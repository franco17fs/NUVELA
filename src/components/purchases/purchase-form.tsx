"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { ActionForm, Field, FieldRow, Input, Select, Textarea } from "@/components/ui/form";
import { createPurchaseAction } from "@/server/actions/manual-entries";
import { dateKey, today } from "@/lib/dates";
import { formatARS, money, ZERO } from "@/lib/money";
import type { AccountSummary } from "@/server/queries/accounts";

interface SkuOption {
  id: string;
  code: string;
  name: string;
  currentAverageCost: string;
}

interface LineItem {
  key: number;
  skuId: string;
  quantity: string;
  unitCost: string;
}

/**
 * Carga de una compra de mercadería.
 *
 * Las líneas se serializan a JSON en inputs ocultos `items[]`, que es lo que
 * espera la acción de servidor. El total se calcula en vivo con aritmética
 * decimal —no con `number`— para que lo que ve el usuario coincida exactamente
 * con lo que se va a guardar.
 */
export function PurchaseForm({
  skus,
  accounts,
}: {
  skus: SkuOption[];
  accounts: AccountSummary[];
}) {
  const [lines, setLines] = useState<LineItem[]>([
    { key: 1, skuId: skus[0]?.id ?? "", quantity: "", unitCost: "" },
  ]);

  const total = useMemo(
    () =>
      lines.reduce(
        (acc, line) => acc.plus(money(line.quantity).times(money(line.unitCost))),
        ZERO,
      ),
    [lines],
  );

  const updateLine = (key: number, patch: Partial<LineItem>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  if (skus.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Primero cargá al menos un SKU en la sección Mercadería. Sin SKU no hay dónde imputar el
        costo.
      </p>
    );
  }

  return (
    <ActionForm action={createPurchaseAction} submitLabel="Registrar compra">
      <FieldRow>
        <Field label="Proveedor">
          <Input name="supplier" required />
        </Field>
        <Field label="Fecha">
          <Input name="date" type="date" required defaultValue={dateKey(today())} />
        </Field>
        <Field label="N° de factura" hint="Opcional">
          <Input name="invoiceNumber" />
        </Field>
        <Field label="Medio de pago">
          <Input name="paymentMethod" placeholder="Transferencia, cuenta corriente…" />
        </Field>
        <Field label="Vence el pago" hint="Si es a plazo, entra al cashflow">
          <Input name="paymentDueDate" type="date" />
        </Field>
        <Field label="Cuenta" hint="Vacío = todo el negocio">
          <Select name="sellerAccountId" defaultValue="">
            <option value="">Todo el negocio</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.nickname}
              </option>
            ))}
          </Select>
        </Field>
      </FieldRow>

      <div className="space-y-2">
        <p className="text-xs font-medium text-ink-muted">Productos</p>

        {lines.map((line) => {
          const sku = skus.find((option) => option.id === line.skuId);
          return (
            <div key={line.key} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-5">
                <Select
                  value={line.skuId}
                  onChange={(event) => updateLine(line.key, { skuId: event.target.value })}
                  aria-label="SKU"
                >
                  {skus.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.code} · {option.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2">
                <Input
                  value={line.quantity}
                  onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  placeholder="Cant."
                  inputMode="decimal"
                  aria-label="Cantidad"
                />
              </div>
              <div className="col-span-3">
                <Input
                  value={line.unitCost}
                  onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                  placeholder={
                    sku && money(sku.currentAverageCost).greaterThan(0)
                      ? `Actual: ${money(sku.currentAverageCost).toDecimalPlaces(2).toFixed(2)}`
                      : "Costo unitario"
                  }
                  inputMode="decimal"
                  aria-label="Costo unitario"
                />
              </div>
              <div className="col-span-1 pb-1.5 text-right text-xs tabular text-ink-muted">
                {formatARS(money(line.quantity).times(money(line.unitCost)))}
              </div>
              <div className="col-span-1 pb-1">
                {lines.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                    className="text-ink-subtle hover:text-negative"
                    aria-label="Quitar producto"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              <input
                type="hidden"
                name="items"
                value={JSON.stringify({
                  skuId: line.skuId,
                  quantity: line.quantity || "0",
                  unitCost: line.unitCost || "0",
                })}
              />
            </div>
          );
        })}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: Math.max(...current.map((line) => line.key)) + 1,
                  skuId: skus[0]?.id ?? "",
                  quantity: "",
                  unitCost: "",
                },
              ])
            }
            className="text-xs font-medium text-brand hover:underline"
          >
            + Agregar producto
          </button>

          <p className="text-sm">
            <span className="text-ink-muted">Total: </span>
            <span className="tabular font-semibold">{formatARS(total)}</span>
          </p>
        </div>
      </div>

      <Field label="Notas">
        <Textarea name="notes" />
      </Field>
    </ActionForm>
  );
}
