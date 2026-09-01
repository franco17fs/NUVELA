import { money, percentage, ratio, ZERO, type Decimal } from "@/lib/money";
import type {
  PeriodResult,
  PeriodResultInput,
  SkuAggregateInput,
  SkuProfitabilityResult,
} from "./types";

/**
 * Definiciones financieras del §29 del brief, implementadas una sola vez.
 *
 * Ninguna de estas fórmulas puede vivir en un componente React: si el margen se
 * calcula en dos lugares, tarde o temprano dan distinto y el dashboard miente.
 *
 *   Facturación bruta          ventas aprobadas, antes de todo
 *   Facturación neta comercial bruta − cancelaciones − devoluciones − descuentos propios
 *   Margen bruto               neta comercial − costo de mercadería
 *   Margen de contribución     margen bruto − costos ML − logística − financiación − publicidad
 *   Resultado operativo        margen de contribución − gastos operativos
 *
 * "Ganancia" es el resultado operativo. La facturación neta NO es ganancia.
 */
export function calculatePeriodResult(input: PeriodResultInput): PeriodResult {
  const grossRevenue = money(input.grossRevenue);

  const netCommercialRevenue = grossRevenue
    .minus(money(input.cancellations))
    .minus(money(input.refunds))
    .minus(money(input.sellerFundedDiscounts));

  const grossMargin = netCommercialRevenue.minus(money(input.cogs));

  const totalMeliCosts = money(input.meliFees)
    .plus(money(input.fixedFees))
    .plus(money(input.financingFees))
    .plus(money(input.shippingCost))
    .plus(money(input.otherCharges));

  const contributionMargin = grossMargin
    .minus(totalMeliCosts)
    .minus(money(input.adsCost))
    // `taxesAsCost` ya viene filtrado por el tratamiento fiscal de la cuenta:
    // si la retención es crédito fiscal, llega en cero.
    .minus(money(input.taxesAsCost));

  const operatingResult = contributionMargin.minus(money(input.operatingExpenses));

  return {
    grossRevenue,
    netCommercialRevenue,
    grossMargin,
    grossMarginPct: percentage(grossMargin, netCommercialRevenue),
    contributionMargin,
    contributionMarginPct: percentage(contributionMargin, netCommercialRevenue),
    operatingResult,
    operatingMarginPct: percentage(operatingResult, netCommercialRevenue),
    totalMeliCosts,
  };
}

/** Margen bruto aislado, para usos puntuales. */
export function calculateGrossMargin(netCommercialRevenue: Decimal, cogs: Decimal): Decimal {
  return money(netCommercialRevenue).minus(money(cogs));
}

/** Margen de contribución aislado. */
export function calculateContributionMargin(params: {
  grossMargin: Decimal;
  meliCosts: Decimal;
  logistics: Decimal;
  financing: Decimal;
  advertising: Decimal;
}): Decimal {
  return money(params.grossMargin)
    .minus(money(params.meliCosts))
    .minus(money(params.logistics))
    .minus(money(params.financing))
    .minus(money(params.advertising));
}

/**
 * Rentabilidad por SKU (§27 del brief).
 *
 * Calcula el margen antes y después de publicidad, que es lo que permite
 * detectar el caso "este producto genera ventas pero pierde dinero": un SKU
 * puede tener margen positivo y quedar negativo una vez imputada la pauta.
 *
 * - ROAS  = facturación atribuida a publicidad / costo de publicidad
 * - ACOS  = costo de publicidad / facturación atribuida
 * - TACOS = costo de publicidad / facturación TOTAL del SKU (incluye orgánico)
 */
export function calculateSkuProfitability(input: SkuAggregateInput): SkuProfitabilityResult {
  const costsBeforeAds = money(input.cogs)
    .plus(money(input.meliFees))
    .plus(money(input.fixedFees))
    .plus(money(input.financingFees))
    .plus(money(input.shippingCost))
    .plus(money(input.otherCharges));

  const marginBeforeAds = money(input.revenue).minus(costsBeforeAds);
  const margin = marginBeforeAds.minus(money(input.adsCost));

  return {
    ...input,
    marginBeforeAds,
    margin,
    marginPct: percentage(margin, input.revenue),
    roas: ratio(input.adsAttributedRevenue, input.adsCost),
    acos: ratio(input.adsCost, input.adsAttributedRevenue).times(100),
    tacos: ratio(input.adsCost, input.revenue).times(100),
    losesMoney: margin.isNegative(),
    losesMoneyOnlyAfterAds: margin.isNegative() && !marginBeforeAds.isNegative(),
  };
}

/**
 * Publicidad sobre ventas del período. Es el número que responde
 * "Publicidad representa el 14,2% de las ventas".
 */
export function advertisingOverSales(adsCost: Decimal, revenue: Decimal): Decimal {
  return percentage(adsCost, revenue);
}

/** ROAS consolidado del período. */
export function calculateRoas(attributedRevenue: Decimal, adsCost: Decimal): Decimal {
  return ratio(attributedRevenue, adsCost);
}

/** ACOS consolidado del período, en porcentaje. */
export function calculateAcos(adsCost: Decimal, attributedRevenue: Decimal): Decimal {
  return ratio(adsCost, attributedRevenue).times(100);
}

/** TACOS consolidado: publicidad sobre facturación total, en porcentaje. */
export function calculateTacos(adsCost: Decimal, totalRevenue: Decimal): Decimal {
  return ratio(adsCost, totalRevenue).times(100);
}

/**
 * "Neto recibido": dinero efectivamente acreditado después de los cargos.
 * No es ganancia ni facturación: es lo que entra a la cuenta (§29 y §51).
 */
export function calculateNetReceived(params: {
  paidAmount: Decimal;
  meliFees: Decimal;
  shippingCost: Decimal;
  financingFees: Decimal;
  taxesWithheld: Decimal;
  refunds: Decimal;
}): Decimal {
  return money(params.paidAmount)
    .minus(money(params.meliFees))
    .minus(money(params.shippingCost))
    .minus(money(params.financingFees))
    .minus(money(params.taxesWithheld))
    .minus(money(params.refunds));
}

/** Suma segura de una serie de márgenes, evitando propagar nulos. */
export function totalOrZero(values: (Decimal | null | undefined)[]): Decimal {
  return values.reduce<Decimal>((acc, value) => acc.plus(money(value)), ZERO);
}
