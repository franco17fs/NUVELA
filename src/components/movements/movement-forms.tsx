"use client";

import { ActionForm, Field, FieldRow, Input, Select, Textarea } from "@/components/ui/form";
import { createExpenseAction, createIncomeAction } from "@/server/actions/manual-entries";
import { dateKey, today } from "@/lib/dates";
import type { AccountSummary } from "@/server/queries/accounts";

interface CategoryOption {
  id: string;
  name: string;
}

const RECURRENCES = [
  { value: "NONE", label: "No se repite" },
  { value: "WEEKLY", label: "Semanal" },
  { value: "BIWEEKLY", label: "Quincenal" },
  { value: "MONTHLY", label: "Mensual" },
  { value: "QUARTERLY", label: "Trimestral" },
  { value: "YEARLY", label: "Anual" },
];

function AccountField({ accounts }: { accounts: AccountSummary[] }) {
  return (
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
  );
}

export function ExpenseForm({
  accounts,
  categories,
}: {
  accounts: AccountSummary[];
  categories: CategoryOption[];
}) {
  return (
    <ActionForm action={createExpenseAction} submitLabel="Registrar egreso">
      <FieldRow>
        <Field label="Fecha">
          <Input name="date" type="date" required defaultValue={dateKey(today())} />
        </Field>
        <Field label="Importe">
          <Input name="amount" required inputMode="decimal" placeholder="25000" />
        </Field>
        <Field label="Categoría">
          <Select name="categoryId" required>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Proveedor">
          <Input name="supplier" />
        </Field>
        <Field label="Medio de pago">
          <Input name="paymentMethod" placeholder="Transferencia, tarjeta…" />
        </Field>
        <Field label="Recurrencia">
          <Select name="recurrence" defaultValue="NONE">
            {RECURRENCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <AccountField accounts={accounts} />
      </FieldRow>
      <Field label="Notas">
        <Textarea name="notes" />
      </Field>
    </ActionForm>
  );
}

export function IncomeForm({
  accounts,
  categories,
}: {
  accounts: AccountSummary[];
  categories: CategoryOption[];
}) {
  return (
    <ActionForm action={createIncomeAction} submitLabel="Registrar ingreso">
      <FieldRow>
        <Field label="Fecha">
          <Input name="date" type="date" required defaultValue={dateKey(today())} />
        </Field>
        <Field label="Importe">
          <Input name="amount" required inputMode="decimal" />
        </Field>
        <Field label="Categoría">
          <Select name="categoryId" required>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Recurrencia">
          <Select name="recurrence" defaultValue="NONE">
            {RECURRENCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <AccountField accounts={accounts} />
      </FieldRow>
      <Field label="Descripción">
        <Input name="description" placeholder="Venta fuera de Mercado Libre, reintegro…" />
      </Field>
    </ActionForm>
  );
}
