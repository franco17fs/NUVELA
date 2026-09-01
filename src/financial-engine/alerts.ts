import { formatARS, formatPercent, money, percentagePointsDelta, ZERO, type Decimal } from "@/lib/money";
import { formatBusinessDateLong } from "@/lib/dates";
import type { DailyReserveResult, SkuProfitabilityResult } from "./types";

/**
 * Generación de alertas (§26 del brief).
 *
 * Las alertas son puramente derivadas: se calculan a partir de números que ya
 * existen y que el usuario puede auditar. No hay heurísticas ocultas ni umbrales
 * mágicos escondidos en el código: todos los umbrales llegan por parámetro y
 * salen de la configuración.
 */

export type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  /** A dónde lleva la alerta cuando el usuario hace click. */
  href?: string;
}

export interface AlertThresholds {
  /** Publicidad sobre ventas por encima de este % dispara alerta. */
  adsOverSalesPct: number;
  /** Caída de margen en puntos porcentuales que dispara alerta. */
  marginDropPoints: number;
  /** Suba del costo de mercadería en % que dispara alerta. */
  costRisePct: number;
  /** Horizonte en días para "vencimientos próximos". */
  obligationHorizonDays: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  adsOverSalesPct: 12,
  marginDropPoints: 3,
  costRisePct: 10,
  obligationHorizonDays: 7,
};

export interface AlertInput {
  thresholds: AlertThresholds;
  /** Primer día proyectado con caja por debajo del colchón. */
  cashShortfall: { date: Date; balance: Decimal } | null;
  /** Total de vencimientos dentro del horizonte. */
  obligationsDue: Decimal;
  obligationsDueCount: number;
  /** Recomendación diaria agregada. */
  dailyReserve: { totalDaily: Decimal; days: number } | null;
  /** SKUs con problemas de margen. */
  skus: SkuProfitabilityResult[];
  /** Publicidad sobre ventas del período, en %. */
  adsOverSalesPct: Decimal;
  /** Margen del período y del anterior, en %. */
  marginPct: Decimal;
  previousMarginPct: Decimal;
  /** Variación del costo de mercadería, en %. */
  cogsVariationPct: Decimal;
  /** Saldo que parece disponible vs. lo realmente disponible. */
  balanceVsSafe: { balance: Decimal; committed: Decimal } | null;
}

export function generateAlerts(input: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  const t = input.thresholds;

  if (input.cashShortfall) {
    alerts.push({
      id: "cash-shortfall",
      severity: "CRITICAL",
      title: `Si mantenés el ritmo actual, el ${formatBusinessDateLong(input.cashShortfall.date)} podrías quedar sin caja suficiente.`,
      detail: `Saldo proyectado ese día: ${formatARS(input.cashShortfall.balance)}.`,
      href: "/cashflow",
    });
  }

  if (money(input.obligationsDue).isPositive()) {
    alerts.push({
      id: "obligations-due",
      severity: "WARNING",
      title: `Tenés ${formatARS(input.obligationsDue)} de vencimientos dentro de ${t.obligationHorizonDays} días.`,
      detail: `${input.obligationsDueCount} obligación(es) en el horizonte.`,
      href: "/obligaciones",
    });
  }

  if (input.dailyReserve && money(input.dailyReserve.totalDaily).isPositive()) {
    alerts.push({
      id: "daily-reserve",
      severity: "WARNING",
      title: `Necesitás reservar ${formatARS(input.dailyReserve.totalDaily)} diarios durante los próximos ${input.dailyReserve.days} días.`,
      href: "/obligaciones",
    });
  }

  for (const sku of input.skus) {
    if (sku.losesMoneyOnlyAfterAds) {
      alerts.push({
        id: `sku-negative-after-ads-${sku.skuCode}`,
        severity: "WARNING",
        title: `El SKU ${sku.skuCode} tiene margen negativo después de publicidad.`,
        detail: `Margen antes de ads: ${formatARS(sku.marginBeforeAds)} · después: ${formatARS(sku.margin)}.`,
        href: "/rentabilidad",
      });
    } else if (sku.losesMoney && money(sku.units).isPositive()) {
      alerts.push({
        id: `sku-loses-money-${sku.skuCode}`,
        severity: "CRITICAL",
        title: `Este producto genera ventas pero pierde dinero: ${sku.skuCode}.`,
        detail: `${sku.units} unidad(es), margen ${formatARS(sku.margin)} (${formatPercent(sku.marginPct)}).`,
        href: "/rentabilidad",
      });
    }
  }

  if (money(input.adsOverSalesPct).greaterThan(t.adsOverSalesPct)) {
    alerts.push({
      id: "ads-over-sales",
      severity: "WARNING",
      title: `Publicidad representa el ${formatPercent(input.adsOverSalesPct)} de las ventas.`,
      detail: `El umbral configurado es ${t.adsOverSalesPct}%.`,
      href: "/publicidad",
    });
  }

  if (money(input.cogsVariationPct).greaterThan(t.costRisePct)) {
    alerts.push({
      id: "cogs-rise",
      severity: "WARNING",
      title: `El costo de mercadería subió ${formatPercent(input.cogsVariationPct)} este período.`,
      href: "/mercaderia",
    });
  }

  const marginDelta = percentagePointsDelta(input.marginPct, input.previousMarginPct);
  if (marginDelta.negated().greaterThan(t.marginDropPoints)) {
    alerts.push({
      id: "margin-drop",
      severity: "WARNING",
      title: `Tu margen cayó ${marginDelta.negated().toDecimalPlaces(1).toFixed(1)} puntos respecto del período anterior.`,
      detail: `${formatPercent(input.previousMarginPct)} → ${formatPercent(input.marginPct)}.`,
      href: "/rentabilidad",
    });
  }

  if (input.balanceVsSafe && money(input.balanceVsSafe.committed).isPositive()) {
    alerts.push({
      id: "committed-money",
      severity: "INFO",
      title: `Tenés ${formatARS(input.balanceVsSafe.balance)} que parece disponible, pero ${formatARS(input.balanceVsSafe.committed)} está comprometido.`,
      href: "/mercado-pago",
    });
  }

  return sortBySeverity(alerts);
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

function sortBySeverity(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Alerta puntual cuando una obligación no se puede cubrir con el ritmo actual. */
export function reserveCapacityAlert(
  result: DailyReserveResult,
  obligationDescription: string,
): Alert | null {
  if (!result.exceedsCapacity) return null;
  return {
    id: `reserve-capacity-${obligationDescription}`,
    severity: "CRITICAL",
    title: `Con el ritmo actual no llegás a cubrir "${obligationDescription}".`,
    detail: `Habría que separar ${formatARS(result.dailyAmount)}/día y la contribución promedio es ${formatARS(result.dailyCapacity)}/día.`,
    href: "/obligaciones",
  };
}

/** Variación con signo, para los indicadores "↑ 2,1 pp vs período anterior". */
export function trendIndicator(
  current: Decimal,
  previous: Decimal,
): { direction: "up" | "down" | "flat"; delta: Decimal } {
  const delta = money(current).minus(money(previous));
  if (delta.isZero()) return { direction: "flat", delta: ZERO };
  return { direction: delta.isPositive() ? "up" : "down", delta };
}
