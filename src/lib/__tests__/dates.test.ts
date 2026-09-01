import { describe, expect, it } from "vitest";
import {
  addMonths,
  businessDateKey,
  dateKey,
  daysUntil,
  endOfBusinessDay,
  fortnightOf,
  fortnightRange,
  monthAlignedWeeks,
  parseDateKey,
  previousFortnight,
  previousPeriod,
  resolvePeriod,
  startOfBusinessDay,
} from "@/lib/dates";

const TZ = "America/Argentina/Buenos_Aires";

describe("fecha de negocio", () => {
  it("una venta de la noche del 31 pertenece a ese mes, no al siguiente", () => {
    // 31/08/2026 22:30 en Buenos Aires = 01/09/2026 01:30 UTC
    const instant = new Date("2026-09-01T01:30:00.000Z");
    expect(businessDateKey(instant, TZ)).toBe("2026-08-31");
  });

  it("una venta de la madrugada pertenece al día local correcto", () => {
    // 01/09/2026 00:30 en Buenos Aires = 01/09/2026 03:30 UTC
    const instant = new Date("2026-09-01T03:30:00.000Z");
    expect(businessDateKey(instant, TZ)).toBe("2026-09-01");
  });

  it("convierte un día de negocio a la ventana UTC que se manda a la API", () => {
    const day = parseDateKey("2026-09-01");
    expect(startOfBusinessDay(day, TZ).toISOString()).toBe("2026-09-01T03:00:00.000Z");
    // El fin es exclusivo: es el inicio del día siguiente.
    expect(endOfBusinessDay(day, TZ).toISOString()).toBe("2026-09-02T03:00:00.000Z");
  });
});

describe("aritmética UTC de fechas de negocio", () => {
  it("no corre el mes al operar sobre medianoche UTC", () => {
    // Este es el bug que la aritmética local de date-fns produciría en un
    // servidor con TZ negativa.
    const first = parseDateKey("2026-09-01");
    expect(dateKey(first)).toBe("2026-09-01");
    expect(first.getUTCMonth()).toBe(8);
  });

  it("clampea el día al sumar meses", () => {
    expect(dateKey(addMonths(parseDateKey("2026-01-31"), 1))).toBe("2026-02-28");
    expect(dateKey(addMonths(parseDateKey("2024-01-31"), 1))).toBe("2024-02-29");
  });
});

describe("períodos", () => {
  const reference = parseDateKey("2026-09-18");

  it("resuelve los presets del brief", () => {
    expect(dateKey(resolvePeriod("today", { reference }).from)).toBe("2026-09-18");
    expect(dateKey(resolvePeriod("yesterday", { reference }).to)).toBe("2026-09-17");

    const last7 = resolvePeriod("last7", { reference });
    expect(dateKey(last7.from)).toBe("2026-09-12");
    expect(dateKey(last7.to)).toBe("2026-09-18");

    const firstHalf = resolvePeriod("first-half", { reference });
    expect(dateKey(firstHalf.from)).toBe("2026-09-01");
    expect(dateKey(firstHalf.to)).toBe("2026-09-15");

    const secondHalf = resolvePeriod("second-half", { reference });
    expect(dateKey(secondHalf.from)).toBe("2026-09-16");
    expect(dateKey(secondHalf.to)).toBe("2026-09-30");

    const lastMonth = resolvePeriod("last-month", { reference });
    expect(dateKey(lastMonth.from)).toBe("2026-08-01");
    expect(dateKey(lastMonth.to)).toBe("2026-08-31");
  });

  it("el período anterior tiene la misma duración", () => {
    const period = resolvePeriod("last15", { reference });
    const previous = previousPeriod(period);
    expect(dateKey(previous.from)).toBe("2026-08-20");
    expect(dateKey(previous.to)).toBe("2026-09-03");
  });
});

describe("quincenas", () => {
  it("clasifica correctamente", () => {
    expect(fortnightOf(parseDateKey("2026-09-15"))).toBe(1);
    expect(fortnightOf(parseDateKey("2026-09-16"))).toBe(2);
  });

  it("la quincena anterior a la segunda es la primera del mismo mes", () => {
    const previous = previousFortnight(parseDateKey("2026-09-20"));
    expect(dateKey(previous.from)).toBe("2026-09-01");
    expect(dateKey(previous.to)).toBe("2026-09-15");
  });

  it("la quincena anterior a la primera es la segunda del mes previo", () => {
    const previous = previousFortnight(parseDateKey("2026-09-05"));
    expect(dateKey(previous.from)).toBe("2026-08-16");
    expect(dateKey(previous.to)).toBe("2026-08-31");
  });

  it("devuelve el rango de la quincena en curso", () => {
    const range = fortnightRange(parseDateKey("2026-09-20"));
    expect(dateKey(range.from)).toBe("2026-09-16");
    expect(dateKey(range.to)).toBe("2026-09-30");
  });
});

describe("semanas alineadas al mes para el cashflow", () => {
  it("produce los tramos 1-7, 8-14, 15-21, 22-fin", () => {
    const weeks = monthAlignedWeeks({
      from: parseDateKey("2026-09-01"),
      to: parseDateKey("2026-09-30"),
    });

    expect(weeks.map((w) => w.label)).toEqual([
      "01-07 Sep",
      "08-14 Sep",
      "15-21 Sep",
      "22-30 Sep",
    ]);
    expect(dateKey(weeks[3]!.to)).toBe("2026-09-30");
  });

  it("respeta un rango que empieza a mitad de semana", () => {
    const weeks = monthAlignedWeeks({
      from: parseDateKey("2026-09-04"),
      to: parseDateKey("2026-09-16"),
    });

    expect(weeks.map((w) => w.label)).toEqual(["04-07 Sep", "08-14 Sep", "15-16 Sep"]);
  });

  it("cruza de mes sin perder días", () => {
    const weeks = monthAlignedWeeks({
      from: parseDateKey("2026-09-28"),
      to: parseDateKey("2026-10-05"),
    });

    expect(weeks[0]!.label).toBe("28-30 Sep");
    expect(dateKey(weeks[1]!.from)).toBe("2026-10-01");
  });
});

describe("días hasta el vencimiento", () => {
  it("cuenta bien y distingue vencido de vence hoy", () => {
    const today = parseDateKey("2026-09-05");
    expect(daysUntil(parseDateKey("2026-09-20"), today)).toBe(15);
    expect(daysUntil(parseDateKey("2026-09-05"), today)).toBe(0);
    expect(daysUntil(parseDateKey("2026-09-01"), today)).toBe(-4);
  });
});
