# 1 · Crear la aplicación en Mercado Libre

Guía para completar el formulario del DevCenter. Con esto obtenés el
`ML_CLIENT_ID` y el `ML_CLIENT_SECRET` que necesita NUVELA.

> **Una sola aplicación para todas tus cuentas.** No hace falta crear una por
> cada cuenta de vendedor: la misma aplicación autoriza a las dos (o las que
> agregues después). Cada cuenta se conecta por separado desde Configuración.

Dónde: <https://developers.mercadolibre.com.ar/devcenter> → *Crear aplicación*.

---

## Pantalla 1 — Información básica

| Campo | Qué poner |
|---|---|
| **Nombre*** | `NUVELA` |
| **Nombre corto*** | `nuvela` — si lo rechaza por repetido, probá `nuvela-fin` |
| **Descripción*** | *Sistema interno de gestión financiera para mis propias cuentas de vendedor. Importa ventas, comisiones, envíos y publicidad para calcular rentabilidad, costo de mercadería y cashflow. Solo lectura.* |
| **¿Cuál es el propósito de tu solución?** | **Negocios** |
| **¿Cuántos usuarios tendrá tu solución?** | El rango más chico disponible |
| **Logo** | Opcional. Podés omitirlo |

### Por qué esos valores

- **Negocios** y no *Personal*: es una herramienta para administrar un negocio,
  aunque el usuario seas vos.
- **El rango más chico**: los "usuarios" son las personas que usan la
  aplicación, no tus compradores. Sos vos.
- El **nombre corto** suele formar parte de identificadores internos y tiene que
  ser único a nivel plataforma. Si está tomado, cualquier variante sirve.

---

## Pantalla 2 — Configuración

Es la que realmente importa.

### Redirect URI

**Tiene que ser HTTPS.** La documentación oficial es explícita: es obligatorio
el protocolo HTTPS en la URI de redirección. `http://localhost:3000` **no se
puede cargar**.

Además, debe coincidir **exactamente** con el valor de `ML_REDIRECT_URI` en tu
`.env`, y no puede llevar información variable (parámetros que cambien).

Si ya tenés dónde deployar:

```
https://tu-dominio/api/oauth/mercadolibre/callback
```

Si todavía no, mirá la guía
[3 · Redirect URI y webhooks](./03-redirect-uri-y-webhooks.md): están las tres
alternativas para desarrollo local.

> **Fijate que la URL termine en `/api/oauth/mercadolibre/callback`.** Es la ruta
> que atiende el callback; el dominio solo no alcanza.

El formulario tiene un botón **Agregar Redirect URI**, así que podés cargar
varias. Conviene: dejás la de desarrollo ahora y sumás la de producción cuando
deployes, sin tener que borrar nada. El `.env` apunta a una a la vez.

### Flujos OAuth

| Flujo | Marcar | Por qué |
|---|---|---|
| **Authorization Code** | ✅ | Es el flujo que usa la aplicación |
| **Refresh Token** | ✅ | **Imprescindible.** Sin él, el `grant_type=refresh_token` responde `unsupported_grant_type` y habría que reconectar las cuentas **cada 6 horas** |
| **Client Credentials** | ❌ | Sirve para que la aplicación actúe sin usuario. NUVELA no lo usa |
| **pkce** | ✅ | La implementación manda `code_challenge` y `code_verifier` siempre |

El más fácil de pasar por alto es **Refresh Token**, que viene desmarcado por
defecto. Todo el mecanismo de renovación automática —incluido el lock que
serializa el refresh, porque el token es de un solo uso— depende de ese flujo.

### Negocios

✅ **Mercado Libre**

**VIS** es Vehículos, Inmuebles y Servicios. No aplica a un vendedor de
productos: dejalo sin marcar.

### Permisos

El DevCenter usa **permisos funcionales**: un desplegable por área, con tres
valores. Según la
[documentación oficial](https://developers.mercadolibre.com.ar/es_ar/permisos-funcionales):

- **Solo lectura** → habilita únicamente métodos `GET`
- **Lectura y escritura** → habilita además `PUT`, `POST` y `DELETE`

**Ninguno va en escritura.** NUVELA sólo lee.

| Permiso | Valor | Recursos que habilita y por qué se necesita |
|---|---|---|
| **Usuarios** | Solo lectura | `users`. Es el que identifica la cuenta al conectarla. Viene por defecto en *Lectura y escritura*: **bajalo** |
| Comunicaciones pre y post ventas | Sin acceso | Mensajería. No se usa |
| **Publicación y sincronización** | Solo lectura | `items`, `prices` y **Costos por vender** (`listing_prices`), que es el simulador de comisiones |
| **Publicidad de un producto** | Solo lectura | `advertising` → Product Ads |
| **Facturación de una venta** | Solo lectura | `invoices`, `billing`, períodos, percepciones y conciliaciones |
| Métricas del negocio | Sin acceso | Da `trends`, `highlights` y visitas. NUVELA no los usa |
| Promociones, cupones y descuentos | Sin acceso | Da `offers` y `deals`. No se usan; los descuentos de una orden vienen con el permiso de ventas |
| **Venta y envíos de un producto** | Solo lectura | **El imprescindible**: `orders`, `shipments`, `claims`, `returns`, Pagos, Packs y Costos de envío |

Los cuatro en negrita son los que el sistema consume de verdad. Sin *Venta y
envíos* no se importa ninguna venta.

> El formulario avisa *"Selecciona al menos una opción para cada permiso"*:
> los que no usás quedan explícitamente en **Sin acceso**, no vacíos.

### Tópicos de notificaciones

Están en acordeones, agrupados por familia. Abrí y marcá:

| Acordeón | Qué marcar |
|---|---|
| **Orders** | `orders_v2` — el recomendado por Mercado Libre |
| **Shipments** | `shipments` |
| **Items** | `items` |
| **Post Purchase** | reclamos, devoluciones y cambios |
| **Others** | `payments` e `invoices` |

### URL de notificaciones

```
https://tu-dominio/api/webhooks/mercadolibre/<ML_WEBHOOK_SECRET>
```

Tiene que ser **pública y HTTPS**: a `localhost` no llega nada.

**Si todavía no deployaste, dejala vacía.** No perdés ventas: NUVELA usa los
webhooks para frescura, no para correctitud. El barrido periódico por fecha de
modificación es el que garantiza que no falte nada, y funciona sin webhooks.
Los agregás después.

---

## Después de crear la aplicación

El DevCenter te muestra el **App ID** y el **Secret Key**. Copialos al `.env`:

```bash
ML_CLIENT_ID="tu app id"
ML_CLIENT_SECRET="tu secret key"
ML_REDIRECT_URI="https://tu-dominio/api/oauth/mercadolibre/callback"
ML_AUTH_DOMAIN="auth.mercadolibre.com.ar"
ML_SITE_ID="MLA"
```

El `ML_REDIRECT_URI` del `.env` y el cargado en el DevCenter tienen que ser
**idénticos**, carácter por carácter. Una barra de más al final rompe el flujo
con `invalid_grant`.

Generá también el secreto del webhook:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

```bash
ML_WEBHOOK_SECRET="lo que salió del comando"
```

---

## Para tener en cuenta

- **Inactividad.** Si la aplicación no hace ninguna llamada a
  `https://api.mercadolibre.com/` durante **4 meses**, Mercado Libre la elimina.
  Con la sincronización corriendo esto no pasa.
- **El `redirect_uri` no admite partes variables.** Todo el contexto del flujo
  viaja en el parámetro `state`, que NUVELA ya maneja.
- **Cambiar la configuración después es posible** desde la vista *Configurar* de
  la aplicación, sin tener que crearla de nuevo.

---

## Siguiente

[2 · Crear la aplicación en Mercado Pago](./02-aplicacion-mercado-pago.md)
