"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { money } from "@/lib/money";
import { toUserMessage } from "@/lib/errors";
import { setSetting, SETTING_DEFAULTS, type SettingKey } from "../queries/settings";
import type { ActionResult } from "./manual-entries";

/**
 * Guardado de los parámetros del negocio.
 *
 * Cada valor se valida según su significado: un colchón mínimo no puede ser
 * negativo, un horizonte de vencimientos no puede ser cero días, y un umbral de
 * alerta tiene que ser un porcentaje razonable. Sin esto, un tipeo convertiría
 * el disponible seguro en un número absurdo sin ningún aviso.
 */
const schema = z.object({
  safetyBuffer: z
    .string()
    .refine((value) => !money(value).isNegative(), "El colchón mínimo no puede ser negativo"),
  obligationHorizonDays: z
    .string()
    .refine((value) => Number(value) >= 1 && Number(value) <= 365, "Entre 1 y 365 días"),
  adsOverSalesPct: z
    .string()
    .refine((value) => Number(value) >= 0 && Number(value) <= 100, "Entre 0 y 100"),
  marginDropPoints: z
    .string()
    .refine((value) => Number(value) >= 0 && Number(value) <= 100, "Entre 0 y 100"),
  costRisePct: z
    .string()
    .refine((value) => Number(value) >= 0 && Number(value) <= 100, "Entre 0 y 100"),
});

export async function saveSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = schema.parse(Object.fromEntries(formData));

    for (const [key, value] of Object.entries(parsed)) {
      if (key in SETTING_DEFAULTS) {
        await setSetting(key as SettingKey, String(value));
      }
    }

    // Los parámetros afectan casi todas las pantallas: el colchón mínimo entra
    // en el disponible seguro, el horizonte en las obligaciones y el cashflow.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Revisá los valores." };
    }
    return { ok: false, error: toUserMessage(error) };
  }
}
