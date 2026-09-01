import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Fechas de negocio.
 *
 * Todo corte financiero (día, quincena, mes) se hace en la zona del negocio,
 * no en UTC. Una venta de las 22:30 del 31 de agosto en Buenos Aires es de
 * agosto, aunque en UTC ya sea 1 de septiembre.
 *
 * ## Por qué la aritmética es UTC pura y no usa las funciones locales de date-fns
 *
 * Una "fecha de negocio" acá es un día calendario sin hora, y se materializa como
 * `Date` a medianoche **UTC** (es lo que espera una columna `@db.Date` de Postgres).
 * Si sobre ese valor se llamara `startOfMonth()` de date-fns —que opera en la zona
 * local del proceso— en un servidor con TZ=-03:00 la medianoche UTC del 1 de
 * septiembre sería "31 de agosto 21:00" y el mes calculado saldría mal.
 *
 * Por eso toda la aritmética de días/meses de este módulo usa `Date.UTC` y los
 * getters `getUTC*`. date-fns-tz se usa sólo para lo que corresponde: convertir
 * entre un instante real y la zona del negocio.
 *
 * Argentina no aplica horario de verano, así que el offset es estable (-03:00);
 * aun así la conversión pasa por la base de zonas horarias, para no romper si
 * eso cambia.
 */
export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

let timezone = DEFAULT_TIMEZONE;

export function setBusinessTimezone(tz: string): void {
  timezone = tz;
}

export function getBusinessTimezone(): string {
  return timezone;
}

// -----------------------------------------------------------------------------
// Aritmética UTC pura sobre fechas de negocio
// -----------------------------------------------------------------------------

/** Construye una fecha de negocio a partir de sus componentes. */
export function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function addDays(date: Date, days: number): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
}

export function subDays(date: Date, days: number): Date {
  return addDays(date, -days);
}

export function addMonths(date: Date, months: number): Date {
  const targetMonth = date.getUTCMonth() + months;
  const lastDayOfTarget = new Date(
    Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0),
  ).getUTCDate();
  // Clampea el día para que "31 de enero + 1 mes" sea el 28/29 de febrero
  // y no se derrame al 2 o 3 de marzo.
  return utcDate(
    date.getUTCFullYear(),
    targetMonth,
    Math.min(date.getUTCDate(), lastDayOfTarget),
  );
}

export function subMonths(date: Date, months: number): Date {
  return addMonths(date, -months);
}

export function startOfMonth(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
}

const MS_PER_DAY = 86_400_000;

/** Días calendario entre dos fechas de negocio (`later - earlier`). */
export function differenceInDays(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

// -----------------------------------------------------------------------------
// Instante ↔ fecha de negocio
// -----------------------------------------------------------------------------

/** `YYYY-MM-DD` del instante dado, en la zona del negocio. */
export function businessDateKey(instant: Date, tz: string = timezone): string {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}

/**
 * Fecha de negocio como `Date` a medianoche UTC.
 * Se guarda en columnas `@db.Date`, que no tienen hora: usar medianoche UTC
 * evita que el driver corra el día para atrás al serializar.
 */
export function businessDate(instant: Date, tz: string = timezone): Date {
  return parseDateKey(businessDateKey(instant, tz));
}

/** Hoy, según la zona del negocio. */
export function today(tz: string = timezone): Date {
  return businessDate(new Date(), tz);
}

/**
 * Instante UTC en el que empieza ese día de negocio.
 * Es lo que se manda como `order.date_created.from` a la API de Mercado Libre.
 */
export function startOfBusinessDay(date: Date, tz: string = timezone): Date {
  return fromZonedTime(`${dateKey(date)}T00:00:00`, tz);
}

/** Instante UTC del final EXCLUSIVO del día de negocio (= inicio del siguiente). */
export function endOfBusinessDay(date: Date, tz: string = timezone): Date {
  return fromZonedTime(`${dateKey(addDays(date, 1))}T00:00:00`, tz);
}

export function nowInBusinessZone(tz: string = timezone): Date {
  return toZonedTime(new Date(), tz);
}

export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function dateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// -----------------------------------------------------------------------------
// Períodos (§47 del brief)
// -----------------------------------------------------------------------------

export type PeriodPresetId =
  | "today"
  | "yesterday"
  | "last7"
  | "last15"
  | "first-half"
  | "second-half"
  | "this-month"
  | "last-month"
  | "custom";

export interface DateRange {
  /** Primer día de negocio incluido. */
  from: Date;
  /** Último día de negocio incluido. */
  to: Date;
}

export interface Period extends DateRange {
  id: PeriodPresetId;
  label: string;
}

export const PERIOD_PRESETS: { id: PeriodPresetId; label: string }[] = [
  { id: "today", label: "Hoy" },
  { id: "yesterday", label: "Ayer" },
  { id: "last7", label: "Últimos 7 días" },
  { id: "last15", label: "Últimos 15 días" },
  { id: "first-half", label: "1 al 15" },
  { id: "second-half", label: "16 a fin de mes" },
  { id: "this-month", label: "Mes actual" },
  { id: "last-month", label: "Mes anterior" },
  { id: "custom", label: "Personalizado" },
];

export function resolvePeriod(
  id: PeriodPresetId,
  options?: { from?: Date; to?: Date; reference?: Date; tz?: string },
): Period {
  const tz = options?.tz ?? timezone;
  const reference = options?.reference ?? today(tz);
  const label = PERIOD_PRESETS.find((preset) => preset.id === id)?.label ?? "Período";

  switch (id) {
    case "today":
      return { id, label, from: reference, to: reference };
    case "yesterday": {
      const day = subDays(reference, 1);
      return { id, label, from: day, to: day };
    }
    case "last7":
      return { id, label, from: subDays(reference, 6), to: reference };
    case "last15":
      return { id, label, from: subDays(reference, 14), to: reference };
    case "first-half": {
      const start = startOfMonth(reference);
      return { id, label, from: start, to: addDays(start, 14) };
    }
    case "second-half": {
      const start = addDays(startOfMonth(reference), 15);
      return { id, label, from: start, to: endOfMonth(reference) };
    }
    case "this-month":
      return { id, label, from: startOfMonth(reference), to: endOfMonth(reference) };
    case "last-month": {
      const previous = subMonths(reference, 1);
      return { id, label, from: startOfMonth(previous), to: endOfMonth(previous) };
    }
    case "custom": {
      const from = options?.from ?? reference;
      const to = options?.to ?? reference;
      return { id, label, from, to };
    }
  }
}

/**
 * Período inmediatamente anterior, de la misma duración.
 * Es lo que alimenta todos los "↑ 2,1 pp vs período anterior" del dashboard.
 */
export function previousPeriod(period: DateRange): DateRange {
  const days = differenceInDays(period.to, period.from) + 1;
  return {
    from: subDays(period.from, days),
    to: subDays(period.to, days),
  };
}

/** Quincena a la que pertenece una fecha: 1 (1-15) o 2 (16-fin). */
export function fortnightOf(date: Date): 1 | 2 {
  return date.getUTCDate() <= 15 ? 1 : 2;
}

/** Rango de la quincena que contiene la fecha. */
export function fortnightRange(date: Date): DateRange {
  const start = startOfMonth(date);
  return fortnightOf(date) === 1
    ? { from: start, to: addDays(start, 14) }
    : { from: addDays(start, 15), to: endOfMonth(date) };
}

/** Rango de la quincena anterior a la de la fecha dada. */
export function previousFortnight(date: Date): DateRange {
  if (fortnightOf(date) === 2) {
    const start = startOfMonth(date);
    return { from: start, to: addDays(start, 14) };
  }
  const previousMonth = subMonths(date, 1);
  return { from: addDays(startOfMonth(previousMonth), 15), to: endOfMonth(previousMonth) };
}

// -----------------------------------------------------------------------------
// Semanas para el cashflow (§23 del brief)
// -----------------------------------------------------------------------------

export interface WeekBucket extends DateRange {
  label: string;
  index: number;
}

/**
 * Parte un rango en semanas alineadas al mes: 1-7, 8-14, 15-21, 22-fin.
 * Es el formato que pidió el brief ("01-07 Sep", "22-30 Sep") y el que usa el
 * negocio para planificar, en vez de semanas ISO que cruzan meses.
 */
export function monthAlignedWeeks(range: DateRange): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  let cursor = range.from;
  let index = 0;

  // Cota de seguridad: un rango razonable nunca supera unos pocos cientos de semanas.
  while (cursor.getTime() <= range.to.getTime() && index < 1000) {
    const monthEnd = endOfMonth(cursor);
    const dayOfMonth = cursor.getUTCDate();
    const boundaryDay = dayOfMonth <= 7 ? 7 : dayOfMonth <= 14 ? 14 : dayOfMonth <= 21 ? 21 : monthEnd.getUTCDate();
    const candidate = utcDate(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth(),
      Math.min(boundaryDay, monthEnd.getUTCDate()),
    );
    const bucketEnd = candidate.getTime() > range.to.getTime() ? range.to : candidate;

    buckets.push({
      index,
      from: cursor,
      to: bucketEnd,
      label: formatWeekLabel(cursor, bucketEnd),
    });

    cursor = addDays(bucketEnd, 1);
    index += 1;
  }

  return buckets;
}

const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatWeekLabel(from: Date, to: Date): string {
  const fromDay = String(from.getUTCDate()).padStart(2, "0");
  const toDay = String(to.getUTCDate()).padStart(2, "0");
  const fromMonth = MONTH_SHORT[from.getUTCMonth()] ?? "";
  const toMonth = MONTH_SHORT[to.getUTCMonth()] ?? "";
  return fromMonth === toMonth
    ? `${fromDay}-${toDay} ${toMonth}`
    : `${fromDay} ${fromMonth} - ${toDay} ${toMonth}`;
}

/** Todos los días de negocio del rango, inclusive. */
export function eachBusinessDay(range: DateRange): Date[] {
  const days: Date[] = [];
  let cursor = range.from;
  while (cursor.getTime() <= range.to.getTime()) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function daysInRange(range: DateRange): number {
  return differenceInDays(range.to, range.from) + 1;
}

/** Días desde `from` (inclusive) hasta el vencimiento. 0 = vence hoy. */
export function daysUntil(dueDate: Date, from: Date = today()): number {
  return differenceInDays(dueDate, from);
}

export function formatBusinessDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatBusinessDateLong(date: Date): string {
  return `${formatBusinessDate(date)}/${date.getUTCFullYear()}`;
}

/** Día de la semana en la zona de negocio: 0 = domingo. Alimenta la estacionalidad. */
export function dayOfWeek(date: Date): number {
  return date.getUTCDay();
}

export function formatRelativeSync(date: Date | null | undefined, now: Date = new Date()): string {
  if (!date) return "nunca";
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}
