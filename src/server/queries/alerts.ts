import "server-only";
import { prisma } from "@/lib/prisma";
import { money, ZERO } from "@/lib/money";
import { addDays, today, type DateRange } from "@/lib/dates";
import {
  costVariationPct,
  generateAlerts,
  obligationsWithinHorizon,
  uncoveredAmount,
  findCashShortfallDate,
  type Alert,
} from "@/financial-engine";
import type { AccountScope } from "./accounts";
import { getPeriodTotals } from "./finance";
import { getSkuProfitability } from "./profitability";
import {
  getBalance,
  getCashflowMovements,
  getDailyReserveRecommendation,
  loadObligations,
} from "./cash";
import { getAllSettings } from "./settings";

/**
 * Construye las alertas del dashboard.
 *
 * Todo lo que entra acá se calcula a partir de números que el usuario puede
 * auditar en otra pantalla. Los umbrales salen de la configuración, no de
 * constantes escondidas en el código.
 */
export async function buildAlerts(
  scope: AccountScope,
  period: DateRange,
  comparison: DateRange,
): Promise<Alert[]> {
  const currentDay = today();
  const settings = await getAllSettings();
  const horizon = Number(settings.obligationHorizonDays);
  const safetyBuffer = money(settings.safetyBuffer);

  const [totals, previousTotals, skus, obligations, balance, dailyReserve, cogsVariation] =
    await Promise.all([
      getPeriodTotals(scope, period),
      getPeriodTotals(scope, comparison),
      getSkuProfitability(scope, period),
      loadObligations(scope),
      getBalance(scope),
      getDailyReserveRecommendation(scope),
      getCogsVariation(period, comparison),
    ]);

  const upcoming = obligationsWithinHorizon(obligations, horizon, currentDay);
  const obligationsDue = upcoming.reduce((acc, item) => acc.plus(uncoveredAmount(item)), ZERO);

  const movements = await getCashflowMovements(scope, {
    from: currentDay,
    to: addDays(currentDay, 90),
  });

  const shortfall = findCashShortfallDate({
    openingBalance: balance.available,
    movements,
    safetyBuffer,
  });

  const adsCost = totals.grossRevenue.isZero()
    ? ZERO
    : skus.reduce((acc, sku) => acc.plus(sku.adsCost), ZERO);

  return generateAlerts({
    thresholds: {
      adsOverSalesPct: Number(settings.adsOverSalesPct),
      marginDropPoints: Number(settings.marginDropPoints),
      costRisePct: Number(settings.costRisePct),
      obligationHorizonDays: horizon,
    },
    cashShortfall: shortfall,
    obligationsDue,
    obligationsDueCount: upcoming.length,
    dailyReserve: dailyReserve.totalDaily.greaterThan(0)
      ? { totalDaily: dailyReserve.totalDaily, days: dailyReserve.days }
      : null,
    // Se limita a los SKUs con problema real para no inundar el panel.
    skus: skus.filter((sku) => sku.losesMoney).slice(0, 5),
    adsOverSalesPct: totals.grossRevenue.isZero()
      ? ZERO
      : adsCost.div(totals.grossRevenue).times(100),
    marginPct: totals.contributionMarginPct,
    previousMarginPct: previousTotals.contributionMarginPct,
    cogsVariationPct: cogsVariation,
    balanceVsSafe: balance.committed.greaterThan(0)
      ? { balance: balance.available, committed: balance.committed }
      : null,
  });
}

/**
 * Variación del costo unitario promedio de compra entre dos períodos.
 *
 * Se compara el costo unitario promedio ponderado de las compras, no el total
 * gastado: comprar más caro y comprar más cantidad son cosas distintas, y sólo
 * la primera es una alerta.
 */
async function getCogsVariation(period: DateRange, comparison: DateRange) {
  const [current, previous] = await Promise.all([
    averageUnitCost(period),
    averageUnitCost(comparison),
  ]);

  return costVariationPct(current, previous);
}

async function averageUnitCost(range: DateRange) {
  const items = await prisma.purchaseItem.findMany({
    where: { purchase: { businessDate: { gte: range.from, lte: range.to } } },
    select: { quantity: true, totalCost: true },
  });

  const units = items.reduce((acc, item) => acc.plus(money(item.quantity)), ZERO);
  const cost = items.reduce((acc, item) => acc.plus(money(item.totalCost)), ZERO);

  return units.isZero() ? ZERO : cost.div(units);
}
