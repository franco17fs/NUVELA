import "server-only";
import {
  parseDateKey,
  previousPeriod,
  resolvePeriod,
  type DateRange,
  type Period,
  type PeriodPresetId,
} from "@/lib/dates";
import { parseAccountScope, type AccountScope } from "./accounts";

/**
 * Traduce los filtros globales de la URL a un contexto tipado.
 *
 * Al ser el único lugar que interpreta la query string, cualquier página nueva
 * hereda automáticamente el mismo comportamiento: mismo alcance de cuenta, mismo
 * período y mismo período de comparación.
 */

export interface RequestContext {
  scope: AccountScope;
  period: Period;
  /** Período anterior de igual duración, para las variaciones. */
  comparison: DateRange;
}

export type SearchParams = Record<string, string | string[] | undefined>;

const VALID_PERIODS: PeriodPresetId[] = [
  "today",
  "yesterday",
  "last7",
  "last15",
  "first-half",
  "second-half",
  "this-month",
  "last-month",
  "custom",
];

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveContext(searchParams: SearchParams): RequestContext {
  const scope = parseAccountScope(single(searchParams.cuenta));

  const requested = single(searchParams.periodo);
  const periodId: PeriodPresetId = VALID_PERIODS.includes(requested as PeriodPresetId)
    ? (requested as PeriodPresetId)
    : "this-month";

  const period = resolvePeriod(periodId, {
    from: parseDateParam(single(searchParams.desde)),
    to: parseDateParam(single(searchParams.hasta)),
  });

  return { scope, period, comparison: previousPeriod(period) };
}

function parseDateParam(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = parseDateKey(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Conserva los filtros globales al construir un enlace interno. */
export function withFilters(href: string, searchParams: SearchParams): string {
  const params = new URLSearchParams();
  for (const key of ["cuenta", "periodo", "desde", "hasta"]) {
    const value = single(searchParams[key]);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${href}?${query}` : href;
}
