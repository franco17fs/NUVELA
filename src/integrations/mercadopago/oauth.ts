import "server-only";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { ConfigurationError } from "@/lib/errors";
import { buildUrl, request } from "../http";

/**
 * OAuth 2.0 de Mercado Pago.
 * Referencia verificada: docs/mercadolibre-api-research.md §5.4.
 *
 * Mercado Pago tiene su propia aplicación, sus propias credenciales y su propio
 * dominio de autorización. Aunque en la práctica la cuenta de Mercado Pago sea
 * la misma persona que la de Mercado Libre, los tokens NO son intercambiables:
 * se guardan por separado, cifrados, en filas distintas de `OAuthToken`.
 *
 * Diferencia operativa importante contra Mercado Libre: acá el access token dura
 * 180 días, no 6 horas. Aun así el flujo de refresh es el mismo, porque el
 * vencimiento igual llega y no queremos que la conciliación se corte sin aviso.
 */

export const MP_API_BASE = "https://api.mercadopago.com";
export const MP_AUTH_URL = "https://auth.mercadopago.com/authorization";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
  user_id: z.number(),
  refresh_token: z.string().optional(),
  public_key: z.string().optional(),
  live_mode: z.boolean().optional(),
});

export type MpTokenResponse = z.infer<typeof tokenResponseSchema>;

export function buildMercadoPagoAuthorizationUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const env = getEnv();
  if (!env.MP_CLIENT_ID) {
    throw new ConfigurationError(
      "Falta MP_CLIENT_ID. Cargá las credenciales de la aplicación de Mercado Pago en el archivo .env.",
    );
  }

  return buildUrl(MP_AUTH_URL, {
    response_type: "code",
    client_id: env.MP_CLIENT_ID,
    redirect_uri: env.MP_REDIRECT_URI,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
}

export async function exchangeMercadoPagoCode(params: {
  code: string;
  codeVerifier: string;
}): Promise<MpTokenResponse> {
  const env = getEnv();
  requireCredentials();

  const result = await request<unknown>({
    provider: "MERCADO_PAGO",
    url: `${MP_API_BASE}/oauth/token`,
    method: "POST",
    body: {
      grant_type: "authorization_code",
      client_id: env.MP_CLIENT_ID,
      client_secret: env.MP_CLIENT_SECRET,
      code: params.code,
      redirect_uri: env.MP_REDIRECT_URI,
      code_verifier: params.codeVerifier,
    },
    rateLimitKey: "MERCADO_PAGO:oauth",
    rateLimitPerMinute: env.MP_RATE_LIMIT_RPM,
    maxRetries: 0,
    userMessage: "No se pudo completar la conexión con Mercado Pago.",
  });

  return tokenResponseSchema.parse(result.data);
}

export async function refreshMercadoPagoToken(refreshToken: string): Promise<MpTokenResponse> {
  const env = getEnv();
  requireCredentials();

  const result = await request<unknown>({
    provider: "MERCADO_PAGO",
    url: `${MP_API_BASE}/oauth/token`,
    method: "POST",
    body: {
      grant_type: "refresh_token",
      client_id: env.MP_CLIENT_ID,
      client_secret: env.MP_CLIENT_SECRET,
      refresh_token: refreshToken,
    },
    rateLimitKey: "MERCADO_PAGO:oauth",
    rateLimitPerMinute: env.MP_RATE_LIMIT_RPM,
    maxRetries: 0,
    userMessage: "No se pudo renovar la conexión con Mercado Pago.",
  });

  return tokenResponseSchema.parse(result.data);
}

function requireCredentials(): void {
  const env = getEnv();
  if (!env.MP_CLIENT_ID || !env.MP_CLIENT_SECRET) {
    throw new ConfigurationError(
      "Faltan MP_CLIENT_ID y/o MP_CLIENT_SECRET. Son las credenciales de tu aplicación de Mercado Pago; cargalas en el archivo .env.",
    );
  }
}
