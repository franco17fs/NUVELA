import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toUserMessage } from "@/lib/errors";
import {
  buildAuthorizationUrl,
  generatePkce,
  generateState,
} from "@/integrations/mercadolibre/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inicia la conexión de una cuenta de Mercado Libre.
 *
 * El `state` y el `code_verifier` de PKCE se guardan en la base y no en una
 * cookie, por dos razones:
 *   - el `redirect_uri` no puede llevar información variable, así que no hay
 *     dónde meter contexto salvo en `state`;
 *   - el usuario puede empezar el flujo en un navegador y volver en otro (por
 *     ejemplo si Mercado Libre lo abre en una app), y una cookie se perdería.
 *
 * El registro vence a los 15 minutos.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkce();

    await prisma.oAuthFlowState.create({
      data: {
        state,
        codeVerifier,
        provider: "MERCADO_LIBRE",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // Limpieza oportunista de flujos abandonados.
    await prisma.oAuthFlowState.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    return NextResponse.redirect(buildAuthorizationUrl({ state, codeChallenge }));
  } catch (error) {
    const message = encodeURIComponent(toUserMessage(error));
    return NextResponse.redirect(
      new URL(`/configuracion?error=${message}`, process.env.APP_BASE_URL ?? "http://localhost:3000"),
    );
  }
}
