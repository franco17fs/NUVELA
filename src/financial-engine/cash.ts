import { clampNonNegative, max, money, sumBy, ZERO, type Decimal } from "@/lib/money";
import { daysUntil } from "@/lib/dates";
import type {
  ObligationInput,
  ReserveInput,
  SafeCashInput,
  SafeCashResult,
  TracedAmount,
} from "./types";

/**
 * Caja: qué parte del saldo es realmente gastable.
 *
 * Principio del §51 del brief: SALDO ≠ DINERO DISPONIBLE. Nunca se muestra el
 * saldo completo como "dinero libre" si una parte está comprometida.
 *
 *   disponible seguro = saldo disponible
 *                       − fondo de reposición de mercadería
 *                       − reservas activas
 *                       − obligaciones próximas no cubiertas
 *                       − gastos comprometidos
 *                       − colchón mínimo
 *
 * ## Cómo se evita contar dos veces la misma plata
 *
 * El fondo de reposición y el colchón mínimo tienen su propio término en la
 * fórmula, así que las reservas de tipo `INVENTORY_REPLACEMENT` y
 * `SAFETY_BUFFER` **no** se suman otra vez en `reservesTotal`: para el fondo se
 * toma el mayor entre el calculado y el ya reservado, y para el colchón se toma
 * el mayor entre el configurado y el ya reservado.
 *
 * De una obligación sólo se cuenta la parte **no cubierta**
 * (`monto − reservado − pagado`), porque la parte reservada ya está contada en
 * la reserva correspondiente.
 */
export function calculateSafeAvailableCash(input: SafeCashInput): SafeCashResult {
  const availableBalance = money(input.availableBalance);

  const inventoryReserve = sumBy(
    input.reserves.filter((reserve) => reserve.type === "INVENTORY_REPLACEMENT"),
    (reserve) => reserve.currentAmount,
  );
  const inventoryReplacementFund = max(
    money(input.inventoryReplacementFund),
    inventoryReserve,
  );

  const bufferReserve = sumBy(
    input.reserves.filter((reserve) => reserve.type === "SAFETY_BUFFER"),
    (reserve) => reserve.currentAmount,
  );
  const safetyBuffer = max(money(input.safetyBuffer), bufferReserve);

  const reservesTotal = sumBy(
    input.reserves.filter(
      (reserve) =>
        reserve.type !== "INVENTORY_REPLACEMENT" && reserve.type !== "SAFETY_BUFFER",
    ),
    (reserve) => reserve.currentAmount,
  );

  const upcomingObligationsUncovered = sumBy(input.upcomingObligations, (obligation) =>
    uncoveredAmount(obligation),
  );

  const committedExpenses = money(input.committedExpenses);

  const safeAvailable = availableBalance
    .minus(inventoryReplacementFund)
    .minus(reservesTotal)
    .minus(upcomingObligationsUncovered)
    .minus(committedExpenses)
    .minus(safetyBuffer);

  // El fondo de reposición existe justamente para comprar mercadería, así que
  // el presupuesto de compra es el disponible seguro MÁS ese fondo.
  const recommendedInventoryBudget = clampNonNegative(
    safeAvailable.plus(inventoryReplacementFund),
  );

  const breakdown: TracedAmount[] = [
    {
      label: "Saldo disponible (conciliado)",
      amount: availableBalance,
      kind: "ACTUAL",
      source: "BILLING_REPORT",
      note: "Reconstruido de los reportes oficiales de Mercado Pago",
    },
    {
      label: "Fondo de reposición de mercadería",
      amount: inventoryReplacementFund.negated(),
      kind: "ESTIMATED",
      source: "CALCULATED",
      note: "Costo de reponer el stock ya vendido",
    },
    {
      label: "Reservas activas",
      amount: reservesTotal.negated(),
      kind: "ACTUAL",
      source: "MANUAL",
    },
    {
      label: "Obligaciones próximas no cubiertas",
      amount: upcomingObligationsUncovered.negated(),
      kind: "ACTUAL",
      source: "MANUAL",
    },
    {
      label: "Gastos comprometidos",
      amount: committedExpenses.negated(),
      kind: "ACTUAL",
      source: "MANUAL",
    },
    {
      label: "Colchón mínimo",
      amount: safetyBuffer.negated(),
      kind: "ACTUAL",
      source: "MANUAL",
    },
    {
      label: "Disponible seguro",
      amount: safeAvailable,
      kind: "ESTIMATED",
      source: "CALCULATED",
    },
  ];

  return {
    availableBalance,
    inventoryReplacementFund,
    reservesTotal,
    upcomingObligationsUncovered,
    committedExpenses,
    safetyBuffer,
    safeAvailable,
    recommendedInventoryBudget,
    breakdown,
  };
}

/** Cuánto falta cubrir de una obligación. Nunca negativo. */
export function uncoveredAmount(obligation: ObligationInput): Decimal {
  return clampNonNegative(
    money(obligation.amount)
      .minus(money(obligation.reservedAmount))
      .minus(money(obligation.paidAmount)),
  );
}

// -----------------------------------------------------------------------------
// Orden de asignación del dinero (§21 del brief)
// -----------------------------------------------------------------------------

export type AllocationBucketId =
  | "INVENTORY_REPLACEMENT"
  | "CRITICAL_OBLIGATIONS"
  | "TAX_RESERVES"
  | "OPERATING_EXPENSES"
  | "SAFETY_BUFFER"
  | "PROFIT";

export interface AllocationBucket {
  id: AllocationBucketId;
  label: string;
  /** Cuánto necesita este bolsillo. `null` en el último, que absorbe el resto. */
  needed: Decimal | null;
  order: number;
}

export interface AllocationResult {
  id: AllocationBucketId;
  label: string;
  needed: Decimal;
  allocated: Decimal;
  shortfall: Decimal;
}

/**
 * Orden por defecto. Es configurable: `allocateCash` recibe los bolsillos ya
 * ordenados, así que cambiar la prelación no requiere tocar esta función.
 */
export const DEFAULT_ALLOCATION_ORDER: AllocationBucketId[] = [
  "INVENTORY_REPLACEMENT",
  "CRITICAL_OBLIGATIONS",
  "TAX_RESERVES",
  "OPERATING_EXPENSES",
  "SAFETY_BUFFER",
  "PROFIT",
];

/**
 * Reparte el dinero disponible en cascada, respetando la prelación.
 * Cada bolsillo toma lo que necesita hasta agotar el disponible; el faltante
 * queda explícito en `shortfall` en vez de repartirse a prorrata, porque
 * financieramente importa saber CUÁL obligación queda descubierta.
 */
export function allocateCash(available: Decimal, buckets: AllocationBucket[]): AllocationResult[] {
  let remaining = clampNonNegative(available);
  const ordered = [...buckets].sort((a, b) => a.order - b.order);

  return ordered.map((bucket) => {
    // `needed: null` = bolsillo residual (la ganancia disponible).
    if (bucket.needed === null) {
      const allocated = remaining;
      remaining = ZERO;
      return { id: bucket.id, label: bucket.label, needed: allocated, allocated, shortfall: ZERO };
    }

    const needed = clampNonNegative(bucket.needed);
    const allocated = needed.greaterThan(remaining) ? remaining : needed;
    remaining = remaining.minus(allocated);

    return {
      id: bucket.id,
      label: bucket.label,
      needed,
      allocated,
      shortfall: needed.minus(allocated),
    };
  });
}

/** Obligaciones que vencen dentro del horizonte, ordenadas por vencimiento. */
export function obligationsWithinHorizon(
  obligations: ObligationInput[],
  horizonDays: number,
  from: Date,
): ObligationInput[] {
  return obligations
    .filter((obligation) => {
      const days = daysUntil(obligation.dueDate, from);
      // Se incluyen las vencidas (días negativos): siguen siendo plata que se debe.
      return days <= horizonDays;
    })
    .filter((obligation) => uncoveredAmount(obligation).greaterThan(0))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

/** Total comprometido por obligaciones en el horizonte. */
export function committedByObligations(
  obligations: ObligationInput[],
  horizonDays: number,
  from: Date,
): Decimal {
  return sumBy(obligationsWithinHorizon(obligations, horizonDays, from), uncoveredAmount);
}

/** Estado de una obligación derivado de sus montos y su vencimiento. */
export function deriveObligationStatus(
  obligation: ObligationInput,
  today: Date,
): "UPCOMING" | "PARTIALLY_RESERVED" | "COVERED" | "PAID" | "OVERDUE" {
  const amount = money(obligation.amount);
  const paid = money(obligation.paidAmount);
  const reserved = money(obligation.reservedAmount);

  if (paid.greaterThanOrEqualTo(amount) && amount.greaterThan(0)) return "PAID";
  if (daysUntil(obligation.dueDate, today) < 0) return "OVERDUE";
  if (reserved.plus(paid).greaterThanOrEqualTo(amount) && amount.greaterThan(0)) return "COVERED";
  if (reserved.greaterThan(0) || paid.greaterThan(0)) return "PARTIALLY_RESERVED";
  return "UPCOMING";
}

/** Suma de reservas activas, para mostrar el total de "bolsillos". */
export function totalReserved(reserves: ReserveInput[]): Decimal {
  return sumBy(reserves, (reserve) => reserve.currentAmount);
}
