# Modelo financiero

Este documento explica **todas** las fórmulas del sistema. Cada una está
implementada una sola vez, en `src/financial-engine/`, y tiene tests.

> **Regla de oro:** ningún componente de interfaz, ninguna consulta y ninguna
> ruta de API calcula un margen por su cuenta. Si una fórmula vive en dos
> lugares, tarde o temprano dan distinto y el dashboard miente.

---

## 1. Los seis principios que ordenan todo

Del §51 del brief, y son la razón de casi todas las decisiones de diseño:

| | Por qué importa acá |
|---|---|
| **VENTA ≠ COBRO** | La venta impacta el P&L el día que se vendió; el dinero llega en `money_release_date`. Son dos tablas y dos pantallas distintas. |
| **COBRO ≠ GANANCIA** | Lo que entra a Mercado Pago ya viene neto de algunos cargos, pero no descontó el costo de la mercadería. |
| **GANANCIA ≠ SALDO** | Se puede tener un mes excelente y cero pesos disponibles, porque la plata está por liberarse. |
| **SALDO ≠ DINERO DISPONIBLE** | Parte del saldo es fondo de reposición, reservas y obligaciones. |
| **RETENCIÓN ≠ GASTO** | Una retención puede ser crédito fiscal, un activo a recuperar. |
| **COSTO DE MERCADERÍA ≠ EGRESO DEL DÍA** | El COGS impacta el resultado el día de la venta; la plata salió cuando se compró. |

---

## 2. Definiciones (§29 del brief)

Implementadas en `src/financial-engine/margins.ts`.

### Facturación bruta

```
facturación bruta = Σ (precio_unitario × cantidad)
```

Ventas aprobadas, antes de cancelaciones, devoluciones y costos. Es el GMV.

### Facturación neta comercial

```
neta comercial = bruta
               − cancelaciones
               − devoluciones
               − descuentos financiados por el vendedor
```

**No es ganancia.** La interfaz lo aclara explícitamente debajo del KPI.

#### Cómo se evita contar dos veces el descuento

`unit_price` de Mercado Libre es el precio **efectivamente cobrado** por el
ítem. `sellerDiscount` es **sólo** la porción de cupones y cashbacks financiada
por el vendedor, tal como la devuelve `GET /orders/{id}/discounts → seller`.

El descuento financiado por Mercado Libre **no se resta**: no sale de nuestro
bolsillo. Y la capa de sincronización tiene prohibido volcar en `sellerDiscount`
un descuento que ya venga incorporado en `unit_price`, porque se descontaría dos
veces.

### Margen bruto

```
margen bruto = neta comercial − costo de mercadería vendida
```

### Margen de contribución

```
margen de contribución = margen bruto
                       − comisiones de Mercado Libre
                       − cargos fijos
                       − financiación (cuotas)
                       − logística a cargo del vendedor
                       − publicidad
                       − impuestos que sean costo (ver §5)
                       − otros cargos
```

### Resultado operativo

```
resultado operativo = margen de contribución − gastos operativos
```

**Esto es la ganancia.** La facturación neta no lo es.

### Neto recibido

```
neto recibido = pagado − comisiones − logística − financiación − impuestos − devoluciones
```

Es dinero que entra a la cuenta. No es ganancia ni facturación.

---

## 3. Rentabilidad de una venta (§28)

`calculateOrderProfitability()` produce el waterfall que se ve al abrir una orden:

```
  Precio producto                    +
− Descuento vendedor                 −
− Devoluciones                       −
= Facturación neta comercial         (subtotal)
− Costo producto                     −
= Margen bruto                       (subtotal)
− Comisión                           −
− Cargo fijo                         −
− Financiación                       −
− Envío                              −
− Publicidad atribuida               −
− Impuestos (sólo si son costo)      −
− Otros cargos                       −
= Margen de contribución             (subtotal)
```

Cada escalón lleva:

- **`kind`**: `ACTUAL` (cargo real de Mercado Libre) o `ESTIMATED` (calculado por
  nosotros). Se muestra como etiqueta REAL / ESTIMADO.
- **`source`**: `MELI_API`, `MP_API`, `BILLING_REPORT`, `MANUAL`, `CALCULATED`.

### De dónde sale la comisión

| Situación | Fuente | Etiqueta |
|---|---|---|
| Venta ya ocurrida | `order_items[].sale_fee` | REAL |
| Sin `sale_fee` (raro) | `listing_prices` con los parámetros del snapshot | ESTIMADO |
| Simulación o producto nuevo | `listing_prices` | ESTIMADO |

**Nunca** se sobrescribe un costo real con una estimación.

`order_items[].sale_fee` y `payments[].marketplace_fee` representan el mismo
cargo visto desde dos lados: sumarlos lo duplicaría. Se prioriza el de los ítems
porque viene desagregado por publicación, que es lo que permite calcular
rentabilidad por SKU.

---

## 4. Costeo de mercadería (§14)

`src/financial-engine/inventory.ts`. Método: **promedio ponderado móvil**, detrás
de una interfaz `CostingStrategy` abierta a FIFO.

### Al ingresar mercadería

```
nuevo promedio = (valor stock anterior + valor de la compra)
                 ÷ (unidades anteriores + unidades nuevas)
```

Si el stock resultante no es positivo, se conserva el promedio anterior en vez de
dividir por cero.

### Al vender

El COGS es el promedio **vigente al momento de vender**, y se **congela** en
`OrderItem.cogsUnitCost`. El promedio no cambia al vender: sólo lo mueven los
ingresos.

> Una venta de la semana pasada NUNCA se recalcula con el costo de hoy. Si lo
> hiciera, el resultado de un mes ya cerrado se movería solo.

### Al devolver

La mercadería vuelve al stock **al mismo costo con el que salió**, no al costo
actual: reingresarla al promedio de hoy inventaría o destruiría valor de
inventario.

### Cuando falta el costo

El margen se calcula igual, con COGS cero, pero queda marcado como `ESTIMATED` y
la interfaz lo señala. Es preferible un margen visiblemente incompleto a un
margen inventado.

---

## 5. Impuestos (§9)

**Una retención no es automáticamente una pérdida.** El tratamiento lo declara el
usuario en `FiscalProfile.treatments`:

| Tratamiento | Efecto en el resultado | Efecto en la caja |
|---|---|---|
| `FISCAL_CREDIT` | **Ninguno** — es un activo a recuperar | Sí |
| `COST` | Se descuenta | Sí |
| `CASH_MOVEMENT_ONLY` | Ninguno | Sí |
| `LIABILITY` | Genera deuda fiscal | Después |

Por defecto es `FISCAL_CREDIT`: el supuesto conservador, que no infla el
resultado contando como pérdida algo que podría recuperarse.

En el waterfall, una retención que no es costo igual **se muestra**, con una nota
que explica por qué no afecta el resultado. Se ve, pero no resta.

---

## 6. Fondo de reposición de mercadería (§15)

Responde: *qué parte de lo que entró no es ganancia sino plata para volver a
comprar lo que vendí*.

```
fondo de reposición = COGS de lo vendido × factor de reposición
factor de reposición = costo de reponer hoy ÷ costo con el que se vendió
```

El factor por defecto es 1. Existe porque, si la mercadería subió 11%, reservar
el COGS histórico deja el stock corto.

---

## 7. Disponible seguro (§22)

`calculateSafeAvailableCash()`:

```
disponible seguro = saldo conciliado disponible
                  − fondo de reposición de mercadería
                  − reservas activas
                  − obligaciones próximas no cubiertas
                  − gastos comprometidos
                  − colchón mínimo
```

```
presupuesto de compra de mercadería = disponible seguro + fondo de reposición
```

El fondo se suma de vuelta porque existe justamente para comprar stock.

### Cómo se evita contar dos veces la misma plata

- El fondo de reposición y el colchón mínimo tienen su propio término, así que
  las reservas de tipo `INVENTORY_REPLACEMENT` y `SAFETY_BUFFER` **no** se suman
  otra vez: se toma el mayor entre el calculado y el ya reservado.
- De una obligación sólo se cuenta la parte **no cubierta**
  (`monto − reservado − pagado`), porque la reservada ya está contada en su
  bolsillo.

### Orden de asignación (§21)

Configurable, por defecto:

1. Reposición de mercadería
2. Obligaciones críticas próximas
3. Reservas fiscales
4. Gastos operativos previstos
5. Colchón mínimo
6. Ganancia disponible

`allocateCash()` reparte en cascada. Cuando no alcanza, deja explícito **cuál**
bolsillo queda descubierto, en vez de prorratear: financieramente importa saber
qué obligación no se cubre.

---

## 8. Motor de reserva diaria (§20)

`calculateDailyReserve()`. **Deliberadamente no es `deuda ÷ días`.**

```
1. falta cubrir       = monto − reservado − pagado

2. plata en camino    = liberaciones pendientes antes del vencimiento
   útil                 − obligaciones anteriores no cubiertas
                        − costo de reposición esperado
                        − egresos previstos
                        − colchón mínimo
                       (nunca menor a cero)

3. a generar con      = falta cubrir − plata en camino útil
   la operación

4. por día            = a generar ÷ días restantes
```

Se devuelve además el reparto ingenuo (`naiveDailyAmount`) para poder mostrarle
al usuario la diferencia, y una lista de explicaciones en castellano de cómo se
llegó al número.

### Capacidad y confianza

```
excede capacidad = recomendación diaria > contribución diaria promedio
```

```
coeficiente de variación = desvío estándar ÷ media

confianza = ALTA   si ≥ 30 días de historia y CV ≤ 0,35
          = MEDIA  si ≥ 14 días de historia y CV ≤ 0,60
          = BAJA   en cualquier otro caso
```

Poca historia o mucha volatilidad ⇒ confianza baja. No hay nada más detrás.

### Obligación vencida

Días restantes es 0, no negativo: se exige entera hoy, sin dividir por un número
negativo.

---

## 9. Rentabilidad por SKU (§27)

```
margen antes de ads = facturación − COGS − comisiones − cargo fijo
                                  − financiación − envío − otros

margen              = margen antes de ads − publicidad

ROAS  = facturación atribuida a publicidad ÷ inversión en publicidad
ACOS  = inversión ÷ facturación atribuida × 100
TACOS = inversión ÷ facturación TOTAL del SKU × 100
```

`losesMoneyOnlyAfterAds` marca el caso que más plata cuesta: el producto que
vende bien, parece rentable, y deja de serlo una vez imputada la pauta.

Los cargos a nivel orden (envío, cargo fijo, financiación) se reparten entre los
ítems **en proporción a su facturación**. Es la única forma defendible de bajar
un costo de orden a nivel SKU.

---

## 10. Saldo de Mercado Pago (§11)

**No existe un endpoint oficial de saldo en vivo** (ver
`mercadolibre-api-research.md` §5.3). El saldo se **reconstruye**:

```
disponible = último BALANCE_AMOUNT informado con RECORD_TYPE = available_balance
           + liberaciones posteriores
           − débitos posteriores

pendiente de liberar = Σ neto de pagos aprobados con money_release_date futuro

comprometido = disponible − disponible seguro   (concepto propio de NUVELA)
```

Las filas `TOTAL` se ignoran: son subtotales del reporte, no dinero.

Se etiqueta siempre como **"Saldo conciliado"**, con la fecha hasta la que llega
la conciliación. **Nunca** como saldo en tiempo real. Sin reporte importado, la
interfaz dice que no hay dato en lugar de mostrar un cero que parezca un saldo.

---

## 11. Cashflow (§23)

`calculateCashflowForecast()`. Esto es **caja**, no resultado.

Semanas alineadas al mes: 1-7, 8-14, 15-21, 22-fin. Cada movimiento lleva su tipo:

| Tipo | Significado |
|---|---|
| `REAL` | Ya ocurrió |
| `SCHEDULED` | Programado, con fecha y monto ciertos (una obligación cargada) |
| `ESTIMATED` | Estimado sobre datos conocidos (liberación futura de un cobro real) |
| `FORECAST` | Proyección estadística |

```
saldo final = saldo inicial + ingresos − egresos
```

El saldo se calcula sobre el **total** de egresos, no sobre la suma de las
columnas conocidas: un egreso con categoría nueva tiene que impactar igual.

### Detección de quiebre de caja

Se evalúa al **cierre de cada día**, no movimiento a movimiento: un egreso de la
mañana compensado por un ingreso de la tarde no es un quiebre.

---

## 12. Proyección de ventas (§24 y §25)

`calculateSalesForecast()`. Modelo estadístico simple, explicable y testeable.
**Sin machine learning**, por pedido explícito del brief.

```
1. Nivel base: promedio ponderado con decaimiento exponencial (0,94 por día)
   sobre los últimos 28 días — los recientes pesan más.

2. Estacionalidad semanal: factor por día de la semana, amortiguado hacia 1
   según cuántas observaciones haya de ese día (con 4+ se confía del todo).

3. Tendencia: pendiente de la regresión lineal reciente, amortiguada por
   1 − offset/(horizonte + offset). Sin freno, extrapolar una pendiente a 90
   días da números absurdos.

4. Escenario: × 0,8 conservador · × 1,0 base · × 1,2 optimista (configurable).
```

```
proyección(día) = máx( (base + tendencia amortiguada) × factor_dow × escenario , 0 )
contribución    = proyección × margen histórico del período
```

Nunca se proyecta facturación negativa. Todos los supuestos usados se listan en
pantalla.

La confianza se mide sobre la **historia real disponible**, no sobre la ventana
de ponderación, y baja a medida que crece el horizonte.

---

## 13. Aritmética

- **Dinero: `Decimal` (decimal.js). Nunca `number`.** `0.1 + 0.2 !== 0.3` en
  punto flotante, y una diferencia de centavos repetida en miles de órdenes
  destruye la conciliación.
- En la base: `NUMERIC(18,4)`.
- Redondeo comercial `ROUND_HALF_UP`, 2 decimales para presentación y cierre.
- División por cero devuelve **cero**, no `NaN` ni `Infinity`: un margen sobre
  facturación cero es "sin dato", no "infinito".
- Reparto proporcional sin perder ni inventar centavos: el residuo del redondeo
  se asigna a la porción más grande.

### Dos trampas de decimal.js que costaron bugs reales

1. **`isPositive()` mira el signo, no el valor.** `new Decimal(0).isPositive()`
   es `true`. Usarlo como "tiene monto" marcaba como *parcialmente reservada* una
   obligación sin nada reservado. En todo el proyecto se usa `greaterThan(0)`.

2. **Los `Decimal` de Prisma son de otra instancia del módulo.** No pasan un
   `instanceof` contra el nuestro. `money()` los normaliza vía `toString()`.

Ambas están cubiertas por tests de regresión en `src/lib/__tests__/money.test.ts`.

---

## 14. Consolidación multi-cuenta (§3)

Consolidar es sumar, pero lo importante es lo que **no** se hace: nunca se
mezclan identificadores entre sellers. Dos cuentas pueden tener legítimamente una
orden con el mismo número; agregarlas por ID sin discriminar la cuenta contaría
de menos.

Todas las claves de agregación son compuestas (`sellerAccountId` + id externo), y
`consolidatePeriodResults()` **falla explícitamente** si la misma cuenta aparece
dos veces.

Los porcentajes consolidados se recalculan sobre los totales: promediar los
márgenes de cuentas de distinto tamaño daría un margen falso.

---

## 15. Tests

`src/financial-engine/__tests__/critical-cases.test.ts` cubre los catorce casos
obligatorios del §41, uno por `describe`:

1. Venta menor al umbral de cargo fijo
2. Venta mayor al umbral
3. Venta con 3 cuotas
4. Venta con envío gratis
5. Venta con publicidad
6. Devolución total
7. Devolución parcial
8. Compra que cambia el promedio ponderado
9. Venta con costo histórico
10. Obligación futura
11. Saldo insuficiente
12. Dos sellers
13. Orden duplicada vía webhook
14. Refund recibido dos veces
