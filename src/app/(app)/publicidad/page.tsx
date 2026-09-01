import { Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { prisma } from "@/lib/prisma";
import { formatARS, formatPercent, money, ratio, ZERO } from "@/lib/money";
import { ADS_MAX_LOOKBACK_DAYS } from "@/integrations/mercadolibre/ads";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { scopeFilter } from "@/server/queries/accounts";
import { getPeriodTotals } from "@/server/queries/finance";

export const dynamic = "force-dynamic";

/**
 * Publicidad (Product Ads) — §12 del brief.
 *
 * Los datos salen de nuestra base, no de la API: Mercado Libre sólo devuelve 90
 * días hacia atrás, así que el histórico real es el que persistimos día a día.
 * Sin esa persistencia, comparar contra el año pasado sería imposible.
 */
export default async function AdvertisingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, period, comparison } = resolveContext(params);

  const [campaignMetrics, itemMetrics, totals, previousTotals, previousAds] = await Promise.all([
    prisma.adMetricDaily.groupBy({
      by: ["adCampaignId"],
      where: { ...scopeFilter(scope), level: "CAMPAIGN", date: { gte: period.from, lte: period.to } },
      _sum: {
        cost: true,
        clicks: true,
        impressions: true,
        totalAmount: true,
        totalUnits: true,
        organicAmount: true,
      },
    }),
    prisma.adMetricDaily.groupBy({
      by: ["mlItemId"],
      where: { ...scopeFilter(scope), level: "ITEM", date: { gte: period.from, lte: period.to } },
      _sum: { cost: true, clicks: true, impressions: true, totalAmount: true, totalUnits: true },
      orderBy: { _sum: { cost: "desc" } },
      take: 50,
    }),
    getPeriodTotals(scope, period),
    getPeriodTotals(scope, comparison),
    prisma.adMetricDaily.aggregate({
      where: { ...scopeFilter(scope), level: "ITEM", date: { gte: comparison.from, lte: comparison.to } },
      _sum: { cost: true },
    }),
  ]);

  const campaigns = await prisma.adCampaign.findMany({
    where: scopeFilter(scope),
    select: { id: true, name: true, status: true },
  });
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  const totalCost = itemMetrics.reduce((acc, row) => acc.plus(money(row._sum.cost)), ZERO);
  const totalAttributed = itemMetrics.reduce(
    (acc, row) => acc.plus(money(row._sum.totalAmount)),
    ZERO,
  );
  const totalClicks = itemMetrics.reduce((acc, row) => acc + (row._sum.clicks ?? 0), 0);
  const totalImpressions = itemMetrics.reduce((acc, row) => acc + (row._sum.impressions ?? 0), 0);
  const clicksHint =
    totalImpressions === 0
      ? undefined
      : `${totalClicks.toLocaleString("es-AR")} clicks · CTR ${formatPercent(
          money(totalClicks).div(totalImpressions).times(100),
          2,
        )}`;

  const marginAfterAds = totals.contributionMargin;
  const marginBeforeAds = marginAfterAds.plus(totalCost);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Publicidad</h1>
        <p className="text-sm text-ink-muted">
          {period.label} · Product Ads, con histórico propio
        </p>
      </header>

      <KpiGrid>
        <Kpi
          label="Inversión"
          value={totalCost}
          previous={money(previousAds._sum.cost)}
          higherIsBetter={false}
          hint={clicksHint}
        />
        <Kpi
          label="Publicidad / ventas"
          value={totals.grossRevenue.isZero() ? ZERO : totalCost.div(totals.grossRevenue).times(100)}
          format="percent"
          higherIsBetter={false}
          hint="TACOS"
        />
        <Kpi
          label="ROAS"
          value={ratio(totalAttributed, totalCost)}
          format="number"
          hint="facturación atribuida / inversión"
        />
        <Kpi
          label="ACOS"
          value={ratio(totalCost, totalAttributed).times(100)}
          format="percent"
          higherIsBetter={false}
        />
        <Kpi label="Margen antes de publicidad" value={marginBeforeAds} />
        <Kpi
          label="Margen después de publicidad"
          value={marginAfterAds}
          previous={previousTotals.contributionMargin}
        />
      </KpiGrid>

      <div className="rounded-lg border border-border-subtle bg-surface px-4 py-3 text-xs text-ink-muted">
        La API de Product Ads sólo devuelve {ADS_MAX_LOOKBACK_DAYS} días hacia atrás. Los datos de
        esta pantalla salen de nuestra propia base, que se alimenta todos los días: por eso podés
        consultar períodos anteriores a esa ventana, siempre que la sincronización haya estado
        corriendo.
      </div>

      <Card>
        <CardHeader title="Por campaña" />
        {campaignMetrics.length === 0 ? (
          <EmptyState
            title="Sin datos de publicidad"
            description="La cuenta no tiene Product Ads activo, o todavía no corrió la sincronización de publicidad."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Campaña</Th>
                <Th align="right">Inversión</Th>
                <Th align="right">Impresiones</Th>
                <Th align="right">Clicks</Th>
                <Th align="right">CPC</Th>
                <Th align="right">CTR</Th>
                <Th align="right">Facturación atribuida</Th>
                <Th align="right">ROAS</Th>
              </tr>
            </thead>
            <tbody>
              {campaignMetrics.map((row) => {
                const cost = money(row._sum.cost);
                const clicks = row._sum.clicks ?? 0;
                const impressions = row._sum.impressions ?? 0;
                const attributed = money(row._sum.totalAmount);

                return (
                  <tr key={row.adCampaignId ?? "sin-campana"}>
                    <Td className="font-medium">
                      {row.adCampaignId
                        ? (campaignById.get(row.adCampaignId)?.name ?? row.adCampaignId)
                        : "Sin campaña"}
                    </Td>
                    <Td align="right">{formatARS(cost)}</Td>
                    <Td align="right">{impressions.toLocaleString("es-AR")}</Td>
                    <Td align="right">{clicks.toLocaleString("es-AR")}</Td>
                    <Td align="right">
                      {clicks === 0 ? "—" : formatARS(cost.div(clicks), { cents: true })}
                    </Td>
                    <Td align="right">
                      {impressions === 0
                        ? "—"
                        : formatPercent(money(clicks).div(impressions).times(100), 2)}
                    </Td>
                    <Td align="right">{formatARS(attributed)}</Td>
                    <Td align="right">
                      {cost.isZero() ? "—" : ratio(attributed, cost).toDecimalPlaces(2).toFixed(2)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Por publicación" description="Las 50 publicaciones con más inversión." />
        {itemMetrics.length === 0 ? (
          <EmptyState title="Sin datos" description="No hay métricas por publicación en el período." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Publicación</Th>
                <Th align="right">Inversión</Th>
                <Th align="right">Clicks</Th>
                <Th align="right">Unid. atribuidas</Th>
                <Th align="right">Facturación atribuida</Th>
                <Th align="right">ROAS</Th>
                <Th align="right">ACOS</Th>
              </tr>
            </thead>
            <tbody>
              {itemMetrics.map((row) => {
                const cost = money(row._sum.cost);
                const attributed = money(row._sum.totalAmount);

                return (
                  <tr key={row.mlItemId ?? "sin-item"}>
                    <Td className="font-medium">{row.mlItemId ?? "—"}</Td>
                    <Td align="right">{formatARS(cost)}</Td>
                    <Td align="right">{(row._sum.clicks ?? 0).toLocaleString("es-AR")}</Td>
                    <Td align="right">{row._sum.totalUnits ?? 0}</Td>
                    <Td align="right">{formatARS(attributed)}</Td>
                    <Td align="right">
                      {cost.isZero() ? "—" : ratio(attributed, cost).toDecimalPlaces(2).toFixed(2)}
                    </Td>
                    <Td align="right">
                      {attributed.isZero() ? "—" : formatPercent(ratio(cost, attributed).times(100))}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <CardBody className="text-xs text-ink-subtle">
          El impacto de la publicidad en el margen de cada SKU está en la pantalla de
          Rentabilidad, donde se ve el margen antes y después de la pauta.
        </CardBody>
      </Card>
    </div>
  );
}
