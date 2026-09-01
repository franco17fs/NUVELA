import Decimal from "decimal.js";

/**
 * Aritmética de dinero.
 *
 * Regla innegociable del proyecto: NUNCA se usa `number` para importes.
 * `0.1 + 0.2 !== 0.3` en punto flotante, y una diferencia de centavos repetida
 * en miles de órdenes destruye la conciliación.
 *
 * - En la base: `Decimal(18,4)` (Postgres NUMERIC).
 * - En memoria: `Decimal` de decimal.js.
 * - En el borde (JSON hacia el cliente): string, no number.
 */

// 28 dígitos significativos alcanzan de sobra para importes en ARS y ratios.
// ROUND_HALF_UP es el redondeo comercial habitual en Argentina.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;
export type MoneyInput = Decimal | string | number | null | undefined;

export const ZERO = new Decimal(0);

/**
 * Convierte a Decimal. Acepta `number` sólo por conveniencia en tests y en la
 * frontera de las APIs externas (que devuelven JSON con números): el valor se
 * normaliza vía string para no arrastrar el error binario del float.
 */
export function money(value: MoneyInput): Decimal {
  if (value === null || value === undefined) return ZERO;
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ZERO;
    return new Decimal(value.toString());
  }
  const trimmed = value.trim();
  if (trimmed === "") return ZERO;
  try {
    return new Decimal(trimmed);
  } catch {
    return ZERO;
  }
}

export function sum(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, value) => acc.plus(money(value)), ZERO);
}

export function sumBy<T>(items: T[], selector: (item: T) => MoneyInput): Decimal {
  return items.reduce<Decimal>((acc, item) => acc.plus(money(selector(item))), ZERO);
}

/** Redondea a la unidad monetaria (2 decimales) para presentación y cierre. */
export function toCents(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Porcentaje `part / whole * 100`. Devuelve 0 si `whole` es 0 en vez de NaN o
 * Infinity: un margen sobre facturación cero es "sin dato", no "infinito".
 */
export function percentage(part: MoneyInput, whole: MoneyInput): Decimal {
  const w = money(whole);
  if (w.isZero()) return ZERO;
  return money(part).div(w).times(100);
}

/** Ratio simple `a / b`, con la misma protección contra división por cero. */
export function ratio(a: MoneyInput, b: MoneyInput): Decimal {
  const denominator = money(b);
  if (denominator.isZero()) return ZERO;
  return money(a).div(denominator);
}

/** Aplica un porcentaje: `value * pct / 100`. */
export function applyPercentage(value: MoneyInput, pct: MoneyInput): Decimal {
  return money(value).times(money(pct)).div(100);
}

export function isZero(value: MoneyInput): boolean {
  return money(value).isZero();
}

export function isNegative(value: MoneyInput): boolean {
  return money(value).isNegative();
}

export function max(a: MoneyInput, b: MoneyInput): Decimal {
  const da = money(a);
  const db = money(b);
  return da.greaterThan(db) ? da : db;
}

export function min(a: MoneyInput, b: MoneyInput): Decimal {
  const da = money(a);
  const db = money(b);
  return da.lessThan(db) ? da : db;
}

/** Nunca por debajo de cero: usado en reservas y disponibles. */
export function clampNonNegative(value: MoneyInput): Decimal {
  const d = money(value);
  return d.isNegative() ? ZERO : d;
}

/**
 * Reparto proporcional de un total entre pesos, sin perder ni inventar centavos.
 * El residuo del redondeo se asigna a la porción más grande.
 *
 * Se usa para atribuir costos de pack (un envío, varias órdenes) y publicidad.
 */
export function allocateProportionally(total: MoneyInput, weights: MoneyInput[]): Decimal[] {
  const totalDecimal = toCents(total);
  const weightDecimals = weights.map(money);
  const weightSum = sum(weightDecimals);

  if (weightDecimals.length === 0) return [];
  if (weightSum.isZero()) {
    // Sin pesos válidos, se reparte en partes iguales.
    const share = toCents(totalDecimal.div(weightDecimals.length));
    const shares = weightDecimals.map(() => share);
    return settleRemainder(totalDecimal, shares, weightDecimals);
  }

  const shares = weightDecimals.map((w) => toCents(totalDecimal.times(w).div(weightSum)));
  return settleRemainder(totalDecimal, shares, weightDecimals);
}

function settleRemainder(total: Decimal, shares: Decimal[], weights: Decimal[]): Decimal[] {
  const allocated = sum(shares);
  const remainder = total.minus(allocated);
  if (remainder.isZero() || shares.length === 0) return shares;

  let targetIndex = 0;
  let largest = weights[0] ?? ZERO;
  for (let i = 1; i < weights.length; i += 1) {
    const w = weights[i] ?? ZERO;
    if (w.greaterThan(largest)) {
      largest = w;
      targetIndex = i;
    }
  }
  const adjusted = [...shares];
  adjusted[targetIndex] = (adjusted[targetIndex] ?? ZERO).plus(remainder);
  return adjusted;
}

/** Serialización para cruzar la frontera servidor → cliente. */
export function toMoneyString(value: MoneyInput): string {
  return toCents(value).toFixed(2);
}

const ARS_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const ARS_FORMATTER_CENTS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formato para mostrar. Acepta el string producido por `toMoneyString`.
 * El `Number()` acá es seguro y deliberado: sólo afecta la presentación, nunca
 * un valor que se vuelva a guardar o a operar.
 */
export function formatARS(value: MoneyInput, options?: { cents?: boolean }): string {
  const asNumber = Number(toCents(value).toFixed(2));
  return options?.cents ? ARS_FORMATTER_CENTS.format(asNumber) : ARS_FORMATTER.format(asNumber);
}

export function formatPercent(value: MoneyInput, decimals = 1): string {
  return `${money(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals)}%`;
}

/** Variación en puntos porcentuales entre dos porcentajes. */
export function percentagePointsDelta(current: MoneyInput, previous: MoneyInput): Decimal {
  return money(current).minus(money(previous));
}

export { Decimal };
