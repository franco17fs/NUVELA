import Link from "next/link";
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Badge,
} from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { SyncStatusPanel } from "@/components/dashboard/sync-status";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { DailyChart } from "@/components/dashboard/daily-chart";
import { formatARS, formatPercent, money, ZERO } from "@/lib/money";
import { resolvePeriod, today } from "@/lib/dates";
import { listAccounts, getSyncStatus } from "@/server/queries/accounts";
import { resolveContext, withFilters, type SearchParams } from "@/server/queries/request-context";
import { getDailySeries, getPeriodTotals } from "@/server/queries/finance";
import {
  getBalance,
  getDailyReserveRecommendation,
  getReplacementFund,
  getSafeAvailableCash,
} from "@/server/queries/cash";
import { buildAlerts } from "@/server/queries/alerts";

/**
 * Dashboard principal (§30 del brief).
 *
 * Está armado para responder en menos de un minuto las preguntas del cierre del
 * brief: cuánto vendí, cuánto gané, cuánto tengo realmente, cuánto necesito para
 * reponer, cuánto está comprometido, cuánto guardar hoy y cuánto puedo gastar.
 *
 * Todo lo que se muestra sale de PostgreSQL, no de las APIs externas (§43): las
 * integraciones alimentan la base por su cuenta, en jobs aparte.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const accounts = await listAccounts();

  if (accounts.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Todavía no hay cuentas conectadas"
          description="Conectá tus cuentas de Mercado Libre para empezar a importar ventas. Hasta que lo hagas, el sistema no muestra ningún número: preferimos una pantalla vacía a datos de ejemplo que parezcan reales."
          action={
            <Link
              href="/configuracion"
              className="inline-flex items-center rounded-md bg-brand px-3 py-2 text-sm font-medium text-white"
            >
              Ir a Configuración
            </Link>
          }
        />
      </Card>
    );
  }

  const { scope, period, comparison } = resolveContext(params);
  const currentDay = today();
  const todayPeriod = resolvePeriod("today", { reference: currentDay });

  const [
    totals,
    previousTotals,
    todayTotals,
    series,
    balance,
    safeCash,
    replacementFund,
    dailyReserve,
    syncStatus,
    alerts,
  ] = await Promise.all([
    getPeriodTotals(scope, period),
    getPeriodTotals(scope, comparison),
    getPeriodTotals(scope, todayPeriod),
    getDailySeries(scope, period),
    getBalance(scope),
    getSafeAvailableCash(scope),
    getReplacementFund(scope),
    getDailyReserveRecommendation(scope),
    getSyncStatus(),
    buildAlerts(scope, period, comparison),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
          <p className="text-sm text-ink-muted">
            {period.label} ·{" "}
            {scope.kind === "CONSOLIDATED"
              ? `Consolidado de ${accounts.length} cuenta(s)`
              : accounts.find((account) => account.id === scope.sellerAccountId)?.nickname}
          </p>
        </div>
        {totals.hasEstimates ? (
          <Badge tone="warning">Hay ventas sin costo de mercadería cargado</Badge>
        ) : null}
      </header>

      {/* Primera fila del §30 */}
      <KpiGrid>
        <Kpi
          label="Facturación bruta"
          value={totals.grossRevenue}
          previous={previousTotals.grossRevenue}
          href={withFilters("/ventas", params)}
        />
        <Kpi
          label="Facturación neta"
          value={totals.netCommercialRevenue}
          previous={previousTotals.netCommercialRevenue}
          hint="No es ganancia"
        />
        <Kpi
          label="Resultado"
          value={totals.operatingResult}
          previous={previousTotals.operatingResult}
          kind={totals.hasEstimates ? "ESTIMATED" : "ACTUAL"}
          href={withFilters("/rentabilidad", params)}
        />
        <Kpi
          label="Margen"
          value={totals.operatingMarginPct}
          format="percent"
          previous={previousTotals.operatingMarginPct}
          deltaMode="pp"
        />
        <Kpi
          label={balance.hasReport ? "Saldo conciliado MP" : "Saldo MP"}
          value={balance.available}
          hint={
            balance.hasReport
              ? `conciliado ${balance.freshness.daysBehind === 0 ? "hoy" : `hace ${balance.freshness.daysBehind} d`}`
              : "sin reporte configurado"
          }
          kind={balance.hasReport ? "ACTUAL" : "ESTIMATED"}
          href={withFilters("/mercado-pago", params)}
        />
        <Kpi
          label="Disponible seguro"
          value={safeCash.safeAvailable}
          hint="hoy, sin riesgo"
          kind="ESTIMATED"
          emphasis
          href={withFilters("/cashflow", params)}
        />
      </KpiGrid>

      {/* Segunda sección del §30: el resumen operativo del día */}
      <Card>
        <CardHeader
          title="Hoy"
          description="La foto del día, para decidir en un minuto."
          action={
            <span className="text-xs text-ink-subtle">
              {currentDay.getUTCDate()}/{currentDay.getUTCMonth() + 1}
            </span>
          }
        />
        <CardBody className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 lg:grid-cols-6">
          <TodayStat label="Vendiste" value={formatARS(todayTotals.grossRevenue)} />
          <TodayStat
            label="Ganaste"
            value={formatARS(todayTotals.contributionMargin)}
            tone={todayTotals.contributionMargin.isNegative() ? "negative" : "positive"}
          />
          <TodayStat label="Margen" value={formatPercent(todayTotals.contributionMarginPct)} />
          <TodayStat
            label="Mercadería a reponer"
            value={formatARS(replacementFund)}
            hint="no es ganancia"
          />
          <TodayStat
            label="A separar hoy"
            value={formatARS(dailyReserve.totalDaily)}
            hint={`confianza ${dailyReserve.confidence.toLowerCase()}`}
          />
          <TodayStat
            label="Podés gastar"
            value={formatARS(safeCash.recommendedInventoryBudget)}
            hint="en mercadería"
            tone="brand"
          />
        </CardBody>
      </Card>

      {alerts.length > 0 ? <AlertsPanel alerts={alerts} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Facturación y contribución por día"
            description="Las dos series están en pesos y comparten escala."
          />
          <CardBody>
            <DailyChart
              data={series.map((point) => ({
                date: `${point.date.getUTCDate()}/${point.date.getUTCMonth() + 1}`,
                facturacion: Number(point.revenue.toFixed(2)),
                contribucion: Number(point.contribution.toFixed(2)),
              }))}
            />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Dinero" description="Qué parte del saldo está realmente libre." />
            <CardBody className="space-y-2 text-sm">
              <MoneyRow label="Disponible" value={formatARS(balance.available)} />
              <MoneyRow label="Pendiente de liberar" value={formatARS(balance.pendingRelease)} />
              <MoneyRow
                label="Comprometido / reservado"
                value={formatARS(balance.committed)}
                tone="muted"
              />
              <div className="border-t border-border-subtle pt-2">
                <MoneyRow
                  label="Disponible realmente"
                  value={formatARS(balance.reallyAvailable)}
                  emphasis
                />
              </div>
              {!balance.hasReport ? (
                <p className="pt-1 text-xs text-warning">
                  Mercado Pago no expone un saldo en vivo por API. Configurá el reporte de
                  liberaciones para que este número sea exacto.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <SyncStatusPanel rows={syncStatus} />
        </div>
      </div>

      <Card>
        <CardHeader
          title="Composición del resultado"
          description="De la facturación bruta al resultado operativo."
        />
        <CardBody className="space-y-1.5 text-sm">
          <MoneyRow label="Facturación bruta" value={formatARS(totals.grossRevenue)} />
          <MoneyRow
            label="Facturación neta comercial"
            value={formatARS(totals.netCommercialRevenue)}
          />
          <MoneyRow
            label="− Costos de Mercado Libre"
            value={formatARS(totals.totalMeliCosts.negated())}
            tone="muted"
          />
          <MoneyRow label="Margen bruto" value={formatARS(totals.grossMargin)} />
          <MoneyRow
            label="Margen de contribución"
            value={formatARS(totals.contributionMargin)}
          />
          <div className="border-t border-border-subtle pt-2">
            <MoneyRow
              label="Resultado operativo"
              value={formatARS(totals.operatingResult)}
              emphasis
            />
          </div>
          <p className="pt-2 text-xs text-ink-subtle">
            {totals.orderCount} venta(s) · {totals.units} unidad(es) · ticket promedio{" "}
            {formatARS(totals.orderCount === 0 ? ZERO : money(totals.averageTicket))}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function TodayStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative" | "brand";
}) {
  const toneClass =
    tone === "negative"
      ? "text-negative"
      : tone === "positive"
        ? "text-positive"
        : tone === "brand"
          ? "text-brand"
          : "text-ink";

  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`kpi-value mt-0.5 text-lg font-semibold ${toneClass}`}>{value}</p>
      {hint ? <p className="text-[11px] text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

function MoneyRow({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "muted";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className={
          tone === "muted"
            ? "text-ink-muted"
            : emphasis
              ? "font-semibold text-ink"
              : "text-ink-muted"
        }
      >
        {label}
      </span>
      <span className={`tabular ${emphasis ? "text-base font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
