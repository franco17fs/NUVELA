import type { OrderStatus, PaymentStatus } from "@prisma/client";
import { money, sum, type Decimal } from "@/lib/money";
import { businessDate } from "@/lib/dates";
import type { MlOrder, MlOrderItem, MlOrderPayment } from "@/integrations/mercadolibre/schemas";

/**
 * Traducción de las respuestas de Mercado Libre al modelo de NUVELA.
 *
 * Estas funciones son PURAS: reciben el JSON ya validado y devuelven objetos
 * planos, sin tocar la base. Así se puede testear el mapeo —que es donde se
 * cometen los errores caros— con datos reales de la API y sin infraestructura.
 */

const ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  confirmed: "CONFIRMED",
  payment_required: "PAYMENT_REQUIRED",
  payment_in_process: "PAYMENT_IN_PROCESS",
  partially_paid: "PARTIALLY_PAID",
  paid: "PAID",
  partially_refunded: "PARTIALLY_REFUNDED",
  cancelled: "CANCELLED",
  invalid: "INVALID",
};

export function mapOrderStatus(status: string | null): OrderStatus {
  if (!status) return "UNKNOWN";
  return ORDER_STATUS_MAP[status] ?? "UNKNOWN";
}

const PAYMENT_STATUS_MAP: Record<string, PaymentStatus> = {
  pending: "PENDING",
  approved: "APPROVED",
  authorized: "AUTHORIZED",
  in_process: "IN_PROCESS",
  in_mediation: "IN_MEDIATION",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
  charged_back: "CHARGED_BACK",
};

export function mapPaymentStatus(status: string | null): PaymentStatus {
  if (!status) return "UNKNOWN";
  return PAYMENT_STATUS_MAP[status] ?? "UNKNOWN";
}

export interface MappedOrderItem {
  position: number;
  mlItemId: string;
  variationId: string | null;
  title: string;
  categoryId: string | null;
  listingTypeId: string | null;
  sellerSku: string | null;
  quantity: number;
  unitPrice: string;
  grossPrice: string | null;
  /** Comisión REAL por unidad, tal como la informa Mercado Libre. */
  saleFee: string | null;
}

export interface MappedOrder {
  mlOrderId: string;
  packId: string | null;
  status: OrderStatus;
  statusDetail: string | null;
  currencyId: string;
  totalAmount: string;
  paidAmount: string;
  couponAmount: string;
  shippingCost: string;
  taxesAmount: string;
  dateCreated: Date;
  dateClosed: Date | null;
  dateLastUpdated: Date;
  businessDate: Date;
  buyerId: string | null;
  tags: string[];
  cancelGroup: string | null;
  cancelCode: string | null;
  cancelReason: string | null;
  shipmentId: string | null;
  items: MappedOrderItem[];
  payments: MappedPayment[];
}

export interface MappedPayment {
  mlPaymentId: string;
  status: PaymentStatus;
  statusDetail: string | null;
  currencyId: string;
  transactionAmount: string;
  totalPaidAmount: string;
  marketplaceFee: string;
  taxesAmount: string;
  shippingCost: string;
  couponAmount: string;
  overpaidAmount: string;
  installments: number | null;
  installmentAmount: string | null;
  paymentType: string | null;
  paymentMethodId: string | null;
  operationType: string | null;
  dateCreated: Date;
  dateApproved: Date | null;
}

/**
 * Mapea una orden completa.
 *
 * `businessDate` se calcula sobre `date_created` en la zona del negocio, porque
 * el P&L se corta por el día en que se vendió. La fecha de COBRO es otra cosa y
 * vive en el pago (`money_release_date`).
 */
export function mapOrder(order: MlOrder, timezone: string): MappedOrder {
  const dateCreated = new Date(order.date_created);

  return {
    mlOrderId: order.id,
    packId: order.pack_id,
    status: mapOrderStatus(order.status),
    statusDetail: order.status_detail,
    currencyId: order.currency_id,
    totalAmount: order.total_amount ?? "0",
    paidAmount: order.paid_amount ?? "0",
    couponAmount: order.coupon?.amount ?? "0",
    shippingCost: order.shipping_cost ?? "0",
    taxesAmount: order.taxes?.amount ?? "0",
    dateCreated,
    dateClosed: order.date_closed ? new Date(order.date_closed) : null,
    dateLastUpdated: new Date(order.date_last_updated),
    businessDate: businessDate(dateCreated, timezone),
    buyerId: order.buyer?.id ?? null,
    tags: order.tags,
    cancelGroup: order.cancel_detail?.group ?? null,
    cancelCode: order.cancel_detail?.code ?? null,
    cancelReason: order.cancel_detail?.description ?? null,
    shipmentId: order.shipping?.id ?? null,
    items: order.order_items.map(mapOrderItem),
    payments: order.payments.map(mapPayment),
  };
}

function mapOrderItem(item: MlOrderItem, position: number): MappedOrderItem {
  return {
    position,
    mlItemId: item.item.id,
    variationId: item.item.variation_id,
    title: item.item.title,
    categoryId: item.item.category_id,
    listingTypeId: item.listing_type_id,
    // Mercado Libre expone el SKU del vendedor en dos campos según cómo se
    // haya publicado; se prefiere `seller_sku`, que es el moderno.
    sellerSku: item.item.seller_sku ?? item.item.seller_custom_field,
    quantity: item.quantity,
    unitPrice: item.unit_price ?? "0",
    grossPrice: item.gross_price ?? item.full_unit_price,
    saleFee: item.sale_fee,
  };
}

function mapPayment(payment: MlOrderPayment): MappedPayment {
  return {
    mlPaymentId: payment.id,
    status: mapPaymentStatus(payment.status),
    statusDetail: payment.status_detail,
    currencyId: payment.currency_id ?? "ARS",
    transactionAmount: payment.transaction_amount ?? "0",
    totalPaidAmount: payment.total_paid_amount ?? "0",
    marketplaceFee: payment.marketplace_fee ?? "0",
    taxesAmount: payment.taxes_amount ?? "0",
    shippingCost: payment.shipping_cost ?? "0",
    couponAmount: payment.coupon_amount ?? "0",
    overpaidAmount: payment.overpaid_amount ?? "0",
    installments: payment.installments,
    installmentAmount: payment.installment_amount,
    paymentType: payment.payment_type,
    paymentMethodId: payment.payment_method_id,
    operationType: payment.operation_type,
    dateCreated: payment.date_created ? new Date(payment.date_created) : new Date(),
    dateApproved: payment.date_approved ? new Date(payment.date_approved) : null,
  };
}

// -----------------------------------------------------------------------------
// Normalización de cargos
// -----------------------------------------------------------------------------

export interface NormalizedFee {
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
  kind: "ACTUAL" | "ESTIMATED" | "FORECAST";
  source: "MELI_API" | "MP_API" | "BILLING_REPORT" | "MANUAL" | "CALCULATED" | "FORECAST";
  description: string;
  sourceReferenceId: string | null;
}

/**
 * Convierte una orden en líneas de cargo normalizadas.
 *
 * Es lo que hace auditable el KPI "Comisiones este mes: $X": cada peso de ese
 * total es una fila que apunta a su orden y a la llamada de API que la produjo.
 *
 * ## Por qué la comisión sale de los ítems y no de `marketplace_fee`
 *
 * `order_items[].sale_fee` y `payments[].marketplace_fee` representan el mismo
 * cargo visto desde dos lados. Sumar los dos lo duplicaría. Se prioriza el de
 * los ítems porque viene desagregado por publicación, que es lo que permite
 * calcular rentabilidad por SKU. `marketplace_fee` sólo se usa si los ítems no
 * traen `sale_fee`.
 */
export function normalizeOrderFees(order: MappedOrder): NormalizedFee[] {
  const fees: NormalizedFee[] = [];

  const itemSaleFees = sum(
    order.items.map((item) => (item.saleFee == null ? "0" : money(item.saleFee).times(item.quantity).toString())),
  );

  if (itemSaleFees.greaterThan(0)) {
    fees.push({
      type: "SALE_FEE",
      amount: itemSaleFees,
      kind: "ACTUAL",
      source: "MELI_API",
      description: "Comisión por vender (order_items.sale_fee)",
      sourceReferenceId: order.mlOrderId,
    });
  } else {
    const marketplaceFee = sum(order.payments.map((payment) => payment.marketplaceFee));
    if (marketplaceFee.greaterThan(0)) {
      fees.push({
        type: "MARKETPLACE_FEE",
        amount: marketplaceFee,
        kind: "ACTUAL",
        source: "MELI_API",
        description: "Cargo de marketplace (payments.marketplace_fee)",
        sourceReferenceId: order.mlOrderId,
      });
    }
  }

  return fees;
}

/**
 * Costo de envío a cargo del vendedor.
 *
 * Un pack (carrito) genera UNA orden por vendedor pero puede generar varias
 * órdenes; el envío se cobra una sola vez por pack. Por eso el costo se imputa
 * al pack y se reparte, en vez de cargarlo entero a cada orden.
 */
export function shippingFee(params: {
  senderCost: string | null;
  orderId: string;
  shipmentId: string;
}): NormalizedFee | null {
  const cost = money(params.senderCost);
  if (!cost.greaterThan(0)) return null;

  return {
    type: "SHIPPING_FEE",
    amount: cost,
    kind: "ACTUAL",
    source: "MELI_API",
    description: "Costo de envío a cargo del vendedor (shipments/costs → senders.cost)",
    sourceReferenceId: params.shipmentId,
  };
}

/** Descuento financiado por el vendedor, por ítem. */
export function sellerDiscountByItem(
  discounts: { itemId: string | null; sellerAmount: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const discount of discounts) {
    if (!discount.itemId) continue;
    const current = money(map.get(discount.itemId) ?? "0");
    map.set(discount.itemId, current.plus(money(discount.sellerAmount)).toString());
  }
  return map;
}
