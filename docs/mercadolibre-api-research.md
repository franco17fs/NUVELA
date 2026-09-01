# FASE 0 — Investigación de APIs oficiales (Mercado Libre + Mercado Pago Argentina)

> **Fecha de verificación:** 1 de septiembre de 2026
> **Sitio objetivo:** `MLA` (Mercado Libre Argentina)
> **Método:** lectura de la documentación oficial en `developers.mercadolibre.com.ar`,
> `developers.mercadolivre.com.br` (mismo contenido en inglés) y
> `www.mercadopago.com.ar/developers`, más verificación de existencia de cada endpoint
> contra `api.mercadolibre.com` / `api.mercadopago.com` (una respuesta `401`/`403` de
> política confirma que la ruta existe y está protegida; un `404` indicaría que no existe).
>
> **Regla del proyecto:** no se implementa ningún endpoint que no figure en este documento.
> Si un dato no se puede obtener por API, se declara explícitamente en la sección
> [§10 Qué NO se puede automatizar](#10-qué-no-se-puede-automatizar).

---

## 0. Cómo leer este documento

Cada endpoint se documenta con:

| Campo | Significado |
|---|---|
| **Endpoint** | Método + path exacto |
| **Propósito** | Para qué lo usa NUVELA |
| **Scopes** | Permisos OAuth requeridos |
| **Paginación** | Mecanismo y límites |
| **Rate limit** | Lo que la documentación declara (ver §9) |
| **Estado** | `VIGENTE` / `DEPRECADO` / `NO DOCUMENTADO` |
| **Uso en NUVELA** | `FUENTE PRIMARIA`, `CONCILIACIÓN`, `SIMULACIÓN`, `FALLBACK` |

Los importes que NUVELA persiste guardan siempre `source` + `sourceReferenceId` + `syncedAt`
(ver `docs/database-model.md`), de modo que todo número del dashboard es auditable hasta
la llamada de API que lo originó.

---

## 1. Autenticación y autorización (OAuth 2.0)

**Fuente:** <https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion>

### 1.1 Autorización

```
GET https://auth.mercadolibre.com.ar/authorization
    ?response_type=code
    &client_id=$APP_ID
    &redirect_uri=$REDIRECT_URI
    &state=$STATE
    &code_challenge=$CODE_CHALLENGE
    &code_challenge_method=S256
```

- **Estado:** VIGENTE.
- El dominio de autorización es **por site**: para Argentina es `auth.mercadolibre.com.ar`.
- `redirect_uri` debe coincidir **exactamente** con el registrado en la aplicación y
  **no puede llevar información variable**. Por eso todo dato de contexto viaja en `state`.
- **PKCE** (`code_challenge` + `code_challenge_method`) es opcional a nivel plataforma
  pero NUVELA lo usa **siempre** con `S256`; `plain` está desaconsejado por la propia
  documentación.

### 1.2 Intercambio de código por token

```
POST https://api.mercadolibre.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
client_id=$APP_ID
client_secret=$SECRET
code=$CODE
redirect_uri=$REDIRECT_URI
code_verifier=$CODE_VERIFIER
```

Respuesta (campos relevantes): `access_token`, `token_type`, `expires_in`, `scope`,
`user_id`, `refresh_token`.

### 1.3 Refresh

```
POST https://api.mercadolibre.com/oauth/token
grant_type=refresh_token
client_id=$APP_ID
client_secret=$SECRET
refresh_token=$REFRESH_TOKEN
```

**Hechos críticos verificados en la documentación oficial:**

1. El `access_token` **expira a las 6 horas**.
2. El `refresh_token` es de **un solo uso**: en cada refresh se recibe uno nuevo y el
   anterior queda inutilizable.
3. Los scopes válidos son exactamente **`offline_access`, `read`, `write`**.
   Cualquier otro valor devuelve `invalid_scope`.
4. `offline_access` es lo que habilita la emisión de `refresh_token`.

> **Consecuencia de diseño (importante):** como el `refresh_token` es de un solo uso, dos
> procesos que refresquen en paralelo se pisan y dejan la cuenta desconectada. NUVELA
> serializa el refresh por cuenta con un lock a nivel base de datos
> (`SELECT ... FOR UPDATE` sobre `OAuthToken`) — ver `docs/sync-strategy.md`.

**Scopes usados por NUVELA:** `offline_access read`.
No pedimos `write`: la aplicación es de lectura financiera y no modifica publicaciones,
precios ni envíos. Esto reduce el daño posible ante una fuga de token.

### 1.4 Usuario autenticado

```
GET https://api.mercadolibre.com/users/me
```
Devuelve `id`, `nickname`, `site_id`, etc. NUVELA lo usa para poblar `SellerAccount`
al conectar y para verificar que un token sigue vivo.

---

## 2. Ventas: órdenes, packs, pagos y envíos

**Fuente:** <https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas>

### 2.1 Búsqueda de órdenes — FUENTE PRIMARIA de ventas

```
GET https://api.mercadolibre.com/orders/search?seller=$SELLER_ID
```

**Filtros documentados:**

| Parámetro | Uso |
|---|---|
| `order.status` | varios separados por coma (`paid`, `cancelled`, …) |
| `tags` / `tags.not` | varios separados por coma |
| `order.date_created.from` / `.to` | rango de creación (ISO-8601 con offset) |
| `order.date_last_updated.from` / `.to` | rango de última modificación |
| `order.date_closed.from` / `.to` | rango de cierre |
| `mediations.status` | estado de mediaciones |
| `feedback.status` | estado del feedback |
| `q` | búsqueda libre (ej.: por número de orden) |
| `sort` | `date_asc` / `date_desc` |

**Paginación:** `offset` + `limit`; el bloque `paging` de la respuesta trae
`{ total, offset, limit }` y el ejemplo oficial muestra `limit: 50` por defecto.

**Limitaciones verificadas (citadas textualmente en la doc):**

- *"actualmente se guardan órdenes creadas hasta 12 meses"* → **el histórico disponible
  por API es de 12 meses**. Este es el techo real de la importación inicial (§6 del brief).
- *"si realizas la búsqueda como vendedor […] filtrarás dichas órdenes [canceladas]"* →
  para ver canceladas hay que pedirlas explícitamente por `order.status`.
- Los filtros de fecha usan hasta la **hora**, descartando minutos/segundos/milisegundos.

**Estado:** VIGENTE. **Uso en NUVELA:** FUENTE PRIMARIA de ventas.

> `/marketplace/orders/search` es la variante para integraciones de marketplace
> (Mercado Shops / CBT). NUVELA usa la de vendedor directo, `/orders/search`.

### 2.2 Detalle de orden

```
GET https://api.mercadolibre.com/orders/$ORDER_ID
```

Campos financieros que devuelve y que NUVELA persiste:

| Campo | Significado |
|---|---|
| `total_amount` | Monto total de la orden |
| `paid_amount` | Monto pagado |
| `currency_id` | Moneda |
| `status`, `status_detail` | Estado y detalle |
| `taxes.amount` | Sumatoria de impuestos de la orden |
| `coupon.amount` | Cupón aplicado |
| `shipping_cost` | Costo de envío a nivel orden |
| `shipping.id` | ID del shipment |
| `pack_id` | ID del pack (carrito) |
| `tags` | `paid`, `delivered`, `not_delivered`, … |
| `cancel_detail.{group,code,description}` | Causa de cancelación |
| `order_items[].sale_fee` | **Comisión de venta REAL cobrada por ML** |
| `order_items[].unit_price` | Precio unitario |
| `order_items[].quantity` | Cantidad |
| `order_items[].gross_price` | Monto original sin descuentos, por todas las unidades |
| `order_items[].listing_type_id` | Tipo de publicación |
| `order_items[].item.{id,title,seller_sku,seller_custom_field,category_id,variation_id}` | Publicación |
| `payments[]` | Ver §2.4 |

> **`order_items[].sale_fee` es el dato de oro del proyecto**: es el cargo realmente
> aplicado por Mercado Libre a esa venta. Manda siempre sobre cualquier estimación de
> `listing_prices` (regla §7 del brief).

**Estado:** VIGENTE. **Uso en NUVELA:** FUENTE PRIMARIA de comisiones reales.

### 2.3 Descuentos de una orden

```
GET https://api.mercadolibre.com/orders/$ORDER_ID/discounts
```

Devuelve, por ítem, el desglose del descuento: `total` (porción del descuento asociada al
ítem, p·q) y `seller` (porción **a cargo del vendedor**). Incluye cupones y cashbacks.

> La documentación aclara que este recurso **solo incluye descuentos aplicados al precio**,
> excluyendo cargos adicionales y devoluciones posteriores. Además existe
> `funding_mode: "sale_fee"`, que indica descuentos financiados vía comisión.

**Estado:** VIGENTE. **Uso en NUVELA:** separar el descuento financiado por el vendedor
(que reduce facturación neta comercial) del financiado por Mercado Libre (que no).

### 2.4 Pagos de la orden

Vienen embebidos en `orders/$ORDER_ID` bajo `payments[]`, y también:

```
GET https://api.mercadolibre.com/collections/$PAYMENT_ID
```

Campos de `payments[]` que NUVELA persiste:

| Campo | Uso financiero |
|---|---|
| `id` | ID de pago (clave para cruzar con Mercado Pago) |
| `status`, `status_detail` | `approved` / `refunded` / … |
| `transaction_amount` | Monto de la transacción |
| `total_paid_amount` | Total pagado por el comprador (incluye interés de cuotas del comprador) |
| `taxes_amount` | Impuestos del pago |
| `shipping_cost` | Costo de envío incluido en ese pago |
| `coupon_amount` | Cupón |
| `overpaid_amount` | Sobrepago |
| `marketplace_fee` | **Cargo de marketplace realmente aplicado** |
| `installments`, `installment_amount` | Cuotas |
| `payment_type`, `payment_method_id` | Medio de pago |
| `date_created`, `date_approved`, `date_last_modified` | Fechas |
| `operation_type` | `regular_payment`, `payment_addition`, … |

**Estado:** VIGENTE. **Uso en NUVELA:** FUENTE PRIMARIA de cargos y de la relación
orden ↔ pago ↔ movimiento de Mercado Pago.

### 2.5 Packs (carrito)

```
GET https://api.mercadolibre.com/packs/$PACK_ID
GET https://api.mercadolibre.com/packs/$PACK_ID/notes
```

**Estado:** VIGENTE.
**Uso en NUVELA:** agrupar órdenes de un mismo carrito para no duplicar el costo de envío,
que se cobra una vez por pack y no una vez por orden.

### 2.6 Envíos

```
GET https://api.mercadolibre.com/shipments/$SHIPMENT_ID
GET https://api.mercadolibre.com/shipments/$SHIPMENT_ID/costs      (header x-format-new: true)
GET https://api.mercadolibre.com/shipments/$SHIPMENT_ID/payments   (header x-format-new: true)
GET https://api.mercadolibre.com/shipments/$SHIPMENT_ID/items
GET https://api.mercadolibre.com/shipments/$SHIPMENT_ID/lead_time
GET https://api.mercadolibre.com/orders/$ORDER_ID/shipments?list_all=true
```

**`/shipments/$SHIPMENT_ID/costs`** es el endpoint clave para el costo logístico real:

```json
{
  "gross_amount": 24.55,
  "receiver": { "user_id": 74425755, "cost": 0, "compensation": 0,
                "discounts": [{ "rate": 1, "type": "loyal", "promoted_amount": 4.07 }] },
  "senders":  [{ "user_id": 81387353, "cost": 8.19, "compensation": 0,
                "discounts": [{ "rate": 0.6, "type": "mandatory", "promoted_amount": 12.29 }] }]
}
```

- `gross_amount`: costo total del envío **sin descuentos**.
- `senders[].cost`: **costo final que paga el vendedor** ← este es el que impacta el P&L.
- `receiver.cost`: lo que paga el comprador.
- `discounts[]`: bonificaciones (`type: "mandatory"` = envío gratis obligatorio,
  `type: "loyal"` = descuento por nivel de comprador).

**Deprecación documentada:** el campo `save` dejó de actualizarse en octubre de 2024 y fue
eliminado del recurso en enero de 2025. NUVELA **no** lo lee.

`/shipments/$SHIPMENT_ID/payments` requiere que el shipment esté asociado a un `pack_id`;
`/costs` no tiene ese requisito. Por eso NUVELA usa `/costs` como fuente principal.

**Estado:** VIGENTE. **Uso en NUVELA:** FUENTE PRIMARIA de costo logístico.

### 2.7 Datos de facturación del comprador

```
GET https://api.mercadolibre.com/orders/billing-info/$SITE_ID/$BILLING_INFO_ID
```
donde `$BILLING_INFO_ID` se obtiene de `orders/$ORDER_ID → buyer.billing_info.id`.

**Estado:** VIGENTE — **reemplaza al recurso legacy `/orders/$ORDER_ID/billing_info`, que
está DEPRECADO.** La documentación indica convivencia temporal de ambos durante la
migración. NUVELA implementa **solo el nuevo**.

**Uso en NUVELA:** opcional; no es necesario para el modelo financiero y contiene datos
personales, así que por defecto **no se sincroniza** (ver §11 Privacidad).

---

## 3. Devoluciones, reclamos y cancelaciones

**Fuente:** <https://developers.mercadolibre.com.ar/es_ar/gestionar-devoluciones>

```
GET https://api.mercadolibre.com/post-purchase/v2/claims/$CLAIM_ID/returns
GET https://api.mercadolibre.com/post-purchase/v1/returns/$RETURN_ID/reviews
GET https://api.mercadolibre.com/post-purchase/v1/returns/$RETURN_ID/return-review
GET https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/charges/return-cost
GET https://api.mercadolibre.com/post-purchase/v1/returns/reasons?flow=$FLOW&claim_id=$CLAIM_ID
```

- `charges/return-cost` devuelve **quién paga el costo de la devolución**, dato que impacta
  directamente el resultado de la venta.
- Las cancelaciones llegan por el propio recurso `orders` (`status: cancelled` +
  `cancel_detail`), no por un endpoint separado.

**Estado:** VIGENTE (`post-purchase` v1/v2).
**Uso en NUVELA:** FUENTE PRIMARIA de devoluciones; el reembolso monetario se concilia
contra el movimiento de Mercado Pago (§5).

---

## 4. Costos de vender: `listing_prices`

**Fuente:** <https://developers.mercadolibre.com.ar/es_ar/comision-por-vender>

```
GET https://api.mercadolibre.com/sites/MLA/listing_prices
    ?price=$PRICE
    &currency_id=ARS
    &category_id=$CATEGORY_ID
    &listing_type_id=$LISTING_TYPE_ID
    &logistic_type=$LOGISTIC_TYPE
    &shipping_mode=me2
    &billable_weight=$GRAMS
    &tags=$CAMPAIGN_TAG          (ej.: ahora-3, supermarket_eligible)
    &quantity=$QUANTITY
```

Respuesta (ejemplo oficial verbatim):

```json
[{
  "currency_id": "ARS",
  "listing_type_id": "gold_pro",
  "listing_type_name": "Premium",
  "listing_exposure": "highest",
  "listing_fee_amount": 0,
  "listing_fee_details": { "fixed_fee": 0, "gross_amount": 0 },
  "requires_picture": true,
  "sale_fee_amount": 2000,
  "sale_fee_details": {
    "financing_add_on_fee": 23,
    "fixed_fee": 200,
    "gross_amount": 2000,
    "meli_percentage_fee": 13,
    "percentage_fee": 36
  },
  "stop_time": "2043-06-01T00:00:00.000-04:00"
}]
```

**Interpretación de `sale_fee_details`:**

| Campo | Significado |
|---|---|
| `gross_amount` | Comisión total en moneda |
| `percentage_fee` | Porcentaje total aplicado |
| `meli_percentage_fee` | Porción porcentual propia de Mercado Libre |
| `financing_add_on_fee` | Adicional por financiación (cuotas) |
| `fixed_fee` | Cargo fijo por unidad vendida (umbral por precio) |

**Valores de `logistic_type` documentados** (con su `shipping_mode`):
`drop_off` (Drop Off, me2), `cross_docking` (Colecta, me2), `xd_drop_off` (Places, me2),
`self_service` (Flex, me2), `turbo` (Turbo, me2), `fulfillment` (Full, me2),
`default` (me1), `custom`, `not_specified`.

**Estado:** VIGENTE.

**Uso en NUVELA — regla estricta (§7 del brief):**

| Escenario | Fuente de la comisión |
|---|---|
| Venta ya ocurrida | `order_items[].sale_fee` / `payments[].marketplace_fee` → **REAL** |
| Simulación de precio | `listing_prices` → **ESTIMADO** |
| Producto nuevo sin ventas | `listing_prices` → **ESTIMADO** |
| Alerta de margen / validación | `listing_prices` → **ESTIMADO** |
| Venta histórica sin `sale_fee` (raro) | `listing_prices` con parámetros del snapshot → **ESTIMADO**, marcado como tal |

**Nunca** se sobrescribe un costo real conocido con una estimación.

### 4.1 Otros recursos de precio

```
GET https://api.mercadolibre.com/items/$ITEM_ID/sale_price?context=$CONTEXT
GET https://api.mercadolibre.com/items/$ITEM_ID/price_to_win
GET https://api.mercadolibre.com/items/$ITEM_ID
```
**Uso en NUVELA:** `items/$ITEM_ID` para título, categoría, `seller_custom_field`/`seller_sku`
y `listing_type_id`. Se guarda **snapshot** al momento de la venta: si mañana cambia la
publicación, la venta histórica no se altera (§6 del brief).

---

## 5. Mercado Pago: dinero, movimientos y saldo

**Fuente:** <https://www.mercadopago.com.ar/developers/es/reference/reports/overview>

### 5.1 Pagos

```
GET https://api.mercadopago.com/v1/payments/search
GET https://api.mercadopago.com/v1/payments/$PAYMENT_ID
GET https://api.mercadopago.com/merchant_orders/search
```
Verificados contra el host: `/v1/payments/search` responde `401 unauthorized`
(existe, requiere credenciales), no `404`.

`/v1/payments/search` acepta `begin_date`/`end_date` (RFC3339), `range`, `criteria`,
`sort`, `limit`, `offset`, `external_reference`, `status`.

Campos financieros relevantes del pago: `transaction_amount`, `transaction_details.*`,
`fee_details[]` (con `type`, `amount`, `fee_payer`), `taxes_amount`,
`shipping_amount`, `money_release_date`, `status`, `status_detail`, `date_approved`.

> **`money_release_date` es la pieza central del cashflow:** es cuándo el dinero de esa
> venta pasa a estar disponible. Es lo que permite separar VENTA de COBRO.

**Estado:** VIGENTE. **Uso en NUVELA:** FUENTE PRIMARIA de fecha de liberación y de fees
por pago.

### 5.2 Reportes oficiales

Ambos reportes existen y están protegidos (`403 PolicyAgent` sin credenciales):

**Liberaciones / Liquidaciones (`release_report`)**

```
POST   /v1/account/release_report/config          Crear configuración
PUT    /v1/account/release_report/config          Actualizar configuración
GET    /v1/account/release_report/config          Consultar configuración
POST   /v1/account/release_report                 Generar reporte por rango de fechas
POST   /v1/account/release_report/schedule        Activar generación automática
DELETE /v1/account/release_report/schedule        Desactivar generación automática
GET    /v1/account/release_report/task/{task-id}  Estado de la tarea de generación
GET    /v1/account/release_report/list            Listar reportes generados
GET    /v1/account/release_report/search          Buscar reportes
GET    /v1/account/release_report/{file_name}     Descargar el archivo
```

**Todas las transacciones (`settlement_report`)** — mismas 10 rutas con
`settlement_report` en lugar de `release_report`.

**Columnas del reporte de liberaciones** (relevantes para NUVELA):

| Columna | Uso |
|---|---|
| `DATE` | Fecha de **liberación** del dinero |
| `SOURCE_ID` | ID de la transacción en MP (cruza con `payment.id`) |
| `RECORD_TYPE` | `initial_available_balance`, `release`, `total`, `available_balance` |
| `NET_CREDIT_AMOUNT` | Acreditado al saldo disponible |
| `NET_DEBIT_AMOUNT` | Debitado del saldo disponible |
| `GROSS_AMOUNT` | Bruto antes de deducciones |
| `BALANCE_AMOUNT` | **Saldo remanente después del movimiento** |
| `SETTLEMENT_NET_AMOUNT` | Impacto real sobre el dinero |
| `MP_FEE_AMOUNT` | Comisión de MP y/o ML, **IVA incluido** |
| `FINANCING_FEE_AMOUNT` | Costo de cuotas sin interés |
| `SHIPPING_FEE_AMOUNT` | Gasto de envío |
| `EFFECTIVE_COUPON_AMOUNT` | Aporte del vendedor al descuento |
| `TAXES_AMOUNT` | Impuestos retenidos (IIBB, IVA, …) |
| `TAX_DETAIL` | Descripción del impuesto retenido por operación |
| `TAXES_DISAGGREGATED` | Impuestos desagregados, en JSON |
| `ORDER_ID`, `SHIPPING_ID`, `PACK_ID`, `ITEM_ID` | Cruce con ML |
| `DESCRIPTION` | Tipo de operación |
| `INSTALLMENTS`, `PAYMENT_METHOD` | Medio de pago |

**Estado:** VIGENTE. **Uso en NUVELA:** CONCILIACIÓN + reconstrucción del saldo.

### 5.3 Saldo — hallazgo importante

> **No existe en la documentación oficial de Mercado Pago un endpoint público de
> "saldo vivo" para cuentas de vendedor.**

El endpoint `GET /users/{user_id}/mercadopago_account/balance` circula en foros desde 2021,
**no figura en la documentación oficial** y al probarlo devuelve
`403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES`.

**Decisión de diseño (§11 del brief, cumplida):** NUVELA **no inventa un saldo en tiempo
real**. Reconstruye el saldo a partir de los reportes oficiales y lo etiqueta en toda la
interfaz como:

> **Saldo conciliado** — reconstruido de reportes oficiales de Mercado Pago
> · última conciliación: `HH:MM`

y **nunca** como "Saldo API en tiempo real". La reconstrucción usa:

- **Disponible** = último `BALANCE_AMOUNT` con `RECORD_TYPE = available_balance` del
  reporte de liberaciones, más los `release` posteriores.
- **Pendiente de liberar** = Σ `net_received_amount` de pagos `approved` cuyo
  `money_release_date` es futuro.
- **Comprometido / reservado** = concepto **propio de NUVELA** (no de Mercado Pago):
  reservas del usuario y obligaciones próximas. Se muestra siempre etiquetado como
  cálculo interno.

Si el usuario habilita el `release_report` en su cuenta, el saldo conciliado es exacto;
si no, NUVELA muestra el estado "sin reporte configurado" y no muestra un número inventado.

### 5.4 Autenticación de Mercado Pago

Mercado Pago usa su propio par de credenciales (`MP_CLIENT_ID` / `MP_CLIENT_SECRET`) y su
propio flujo OAuth, o un **Access Token** de la cuenta. NUVELA soporta ambos y guarda las
credenciales de MP **por cuenta**, cifradas, igual que las de ML.

---

## 6. Facturación de Mercado Libre / Mercado Pago

**Fuente:** <https://developers.mercadolibre.com.ar/es_ar/reportes-de-facturacion>

```
GET /billing/integration/monthly/periods?group=$GROUP&document_type=$TYPE&offset=&limit=
GET /billing/integration/periods/key/$KEY/documents?group=$GROUP&document_type=$TYPE&limit=
GET /billing/integration/periods/key/$KEY/summary/details
GET /users/$USER_ID/invoices/$INVOICE_ID
```

- `$KEY` es la clave del período, con formato `YYYY-MM-01` (ej.: `2023-10-01`).
- `group`: **`ML`** o **`MP`** — la separación que pide el brief (§10) viene dada por la
  propia API.
- `document_type`: **`BILL`** (factura) o **`CREDIT_NOTE`** (nota de crédito).

**Estado:** VIGENTE.

**Uso en NUVELA:** **CONCILIACIÓN fiscal/financiera, nunca fuente primaria de ventas en
tiempo real** (regla explícita del brief §10). Los períodos de facturación se cierran con
retraso; usarlos como fuente de ventas rompería el "casi tiempo real".

---

## 7. Publicidad — Product Ads

**Fuente:** <https://developers.mercadolibre.com.ar/en_us/product-ads-us-read>
(última actualización declarada en la página: **30/12/2025**)

> **Deprecación relevante:** los endpoints legacy del tipo
> `/marketplace/advertising/product_ads/campaigns/{id}/ads/metrics` fueron dados de baja y
> pueden responder `404` desde **febrero de 2026**. NUVELA **no los implementa**.

### 7.1 Endpoints vigentes

```
GET /advertising/advertisers?product_id=PADS
    Headers: Authorization, Content-Type: application/json, Api-Version: 1

GET /advertising/advertisers/$ADVERTISER_ID/product_ads/campaigns
GET /advertising/product_ads/campaigns/$CAMPAIGN_ID
GET /advertising/advertisers/$ADVERTISER_ID/product_ads/items
GET /advertising/product_ads/items/$ITEM_ID
    Headers: Authorization, api-version: 2
```

**Parámetros de métricas:** `date_from`, `date_to` (`YYYY-MM-DD`), `metrics` (lista
separada por comas), `aggregation_type=DAILY`, `metrics_summary=true`, `limit`, `offset`.

**Métricas documentadas disponibles:**
`clicks`, `prints`, `ctr`, `cost`, `cpc`, `acos`, `cvr`, `roas`, `sov`,
`organic_units_quantity`, `organic_units_amount`, `organic_items_quantity`,
`direct_items_quantity`, `indirect_items_quantity`, `advertising_items_quantity`,
`direct_units_quantity`, `indirect_units_quantity`, `units_quantity`,
`direct_amount`, `indirect_amount`, `total_amount`,
y a nivel campaña también `impression_share`, `top_impression_share`,
`lost_impression_share_by_budget`, `lost_impression_share_by_ad_rank`, `acos_benchmark`.

### 7.2 Limitaciones verificadas

1. **El rango de métricas es de solo 90 días hacia atrás.**
2. Las métricas se actualizan a las **10:00 GMT-3**.
3. `limit` por defecto en listados de campañas: 50.

> **Consecuencia de diseño (§12 del brief, cumplida):** como la API solo expone 90 días,
> NUVELA persiste `AdMetricDaily` **todos los días**. La base es el histórico; la API es
> solo la ventana móvil.

**Estado:** VIGENTE (`api-version: 2`). **Uso en NUVELA:** FUENTE PRIMARIA de publicidad.

**TACOS** no lo devuelve la API: se calcula como
`cost / facturación total del período` (publicidad sobre ventas totales, no solo atribuidas)
y se marca como `CALCULATED`.

---

## 8. Notificaciones (webhooks)

**Fuente:** <https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones>

### 8.1 Tópicos que usa NUVELA

| Tópico | Para qué |
|---|---|
| `orders_v2` | Creación y modificación de ventas confirmadas — **recomendado por ML** |
| `shipments` | Creación y cambios de envíos |
| `payments` | Creación de un pago en una orden o cambio de estado |
| `invoices` | Facturación |
| `post_purchase` | Reclamos, devoluciones y cambios |
| `items` | Cambios de publicación (para refrescar catálogo, no para tocar ventas cerradas) |

Payload (ejemplo oficial):

```json
{
  "resource": "/orders/2195160686",
  "user_id": 468424240,
  "topic": "orders_v2",
  "application_id": 5503910054141466,
  "attempts": 1,
  "sent": "2019-10-30T16:19:20.129Z",
  "received": "2019-10-30T16:19:20.106Z"
}
```

La notificación **no trae el dato**, trae el puntero: hay que hacer `GET` al `resource`.

### 8.2 Reglas operativas verificadas

- Hay que responder **HTTP 200 dentro de 500 ms**; si no, ML puede **desactivar el tópico
  por fallback**, y las notificaciones de ese período **no se guardan en "my feeds"**.
- Reintentos durante **1 hora**; a partir del octavo intento sin `200`, la notificación se
  considera perdida.
- La doc recomienda explícitamente **encolar**: confirmar 200 al instante y recién después
  consultar la API.

> **Consecuencia de diseño (cumplida):** el webhook de NUVELA solo hace `INSERT` en
> `WebhookEvent` y responde `200`. El procesamiento es asíncrono. Nunca llama a la API de
> ML dentro del handler.

### 8.3 IPs de origen

Mercado Libre envía las notificaciones desde:
`44.212.211.213`, `52.1.149.176`, `52.44.99.39`, `52.2.210.204`, `52.6.145.31`
(la doc lista 6 direcciones; se leyeron 5 en el render actual, ver nota abajo).

> **Nota honesta:** la tabla del sitio declara 6 direcciones y el render entrega 5 valores
> legibles. NUVELA implementa el allowlist de IP como **opcional y configurable**
> (`ML_WEBHOOK_ALLOWED_IPS`), y **no** lo usa como único control: la defensa real es el
> secreto en la URL del webhook + validación de que `user_id` corresponde a una cuenta
> conectada. Nunca dependemos de una lista que puede cambiar sin aviso.

### 8.4 Notificaciones perdidas

```
GET https://api.mercadolibre.com/missed_feeds?app_id=$APP_ID&topic=$TOPIC&offset=&limit=
```

**Limitación verificada:** `missed_feeds` **solo guarda notificaciones perdidas de hasta
2 días atrás**.

**Uso en NUVELA:** primer nivel de reconciliación. El segundo nivel — y el que realmente
garantiza que no se pierda nada — es el barrido periódico por
`order.date_last_updated.from`, que no depende de webhooks (§ `docs/sync-strategy.md`).

---

## 9. Rate limits

**Fuente:** <https://developers.mercadolibre.com.ar/es_ar/rate-limit-error-429>

Lo que la documentación oficial **sí** afirma:

- El control se aplica **principalmente por Client ID (aplicación)** y por endpoint.
- El tamaño del payload no cuenta para el cálculo del límite.
- Ante `429` hay que aplicar **backoff con jitter** y distribuir las requests.
- Se pueden pedir aumentos de cuota por los canales correspondientes.
- `/marketplace/orders/search` declara **100 requests por minuto**.

Lo que la documentación **no** publica: un número de RPM general por endpoint.

> **Decisión honesta:** NUVELA **no hardcodea un RPM inventado**. Implementa un limitador
> por cuenta con valor **configurable** (`ML_RATE_LIMIT_RPM`, por defecto conservador),
> backoff exponencial con jitter ante `429`/`5xx`, respeto de `Retry-After` si viene, y
> registro de cada `429` en `SyncJob` para poder calibrar el valor real con evidencia.

---

## 10. Qué NO se puede automatizar

Esta sección es tan importante como el resto: define dónde NUVELA pide carga manual en
lugar de simular que la API devuelve algo que no devuelve.

| Dato | Situación | Solución en NUVELA |
|---|---|---|
| **Saldo en tiempo real de Mercado Pago** | Sin endpoint oficial público (§5.3) | Saldo **conciliado** desde reportes oficiales, etiquetado como tal |
| **Costo de mercadería (COGS)** | Mercado Libre no lo conoce | **Carga manual** de `Purchase`/`PurchaseItem` + costeo propio |
| **Gastos fuera de Mercado Libre** | No existe fuente | **Carga manual** (`Expense`) |
| **Ingresos fuera de Mercado Libre** | No existe fuente | **Carga manual** (`Income`), nunca mezclados con GMV |
| **Obligaciones y vencimientos** | No existe fuente | **Carga manual** (`Obligation`) |
| **Perfil fiscal del vendedor** (condición IVA, IIBB, SIRTAC) | No expuesto de forma confiable por API | **Carga manual** (`FiscalProfile`) con fechas de vigencia |
| **Publicidad anterior a 90 días** | Límite duro de la API (§7.2) | **Persistencia diaria propia** en `AdMetricDaily` |
| **Órdenes anteriores a 12 meses** | Límite duro de la API (§2.1) | Se declara el techo; opcionalmente **importación por reporte** |
| **Retenciones y percepciones impositivas** | Aparecen en `TAXES_AMOUNT` / `TAX_DETAIL` del reporte MP, pero su **tratamiento contable** (costo vs. crédito fiscal) no lo define la API | El usuario clasifica por tipo en `FiscalProfile`; NUVELA **no asume** que toda retención es pérdida |
| **Peso facturable exacto para simular** | Hay que conocerlo del producto | Campo en `Product`; si falta, la simulación se marca como incompleta |

**Ninguno de estos huecos se rellena con datos ficticios.** En la interfaz, todo importe
que no provenga de una API lleva su etiqueta de `source` (`MANUAL`, `CALCULATED`,
`FORECAST`) visible.

---

## 11. Privacidad y datos personales

- La documentación indica que Mercado Libre **ya no entrega datos personales de comprador y
  vendedor** en el `GET` de órdenes con Mercado Envíos 2.
- NUVELA no necesita datos del comprador para nada financiero. Se persiste **solo
  `buyer.id`** (para detectar recompra y fraude), y **no** nombre, documento ni dirección.
- Los datos de facturación del comprador (§2.7) **no se sincronizan por defecto**.

---

## 12. Resumen: fuente de verdad por concepto financiero

| Concepto | Fuente primaria | Fallback | Nunca |
|---|---|---|---|
| Ventas / GMV | `orders/search` + `orders/$id` | — | Reportes de facturación |
| Comisión ML | `order_items[].sale_fee` | `listing_prices` (marcado ESTIMADO) | Porcentaje hardcodeado |
| Cargo fijo | incluido en `sale_fee`; desglose por `listing_prices.sale_fee_details.fixed_fee` | `CommercialRule` | Constante en código |
| Cargo de marketplace | `payments[].marketplace_fee` | — | — |
| Financiación (cuotas) | `FINANCING_FEE_AMOUNT` (reporte MP) / `sale_fee_details.financing_add_on_fee` | `CommercialRule` | Tabla fija en código |
| Envío (costo vendedor) | `shipments/$id/costs → senders[].cost` | `SHIPPING_FEE_AMOUNT` (reporte MP) | Estimación silenciosa |
| Publicidad | `advertising/.../product_ads/items` (diario) | — | — |
| Impuestos / retenciones | `TAXES_AMOUNT`, `TAX_DETAIL`, `TAXES_DISAGGREGATED` (reporte MP) | `FiscalProfile` (marcado ESTIMADO) | Porcentaje fiscal hardcodeado |
| Fecha de cobro | `payments.money_release_date` | reporte de liberaciones | Asumir "cobro = venta" |
| Saldo disponible | Reporte de liberaciones (`BALANCE_AMOUNT`) | — | Inventar un saldo "en vivo" |
| COGS | `Purchase` manual + costeo | — | Costo actual aplicado a venta vieja |
| Devoluciones | `post-purchase/v2/claims/$id/returns` + refund en MP | — | — |

---

## Fuentes

- [Autenticación y Autorización — Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion)
- [Gestionar ventas / Órdenes — Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas)
- [Envíos — Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/envios)
- [Costos por vender (`listing_prices`) — Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/comision-por-vender)
- [Notas de Packs — Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/notas-de-packs)
- [Gestionar devoluciones — Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/gestionar-devoluciones)
- [Reportes de Facturación — Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/reportes-de-facturacion)
- [Recibir notificaciones — Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones)
- [Rate Limit / Error 429 — Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/rate-limit-error-429)
- [Product Ads — Mercado Libre](https://developers.mercadolibre.com.ar/en_us/product-ads-us-read)
- [API Reference · Reportes — Mercado Pago](https://www.mercadopago.com.ar/developers/es/reference/reports/overview)
- [Campos del reporte de liberaciones — Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/vtex/additional-content/reports/released-money/report-fields)
- [Reporte de liberaciones · introducción — Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/introduction)
- [Reporte de todas las transacciones — Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/reports/account-money/api)
