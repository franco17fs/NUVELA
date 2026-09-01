# Integraciones — endpoints en uso

Registro operativo de **cada endpoint que NUVELA llama**, dónde está implementado
y para qué se usa. La investigación que lo respalda, con las citas de la
documentación oficial, está en
[`mercadolibre-api-research.md`](./mercadolibre-api-research.md).

> **Regla:** no se implementa ningún endpoint que no figure en la investigación.
> Nada de rutas adivinadas ni copiadas de blogs.

**Verificado el 1 de septiembre de 2026.**

---

## Mercado Libre

Base: `https://api.mercadolibre.com`

### OAuth · `src/integrations/mercadolibre/oauth.ts`

| Método | Ruta | Uso | Notas |
|---|---|---|---|
| GET | `https://auth.mercadolibre.com.ar/authorization` | Autorización | Dominio **por site**. PKCE `S256`. `redirect_uri` sin partes variables |
| POST | `/oauth/token` | `authorization_code` y `refresh_token` | Access token 6 h. **Refresh token de un solo uso** |
| GET | `/users/me` | Identificar la cuenta conectada | |

Scopes del flujo: `offline_access read`. No se pide `write`: la aplicación sólo lee.

> Son dos capas distintas y conviven. El **scope** viaja en la URL de
> autorización y define qué pide el flujo; los **permisos funcionales** se
> configuran una vez en el DevCenter y definen a qué recursos puede acceder la
> aplicación (`orders`, `items`, `advertising`, `billing`…). Los dos tienen que
> estar en sólo lectura. El detalle de cuál marcar está en
> [`setup/01-aplicacion-mercado-libre.md`](./setup/01-aplicacion-mercado-libre.md).

### Ventas · `orders.ts`, `shipments.ts`

| Método | Ruta | Uso |
|---|---|---|
| GET | `/orders/search?seller=` | **Fuente primaria de ventas** |
| GET | `/orders/{id}` | Detalle, ítems, pagos, `sale_fee` |
| GET | `/orders/{id}/discounts` | Porción del descuento a cargo del vendedor |
| GET | `/orders/{id}/shipments?list_all=true` | Envíos de la orden |
| GET | `/shipments/{id}` | Detalle del envío |
| GET | `/shipments/{id}/costs` | **Costo del vendedor** (`senders[].cost`) · header `x-format-new: true` |

Filtros usados: `order.status`, `order.date_created.from/to`,
`order.date_last_updated.from/to`, `sort`, `offset`, `limit`.

**Límites que condicionan el diseño**

- Sólo hay **12 meses** de histórico.
- Los filtros de fecha usan hasta la **hora**; minutos y segundos se descartan.
- El campo `save` de `/costs` fue **eliminado** en enero de 2025. No se lee.

### Costos de venta · `listing-prices.ts`

| Método | Ruta | Uso |
|---|---|---|
| GET | `/sites/{site}/listing_prices` | **Simulación**, nunca reemplazo de un cargo real |

Parámetros: `price`, `currency_id`, `category_id`, `listing_type_id`,
`logistic_type`, `shipping_mode`, `billable_weight`, `quantity`, `tags`.

Devuelve `sale_fee_details`: `gross_amount`, `percentage_fee`,
`meli_percentage_fee`, `fixed_fee`, `financing_add_on_fee`.

### Publicidad · `ads.ts`

| Método | Ruta | Header |
|---|---|---|
| GET | `/advertising/advertisers?product_id=PADS` | `Api-Version: 1` |
| GET | `/advertising/advertisers/{id}/product_ads/campaigns` | `api-version: 2` |
| GET | `/advertising/product_ads/campaigns/{id}` | `api-version: 2` |
| GET | `/advertising/advertisers/{id}/product_ads/items` | `api-version: 2` |
| GET | `/advertising/product_ads/items/{id}` | `api-version: 2` |

> **Deprecación:** las rutas legacy del tipo
> `/marketplace/advertising/product_ads/campaigns/{id}/ads/metrics` pueden
> responder `404` desde febrero de 2026. **No se implementan.**

**Límite duro: 90 días hacia atrás.** Por eso `AdMetricDaily` se persiste todos
los días. Las métricas se consolidan a las 10:00 GMT-3.

### Facturación · `billing.ts`

| Método | Ruta |
|---|---|
| GET | `/billing/integration/monthly/periods?group=&document_type=` |
| GET | `/billing/integration/periods/key/{YYYY-MM-01}/documents` |
| GET | `/billing/integration/periods/key/{YYYY-MM-01}/summary/details` |

`group`: `ML` o `MP`. `document_type`: `BILL` o `CREDIT_NOTE`.

**Uso: conciliación, no fuente de ventas.** Los períodos se cierran con retraso.

### Notificaciones · `notifications.ts`, `src/app/api/webhooks/`

| Método | Ruta | Uso |
|---|---|---|
| POST | *(nuestro)* `/api/webhooks/mercadolibre/{secreto}` | Receptor |
| GET | `/missed_feeds?app_id=&topic=` | Notificaciones perdidas |

Tópicos: `orders_v2`, `shipments`, `payments`, `invoices`, `post_purchase`,
`items`.

Requisitos: responder **200 en menos de 500 ms** o el tópico se desactiva.
`missed_feeds` sólo guarda **2 días**.

### Devoluciones — documentado, aún sin job

| Método | Ruta |
|---|---|
| GET | `/post-purchase/v2/claims/{id}/returns` |
| GET | `/post-purchase/v1/returns/{id}/reviews` |
| GET | `/post-purchase/v1/claims/{id}/charges/return-cost` |

El modelo `Refund` y su idempotencia existen y están testeados; falta el job de
sincronización. Las cancelaciones sí llegan hoy, por el propio recurso de órdenes
(`status: cancelled` + `cancel_detail`).

---

## Mercado Pago

Base: `https://api.mercadopago.com`

### OAuth · `src/integrations/mercadopago/oauth.ts`

| Método | Ruta | Notas |
|---|---|---|
| GET | `https://auth.mercadopago.com/authorization` | PKCE `S256` |
| POST | `/oauth/token` | Access token **180 días** |

Credenciales propias (`MP_CLIENT_ID` / `MP_CLIENT_SECRET`), independientes de las
de Mercado Libre. El vínculo con una cuenta se declara explícitamente, no se
adivina.

### Pagos · `payments.ts`

| Método | Ruta | Uso |
|---|---|---|
| GET | `/v1/payments/search` | Enriquece los pagos con `money_release_date` |
| GET | `/v1/payments/{id}` | Detalle |

`money_release_date` es **la pieza central del cashflow**: es lo que separa venta
de cobro.

Un pago sin orden conocida **no se inventa**: se registra como
`ReconciliationIssue` de tipo "cobro sin venta".

### Reportes · `reports.ts`

Dos reportes con el mismo juego de rutas — `release_report` (liberaciones) y
`settlement_report` (todas las transacciones):

```
POST   /v1/account/{reporte}/config
PUT    /v1/account/{reporte}/config
GET    /v1/account/{reporte}/config
POST   /v1/account/{reporte}
POST   /v1/account/{reporte}/schedule
DELETE /v1/account/{reporte}/schedule
GET    /v1/account/{reporte}/task/{task-id}
GET    /v1/account/{reporte}/list
GET    /v1/account/{reporte}/search
GET    /v1/account/{reporte}/{file_name}
```

Columnas que se piden y para qué: `RECORD_TYPE` y `BALANCE_AMOUNT` reconstruyen
el saldo; `MP_FEE_AMOUNT`, `FINANCING_FEE_AMOUNT`, `SHIPPING_FEE_AMOUNT`,
`TAXES_AMOUNT` y `TAX_DETAIL` alimentan la conciliación; `ORDER_ID`,
`SHIPPING_ID`, `PACK_ID` e `ITEM_ID` cruzan con Mercado Libre.

El parser de CSV es propio y respeta comillas: `TAXES_DISAGGREGATED` viene en
JSON, con comas y comillas adentro, y un `split(",")` correría todas las columnas
siguientes. Está testeado con ese caso exacto.

**Estado:** cliente y parser implementados y testeados. Falta el job que descarga
el archivo y lo vuelca a `MercadoPagoMovement`.

### Saldo — no existe

**No hay endpoint oficial y público de saldo en vivo para vendedores.**
`/users/{id}/mercadopago_account/balance` no figura en la documentación y
responde `403`.

NUVELA reconstruye el saldo de los reportes y lo etiqueta **"Saldo conciliado"**.
Nunca "Saldo API en tiempo real".

---

## Lo que NO se puede automatizar

Se declara en lugar de simularlo:

| Dato | Solución |
|---|---|
| Saldo en vivo de Mercado Pago | Saldo conciliado desde reportes, etiquetado |
| Costo de mercadería | Carga manual + costeo propio |
| Gastos e ingresos externos | Carga manual |
| Obligaciones y vencimientos | Carga manual |
| Perfil fiscal | Carga manual, con vigencias |
| Publicidad anterior a 90 días | Persistencia diaria propia |
| Órdenes anteriores a 12 meses | Se declara el techo |
| Si una retención es costo o crédito | Lo declara el usuario; el sistema no decide |

---

## Higiene

- **Validación Zod** de toda respuesta antes de tocar la base. Un campo que
  cambia de tipo produce un error claro, no un `undefined` que se propaga hasta
  el dashboard convertido en cero.
- **Los importes JSON se pasan a string** en el borde, para que el resto del
  sistema los maneje como `Decimal`.
- **Los esquemas ignoran campos desconocidos**: que Mercado Libre agregue un
  campo no rompe la sincronización.
- **Los logs guardan `origin + pathname`**, nunca la query string: algunos
  recursos legacy aceptan `access_token` por query.
- **Rate limit configurable** y `429` contados como evidencia, porque la
  documentación no publica un RPM general.
