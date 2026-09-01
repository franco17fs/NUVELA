import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { formatARS, formatPercent, money, ZERO } from "@/lib/money";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { getPeriodTotals } from "@/server/queries/finance";
import { getSkuProfitability } from "@/server/queries/profitability";

export const dynamic = "force-dynamic";

/**
 * Rentabilidad por SKU (§27 del brief).
 *
 * La tabla separa el margen antes y después de publicidad, que es lo que revela
 * el caso que más plata cuesta: el producto que vende bien, parece rentable y
 * deja de serlo una vez imputada la pauta.
 */
export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, period, comparison } = resolveContext(params);

  const [skus, totals, previous] = await Promise.all([
    getSkuProfitability(scope, period),
    getPeriodTotals(scope, period),
    getPeriodTotals(scope, comparison),
  ]);

  const adsCost = skus.reduce((acc, sku) => acc.plus(sku.adsCost), ZERO);
  const adsAttributed = skus.reduce((acc, sku) => acc.plus(sku.adsAttributedRevenue), ZERO);
  const losing = skus.filter((sku) => sku.losesMoney);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Rentabilidad</h1>
          <p className="text-sm text-ink-muted">{period.label} · por SKU</p>
        </div>
        {losing.length > 0 ? (
          <Badge tone="negative">{losing.length} SKU con margen negativo</Badge>
        ) : null}
      </header>

      <KpiGrid>
        <Kpi label="Margen bruto" value={totals.grossMargin} previous={previous.grossMargin} />
        <Kpi
          label="Margen de contribución"
          value={totals.contributionMargin}
          previous={previous.contributionMargin}
        />
        <Kpi
          label="Resultado operativo"
          value={totals.operatingResult}
          previous={previous.operatingResult}
        />
        <Kpi
          label="Margen %"
          value={totals.contributionMarginPct}
          format="percent"
          previous={previous.contributionMarginPct}
          deltaMode="pp"
        />
        <Kpi
          label="Publicidad / ventas"
          value={totals.grossRevenue.isZero() ? ZERO : adsCost.div(totals.grossRevenue).times(100)}
          format="percent"
          higherIsBetter={false}
          hint="TACOS"
        />
        <Kpi
          label="ROAS"
          value={adsCost.isZero() ? ZERO : adsAttributed.div(adsCost)}
          format="number"
          hint="facturación atribuida / pauta"
        />
      </KpiGrid>

      <Card>
        <CardHeader
          title="Rentabilidad por SKU"
          description="Los cargos de la orden (envío, cargo fijo, financiación) se prorratean entre los ítems según su facturación."
        />
        {skus.length === 0 ? (
          <EmptyState
            title="Sin datos en el período"
            description="No hay ventas cargadas para el período y la cuenta seleccionados."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Producto</Th>
                <Th align="right">Unid.</Th>
                <Th align="right">Facturación</Th>
                <Th align="right">Mercadería</Th>
                <Th align="right">Comisión</Th>
                <Th align="right">Envío</Th>
                <Th align="right">Publicidad</Th>
                <Th align="right">Margen antes ads</Th>
                <Th align="right">Margen</Th>
                <Th align="right">Margen %</Th>
                <Th align="right">ROAS</Th>
                <Th align="right">TACOS</Th>
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => (
                <tr
                  key={`${sku.skuId ?? sku.mlItemId}`}
                  className={sku.losesMoney ? "bg-negative-soft" : ""}
                >
                  <Td className="font-medium">{sku.skuCode}</Td>
                  <Td className="max-w-xs truncate">
                    {sku.title}
                    {sku.losesMoneyOnlyAfterAds ? (
                      <span className="ml-2 text-[10px] font-semibold text-warning">
                        NEGATIVO POST-ADS
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right">{sku.units}</Td>
                  <Td align="right">{formatARS(sku.revenue)}</Td>
                  <Td align="right">
                    {formatARS(sku.cogs)}
                    {sku.hasEstimates ? (
                      <span className="ml-1 text-[10px] text-warning">?</span>
                    ) : null}
                  </Td>
                  <Td align="right">{formatARS(sku.meliFees)}</Td>
                  <Td align="right">{formatARS(sku.shippingCost)}</Td>
                  <Td align="right">{formatARS(sku.adsCost)}</Td>
                  <Td align="right">{formatARS(sku.marginBeforeAds)}</Td>
                  <Td
                    align="right"
                    className={sku.margin.isNegative() ? "font-semibold text-negative" : ""}
                  >
                    {formatARS(sku.margin)}
                  </Td>
                  <Td
                    align="right"
                    className={sku.marginPct.isNegative() ? "text-negative" : ""}
                  >
                    {formatPercent(sku.marginPct)}
                  </Td>
                  <Td align="right">
                    {sku.adsCost.isZero() ? "—" : money(sku.roas).toDecimalPlaces(2).toFixed(2)}
                  </Td>
                  <Td align="right">
                    {sku.adsCost.isZero() ? "—" : formatPercent(sku.tacos)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <CardBody className="text-xs text-ink-subtle">
          Un <span className="text-warning">?</span> en la columna de mercadería indica
          que falta cargar el costo del SKU: ese margen está incompleto, no es cero.
        </CardBody>
      </Card>
    </div>
  );
}
