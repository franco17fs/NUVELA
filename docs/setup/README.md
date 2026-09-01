# Puesta en marcha

Guías para dejar NUVELA funcionando, en orden. Están pensadas para seguirlas con
el navegador abierto.

| | Guía | Qué resuelve |
|---|---|---|
| 1 | [Crear la aplicación en Mercado Libre](./01-aplicacion-mercado-libre.md) | Qué poner en cada campo del DevCenter, scopes y topics |
| 2 | [Crear la aplicación en Mercado Pago](./02-aplicacion-mercado-pago.md) | Credenciales, vínculo con la cuenta y reporte de liberaciones |
| 3 | [Redirect URI y webhooks](./03-redirect-uri-y-webhooks.md) | Por qué hace falta HTTPS y las tres alternativas mientras no lo tenés |
| 4 | [Primera sincronización](./04-primera-sincronizacion.md) | Del `.env` a un dashboard que dice la verdad |

---

## Lo mínimo, si tenés apuro

1. Creá la aplicación de Mercado Libre con scopes `read` + `offline_access`
   (guía 1).
2. Para el redirect URI usá un túnel (guía 3, opción B).
3. Completá el `.env`, `npm run db:migrate && npm run db:seed`, `npm run dev`.
4. Conectá la cuenta, cargá los SKUs con su costo, e importá el histórico
   (guía 4).

Mercado Pago y los webhooks se pueden agregar después sin perder nada.

---

## Lo que sólo podés hacer vos

NUVELA no puede generar estas credenciales: se crean con tu usuario.

| Variable | Dónde |
|---|---|
| `ML_CLIENT_ID` · `ML_CLIENT_SECRET` | DevCenter de Mercado Libre |
| `MP_CLIENT_ID` · `MP_CLIENT_SECRET` | Panel de aplicaciones de Mercado Pago |
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ML_WEBHOOK_SECRET` · `CRON_SECRET` | Cualquier cadena aleatoria larga |

Y estos datos, que ninguna API expone y se cargan a mano desde la aplicación:
costo de mercadería, gastos, ingresos externos, obligaciones y perfil fiscal.

---

## Documentación técnica

Estas guías son operativas. Si querés entender **cómo funciona** por dentro:

- [`../architecture.md`](../architecture.md) — capas y decisiones
- [`../financial-model.md`](../financial-model.md) — todas las fórmulas
- [`../mercadolibre-api-research.md`](../mercadolibre-api-research.md) — la investigación de las APIs
- [`../integrations.md`](../integrations.md) — cada endpoint en uso
