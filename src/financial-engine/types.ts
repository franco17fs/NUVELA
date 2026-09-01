import type Decimal from "decimal.js";

/**
 * Tipos del motor financiero.
 *
 * El motor es PURO: no toca la base, no llama APIs, no sabe de React.
 * Recibe estructuras planas y devuelve resultados. Eso lo hace testeable al
 * 100% y evita que las fórmulas se dispersen por componentes (§40 del brief).
 */

/** Qué tan firme es el número (§39 del brief). */
export type ValueKind = "ACTUAL" | "ESTIMATED" | "FORECAST";

/** De dónde salió el número (§38 del brief). */
export type MoneySource =
  | "MELI_API"
  | "MP_API"
  | "BILLING_REPORT"
  | "MANUAL"
  | "CALCULATED"
  | "FORECAST";

/**
 * Importe trazable. Es el tipo de retorno de todo componente del waterfall:
 * la UI puede mostrar "$4.520 REAL" o "$800 ESTIMADO" sin adivinar.
 */
export interface TracedAmount {
  /** Etiqueta legible: "Comisión", "Costo producto", … */
  label: string;
  amount: Decimal;
  kind: ValueKind;
  source: MoneySource;
  /** Identificador en el sistema de origen, para poder abrir el detalle. */
  reference?: string;
  /** Explicación de cómo se obtuvo, cuando no es obvio. */
  note?: string;
}

// -----------------------------------------------------------------------------
// Rentabilidad por orden
// -----------------------------------------------------------------------------

export interface OrderItemInput {
  id: string;
  mlItemId: string;
  sellerSku?: string | null;
  skuId?: string | null;
  title: string;
  quantity: number;
  /** Precio unitario cobrado. */
  unitPrice: Decimal;
  /** Precio original por todas las unidades, sin descuentos (gross_price). */
  grossPrice?: Decimal | null;
  /** Porción del descuento a cargo del vendedor. */
  sellerDiscount: Decimal;
  /** Comisión REAL por unidad (order_items[].sale_fee). */
  saleFee?: Decimal | null;
  saleFeeKind: ValueKind;
  saleFeeSource: MoneySource;
  /** COGS congelado al procesar la venta. */
  cogsUnitCost?: Decimal | null;
  cogsTotal?: Decimal | null;
}

export interface OrderFeeInput {
  type:
    | "SALE_FEE"
    | "FIXED_FEE"
    | "FINANCING_FEE"
    | "SHIPPING_FEE"
    | "MARKETPLACE_FEE"
    | "ADS_ATTRIBUTED"
    | "TAX_WITHHELD"
    | "RETURN_COST"
    | "OTHER";
  amount: Decimal;
  kind: ValueKind;
  source: MoneySource;
  description?: string | null;
  reference?: string | null;
}

export interface OrderProfitabilityInput {
  orderId: string;
  mlOrderId: string;
  status: string;
  currencyId: string;
  /** total_amount de la orden. */
  totalAmount: Decimal;
  items: OrderItemInput[];
  /** Líneas de cargo ya normalizadas (comisión, envío, financiación, ads, impuestos). */
  fees: OrderFeeInput[];
  /** Devoluciones aplicadas sobre esta orden. */
  refundedAmount: Decimal;
  /**
   * Cómo tratar las retenciones/percepciones de esta cuenta.
   * Si es `FISCAL_CREDIT`, NO se descuentan del resultado: son un activo
   * a recuperar, no una pérdida (§9 y §51 del brief).
   */
  taxTreatment: TaxTreatment;
}

export type TaxTreatment = "FISCAL_CREDIT" | "COST" | "CASH_MOVEMENT_ONLY" | "LIABILITY";

/** Un escalón del waterfall de la venta (§28 del brief). */
export interface WaterfallStep extends TracedAmount {
  /** `POSITIVE` suma, `NEGATIVE` resta, `SUBTOTAL` es un acumulado. */
  effect: "POSITIVE" | "NEGATIVE" | "SUBTOTAL";
  /** Saldo acumulado después de aplicar este escalón. */
  runningTotal: Decimal;
}

export interface OrderProfitabilityResult {
  orderId: string;
  currencyId: string;

  grossRevenue: Decimal;
  sellerDiscounts: Decimal;
  refunds: Decimal;
  netRevenue: Decimal;

  cogs: Decimal;
  meliFees: Decimal;
  fixedFees: Decimal;
  financingFees: Decimal;
  shippingCost: Decimal;
  adsAttributed: Decimal;
  taxesWithheld: Decimal;
  /** Impuestos que efectivamente son costo, según el tratamiento fiscal. */
  taxesAsCost: Decimal;
  otherCharges: Decimal;

  grossMargin: Decimal;
  contributionMargin: Decimal;
  marginPct: Decimal;

  /** true si algún componente es ESTIMATED: la UI debe advertirlo. */
  hasEstimates: boolean;
  /** Qué componentes son estimados, para poder listarlos. */
  estimatedComponents: string[];
  waterfall: WaterfallStep[];
}

// -----------------------------------------------------------------------------
// Rentabilidad por SKU
// -----------------------------------------------------------------------------

export interface SkuAggregateInput {
  skuId: string | null;
  skuCode: string;
  mlItemId: string | null;
  title: string;
  units: number;
  revenue: Decimal;
  cogs: Decimal;
  meliFees: Decimal;
  fixedFees: Decimal;
  financingFees: Decimal;
  shippingCost: Decimal;
  adsCost: Decimal;
  otherCharges: Decimal;
  /** Facturación atribuida a publicidad (directa + indirecta). */
  adsAttributedRevenue: Decimal;
  hasEstimates: boolean;
}

export interface SkuProfitabilityResult extends SkuAggregateInput {
  marginBeforeAds: Decimal;
  margin: Decimal;
  marginPct: Decimal;
  /** ROAS = facturación atribuida / costo de publicidad. */
  roas: Decimal;
  /** ACOS = costo de publicidad / facturación atribuida. */
  acos: Decimal;
  /** TACOS = costo de publicidad / facturación TOTAL del SKU. */
  tacos: Decimal;
  /** Señal para la UI: el producto vende pero pierde plata. */
  losesMoney: boolean;
  /** El producto sólo pierde plata DESPUÉS de publicidad. */
  losesMoneyOnlyAfterAds: boolean;
}

// -----------------------------------------------------------------------------
// Resultado del período (P&L)
// -----------------------------------------------------------------------------

export interface PeriodResultInput {
  /** Ventas aprobadas antes de cancelaciones, devoluciones y costos. */
  grossRevenue: Decimal;
  cancellations: Decimal;
  refunds: Decimal;
  sellerFundedDiscounts: Decimal;
  cogs: Decimal;
  meliFees: Decimal;
  fixedFees: Decimal;
  financingFees: Decimal;
  shippingCost: Decimal;
  adsCost: Decimal;
  taxesAsCost: Decimal;
  /** Gastos operativos externos a Mercado Libre. */
  operatingExpenses: Decimal;
  otherCharges: Decimal;
}

export interface PeriodResult {
  /** Facturación bruta. */
  grossRevenue: Decimal;
  /** Facturación neta comercial = bruta − cancelaciones − devoluciones − descuentos propios. */
  netCommercialRevenue: Decimal;
  /** Margen bruto = neta comercial − costo de mercadería. */
  grossMargin: Decimal;
  grossMarginPct: Decimal;
  /** Margen de contribución = bruto − costos ML − logística − financiación − publicidad. */
  contributionMargin: Decimal;
  contributionMarginPct: Decimal;
  /** Resultado operativo = contribución − gastos operativos. */
  operatingResult: Decimal;
  operatingMarginPct: Decimal;
  totalMeliCosts: Decimal;
}

// -----------------------------------------------------------------------------
// Costeo de inventario
// -----------------------------------------------------------------------------

export interface CostingState {
  stock: Decimal;
  averageCost: Decimal;
  stockValue: Decimal;
}

export interface CostingTransition extends CostingState {
  before: CostingState;
}

// -----------------------------------------------------------------------------
// Caja: disponible seguro, reservas y recomendación diaria
// -----------------------------------------------------------------------------

export interface ReserveInput {
  id: string;
  name: string;
  type: "INVENTORY_REPLACEMENT" | "TAX" | "OBLIGATION" | "SAFETY_BUFFER" | "CUSTOM";
  targetAmount: Decimal;
  currentAmount: Decimal;
  priority: number;
}

export interface ObligationInput {
  id: string;
  description: string;
  amount: Decimal;
  reservedAmount: Decimal;
  paidAmount: Decimal;
  dueDate: Date;
  priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
}

export interface SafeCashInput {
  /** Saldo conciliado disponible (nunca un "saldo API en vivo"). */
  availableBalance: Decimal;
  /** Fondo de reposición de la mercadería ya vendida y aún no repuesta. */
  inventoryReplacementFund: Decimal;
  /** Reservas activas del usuario. */
  reserves: ReserveInput[];
  /** Obligaciones dentro del horizonte considerado "próximo". */
  upcomingObligations: ObligationInput[];
  /** Gastos ya comprometidos (compras a pagar, gastos recurrentes del período). */
  committedExpenses: Decimal;
  /** Colchón mínimo configurado. */
  safetyBuffer: Decimal;
}

export interface SafeCashResult {
  availableBalance: Decimal;
  inventoryReplacementFund: Decimal;
  reservesTotal: Decimal;
  upcomingObligationsUncovered: Decimal;
  committedExpenses: Decimal;
  safetyBuffer: Decimal;
  /** Disponible seguro hoy: lo que se puede gastar sin poner en riesgo el negocio. */
  safeAvailable: Decimal;
  /** Presupuesto sugerido para comprar mercadería hoy. */
  recommendedInventoryBudget: Decimal;
  breakdown: TracedAmount[];
}

export type ProjectionConfidence = "ALTA" | "MEDIA" | "BAJA";

export interface DailyReserveInput {
  obligation: ObligationInput;
  today: Date;
  /** Contribución diaria promedio de los últimos días (margen, no facturación). */
  averageDailyContribution: Decimal;
  /** Cuántos días de historia respaldan ese promedio. */
  historyDays: number;
  /** Desvío estándar de la contribución diaria: mide la volatilidad. */
  contributionStdDev: Decimal;
  /** Dinero que ya se va a liberar antes del vencimiento. */
  pendingReleaseBeforeDue: Decimal;
  /** Obligaciones que vencen ANTES que ésta y todavía no están cubiertas. */
  earlierObligationsUncovered: Decimal;
  /** Costo de reposición esperado hasta el vencimiento. */
  expectedInventoryCost: Decimal;
  /** Otros egresos previstos hasta el vencimiento. */
  expectedExpenses: Decimal;
  /** Colchón mínimo a preservar. */
  safetyBuffer: Decimal;
}

export interface DailyReserveResult {
  /** Cuánto falta reservar para esta obligación. */
  remainingAmount: Decimal;
  daysRemaining: number;
  /** Recomendación: cuánto separar por día. */
  dailyAmount: Decimal;
  /** Reparto ingenuo (deuda / días), sólo para comparar y explicar. */
  naiveDailyAmount: Decimal;
  /** Capacidad diaria estimada de generación de caja. */
  dailyCapacity: Decimal;
  /** true si la recomendación supera la capacidad: no alcanza con el ritmo actual. */
  exceedsCapacity: boolean;
  confidence: ProjectionConfidence;
  explanation: string[];
  isOverdue: boolean;
}

// -----------------------------------------------------------------------------
// Cashflow y proyección
// -----------------------------------------------------------------------------

export type CashflowKind = "REAL" | "SCHEDULED" | "ESTIMATED" | "FORECAST";

export interface CashflowMovement {
  date: Date;
  direction: "IN" | "OUT";
  kind: CashflowKind;
  category: string;
  amount: Decimal;
  description?: string;
}

export interface CashflowWeek {
  label: string;
  from: Date;
  to: Date;
  openingBalance: Decimal;
  realIncome: Decimal;
  projectedIncome: Decimal;
  inventoryPurchases: Decimal;
  meliCharges: Decimal;
  ads: Decimal;
  taxes: Decimal;
  expenses: Decimal;
  obligations: Decimal;
  closingBalance: Decimal;
  /** Composición por tipo, para el sombreado Real / Estimado / Programado. */
  kinds: Record<CashflowKind, Decimal>;
  /** true si el saldo proyectado de cierre queda por debajo del colchón. */
  belowSafetyBuffer: boolean;
}

export interface SalesForecastPoint {
  date: Date;
  /** Facturación proyectada. */
  revenue: Decimal;
  /** Contribución proyectada (facturación × margen histórico). */
  contribution: Decimal;
}

export interface SalesForecast {
  scenario: "CONSERVATIVE" | "BASE" | "OPTIMISTIC";
  points: SalesForecastPoint[];
  averageDailyRevenue: Decimal;
  marginRate: Decimal;
  confidence: ProjectionConfidence;
  model: string;
  assumptions: string[];
}
