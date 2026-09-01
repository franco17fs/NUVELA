import "server-only";

/**
 * Limitador de requests por clave (una clave por cuenta y proveedor).
 *
 * ## Por qué el valor es configurable y no una constante
 *
 * La documentación oficial de Mercado Libre **no publica un RPM general** por
 * endpoint: sólo dice que el control se aplica principalmente por Client ID, que
 * hay que hacer backoff ante un 429 y que se pueden pedir aumentos de cuota
 * (ver docs/mercadolibre-api-research.md §9). Inventar acá un número y tratarlo
 * como si fuera oficial sería exactamente lo que el proyecto no quiere hacer.
 *
 * Entonces: arrancamos conservador vía `ML_RATE_LIMIT_RPM`, contamos cada 429 en
 * `SyncJob.rateLimitHits`, y el valor se calibra con esa evidencia.
 *
 * Es un limitador en memoria: alcanza para un proceso único, que es el modo de
 * despliegue previsto. Si el día de mañana corren varias instancias, esta clase
 * es el único punto a cambiar por un limitador compartido (Redis).
 */
class RateLimiter {
  private readonly windows = new Map<string, number[]>();

  /** Espera lo necesario para no superar `limitPerMinute` en la clave dada. */
  async acquire(key: string, limitPerMinute: number): Promise<void> {
    const windowMs = 60_000;

    for (;;) {
      const now = Date.now();
      const timestamps = (this.windows.get(key) ?? []).filter(
        (timestamp) => now - timestamp < windowMs,
      );

      if (timestamps.length < limitPerMinute) {
        timestamps.push(now);
        this.windows.set(key, timestamps);
        return;
      }

      // Esperar hasta que el request más viejo salga de la ventana.
      const oldest = timestamps[0] ?? now;
      const waitMs = Math.max(windowMs - (now - oldest) + 5, 10);
      await sleep(waitMs);
    }
  }

  /** Libera la ventana de una clave (útil en tests y al reconectar una cuenta). */
  reset(key: string): void {
    this.windows.delete(key);
  }
}

export const rateLimiter = new RateLimiter();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backoff exponencial con jitter, tal como recomienda la documentación de
 * Mercado Libre para el 429. El jitter evita que varios reintentos vuelvan a
 * chocar sincronizados.
 */
export function backoffDelay(attempt: number, baseMs = 1_000, maxMs = 30_000): number {
  const exponential = Math.min(baseMs * 2 ** attempt, maxMs);
  const jitter = Math.random() * exponential * 0.3;
  return Math.floor(exponential * 0.7 + jitter);
}

/** Interpreta el header `Retry-After` (segundos o fecha HTTP). */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(date - Date.now(), 0);
  }

  return null;
}
