import "server-only";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/money";
import { businessDate } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { weightedAverageStrategy } from "@/financial-engine";

/**
 * Registro de compras de mercadería.
 *
 * Cada compra:
 *   1. Genera un `InventoryMovement` de tipo `PURCHASE` por ítem, con el estado
 *      del stock antes y después.
 *   2. Recalcula el costo promedio ponderado móvil del SKU.
 *   3. Deja una fila en `CostHistory`, cerrando la vigencia del costo anterior.
 *
 * El punto 3 es el que responde "¿cuánto costaba este producto en tal fecha?"
 * (§13 del brief): el costo viejo NUNCA se pisa, se le pone fecha de fin.
 */

export interface PurchaseItemInput {
  skuId: string;
  quantity: string | number;
  unitCost: string | number;
  notes?: string;
}

export interface CreatePurchaseInput {
  sellerAccountId?: string | null;
  supplier: string;
  date: Date;
  invoiceNumber?: string | null;
  paymentMethod?: string | null;
  paymentDueDate?: Date | null;
  paid?: boolean;
  notes?: string | null;
  items: PurchaseItemInput[];
}

export async function createPurchase(input: CreatePurchaseInput): Promise<string> {
  const timezone = getEnv().APP_TIMEZONE;
  const purchaseBusinessDate = businessDate(input.date, timezone);

  const total = input.items.reduce(
    (acc, item) => acc.plus(money(item.quantity).times(money(item.unitCost))),
    money(0),
  );

  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        sellerAccountId: input.sellerAccountId ?? null,
        supplier: input.supplier,
        date: input.date,
        businessDate: purchaseBusinessDate,
        invoiceNumber: input.invoiceNumber ?? null,
        total: total.toString(),
        paymentMethod: input.paymentMethod ?? null,
        paymentDueDate: input.paymentDueDate ?? null,
        paid: input.paid ?? false,
        notes: input.notes ?? null,
        source: "MANUAL",
      },
      select: { id: true },
    });

    for (const item of input.items) {
      const quantity = money(item.quantity);
      const unitCost = money(item.unitCost);

      const purchaseItem = await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          skuId: item.skuId,
          quantity: quantity.toString(),
          unitCost: unitCost.toString(),
          totalCost: quantity.times(unitCost).toString(),
          notes: item.notes ?? null,
        },
        select: { id: true },
      });

      const sku = await tx.sku.findUniqueOrThrow({
        where: { id: item.skuId },
        select: {
          currentStock: true,
          currentAverageCost: true,
          currentStockValue: true,
          costingMethod: true,
        },
      });

      const transition = weightedAverageStrategy.applyPurchase(
        {
          stock: money(sku.currentStock),
          averageCost: money(sku.currentAverageCost),
          stockValue: money(sku.currentStockValue),
        },
        quantity,
        unitCost,
      );

      await tx.inventoryMovement.create({
        data: {
          sellerAccountId: input.sellerAccountId ?? null,
          skuId: item.skuId,
          type: "PURCHASE",
          date: input.date,
          businessDate: purchaseBusinessDate,
          quantity: quantity.toString(),
          unitCost: unitCost.toString(),
          totalCost: quantity.times(unitCost).toString(),
          stockBefore: transition.before.stock.toString(),
          stockAfter: transition.stock.toString(),
          avgCostBefore: transition.before.averageCost.toString(),
          avgCostAfter: transition.averageCost.toString(),
          stockValueBefore: transition.before.stockValue.toString(),
          stockValueAfter: transition.stockValue.toString(),
          referenceType: "PURCHASE_ITEM",
          referenceId: purchaseItem.id,
          source: "MANUAL",
        },
      });

      await tx.sku.update({
        where: { id: item.skuId },
        data: {
          currentStock: transition.stock.toString(),
          currentAverageCost: transition.averageCost.toString(),
          currentStockValue: transition.stockValue.toString(),
        },
      });

      // Se cierra la vigencia del costo anterior antes de abrir la nueva: el
      // historial queda como una serie de intervalos sin huecos ni solapes.
      await tx.costHistory.updateMany({
        where: { skuId: item.skuId, validTo: null },
        data: { validTo: input.date },
      });

      await tx.costHistory.create({
        data: {
          skuId: item.skuId,
          validFrom: input.date,
          unitCost: unitCost.toString(),
          averageCost: transition.averageCost.toString(),
          method: sku.costingMethod,
          referenceType: "PURCHASE_ITEM",
          referenceId: purchaseItem.id,
          source: "MANUAL",
        },
      });
    }

    return purchase.id;
  });
}

/**
 * Ajuste manual de stock (inventario inicial, roturas, diferencias de conteo).
 *
 * Un ajuste con costo modifica el promedio como si fuera una compra; sin costo
 * sólo mueve unidades y conserva el promedio vigente.
 */
export async function adjustStock(params: {
  skuId: string;
  quantity: string | number;
  unitCost?: string | number | null;
  date: Date;
  notes?: string;
  sellerAccountId?: string | null;
}): Promise<void> {
  const timezone = getEnv().APP_TIMEZONE;
  const quantity = money(params.quantity);

  await prisma.$transaction(async (tx) => {
    const sku = await tx.sku.findUniqueOrThrow({
      where: { id: params.skuId },
      select: { currentStock: true, currentAverageCost: true, currentStockValue: true },
    });

    const before = {
      stock: money(sku.currentStock),
      averageCost: money(sku.currentAverageCost),
      stockValue: money(sku.currentStockValue),
    };

    const unitCost = params.unitCost != null ? money(params.unitCost) : before.averageCost;

    const transition = quantity.greaterThan(0)
      ? weightedAverageStrategy.applyPurchase(before, quantity, unitCost)
      : weightedAverageStrategy.applySale(before, quantity.abs());

    await tx.inventoryMovement.create({
      data: {
        sellerAccountId: params.sellerAccountId ?? null,
        skuId: params.skuId,
        type: "ADJUSTMENT",
        date: params.date,
        businessDate: businessDate(params.date, timezone),
        quantity: quantity.toString(),
        unitCost: unitCost.toString(),
        totalCost: quantity.times(unitCost).toString(),
        stockBefore: before.stock.toString(),
        stockAfter: transition.stock.toString(),
        avgCostBefore: before.averageCost.toString(),
        avgCostAfter: transition.averageCost.toString(),
        stockValueBefore: before.stockValue.toString(),
        stockValueAfter: transition.stockValue.toString(),
        referenceType: "ADJUSTMENT",
        referenceId: `${params.skuId}:${params.date.toISOString()}`,
        notes: params.notes ?? null,
        source: "MANUAL",
      },
    });

    await tx.sku.update({
      where: { id: params.skuId },
      data: {
        currentStock: transition.stock.toString(),
        currentAverageCost: transition.averageCost.toString(),
        currentStockValue: transition.stockValue.toString(),
      },
    });
  });
}
