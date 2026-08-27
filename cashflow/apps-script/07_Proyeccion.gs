/**
 * NUVELA · Cashflow — Lectura del Sheet, ejecución del motor y escritura.
 *
 * Toda la aritmética vive en 06_Motor.gs. Acá solo se lee, se llama y se pinta.
 */

var COLOR_ESTADO = {
  ROJO: { fondo: '#FBE3E3', texto: '#A02020' },
  ATENCION: { fondo: '#FFF6E0', texto: '#8A6100' },
  OK: { fondo: null, texto: null }
};

/**
 * Lee la planilla, proyecta y arma el plan de pago de la semana en curso.
 * Lo usan tanto el menú como el aviso automático del domingo.
 *
 * Devuelve null si los datos no dan para proyectar; el motivo queda en `error`.
 */
function calcularTodo(ss) {
  var cfg = leerConfig(ss);
  var obligaciones = filasDe(ss, ESQUEMA.OBLIGACIONES);

  var problemas = validarObligaciones(obligaciones);
  if (problemas.length) return { error: 'Arreglá esto primero:\n\n' + problemas.join('\n\n') };

  var ventas = filasDe(ss, ESQUEMA.VENTAS).filter(function (f) { return esFecha(f[COL_VENTAS.DESDE]); });
  if (!ventas.length) return { error: 'Falta cargar la hoja Ventas.' };

  var semanas = ventas.map(function (f, i) {
    return { numero: i + 1, desde: f[COL_VENTAS.DESDE], hasta: f[COL_VENTAS.HASTA] };
  });

  // El real manda sobre el proyectado: una semana ya cerrada no se estima.
  var brutoPorSemana = ventas.map(function (f) {
    return Number(f[COL_VENTAS.REAL]) || Number(f[COL_VENTAS.PROYECTADO]) || 0;
  });

  var resultado = proyectar({
    semanas: semanas,
    brutoPorSemana: brutoPorSemana,
    obligaciones: obligaciones,
    cfg: cfg,
    hoy: new Date(),
    pagados: pagosPorSemana(filasDe(ss, ESQUEMA.MOVIMIENTOS), semanas)
  });

  // La plata con la que se cuenta esta semana: lo que hay más lo que entra.
  var semana1 = resultado.filas[0];
  resultado.plan = planDePago(semana1.vencimientos, semana1.saldoInicial + semana1.ingresos);
  resultado.cfg = cfg;
  resultado.brutoPorSemana = brutoPorSemana;
  resultado.deudas = filasDe(ss, ESQUEMA.DEUDAS);
  resultado.avisos = avisosDeObligaciones(obligaciones);
  return resultado;
}

function actualizarProyeccion() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var resultado = calcularTodo(ss);

  if (resultado.error) {
    SpreadsheetApp.getUi().alert('No proyecto con datos rotos', resultado.error,
                                 SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  escribirNetoEstimado(ss, resultado.brutoPorSemana, Number(resultado.cfg.PCT_NETO_SOBRE_BRUTO) || 0);
  escribirCashflow(ss, resultado, new Date());
  escribirEstaSemana(ss, resultado, resultado.plan, resultado.deudas);

  ss.setActiveSheet(ss.getSheetByName(ESQUEMA.ESTA_SEMANA.nombre));
  SpreadsheetApp.getUi().alert('NUVELA · Cashflow', mensajeResumen(resultado, resultado.cfg),
                               SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Filas con datos de una hoja, sin la cabecera. */
function filasDe(ss, definicion) {
  var hoja = ss.getSheetByName(definicion.nombre);
  if (!hoja || hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, definicion.columnas.length).getValues();
}

/**
 * Vencimientos ya pagados, indexados por "OBL-XXX|semana".
 * Se toma la semana del movimiento, no la del vencimiento: se paga cuando se
 * puede, no cuando vence, y lo que importa es que no se cuente dos veces.
 */
function pagosPorSemana(movimientos, semanas) {
  var pagados = {};
  movimientos.forEach(function (m) {
    var id = String(m[COL_MOV.OBLIGACION] || '').trim();
    if (!id || !esFecha(m[COL_MOV.FECHA])) return;
    var i = semanaDe(semanas, m[COL_MOV.FECHA]);
    if (i !== -1) pagados[id + '|' + i] = true;
  });
  return pagados;
}

function escribirNetoEstimado(ss, brutoPorSemana, pctNeto) {
  var hoja = ss.getSheetByName(ESQUEMA.VENTAS.nombre);
  hoja.getRange(2, COL_VENTAS.NETO + 1, brutoPorSemana.length, 1).setValues(
    brutoPorSemana.map(function (b) { return [Math.round(b * pctNeto / 100)]; })
  );
}

function escribirCashflow(ss, resultado, hoy) {
  var def = ESQUEMA.CASHFLOW;
  var hoja = ss.getSheetByName(def.nombre);
  var quiebre = resultado.quiebre;

  if (hoja.getLastRow() > 1) {
    hoja.getRange(2, 1, hoja.getLastRow() - 1, def.columnas.length).clear();
  }

  var filas = resultado.filas.map(function (f) {
    return [f.numero, f.desde, f.hasta, f.saldoInicial, f.ingresos, f.mercaderia,
            f.fijos, f.impuestos, f.deuda, f.saldoFinal, f.estado, detalleDe(f, quiebre, hoy)];
  });

  hoja.getRange(2, 1, filas.length, def.columnas.length).setValues(filas);

  resultado.filas.forEach(function (f, i) {
    var color = COLOR_ESTADO[f.estado];
    var rango = hoja.getRange(i + 2, 1, 1, def.columnas.length);
    rango.setBackground(color.fondo).setFontColor(color.texto);
    if (f.estado !== 'OK') hoja.getRange(i + 2, 11).setFontWeight('bold');
  });

  hoja.getRange(2, 12, filas.length, 1).setWrap(true);
}

function detalleDe(fila, quiebre, hoy) {
  var partes = [];

  if (fila.estado === 'ROJO') {
    partes.push('QUIEBRE: faltan ' + pesos(-fila.saldoFinal));
  } else if (fila.estado === 'ATENCION') {
    partes.push('Bajo el colchón mínimo');
  }

  // En la primera semana se avisa cuánto aire queda hasta el quiebre.
  if (fila.numero === 1 && quiebre) {
    partes.push(quiebre.semana === 1
      ? 'El quiebre es esta semana'
      : 'Primer quiebre en la semana ' + quiebre.semana + ', dentro de ' + quiebre.dias + ' días');
  }

  var resumen = resumenDeSemana(fila, 3);
  if (resumen) partes.push(resumen);
  return partes.join(' — ');
}

function mensajeResumen(resultado, cfg) {
  var quiebre = resultado.quiebre;
  var ultima = resultado.filas[resultado.filas.length - 1];
  var plan = resultado.plan;
  var lineas = ['Proyección actualizada: ' + resultado.filas.length + ' semanas.', ''];

  lineas.push(plan.alcanza
    ? 'Esta semana alcanza: te sobran ' + pesos(plan.sobrante) + '.'
    : 'ESTA SEMANA TE FALTAN ' + pesos(plan.deficit) + ' — quedan ' + plan.sinPagar.length +
      ' vencimientos sin pagar. Mirá "Esta Semana".');
  lineas.push('');

  if (quiebre) {
    lineas.push('QUIEBRE en la semana ' + quiebre.semana +
                ' (' + formatearFecha(quiebre.desde) + ' al ' + formatearFecha(quiebre.hasta) + ').');
    lineas.push('Faltan ' + pesos(quiebre.faltan) + '. Tenés ' + quiebre.dias + ' días de aviso.');
  } else {
    var atencion = primeraAtencion(resultado.filas);
    lineas.push(atencion
      ? 'Sin quiebre, pero la semana ' + atencion.numero + ' baja del colchón (' +
        pesos(atencion.saldoFinal) + ' contra un mínimo de ' + pesos(Number(cfg.COLCHON_MINIMO) || 0) + ').'
      : 'Ninguna semana cierra en negativo ni baja del colchón.');
  }

  lineas.push('', 'Saldo al cierre de la semana ' + ultima.numero + ': ' + pesos(ultima.saldoFinal) + '.');
  return lineas.join('\n');
}
