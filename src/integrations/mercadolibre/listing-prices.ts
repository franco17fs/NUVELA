import "server-only";
import { getEnv } from "@/lib/env";
import { money, type Decimal } from "@/lib/money";
import type { MercadoLibreClient } from "./client";
import { listingPricesResponseSchema, type MlListingPrice } from "./schemas";

/**
 * `listing_prices` — SIMULACIÓN de costos de venta.
 * Referencia verificada: docs/mercadolibre-api-research.md §4.
 *
 * ## Regla dura del proyecto
 *
 * Este recurso se usa para **simular, proyectar, validar y alertar**. NUNCA para
 * reemplazar un costo real conocido.
 *
 * Para una venta que ya ocurrió, la comisión sale de `order_items[].sale_fee`
 * (el cargo efectivamente aplicado). `listing_prices` sólo entra si ese dato no
 * existe, y en ese caso el importe queda marcado como `ESTIMATED` y así se
 * muestra en la interfaz.
 */

export interface ListingPriceQuery {
  price: Decimal | string | number;
  categoryId?: string;
  listingTypeId?: string;
  /** drop_off, cross_docking, xd_drop_off, self_service, turbo, fulfillment, default… */
  logisticType?: string;
  /** me1, me2, custom, not_specified */
  shippingMode?: string;
  /** Peso facturable en gramos. */
  billableWeight?: number;
  quantity?: number;
  /** Etiquetas de campaña: `ahora-3`, `supermarket_eligible`, … */
  tags?: string;
  currencyId?: string;
  siteId?: string;
}

export interface SimulatedFees {
  listingTypeId: string;
  listingTypeName: string | null;
  /** Comisión total simulada. */
  saleFeeAmount: Decimal;
  /** Porcentaje total aplicado. */
  percentageFee: Decimal;
  /** Porción porcentual propia de Mercado Libre. */
  meliPercentageFee: Decimal;
  /** Cargo fijo por unidad. */
  fixedFee: Decimal;
  /** Adicional por financiación en cuotas. */
  financingAddOnFee: Decimal;
  listingFeeAmount: Decimal;
  /** Siempre ESTIMADO: es una simulación, no un cargo cobrado. */
  kind: "ESTIMATED";
}

export async function fetchListingPrices(
  client: MercadoLibreClient,
  query: ListingPriceQuery,
): Promise<SimulatedFees[]> {
  const siteId = query.siteId ?? getEnv().ML_SITE_ID;

  const raw = await client.get<unknown>(`/sites/${siteId}/listing_prices`, {
    price: money(query.price).toString(),
    currency_id: query.currencyId ?? "ARS",
    category_id: query.categoryId,
    listing_type_id: query.listingTypeId,
    logistic_type: query.logisticType,
    shipping_mode: query.shippingMode,
    billable_weight: query.billableWeight,
    quantity: query.quantity,
    tags: query.tags,
  });

  return listingPricesResponseSchema.parse(raw).map(toSimulatedFees);
}

function toSimulatedFees(entry: MlListingPrice): SimulatedFees {
  const details = entry.sale_fee_details;
  return {
    listingTypeId: entry.listing_type_id,
    listingTypeName: entry.listing_type_name,
    saleFeeAmount: money(entry.sale_fee_amount),
    percentageFee: money(details?.percentage_fee),
    meliPercentageFee: money(details?.meli_percentage_fee),
    fixedFee: money(details?.fixed_fee),
    financingAddOnFee: money(details?.financing_add_on_fee),
    listingFeeAmount: money(entry.listing_fee_amount),
    kind: "ESTIMATED",
  };
}

/**
 * Simula el margen de un producto a un precio dado.
 *
 * Es lo que alimenta las alertas de margen y el análisis de productos nuevos:
 * responde "si vendo esto a $X, ¿cuánto me queda?" sin necesidad de vender.
 */
export interface MarginSimulation {
  price: Decimal;
  fees: SimulatedFees;
  cogs: Decimal;
  shippingCost: Decimal;
  estimatedMargin: Decimal;
  estimatedMarginPct: Decimal;
}

export function simulateMargin(params: {
  price: Decimal | string | number;
  fees: SimulatedFees;
  cogs: Decimal | string | number;
  shippingCost?: Decimal | string | number;
}): MarginSimulation {
  const price = money(params.price);
  const cogs = money(params.cogs);
  const shippingCost = money(params.shippingCost ?? 0);

  const estimatedMargin = price.minus(params.fees.saleFeeAmount).minus(cogs).minus(shippingCost);

  return {
    price,
    fees: params.fees,
    cogs,
    shippingCost,
    estimatedMargin,
    estimatedMarginPct: price.isZero() ? money(0) : estimatedMargin.div(price).times(100),
  };
}
