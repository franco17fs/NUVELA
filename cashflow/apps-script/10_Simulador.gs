/**
 * NUVELA · Cashflow — Simulador de escenarios.
 *
 * Contesta "si compro $X el día D, ¿en qué semana me quedo corto?" corriendo
 * la misma proyección dos veces —base y escenario— y comparándolas.
 *
 * No toca la proyección real: es una hoja aparte que se puede tirar y rehacer.
 */

// Celdas de entrada del escenario. Fijas para poder leerlas sin buscar.
var SIM = {
  MONTO: 'B4', FECHA: 'B5', AJUSTE_VENTAS: 'B6', LAG: 'B7',
  PRIMERA_SALIDA: 10
};

/**
 * Aplica un escenario sobre las entradas de la proyección.
 * Puro: devuelve entradas nuevas, no modifica las que recibe.
 */
function aplicarEscenario(base, escenario) {
  var ajuste = 1 + (Number(escenario.ajusteVentasPct) || 0) / 100;
  var cfg = {};
  for (var k in base.cfg) cfg[k] = base.cfg[k];

  if (escenario.lagDias > 0) {
    // Estirar el plazo significa dejar de pagar el adelanto de dinero, y su
    // costo está descontado dentro de PCT_NETO_SOBRE_BRUTO. Si solo se corriera
    // la fecha, el escenario seguiría cobrando una comisión que ya no existe y
    // apagar el adelanto daría peor de lo que realmente es.
    if (escenario.lagDias > Number(base.cfg.LAG_ACREDITACION_DIAS)) {
      cfg.PCT_NETO_SOBRE_BRUTO = Number(base.cfg.PCT_NETO_SOBRE_BRUTO) +
                                 Number(base.cfg.PCT_ADELANTO_DINERO || 0);
    }
    cfg.LAG_ACREDITACION_DIAS = escenario.lagDias;
  }

  return {
    semanas: base.semanas,
    brutoPorSemana: base.brutoPorSemana.map(function (b) { return b * ajuste; }),
    obligaciones: base.obligaciones,
    cfg: cfg,
    hoy: base.hoy,
    pagados: base.pagados,
    extras: escenario.movimientos || []
  };
}

/**
 * Corre base y escenario y arma la comparación semana a semana.
 * Lo que importa es el corrimiento del quiebre: adelantarlo una semana es
 * peor que cualquier diferencia de saldo.
 */
function compararEscenarios(base, escenario) {
  var a = proyectar(base);
  var b = proyectar(aplicarEscenario(base, escenario));

  var semanas = a.filas.map(function (f, i) {
    return {
      numero: f.numero,
      desde: f.desde,
      hasta: f.hasta,
      base: f.saldoFinal,
      escenario: b.filas[i].saldoFinal,
      diferencia: b.filas[i].saldoFinal - f.saldoFinal,
      estadoBase: f.estado,
      estadoEscenario: b.filas[i].estado
    };
  });

  return {
    base: a,
    escenario: b,
    semanas: semanas,
    quiebreBase: a.quiebre,
    quiebreEscenario: b.quiebre,
    corrimiento: corrimientoDelQuiebre(a.quiebre, b.quiebre),
    cierreBase: a.filas[a.filas.length - 1].saldoFinal,
    cierreEscenario: b.filas[b.filas.length - 1].saldoFinal,
    nota: notaDelEscenario(base, escenario)
  };
}

/**
 * Avisos sobre cómo leer la comparación.
 *
 * Estirar el plazo de acreditación corre las ventas de las últimas semanas más
 * allá del horizonte: esa plata no se pierde, entra después de la semana 13.
 * El cierre queda peor de lo que realmente es, así que hay que mirar el
 * quiebre y las primeras semanas, no el saldo final.
 */
function notaDelEscenario(base, escenario) {
  var lagBase = Number(base.cfg.LAG_ACREDITACION_DIAS) || 0;
  if (!escenario.lagDias || escenario.lagDias <= lagBase) return '';

  var semanasFuera = Math.ceil((escenario.lagDias - lagBase) / 7);
  return 'Ojo con el cierre: al estirar el plazo a ' + escenario.lagDias + ' días, las ventas de ' +
         'las últimas ' + semanasFuera + (semanasFuera === 1 ? ' semana' : ' semanas') +
         ' se acreditan después de la semana 13 y quedan fuera del cuadro. Esa plata no se pierde. ' +
         'Para decidir, mirá el quiebre y las primeras semanas, no el saldo final.';
}

/**
 * Cuántas semanas se adelanta o se atrasa el quiebre.
 * Negativo = se adelanta (peor). Positivo = se corre para adelante (mejor).
 */
function corrimientoDelQuiebre(base, escenario) {
  if (!base && !escenario) return { texto: 'Sigue sin haber quiebre.', semanas: 0 };
  if (!base && escenario) return { texto: 'Aparece un quiebre en la semana ' + escenario.semana + '.', semanas: -99 };
  if (base && !escenario) return { texto: 'Desaparece el quiebre de la semana ' + base.semana + '.', semanas: 99 };

  var d = escenario.semana - base.semana;
  if (d === 0) return { texto: 'El quiebre sigue en la semana ' + base.semana + '.', semanas: 0 };
  return {
    semanas: d,
    texto: d < 0
      ? 'El quiebre se adelanta ' + (-d) + (-d === 1 ? ' semana' : ' semanas') +
        ': pasa de la ' + base.semana + ' a la ' + escenario.semana + '.'
      : 'El quiebre se corre ' + d + (d === 1 ? ' semana' : ' semanas') +
        ': pasa de la ' + base.semana + ' a la ' + escenario.semana + '.'
  };
}

// --- Hoja -------------------------------------------------------------------

/** Escribe el bloque de entrada una sola vez, sin pisar lo que ya haya. */
function prepararSimulador(ss) {
  var hoja = ss.getSheetByName(ESQUEMA.SIMULADOR.nombre);
  if (String(hoja.getRange('A4').getValue()).indexOf('Compro') === 0) return;

  hoja.clear();
  hoja.getRange('A1').setValue('SIMULADOR').setFontSize(20).setFontWeight('bold')
      .setFontColor(COLOR.cabeceraEntrada);
  hoja.getRange('A2').setValue('Cambiá los valores de abajo y corré "Simular escenario" en el menú.')
      .setFontColor('#6B7280');

  var entradas = [
    ['Compro mercadería por', 2000000, 'Un gasto extra que no está en la proyección. Dejalo en 0 para no agregar nada.'],
    ['el día', new Date(), 'Cuándo lo pagás. Es lo que se mueve para ver si destraba una semana.'],
    ['Ajusto las ventas en (%)', 0, 'Sube o baja las 13 semanas. -20 simula un mes flojo; 15, uno bueno.'],
    ['Plazo de acreditación (días)', 1, 'Hoy es 1 porque pagás el adelanto de dinero. Poné 7 o 14 para ver qué pasa si lo apagás.']
  ];
  hoja.getRange(4, 1, entradas.length, 3).setValues(entradas);
  hoja.getRange(4, 2, entradas.length, 1).setBackground('#ECF6FD').setFontWeight('bold');
  hoja.getRange(SIM.MONTO).setNumberFormat(MONEDA);
  hoja.getRange(SIM.FECHA).setNumberFormat(FECHA);
  hoja.getRange(4, 3, entradas.length, 1).setFontColor('#6B7280').setWrap(true);

  ESQUEMA.SIMULADOR.columnas.forEach(function (c, i) { hoja.setColumnWidth(i + 1, c.ancho); });
}

function simular() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  if (versionDesactualizada(ss)) {
    ui.alert('Datos desactualizados', textoDesactualizado(ss), ui.ButtonSet.OK);
    return;
  }

  var base = entradasDeProyeccion(ss);
  if (base.error) {
    ui.alert('No puedo simular', base.error, ui.ButtonSet.OK);
    return;
  }

  prepararSimulador(ss);
  var hoja = ss.getSheetByName(ESQUEMA.SIMULADOR.nombre);
  var monto = Number(hoja.getRange(SIM.MONTO).getValue()) || 0;
  var fecha = hoja.getRange(SIM.FECHA).getValue();

  var comparacion = compararEscenarios(base, {
    movimientos: (monto > 0 && esFecha(fecha))
      ? [{ concepto: 'Compra simulada', acreedor: 'Escenario', monto: monto, fecha: fecha }]
      : [],
    ajusteVentasPct: Number(hoja.getRange(SIM.AJUSTE_VENTAS).getValue()) || 0,
    lagDias: Number(hoja.getRange(SIM.LAG).getValue()) || 0
  });

  escribirSimulacion(hoja, comparacion);
  ss.setActiveSheet(hoja);
  ui.alert('Simulador', resumenDeSimulacion(comparacion), ui.ButtonSet.OK);
}

function escribirSimulacion(hoja, c) {
  var f = SIM.PRIMERA_SALIDA;
  if (hoja.getLastRow() >= f) {
    hoja.getRange(f, 1, hoja.getLastRow() - f + 1, 5).clear();
  }

  hoja.getRange(f, 1, 1, 5).merge().setValue(c.corrimiento.texto)
      .setFontSize(14).setFontWeight('bold')
      .setBackground(c.corrimiento.semanas < 0 ? '#FBE3E3' : '#EDF7ED')
      .setFontColor(c.corrimiento.semanas < 0 ? '#A02020' : '#2C6B2F')
      .setHorizontalAlignment('center');
  f++;

  if (c.nota) {
    hoja.getRange(f, 1, 1, 5).merge().setValue(c.nota)
        .setBackground('#FFF6E0').setFontColor('#8A6100').setWrap(true);
    hoja.setRowHeight(f, 46);
    f++;
  }
  f++;

  var cabecera = ESQUEMA.SIMULADOR.columnas.map(function (col) { return col.titulo; });
  hoja.getRange(f, 1, 1, cabecera.length).setValues([cabecera])
      .setFontWeight('bold').setFontColor(COLOR.textoCabecera).setBackground(COLOR.cabeceraEntrada);
  f++;

  var filas = c.semanas.map(function (s) {
    return ['Semana ' + s.numero + ' · ' + formatearFecha(s.desde),
            s.base, s.escenario, s.diferencia, cambioDeEstado(s)];
  });
  hoja.getRange(f, 1, filas.length, 5).setValues(filas);
  hoja.getRange(f, 2, filas.length, 3).setNumberFormat(MONEDA);

  c.semanas.forEach(function (s, i) {
    if (s.estadoEscenario === ESTADO.ROJO && s.estadoBase !== ESTADO.ROJO) {
      hoja.getRange(f + i, 1, 1, 5).setBackground('#FBE3E3').setFontColor('#A02020');
    } else if (s.estadoBase === ESTADO.ROJO && s.estadoEscenario !== ESTADO.ROJO) {
      hoja.getRange(f + i, 1, 1, 5).setBackground('#EDF7ED').setFontColor('#2C6B2F');
    }
  });

  f += filas.length + 1;
  hoja.getRange(f, 1).setValue('Cierre a 13 semanas').setFontWeight('bold');
  hoja.getRange(f, 2, 1, 3).setValues([[c.cierreBase, c.cierreEscenario,
                                        c.cierreEscenario - c.cierreBase]])
      .setNumberFormat(MONEDA).setFontWeight('bold');
}

function cambioDeEstado(s) {
  if (s.estadoBase === s.estadoEscenario) return '';
  if (s.estadoEscenario === ESTADO.ROJO) return 'Se pone en rojo';
  if (s.estadoBase === ESTADO.ROJO) return 'Deja de estar en rojo';
  if (s.estadoEscenario === ESTADO.ATENCION) return 'Baja del colchón';
  return 'Sale del colchón';
}

function resumenDeSimulacion(c) {
  var l = [c.corrimiento.texto, ''];

  if (c.quiebreEscenario) {
    l.push('En el escenario, el quiebre es la semana ' + c.quiebreEscenario.semana +
           ' (' + formatearFecha(c.quiebreEscenario.desde) + ') y faltan ' +
           pesos(c.quiebreEscenario.faltan) + '.');
  } else {
    l.push('En el escenario ninguna semana cierra en negativo.');
  }

  var delta = c.cierreEscenario - c.cierreBase;
  l.push('');
  l.push('Cierre a 13 semanas: ' + pesos(c.cierreBase) + ' → ' + pesos(c.cierreEscenario) +
         ' (' + (delta >= 0 ? '+' : '') + pesos(delta) + ').');

  if (c.nota) { l.push(''); l.push(c.nota); }
  return l.join('\n');
}
