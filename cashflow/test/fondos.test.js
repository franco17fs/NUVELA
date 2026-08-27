/**
 * NUVELA · Cashflow — Tests de la distribución diaria en fondos (Etapa 6).
 * Correr con:  node --test "cashflow/test/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./cargar');

const G = cargar(['02_Esquema.gs', '01_Config.gs', '03_Semilla.gs', '05_Validacion.gs',
                  '06_Motor.gs', '08_Prioridad.gs', '11_Fondos.gs']);
const cfgSemilla = Object.fromEntries(G.CONFIG_SEMILLA.map((f) => [f[0], f[1]]));

const cfg = (extra = {}) => ({ ...cfgSemilla, ...extra });
const D = (dia) => new Date(2026, 8, dia);           // septiembre 2026
const BRUTO_DIA = 400_000;                            // 2.800.000 / 7

/** Serie de días con venta pareja. */
const serie = (n, bruto = BRUTO_DIA, compras = 0, desde = 1) =>
  Array.from({ length: n }, (_, i) => ({ fecha: D(desde + i), bruto, compras }));

const objetivo = (concepto, monto, dia, criticidad = 3) => ({
  id: concepto, obligacionId: concepto, concepto, acreedor: 'X',
  fecha: D(dia), monto, criticidad, consecuencia: 'pasa algo'
});

const estadoVacio = () => ({ fondoMercaderia: 0, fondoColchon: 0, fondoLibre: 0, reservas: {}, pagados: {} });

// --- Prioridad 1: la mercadería sale primero, siempre -----------------------

test('la reposición se descuenta antes que cualquier obligación', () => {
  const r = G.distribuirDia({ fecha: D(1), bruto: BRUTO_DIA, compras: 0 }, estadoVacio(),
                            [objetivo('Alquiler', 400_000, 10, 5)], cfg());

  assert.strictEqual(r.costoMercaderia, Math.round(BRUTO_DIA * 0.462));
  assert.strictEqual(r.margen, Math.round(r.neto - r.costoMercaderia));
  assert.ok(r.aObligaciones <= r.margen, 'no se puede separar más que el margen');
});

test('separar para obligaciones nunca deja el fondo de mercadería sin reposición', () => {
  // Una obligación enorme que vence mañana: aun así la reposición entra entera.
  const r = G.distribuirDia({ fecha: D(1), bruto: BRUTO_DIA, compras: 0 }, estadoVacio(),
                            [objetivo('Urgente', 50_000_000, 2, 5)], cfg());

  assert.strictEqual(r.aMercaderia, Math.round(BRUTO_DIA * 0.462));
  assert.strictEqual(r.estado.fondoMercaderia, BRUTO_DIA * 0.462);
  assert.strictEqual(r.libre, 0, 'con una obligación así no puede quedar nada libre');
});

test('el fondo de mercadería sube con las ventas y baja con las compras', () => {
  const { estado } = G.reproducirDias(serie(10, BRUTO_DIA, 100_000), [], cfg(), {});
  const reposicionTotal = 10 * BRUTO_DIA * 0.462;
  assert.ok(Math.abs(estado.fondoMercaderia - (reposicionTotal - 1_000_000)) < 1);
});

test('comprar más de lo que se repone deja el fondo en negativo, y eso se ve', () => {
  const { estado } = G.reproducirDias(serie(10, BRUTO_DIA, 300_000), [], cfg(), {});
  assert.ok(estado.fondoMercaderia < 0, 'comprando 300k/día contra 184.800 de reposición');

  const s = G.semaforo(estado, [], D(11), 100_000, cfg());
  assert.strictEqual(s.estado, 'ROJO');
  assert.match(s.porque, /fondo de mercadería/);
});

// --- Prioridad 2: obligaciones ---------------------------------------------

test('se separa el pendiente dividido los días que faltan', () => {
  const obj = [objetivo('Alquiler', 400_000, 11)];       // vence en 10 días
  const r = G.distribuirDia({ fecha: D(1), bruto: BRUTO_DIA, compras: 0 }, estadoVacio(), obj, cfg());
  assert.strictEqual(r.asignado['Alquiler'], 40_000);
});

test('con varias obligaciones, primero la que vence antes', () => {
  const obj = [objetivo('Lejana', 900_000, 30, 5), objetivo('Cercana', 200_000, 3, 1)];
  const orden = G.ordenarObjetivos(obj, {}, D(1));
  assert.deepStrictEqual([...orden.map((o) => o.concepto)], ['Cercana', 'Lejana']);
});

test('a igual fecha desempata la criticidad, y después lo más descubierto', () => {
  const a = objetivo('A', 100_000, 10, 5);
  const b = objetivo('B', 100_000, 10, 2);
  assert.deepStrictEqual([...G.ordenarObjetivos([b, a], {}, D(1)).map((o) => o.concepto)], ['A', 'B']);

  const c = objetivo('C', 100_000, 10, 3);
  const d = objetivo('D', 100_000, 10, 3);
  const orden = G.ordenarObjetivos([c, d], { C: 90_000, D: 10_000 }, D(1));
  assert.strictEqual(orden[0].concepto, 'D', 'primero la más descubierta');
});

test('al pasar el vencimiento la reserva se usa y el fondo se vacía', () => {
  const obj = [objetivo('Alquiler', 400_000, 5)];
  const conReserva = { ...estadoVacio(), reservas: { Alquiler: 400_000 } };
  const r = G.distribuirDia({ fecha: D(6), bruto: BRUTO_DIA, compras: 0 }, conReserva, obj, cfg());

  assert.strictEqual(r.liquidados.length, 1);
  assert.strictEqual(r.liquidados[0].origen.reserva, 400_000, 'se pagó con lo que se había juntado');
  assert.strictEqual(r.estado.reservas['Alquiler'], 0, 'el fondo queda vacío, no acumula para siempre');
  assert.strictEqual(r.estado.pagados['Alquiler'], true);
});

test('si la reserva no alcanzó, el faltante sale de libre, colchón y recién ahí mercadería', () => {
  const obj = [objetivo('Alquiler', 400_000, 5)];
  const estado = { ...estadoVacio(), reservas: { Alquiler: 100_000 },
                   fondoLibre: 150_000, fondoColchon: 100_000, fondoMercaderia: 500_000 };
  const r = G.distribuirDia({ fecha: D(6), bruto: 0, compras: 0 }, estado, obj, cfg());
  const o = r.liquidados[0].origen;

  assert.strictEqual(o.reserva, 100_000);
  assert.strictEqual(o.libre, 150_000, 'primero lo libre: es lo que menos duele');
  assert.strictEqual(o.colchon, 100_000, 'después el colchón');
  assert.strictEqual(o.mercaderia, 50_000, 'la mercadería es lo último');
  assert.strictEqual(o.reserva + o.libre + o.colchon + o.mercaderia, 400_000);
  assert.strictEqual(r.estado.fondoMercaderia, 450_000);
});

test('una obligación liquidada sale de los cuadros y deja de pedir plata', () => {
  const obj = [objetivo('Alquiler', 400_000, 5)];
  const conReserva = { ...estadoVacio(), reservas: { Alquiler: 400_000 } };
  const r = G.distribuirDia({ fecha: D(6), bruto: BRUTO_DIA, compras: 0 }, conReserva, obj, cfg());

  assert.strictEqual(G.estadoDeObjetivos(obj, r.estado, D(7)).length, 0);
  assert.strictEqual(G.reparto(r.estado, obj).obligaciones, 0);
  assert.strictEqual(G.riesgos(obj, r.estado, D(7), 100_000).length, 0);
});

test('el ciclo completo: juntar, liquidar y volver a empezar', () => {
  // Alquiler el 11 y el 21: el primero se liquida y el segundo arranca de cero.
  const obj = [objetivo('Alq1', 400_000, 11), objetivo('Alq2', 400_000, 21)];
  const { estado, dias } = G.reproducirDias(serie(25), obj, cfg(), {});

  assert.strictEqual(estado.pagados['Alq1'], true, 'el primero se liquidó al vencer');
  assert.strictEqual(estado.reservas['Alq1'], 0, 'y su fondo quedó vacío');
  assert.strictEqual(estado.pagados['Alq2'], true, 'el segundo también');

  const liquidados = dias.reduce((a, d) => a + d.liquidados.length, 0);
  assert.strictEqual(liquidados, 2, 'cada vencimiento se liquida una sola vez');
});

test('una obligación ya pagada deja de juntar plata', () => {
  const obj = [objetivo('Pagada', 400_000, 11)];
  const estado = { ...estadoVacio(), pagados: { Pagada: true } };
  const r = G.distribuirDia({ fecha: D(1), bruto: BRUTO_DIA, compras: 0 }, estado, obj, cfg());

  assert.strictEqual(r.aObligaciones, 0);
  assert.ok(r.libre > 0 || r.aColchon > 0, 'esa plata tiene que ir al colchón o a libre');
});

test('al llegar el vencimiento, la obligación está entera', () => {
  const obj = [objetivo('Alquiler', 400_000, 11)];
  const { estado } = G.reproducirDias(serie(10), obj, cfg(), {});
  assert.ok(Math.abs(estado.reservas['Alquiler'] - 400_000) < 1,
    `juntó ${estado.reservas['Alquiler']} de 400.000`);
});

// --- Regla 3 y 4: días buenos y días malos ----------------------------------

test('un día bueno adelanta reservas futuras, una vez cubierto el colchón', () => {
  const obj = [objetivo('Lejana', 500_000, 40)];
  const lleno = { ...estadoVacio(), fondoColchon: 300_000 };
  const r = G.distribuirDia({ fecha: D(1), bruto: 3_000_000, compras: 0 }, lleno, obj,
                            cfg({ COLCHON_MINIMO: 300_000 }));

  assert.ok(r.adelantado > 0, 'con una venta de $3.000.000 tiene que sobrar para adelantar');
  assert.ok(r.asignado['Lejana'] > 500_000 / 39, 'separó más que el promedio lineal');
  assert.strictEqual(r.asignado['Lejana'], 500_000, 'con ese margen lo cubre entero de una');
});

test('la escalera de prioridades se respeta en ese orden exacto', () => {
  // Mercadería → lo necesario de cada obligación → colchón → adelantos → libre.
  const obj = [objetivo('Lejana', 500_000, 40)];
  const c = cfg({ COLCHON_MINIMO: 300_000 });

  // La obligación vence en 39 días: su cuota del día es siempre la misma.
  const cuota = Math.round(500_000 / 39);

  // Margen chico: la obligación cobra su cuota entera igual, y el resto empieza el colchón.
  const justo = G.distribuirDia({ fecha: D(1), bruto: 100_000, compras: 0 }, estadoVacio(), obj, c);
  assert.strictEqual(Math.round(justo.asignado['Lejana']), cuota,
    'la cuota del día se paga antes que el colchón');
  assert.strictEqual(justo.adelantado, 0);
  assert.strictEqual(justo.libre, 0, 'con este margen no puede sobrar nada');

  // Margen mediano: la cuota es la misma y todo el resto va al colchón, sin adelantar.
  const medio = G.distribuirDia({ fecha: D(1), bruto: 1_000_000, compras: 0 }, estadoVacio(), obj, c);
  assert.strictEqual(Math.round(medio.asignado['Lejana']), cuota);
  assert.ok(medio.aColchon > justo.aColchon);
  assert.strictEqual(medio.adelantado, 0, 'no se adelanta con el colchón a medio llenar');
  assert.strictEqual(medio.libre, 0, 'ni queda plata libre');

  // Margen grande: llena el colchón y recién ahí adelanta.
  const grande = G.distribuirDia({ fecha: D(1), bruto: 3_000_000, compras: 0 }, estadoVacio(), obj, c);
  assert.strictEqual(grande.aColchon, 300_000, 'el colchón se completa');
  assert.ok(grande.adelantado > 0, 'y después se adelanta');

  // El colchón nunca se pasa del objetivo.
  const lleno = { ...estadoVacio(), fondoColchon: 300_000 };
  assert.strictEqual(G.distribuirDia({ fecha: D(1), bruto: 3_000_000, compras: 0 }, lleno, obj, c).aColchon, 0);
});

test('un día malo separa menos y el esfuerzo se recalcula solo', () => {
  const obj = [objetivo('Alquiler', 400_000, 11)];

  const malo = G.distribuirDia({ fecha: D(1), bruto: 50_000, compras: 0 }, estadoVacio(), obj, cfg());
  assert.ok(malo.asignado['Alquiler'] < 40_000, 'con ventas bajas separa menos');

  // Al día siguiente, el promedio necesario sube solo porque hay menos días.
  const despues = G.estadoDeObjetivos(obj, malo.estado, D(2))[0];
  assert.ok(despues.porDia > 40_000, `pasó a ${despues.porDia}, tiene que ser mayor a 40.000`);
  assert.strictEqual(despues.pendiente, 400_000 - Math.round(malo.asignado['Alquiler']));
});

test('varios días malos seguidos igual llegan si después hay días buenos', () => {
  const obj = [objetivo('Alquiler', 400_000, 21)];
  const dias = serie(5, 50_000).concat(serie(15, 900_000, 0, 6));
  const { estado } = G.reproducirDias(dias, obj, cfg(), {});
  assert.ok(Math.abs(estado.reservas['Alquiler'] - 400_000) < 1);
});

// --- Prioridad 3: el colchón y lo libre -------------------------------------

test('el colchón se llena después de las obligaciones y antes de liberar plata', () => {
  const r = G.distribuirDia({ fecha: D(1), bruto: 3_000_000, compras: 0 }, estadoVacio(), [],
                            cfg({ COLCHON_MINIMO: 500_000 }));
  assert.strictEqual(r.aColchon, 500_000);
  assert.ok(r.libre > 0);
});

test('con el colchón lleno, todo el excedente queda libre', () => {
  const estado = { ...estadoVacio(), fondoColchon: 500_000 };
  const r = G.distribuirDia({ fecha: D(1), bruto: 3_000_000, compras: 0 }, estado, [],
                            cfg({ COLCHON_MINIMO: 500_000 }));
  assert.strictEqual(r.aColchon, 0);
  assert.strictEqual(r.libre, r.margen);
});

test('la caja se parte en cuatro y las partes suman el total', () => {
  const obj = [objetivo('Alquiler', 400_000, 20)];
  const { estado } = G.reproducirDias(serie(15, 800_000), obj, cfg({ COLCHON_MINIMO: 500_000 }), {});
  const p = G.reparto(estado, obj);

  assert.strictEqual(p.total, p.mercaderia + p.obligaciones + p.colchon + p.libre);
  assert.ok(p.obligaciones > 0 && p.colchon > 0 && p.libre > 0);
});

test('lo reservado de más para una obligación no se cuenta como comprometido', () => {
  const obj = [objetivo('Chica', 100_000, 20)];
  const estado = { ...estadoVacio(), reservas: { Chica: 999_999 } };
  assert.strictEqual(G.reparto(estado, obj).obligaciones, 100_000);
});

// --- Idempotencia -----------------------------------------------------------

test('reproducir la historia dos veces da exactamente lo mismo', () => {
  const obj = [objetivo('Alquiler', 400_000, 20), objetivo('IVA', 300_000, 18)];
  const dias = serie(15, 700_000, 120_000);

  const a = G.reproducirDias(dias, obj, cfg(), {});
  const b = G.reproducirDias(dias, obj, cfg(), {});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.estado)), JSON.parse(JSON.stringify(b.estado)));
});

test('el orden en que se cargan los días no cambia el resultado', () => {
  const obj = [objetivo('Alquiler', 400_000, 20)];
  const dias = serie(10, 600_000);
  const desordenados = [dias[5], dias[0], dias[9], dias[2], dias[7], dias[1], dias[3], dias[8], dias[4], dias[6]];

  const a = G.reproducirDias(dias, obj, cfg(), {});
  const b = G.reproducirDias(desordenados, obj, cfg(), {});
  assert.strictEqual(Math.round(a.estado.reservas['Alquiler']), Math.round(b.estado.reservas['Alquiler']));
});

test('distribuirDia no modifica el estado que recibe', () => {
  const estado = estadoVacio();
  const antes = JSON.stringify(estado);
  G.distribuirDia({ fecha: D(1), bruto: 900_000, compras: 0 }, estado,
                  [objetivo('A', 300_000, 10)], cfg());
  assert.strictEqual(JSON.stringify(estado), antes);
});

// --- Nada se pierde ---------------------------------------------------------

test('cada peso del margen tiene destino: obligaciones, colchón o libre', () => {
  for (const bruto of [50_000, 400_000, 900_000, 3_000_000]) {
    const r = G.distribuirDia({ fecha: D(1), bruto, compras: 0 }, estadoVacio(),
                              [objetivo('A', 400_000, 15), objetivo('B', 200_000, 25)],
                              cfg({ COLCHON_MINIMO: 300_000 }));
    const repartido = r.aObligaciones + r.aColchon + r.libre;
    assert.ok(Math.abs(repartido - Math.max(0, r.margen)) <= 2,
      `bruto ${bruto}: margen ${r.margen} vs repartido ${repartido}`);
  }
});

test('con margen negativo no se separa nada ni queda plata libre', () => {
  const r = G.distribuirDia({ fecha: D(1), bruto: 100, compras: 0 }, estadoVacio(),
                            [objetivo('A', 400_000, 15)], cfg({ PCT_NETO_SOBRE_BRUTO: 20 }));
  assert.ok(r.margen < 0);
  assert.strictEqual(r.aObligaciones, 0);
  assert.strictEqual(r.libre, 0);
});

// --- Regla 5: riesgo --------------------------------------------------------

test('avisa cuando al ritmo actual no se llega a un vencimiento', () => {
  const obj = [objetivo('Grande', 5_000_000, 11)];
  const { estado, dias } = G.reproducirDias(serie(3), obj, cfg(), {});
  const margen = G.margenDiarioPromedio(dias);

  const r = G.riesgos(obj, estado, D(4), margen);
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].necesarioPorDia > r[0].disponiblePorDia);
  assert.strictEqual(r[0].faltantePorDia, Math.round(r[0].necesarioPorDia - r[0].disponiblePorDia));
});

test('una obligación cubierta no genera alerta', () => {
  const obj = [objetivo('Cubierta', 100_000, 20)];
  const estado = { ...estadoVacio(), reservas: { Cubierta: 100_000 } };
  assert.strictEqual(G.riesgos(obj, estado, D(1), 200_000).length, 0);
});

test('la que vence antes se come el margen primero', () => {
  // Dos obligaciones que juntas no entran: la segunda tiene que quedar en riesgo.
  const obj = [objetivo('Primera', 1_000_000, 11), objetivo('Segunda', 1_000_000, 12)];
  const r = G.riesgos(obj, estadoVacio(), D(1), 120_000);
  assert.ok(r.some((x) => x.concepto === 'Segunda'), 'la segunda no debería llegar');
});

test('cada alerta viene con propuestas concretas, no con un lamento', () => {
  const obj = [objetivo('Grande', 5_000_000, 11)];
  const estado = { ...estadoVacio(), fondoLibre: 200_000, fondoColchon: 300_000 };
  const r = G.riesgos(obj, estado, D(1), 100_000);
  const p = G.propuestasParaRiesgo(r[0], estado, cfg(), 100_000);

  assert.ok(p.length >= 3);
  assert.ok(p.some((x) => /fondo libre/.test(x)));
  assert.ok(p.some((x) => /más por día/.test(x)));
  assert.ok(p.some((x) => /colchón/i.test(x)), 'tocar el colchón tiene que estar, y último');
  assert.match(p[p.length - 1], /colchón/i);
});

// --- Semáforo ---------------------------------------------------------------

test('verde cuando todo está cubierto', () => {
  const obj = [objetivo('A', 100_000, 30)];
  const estado = { ...estadoVacio(), fondoMercaderia: 1_000_000, fondoColchon: 500_000,
                   reservas: { A: 100_000 } };
  const s = G.semaforo(estado, obj, D(1), 500_000, cfg({ COLCHON_MINIMO: 500_000 }));
  assert.strictEqual(s.estado, 'VERDE');
});

test('amarillo cuando se llega pero justo', () => {
  const obj = [objetivo('A', 900_000, 11)];       // 100.000/día
  const estado = { ...estadoVacio(), fondoMercaderia: 500_000, fondoColchon: 500_000 };
  const s = G.semaforo(estado, obj, D(2), 110_000, cfg({ COLCHON_MINIMO: 500_000 }));
  assert.strictEqual(s.estado, 'AMARILLO');
  assert.match(s.porque, /% del margen diario/);
});

test('amarillo si el colchón está corto aunque las obligaciones estén al día', () => {
  const estado = { ...estadoVacio(), fondoMercaderia: 500_000, fondoColchon: 100_000 };
  const s = G.semaforo(estado, [], D(1), 500_000, cfg({ COLCHON_MINIMO: 500_000 }));
  assert.strictEqual(s.estado, 'AMARILLO');
  assert.match(s.porque, /colchón/);
});

test('rojo cuando una obligación venció sin estar cubierta', () => {
  const obj = [objetivo('Vencida', 400_000, 1)];
  const estado = { ...estadoVacio(), fondoMercaderia: 500_000, fondoColchon: 500_000 };
  const s = G.semaforo(estado, obj, D(10), 5_000_000, cfg({ COLCHON_MINIMO: 500_000 }));
  assert.strictEqual(s.estado, 'ROJO');
  assert.match(s.porque, /venció/);
});

test('cada estado del semáforo explica por qué', () => {
  for (const caso of [
    { estado: { ...estadoVacio(), fondoMercaderia: -1 }, obj: [] },
    { estado: { ...estadoVacio(), fondoColchon: 0 }, obj: [] },
    { estado: { ...estadoVacio(), fondoColchon: 500_000 }, obj: [] }
  ]) {
    const s = G.semaforo(caso.estado, caso.obj, D(1), 300_000, cfg({ COLCHON_MINIMO: 500_000 }));
    assert.ok(s.porque && s.porque.length > 30, `${s.estado} sin explicación`);
  }
});

// --- Colchón ----------------------------------------------------------------

test('el colchón sugerido cubre los días de operación configurados', () => {
  const c = cfg({ VENTA_BRUTA_SEMANAL_BASE: 2_800_000, DIAS_COLCHON: 5 });
  const porDia = 50_000;
  const sugerido = G.colchonSugerido(c, porDia);
  const diario = 400_000 * 0.462 + 400_000 * 0.043 + porDia;

  assert.strictEqual(sugerido, Math.round(diario * 5));
  assert.ok(sugerido > 1_200_000, 'con los números de NUVELA tiene que dar más de un millón');
});

test('más días de cobertura, colchón más grande, y proporcional', () => {
  const cinco = G.colchonSugerido(cfg({ DIAS_COLCHON: 5 }), 50_000);
  const diez = G.colchonSugerido(cfg({ DIAS_COLCHON: 10 }), 50_000);
  assert.strictEqual(diez, cinco * 2);
});

// --- Criterio ---------------------------------------------------------------

test('avisa cuando se compra más rápido de lo que se vende', () => {
  const dias = serie(14, BRUTO_DIA, 300_000);
  const { estado, dias: detalle } = G.reproducirDias(dias, [], cfg(), {});
  const obs = G.diagnostico(estado, [], detalle, cfg(), D(15));
  assert.ok(obs.some((o) => o.tipo === 'COMPRAS' && /más rápido de lo que vendés/.test(o.texto)));
});

test('avisa cuando se compra de menos', () => {
  const dias = serie(14, BRUTO_DIA, 50_000);
  const { estado, dias: detalle } = G.reproducirDias(dias, [], cfg(), {});
  const obs = G.diagnostico(estado, [], detalle, cfg(), D(15));
  assert.ok(obs.some((o) => o.tipo === 'COMPRAS' && /se va a notar en las ventas/.test(o.texto)));
});

test('avisa cuando hay plata quieta en el fondo de mercadería', () => {
  const dias = serie(30, BRUTO_DIA, 0);
  const { estado, dias: detalle } = G.reproducirDias(dias, [], cfg(), {});
  const obs = G.diagnostico(estado, [], detalle, cfg(), D(31));
  assert.ok(obs.some((o) => o.tipo === 'CAJA' && /plata quieta/.test(o.texto)));
});

test('avisa cuando la plata libre es realmente retirable', () => {
  const obj = [objetivo('A', 100_000, 20)];
  const dias = serie(20, 900_000, 300_000);
  const { estado, dias: detalle } = G.reproducirDias(dias, obj, cfg({ COLCHON_MINIMO: 200_000 }), {});
  const obs = G.diagnostico(estado, obj, detalle, cfg({ COLCHON_MINIMO: 200_000 }), D(21));
  assert.ok(obs.some((o) => o.tipo === 'LIBRE' && /se puede retirar/.test(o.texto)));
});

test('avisa cuando el colchón está a menos de la mitad', () => {
  const { estado, dias } = G.reproducirDias(serie(3, 100_000), [], cfg({ COLCHON_MINIMO: 1_000_000 }), {});
  const obs = G.diagnostico(estado, [], dias, cfg({ COLCHON_MINIMO: 1_000_000 }), D(4));
  assert.ok(obs.some((o) => o.tipo === 'COLCHON'));
});
