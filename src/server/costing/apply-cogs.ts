import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/money";
import { weightedAverageStrategy } from "@/financial-engine";

/**
 * Imputación del costo de mercadería (COGS) a una venta.
 *
 * ## Reglas que esto implementa
 *
 * 1. **El COGS se congela.** Se guarda en `OrderItem.cogsUnitCost` el costo
 *    vigente al momento de procesar la venta. Si mañana la mercadería sube, el
 *    margen de esta venta NO cambia (§14 del brief). Recalcular ventas viejas
 *    con el costo actual haría que el resultado de un mes ya cerrado se moviera
 *    solo, que es exactamente lo que el brief prohíbe.
 *
 * 2. **Es idempotente.** El movimiento de stock se identifica por
 *    `(referenceType, referenceId) = ('ORDER_ITEM', orderItemId)`, con índice
 *    único. Reprocesar una orden —cosa que pasa cada vez que llega un webhook de
 *    cambio de estado— no descuenta el stock dos veces.
 *
 * 3. **Todo queda trazado.** Cada movimiento guarda stock y costo promedio
 *    ANTES y DESPUÉS, así se puede reconstruir el costo de cualquier fecha.
 */

export interface ApplyCogsResult {
  itemsCosted: number;
  itemsWithoutSku: number;
  itemsAlreadyCosted: number;
}

export async function applyCogsToOrder(orderId: string): Promise<ApplyCogsResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) return { itemsCosted: 0, itemsWithoutSku: 0, itemsAlreadyCosted: 0 };

  const result: ApplyCogsResult = {
    itemsCosted: 0,
    itemsWithoutSku: 0,
    itemsAlreadyCosted: 0,
  };

  for (const item of order.items) {
    if (item.cogsAppliedAt !== null) {
      result.itemsAlreadyCosted += 1;
      continue;
    }

    const mapping = await resolveSku({
      sellerAccountId: order.sellerAccountId,
      mlItemId: item.mlItemId,
      variationId: item.variationId,
      sellerSku: item.sellerSku,
    });

    if (!mapping) {
      // Sin SKU no hay costo. El margen de esta venta queda marcado como
      // estimado y el usuario ve el hueco, en vez de un costo inventado.
      result.itemsWithoutSku += 1;
      continue;
    }

    const units = money(item.quantity).times(mapping.unitsPerListing);
    await costItem({
      sellerAccountId: order.sellerAccountId,
      orderItemId: item.id,
      skuId: mapping.skuId,
      units,
      quantity: item.quantity,
      businessDate: order.businessDate,
      saleDate: order.dateCreated,
    });

    result.itemsCosted += 1;
  }

  return result;
}

/**
 * Resuelve a qué SKU corresponde una publicación.
 *
 * Prioridad:
 *   1. `ListingMapping` explícito (permite kits: N unidades de SKU por venta).
 *   2. El `seller_sku` que viene en la publicación, si coincide con un SKU cargado.
 *
 * El mapeo explícito manda porque es el único que sabe de kits y combos, donde
 * una venta consume más de una unidad de stock.
 */
async function resolveSku(params: {
  sellerAccountId: string;
  mlItemId: string;
  variationId: string | null;
  sellerSku: string | null;
}): Promise<{ skuId: string; unitsPerListing: string } | null> {
  const mapping = await prisma.listingMapping.findUnique({
    where: {
      sellerAccountId_mlItemId_variationId: {
        sellerAccountId: params.sellerAccountId,
        mlItemId: params.mlItemId,
        // Cadena vacía = publicación sin variaciones (ver ListingMapping).
        variationId: params.variationId ?? "",
      },
    },
    select: { skuId: true, unitsPerListing: true },
  });

  if (mapping) {
    return { skuId: mapping.skuId, unitsPerListing: mapping.unitsPerListing.toString() };
  }

  if (params.sellerSku) {
    const sku = await prisma.sku.findUnique({
      where: { code: params.sellerSku },
      select: { id: true },
    });
    if (sku) return { skuId: sku.id, unitsPerListing: "1" };
  }

  return null;
}

async function costItem(params: {
  sellerAccountId: string;
  orderItemId: string;
  skuId: string;
  units: ReturnType<typeof money>;
  quantity: number;
  businessDate: Date;
  saleDate: Date;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Se relee el SKU dentro de la transacción para no costear con un promedio
    // que otra compra concurrente ya movió.
    const sku = await tx.sku.findUniqueOrThrow({
      where: { id: params.skuId },
      select: {
        id: true,
        currentStock: true,
        currentAverageCost: true,
        currentStockValue: true,
        costingMethod: true,
      },
    });

    const transition = weightedAverageStrategy.applySale(
      {
        stock: money(sku.currentStock),
        averageCost: money(sku.currentAverageCost),
        stockValue: money(sku.currentStockValue),
      },
      params.units,
    );

    const cogsUnitCost = transition.cogsUnitCost;
    const cogsTotal = cogsUnitCost.times(params.units);

    await tx.inventoryMovement.create({
      data: {
        sellerAccountId: params.sellerAccountId,
        skuId: params.skuId,
        type: "SALE",
        date: params.saleDate,
        businessDate: params.businessDate,
        quantity: params.units.negated().toString(),
        unitCost: cogsUnitCost.toString(),
        totalCost: cogsTotal.toString(),
        stockBefore: transition.before.stock.toString(),
        stockAfter: transition.stock.toString(),
        avgCostBefore: transition.before.averageCost.toString(),
        avgCostAfter: transition.averageCost.toString(),
        stockValueBefore: transition.before.stockValue.toString(),
        stockValueAfter: transition.stockValue.toString(),
        referenceType: "ORDER_ITEM",
        referenceId: params.orderItemId,
        source: "CALCULATED",
      },
    });

    await tx.sku.update({
      where: { id: params.skuId },
      data: {
        currentStock: transition.stock.toString(),
        currentStockValue: transition.stockValue.toString(),
        // El promedio no cambia al vender: sólo lo mueven los ingresos.
        currentAverageCost: transition.averageCost.toString(),
      },
    });

    await tx.orderItem.update({
      where: { id: params.orderItemId },
      data: {
        skuId: params.skuId,
        cogsUnitCost: cogsUnitCost.toString(),
        cogsTotal: cogsTotal.toString(),
        cogsMethod: sku.costingMethod,
        cogsAppliedAt: new Date(),
      },
    });
  });
}

/**
 * Revierte el COGS de una devolución: la mercadería vuelve al stock.
 *
 * Reingresa al MISMO costo con el que salió, no al costo actual. Si volviera al
 * promedio de hoy, una devolución podría inventar o destruir valor de inventario.
 */
export async function reverseCogsForItem(orderItemId: string, unitsReturned: number): Promise<void> {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    include: { order: { select: { sellerAccountId: true, businessDate: true } } },
  });

  if (!item || !item.skuId || item.cogsUnitCost == null) return;

  const referenceId = `${orderItemId}:return`;
  const existing = await prisma.inventoryMovement.findUnique({
    where: { referenceType_referenceId: { referenceType: "ORDER_ITEM_RETURN", referenceId } },
  });
  if (existing) return;

  const units = money(unitsReturned);
  const unitCost = money(item.cogsUnitCost);

  await prisma.$transaction(async (tx) => {
    const sku = await tx.sku.findUniqueOrThrow({
      where: { id: item.skuId as string },
      select: { currentStock: true, currentAverageCost: true, currentStockValue: true },
    });

    const before = {
      stock: money(sku.currentStock),
      averageCost: money(sku.currentAverageCost),
      stockValue: money(sku.currentStockValue),
    };

    const stockAfter = before.stock.plus(units);
    const valueAfter = before.stockValue.plus(units.times(unitCost));

    await tx.inventoryMovement.create({
      data: {
        sellerAccountId: item.order.sellerAccountId,
        skuId: item.skuId as string,
        type: "RETURN",
        date: new Date(),
        businessDate: item.order.businessDate,
        quantity: units.toString(),
        unitCost: unitCost.toString(),
        totalCost: units.times(unitCost).toString(),
        stockBefore: before.stock.toString(),
        stockAfter: stockAfter.toString(),
        avgCostBefore: before.averageCost.toString(),
        avgCostAfter: before.averageCost.toString(),
        stockValueBefore: before.stockValue.toString(),
        stockValueAfter: valueAfter.toString(),
        referenceType: "ORDER_ITEM_RETURN",
        referenceId,
        source: "CALCULATED",
      },
    });

    await tx.sku.update({
      where: { id: item.skuId as string },
      data: {
        currentStock: stockAfter.toString(),
        currentStockValue: valueAfter.toString(),
      },
    });

    // El COGS del ítem se reduce en proporción a lo devuelto.
    const remainingUnits = money(item.quantity).minus(units);
    await tx.orderItem.update({
      where: { id: orderItemId },
      data: {
        cogsTotal: unitCost.times(remainingUnits.isNegative() ? 0 : remainingUnits).toString(),
      },
    });
  });
}

/** Costo promedio de un SKU en una fecha dada, según el historial de movimientos. */
export async function averageCostAt(skuId: string, date: Date): Promise<Prisma.Decimal | null> {
  const movement = await prisma.inventoryMovement.findFirst({
    where: { skuId, date: { lte: date } },
    orderBy: { date: "desc" },
    select: { avgCostAfter: true },
  });

  return movement?.avgCostAfter ?? null;
}
