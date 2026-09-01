import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { parseDateKey } from "@/lib/dates";
import {
  OUTFLOW_CATEGORIES,
  calculateCashflowForecast,
  calculateSalesForecast,
  dayOfWeekFactors,
  findCashShortfallDate,
  linearSlope,
  standardDeviation,
  weightedAverage,
} from "@/financial-engine";
import type { CashflowMovement } from "@/financial-engine/types";

const day = (key: string) => parseDateKey(key);

function movement(
  dateKey: string,
  direction: "IN" | "OUT",
  amount: number,
  overrides: Partial<CashflowMovement> = {},
): CashflowMovement {
  return {
    date: day(dateKey),
    direction,
    kind: "REAL",
    category: direction === "IN" ? "Liberaciones Mercado Pago" : OUTFLOW_CATEGORIES.EXPENSES,
    amount: money(amount),
    ...overrides,
  };
}

describe("cashflow semanal", () => {
  it("arrastra el saldo de una semana a la siguiente", () => {
    const weeks = calculateCashflowForecast({
      range: { from: day("2026-09-01"), to: day("2026-09-14") },
      openingBalance: money(1_000_000),
      safetyBuffer: money(200_000),
      movements: [
        movement("2026-09-03", "IN", 500_000),
        movement("2026-09-10", "OUT", 300_000),
      ],
    });

    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.closingBalance.toString()).toBe("1500000");
    expect(weeks[1]!.openingBalance.toString()).toBe("1500000");
    expect(weeks[1]!.closingBalance.toString()).toBe("1200000");
  });

  it("separa ingresos reales de proyectados", () => {
    const weeks = calculateCashflowForecast({
      range: { from: day("2026-09-01"), to: day("2026-09-07") },
      openingBalance: money(0),
      safetyBuffer: money(0),
      movements: [
        movement("2026-09-02", "IN", 100_000, { kind: "REAL" }),
        movement("2026-09-04", "IN", 80_000, { kind: "FORECAST" }),
        movement("2026-09-05", "IN", 40_000, { kind: "ESTIMATED" }),
      ],
    });

    expect(weeks[0]!.realIncome.toString()).toBe("100000");
    // Estimado y proyectado van juntos en "ingresos proyectados".
    expect(weeks[0]!.projectedIncome.toString()).toBe("120000");
  });

  it("impacta el saldo aunque la categoría de egreso no sea una de las conocidas", () => {
    const weeks = calculateCashflowForecast({
      range: { from: day("2026-09-01"), to: day("2026-09-07") },
      openingBalance: money(100_000),
      safetyBuffer: money(0),
      movements: [movement("2026-09-03", "OUT", 25_000, { category: "Categoría nueva" })],
    });

    // No cae en ninguna columna nombrada, pero el saldo tiene que bajar igual.
    expect(weeks[0]!.expenses.toString()).toBe("0");
    expect(weeks[0]!.closingBalance.toString()).toBe("75000");
  });

  it("marca la semana que cae por debajo del colchón", () => {
    const weeks = calculateCashflowForecast({
      range: { from: day("2026-09-01"), to: day("2026-09-07") },
      openingBalance: money(300_000),
      safetyBuffer: money(200_000),
      movements: [movement("2026-09-03", "OUT", 250_000)],
    });

    expect(weeks[0]!.belowSafetyBuffer).toBe(true);
  });
});

describe("detección de quiebre de caja", () => {
  it("encuentra el primer día por debajo del colchón", () => {
    const shortfall = findCashShortfallDate({
      openingBalance: money(1_000_000),
      safetyBuffer: money(200_000),
      movements: [
        movement("2026-09-10", "OUT", 400_000),
        movement("2026-09-18", "OUT", 500_000),
        movement("2026-09-25", "IN", 900_000),
      ],
    });

    expect(shortfall).not.toBeNull();
    // 1.000.000 − 400.000 = 600.000 el 10; − 500.000 = 100.000 el 18 < 200.000
    expect(shortfall && shortfall.date.toISOString().slice(0, 10)).toBe("2026-09-18");
    expect(shortfall?.balance.toString()).toBe("100000");
  });

  it("no marca quiebre si un ingreso del mismo día compensa el egreso", () => {
    const shortfall = findCashShortfallDate({
      openingBalance: money(300_000),
      safetyBuffer: money(200_000),
      movements: [
        movement("2026-09-10", "OUT", 250_000),
        movement("2026-09-10", "IN", 250_000),
      ],
    });

    expect(shortfall).toBeNull();
  });

  it("devuelve null cuando la caja nunca baja del colchón", () => {
    const shortfall = findCashShortfallDate({
      openingBalance: money(1_000_000),
      safetyBuffer: money(100_000),
      movements: [movement("2026-09-10", "OUT", 50_000)],
    });

    expect(shortfall).toBeNull();
  });
});

describe("estadística de la proyección", () => {
  it("el promedio ponderado da más peso a los días recientes", () => {
    const values = [money(100), money(100), money(400)];
    const simple = money(200); // promedio simple
    const weighted = weightedAverage(values, 0.9);
    expect(weighted.greaterThan(simple)).toBe(true);
  });

  it("con decaimiento 1 el ponderado equivale al promedio simple", () => {
    const weighted = weightedAverage([money(100), money(200), money(300)], 1);
    expect(weighted.toString()).toBe("200");
  });

  it("calcula desvío estándar y pendiente", () => {
    expect(standardDeviation([money(10), money(10), money(10)]).toString()).toBe("0");
    // Serie creciente de a 10: pendiente 10.
    const slope = linearSlope([money(10), money(20), money(30), money(40)]);
    expect(slope.toDecimalPlaces(4).toString()).toBe("10");
  });

  it("amortigua el factor de día de la semana cuando hay pocas observaciones", () => {
    // Un solo lunes muy alto: el factor no debe dispararse.
    const history = [
      { date: day("2026-09-07"), revenue: money(400), contribution: money(100) }, // lunes
      { date: day("2026-09-08"), revenue: money(100), contribution: money(25) },
      { date: day("2026-09-09"), revenue: money(100), contribution: money(25) },
      { date: day("2026-09-10"), revenue: money(100), contribution: money(25) },
    ];
    const factors = dayOfWeekFactors(history);
    const mondayFactor = factors[1]!;
    // Sin amortiguar sería 400/175 ≈ 2,29; con una sola observación se confía 1/4.
    expect(mondayFactor.lessThan(1.5)).toBe(true);
    expect(mondayFactor.greaterThan(1)).toBe(true);
  });
});

describe("proyección de ventas", () => {
  const history = Array.from({ length: 30 }, (_, i) => ({
    date: parseDateKey(`2026-08-${String(i + 1).padStart(2, "0")}`),
    revenue: money(100_000),
    contribution: money(20_000),
  }));

  it("proyecta el horizonte pedido y aplica el margen histórico", () => {
    const forecast = calculateSalesForecast(history, {
      horizonDays: 7,
      scenario: "BASE",
      useDayOfWeek: false,
      useTrend: false,
      today: parseDateKey("2026-08-30"),
    });

    expect(forecast.points).toHaveLength(7);
    expect(forecast.averageDailyRevenue.toDecimalPlaces(0).toString()).toBe("100000");
    // Margen histórico: 20.000 / 100.000
    expect(forecast.marginRate.toString()).toBe("0.2");
    expect(forecast.points[0]!.contribution.toDecimalPlaces(0).toString()).toBe("20000");
  });

  it("los escenarios mueven la proyección hacia arriba y hacia abajo", () => {
    const options = {
      horizonDays: 7,
      useDayOfWeek: false,
      useTrend: false,
      today: parseDateKey("2026-08-30"),
    } as const;

    const conservative = calculateSalesForecast(history, { ...options, scenario: "CONSERVATIVE" });
    const base = calculateSalesForecast(history, { ...options, scenario: "BASE" });
    const optimistic = calculateSalesForecast(history, { ...options, scenario: "OPTIMISTIC" });

    expect(conservative.points[0]!.revenue.lessThan(base.points[0]!.revenue)).toBe(true);
    expect(optimistic.points[0]!.revenue.greaterThan(base.points[0]!.revenue)).toBe(true);
    expect(conservative.points[0]!.revenue.toDecimalPlaces(0).toString()).toBe("80000");
  });

  it("acepta un multiplicador manual", () => {
    const forecast = calculateSalesForecast(history, {
      horizonDays: 3,
      scenario: "BASE",
      scenarioMultiplier: 1.5,
      useDayOfWeek: false,
      useTrend: false,
      today: parseDateKey("2026-08-30"),
    });
    expect(forecast.points[0]!.revenue.toDecimalPlaces(0).toString()).toBe("150000");
  });

  it("no proyecta nada sin historial, y lo dice", () => {
    const forecast = calculateSalesForecast([], { horizonDays: 30, scenario: "BASE" });
    expect(forecast.points).toHaveLength(0);
    expect(forecast.confidence).toBe("BAJA");
    expect(forecast.assumptions[0]).toContain("Sin historial");
  });

  it("baja la confianza a medida que crece el horizonte", () => {
    const short = calculateSalesForecast(history, { horizonDays: 7, scenario: "BASE" });
    const long = calculateSalesForecast(history, { horizonDays: 90, scenario: "BASE" });
    expect(short.confidence).toBe("ALTA");
    expect(long.confidence).toBe("MEDIA");
  });

  it("nunca proyecta facturación negativa aunque la tendencia sea fuertemente bajista", () => {
    const declining = Array.from({ length: 20 }, (_, i) => ({
      date: parseDateKey(`2026-08-${String(i + 1).padStart(2, "0")}`),
      revenue: money(Math.max(200_000 - i * 10_000, 0)),
      contribution: money(0),
    }));

    const forecast = calculateSalesForecast(declining, {
      horizonDays: 60,
      scenario: "BASE",
      today: parseDateKey("2026-08-20"),
    });

    expect(forecast.points.every((point) => !point.revenue.isNegative())).toBe(true);
  });

  it("expone los supuestos usados", () => {
    const forecast = calculateSalesForecast(history, {
      horizonDays: 15,
      scenario: "CONSERVATIVE",
    });
    expect(forecast.assumptions.join(" ")).toContain("Margen histórico");
    expect(forecast.assumptions.join(" ")).toContain("CONSERVATIVE");
    expect(forecast.model).toBe("weighted-average-v1");
  });
});
