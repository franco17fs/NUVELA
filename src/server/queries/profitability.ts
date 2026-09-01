import "server-only";
import { prisma } from "@/lib/prisma";
import { money, sumBy, ZERO, type Decimal } from "@/lib/money";
import type { DateRange } from "@/lib/dates";
import {
  calculateOrderProfitability,
  calculateSkuProfitability,
  type OrderProfitabilityResult,
  type SkuProfitabilityResult,
} from "@/financial-engine";
import { scopeFilter, type AccountScope } from "./accounts";
import { getTaxTreatment } from "./fiscal";

/**
 * Rentabilidad por SKU y por venta.
 *
 * Igual que el resto de las consultas: se leen datos y se delega el cálculo al
 * motor. Acá no hay ninguna fórmula.
 */

const REVENUE_STATUSES = ["PAID", "PARTIALLY_REFUNDED", "PARTIALLY_PAID"] as const;

export interface SkuRow extends SkuProfitabilityResult {
  accountNames: string[];
}

/**
 * Tabla de rentabilidad por SKU (§27 del brief).
 *
 * La publicidad se imputa por publicación (`AdMetricDaily` a nivel ITEM), que es
 * el nivel al que Mercado Libre la informa. Un SKU vendido en dos publicaciones
 * acumula la pauta de ambas.
 */
export async function getSkuProfitability(
  scope: AccountScope,
  range: DateRange,
): Promise<SkuRow[]> {
  const [items, adMetrics] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        order: {
          ...scopeFilter(scope),
          businessDate: { gte: range.from, lte: range.to },
          status: { in: [...REVENUE_STATUSES] },
        },
      },
      select: {
        mlItemId: true,
        sellerSku: true,
        title: true,
        quantity: true,
        unitPrice: true,
        sellerDiscount: true,
        saleFee: true,
        cogsTotal: true,
        cogsAppliedAt: true,
        sku: { select: { id: true, code: true } },
        order: {
          select: {
            id: true,
            sellerAccount: { select: { nickname: true } },
            marketplaceFees: { select: { type: true, amount: true } },
            items: { select: { id: true, quantity: true, unitPrice: true } },
          },
        },
      },
    }),
    prisma.adMetricDaily.groupBy({
      by: ["mlItemId"],
      where: {
        ...scopeFilter(scope),
        level: "ITEM",
        date: { gte: range.from, lte: range.to },
      },
      _sum: { cost: true, totalAmount: true },
    }),
  ]);

  const adsByItem = new Map(
    adMetrics.map((row) => [
      row.mlItemId ?? "",
      { cost: money(row._sum.cost), attributed: money(row._sum.totalAmount) },
    ]),
  );

  interface Accumulator {
    skuId: string | null;
    skuCode: string;
    mlItemIds: Set<string>;
    title: string;
    units: number;
    revenue: Decimal;
    cogs: Decimal;
    meliFees: Decimal;
    fixedFees: Decimal;
    financingFees: Decimal;
    shippingCost: Decimal;
    otherCharges: Decimal;
    hasEstimates: boolean;
    accountNames: Set<string>;
  }

  const groups = new Map<string, Accumulator>();

  for (const item of items) {
    // Clave de agrupación: el SKU interno si está mapeado; si no, la publicación.
    // Nunca se agrupa por título, que cambia y confundiría productos distintos.
    const key = item.sku?.id ?? `item:${item.mlItemId}`;
    const code = item.sku?.code ?? item.sellerSku ?? item.mlItemId;

    const current: Accumulator = groups.get(key) ?? {
      skuId: item.sku?.id ?? null,
      skuCode: code,
      mlItemIds: new Set(),
      title: item.title,
      units: 0,
      revenue: ZERO,
      cogs: ZERO,
      meliFees: ZERO,
      fixedFees: ZERO,
      financingFees: ZERO,
      shippingCost: ZERO,
      otherCharges: ZERO,
      hasEstimates: false,
      accountNames: new Set(),
    };

    const lineRevenue = money(item.unitPrice).times(item.quantity).minus(money(item.sellerDiscount));

    current.mlItemIds.add(item.mlItemId);
    current.accountNames.add(item.order.sellerAccount.nickname);
    current.units += item.quantity;
    current.revenue = current.revenue.plus(lineRevenue);
    current.cogs = current.cogs.plus(money(item.cogsTotal));
    current.meliFees = current.meliFees.plus(money(item.saleFee).times(item.quantity));
    if (item.cogsAppliedAt === null) current.hasEstimates = true;

    // Los cargos a nivel orden (envío, cargo fijo, financiación) se reparten
    // entre los ítems en proporción a su facturación: es la única forma
    // defendible de bajar un costo de orden a nivel SKU.
    const orderRevenue = sumBy(item.order.items, (line) =>
      money(line.unitPrice).times(line.quantity),
    );
    const share = orderRevenue.isZero() ? ZERO : lineRevenue.div(orderRevenue);

    for (const fee of item.order.marketplaceFees) {
      const amount = money(fee.amount).times(share);
      if (fee.type === "SHIPPING_FEE") current.shippingCost = current.shippingCost.plus(amount);
      else if (fee.type === "FIXED_FEE") current.fixedFees = current.fixedFees.plus(amount);
      else if (fee.type === "FINANCING_FEE")
        current.financingFees = current.financingFees.plus(amount);
      else if (fee.type === "OTHER" || fee.type === "RETURN_COST")
        current.otherCharges = current.otherCharges.plus(amount);
      else if (fee.type === "MARKETPLACE_FEE" && money(item.saleFee).isZero())
        current.meliFees = current.meliFees.plus(amount);
    }

    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => {
      const ads = [...group.mlItemIds].reduce(
        (acc, mlItemId) => {
          const entry = adsByItem.get(mlItemId);
          return {
            cost: acc.cost.plus(entry?.cost ?? ZERO),
            attributed: acc.attributed.plus(entry?.attributed ?? ZERO),
          };
        },
        { cost: ZERO, attributed: ZERO },
      );

      const result = calculateSkuProfitability({
        skuId: group.skuId,
        skuCode: group.skuCode,
        mlItemId: [...group.mlItemIds][0] ?? null,
        title: group.title,
        units: group.units,
        revenue: group.revenue,
        cogs: group.cogs,
        meliFees: group.meliFees,
        fixedFees: group.fixedFees,
        financingFees: group.financingFees,
        shippingCost: group.shippingCost,
        adsCost: ads.cost,
        otherCharges: group.otherCharges,
        adsAttributedRevenue: ads.attributed,
        hasEstimates: group.hasEstimates,
      });

      return { ...result, accountNames: [...group.accountNames] };
    })
    .sort((a, b) => b.revenue.comparedTo(a.revenue));
}

export interface OrderListRow {
  id: string;
  mlOrderId: string;
  accountName: string;
  accountColor: string;
  businessDate: Date;
  status: string;
  totalAmount: Decimal;
  units: number;
  margin: Decimal;
  marginPct: Decimal;
  hasEstimates: boolean;
  title: string;
}

export async function listOrders(
  scope: AccountScope,
  range: DateRange,
  options: { limit?: number } = {},
): Promise<OrderListRow[]> {
  const orders = await prisma.order.findMany({
    where: {
      ...scopeFilter(scope),
      businessDate: { gte: range.from, lte: range.to },
    },
    orderBy: { dateCreated: "desc" },
    take: options.limit ?? 100,
    include: {
      sellerAccount: { select: { nickname: true, colorHex: true } },
      items: true,
      marketplaceFees: true,
      profitability: true,
    },
  });

  const taxTreatment = await getTaxTreatment(scope);

  return orders.map((order) => {
    const result = calculateOrderProfitability({
      orderId: order.id,
      mlOrderId: order.mlOrderId.toString(),
      status: order.status,
      currencyId: order.currencyId,
      totalAmount: money(order.totalAmount),
      items: order.items.map((item) => ({
        id: item.id,
        mlItemId: item.mlItemId,
        sellerSku: item.sellerSku,
        skuId: item.skuId,
        title: item.title,
        quantity: item.quantity,
        unitPrice: money(item.unitPrice),
        grossPrice: item.grossPrice ? money(item.grossPrice) : null,
        sellerDiscount: money(item.sellerDiscount),
        saleFee: item.saleFee ? money(item.saleFee) : null,
        saleFeeKind: item.saleFeeKind,
        saleFeeSource: item.saleFeeSource,
        cogsUnitCost: item.cogsUnitCost ? money(item.cogsUnitCost) : null,
        cogsTotal: item.cogsTotal ? money(item.cogsTotal) : null,
      })),
      fees: order.marketplaceFees.map((fee) => ({
        type: fee.type,
        amount: money(fee.amount),
        kind: fee.kind,
        source: fee.source,
        description: fee.description,
        reference: fee.sourceReferenceId,
      })),
      refundedAmount: money(order.refundedAmount),
      taxTreatment,
    });

    return {
      id: order.id,
      mlOrderId: order.mlOrderId.toString(),
      accountName: order.sellerAccount.nickname,
      accountColor: order.sellerAccount.colorHex,
      businessDate: order.businessDate,
      status: order.status,
      totalAmount: money(order.totalAmount),
      units: order.items.reduce((acc, item) => acc + item.quantity, 0),
      margin: result.contributionMargin,
      marginPct: result.marginPct,
      hasEstimates: result.hasEstimates,
      title: order.items[0]?.title ?? "Venta",
    };
  });
}

/** Waterfall completo de una venta (§28 del brief). */
export async function getOrderProfitability(
  orderId: string,
): Promise<{ result: OrderProfitabilityResult; order: { mlOrderId: string; accountName: string; businessDate: Date; status: string } } | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      sellerAccount: { select: { id: true, nickname: true } },
      items: true,
      marketplaceFees: true,
    },
  });

  if (!order) return null;

  const taxTreatment = await getTaxTreatment({
    kind: "ACCOUNT",
    sellerAccountId: order.sellerAccount.id,
  });

  const result = calculateOrderProfitability({
    orderId: order.id,
    mlOrderId: order.mlOrderId.toString(),
    status: order.status,
    currencyId: order.currencyId,
    totalAmount: money(order.totalAmount),
    items: order.items.map((item) => ({
      id: item.id,
      mlItemId: item.mlItemId,
      sellerSku: item.sellerSku,
      skuId: item.skuId,
      title: item.title,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      grossPrice: item.grossPrice ? money(item.grossPrice) : null,
      sellerDiscount: money(item.sellerDiscount),
      saleFee: item.saleFee ? money(item.saleFee) : null,
      saleFeeKind: item.saleFeeKind,
      saleFeeSource: item.saleFeeSource,
      cogsUnitCost: item.cogsUnitCost ? money(item.cogsUnitCost) : null,
      cogsTotal: item.cogsTotal ? money(item.cogsTotal) : null,
    })),
    fees: order.marketplaceFees.map((fee) => ({
      type: fee.type,
      amount: money(fee.amount),
      kind: fee.kind,
      source: fee.source,
      description: fee.description,
      reference: fee.sourceReferenceId,
    })),
    refundedAmount: money(order.refundedAmount),
    taxTreatment,
  });

  return {
    result,
    order: {
      mlOrderId: order.mlOrderId.toString(),
      accountName: order.sellerAccount.nickname,
      businessDate: order.businessDate,
      status: order.status,
    },
  };
}
