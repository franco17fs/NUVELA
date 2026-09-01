import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { parseDateKey } from "@/lib/dates";
import {
  allocateCash,
  DEFAULT_ALLOCATION_ORDER,
  deriveObligationStatus,
  obligationsWithinHorizon,
  uncoveredAmount,
  type AllocationBucket,
} from "@/financial-engine";
import type { ObligationInput } from "@/financial-engine/types";

const TODAY = parseDateKey("2026-09-01");

function obligation(overrides: Partial<ObligationInput> = {}): ObligationInput {
  return {
    id: "ob-1",
    description: "Obligación",
    amount: money(100_000),
    reservedAmount: money(0),
    paidAmount: money(0),
    dueDate: parseDateKey("2026-09-20"),
    priority: "NORMAL",
    ...overrides,
  };
}

describe("estado derivado de una obligación", () => {
  it("sin reservas ni pagos y con vencimiento futuro es PRÓXIMA", () => {
    expect(deriveObligationStatus(obligation(), TODAY)).toBe("UPCOMING");
  });

  it("con algo reservado pero no todo es PARCIALMENTE RESERVADA", () => {
    expect(
      deriveObligationStatus(obligation({ reservedAmount: money(30_000) }), TODAY),
    ).toBe("PARTIALLY_RESERVED");
  });

  it("con lo reservado igual al monto es CUBIERTA", () => {
    expect(
      deriveObligationStatus(obligation({ reservedAmount: money(100_000) }), TODAY),
    ).toBe("COVERED");
  });

  it("con el monto pagado es PAGADA, aunque haya vencido", () => {
    expect(
      deriveObligationStatus(
        obligation({ paidAmount: money(100_000), dueDate: parseDateKey("2026-08-01") }),
        TODAY,
      ),
    ).toBe("PAID");
  });

  it("vencida e impaga es VENCIDA, aunque tenga algo reservado", () => {
    expect(
      deriveObligationStatus(
        obligation({ dueDate: parseDateKey("2026-08-20"), reservedAmount: money(50_000) }),
        TODAY,
      ),
    ).toBe("OVERDUE");
  });

  it("que vence hoy todavía no está vencida", () => {
    expect(deriveObligationStatus(obligation({ dueDate: TODAY }), TODAY)).toBe("UPCOMING");
  });
});

describe("monto no cubierto", () => {
  it("descuenta reservado y pagado", () => {
    expect(
      uncoveredAmount(
        obligation({ reservedAmount: money(30_000), paidAmount: money(20_000) }),
      ).toString(),
    ).toBe("50000");
  });

  it("nunca es negativo aunque se haya reservado de más", () => {
    expect(uncoveredAmount(obligation({ reservedAmount: money(150_000) })).toString()).toBe("0");
  });
});

describe("obligaciones dentro del horizonte", () => {
  const obligations = [
    obligation({ id: "vencida", dueDate: parseDateKey("2026-08-25") }),
    obligation({ id: "cerca", dueDate: parseDateKey("2026-09-05") }),
    obligation({ id: "lejos", dueDate: parseDateKey("2026-10-30") }),
    obligation({ id: "cubierta", dueDate: parseDateKey("2026-09-03"), reservedAmount: money(100_000) }),
  ];

  it("incluye las vencidas: siguen siendo plata que se debe", () => {
    const result = obligationsWithinHorizon(obligations, 15, TODAY);
    expect(result.map((item) => item.id)).toContain("vencida");
  });

  it("excluye las que están fuera del horizonte y las ya cubiertas", () => {
    const result = obligationsWithinHorizon(obligations, 15, TODAY);
    expect(result.map((item) => item.id)).not.toContain("lejos");
    expect(result.map((item) => item.id)).not.toContain("cubierta");
  });

  it("las devuelve ordenadas por vencimiento", () => {
    const result = obligationsWithinHorizon(obligations, 15, TODAY);
    expect(result.map((item) => item.id)).toEqual(["vencida", "cerca"]);
  });
});

describe("orden de asignación del dinero (§21)", () => {
  const buckets: AllocationBucket[] = DEFAULT_ALLOCATION_ORDER.map((id, index) => ({
    id,
    label: id,
    order: index,
    needed:
      id === "INVENTORY_REPLACEMENT"
        ? money(500_000)
        : id === "CRITICAL_OBLIGATIONS"
          ? money(400_000)
          : id === "TAX_RESERVES"
            ? money(250_000)
            : id === "OPERATING_EXPENSES"
              ? money(150_000)
              : id === "SAFETY_BUFFER"
                ? money(200_000)
                : null,
  }));

  it("cubre los bolsillos en orden y deja el resto como ganancia", () => {
    const result = allocateCash(money(2_000_000), buckets);
    const byId = new Map(result.map((entry) => [entry.id, entry]));

    expect(byId.get("INVENTORY_REPLACEMENT")?.allocated.toString()).toBe("500000");
    expect(byId.get("SAFETY_BUFFER")?.allocated.toString()).toBe("200000");
    // 2.000.000 − 1.500.000 de bolsillos
    expect(byId.get("PROFIT")?.allocated.toString()).toBe("500000");
  });

  it("cuando no alcanza, deja explícito CUÁL bolsillo queda descubierto", () => {
    const result = allocateCash(money(900_000), buckets);
    const byId = new Map(result.map((entry) => [entry.id, entry]));

    // La reposición de mercadería se cubre primero, por prelación.
    expect(byId.get("INVENTORY_REPLACEMENT")?.shortfall.toString()).toBe("0");
    // Las obligaciones críticas quedan cortas: 400.000 pedidos, 400.000 disponibles.
    expect(byId.get("CRITICAL_OBLIGATIONS")?.allocated.toString()).toBe("400000");
    // Y de ahí para abajo no queda nada.
    expect(byId.get("TAX_RESERVES")?.allocated.toString()).toBe("0");
    expect(byId.get("TAX_RESERVES")?.shortfall.toString()).toBe("250000");
    expect(byId.get("PROFIT")?.allocated.toString()).toBe("0");
  });

  it("con saldo negativo no asigna nada", () => {
    const result = allocateCash(money(-100_000), buckets);
    expect(result.every((entry) => entry.allocated.isZero())).toBe(true);
  });
});
