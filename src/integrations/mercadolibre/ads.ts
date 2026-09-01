import "server-only";
import { dateKey, differenceInDays, subDays } from "@/lib/dates";
import type { MercadoLibreClient } from "./client";
import {
  adCampaignsResponseSchema,
  adItemsResponseSchema,
  advertisersSchema,
} from "./schemas";

/**
 * Product Ads.
 * Referencia verificada: docs/mercadolibre-api-research.md §7.
 *
 * ## Dos hechos que definen esta implementación
 *
 * 1. **Los endpoints legacy fueron dados de baja.** Rutas del tipo
 *    `/marketplace/advertising/product_ads/campaigns/{id}/ads/metrics` pueden
 *    responder 404 desde febrero de 2026. Acá sólo se usan las vigentes, con el
 *    header `api-version: 2` (salvo `/advertising/advertisers`, que usa
 *    `Api-Version: 1`).
 *
 * 2. **La API sólo devuelve 90 días hacia atrás.** Por eso NUVELA persiste
 *    `AdMetricDaily` todos los días: la base es el histórico real y la API es
 *    apenas una ventana móvil. Si dejáramos de sincronizar un tiempo, esos días
 *    se pierden para siempre.
 *
 * Además, las métricas se consolidan a las 10:00 GMT-3: pedir el día de hoy
 * antes de esa hora devuelve datos parciales.
 */

/** Ventana máxima consultable, en días. */
export const ADS_MAX_LOOKBACK_DAYS = 90;

const API_V2 = { "api-version": "2" };
const API_V1 = { "Api-Version": "1", "Content-Type": "application/json" };

/** Métricas que pedimos. Están todas documentadas en el recurso vigente. */
export const AD_METRICS = [
  "clicks",
  "prints",
  "ctr",
  "cost",
  "cpc",
  "acos",
  "cvr",
  "roas",
  "organic_units_quantity",
  "organic_units_amount",
  "direct_units_quantity",
  "indirect_units_quantity",
  "units_quantity",
  "direct_amount",
  "indirect_amount",
  "total_amount",
].join(",");

export async function fetchAdvertiserId(client: MercadoLibreClient): Promise<string | null> {
  const raw = await client.get<unknown>("/advertising/advertisers", { product_id: "PADS" }, API_V1);
  const parsed = advertisersSchema.parse(raw);
  return parsed.advertisers[0]?.advertiser_id ?? null;
}

export interface AdsDateRange {
  from: Date;
  to: Date;
}

/**
 * Recorta el rango pedido a lo que la API puede devolver.
 * Devuelve además `truncated` para que la sincronización lo registre y el
 * usuario sepa que hay días que sólo existen en nuestra base.
 */
export function clampToAdsWindow(range: AdsDateRange, today: Date): {
  range: AdsDateRange;
  truncated: boolean;
} {
  const earliest = subDays(today, ADS_MAX_LOOKBACK_DAYS);
  if (differenceInDays(range.from, earliest) >= 0) return { range, truncated: false };
  return { range: { from: earliest, to: range.to }, truncated: true };
}

export async function fetchCampaignDailyMetrics(
  client: MercadoLibreClient,
  advertiserId: string,
  range: AdsDateRange,
) {
  const raw = await client.get<unknown>(
    `/advertising/advertisers/${advertiserId}/product_ads/campaigns`,
    {
      limit: 50,
      offset: 0,
      date_from: dateKey(range.from),
      date_to: dateKey(range.to),
      metrics: AD_METRICS,
      aggregation_type: "DAILY",
    },
    API_V2,
  );

  return adCampaignsResponseSchema.parse(raw).results;
}

export async function fetchItemDailyMetrics(
  client: MercadoLibreClient,
  advertiserId: string,
  range: AdsDateRange,
  options: { limit?: number; offset?: number } = {},
) {
  const raw = await client.get<unknown>(
    `/advertising/advertisers/${advertiserId}/product_ads/items`,
    {
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
      date_from: dateKey(range.from),
      date_to: dateKey(range.to),
      metrics: AD_METRICS,
      aggregation_type: "DAILY",
    },
    API_V2,
  );

  return adItemsResponseSchema.parse(raw);
}

/** Recorre todas las páginas de métricas por publicación. */
export async function* iterateItemMetrics(
  client: MercadoLibreClient,
  advertiserId: string,
  range: AdsDateRange,
) {
  const limit = 50;
  let offset = 0;

  for (;;) {
    const page = await fetchItemDailyMetrics(client, advertiserId, range, { limit, offset });
    if (page.results.length === 0) return;

    yield page.results;

    offset += page.results.length;
    if (page.results.length < limit) return;
    if (page.paging && offset >= page.paging.total) return;
  }
}
