"use client";

import { ActionForm, Field, FieldRow, Input } from "@/components/ui/form";
import { saveSettingsAction } from "@/server/actions/settings";
import type { SettingKey } from "@/server/queries/settings";

export function SettingsForm({ settings }: { settings: Record<SettingKey, string> }) {
  return (
    <ActionForm
      action={saveSettingsAction}
      submitLabel="Guardar parámetros"
      successMessage="Parámetros actualizados."
      resetOnSuccess={false}
    >
      <FieldRow>
        <Field
          label="Colchón mínimo"
          hint="Plata que nunca se considera disponible."
        >
          <Input name="safetyBuffer" type="text" defaultValue={settings.safetyBuffer} inputMode="decimal" />
        </Field>

        <Field label="Horizonte de vencimientos" hint="Días considerados 'próximos'.">
          <Input
            name="obligationHorizonDays"
            type="number"
            min={1}
            max={365}
            defaultValue={settings.obligationHorizonDays}
          />
        </Field>

        <Field label="Alerta publicidad / ventas" hint="En %.">
          <Input
            name="adsOverSalesPct"
            type="number"
            step="0.1"
            defaultValue={settings.adsOverSalesPct}
          />
        </Field>

        <Field label="Alerta caída de margen" hint="En puntos porcentuales.">
          <Input
            name="marginDropPoints"
            type="number"
            step="0.1"
            defaultValue={settings.marginDropPoints}
          />
        </Field>

        <Field label="Alerta suba de costo" hint="En %.">
          <Input name="costRisePct" type="number" step="0.1" defaultValue={settings.costRisePct} />
        </Field>
      </FieldRow>
    </ActionForm>
  );
}
