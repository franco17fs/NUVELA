# 4 · Primera sincronización

Del `.env` completo a un dashboard que dice la verdad.

---

## Checklist del `.env`

```bash
DATABASE_URL="postgresql://nuvela:nuvela@localhost:5432/nuvela?schema=public"

# node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY=""

ML_CLIENT_ID=""
ML_CLIENT_SECRET=""
ML_REDIRECT_URI=""          # idéntico al del DevCenter
ML_WEBHOOK_SECRET=""

MP_CLIENT_ID=""             # opcional al principio
MP_CLIENT_SECRET=""
MP_REDIRECT_URI=""

APP_BASE_URL=""
CRON_SECRET=""              # otra cadena aleatoria larga
```

Si falta algo o `ENCRYPTION_KEY` no son 32 bytes en base64, la aplicación falla
al arrancar con un mensaje que nombra la variable. Es a propósito: mejor un
error claro que un token guardado sin cifrar.

---

## Levantar

```bash
npm install
npm run db:up        # PostgreSQL en Docker
npm run db:migrate
npm run db:seed      # categorías y reglas de referencia
npm run dev
```

El seed **no crea datos de negocio**: ni cuentas, ni ventas, ni saldos. Una base
con datos de ejemplo que parecen reales es peor que una vacía.

---

## Orden de los pasos

El orden importa: si cargás las ventas antes que los costos, el margen sale
incompleto y hay que recostear.

### 1. Conectar las cuentas

`/configuracion` → **Conectar una cuenta de Mercado Libre**. Repetilo para la
segunda cuenta. Después, **Vincular Mercado Pago** en cada fila.

### 2. Cargar los SKUs con su costo

`/mercaderia` → **Nuevo SKU**, con stock y costo unitario iniciales.

**Hacelo antes de importar el histórico.** El COGS se congela al procesar cada
venta: las ventas importadas sin SKU quedan con margen incompleto.

### 3. Vincular las publicaciones

`/productos` muestra arriba las publicaciones vendidas **sin SKU**. Si el
`seller_sku` de la publicación coincide con el código de un SKU cargado, el
sistema las vincula solo; si no, mapealas ahí.

`unitsPerListing` cubre los kits: si una publicación vende un pack de 3, cada
venta consume 3 unidades de stock.

### 4. Importar el histórico

```bash
curl -X POST "$APP_BASE_URL/api/jobs/sync" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"job":"backfill"}'
```

**Techo real: 12 meses.** Mercado Libre no conserva órdenes más viejas. Pedir más
atrás no devuelve nada, y el sistema recorta la ventana en vez de simular que
trajo todo.

Puede tardar. Seguí el avance en `/conciliacion`, que muestra las corridas
fallidas y los `429`.

### 5. Cargar lo que ninguna API puede dar

| Qué | Dónde |
|---|---|
| Compras de mercadería | `/compras` |
| Gastos e ingresos externos | `/movimientos` |
| Obligaciones y vencimientos | `/obligaciones` |
| Colchón mínimo y umbrales | `/configuracion` |
| Perfil fiscal | `/configuracion` |

Sobre el perfil fiscal: mientras no lo cargues, las retenciones se tratan como
**crédito fiscal** — afectan la caja pero no el resultado. Es el supuesto
conservador. NUVELA no decide por vos si una retención es un costo definitivo:
eso depende de tu régimen y lo declarás vos.

### 6. Dejar el cron corriendo

```bash
curl -X POST "$APP_BASE_URL/api/jobs/sync" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"job":"all"}'
```

| Job | Frecuencia sugerida |
|---|---|
| `all` | cada 15 minutos |
| `ads` | una vez por día, **después de las 10:00** |
| `webhooks` | cada 5 minutos, si activaste webhooks |

Publicidad después de las 10:00 porque las métricas se consolidan a las 10:00
GMT-3: antes de esa hora los datos del día son parciales.

**Arrancá el cron cuanto antes**, aunque todavía no uses el dashboard. La API de
Product Ads sólo devuelve **90 días** hacia atrás; lo que no se guarda, se pierde
para siempre.

---

## Cómo saber que está bien

En `/` (Dashboard):

- **Sincronización** muestra cada fuente con su antigüedad. En rojo, la que falló.
- Si aparece *"Hay ventas sin costo de mercadería cargado"*, faltan SKUs o
  mapeos. El margen está incompleto, no en cero.
- El **Saldo conciliado** dice hasta cuándo llega la conciliación. Sin reportes
  de Mercado Pago dirá *"sin reporte configurado"* en lugar de un número.

En `/ventas`, abrí una venta cualquiera: el waterfall muestra cada cargo con su
etiqueta **REAL** o **ESTIMADO** y su fuente. Si algo dice ESTIMADO, el detalle
te dice exactamente qué falta.

---

## Problemas frecuentes

| Síntoma | Causa |
|---|---|
| `invalid_grant` al conectar | El `redirect_uri` del `.env` y el del DevCenter no son idénticos |
| *"La conexión expiró o no es válida"* | El `state` ya se usó, o pasaron 15 minutos. Empezá de nuevo |
| Ventas sin comisión | Órdenes muy nuevas: `sale_fee` aparece cuando se emiten los cargos |
| Publicidad vacía | La cuenta no tiene Product Ads activo. No es un error |
| Muchos `429` en Conciliación | Bajá `ML_RATE_LIMIT_RPM`. Ese contador existe justamente para calibrarlo con evidencia |
| Stock negativo en Mercadería | Se vendieron unidades sin compra registrada. Se muestra en vez de disimularlo |

---

## Volver

[Índice de guías](./README.md) · [README del proyecto](../../README.md)
