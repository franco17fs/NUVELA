import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { ConfigurationError } from "@/lib/errors";
import { buildUrl, request } from "../http";

/**
 * OAuth 2.0 de Mercado Libre.
 * Referencia verificada: docs/mercadolibre-api-research.md §1.
 *
 * Puntos que definen la implementación:
 *   - El dominio de autorización es por site (Argentina: auth.mercadolibre.com.ar).
 *   - `redirect_uri` no puede llevar información variable: todo el contexto va
 *     en `state`.
 *   - El access token dura 6 horas.
 *   - El refresh token es de UN SOLO USO y devuelve uno nuevo en cada refresh.
 *   - Los únicos scopes válidos son `offline_access`, `read` y `write`.
 */

export const ML_API_BASE = "https://api.mercadolibre.com";

/** NUVELA no modifica publicaciones ni precios: sólo lee. */
export const ML_SCOPES = "offline_access read";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
  user_id: z.number(),
  refresh_token: z.string().optional(),
});

export type MlTokenResponse = z.infer<typeof tokenResponseSchema>;

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * Genera el par PKCE. Se usa `S256`; la documentación admite `plain` pero lo
 * desaconseja explícitamente por seguridad.
 */
export function generatePkce(): PkcePair {
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return base64Url(randomBytes(24));
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildAuthorizationUrl(params: { state: string; codeChallenge: string }): string {
  const env = getEnv();
  if (!env.ML_CLIENT_ID) {
    throw new ConfigurationError(
      "Falta ML_CLIENT_ID. Cargá las credenciales de la aplicación de Mercado Libre en el archivo .env.",
    );
  }

  return buildUrl(`https://${env.ML_AUTH_DOMAIN}/authorization`, {
    response_type: "code",
    client_id: env.ML_CLIENT_ID,
    redirect_uri: env.ML_REDIRECT_URI,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
}): Promise<MlTokenResponse> {
  const env = getEnv();
  requireCredentials();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.ML_CLIENT_ID,
    client_secret: env.ML_CLIENT_SECRET,
    code: params.code,
    redirect_uri: env.ML_REDIRECT_URI,
    code_verifier: params.codeVerifier,
  });

  const result = await request<unknown>({
    provider: "MERCADO_LIBRE",
    url: `${ML_API_BASE}/oauth/token`,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    rateLimitKey: "MERCADO_LIBRE:oauth",
    rateLimitPerMinute: env.ML_RATE_LIMIT_RPM,
    // Un código de autorización se usa una sola vez: reintentar con el mismo
    // código sólo produce errores. Por eso no hay reintentos acá.
    maxRetries: 0,
    userMessage: "No se pudo completar la conexión con Mercado Libre.",
  });

  return tokenResponseSchema.parse(result.data);
}

export async function refreshAccessToken(refreshToken: string): Promise<MlTokenResponse> {
  const env = getEnv();
  requireCredentials();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ML_CLIENT_ID,
    client_secret: env.ML_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const result = await request<unknown>({
    provider: "MERCADO_LIBRE",
    url: `${ML_API_BASE}/oauth/token`,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    rateLimitKey: "MERCADO_LIBRE:oauth",
    rateLimitPerMinute: env.ML_RATE_LIMIT_RPM,
    // El refresh token es de un solo uso: si el primer intento llegó al
    // servidor, reintentarlo con el mismo valor lo quema y deja la cuenta
    // desconectada. Un fallo se resuelve reconectando, no reintentando.
    maxRetries: 0,
    userMessage: "No se pudo renovar la conexión con Mercado Libre.",
  });

  return tokenResponseSchema.parse(result.data);
}

function requireCredentials(): void {
  const env = getEnv();
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    throw new ConfigurationError(
      "Faltan ML_CLIENT_ID y/o ML_CLIENT_SECRET. Son datos que tenés que generar en el DevCenter de Mercado Libre y cargar en el archivo .env.",
    );
  }
}

const meSchema = z.object({
  id: z.number(),
  nickname: z.string(),
  site_id: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

export type MlUser = z.infer<typeof meSchema>;

/** `GET /users/me`: identifica la cuenta recién conectada. */
export async function fetchAuthenticatedUser(accessToken: string): Promise<MlUser> {
  const env = getEnv();
  const result = await request<unknown>({
    provider: "MERCADO_LIBRE",
    url: `${ML_API_BASE}/users/me`,
    accessToken,
    rateLimitKey: "MERCADO_LIBRE:oauth",
    rateLimitPerMinute: env.ML_RATE_LIMIT_RPM,
    userMessage: "No se pudieron obtener los datos de la cuenta.",
  });

  return meSchema.parse(result.data);
}
