import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { formatARS, formatPercent } from "@/lib/money";
import { formatBusinessDate } from "@/lib/dates";
import { resolveContext, withFilters, type SearchParams } from "@/server/queries/request-context";
import { getPeriodTotals } from "@/server/queries/finance";
import { listOrders } from "@/server/queries/profitability";

export const dynamic = "force-dynamic";

/** Listado de ventas con su margen. Cada fila abre el waterfall de la orden. */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, period, comparison } = resolveContext(params);

  const [orders, totals, previous] = await Promise.all([
    listOrders(scope, period, { limit: 200 }),
    getPeriodTotals(scope, period),
    getPeriodTotals(scope, comparison),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Ventas</h1>
        <p className="text-sm text-ink-muted">{period.label}</p>
      </header>

      <KpiGrid>
        <Kpi label="Facturación bruta" value={totals.grossRevenue} previous={previous.grossRevenue} />
        <Kpi label="Ventas" value={totals.orderCount} format="number" previous={previous.orderCount} />
        <Kpi label="Unidades" value={totals.units} format="number" previous={previous.units} />
        <Kpi label="Ticket promedio" value={totals.averageTicket} previous={previous.averageTicket} />
        <Kpi
          label="Margen de contribución"
          value={totals.contributionMargin}
          previous={previous.contributionMargin}
        />
        <Kpi
          label="Margen %"
          value={totals.contributionMarginPct}
          format="percent"
          previous={previous.contributionMarginPct}
          deltaMode="pp"
        />
      </KpiGrid>

      <Card>
        <CardHeader
          title="Detalle de ventas"
          description="Hacé click en una venta para ver su waterfall completo."
        />
        {orders.length === 0 ? (
          <EmptyState
            title="No hay ventas en este período"
            description="Cambiá el período o ejecutá una sincronización desde Configuración."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Orden</Th>
                <Th>Producto</Th>
                <Th>Cuenta</Th>
                <Th align="right">Unid.</Th>
                <Th align="right">Total</Th>
                <Th align="right">Margen</Th>
                <Th align="right">Margen %</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-surface-muted">
                  <Td>{formatBusinessDate(order.businessDate)}</Td>
                  <Td>
                    <Link
                      href={withFilters(`/ventas/${order.id}`, params)}
                      className="font-medium text-brand hover:underline"
                    >
                      #{order.mlOrderId}
                    </Link>
                  </Td>
                  <Td className="max-w-xs truncate">{order.title}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: order.accountColor }}
                        aria-hidden
                      />
                      {order.accountName}
                    </span>
                  </Td>
                  <Td align="right">{order.units}</Td>
                  <Td align="right">{formatARS(order.totalAmount)}</Td>
                  <Td
                    align="right"
                    className={order.margin.isNegative() ? "text-negative" : ""}
                  >
                    {formatARS(order.margin)}
                    {order.hasEstimates ? (
                      <span
                        className="ml-1 text-[10px] text-warning"
                        title="Incluye componentes estimados"
                      >
                        est.
                      </span>
                    ) : null}
                  </Td>
                  <Td
                    align="right"
                    className={order.marginPct.isNegative() ? "text-negative" : ""}
                  >
                    {formatPercent(order.marginPct)}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        order.status === "PAID"
                          ? "positive"
                          : order.status === "CANCELLED"
                            ? "negative"
                            : "neutral"
                      }
                    >
                      {STATUS_LABELS[order.status] ?? order.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <CardBody className="text-xs text-ink-subtle">
          Mostrando hasta 200 ventas del período.
        </CardBody>
      </Card>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  PAID: "Pagada",
  CANCELLED: "Cancelada",
  PARTIALLY_REFUNDED: "Dev. parcial",
  PARTIALLY_PAID: "Pago parcial",
  PAYMENT_REQUIRED: "Pendiente",
  PAYMENT_IN_PROCESS: "Procesando",
  CONFIRMED: "Confirmada",
  INVALID: "Inválida",
  UNKNOWN: "Desconocido",
};
