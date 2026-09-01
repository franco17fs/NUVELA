import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { toUserMessage } from "@/lib/errors";
import {
  exchangeAuthorizationCode,
  fetchAuthenticatedUser,
} from "@/integrations/mercadolibre/oauth";
import { storeTokens } from "@/server/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cierre del flujo OAuth de Mercado Libre.
 *
 * Crea (o reactiva) el `SellerAccount` y guarda los tokens cifrados. Soporta
 * múltiples cuentas desde el arranque: la unicidad es por `mercadoLibreUserId`,
 * así que conectar una segunda cuenta agrega una fila más, y reconectar la
 * misma actualiza sus credenciales sin tocar su historial financiero.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const env = getEnv();
  const url = new URL(request.url);
  const settingsUrl = (params: string) => new URL(`/configuracion?${params}`, env.APP_BASE_URL);

  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      settingsUrl(`error=${encodeURIComponent("No se autorizó la conexión con Mercado Libre.")}`),
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(
      settingsUrl(`error=${encodeURIComponent("La respuesta de Mercado Libre vino incompleta.")}`),
    );
  }

  try {
    // El `state` se consume: un segundo intento con el mismo valor no sirve.
    const flow = await prisma.oAuthFlowState.findUnique({ where: { state } });

    if (!flow || flow.provider !== "MERCADO_LIBRE" || flow.expiresAt < new Date()) {
      return NextResponse.redirect(
        settingsUrl(
          `error=${encodeURIComponent("La conexión expiró o no es válida. Volvé a intentarlo.")}`,
        ),
      );
    }

    await prisma.oAuthFlowState.delete({ where: { id: flow.id } });

    const tokens = await exchangeAuthorizationCode({ code, codeVerifier: flow.codeVerifier });
    const user = await fetchAuthenticatedUser(tokens.access_token);

    const account = await prisma.sellerAccount.upsert({
      where: { mercadoLibreUserId: BigInt(user.id) },
      create: {
        mercadoLibreUserId: BigInt(user.id),
        nickname: user.nickname,
        accountName: user.nickname,
        siteId: user.site_id,
        status: "ACTIVE",
        colorHex: await nextAccountColor(),
      },
      update: {
        nickname: user.nickname,
        siteId: user.site_id,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    await storeTokens({
      sellerAccountId: account.id,
      provider: "MERCADO_LIBRE",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in,
      scope: tokens.scope ?? null,
    });

    return NextResponse.redirect(settingsUrl(`conectada=${encodeURIComponent(user.nickname)}`));
  } catch (caught) {
    return NextResponse.redirect(settingsUrl(`error=${encodeURIComponent(toUserMessage(caught))}`));
  }
}

/** Colores para distinguir cuentas de un vistazo en toda la interfaz. */
const ACCOUNT_COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626"];

async function nextAccountColor(): Promise<string> {
  const count = await prisma.sellerAccount.count();
  return ACCOUNT_COLORS[count % ACCOUNT_COLORS.length] ?? "#2563eb";
}
