import "server-only";
import { z } from "zod";
import type { MercadoPagoClient } from "./client";

/**
 * Reportes oficiales de Mercado Pago.
 * Referencia verificada: docs/mercadolibre-api-research.md §5.2.
 *
 * Dos reportes, con el mismo juego de endpoints:
 *   - `release_report`    Liberaciones / Liquidaciones → reconstruye el SALDO
 *   - `settlement_report` Todas las transacciones      → concilia los MOVIMIENTOS
 *
 * Generar un reporte es asíncrono: se pide, se consulta la tarea hasta que
 * termina y recién ahí se descarga el archivo.
 */

export type ReportKind = "release_report" | "settlement_report";

const taskSchema = z.object({
  id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : String(v))),
  status: z.string().nullish(),
  file_name: z.string().nullish(),
});

const reportListSchema = z.array(
  z.object({
    id: z.union([z.number(), z.string()]).transform((v) => String(v)),
    file_name: z.string(),
    date_created: z.string().nullish(),
    begin_date: z.string().nullish(),
    end_date: z.string().nullish(),
    is_test: z.boolean().nullish(),
  }),
);

/**
 * Columnas que pedimos.
 *
 * `RECORD_TYPE` y `BALANCE_AMOUNT` son las que permiten reconstruir el saldo;
 * el resto alimenta la conciliación de cargos, impuestos y envíos.
 */
export const RELEASE_REPORT_COLUMNS = [
  "DATE",
  "SOURCE_ID",
  "EXTERNAL_REFERENCE",
  "RECORD_TYPE",
  "DESCRIPTION",
  "NET_CREDIT_AMOUNT",
  "NET_DEBIT_AMOUNT",
  "GROSS_AMOUNT",
  "BALANCE_AMOUNT",
  "SETTLEMENT_NET_AMOUNT",
  "MP_FEE_AMOUNT",
  "FINANCING_FEE_AMOUNT",
  "SHIPPING_FEE_AMOUNT",
  "EFFECTIVE_COUPON_AMOUNT",
  "TAXES_AMOUNT",
  "TAX_DETAIL",
  "TAXES_DISAGGREGATED",
  "INSTALLMENTS",
  "PAYMENT_METHOD",
  "ORDER_ID",
  "SHIPPING_ID",
  "SHIPMENT_MODE",
  "PACK_ID",
  "ITEM_ID",
  "TRANSACTION_APPROVAL_DATE",
] as const;

export async function getReportConfig(
  client: MercadoPagoClient,
  kind: ReportKind,
): Promise<unknown> {
  return client.get<unknown>(`/v1/account/${kind}/config`);
}

/** Pide la generación del reporte para un rango. Devuelve la tarea a consultar. */
export async function createReport(
  client: MercadoPagoClient,
  kind: ReportKind,
  params: { beginDate: Date; endDate: Date },
) {
  const raw = await client.post<unknown>(`/v1/account/${kind}`, {
    begin_date: params.beginDate.toISOString(),
    end_date: params.endDate.toISOString(),
  });

  return taskSchema.parse(raw);
}

export async function getReportTask(client: MercadoPagoClient, kind: ReportKind, taskId: string) {
  const raw = await client.get<unknown>(`/v1/account/${kind}/task/${taskId}`);
  return taskSchema.parse(raw);
}

export async function listReports(client: MercadoPagoClient, kind: ReportKind) {
  const raw = await client.get<unknown>(`/v1/account/${kind}/list`);
  return reportListSchema.parse(raw);
}

/** Descarga el archivo del reporte. Llega como CSV. */
export async function downloadReport(
  client: MercadoPagoClient,
  kind: ReportKind,
  fileName: string,
): Promise<string> {
  return client.get<string>(`/v1/account/${kind}/${fileName}`);
}

// -----------------------------------------------------------------------------
// Parseo del CSV
// -----------------------------------------------------------------------------

export interface ReportRow {
  [column: string]: string;
}

/**
 * Parser de CSV con comillas.
 *
 * No se usa `split(",")`: la columna `TAXES_DISAGGREGATED` viene en JSON, que
 * contiene comas y comillas dentro del propio valor. Un split ingenuo correría
 * todas las columnas siguientes y el saldo saldría mal.
 */
export function parseReportCsv(csv: string): ReportRow[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];

  const header = rows[0] ?? [];
  return rows.slice(1).map((cells) => {
    const row: ReportRow = {};
    header.forEach((column, index) => {
      row[column.trim()] = (cells[index] ?? "").trim();
    });
    return row;
  });
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];

    if (inQuotes) {
      if (char === '"') {
        // Comilla escapada dentro de un valor entrecomillado.
        if (csv[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}
