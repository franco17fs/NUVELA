import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { toUserMessage } from "@/lib/errors";
import { generatePkce, generateState } from "@/integrations/mercadolibre/oauth";
import { buildMercadoPagoAuthorizationUrl } from "@/integrations/mercadopago/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inicia la conexión de Mercado Pago para una cuenta ya conectada a Mercado Libre.
 *
 * Se pide `accountId` porque Mercado Pago es una aplicación distinta con sus
 * propias credenciales: aunque en la práctica sea la misma persona, el vínculo
 * hay que declararlo, no adivinarlo. Vincularlo por su cuenta podría atar los
 * movimientos de dinero de una cuenta a las ventas de la otra.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const env = getEnv();
  const accountId = new URL(request.url).searchParams.get("accountId");

  const settingsUrl = (params: string) => new URL(`/configuracion?${params}`, env.APP_BASE_URL);

  if (!accountId) {
    return NextResponse.redirect(
      settingsUrl(`error=${encodeURIComponent("Elegí a qué cuenta vincular Mercado Pago.")}`),
    );
  }

  try {
    const account = await prisma.sellerAccount.findUnique({
      where: { id: accountId },
      select: { id: true },
    });

    if (!account) {
      return NextResponse.redirect(
        settingsUrl(`error=${encodeURIComponent("La cuenta indicada no existe.")}`),
      );
    }

    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkce();

    await prisma.oAuthFlowState.create({
      data: {
        state,
        codeVerifier,
        provider: "MERCADO_PAGO",
        sellerAccountId: account.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    return NextResponse.redirect(buildMercadoPagoAuthorizationUrl({ state, codeChallenge }));
  } catch (error) {
    return NextResponse.redirect(settingsUrl(`error=${encodeURIComponent(toUserMessage(error))}`));
  }
}
