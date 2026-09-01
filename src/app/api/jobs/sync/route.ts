import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { syncOrders } from "@/server/sync/orders-sync";
import { syncPayments } from "@/server/sync/payments-sync";
import { syncAds } from "@/server/sync/ads-sync";
import { processPendingWebhooks } from "@/server/sync/webhook-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Una corrida completa puede tomar varios minutos con dos cuentas. */
export const maxDuration = 300;

/**
 * Disparador de sincronización, pensado para un cron externo:
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *        $APP_BASE_URL/api/jobs/sync -d '{"job":"all"}'
 *
 * ## Por qué cada job se aísla
 *
 * Si la publicidad falla, las ventas igual se sincronizan. El brief lo pide
 * explícitamente (§42): "Publicidad no pudo actualizarse" no puede romper todo
 * el dashboard. Por eso cada job corre dentro de `runSyncJob`, que captura el
 * error, lo registra y devuelve un resultado en vez de propagarlo.
 */

const bodySchema = z.object({
  job: z
    .enum(["all", "orders", "payments", "ads", "webhooks", "backfill"])
    .default("all"),
  accountId: z.string().optional(),
  /** Sólo para backfill: desde cuándo importar. */
  from: z.string().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv();
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");

  if (!env.CRON_SECRET || !safeEqual(token, env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { job, accountId, from } = parsed.data;

  const accounts = await prisma.sellerAccount.findMany({
    where: { status: "ACTIVE", ...(accountId ? { id: accountId } : {}) },
    select: { id: true, nickname: true },
  });

  const results: Record<string, unknown>[] = [];

  for (const account of accounts) {
    if (job === "all" || job === "orders") {
      const result = await syncOrders(account.id, { mode: "incremental" });
      results.push({ account: account.nickname, job: "orders", ok: result.ok, jobId: result.jobId });
    }

    if (job === "backfill") {
      const result = await syncOrders(account.id, {
        mode: "backfill",
        from: from ? new Date(from) : undefined,
      });
      results.push({ account: account.nickname, job: "backfill", ok: result.ok, jobId: result.jobId });
    }

    if (job === "all" || job === "payments") {
      const result = await syncPayments(account.id);
      results.push({ account: account.nickname, job: "payments", ok: result.ok, jobId: result.jobId });
    }

    if (job === "all" || job === "ads") {
      const result = await syncAds(account.id);
      results.push({ account: account.nickname, job: "ads", ok: result.ok, jobId: result.jobId });
    }
  }

  if (job === "all" || job === "webhooks") {
    const result = await processPendingWebhooks();
    results.push({ job: "webhooks", ok: result.ok, jobId: result.jobId });
  }

  // Siempre 200 con el detalle: el cron necesita saber qué pasó con cada job,
  // no un error global que esconda los que sí funcionaron.
  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
