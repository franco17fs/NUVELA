import "server-only";
import { getEnv } from "@/lib/env";
import { getValidAccessToken } from "@/server/tokens";
import { buildUrl, request } from "../http";
import { MP_API_BASE } from "./oauth";

/** Cliente de la API de Mercado Pago atado a una cuenta. */
export class MercadoPagoClient {
  private rateLimitHits = 0;

  constructor(private readonly sellerAccountId: string) {}

  get accumulatedRateLimitHits(): number {
    return this.rateLimitHits;
  }

  async get<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined | null> = {},
  ): Promise<T> {
    return this.send<T>("GET", path, params);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("POST", path, {}, body);
  }

  private async send<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    params: Record<string, string | number | boolean | undefined | null>,
    body?: unknown,
  ): Promise<T> {
    const env = getEnv();
    const accessToken = await getValidAccessToken(this.sellerAccountId, "MERCADO_PAGO");

    const result = await request<T>({
      provider: "MERCADO_PAGO",
      url: buildUrl(`${MP_API_BASE}${path}`, params),
      method,
      accessToken,
      body,
      rateLimitKey: `MERCADO_PAGO:${this.sellerAccountId}`,
      rateLimitPerMinute: env.MP_RATE_LIMIT_RPM,
    });

    this.rateLimitHits += result.rateLimitHits;
    return result.data;
  }
}
