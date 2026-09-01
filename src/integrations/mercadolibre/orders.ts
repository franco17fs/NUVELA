import "server-only";
import { MercadoLibreClient, paginate } from "./client";
import {
  orderDiscountsSchema,
  orderSchema,
  orderSearchSchema,
  type MlOrder,
} from "./schemas";

/**
 * Recurso de órdenes — FUENTE PRIMARIA de ventas.
 * Referencia verificada: docs/mercadolibre-api-research.md §2.
 *
 * Límite duro a tener presente: Mercado Libre conserva las órdenes de los
 * ÚLTIMOS 12 MESES. La importación histórica no puede ir más atrás, y el sistema
 * lo declara en vez de simular que trajo todo.
 */

/** Techo real del histórico disponible por API. */
export const ORDERS_HISTORY_MONTHS = 12;

export interface OrderSearchParams {
  sellerId: string | number | bigint;
  /** Filtra por fecha de creación. */
  dateCreatedFrom?: Date;
  dateCreatedTo?: Date;
  /** Filtra por última modificación: es lo que usa la sincronización incremental. */
  dateLastUpdatedFrom?: Date;
  dateLastUpdatedTo?: Date;
  /** Varios estados separados por coma. */
  status?: string;
  sort?: "date_asc" | "date_desc";
}

/**
 * Busca órdenes del vendedor.
 *
 * Detalle documentado que importa: los filtros de fecha usan hasta la HORA y
 * descartan minutos y segundos. Por eso las marcas de agua de la sincronización
 * se redondean hacia atrás a la hora en punto: si se mandara un minuto exacto,
 * Mercado Libre lo ignoraría y podríamos creer que cubrimos una ventana que en
 * realidad quedó corta.
 */
export async function* searchOrders(
  client: MercadoLibreClient,
  params: OrderSearchParams,
  options: { limit?: number; maxItems?: number } = {},
): AsyncGenerator<MlOrder[], void, undefined> {
  const query: Record<string, string | number | undefined> = {
    seller: String(params.sellerId),
    sort: params.sort ?? "date_asc",
    "order.status": params.status,
    "order.date_created.from": toHourPrecision(params.dateCreatedFrom),
    "order.date_created.to": toHourPrecision(params.dateCreatedTo),
    "order.date_last_updated.from": toHourPrecision(params.dateLastUpdatedFrom),
    "order.date_last_updated.to": toHourPrecision(params.dateLastUpdatedTo),
  };

  yield* paginate<MlOrder>(
    async (offset, limit) => {
      const raw = await client.get<unknown>("/orders/search", { ...query, offset, limit });
      return orderSearchSchema.parse(raw);
    },
    options,
  );
}

export async function fetchOrder(client: MercadoLibreClient, orderId: string): Promise<MlOrder> {
  const raw = await client.get<unknown>(`/orders/${orderId}`);
  return orderSchema.parse(raw);
}

/**
 * Descuentos de la orden.
 *
 * Sólo la porción `seller` reduce nuestra facturación: el descuento financiado
 * por Mercado Libre no sale de nuestro bolsillo. La documentación aclara que
 * este recurso incluye únicamente descuentos sobre el precio (más cupones y
 * cashbacks), sin cargos adicionales ni devoluciones posteriores.
 */
export async function fetchOrderDiscounts(
  client: MercadoLibreClient,
  orderId: string,
): Promise<{ itemId: string | null; sellerAmount: string | null; total: string | null }[]> {
  try {
    const raw = await client.get<unknown>(`/orders/${orderId}/discounts`);
    const parsed = orderDiscountsSchema.parse(raw);
    return parsed.details.map((detail) => ({
      itemId: detail.item_id,
      sellerAmount: detail.seller,
      total: detail.total,
    }));
  } catch {
    // Una orden sin descuentos puede responder 404. No es un error de negocio:
    // significa que no hubo descuentos.
    return [];
  }
}

/**
 * Redondea hacia atrás a la hora en punto y formatea como espera la API.
 * Redondear hacia atrás (y no hacia adelante) garantiza que la ventana no deje
 * huecos, a costa de reprocesar como mucho una hora de órdenes — reprocesar es
 * inocuo porque la escritura es idempotente.
 */
export function toHourPrecision(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  const truncated = new Date(date);
  truncated.setUTCMinutes(0, 0, 0);
  return truncated.toISOString().replace(/\.\d{3}Z$/, ".000-00:00");
}
