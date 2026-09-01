"use client";

import { useState } from "react";
import { ActionForm, Input } from "@/components/ui/form";
import {
  payObligationAction,
  reserveForObligationAction,
} from "@/server/actions/manual-entries";
import { dateKey, today } from "@/lib/dates";

/**
 * Reservar y pagar una obligación.
 *
 * Son dos operaciones distintas y la diferencia importa: **reservar** aparta
 * dinero conceptualmente —deja de contarse como disponible pero sigue en la
 * cuenta— mientras que **pagar** registra una salida real de caja. Confundirlas
 * haría que el disponible seguro quedara mal en cualquiera de las dos
 * direcciones.
 */
export function ObligationActions({ obligationId }: { obligationId: string }) {
  const [mode, setMode] = useState<"none" | "reserve" | "pay">("none");

  if (mode === "none") {
    return (
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setMode("reserve")}
          className="rounded border border-border-subtle px-2 py-0.5 text-xs text-ink-muted hover:border-brand hover:text-brand"
        >
          Reservar
        </button>
        <button
          type="button"
          onClick={() => setMode("pay")}
          className="rounded border border-border-subtle px-2 py-0.5 text-xs text-ink-muted hover:border-positive hover:text-positive"
        >
          Pagar
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-52">
      <ActionForm
        action={mode === "reserve" ? reserveForObligationAction : payObligationAction}
        submitLabel={mode === "reserve" ? "Reservar" : "Registrar pago"}
        successMessage="Listo."
        className="space-y-1.5"
      >
        <input type="hidden" name="obligationId" value={obligationId} />
        {mode === "pay" ? (
          <input type="hidden" name="date" value={dateKey(today())} />
        ) : null}
        <Input name="amount" placeholder="Importe" inputMode="decimal" required autoFocus />
        <button
          type="button"
          onClick={() => setMode("none")}
          className="text-xs text-ink-subtle hover:underline"
        >
          Cancelar
        </button>
      </ActionForm>
    </div>
  );
}
