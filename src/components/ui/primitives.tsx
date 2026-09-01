import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Primitivas de interfaz, en la línea de shadcn/ui: componentes sin estado,
 * estilados con Tailwind y compuestos por props.
 *
 * Se escriben a mano en vez de instalar el paquete para tener control total
 * sobre dos cosas que este sistema necesita y una librería genérica no da:
 * el tratamiento tipográfico de los importes (cifras tabulares en todos lados)
 * y las etiquetas REAL / ESTIMADO, que son parte del contrato de honestidad del
 * producto y no un detalle visual.
 */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

/**
 * Etiqueta de procedencia del número (§39 del brief).
 *
 * Es deliberadamente visible: el usuario tiene que poder distinguir de un
 * vistazo un cargo que Mercado Libre realmente cobró de una estimación nuestra.
 */
export function ValueKindBadge({ kind }: { kind: "ACTUAL" | "ESTIMATED" | "FORECAST" }) {
  const styles: Record<typeof kind, string> = {
    ACTUAL: "bg-positive-soft text-positive",
    ESTIMATED: "bg-warning-soft text-warning",
    FORECAST: "bg-brand-soft text-brand",
  };
  const labels: Record<typeof kind, string> = {
    ACTUAL: "REAL",
    ESTIMATED: "ESTIMADO",
    FORECAST: "PROYECTADO",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
        styles[kind],
      )}
    >
      {labels[kind]}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    MELI_API: "Mercado Libre",
    MP_API: "Mercado Pago",
    BILLING_REPORT: "Reporte oficial",
    MANUAL: "Carga manual",
    CALCULATED: "Calculado",
    FORECAST: "Proyección",
  };

  return (
    <span className="inline-flex items-center rounded bg-neutral-chip px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
      {labels[source] ?? source}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning" | "brand";
}) {
  const tones = {
    neutral: "bg-neutral-chip text-ink-muted",
    positive: "bg-positive-soft text-positive",
    negative: "bg-negative-soft text-negative",
    warning: "bg-warning-soft text-warning",
    brand: "bg-brand-soft text-brand",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-md text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-slim overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      className={cn(
        "border-b border-border-subtle px-3 py-2 text-xs font-semibold text-ink-muted",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-border-subtle px-3 py-2 text-ink",
        align === "right" && "text-right tabular",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}
