import { money, percentage, sumBy, ZERO, type Decimal } from "@/lib/money";
import type {
  OrderFeeInput,
  OrderProfitabilityInput,
  OrderProfitabilityResult,
  TaxTreatment,
  ValueKind,
  WaterfallStep,
} from "./types";

/**
 * Rentabilidad de una venta.
 *
 * Esta función responde la pregunta del §28 del brief: abrir una orden y ver el
 * waterfall completo, con cada escalón marcado como REAL o ESTIMADO.
 *
 * ## Convenciones de ingresos (documentadas también en docs/financial-model.md)
 *
 * - `unitPrice × quantity` es la **facturación bruta** de la línea: el importe
 *   efectivamente cobrado por el ítem, que es lo que Mercado Libre informa en
 *   `order_items[].unit_price`.
 * - `sellerDiscount` es **sólo** la porción de cupones y cashbacks financiada por
 *   el vendedor, tal como la devuelve `GET /orders/{id}/discounts → seller`.
 *   No se resta el descuento financiado por Mercado Libre, porque ese no sale de
 *   nuestro bolsillo. La capa de sincronización es la responsable de no volcar
 *   acá un descuento que ya venga incorporado en `unit_price`, para no
 *   descontarlo dos veces.
 * - `gross_price` (precio de lista sin descuentos) se guarda como dato de
 *   contexto pero no entra en la facturación: facturamos lo que cobramos.
 *
 * ## Impuestos
 *
 * Una retención NO es automáticamente una pérdida (§9 y §51 del brief). Sólo se
 * descuenta del resultado si el perfil fiscal de la cuenta dice que su
 * tratamiento es `COST`. Si es `FISCAL_CREDIT` es un activo a recuperar, y si es
 * `CASH_MOVEMENT_ONLY` afecta la caja pero no el resultado. En todos los casos el
 * importe se informa aparte para que sea visible.
 */
export function calculateOrderProfitability(
  input: OrderProfitabilityInput,
): OrderProfitabilityResult {
  const estimatedComponents: string[] = [];

  const noteEstimate = (label: string, kind: ValueKind) => {
    if (kind !== "ACTUAL" && !estimatedComponents.includes(label)) {
      estimatedComponents.push(label);
    }
  };

  // --- Ingresos -------------------------------------------------------------
  const grossRevenue = sumBy(input.items, (item) =>
    money(item.unitPrice).times(item.quantity),
  );
  const sellerDiscounts = sumBy(input.items, (item) => item.sellerDiscount);
  const refunds = money(input.refundedAmount);
  const netRevenue = grossRevenue.minus(sellerDiscounts).minus(refunds);

  // --- Costo de mercadería --------------------------------------------------
  // Se usa el COGS congelado al procesar la venta. Si falta, vale cero y se
  // marca como estimado: es preferible un margen visiblemente incompleto a un
  // margen inventado con el costo actual del SKU.
  const cogs = sumBy(input.items, (item) => resolveItemCogs(item));
  const missingCogs = input.items.some(
    (item) => item.cogsTotal == null && item.cogsUnitCost == null,
  );
  if (missingCogs) {
    estimatedComponents.push("Costo de mercadería (sin costo cargado)");
  }

  // --- Cargos ---------------------------------------------------------------
  const feeTotals = groupFees(input.fees, noteEstimate);

  // La comisión puede venir de la línea (`sale_fee` real) o de una línea de cargo
  // normalizada. Si vino por línea, se prioriza porque es el dato de Mercado Libre.
  const itemSaleFees = sumBy(input.items, (item) =>
    item.saleFee == null ? ZERO : money(item.saleFee).times(item.quantity),
  );
  for (const item of input.items) {
    if (item.saleFee != null) noteEstimate("Comisión", item.saleFeeKind);
  }
  const meliFees = itemSaleFees.isZero() ? feeTotals.SALE_FEE : itemSaleFees;

  const taxesWithheld = feeTotals.TAX_WITHHELD;
  const taxesAsCost = taxesAffectResult(input.taxTreatment) ? taxesWithheld : ZERO;

  const otherCharges = feeTotals.OTHER.plus(feeTotals.RETURN_COST).plus(
    // marketplace_fee sólo se suma si NO tenemos la comisión por línea: en las
    // órdenes normales ambos representan el mismo cargo y sumarlos lo duplicaría.
    itemSaleFees.isZero() ? ZERO : feeTotals.MARKETPLACE_FEE,
  );

  const grossMargin = netRevenue.minus(cogs);
  const contributionMargin = grossMargin
    .minus(meliFees)
    .minus(feeTotals.FIXED_FEE)
    .minus(feeTotals.FINANCING_FEE)
    .minus(feeTotals.SHIPPING_FEE)
    .minus(feeTotals.ADS_ATTRIBUTED)
    .minus(taxesAsCost)
    .minus(otherCharges);

  const waterfall = buildWaterfall({
    grossRevenue,
    sellerDiscounts,
    refunds,
    netRevenue,
    cogs,
    meliFees,
    fixedFees: feeTotals.FIXED_FEE,
    financingFees: feeTotals.FINANCING_FEE,
    shippingCost: feeTotals.SHIPPING_FEE,
    adsAttributed: feeTotals.ADS_ATTRIBUTED,
    taxesWithheld,
    taxesAsCost,
    taxTreatment: input.taxTreatment,
    otherCharges,
    grossMargin,
    contributionMargin,
    fees: input.fees,
    saleFeeKind: resolveSaleFeeKind(input),
    cogsKind: missingCogs ? "ESTIMATED" : "ACTUAL",
  });

  return {
    orderId: input.orderId,
    currencyId: input.currencyId,
    grossRevenue,
    sellerDiscounts,
    refunds,
    netRevenue,
    cogs,
    meliFees,
    fixedFees: feeTotals.FIXED_FEE,
    financingFees: feeTotals.FINANCING_FEE,
    shippingCost: feeTotals.SHIPPING_FEE,
    adsAttributed: feeTotals.ADS_ATTRIBUTED,
    taxesWithheld,
    taxesAsCost,
    otherCharges,
    grossMargin,
    contributionMargin,
    marginPct: percentage(contributionMargin, netRevenue),
    hasEstimates: estimatedComponents.length > 0,
    estimatedComponents,
    waterfall,
  };
}

function resolveItemCogs(item: OrderProfitabilityInput["items"][number]): Decimal {
  if (item.cogsTotal != null) return money(item.cogsTotal);
  if (item.cogsUnitCost != null) return money(item.cogsUnitCost).times(item.quantity);
  return ZERO;
}

function resolveSaleFeeKind(input: OrderProfitabilityInput): ValueKind {
  const withFee = input.items.filter((item) => item.saleFee != null);
  if (withFee.length === 0) {
    const feeLine = input.fees.find((fee) => fee.type === "SALE_FEE");
    return feeLine?.kind ?? "ESTIMATED";
  }
  return withFee.some((item) => item.saleFeeKind !== "ACTUAL") ? "ESTIMATED" : "ACTUAL";
}

type FeeTotals = Record<OrderFeeInput["type"], Decimal>;

function groupFees(
  fees: OrderFeeInput[],
  noteEstimate: (label: string, kind: ValueKind) => void,
): FeeTotals {
  const totals: FeeTotals = {
    SALE_FEE: ZERO,
    FIXED_FEE: ZERO,
    FINANCING_FEE: ZERO,
    SHIPPING_FEE: ZERO,
    MARKETPLACE_FEE: ZERO,
    ADS_ATTRIBUTED: ZERO,
    TAX_WITHHELD: ZERO,
    RETURN_COST: ZERO,
    OTHER: ZERO,
  };

  for (const fee of fees) {
    totals[fee.type] = totals[fee.type].plus(money(fee.amount));
    noteEstimate(FEE_LABELS[fee.type], fee.kind);
  }

  return totals;
}

const FEE_LABELS: Record<OrderFeeInput["type"], string> = {
  SALE_FEE: "Comisión",
  FIXED_FEE: "Cargo fijo",
  FINANCING_FEE: "Financiación",
  SHIPPING_FEE: "Envío",
  MARKETPLACE_FEE: "Cargo de marketplace",
  ADS_ATTRIBUTED: "Publicidad atribuida",
  TAX_WITHHELD: "Impuestos / retenciones",
  RETURN_COST: "Costo de devolución",
  OTHER: "Otros cargos",
};

/** Sólo el tratamiento `COST` convierte una retención en pérdida del período. */
export function taxesAffectResult(treatment: TaxTreatment): boolean {
  return treatment === "COST";
}

interface WaterfallParams {
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
  taxesAsCost: Decimal;
  taxTreatment: TaxTreatment;
  otherCharges: Decimal;
  grossMargin: Decimal;
  contributionMargin: Decimal;
  fees: OrderFeeInput[];
  saleFeeKind: ValueKind;
  cogsKind: ValueKind;
}

function buildWaterfall(p: WaterfallParams): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let running = ZERO;

  const push = (
    label: string,
    amount: Decimal,
    effect: WaterfallStep["effect"],
    kind: ValueKind,
    source: WaterfallStep["source"],
    note?: string,
  ) => {
    if (effect === "SUBTOTAL") {
      running = amount;
    } else if (effect === "POSITIVE") {
      running = running.plus(amount);
    } else {
      running = running.minus(amount);
    }
    steps.push({ label, amount, effect, kind, source, runningTotal: running, note });
  };

  const kindOf = (type: OrderFeeInput["type"], fallback: ValueKind = "ACTUAL"): ValueKind => {
    const line = p.fees.find((fee) => fee.type === type);
    return line?.kind ?? fallback;
  };
  const sourceOf = (
    type: OrderFeeInput["type"],
    fallback: WaterfallStep["source"] = "MELI_API",
  ): WaterfallStep["source"] => {
    const line = p.fees.find((fee) => fee.type === type);
    return line?.source ?? fallback;
  };

  push("Precio producto", p.grossRevenue, "POSITIVE", "ACTUAL", "MELI_API");

  if (!p.sellerDiscounts.isZero()) {
    push("Descuento vendedor", p.sellerDiscounts, "NEGATIVE", "ACTUAL", "MELI_API");
  }
  if (!p.refunds.isZero()) {
    push("Devoluciones", p.refunds, "NEGATIVE", "ACTUAL", "MELI_API");
  }

  push("Facturación neta comercial", p.netRevenue, "SUBTOTAL", "ACTUAL", "CALCULATED");

  push(
    "Costo producto",
    p.cogs,
    "NEGATIVE",
    p.cogsKind,
    "MANUAL",
    p.cogsKind === "ESTIMATED" ? "Falta cargar el costo del SKU" : undefined,
  );
  push("Margen bruto", p.grossMargin, "SUBTOTAL", p.cogsKind, "CALCULATED");

  push("Comisión", p.meliFees, "NEGATIVE", p.saleFeeKind, "MELI_API");
  if (!p.fixedFees.isZero()) {
    push("Cargo fijo", p.fixedFees, "NEGATIVE", kindOf("FIXED_FEE"), sourceOf("FIXED_FEE"));
  }
  if (!p.financingFees.isZero()) {
    push(
      "Financiación",
      p.financingFees,
      "NEGATIVE",
      kindOf("FINANCING_FEE"),
      sourceOf("FINANCING_FEE"),
    );
  }
  if (!p.shippingCost.isZero()) {
    push("Envío", p.shippingCost, "NEGATIVE", kindOf("SHIPPING_FEE"), sourceOf("SHIPPING_FEE"));
  }
  if (!p.adsAttributed.isZero()) {
    push(
      "Publicidad atribuida",
      p.adsAttributed,
      "NEGATIVE",
      kindOf("ADS_ATTRIBUTED"),
      sourceOf("ADS_ATTRIBUTED", "CALCULATED"),
    );
  }

  if (!p.taxesWithheld.isZero()) {
    if (taxesAffectResult(p.taxTreatment)) {
      push(
        "Impuestos (costo)",
        p.taxesAsCost,
        "NEGATIVE",
        kindOf("TAX_WITHHELD", "ESTIMATED"),
        sourceOf("TAX_WITHHELD", "MP_API"),
      );
    } else {
      // Informativo: la retención se muestra para que el usuario la vea, pero no
      // toca el acumulado porque no es una pérdida. Por eso se empuja a mano en
      // vez de usar `push`, que sí modificaría el running total.
      steps.push({
        label: "Retenciones / percepciones",
        amount: p.taxesWithheld,
        effect: "SUBTOTAL",
        kind: kindOf("TAX_WITHHELD", "ACTUAL"),
        source: sourceOf("TAX_WITHHELD", "MP_API"),
        runningTotal: running,
        note:
          p.taxTreatment === "FISCAL_CREDIT"
            ? "Crédito fiscal: afecta la caja, no el resultado"
            : "Movimiento de caja: no afecta el resultado",
      });
    }
  }

  if (!p.otherCharges.isZero()) {
    push("Otros cargos", p.otherCharges, "NEGATIVE", kindOf("OTHER"), sourceOf("OTHER"));
  }

  push(
    "Margen de contribución",
    p.contributionMargin,
    "SUBTOTAL",
    p.cogsKind === "ESTIMATED" || p.saleFeeKind === "ESTIMATED" ? "ESTIMATED" : "ACTUAL",
    "CALCULATED",
  );

  return steps;
}
