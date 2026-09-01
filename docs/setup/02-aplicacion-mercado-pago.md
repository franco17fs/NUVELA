# 2 · Crear la aplicación en Mercado Pago

Mercado Pago es una plataforma **aparte** de Mercado Libre: tiene su propio panel
de aplicaciones, sus propias credenciales y su propio flujo OAuth. Aunque la
cuenta sea la misma persona, los tokens **no** son intercambiables.

Dónde: <https://www.mercadopago.com.ar/developers/panel/app> → *Crear aplicación*.

---

## ¿Es obligatoria?

**No para empezar.** Sin Mercado Pago, NUVELA funciona igual: importa ventas,
calcula comisiones, costos y márgenes.

Lo que **no** vas a tener sin ella:

| Sin Mercado Pago | Con Mercado Pago |
|---|---|
| No hay fecha de acreditación | `money_release_date` por cobro |
| Cashflow sin liberaciones | Cashflow real |
| Sin saldo | Saldo conciliado |
| Sin "disponible seguro" confiable | Disponible seguro completo |

Como todo el cashflow depende de **cuándo entra la plata**, y ese dato sólo lo
tiene Mercado Pago, conviene conectarla.

---

## Crear la aplicación

| Campo | Qué poner |
|---|---|
| **Nombre** | `NUVELA` |
| **¿Qué producto estás integrando?** | Elegí la opción de pagos online / Checkout |
| **Modelo de integración** | Sin plataforma (integración propia) |
| **Tipo de solución** | Pagos online |

Las opciones exactas cambian cada tanto en el panel. Lo que importa es que la
aplicación quede creada y te dé credenciales; NUVELA no cobra pagos, sólo lee
movimientos.

---

## Redirect URI

En la configuración de la aplicación, cargá la **URL de redirect** para OAuth:

```
https://tu-dominio/api/oauth/mercadopago/callback
```

Igual que en Mercado Libre: **HTTPS y exacta**. Ver
[3 · Redirect URI y webhooks](./03-redirect-uri-y-webhooks.md) si todavía no
tenés dominio.

Si la aplicación ofrece activar **PKCE**, activalo: NUVELA lo usa siempre.

---

## Credenciales al `.env`

Del panel de la aplicación, sección *Credenciales*:

```bash
MP_CLIENT_ID="tu client id"
MP_CLIENT_SECRET="tu client secret"
MP_REDIRECT_URI="https://tu-dominio/api/oauth/mercadopago/callback"
```

---

## Vincular la cuenta

A diferencia de Mercado Libre, Mercado Pago **no se conecta solo**: hay que
declarar a qué cuenta pertenece.

1. Conectá primero la cuenta de Mercado Libre (guía 1).
2. Andá a **Configuración**.
3. En la fila de la cuenta, tocá **Vincular Mercado Pago**.

El vínculo se declara y no se adivina a propósito: atar los movimientos de
dinero de una cuenta a las ventas de otra sería un error silencioso y muy caro
de detectar.

---

## Activar el reporte de liberaciones

Este paso es el que hace que el saldo funcione, y es fácil de pasar por alto.

**Mercado Pago no expone un endpoint público de saldo en vivo para vendedores.**
El que circula en foros no está documentado y devuelve `403`. NUVELA reconstruye
el saldo a partir del **reporte oficial de liberaciones**, y por eso lo muestra
etiquetado como *"Saldo conciliado"* y nunca como saldo en tiempo real.

Para que ese reporte exista, hay que habilitarlo en la cuenta:

<https://www.mercadopago.com.ar/activities> → *Reportes* → **Liberaciones**

Mientras no esté configurado, la pantalla de Mercado Pago dice *"sin reportes
importados"* en lugar de mostrar un cero que parezca un saldo.

> **Estado actual:** el cliente de la API de reportes y el parser del CSV están
> implementados y testeados, pero **falta el job** que descarga el archivo y lo
> vuelca a la base. Ver la sección "Lo que falta" en
> [`architecture.md`](../architecture.md).

---

## Diferencia operativa con Mercado Libre

| | Mercado Libre | Mercado Pago |
|---|---|---|
| Duración del access token | 6 horas | 180 días |
| Refresh token | **De un solo uso** | Reutilizable |
| Dominio de autorización | Por país (`.com.ar`) | Único |

El refresh de Mercado Libre está serializado con un lock en base justamente
porque es de un solo uso: dos procesos renovando a la vez dejaban la cuenta
desconectada.

---

## Siguiente

[3 · Redirect URI y webhooks](./03-redirect-uri-y-webhooks.md)
