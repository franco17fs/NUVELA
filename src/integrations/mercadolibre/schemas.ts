import { z } from "zod";

/**
 * Esquemas de las respuestas de Mercado Libre.
 *
 * Se validan con Zod en el borde, antes de tocar la base. Dos razones:
 *
 *  1. La API cambia. Si un campo desaparece o cambia de tipo, queremos un error
 *     claro en la sincronización y no un `undefined` que se propague hasta el
 *     dashboard convertido en cero.
 *  2. Los importes llegan como `number` en JSON. Se los pasa a `string` acá
 *     mismo (`numericToString`) para que el resto del sistema los maneje como
 *     Decimal y nunca como punto flotante.
 *
 * Todos los esquemas son permisivos con campos desconocidos (Zod los ignora por
 * defecto): agregar un campo del lado de Mercado Libre no rompe la sincronización.
 */

/** Convierte un número o string de la API en string, para construir un Decimal. */
const numericToString = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    return typeof value === "number" ? value.toString() : value;
  });

const nullableString = z.string().nullish().transform((value) => value ?? null);

// -----------------------------------------------------------------------------
// Órdenes
// -----------------------------------------------------------------------------

export const orderItemSchema = z.object({
  item: z.object({
    id: z.string(),
    title: z.string().default(""),
    category_id: nullableString,
    variation_id: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? null : String(v))),
    seller_sku: nullableString,
    seller_custom_field: nullableString,
    condition: nullableString,
  }),
  quantity: z.number(),
  unit_price: numericToString,
  /** Monto original por todas las unidades, sin descuentos. */
  full_unit_price: numericToString,
  gross_price: numericToString,
  /** Comisión REAL cobrada por Mercado Libre. */
  sale_fee: numericToString,
  listing_type_id: nullableString,
  currency_id: nullableString,
});

export const orderPaymentSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: nullableString,
  status_detail: nullableString,
  transaction_amount: numericToString,
  total_paid_amount: numericToString,
  taxes_amount: numericToString,
  shipping_cost: numericToString,
  coupon_amount: numericToString,
  overpaid_amount: numericToString,
  marketplace_fee: numericToString,
  installments: z.number().nullish().transform((v) => v ?? null),
  installment_amount: numericToString,
  payment_type: nullableString,
  payment_method_id: nullableString,
  operation_type: nullableString,
  currency_id: nullableString,
  date_created: nullableString,
  date_approved: nullableString,
  date_last_modified: nullableString,
});

export const orderSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: nullableString,
  status_detail: nullableString,
  date_created: z.string(),
  date_closed: nullableString,
  date_last_updated: z.string(),
  last_updated: nullableString,
  currency_id: z.string().default("ARS"),
  total_amount: numericToString,
  paid_amount: numericToString,
  shipping_cost: numericToString,
  pack_id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))),
  tags: z.array(z.string()).default([]),
  coupon: z.object({ amount: numericToString, id: nullableString }).nullish(),
  taxes: z.object({ amount: numericToString, currency_id: nullableString }).nullish(),
  buyer: z.object({ id: z.union([z.number(), z.string()]).transform((v) => String(v)) }).nullish(),
  seller: z.object({ id: z.union([z.number(), z.string()]).transform((v) => String(v)) }).nullish(),
  shipping: z
    .object({ id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))) })
    .nullish(),
  order_items: z.array(orderItemSchema).default([]),
  payments: z.array(orderPaymentSchema).default([]),
  cancel_detail: z
    .object({ group: nullableString, code: nullableString, description: nullableString })
    .nullish(),
  mediations: z.array(z.unknown()).default([]),
});

export type MlOrder = z.infer<typeof orderSchema>;
export type MlOrderItem = z.infer<typeof orderItemSchema>;
export type MlOrderPayment = z.infer<typeof orderPaymentSchema>;

export const orderSearchSchema = z.object({
  results: z.array(orderSchema).default([]),
  paging: z
    .object({ total: z.number(), offset: z.number(), limit: z.number() })
    .default({ total: 0, offset: 0, limit: 50 }),
});

// -----------------------------------------------------------------------------
// Descuentos de la orden
// -----------------------------------------------------------------------------

export const orderDiscountsSchema = z.object({
  details: z
    .array(
      z.object({
        item_id: nullableString,
        /** Porción del descuento asociada al ítem (precio × cantidad). */
        total: numericToString,
        /** Porción a cargo del VENDEDOR: es la única que reduce nuestra facturación. */
        seller: numericToString,
        meli: numericToString,
        type: nullableString,
        funding_mode: nullableString,
      }),
    )
    .default([]),
});

// -----------------------------------------------------------------------------
// Envíos
// -----------------------------------------------------------------------------

const shipmentDiscountSchema = z.object({
  rate: z.number().nullish(),
  type: nullableString,
  promoted_amount: numericToString,
});

export const shipmentCostsSchema = z.object({
  gross_amount: numericToString,
  receiver: z
    .object({
      user_id: z.number().nullish(),
      cost: numericToString,
      compensation: numericToString,
      discounts: z.array(shipmentDiscountSchema).default([]),
    })
    .nullish(),
  senders: z
    .array(
      z.object({
        user_id: z.number().nullish(),
        cost: numericToString,
        compensation: numericToString,
        discounts: z.array(shipmentDiscountSchema).default([]),
      }),
    )
    .default([]),
});

export const shipmentSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: nullableString,
  substatus: nullableString,
  mode: nullableString,
  logistic_type: nullableString,
  date_created: nullableString,
  order_id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))),
  // El peso facturable aparece en distintos lugares según el tipo logístico.
  shipping_option: z
    .object({
      cost: numericToString,
      list_cost: numericToString,
      name: nullableString,
    })
    .nullish(),
});

// -----------------------------------------------------------------------------
// listing_prices (simulación de costos)
// -----------------------------------------------------------------------------

export const listingPriceSchema = z.object({
  currency_id: z.string(),
  listing_type_id: z.string(),
  listing_type_name: nullableString,
  listing_exposure: nullableString,
  listing_fee_amount: numericToString,
  listing_fee_details: z
    .object({ fixed_fee: numericToString, gross_amount: numericToString })
    .nullish(),
  requires_picture: z.boolean().nullish(),
  sale_fee_amount: numericToString,
  sale_fee_details: z
    .object({
      /** Adicional por financiación (cuotas). */
      financing_add_on_fee: numericToString,
      /** Cargo fijo por unidad vendida. */
      fixed_fee: numericToString,
      gross_amount: numericToString,
      meli_percentage_fee: numericToString,
      percentage_fee: numericToString,
    })
    .nullish(),
  stop_time: nullableString,
});

export const listingPricesResponseSchema = z.array(listingPriceSchema);

export type MlListingPrice = z.infer<typeof listingPriceSchema>;

// -----------------------------------------------------------------------------
// Publicidad (Product Ads) — api-version: 2
// -----------------------------------------------------------------------------

export const advertisersSchema = z.object({
  advertisers: z
    .array(
      z.object({
        advertiser_id: z.union([z.number(), z.string()]).transform((v) => String(v)),
        site_id: nullableString,
        advertiser_name: nullableString,
        account_name: nullableString,
      }),
    )
    .default([]),
});

const adMetricsSchema = z.object({
  clicks: z.number().nullish(),
  prints: z.number().nullish(),
  ctr: z.number().nullish(),
  cost: numericToString,
  cpc: numericToString,
  acos: z.number().nullish(),
  cvr: z.number().nullish(),
  roas: z.number().nullish(),
  organic_units_quantity: z.number().nullish(),
  organic_units_amount: numericToString,
  direct_units_quantity: z.number().nullish(),
  indirect_units_quantity: z.number().nullish(),
  units_quantity: z.number().nullish(),
  direct_amount: numericToString,
  indirect_amount: numericToString,
  total_amount: numericToString,
});

/** Métrica de un día concreto cuando se pide `aggregation_type=DAILY`. */
export const adDailyMetricSchema = adMetricsSchema.extend({
  date: z.string(),
});

export const adCampaignSchema = adMetricsSchema.extend({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  name: z.string().default(""),
  status: nullableString,
  budget: numericToString,
  acos_target: z.number().nullish(),
  strategy: nullableString,
  channel: nullableString,
  date_created: nullableString,
  metrics: z.array(adDailyMetricSchema).nullish(),
});

export const adCampaignsResponseSchema = z.object({
  results: z.array(adCampaignSchema).default([]),
  paging: z
    .object({ total: z.number(), offset: z.number(), limit: z.number() })
    .default({ total: 0, offset: 0, limit: 50 }),
});

export const adItemSchema = adMetricsSchema.extend({
  id: z.string(),
  title: nullableString,
  status: nullableString,
  campaign_id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))),
  metrics: z.array(adDailyMetricSchema).nullish(),
});

export const adItemsResponseSchema = z.object({
  results: z.array(adItemSchema).default([]),
  paging: z
    .object({ total: z.number(), offset: z.number(), limit: z.number() })
    .default({ total: 0, offset: 0, limit: 50 }),
});

// -----------------------------------------------------------------------------
// Facturación
// -----------------------------------------------------------------------------

export const billingPeriodsSchema = z.object({
  results: z
    .array(
      z.object({
        key: z.string(),
        group: nullableString,
        date_from: nullableString,
        date_to: nullableString,
        due_date: nullableString,
        status: nullableString,
        amount: numericToString,
        currency_id: nullableString,
      }),
    )
    .default([]),
  paging: z
    .object({ total: z.number(), offset: z.number(), limit: z.number() })
    .default({ total: 0, offset: 0, limit: 50 }),
});

export const billingDocumentsSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]).transform((v) => String(v)),
        document_type: nullableString,
        document_number: nullableString,
        date_issued: nullableString,
        due_date: nullableString,
        amount: numericToString,
        currency_id: nullableString,
        status: nullableString,
      }),
    )
    .default([]),
  paging: z
    .object({ total: z.number(), offset: z.number(), limit: z.number() })
    .default({ total: 0, offset: 0, limit: 50 }),
});

// -----------------------------------------------------------------------------
// Notificaciones
// -----------------------------------------------------------------------------

export const webhookNotificationSchema = z.object({
  resource: z.string(),
  user_id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))),
  topic: z.string(),
  application_id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))),
  attempts: z.number().nullish(),
  sent: z.string().nullish(),
  received: z.string().nullish(),
});

export type MlWebhookNotification = z.infer<typeof webhookNotificationSchema>;

export const missedFeedsSchema = z.object({
  messages: z
    .array(
      z.object({
        resource: z.string(),
        user_id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))),
        topic: z.string(),
        application_id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))),
        attempts: z.number().nullish(),
        sent: z.string().nullish(),
        received: z.string().nullish(),
      }),
    )
    .default([]),
});
