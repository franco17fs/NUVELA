import "server-only";
import type { MercadoLibreClient } from "./client";
import { missedFeedsSchema } from "./schemas";

/**
 * Notificaciones perdidas.
 * Referencia verificada: docs/mercadolibre-api-research.md §8.4.
 *
 * **Limitación dura: `missed_feeds` sólo guarda notificaciones perdidas de hasta
 * 2 días atrás.** Por eso es apenas el primer nivel de recuperación. El que
 * realmente garantiza que no se pierda una venta es el barrido periódico por
 * `order.date_last_updated.from`, que no depende de webhooks (ver
 * docs/sync-strategy.md).
 */

export const MISSED_FEEDS_MAX_DAYS = 2;

/** Tópicos a los que se suscribe NUVELA. */
export const SUBSCRIBED_TOPICS = [
  "orders_v2",
  "shipments",
  "payments",
  "invoices",
  "post_purchase",
  "items",
] as const;

export type SubscribedTopic = (typeof SUBSCRIBED_TOPICS)[number];

export async function fetchMissedFeeds(
  client: MercadoLibreClient,
  params: { appId: string; topic?: string; offset?: number; limit?: number },
) {
  const raw = await client.get<unknown>("/missed_feeds", {
    app_id: params.appId,
    topic: params.topic,
    offset: params.offset ?? 0,
    limit: params.limit ?? 50,
  });

  return missedFeedsSchema.parse(raw).messages;
}

/**
 * Extrae el ID del recurso de una notificación.
 * El payload trae `"resource": "/orders/2195160686"`, nunca el dato en sí: hay
 * que hacer el GET.
 */
export function resourceId(resource: string): string | null {
  const parts = resource.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return last && /^\d+$/.test(last) ? last : (last ?? null);
}

/** Tipo de recurso al que apunta la notificación. */
export function resourceKind(resource: string): string | null {
  const parts = resource.split("/").filter(Boolean);
  return parts[0] ?? null;
}
