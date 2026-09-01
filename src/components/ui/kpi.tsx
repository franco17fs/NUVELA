import Link from "next/link";
import type { ReactNode } from "react";
import { formatARS, formatPercent, money, type MoneyInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ValueKindBadge } from "./primitives";

/**
 * KPI del dashboard.
 *
 * Requisito del §45 del brief: cada KPI tiene que responder "¿esto es bueno o
 * malo?". Por eso el componente exige decidir el sentido de la variación
 * (`higherIsBetter`): un margen que sube es bueno, un costo de mercadería que
 * sube no lo es, y pintar los dos de verde sería mentir.
 *
 * La dirección se comunica con flecha Y con color, nunca sólo con color.
 */
export interface KpiProps {
  label: string;
  value: MoneyInput;
  format?: "currency" | "percent" | "number";
  /** Valor del período anterior, para la variación. */
  previous?: MoneyInput;
  /** `pp` para márgenes (puntos porcentuales), `pct` para variación relativa. */
  deltaMode?: "pp" | "pct";
  higherIsBetter?: boolean;
  hint?: string;
  kind?: "ACTUAL" | "ESTIMATED" | "FORECAST";
  /** Si se pasa, el KPI es clickeable y lleva a su desglose auditable (§35). */
  href?: string;
  emphasis?: boolean;
  className?: string;
}

export function Kpi(props: KpiProps) {
  const {
    label,
    value,
    format = "currency",
    previous,
    deltaMode = "pct",
    higherIsBetter = true,
    hint,
    kind,
    href,
    emphasis,
    className,
  } = props;

  const current = money(value);
  const formatted =
    format === "currency"
      ? formatARS(current)
      : format === "percent"
        ? formatPercent(current)
        : current.toDecimalPlaces(0).toString();

  const delta = previous === undefined ? null : computeDelta(current, money(previous), deltaMode);

  const content = (
    <div
      className={cn(
        "card flex h-full flex-col justify-between px-5 py-4 transition",
        href && "hover:border-brand hover:shadow-sm",
        emphasis && "border-brand bg-brand-soft",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* `min-w-0` deja que la etiqueta se corte antes que empujar la insignia
            fuera de la tarjeta: sin esto, "COMPROMETIDO ESTIMADO" se desbordaba. */}
        <p className="min-w-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
          {label}
        </p>
        {kind && kind !== "ACTUAL" ? (
          <span className="shrink-0">
            <ValueKindBadge kind={kind} />
          </span>
        ) : null}
      </div>

      <p
        className={cn(
          "kpi-value mt-2 font-semibold text-ink",
          emphasis ? "text-3xl" : "text-2xl",
          current.isNegative() && "text-negative",
        )}
      >
        {formatted}
      </p>

      {/* Variación y nota van apilados, no en la misma línea: con textos largos
          ("98,5% vs período anterior" + "No es ganancia") se pisaban entre sí. */}
      <div className="mt-1 flex min-h-5 flex-col gap-0.5">
        {delta ? <DeltaIndicator delta={delta} higherIsBetter={higherIsBetter} /> : null}
        {hint ? <span className="text-xs text-ink-subtle">{hint}</span> : null}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {content}
    </Link>
  ) : (
    content
  );
}

interface Delta {
  direction: "up" | "down" | "flat";
  label: string;
}

function computeDelta(
  current: ReturnType<typeof money>,
  previous: ReturnType<typeof money>,
  mode: "pp" | "pct",
): Delta | null {
  if (mode === "pp") {
    const diff = current.minus(previous);
    if (diff.isZero()) return { direction: "flat", label: "sin cambios" };
    return {
      direction: diff.greaterThan(0) ? "up" : "down",
      label: `${diff.abs().toDecimalPlaces(1).toFixed(1)} pp vs período anterior`,
    };
  }

  // Sin base de comparación, una variación porcentual no significa nada:
  // pasar de 0 a 100 no es "+∞%", es "no había datos antes".
  if (previous.isZero()) return null;

  const diff = current.minus(previous).div(previous).times(100);
  if (diff.isZero()) return { direction: "flat", label: "sin cambios" };

  return {
    direction: diff.greaterThan(0) ? "up" : "down",
    label: `${diff.abs().toDecimalPlaces(1).toFixed(1)}% vs período anterior`,
  };
}

function DeltaIndicator({ delta, higherIsBetter }: { delta: Delta; higherIsBetter: boolean }) {
  if (delta.direction === "flat") {
    return <span className="text-xs text-ink-subtle">→ {delta.label}</span>;
  }

  const isGood = higherIsBetter ? delta.direction === "up" : delta.direction === "down";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isGood ? "text-positive" : "text-negative",
      )}
    >
      {/* La flecha además del color: la variación tiene que leerse sin depender
          de distinguir verde de rojo. */}
      <span aria-hidden>{delta.direction === "up" ? "↑" : "↓"}</span>
      {delta.label}
    </span>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {children}
    </div>
  );
}
