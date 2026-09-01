# Motor de cashflow

Todo lo de acá vive en `src/financial-engine/cashflow.ts`, `cash.ts`,
`daily-reserve.ts`, `balance.ts` y `forecast.ts`. Es puro y está testeado.

---

## La distinción que ordena todo

**Cashflow no es resultado.** Una venta impacta el P&L el día que se vendió; el
dinero llega en `money_release_date`, días después. Son dos pantallas separadas y
dos conjuntos de datos separados, a propósito.

Un mes puede cerrar con ganancia y con la caja en cero, porque la plata está por
liberarse. Y al revés: se puede tener saldo alto y estar perdiendo dinero.

---

## De dónde sale cada movimiento

| Concepto | Fuente | `kind` |
|---|---|---|
| Liberación ya acreditada | `Payment` con `moneyReleaseDate` pasada | `REAL` |
| Liberación futura | `Payment` aprobado con `moneyReleaseDate` futura | `ESTIMATED` |
| Obligación | `Obligation` no pagada | `SCHEDULED` |
| Compra a plazo | `Purchase` con `paymentDueDate` | `SCHEDULED` |
| Gasto registrado | `Expense` | `REAL` |
| Ingreso externo | `Income` | `REAL` |
| Publicidad | `AdMetricDaily` | `REAL` |
| Ventas futuras | Proyección | `FORECAST` |

Una liberación futura es `ESTIMATED` y no `FORECAST` porque **el cobro ya
existe**: lo único incierto es la fecha exacta. Una venta futura sí es una
proyección.

Cuando Mercado Pago todavía no informó el neto de un pago, se usa el monto de la
transacción: es una cota superior, y se prefiere eso a omitir la liberación y
subestimar lo que va a entrar.

---

## Vista semanal (§23)

Semanas alineadas al mes —1-7, 8-14, 15-21, 22-fin— y no semanas ISO, porque es
como planifica el negocio y evita filas que cruzan meses.

```
saldo final = saldo inicial + ingresos reales + ingresos proyectados − egresos totales
```

El descuento usa el **total** de egresos, no la suma de las columnas nombradas:
un egreso con una categoría nueva tiene que impactar el saldo igual, aunque no
tenga columna propia.

El saldo inicial de la primera semana es el **saldo conciliado** de Mercado Pago.
Si no hay reporte importado, la pantalla lo dice.

Las semanas que cierran por debajo del colchón mínimo se marcan.

---

## Detección de quiebre de caja

```
findCashShortfallDate({ openingBalance, movements, safetyBuffer })
```

Se evalúa al **cierre de cada día**, no movimiento a movimiento: un egreso de la
mañana compensado por un ingreso de la tarde no es un quiebre de caja, y marcarlo
como tal generaría alarmas falsas que el usuario aprendería a ignorar.

Alimenta la alerta *"Si mantenés el ritmo actual, el 18/09 podrías quedar sin caja
suficiente."*

---

## Saldo conciliado

**No existe un endpoint oficial de saldo en vivo de Mercado Pago para
vendedores.** El endpoint que circula en foros no está documentado y responde
`403`. Detalle completo en `mercadolibre-api-research.md` §5.3.

NUVELA lo reconstruye del reporte oficial de liberaciones:

```
1. Ancla: el BALANCE_AMOUNT más reciente con RECORD_TYPE = available_balance.
   Es el número que da Mercado Pago.

2. Se le suman las liberaciones y se le restan los débitos POSTERIORES al ancla.
   Las filas TOTAL se ignoran: son subtotales del reporte, no dinero.

3. Si no hay ninguna ancla, se parte de initial_available_balance.

4. Si no hay reporte, hasReport = false y la interfaz no muestra un saldo.
```

Se etiqueta siempre como **"Saldo conciliado"**, con la fecha hasta la que llega
la conciliación y cuántos días de atraso tiene. Nunca como saldo en tiempo real.

```
pendiente de liberar = Σ neto de pagos aprobados con money_release_date futura
comprometido         = disponible − disponible seguro
```

`comprometido` es un concepto **propio de NUVELA**, no de Mercado Pago, y en la
interfaz aparece etiquetado como cálculo.

---

## Disponible seguro

```
disponible seguro = saldo disponible
                  − fondo de reposición de mercadería
                  − reservas activas
                  − obligaciones próximas no cubiertas
                  − gastos comprometidos
                  − colchón mínimo
```

```
presupuesto de compra de mercadería = disponible seguro + fondo de reposición
```

### Sin contar dos veces

- El fondo de reposición y el colchón tienen su propio término: las reservas de
  esos dos tipos no se suman otra vez. Se toma el mayor entre el calculado y el
  ya reservado.
- De una obligación sólo se cuenta `monto − reservado − pagado`.

### Ejemplo del §19 del brief

| | |
|---|---|
| Saldo Mercado Pago | $3.000.000 |
| − Fondo mercadería | $800.000 |
| − Impuestos | $250.000 |
| − Tarjeta | $400.000 |
| − Proveedor | $300.000 |
| − Colchón mínimo | $200.000 |
| **Disponible realmente** | **$1.050.000** |

Es un test.

---

## Motor de reserva diaria

La función central del sistema. **No es `deuda ÷ días`.**

```
1. falta cubrir     = monto − reservado − pagado

2. plata en camino  = liberaciones antes del vencimiento
   útil               − obligaciones anteriores no cubiertas
                      − costo de reposición esperado
                      − egresos previstos
                      − colchón mínimo
                     (nunca menor a cero: si los compromisos previos se comen
                      todo, esta obligación no puede contar con nada)

3. a generar        = falta cubrir − plata en camino útil

4. por día          = a generar ÷ días restantes
```

Se devuelve también el reparto ingenuo, para poder mostrar la diferencia, y una
lista de explicaciones en castellano que se ve en pantalla:

> Falta cubrir $900.000 de $1.200.000 con vencimiento 20/09/2026.
> Quedan 15 días hasta el vencimiento.
> Se liberan $450.000 de Mercado Pago antes del vencimiento; $0 ya están
> comprometidos antes que esta obligación, así que se puede contar con $450.000.
> Por eso la recomendación ($30.000/día) es menor que el reparto simple
> $60.000/día.

### Agregado sobre varias obligaciones

Se ordenan por vencimiento y cada una recibe como "obligaciones anteriores" la
suma no cubierta de las que vencen antes. El colchón se descuenta **una sola
vez**, en la más próxima: restarlo en todas lo contaría N veces.

### Capacidad y confianza

```
excede capacidad = recomendación diaria > contribución diaria promedio
```

```
CV = desvío estándar ÷ media

ALTA   ≥ 30 días de historia y CV ≤ 0,35
MEDIA  ≥ 14 días de historia y CV ≤ 0,60
BAJA   en cualquier otro caso
```

### Obligación vencida

`daysRemaining` es 0, no negativo: se exige entera hoy. Dividir por un número
negativo daría una recomendación negativa, que no significa nada.

---

## Proyección

Modelo estadístico simple, explicable y testeable. **Sin machine learning**, por
pedido explícito del brief.

```
proyección(día) = máx( (nivel base + tendencia amortiguada) × factor_dow × escenario , 0 )
```

| Componente | Cómo |
|---|---|
| Nivel base | Promedio ponderado con decaimiento 0,94 sobre los últimos 28 días |
| Estacionalidad | Factor por día de la semana, amortiguado hacia 1 según cuántas observaciones haya (con 4+ se confía del todo) |
| Tendencia | Pendiente de la regresión lineal, amortiguada por `1 − offset/(horizonte + offset)` |
| Escenario | 0,8 conservador · 1,0 base · 1,2 optimista, configurable |

La amortiguación de la tendencia existe porque extrapolar una pendiente lineal a
90 días sin freno produce números absurdos. La de la estacionalidad, porque con
dos lunes en la historia no conviene creerle al factor del lunes.

Nunca se proyecta facturación negativa.

Todos los supuestos se listan en pantalla. Sin historial, la función devuelve
cero puntos y lo dice, en vez de proyectar sobre la nada.

La confianza se mide sobre la **historia real disponible** (no sobre la ventana
de 28 días de ponderación) y baja con el horizonte: 90 días nunca es ALTA.

---

## Alertas

Todas derivadas de números auditables, con umbrales configurables:

| Alerta | Disparador |
|---|---|
| Quiebre de caja | Primer día bajo el colchón |
| Vencimientos próximos | Suma no cubierta en el horizonte |
| Reserva diaria | Recomendación agregada mayor a cero |
| SKU con margen negativo | `margen < 0` |
| SKU negativo sólo después de ads | `margen < 0 ≤ margen antes de ads` |
| Publicidad sobre ventas | Supera `adsOverSalesPct` |
| Suba del costo de mercadería | Supera `costRisePct` |
| Caída de margen | Cae más de `marginDropPoints` puntos |
| Dinero comprometido | `comprometido > 0` |

La variación del costo compara el **costo unitario promedio ponderado** de las
compras, no el total gastado: comprar más caro y comprar más cantidad son cosas
distintas, y sólo la primera es una alerta.

Cada alerta lleva a la pantalla donde se resuelve: una alerta que no se puede
accionar es ruido.
