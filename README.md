# NUVELA

Centro financiero, de rentabilidad y cashflow para vendedores de Mercado Libre
Argentina. Administra varias cuentas desde una misma interfaz, con vista por
cuenta y consolidada.

Está hecho para responder en menos de un minuto, todos los días:

- ¿Cuánto vendí?
- ¿Cuánto gané? *(que no es lo mismo)*
- ¿Cuánto dinero tengo realmente? *(que tampoco es lo mismo)*
- ¿Cuánto necesito para reponer mercadería?
- ¿Cuánto está comprometido?
- ¿Cuánto debo guardar hoy?
- ¿Cuánto puedo gastar hoy sin poner en riesgo el negocio?
- ¿Voy a poder pagar los vencimientos de las próximas semanas?

---

## Lo que hace distinto a este sistema

### Separa rentabilidad de cashflow

Una venta de hoy afecta el resultado de hoy, pero el dinero puede estar
disponible en Mercado Pago días después. Son dos pantallas distintas y dos
conjuntos de datos distintos. Nunca se mezclan.

### Distingue lo real de lo estimado

Cada importe lleva su procedencia visible: **REAL** si es un cargo que Mercado
Libre efectivamente cobró, **ESTIMADO** si lo calculamos nosotros. Una estimación
jamás se presenta como un cargo real.

### No inventa datos

- Mercado Pago **no expone un saldo en vivo por API** para vendedores. El sistema
  reconstruye el saldo de los reportes oficiales y lo llama por su nombre:
  *"Saldo conciliado"*, con la fecha hasta la que llega la conciliación.
- Sin cuentas conectadas, el dashboard está vacío. No hay datos de ejemplo.
- Si falta el costo de un SKU, el margen se marca como incompleto en vez de
  calcularse con un costo inventado.

### No trata toda retención como pérdida

Una retención puede ser crédito fiscal —un activo a recuperar— y no un costo. El
tratamiento lo declara el usuario según su régimen. El sistema no actúa de
contador.

### Todo número es auditable

"Comisiones este mes: $2.350.500" se puede abrir y ver qué ventas y qué cargos lo
componen, con la fuente de cada uno.

---

## Puesta en marcha

```bash
cp .env.example .env

# clave de cifrado de credenciales (32 bytes en base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm install
npm run db:up        # PostgreSQL en Docker
npm run db:migrate
npm run db:seed      # categorías y reglas de referencia
npm run dev
```

En `http://localhost:3000/configuracion` se conectan las cuentas.

### Guías paso a paso

Crear las aplicaciones de Mercado Libre y Mercado Pago tiene varios detalles que
conviene no adivinar: el redirect URI exige HTTPS, los scopes hay que elegirlos
bien y el orden de carga inicial afecta el resultado. Está todo en
**[`docs/setup/`](docs/setup/README.md)**:

| | Guía |
|---|---|
| 1 | [Crear la aplicación en Mercado Libre](docs/setup/01-aplicacion-mercado-libre.md) |
| 2 | [Crear la aplicación en Mercado Pago](docs/setup/02-aplicacion-mercado-pago.md) |
| 3 | [Redirect URI y webhooks](docs/setup/03-redirect-uri-y-webhooks.md) |
| 4 | [Primera sincronización](docs/setup/04-primera-sincronizacion.md) |

Las credenciales las genera el usuario; el sistema no puede obtenerlas:

| Variable | Dónde se obtiene |
|---|---|
| `ML_CLIENT_ID` / `ML_CLIENT_SECRET` | DevCenter de Mercado Libre |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | Panel de aplicaciones de Mercado Pago |
| `ENCRYPTION_KEY` | Se genera con el comando de arriba |
| `ML_WEBHOOK_SECRET` / `CRON_SECRET` | Cualquier cadena aleatoria larga |

El `redirect_uri` registrado en la aplicación de Mercado Libre tiene que
coincidir **exactamente** con `ML_REDIRECT_URI`, y **debe ser HTTPS**:
`localhost` no se puede cargar. La guía 3 explica las alternativas.

### Sincronización

No hay scheduler interno. Un cron externo llama:

```bash
curl -X POST "$APP_BASE_URL/api/jobs/sync" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"job":"all"}'
```

Para la importación histórica inicial: `{"job":"backfill"}` (hasta 12 meses, que
es lo que conserva Mercado Libre).

---

## Verificación

```bash
npm run check      # lint + typecheck + tests
npm test           # sólo tests
```

116 tests, incluidos los catorce casos críticos: umbral de cargo fijo, cuotas,
envío gratis, publicidad, devoluciones total y parcial, promedio ponderado, costo
histórico, obligación futura, saldo insuficiente, dos sellers, orden duplicada
por webhook y refund recibido dos veces.

---

## Pantallas

| | |
|---|---|
| **Dashboard** | Los seis KPIs, la foto del día y las alertas |
| **Ventas** | Listado con margen; cada venta abre su waterfall completo |
| **Productos** | Vínculo publicación ↔ SKU, con las publicaciones sin mapear primero |
| **Rentabilidad** | Por SKU, con margen antes y después de publicidad |
| **Mercadería** | Stock, costo promedio y fondo de reposición |
| **Compras** | Carga de compras; actualiza el costo promedio |
| **Publicidad** | Product Ads con histórico propio |
| **Cashflow** | Semana por semana, real / programado / estimado |
| **Obligaciones** | Vencimientos, bolsillos y cuánto separar por día, con su explicación |
| **Ingresos/Egresos** | Movimientos manuales |
| **Mercado Pago** | Saldo conciliado, pendiente de liberar y comprometido |
| **Facturación** | Períodos y documentos de ML y MP |
| **Conciliación** | Diferencias detectadas; ninguna se borra en silencio |
| **Proyecciones** | Escenarios conservador / base / optimista, con sus supuestos |
| **Configuración** | Cuentas, parámetros del negocio y perfil fiscal |

---

## Documentación

| Documento | Qué contiene |
|---|---|
| [`docs/setup/`](docs/setup/README.md) | **Puesta en marcha paso a paso**: crear las aplicaciones, redirect URI, webhooks y primera sincronización |
| [`docs/mercadolibre-api-research.md`](docs/mercadolibre-api-research.md) | **Investigación de las APIs oficiales**: cada endpoint verificado, sus límites, y qué NO se puede automatizar |
| [`docs/architecture.md`](docs/architecture.md) | Capas, decisiones y qué falta |
| [`docs/financial-model.md`](docs/financial-model.md) | **Todas las fórmulas**, con sus supuestos |
| [`docs/database-model.md`](docs/database-model.md) | Modelo de datos y reglas de integridad |
| [`docs/sync-strategy.md`](docs/sync-strategy.md) | Webhooks, barridos e idempotencia |
| [`docs/cashflow-engine.md`](docs/cashflow-engine.md) | Saldo, disponible seguro, reserva diaria y proyección |
| [`docs/integrations.md`](docs/integrations.md) | Registro de cada endpoint en uso |

---

## Estado

Implementado y funcionando: fases 0 a 10 del plan (investigación, arquitectura,
OAuth multi-cuenta, sincronización de ventas, costeo y COGS, motor de
rentabilidad, dashboard, Mercado Pago, cashflow, obligaciones con motor de
reserva diaria, y publicidad).

Pendiente, con el detalle en [`docs/architecture.md`](docs/architecture.md):
importación de los reportes de Mercado Pago y de facturación (los clientes y el
parser están hechos y testeados; falta el job), cruce automático de conciliación,
exportación a CSV/XLSX/PDF, y costeo FIFO.

---

## Nota sobre `index.html`, `callback.js` y `styles.css`

Son el bridge estático de OAuth publicado en GitHub Pages, previo a esta
aplicación. Se conservan en la raíz para no romper esa publicación; no forman
parte del proyecto Next.js y están excluidos del lint.
