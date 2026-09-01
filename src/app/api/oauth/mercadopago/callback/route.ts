import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { toUserMessage } from "@/lib/errors";
import { exchangeMercadoPagoCode } from "@/integrations/mercadopago/oauth";
import { storeTokens } from "@/server/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cierre del flujo OAuth de Mercado Pago: vincula los tokens a la cuenta elegida. */
export async function GET(request: Request): Promise<NextResponse> {
  const env = getEnv();
  const url = new URL(request.url);
  const settingsUrl = (params: string) => new URL(`/configuracion?${params}`, env.APP_BASE_URL);

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(
      settingsUrl(`error=${encodeURIComponent("No se autorizó la conexión con Mercado Pago.")}`),
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(
      settingsUrl(`error=${encodeURIComponent("La respuesta de Mercado Pago vino incompleta.")}`),
    );
  }

  try {
    const flow = await prisma.oAuthFlowState.findUnique({ where: { state } });

    if (
      !flow ||
      flow.provider !== "MERCADO_PAGO" ||
      flow.expiresAt < new Date() ||
      !flow.sellerAccountId
    ) {
      return NextResponse.redirect(
        settingsUrl(
          `error=${encodeURIComponent("La conexión expiró o no es válida. Volvé a intentarlo.")}`,
        ),
      );
    }

    await prisma.oAuthFlowState.delete({ where: { id: flow.id } });

    const tokens = await exchangeMercadoPagoCode({ code, codeVerifier: flow.codeVerifier });

    await storeTokens({
      sellerAccountId: flow.sellerAccountId,
      provider: "MERCADO_PAGO",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in,
      scope: tokens.scope ?? null,
    });

    await prisma.sellerAccount.update({
      where: { id: flow.sellerAccountId },
      data: { mercadoPagoUserId: BigInt(tokens.user_id) },
    });

    return NextResponse.redirect(settingsUrl("mp=conectado"));
  } catch (caught) {
    return NextResponse.redirect(settingsUrl(`error=${encodeURIComponent(toUserMessage(caught))}`));
  }
}
