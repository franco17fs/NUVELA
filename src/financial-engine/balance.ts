import { money, sumBy, ZERO, type Decimal } from "@/lib/money";
import type { TracedAmount } from "./types";

/**
 * Saldo de Mercado Pago — reconstrucción honesta.
 *
 * ## El hallazgo que obliga a esto
 *
 * **No existe un endpoint oficial y público de "saldo en vivo" de Mercado Pago
 * para cuentas de vendedor** (docs/mercadolibre-api-research.md §5.3). El
 * endpoint `/users/{id}/mercadopago_account/balance` que circula en foros no
 * figura en la documentación y responde 403 por política.
 *
 * Así que NUVELA no inventa un saldo. Lo **reconstruye** a partir de los
 * reportes oficiales y lo etiqueta en toda la interfaz como
 * **"Saldo conciliado"**, nunca como "Saldo API en tiempo real".
 *
 * ## Cómo se reconstruye
 *
 * El reporte de liberaciones trae filas con `RECORD_TYPE`:
 *   - `initial_available_balance` saldo al inicio del período
 *   - `release`                   cada liberación o débito
 *   - `available_balance`         saldo informado por Mercado Pago
 *   - `total`                     totales del reporte (se ignoran: no son saldo)
 *
 * Se toma el `available_balance` más reciente como ancla —es el número que da
 * Mercado Pago— y se le suman los movimientos posteriores. Si no hay ningún
 * ancla, se parte del `initial_available_balance` y se acumula todo.
 *
 * Si no hay reporte configurado, la función devuelve `hasReport: false` y la UI
 * muestra el estado "sin reporte configurado" en lugar de un número inventado.
 */

export interface BalanceMovementInput {
  /** Fecha en la que el movimiento impacta el saldo. */
  date: Date;
  recordType:
    | "INITIAL_AVAILABLE_BALANCE"
    | "RELEASE"
    | "TOTAL"
    | "AVAILABLE_BALANCE"
    | "MOVEMENT"
    | "UNKNOWN";
  netCreditAmount: Decimal;
  netDebitAmount: Decimal;
  /** BALANCE_AMOUNT informado por Mercado Pago, cuando viene. */
  balanceAmount?: Decimal | null;
}

export interface PendingReleaseInput {
  /** `money_release_date` del pago. */
  releaseDate: Date;
  /** Neto que se va a acreditar. */
  amount: Decimal;
}

export interface ReconciledBalance {
  /** Disponible hoy, reconstruido. */
  available: Decimal;
  /** Aprobado pero todavía no liberado. */
  pendingRelease: Decimal;
  /** Hasta qué fecha llega la conciliación: define cuán confiable es el número. */
  reconciledUntil: Date | null;
  /** false = no hay datos de reporte; la UI no debe mostrar un saldo. */
  hasReport: boolean;
  /** Etiqueta obligatoria en la interfaz. */
  label: "Saldo conciliado";
  /** Cómo se llegó al número, para poder auditarlo. */
  breakdown: TracedAmount[];
}

export function reconstructBalance(params: {
  movements: BalanceMovementInput[];
  pendingReleases: PendingReleaseInput[];
  today: Date;
}): ReconciledBalance {
  const sorted = [...params.movements].sort((a, b) => a.date.getTime() - b.date.getTime());

  const breakdown: TracedAmount[] = [];

  // 1. Ancla: el saldo más reciente informado por Mercado Pago.
  const anchor = findLastAnchor(sorted);

  // 2. Movimientos posteriores al ancla que afectan el disponible.
  //    `TOTAL` se excluye: son subtotales del reporte, no dinero.
  const afterAnchor = sorted.filter(
    (movement) =>
      movement.recordType !== "TOTAL" &&
      movement.recordType !== "AVAILABLE_BALANCE" &&
      movement.recordType !== "INITIAL_AVAILABLE_BALANCE" &&
      (anchor === null || movement.date.getTime() > anchor.date.getTime()),
  );

  const credits = sumBy(afterAnchor, (movement) => movement.netCreditAmount);
  const debits = sumBy(afterAnchor, (movement) => movement.netDebitAmount);

  const anchorAmount = anchor?.amount ?? ZERO;
  const available = anchorAmount.plus(credits).minus(debits);

  breakdown.push({
    label: anchor ? "Saldo informado por Mercado Pago" : "Saldo inicial del reporte",
    amount: anchorAmount,
    kind: "ACTUAL",
    source: "BILLING_REPORT",
    note: anchor ? `Al ${anchor.date.toISOString().slice(0, 10)}` : undefined,
  });
  if (!credits.isZero()) {
    breakdown.push({
      label: "Liberaciones posteriores",
      amount: credits,
      kind: "ACTUAL",
      source: "BILLING_REPORT",
    });
  }
  if (!debits.isZero()) {
    breakdown.push({
      label: "Débitos posteriores",
      amount: debits.negated(),
      kind: "ACTUAL",
      source: "BILLING_REPORT",
    });
  }

  // 3. Pendiente de liberar: pagos aprobados cuya fecha de liberación es futura.
  const pendingRelease = sumBy(
    params.pendingReleases.filter(
      (release) => release.releaseDate.getTime() > params.today.getTime(),
    ),
    (release) => release.amount,
  );

  breakdown.push({
    label: "Pendiente de liberar",
    amount: pendingRelease,
    kind: "ACTUAL",
    source: "MP_API",
    note: "Pagos aprobados con fecha de liberación futura",
  });

  const lastMovement = sorted[sorted.length - 1];

  return {
    available,
    pendingRelease,
    reconciledUntil: lastMovement?.date ?? null,
    hasReport: sorted.length > 0,
    label: "Saldo conciliado",
    breakdown,
  };
}

function findLastAnchor(
  movements: BalanceMovementInput[],
): { date: Date; amount: Decimal } | null {
  for (let i = movements.length - 1; i >= 0; i -= 1) {
    const movement = movements[i];
    if (!movement) continue;
    if (movement.recordType === "AVAILABLE_BALANCE" && movement.balanceAmount != null) {
      return { date: movement.date, amount: money(movement.balanceAmount) };
    }
  }

  // Sin `available_balance`, se usa el saldo inicial del reporte.
  const initial = movements.find(
    (movement) => movement.recordType === "INITIAL_AVAILABLE_BALANCE",
  );
  if (initial) {
    const amount = initial.balanceAmount ?? initial.netCreditAmount;
    return { date: initial.date, amount: money(amount) };
  }

  return null;
}

/**
 * Frescura de la conciliación.
 * Se muestra junto al saldo para que el usuario sepa si está mirando algo de
 * hoy o de la semana pasada.
 */
export function reconciliationFreshness(
  reconciledUntil: Date | null,
  today: Date,
): { daysBehind: number; status: "AL_DIA" | "ATRASADO" | "SIN_DATOS" } {
  if (!reconciledUntil) return { daysBehind: Number.POSITIVE_INFINITY, status: "SIN_DATOS" };

  const daysBehind = Math.max(
    Math.round((today.getTime() - reconciledUntil.getTime()) / 86_400_000),
    0,
  );

  return { daysBehind, status: daysBehind <= 1 ? "AL_DIA" : "ATRASADO" };
}
