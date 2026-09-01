import { money, percentage, ZERO, type Decimal } from "@/lib/money";
import type { PeriodResult } from "./types";

/**
 * Vista consolidada de varias cuentas (§3 del brief).
 *
 * Consolidar es sumar, pero la parte importante es lo que NO se hace: nunca se
 * mezclan identificadores entre sellers. Dos cuentas pueden tener órdenes,
 * publicaciones o pagos con el mismo número; si se agregaran por ID sin
 * discriminar la cuenta, el consolidado contaría de menos.
 *
 * Por eso las claves de agregación de este módulo son siempre compuestas
 * (`sellerAccountId` + id externo), y `consolidateEntityKeys` deja explícito
 * ese contrato para poder testearlo.
 */

export interface AccountPeriodResult {
  sellerAccountId: string;
  result: PeriodResult;
}

/**
 * Suma los resultados de varias cuentas.
 * Los porcentajes se recalculan sobre los totales consolidados: promediar
 * porcentajes de cuentas de distinto tamaño daría un margen falso.
 */
export function consolidatePeriodResults(results: AccountPeriodResult[]): PeriodResult {
  const empty: PeriodResult = {
    grossRevenue: ZERO,
    netCommercialRevenue: ZERO,
    grossMargin: ZERO,
    grossMarginPct: ZERO,
    contributionMargin: ZERO,
    contributionMarginPct: ZERO,
    operatingResult: ZERO,
    operatingMarginPct: ZERO,
    totalMeliCosts: ZERO,
  };

  if (results.length === 0) return empty;

  const seen = new Set<string>();
  for (const entry of results) {
    if (seen.has(entry.sellerAccountId)) {
      throw new Error(
        `La cuenta ${entry.sellerAccountId} aparece dos veces en el consolidado: se estarían duplicando importes.`,
      );
    }
    seen.add(entry.sellerAccountId);
  }

  const totals = results.reduce<PeriodResult>(
    (acc, entry) => ({
      ...acc,
      grossRevenue: acc.grossRevenue.plus(entry.result.grossRevenue),
      netCommercialRevenue: acc.netCommercialRevenue.plus(entry.result.netCommercialRevenue),
      grossMargin: acc.grossMargin.plus(entry.result.grossMargin),
      contributionMargin: acc.contributionMargin.plus(entry.result.contributionMargin),
      operatingResult: acc.operatingResult.plus(entry.result.operatingResult),
      totalMeliCosts: acc.totalMeliCosts.plus(entry.result.totalMeliCosts),
    }),
    empty,
  );

  return {
    ...totals,
    grossMarginPct: percentage(totals.grossMargin, totals.netCommercialRevenue),
    contributionMarginPct: percentage(totals.contributionMargin, totals.netCommercialRevenue),
    operatingMarginPct: percentage(totals.operatingResult, totals.netCommercialRevenue),
  };
}

/**
 * Clave de agregación segura entre cuentas.
 * Cualquier consolidación por entidad externa (orden, publicación, pago) debe
 * usar esta función y nunca el ID externo pelado.
 */
export function scopedKey(sellerAccountId: string, externalId: string | number | bigint): string {
  return `${sellerAccountId}::${String(externalId)}`;
}

export interface ScopedAmount {
  sellerAccountId: string;
  externalId: string | number | bigint;
  amount: Decimal;
}

/**
 * Suma importes de varias cuentas deduplicando por (cuenta, id externo).
 * Si la misma entidad llega dos veces —por ejemplo, la misma orden por webhook y
 * por reconciliación— se cuenta una sola vez.
 */
export function sumScopedAmounts(entries: ScopedAmount[]): {
  total: Decimal;
  counted: number;
  duplicatesIgnored: number;
} {
  const seen = new Set<string>();
  let total = ZERO;
  let duplicatesIgnored = 0;

  for (const entry of entries) {
    const key = scopedKey(entry.sellerAccountId, entry.externalId);
    if (seen.has(key)) {
      duplicatesIgnored += 1;
      continue;
    }
    seen.add(key);
    total = total.plus(money(entry.amount));
  }

  return { total, counted: seen.size, duplicatesIgnored };
}
