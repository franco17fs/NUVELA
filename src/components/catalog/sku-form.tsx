"use client";

import { ActionForm, Field, FieldRow, Input } from "@/components/ui/form";
import { createSkuAction } from "@/server/actions/catalog";

export function SkuForm() {
  return (
    <ActionForm action={createSkuAction} submitLabel="Crear SKU">
      <FieldRow>
        <Field label="Código" hint="Tiene que ser único">
          <Input name="code" required placeholder="REM-001" />
        </Field>
        <Field label="Nombre">
          <Input name="name" required placeholder="Remera algodón negra M" />
        </Field>
        <Field label="Marca" hint="Opcional">
          <Input name="brand" />
        </Field>
        <Field label="Peso facturable (g)" hint="Para simular costos de envío">
          <Input name="billableWeightGrams" type="number" min={0} />
        </Field>
        <Field label="Stock inicial" hint="Opcional">
          <Input name="initialStock" inputMode="decimal" />
        </Field>
        <Field label="Costo unitario inicial" hint="Opcional">
          <Input name="initialUnitCost" inputMode="decimal" />
        </Field>
      </FieldRow>
    </ActionForm>
  );
}
