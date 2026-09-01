import "server-only";
import type { Provider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { TokenExpiredError } from "@/lib/errors";
import { sleep } from "@/integrations/rate-limiter";
import { refreshAccessToken } from "@/integrations/mercadolibre/oauth";
import { refreshMercadoPagoToken } from "@/integrations/mercadopago/oauth";

/**
 * Custodia de tokens OAuth.
 *
 * ## El problema del refresh token de un solo uso
 *
 * Mercado Libre invalida el `refresh_token` apenas se usa y devuelve uno nuevo
 * (research §1.3). Si dos procesos refrescan a la vez —el job de órdenes y el de
 * publicidad, por ejemplo— el segundo usa un token ya quemado, recibe un error y
 * la cuenta queda desconectada hasta que alguien la reconecte a mano.
 *
 * Por eso el refresh se serializa con un lock atómico en la base: un
 * `UPDATE ... WHERE refreshLockedAt IS NULL` que sólo puede ganar un proceso.
 * El que pierde espera y vuelve a leer el token, que para entonces ya está
 * renovado.
 *
 * El lock tiene vencimiento (`LOCK_TIMEOUT_MS`) para que un proceso que muera a
 * mitad de camino no deje la cuenta bloqueada para siempre.
 */

/** Se renueva antes de que expire, para que un job largo no se quede sin token. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const LOCK_TIMEOUT_MS = 60 * 1000;
const LOCK_POLL_MS = 500;
const LOCK_MAX_WAIT_MS = 30 * 1000;

export async function getValidAccessToken(
  sellerAccountId: string,
  provider: Provider = "MERCADO_LIBRE",
): Promise<string> {
  const token = await prisma.oAuthToken.findUnique({
    where: { sellerAccountId_provider: { sellerAccountId, provider } },
  });

  if (!token) throw new TokenExpiredError(sellerAccountId);

  if (token.tokenExpiration.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return decryptSecret(token.accessTokenEncrypted);
  }

  if (!token.refreshTokenEncrypted) {
    // Sin refresh token no hay nada que renovar: la cuenta se conectó sin
    // `offline_access` o el token fue revocado.
    await markAccountExpired(sellerAccountId);
    throw new TokenExpiredError(sellerAccountId);
  }

  const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS);
  const lock = await prisma.oAuthToken.updateMany({
    where: {
      id: token.id,
      OR: [{ refreshLockedAt: null }, { refreshLockedAt: { lt: staleThreshold } }],
    },
    data: { refreshLockedAt: new Date() },
  });

  if (lock.count === 0) {
    // Otro proceso está renovando. Se espera a que termine en vez de quemar el
    // refresh token en paralelo.
    return waitForRefreshedToken(sellerAccountId, provider);
  }

  try {
    const refreshed = await performRefresh(provider, decryptSecret(token.refreshTokenEncrypted));

    await prisma.oAuthToken.update({
      where: { id: token.id },
      data: {
        accessTokenEncrypted: encryptSecret(refreshed.accessToken),
        // Si el proveedor no devolviera uno nuevo, se conserva el anterior en
        // vez de dejar la fila sin refresh token.
        refreshTokenEncrypted: refreshed.refreshToken
          ? encryptSecret(refreshed.refreshToken)
          : token.refreshTokenEncrypted,
        tokenExpiration: new Date(Date.now() + refreshed.expiresIn * 1000),
        scope: refreshed.scope ?? token.scope,
        lastRefreshedAt: new Date(),
        refreshLockedAt: null,
      },
    });

    await prisma.sellerAccount.update({
      where: { id: sellerAccountId },
      data: { status: "ACTIVE" },
    });

    return refreshed.accessToken;
  } catch (error) {
    // Se libera el lock pase lo que pase; si no, la cuenta queda trabada hasta
    // que venza el timeout.
    await prisma.oAuthToken.update({
      where: { id: token.id },
      data: { refreshLockedAt: null },
    });
    await markAccountExpired(sellerAccountId);
    throw error instanceof Error ? error : new TokenExpiredError(sellerAccountId);
  }
}

interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

async function performRefresh(provider: Provider, refreshToken: string): Promise<RefreshResult> {
  if (provider === "MERCADO_LIBRE") {
    const response = await refreshAccessToken(refreshToken);
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in,
      scope: response.scope,
    };
  }

  const response = await refreshMercadoPagoToken(refreshToken);
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresIn: response.expires_in,
    scope: response.scope,
  };
}

async function waitForRefreshedToken(
  sellerAccountId: string,
  provider: Provider,
): Promise<string> {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    await sleep(LOCK_POLL_MS);

    const current = await prisma.oAuthToken.findUnique({
      where: { sellerAccountId_provider: { sellerAccountId, provider } },
    });

    if (!current) throw new TokenExpiredError(sellerAccountId);

    if (
      current.refreshLockedAt === null &&
      current.tokenExpiration.getTime() - Date.now() > REFRESH_MARGIN_MS
    ) {
      return decryptSecret(current.accessTokenEncrypted);
    }
  }

  throw new TokenExpiredError(sellerAccountId);
}

async function markAccountExpired(sellerAccountId: string): Promise<void> {
  await prisma.sellerAccount
    .update({ where: { id: sellerAccountId }, data: { status: "TOKEN_EXPIRED" } })
    .catch(() => {
      // Si la cuenta ya no existe no hay nada que marcar; no vale la pena
      // tapar el error original con éste.
    });
}

/** Guarda un par de tokens recién emitido. */
export async function storeTokens(params: {
  sellerAccountId: string;
  provider: Provider;
  accessToken: string;
  refreshToken?: string | null;
  expiresIn: number;
  scope?: string | null;
}): Promise<void> {
  const tokenExpiration = new Date(Date.now() + params.expiresIn * 1000);
  const accessTokenEncrypted = encryptSecret(params.accessToken);
  const refreshTokenEncrypted = params.refreshToken ? encryptSecret(params.refreshToken) : null;

  await prisma.oAuthToken.upsert({
    where: {
      sellerAccountId_provider: {
        sellerAccountId: params.sellerAccountId,
        provider: params.provider,
      },
    },
    create: {
      sellerAccountId: params.sellerAccountId,
      provider: params.provider,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiration,
      scope: params.scope ?? null,
      lastRefreshedAt: new Date(),
    },
    update: {
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiration,
      scope: params.scope ?? null,
      lastRefreshedAt: new Date(),
      refreshLockedAt: null,
    },
  });
}

/** Borra las credenciales de una cuenta sin perder su historial financiero. */
export async function revokeTokens(sellerAccountId: string, provider: Provider): Promise<void> {
  await prisma.oAuthToken.deleteMany({ where: { sellerAccountId, provider } });
  if (provider === "MERCADO_LIBRE") {
    await prisma.sellerAccount.update({
      where: { id: sellerAccountId },
      data: { status: "DISCONNECTED" },
    });
  }
}
