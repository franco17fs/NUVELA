import "server-only";
import { z } from "zod";
import type { MercadoLibreClient } from "./client";
import { shipmentCostsSchema, shipmentSchema } from "./schemas";

/**
 * Recurso de envíos.
 * Referencia verificada: docs/mercadolibre-api-research.md §2.6.
 *
 * El dato que importa financieramente es `senders[].cost`: el costo final que
 * paga el VENDEDOR. `gross_amount` es el costo sin descuentos y
 * `receiver.cost` es lo que paga el comprador; ninguno de los dos es nuestro
 * costo.
 *
 * `save` NO se lee: dejó de actualizarse en octubre de 2024 y fue eliminado del
 * recurso en enero de 2025.
 */

/** Los recursos de costos y pagos requieren este header. */
const NEW_FORMAT_HEADER = { "x-format-new": "true" };

export interface ShipmentCostBreakdown {
  grossAmount: string | null;
  /** Costo a cargo del vendedor: el que impacta el P&L. */
  senderCost: string | null;
  receiverCost: string | null;
  /** Bonificaciones aplicadas (envío gratis obligatorio, nivel del comprador…). */
  discounts: { type: string | null; rate: number | null; promotedAmount: string | null }[];
  discountsTotal: string;
}

export async function fetchShipmentCosts(
  client: MercadoLibreClient,
  shipmentId: string,
  sellerMlUserId?: string,
): Promise<ShipmentCostBreakdown | null> {
  const raw = await client
    .get<unknown>(`/shipments/${shipmentId}/costs`, {}, NEW_FORMAT_HEADER)
    .catch(() => null);

  if (raw === null) return null;

  const parsed = shipmentCostsSchema.parse(raw);

  // `senders` es una lista pensada para carritos multi-vendedor. Si sabemos
  // nuestro user_id tomamos el nuestro; si no, el primero, que es el caso normal
  // de un vendedor único.
  const sender =
    (sellerMlUserId
      ? parsed.senders.find((entry) => String(entry.user_id ?? "") === sellerMlUserId)
      : undefined) ?? parsed.senders[0];

  const discounts = (sender?.discounts ?? []).map((discount) => ({
    type: discount.type,
    rate: discount.rate ?? null,
    promotedAmount: discount.promoted_amount,
  }));

  const discountsTotal = discounts
    .reduce((acc, discount) => acc + Number(discount.promotedAmount ?? 0), 0)
    .toString();

  return {
    grossAmount: parsed.gross_amount,
    senderCost: sender?.cost ?? null,
    receiverCost: parsed.receiver?.cost ?? null,
    discounts,
    discountsTotal,
  };
}

export async function fetchShipment(client: MercadoLibreClient, shipmentId: string) {
  const raw = await client.get<unknown>(`/shipments/${shipmentId}`);
  return shipmentSchema.parse(raw);
}

const orderShipmentsSchema = z.object({
  shipments: z
    .array(z.object({ id: z.union([z.number(), z.string()]).transform((v) => String(v)) }))
    .default([]),
});

/** Envíos de una orden. `list_all=true` incluye los envíos ya cerrados. */
export async function fetchOrderShipments(
  client: MercadoLibreClient,
  orderId: string,
): Promise<string[]> {
  const raw = await client
    .get<unknown>(`/orders/${orderId}/shipments`, { list_all: true })
    .catch(() => null);
  if (raw === null) return [];

  // El recurso puede devolver un objeto con `shipments` o un envío suelto.
  const asList = orderShipmentsSchema.safeParse(raw);
  if (asList.success) return asList.data.shipments.map((shipment) => shipment.id);

  const single = z
    .object({ id: z.union([z.number(), z.string()]).transform((v) => String(v)) })
    .safeParse(raw);
  return single.success ? [single.data.id] : [];
}
