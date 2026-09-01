import "server-only";
import { prisma } from "@/lib/prisma";
import type { TaxTreatment } from "@/financial-engine";
import { scopeFilter, type AccountScope } from "./accounts";

/**
 * Perfil fiscal y tratamiento de retenciones.
 *
 * ## Por qué esto existe
 *
 * El brief es explícito (§9 y §51): una retención o percepción **no es
 * automáticamente una pérdida**. Puede ser crédito fiscal (un activo a
 * recuperar), un costo definitivo, un mero movimiento de caja o una deuda
 * fiscal. Cuál de las cuatro es lo define el régimen del contribuyente, no el
 * software.
 *
 * NUVELA no actúa de contador: no decide por su cuenta. El usuario declara el
 * tratamiento en `FiscalProfile.treatments` y el motor lo aplica. Mientras no lo
 * declare, se asume `FISCAL_CREDIT`, que es el supuesto conservador: no infla
 * artificialmente el resultado contando como pérdida algo que podría recuperarse.
 */

/** Tratamiento por defecto: el conservador, hasta que el usuario declare el suyo. */
export const DEFAULT_TAX_TREATMENT: TaxTreatment = "FISCAL_CREDIT";

const VALID_TREATMENTS: TaxTreatment[] = [
  "FISCAL_CREDIT",
  "COST",
  "CASH_MOVEMENT_ONLY",
  "LIABILITY",
];

export async function getTaxTreatment(
  scope: AccountScope,
  concept = "DEFAULT",
): Promise<TaxTreatment> {
  const profile = await prisma.fiscalProfile.findFirst({
    where: {
      ...scopeFilter(scope),
      validFrom: { lte: new Date() },
      OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
    },
    orderBy: { validFrom: "desc" },
    select: { treatments: true },
  });

  if (!profile?.treatments || typeof profile.treatments !== "object") {
    return DEFAULT_TAX_TREATMENT;
  }

  const treatments = profile.treatments as Record<string, unknown>;
  const value = treatments[concept] ?? treatments.DEFAULT;

  return typeof value === "string" && VALID_TREATMENTS.includes(value as TaxTreatment)
    ? (value as TaxTreatment)
    : DEFAULT_TAX_TREATMENT;
}

export interface FiscalProfileView {
  id: string;
  accountName: string;
  condition: string;
  province: string;
  cuit: string | null;
  iibbStatus: string | null;
  sirtacStatus: string | null;
  treatments: Record<string, string>;
  validFrom: Date;
  validTo: Date | null;
}

export async function listFiscalProfiles(): Promise<FiscalProfileView[]> {
  const profiles = await prisma.fiscalProfile.findMany({
    orderBy: { validFrom: "desc" },
    include: { sellerAccount: { select: { nickname: true } } },
  });

  return profiles.map((profile) => ({
    id: profile.id,
    accountName: profile.sellerAccount.nickname,
    condition: profile.condition,
    province: profile.province,
    cuit: profile.cuit,
    iibbStatus: profile.iibbStatus,
    sirtacStatus: profile.sirtacStatus,
    treatments: (profile.treatments ?? {}) as Record<string, string>,
    validFrom: profile.validFrom,
    validTo: profile.validTo,
  }));
}
