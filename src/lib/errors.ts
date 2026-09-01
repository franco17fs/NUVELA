/**
 * Errores de dominio.
 *
 * Regla de seguridad (§44 del brief): al usuario nunca se le muestra un stack
 * trace ni el cuerpo crudo de una respuesta de la API externa (puede contener
 * identificadores o fragmentos de credenciales). Cada error lleva un
 * `userMessage` seguro y, aparte, el detalle técnico para el log.
 */
export class AppError extends Error {
  readonly userMessage: string;
  readonly code: string;
  readonly detail?: unknown;

  constructor(code: string, userMessage: string, detail?: unknown) {
    super(userMessage);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.detail = detail;
  }
}

export class IntegrationError extends AppError {
  readonly status: number;
  readonly provider: "MERCADO_LIBRE" | "MERCADO_PAGO";
  readonly endpoint: string;

  constructor(params: {
    provider: "MERCADO_LIBRE" | "MERCADO_PAGO";
    endpoint: string;
    status: number;
    userMessage: string;
    detail?: unknown;
  }) {
    super(`INTEGRATION_${params.status}`, params.userMessage, params.detail);
    this.name = "IntegrationError";
    this.provider = params.provider;
    this.endpoint = params.endpoint;
    this.status = params.status;
  }

  /** 429 y 5xx son transitorios: vale la pena reintentar con backoff. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /** 401/403 significan token vencido o permisos faltantes: hay que reconectar. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export class TokenExpiredError extends AppError {
  constructor(sellerAccountId: string) {
    super(
      "TOKEN_EXPIRED",
      "La conexión con la cuenta expiró. Volvé a conectarla desde Configuración.",
      { sellerAccountId },
    );
    this.name = "TokenExpiredError";
  }
}

export class ConfigurationError extends AppError {
  constructor(userMessage: string, detail?: unknown) {
    super("CONFIGURATION", userMessage, detail);
    this.name = "ConfigurationError";
  }
}

/** Mensaje seguro para mostrar al usuario ante cualquier excepción. */
export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;
  return "Ocurrió un error inesperado. Revisá el detalle de sincronización.";
}
