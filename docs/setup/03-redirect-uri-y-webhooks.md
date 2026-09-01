# 3 · Redirect URI y webhooks

Las dos cosas que necesitan una URL **HTTPS y pública**, y qué hacer mientras no
la tenés.

---

## Por qué no alcanza con localhost

La documentación oficial de Mercado Libre exige el **protocolo HTTPS** en la URI
de redirección. El DevCenter directamente no deja cargar `http://localhost:3000`.

Y para los webhooks el problema es otro: Mercado Libre tiene que poder **llegar**
a tu servidor desde internet. A `localhost` no llega nunca.

| | Necesita HTTPS | Necesita ser alcanzable desde internet |
|---|---|---|
| Redirect URI | Sí | No — sólo el navegador lo abre |
| URL de webhooks | Sí | **Sí** |

Esa diferencia es la que permite las soluciones de abajo: el redirect lo abre tu
propio navegador, así que un rebote alcanza.

---

## Opción A — Deployar (lo definitivo)

Con la aplicación en un dominio con HTTPS, todo funciona sin trucos:

```
Redirect ML   https://tu-dominio/api/oauth/mercadolibre/callback
Redirect MP   https://tu-dominio/api/oauth/mercadopago/callback
Webhooks      https://tu-dominio/api/webhooks/mercadolibre/<ML_WEBHOOK_SECRET>
```

```bash
APP_BASE_URL="https://tu-dominio"
```

Es la única opción que habilita webhooks de verdad.

---

## Opción B — Túnel (lo más cómodo para desarrollar)

Un túnel expone tu `localhost` con una URL HTTPS pública. Sirve para redirect
**y** para webhooks.

```bash
# Cloudflare (no requiere cuenta para pruebas rápidas)
cloudflared tunnel --url http://localhost:3000

# o ngrok
ngrok http 3000
```

Te da algo como `https://algo-random.trycloudflare.com`. Cargá esa URL en el
DevCenter y en el `.env`:

```bash
APP_BASE_URL="https://algo-random.trycloudflare.com"
ML_REDIRECT_URI="https://algo-random.trycloudflare.com/api/oauth/mercadolibre/callback"
```

**La contra:** con un túnel gratuito la URL cambia cada vez que lo reiniciás, y
hay que actualizarla en los dos lados. Para una conexión inicial está bien; para
uso diario, deployá.

---

## Opción C — El bridge de GitHub Pages que ya tenés

En la raíz del repo hay `index.html`, `callback.js` y `styles.css`: un bridge
estático publicado en GitHub Pages, de antes de esta aplicación. Recibe el
retorno de Mercado Libre en HTTPS y rebota el `code` a tu máquina.

**Sirve sólo para el redirect, no para los webhooks**, porque el rebote lo hace
el navegador y no Mercado Libre.

### Hay que actualizarlo

Hoy `callback.js` apunta al asistente viejo:

```js
const localCallback = new URL("http://127.0.0.1:8000/callback");
```

La aplicación corre en otro puerto y otra ruta. Habría que cambiarlo a:

```js
const localCallback = new URL("http://127.0.0.1:3000/api/oauth/mercadolibre/callback");
```

Y en el DevCenter cargar como redirect URI la URL de tu GitHub Pages:

```
https://<tu-usuario>.github.io/NUVELA/
```

con el `.env` apuntando **al mismo valor**, porque Mercado Libre valida que
coincidan:

```bash
ML_REDIRECT_URI="https://<tu-usuario>.github.io/NUVELA/"
```

> **Ojo con el `state`.** El bridge reenvía `code` y `state` tal cual, y el
> callback de NUVELA valida el `state` contra la base y lo consume. Eso sigue
> funcionando. Lo que **no** funciona es abrir la URL de GitHub Pages dos veces:
> el `state` ya se consumió y el segundo intento falla, como corresponde.

Decime si querés que lo actualice; no lo toqué para no romper lo que ya tenés
publicado.

---

## Webhooks: se pueden dejar para después

**No perdés ventas por no tener webhooks.** NUVELA los usa para frescura, no
para correctitud:

| | Webhooks | Barrido periódico |
|---|---|---|
| Latencia | Segundos | Minutos |
| ¿Se puede perder algo? | Sí | No |
| Rol | Velocidad | **Garantía** |

El barrido avanza por fecha de modificación con solapamiento deliberado, así que
cubre todo aunque no llegue ninguna notificación. Arrancá con el cron y agregá
los webhooks cuando tengas dominio.

Hay tres razones documentadas por las que un webhook se pierde, y son la razón
de que el sistema no dependa de ellos:

1. Si no respondés `200` en **500 ms**, Mercado Libre puede **desactivar el
   topic**, y esas notificaciones **no** quedan guardadas.
2. Los reintentos duran una hora; después se descartan.
3. `missed_feeds` sólo conserva las perdidas de **2 días**.

### Cuando los actives

```
https://tu-dominio/api/webhooks/mercadolibre/<ML_WEBHOOK_SECRET>
```

El secreto va **en la URL** y se compara en tiempo constante. Generalo con:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Opcionalmente podés restringir por IP de origen:

```bash
ML_WEBHOOK_ALLOWED_IPS="44.212.211.213,52.1.149.176,52.44.99.39,52.2.210.204,52.6.145.31"
```

Está **desactivado por defecto a propósito**: la lista puede cambiar sin aviso, y
si Mercado Libre agrega una IP, dejarías de recibir ventas en silencio. El
control real es el secreto de la URL.

---

## Siguiente

[4 · Primera sincronización](./04-primera-sincronizacion.md)
