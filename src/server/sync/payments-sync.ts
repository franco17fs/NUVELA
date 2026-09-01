import "server-only";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { businessDate, subDays, today } from "@/lib/dates";
import { money } from "@/lib/money";
import { MercadoPagoClient } from "@/integrations/mercadopago/client";
import { searchPayments, sellerFees } from "@/integrations/mercadopago/payments";
import { getCursor, runSyncJob, setCursor } from "./sync-job";

/**
 * Sincronización de pagos con Mercado Pago.
 *
 * ## Qué agrega sobre lo que ya trae el recurso de órdenes
 *
 * El recurso de órdenes de Mercado Libre trae los pagos, pero **no trae
 * `money_release_date`**: cuándo el dinero queda disponible. Ese dato sólo está
 * en Mercado Pago, y es el que permite separar VENTA de COBRO en todo el
 * cashflow. También trae `net_received_amount` y el desglose de `fee_details`.
 *
 * Por eso esta sincronización no crea pagos nuevos como regla: enriquece los que
 * ya existen. Si aparece un pago que no está en ninguna orden, se registra como
 * `ReconciliationIssue` (pago sin venta) en vez de inventarle una orden.
 */
export async function syncPayments(
  sellerAccountId: string,
  options: { from?: Date; to?: Date } = {},
) {
  const timezone = getEnv().APP_TIMEZONE;
  const cursor = await getCursor(sellerAccountId, "PAYMENTS");

  const from = options.from ?? cursor.lastWatermark ?? subDays(today(), 30);
  const to = options.to ?? new Date();

  return runSyncJob(
    { sellerAccountId, type: "PAYMENTS", windowFrom: from, windowTo: to },
    async (context) => {
      const client = new MercadoPagoClient(sellerAccountId);

      for await (const payments of searchPayments(client, {
        beginDate: from,
        endDate: to,
        range: "date_last_updated",
      })) {
        context.itemsRead += payments.length;

        for (const payment of payments) {
          const existing = await prisma.payment.findUnique({
            where: {
              sellerAccountId_mlPaymentId: {
                sellerAccountId,
                mlPaymentId: BigInt(payment.id),
              },
            },
            select: { id: true },
          });

          const moneyReleaseDate = payment.money_release_date
            ? new Date(payment.money_release_date)
            : null;

          if (!existing) {
            // Un pago sin orden conocida no se inventa: se deja registrado para
            // que la conciliación lo muestre y el usuario decida.
            await recordOrphanPayment(sellerAccountId, payment.id, payment.transaction_amount, timezone);
            context.itemsSkipped += 1;
            continue;
          }

          await prisma.payment.update({
            where: { id: existing.id },
            data: {
              moneyReleaseDate,
              cashBusinessDate: moneyReleaseDate
                ? businessDate(moneyReleaseDate, timezone)
                : null,
              netReceivedAmount: payment.transaction_details?.net_received_amount ?? null,
              // El fee de Mercado Pago se guarda como referencia; el cargo que
              // impacta el P&L sigue siendo el de Mercado Libre, para no contar
              // la misma comisión dos veces.
              syncedAt: new Date(),
              source: "MP_API",
              sourceReferenceId: payment.id,
              rawPayload: {
                fee_details: payment.fee_details,
                seller_fees: sellerFees(payment),
                status: payment.status,
              },
            },
          });

          context.itemsWritten += 1;
        }
      }

      context.rateLimitHits += client.accumulatedRateLimitHits;
      await setCursor(sellerAccountId, "PAYMENTS", to);

      return { paymentsUpdated: context.itemsWritten };
    },
  );
}

async function recordOrphanPayment(
  sellerAccountId: string,
  paymentId: string,
  amount: string | null,
  timezone: string,
): Promise<void> {
  const fingerprint = `payment-without-order:${paymentId}`;

  await prisma.reconciliationIssue
    .upsert({
      where: { sellerAccountId_fingerprint: { sellerAccountId, fingerprint } },
      create: {
        sellerAccountId,
        type: "PAYMENT_WITHOUT_ORDER",
        severity: "MEDIUM",
        businessDate: businessDate(new Date(), timezone),
        actualAmount: money(amount).toString(),
        description: `El pago ${paymentId} de Mercado Pago no tiene una venta asociada en el sistema.`,
        context: { mpPaymentId: paymentId },
        fingerprint,
      },
      update: { status: "OPEN" },
    })
    .catch(() => {
      // Registrar el problema es best-effort: no puede tumbar la sincronización.
    });
}
