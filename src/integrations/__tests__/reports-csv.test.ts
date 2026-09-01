import { describe, expect, it } from "vitest";
import { parseReportCsv } from "@/integrations/mercadopago/reports";
import { backoffDelay, parseRetryAfter } from "@/integrations/rate-limiter";
import { safeEndpoint } from "@/integrations/http";
import { toHourPrecision } from "@/integrations/mercadolibre/orders";
import { clampToAdsWindow } from "@/integrations/mercadolibre/ads";
import { parseDateKey, dateKey } from "@/lib/dates";

describe("parser del CSV de reportes de Mercado Pago", () => {
  it("parsea encabezado y filas", () => {
    const csv = [
      "DATE,SOURCE_ID,RECORD_TYPE,NET_CREDIT_AMOUNT,BALANCE_AMOUNT",
      "2026-08-25,123456,available_balance,0,1000000",
      "2026-08-26,123457,release,250000,1250000",
    ].join("\n");

    const rows = parseReportCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.RECORD_TYPE).toBe("available_balance");
    expect(rows[1]!.NET_CREDIT_AMOUNT).toBe("250000");
  });

  it("no rompe con la columna TAXES_DISAGGREGATED, que trae JSON con comas", () => {
    // Un split(",") ingenuo correría todas las columnas siguientes y el saldo
    // saldría mal: por eso el parser respeta las comillas.
    const csv = [
      "SOURCE_ID,TAXES_DISAGGREGATED,BALANCE_AMOUNT",
      '123456,"[{""type"":""IIBB"",""amount"":150.50},{""type"":""IVA"",""amount"":21}]",1000000',
    ].join("\n");

    const rows = parseReportCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.BALANCE_AMOUNT).toBe("1000000");
    expect(rows[0]!.TAXES_DISAGGREGATED).toContain('"type":"IIBB"');
    expect(JSON.parse(rows[0]!.TAXES_DISAGGREGATED!)).toHaveLength(2);
  });

  it("tolera saltos de línea Windows y filas vacías", () => {
    const csv = "A,B\r\n1,2\r\n\r\n3,4\r\n";
    const rows = parseReportCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.A).toBe("3");
  });

  it("devuelve lista vacía con un archivo vacío", () => {
    expect(parseReportCsv("")).toEqual([]);
  });
});

describe("backoff y rate limit", () => {
  it("el backoff crece con los intentos y se topea", () => {
    const first = backoffDelay(0, 1000, 30000);
    const later = backoffDelay(6, 1000, 30000);
    expect(first).toBeLessThan(later);
    expect(later).toBeLessThanOrEqual(30000);
  });

  it("interpreta Retry-After en segundos y como fecha", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("no-es-una-fecha")).toBeNull();
    const future = new Date(Date.now() + 5000).toUTCString();
    expect(parseRetryAfter(future)).toBeGreaterThan(0);
  });
});

describe("higiene de logs", () => {
  it("el endpoint registrado descarta la query string", () => {
    // Algunos recursos legacy aceptan access_token por query: nunca debe
    // terminar en un log.
    expect(safeEndpoint("https://api.mercadolibre.com/packs/1/notes?access_token=APP_USR-secreto")).toBe(
      "https://api.mercadolibre.com/packs/1/notes",
    );
    expect(safeEndpoint("no es una url")).toBe("url-invalida");
  });
});

describe("filtros de fecha de órdenes", () => {
  it("trunca a la hora, porque la API descarta minutos y segundos", () => {
    const formatted = toHourPrecision(new Date("2026-09-01T14:37:52.123Z"));
    expect(formatted).toBe("2026-09-01T14:00:00.000-00:00");
  });

  it("devuelve undefined sin fecha", () => {
    expect(toHourPrecision(undefined)).toBeUndefined();
  });
});

describe("ventana de métricas de publicidad", () => {
  const today = parseDateKey("2026-09-01");

  it("recorta a los 90 días que devuelve la API y lo informa", () => {
    const result = clampToAdsWindow(
      { from: parseDateKey("2026-01-01"), to: today },
      today,
    );

    expect(result.truncated).toBe(true);
    expect(dateKey(result.range.from)).toBe("2026-06-03");
  });

  it("no toca un rango que ya está dentro de la ventana", () => {
    const result = clampToAdsWindow(
      { from: parseDateKey("2026-08-25"), to: today },
      today,
    );

    expect(result.truncated).toBe(false);
    expect(dateKey(result.range.from)).toBe("2026-08-25");
  });
});
