import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { PurchaseForm } from "@/components/purchases/purchase-form";
import { prisma } from "@/lib/prisma";
import { formatARS, money, ZERO } from "@/lib/money";
import { formatBusinessDate } from "@/lib/dates";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { listAccounts } from "@/server/queries/accounts";

export const dynamic = "force-dynamic";

/**
 * Compras de mercadería (§13 del brief).
 *
 * Cada compra recalcula el costo promedio ponderado del SKU y deja una entrada
 * en el historial de costos. El costo viejo no se pisa: se le cierra la
 * vigencia, para poder responder cuánto costaba un producto en cualquier fecha.
 */
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, period } = resolveContext(params);

  const accountFilter =
    scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {};

  const [purchases, skus, accounts] = await Promise.all([
    prisma.purchase.findMany({
      where: { ...accountFilter, businessDate: { gte: period.from, lte: period.to } },
      orderBy: { businessDate: "desc" },
      include: { items: { include: { sku: { select: { code: true, name: true } } } } },
      take: 100,
    }),
    prisma.sku.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, currentAverageCost: true },
    }),
    listAccounts(),
  ]);

  const total = purchases.reduce((acc, purchase) => acc.plus(money(purchase.total)), ZERO);
  const unpaid = purchases
    .filter((purchase) => !purchase.paid)
    .reduce((acc, purchase) => acc.plus(money(purchase.total)), ZERO);
  const units = purchases.reduce(
    (acc, purchase) =>
      acc.plus(purchase.items.reduce((sum, item) => sum.plus(money(item.quantity)), ZERO)),
    ZERO,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Compras</h1>
        <p className="text-sm text-ink-muted">
          {period.label} · cada compra actualiza el costo promedio del SKU
        </p>
      </header>

      <KpiGrid>
        <Kpi label="Comprado en el período" value={total} higherIsBetter={false} />
        <Kpi label="Pendiente de pago" value={unpaid} higherIsBetter={false} />
        <Kpi label="Unidades ingresadas" value={units} format="number" />
        <Kpi label="Compras" value={purchases.length} format="number" />
        <Kpi
          label="Costo unitario promedio"
          value={units.isZero() ? ZERO : total.div(units)}
          higherIsBetter={false}
        />
      </KpiGrid>

      <Card>
        <CardHeader
          title="Registrar compra"
          description="Mercado Libre no conoce lo que te cuesta la mercadería: este dato se carga a mano."
        />
        <CardBody>
          <PurchaseForm
            accounts={accounts}
            skus={skus.map((sku) => ({
              id: sku.id,
              code: sku.code,
              name: sku.name,
              currentAverageCost: sku.currentAverageCost.toString(),
            }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Compras del período" />
        {purchases.length === 0 ? (
          <EmptyState
            title="Sin compras registradas"
            description="Cargá tus compras para que el sistema pueda calcular el costo de mercadería vendida y el fondo de reposición."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Proveedor</Th>
                <Th>Factura</Th>
                <Th>Productos</Th>
                <Th align="right">Total</Th>
                <Th>Pago</Th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <Td>{formatBusinessDate(purchase.businessDate)}</Td>
                  <Td className="font-medium">{purchase.supplier}</Td>
                  <Td className="text-xs">{purchase.invoiceNumber ?? "—"}</Td>
                  <Td className="max-w-sm truncate text-xs text-ink-muted">
                    {purchase.items
                      .map(
                        (item) =>
                          `${money(item.quantity).toDecimalPlaces(0)}× ${item.sku.code}`,
                      )
                      .join(", ")}
                  </Td>
                  <Td align="right">{formatARS(money(purchase.total))}</Td>
                  <Td>
                    {purchase.paid ? (
                      <Badge tone="positive">Pagada</Badge>
                    ) : purchase.paymentDueDate ? (
                      <Badge tone="warning">
                        Vence {formatBusinessDate(purchase.paymentDueDate)}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Sin pagar</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
