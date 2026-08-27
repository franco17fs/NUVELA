/**
 * NUVELA · Cashflow — Tests de priorización y alertas (Etapa 3).
 * Correr con:  node --test "cashflow/test/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./cargar');

const G = cargar(['02_Esquema.gs', '01_Config.gs', '03_Semilla.gs', '05_Validacion.gs',
                  '06_Motor.gs', '08_Prioridad.gs', '09_EstaSemana.gs']);
const cfgSemilla = Object.fromEntries(G.CONFIG_SEMILLA.map((f) => [f[0], f[1]]));

const LUNES = new Date(2026, 7, 24);
const cfg = (extra = {}) => ({ ...cfgSemilla, SALDO_MERCADO_PAGO: 0, SALDO_EFECTIVO: 0, ...extra });

/** Vencimiento de mentira, para probar el orden sin depender de la semilla. */
const v = (concepto, monto, criticidad, dia = 1) => ({
  id: concepto, concepto, acreedor: 'X', categoria: 'OTROS',
  criticidad, monto, fecha: new Date(2026, 7, 24 + dia),
  consecuencia: 'algo pasa', cuenta: 'MERCADO_PAGO', semana: 0
});

// --- Orden ------------------------------------------------------------------

test('la criticidad manda sobre todo lo demás', () => {
  const orden = G.ordenarPorPrioridad([v('barato', 1_000, 1), v('caro', 900_000, 5)]);
  assert.deepStrictEqual([...orden.map((x) => x.concepto)], ['caro', 'barato']);
});

test('a igual criticidad, primero lo que vence antes', () => {
  const orden = G.ordenarPorPrioridad([v('jueves', 100, 3, 4), v('martes', 100, 3, 2)]);
  assert.deepStrictEqual([...orden.map((x) => x.concepto)], ['martes', 'jueves']);
});

test('a igual criticidad y fecha, primero lo más barato', () => {
  const orden = G.ordenarPorPrioridad([v('grande', 500_000, 3, 1), v('chico', 50_000, 3, 1)]);
  assert.deepStrictEqual([...orden.map((x) => x.concepto)], ['chico', 'grande']);
});

test('ordenar no modifica la lista original', () => {
  const lista = [v('a', 100, 1), v('b', 100, 5)];
  const copia = lista.slice();
  G.ordenarPorPrioridad(lista);
  assert.deepStrictEqual(lista.map((x) => x.concepto), copia.map((x) => x.concepto));
});

// --- Plan de pago -----------------------------------------------------------

test('si alcanza para todo, no queda nada afuera', () => {
  const plan = G.planDePago([v('a', 100_000, 5), v('b', 200_000, 3)], 1_000_000);
  assert.ok(plan.alcanza);
  assert.strictEqual(plan.sinPagar.length, 0);
  assert.strictEqual(plan.faltante, 0);
  assert.strictEqual(plan.sobrante, 700_000);
});

test('cuando no alcanza, se paga por criticidad y el resto queda a la vista', () => {
  const plan = G.planDePago([
    v('factura ML', 550_000, 5),
    v('moto', 120_000, 5),
    v('contadora', 130_000, 2)
  ], 700_000);

  assert.ok(!plan.alcanza);
  assert.deepStrictEqual([...plan.pagados.map((x) => x.concepto)], ['moto', 'factura ML']);
  assert.deepStrictEqual([...plan.sinPagar.map((x) => x.concepto)], ['contadora']);
  assert.strictEqual(plan.faltante, 130_000);
});

test('un vencimiento grande que no entra no bloquea a los chicos que siguen', () => {
  // Con $200.000: el grande de criticidad 5 no entra, pero los dos chicos sí.
  const plan = G.planDePago([
    v('grande', 900_000, 5),
    v('chico1', 100_000, 4),
    v('chico2', 90_000, 4)
  ], 200_000);

  assert.deepStrictEqual([...plan.pagados.map((x) => x.concepto)], ['chico2', 'chico1']);
  assert.deepStrictEqual([...plan.sinPagar.map((x) => x.concepto)], ['grande']);
  assert.strictEqual(plan.sobrante, 10_000);
});

test('sin plata no se paga nada y el faltante es todo lo comprometido', () => {
  const plan = G.planDePago([v('a', 100_000, 5), v('b', 50_000, 3)], 0);
  assert.strictEqual(plan.pagados.length, 0);
  assert.strictEqual(plan.faltante, 150_000);
  assert.strictEqual(plan.comprometido, 150_000);
  assert.strictEqual(plan.sobrante, 0);
});

test('con la plata justa alcanza, sin sobrar ni faltar', () => {
  const plan = G.planDePago([v('a', 100_000, 5), v('b', 50_000, 3)], 150_000);
  assert.ok(plan.alcanza);
  assert.strictEqual(plan.sobrante, 0);
});

test('una semana sin vencimientos no rompe nada', () => {
  const plan = G.planDePago([], 500_000);
  assert.ok(plan.alcanza);
  assert.strictEqual(plan.comprometido, 0);
  assert.strictEqual(plan.sobrante, 500_000);
});

test('el plan no pierde ni duplica vencimientos', () => {
  const lista = [v('a', 100, 5), v('b', 200, 4), v('c', 300, 3), v('d', 400, 2)];
  const plan = G.planDePago(lista, 350);

  assert.strictEqual(plan.pagados.length + plan.sinPagar.length, lista.length);
  const suma = (l) => l.reduce((a, x) => a + x.monto, 0);
  assert.strictEqual(suma(plan.pagados) + suma(plan.sinPagar), suma(lista));
  assert.strictEqual(plan.comprometido, suma(lista));
});

test('nunca se gasta más de lo disponible', () => {
  for (const disponible of [0, 1, 99_999, 150_000, 700_000, 5_000_000]) {
    const plan = G.planDePago([v('a', 550_000, 5), v('b', 120_000, 5), v('c', 130_000, 2)], disponible);
    const gastado = plan.pagados.reduce((a, x) => a + x.monto, 0);
    assert.ok(gastado <= disponible, `gastó ${gastado} con ${disponible} disponibles`);
    assert.strictEqual(plan.sobrante, disponible - gastado);
  }
});

// --- Consecuencias ----------------------------------------------------------

test('lo que queda sin pagar viaja con su consecuencia escrita', () => {
  const plan = G.planDePago([v('factura ML', 550_000, 5), v('contadora', 130_000, 2)], 550_000);
  const consecuencias = G.consecuenciasDe(plan);

  assert.strictEqual(consecuencias.length, 1);
  assert.strictEqual(consecuencias[0].concepto, 'contadora');
  assert.ok(consecuencias[0].consecuencia, 'sin el texto no hay trade-off que mostrar');
});

test('cada obligación activa de la semilla tiene una consecuencia que mostrar', () => {
  const semanas = G.generarSemanas(LUNES, 13);
  const venc = G.expandirObligaciones(G.OBLIGACIONES_SEMILLA, semanas,
                                      new Array(13).fill(2_800_000), cfg(), LUNES);
  for (const x of venc) {
    assert.ok(String(x.consecuencia).trim().length > 20,
      `${x.concepto} no explica qué pasa si no se paga`);
  }
});

// --- Integración con la proyección ------------------------------------------

const conSemilla = (extra = {}, brutoSemanal = 2_800_000, pagados = {}, semana = 0) => {
  const semanas = G.generarSemanas(LUNES, 13);
  const brutos = new Array(13).fill(brutoSemanal);
  const r = G.proyectar({ semanas, brutoPorSemana: brutos,
                          obligaciones: G.OBLIGACIONES_SEMILLA, cfg: cfg(extra), hoy: LUNES, pagados });
  const f = r.filas[semana];
  r.plan = G.planDePago(f.vencimientos, f.saldoInicial + f.ingresos);
  return r;
};

/** La semana con más plata comprometida: es donde se ve si la priorización sirve. */
const semanaMasPesada = (r) => r.filas.reduce(
  (peor, f, i) => (f.vencimientos.reduce((a, v) => a + v.monto, 0) >
                   r.filas[peor].vencimientos.reduce((a, v) => a + v.monto, 0) ? i : peor), 0);

test('en una semana normal la plata alcanza', () => {
  const r = conSemilla();
  assert.ok(r.plan.alcanza, 'con ventas normales la semana 1 debería cerrar');
});

test('la semana pesada del mes junta factura de ML, alquiler y moto', () => {
  const r = conSemilla();
  const i = semanaMasPesada(r);
  const ids = r.filas[i].vencimientos.map((v) => v.id);
  assert.ok(ids.includes('OBL-002'), 'la factura de ML');
  assert.ok(ids.includes('OBL-001'), 'el alquiler');
  assert.ok(ids.includes('OBL-003'), 'la moto');
});

test('cuando no alcanza, lo primero de la lista es lo que corta el ingreso', () => {
  const r = conSemilla({}, 900_000);
  const i = semanaMasPesada(r);
  const f = r.filas[i];
  const plan = G.planDePago(f.vencimientos, Math.max(0, f.saldoInicial + f.ingresos));

  assert.ok(!plan.alcanza, 'con ventas de $900.000 la semana pesada no puede cerrar');
  assert.strictEqual(plan.orden[0].criticidad, 5, 'lo primero tiene que ser criticidad 5');
  assert.ok(plan.sinPagar.length > 0);
  // Lo que queda afuera nunca puede ser más crítico que lo que entró.
  const minPagado = Math.min.apply(null, plan.pagados.map((x) => x.criticidad).concat([9]));
  const maxAfuera = Math.max.apply(null, plan.sinPagar.map((x) => x.criticidad).concat([0]));
  assert.ok(maxAfuera <= minPagado || plan.pagados.length === 0,
    'quedó afuera algo más crítico que algo que se pagó');
});

test('marcar un pago lo saca del plan y lo deja visible como hecho', () => {
  const sinMarcar = conSemilla();
  const idMoto = 'OBL-003';
  assert.ok(sinMarcar.plan.orden.some((x) => x.id === idMoto));

  const marcado = conSemilla({}, 2_800_000, { [idMoto + '|0']: true });
  assert.ok(!marcado.plan.orden.some((x) => x.id === idMoto), 'ya pagado: fuera del plan');
  assert.ok(marcado.filas[0].yaPagados.some((x) => x.id === idMoto), 'pero visible como PAGADO');
  assert.ok(marcado.plan.comprometido < sinMarcar.plan.comprometido);
});

// --- Resumen y aviso --------------------------------------------------------

test('el resumen contesta las tres preguntas de la pantalla de inicio', () => {
  const r = conSemilla({ SALDO_MERCADO_PAGO: 800_000 });
  const s = G.resumenSemanal(r.filas[0], r.plan);

  assert.strictEqual(s.tenesHoy, 800_000);
  assert.strictEqual(s.vaAEntrar, r.filas[0].ingresos);
  assert.strictEqual(s.tenesQuePagar, r.plan.comprometido);
  assert.strictEqual(s.disponible, s.tenesHoy + s.vaAEntrar);
});

test('cuando falta plata el aviso dice cuánto y qué queda sin pagar', () => {
  const r = conSemilla({}, 900_000);
  const f = r.filas[semanaMasPesada(r)];
  r.plan = G.planDePago(f.vencimientos, Math.max(0, f.saldoInicial + f.ingresos));
  const texto = G.textoDelAviso(G.resumenSemanal(f, r.plan), r.plan, r.quiebre);

  assert.match(texto, /TE FALTAN/);
  assert.match(texto, /entra todo menos/);
  // El aviso tiene que decir el déficit de caja, no la suma de lo que queda afuera:
  // son números distintos y el que sirve para salir a conseguir plata es el déficit.
  assert.ok(texto.includes(G.pesos(r.plan.deficit)),
    `el aviso debería mostrar el déficit ${G.pesos(r.plan.deficit)}`);
  for (const x of r.plan.sinPagar) {
    assert.ok(texto.includes(x.concepto), `el aviso no menciona ${x.concepto}`);
    assert.ok(texto.includes(x.consecuencia), `el aviso no dice qué pasa con ${x.concepto}`);
  }
});

test('cuando alcanza, el aviso lo dice y no inventa faltantes', () => {
  const r = conSemilla({ SALDO_MERCADO_PAGO: 10_000_000 });
  const texto = G.textoDelAviso(G.resumenSemanal(r.filas[0], r.plan), r.plan, r.quiebre);

  assert.match(texto, /ALCANZA/);
  assert.ok(!texto.includes('TE FALTAN'));
  assert.ok(!texto.includes('entra todo menos'));
});

test('déficit y faltante son cosas distintas y no se confunden', () => {
  // Faltan $50.000 para una compra de $1.000.000: el déficit es $50.000,
  // pero lo que queda entero sin pagar es $1.000.000.
  const plan = G.planDePago([v('chico', 200_000, 5), v('compra', 1_000_000, 4)], 1_150_000);

  assert.strictEqual(plan.deficit, 50_000, 'lo que hay que conseguir para pagar todo');
  assert.strictEqual(plan.faltante, 1_000_000, 'lo que queda entero sin pagar');
  assert.deepStrictEqual([...plan.sinPagar.map((x) => x.concepto)], ['compra']);
});

test('si alcanza, el déficit es cero', () => {
  const plan = G.planDePago([v('a', 100_000, 5)], 500_000);
  assert.strictEqual(plan.deficit, 0);
  assert.strictEqual(plan.faltante, 0);
});

test('el déficit siempre es comprometido menos disponible, nunca negativo', () => {
  for (const disponible of [0, 250_000, 700_000, 9_000_000]) {
    const plan = G.planDePago([v('a', 550_000, 5), v('b', 120_000, 5)], disponible);
    assert.strictEqual(plan.deficit, Math.max(0, plan.comprometido - disponible));
  }
});

test('el aviso avisa del quiebre aunque esta semana alcance', () => {
  const r = conSemilla({}, 500_000);
  const texto = G.textoDelAviso(G.resumenSemanal(r.filas[0], r.plan), r.plan, r.quiebre);
  if (r.quiebre && r.quiebre.semana > 1) {
    assert.match(texto, /Primer quiebre/);
    assert.ok(texto.includes(String(r.quiebre.dias)), 'tiene que decir cuántos días de aviso hay');
  }
});

// --- Deuda viva -------------------------------------------------------------

test('la deuda viva se ordena por cuál termina antes y dice cuánto libera', () => {
  const lista = G.liberacionDeFlujo(G.DEUDAS_SEMILLA);
  assert.strictEqual(lista.length, 3);

  for (let i = 1; i < lista.length; i++) {
    assert.ok(lista[i].cuotas >= lista[i - 1].cuotas, 'debería ir de la que termina antes a la que termina después');
  }
  const auto = lista.find((d) => /galicia/i.test(d.acreedor));
  assert.strictEqual(auto.libera, 400_000, 'el auto libera $400.000/mes cuando termine');
  assert.strictEqual(auto.cuotas, 9);
});

test('una deuda desactivada no aparece', () => {
  const desactivada = G.DEUDAS_SEMILLA.map((d) => {
    const copia = d.slice();
    copia[G.COL_DEU.ACTIVO] = 'NO';
    return copia;
  });
  assert.strictEqual(G.liberacionDeFlujo(desactivada).length, 0);
});
