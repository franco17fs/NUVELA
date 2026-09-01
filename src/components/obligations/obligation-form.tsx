"use client";

import { ActionForm, Field, FieldRow, Input, Select, Textarea } from "@/components/ui/form";
import { createObligationAction } from "@/server/actions/manual-entries";
import type { AccountSummary } from "@/server/queries/accounts";

/** Categorías sugeridas del §18 del brief. El campo acepta cualquier texto. */
const CATEGORIES = [
  "Tarjeta",
  "Proveedor",
  "Impuestos",
  "Préstamo",
  "Alquiler",
  "Sueldos",
  "Servicios",
  "Factura Mercado Libre",
  "Otras deudas",
];

export function ObligationForm({ accounts }: { accounts: AccountSummary[] }) {
  return (
    <ActionForm action={createObligationAction} submitLabel="Cargar obligación">
      <FieldRow>
        <Field label="Descripción" className="sm:col-span-2">
          <Input name="description" required placeholder="Tarjeta Visa · resumen septiembre" />
        </Field>

        <Field label="Monto">
          <Input name="amount" required inputMode="decimal" placeholder="1200000" />
        </Field>

        <Field label="Vencimiento">
          <Input name="dueDate" type="date" required />
        </Field>

        <Field label="Categoría">
          <Select name="category" required defaultValue="Tarjeta">
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Prioridad">
          <Select name="priority" defaultValue="NORMAL">
            <option value="CRITICAL">Crítica</option>
            <option value="HIGH">Alta</option>
            <option value="NORMAL">Normal</option>
            <option value="LOW">Baja</option>
          </Select>
        </Field>

        <Field label="Cuota actual" hint="Opcional">
          <Input name="installmentNumber" type="number" min={1} />
        </Field>

        <Field label="Total de cuotas" hint="Opcional">
          <Input name="installmentsTotal" type="number" min={1} />
        </Field>

        <Field label="Recurrencia">
          <Select name="recurrence" defaultValue="NONE">
            <option value="NONE">No se repite</option>
            <option value="WEEKLY">Semanal</option>
            <option value="BIWEEKLY">Quincenal</option>
            <option value="MONTHLY">Mensual</option>
            <option value="QUARTERLY">Trimestral</option>
            <option value="YEARLY">Anual</option>
          </Select>
        </Field>

        <Field label="Cuenta" hint="Dejalo vacío si aplica a todo el negocio">
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

      <Field label="Notas">
        <Textarea name="notes" />
      </Field>
    </ActionForm>
  );
}
