import "server-only";
import type { MercadoLibreClient } from "./client";
import { billingDocumentsSchema, billingPeriodsSchema } from "./schemas";

/**
 * Reportes de facturación de Mercado Libre y Mercado Pago.
 * Referencia verificada: docs/mercadolibre-api-research.md §6.
 *
 * ## Para qué se usan y para qué NO
 *
 * Estos reportes son la fuente para **conciliación fiscal y financiera**: sirven
 * para verificar que los cargos que calculamos coinciden con los que Mercado
 * Libre efectivamente facturó.
 *
 * NO son la fuente primaria de ventas (regla explícita del brief §10). Los
 * períodos se cierran con retraso; usarlos para el "cuánto vendí hoy" haría que
 * el dashboard dejara de ser casi en tiempo real.
 */

export type BillingGroup = "ML" | "MP";
export type BillingDocumentType = "BILL" | "CREDIT_NOTE";

/** La clave del período tiene formato `YYYY-MM-01`. */
export function periodKeyFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export async function fetchBillingPeriods(
  client: MercadoLibreClient,
  params: { group: BillingGroup; documentType?: BillingDocumentType; limit?: number; offset?: number },
) {
  const raw = await client.get<unknown>("/billing/integration/monthly/periods", {
    group: params.group,
    document_type: params.documentType,
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  });

  return billingPeriodsSchema.parse(raw);
}

export async function fetchBillingDocuments(
  client: MercadoLibreClient,
  params: {
    periodKey: string;
    group: BillingGroup;
    documentType?: BillingDocumentType;
    limit?: number;
    offset?: number;
  },
) {
  const raw = await client.get<unknown>(
    `/billing/integration/periods/key/${params.periodKey}/documents`,
    {
      group: params.group,
      document_type: params.documentType,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    },
  );

  return billingDocumentsSchema.parse(raw);
}

/**
 * Detalle del resumen del período.
 *
 * La forma de esta respuesta varía según el período y el grupo, así que se
 * guarda cruda en `BillingPeriod.rawPayload` y se interpreta al conciliar, en
 * lugar de forzar un esquema rígido que rompería la sincronización cada vez que
 * Mercado Libre agregue un concepto.
 */
export async function fetchBillingSummaryDetails(
  client: MercadoLibreClient,
  periodKey: string,
): Promise<unknown> {
  return client.get<unknown>(`/billing/integration/periods/key/${periodKey}/summary/details`);
}
