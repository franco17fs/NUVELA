"use client";

import { ActionForm, Field, FieldRow, Input, Select } from "@/components/ui/form";
import { linkListingAction } from "@/server/actions/catalog";
import type { AccountSummary } from "@/server/queries/accounts";

/**
 * Vincula una publicación de Mercado Libre con un SKU interno.
 *
 * Es lo que permite imputar costo de mercadería a una venta. `unitsPerListing`
 * cubre los kits: si una publicación vende un pack de 3, cada venta consume 3
 * unidades de stock.
 */
export function ListingMappingForm({
  accounts,
  skus,
}: {
  accounts: AccountSummary[];
  skus: { id: string; code: string; name: string }[];
}) {
  if (accounts.length === 0 || skus.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Necesitás al menos una cuenta conectada y un SKU cargado para poder vincularlos.
      </p>
    );
  }

  return (
    <ActionForm action={linkListingAction} submitLabel="Vincular publicación">
      <FieldRow>
        <Field label="Cuenta">
          <Select name="sellerAccountId" required>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.nickname}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ID de publicación">
          <Input name="mlItemId" required placeholder="MLA123456789" />
        </Field>
        <Field label="ID de variación" hint="Vacío si no tiene variaciones">
          <Input name="variationId" />
        </Field>
        <Field label="SKU">
          <Select name="skuId" required>
            {skus.map((sku) => (
              <option key={sku.id} value={sku.id}>
                {sku.code} · {sku.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unidades por venta" hint="3 si la publicación es un pack de 3">
          <Input name="unitsPerListing" inputMode="decimal" defaultValue="1" />
        </Field>
      </FieldRow>
    </ActionForm>
  );
}
