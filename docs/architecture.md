# Arquitectura

## Objetivo

Que todos los días se pueda abrir la aplicación y responder en menos de un minuto:
cuánto vendí, cuánto gané, cuánto dinero tengo realmente, cuánto necesito para
reponer mercadería, cuánto está comprometido, cuánto debo guardar hoy, cuánto
puedo gastar sin poner en riesgo el negocio y si voy a poder pagar los
vencimientos de las próximas semanas.

---

## Stack

| Capa | Elección | Por qué |
|---|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript estricto | Renderizado en servidor: los cálculos financieros y los secretos nunca bajan al navegador |
| Estilos | Tailwind CSS 4 | Sistema de diseño por tokens en `@theme` |
| Componentes | Primitivas propias en la línea de shadcn/ui | Control total sobre el tratamiento tipográfico de los importes y sobre las etiquetas REAL/ESTIMADO, que son parte del contrato del producto |
| Base | PostgreSQL 16 + Prisma 6 | `NUMERIC` exacto para dinero; Docker Compose para desarrollo |
| Validación | Zod 4 | En el borde de las APIs externas y en cada formulario |
| Gráficos | Recharts | |
| Dinero | decimal.js | Nunca punto flotante |
| Tests | Vitest | El motor financiero es puro y se testea sin base ni red |

### Desvíos respecto de la preferencia del brief, y su razón

- **Prisma 6 y no 7.** La 7 está en release candidate y cambia el generador de
  cliente. Para un sistema financiero conviene la versión estable.
- **Primitivas de UI propias en vez del CLI de shadcn/ui.** Misma filosofía
  (componentes sin estado, estilados con Tailwind, compuestos por props) pero
  escritas a mano, porque hacían falta dos cosas que una librería genérica no da:
  cifras tabulares en todos los importes y las insignias REAL / ESTIMADO.
- **Sin scheduler propio.** La sincronización se dispara desde un cron externo
  contra `/api/jobs/sync`. Un proceso de fondo dentro de Next complica el
  despliegue sin aportar nada.

---

## Capas

```
┌─────────────────────────────────────────────────────────────┐
│  src/app/(app)/**        Pantallas (React Server Components)│
│  src/components/**       Presentación. CERO fórmulas.        │
└───────────────────────────┬─────────────────────────────────┘
                            │ lee
┌───────────────────────────▼─────────────────────────────────┐
│  src/server/queries/**   Consultas. Leen la base y delegan   │
│                          el cálculo. CERO fórmulas.          │
│  src/server/actions/**   Acciones de carga manual            │
└───────────────────────────┬─────────────────────────────────┘
                            │ usa
┌───────────────────────────▼─────────────────────────────────┐
│  src/financial-engine/** MOTOR FINANCIERO                    │
│                          Puro: sin base, sin red, sin React  │
│                          TODAS las fórmulas viven acá        │
└───────────────────────────▲─────────────────────────────────┘
                            │ alimentan
┌───────────────────────────┴─────────────────────────────────┐
│  src/server/sync/**      Sincronización idempotente          │
│  src/server/costing/**   Costeo y movimientos de stock       │
│  src/integrations/**     Clientes de Mercado Libre y Pago    │
└───────────────────────────┬─────────────────────────────────┘
                            │ escriben
┌───────────────────────────▼─────────────────────────────────┐
│  PostgreSQL                                                  │
└──────────────────────────────────────────────────────────────┘
```

### La regla de flujo

**El dashboard consulta PostgreSQL, nunca las APIs externas** (§43 del brief).
Las integraciones alimentan la base en jobs aparte. Abrir el dashboard no
dispara ni una llamada a Mercado Libre.

### La regla del motor

`src/financial-engine/` es **puro**: no importa Prisma, no hace `fetch`, no sabe
de React. Recibe estructuras planas y devuelve resultados. Eso permite testear
cada fórmula de forma aislada y determinística, y garantiza que no haya dos
implementaciones del mismo cálculo.

---

## Mapa de directorios

```
src/
  app/
    (app)/                 Pantallas con sidebar y filtros globales
      page.tsx             Dashboard
      ventas/[id]/         Waterfall de una venta
      ...
    api/
      oauth/               Inicio y callback de ML y MP
      webhooks/            Receptor de notificaciones
      jobs/sync/           Disparador para el cron externo
  components/
    ui/                    Primitivas: Card, Kpi, Table, formularios
    layout/                Sidebar y filtros globales
    dashboard/             Gráfico, alertas, estado de sincronización
  financial-engine/        EL MOTOR — todas las fórmulas
    order-profitability.ts Waterfall de una venta
    margins.ts             Definiciones del §29 y rentabilidad por SKU
    inventory.ts           Costeo y fondo de reposición
    cash.ts                Disponible seguro y orden de asignación
    daily-reserve.ts       Motor de reserva diaria
    cashflow.ts            Cashflow semanal
    forecast.ts            Proyección estadística
    balance.ts             Reconstrucción del saldo de Mercado Pago
    consolidation.ts       Suma multi-cuenta sin mezclar IDs
    alerts.ts              Alertas derivadas
  integrations/
    http.ts                Cliente común: rate limit, backoff, higiene de logs
    mercadolibre/          OAuth, órdenes, envíos, listing_prices, ads, billing
    mercadopago/           OAuth, pagos, reportes
  server/
    tokens.ts              Custodia de credenciales con lock de refresh
    sync/                  Sincronización, mapeo e idempotencia
    costing/               COGS y compras
    queries/               Lectura para las pantallas
    actions/               Escritura desde formularios
  lib/
    money.ts               Aritmética decimal
    dates.ts               Fechas de negocio (aritmética UTC pura)
    crypto.ts              AES-256-GCM
    env.ts                 Configuración validada con Zod
    errors.ts              Errores con mensaje seguro para el usuario
```

---

## Decisiones que vale la pena conocer

### Fechas de negocio con aritmética UTC pura

Una "fecha de negocio" es un día calendario sin hora, materializado como `Date` a
medianoche **UTC** (lo que espera una columna `@db.Date`). Sobre esos valores
**no** se pueden usar las funciones de date-fns, que operan en la zona local del
proceso: en un servidor con TZ −03:00, la medianoche UTC del 1 de septiembre es
"31 de agosto 21:00" y `startOfMonth()` devolvería agosto.

Por eso `src/lib/dates.ts` implementa su propia aritmética con `Date.UTC` y
`getUTC*`. date-fns-tz se usa sólo para lo que corresponde: convertir entre un
instante real y la zona del negocio.

Una venta de las 22:30 del 31 de agosto en Buenos Aires es de **agosto**, aunque
en UTC ya sea septiembre.

### Idempotencia por índice único, con claves explícitas

La garantía contra duplicados son los índices únicos de PostgreSQL. Pero **un
índice único con columnas NULL no deduplica**: dos filas con NULL en la columna
son distintas para Postgres. Varias claves del diseño original tenían columnas
opcionales y por lo tanto no protegían nada.

Las tablas afectadas usan hoy una columna `dedupeKey` de texto, siempre presente,
calculada por la aplicación en `src/server/sync/idempotency.ts` y testeada.

### El refresh token de un solo uso

Mercado Libre invalida el `refresh_token` apenas se usa. Dos procesos que
refresquen a la vez dejan la cuenta desconectada. El refresh se serializa con un
`UPDATE ... WHERE refreshLockedAt IS NULL` atómico; el que pierde espera y
vuelve a leer. El lock tiene vencimiento para que un proceso caído no bloquee la
cuenta para siempre.

### Webhook que no hace nada

Mercado Libre exige responder **200 en menos de 500 ms** o desactiva el tópico, y
las notificaciones de ese período no se recuperan. El handler sólo valida,
inserta en `WebhookEvent` y responde. Ninguna llamada a la API, ningún cálculo.
Incluso ante un fallo de base responde 200: un error dispararía reintentos y
acercaría la desactivación.

### Fallos aislados

Cada job corre dentro de `runSyncJob`, que captura el error, lo registra y
devuelve un resultado. Si la publicidad falla, las ventas se sincronizan igual y
el dashboard muestra "Publicidad no pudo actualizarse" en vez de romperse.

---

## Seguridad

| Requisito | Cómo |
|---|---|
| Tokens cifrados | AES-256-GCM con tag de autenticación; un token manipulado falla al descifrar |
| Secretos sólo en servidor | Los módulos sensibles importan `server-only`: usarlos desde un componente de cliente rompe el build |
| Webhooks validados | Secreto en la URL comparado en tiempo constante, más allowlist de IP opcional |
| Endpoints protegidos | `/api/jobs/sync` exige `CRON_SECRET` |
| Rate limits | Limitador por cuenta, backoff con jitter, `Retry-After` respetado |
| Entradas saneadas | Zod en cada formulario y en cada respuesta de API externa |
| Logs sin tokens | Se registra sólo `origin + pathname`, nunca la query string |
| Sin stack traces al usuario | Cada error lleva un `userMessage` seguro; el detalle va al log |
| Datos personales | Se guarda sólo `buyer.id`; nunca nombre, documento ni dirección |

---

## Puesta en marcha

```bash
cp .env.example .env
# generar la clave de cifrado:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm install
npm run db:up          # PostgreSQL en Docker
npm run db:migrate
npm run db:seed        # categorías y reglas de referencia; NO crea datos ficticios
npm run dev
```

Verificación completa:

```bash
npm run check          # lint + typecheck + tests
```

---

## Lo que falta (fases 11 y 12 del brief)

Con honestidad sobre el estado real:

- **Importación de reportes de Mercado Pago**: los clientes de la API de reportes
  están implementados y documentados, pero falta el job que descarga el CSV, lo
  parsea (el parser existe y está testeado) y lo vuelca a `MercadoPagoMovement`.
  Hasta que exista, la pantalla de Mercado Pago dice "sin reportes importados" en
  lugar de mostrar un saldo inventado.
- **Sincronización de facturación**: mismo caso — cliente listo, job pendiente.
- **Detección automática de diferencias de conciliación**: el modelo
  `ReconciliationIssue` y la pantalla existen, y ya se registran los problemas
  que aparecen durante la sincronización (órdenes que fallan, pagos sin venta).
  Falta el cruce sistemático órdenes ↔ pagos ↔ movimientos ↔ facturación.
- **Exportación a CSV/XLSX/PDF** del cierre mensual.
- **FIFO**: la interfaz de costeo está preparada, pero `getCostingStrategy("FIFO")`
  lanza un error explícito en vez de caer en silencio al promedio ponderado, que
  daría números distintos sin avisar.
