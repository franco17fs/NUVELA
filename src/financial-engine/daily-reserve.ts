import { clampNonNegative, formatARS, money, ratio, ZERO, type Decimal } from "@/lib/money";
import { daysUntil, formatBusinessDateLong } from "@/lib/dates";
import { uncoveredAmount } from "./cash";
import type { DailyReserveInput, DailyReserveResult, ProjectionConfidence } from "./types";

/**
 * Daily Reserve Engine (§20 del brief).
 *
 * Responde "¿cuánto tengo que separar por día para llegar al vencimiento?".
 *
 * Explícitamente NO es `deuda / días`. Ese reparto ingenuo ignora que parte de la
 * plata ya está en camino y que hay otros compromisos antes. El cálculo real es:
 *
 *   1. Falta cubrir            = monto − reservado − pagado
 *   2. Plata en camino útil    = liberaciones pendientes antes del vencimiento
 *                                − obligaciones anteriores no cubiertas
 *                                − costo de reposición esperado
 *                                − egresos previstos
 *                                − colchón mínimo
 *      (nunca menor a cero: si los compromisos previos se comen todo,
 *       esta obligación no puede contar con nada de eso)
 *   3. A generar con la operación = falta cubrir − plata en camino útil
 *   4. Por día                    = a generar / días restantes
 *
 * Además se compara contra la capacidad diaria real del negocio (contribución
 * promedio) para poder avisar "no alcanza con el ritmo actual", y se informa una
 * confianza derivada de cuántos días de historia hay y de qué tan volátiles son.
 *
 * El `naiveDailyAmount` se devuelve sólo para poder explicarle al usuario la
 * diferencia entre el número ingenuo y el recomendado.
 */
export function calculateDailyReserve(input: DailyReserveInput): DailyReserveResult {
  const remainingAmount = uncoveredAmount(input.obligation);
  const rawDaysRemaining = daysUntil(input.obligation.dueDate, input.today);
  const isOverdue = rawDaysRemaining < 0;

  // Si vence hoy o ya venció, no hay días para prorratear: hay que cubrirlo ya.
  const daysRemaining = Math.max(rawDaysRemaining, 0);
  const divisor = Math.max(daysRemaining, 1);

  const naiveDailyAmount = remainingAmount.div(divisor);

  const commitmentsBefore = money(input.earlierObligationsUncovered)
    .plus(money(input.expectedInventoryCost))
    .plus(money(input.expectedExpenses))
    .plus(money(input.safetyBuffer));

  const usableIncoming = clampNonNegative(
    money(input.pendingReleaseBeforeDue).minus(commitmentsBefore),
  );

  const needFromOperations = clampNonNegative(remainingAmount.minus(usableIncoming));
  const dailyAmount = needFromOperations.div(divisor);

  const dailyCapacity = money(input.averageDailyContribution);
  const exceedsCapacity = dailyCapacity.greaterThan(0)
    ? dailyAmount.greaterThan(dailyCapacity)
    : needFromOperations.greaterThan(0);

  const confidence = projectionConfidence({
    historyDays: input.historyDays,
    mean: dailyCapacity,
    stdDev: money(input.contributionStdDev),
  });

  const explanation: string[] = [];
  explanation.push(
    `Falta cubrir ${formatARS(remainingAmount)} de ${formatARS(input.obligation.amount)} con vencimiento ${formatBusinessDateLong(input.obligation.dueDate)}.`,
  );
  if (isOverdue) {
    explanation.push(`La obligación está vencida hace ${Math.abs(rawDaysRemaining)} día(s).`);
  } else if (daysRemaining === 0) {
    explanation.push("Vence hoy: no hay días para prorratear.");
  } else {
    explanation.push(`Quedan ${daysRemaining} día(s) hasta el vencimiento.`);
  }

  if (money(input.pendingReleaseBeforeDue).greaterThan(0)) {
    explanation.push(
      `Se liberan ${formatARS(input.pendingReleaseBeforeDue)} de Mercado Pago antes del vencimiento; ` +
        `${formatARS(commitmentsBefore)} ya están comprometidos antes que esta obligación, así que se puede contar con ${formatARS(usableIncoming)}.`,
    );
  }

  if (needFromOperations.lessThan(remainingAmount)) {
    explanation.push(
      `Por eso la recomendación (${formatARS(dailyAmount)}/día) es menor que el reparto simple ${formatARS(naiveDailyAmount)}/día.`,
    );
  } else if (needFromOperations.equals(remainingAmount) && usableIncoming.isZero()) {
    explanation.push(
      "No hay liberaciones libres antes del vencimiento: la obligación depende íntegramente de la operación.",
    );
  }

  if (exceedsCapacity && dailyCapacity.greaterThan(0)) {
    explanation.push(
      `Atención: la contribución promedio es de ${formatARS(dailyCapacity)}/día, menos que lo que hay que separar.`,
    );
  }

  return {
    remainingAmount,
    daysRemaining,
    dailyAmount,
    naiveDailyAmount,
    dailyCapacity,
    exceedsCapacity,
    confidence,
    explanation,
    isOverdue,
  };
}

/**
 * Confianza de una proyección.
 *
 * Se basa en dos cosas medibles: cuánta historia hay y qué tan dispersa es
 * (coeficiente de variación = desvío / media). No hay magia ni modelo oculto:
 * poca historia o mucha volatilidad ⇒ confianza baja.
 */
export function projectionConfidence(params: {
  historyDays: number;
  mean: Decimal;
  stdDev: Decimal;
}): ProjectionConfidence {
  if (params.historyDays < 7) return "BAJA";
  if (money(params.mean).isZero()) return "BAJA";

  const cv = ratio(params.stdDev, params.mean).abs();

  if (params.historyDays >= 30 && cv.lessThanOrEqualTo(0.35)) return "ALTA";
  if (params.historyDays >= 14 && cv.lessThanOrEqualTo(0.6)) return "MEDIA";
  return "BAJA";
}

/**
 * Recomendación diaria agregada: cuánto separar hoy considerando TODAS las
 * obligaciones del horizonte, no una sola.
 *
 * Cada obligación se evalúa con el motor de arriba, pasándole como
 * "obligaciones anteriores" las que vencen antes que ella. La suma de las
 * recomendaciones diarias es lo que hay que apartar hoy.
 */
export function calculateTotalDailyReserve(params: {
  obligations: DailyReserveInput["obligation"][];
  today: Date;
  averageDailyContribution: Decimal;
  historyDays: number;
  contributionStdDev: Decimal;
  /** Liberaciones pendientes por fecha de acreditación. */
  pendingReleasesByDate: { date: Date; amount: Decimal }[];
  expectedDailyInventoryCost: Decimal;
  expectedDailyExpenses: Decimal;
  safetyBuffer: Decimal;
}): { totalDaily: Decimal; perObligation: (DailyReserveResult & { obligationId: string })[] } {
  const sorted = [...params.obligations].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
  );

  const perObligation = sorted.map((obligation, index) => {
    const earlier = sorted.slice(0, index);
    const earlierUncovered = earlier.reduce<Decimal>(
      (acc, item) => acc.plus(uncoveredAmount(item)),
      ZERO,
    );

    const days = Math.max(daysUntil(obligation.dueDate, params.today), 0);
    const pendingBeforeDue = params.pendingReleasesByDate
      .filter((release) => release.date.getTime() <= obligation.dueDate.getTime())
      .reduce<Decimal>((acc, release) => acc.plus(money(release.amount)), ZERO);

    const result = calculateDailyReserve({
      obligation,
      today: params.today,
      averageDailyContribution: params.averageDailyContribution,
      historyDays: params.historyDays,
      contributionStdDev: params.contributionStdDev,
      pendingReleaseBeforeDue: pendingBeforeDue,
      earlierObligationsUncovered: earlierUncovered,
      expectedInventoryCost: money(params.expectedDailyInventoryCost).times(days),
      expectedExpenses: money(params.expectedDailyExpenses).times(days),
      // El colchón se descuenta una sola vez, en la obligación más próxima:
      // si se restara en todas, quedaría contado N veces.
      safetyBuffer: index === 0 ? money(params.safetyBuffer) : ZERO,
    });

    return { ...result, obligationId: obligation.id };
  });

  const totalDaily = perObligation.reduce<Decimal>(
    (acc, result) => acc.plus(result.dailyAmount),
    ZERO,
  );

  return { totalDaily, perObligation };
}
