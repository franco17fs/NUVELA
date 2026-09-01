import { money, sumBy, ZERO, type Decimal } from "@/lib/money";
import { monthAlignedWeeks, type DateRange } from "@/lib/dates";
import type { CashflowKind, CashflowMovement, CashflowWeek } from "./types";

/**
 * Cashflow semanal (§23 del brief).
 *
 * Esto es CAJA, no resultado. Una venta de hoy aparece acá el día en que el
 * dinero se libera (`money_release_date`), no el día en que se vendió. El P&L
 * vive en `margins.ts` y las dos cosas nunca se mezclan (§2 y §51 del brief).
 *
 * Cada movimiento trae su `kind`, que la UI usa para distinguir visualmente:
 *   REAL      ya ocurrió
 *   SCHEDULED programado, con fecha y monto ciertos (una obligación cargada)
 *   ESTIMATED estimado sobre datos conocidos (liberación futura de un cobro real)
 *   FORECAST  proyección estadística
 */

export const INFLOW_CATEGORIES = {
  MELI_RELEASE: "Liberaciones Mercado Pago",
  MANUAL_INCOME: "Ingresos manuales",
  FORECAST_SALES: "Ventas proyectadas",
} as const;

export const OUTFLOW_CATEGORIES = {
  INVENTORY: "Compras de mercadería",
  MELI_CHARGES: "Comisiones y cargos",
  ADS: "Publicidad",
  TAXES: "Impuestos",
  EXPENSES: "Gastos",
  OBLIGATIONS: "Obligaciones",
} as const;

export interface CashflowInput {
  range: DateRange;
  openingBalance: Decimal;
  movements: CashflowMovement[];
  /** Colchón mínimo: si el saldo proyectado cae por debajo, se marca la semana. */
  safetyBuffer: Decimal;
}

export function calculateCashflowForecast(input: CashflowInput): CashflowWeek[] {
  const weeks = monthAlignedWeeks(input.range);
  let balance = money(input.openingBalance);

  return weeks.map((week) => {
    const inWeek = input.movements.filter(
      (movement) =>
        movement.date.getTime() >= week.from.getTime() &&
        movement.date.getTime() <= week.to.getTime(),
    );

    const inflows = inWeek.filter((movement) => movement.direction === "IN");
    const outflows = inWeek.filter((movement) => movement.direction === "OUT");

    const realIncome = sumBy(
      inflows.filter((movement) => movement.kind === "REAL"),
      (movement) => movement.amount,
    );
    const projectedIncome = sumBy(
      inflows.filter((movement) => movement.kind !== "REAL"),
      (movement) => movement.amount,
    );

    const byCategory = (category: string) =>
      sumBy(
        outflows.filter((movement) => movement.category === category),
        (movement) => movement.amount,
      );

    const inventoryPurchases = byCategory(OUTFLOW_CATEGORIES.INVENTORY);
    const meliCharges = byCategory(OUTFLOW_CATEGORIES.MELI_CHARGES);
    const ads = byCategory(OUTFLOW_CATEGORIES.ADS);
    const taxes = byCategory(OUTFLOW_CATEGORIES.TAXES);
    const expenses = byCategory(OUTFLOW_CATEGORIES.EXPENSES);
    const obligations = byCategory(OUTFLOW_CATEGORIES.OBLIGATIONS);

    // Cualquier egreso con una categoría no prevista igual tiene que impactar el
    // saldo: se toma el total de salidas, no la suma de las categorías conocidas.
    const totalOutflows = sumBy(outflows, (movement) => movement.amount);

    const openingBalance = balance;
    const closingBalance = openingBalance
      .plus(realIncome)
      .plus(projectedIncome)
      .minus(totalOutflows);
    balance = closingBalance;

    const kinds: Record<CashflowKind, Decimal> = {
      REAL: ZERO,
      SCHEDULED: ZERO,
      ESTIMATED: ZERO,
      FORECAST: ZERO,
    };
    for (const movement of inWeek) {
      const signed =
        movement.direction === "IN" ? money(movement.amount) : money(movement.amount).negated();
      kinds[movement.kind] = kinds[movement.kind].plus(signed);
    }

    return {
      label: week.label,
      from: week.from,
      to: week.to,
      openingBalance,
      realIncome,
      projectedIncome,
      inventoryPurchases,
      meliCharges,
      ads,
      taxes,
      expenses,
      obligations,
      closingBalance,
      kinds,
      belowSafetyBuffer: closingBalance.lessThan(money(input.safetyBuffer)),
    };
  });
}

/**
 * Primer día en el que el saldo proyectado cae por debajo del colchón.
 * Es lo que alimenta la alerta "el 18/09 podrías quedar sin caja suficiente".
 */
export function findCashShortfallDate(params: {
  openingBalance: Decimal;
  movements: CashflowMovement[];
  safetyBuffer: Decimal;
}): { date: Date; balance: Decimal } | null {
  const buffer = money(params.safetyBuffer);

  // Se evalúa al CIERRE de cada día, no movimiento a movimiento: un egreso de la
  // mañana compensado por un ingreso de la tarde no es un quiebre de caja.
  const netByDay = new Map<number, Decimal>();
  for (const movement of params.movements) {
    const dayTime = movement.date.getTime();
    const signed =
      movement.direction === "IN" ? money(movement.amount) : money(movement.amount).negated();
    netByDay.set(dayTime, (netByDay.get(dayTime) ?? ZERO).plus(signed));
  }

  let balance = money(params.openingBalance);
  for (const dayTime of [...netByDay.keys()].sort((a, b) => a - b)) {
    balance = balance.plus(netByDay.get(dayTime) ?? ZERO);
    if (balance.lessThan(buffer)) {
      return { date: new Date(dayTime), balance };
    }
  }

  return null;
}

/** Saldo proyectado al final del rango. */
export function projectedClosingBalance(weeks: CashflowWeek[]): Decimal {
  return weeks.length === 0 ? ZERO : weeks[weeks.length - 1]!.closingBalance;
}
