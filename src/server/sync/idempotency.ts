/**
 * Claves de idempotencia de la sincronización.
 *
 * Son funciones puras a propósito: la garantía real contra duplicados son los
 * índices únicos de PostgreSQL (ver `prisma/schema.prisma`), pero la clave que
 * los alimenta tiene que ser determinística y testeable sin base de datos.
 *
 * Casos que esto tiene que cubrir (§41 del brief):
 *   - la misma orden llega por webhook y por reconciliación
 *   - la misma notificación se reintenta ocho veces
 *   - el mismo refund se recibe dos veces
 *   - dos cuentas distintas tienen entidades con el mismo ID externo
 */

/** Identidad de una orden. Siempre incluye la cuenta: dos sellers pueden repetir ID. */
export function orderKey(sellerAccountId: string, mlOrderId: string | number | bigint): string {
  return `order:${sellerAccountId}:${String(mlOrderId)}`;
}

export function paymentKey(sellerAccountId: string, mlPaymentId: string | number | bigint): string {
  return `payment:${sellerAccountId}:${String(mlPaymentId)}`;
}

export function refundKey(sellerAccountId: string, externalId: string): string {
  return `refund:${sellerAccountId}:${externalId}`;
}

export function shipmentKey(sellerAccountId: string, mlShipmentId: string | number | bigint): string {
  return `shipment:${sellerAccountId}:${String(mlShipmentId)}`;
}

/**
 * Identidad de una notificación.
 *
 * Mercado Libre reintenta la MISMA notificación hasta ocho veces durante una
 * hora, incrementando `attempts`. Por eso `attempts` NO entra en la clave: si
 * entrara, cada reintento se procesaría como un evento nuevo. Lo que identifica
 * al evento es el recurso y el instante de envío (`sent`).
 */
export function webhookKey(params: {
  provider: string;
  topic: string;
  resource: string;
  sentAt: Date | string | null;
}): string {
  const sent = params.sentAt
    ? params.sentAt instanceof Date
      ? params.sentAt.toISOString()
      : params.sentAt
    : "no-sent";
  return `webhook:${params.provider}:${params.topic}:${params.resource}:${sent}`;
}

/** Movimiento de Mercado Pago: el SOURCE_ID puede repetirse entre tipos de registro. */
export function mpMovementKey(params: {
  sourceId: string;
  recordType: string;
  date: string;
  /** Discrimina filas del mismo pago en el mismo día (ej. cobro y su comisión). */
  description?: string | null;
}): string {
  return [params.sourceId, params.recordType, params.date, params.description ?? ""].join("|");
}

/** Métrica diaria de publicidad: una fila por entidad y día. */
export function adMetricKey(params: {
  level: "CAMPAIGN" | "ITEM";
  entityId: string;
  date: string;
}): string {
  return `ads:${params.level}:${params.entityId}:${params.date}`;
}

/**
 * Deduplica una lista por clave, conservando el ÚLTIMO elemento de cada clave.
 *
 * Se queda con el último y no con el primero porque, cuando la misma entidad
 * llega dos veces, la segunda suele traer el estado más reciente (una orden que
 * pasó de `paid` a `cancelled`, por ejemplo).
 */
export function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): {
  unique: T[];
  duplicates: number;
} {
  const map = new Map<string, T>();
  let duplicates = 0;

  for (const item of items) {
    const key = keyOf(item);
    if (map.has(key)) duplicates += 1;
    map.set(key, item);
  }

  return { unique: [...map.values()], duplicates };
}
