import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  SourceBadge,
  ValueKindBadge,
} from "@/components/ui/primitives";
import { formatARS, formatPercent } from "@/lib/money";
import { formatBusinessDateLong } from "@/lib/dates";
import { getOrderProfitability } from "@/server/queries/profitability";
import { withFilters, type SearchParams } from "@/server/queries/request-context";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Rentabilidad de una venta (§28 del brief).
 *
 * Muestra el waterfall completo: del precio del producto a la ganancia, con cada
 * escalón etiquetado como REAL o ESTIMADO y con su fuente. Es la pantalla que
 * hace auditable el margen: no hay ningún número acá que no se pueda rastrear
 * hasta el dato que lo originó.
 */
export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const data = await getOrderProfitability(id);

  if (!data) notFound();

  const { result, order } = data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={withFilters("/ventas", query)}
            className="text-xs text-brand hover:underline"
          >
            ← Volver a ventas
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            Venta #{order.mlOrderId}
          </h1>
          <p className="text-sm text-ink-muted">
            {formatBusinessDateLong(order.businessDate)} · {order.accountName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result.hasEstimates ? (
            <Badge tone="warning">Contiene estimaciones</Badge>
          ) : (
            <Badge tone="positive">Todos los cargos son reales</Badge>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Waterfall de la venta"
            description="Del precio del producto a la ganancia, escalón por escalón."
          />
          <CardBody className="space-y-0">
            {result.waterfall.map((step, index) => {
              const isSubtotal = step.effect === "SUBTOTAL";
              const isInformational =
                isSubtotal && step.label === "Retenciones / percepciones";

              return (
                <div
                  key={`${step.label}-${index}`}
                  className={cn(
                    "flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle py-2.5 last:border-b-0",
                    isSubtotal && !isInformational && "bg-surface-muted px-2",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "text-sm",
                        isSubtotal && !isInformational
                          ? "font-semibold text-ink"
                          : "text-ink-muted",
                      )}
                    >
                      {step.effect === "NEGATIVE" ? "− " : ""}
                      {step.label}
                    </span>
                    <ValueKindBadge kind={step.kind} />
                    <SourceBadge source={step.source} />
                  </div>

                  <div className="flex items-baseline gap-4">
                    <span
                      className={cn(
                        "tabular text-sm",
                        step.effect === "NEGATIVE" && "text-negative",
                      )}
                    >
                      {formatARS(step.amount)}
                    </span>
                    {!isInformational ? (
                      <span
                        className={cn(
                          "tabular w-32 text-right text-sm",
                          isSubtotal ? "font-semibold" : "text-ink-subtle",
                          step.runningTotal.isNegative() && "text-negative",
                        )}
                      >
                        {formatARS(step.runningTotal)}
                      </span>
                    ) : (
                      <span className="w-32" />
                    )}
                  </div>

                  {step.note ? (
                    <p className="w-full text-xs text-ink-subtle">{step.note}</p>
                  ) : null}
                </div>
              );
            })}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Resultado" />
            <CardBody className="space-y-2 text-sm">
              <Row label="Facturación bruta" value={formatARS(result.grossRevenue)} />
              <Row label="Facturación neta" value={formatARS(result.netRevenue)} />
              <Row label="Costo de mercadería" value={formatARS(result.cogs)} />
              <Row label="Margen bruto" value={formatARS(result.grossMargin)} />
              <div className="border-t border-border-subtle pt-2">
                <Row
                  label="Margen de contribución"
                  value={formatARS(result.contributionMargin)}
                  emphasis
                />
                <Row label="Margen %" value={formatPercent(result.marginPct)} />
              </div>
            </CardBody>
          </Card>

          {result.estimatedComponents.length > 0 ? (
            <Card>
              <CardHeader
                title="Qué falta para que sea exacto"
                description="Estos componentes hoy son estimados."
              />
              <CardBody>
                <ul className="list-inside list-disc space-y-1 text-sm text-ink-muted">
                  {result.estimatedComponents.map((component) => (
                    <li key={component}>{component}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={emphasis ? "font-semibold text-ink" : "text-ink-muted"}>
        {label}
      </span>
      <span className={cn("tabular", emphasis && "text-base font-semibold")}>{value}</span>
    </div>
  );
}
