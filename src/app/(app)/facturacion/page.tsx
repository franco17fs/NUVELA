import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { prisma } from "@/lib/prisma";
import { formatARS, money, ZERO } from "@/lib/money";
import { formatBusinessDateLong } from "@/lib/dates";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { scopeFilter } from "@/server/queries/accounts";

export const dynamic = "force-dynamic";

/**
 * Facturación de Mercado Libre y Mercado Pago (§10 del brief).
 *
 * Los reportes de facturación se usan para **conciliación fiscal y financiera**,
 * nunca como fuente primaria de ventas: los períodos se cierran con retraso y
 * usarlos para el "cuánto vendí hoy" haría que el dashboard dejara de ser casi
 * en tiempo real. Los grupos ML y MP vienen separados desde la propia API.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope } = resolveContext(params);

  const periods = await prisma.billingPeriod.findMany({
    where: scopeFilter(scope),
    orderBy: { periodKey: "desc" },
    take: 24,
    include: {
      sellerAccount: { select: { nickname: true } },
      documents: { select: { id: true, documentType: true, totalAmount: true, dueDate: true } },
    },
  });

  const mlTotal = periods
    .filter((period) => period.group === "ML")
    .reduce((acc, period) => acc.plus(money(period.totalAmount)), ZERO);
  const mpTotal = periods
    .filter((period) => period.group === "MP")
    .reduce((acc, period) => acc.plus(money(period.totalAmount)), ZERO);

  const creditNotes = periods.reduce(
    (acc, period) =>
      acc.plus(
        period.documents
          .filter((document) => document.documentType === "CREDIT_NOTE")
          .reduce((sum, document) => sum.plus(money(document.totalAmount)), ZERO),
      ),
    ZERO,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Facturación</h1>
        <p className="text-sm text-ink-muted">
          Períodos, facturas y notas de crédito de Mercado Libre y Mercado Pago.
        </p>
      </header>

      <div className="rounded-lg border border-border-subtle bg-surface px-4 py-3 text-xs text-ink-muted">
        Estos reportes se usan para conciliar cargos, no como fuente de ventas: se cierran con
        retraso. Las ventas en tiempo casi real salen del recurso de órdenes.
      </div>

      <KpiGrid>
        <Kpi label="Facturado por Mercado Libre" value={mlTotal} higherIsBetter={false} />
        <Kpi label="Facturado por Mercado Pago" value={mpTotal} higherIsBetter={false} />
        <Kpi label="Notas de crédito" value={creditNotes} />
        <Kpi label="Períodos importados" value={periods.length} format="number" />
      </KpiGrid>

      <Card>
        <CardHeader title="Períodos de facturación" />
        {periods.length === 0 ? (
          <EmptyState
            title="Sin períodos importados"
            description="Todavía no se sincronizó la facturación. Es un proceso aparte del de ventas, porque los períodos se cierran con retraso."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Período</Th>
                <Th>Grupo</Th>
                <Th>Cuenta</Th>
                <Th>Vencimiento</Th>
                <Th align="right">Documentos</Th>
                <Th align="right">Total</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id}>
                  <Td className="font-medium">{period.periodKey}</Td>
                  <Td>
                    <Badge tone={period.group === "ML" ? "brand" : "neutral"}>{period.group}</Badge>
                  </Td>
                  <Td className="text-xs">{period.sellerAccount.nickname}</Td>
                  <Td>{period.dueDate ? formatBusinessDateLong(period.dueDate) : "—"}</Td>
                  <Td align="right">{period.documents.length}</Td>
                  <Td align="right">
                    {period.totalAmount ? formatARS(money(period.totalAmount)) : "—"}
                  </Td>
                  <Td className="text-xs">{period.status ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <CardBody className="text-xs text-ink-subtle">
          Las diferencias entre lo que calculamos y lo que Mercado Libre facturó aparecen en la
          pantalla de Conciliación.
        </CardBody>
      </Card>
    </div>
  );
}
