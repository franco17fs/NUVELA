import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Parámetros operativos configurables.
 *
 * Regla del brief (§8): cambiar un porcentaje, un umbral o el colchón mínimo
 * NUNCA puede requerir tocar código ni volver a desplegar. Todo lo que el
 * negocio ajusta con frecuencia vive acá, en `AppSetting`.
 */

export const SETTING_DEFAULTS = {
  /** Colchón mínimo de caja, en pesos. */
  safetyBuffer: "0",
  /** Días que se consideran "obligación próxima". */
  obligationHorizonDays: "15",
  /** Umbral de alerta de publicidad sobre ventas, en %. */
  adsOverSalesPct: "12",
  /** Caída de margen que dispara alerta, en puntos porcentuales. */
  marginDropPoints: "3",
  /** Suba del costo de mercadería que dispara alerta, en %. */
  costRisePct: "10",
  /** Orden de asignación del dinero (§21 del brief), configurable. */
  allocationOrder:
    "INVENTORY_REPLACEMENT,CRITICAL_OBLIGATIONS,TAX_RESERVES,OPERATING_EXPENSES,SAFETY_BUFFER,PROFIT",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(key: SettingKey, fallback?: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row && typeof row.value === "string") return row.value;
  if (row && row.value !== null && typeof row.value === "object" && "value" in row.value) {
    const inner = (row.value as { value: unknown }).value;
    if (typeof inner === "string") return inner;
  }
  return fallback ?? SETTING_DEFAULTS[key];
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getAllSettings(): Promise<Record<SettingKey, string>> {
  const rows = await prisma.appSetting.findMany();
  const map = new Map(
    rows.map((row) => [row.key, typeof row.value === "string" ? row.value : String(row.value)]),
  );

  const result = {} as Record<SettingKey, string>;
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    result[key] = map.get(key) ?? SETTING_DEFAULTS[key];
  }
  return result;
}
