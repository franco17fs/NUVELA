import "server-only";
import { IntegrationError } from "@/lib/errors";
import { backoffDelay, parseRetryAfter, rateLimiter, sleep } from "./rate-limiter";

/**
 * Cliente HTTP común a Mercado Libre y Mercado Pago.
 *
 * Responsabilidades:
 *   - respetar el límite de requests por cuenta;
 *   - reintentar con backoff exponencial + jitter ante 429 y 5xx;
 *   - honrar `Retry-After` cuando el servidor lo manda;
 *   - contar los 429 para poder calibrar el límite con evidencia;
 *   - **nunca** dejar que un token o el cuerpo crudo de un error lleguen al log
 *     o al usuario.
 */

export type Provider = "MERCADO_LIBRE" | "MERCADO_PAGO";

export interface RequestOptions {
  provider: Provider;
  /** URL absoluta. */
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  accessToken?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Clave del limitador: normalmente `${provider}:${sellerAccountId}`. */
  rateLimitKey: string;
  rateLimitPerMinute: number;
  maxRetries?: number;
  /** Mensaje mostrado al usuario si todo falla. */
  userMessage?: string;
  signal?: AbortSignal;
}

export interface RequestResult<T> {
  data: T;
  status: number;
  /** Cuántos 429 se recibieron durante esta llamada (incluye los reintentados). */
  rateLimitHits: number;
}

export async function request<T>(options: RequestOptions): Promise<RequestResult<T>> {
  const maxRetries = options.maxRetries ?? 4;
  let rateLimitHits = 0;
  let lastError: IntegrationError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await rateLimiter.acquire(options.rateLimitKey, options.rateLimitPerMinute);

    let response: Response;
    try {
      response = await fetch(options.url, {
        method: options.method ?? "GET",
        headers: buildHeaders(options),
        body: options.body === undefined ? undefined : serializeBody(options),
        signal: options.signal,
        cache: "no-store",
      });
    } catch (cause) {
      // Fallo de red: reintentable.
      lastError = new IntegrationError({
        provider: options.provider,
        endpoint: safeEndpoint(options.url),
        status: 0,
        userMessage: options.userMessage ?? "No se pudo conectar con el servicio.",
        detail: { reason: cause instanceof Error ? cause.message : "network" },
      });
      if (attempt < maxRetries) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      const data = (await parseBody(response)) as T;
      return { data, status: response.status, rateLimitHits };
    }

    if (response.status === 429) rateLimitHits += 1;

    const error = await toIntegrationError(response, options);

    if (error.isRetryable && attempt < maxRetries) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      await sleep(retryAfter ?? backoffDelay(attempt));
      lastError = error;
      continue;
    }

    throw error;
  }

  throw (
    lastError ??
    new IntegrationError({
      provider: options.provider,
      endpoint: safeEndpoint(options.url),
      status: 0,
      userMessage: options.userMessage ?? "No se pudo completar la consulta.",
    })
  );
}

function buildHeaders(options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }
  if (options.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

function serializeBody(options: RequestOptions): string {
  if (typeof options.body === "string") return options.body;
  return JSON.stringify(options.body);
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function toIntegrationError(
  response: Response,
  options: RequestOptions,
): Promise<IntegrationError> {
  const body = await parseBody(response).catch(() => null);

  return new IntegrationError({
    provider: options.provider,
    endpoint: safeEndpoint(options.url),
    status: response.status,
    userMessage: options.userMessage ?? defaultMessage(response.status),
    // Se guarda sólo lo estrictamente necesario para diagnosticar: mensaje y
    // código. Nunca el cuerpo entero, que puede traer datos de terceros.
    detail: {
      message: extractMessage(body),
      code: extractCode(body),
      requestId: response.headers.get("x-request-id"),
    },
  });
}

function defaultMessage(status: number): string {
  if (status === 401) return "La conexión con la cuenta expiró o fue revocada.";
  if (status === 403) return "La aplicación no tiene permisos para consultar este recurso.";
  if (status === 404) return "El recurso consultado no existe.";
  if (status === 429) return "Se alcanzó el límite de consultas. Se reintentará automáticamente.";
  if (status >= 500) return "El servicio no está respondiendo. Se reintentará automáticamente.";
  return "No se pudo completar la consulta.";
}

function extractMessage(body: unknown): string | null {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message: unknown }).message;
    return typeof message === "string" ? message.slice(0, 300) : null;
  }
  return null;
}

function extractCode(body: unknown): string | null {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const code = record.code ?? record.error;
    return typeof code === "string" ? code.slice(0, 100) : null;
  }
  return null;
}

/**
 * Path del endpoint sin query string.
 *
 * Los logs guardan sólo esto: la query puede llevar `access_token` (algunos
 * recursos legacy de Mercado Libre lo aceptan por query) o identificadores de
 * comprador.
 */
export function safeEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "url-invalida";
  }
}

/** Construye una URL con query params, omitiendo los indefinidos. */
export function buildUrl(
  base: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}
