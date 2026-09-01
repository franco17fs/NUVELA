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

### Scopes

Marcá:

- ✅ `read`
- ✅ `offline_access`
- ❌ `write` — **no lo marques**

NUVELA sólo lee. Sin `write`, una fuga de token no puede modificar tus
publicaciones, precios ni envíos. `offline_access` es lo que habilita el
`refresh_token`, sin el cual habría que reconectar cada 6 horas.

### Topics de notificaciones

| Topic | Para qué |
|---|---|
| `orders_v2` | Ventas — el recomendado por Mercado Libre |
| `shipments` | Cambios de envío |
| `payments` | Cambios de estado de cobro |
| `invoices` | Facturación |
| `post_purchase` | Reclamos, devoluciones y cambios |
| `items` | Cambios de publicación |

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
