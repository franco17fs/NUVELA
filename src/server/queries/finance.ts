import "server-only";
import { prisma } from "@/lib/prisma";
import { money, sumBy, ZERO, type Decimal } from "@/lib/money";
import { dateKey, eachBusinessDay, today, type DateRange } from "@/lib/dates";
import { calculatePeriodResult, type PeriodResult } from "@/financial-engine";
import { scopeFilter, type AccountScope } from "./accounts";
import { getTaxTreatment } from "./fiscal";

/**
 * Consultas financieras del período.
 *
 * Regla de oro de este módulo: **acá no se calcula nada**. Se leen agregados de
 * PostgreSQL y se los pasa al motor financiero, que es el único que aplica
 * fórmulas. Si una definición cambia (por ejemplo qué entra en el margen de
 * contribución), se cambia en un solo lugar.
 *
 * Segunda regla: el dashboard consulta la BASE, no las APIs externas (§43 del
 * brief). Las integraciones alimentan la base por su cuenta.
 */

/** Estados que cuentan como venta a efectos del P&L. */
const REVENUE_STATUSES = ["PAID", "PARTIALLY_REFUNDED", "PARTIALLY_PAID"] as const;

export interface PeriodTotals extends PeriodResult {
  units: number;
  orderCount: number;
  averageTicket: Decimal;
  /** true si algún componente del período viene de una estimación. */
  hasEstimates: boolean;
}

export async function getPeriodTotals(
  scope: AccountScope,
  range: DateRange,
): Promise<PeriodTotals> {
  const where = {
    ...scopeFilter(scope),
    businessDate: { gte: range.from, lte: range.to },
  };

  const [orders, cancelled, feeRows, adsCost, expenses, refunds, taxTreatment] = await Promise.all([
    prisma.order.findMany({
      where: { ...where, status: { in: [...REVENUE_STATUSES] } },
      select: {
        id: true,
        totalAmount: true,
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            sellerDiscount: true,
            cogsTotal: true,
            cogsAppliedAt: true,
          },
        },
      },
    }),
    prisma.order.aggregate({
      where: { ...where, status: "CANCELLED" },
      _sum: { totalAmount: true },
    }),
    prisma.marketplaceFee.groupBy({
      by: ["type"],
      where: {
        ...scopeFilter(scope),
        businessDate: { gte: range.from, lte: range.to },
      },
      _sum: { amount: true },
    }),
    prisma.adMetricDaily.aggregate({
      where: { ...scopeFilter(scope), date: { gte: range.from, lte: range.to } },
      _sum: { cost: true, totalAmount: true },
    }),
    prisma.expense.aggregate({
      where: {
        ...(scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {}),
        businessDate: { gte: range.from, lte: range.to },
      },
      _sum: { amount: true },
    }),
    prisma.refund.aggregate({
      where: { ...scopeFilter(scope), businessDate: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
    }),
    getTaxTreatment(scope),
  ]);

  const grossRevenue = sumBy(orders, (order) =>
    sumBy(order.items, (item) => money(item.unitPrice).times(item.quantity)),
  );
  const sellerDiscounts = sumBy(orders, (order) =>
    sumBy(order.items, (item) => item.sellerDiscount),
  );
  const cogs = sumBy(orders, (order) => sumBy(order.items, (item) => item.cogsTotal));

  const units = orders.reduce(
    (acc, order) => acc + order.items.reduce((sum, item) => sum + item.quantity, 0),
    0,
  );

  // Un ítem sin COGS aplicado hace que el margen del período sea incompleto.
  // Se informa en vez de disimularlo.
  const hasEstimates = orders.some((order) =>
    order.items.some((item) => item.cogsAppliedAt === null),
  );

  const feeByType = new Map(feeRows.map((row) => [row.type, money(row._sum.amount)]));
  const taxesWithheld = feeByType.get("TAX_WITHHELD") ?? ZERO;

  const result = calculatePeriodResult({
    grossRevenue,
    cancellations: money(cancelled._sum.totalAmount),
    refunds: money(refunds._sum.amount),
    sellerFundedDiscounts: sellerDiscounts,
    cogs,
    meliFees: (feeByType.get("SALE_FEE") ?? ZERO).plus(feeByType.get("MARKETPLACE_FEE") ?? ZERO),
    fixedFees: feeByType.get("FIXED_FEE") ?? ZERO,
    financingFees: feeByType.get("FINANCING_FEE") ?? ZERO,
    shippingCost: feeByType.get("SHIPPING_FEE") ?? ZERO,
    adsCost: money(adsCost._sum.cost),
    // Sólo se descuenta como costo si el perfil fiscal lo indica: una retención
    // no es automáticamente una pérdida (§9 del brief).
    taxesAsCost: taxTreatment === "COST" ? taxesWithheld : ZERO,
    operatingExpenses: money(expenses._sum.amount),
    otherCharges: (feeByType.get("OTHER") ?? ZERO).plus(feeByType.get("RETURN_COST") ?? ZERO),
  });

  return {
    ...result,
    units,
    orderCount: orders.length,
    averageTicket: orders.length === 0 ? ZERO : grossRevenue.div(orders.length),
    hasEstimates,
  };
}

export interface DailyPoint {
  date: Date;
  revenue: Decimal;
  cogs: Decimal;
  fees: Decimal;
  ads: Decimal;
  contribution: Decimal;
  marginPct: Decimal;
  units: number;
}

/**
 * Serie diaria de facturación, costos y margen.
 * Alimenta los gráficos del dashboard y la proyección estadística.
 */
export async function getDailySeries(
  scope: AccountScope,
  requestedRange: DateRange,
): Promise<DailyPoint[]> {
  // La serie histórica se corta HOY. Si el período elegido llega a fin de mes,
  // los días que todavía no ocurrieron no son ventas en cero: son días sin
  // datos. Graficarlos como ceros dibuja una caída a piso que no pasó y
  // arrastraría hacia abajo cualquier promedio calculado sobre la serie.
  const currentDay = today();
  const range: DateRange = {
    from: requestedRange.from,
    to: requestedRange.to.getTime() > currentDay.getTime() ? currentDay : requestedRange.to,
  };

  if (range.to.getTime() < range.from.getTime()) return [];

  const [orders, fees, ads] = await Promise.all([
    prisma.order.findMany({
      where: {
        ...scopeFilter(scope),
        businessDate: { gte: range.from, lte: range.to },
        status: { in: [...REVENUE_STATUSES] },
      },
      select: {
        businessDate: true,
        items: { select: { quantity: true, unitPrice: true, cogsTotal: true } },
      },
    }),
    prisma.marketplaceFee.groupBy({
      by: ["businessDate"],
      where: { ...scopeFilter(scope), businessDate: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
    }),
    prisma.adMetricDaily.groupBy({
      by: ["date"],
      where: { ...scopeFilter(scope), date: { gte: range.from, lte: range.to } },
      _sum: { cost: true },
    }),
  ]);

  const revenueByDay = new Map<string, { revenue: Decimal; cogs: Decimal; units: number }>();
  for (const order of orders) {
    const key = dateKey(order.businessDate);
    const current = revenueByDay.get(key) ?? { revenue: ZERO, cogs: ZERO, units: 0 };
    revenueByDay.set(key, {
      revenue: current.revenue.plus(
        sumBy(order.items, (item) => money(item.unitPrice).times(item.quantity)),
      ),
      cogs: current.cogs.plus(sumBy(order.items, (item) => item.cogsTotal)),
      units: current.units + order.items.reduce((sum, item) => sum + item.quantity, 0),
    });
  }

  const feesByDay = new Map(fees.map((row) => [dateKey(row.businessDate), money(row._sum.amount)]));
  const adsByDay = new Map(ads.map((row) => [dateKey(row.date), money(row._sum.cost)]));

  // Se recorren TODOS los días del rango, no sólo los que tienen ventas: un día
  // sin ventas es un cero que el gráfico y la proyección necesitan ver.
  return eachBusinessDay(range).map((day) => {
    const key = dateKey(day);
    const sales = revenueByDay.get(key) ?? { revenue: ZERO, cogs: ZERO, units: 0 };
    const dayFees = feesByDay.get(key) ?? ZERO;
    const dayAds = adsByDay.get(key) ?? ZERO;
    const contribution = sales.revenue.minus(sales.cogs).minus(dayFees).minus(dayAds);

    return {
      date: day,
      revenue: sales.revenue,
      cogs: sales.cogs,
      fees: dayFees,
      ads: dayAds,
      contribution,
      marginPct: sales.revenue.isZero() ? ZERO : contribution.div(sales.revenue).times(100),
      units: sales.units,
    };
  });
}

/**
 * Desglose de un KPI: qué órdenes y cargos componen el número (§35 del brief).
 * Es lo que hace que "Comisiones este mes: $2.350.500" sea clickeable.
 */
export async function getFeeBreakdown(
  scope: AccountScope,
  range: DateRange,
  type: string,
): Promise<
  {
    id: string;
    amount: Decimal;
    kind: string;
    source: string;
    description: string | null;
    businessDate: Date;
    mlOrderId: string | null;
  }[]
> {
  const rows = await prisma.marketplaceFee.findMany({
    where: {
      ...scopeFilter(scope),
      businessDate: { gte: range.from, lte: range.to },
      type: type as never,
    },
    orderBy: { businessDate: "desc" },
    take: 500,
    select: {
      id: true,
      amount: true,
      kind: true,
      source: true,
      description: true,
      businessDate: true,
      order: { select: { mlOrderId: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    amount: money(row.amount),
    kind: row.kind,
    source: row.source,
    description: row.description,
    businessDate: row.businessDate,
    mlOrderId: row.order?.mlOrderId.toString() ?? null,
  }));
}

/** Fondo de reposición: costo de la mercadería vendida en el período. */
export async function getInventoryReplacementData(scope: AccountScope, range: DateRange) {
  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        ...scopeFilter(scope),
        businessDate: { gte: range.from, lte: range.to },
        status: { in: [...REVENUE_STATUSES] },
      },
    },
    select: { skuId: true, quantity: true, cogsTotal: true },
  });

  return items.map((item) => ({
    skuId: item.skuId,
    quantity: item.quantity,
    cogsTotal: money(item.cogsTotal),
  }));
}
