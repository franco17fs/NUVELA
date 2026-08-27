# NUVELA · Sistema de cashflow

Flujo de caja rolling de 13 semanas sobre Google Sheets + Apps Script.
Responde tres preguntas: **qué hay que pagar esta semana**, **cuánta plata va a haber**,
y **si no alcanza, qué se paga primero y qué queda afuera**.

## Estado

| Etapa | Qué incluye | Estado |
|---|---|---|
| 1 | Modelo de datos + carga de las obligaciones reales | ✅ listo |
| 2 | Proyección de 13 semanas | ✅ listo |
| 3 | Priorización y alertas | ✅ listo |
| 4 | Simulador de escenarios | ✅ listo |
| 5 | Distribución diaria en fondos | ✅ listo |
| 6 | Conector de la API de Mercado Libre | pendiente |

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
4. Menú → **Actualizar proyección**.
5. Leer `Cashflow 13S` (y `Esta Semana`, desde la Etapa 3).

## Cómo proyecta

Arrastre semanal simple — `saldo final = saldo inicial + ingresos − egresos`, y el
final de una semana es el inicial de la siguiente. Lo que no es simple es cómo se
arma cada término:

- **Ingresos.** Las ventas de la semana entran netas (67,3%) y se reparten según el
  plazo de acreditación. Con 1 día, 6/7 se cobran en la misma semana y 1/7 —lo del
  domingo— cae en la siguiente. La misma cuenta sirve para 7 o 14 días de plazo, que
  desplazan semanas enteras.
- **Vencimientos.** Cada obligación se expande a fechas concretas: "todos los lunes"
  se vuelve 13 fechas, "el día 10" se vuelve una por mes. Un vencimiento anterior al
  arranque no se cuela.
- **Montos.** `PCT_VENTAS` se resuelve con las ventas de esa semana puntual, así que
  la mercadería y la moto suben cuando la semana vende más. Los montos fijos marcados
  `Ajusta_Inflacion = SI` crecen con los meses de distancia. **Un `PCT_VENTAS` nunca
  ajusta por inflación**: si las ventas ya suben con los precios, ajustarlo otra vez
  la cuenta dos veces.
- **Lo ya pagado.** Un movimiento con `Obligacion_ID` saca ese vencimiento de la
  semana. Sin eso la semana en curso miente siempre.
- **El real manda.** Si una semana tiene `Bruto_Real`, se usa ese y se ignora el
  proyectado.

Rojo = cierra en negativo. Amarillo = queda por debajo del colchón. El aviso dice qué
semana rompe, cuánto falta y cuántos días hay de anticipación.

## Cómo prioriza cuando no alcanza

El orden sale de la planilla, no del código:

1. **Criticidad**, de mayor a menor. Está cargada a mano en `Obligaciones`, así que se
   cambia editando una celda.
2. A igual criticidad, **lo que vence antes**.
3. A igual fecha, **lo más barato primero**: con plata limitada, pagar los chicos deja
   menos acreedores golpeados que pagar uno grande.

Un vencimiento grande que no entra **no bloquea** a los chicos que siguen. El sistema
no decide: ordena, muestra hasta dónde llega la plata, y al lado de cada cosa que queda
afuera pone la consecuencia que vos escribiste.

### Dos números que no son lo mismo

- **Déficit** — cuánta plata hay que conseguir para pagar todo.
- **Faltante** — cuánto suma lo que queda entero sin pagar.

Si faltan $47.000 para una compra de $1.293.600, el déficit es $47.000 y el faltante
$1.293.600. El déficit es el número para salir a buscar plata; el faltante es lo que se
deja de hacer si no aparece. Confundirlos lleva a decisiones equivocadas, así que van
separados en todos lados.

## Simulador

`Simular escenario` corre la proyección dos veces —base y escenario— y las compara
semana a semana. Los supuestos se cargan arriba de la hoja `Simulador`:

| Entrada | Para qué |
|---|---|
| Compro mercadería por / el día | La pregunta original: mover una compra y ver si destraba una semana |
| Ajusto las ventas en (%) | Un mes flojo o uno bueno sobre las 13 semanas |
| Plazo de acreditación (días) | Poner 7 o 14 simula apagar el adelanto de dinero |

Lo que se lee primero no es el saldo sino **el corrimiento del quiebre**: adelantarlo
una semana es peor que cualquier diferencia de pesos.

Apagar el adelanto devuelve su costo (`PCT_ADELANTO_DINERO`, 3,2%), que está descontado
dentro del 67,3%. Sin eso el escenario seguiría cobrando una comisión que ya no se paga
y la palanca daría siempre peor de lo que es.

**Una advertencia que el simulador da solo:** estirar el plazo corre las ventas de las
últimas semanas más allá del horizonte de 13 semanas. Esa plata no se pierde — entra
después. El cierre queda peor de lo que realmente es, así que para decidir hay que mirar
el quiebre y las primeras semanas.

## Distribución diaria en fondos

`Cerrar el día` reparte lo que generaron las ventas del día para que ningún peso quede
sin destino. El orden **es** la regla de seguridad:

1. **Mercadería** — el costo de reponer lo vendido. No es ganancia y sale primero, así
   separar para una obligación nunca puede dejar al negocio sin con qué comprar.
2. **Obligaciones** — lo que hay que separar hoy para llegar a cada vencimiento:
   `pendiente ÷ días restantes`, recalculado todos los días.
3. **Colchón** — hasta el objetivo de seguridad.
4. **Adelantos** — en días buenos, se adelantan reservas futuras.
5. **Libre** — lo único que se puede retirar.

### El ciclo de un fondo

Cada vencimiento junta plata día a día y **se vacía al vencer**: la reserva se usa para
pagarlo. Si no alcanzó, el faltante sale de libre, después del colchón y recién al final
de mercadería — y eso pone el semáforo en rojo, que es exactamente lo que hay que ver.

Un fondo que se llena y no se vacía no es un fondo: acumula para siempre y hace que
nunca haya plata libre.

### Orden cuando compiten por la plata

Vencimiento más cercano → criticidad → la más descubierta. Un día flojo separa menos y
el promedio necesario de los días siguientes sube solo, sin que haya que tocar nada.

### Recalcular no acumula

El estado se reconstruye reproduciendo todos los días desde el principio. Correr
`Cerrar el día` dos veces no duplica nada, y el orden en que se cargan los días no
cambia el resultado.

### El colchón

`Sugerir colchón` lo calcula como `DIAS_COLCHON` días de operación completa: reposición
de mercadería, motomensajería y el prorrateo diario de los vencimientos del mes.
Contesta "si dejo de vender, ¿cuántos días aguanto sin romper nada?".

### Semáforo

- **ROJO** — el fondo de mercadería en negativo, una obligación vencida sin cubrir, o
  un vencimiento al que no se llega al ritmo actual.
- **AMARILLO** — se llega, pero las obligaciones se comen más del 80% del margen diario,
  o el colchón está corto.
- **VERDE** — mercadería, obligaciones y colchón cubiertos.

Cada estado dice por qué, y cada alerta viene con propuestas concretas ordenadas de menor
a mayor daño: usar el fondo libre, separar más por día, postergar compras, y último de
todo tocar el colchón.

## Avisos

**Activar aviso de los domingos** programa un disparador para las 20 hs. Llega por mail
siempre. Para que llegue también por WhatsApp, cargá en `Config`:

- `WHATSAPP_NUMERO` — con código de país, sin espacios
- `CALLMEBOT_APIKEY` — mandarle `I allow callmebot to send me messages` al
  +34 644 51 95 23 desde el celular y devuelve la clave

Si WhatsApp falla, el mail sale igual: no puede tumbar el aviso.

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
