import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEnv, webhookAllowedIps } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { webhookNotificationSchema } from "@/integrations/mercadolibre/schemas";
import { webhookKey } from "@/server/sync/idempotency";

export const runtime = "nodejs";
/** Nunca se cachea: cada notificación es un evento distinto. */
export const dynamic = "force-dynamic";

/**
 * Receptor de notificaciones de Mercado Libre.
 *
 * ## Por qué este handler no hace prácticamente nada
 *
 * La documentación es explícita (research §8.2): hay que responder **HTTP 200 en
 * menos de 500 ms**, o Mercado Libre puede **desactivar el tópico por fallback**,
 * y las notificaciones de ese período **no quedan guardadas** en "my feeds".
 * Además recomienda encolar y consultar la API después.
 *
 * Entonces acá sólo se valida, se hace un INSERT y se responde 200. Ninguna
 * llamada a la API de Mercado Libre, ningún cálculo. El procesamiento real corre
 * asíncrono (`/api/jobs/webhooks`).
 *
 * ## Autenticación
 *
 * El control principal es un secreto en la propia URL
 * (`/api/webhooks/mercadolibre/<ML_WEBHOOK_SECRET>`), comparado en tiempo
 * constante. El allowlist de IPs es OPCIONAL y adicional: la lista publicada
 * puede cambiar sin aviso, así que depender sólo de ella dejaría de recibir
 * ventas en silencio.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ secret: string }> },
): Promise<NextResponse> {
  const env = getEnv();
  const { secret } = await context.params;

  if (!env.ML_WEBHOOK_SECRET || !safeEqual(secret, env.ML_WEBHOOK_SECRET)) {
    // 404 y no 403: no confirmamos la existencia del endpoint a quien no tiene
    // el secreto.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const allowedIps = webhookAllowedIps();
  if (allowedIps.length > 0) {
    const sourceIp = clientIp(request);
    if (sourceIp && !allowedIps.includes(sourceIp)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    // Se responde 200 igual: un cuerpo ilegible no se arregla reintentando, y un
    // no-200 acerca la desactivación del tópico.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const parsed = webhookNotificationSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const notification = parsed.data;
  const sentAt = notification.sent ? new Date(notification.sent) : null;

  const dedupeKey = webhookKey({
    provider: "MERCADO_LIBRE",
    topic: notification.topic,
    resource: notification.resource,
    sentAt,
  });

  try {
    const sellerAccount = notification.user_id
      ? await prisma.sellerAccount.findUnique({
          where: { mercadoLibreUserId: BigInt(notification.user_id) },
          select: { id: true },
        })
      : null;

    await prisma.webhookEvent.upsert({
      where: { dedupeKey },
      create: {
        dedupeKey,
        sellerAccountId: sellerAccount?.id ?? null,
        provider: "MERCADO_LIBRE",
        topic: notification.topic,
        resource: notification.resource,
        mlUserId: notification.user_id ? BigInt(notification.user_id) : null,
        applicationId: notification.application_id ? BigInt(notification.application_id) : null,
        attempts: notification.attempts ?? 0,
        sentAt,
        // Una notificación de una cuenta que no tenemos conectada se guarda pero
        // se ignora: no es un error, pero tampoco hay nada que sincronizar.
        status: sellerAccount ? "RECEIVED" : "IGNORED",
        payload: notification,
      },
      update: {
        // Un reintento sólo actualiza el contador: el evento ya está encolado.
        attempts: notification.attempts ?? 0,
      },
    });
  } catch {
    // Ni siquiera un fallo de base justifica devolver un error: eso dispararía
    // reintentos y acercaría la desactivación del tópico. La reconciliación
    // periódica cubre lo que se pierda acá.
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}
