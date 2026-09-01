import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { prisma } from "@/lib/prisma";
import { formatARS, money } from "@/lib/money";
import { formatBusinessDate } from "@/lib/dates";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { scopeFilter } from "@/server/queries/accounts";

export const dynamic = "force-dynamic";

/**
 * Conciliación (§34 del brief).
 *
 * Ninguna diferencia se borra en silencio. Cada descuadre entre órdenes, pagos,
 * movimientos de Mercado Pago y facturación queda registrado como
 * `ReconciliationIssue` con su huella, para que reprocesar no genere duplicados
 * ni haga desaparecer un problema sin que nadie lo mire.
 */
export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope } = resolveContext(params);

  const [issues, syncFailures] = await Promise.all([
    prisma.reconciliationIssue.findMany({
      where: { ...scopeFilter(scope), status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      orderBy: [{ severity: "asc" }, { businessDate: "desc" }],
      include: { sellerAccount: { select: { nickname: true } } },
      take: 200,
    }),
    prisma.syncJob.findMany({
      where: { ...scopeFilter(scope), status: "FAILED" },
      orderBy: { startedAt: "desc" },
      take: 20,
      include: { sellerAccount: { select: { nickname: true } } },
    }),
  ]);

  const byType = new Map<string, number>();
  for (const issue of issues) {
    byType.set(issue.type, (byType.get(issue.type) ?? 0) + 1);
  }

  const totalDifference = issues.reduce((acc, issue) => acc.plus(money(issue.difference)), money(0));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Conciliación</h1>
        <p className="text-sm text-ink-muted">
          Diferencias entre ventas, pagos, movimientos y facturación.
        </p>
      </header>

      <KpiGrid>
        <Kpi label="Diferencias abiertas" value={issues.length} format="number" higherIsBetter={false} />
        <Kpi label="Monto en discusión" value={totalDifference} higherIsBetter={false} />
        <Kpi
          label="Sincronizaciones fallidas"
          value={syncFailures.length}
          format="number"
          higherIsBetter={false}
        />
        <Kpi label="Tipos de problema" value={byType.size} format="number" higherIsBetter={false} />
      </KpiGrid>

      <Card>
        <CardHeader
          title="Diferencias detectadas"
          description="Cada una guarda el contexto de las entidades comparadas."
        />
        {issues.length === 0 ? (
          <EmptyState
            title="Sin diferencias abiertas"
            description="No se detectaron descuadres entre las fuentes conciliadas."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Cuenta</Th>
                <Th>Tipo</Th>
                <Th>Descripción</Th>
                <Th align="right">Esperado</Th>
                <Th align="right">Real</Th>
                <Th align="right">Diferencia</Th>
                <Th>Severidad</Th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id}>
                  <Td>{formatBusinessDate(issue.businessDate)}</Td>
                  <Td className="text-xs">{issue.sellerAccount.nickname}</Td>
                  <Td className="text-xs">{ISSUE_LABELS[issue.type] ?? issue.type}</Td>
                  <Td className="max-w-md">{issue.description}</Td>
                  <Td align="right">
                    {issue.expectedAmount ? formatARS(money(issue.expectedAmount)) : "—"}
                  </Td>
                  <Td align="right">
                    {issue.actualAmount ? formatARS(money(issue.actualAmount)) : "—"}
                  </Td>
                  <Td align="right">
                    {issue.difference ? formatARS(money(issue.difference)) : "—"}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        issue.severity === "HIGH"
                          ? "negative"
                          : issue.severity === "MEDIUM"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {issue.severity}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {syncFailures.length > 0 ? (
        <Card>
          <CardHeader
            title="Sincronizaciones fallidas"
            description="Un fallo en una integración no rompe el resto: queda registrado acá."
          />
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Cuenta</Th>
                <Th>Proceso</Th>
                <Th>Motivo</Th>
                <Th align="right">Leídos</Th>
                <Th align="right">429</Th>
              </tr>
            </thead>
            <tbody>
              {syncFailures.map((job) => (
                <tr key={job.id}>
                  <Td>{formatBusinessDate(job.startedAt)}</Td>
                  <Td className="text-xs">{job.sellerAccount?.nickname ?? "—"}</Td>
                  <Td className="text-xs">{job.type}</Td>
                  <Td className="max-w-md text-xs">{job.errorMessage ?? "—"}</Td>
                  <Td align="right">{job.itemsRead}</Td>
                  <Td align="right">{job.rateLimitHits}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <CardBody className="text-xs text-ink-subtle">
            La columna 429 cuenta los rechazos por límite de consultas. Si crece, hay que bajar
            <code className="mx-1 rounded bg-surface-sunken px-1">ML_RATE_LIMIT_RPM</code>
            o pedir un aumento de cuota: es la evidencia para calibrarlo.
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

const ISSUE_LABELS: Record<string, string> = {
  ORDER_WITHOUT_PAYMENT: "Venta sin cobro",
  PAYMENT_WITHOUT_ORDER: "Cobro sin venta",
  CHARGE_WITHOUT_SALE: "Cargo sin venta",
  MOVEMENT_UNIDENTIFIED: "Movimiento sin identificar",
  AMOUNT_MISMATCH: "Diferencia de importe",
  MISSING_SHIPMENT_COST: "Falta costo de envío",
  REFUND_MISMATCH: "Diferencia en devolución",
  CHARGEBACK: "Contracargo",
  BONUS_UNEXPECTED: "Bonificación inesperada",
  ADJUSTMENT: "Ajuste",
  DUPLICATE_SUSPECTED: "Posible duplicado",
};
