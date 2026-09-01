import "server-only";
import { prisma } from "@/lib/prisma";
import { lastSyncByType } from "../sync/sync-job";

/**
 * Selección de cuenta (§3 del brief).
 *
 * Toda consulta del sistema recibe un `AccountScope`. `CONSOLIDATED` no es
 * "todas las cuentas mezcladas": es la suma de cuentas, con las claves de
 * agregación siempre incluyendo el `sellerAccountId`, para que dos sellers con
 * el mismo número de orden no se pisen.
 */

export type AccountScope =
  | { kind: "CONSOLIDATED" }
  | { kind: "ACCOUNT"; sellerAccountId: string };

export function parseAccountScope(value: string | null | undefined): AccountScope {
  if (!value || value === "consolidado") return { kind: "CONSOLIDATED" };
  return { kind: "ACCOUNT", sellerAccountId: value };
}

export function scopeToParam(scope: AccountScope): string {
  return scope.kind === "CONSOLIDATED" ? "consolidado" : scope.sellerAccountId;
}

/** Filtro Prisma correspondiente al alcance elegido. */
export function scopeFilter(scope: AccountScope): { sellerAccountId?: string } {
  return scope.kind === "CONSOLIDATED" ? {} : { sellerAccountId: scope.sellerAccountId };
}

export interface AccountSummary {
  id: string;
  nickname: string;
  accountName: string;
  colorHex: string;
  status: string;
  hasMercadoPago: boolean;
  siteId: string;
}

export async function listAccounts(): Promise<AccountSummary[]> {
  const accounts = await prisma.sellerAccount.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      nickname: true,
      accountName: true,
      colorHex: true,
      status: true,
      siteId: true,
      tokens: { select: { provider: true } },
    },
  });

  return accounts.map((account) => ({
    id: account.id,
    nickname: account.nickname,
    accountName: account.accountName,
    colorHex: account.colorHex,
    status: account.status,
    siteId: account.siteId,
    hasMercadoPago: account.tokens.some((token) => token.provider === "MERCADO_PAGO"),
  }));
}

export interface SyncStatusRow {
  accountId: string;
  accountName: string;
  colorHex: string;
  entries: { type: string; label: string; lastRun: Date | null; status: string }[];
}

const SYNC_LABELS: Record<string, string> = {
  ORDERS_INCREMENTAL: "Ventas",
  ORDERS_BACKFILL: "Importación histórica",
  PAYMENTS: "Mercado Pago",
  ADS_DAILY: "Publicidad",
  BILLING: "Facturación",
  MP_MOVEMENTS: "Movimientos",
  MP_REPORT: "Reportes",
  RECONCILIATION: "Conciliación",
};

/**
 * Estado de sincronización por cuenta (§42 del brief).
 *
 * Incluye los fallos: si la publicidad no pudo actualizarse, se muestra ese
 * renglón en rojo y el resto del dashboard sigue funcionando.
 */
export async function getSyncStatus(): Promise<SyncStatusRow[]> {
  const accounts = await prisma.sellerAccount.findMany({
    where: { status: { not: "DISCONNECTED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, nickname: true, colorHex: true },
  });

  const rows: SyncStatusRow[] = [];

  for (const account of accounts) {
    const jobs = await lastSyncByType(account.id);
    const failed = await prisma.syncJob.findMany({
      where: { sellerAccountId: account.id, status: "FAILED" },
      orderBy: { startedAt: "desc" },
      distinct: ["type"],
      select: { type: true, startedAt: true, errorMessage: true },
    });

    const entries = [...jobs].map((job) => ({
      type: job.type as string,
      label: SYNC_LABELS[job.type] ?? job.type,
      lastRun: job.finishedAt ?? job.startedAt,
      status: job.status as string,
    }));

    // Un tipo que sólo tiene corridas fallidas también tiene que aparecer.
    for (const failure of failed) {
      if (!entries.some((entry) => entry.type === failure.type)) {
        entries.push({
          type: failure.type as string,
          label: SYNC_LABELS[failure.type] ?? failure.type,
          lastRun: failure.startedAt,
          status: "FAILED",
        });
      }
    }

    rows.push({
      accountId: account.id,
      accountName: account.nickname,
      colorHex: account.colorHex,
      entries,
    });
  }

  return rows;
}
