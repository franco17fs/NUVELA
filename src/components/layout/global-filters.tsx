"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { PERIOD_PRESETS } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AccountSummary } from "@/server/queries/accounts";

/**
 * Filtros globales de cuenta y período (§47 del brief).
 *
 * El estado vive en la URL, no en React. Así el usuario puede compartir o
 * marcar un enlace a "la quincena de la Cuenta 2" y volver exactamente a lo
 * mismo, y el botón atrás del navegador funciona como se espera.
 */
export function GlobalFilters({ accounts }: { accounts: AccountSummary[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentAccount = searchParams.get("cuenta") ?? "consolidado";
  const currentPeriod = searchParams.get("periodo") ?? "this-month";

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      // Cambiar de período no debería arrastrar un rango personalizado viejo.
      if (key === "periodo" && value !== "custom") {
        params.delete("desde");
        params.delete("hasta");
      }
      startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
    },
    [router, searchParams],
  );

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-6 py-3",
        isPending && "opacity-70",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-ink-muted">Cuenta</span>
        <div className="flex rounded-md border border-border-subtle p-0.5">
          <FilterChip
            active={currentAccount === "consolidado"}
            onClick={() => update("cuenta", "consolidado")}
          >
            Consolidado
          </FilterChip>
          {accounts.map((account) => (
            <FilterChip
              key={account.id}
              active={currentAccount === account.id}
              onClick={() => update("cuenta", account.id)}
              color={account.colorHex}
            >
              {account.nickname}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-ink-muted">Período</span>
        <select
          value={currentPeriod}
          onChange={(event) => update("periodo", event.target.value)}
          className="rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-brand focus:outline-none"
        >
          {PERIOD_PRESETS.filter((preset) => preset.id !== "custom").map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Personalizado</option>
        </select>
      </div>

      {currentPeriod === "custom" ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            defaultValue={searchParams.get("desde") ?? ""}
            onChange={(event) => update("desde", event.target.value)}
            className="rounded-md border border-border-subtle px-2 py-1.5 text-sm"
            aria-label="Desde"
          />
          <span className="text-xs text-ink-subtle">a</span>
          <input
            type="date"
            defaultValue={searchParams.get("hasta") ?? ""}
            onChange={(event) => update("hasta", event.target.value)}
            className="rounded-md border border-border-subtle px-2 py-1.5 text-sm"
            aria-label="Hasta"
          />
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition",
        active
          ? "bg-ink font-medium text-white"
          : "text-ink-muted hover:bg-surface-sunken",
      )}
    >
      {color ? (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
}
