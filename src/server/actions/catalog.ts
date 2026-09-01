"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/money";
import { toUserMessage } from "@/lib/errors";
import { adjustStock } from "../costing/purchases";
import { parseDateKey } from "@/lib/dates";
import type { ActionResult } from "./manual-entries";

/**
 * Catálogo propio: productos, SKUs y el mapeo publicación ↔ SKU.
 *
 * El mapeo es lo que permite atribuir costo de mercadería a una venta. Sin él,
 * la venta se registra igual pero el margen queda marcado como estimado, porque
 * falta el COGS.
 */

const skuSchema = z.object({
  code: z.string().min(1, "Ingresá el código del SKU"),
  name: z.string().min(1, "Ingresá el nombre"),
  productName: z.string().optional(),
  brand: z.string().optional(),
  billableWeightGrams: z.string().optional(),
  initialStock: z.string().optional(),
  initialUnitCost: z.string().optional(),
});

export async function createSkuAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = skuSchema.parse(Object.fromEntries(formData));

    const product = await prisma.product.create({
      data: {
        name: parsed.productName || parsed.name,
        brand: parsed.brand || null,
      },
      select: { id: true },
    });

    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        code: parsed.code,
        name: parsed.name,
        billableWeightGrams: parsed.billableWeightGrams
          ? Number(parsed.billableWeightGrams)
          : null,
      },
      select: { id: true },
    });

    // Inventario inicial: entra como ajuste con costo, así queda un movimiento
    // trazable en vez de un stock que aparece de la nada.
    const initialStock = money(parsed.initialStock);
    if (initialStock.greaterThan(0)) {
      await adjustStock({
        skuId: sku.id,
        quantity: initialStock.toString(),
        unitCost: money(parsed.initialUnitCost).toString(),
        date: new Date(),
        notes: "Inventario inicial",
      });
    }

    revalidatePath("/mercaderia");
    revalidatePath("/productos");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

const mappingSchema = z.object({
  sellerAccountId: z.string().min(1, "Elegí la cuenta"),
  skuId: z.string().min(1, "Elegí el SKU"),
  mlItemId: z.string().min(1, "Ingresá el ID de la publicación"),
  variationId: z.string().optional(),
  unitsPerListing: z.string().optional(),
});

export async function linkListingAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = mappingSchema.parse(Object.fromEntries(formData));
    // Cadena vacía = publicación sin variaciones. No se usa NULL porque el
    // índice único de PostgreSQL no deduplica valores nulos.
    const variationId = parsed.variationId || "";
    const unitsPerListing = parsed.unitsPerListing
      ? money(parsed.unitsPerListing).toString()
      : "1";

    await prisma.listingMapping.upsert({
      where: {
        sellerAccountId_mlItemId_variationId: {
          sellerAccountId: parsed.sellerAccountId,
          mlItemId: parsed.mlItemId,
          variationId,
        },
      },
      create: {
        sellerAccountId: parsed.sellerAccountId,
        skuId: parsed.skuId,
        mlItemId: parsed.mlItemId,
        variationId,
        unitsPerListing,
      },
      update: { skuId: parsed.skuId, unitsPerListing },
    });

    revalidatePath("/productos");
    revalidatePath("/mercaderia");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

const adjustSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.string().min(1, "Ingresá la cantidad"),
  unitCost: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});

export async function adjustStockAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = adjustSchema.parse(Object.fromEntries(formData));

    await adjustStock({
      skuId: parsed.skuId,
      quantity: parsed.quantity,
      unitCost: parsed.unitCost || null,
      date: parseDateKey(parsed.date),
      notes: parsed.notes,
    });

    revalidatePath("/mercaderia");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

function formatError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Revisá los datos ingresados.";
  }
  // Un código de SKU repetido es el error más común de este formulario:
  // conviene decirlo con palabras y no con el mensaje de Prisma.
  if (error instanceof Error && error.message.includes("Unique constraint")) {
    return "Ya existe un SKU con ese código.";
  }
  return toUserMessage(error);
}
