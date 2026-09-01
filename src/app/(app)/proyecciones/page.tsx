import { Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { formatARS, money, ZERO } from "@/lib/money";
import { addDays, subDays, today } from "@/lib/dates";
import { calculateSalesForecast, type SalesForecast } from "@/financial-engine";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { getDailySeries } from "@/server/queries/finance";

export const dynamic = "force-dynamic";

const HORIZONS = [7, 15, 30, 60, 90];

/**
 * Proyecciones y escenarios (§24 y §25 del brief).
 *
 * El modelo es estadístico simple y explicable a propósito: promedio ponderado
 * con decaimiento, estacionalidad semanal amortiguada y tendencia lineal
 * también amortiguada. No hay machine learning ni cajas negras, y todos los
 * supuestos usados se listan en pantalla para que el usuario pueda discutirlos.
 */
export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope } = resolveContext(params);

  const requestedHorizon = Number(
    Array.isArray(params.horizonte) ? params.horizonte[0] : (params.horizonte ?? 30),
  );
  const horizonDays = HORIZONS.includes(requestedHorizon) ? requestedHorizon : 30;

  const currentDay = today();
  // Se usan 90 días de historia para proyectar, independientemente del filtro de
  // período: proyectar a partir de "ayer" daría un modelo sin ninguna base.
  const history = await getDailySeries(scope, {
    from: subDays(currentDay, 90),
    to: currentDay,
  });

  const options = { horizonDays, today: currentDay } as const;

  const scenarios: SalesForecast[] = [
    calculateSalesForecast(history, { ...options, scenario: "CONSERVATIVE" }),
    calculateSalesForecast(history, { ...options, scenario: "BASE" }),
    calculateSalesForecast(history, { ...options, scenario: "OPTIMISTIC" }),
  ];

  const base = scenarios[1]!;
  const hasHistory = history.some((point) => point.revenue.greaterThan(0));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Proyecciones</h1>
          <p className="text-sm text-ink-muted">
            Modelo estadístico simple, explicable y auditable.
          </p>
        </div>
        <div className="flex gap-1">
          {HORIZONS.map((horizon) => {
            const query = new URLSearchParams();
            for (const key of ["cuenta", "periodo", "desde", "hasta"]) {
              const value = Array.isArray(params[key]) ? params[key][0] : params[key];
              if (value) query.set(key, String(value));
            }
            query.set("horizonte", String(horizon));

            return (
              <a
                key={horizon}
                href={`?${query.toString()}`}
                className={
                  horizon === horizonDays
                    ? "rounded-md bg-ink px-2.5 py-1 text-sm font-medium text-white"
                    : "rounded-md border border-border-subtle px-2.5 py-1 text-sm text-ink-muted hover:border-brand"
                }
              >
                {horizon} d
              </a>
            );
          })}
        </div>
      </header>

      {!hasHistory ? (
        <Card>
          <EmptyState
            title="Sin historial suficiente"
            description="Todavía no hay ventas registradas. El sistema no proyecta sobre datos que no existen: primero hay que sincronizar ventas."
          />
        </Card>
      ) : (
        <>
          <KpiGrid>
            <Kpi
              label="Facturación diaria promedio"
              value={base.averageDailyRevenue}
              kind="FORECAST"
            />
            <Kpi
              label="Margen histórico aplicado"
              value={base.marginRate.times(100)}
              format="percent"
              kind="FORECAST"
            />
            {scenarios.map((scenario) => (
              <Kpi
                key={scenario.scenario}
                label={`${SCENARIO_LABELS[scenario.scenario]} · ${horizonDays} d`}
                value={scenario.points.reduce((acc, point) => acc.plus(point.revenue), ZERO)}
                kind="FORECAST"
                emphasis={scenario.scenario === "BASE"}
              />
            ))}
            <Kpi
              label="Confianza"
              value={0}
              format="number"
              hint={base.confidence.toLowerCase()}
              kind="FORECAST"
            />
          </KpiGrid>

          <Card>
            <CardHeader
              title="Escenarios"
              description="Conservador −20%, base, optimista +20% sobre la facturación proyectada."
            />
            <Table>
              <thead>
                <tr>
                  <Th>Escenario</Th>
                  <Th align="right">Facturación proyectada</Th>
                  <Th align="right">Contribución proyectada</Th>
                  <Th align="right">Promedio diario</Th>
                  <Th>Confianza</Th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((scenario) => {
                  const revenue = scenario.points.reduce(
                    (acc, point) => acc.plus(point.revenue),
                    ZERO,
                  );
                  const contribution = scenario.points.reduce(
                    (acc, point) => acc.plus(point.contribution),
                    ZERO,
                  );

                  return (
                    <tr
                      key={scenario.scenario}
                      className={scenario.scenario === "BASE" ? "bg-surface-muted" : ""}
                    >
                      <Td className="font-medium">{SCENARIO_LABELS[scenario.scenario]}</Td>
                      <Td align="right">{formatARS(revenue)}</Td>
                      <Td align="right">{formatARS(contribution)}</Td>
                      <Td align="right">
                        {formatARS(
                          scenario.points.length === 0
                            ? ZERO
                            : revenue.div(scenario.points.length),
                        )}
                      </Td>
                      <Td className="text-xs">{scenario.confidence}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader
              title="Supuestos del modelo"
              description="Todo lo que el modelo asume, en palabras."
            />
            <CardBody>
              <ul className="list-inside list-disc space-y-1 text-sm text-ink-muted">
                {base.assumptions.map((assumption, index) => (
                  <li key={index}>{assumption}</li>
                ))}
                <li>
                  La confianza baja a medida que crece el horizonte: proyectar a {horizonDays} días
                  no es lo mismo que proyectar a 7.
                </li>
                <li>
                  Modelo: <code className="rounded bg-surface-sunken px-1">{base.model}</code>
                </li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Detalle día por día"
              description={`Primeros 30 días del escenario base, desde ${addDays(currentDay, 1).getUTCDate()}/${addDays(currentDay, 1).getUTCMonth() + 1}.`}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th align="right">Facturación proyectada</Th>
                  <Th align="right">Contribución proyectada</Th>
                </tr>
              </thead>
              <tbody>
                {base.points.slice(0, 30).map((point) => (
                  <tr key={point.date.toISOString()}>
                    <Td>
                      {point.date.getUTCDate()}/{point.date.getUTCMonth() + 1}
                    </Td>
                    <Td align="right">{formatARS(money(point.revenue))}</Td>
                    <Td align="right">{formatARS(money(point.contribution))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

const SCENARIO_LABELS: Record<string, string> = {
  CONSERVATIVE: "Conservador",
  BASE: "Base",
  OPTIMISTIC: "Optimista",
};
