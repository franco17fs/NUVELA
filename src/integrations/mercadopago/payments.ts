import "server-only";
import { z } from "zod";
import type { MercadoPagoClient } from "./client";

/**
 * Pagos de Mercado Pago.
 * Referencia verificada: docs/mercadolibre-api-research.md §5.1.
 *
 * El campo central para el cashflow es **`money_release_date`**: cuándo el
 * dinero de esa venta pasa a estar disponible. Es lo que permite que el sistema
 * distinga VENTA de COBRO, que es el principio fundacional del proyecto.
 */

const numericToString = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => (value == null ? null : typeof value === "number" ? value.toString() : value));

const feeDetailSchema = z.object({
  type: z.string(),
  amount: numericToString,
  fee_payer: z.string().nullish(),
});

export const paymentSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: z.string().nullish(),
  status_detail: z.string().nullish(),
  operation_type: z.string().nullish(),
  payment_type_id: z.string().nullish(),
  payment_method_id: z.string().nullish(),
  currency_id: z.string().nullish(),
  transaction_amount: numericToString,
  shipping_amount: numericToString,
  taxes_amount: numericToString,
  coupon_amount: numericToString,
  installments: z.number().nullish(),
  date_created: z.string().nullish(),
  date_approved: z.string().nullish(),
  date_last_updated: z.string().nullish(),
  /** Cuándo el dinero queda disponible. */
  money_release_date: z.string().nullish(),
  fee_details: z.array(feeDetailSchema).default([]),
  transaction_details: z
    .object({
      net_received_amount: numericToString,
      total_paid_amount: numericToString,
      installment_amount: numericToString,
    })
    .nullish(),
  order: z
    .object({ id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))) })
    .nullish(),
  external_reference: z.string().nullish(),
});

export type MpPayment = z.infer<typeof paymentSchema>;

const paymentSearchSchema = z.object({
  results: z.array(paymentSchema).default([]),
  paging: z
    .object({ total: z.number(), offset: z.number(), limit: z.number() })
    .default({ total: 0, offset: 0, limit: 50 }),
});

export interface PaymentSearchParams {
  beginDate: Date;
  endDate: Date;
  /** Campo sobre el que se aplica el rango. */
  range?: "date_created" | "date_approved" | "date_last_updated" | "money_release_date";
  status?: string;
}

export async function* searchPayments(
  client: MercadoPagoClient,
  params: PaymentSearchParams,
  options: { limit?: number; maxItems?: number } = {},
): AsyncGenerator<MpPayment[], void, undefined> {
  const limit = options.limit ?? 50;
  const maxItems = options.maxItems ?? 20_000;
  let offset = 0;
  let fetched = 0;

  for (;;) {
    const raw = await client.get<unknown>("/v1/payments/search", {
      range: params.range ?? "date_created",
      begin_date: params.beginDate.toISOString(),
      end_date: params.endDate.toISOString(),
      status: params.status,
      sort: "date_created",
      criteria: "asc",
      limit,
      offset,
    });

    const page = paymentSearchSchema.parse(raw);
    if (page.results.length === 0) return;

    yield page.results;

    fetched += page.results.length;
    offset += page.results.length;

    if (fetched >= maxItems) return;
    if (page.results.length < limit) return;
    if (page.paging && offset >= page.paging.total) return;
  }
}

export async function fetchPayment(
  client: MercadoPagoClient,
  paymentId: string,
): Promise<MpPayment> {
  const raw = await client.get<unknown>(`/v1/payments/${paymentId}`);
  return paymentSchema.parse(raw);
}

/** Suma de los `fee_details` a cargo del vendedor (`collector`). */
export function sellerFees(payment: MpPayment): string {
  const total = payment.fee_details
    .filter((fee) => fee.fee_payer == null || fee.fee_payer === "collector")
    .reduce((acc, fee) => acc + Number(fee.amount ?? 0), 0);
  return total.toString();
}
