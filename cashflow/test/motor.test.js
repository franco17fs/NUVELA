/**
 * NUVELA · Cashflow — Tests del motor de proyección (Etapa 2).
 * Correr con:  node --test "cashflow/test/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./cargar');

const G = cargar(['02_Esquema.gs', '01_Config.gs', '03_Semilla.gs', '05_Validacion.gs', '06_Motor.gs']);
const cfgSemilla = Object.fromEntries(G.CONFIG_SEMILLA.map((f) => [f[0], f[1]]));

const LUNES = new Date(2026, 7, 24);           // lunes 24/08/2026
const semanas13 = () => G.generarSemanas(LUNES, 13);
const bruto = (v = 2_800_000) => new Array(13).fill(v);

/** Config de trabajo, sobreescribible por test. */
const cfg = (extra = {}) => ({ ...cfgSemilla, SALDO_MERCADO_PAGO: 0, SALDO_EFECTIVO: 0, ...extra });

// --- Expansión de vencimientos ----------------------------------------------

test('una obligación semanal vence una vez por semana, siempre el mismo día', () => {
  const semanas = semanas13();
  const moto = G.OBLIGACIONES_SEMILLA.find((f) => f[G.COL_OBL.ID] === 'OBL-003');
  const fechas = G.ocurrenciasDeObligacion(moto, semanas[0].desde, semanas[12].hasta);

  assert.strictEqual(fechas.length, 13);
  fechas.forEach((f) => assert.strictEqual(f.getDay(), 1, `${f.toDateString()} no es lunes`));
});

test('una obligación mensual vence una vez por mes, en el día indicado', () => {
  const semanas = semanas13();
  const alquiler = G.OBLIGACIONES_SEMILLA.find((f) => f[G.COL_OBL.ID] === 'OBL-001');
  const fechas = G.ocurrenciasDeObligacion(alquiler, semanas[0].desde, semanas[12].hasta);

  fechas.forEach((f) => assert.strictEqual(f.getDate(), 10));
  // 24/08 al 22/11 contiene el día 10 de septiembre, octubre y noviembre.
  assert.strictEqual(fechas.length, 3);
  assert.deepStrictEqual([...fechas.map((f) => f.getMonth())], [8, 9, 10]);
});

test('un vencimiento mensual anterior al arranque no se cuela', () => {
  // La semana 1 empieza el 24/08 y el alquiler vence el 10: el de agosto ya pasó.
  const alquiler = G.OBLIGACIONES_SEMILLA.find((f) => f[G.COL_OBL.ID] === 'OBL-001');
  const fechas = G.ocurrenciasDeObligacion(alquiler, new Date(2026, 7, 24), new Date(2026, 8, 30));
  assert.strictEqual(fechas.length, 1);
  assert.strictEqual(fechas[0].getMonth(), 8, 'solo debería aparecer el de septiembre');
});

test('una obligación única aparece una sola vez, y solo si cae en el rango', () => {
  const base = G.OBLIGACIONES_SEMILLA.find((f) => f[G.COL_OBL.ID] === 'OBL-011').slice();

  base[G.COL_OBL.VENCIMIENTO] = new Date(2026, 8, 30);
  assert.strictEqual(G.ocurrenciasDeObligacion(base, LUNES, new Date(2026, 10, 22)).length, 1);

  base[G.COL_OBL.VENCIMIENTO] = new Date(2027, 0, 15);
  assert.strictEqual(G.ocurrenciasDeObligacion(base, LUNES, new Date(2026, 10, 22)).length, 0);

  base[G.COL_OBL.VENCIMIENTO] = '';
  assert.strictEqual(G.ocurrenciasDeObligacion(base, LUNES, new Date(2026, 10, 22)).length, 0,
    'sin fecha no debería inventar un vencimiento');
});

test('las obligaciones desactivadas no entran en la proyección', () => {
  const semanas = semanas13();
  const venc = G.expandirObligaciones(G.OBLIGACIONES_SEMILLA, semanas, bruto(), cfg(), LUNES);
  assert.ok(!venc.some((v) => v.id === 'OBL-012'), 'Ads está desactivada y no debe aparecer');
});

test('un porcentaje sobre ventas se resuelve con las ventas de esa semana', () => {
  const semanas = semanas13();
  const brutos = bruto();
  brutos[5] = 10_000_000;                      // una semana fuerte

  const venc = G.expandirObligaciones(G.OBLIGACIONES_SEMILLA, semanas, brutos, cfg(), LUNES);
  const merc = venc.filter((v) => v.id === 'OBL-004');

  assert.strictEqual(merc[0].monto, Math.round(2_800_000 * 0.462));
  assert.strictEqual(merc[5].monto, Math.round(10_000_000 * 0.462));
});

test('la motomensajería sigue a las ventas y da ~$120.000 en una semana normal', () => {
  const venc = G.expandirObligaciones(G.OBLIGACIONES_SEMILLA, semanas13(), bruto(), cfg(), LUNES);
  const moto = venc.filter((v) => v.id === 'OBL-003');

  assert.strictEqual(moto.length, 13);
  assert.ok(Math.abs(moto[0].monto - 120_000) < 2_000,
    `da ${moto[0].monto}, se esperaba ~$120.000 sobre la venta semanal de referencia`);
});

test('un monto fijo con inflación crece con los meses, y no dentro de la semana', () => {
  const semanas = semanas13();
  const venc = G.expandirObligaciones(G.OBLIGACIONES_SEMILLA, semanas, bruto(),
                                      cfg({ INFLACION_MENSUAL_PCT: 10 }), LUNES);
  const alquiler = venc.filter((v) => v.id === 'OBL-001');

  assert.ok(alquiler[0].monto > 400_000, 'el primero ya está a algunas semanas vista');
  assert.ok(alquiler[2].monto > alquiler[0].monto, 'el de noviembre tiene que costar más que el de septiembre');
  // Dos meses al 10% mensual: ~21% de diferencia.
  const ratio = alquiler[2].monto / alquiler[0].monto;
  assert.ok(ratio > 1.15 && ratio < 1.28, `ratio ${ratio.toFixed(3)} fuera de lo esperable`);
});

test('un porcentaje sobre ventas no se ajusta por inflación (sería contarla dos veces)', () => {
  for (const id of ['OBL-003', 'OBL-004']) {
    const fila = G.OBLIGACIONES_SEMILLA.find((f) => f[G.COL_OBL.ID] === id);
    assert.strictEqual(fila[G.COL_OBL.AJUSTA], 'NO',
      `${id} es PCT_VENTAS: si las ventas ya suben con la inflación, ajustarlo de nuevo la cuenta dos veces`);
  }

  const venc = G.expandirObligaciones(G.OBLIGACIONES_SEMILLA, semanas13(), bruto(),
                                      cfg({ INFLACION_MENSUAL_PCT: 50 }), LUNES);
  const merc = venc.filter((v) => v.id === 'OBL-004');
  assert.strictEqual(merc[0].monto, merc[12].monto, 'con ventas planas la mercadería no debe moverse');
});

// --- Ingresos ---------------------------------------------------------------

test('con 1 día de plazo, la venta del domingo se cobra la semana siguiente', () => {
  const ingresos = G.distribuirIngresos([700_000, 0, 0], 100, 1);
  // 6/7 en la semana, 1/7 en la siguiente. La semana 1 suma además su propia cola de arrastre.
  assert.strictEqual(ingresos[1], 100_000);
  assert.strictEqual(ingresos[0], 700_000, '6/7 propios + 1/7 de arrastre de la semana anterior');
});

test('un plazo de 7 días corre la plata una semana entera', () => {
  const ingresos = G.distribuirIngresos([1_000_000, 0, 0], 100, 7);
  assert.strictEqual(ingresos[0], 0);
  assert.strictEqual(ingresos[1], 1_000_000);
});

test('un plazo de 14 días corre dos semanas', () => {
  const ingresos = G.distribuirIngresos([1_000_000, 0, 0, 0], 100, 14);
  assert.deepStrictEqual([...ingresos], [0, 0, 1_000_000, 0]);
});

test('el ingreso entra neto de comisión, no bruto', () => {
  const ingresos = G.distribuirIngresos(bruto(), cfgSemilla.PCT_NETO_SOBRE_BRUTO, 1);
  assert.ok(Math.abs(ingresos[5] - 2_800_000 * 0.673) < 2,
    `semana normal: ${ingresos[5]} vs neto esperado ${Math.round(2_800_000 * 0.673)}`);
});

// --- Proyección completa ----------------------------------------------------

const proyectarBase = (extra = {}, brutos = bruto()) => G.proyectar({
  semanas: semanas13(),
  brutoPorSemana: brutos,
  obligaciones: G.OBLIGACIONES_SEMILLA,
  cfg: cfg(extra),
  hoy: LUNES,
  pagados: {}
});

test('el saldo se arrastra: el final de una semana es el inicial de la siguiente', () => {
  const { filas } = proyectarBase();
  assert.strictEqual(filas.length, 13);
  for (let i = 1; i < filas.length; i++) {
    assert.strictEqual(filas[i].saldoInicial, filas[i - 1].saldoFinal,
      `la semana ${i + 1} no arranca donde terminó la ${i}`);
  }
});

test('cada semana cierra con inicial + ingresos - egresos', () => {
  const { filas } = proyectarBase();
  for (const f of filas) {
    const egresos = f.mercaderia + f.fijos + f.impuestos + f.deuda;
    assert.strictEqual(f.saldoFinal, f.saldoInicial + f.ingresos - egresos,
      `no cierra la aritmética de la semana ${f.numero}`);
  }
});

test('el saldo inicial de la semana 1 es la plata que hay hoy', () => {
  const { filas } = proyectarBase({ SALDO_MERCADO_PAGO: 1_500_000, SALDO_EFECTIVO: 200_000 });
  assert.strictEqual(filas[0].saldoInicial, 1_700_000);
});

test('cada vencimiento cae en la columna que le corresponde', () => {
  const { filas } = proyectarBase();
  const conAlquiler = filas.find((f) => f.vencimientos.some((v) => v.id === 'OBL-001'));

  assert.ok(conAlquiler.mercaderia > 0, 'la mercadería va en su propia columna');
  assert.ok(conAlquiler.fijos >= 400_000, 'el alquiler va en egresos fijos');
  assert.ok(filas.some((f) => f.impuestos > 0), 'IVA, IIBB y autónomos van en impuestos');
  assert.ok(filas.some((f) => f.deuda > 0), 'la devolución a la madre de Elian va en deuda');
});

test('ningún vencimiento se pierde ni se duplica al repartirlo en columnas', () => {
  const { filas } = proyectarBase();
  for (const f of filas) {
    const enColumnas = f.mercaderia + f.fijos + f.impuestos + f.deuda;
    const enVencimientos = f.vencimientos.reduce((a, v) => a + v.monto, 0);
    assert.strictEqual(enColumnas, enVencimientos, `descuadre en la semana ${f.numero}`);
  }
});

test('marcar un pago hecho lo saca de la proyección', () => {
  const sinPagar = proyectarBase();
  const semanaAlquiler = sinPagar.filas.findIndex((f) => f.vencimientos.some((v) => v.id === 'OBL-001'));

  const conPago = G.proyectar({
    semanas: semanas13(),
    brutoPorSemana: bruto(),
    obligaciones: G.OBLIGACIONES_SEMILLA,
    cfg: cfg(),
    hoy: LUNES,
    pagados: { ['OBL-001|' + semanaAlquiler]: true }
  });

  const antes = sinPagar.filas[semanaAlquiler];
  const despues = conPago.filas[semanaAlquiler];
  assert.ok(despues.fijos < antes.fijos, 'el alquiler pagado debería dejar de restar');
  assert.ok(despues.saldoFinal > antes.saldoFinal);
});

test('una semana negativa se marca ROJO y una bajo el colchón, ATENCION', () => {
  const flojo = proyectarBase({ SALDO_MERCADO_PAGO: 0 }, bruto(500_000));
  assert.ok(flojo.filas.some((f) => f.estado === 'ROJO'), 'con ventas de $500.000 tiene que romper');

  const holgado = proyectarBase({ SALDO_MERCADO_PAGO: 50_000_000 });
  assert.ok(holgado.filas.every((f) => f.estado === 'OK'), 'con $50M no debería alertar nada');

  // Saldo final justo entre cero y el colchón.
  const filas = proyectarBase({ SALDO_MERCADO_PAGO: 0 }, bruto(2_800_000)).filas;
  for (const f of filas) {
    if (f.saldoFinal < 0) assert.strictEqual(f.estado, 'ROJO');
    else if (f.saldoFinal < cfgSemilla.COLCHON_MINIMO) assert.strictEqual(f.estado, 'ATENCION');
    else assert.strictEqual(f.estado, 'OK');
  }
});

test('el quiebre informa qué semana, cuánto falta y cuántos días de aviso hay', () => {
  const { filas, quiebre } = proyectarBase({ SALDO_MERCADO_PAGO: 0 }, bruto(500_000));
  assert.ok(quiebre, 'debería detectar el quiebre');

  const primeraRoja = filas.find((f) => f.estado === 'ROJO');
  assert.strictEqual(quiebre.semana, primeraRoja.numero, 'tiene que ser la PRIMERA semana en rojo');
  assert.strictEqual(quiebre.faltan, -primeraRoja.saldoFinal);
  assert.ok(quiebre.dias >= 0);
  assert.strictEqual(quiebre.dias, Math.round((primeraRoja.hasta - LUNES) / 86400000));
});

test('sin quiebre no se inventa uno', () => {
  const { quiebre } = proyectarBase({ SALDO_MERCADO_PAGO: 50_000_000 });
  assert.strictEqual(quiebre, null);
});

test('vender más adelanta plata pero también adelanta la mercadería', () => {
  const flojo = proyectarBase({ SALDO_MERCADO_PAGO: 2_000_000 }, bruto(2_000_000));
  const fuerte = proyectarBase({ SALDO_MERCADO_PAGO: 2_000_000 }, bruto(4_000_000));

  // Con neto 67,3% y mercadería 46,2% + moto 4,3%, vender deja margen: ~16,8 puntos.
  assert.ok(fuerte.filas[12].saldoFinal > flojo.filas[12].saldoFinal,
    'a este margen, más ventas tienen que dejar más caja al final del trimestre');
});

// --- Formato ----------------------------------------------------------------

test('los pesos se escriben como se leen en Argentina', () => {
  assert.strictEqual(G.pesos(1_200_000), '$1.200.000');
  assert.strictEqual(G.pesos(550_000), '$550.000');
  assert.strictEqual(G.pesos(450), '$450');
  assert.strictEqual(G.pesos(-37_891), '-$37.891');
  assert.strictEqual(G.pesos(0), '$0');
});

test('el resumen de la semana muestra los vencimientos más grandes primero', () => {
  const { filas } = proyectarBase();
  const cargada = filas.find((f) => f.vencimientos.length >= 3);
  const texto = G.resumenDeSemana(cargada, 3);

  const montos = cargada.vencimientos.slice().sort((a, b) => b.monto - a.monto);
  assert.ok(texto.startsWith(montos[0].concepto), `"${texto}" no arranca por el más grande`);
  assert.strictEqual(texto.split(' · ').length, 3);
});
