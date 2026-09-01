import "server-only";
import { getEnv } from "@/lib/env";
import { getValidAccessToken } from "@/server/tokens";
import { buildUrl, request, type RequestResult } from "../http";
import { ML_API_BASE } from "./oauth";

/**
 * Cliente de la API de Mercado Libre atado a una cuenta.
 *
 * Se crea uno por cuenta y por corrida de sincronización. Resuelve el token
 * (renovándolo si hace falta) y acumula cuántos 429 se recibieron, para que el
 * `SyncJob` pueda guardarlo como evidencia y así calibrar `ML_RATE_LIMIT_RPM`
 * con datos y no con una constante inventada.
 */
export class MercadoLibreClient {
  private rateLimitHits = 0;

  constructor(private readonly sellerAccountId: string) {}

  get accumulatedRateLimitHits(): number {
    return this.rateLimitHits;
  }

  async get<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined | null> = {},
    headers: Record<string, string> = {},
  ): Promise<T> {
    const env = getEnv();
    const accessToken = await getValidAccessToken(this.sellerAccountId, "MERCADO_LIBRE");

    const result: RequestResult<T> = await request<T>({
      provider: "MERCADO_LIBRE",
      url: buildUrl(`${ML_API_BASE}${path}`, params),
      accessToken,
      headers,
      // El límite se aplica por cuenta: dos sellers no se estorban entre sí.
      rateLimitKey: `MERCADO_LIBRE:${this.sellerAccountId}`,
      rateLimitPerMinute: env.ML_RATE_LIMIT_RPM,
    });

    this.rateLimitHits += result.rateLimitHits;
    return result.data;
  }
}

/** Página de resultados con el bloque `paging` estándar de Mercado Libre. */
export interface PagedResponse<T> {
  results: T[];
  paging: { total: number; offset: number; limit: number };
}

/**
 * Recorre un recurso paginado por offset.
 *
 * `maxItems` existe como red de seguridad: una importación inicial mal acotada
 * podría intentar traer decenas de miles de órdenes y agotar la cuota de la
 * aplicación. Preferimos cortar y dejarlo registrado a barrer sin límite.
 */
export async function* paginate<T>(
  fetchPage: (offset: number, limit: number) => Promise<PagedResponse<T>>,
  options: { limit?: number; maxItems?: number } = {},
): AsyncGenerator<T[], void, undefined> {
  const limit = options.limit ?? 50;
  const maxItems = options.maxItems ?? 20_000;

  let offset = 0;
  let fetched = 0;

  for (;;) {
    const page = await fetchPage(offset, limit);
    const results = page.results ?? [];

    if (results.length === 0) return;

    yield results;

    fetched += results.length;
    offset += results.length;

    if (fetched >= maxItems) return;
    if (page.paging && offset >= page.paging.total) return;
    // Defensa contra un `paging.total` inconsistente: si la página vino
    // incompleta, no hay más.
    if (results.length < limit) return;
  }
}
