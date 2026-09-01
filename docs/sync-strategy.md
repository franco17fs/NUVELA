# Estrategia de sincronización

## Principio

**El dashboard consulta PostgreSQL, nunca las APIs externas.** Abrir una pantalla
no dispara ni una llamada a Mercado Libre. Las integraciones alimentan la base en
procesos aparte, y cada corrida queda auditada en `SyncJob`.

---

## Dos caminos, a propósito

| | Webhooks | Barrido periódico |
|---|---|---|
| Latencia | Segundos | Minutos |
| Confiabilidad | Se pueden perder | No se pierde nada |
| Rol | Frescura | **Garantía** |

Los webhooks dan tiempo casi real. El barrido es el que garantiza que no falte
una venta. No se depende de los webhooks para la correctitud, sólo para la
velocidad.

Hay tres razones concretas por las que un webhook se puede perder, todas
documentadas por Mercado Libre:

1. Si el servidor no responde `200` en **500 ms**, el tópico puede quedar
   **desactivado por fallback**, y las notificaciones de ese período **no se
   guardan** en "my feeds".
2. Los reintentos duran una hora; después de ocho intentos sin `200`, la
   notificación se considera perdida.
3. `missed_feeds` sólo conserva las perdidas de **hasta 2 días atrás**.

---

## Recepción de notificaciones

`POST /api/webhooks/mercadolibre/<ML_WEBHOOK_SECRET>`

El handler hace **exactamente tres cosas**: valida el secreto, inserta en
`WebhookEvent` y responde `200`. Nada más. Ninguna llamada a la API, ningún
cálculo, ninguna transacción larga.

Incluso ante un fallo de base responde `200`: devolver un error dispararía
reintentos y acercaría la desactivación del tópico. Lo que se pierda ahí lo
recupera el barrido.

### Idempotencia de la notificación

```
dedupeKey = webhook:PROVIDER:TOPIC:RESOURCE:SENT_AT
```

**`attempts` no entra en la clave.** Mercado Libre reintenta la MISMA
notificación hasta ocho veces incrementando ese contador; si entrara, cada
reintento se procesaría como un evento nuevo. Lo que identifica al evento es el
recurso y el instante de envío.

Un cambio real posterior sobre la misma orden llega con otro `sent` y por lo
tanto es otro evento. Está cubierto por tests.

### Tópicos suscritos

`orders_v2` (recomendado por Mercado Libre), `shipments`, `payments`, `invoices`,
`post_purchase`, `items`.

### Procesamiento

`processPendingWebhooks()` toma un lote, marca cada evento como `PROCESSING` con
un `UPDATE` condicional —así dos corridas simultáneas no toman el mismo— y
recién ahí consulta el recurso.

`processAttempts` está acotado: un evento imposible de procesar no se reintenta
para siempre.

Los tópicos `shipments` y `payments` no tienen lógica propia: resuelven la orden
asociada y la reprocesan entera, que es idempotente. Duplicar la lógica de
persistencia sería la forma más rápida de que las dos versiones diverjan.

---

## Sincronización de órdenes

### Incremental

Avanza por **`order.date_last_updated`**, no por fecha de creación. Es lo que
captura las órdenes viejas que cambian de estado: una cancelación de una venta de
hace tres semanas no aparecería nunca filtrando por creación.

```
ventana = [ última marca de agua − 90 minutos , ahora ]
```

**El solapamiento es deliberado.** Los filtros de fecha de Mercado Libre tienen
precisión de **hora** —descartan minutos y segundos—, así que una orden
modificada justo en el borde puede caer entre dos ventanas. Como reprocesar es
inocuo (todo es idempotente), se prefiere leer de más a perder una venta.

Por el mismo motivo, las marcas de agua se redondean **hacia atrás** a la hora en
punto: hacia adelante dejaría huecos.

### Histórica

```
ventana = [ máx(fecha pedida, hoy − 12 meses) , ahora ]
```

**Mercado Libre conserva las órdenes de los últimos 12 meses.** Pedir más atrás
no devuelve nada. El techo se aplica en el código para no generar la expectativa
de un histórico que la API no tiene.

---

## Qué se persiste por cada orden

Todo dentro de una transacción: o queda la orden entera y coherente, o no queda
nada. Media orden guardada sería peor que ninguna, porque el dashboard mostraría
facturación sin sus costos.

| Dato | Origen |
|---|---|
| Cabecera, ítems, pagos | `GET /orders/{id}` |
| Descuento del vendedor | `GET /orders/{id}/discounts` → `seller` |
| Costo de envío del vendedor | `GET /shipments/{id}/costs` → `senders[].cost` |
| Líneas de cargo normalizadas | Derivadas, en `MarketplaceFee` |
| Payload crudo | `Order.rawPayload`, como evidencia de auditoría |

Las llamadas de red se hacen **antes** de abrir la transacción: una transacción
no debe quedarse esperando a un servidor externo.

El COGS se aplica fuera de esa transacción, porque mueve stock y escribe
historial de costos: es un proceso propio con su propia idempotencia.

### Lo que NO se actualiza al reprocesar

- **`businessDate`**: la fecha de venta de una orden histórica es inmutable. Si
  cambiara, el resultado de un mes ya cerrado se movería solo.
- **El snapshot de la publicación** (título, categoría): valen los del momento de
  la venta. Si mañana se renombra la publicación, la venta vieja no cambia.

---

## Idempotencia

| Entidad | Clave |
|---|---|
| Orden | `(sellerAccountId, mlOrderId)` |
| Ítem | `(orderId, position)` |
| Pago | `(sellerAccountId, mlPaymentId)` |
| Envío | `(sellerAccountId, mlShipmentId)` |
| Devolución | `(sellerAccountId, externalId)` |
| Cargo | `(sellerAccountId, dedupeKey)` |
| Métrica de publicidad | `(sellerAccountId, dedupeKey)` |
| Movimiento de stock | `(referenceType, referenceId)` |
| Notificación | `dedupeKey` |

**Todas incluyen la cuenta.** Dos sellers pueden tener legítimamente entidades
con el mismo ID externo; sin el `sellerAccountId` en la clave, uno pisaría al
otro.

### Por qué hay columnas `dedupeKey` en vez de índices compuestos

En PostgreSQL **un índice único con columnas NULL no deduplica**: dos filas con
NULL son distintas para el motor. Las tablas cuyas claves incluían columnas
opcionales (`orderId` en los cargos, `mlItemId` en las métricas, `sentAt` en los
webhooks) no estaban protegidas.

Hoy usan una columna de texto siempre presente, calculada en
`src/server/sync/idempotency.ts` y cubierta por tests.

---

## Tolerancia a fallos

- Una orden que falla **no aborta la corrida**: se cuenta como salteada y se
  registra un `ReconciliationIssue` para que aparezca en la pantalla de
  Conciliación.
- Un job que falla **no tumba los demás**: si la publicidad se cae, las ventas se
  sincronizan igual.
- El estado de cada fuente se ve en el dashboard, incluidos los fallos.

---

## Rate limiting

La documentación oficial **no publica un RPM general** por endpoint. Sólo dice
que el control se aplica principalmente por Client ID, que hay que hacer backoff
ante un `429` y que se pueden pedir aumentos de cuota.

Por eso NUVELA **no hardcodea un número inventado**:

- El límite es `ML_RATE_LIMIT_RPM`, configurable, con un valor inicial
  conservador.
- Cada `429` se cuenta en `SyncJob.rateLimitHits` y se muestra en Conciliación.
- Ese contador es la **evidencia** para calibrar el valor real.
- Backoff exponencial con jitter, y `Retry-After` respetado cuando viene.

El único límite que la documentación sí publica es el de
`/marketplace/orders/search`: 100 requests por minuto.

---

## Publicidad

**La API sólo devuelve 90 días hacia atrás.** `AdMetricDaily` es nuestro
histórico real; la API es apenas una ventana móvil sobre él. Si la sincronización
se detiene dos meses, esos días se pierden para siempre.

La corrida por defecto termina **ayer**: las métricas se consolidan a las 10:00
GMT-3, así que pedir el día en curso antes de esa hora devuelve datos parciales
que después habría que corregir.

Cuando el rango pedido excede la ventana, se recorta y se informa (`truncated`).

---

## Ejecución

No hay scheduler dentro de la aplicación. Un cron externo llama:

```bash
curl -X POST "$APP_BASE_URL/api/jobs/sync" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"job":"all"}'
```

| `job` | Qué hace | Frecuencia sugerida |
|---|---|---|
| `all` | Todo | cada 15 minutos |
| `orders` | Sólo ventas | |
| `payments` | Sólo Mercado Pago | cada hora |
| `ads` | Sólo publicidad | una vez por día, después de las 10:00 |
| `webhooks` | Procesa la cola | cada 5 minutos |
| `backfill` | Importación histórica | una vez, al conectar |

La respuesta siempre es `200` con el detalle de cada job: el cron necesita saber
qué pasó con cada uno, no un error global que esconda los que sí funcionaron.
