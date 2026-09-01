import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui/primitives";
import { ListingMappingForm } from "@/components/catalog/listing-mapping-form";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/money";
import { resolveContext, type SearchParams } from "@/server/queries/request-context";
import { listAccounts, scopeFilter } from "@/server/queries/accounts";

export const dynamic = "force-dynamic";

/**
 * Publicaciones y su vínculo con el catálogo propio.
 *
 * Esta pantalla resuelve el cuello de botella del costeo: mientras una
 * publicación no esté mapeada a un SKU, sus ventas se registran pero su margen
 * queda incompleto. Por eso lo primero que se muestra son las publicaciones
 * vendidas SIN mapear.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { scope } = resolveContext(params);

  const [soldItems, mappings, skus, accounts] = await Promise.all([
    prisma.orderItem.groupBy({
      by: ["mlItemId", "title", "sellerSku"],
      where: { order: scopeFilter(scope), skuId: null },
      _sum: { quantity: true },
      _count: { _all: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 100,
    }),
    prisma.listingMapping.findMany({
      where: scopeFilter(scope),
      include: {
        sku: { select: { code: true, name: true, currentAverageCost: true } },
        sellerAccount: { select: { nickname: true, colorHex: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sku.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    listAccounts(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Productos</h1>
        <p className="text-sm text-ink-muted">
          Vínculo entre las publicaciones de Mercado Libre y tu catálogo de costos.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Publicaciones vendidas sin SKU"
          description="Sus ventas no tienen costo de mercadería imputado, así que su margen está incompleto."
          action={
            soldItems.length > 0 ? (
              <Badge tone="warning">{soldItems.length} sin mapear</Badge>
            ) : (
              <Badge tone="positive">Todo mapeado</Badge>
            )
          }
        />
        {soldItems.length === 0 ? (
          <EmptyState
            title="No hay publicaciones sin mapear"
            description="Todas las ventas registradas tienen su SKU y su costo."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Publicación</Th>
                <Th>Título</Th>
                <Th>SKU declarado</Th>
                <Th align="right">Unidades vendidas</Th>
                <Th align="right">Ventas</Th>
              </tr>
            </thead>
            <tbody>
              {soldItems.map((item) => (
                <tr key={`${item.mlItemId}-${item.sellerSku ?? ""}`}>
                  <Td className="font-medium">{item.mlItemId}</Td>
                  <Td className="max-w-md truncate">{item.title}</Td>
                  <Td className="text-xs">{item.sellerSku ?? "—"}</Td>
                  <Td align="right">{item._sum.quantity ?? 0}</Td>
                  <Td align="right">{item._count._all}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <CardBody className="text-xs text-ink-subtle">
          Si el SKU declarado en la publicación coincide con el código de un SKU cargado, el
          sistema lo vincula solo. Si no, mapealo abajo.
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Vincular publicación con SKU" />
        <CardBody>
          <ListingMappingForm accounts={accounts} skus={skus} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Publicaciones vinculadas" />
        {mappings.length === 0 ? (
          <EmptyState title="Sin vínculos" description="Todavía no vinculaste ninguna publicación." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cuenta</Th>
                <Th>Publicación</Th>
                <Th>Variación</Th>
                <Th>SKU</Th>
                <Th align="right">Unid. por venta</Th>
                <Th align="right">Costo promedio</Th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: mapping.sellerAccount.colorHex }}
                        aria-hidden
                      />
                      {mapping.sellerAccount.nickname}
                    </span>
                  </Td>
                  <Td className="font-medium">{mapping.mlItemId}</Td>
                  <Td className="text-xs">{mapping.variationId || "—"}</Td>
                  <Td>
                    {mapping.sku.code} · {mapping.sku.name}
                  </Td>
                  <Td align="right">
                    {money(mapping.unitsPerListing).toDecimalPlaces(2).toString()}
                  </Td>
                  <Td align="right">
                    {money(mapping.sku.currentAverageCost).toDecimalPlaces(2).toFixed(2)}
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
