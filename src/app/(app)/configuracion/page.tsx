import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/primitives";
import { SettingsForm } from "@/components/settings/settings-form";
import { listAccounts } from "@/server/queries/accounts";
import { getAllSettings } from "@/server/queries/settings";
import { listFiscalProfiles, DEFAULT_TAX_TREATMENT } from "@/server/queries/fiscal";
import { hasMercadoLibreCredentials, hasMercadoPagoCredentials, getEnv } from "@/lib/env";
import type { SearchParams } from "@/server/queries/request-context";

export const dynamic = "force-dynamic";

/**
 * Configuración: conexión de cuentas, parámetros del negocio y perfil fiscal.
 *
 * Es la única pantalla donde el usuario tiene que intervenir con datos que el
 * sistema no puede inferir: las credenciales de las aplicaciones de Mercado
 * Libre y Mercado Pago, el colchón mínimo y su situación impositiva.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [accounts, settings, fiscalProfiles] = await Promise.all([
    listAccounts(),
    getAllSettings(),
    listFiscalProfiles(),
  ]);

  const env = getEnv();
  const mlReady = hasMercadoLibreCredentials();
  const mpReady = hasMercadoPagoCredentials();

  const error = typeof params.error === "string" ? params.error : null;
  const connected = typeof params.conectada === "string" ? params.conectada : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Configuración</h1>
        <p className="text-sm text-ink-muted">
          Conexiones, parámetros del negocio y situación fiscal.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-negative bg-negative-soft px-4 py-3 text-sm text-negative"
        >
          {error}
        </div>
      ) : null}
      {connected ? (
        <div className="rounded-lg border border-positive bg-positive-soft px-4 py-3 text-sm text-positive">
          Cuenta <strong>{connected}</strong> conectada correctamente.
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Cuentas de Mercado Libre"
          description="Podés conectar todas las que necesites; el sistema soporta múltiples vendedores desde el inicio."
        />
        <CardBody className="space-y-4">
          {!mlReady ? (
            <div className="rounded-lg border border-warning bg-warning-soft px-4 py-3 text-sm">
              <p className="font-medium text-warning">
                Faltan las credenciales de la aplicación.
              </p>
              <p className="mt-1 text-ink-muted">
                Creá una aplicación en el DevCenter de Mercado Libre y cargá{" "}
                <code className="rounded bg-surface-sunken px-1">ML_CLIENT_ID</code> y{" "}
                <code className="rounded bg-surface-sunken px-1">ML_CLIENT_SECRET</code>{" "}
                en el archivo <code className="rounded bg-surface-sunken px-1">.env</code>.
                Configurá como redirect URI exactamente:{" "}
                <code className="rounded bg-surface-sunken px-1">
                  {env.ML_REDIRECT_URI}
                </code>
              </p>
            </div>
          ) : null}

          {accounts.length === 0 ? (
            <EmptyState
              title="Ninguna cuenta conectada"
              description="Sin cuentas conectadas no hay ventas que importar. El sistema no muestra datos de ejemplo."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: account.colorHex }}
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-medium text-ink">{account.nickname}</p>
                      <p className="text-xs text-ink-subtle">
                        {account.siteId} ·{" "}
                        {account.hasMercadoPago
                          ? "Mercado Pago vinculado"
                          : "Mercado Pago sin vincular"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        account.status === "ACTIVE"
                          ? "positive"
                          : account.status === "TOKEN_EXPIRED"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {account.status === "ACTIVE"
                        ? "Activa"
                        : account.status === "TOKEN_EXPIRED"
                          ? "Reconectar"
                          : account.status}
                    </Badge>

                    {mpReady && !account.hasMercadoPago ? (
                      <Link
                        href={`/api/oauth/mercadopago/start?accountId=${account.id}`}
                        className="rounded-md border border-border-subtle px-2.5 py-1 text-xs font-medium text-ink-muted hover:border-brand hover:text-brand"
                      >
                        Vincular Mercado Pago
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {mlReady ? (
            <Link
              href="/api/oauth/mercadolibre/start"
              className="inline-flex items-center rounded-md bg-brand px-3 py-2 text-sm font-medium text-white"
            >
              Conectar una cuenta de Mercado Libre
            </Link>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Parámetros del negocio"
          description="Cambiar estos valores nunca requiere tocar código ni volver a desplegar."
        />
        <CardBody>
          <SettingsForm settings={settings} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Perfil fiscal"
          description="Define cómo se tratan las retenciones y percepciones."
        />
        <CardBody>
          {fiscalProfiles.length === 0 ? (
            <div className="space-y-2 text-sm">
              <p className="text-ink-muted">
                Todavía no cargaste un perfil fiscal. Mientras tanto, las retenciones se tratan
                como <strong>crédito fiscal</strong> ({DEFAULT_TAX_TREATMENT}): afectan la caja
                pero no se descuentan del resultado.
              </p>
              <p className="text-ink-subtle">
                Es el supuesto conservador. NUVELA no actúa como contador ni decide por vos si una
                retención es un costo definitivo: eso depende de tu régimen y lo declarás vos.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle text-sm">
              {fiscalProfiles.map((profile) => (
                <li key={profile.id} className="py-2">
                  <p className="font-medium text-ink">
                    {profile.accountName} · {profile.condition}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {profile.province}
                    {profile.iibbStatus ? ` · IIBB ${profile.iibbStatus}` : ""}
                    {profile.sirtacStatus ? ` · SIRTAC ${profile.sirtacStatus}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sincronización automática"
          description="La aplicación no corre un scheduler propio: se dispara desde un cron externo."
        />
        <CardBody className="space-y-2 text-sm text-ink-muted">
          <p>
            Configurá un cron que llame cada 15 minutos al endpoint de sincronización con el
            token <code className="rounded bg-surface-sunken px-1">CRON_SECRET</code>:
          </p>
          <pre className="scroll-slim overflow-x-auto rounded-md bg-surface-sunken p-3 text-xs">
{`curl -X POST "${env.APP_BASE_URL}/api/jobs/sync" \\
  -H "Authorization: Bearer $CRON_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"job":"all"}'`}
          </pre>
          <p>
            Para la importación histórica inicial (hasta 12 meses, que es lo que conserva Mercado
            Libre), usá <code className="rounded bg-surface-sunken px-1">
              {'{"job":"backfill"}'}
            </code>.
          </p>
          <p>
            URL del webhook a registrar en tu aplicación de Mercado Libre:{" "}
            <code className="rounded bg-surface-sunken px-1">
              {env.APP_BASE_URL}/api/webhooks/mercadolibre/&lt;ML_WEBHOOK_SECRET&gt;
            </code>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
