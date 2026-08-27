/**
 * NUVELA · Cashflow — Tests de la Etapa 1.
 * Correr con:  node --test cashflow/test/
 *
 * Lo que se prueba acá es lo que después sostiene la proyección:
 * que la semilla esté completa y consistente, que las fechas se generen bien,
 * y que las constantes del modelo sigan reconciliando con junio 2026.
 */
const test = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./cargar');

const G = cargar();

// --- Datos reales de junio 2026 (informe de rentabilidad NUVELA) ------------
const JUNIO = {
  bruto: 10_980_981,
  neto: 7_385_927,
  costoProducto: 5_073_318,
  flex: 650_500,
  ads: 240_947,
  gananciaPreAds: 1_662_109,
  gananciaFinal: 1_421_162
};

const cfg = Object.fromEntries(G.CONFIG_SEMILLA.map((f) => [f[0], f[1]]));

test('las constantes del modelo reconcilian con junio 2026', () => {
  const neto = JUNIO.bruto * cfg.PCT_NETO_SOBRE_BRUTO / 100;
  assert.ok(Math.abs(neto - JUNIO.neto) < 30_000,
    `neto proyectado ${Math.round(neto)} vs real ${JUNIO.neto}`);

  const mercaderia = JUNIO.bruto * cfg.PCT_COSTO_MERCADERIA / 100;
  assert.ok(Math.abs(mercaderia - JUNIO.costoProducto) < 30_000,
    `mercadería proyectada ${Math.round(mercaderia)} vs real ${JUNIO.costoProducto}`);

  // La cadena tiene que reproducir la ganancia del informe. Se usa el Flex real
  // de junio y no el porcentaje de Config: la moto se renegoció y hoy corre más
  // barata, así que el ratio vigente ya no describe junio.
  const gananciaPreAds = neto - mercaderia - JUNIO.flex;
  assert.ok(Math.abs(gananciaPreAds - JUNIO.gananciaPreAds) < 60_000,
    `ganancia pre-ads ${Math.round(gananciaPreAds)} vs real ${JUNIO.gananciaPreAds}`);
});

test('la motomensajería está calibrada al nivel declarado hoy', () => {
  // Franco: ~$120.000 por semana, y sube o baja según las ventas de la semana.
  const semanal = cfg.VENTA_BRUTA_SEMANAL_BASE * cfg.PCT_MOTOMENSAJERIA / 100;
  assert.ok(Math.abs(semanal - 120_000) < 2_000,
    `${Math.round(semanal)}/semana con el % de Config, se declaró ~$120.000`);

  // Junio corrió al 5,9%: el ratio bajó, no se perdió el dato.
  assert.ok(cfg.PCT_MOTOMENSAJERIA < JUNIO.flex / JUNIO.bruto * 100,
    'el ratio vigente debería ser menor que el de junio');
});

test('la venta semanal de referencia coincide con el promedio real', () => {
  // $46.694.168 facturados entre el 01/05 y el 26/08/2026 = 117 días.
  const promedioSemanal = 46_694_168 / (117 / 7);
  assert.ok(Math.abs(cfg.VENTA_BRUTA_SEMANAL_BASE - promedioSemanal) < 50_000,
    `base ${cfg.VENTA_BRUTA_SEMANAL_BASE} vs promedio real ${Math.round(promedioSemanal)}`);
});

test('toda la semilla de Config tiene clave, unidad, descripción y origen', () => {
  const origenes = ['MEDIDO', 'DECLARADO', 'ESTIMADO', 'CONFIRMAR'];
  for (const [clave, valor, unidad, desc, origen] of G.CONFIG_SEMILLA) {
    assert.ok(clave, 'hay una fila de Config sin clave');
    assert.notStrictEqual(valor, undefined, `${clave}: sin valor`);
    assert.ok(unidad, `${clave}: sin unidad`);
    assert.ok(desc && desc.length > 20, `${clave}: la descripción no explica nada`);
    assert.ok(origenes.includes(origen), `${clave}: origen inválido (${origen})`);
  }
});

test('la semilla de obligaciones respeta el esquema', () => {
  const cols = G.ESQUEMA.OBLIGACIONES.columnas.length;
  for (const fila of G.OBLIGACIONES_SEMILLA) {
    assert.strictEqual(fila.length, cols,
      `${fila[0]}: tiene ${fila.length} columnas y el esquema pide ${cols}`);
  }
});

test('la semilla de obligaciones pasa la validación tal como se entrega', () => {
  // Sale de fábrica con OBL-011 sin fecha (hay que confirmarla con Mercado Pago)
  // y aun así tiene que poder proyectar: si no, el sistema no arranca nunca.
  const problemas = G.validarObligaciones(G.OBLIGACIONES_SEMILLA);
  assert.deepStrictEqual([...problemas], [], problemas.join('\n'));
});

test('una fecha única sin confirmar avisa, pero no bloquea', () => {
  const filas = G.OBLIGACIONES_SEMILLA.map((f) => f.slice());
  const unica = filas.find((f) => f[G.COL_OBL.PERIODICIDAD] === 'UNICA');

  unica[G.COL_OBL.VENCIMIENTO] = '';
  assert.deepStrictEqual([...G.validarObligaciones(filas)], [], 'sin fecha no puede ser un error');

  const avisos = G.avisosDeObligaciones(filas);
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].id, 'OBL-011');
  assert.strictEqual(avisos[0].monto, 900_000, 'la plata tiene que seguir a la vista');

  // Una fecha basura sí es un error: se escribió algo y está mal.
  unica[G.COL_OBL.VENCIMIENTO] = 'el mes que viene';
  assert.match(G.validarObligaciones(filas).join(' '), /tiene que ser una fecha/);
});

test('con la fecha puesta deja de avisar', () => {
  const filas = G.OBLIGACIONES_SEMILLA.map((f) => f.slice());
  filas.find((f) => f[G.COL_OBL.PERIODICIDAD] === 'UNICA')[G.COL_OBL.VENCIMIENTO] = new Date(2026, 8, 30);
  assert.strictEqual(G.avisosDeObligaciones(filas).length, 0);
});

test('una obligación desactivada sin fecha no avisa: ya se sabe que no cuenta', () => {
  const filas = G.OBLIGACIONES_SEMILLA.map((f) => f.slice());
  const unica = filas.find((f) => f[G.COL_OBL.PERIODICIDAD] === 'UNICA');
  unica[G.COL_OBL.ACTIVO] = 'NO';
  assert.strictEqual(G.avisosDeObligaciones(filas).length, 0);
});

test('la validación agarra los errores que rompen la proyección', () => {
  const base = G.OBLIGACIONES_SEMILLA[0].slice();

  const sinConsecuencia = base.slice();
  sinConsecuencia[G.COL_OBL.ID] = 'OBL-999';
  sinConsecuencia[G.COL_OBL.CONSECUENCIA] = '';
  assert.match(G.validarObligaciones([sinConsecuencia]).join(' '), /Consecuencia_Atraso/);

  const semanalConDiaDelMes = base.slice();
  semanalConDiaDelMes[G.COL_OBL.ID] = 'OBL-998';
  semanalConDiaDelMes[G.COL_OBL.PERIODICIDAD] = 'SEMANAL';
  semanalConDiaDelMes[G.COL_OBL.VENCIMIENTO] = 10;
  assert.match(G.validarObligaciones([semanalConDiaDelMes]).join(' '), /SEMANAL/);

  const dia31 = base.slice();
  dia31[G.COL_OBL.ID] = 'OBL-997';
  dia31[G.COL_OBL.VENCIMIENTO] = 31;
  assert.match(G.validarObligaciones([dia31]).join(' '), /día del mes/);

  const pctAbsurdo = base.slice();
  pctAbsurdo[G.COL_OBL.ID] = 'OBL-996';
  pctAbsurdo[G.COL_OBL.TIPO_MONTO] = 'PCT_VENTAS';
  pctAbsurdo[G.COL_OBL.MONTO] = 400000;
  assert.match(G.validarObligaciones([pctAbsurdo]).join(' '), /porcentaje/);

  const duplicado = base.slice();
  assert.match(G.validarObligaciones([base, duplicado]).join(' '), /repetido/);
});

test('una obligación desactivada e incompleta no genera ruido', () => {
  const ads = G.OBLIGACIONES_SEMILLA.find((f) => f[G.COL_OBL.ID] === 'OBL-012');
  assert.strictEqual(ads[G.COL_OBL.ACTIVO], 'NO', 'OBL-012 debe estar desactivada: Ads ya viene en la factura de ML');
  assert.deepStrictEqual([...G.validarObligaciones([ads])], []);
});

test('no hay doble conteo entre obligaciones y deudas', () => {
  const activas = G.OBLIGACIONES_SEMILLA.filter((f) => f[G.COL_OBL.ACTIVO] === 'SI');

  // La cuota del auto sale del retiro de Elian: no puede existir como obligación propia.
  assert.ok(!activas.some((f) => /auto|galicia/i.test(String(f[2]))),
    'la cuota del auto no va como obligación: se paga del retiro (OBL-009)');

  // Ads está dentro de la factura de ML.
  assert.ok(!activas.some((f) => f[G.COL_OBL.CATEGORIA] === 'PUBLICIDAD'),
    'Ads no va aparte: ya está dentro del saldo de la factura de ML (OBL-002)');

  // El saldo de ML es el adeudado, no el total facturado (~$4.400.000).
  const ml = activas.find((f) => f[G.COL_OBL.ID] === 'OBL-002');
  assert.ok(ml[G.COL_OBL.MONTO] < 1_000_000,
    'OBL-002 es el saldo a pagar, no el total facturado del ciclo');
});

test('lunesDeLaSemana cae siempre en lunes', () => {
  for (let i = 0; i < 40; i++) {
    const d = new Date(2026, 7, 1 + i);
    const lunes = G.lunesDeLaSemana(d);
    assert.strictEqual(lunes.getDay(), 1, `${d.toDateString()} -> ${lunes.toDateString()}`);
    assert.ok(lunes <= d && (d - lunes) / 86400000 < 7);
  }
});

test('un domingo pertenece a la semana que arrancó el lunes anterior', () => {
  const domingo = new Date(2026, 7, 30);          // domingo 30/08/2026
  assert.strictEqual(domingo.getDay(), 0);
  const lunes = G.lunesDeLaSemana(domingo);
  assert.strictEqual(lunes.getDate(), 24);
  assert.strictEqual(lunes.getMonth(), 7);
});

test('generarSemanas produce 13 semanas contiguas de lunes a domingo', () => {
  const semanas = G.generarSemanas(new Date(2026, 7, 26), 13);
  assert.strictEqual(semanas.length, 13);

  semanas.forEach((s, i) => {
    assert.strictEqual(s.numero, i + 1);
    assert.strictEqual(s.desde.getDay(), 1, 'la semana no arranca lunes');
    assert.strictEqual(s.hasta.getDay(), 0, 'la semana no termina domingo');
    assert.strictEqual((s.hasta - s.desde) / 86400000, 6);
    if (i > 0) {
      assert.strictEqual((s.desde - semanas[i - 1].hasta) / 86400000, 1, 'quedó un hueco entre semanas');
    }
  });

  // 13 semanas tienen que cubrir un trimestre completo.
  const dias = (semanas[12].hasta - semanas[0].desde) / 86400000 + 1;
  assert.strictEqual(dias, 91);
});

test('generarSemanas cruza fin de mes y fin de año sin romperse', () => {
  const semanas = G.generarSemanas(new Date(2026, 11, 28), 13);
  assert.strictEqual(semanas[0].desde.getFullYear(), 2026);
  assert.strictEqual(semanas[12].hasta.getFullYear(), 2027);
  semanas.forEach((s) => assert.strictEqual(s.desde.getDay(), 1));
});

test('ventasSemilla arma 13 filas con el neto ya calculado', () => {
  const filas = G.ventasSemilla(new Date(2026, 7, 26), 13, 2_800_000, 67.3);
  assert.strictEqual(filas.length, 13);
  assert.strictEqual(filas[0].length, G.ESQUEMA.VENTAS.columnas.length);
  assert.strictEqual(filas[0][5], Math.round(2_800_000 * 0.673));
  assert.ok(filas[0][6].includes('Semana en curso'));
  assert.strictEqual(filas[1][6], '');
});

test('la semilla de deudas respeta el esquema y deja trazado el vínculo', () => {
  const cols = G.ESQUEMA.DEUDAS.columnas.length;
  for (const fila of G.DEUDAS_SEMILLA) {
    assert.strictEqual(fila.length, cols, `${fila[0]}: ${fila.length} columnas, el esquema pide ${cols}`);
    assert.ok(Number(fila[5]) > 0, `${fila[0]}: sin saldo actual`);
  }
  const auto = G.DEUDAS_SEMILLA.find((f) => f[0] === 'DEU-003');
  assert.match(auto[10], /RETIRO/, 'DEU-003 tiene que aclarar que se paga del retiro');
});

test('la semilla declara su versión y coincide con la del código', () => {
  // Franco corrió la Etapa 3 sobre datos de la Etapa 1 y obtuvo números que
  // parecían buenos y no lo eran. La versión es lo que hace visible ese desfasaje.
  assert.strictEqual(cfg.MODELO_VERSION, G.MODELO_VERSION);
  assert.ok(G.MODELO_VERSION >= 3, 'la versión tiene que subir cuando cambia la semilla');
});

test('cambiar la semilla sin subir la versión es un error a la vista', () => {
  // Este test no puede detectar el olvido solo, pero deja la regla escrita
  // donde se lee: si cambian estos valores, sube MODELO_VERSION.
  const moto = G.OBLIGACIONES_SEMILLA.find((f) => f[G.COL_OBL.ID] === 'OBL-003');
  assert.strictEqual(moto[G.COL_OBL.TIPO_MONTO], 'PCT_VENTAS');
  assert.strictEqual(moto[G.COL_OBL.MONTO], 4.3);
  assert.strictEqual(moto[G.COL_OBL.AJUSTA], 'NO');
});

test('las hojas generadas están declaradas como tales', () => {
  for (const clave of ['ESTA_SEMANA', 'CASHFLOW', 'SIMULADOR']) {
    assert.strictEqual(G.ESQUEMA[clave].generada, true, `${clave} debería ser de solo lectura`);
  }
  for (const clave of ['CONFIG', 'OBLIGACIONES', 'DEUDAS', 'VENTAS', 'MOVIMIENTOS']) {
    assert.strictEqual(G.ESQUEMA[clave].generada, false, `${clave} debería ser de carga manual`);
  }
  assert.strictEqual(G.ORDEN_HOJAS.length, Object.keys(G.ESQUEMA).length);
});
