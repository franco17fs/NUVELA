import "server-only";
import { prisma } from "@/lib/prisma";
import { dateKey, parseDateKey, subDays, today } from "@/lib/dates";
import { money, ratio } from "@/lib/money";
import { MercadoLibreClient } from "@/integrations/mercadolibre/client";
import {
  clampToAdsWindow,
  fetchAdvertiserId,
  fetchCampaignDailyMetrics,
  iterateItemMetrics,
} from "@/integrations/mercadolibre/ads";
import { adMetricKey } from "./idempotency";
import { runSyncJob } from "./sync-job";

/**
 * Sincronización diaria de Product Ads.
 *
 * ## Por qué esto tiene que correr todos los días
 *
 * La API sólo devuelve **90 días hacia atrás**. Si dejamos de sincronizar dos
 * meses, esos días desaparecen para siempre y con ellos la posibilidad de
 * comparar rentabilidad interanual. `AdMetricDaily` es nuestro histórico real;
 * la API es apenas una ventana móvil sobre él.
 *
 * Las métricas se consolidan a las 10:00 GMT-3, así que la corrida por defecto
 * termina en el día de AYER: pedir el día en curso antes de esa hora devuelve
 * datos parciales que después habría que corregir.
 */
export async function syncAds(
  sellerAccountId: string,
  options: { from?: Date; to?: Date } = {},
) {
  const currentDay = today();
  const requested = {
    from: options.from ?? subDays(currentDay, 7),
    // Por defecto hasta ayer: el día de hoy todavía no está consolidado.
    to: options.to ?? subDays(currentDay, 1),
  };

  const { range, truncated } = clampToAdsWindow(requested, currentDay);

  return runSyncJob(
    { sellerAccountId, type: "ADS_DAILY", windowFrom: range.from, windowTo: range.to },
    async (context) => {
      const client = new MercadoLibreClient(sellerAccountId);

      const account = await prisma.sellerAccount.findUniqueOrThrow({
        where: { id: sellerAccountId },
        select: { advertiserId: true },
      });

      let advertiserId = account.advertiserId?.toString() ?? null;
      if (!advertiserId) {
        advertiserId = await fetchAdvertiserId(client);
        if (advertiserId) {
          await prisma.sellerAccount.update({
            where: { id: sellerAccountId },
            data: { advertiserId: BigInt(advertiserId) },
          });
        }
      }

      if (!advertiserId) {
        // La cuenta no tiene Product Ads. No es un error: se registra y listo.
        return { skipped: "sin advertiser de Product Ads", truncated };
      }

      const campaigns = await fetchCampaignDailyMetrics(client, advertiserId, range);
      context.itemsRead += campaigns.length;

      for (const campaign of campaigns) {
        const record = await prisma.adCampaign.upsert({
          where: {
            sellerAccountId_mlCampaignId: {
              sellerAccountId,
              mlCampaignId: BigInt(campaign.id),
            },
          },
          create: {
            sellerAccountId,
            mlCampaignId: BigInt(campaign.id),
            name: campaign.name,
            status: campaign.status,
            strategy: campaign.strategy,
            budget: campaign.budget,
            channel: campaign.channel,
            dateCreated: campaign.date_created ? new Date(campaign.date_created) : null,
          },
          update: {
            name: campaign.name,
            status: campaign.status,
            budget: campaign.budget,
            syncedAt: new Date(),
          },
          select: { id: true },
        });

        for (const metric of campaign.metrics ?? []) {
          await upsertDailyMetric({
            sellerAccountId,
            level: "CAMPAIGN",
            entityId: campaign.id,
            adCampaignId: record.id,
            mlItemId: null,
            date: metric.date,
            metric,
          });
          context.itemsWritten += 1;
        }
      }

      for await (const items of iterateItemMetrics(client, advertiserId, range)) {
        context.itemsRead += items.length;

        for (const item of items) {
          const campaign = item.campaign_id
            ? await prisma.adCampaign.findUnique({
                where: {
                  sellerAccountId_mlCampaignId: {
                    sellerAccountId,
                    mlCampaignId: BigInt(item.campaign_id),
                  },
                },
                select: { id: true },
              })
            : null;

          for (const metric of item.metrics ?? []) {
            await upsertDailyMetric({
              sellerAccountId,
              level: "ITEM",
              entityId: item.id,
              adCampaignId: campaign?.id ?? null,
              mlItemId: item.id,
              date: metric.date,
              metric,
            });
            context.itemsWritten += 1;
          }
        }
      }

      context.rateLimitHits += client.accumulatedRateLimitHits;

      return { truncated, metricsWritten: context.itemsWritten };
    },
  );
}

interface DailyMetricPayload {
  clicks?: number | null;
  prints?: number | null;
  ctr?: number | null;
  cost: string | null;
  cpc: string | null;
  acos?: number | null;
  cvr?: number | null;
  roas?: number | null;
  organic_units_quantity?: number | null;
  organic_units_amount: string | null;
  direct_units_quantity?: number | null;
  indirect_units_quantity?: number | null;
  units_quantity?: number | null;
  direct_amount: string | null;
  indirect_amount: string | null;
  total_amount: string | null;
}

async function upsertDailyMetric(params: {
  sellerAccountId: string;
  level: "CAMPAIGN" | "ITEM";
  entityId: string;
  adCampaignId: string | null;
  mlItemId: string | null;
  date: string;
  metric: DailyMetricPayload;
}): Promise<void> {
  const day = parseDateKey(params.date.slice(0, 10));
  const dedupeKey = adMetricKey({
    level: params.level,
    entityId: params.entityId,
    date: dateKey(day),
  });

  const cost = money(params.metric.cost);
  const attributed = money(params.metric.total_amount);

  const data = {
    adCampaignId: params.adCampaignId,
    mlItemId: params.mlItemId,
    level: params.level,
    date: day,
    cost: cost.toString(),
    clicks: params.metric.clicks ?? 0,
    impressions: params.metric.prints ?? 0,
    cpc: money(params.metric.cpc).toString(),
    ctr: (params.metric.ctr ?? 0).toString(),
    cvr: (params.metric.cvr ?? 0).toString(),
    directUnits: params.metric.direct_units_quantity ?? 0,
    indirectUnits: params.metric.indirect_units_quantity ?? 0,
    totalUnits: params.metric.units_quantity ?? 0,
    directAmount: money(params.metric.direct_amount).toString(),
    indirectAmount: money(params.metric.indirect_amount).toString(),
    totalAmount: attributed.toString(),
    organicUnits: params.metric.organic_units_quantity ?? 0,
    organicAmount: money(params.metric.organic_units_amount).toString(),
    // Si la API manda ROAS/ACOS se usan; si no, se derivan de importes que ya
    // tenemos. Nunca se dejan nulos silenciosamente.
    roas: (params.metric.roas ?? Number(ratio(attributed, cost).toFixed(6))).toString(),
    acos: (params.metric.acos ?? Number(ratio(cost, attributed).times(100).toFixed(6))).toString(),
    source: "MELI_API" as const,
    syncedAt: new Date(),
  };

  await prisma.adMetricDaily.upsert({
    where: {
      sellerAccountId_dedupeKey: { sellerAccountId: params.sellerAccountId, dedupeKey },
    },
    create: { sellerAccountId: params.sellerAccountId, dedupeKey, ...data },
    update: data,
  });
}
