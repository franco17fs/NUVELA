import { Card, CardBody, CardHeader, EmptyState, SourceBadge, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { prisma } from "@/lib/prisma";
import { formatARS, money } from "@/lib/money";
import { formatBusinessDate, formatBusinessDateLong } from "@/lib/dates";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { scopeFilter } from "@/server/queries/accounts";
import { getBalance, getSafeAvailableCash } from "@/server/queries/cash";

export const dynamic = "force-dynamic";

/**
 * Dinero en Mercado Pago (§11 del brief).
 *
 * ## La aclaración más importante de todo el sistema
 *
 * Mercado Pago **no expone un endpoint oficial de saldo en vivo** para cuentas
 * de vendedor (ver docs/mercadolibre-api-research.md §5.3). Así que este saldo
 * está **reconstruido** a partir de los reportes oficiales de liberaciones, y se
 * lo llama por su nombre: **Saldo conciliado**, con la fecha hasta la que llega
 * la conciliación. Nunca se lo presenta como un saldo en tiempo real.
 */
export default async function MercadoPagoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, period } = resolveContext(params);

  const [balance, safeCash, movements, pendingPayments] = await Promise.all([
    getBalance(scope),
    getSafeAvailableCash(scope),
    prisma.mercadoPagoMovement.findMany({
      where: { ...scopeFilter(scope), businessDate: { gte: period.from, lte: period.to } },
      orderBy: { date: "desc" },
      take: 200,
    }),
    prisma.payment.findMany({
      where: { ...scopeFilter(scope), status: "APPROVED", moneyReleaseDate: { gt: new Date() } },
      orderBy: { moneyReleaseDate: "asc" },
      take: 50,
      select: {
        id: true,
        mlPaymentId: true,
        moneyReleaseDate: true,
        netReceivedAmount: true,
        transactionAmount: true,
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Mercado Pago</h1>
        <p className="text-sm text-ink-muted">
          Dónde está el dinero: disponible, pendiente de liberar y comprometido.
        </p>
      </header>

      <div className="rounded-lg border border-border-subtle bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-ink">
              {balance.label} <SourceBadge source="BILLING_REPORT" />
            </p>
            <p className="text-xs text-ink-muted">
              {balance.hasReport
                ? `Reconstruido de los reportes oficiales de Mercado Pago. Conciliado hasta ${
                    balance.reconciledUntil
                      ? formatBusinessDateLong(balance.reconciledUntil)
                      : "—"
                  }.`
                : "Todavía no hay reportes importados: no se puede reconstruir el saldo."}
            </p>
          </div>
          <p className="max-w-md text-xs text-ink-subtle">
            La API de Mercado Pago no publica un endpoint de saldo en tiempo real para vendedores,
            así que este número no se presenta como tal.
          </p>
        </div>
      </div>

      <KpiGrid>
        <Kpi
          label="Disponible"
          value={balance.available}
          kind={balance.hasReport ? "ACTUAL" : "ESTIMATED"}
        />
        <Kpi label="Pendiente de liberar" value={balance.pendingRelease} kind="ACTUAL" />
        <Kpi
          label="Comprometido / reservado"
          value={balance.committed}
          higherIsBetter={false}
          kind="ESTIMATED"
          hint="cálculo propio"
        />
        <Kpi
          label="Disponible realmente"
          value={balance.reallyAvailable}
          kind="ESTIMATED"
          emphasis
        />
        <Kpi
          label="Fondo de reposición"
          value={safeCash.inventoryReplacementFund}
          higherIsBetter={false}
          kind="ESTIMATED"
        />
        <Kpi label="Colchón mínimo" value={safeCash.safetyBuffer} />
      </KpiGrid>

      <Card>
        <CardHeader
          title="Pendiente de liberar"
          description="Cobros aprobados con fecha de acreditación futura. Es la base del cashflow."
        />
        {pendingPayments.length === 0 ? (
          <EmptyState
            title="Nada pendiente"
            description="No hay cobros aprobados esperando acreditación, o todavía no se sincronizó Mercado Pago."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Pago</Th>
                <Th>Se libera</Th>
                <Th align="right">Neto a acreditar</Th>
              </tr>
            </thead>
            <tbody>
              {pendingPayments.map((payment) => (
                <tr key={payment.id}>
                  <Td>#{payment.mlPaymentId.toString()}</Td>
                  <Td>
                    {payment.moneyReleaseDate
                      ? formatBusinessDateLong(payment.moneyReleaseDate)
                      : "—"}
                  </Td>
                  <Td align="right">
                    {formatARS(money(payment.netReceivedAmount ?? payment.transactionAmount))}
                    {payment.netReceivedAmount === null ? (
                      <span
                        className="ml-1 text-[10px] text-warning"
                        title="Mercado Pago todavía no informó el neto; se muestra el monto de la transacción"
                      >
                        bruto
                      </span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Movimientos del período"
          description="Filas del reporte oficial de liberaciones."
        />
        {movements.length === 0 ? (
          <EmptyState
            title="Sin movimientos importados"
            description="Configurá el reporte de liberaciones en tu cuenta de Mercado Pago y vinculá la cuenta desde Configuración."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Tipo</Th>
                <Th>Descripción</Th>
                <Th align="right">Crédito</Th>
                <Th align="right">Débito</Th>
                <Th align="right">Comisión</Th>
                <Th align="right">Impuestos</Th>
                <Th align="right">Saldo</Th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <Td>{formatBusinessDate(movement.businessDate)}</Td>
                  <Td className="text-xs">{RECORD_LABELS[movement.recordType] ?? movement.recordType}</Td>
                  <Td className="max-w-xs truncate text-xs">{movement.description ?? "—"}</Td>
                  <Td align="right" className="text-positive">
                    {formatARS(money(movement.netCreditAmount))}
                  </Td>
                  <Td align="right" className="text-negative">
                    {formatARS(money(movement.netDebitAmount))}
                  </Td>
                  <Td align="right">{formatARS(money(movement.mpFeeAmount))}</Td>
                  <Td align="right">{formatARS(money(movement.taxesAmount))}</Td>
                  <Td align="right">
                    {movement.balanceAmount ? formatARS(money(movement.balanceAmount)) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Cómo se llegó al saldo" />
        <CardBody className="space-y-1.5 text-sm">
          {safeCash.breakdown.map((entry) => (
            <div key={entry.label} className="flex items-baseline justify-between gap-4">
              <span className="text-ink-muted">
                {entry.label}
                {entry.note ? (
                  <span className="ml-2 text-xs text-ink-subtle">{entry.note}</span>
                ) : null}
              </span>
              <span className="tabular">{formatARS(entry.amount)}</span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

const RECORD_LABELS: Record<string, string> = {
  INITIAL_AVAILABLE_BALANCE: "Saldo inicial",
  RELEASE: "Liberación",
  TOTAL: "Total",
  AVAILABLE_BALANCE: "Saldo disponible",
  MOVEMENT: "Movimiento",
  UNKNOWN: "Sin clasificar",
};
