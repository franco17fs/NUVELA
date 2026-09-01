import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { businessDate, subDays, subMonths, today } from "@/lib/dates";
import { money } from "@/lib/money";
import { MercadoLibreClient } from "@/integrations/mercadolibre/client";
import {
  ORDERS_HISTORY_MONTHS,
  fetchOrderDiscounts,
  searchOrders,
} from "@/integrations/mercadolibre/orders";
import { fetchShipmentCosts } from "@/integrations/mercadolibre/shipments";
import type { MlOrder } from "@/integrations/mercadolibre/schemas";
import {
  mapOrder,
  normalizeOrderFees,
  sellerDiscountByItem,
  shippingFee,
  type MappedOrder,
} from "./mappers";
import { getCursor, runSyncJob, setCursor } from "./sync-job";
import { feeKey } from "./idempotency";
import { applyCogsToOrder } from "../costing/apply-cogs";

/**
 * Sincronización de ventas.
 *
 * ## Garantías
 *
 * - **Idempotente**: todo se escribe con `upsert` sobre claves únicas que
 *   incluyen la cuenta. Reprocesar la misma orden actualiza, nunca duplica.
 * - **Incremental**: se avanza por `order.date_last_updated`, no por fecha de
 *   creación, para capturar también las órdenes viejas que cambian de estado
 *   (una cancelación de una venta de hace tres semanas).
 * - **Tolerante a fallos**: si falla el envío de una orden, se guarda la orden
 *   igual y queda un `ReconciliationIssue`; una integración caída no tumba el
 *   resto.
 * - **Auditable**: cada corrida deja un `SyncJob` y cada orden guarda el payload
 *   crudo que la originó.
 *
 * ## Solapamiento deliberado
 *
 * La ventana incremental arranca unos minutos ANTES de la última marca de agua.
 * Los filtros de fecha de Mercado Libre tienen precisión de hora, y una orden
 * modificada justo en el borde podría caer entre dos ventanas. Como reprocesar
 * es inocuo (todo es idempotente), preferimos leer de más a perder una venta.
 */

const OVERLAP_MINUTES = 90;

export interface SyncOrdersOptions {
  /** `incremental` usa la marca de agua; `backfill` recorre un rango explícito. */
  mode: "incremental" | "backfill";
  from?: Date;
  to?: Date;
  maxItems?: number;
}

export async function syncOrders(sellerAccountId: string, options: SyncOrdersOptions) {
  const account = await prisma.sellerAccount.findUniqueOrThrow({
    where: { id: sellerAccountId },
  });

  const window = await resolveWindow(sellerAccountId, options);

  return runSyncJob(
    {
      sellerAccountId,
      type: options.mode === "backfill" ? "ORDERS_BACKFILL" : "ORDERS_INCREMENTAL",
      windowFrom: window.from,
      windowTo: window.to,
    },
    async (context) => {
      const client = new MercadoLibreClient(sellerAccountId);
      let maxSeenUpdate = window.from;

      const pages = searchOrders(
        client,
        {
          sellerId: account.mercadoLibreUserId,
          ...(options.mode === "backfill"
            ? { dateCreatedFrom: window.from, dateCreatedTo: window.to }
            : { dateLastUpdatedFrom: window.from, dateLastUpdatedTo: window.to }),
          sort: "date_asc",
        },
        { maxItems: options.maxItems },
      );

      for await (const orders of pages) {
        context.itemsRead += orders.length;

        for (const order of orders) {
          try {
            await persistOrder({ sellerAccountId, order, client });
            context.itemsWritten += 1;

            const updated = new Date(order.date_last_updated);
            if (updated > maxSeenUpdate) maxSeenUpdate = updated;
          } catch (error) {
            // Una orden problemática no aborta la corrida: se registra y se sigue.
            context.itemsSkipped += 1;
            await recordOrderIssue(sellerAccountId, order, error);
          }
        }
      }

      context.rateLimitHits += client.accumulatedRateLimitHits;

      if (options.mode === "incremental") {
        await setCursor(sellerAccountId, "ORDERS_INCREMENTAL", maxSeenUpdate);
      }

      return { ordersProcessed: context.itemsWritten, watermark: maxSeenUpdate };
    },
  );
}

async function resolveWindow(
  sellerAccountId: string,
  options: SyncOrdersOptions,
): Promise<{ from: Date; to: Date }> {
  const to = options.to ?? new Date();

  if (options.mode === "backfill") {
    // Mercado Libre conserva sólo 12 meses de órdenes: pedir más atrás no
    // devuelve nada. El techo se aplica acá para no generar expectativas falsas.
    const earliest = subMonths(today(), ORDERS_HISTORY_MONTHS);
    const requested = options.from ?? earliest;
    return { from: requested < earliest ? earliest : requested, to };
  }

  const cursor = await getCursor(sellerAccountId, "ORDERS_INCREMENTAL");
  const from =
    options.from ??
    (cursor.lastWatermark
      ? new Date(cursor.lastWatermark.getTime() - OVERLAP_MINUTES * 60_000)
      : // Primera corrida sin histórico previo: se cubren 30 días.
        subDays(today(), 30));

  return { from, to };
}

/**
 * Persiste una orden completa: cabecera, ítems, pagos, cargos y envío.
 *
 * Todo ocurre en una transacción: o queda la orden entera y coherente, o no
 * queda nada. Media orden guardada sería peor que ninguna, porque el dashboard
 * mostraría facturación sin sus costos.
 */
export async function persistOrder(params: {
  sellerAccountId: string;
  order: MlOrder;
  client: MercadoLibreClient;
}): Promise<string> {
  const timezone = getEnv().APP_TIMEZONE;
  const mapped = mapOrder(params.order, timezone);

  // Los descuentos y el costo de envío se piden ANTES de abrir la transacción:
  // una transacción no debe quedarse esperando llamadas de red.
  const discounts = await fetchOrderDiscounts(params.client, mapped.mlOrderId);
  const discountByItem = sellerDiscountByItem(discounts);

  const shipmentCosts = mapped.shipmentId
    ? await fetchShipmentCosts(params.client, mapped.shipmentId).catch(() => null)
    : null;

  const orderId = await prisma.$transaction(async (tx) => {
    const record = await tx.order.upsert({
      where: {
        sellerAccountId_mlOrderId: {
          sellerAccountId: params.sellerAccountId,
          mlOrderId: BigInt(mapped.mlOrderId),
        },
      },
      create: buildOrderData(params.sellerAccountId, mapped, params.order),
      update: buildOrderUpdate(mapped, params.order),
      select: { id: true },
    });

    await upsertItems(tx, record.id, mapped, discountByItem);
    await upsertPayments(tx, params.sellerAccountId, record.id, mapped);
    await upsertFees(tx, params.sellerAccountId, record.id, mapped, shipmentCosts);
    await upsertShipment(tx, params.sellerAccountId, record.id, mapped, shipmentCosts);

    return record.id;
  });

  // El COGS se aplica fuera de la transacción de la orden porque mueve stock y
  // escribe historial de costos: es un proceso propio, con su propia
  // idempotencia (ver src/server/costing/apply-cogs.ts).
  await applyCogsToOrder(orderId).catch(() => {
    // Si falla, la orden ya está guardada; el margen queda marcado como
    // estimado hasta que se pueda costear.
  });

  return orderId;
}

function buildOrderData(
  sellerAccountId: string,
  mapped: MappedOrder,
  raw: MlOrder,
): Prisma.OrderCreateInput {
  return {
    sellerAccount: { connect: { id: sellerAccountId } },
    mlOrderId: BigInt(mapped.mlOrderId),
    packId: mapped.packId ? BigInt(mapped.packId) : null,
    status: mapped.status,
    statusDetail: mapped.statusDetail,
    currencyId: mapped.currencyId,
    totalAmount: mapped.totalAmount,
    paidAmount: mapped.paidAmount,
    couponAmount: mapped.couponAmount,
    shippingCost: mapped.shippingCost,
    taxesAmount: mapped.taxesAmount,
    dateCreated: mapped.dateCreated,
    dateClosed: mapped.dateClosed,
    dateLastUpdated: mapped.dateLastUpdated,
    businessDate: mapped.businessDate,
    buyerId: mapped.buyerId ? BigInt(mapped.buyerId) : null,
    tags: mapped.tags,
    cancelGroup: mapped.cancelGroup,
    cancelCode: mapped.cancelCode,
    cancelReason: mapped.cancelReason,
    rawPayload: raw as unknown as Prisma.InputJsonValue,
    source: "MELI_API",
    sourceReferenceId: mapped.mlOrderId,
    syncedAt: new Date(),
  };
}

function buildOrderUpdate(mapped: MappedOrder, raw: MlOrder): Prisma.OrderUpdateInput {
  return {
    status: mapped.status,
    statusDetail: mapped.statusDetail,
    totalAmount: mapped.totalAmount,
    paidAmount: mapped.paidAmount,
    couponAmount: mapped.couponAmount,
    shippingCost: mapped.shippingCost,
    taxesAmount: mapped.taxesAmount,
    dateClosed: mapped.dateClosed,
    dateLastUpdated: mapped.dateLastUpdated,
    tags: mapped.tags,
    cancelGroup: mapped.cancelGroup,
    cancelCode: mapped.cancelCode,
    cancelReason: mapped.cancelReason,
    packId: mapped.packId ? BigInt(mapped.packId) : null,
    rawPayload: raw as unknown as Prisma.InputJsonValue,
    syncedAt: new Date(),
    // `businessDate` NO se actualiza: la fecha de venta de una orden histórica
    // es inmutable. Si cambiara, el P&L de un mes ya cerrado se movería solo.
  };
}

type Tx = Prisma.TransactionClient;

async function upsertItems(
  tx: Tx,
  orderId: string,
  mapped: MappedOrder,
  discountByItem: Map<string, string>,
): Promise<void> {
  for (const item of mapped.items) {
    const sellerDiscount = discountByItem.get(item.mlItemId) ?? "0";

    await tx.orderItem.upsert({
      where: { orderId_position: { orderId, position: item.position } },
      create: {
        orderId,
        position: item.position,
        mlItemId: item.mlItemId,
        variationId: item.variationId,
        title: item.title,
        categoryId: item.categoryId,
        listingTypeId: item.listingTypeId,
        sellerSku: item.sellerSku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        grossPrice: item.grossPrice,
        sellerDiscount,
        saleFee: item.saleFee,
        saleFeeKind: item.saleFee ? "ACTUAL" : "ESTIMATED",
        saleFeeSource: "MELI_API",
      },
      update: {
        // El snapshot de la publicación NO se refresca: el título y la categoría
        // que valen son los del momento de la venta (§6 del brief).
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        grossPrice: item.grossPrice,
        sellerDiscount,
        saleFee: item.saleFee,
        saleFeeKind: item.saleFee ? "ACTUAL" : "ESTIMATED",
      },
    });
  }
}

async function upsertPayments(
  tx: Tx,
  sellerAccountId: string,
  orderId: string,
  mapped: MappedOrder,
): Promise<void> {
  for (const payment of mapped.payments) {
    await tx.payment.upsert({
      where: {
        sellerAccountId_mlPaymentId: {
          sellerAccountId,
          mlPaymentId: BigInt(payment.mlPaymentId),
        },
      },
      create: {
        sellerAccountId,
        orderId,
        mlPaymentId: BigInt(payment.mlPaymentId),
        status: payment.status,
        statusDetail: payment.statusDetail,
        currencyId: payment.currencyId,
        transactionAmount: payment.transactionAmount,
        totalPaidAmount: payment.totalPaidAmount,
        marketplaceFee: payment.marketplaceFee,
        taxesAmount: payment.taxesAmount,
        shippingCost: payment.shippingCost,
        couponAmount: payment.couponAmount,
        overpaidAmount: payment.overpaidAmount,
        installments: payment.installments,
        installmentAmount: payment.installmentAmount,
        paymentType: payment.paymentType,
        paymentMethodId: payment.paymentMethodId,
        operationType: payment.operationType,
        dateCreated: payment.dateCreated,
        dateApproved: payment.dateApproved,
        source: "MELI_API",
        sourceReferenceId: payment.mlPaymentId,
      },
      update: {
        orderId,
        status: payment.status,
        statusDetail: payment.statusDetail,
        transactionAmount: payment.transactionAmount,
        totalPaidAmount: payment.totalPaidAmount,
        marketplaceFee: payment.marketplaceFee,
        taxesAmount: payment.taxesAmount,
        shippingCost: payment.shippingCost,
        couponAmount: payment.couponAmount,
        overpaidAmount: payment.overpaidAmount,
        dateApproved: payment.dateApproved,
        syncedAt: new Date(),
        // `moneyReleaseDate` NO se toca acá: ese dato viene de Mercado Pago, no
        // del recurso de órdenes. Lo completa la sincronización de pagos.
      },
    });
  }
}

async function upsertFees(
  tx: Tx,
  sellerAccountId: string,
  orderId: string,
  mapped: MappedOrder,
  shipmentCosts: { senderCost: string | null } | null,
): Promise<void> {
  const fees = normalizeOrderFees(mapped);

  if (shipmentCosts && mapped.shipmentId) {
    const fee = shippingFee({
      senderCost: shipmentCosts.senderCost,
      orderId: mapped.mlOrderId,
      shipmentId: mapped.shipmentId,
    });
    if (fee) fees.push(fee);
  }

  for (const fee of fees) {
    const dedupeKey = feeKey({ orderId, type: fee.type, source: fee.source });

    await tx.marketplaceFee.upsert({
      where: { sellerAccountId_dedupeKey: { sellerAccountId, dedupeKey } },
      create: {
        sellerAccountId,
        orderId,
        dedupeKey,
        type: fee.type,
        amount: fee.amount.toString(),
        currencyId: mapped.currencyId,
        kind: fee.kind,
        source: fee.source,
        sourceReferenceId: fee.sourceReferenceId,
        businessDate: mapped.businessDate,
        description: fee.description,
      },
      update: {
        amount: fee.amount.toString(),
        kind: fee.kind,
        description: fee.description,
        syncedAt: new Date(),
      },
    });
  }
}

async function upsertShipment(
  tx: Tx,
  sellerAccountId: string,
  orderId: string,
  mapped: MappedOrder,
  costs: {
    grossAmount: string | null;
    senderCost: string | null;
    receiverCost: string | null;
    discountsTotal: string;
    discounts: unknown;
  } | null,
): Promise<void> {
  if (!mapped.shipmentId) return;

  await tx.shipment.upsert({
    where: {
      sellerAccountId_mlShipmentId: {
        sellerAccountId,
        mlShipmentId: BigInt(mapped.shipmentId),
      },
    },
    create: {
      sellerAccountId,
      orderId,
      mlShipmentId: BigInt(mapped.shipmentId),
      packId: mapped.packId ? BigInt(mapped.packId) : null,
      grossAmount: costs?.grossAmount ?? null,
      senderCost: costs?.senderCost ?? null,
      receiverCost: costs?.receiverCost ?? null,
      discountsTotal: costs?.discountsTotal ?? "0",
      discountsDetail: (costs?.discounts ?? null) as Prisma.InputJsonValue,
      source: "MELI_API",
      sourceReferenceId: mapped.shipmentId,
    },
    update: {
      orderId,
      grossAmount: costs?.grossAmount ?? undefined,
      senderCost: costs?.senderCost ?? undefined,
      receiverCost: costs?.receiverCost ?? undefined,
      discountsTotal: costs?.discountsTotal ?? undefined,
      discountsDetail: (costs?.discounts ?? undefined) as Prisma.InputJsonValue,
      syncedAt: new Date(),
    },
  });
}

/** Deja registro de una orden que no se pudo procesar, sin abortar la corrida. */
async function recordOrderIssue(
  sellerAccountId: string,
  order: MlOrder,
  error: unknown,
): Promise<void> {
  const fingerprint = `order-sync-failed:${order.id}`;

  await prisma.reconciliationIssue
    .upsert({
      where: { sellerAccountId_fingerprint: { sellerAccountId, fingerprint } },
      create: {
        sellerAccountId,
        type: "AMOUNT_MISMATCH",
        severity: "HIGH",
        businessDate: businessDate(new Date(order.date_created), getEnv().APP_TIMEZONE),
        expectedAmount: money(order.total_amount).toString(),
        description: `No se pudo procesar la orden ${order.id}. Se reintentará en la próxima sincronización.`,
        context: { mlOrderId: order.id, reason: describeError(error) },
        fingerprint,
      },
      update: {
        status: "OPEN",
        context: { mlOrderId: order.id, reason: describeError(error) },
      },
    })
    .catch(() => {
      // Si ni siquiera se puede registrar el problema, no vale la pena romper
      // toda la sincronización por eso.
    });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "error desconocido";
}
