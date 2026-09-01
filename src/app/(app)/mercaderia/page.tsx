import { Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { Kpi, KpiGrid } from "@/components/ui/kpi";
import { SkuForm } from "@/components/catalog/sku-form";
import { prisma } from "@/lib/prisma";
import { formatARS, money, ZERO } from "@/lib/money";
import { addDays, formatBusinessDate, today } from "@/lib/dates";
import { calculateInventoryReplacementFund } from "@/financial-engine";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { getInventoryReplacementData } from "@/server/queries/finance";

export const dynamic = "force-dynamic";

/**
 * Mercadería: stock, costo promedio y fondo de reposición (§14 y §15 del brief).
 *
 * El fondo de reposición es la respuesta a "qué parte de lo que entró no es
 * ganancia sino plata para volver a comprar lo que vendí". Es un concepto
 * propio del sistema, no un dato de Mercado Libre, y se muestra etiquetado como
 * cálculo.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope, period } = resolveContext(params);
  const currentDay = today();

  const [skus, soldItems, recentMovements] = await Promise.all([
    prisma.sku.findMany({
      orderBy: { code: "asc" },
      include: { product: { select: { name: true, brand: true } } },
    }),
    getInventoryReplacementData(scope, period),
    prisma.inventoryMovement.findMany({
      where: { date: { gte: addDays(currentDay, -30) } },
      orderBy: { date: "desc" },
      take: 50,
      include: { sku: { select: { code: true } } },
    }),
  ]);

  const replacement = calculateInventoryReplacementFund(soldItems);
  const stockValue = skus.reduce((acc, sku) => acc.plus(money(sku.currentStockValue)), ZERO);
  const unitsInStock = skus.reduce((acc, sku) => acc.plus(money(sku.currentStock)), ZERO);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Mercadería</h1>
        <p className="text-sm text-ink-muted">
          Stock, costo promedio ponderado y fondo de reposición.
        </p>
      </header>

      <KpiGrid>
        <Kpi label="Valor del stock" value={stockValue} />
        <Kpi label="Unidades en stock" value={unitsInStock} format="number" />
        <Kpi label="SKUs activos" value={skus.filter((sku) => sku.active).length} format="number" />
        <Kpi
          label="Costo de mercadería vendida"
          value={replacement.cogsSold}
          higherIsBetter={false}
          hint={period.label}
        />
        <Kpi
          label="A reservar para reponer"
          value={replacement.replacementFund}
          kind="ESTIMATED"
          higherIsBetter={false}
          emphasis
        />
        <Kpi
          label="Ventas sin costo cargado"
          value={replacement.itemsWithoutCost}
          format="number"
          higherIsBetter={false}
        />
      </KpiGrid>

      {replacement.itemsWithoutCost > 0 ? (
        <div className="rounded-lg border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          Hay {replacement.itemsWithoutCost} ítem(s) vendidos sin costo de mercadería. Su margen
          está incompleto, no es cero: mapeá la publicación a un SKU con costo cargado.
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Stock por SKU"
          description="El costo promedio se recalcula con cada compra; el histórico no se pisa."
        />
        {skus.length === 0 ? (
          <EmptyState
            title="Sin SKUs cargados"
            description="Cargá tus productos para poder calcular el costo de mercadería vendida y el margen real de cada venta."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Producto</Th>
                <Th align="right">Stock</Th>
                <Th align="right">Costo promedio</Th>
                <Th align="right">Valor</Th>
                <Th align="right">Peso (g)</Th>
                <Th>Método</Th>
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => (
                <tr key={sku.id}>
                  <Td className="font-medium">{sku.code}</Td>
                  <Td>
                    {sku.name}
                    {sku.product.brand ? (
                      <span className="ml-1 text-xs text-ink-subtle">
                        {sku.product.brand}
                      </span>
                    ) : null}
                  </Td>
                  <Td
                    align="right"
                    className={money(sku.currentStock).isNegative() ? "text-negative" : ""}
                  >
                    {money(sku.currentStock).toDecimalPlaces(2).toString()}
                  </Td>
                  <Td align="right">{formatARS(money(sku.currentAverageCost), { cents: true })}</Td>
                  <Td align="right">{formatARS(money(sku.currentStockValue))}</Td>
                  <Td align="right">{sku.billableWeightGrams ?? "—"}</Td>
                  <Td className="text-xs text-ink-muted">
                    {sku.costingMethod === "WEIGHTED_AVERAGE" ? "Promedio ponderado" : "FIFO"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <CardBody className="text-xs text-ink-subtle">
          Un stock negativo significa que se vendieron unidades que no estaban registradas:
          falta cargar una compra. El sistema lo muestra en vez de disimularlo.
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Nuevo SKU" description="Con stock y costo inicial opcionales." />
          <CardBody>
            <SkuForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Últimos movimientos de stock"
            description="Cada movimiento guarda el costo antes y después."
          />
          {recentMovements.length === 0 ? (
            <EmptyState title="Sin movimientos" description="Todavía no hay entradas ni salidas." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>SKU</Th>
                  <Th>Tipo</Th>
                  <Th align="right">Cant.</Th>
                  <Th align="right">Costo unit.</Th>
                  <Th align="right">Prom. después</Th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.map((movement) => (
                  <tr key={movement.id}>
                    <Td>{formatBusinessDate(movement.businessDate)}</Td>
                    <Td>{movement.sku.code}</Td>
                    <Td className="text-xs">{MOVEMENT_LABELS[movement.type] ?? movement.type}</Td>
                    <Td
                      align="right"
                      className={
                        money(movement.quantity).isNegative() ? "text-negative" : ""
                      }
                    >
                      {money(movement.quantity).toDecimalPlaces(2).toString()}
                    </Td>
                    <Td align="right">{formatARS(money(movement.unitCost), { cents: true })}</Td>
                    <Td align="right">{formatARS(money(movement.avgCostAfter), { cents: true })}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE: "Compra",
  SALE: "Venta",
  RETURN: "Devolución",
  ADJUSTMENT: "Ajuste",
  INITIAL: "Inicial",
};
