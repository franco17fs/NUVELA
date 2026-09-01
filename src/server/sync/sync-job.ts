import "server-only";
import type { Prisma, SyncJobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError, IntegrationError, toUserMessage } from "@/lib/errors";

/**
 * Auditoría de las corridas de sincronización.
 *
 * Cada corrida deja una fila en `SyncJob` con qué ventana cubrió, cuánto leyó,
 * cuánto escribió y cuántos 429 recibió. Eso alimenta tres cosas:
 *   - el panel "Sincronizado hace N minutos" del dashboard;
 *   - el diagnóstico cuando algo no cuadra en la conciliación;
 *   - la calibración con evidencia de `ML_RATE_LIMIT_RPM`.
 *
 * El error se guarda con un mensaje seguro (`errorMessage`) y el detalle
 * técnico aparte, jamás un stack trace crudo (§44 del brief).
 */

export interface SyncJobStats {
  itemsRead: number;
  itemsWritten: number;
  itemsSkipped: number;
  rateLimitHits: number;
}

export interface SyncContext extends SyncJobStats {
  jobId: string;
}

export async function runSyncJob<T>(
  params: {
    sellerAccountId: string | null;
    type: SyncJobType;
    windowFrom?: Date;
    windowTo?: Date;
  },
  work: (context: SyncContext) => Promise<T>,
): Promise<{ result: T | null; jobId: string; ok: boolean }> {
  const job = await prisma.syncJob.create({
    data: {
      sellerAccountId: params.sellerAccountId,
      type: params.type,
      status: "RUNNING",
      windowFrom: params.windowFrom ?? null,
      windowTo: params.windowTo ?? null,
    },
  });

  const context: SyncContext = {
    jobId: job.id,
    itemsRead: 0,
    itemsWritten: 0,
    itemsSkipped: 0,
    rateLimitHits: 0,
  };

  try {
    const result = await work(context);

    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        // PARTIAL cuando hubo 429: los datos están, pero la ventana pudo quedar
        // recortada por el límite y conviene que se note en la UI.
        status: context.rateLimitHits > 0 ? "PARTIAL" : "SUCCESS",
        finishedAt: new Date(),
        itemsRead: context.itemsRead,
        itemsWritten: context.itemsWritten,
        itemsSkipped: context.itemsSkipped,
        rateLimitHits: context.rateLimitHits,
      },
    });

    return { result, jobId: job.id, ok: true };
  } catch (error) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        itemsRead: context.itemsRead,
        itemsWritten: context.itemsWritten,
        itemsSkipped: context.itemsSkipped,
        rateLimitHits: context.rateLimitHits,
        errorMessage: toUserMessage(error),
        errorDetail: safeErrorDetail(error),
      },
    });

    // No se relanza: una integración caída no puede tumbar el resto de la
    // sincronización ni el dashboard (§42 del brief). El fallo queda registrado
    // y visible en el panel de sincronización.
    return { result: null, jobId: job.id, ok: false };
  }
}

/** Detalle técnico sin tokens, sin cuerpos crudos y sin stack traces. */
function safeErrorDetail(error: unknown): Prisma.InputJsonValue {
  if (error instanceof IntegrationError) {
    return toJson({
      kind: "integration",
      provider: error.provider,
      endpoint: error.endpoint,
      status: error.status,
      detail: error.detail,
    });
  }
  if (error instanceof AppError) {
    return toJson({ kind: "app", code: error.code, detail: error.detail });
  }
  if (error instanceof Error) {
    return { kind: "unexpected", name: error.name, message: error.message.slice(0, 500) };
  }
  return { kind: "unknown" };
}

/**
 * Normaliza a JSON plano. `detail` es `unknown` y podría traer algo no
 * serializable; si el round-trip falla, se guarda una nota en vez de romper el
 * registro del error, que sería perder justamente la información del fallo.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return { kind: "unserializable" };
  }
}

/** Marca de agua incremental por (cuenta, tipo). */
export async function getCursor(
  sellerAccountId: string,
  type: SyncJobType,
): Promise<{ lastWatermark: Date | null; lastSuccessAt: Date | null }> {
  const cursor = await prisma.syncCursor.findUnique({
    where: { sellerAccountId_type: { sellerAccountId, type } },
  });
  return {
    lastWatermark: cursor?.lastWatermark ?? null,
    lastSuccessAt: cursor?.lastSuccessAt ?? null,
  };
}

export async function setCursor(
  sellerAccountId: string,
  type: SyncJobType,
  watermark: Date,
): Promise<void> {
  await prisma.syncCursor.upsert({
    where: { sellerAccountId_type: { sellerAccountId, type } },
    create: { sellerAccountId, type, lastWatermark: watermark, lastSuccessAt: new Date() },
    update: { lastWatermark: watermark, lastSuccessAt: new Date() },
  });
}

/** Última sincronización exitosa por tipo, para el panel de estado. */
export async function lastSyncByType(sellerAccountId: string) {
  const jobs = await prisma.syncJob.findMany({
    where: { sellerAccountId, status: { in: ["SUCCESS", "PARTIAL"] } },
    orderBy: { startedAt: "desc" },
    distinct: ["type"],
    select: { type: true, startedAt: true, finishedAt: true, status: true },
  });

  return jobs;
}
