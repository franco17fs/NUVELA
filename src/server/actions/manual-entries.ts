"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { businessDate, parseDateKey } from "@/lib/dates";
import { money } from "@/lib/money";
import { toUserMessage } from "@/lib/errors";
import { createPurchase } from "../costing/purchases";

/**
 * Carga manual de lo que ninguna API puede darnos: compras de mercadería,
 * gastos, ingresos externos y obligaciones (§13, §16, §17 y §18 del brief).
 *
 * Todas las entradas se validan con Zod antes de tocar la base. El resultado
 * siempre vuelve como `{ ok, error }`: los formularios muestran el mensaje sin
 * que se filtre una excepción cruda a la interfaz.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha tiene que tener formato AAAA-MM-DD");

const amountSchema = z
  .string()
  .min(1, "Ingresá un importe")
  .refine((value) => money(value).greaterThan(0), "El importe tiene que ser mayor a cero");

// -----------------------------------------------------------------------------
// Compras de mercadería
// -----------------------------------------------------------------------------

const purchaseSchema = z.object({
  supplier: z.string().min(1, "Ingresá el proveedor"),
  date: dateSchema,
  invoiceNumber: z.string().optional(),
  paymentMethod: z.string().optional(),
  paymentDueDate: z.string().optional(),
  notes: z.string().optional(),
  sellerAccountId: z.string().optional(),
  items: z
    .array(
      z.object({
        skuId: z.string().min(1),
        quantity: z.string().min(1),
        unitCost: z.string().min(1),
      }),
    )
    .min(1, "Agregá al menos un producto"),
});

export async function createPurchaseAction(formData: FormData): Promise<ActionResult> {
  try {
    const rawItems = formData.getAll("items").map((value) => JSON.parse(String(value)));

    const parsed = purchaseSchema.parse({
      supplier: formData.get("supplier"),
      date: formData.get("date"),
      invoiceNumber: formData.get("invoiceNumber") || undefined,
      paymentMethod: formData.get("paymentMethod") || undefined,
      paymentDueDate: formData.get("paymentDueDate") || undefined,
      notes: formData.get("notes") || undefined,
      sellerAccountId: formData.get("sellerAccountId") || undefined,
      items: rawItems,
    });

    await createPurchase({
      supplier: parsed.supplier,
      date: parseDateKey(parsed.date),
      invoiceNumber: parsed.invoiceNumber ?? null,
      paymentMethod: parsed.paymentMethod ?? null,
      paymentDueDate: parsed.paymentDueDate ? parseDateKey(parsed.paymentDueDate) : null,
      notes: parsed.notes ?? null,
      sellerAccountId: parsed.sellerAccountId || null,
      items: parsed.items,
    });

    revalidatePath("/compras");
    revalidatePath("/mercaderia");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

// -----------------------------------------------------------------------------
// Gastos e ingresos
// -----------------------------------------------------------------------------

const expenseSchema = z.object({
  date: dateSchema,
  amount: amountSchema,
  categoryId: z.string().min(1, "Elegí una categoría"),
  subcategory: z.string().optional(),
  supplier: z.string().optional(),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
  sellerAccountId: z.string().optional(),
  recurrence: z
    .enum(["NONE", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"])
    .default("NONE"),
});

export async function createExpenseAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = expenseSchema.parse(Object.fromEntries(formData));
    const timezone = getEnv().APP_TIMEZONE;
    const date = parseDateKey(parsed.date);

    await prisma.expense.create({
      data: {
        date,
        businessDate: businessDate(date, timezone),
        amount: money(parsed.amount).toString(),
        categoryId: parsed.categoryId,
        subcategory: parsed.subcategory || null,
        supplier: parsed.supplier || null,
        paymentMethod: parsed.paymentMethod || null,
        notes: parsed.notes || null,
        sellerAccountId: parsed.sellerAccountId || null,
        recurrent: parsed.recurrence !== "NONE",
        recurrence: parsed.recurrence,
        source: "MANUAL",
      },
    });

    revalidatePath("/movimientos");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

const incomeSchema = z.object({
  date: dateSchema,
  amount: amountSchema,
  categoryId: z.string().min(1, "Elegí una categoría"),
  description: z.string().optional(),
  notes: z.string().optional(),
  sellerAccountId: z.string().optional(),
  recurrence: z
    .enum(["NONE", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"])
    .default("NONE"),
});

/**
 * Ingreso que NO viene de Mercado Libre.
 * Se guarda en su propia tabla y nunca se suma al GMV (§17 del brief): mezclarlo
 * inflaría la facturación con plata que no salió de una venta.
 */
export async function createIncomeAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = incomeSchema.parse(Object.fromEntries(formData));
    const timezone = getEnv().APP_TIMEZONE;
    const date = parseDateKey(parsed.date);

    await prisma.income.create({
      data: {
        date,
        businessDate: businessDate(date, timezone),
        amount: money(parsed.amount).toString(),
        categoryId: parsed.categoryId,
        description: parsed.description || null,
        notes: parsed.notes || null,
        sellerAccountId: parsed.sellerAccountId || null,
        recurrent: parsed.recurrence !== "NONE",
        recurrence: parsed.recurrence,
        source: "MANUAL",
      },
    });

    revalidatePath("/movimientos");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

const categorySchema = z.object({
  direction: z.enum(["EXPENSE", "INCOME"]),
  name: z.string().min(1, "Ingresá el nombre de la categoría"),
});

/** Categorías propias: agregar una nunca requiere tocar código (§16). */
export async function createCategoryAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = categorySchema.parse(Object.fromEntries(formData));

    await prisma.transactionCategory.create({
      data: { direction: parsed.direction, name: parsed.name, isSystem: false },
    });

    revalidatePath("/movimientos");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

// -----------------------------------------------------------------------------
// Obligaciones
// -----------------------------------------------------------------------------

const obligationSchema = z.object({
  description: z.string().min(1, "Describí la obligación"),
  amount: amountSchema,
  dueDate: dateSchema,
  category: z.string().min(1, "Elegí una categoría"),
  priority: z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]).default("NORMAL"),
  installmentsTotal: z.string().optional(),
  installmentNumber: z.string().optional(),
  sellerAccountId: z.string().optional(),
  notes: z.string().optional(),
  recurrence: z
    .enum(["NONE", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"])
    .default("NONE"),
});

export async function createObligationAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = obligationSchema.parse(Object.fromEntries(formData));

    await prisma.obligation.create({
      data: {
        description: parsed.description,
        amount: money(parsed.amount).toString(),
        dueDate: parseDateKey(parsed.dueDate),
        category: parsed.category,
        priority: parsed.priority,
        installmentsTotal: parsed.installmentsTotal ? Number(parsed.installmentsTotal) : null,
        installmentNumber: parsed.installmentNumber ? Number(parsed.installmentNumber) : null,
        sellerAccountId: parsed.sellerAccountId || null,
        notes: parsed.notes || null,
        recurrent: parsed.recurrence !== "NONE",
        recurrence: parsed.recurrence,
        source: "MANUAL",
      },
    });

    revalidatePath("/obligaciones");
    revalidatePath("/cashflow");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

const reserveAmountSchema = z.object({
  obligationId: z.string().min(1),
  amount: amountSchema,
});

/** Reserva dinero contra una obligación: mueve `reservedAmount`, no el saldo. */
export async function reserveForObligationAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = reserveAmountSchema.parse(Object.fromEntries(formData));

    const obligation = await prisma.obligation.findUniqueOrThrow({
      where: { id: parsed.obligationId },
    });

    const reserved = money(obligation.reservedAmount).plus(money(parsed.amount));

    await prisma.$transaction([
      prisma.obligation.update({
        where: { id: parsed.obligationId },
        data: { reservedAmount: reserved.toString() },
      }),
      // La reserva también se refleja como "bolsillo", que es lo que descuenta
      // del disponible seguro.
      prisma.reserve.upsert({
        where: { id: `obligation-${parsed.obligationId}` },
        create: {
          id: `obligation-${parsed.obligationId}`,
          sellerAccountId: obligation.sellerAccountId,
          type: "OBLIGATION",
          name: obligation.description,
          targetAmount: obligation.amount,
          currentAmount: reserved.toString(),
          obligationId: obligation.id,
          priority: 2,
        },
        update: { currentAmount: reserved.toString() },
      }),
    ]);

    revalidatePath("/obligaciones");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

const payObligationSchema = z.object({
  obligationId: z.string().min(1),
  amount: amountSchema,
  date: dateSchema,
  method: z.string().optional(),
});

export async function payObligationAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = payObligationSchema.parse(Object.fromEntries(formData));
    const timezone = getEnv().APP_TIMEZONE;
    const date = parseDateKey(parsed.date);

    const obligation = await prisma.obligation.findUniqueOrThrow({
      where: { id: parsed.obligationId },
    });

    const paid = money(obligation.paidAmount).plus(money(parsed.amount));
    const fullyPaid = paid.greaterThanOrEqualTo(money(obligation.amount));

    await prisma.$transaction([
      prisma.obligationPayment.create({
        data: {
          obligationId: parsed.obligationId,
          date,
          businessDate: businessDate(date, timezone),
          amount: money(parsed.amount).toString(),
          method: parsed.method || null,
        },
      }),
      prisma.obligation.update({
        where: { id: parsed.obligationId },
        data: { paidAmount: paid.toString(), status: fullyPaid ? "PAID" : "PARTIALLY_RESERVED" },
      }),
    ]);

    // Al pagarse por completo, el bolsillo deja de retener plata.
    if (fullyPaid) {
      await prisma.reserve
        .update({
          where: { id: `obligation-${parsed.obligationId}` },
          data: { active: false, currentAmount: "0" },
        })
        .catch(() => {
          // La reserva puede no existir si nunca se reservó contra esta obligación.
        });
    }

    revalidatePath("/obligaciones");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

function formatError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Revisá los datos ingresados.";
  }
  return toUserMessage(error);
}
