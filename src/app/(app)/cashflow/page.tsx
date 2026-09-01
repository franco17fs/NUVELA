import { Card, CardBody, CardHeader, Table, Td, Th, Badge } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { formatARS } from "@/lib/money";
import { addDays, startOfMonth, today } from "@/lib/dates";
import { calculateCashflowForecast, findCashShortfallDate } from "@/financial-engine";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import {
  getBalance,
  getCashflowMovements,
  getSafeAvailableCash,
} from "@/server/queries/cash";
import { getAllSettings } from "@/server/queries/settings";
import { money } from "@/lib/money";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Cashflow semanal (§23 del brief).
 *
 * Esta pantalla es CAJA, no resultado. Una venta aparece acá el día en que el
 * dinero se libera, no el día en que se vendió. Es deliberadamente una vista
 * separada de Rentabilidad: mezclar las dos cosas es el error que el brief
 * prohíbe en su principio fundamental.
 */
export default async function CashflowPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope } = resolveContext(params);

  const currentDay = today();
  // El cashflow siempre mira hacia adelante: arranca a principio del mes en
  // curso y proyecta 90 días. No usa el filtro de período, que sirve para el
  // análisis retrospectivo del P&L.
  const range = { from: startOfMonth(currentDay), to: addDays(currentDay, 90) };

  const [balance, safeCash, movements, settings] = await Promise.all([
    getBalance(scope),
    getSafeAvailableCash(scope),
    getCashflowMovements(scope, range),
    getAllSettings(),
  ]);

  const safetyBuffer = money(settings.safetyBuffer);

  const weeks = calculateCashflowForecast({
    range,
    openingBalance: balance.available,
    movements,
    safetyBuffer,
  });

  const shortfall = findCashShortfallDate({
    openingBalance: balance.available,
    movements: movements.filter((movement) => movement.date >= currentDay),
    safetyBuffer,
  });

  const closing = weeks.at(-1)?.closingBalance ?? balance.available;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Cashflow</h1>
        <p className="text-sm text-ink-muted">
          Cuándo entra y sale el dinero. No es lo mismo que el resultado del negocio.
        </p>
      </header>

      <KpiGrid>
        <Kpi
          label={balance.hasReport ? "Saldo conciliado" : "Saldo"}
          value={balance.available}
          kind={balance.hasReport ? "ACTUAL" : "ESTIMATED"}
        />
        <Kpi label="Pendiente de liberar" value={balance.pendingRelease} kind="ACTUAL" />
        <Kpi
          label="Comprometido"
          value={balance.committed}
          higherIsBetter={false}
          kind="ESTIMATED"
        />
        <Kpi label="Disponible seguro" value={safeCash.safeAvailable} kind="ESTIMATED" emphasis />
        <Kpi label="Colchón mínimo" value={safetyBuffer} hint="configurable" />
        <Kpi label="Saldo proyectado a 90 días" value={closing} kind="FORECAST" />
      </KpiGrid>

      {shortfall ? (
        <div className="rounded-lg border border-negative bg-negative-soft px-4 py-3 text-sm text-negative">
          Con el ritmo actual, el{" "}
          <strong>
            {shortfall.date.getUTCDate()}/{shortfall.date.getUTCMonth() + 1}
          </strong>{" "}
          el saldo proyectado ({formatARS(shortfall.balance)}) cae por debajo del colchón mínimo.
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Semana por semana"
          description="Semanas alineadas al mes (1-7, 8-14, 15-21, 22-fin)."
          action={
            <div className="flex items-center gap-2 text-[11px]">
              <LegendDot className="bg-positive" label="Real" />
              <LegendDot className="bg-brand" label="Programado" />
              <LegendDot className="bg-warning" label="Estimado / proyectado" />
            </div>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Semana</Th>
              <Th align="right">Saldo inicial</Th>
              <Th align="right">Ingresos reales</Th>
              <Th align="right">Ingresos proyectados</Th>
              <Th align="right">Mercadería</Th>
              <Th align="right">Comisiones</Th>
              <Th align="right">Publicidad</Th>
              <Th align="right">Impuestos</Th>
              <Th align="right">Gastos</Th>
              <Th align="right">Obligaciones</Th>
              <Th align="right">Saldo final</Th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr
                key={week.label}
                className={week.belowSafetyBuffer ? "bg-negative-soft" : ""}
              >
                <Td className="font-medium">{week.label}</Td>
                <Td align="right">{formatARS(week.openingBalance)}</Td>
                <Td align="right" className="text-positive">
                  {formatARS(week.realIncome)}
                </Td>
                <Td align="right" className="text-warning">
                  {formatARS(week.projectedIncome)}
                </Td>
                <Td align="right">{formatARS(week.inventoryPurchases)}</Td>
                <Td align="right">{formatARS(week.meliCharges)}</Td>
                <Td align="right">{formatARS(week.ads)}</Td>
                <Td align="right">{formatARS(week.taxes)}</Td>
                <Td align="right">{formatARS(week.expenses)}</Td>
                <Td align="right">{formatARS(week.obligations)}</Td>
                <Td
                  align="right"
                  className={cn(
                    "font-semibold",
                    week.closingBalance.isNegative() && "text-negative",
                  )}
                >
                  {formatARS(week.closingBalance)}
                  {week.belowSafetyBuffer ? (
                    <span className="ml-1 text-[10px] text-negative">▼</span>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <CardBody className="space-y-1 text-xs text-ink-subtle">
          <p>
            El saldo inicial de la primera semana es el saldo conciliado de Mercado Pago
            {balance.hasReport ? "" : " (todavía sin reporte configurado: puede estar incompleto)"}.
          </p>
          <p>
            Las filas marcadas con ▼ cierran por debajo del colchón mínimo de{" "}
            {formatARS(safetyBuffer)}.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Composición del disponible seguro"
          description="Qué se descuenta del saldo y por qué."
        />
        <CardBody className="space-y-1.5 text-sm">
          {safeCash.breakdown.map((entry) => (
            <div
              key={entry.label}
              className={cn(
                "flex items-baseline justify-between gap-4",
                entry.label === "Disponible seguro" &&
                  "border-t border-border-subtle pt-2 font-semibold",
              )}
            >
              <span className="text-ink-muted">
                {entry.label}
                {entry.note ? (
                  <span className="ml-2 text-xs text-ink-subtle">{entry.note}</span>
                ) : null}
              </span>
              <span
                className={cn("tabular", entry.amount.isNegative() && "text-negative")}
              >
                {formatARS(entry.amount)}
              </span>
            </div>
          ))}
          <div className="border-t border-border-subtle pt-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-ink-muted">
                Presupuesto recomendado para comprar mercadería hoy
                <Badge tone="brand">incluye el fondo de reposición</Badge>
              </span>
              <span className="tabular text-base font-semibold text-brand">
                {formatARS(safeCash.recommendedInventoryBudget)}
              </span>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-muted">
      <span className={cn("h-2 w-2 rounded-full", className)} aria-hidden />
      {label}
    </span>
  );
}
