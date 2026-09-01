import "server-only";
import { prisma } from "@/lib/prisma";
import { money, sumBy, ZERO, type Decimal } from "@/lib/money";
import { addDays, businessDate, dateKey, today, type DateRange } from "@/lib/dates";
import {
  calculateInventoryReplacementFund,
  calculateSafeAvailableCash,
  calculateTotalDailyReserve,
  deriveObligationStatus,
  obligationsWithinHorizon,
  reconciliationFreshness,
  reconstructBalance,
  type CashflowMovement,
  type ObligationInput,
  type ReserveInput,
  type SafeCashResult,
} from "@/financial-engine";
import { scopeFilter, type AccountScope } from "./accounts";
import { getInventoryReplacementData } from "./finance";
import { getSetting } from "./settings";
import { OUTFLOW_CATEGORIES, INFLOW_CATEGORIES } from "@/financial-engine/cashflow";

/**
 * Caja: saldo conciliado, reservas, obligaciones y disponible seguro.
 *
 * Todo lo que sale de acá lleva su etiqueta de origen. En particular, el saldo
 * de Mercado Pago se presenta SIEMPRE como "Saldo conciliado" y nunca como un
 * saldo en vivo, porque la API oficial no expone tal cosa.
 */

export interface BalanceView {
  available: Decimal;
  pendingRelease: Decimal;
  committed: Decimal;
  reallyAvailable: Decimal;
  hasReport: boolean;
  reconciledUntil: Date | null;
  freshness: { daysBehind: number; status: "AL_DIA" | "ATRASADO" | "SIN_DATOS" };
  label: string;
}

export async function getBalance(scope: AccountScope): Promise<BalanceView> {
  const currentDay = today();

  const [movements, pendingPayments] = await Promise.all([
    prisma.mercadoPagoMovement.findMany({
      where: scopeFilter(scope),
      orderBy: { date: "asc" },
      take: 5000,
      select: {
        date: true,
        recordType: true,
        netCreditAmount: true,
        netDebitAmount: true,
        balanceAmount: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        ...scopeFilter(scope),
        status: "APPROVED",
        moneyReleaseDate: { gt: new Date() },
      },
      select: { moneyReleaseDate: true, netReceivedAmount: true, transactionAmount: true },
    }),
  ]);

  const reconstructed = reconstructBalance({
    movements: movements.map((movement) => ({
      date: movement.date,
      recordType: movement.recordType,
      netCreditAmount: money(movement.netCreditAmount),
      netDebitAmount: money(movement.netDebitAmount),
      balanceAmount: movement.balanceAmount ? money(movement.balanceAmount) : null,
    })),
    pendingReleases: pendingPayments.map((payment) => ({
      releaseDate: payment.moneyReleaseDate as Date,
      // Si Mercado Pago todavía no informó el neto, se usa el monto de la
      // transacción: es una cota superior, y se prefiere eso a omitir la
      // liberación y subestimar lo que va a entrar.
      amount: money(payment.netReceivedAmount ?? payment.transactionAmount),
    })),
    today: currentDay,
  });

  const safeCash = await getSafeAvailableCash(scope);

  return {
    available: reconstructed.available,
    pendingRelease: reconstructed.pendingRelease,
    committed: reconstructed.available.minus(safeCash.safeAvailable),
    reallyAvailable: safeCash.safeAvailable,
    hasReport: reconstructed.hasReport,
    reconciledUntil: reconstructed.reconciledUntil,
    freshness: reconciliationFreshness(reconstructed.reconciledUntil, currentDay),
    label: reconstructed.label,
  };
}

async function loadReserves(scope: AccountScope): Promise<ReserveInput[]> {
  const reserves = await prisma.reserve.findMany({
    where: { ...(scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {}), active: true },
    orderBy: { priority: "asc" },
  });

  return reserves.map((reserve) => ({
    id: reserve.id,
    name: reserve.name,
    type: reserve.type,
    targetAmount: money(reserve.targetAmount),
    currentAmount: money(reserve.currentAmount),
    priority: reserve.priority,
  }));
}

export async function loadObligations(scope: AccountScope): Promise<ObligationInput[]> {
  const obligations = await prisma.obligation.findMany({
    where: {
      ...(scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {}),
      status: { not: "PAID" },
    },
    orderBy: { dueDate: "asc" },
  });

  return obligations.map((obligation) => ({
    id: obligation.id,
    description: obligation.description,
    amount: money(obligation.amount),
    reservedAmount: money(obligation.reservedAmount),
    paidAmount: money(obligation.paidAmount),
    dueDate: obligation.dueDate,
    priority: obligation.priority,
  }));
}

/** Colchón mínimo configurado por el usuario. */
async function getSafetyBuffer(): Promise<Decimal> {
  return money(await getSetting("safetyBuffer", "0"));
}

/** Horizonte en días de lo que se considera "obligación próxima". */
async function getObligationHorizon(): Promise<number> {
  return Number(await getSetting("obligationHorizonDays", "15"));
}

export async function getSafeAvailableCash(scope: AccountScope): Promise<SafeCashResult> {
  const currentDay = today();
  const horizon = await getObligationHorizon();

  const [reserves, obligations, safetyBuffer, replacementFund, committedExpenses, balanceRaw] =
    await Promise.all([
      loadReserves(scope),
      loadObligations(scope),
      getSafetyBuffer(),
      getReplacementFund(scope),
      getCommittedExpenses(scope, currentDay, horizon),
      rawAvailableBalance(scope),
    ]);

  return calculateSafeAvailableCash({
    availableBalance: balanceRaw,
    inventoryReplacementFund: replacementFund,
    reserves,
    upcomingObligations: obligationsWithinHorizon(obligations, horizon, currentDay),
    committedExpenses,
    safetyBuffer,
  });
}

/**
 * Saldo disponible crudo, sin restar reservas.
 * Se separa de `getBalance` para evitar la recursión (el disponible seguro
 * necesita el saldo, y el saldo muestra el disponible seguro).
 */
async function rawAvailableBalance(scope: AccountScope): Promise<Decimal> {
  const movements = await prisma.mercadoPagoMovement.findMany({
    where: scopeFilter(scope),
    orderBy: { date: "asc" },
    take: 5000,
    select: {
      date: true,
      recordType: true,
      netCreditAmount: true,
      netDebitAmount: true,
      balanceAmount: true,
    },
  });

  return reconstructBalance({
    movements: movements.map((movement) => ({
      date: movement.date,
      recordType: movement.recordType,
      netCreditAmount: money(movement.netCreditAmount),
      netDebitAmount: money(movement.netDebitAmount),
      balanceAmount: movement.balanceAmount ? money(movement.balanceAmount) : null,
    })),
    pendingReleases: [],
    today: today(),
  }).available;
}

/** Fondo de reposición sobre las ventas de los últimos 30 días. */
export async function getReplacementFund(scope: AccountScope): Promise<Decimal> {
  const currentDay = today();
  const soldItems = await getInventoryReplacementData(scope, {
    from: addDays(currentDay, -30),
    to: currentDay,
  });

  return calculateInventoryReplacementFund(soldItems).replacementFund;
}

/** Compras y gastos ya comprometidos con vencimiento dentro del horizonte. */
async function getCommittedExpenses(
  scope: AccountScope,
  from: Date,
  horizonDays: number,
): Promise<Decimal> {
  const to = addDays(from, horizonDays);

  const purchases = await prisma.purchase.aggregate({
    where: {
      ...(scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {}),
      paid: false,
      paymentDueDate: { gte: from, lte: to },
    },
    _sum: { total: true },
  });

  return money(purchases._sum.total);
}

export interface ObligationView {
  id: string;
  description: string;
  amount: Decimal;
  reservedAmount: Decimal;
  paidAmount: Decimal;
  uncovered: Decimal;
  dueDate: Date;
  daysUntilDue: number;
  category: string;
  priority: string;
  status: string;
  installmentLabel: string | null;
}

export async function listObligations(scope: AccountScope): Promise<ObligationView[]> {
  const currentDay = today();
  const obligations = await prisma.obligation.findMany({
    where: scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {},
    orderBy: { dueDate: "asc" },
  });

  return obligations.map((obligation) => {
    const input: ObligationInput = {
      id: obligation.id,
      description: obligation.description,
      amount: money(obligation.amount),
      reservedAmount: money(obligation.reservedAmount),
      paidAmount: money(obligation.paidAmount),
      dueDate: obligation.dueDate,
      priority: obligation.priority,
    };

    return {
      id: obligation.id,
      description: obligation.description,
      amount: input.amount,
      reservedAmount: input.reservedAmount,
      paidAmount: input.paidAmount,
      uncovered: input.amount.minus(input.reservedAmount).minus(input.paidAmount),
      dueDate: obligation.dueDate,
      daysUntilDue: Math.round(
        (obligation.dueDate.getTime() - currentDay.getTime()) / 86_400_000,
      ),
      category: obligation.category,
      priority: obligation.priority,
      // El estado se deriva de los montos y la fecha, no se confía en la columna:
      // así no queda desactualizado si alguien registra un pago por otra vía.
      status: deriveObligationStatus(input, currentDay),
      installmentLabel:
        obligation.installmentsTotal && obligation.installmentNumber
          ? `${obligation.installmentNumber}/${obligation.installmentsTotal}`
          : null,
    };
  });
}

export async function listReserves(scope: AccountScope) {
  const reserves = await loadReserves(scope);
  return reserves.map((reserve) => ({
    ...reserve,
    remaining: reserve.targetAmount.minus(reserve.currentAmount),
  }));
}

/** Recomendación diaria agregada (§20 del brief). */
export async function getDailyReserveRecommendation(scope: AccountScope) {
  const currentDay = today();
  const horizon = await getObligationHorizon();

  const [obligations, safetyBuffer, dailyStats, pendingReleases] = await Promise.all([
    loadObligations(scope),
    getSafetyBuffer(),
    getDailyContributionStats(scope),
    getPendingReleasesByDate(scope),
  ]);

  const relevant = obligationsWithinHorizon(obligations, horizon, currentDay);

  if (relevant.length === 0) {
    return { totalDaily: ZERO, perObligation: [], days: horizon, confidence: "ALTA" as const };
  }

  const replacementFund = await getReplacementFund(scope);

  const result = calculateTotalDailyReserve({
    obligations: relevant,
    today: currentDay,
    averageDailyContribution: dailyStats.mean,
    historyDays: dailyStats.days,
    contributionStdDev: dailyStats.stdDev,
    pendingReleasesByDate: pendingReleases,
    // El fondo de reposición se prorratea por día sobre la ventana de 30 días
    // con la que se calculó.
    expectedDailyInventoryCost: replacementFund.div(30),
    expectedDailyExpenses: dailyStats.dailyExpenses,
    safetyBuffer,
  });

  return {
    ...result,
    days: horizon,
    confidence: result.perObligation[0]?.confidence ?? ("BAJA" as const),
  };
}

/** Contribución diaria promedio y su dispersión, de los últimos 60 días. */
export async function getDailyContributionStats(scope: AccountScope) {
  const currentDay = today();
  const range: DateRange = { from: addDays(currentDay, -60), to: currentDay };

  const { getDailySeries } = await import("./finance");
  const series = await getDailySeries(scope, range);

  const contributions = series.map((point) => point.contribution);
  const mean =
    contributions.length === 0
      ? ZERO
      : contributions.reduce<Decimal>((acc, value) => acc.plus(value), ZERO).div(contributions.length);

  const variance =
    contributions.length < 2
      ? ZERO
      : contributions
          .reduce<Decimal>((acc, value) => acc.plus(value.minus(mean).pow(2)), ZERO)
          .div(contributions.length);

  const expenses = await prisma.expense.aggregate({
    where: {
      ...(scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {}),
      businessDate: { gte: range.from, lte: range.to },
    },
    _sum: { amount: true },
  });

  return {
    mean,
    stdDev: variance.sqrt(),
    // Días con actividad: un negocio que arrancó hace una semana no tiene 60
    // días de historia aunque el rango los abarque.
    days: series.filter((point) => !point.revenue.isZero()).length,
    dailyExpenses: money(expenses._sum.amount).div(61),
  };
}

async function getPendingReleasesByDate(
  scope: AccountScope,
): Promise<{ date: Date; amount: Decimal }[]> {
  const payments = await prisma.payment.findMany({
    where: {
      ...scopeFilter(scope),
      status: "APPROVED",
      moneyReleaseDate: { gt: new Date() },
    },
    select: { moneyReleaseDate: true, netReceivedAmount: true, transactionAmount: true },
  });

  const byDate = new Map<string, Decimal>();
  for (const payment of payments) {
    const day = businessDate(payment.moneyReleaseDate as Date);
    const key = dateKey(day);
    byDate.set(
      key,
      (byDate.get(key) ?? ZERO).plus(money(payment.netReceivedAmount ?? payment.transactionAmount)),
    );
  }

  return [...byDate.entries()].map(([key, amount]) => ({
    date: new Date(`${key}T00:00:00.000Z`),
    amount,
  }));
}

/**
 * Movimientos de caja para el cashflow.
 *
 * Mezcla lo REAL (movimientos ya conciliados), lo ESTIMADO (liberaciones futuras
 * de cobros que ya existen), lo PROGRAMADO (obligaciones y compras a pagar) y lo
 * PROYECTADO (ventas futuras). Cada uno con su `kind`, para que la UI los pinte
 * distinto y nadie confunda una proyección con plata en la cuenta.
 */
export async function getCashflowMovements(
  scope: AccountScope,
  range: DateRange,
): Promise<CashflowMovement[]> {
  const movements: CashflowMovement[] = [];

  const [releases, obligations, purchases, expenses, incomes, ads] = await Promise.all([
    prisma.payment.findMany({
      where: {
        ...scopeFilter(scope),
        status: "APPROVED",
        cashBusinessDate: { gte: range.from, lte: range.to },
      },
      select: {
        cashBusinessDate: true,
        netReceivedAmount: true,
        transactionAmount: true,
        moneyReleaseDate: true,
      },
    }),
    prisma.obligation.findMany({
      where: {
        ...(scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {}),
        status: { not: "PAID" },
        dueDate: { gte: range.from, lte: range.to },
      },
      select: { dueDate: true, amount: true, paidAmount: true, description: true },
    }),
    prisma.purchase.findMany({
      where: {
        ...(scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {}),
        paid: false,
        paymentDueDate: { gte: range.from, lte: range.to },
      },
      select: { paymentDueDate: true, total: true, supplier: true },
    }),
    prisma.expense.findMany({
      where: {
        ...(scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {}),
        businessDate: { gte: range.from, lte: range.to },
      },
      select: { businessDate: true, amount: true, category: { select: { name: true } } },
    }),
    prisma.income.findMany({
      where: {
        ...(scope.kind === "ACCOUNT" ? { sellerAccountId: scope.sellerAccountId } : {}),
        businessDate: { gte: range.from, lte: range.to },
      },
      select: { businessDate: true, amount: true, description: true },
    }),
    prisma.adMetricDaily.groupBy({
      by: ["date"],
      where: { ...scopeFilter(scope), date: { gte: range.from, lte: range.to } },
      _sum: { cost: true },
    }),
  ]);

  const now = new Date();

  for (const release of releases) {
    movements.push({
      date: release.cashBusinessDate as Date,
      direction: "IN",
      // Ya liberado = REAL; a liberar = ESTIMADO (el cobro existe, la fecha
      // puede moverse).
      kind: (release.moneyReleaseDate as Date) <= now ? "REAL" : "ESTIMATED",
      category: INFLOW_CATEGORIES.MELI_RELEASE,
      amount: money(release.netReceivedAmount ?? release.transactionAmount),
    });
  }

  for (const obligation of obligations) {
    const pending = money(obligation.amount).minus(money(obligation.paidAmount));
    if (pending.greaterThan(0)) {
      movements.push({
        date: obligation.dueDate,
        direction: "OUT",
        kind: "SCHEDULED",
        category: OUTFLOW_CATEGORIES.OBLIGATIONS,
        amount: pending,
        description: obligation.description,
      });
    }
  }

  for (const purchase of purchases) {
    movements.push({
      date: purchase.paymentDueDate as Date,
      direction: "OUT",
      kind: "SCHEDULED",
      category: OUTFLOW_CATEGORIES.INVENTORY,
      amount: money(purchase.total),
      description: purchase.supplier,
    });
  }

  for (const expense of expenses) {
    movements.push({
      date: expense.businessDate,
      direction: "OUT",
      kind: "REAL",
      category: OUTFLOW_CATEGORIES.EXPENSES,
      amount: money(expense.amount),
      description: expense.category.name,
    });
  }

  for (const income of incomes) {
    movements.push({
      date: income.businessDate,
      direction: "IN",
      kind: "REAL",
      category: INFLOW_CATEGORIES.MANUAL_INCOME,
      amount: money(income.amount),
      description: income.description ?? undefined,
    });
  }

  for (const day of ads) {
    const cost = money(day._sum.cost);
    if (cost.greaterThan(0)) {
      movements.push({
        date: day.date,
        direction: "OUT",
        kind: "REAL",
        category: OUTFLOW_CATEGORIES.ADS,
        amount: cost,
      });
    }
  }

  return movements;
}

/** Total de reservas activas, para el panel de bolsillos. */
export async function getReservesTotal(scope: AccountScope): Promise<Decimal> {
  const reserves = await loadReserves(scope);
  return sumBy(reserves, (reserve) => reserve.currentAmount);
}
