import { describe, expect, it } from "vitest";
import { money, Decimal } from "@/lib/money";
import { parseDateKey } from "@/lib/dates";
import {
  EMPTY_COSTING_STATE,
  calculateDailyReserve,
  calculateInventoryReplacementFund,
  calculateOrderProfitability,
  calculatePeriodResult,
  calculateSafeAvailableCash,
  calculateSkuProfitability,
  consolidatePeriodResults,
  sumScopedAmounts,
  weightedAverageStrategy,
} from "@/financial-engine";
import type {
  OrderFeeInput,
  OrderItemInput,
  OrderProfitabilityInput,
  ObligationInput,
} from "@/financial-engine/types";
import { dedupeByKey, refundKey, webhookKey } from "@/server/sync/idempotency";

/**
 * Casos de test obligatorios del §41 del brief.
 *
 * Cada `describe` corresponde literalmente a uno de los catorce casos pedidos.
 * Son la red de seguridad del sistema: si alguno se rompe, hay un número del
 * dashboard que está mintiendo.
 */

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function item(overrides: Partial<OrderItemInput> = {}): OrderItemInput {
  return {
    id: "item-1",
    mlItemId: "MLA123456",
    sellerSku: "SKU-1",
    skuId: "sku-1",
    title: "Producto de prueba",
    quantity: 1,
    unitPrice: money(0),
    grossPrice: null,
    sellerDiscount: money(0),
    saleFee: null,
    saleFeeKind: "ACTUAL",
    saleFeeSource: "MELI_API",
    cogsUnitCost: null,
    cogsTotal: null,
    ...overrides,
  };
}

function fee(
  type: OrderFeeInput["type"],
  amount: number,
  overrides: Partial<OrderFeeInput> = {},
): OrderFeeInput {
  return {
    type,
    amount: money(amount),
    kind: "ACTUAL",
    source: "MELI_API",
    ...overrides,
  };
}

function order(overrides: Partial<OrderProfitabilityInput> = {}): OrderProfitabilityInput {
  return {
    orderId: "order-1",
    mlOrderId: "2000000000001",
    status: "paid",
    currencyId: "ARS",
    totalAmount: money(0),
    items: [],
    fees: [],
    refundedAmount: money(0),
    taxTreatment: "FISCAL_CREDIT",
    ...overrides,
  };
}

const expectMoney = (actual: Decimal, expected: string) =>
  expect(actual.toDecimalPlaces(4).toString()).toBe(expected);

// -----------------------------------------------------------------------------
// 1 y 2 — Umbral de cargo fijo
// -----------------------------------------------------------------------------

describe("Caso 1 — venta menor al umbral de costo fijo", () => {
  it("descuenta el cargo fijo además de la comisión", () => {
    const result = calculateOrderProfitability(
      order({
        totalAmount: money(8000),
        items: [
          item({ quantity: 1, unitPrice: money(8000), saleFee: money(1000), cogsTotal: money(3000) }),
        ],
        fees: [fee("FIXED_FEE", 1095)],
      }),
    );

    expectMoney(result.grossRevenue, "8000");
    expectMoney(result.netRevenue, "8000");
    expectMoney(result.grossMargin, "5000");
    expectMoney(result.meliFees, "1000");
    expectMoney(result.fixedFees, "1095");
    // 8000 − 3000 − 1000 − 1095
    expectMoney(result.contributionMargin, "2905");
    expect(result.hasEstimates).toBe(false);
  });
});

describe("Caso 2 — venta mayor al umbral de costo fijo", () => {
  it("no aplica cargo fijo cuando Mercado Libre no lo cobró", () => {
    const result = calculateOrderProfitability(
      order({
        totalAmount: money(40000),
        items: [
          item({ quantity: 1, unitPrice: money(40000), saleFee: money(5000), cogsTotal: money(20000) }),
        ],
        fees: [],
      }),
    );

    expectMoney(result.fixedFees, "0");
    expectMoney(result.contributionMargin, "15000");
    // 15000 / 40000
    expectMoney(result.marginPct, "37.5");
  });
});

// -----------------------------------------------------------------------------
// 3 — Cuotas
// -----------------------------------------------------------------------------

describe("Caso 3 — venta con 3 cuotas", () => {
  it("descuenta el costo de financiación como línea propia", () => {
    const result = calculateOrderProfitability(
      order({
        totalAmount: money(10000),
        items: [
          item({ quantity: 1, unitPrice: money(10000), saleFee: money(1300), cogsTotal: money(4000) }),
        ],
        // 8,8% de referencia para 3 cuotas, provisto por CommercialRule o por el
        // cargo real de Mercado Pago. El motor no conoce el porcentaje.
        fees: [fee("FINANCING_FEE", 880)],
      }),
    );

    expectMoney(result.financingFees, "880");
    expectMoney(result.contributionMargin, "3820");

    const financingStep = result.waterfall.find((step) => step.label === "Financiación");
    expect(financingStep).toBeDefined();
    expect(financingStep?.effect).toBe("NEGATIVE");
  });

  it("marca la financiación como ESTIMADO cuando viene de una regla y no del cargo real", () => {
    const result = calculateOrderProfitability(
      order({
        totalAmount: money(10000),
        items: [
          item({ quantity: 1, unitPrice: money(10000), saleFee: money(1300), cogsTotal: money(4000) }),
        ],
        fees: [fee("FINANCING_FEE", 880, { kind: "ESTIMATED", source: "CALCULATED" })],
      }),
    );

    expect(result.hasEstimates).toBe(true);
    expect(result.estimatedComponents).toContain("Financiación");
  });
});

// -----------------------------------------------------------------------------
// 4 — Envío gratis
// -----------------------------------------------------------------------------

describe("Caso 4 — venta con envío gratis", () => {
  it("imputa al vendedor el costo del envío (senders[].cost)", () => {
    const result = calculateOrderProfitability(
      order({
        totalAmount: money(30000),
        items: [
          item({ quantity: 1, unitPrice: money(30000), saleFee: money(4000), cogsTotal: money(12000) }),
        ],
        fees: [fee("SHIPPING_FEE", 2500)],
      }),
    );

    expectMoney(result.shippingCost, "2500");
    expectMoney(result.contributionMargin, "11500");
  });
});

// -----------------------------------------------------------------------------
// 5 — Publicidad
// -----------------------------------------------------------------------------

describe("Caso 5 — venta con publicidad", () => {
  it("descuenta la publicidad atribuida y la distingue del margen previo", () => {
    const base = {
      totalAmount: money(20000),
      items: [
        item({ quantity: 1, unitPrice: money(20000), saleFee: money(2600), cogsTotal: money(9000) }),
      ],
    };

    const withoutAds = calculateOrderProfitability(order({ ...base, fees: [] }));
    const withAds = calculateOrderProfitability(
      order({
        ...base,
        fees: [fee("ADS_ATTRIBUTED", 1200, { source: "CALCULATED" })],
      }),
    );

    expectMoney(withoutAds.contributionMargin, "8400");
    expectMoney(withAds.contributionMargin, "7200");
    expectMoney(withAds.adsAttributed, "1200");
  });

  it("detecta el SKU que sólo pierde plata después de publicidad", () => {
    const sku = calculateSkuProfitability({
      skuId: "sku-1",
      skuCode: "SKU-1",
      mlItemId: "MLA1",
      title: "Producto",
      units: 10,
      revenue: money(100000),
      cogs: money(60000),
      meliFees: money(13000),
      fixedFees: money(0),
      financingFees: money(0),
      shippingCost: money(20000),
      adsCost: money(9000),
      otherCharges: money(0),
      adsAttributedRevenue: money(30000),
      hasEstimates: false,
    });

    // 100000 − 93000 = 7000 antes de publicidad; 7000 − 9000 = −2000 después.
    expectMoney(sku.marginBeforeAds, "7000");
    expectMoney(sku.margin, "-2000");
    expect(sku.losesMoney).toBe(true);
    expect(sku.losesMoneyOnlyAfterAds).toBe(true);
    // ROAS = 30000 / 9000
    expect(sku.roas.toDecimalPlaces(4).toString()).toBe("3.3333");
    // TACOS = 9000 / 100000
    expectMoney(sku.tacos, "9");
  });
});

// -----------------------------------------------------------------------------
// 6 y 7 — Devoluciones
// -----------------------------------------------------------------------------

describe("Caso 6 — devolución total", () => {
  it("anula la facturación y deja como pérdida sólo los costos no reintegrados", () => {
    const result = calculateOrderProfitability(
      order({
        totalAmount: money(8000),
        items: [
          // La mercadería volvió al stock: el COGS se revierte, por eso llega en cero.
          item({ quantity: 1, unitPrice: money(8000), saleFee: null, cogsTotal: money(0) }),
        ],
        fees: [fee("SHIPPING_FEE", 1500), fee("RETURN_COST", 800)],
        refundedAmount: money(8000),
      }),
    );

    expectMoney(result.netRevenue, "0");
    // Se pierden el envío de ida y el costo del retorno.
    expectMoney(result.contributionMargin, "-2300");
  });
});

describe("Caso 7 — devolución parcial", () => {
  it("descuenta sólo la porción devuelta", () => {
    const result = calculateOrderProfitability(
      order({
        totalAmount: money(16000),
        items: [
          // Se vendieron 2, volvió 1: queda el COGS de la unidad que se quedó el comprador.
          item({ quantity: 2, unitPrice: money(8000), saleFee: money(1000), cogsTotal: money(3000) }),
        ],
        fees: [],
        refundedAmount: money(8000),
      }),
    );

    expectMoney(result.grossRevenue, "16000");
    expectMoney(result.refunds, "8000");
    expectMoney(result.netRevenue, "8000");
    // saleFee es por unidad: 1000 × 2
    expectMoney(result.meliFees, "2000");
    expectMoney(result.contributionMargin, "3000");
  });
});

// -----------------------------------------------------------------------------
// 8 y 9 — Costeo
// -----------------------------------------------------------------------------

describe("Caso 8 — compra de stock que cambia el promedio ponderado", () => {
  it("recalcula el promedio con la fórmula (valor anterior + compra) / (unidades)", () => {
    const initial = weightedAverageStrategy.applyPurchase(
      EMPTY_COSTING_STATE,
      money(10),
      money(100),
    );
    expectMoney(initial.stock, "10");
    expectMoney(initial.averageCost, "100");
    expectMoney(initial.stockValue, "1000");

    const afterSecond = weightedAverageStrategy.applyPurchase(initial, money(10), money(200));
    // (1000 + 2000) / 20 = 150
    expectMoney(afterSecond.averageCost, "150");
    expectMoney(afterSecond.stock, "20");
    expectMoney(afterSecond.stockValue, "3000");
    // La trazabilidad del estado anterior queda guardada.
    expectMoney(afterSecond.before.averageCost, "100");
  });

  it("no rompe cuando el stock queda en cero", () => {
    const state = weightedAverageStrategy.applyPurchase(EMPTY_COSTING_STATE, money(5), money(80));
    const afterSale = weightedAverageStrategy.applySale(state, money(5));
    expectMoney(afterSale.stock, "0");
    expectMoney(afterSale.cogsUnitCost, "80");
    // El promedio se conserva: no se divide por cero ni se pone en cero.
    expectMoney(afterSale.averageCost, "80");
  });
});

describe("Caso 9 — venta con costo histórico", () => {
  it("no recalcula una venta vieja con el costo actual del SKU", () => {
    // Compro a 100, vendo, y recién después compro más caro.
    const afterFirstPurchase = weightedAverageStrategy.applyPurchase(
      EMPTY_COSTING_STATE,
      money(10),
      money(100),
    );
    const sale = weightedAverageStrategy.applySale(afterFirstPurchase, money(5));
    const frozenCogs = sale.cogsUnitCost;

    const afterExpensivePurchase = weightedAverageStrategy.applyPurchase(
      sale,
      money(10),
      money(300),
    );

    // El promedio actual sube…
    expect(afterExpensivePurchase.averageCost.greaterThan(money(100))).toBe(true);
    // …pero el COGS congelado de la venta anterior sigue siendo 100.
    expectMoney(frozenCogs, "100");

    const historicOrder = calculateOrderProfitability(
      order({
        totalAmount: money(1000),
        items: [
          item({
            quantity: 5,
            unitPrice: money(200),
            saleFee: money(20),
            cogsUnitCost: frozenCogs,
            cogsTotal: frozenCogs.times(5),
          }),
        ],
      }),
    );

    expectMoney(historicOrder.cogs, "500");
    expectMoney(historicOrder.contributionMargin, "400");
  });

  it("marca el margen como estimado cuando falta cargar el costo", () => {
    const result = calculateOrderProfitability(
      order({
        totalAmount: money(1000),
        items: [item({ quantity: 1, unitPrice: money(1000), saleFee: money(120) })],
      }),
    );

    expect(result.hasEstimates).toBe(true);
    expect(result.estimatedComponents).toContain("Costo de mercadería (sin costo cargado)");
  });
});

// -----------------------------------------------------------------------------
// 10 — Obligación futura
// -----------------------------------------------------------------------------

describe("Caso 10 — obligación futura", () => {
  const obligation: ObligationInput = {
    id: "ob-1",
    description: "Tarjeta",
    amount: money(1_200_000),
    reservedAmount: money(300_000),
    paidAmount: money(0),
    dueDate: parseDateKey("2026-09-20"),
    priority: "CRITICAL",
  };

  const baseInput = {
    obligation,
    today: parseDateKey("2026-09-05"),
    averageDailyContribution: money(120_000),
    historyDays: 45,
    contributionStdDev: money(25_000),
    pendingReleaseBeforeDue: money(0),
    earlierObligationsUncovered: money(0),
    expectedInventoryCost: money(0),
    expectedExpenses: money(0),
    safetyBuffer: money(0),
  };

  it("calcula cuánto falta y en cuántos días", () => {
    const result = calculateDailyReserve(baseInput);
    expectMoney(result.remainingAmount, "900000");
    expect(result.daysRemaining).toBe(15);
    expect(result.isOverdue).toBe(false);
  });

  it("sin plata en camino, coincide con el reparto simple", () => {
    const result = calculateDailyReserve(baseInput);
    expectMoney(result.naiveDailyAmount, "60000");
    expectMoney(result.dailyAmount, "60000");
  });

  it("NO es deuda/días: descuenta las liberaciones libres antes del vencimiento", () => {
    const result = calculateDailyReserve({
      ...baseInput,
      pendingReleaseBeforeDue: money(450_000),
    });

    // 900.000 − 450.000 = 450.000 a generar en 15 días
    expectMoney(result.dailyAmount, "30000");
    expectMoney(result.naiveDailyAmount, "60000");
    expect(result.dailyAmount.lessThan(result.naiveDailyAmount)).toBe(true);
  });

  it("no cuenta liberaciones que ya están comprometidas por obligaciones anteriores", () => {
    const result = calculateDailyReserve({
      ...baseInput,
      pendingReleaseBeforeDue: money(450_000),
      earlierObligationsUncovered: money(500_000),
    });

    // Los compromisos previos se comen toda la liberación: no queda nada útil.
    expectMoney(result.dailyAmount, "60000");
  });

  it("avisa cuando la recomendación supera la capacidad diaria del negocio", () => {
    const result = calculateDailyReserve({
      ...baseInput,
      averageDailyContribution: money(40_000),
      contributionStdDev: money(5_000),
    });

    expect(result.exceedsCapacity).toBe(true);
    expect(result.explanation.join(" ")).toContain("contribución promedio");
  });

  it("informa confianza alta con historia larga y estable, baja con historia corta", () => {
    expect(calculateDailyReserve(baseInput).confidence).toBe("ALTA");
    expect(calculateDailyReserve({ ...baseInput, historyDays: 4 }).confidence).toBe("BAJA");
    expect(
      calculateDailyReserve({ ...baseInput, contributionStdDev: money(200_000) }).confidence,
    ).toBe("BAJA");
  });

  it("trata la obligación vencida como exigible hoy, sin dividir por días negativos", () => {
    const result = calculateDailyReserve({
      ...baseInput,
      today: parseDateKey("2026-09-25"),
    });

    expect(result.isOverdue).toBe(true);
    expect(result.daysRemaining).toBe(0);
    expectMoney(result.dailyAmount, "900000");
  });
});

// -----------------------------------------------------------------------------
// 11 — Saldo insuficiente
// -----------------------------------------------------------------------------

describe("Caso 11 — saldo insuficiente", () => {
  it("devuelve disponible seguro negativo y presupuesto de compra en cero", () => {
    const result = calculateSafeAvailableCash({
      availableBalance: money(1_000_000),
      inventoryReplacementFund: money(800_000),
      reserves: [
        {
          id: "r1",
          name: "Impuestos",
          type: "TAX",
          targetAmount: money(250_000),
          currentAmount: money(250_000),
          priority: 3,
        },
      ],
      upcomingObligations: [
        {
          id: "ob-1",
          description: "Proveedor",
          amount: money(400_000),
          reservedAmount: money(0),
          paidAmount: money(0),
          dueDate: parseDateKey("2026-09-10"),
          priority: "HIGH",
        },
      ],
      committedExpenses: money(150_000),
      safetyBuffer: money(200_000),
    });

    // 1.000.000 − 800.000 − 250.000 − 400.000 − 150.000 − 200.000
    expectMoney(result.safeAvailable, "-800000");
    // El presupuesto de compra nunca es negativo.
    expectMoney(result.recommendedInventoryBudget, "0");
  });

  it("no cuenta dos veces el fondo de reposición ni el colchón", () => {
    const result = calculateSafeAvailableCash({
      availableBalance: money(3_000_000),
      inventoryReplacementFund: money(800_000),
      reserves: [
        {
          id: "r-inv",
          name: "Fondo mercadería",
          type: "INVENTORY_REPLACEMENT",
          targetAmount: money(800_000),
          currentAmount: money(800_000),
          priority: 1,
        },
        {
          id: "r-tax",
          name: "Impuestos",
          type: "TAX",
          targetAmount: money(250_000),
          currentAmount: money(250_000),
          priority: 3,
        },
        {
          id: "r-card",
          name: "Tarjeta",
          type: "OBLIGATION",
          targetAmount: money(400_000),
          currentAmount: money(400_000),
          priority: 2,
        },
        {
          id: "r-supplier",
          name: "Proveedor",
          type: "OBLIGATION",
          targetAmount: money(300_000),
          currentAmount: money(300_000),
          priority: 2,
        },
        {
          id: "r-buffer",
          name: "Colchón mínimo",
          type: "SAFETY_BUFFER",
          targetAmount: money(200_000),
          currentAmount: money(200_000),
          priority: 5,
        },
      ],
      upcomingObligations: [],
      committedExpenses: money(0),
      safetyBuffer: money(200_000),
    });

    // El ejemplo del §19 del brief: 3.000.000 − 800.000 − 250.000 − 400.000
    //                              − 300.000 − 200.000 = 1.050.000
    expectMoney(result.reservesTotal, "950000");
    expectMoney(result.inventoryReplacementFund, "800000");
    expectMoney(result.safetyBuffer, "200000");
    expectMoney(result.safeAvailable, "1050000");
  });

  it("suma el fondo de reposición al presupuesto de compra de mercadería", () => {
    const result = calculateSafeAvailableCash({
      availableBalance: money(2_000_000),
      inventoryReplacementFund: money(500_000),
      reserves: [],
      upcomingObligations: [],
      committedExpenses: money(0),
      safetyBuffer: money(300_000),
    });

    expectMoney(result.safeAvailable, "1200000");
    // 1.200.000 + 500.000 del fondo, que existe justamente para reponer stock.
    expectMoney(result.recommendedInventoryBudget, "1700000");
  });
});

// -----------------------------------------------------------------------------
// 12 — Dos sellers
// -----------------------------------------------------------------------------

describe("Caso 12 — dos sellers", () => {
  const accountResult = (revenue: number, cogs: number, expenses: number) =>
    calculatePeriodResult({
      grossRevenue: money(revenue),
      cancellations: money(0),
      refunds: money(0),
      sellerFundedDiscounts: money(0),
      cogs: money(cogs),
      meliFees: money(0),
      fixedFees: money(0),
      financingFees: money(0),
      shippingCost: money(0),
      adsCost: money(0),
      taxesAsCost: money(0),
      operatingExpenses: money(expenses),
      otherCharges: money(0),
    });

  it("suma las cuentas y recalcula los porcentajes sobre el total", () => {
    const consolidated = consolidatePeriodResults([
      { sellerAccountId: "acc-1", result: accountResult(1_000_000, 600_000, 100_000) },
      { sellerAccountId: "acc-2", result: accountResult(500_000, 200_000, 50_000) },
    ]);

    expectMoney(consolidated.grossRevenue, "1500000");
    expectMoney(consolidated.grossMargin, "700000");
    expectMoney(consolidated.operatingResult, "550000");
    // El margen consolidado NO es el promedio de los márgenes de cada cuenta.
    expectMoney(consolidated.grossMarginPct, "46.6667");
  });

  it("rechaza consolidar la misma cuenta dos veces", () => {
    expect(() =>
      consolidatePeriodResults([
        { sellerAccountId: "acc-1", result: accountResult(1000, 0, 0) },
        { sellerAccountId: "acc-1", result: accountResult(1000, 0, 0) },
      ]),
    ).toThrow(/dos veces/);
  });

  it("no mezcla entidades de distintos sellers aunque compartan el mismo ID externo", () => {
    // Dos cuentas pueden tener, legítimamente, una orden con el mismo número.
    const totals = sumScopedAmounts([
      { sellerAccountId: "acc-1", externalId: 2_000_000_000_001n, amount: money(10_000) },
      { sellerAccountId: "acc-2", externalId: 2_000_000_000_001n, amount: money(7_000) },
    ]);

    expectMoney(totals.total, "17000");
    expect(totals.counted).toBe(2);
    expect(totals.duplicatesIgnored).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// 13 — Orden duplicada vía webhook
// -----------------------------------------------------------------------------

describe("Caso 13 — orden duplicada vía webhook", () => {
  it("los reintentos de la misma notificación comparten clave", () => {
    const first = webhookKey({
      provider: "MERCADO_LIBRE",
      topic: "orders_v2",
      resource: "/orders/2195160686",
      sentAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    // Mercado Libre reintenta hasta ocho veces incrementando `attempts`; el
    // evento sigue siendo el mismo.
    const retry = webhookKey({
      provider: "MERCADO_LIBRE",
      topic: "orders_v2",
      resource: "/orders/2195160686",
      sentAt: new Date("2026-09-01T10:00:00.000Z"),
    });

    expect(first).toBe(retry);
  });

  it("un cambio real posterior sobre la misma orden es un evento distinto", () => {
    const created = webhookKey({
      provider: "MERCADO_LIBRE",
      topic: "orders_v2",
      resource: "/orders/2195160686",
      sentAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    const updated = webhookKey({
      provider: "MERCADO_LIBRE",
      topic: "orders_v2",
      resource: "/orders/2195160686",
      sentAt: new Date("2026-09-01T11:30:00.000Z"),
    });

    expect(created).not.toBe(updated);
  });

  it("la misma orden por webhook y por reconciliación se cuenta una sola vez", () => {
    const incoming = [
      { sellerAccountId: "acc-1", mlOrderId: 2_000_000_000_001n, total: money(10_000), status: "paid" },
      // Llega otra vez por el barrido de reconciliación, con el estado más nuevo.
      { sellerAccountId: "acc-1", mlOrderId: 2_000_000_000_001n, total: money(10_000), status: "cancelled" },
      { sellerAccountId: "acc-2", mlOrderId: 2_000_000_000_001n, total: money(5_000), status: "paid" },
    ];

    const { unique, duplicates } = dedupeByKey(
      incoming,
      (o) => `order:${o.sellerAccountId}:${o.mlOrderId}`,
    );

    expect(unique).toHaveLength(2);
    expect(duplicates).toBe(1);
    // Se conserva el estado más reciente, no el primero que llegó.
    expect(unique.find((o) => o.sellerAccountId === "acc-1")?.status).toBe("cancelled");
  });
});

// -----------------------------------------------------------------------------
// 14 — Refund recibido dos veces
// -----------------------------------------------------------------------------

describe("Caso 14 — refund recibido dos veces", () => {
  it("no descuenta dos veces la misma devolución", () => {
    const refunds = [
      { sellerAccountId: "acc-1", externalId: "refund-778", amount: money(8_000) },
      { sellerAccountId: "acc-1", externalId: "refund-778", amount: money(8_000) },
    ];

    const { unique, duplicates } = dedupeByKey(refunds, (r) =>
      refundKey(r.sellerAccountId, r.externalId),
    );

    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);

    const totals = sumScopedAmounts(
      refunds.map((r) => ({
        sellerAccountId: r.sellerAccountId,
        externalId: r.externalId,
        amount: r.amount,
      })),
    );
    expectMoney(totals.total, "8000");
    expect(totals.duplicatesIgnored).toBe(1);
  });

  it("aplicado a la orden, el margen no se castiga dos veces", () => {
    const build = (refunded: number) =>
      calculateOrderProfitability(
        order({
          totalAmount: money(8000),
          items: [item({ quantity: 1, unitPrice: money(8000), saleFee: money(1000), cogsTotal: money(0) })],
          refundedAmount: money(refunded),
        }),
      );

    const once = build(8000);
    const twiceByMistake = build(16000);

    expectMoney(once.netRevenue, "0");
    // Si el refund se sumara dos veces, la facturación neta quedaría en −8000:
    // por eso la deduplicación tiene que pasar ANTES de llegar al motor.
    expectMoney(twiceByMistake.netRevenue, "-8000");
    expect(twiceByMistake.netRevenue.lessThan(once.netRevenue)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Fondo de reposición (§15) — no es un caso numerado, pero es central
// -----------------------------------------------------------------------------

describe("Fondo de reposición de mercadería", () => {
  it("reserva el costo de reponer lo vendido", () => {
    const result = calculateInventoryReplacementFund([
      { skuId: "sku-1", quantity: 3, cogsTotal: money(30_000) },
      { skuId: "sku-2", quantity: 1, cogsTotal: money(12_000) },
    ]);

    expectMoney(result.cogsSold, "42000");
    expectMoney(result.replacementFund, "42000");
    expectMoney(result.inflationAdjustment, "0");
  });

  it("ajusta el fondo cuando reponer hoy cuesta más caro", () => {
    const result = calculateInventoryReplacementFund(
      [{ skuId: "sku-1", quantity: 3, cogsTotal: money(30_000) }],
      { replacementCostFactor: money(1.11) },
    );

    expectMoney(result.replacementFund, "33300");
    expectMoney(result.inflationAdjustment, "3300");
  });

  it("avisa cuántos ítems vendidos no tienen costo cargado", () => {
    const result = calculateInventoryReplacementFund([
      { skuId: "sku-1", quantity: 1, cogsTotal: money(10_000) },
      { skuId: null, quantity: 1, cogsTotal: money(0) },
    ]);

    expect(result.itemsWithoutCost).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// Tratamiento fiscal (§9) — una retención no es automáticamente una pérdida
// -----------------------------------------------------------------------------

describe("Tratamiento de retenciones y percepciones", () => {
  const base = order({
    totalAmount: money(10_000),
    items: [item({ quantity: 1, unitPrice: money(10_000), saleFee: money(1_300), cogsTotal: money(4_000) })],
    fees: [fee("TAX_WITHHELD", 500, { source: "MP_API" })],
  });

  it("como crédito fiscal NO reduce el resultado", () => {
    const result = calculateOrderProfitability({ ...base, taxTreatment: "FISCAL_CREDIT" });
    expectMoney(result.taxesWithheld, "500");
    expectMoney(result.taxesAsCost, "0");
    expectMoney(result.contributionMargin, "4700");

    const step = result.waterfall.find((s) => s.label === "Retenciones / percepciones");
    expect(step?.note).toContain("Crédito fiscal");
  });

  it("como costo sí reduce el resultado", () => {
    const result = calculateOrderProfitability({ ...base, taxTreatment: "COST" });
    expectMoney(result.taxesAsCost, "500");
    expectMoney(result.contributionMargin, "4200");
  });

  it("como movimiento de caja tampoco reduce el resultado", () => {
    const result = calculateOrderProfitability({ ...base, taxTreatment: "CASH_MOVEMENT_ONLY" });
    expectMoney(result.contributionMargin, "4700");
  });
});
