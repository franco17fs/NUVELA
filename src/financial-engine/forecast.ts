import { money, ratio, sumBy, ZERO, Decimal } from "@/lib/money";
import { addDays, dayOfWeek } from "@/lib/dates";
import { projectionConfidence } from "./daily-reserve";
import type { ProjectionConfidence, SalesForecast, SalesForecastPoint } from "./types";

/**
 * Proyección de ventas.
 *
 * Deliberadamente **no** es machine learning (§24 del brief): es un modelo
 * estadístico simple, explicable y testeable. Cada supuesto que usa queda
 * listado en `assumptions`, así que el usuario puede ver por qué el sistema
 * proyecta lo que proyecta.
 *
 * Componentes:
 *   1. Nivel base: promedio ponderado de los últimos días, dando más peso a los
 *      recientes (decaimiento exponencial).
 *   2. Estacionalidad semanal: factor por día de la semana, calculado sobre la
 *      historia y amortiguado hacia 1 cuando hay pocas observaciones.
 *   3. Tendencia: pendiente lineal reciente, amortiguada para que no explote en
 *      horizontes largos.
 *   4. Escenario: multiplicador conservador / base / optimista.
 */

export interface DailySalesPoint {
  date: Date;
  revenue: Decimal;
  /** Contribución del día (margen), no facturación. */
  contribution: Decimal;
}

export const SCENARIO_MULTIPLIERS: Record<SalesForecast["scenario"], number> = {
  CONSERVATIVE: 0.8,
  BASE: 1,
  OPTIMISTIC: 1.2,
};

export interface ForecastOptions {
  horizonDays: number;
  scenario: SalesForecast["scenario"];
  /** Multiplicador manual; si se pasa, reemplaza al del escenario. */
  scenarioMultiplier?: number;
  /** Ventana de historia usada para el nivel base. */
  lookbackDays?: number;
  /** Factor de decaimiento: más bajo = más peso a los días recientes. */
  decay?: number;
  /** Desactiva la estacionalidad semanal (útil para tests). */
  useDayOfWeek?: boolean;
  /** Desactiva la tendencia. */
  useTrend?: boolean;
  today?: Date;
}

export function calculateSalesForecast(
  history: DailySalesPoint[],
  options: ForecastOptions,
): SalesForecast {
  const lookbackDays = options.lookbackDays ?? 28;
  const decay = options.decay ?? 0.94;
  const useDayOfWeek = options.useDayOfWeek ?? true;
  const useTrend = options.useTrend ?? true;
  const multiplier = money(options.scenarioMultiplier ?? SCENARIO_MULTIPLIERS[options.scenario]);

  const sorted = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());
  const window = sorted.slice(-lookbackDays);
  const assumptions: string[] = [];

  if (window.length === 0) {
    return {
      scenario: options.scenario,
      points: [],
      averageDailyRevenue: ZERO,
      marginRate: ZERO,
      confidence: "BAJA",
      model: "weighted-average-v1",
      assumptions: ["Sin historial de ventas: no se puede proyectar."],
    };
  }

  const baseDaily = weightedAverage(
    window.map((point) => money(point.revenue)),
    decay,
  );
  assumptions.push(
    `Nivel base: promedio ponderado de ${window.length} día(s), con más peso en los recientes.`,
  );

  const totalRevenue = sumBy(window, (point) => point.revenue);
  const totalContribution = sumBy(window, (point) => point.contribution);
  const marginRate = ratio(totalContribution, totalRevenue);
  assumptions.push(
    `Margen histórico aplicado: ${marginRate.times(100).toDecimalPlaces(1).toFixed(1)}% de la facturación.`,
  );

  const dowFactors = useDayOfWeek ? dayOfWeekFactors(window) : null;
  if (dowFactors) {
    assumptions.push("Se aplica estacionalidad por día de la semana.");
  }

  const slope = useTrend ? linearSlope(window.map((point) => money(point.revenue))) : ZERO;
  if (useTrend && !slope.isZero()) {
    assumptions.push(
      `Tendencia diaria detectada: ${slope.isPositive() ? "+" : ""}${slope.toDecimalPlaces(2).toFixed(2)} por día, amortiguada en el horizonte.`,
    );
  }

  if (!multiplier.equals(1)) {
    assumptions.push(
      `Escenario ${options.scenario}: se ajusta la facturación por ${multiplier.times(100).toDecimalPlaces(0).toFixed(0)}%.`,
    );
  }

  const start = options.today ?? sorted[sorted.length - 1]!.date;
  const points: SalesForecastPoint[] = [];

  for (let offset = 1; offset <= options.horizonDays; offset += 1) {
    const date = addDays(start, offset);

    // La tendencia se amortigua: sin freno, extrapolar una pendiente lineal a 90
    // días produce números absurdos.
    const dampening = new Decimal(1).minus(new Decimal(offset).div(options.horizonDays + offset));
    const trendComponent = slope.times(offset).times(dampening);

    const dowFactor = dowFactors ? (dowFactors[dayOfWeek(date)] ?? new Decimal(1)) : new Decimal(1);

    const revenue = Decimal.max(baseDaily.plus(trendComponent).times(dowFactor).times(multiplier), 0);

    points.push({ date, revenue, contribution: revenue.times(marginRate) });
  }

  const stdDev = standardDeviation(window.map((point) => money(point.revenue)));

  return {
    scenario: options.scenario,
    points,
    averageDailyRevenue: baseDaily,
    marginRate,
    // La confianza se mide sobre la historia REAL disponible, no sobre la ventana
    // de ponderación: tener 90 días de datos y ponderar los últimos 28 es más
    // confiable que tener sólo 28 días en total.
    confidence: forecastConfidence(sorted.length, baseDaily, stdDev, options.horizonDays),
    model: "weighted-average-v1",
    assumptions,
  };
}

/**
 * La confianza cae con el horizonte: proyectar 7 días no es lo mismo que 90,
 * aunque la historia sea la misma.
 */
function forecastConfidence(
  historyDays: number,
  mean: Decimal,
  stdDev: Decimal,
  horizonDays: number,
): ProjectionConfidence {
  const base = projectionConfidence({ historyDays, mean, stdDev });
  if (horizonDays <= 15) return base;
  if (horizonDays <= 45) return base === "ALTA" ? "MEDIA" : base === "MEDIA" ? "MEDIA" : "BAJA";
  return base === "ALTA" ? "MEDIA" : "BAJA";
}

// -----------------------------------------------------------------------------
// Estadística de apoyo (toda en Decimal, sin punto flotante)
// -----------------------------------------------------------------------------

/** Promedio ponderado con decaimiento exponencial: el último día pesa más. */
export function weightedAverage(values: Decimal[], decay: number): Decimal {
  if (values.length === 0) return ZERO;

  const decayDecimal = new Decimal(decay);
  let weightedSum = ZERO;
  let weightSum = ZERO;

  for (let i = 0; i < values.length; i += 1) {
    // El último elemento tiene exponente 0 (peso 1); los anteriores decaen.
    const exponent = values.length - 1 - i;
    const weight = decayDecimal.pow(exponent);
    weightedSum = weightedSum.plus((values[i] ?? ZERO).times(weight));
    weightSum = weightSum.plus(weight);
  }

  return weightSum.isZero() ? ZERO : weightedSum.div(weightSum);
}

export function mean(values: Decimal[]): Decimal {
  if (values.length === 0) return ZERO;
  return values.reduce<Decimal>((acc, value) => acc.plus(value), ZERO).div(values.length);
}

/** Desvío estándar poblacional. */
export function standardDeviation(values: Decimal[]): Decimal {
  if (values.length < 2) return ZERO;
  const avg = mean(values);
  const variance = values
    .reduce<Decimal>((acc, value) => acc.plus(value.minus(avg).pow(2)), ZERO)
    .div(values.length);
  return variance.sqrt();
}

/** Pendiente de la regresión lineal simple sobre el índice temporal. */
export function linearSlope(values: Decimal[]): Decimal {
  const n = values.length;
  if (n < 3) return ZERO;

  const indices = Array.from({ length: n }, (_, i) => new Decimal(i));
  const meanX = mean(indices);
  const meanY = mean(values);

  let numerator = ZERO;
  let denominator = ZERO;
  for (let i = 0; i < n; i += 1) {
    const dx = (indices[i] ?? ZERO).minus(meanX);
    numerator = numerator.plus(dx.times((values[i] ?? ZERO).minus(meanY)));
    denominator = denominator.plus(dx.pow(2));
  }

  return denominator.isZero() ? ZERO : numerator.div(denominator);
}

/**
 * Factores por día de la semana (índice 0 = domingo).
 *
 * Se amortiguan hacia 1 según cuántas observaciones haya de ese día: con dos
 * lunes en la historia no conviene creerle demasiado al factor del lunes.
 */
export function dayOfWeekFactors(history: DailySalesPoint[]): Record<number, Decimal> {
  const overall = mean(history.map((point) => money(point.revenue)));
  const factors: Record<number, Decimal> = {};

  for (let day = 0; day < 7; day += 1) {
    const dayPoints = history.filter((point) => dayOfWeek(point.date) === day);
    if (dayPoints.length === 0 || overall.isZero()) {
      factors[day] = new Decimal(1);
      continue;
    }

    const rawFactor = mean(dayPoints.map((point) => money(point.revenue))).div(overall);
    // Amortiguación: con 4+ observaciones se confía plenamente en el factor.
    const trust = Decimal.min(new Decimal(dayPoints.length).div(4), 1);
    factors[day] = new Decimal(1).plus(rawFactor.minus(1).times(trust));
  }

  return factors;
}
