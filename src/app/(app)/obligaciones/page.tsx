import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { ObligationForm } from "@/components/obligations/obligation-form";
import { ObligationActions } from "@/components/obligations/obligation-actions";
import { formatARS } from "@/lib/money";
import { formatBusinessDateLong } from "@/lib/dates";
import { ZERO } from "@/lib/money";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { listAccounts } from "@/server/queries/accounts";
import {
  getDailyReserveRecommendation,
  listObligations,
  listReserves,
} from "@/server/queries/cash";

export const dynamic = "force-dynamic";

/**
 * Obligaciones, reservas y recomendación diaria (§18, §19 y §20 del brief).
 *
 * La recomendación de cuánto separar por día es la función central de esta
 * pantalla, y deliberadamente NO es "deuda dividido días": descuenta lo que ya
 * está reservado, lo que se va a liberar antes del vencimiento y lo que ya está
 * comprometido por obligaciones anteriores. La explicación de cada número se
 * muestra junto a él.
 */
export default async function ObligationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope } = resolveContext(params);

  const [obligations, reserves, recommendation, accounts] = await Promise.all([
    listObligations(scope),
    listReserves(scope),
    getDailyReserveRecommendation(scope),
    listAccounts(),
  ]);

  const pending = obligations.filter((obligation) => obligation.status !== "PAID");
  const totalPending = pending.reduce((acc, obligation) => acc.plus(obligation.uncovered), ZERO);
  const totalReserved = reserves.reduce((acc, reserve) => acc.plus(reserve.currentAmount), ZERO);
  const overdue = pending.filter((obligation) => obligation.status === "OVERDUE");

  const byObligation = new Map(
    recommendation.perObligation.map((entry) => [entry.obligationId, entry]),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Obligaciones</h1>
        <p className="text-sm text-ink-muted">
          Vencimientos, reservas y cuánto separar por día.
        </p>
      </header>

      <KpiGrid>
        <Kpi label="Total a cubrir" value={totalPending} higherIsBetter={false} />
        <Kpi label="Ya reservado" value={totalReserved} />
        <Kpi
          label="A separar por día"
          value={recommendation.totalDaily}
          higherIsBetter={false}
          hint={`confianza ${recommendation.confidence.toLowerCase()}`}
          kind="ESTIMATED"
          emphasis
        />
        <Kpi label="Vencidas" value={overdue.length} format="number" higherIsBetter={false} />
        <Kpi label="Obligaciones abiertas" value={pending.length} format="number" />
        <Kpi label="Bolsillos activos" value={reserves.length} format="number" />
      </KpiGrid>

      <Card>
        <CardHeader
          title="Vencimientos"
          description="Estado derivado de los montos y la fecha, no de un campo que puede quedar viejo."
        />
        {obligations.length === 0 ? (
          <EmptyState
            title="No hay obligaciones cargadas"
            description="Cargá tarjetas, proveedores, impuestos, préstamos o cualquier vencimiento. Mercado Libre no puede darnos este dato: se carga a mano."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Descripción</Th>
                <Th>Categoría</Th>
                <Th>Vence</Th>
                <Th align="right">Monto</Th>
                <Th align="right">Reservado</Th>
                <Th align="right">Falta</Th>
                <Th align="right">Por día</Th>
                <Th>Estado</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {obligations.map((obligation) => {
                const reserve = byObligation.get(obligation.id);

                return (
                  <tr key={obligation.id}>
                    <Td className="font-medium">
                      {obligation.description}
                      {obligation.installmentLabel ? (
                        <span className="ml-1 text-xs text-ink-subtle">
                          ({obligation.installmentLabel})
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-ink-muted">{obligation.category}</Td>
                    <Td>
                      {formatBusinessDateLong(obligation.dueDate)}
                      <span className="ml-1 text-xs text-ink-subtle">
                        {obligation.daysUntilDue < 0
                          ? `hace ${Math.abs(obligation.daysUntilDue)} d`
                          : obligation.daysUntilDue === 0
                            ? "hoy"
                            : `en ${obligation.daysUntilDue} d`}
                      </span>
                    </Td>
                    <Td align="right">{formatARS(obligation.amount)}</Td>
                    <Td align="right">{formatARS(obligation.reservedAmount)}</Td>
                    <Td align="right" className="font-medium">
                      {formatARS(obligation.uncovered)}
                    </Td>
                    <Td align="right">
                      {reserve ? (
                        <span
                          title={reserve.explanation.join(" ")}
                          className={
                            reserve.exceedsCapacity ? "font-semibold text-negative" : ""
                          }
                        >
                          {formatARS(reserve.dailyAmount)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONES[obligation.status] ?? "neutral"}>
                        {STATUS_LABELS[obligation.status] ?? obligation.status}
                      </Badge>
                    </Td>
                    <Td>
                      <ObligationActions obligationId={obligation.id} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {recommendation.perObligation.length > 0 ? (
        <Card>
          <CardHeader
            title="Por qué esos números"
            description="La recomendación no es deuda dividido días: acá está el razonamiento."
          />
          <CardBody className="space-y-4">
            {recommendation.perObligation.map((entry) => {
              const obligation = obligations.find((item) => item.id === entry.obligationId);
              return (
                <div key={entry.obligationId}>
                  <p className="text-sm font-medium text-ink">
                    {obligation?.description ?? "Obligación"} ·{" "}
                    {formatARS(entry.dailyAmount)} por día
                    <span className="ml-2 text-xs font-normal text-ink-subtle">
                      (reparto simple: {formatARS(entry.naiveDailyAmount)})
                    </span>
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-ink-muted">
                    {entry.explanation.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Bolsillos"
            description="Dinero que está en la cuenta pero no está libre."
          />
          {reserves.length === 0 ? (
            <EmptyState
              title="Sin reservas activas"
              description="Reservá contra una obligación para que ese dinero deje de contarse como disponible."
            />
          ) : (
            <CardBody className="space-y-2 text-sm">
              {reserves.map((reserve) => (
                <div key={reserve.id} className="flex items-baseline justify-between gap-4">
                  <span className="text-ink-muted">{reserve.name}</span>
                  <span className="tabular">
                    {formatARS(reserve.currentAmount)}
                    {reserve.remaining.greaterThan(0) ? (
                      <span className="ml-2 text-xs text-ink-subtle">
                        faltan {formatARS(reserve.remaining)}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
              <div className="border-t border-border-subtle pt-2">
                <div className="flex items-baseline justify-between gap-4 font-semibold">
                  <span>Total reservado</span>
                  <span className="tabular">{formatARS(totalReserved)}</span>
                </div>
              </div>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Nueva obligación" description="Tarjeta, proveedor, impuesto, alquiler…" />
          <CardBody>
            <ObligationForm accounts={accounts} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  UPCOMING: "Próxima",
  PARTIALLY_RESERVED: "Parcialmente reservada",
  COVERED: "Cubierta",
  PAID: "Pagada",
  OVERDUE: "Vencida",
};

const STATUS_TONES: Record<string, "neutral" | "positive" | "negative" | "warning" | "brand"> = {
  UPCOMING: "neutral",
  PARTIALLY_RESERVED: "warning",
  COVERED: "brand",
  PAID: "positive",
  OVERDUE: "negative",
};
