import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { parseDateKey } from "@/lib/dates";
import { reconciliationFreshness, reconstructBalance } from "@/financial-engine";
import type { BalanceMovementInput } from "@/financial-engine/balance";

/**
 * El saldo de Mercado Pago se reconstruye de los reportes oficiales porque no
 * existe un endpoint público de saldo en vivo. Estos tests fijan ese contrato:
 * el número tiene que ser reproducible y estar etiquetado como conciliado.
 */

const movement = (
  date: string,
  recordType: BalanceMovementInput["recordType"],
  overrides: Partial<BalanceMovementInput> = {},
): BalanceMovementInput => ({
  date: parseDateKey(date),
  recordType,
  netCreditAmount: money(0),
  netDebitAmount: money(0),
  balanceAmount: null,
  ...overrides,
});

describe("saldo conciliado de Mercado Pago", () => {
  it("usa el último saldo informado como ancla y le suma lo posterior", () => {
    const result = reconstructBalance({
      movements: [
        movement("2026-08-25", "AVAILABLE_BALANCE", { balanceAmount: money(1_000_000) }),
        movement("2026-08-26", "RELEASE", { netCreditAmount: money(250_000) }),
        movement("2026-08-27", "RELEASE", { netDebitAmount: money(80_000) }),
      ],
      pendingReleases: [],
      today: parseDateKey("2026-08-28"),
    });

    expect(result.available.toString()).toBe("1170000");
    expect(result.label).toBe("Saldo conciliado");
    expect(result.hasReport).toBe(true);
  });

  it("ignora las filas TOTAL, que son subtotales del reporte y no dinero", () => {
    const result = reconstructBalance({
      movements: [
        movement("2026-08-25", "AVAILABLE_BALANCE", { balanceAmount: money(500_000) }),
        movement("2026-08-26", "TOTAL", { netCreditAmount: money(9_999_999) }),
      ],
      pendingReleases: [],
      today: parseDateKey("2026-08-28"),
    });

    expect(result.available.toString()).toBe("500000");
  });

  it("no cuenta dos veces el ancla cuando hay varios saldos informados", () => {
    const result = reconstructBalance({
      movements: [
        movement("2026-08-20", "AVAILABLE_BALANCE", { balanceAmount: money(300_000) }),
        movement("2026-08-25", "AVAILABLE_BALANCE", { balanceAmount: money(1_000_000) }),
        movement("2026-08-26", "RELEASE", { netCreditAmount: money(50_000) }),
      ],
      pendingReleases: [],
      today: parseDateKey("2026-08-28"),
    });

    // Se toma el ancla más reciente, no la suma de ambas.
    expect(result.available.toString()).toBe("1050000");
  });

  it("parte del saldo inicial cuando el reporte no trae available_balance", () => {
    const result = reconstructBalance({
      movements: [
        movement("2026-08-01", "INITIAL_AVAILABLE_BALANCE", { balanceAmount: money(200_000) }),
        movement("2026-08-05", "RELEASE", { netCreditAmount: money(100_000) }),
        movement("2026-08-06", "RELEASE", { netDebitAmount: money(30_000) }),
      ],
      pendingReleases: [],
      today: parseDateKey("2026-08-10"),
    });

    expect(result.available.toString()).toBe("270000");
  });

  it("cuenta como pendiente sólo lo que se libera en el futuro", () => {
    const result = reconstructBalance({
      movements: [movement("2026-08-25", "AVAILABLE_BALANCE", { balanceAmount: money(0) })],
      pendingReleases: [
        // Ya liberado: no es pendiente.
        { releaseDate: parseDateKey("2026-08-27"), amount: money(100_000) },
        { releaseDate: parseDateKey("2026-09-05"), amount: money(300_000) },
        { releaseDate: parseDateKey("2026-09-12"), amount: money(200_000) },
      ],
      today: parseDateKey("2026-08-28"),
    });

    expect(result.pendingRelease.toString()).toBe("500000");
  });

  it("sin reporte no devuelve un saldo inventado", () => {
    const result = reconstructBalance({
      movements: [],
      pendingReleases: [],
      today: parseDateKey("2026-08-28"),
    });

    expect(result.hasReport).toBe(false);
    expect(result.available.toString()).toBe("0");
    expect(result.reconciledUntil).toBeNull();
  });

  it("expone el desglose para poder auditar el número", () => {
    const result = reconstructBalance({
      movements: [
        movement("2026-08-25", "AVAILABLE_BALANCE", { balanceAmount: money(1_000_000) }),
        movement("2026-08-26", "RELEASE", { netCreditAmount: money(250_000) }),
      ],
      pendingReleases: [],
      today: parseDateKey("2026-08-28"),
    });

    const labels = result.breakdown.map((entry) => entry.label);
    expect(labels).toContain("Saldo informado por Mercado Pago");
    expect(labels).toContain("Liberaciones posteriores");
    expect(result.breakdown.every((entry) => entry.source !== "MELI_API")).toBe(true);
  });
});

describe("frescura de la conciliación", () => {
  it("distingue al día, atrasado y sin datos", () => {
    const today = parseDateKey("2026-09-01");
    expect(reconciliationFreshness(parseDateKey("2026-09-01"), today).status).toBe("AL_DIA");
    expect(reconciliationFreshness(parseDateKey("2026-08-31"), today).status).toBe("AL_DIA");
    expect(reconciliationFreshness(parseDateKey("2026-08-20"), today).daysBehind).toBe(12);
    expect(reconciliationFreshness(parseDateKey("2026-08-20"), today).status).toBe("ATRASADO");
    expect(reconciliationFreshness(null, today).status).toBe("SIN_DATOS");
  });
});
