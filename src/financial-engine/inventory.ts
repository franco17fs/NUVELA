import { money, sumBy, ZERO, type Decimal } from "@/lib/money";
import type { CostingState, CostingTransition } from "./types";

/**
 * Costeo de inventario.
 *
 * Se implementa **promedio ponderado móvil** por SKU (§14 del brief), detrás de
 * una interfaz `CostingStrategy` para poder agregar FIFO más adelante sin tocar
 * a los llamadores: el motor pide `applyPurchase` / `applySale` y no sabe qué
 * método hay debajo.
 *
 * Regla histórica innegociable: el COGS se congela en el momento de procesar la
 * venta (`OrderItem.cogsUnitCost`). Cambiar el costo hoy NO reescribe el margen
 * de una venta de la semana pasada.
 */

export interface CostingStrategy {
  readonly name: "WEIGHTED_AVERAGE" | "FIFO";
  /** Ingreso de mercadería. Devuelve el estado antes y después. */
  applyPurchase(state: CostingState, quantity: Decimal, unitCost: Decimal): CostingTransition;
  /** Salida de mercadería. `unitCost` del resultado es el COGS a imputar. */
  applySale(state: CostingState, quantity: Decimal): CostingTransition & { cogsUnitCost: Decimal };
}

export const EMPTY_COSTING_STATE: CostingState = {
  stock: ZERO,
  averageCost: ZERO,
  stockValue: ZERO,
};

/**
 * Promedio ponderado móvil:
 *
 *   nuevo costo promedio = (valor stock anterior + valor compra nueva)
 *                          / (unidades anteriores + unidades nuevas)
 */
export const weightedAverageStrategy: CostingStrategy = {
  name: "WEIGHTED_AVERAGE",

  applyPurchase(state, quantity, unitCost): CostingTransition {
    const qty = money(quantity);
    const cost = money(unitCost);
    const before = snapshot(state);

    const newStock = before.stock.plus(qty);
    const newValue = before.stockValue.plus(qty.times(cost));

    // Si el stock queda en cero o negativo, el promedio pierde sentido:
    // se conserva el anterior en vez de dividir por cero o inventar un costo.
    const newAverage = newStock.greaterThan(0) ? newValue.div(newStock) : before.averageCost;

    return {
      before,
      stock: newStock,
      stockValue: newValue,
      averageCost: newAverage,
    };
  },

  applySale(state, quantity) {
    const qty = money(quantity);
    const before = snapshot(state);

    // El COGS de la venta es el promedio VIGENTE al momento de vender.
    const cogsUnitCost = before.averageCost;

    const newStock = before.stock.minus(qty);
    const newValue = before.stockValue.minus(qty.times(cogsUnitCost));

    return {
      before,
      stock: newStock,
      // El promedio no cambia al vender: sólo cambia con ingresos de mercadería.
      averageCost: before.averageCost,
      // El valor puede quedar negativo si se vendió más de lo registrado
      // (stock desincronizado). Se deja pasar y se refleja tal cual, en vez de
      // enmascararlo: es una señal de que falta cargar una compra.
      stockValue: newValue,
      cogsUnitCost,
    };
  },
};

function snapshot(state: CostingState): CostingState {
  return {
    stock: money(state.stock),
    averageCost: money(state.averageCost),
    stockValue: money(state.stockValue),
  };
}

export function getCostingStrategy(method: "WEIGHTED_AVERAGE" | "FIFO"): CostingStrategy {
  if (method === "FIFO") {
    // FIFO requiere mantener capas de compra (lotes), que el modelo de datos ya
    // soporta vía InventoryMovement. Se implementará como estrategia aparte; no
    // se cae silenciosamente al promedio, porque daría números distintos sin avisar.
    throw new Error(
      "El método FIFO todavía no está implementado. El SKU debe usar promedio ponderado móvil.",
    );
  }
  return weightedAverageStrategy;
}

// -----------------------------------------------------------------------------
// Fondo de reposición de mercadería (§15 del brief)
// -----------------------------------------------------------------------------

export interface SoldItemCost {
  skuId: string | null;
  quantity: number;
  /** COGS efectivamente imputado a la venta. */
  cogsTotal: Decimal;
}

export interface InventoryReplacementResult {
  /** Costo de la mercadería vendida en el período. */
  cogsSold: Decimal;
  /**
   * Dinero que debería reservarse para reponer ese stock.
   * Por defecto es igual al COGS, pero se ajusta por el factor de reposición
   * cuando el costo de compra subió respecto del costo con el que se vendió.
   */
  replacementFund: Decimal;
  /** Ajuste por inflación de costos entre el costo histórico y el actual. */
  inflationAdjustment: Decimal;
  itemsWithoutCost: number;
}

/**
 * Cuánto del dinero que entró NO es ganancia sino plata necesaria para recomprar
 * lo vendido.
 *
 * `replacementCostFactor` permite reponer al costo de HOY y no al costo con el
 * que se vendió: si la mercadería subió 11%, reservar el COGS histórico deja el
 * stock corto. El factor se calcula fuera (costo actual / costo histórico) y por
 * defecto es 1.
 */
export function calculateInventoryReplacementFund(
  soldItems: SoldItemCost[],
  options?: { replacementCostFactor?: Decimal },
): InventoryReplacementResult {
  const cogsSold = sumBy(soldItems, (item) => item.cogsTotal);
  const factor = options?.replacementCostFactor ?? money(1);
  const replacementFund = cogsSold.times(factor);

  return {
    cogsSold,
    replacementFund,
    inflationAdjustment: replacementFund.minus(cogsSold),
    itemsWithoutCost: soldItems.filter((item) => money(item.cogsTotal).isZero()).length,
  };
}

/**
 * Factor de reposición: cuánto más caro está hoy reponer lo que se vendió.
 * Devuelve 1 cuando no hay datos suficientes, para no distorsionar sin evidencia.
 */
export function calculateReplacementFactor(params: {
  historicalCost: Decimal;
  currentCost: Decimal;
}): Decimal {
  const historical = money(params.historicalCost);
  if (historical.isZero()) return money(1);
  return money(params.currentCost).div(historical);
}

/** Variación porcentual del costo de mercadería entre dos períodos. */
export function costVariationPct(currentAvgCost: Decimal, previousAvgCost: Decimal): Decimal {
  const previous = money(previousAvgCost);
  if (previous.isZero()) return ZERO;
  return money(currentAvgCost).minus(previous).div(previous).times(100);
}
