import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { formatRelativeSync } from "@/lib/dates";
import type { SyncStatusRow } from "@/server/queries/accounts";

/**
 * Panel de estado de sincronización (§42 del brief).
 *
 * Muestra cuándo se actualizó cada fuente y, sobre todo, cuál falló. El punto
 * del requisito es que un fallo parcial se vea como tal —"Publicidad no pudo
 * actualizarse"— en lugar de romper el dashboard o, peor, mostrar números viejos
 * como si fueran de hoy.
 */
export function SyncStatusPanel({ rows }: { rows: SyncStatusRow[] }) {
  const now = new Date();

  return (
    <Card>
      <CardHeader title="Sincronización" description="Cuándo se actualizó cada fuente." />
      <CardBody className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-muted">Sin cuentas conectadas.</p>
        ) : null}

        {rows.map((row) => (
          <div key={row.accountId}>
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: row.colorHex }}
                aria-hidden
              />
              <p className="text-xs font-semibold text-ink">{row.accountName}</p>
            </div>

            {row.entries.length === 0 ? (
              <p className="mt-1 pl-4 text-xs text-ink-subtle">
                Todavía no se sincronizó nada.
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5 pl-4">
                {row.entries.map((entry) => (
                  <li
                    key={entry.type}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="text-ink-muted">{entry.label}</span>
                    <span
                      className={
                        entry.status === "FAILED"
                          ? "font-medium text-negative"
                          : entry.status === "PARTIAL"
                            ? "text-warning"
                            : "text-ink-subtle"
                      }
                    >
                      {entry.status === "FAILED"
                        ? "no pudo actualizarse"
                        : entry.status === "PARTIAL"
                          ? `parcial · ${formatRelativeSync(entry.lastRun, now)}`
                          : formatRelativeSync(entry.lastRun, now)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
