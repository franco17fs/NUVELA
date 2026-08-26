# NUVELA · Sistema de cashflow

Flujo de caja rolling de 13 semanas sobre Google Sheets + Apps Script.
Responde tres preguntas: **qué hay que pagar esta semana**, **cuánta plata va a haber**,
y **si no alcanza, qué se paga primero y qué queda afuera**.

## Estado

| Etapa | Qué incluye | Estado |
|---|---|---|
| 1 | Modelo de datos + carga de las obligaciones reales | ✅ listo |
| 2 | Proyección de 13 semanas | pendiente |
| 3 | Priorización y alertas | pendiente |
| 4 | Simulador de escenarios | pendiente |
| 5 | Importación automática de liquidaciones de ML | pendiente |

## Instalación (una sola vez, ~3 minutos)

1. Crear un Google Sheets nuevo. Nombre sugerido: `NUVELA · Cashflow`.
2. **Extensiones → Apps Script**.
3. Borrar el `Código.gs` que viene por defecto.
4. Crear un archivo por cada `.gs` de `apps-script/`, **con el mismo nombre**, y pegar el contenido.
   El orden de los nombres importa: Apps Script carga alfabéticamente y `02_Esquema`
   define cosas que usan los demás.
5. Guardar y volver a la planilla. Recargar la pestaña del navegador.
6. Menú **NUVELA Cashflow → Crear / reparar sistema**. Autorizar cuando lo pida
   (la primera vez avisa que la app no está verificada: *Configuración avanzada → Ir a…*).

`Crear / reparar sistema` se puede correr las veces que haga falta: crea lo que falta,
actualiza cabeceras y formatos, y **nunca pisa datos ya cargados**.

## Las hojas

**Se cargan a mano:**

| Hoja | Qué lleva |
|---|---|
| `Config` | Parámetros. Cada uno con su origen: MEDIDO / DECLARADO / ESTIMADO / **CONFIRMAR** |
| `Obligaciones` | Todo lo que hay que pagar. Una fila por concepto, no por vencimiento |
| `Deudas` | Saldo vivo de cada crédito y cuántas cuotas quedan |
| `Ventas` | Una fila por semana: proyectado y real |
| `Movimientos` | Lo que efectivamente se pagó o cobró |

**Las escribe el sistema (no editar):** `Esta Semana`, `Cashflow 13S`, `Simulador`.

La proyección se calcula en Apps Script y se escriben valores, no fórmulas encadenadas.
Las fórmulas encadenadas se rompen al insertar una fila en el medio, y cuando eso pasa
la planilla miente sin avisar.

## La rutina del domingo (5 minutos)

1. `Config` → actualizar `SALDO_MERCADO_PAGO`.
2. `Ventas` → completar `Bruto_Real` de la semana que terminó y ajustar el proyectado de la que viene.
3. `Movimientos` → anotar lo que se pagó.
4. Menú → **Actualizar proyección** *(Etapa 2)*.
5. Leer `Esta Semana`.

## Cómo modela la plata

```
facturación bruta (lo que paga el comprador)
  × 67,3%  →  neto que entra a Mercado Pago
```

ML ya descontó comisión (19,0%), envío (11,2%) e impuestos (2,6%) de cada liquidación.
Medido sobre junio 2026: $10.980.981 brutos → $7.385.927 netos.

**Los tres errores que el modelo evita a propósito** (cada uno está cubierto por un test):

- La **factura de ML** no entra como egreso por su total (~$4.400.000/mes). ML descuenta
  casi todo de las liquidaciones diarias; lo que se paga es el saldo adeudado ($400.000–$700.000).
  Cargar el total sería contar dos veces cuatro millones.
- **Ads** no va como línea aparte: ya está adentro de la factura de ML.
- La **cuota del auto** no va como obligación: se paga del retiro de Elian. Figura en
  `Deudas` como saldo vivo, para ver cuánto flujo libera cuando termine.

La plata se acredita a **1 día** porque se paga el adelanto de dinero (~$384.000/mes,
~3,2% de las ventas). Sin adelanto serían 7 a 14 días. Es la palanca más cara del sistema
y por eso está explícita en `Config`.

## Tests

```bash
node --test "cashflow/test/*.test.js"
```

Sin dependencias: usa el runner de Node y carga los `.gs` en un sandbox `vm`.

El test que más importa es `las constantes del modelo reconcilian con junio 2026`:
alimenta los porcentajes de `Config` con la facturación real de junio y verifica que
la cadena reproduzca la ganancia del informe de rentabilidad ($1.662.109 pre-ads).
Si alguien cambia un porcentaje a ojo, ese test se cae.

## Fuentes de los números

- Facturas del ciclo 06/07–06/08/2026 (7 PDFs de MercadoLibre S.R.L. y Meli Log S.R.L.)
- `vendedores.mercadolibre.com.ar/billing/resume` — facturado y adeudado por ciclo
- Informe de rentabilidad de junio 2026 (documento maestro NUVELA)
- Facturación bruta 01/05–26/08/2026: $46.694.168 en 117 días

CUIT de Elian: terminación **1** → grupo 0-1 para vencimientos impositivos.
