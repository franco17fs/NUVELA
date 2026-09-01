import "server-only";
import { prisma } from "@/lib/prisma";
import { toUserMessage } from "@/lib/errors";
import { MercadoLibreClient } from "@/integrations/mercadolibre/client";
import { fetchOrder } from "@/integrations/mercadolibre/orders";
import { resourceId, resourceKind } from "@/integrations/mercadolibre/notifications";
import { persistOrder } from "./orders-sync";
import { runSyncJob } from "./sync-job";

/**
 * Procesamiento asíncrono de la cola de notificaciones.
 *
 * El endpoint del webhook sólo encola y responde 200 en menos de 500 ms
 * (requisito de Mercado Libre). Acá se hace el trabajo de verdad: por cada
 * evento se consulta el recurso y se persiste.
 *
 * Cada evento se marca `PROCESSING` antes de trabajarlo, de modo que dos
 * corridas simultáneas no tomen el mismo. El `processAttempts` acotado evita que
 * un evento imposible de procesar se reintente para siempre.
 */

const MAX_PROCESS_ATTEMPTS = 5;

export async function processPendingWebhooks(options: { batchSize?: number } = {}) {
  const batchSize = options.batchSize ?? 50;

  return runSyncJob({ sellerAccountId: null, type: "ORDER_DETAIL" }, async (context) => {
    const events = await prisma.webhookEvent.findMany({
      where: {
        status: { in: ["RECEIVED", "FAILED"] },
        processAttempts: { lt: MAX_PROCESS_ATTEMPTS },
        sellerAccountId: { not: null },
      },
      orderBy: { receivedAt: "asc" },
      take: batchSize,
    });

    context.itemsRead = events.length;

    for (const event of events) {
      // Toma exclusiva: si otra corrida ya lo agarró, `count` viene en 0.
      const claimed = await prisma.webhookEvent.updateMany({
        where: { id: event.id, status: { in: ["RECEIVED", "FAILED"] } },
        data: { status: "PROCESSING", processAttempts: { increment: 1 } },
      });

      if (claimed.count === 0) {
        context.itemsSkipped += 1;
        continue;
      }

      try {
        await processEvent(event.id, event.sellerAccountId as string, event.topic, event.resource);

        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: { status: "PROCESSED", processedAt: new Date(), errorMessage: null },
        });
        context.itemsWritten += 1;
      } catch (error) {
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: { status: "FAILED", errorMessage: toUserMessage(error) },
        });
        context.itemsSkipped += 1;
      }
    }

    return { processed: context.itemsWritten };
  });
}

async function processEvent(
  _eventId: string,
  sellerAccountId: string,
  topic: string,
  resource: string,
): Promise<void> {
  const id = resourceId(resource);
  if (!id) return;

  const client = new MercadoLibreClient(sellerAccountId);

  switch (topic) {
    case "orders_v2": {
      const order = await fetchOrder(client, id);
      await persistOrder({ sellerAccountId, order, client });
      return;
    }

    case "shipments":
    case "payments": {
      // Ambos tópicos apuntan a datos que ya se traen al persistir la orden.
      // En vez de duplicar lógica, se resuelve la orden asociada y se
      // reprocesa entera, que es idempotente.
      await reprocessOrderFor(client, sellerAccountId, topic, id);
      return;
    }

    default:
      // Tópicos que todavía no movemos (items, invoices, post_purchase) quedan
      // guardados en la cola. Se marcan procesados para no reintentarlos, pero
      // el payload sigue disponible para cuando se implementen.
      return;
  }
}

async function reprocessOrderFor(
  client: MercadoLibreClient,
  sellerAccountId: string,
  topic: string,
  id: string,
): Promise<void> {
  const orderId =
    topic === "payments"
      ? (
          await prisma.payment.findUnique({
            where: { sellerAccountId_mlPaymentId: { sellerAccountId, mlPaymentId: BigInt(id) } },
            select: { order: { select: { mlOrderId: true } } },
          })
        )?.order?.mlOrderId
      : (
          await prisma.shipment.findUnique({
            where: { sellerAccountId_mlShipmentId: { sellerAccountId, mlShipmentId: BigInt(id) } },
            select: { order: { select: { mlOrderId: true } } },
          })
        )?.order?.mlOrderId;

  if (!orderId) return;

  const order = await fetchOrder(client, orderId.toString());
  await persistOrder({ sellerAccountId, order, client });
}

/** Ignora explícitamente un tópico que no procesamos, para no reintentarlo. */
export async function markUnhandledTopicsProcessed(topics: string[]): Promise<number> {
  const result = await prisma.webhookEvent.updateMany({
    where: { status: "RECEIVED", topic: { in: topics } },
    data: { status: "IGNORED", processedAt: new Date() },
  });
  return result.count;
}

export { resourceKind };
