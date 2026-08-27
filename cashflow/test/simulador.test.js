/**
 * NUVELA · Cashflow — Tests del simulador (Etapa 4).
 * Correr con:  node --test "cashflow/test/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./cargar');

const G = cargar(['02_Esquema.gs', '01_Config.gs', '03_Semilla.gs', '05_Validacion.gs',
                  '06_Motor.gs', '08_Prioridad.gs', '10_Simulador.gs']);
const cfgSemilla = Object.fromEntries(G.CONFIG_SEMILLA.map((f) => [f[0], f[1]]));

const LUNES = new Date(2026, 7, 24);

const entradas = (extra = {}, bruto = 2_800_000) => ({
  semanas: G.generarSemanas(LUNES, 13),
  brutoPorSemana: new Array(13).fill(bruto),
  obligaciones: G.OBLIGACIONES_SEMILLA,
  cfg: { ...cfgSemilla, SALDO_MERCADO_PAGO: 0, SALDO_EFECTIVO: 0, ...extra },
  hoy: LUNES,
  pagados: {}
});

const vacio = { movimientos: [], ajusteVentasPct: 0, lagDias: 0 };

// --- El escenario no ensucia la base ---------------------------------------

test('aplicar un escenario no modifica las entradas originales', () => {
  const base = entradas();
  const brutosAntes = [...base.brutoPorSemana];
  const lagAntes = base.cfg.LAG_ACREDITACION_DIAS;

  G.aplicarEscenario(base, { ajusteVentasPct: -50, lagDias: 14, movimientos: [] });

  assert.deepStrictEqual([...base.brutoPorSemana], brutosAntes);
  assert.strictEqual(base.cfg.LAG_ACREDITACION_DIAS, lagAntes);
});

test('un escenario vacío da exactamente la proyección base', () => {
  const c = G.compararEscenarios(entradas(), vacio);
  assert.strictEqual(c.cierreBase, c.cierreEscenario);
  assert.strictEqual(c.corrimiento.semanas, 0);
  c.semanas.forEach((s) => assert.strictEqual(s.diferencia, 0));
});

// --- La pregunta que Franco quería contestar --------------------------------

test('una compra grande adelanta el quiebre, y la fecha decide cuánto', () => {
  const base = entradas();
  const temprano = G.compararEscenarios(base, {
    ...vacio, movimientos: [{ concepto: 'Compra', monto: 2_000_000, fecha: new Date(2026, 7, 26) }]
  });

  assert.ok(temprano.quiebreEscenario.semana <= temprano.quiebreBase.semana,
    'meter $2.000.000 no puede correr el quiebre para adelante');
  assert.ok(temprano.cierreEscenario < temprano.cierreBase);
  assert.strictEqual(temprano.cierreBase - temprano.cierreEscenario, 2_000_000,
    'el trimestre tiene que cerrar exactamente $2.000.000 más abajo');
});

test('correr la misma compra más adelante mejora las semanas del medio', () => {
  const base = entradas();
  const compra = (dia) => G.compararEscenarios(base, {
    ...vacio, movimientos: [{ concepto: 'Compra', monto: 1_500_000, fecha: dia }]
  });

  const yaMismo = compra(new Date(2026, 7, 26));
  const enUnMes = compra(new Date(2026, 9, 26));

  assert.strictEqual(yaMismo.cierreEscenario, enUnMes.cierreEscenario,
    'a 13 semanas la plata sale igual: lo que cambia es cuándo');
  assert.ok((enUnMes.quiebreEscenario ? enUnMes.quiebreEscenario.semana : 99) >=
            (yaMismo.quiebreEscenario ? yaMismo.quiebreEscenario.semana : 99),
    'comprar más tarde no puede adelantar el quiebre');
});

test('una compra fuera de las 13 semanas no entra en el escenario', () => {
  const c = G.compararEscenarios(entradas(), {
    ...vacio, movimientos: [{ concepto: 'Compra', monto: 5_000_000, fecha: new Date(2027, 5, 1) }]
  });
  assert.strictEqual(c.cierreBase, c.cierreEscenario);
});

test('un monto en cero o negativo se ignora', () => {
  for (const monto of [0, -100_000]) {
    const c = G.compararEscenarios(entradas(), {
      ...vacio, movimientos: [{ concepto: 'Compra', monto, fecha: new Date(2026, 8, 1) }]
    });
    assert.strictEqual(c.cierreBase, c.cierreEscenario, `monto ${monto} no debería mover nada`);
  }
});

// --- Ventas -----------------------------------------------------------------

test('vender menos empeora el cierre; vender más lo mejora', () => {
  const base = entradas();
  const flojo = G.compararEscenarios(base, { ...vacio, ajusteVentasPct: -25 });
  const bueno = G.compararEscenarios(base, { ...vacio, ajusteVentasPct: 25 });

  assert.ok(flojo.cierreEscenario < flojo.cierreBase);
  assert.ok(bueno.cierreEscenario > bueno.cierreBase);
});

test('un 20% más de ventas puede sacar el quiebre del trimestre', () => {
  const c = G.compararEscenarios(entradas(), { ...vacio, ajusteVentasPct: 20 });
  assert.ok(c.quiebreBase, 'la base tiene quiebre');
  assert.ok(!c.quiebreEscenario || c.quiebreEscenario.semana > c.quiebreBase.semana,
    'vendiendo 20% más el quiebre tiene que desaparecer o correrse');
});

// --- La palanca del adelanto de dinero --------------------------------------

test('apagar el adelanto corre la plata y adelanta el quiebre', () => {
  // Con plazo de 14 días las dos primeras semanas se quedan sin ingreso.
  const c = G.compararEscenarios(entradas(), { ...vacio, lagDias: 14 });

  assert.ok(c.semanas[0].escenario < c.semanas[0].base,
    'la primera semana tiene que quedar peor sin el adelanto');
  assert.ok(c.quiebreEscenario.semana <= c.quiebreBase.semana);
});

test('apagar el adelanto devuelve su costo: deja de pagarse la comisión', () => {
  const base = entradas();
  const c = G.compararEscenarios(base, { ...vacio, lagDias: 14 });

  const cfgEscenario = G.aplicarEscenario(base, { ...vacio, lagDias: 14 }).cfg;
  assert.strictEqual(cfgEscenario.PCT_NETO_SOBRE_BRUTO,
    base.cfg.PCT_NETO_SOBRE_BRUTO + base.cfg.PCT_ADELANTO_DINERO,
    'sin adelanto entra un 3,2% más de cada venta');

  // En régimen entra más plata por semana: 70,5% en vez de 67,3%.
  const semanaPlena = c.escenario.filas.find((f) => f.ingresos > 0 && f.numero > 3);
  const misma = c.base.filas.find((f) => f.numero === semanaPlena.numero);
  assert.ok(semanaPlena.ingresos > misma.ingresos,
    'una semana en régimen tiene que cobrar más sin el adelanto');

  // Pero el cierre a 13 semanas queda peor, y no porque el negocio empeore:
  // las ventas de las últimas semanas se acreditan más allá del horizonte.
  // Eso no se disimula, se avisa.
  assert.ok(c.nota, 'estirar el plazo tiene que venir con la advertencia');
  assert.match(c.nota, /fuera del cuadro/);
  assert.match(c.nota, /no se pierde/);
});

test('la advertencia del horizonte solo aparece cuando el plazo se estira', () => {
  const base = entradas();
  assert.strictEqual(G.compararEscenarios(base, vacio).nota, '');
  assert.strictEqual(G.compararEscenarios(base, { ...vacio, ajusteVentasPct: -30 }).nota, '');
  assert.strictEqual(G.compararEscenarios(base, { ...vacio, lagDias: 1 }).nota, '');
  assert.ok(G.compararEscenarios(base, { ...vacio, lagDias: 7 }).nota);
});

test('acortar el plazo no regala el costo del adelanto', () => {
  const base = entradas({ LAG_ACREDITACION_DIAS: 14 });
  const cfg = G.aplicarEscenario(base, { ...vacio, lagDias: 7 }).cfg;
  assert.strictEqual(cfg.PCT_NETO_SOBRE_BRUTO, base.cfg.PCT_NETO_SOBRE_BRUTO,
    'cobrar antes no puede mejorar el neto: eso es justamente lo que se paga');
});

// --- Cómo se cuenta el corrimiento ------------------------------------------

test('el corrimiento del quiebre se explica en palabras', () => {
  const q = (semana) => ({ semana, desde: LUNES, hasta: LUNES, faltan: 1, dias: 1 });

  assert.match(G.corrimientoDelQuiebre(q(5), q(2)).texto, /se adelanta 3 semanas/);
  assert.match(G.corrimientoDelQuiebre(q(2), q(5)).texto, /se corre 3 semanas/);
  assert.match(G.corrimientoDelQuiebre(q(3), q(2)).texto, /se adelanta 1 semana\b/);
  assert.match(G.corrimientoDelQuiebre(q(3), q(3)).texto, /sigue en la semana 3/);
  assert.match(G.corrimientoDelQuiebre(null, q(4)).texto, /Aparece un quiebre/);
  assert.match(G.corrimientoDelQuiebre(q(4), null).texto, /Desaparece el quiebre/);
  assert.match(G.corrimientoDelQuiebre(null, null).texto, /Sigue sin haber quiebre/);
});

test('el signo del corrimiento distingue mejor de peor', () => {
  const q = (semana) => ({ semana, desde: LUNES, hasta: LUNES, faltan: 1, dias: 1 });
  assert.ok(G.corrimientoDelQuiebre(q(5), q(2)).semanas < 0, 'adelantarse es peor');
  assert.ok(G.corrimientoDelQuiebre(q(2), q(5)).semanas > 0, 'correrse es mejor');
  assert.ok(G.corrimientoDelQuiebre(q(4), null).semanas > 0, 'que desaparezca es lo mejor');
  assert.ok(G.corrimientoDelQuiebre(null, q(4)).semanas < 0, 'que aparezca es lo peor');
});

// --- Comparación semana a semana --------------------------------------------

test('la comparación cubre las 13 semanas y la diferencia cierra', () => {
  const c = G.compararEscenarios(entradas(), {
    ...vacio, movimientos: [{ concepto: 'Compra', monto: 800_000, fecha: new Date(2026, 8, 15) }]
  });

  assert.strictEqual(c.semanas.length, 13);
  c.semanas.forEach((s) => {
    assert.strictEqual(s.diferencia, s.escenario - s.base, `descuadre en la semana ${s.numero}`);
  });
});

test('se marca la semana que cambia de estado', () => {
  const c = G.compararEscenarios(entradas(), {
    ...vacio, movimientos: [{ concepto: 'Compra', monto: 3_000_000, fecha: new Date(2026, 7, 26) }]
  });
  const seRompe = c.semanas.find((s) => s.estadoBase !== 'ROJO' && s.estadoEscenario === 'ROJO');
  assert.ok(seRompe, 'con $3.000.000 extra tiene que romperse alguna semana nueva');
  assert.strictEqual(G.cambioDeEstado(seRompe), 'Se pone en rojo');
});

test('el resumen dice el cierre de los dos escenarios', () => {
  const c = G.compararEscenarios(entradas(), {
    ...vacio, movimientos: [{ concepto: 'Compra', monto: 1_000_000, fecha: new Date(2026, 8, 1) }]
  });
  const texto = G.resumenDeSimulacion(c);

  assert.ok(texto.includes(G.pesos(c.cierreBase)));
  assert.ok(texto.includes(G.pesos(c.cierreEscenario)));
  assert.match(texto, /Cierre a 13 semanas/);
});

// --- Los extras no ensucian el motor ----------------------------------------

test('un movimiento simulado se comporta como un vencimiento más', () => {
  const semanas = G.generarSemanas(LUNES, 13);
  const extras = G.extrasComoVencimientos(
    [{ concepto: 'Compra', monto: 500_000, fecha: new Date(2026, 8, 1) }], semanas);

  assert.strictEqual(extras.length, 1);
  assert.strictEqual(extras[0].id, 'SIM-1');
  assert.ok(extras[0].semana >= 0);
  assert.strictEqual(extras[0].categoria, 'MERCADERIA');
  assert.ok(extras[0].consecuencia, 'hasta lo simulado tiene que explicarse');
});

test('sin extras el motor no cambia en nada', () => {
  const base = entradas();
  const sin = G.proyectar(base);
  const conVacio = G.proyectar({ ...base, extras: [] });
  assert.deepStrictEqual(sin.filas.map((f) => f.saldoFinal), conVacio.filas.map((f) => f.saldoFinal));
});
