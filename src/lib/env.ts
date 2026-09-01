import "server-only";
import { z } from "zod";

/**
 * Validación de configuración. Se ejecuta una sola vez, en el servidor.
 *
 * Regla del proyecto: ningún secreto llega jamás al cliente. Este módulo importa
 * `server-only`, así que cualquier intento de usarlo desde un componente de
 * cliente rompe el build en vez de filtrar credenciales en silencio.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),

  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY es obligatoria")
    .refine(
      (value) => {
        try {
          return Buffer.from(value, "base64").length === 32;
        } catch {
          return false;
        }
      },
      'ENCRYPTION_KEY debe ser 32 bytes en base64: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    ),

  ML_CLIENT_ID: z.string().default(""),
  ML_CLIENT_SECRET: z.string().default(""),
  ML_REDIRECT_URI: z.string().default("http://localhost:3000/api/oauth/mercadolibre/callback"),
  ML_AUTH_DOMAIN: z.string().default("auth.mercadolibre.com.ar"),
  ML_SITE_ID: z.string().default("MLA"),
  ML_WEBHOOK_SECRET: z.string().default(""),
  ML_WEBHOOK_ALLOWED_IPS: z.string().default(""),
  ML_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(60),

  MP_CLIENT_ID: z.string().default(""),
  MP_CLIENT_SECRET: z.string().default(""),
  MP_REDIRECT_URI: z.string().default("http://localhost:3000/api/oauth/mercadopago/callback"),
  MP_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(60),

  APP_BASE_URL: z.string().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("America/Argentina/Buenos_Aires"),
  CRON_SECRET: z.string().default(""),
  REPORTS_STORAGE_DIR: z.string().default("./storage/reports"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Los mensajes nombran la variable, nunca su valor.
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuración inválida en .env:\n${problems}`);
  }

  cached = parsed.data;
  return cached;
}

/** Credenciales de Mercado Libre presentes: habilita el flujo OAuth en la UI. */
export function hasMercadoLibreCredentials(): boolean {
  const env = getEnv();
  return env.ML_CLIENT_ID.length > 0 && env.ML_CLIENT_SECRET.length > 0;
}

/** Credenciales de Mercado Pago presentes. */
export function hasMercadoPagoCredentials(): boolean {
  const env = getEnv();
  return env.MP_CLIENT_ID.length > 0 && env.MP_CLIENT_SECRET.length > 0;
}

export function webhookAllowedIps(): string[] {
  return getEnv()
    .ML_WEBHOOK_ALLOWED_IPS.split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}
