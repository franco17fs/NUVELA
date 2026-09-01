"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/actions/manual-entries";

/**
 * Formulario conectado a una acción de servidor.
 *
 * Centraliza tres cosas que todos los formularios de carga manual necesitan:
 * estado de envío, mensaje de error legible y limpieza del formulario al
 * guardar. El error viene del `ActionResult`, nunca de una excepción cruda, así
 * que el usuario ve "Ingresá un importe" y no un stack trace (§44 del brief).
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Guardar",
  successMessage = "Guardado.",
  className,
  resetOnSuccess = true,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel?: string;
  successMessage?: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className={cn("space-y-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        setSuccess(false);

        startTransition(async () => {
          const result = await action(formData);
          if (result.ok) {
            setSuccess(true);
            if (resetOnSuccess) formRef.current?.reset();
          } else {
            setError(result.error);
          }
        });
      }}
    >
      {children}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Guardando…" : submitLabel}
        </button>

        {error ? (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        ) : null}
        {success && !error ? (
          <p className="text-sm text-positive">{successMessage}</p>
        ) : null}
      </div>
    </form>
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-[11px] text-ink-subtle">{hint}</span> : null}
    </label>
  );
}

const CONTROL_CLASS =
  "w-full rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-brand focus:outline-none";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL_CLASS, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(CONTROL_CLASS, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CONTROL_CLASS, props.className)} rows={2} />;
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
