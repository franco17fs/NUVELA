import Link from "next/link";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Alert } from "@/financial-engine";

/**
 * Alertas accionables (§26 del brief).
 *
 * Cada alerta lleva a la pantalla donde se resuelve: una alerta que no se puede
 * accionar es ruido. La severidad se comunica con ícono y texto además del
 * color, para no depender de distinguir rojo de ámbar.
 */
export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <Card>
      <CardHeader
        title="Alertas"
        description="Situaciones que conviene mirar hoy."
        action={
          <span className="text-xs text-ink-subtle">{alerts.length} activa(s)</span>
        }
      />
      <CardBody className="space-y-2">
        {alerts.map((alert) => {
          const Icon =
            alert.severity === "CRITICAL"
              ? AlertCircle
              : alert.severity === "WARNING"
                ? AlertTriangle
                : Info;

          const body = (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
                alert.severity === "CRITICAL" &&
                  "border-negative bg-negative-soft",
                alert.severity === "WARNING" &&
                  "border-warning bg-warning-soft",
                alert.severity === "INFO" && "border-border-subtle bg-surface-muted",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  alert.severity === "CRITICAL" && "text-negative",
                  alert.severity === "WARNING" && "text-warning",
                  alert.severity === "INFO" && "text-ink-muted",
                )}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{alert.title}</p>
                {alert.detail ? (
                  <p className="mt-0.5 text-xs text-ink-muted">{alert.detail}</p>
                ) : null}
              </div>
            </div>
          );

          return alert.href ? (
            <Link key={alert.id} href={alert.href} className="block">
              {body}
            </Link>
          ) : (
            <div key={alert.id}>{body}</div>
          );
        })}
      </CardBody>
    </Card>
  );
}
