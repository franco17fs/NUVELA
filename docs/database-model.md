# Modelo de datos

Esquema completo en `prisma/schema.prisma`.

---

## Reglas transversales

### 1. Dinero: `NUMERIC(18,4)`. Nunca `Float`

En Prisma: `Decimal @db.Decimal(18, 4)`. En memoria: `Decimal` de decimal.js.
Al cruzar al cliente: string, no `number`.

Cuatro decimales y no dos porque los cargos porcentuales y los prorrateos
producen fracciones de centavo que hay que conservar hasta el redondeo final.

> Los `Decimal` que devuelve Prisma vienen de **otra instancia** del módulo
> decimal.js y no pasan un `instanceof` contra el nuestro. `money()` los
> normaliza. Está cubierto por un test de regresión.

### 2. Todo importe importante guarda su procedencia

```
source            MELI_API · MP_API · BILLING_REPORT · MANUAL · CALCULATED · FORECAST
sourceReferenceId identificador en el sistema de origen
syncedAt          cuándo se trajo
```

### 3. Todo importe guarda qué tan firme es

```
kind   ACTUAL · ESTIMATED · FORECAST
```

Una estimación jamás se presenta como un cargo real. La interfaz lo muestra como
insignia.

### 4. Nada se comparte entre sellers

Casi todas las tablas cuelgan de `sellerAccountId`, y **todas** las claves únicas
lo incluyen. Dos cuentas pueden tener una orden con el mismo número.

### 5. Lo histórico no se sobrescribe

- `Order.businessDate` es inmutable.
- El snapshot de la publicación en `OrderItem` es del momento de la venta.
- `OrderItem.cogsUnitCost` se congela al procesar.
- `CostHistory` cierra vigencias, no pisa filas.

---

## Las claves únicas y el problema del NULL

**En PostgreSQL, un índice único con columnas NULL no deduplica.** Dos filas con
NULL en la columna son distintas para el motor. Un `@@unique([a, b])` con `b`
opcional no impide duplicados cuando `b` es nulo.

Cuatro tablas tenían ese problema. Se resolvió con una columna `dedupeKey` de
texto, siempre presente, calculada en `src/server/sync/idempotency.ts`:

| Tabla | Antes (roto) | Ahora |
|---|---|---|
| `MarketplaceFee` | `(sellerAccountId, orderId?, type, source)` | `(sellerAccountId, dedupeKey)` |
| `AdMetricDaily` | `(sellerAccountId, level, adCampaignId?, mlItemId?, date)` | `(sellerAccountId, dedupeKey)` |
| `CashflowEntry` | `(referenceType?, referenceId?, direction)` | `(dedupeKey)` |
| `WebhookEvent` | `(provider, topic, resource, sentAt?)` | `(dedupeKey)` |

Además:

- `ListingMapping.variationId` es `String @default("")` y no opcional: cadena
  vacía significa "sin variaciones". Con NULL se podían crear dos mapeos para la
  misma publicación.
- `InventoryMovement.referenceType/referenceId` son obligatorios: son lo que da
  idempotencia.
- `TransactionCategory` es única por `(direction, name)` y no incluye `parentId`,
  que es opcional.

---

## Entidades por dominio

### Cuentas y credenciales

| Modelo | Qué guarda |
|---|---|
| `SellerAccount` | Una cuenta de Mercado Libre. Única por `mercadoLibreUserId` |
| `OAuthToken` | Tokens cifrados por `(cuenta, proveedor)`, con `refreshLockedAt` para serializar el refresh |
| `OAuthFlowState` | `state` y `code_verifier` de PKCE durante el flujo. Vence a los 15 minutos |

### Ventas

| Modelo | Notas |
|---|---|
| `Order` | Único por `(sellerAccountId, mlOrderId)`. Guarda `rawPayload` como evidencia |
| `OrderItem` | Único por `(orderId, position)`. Lleva `saleFee` real y COGS congelado |
| `Payment` | Único por `(sellerAccountId, mlPaymentId)`. `moneyReleaseDate` es la pieza que separa venta de cobro |
| `Refund` | Único por `(sellerAccountId, externalId)`: el mismo refund por dos vías se cuenta una vez |
| `Shipment` | `senderCost` es el costo del vendedor; `grossAmount` y `receiverCost` son contexto |
| `MarketplaceFee` | **La tabla que hace auditables los KPIs**: cada peso de "Comisiones del mes" es una fila con su orden y su fuente |
| `OrderProfitability` | Resultado materializado del motor, con `breakdown` y `calculatedAt` |

### Catálogo y costeo

| Modelo | Notas |
|---|---|
| `Product` / `Sku` | El `Sku` es la unidad de costeo y de stock; su `code` es la clave de negocio |
| `ListingMapping` | Publicación ↔ SKU por cuenta. `unitsPerListing` cubre kits |
| `InventoryMovement` | Guarda stock y promedio **antes y después**: permite reconstruir el costo de cualquier fecha |
| `CostHistory` | Intervalos de vigencia del costo. Nunca se borra |
| `Purchase` / `PurchaseItem` | Compras manuales. `paymentDueDate` las mete en el cashflow |

### Dinero

| Modelo | Notas |
|---|---|
| `MercadoPagoMovement` | Filas del reporte oficial. `recordType` y `balanceAmount` reconstruyen el saldo |
| `MercadoPagoBalanceSnapshot` | Instantánea del saldo conciliado, con `reconciledUntil`. `source` nunca es "API en vivo" |
| `Obligation` / `ObligationPayment` | Vencimientos y sus pagos |
| `Reserve` | Bolsillos. `priority` define la prelación, configurable |
| `CashflowEntry` | Movimiento de caja con su `kind` (real / programado / estimado / proyectado) |
| `Forecast` | Proyección con su modelo, confianza y supuestos, para poder explicarla |

### Manuales

`Expense`, `Income` y `TransactionCategory`. Los ingresos externos viven en su
propia tabla y **nunca** se suman al GMV.

Las categorías son configurables: agregar una no requiere tocar código.

### Configuración

| Modelo | Notas |
|---|---|
| `CommercialRule` | Reglas versionadas por vigencia (`validFrom`/`validTo`), con `values` en JSON y `source`. Cambiar un porcentaje es editar una fila |
| `FiscalProfile` | Condición, provincia, IIBB, SIRTAC, alícuotas y **tratamiento por tipo de impuesto** |
| `AppSetting` | Colchón mínimo, horizontes, umbrales de alerta, orden de asignación |

### Auditoría

| Modelo | Notas |
|---|---|
| `SyncJob` | Ventana, leídos, escritos, salteados, `rateLimitHits` y error con mensaje seguro |
| `SyncCursor` | Marca de agua por `(cuenta, tipo)` |
| `WebhookEvent` | Cola de notificaciones con estado y reintentos |
| `ReconciliationIssue` | Diferencias, con `fingerprint` para no recrearlas en cada corrida |

---

## Auditabilidad

El requisito del §35 —poder hacer click en "Comisiones este mes: $2.350.500" y
ver qué la compone— se sostiene sobre `MarketplaceFee`:

```sql
SELECT SUM(amount) FROM "MarketplaceFee"
WHERE "sellerAccountId" = $1
  AND type = 'SALE_FEE'
  AND "businessDate" BETWEEN $2 AND $3;
```

Cada fila apunta a su orden, su tipo, su `kind`, su `source` y su
`sourceReferenceId`. Y la orden guarda el `rawPayload` con el que se generó.

No hay ningún KPI cuyo número no se pueda descomponer hasta la llamada de API que
lo originó.

---

## Migraciones

```bash
npm run db:migrate     # desarrollo
npm run db:deploy      # producción
npm run db:seed        # categorías y reglas de referencia
```

El seed **no crea datos de negocio**: ni cuentas, ni ventas, ni saldos. Una base
con datos de ejemplo que parecen reales es peor que una vacía.
