/**
 * NUVELA · Cashflow — Pantalla "Esta Semana" y avisos.
 *
 * Contesta tres cosas y nada más:
 *   1. Qué hay que pagar en los próximos 7 días
 *   2. Cuánta plata va a haber
 *   3. Si falta, cuánto falta y qué queda sin pagar
 */

var COLOR_PAGO = {
  PAGADO: { fondo: '#EDF7ED', texto: '#2C6B2F' },
  ALCANZA: { fondo: null, texto: null },
  'NO ALCANZA': { fondo: '#FBE3E3', texto: '#A02020' }
};

function escribirEstaSemana(ss, resultado, plan, deudas) {
  var hoja = ss.getSheetByName(ESQUEMA.ESTA_SEMANA.nombre);
  var def = ESQUEMA.ESTA_SEMANA;
  var fila = resultado.filas[0];
  var resumen = resumenSemanal(fila, plan);
  var quiebre = resultado.quiebre;

  hoja.clear();
  hoja.clearFormats();

  var f = 1;

  hoja.getRange(f, 1).setValue('ESTA SEMANA')
      .setFontSize(20).setFontWeight('bold').setFontColor(COLOR.cabeceraEntrada);
  hoja.getRange(f++, 4).setValue(formatearFecha(resumen.desde) + ' al ' + formatearFecha(resumen.hasta))
      .setFontSize(12).setFontColor('#6B7280');
  f++;

  // --- Las tres respuestas --------------------------------------------------
  [['Tenés hoy', resumen.tenesHoy],
   ['Va a entrar esta semana', resumen.vaAEntrar],
   ['Tenés que pagar', -resumen.tenesQuePagar]].forEach(function (par) {
    hoja.getRange(f, 1).setValue(par[0]).setFontColor('#6B7280');
    hoja.getRange(f++, 2).setValue(pesos(par[1])).setFontSize(13).setFontWeight('bold');
  });

  var veredicto = resumen.alcanza
    ? 'ALCANZA — te sobran ' + pesos(plan.sobrante)
    : 'TE FALTAN ' + pesos(plan.deficit) + ' — queda sin pagar ' + pesos(plan.faltante);
  hoja.getRange(f, 1, 1, 3).merge().setValue(veredicto)
      .setFontSize(15).setFontWeight('bold')
      .setBackground(resumen.alcanza ? '#EDF7ED' : '#FBE3E3')
      .setFontColor(resumen.alcanza ? '#2C6B2F' : '#A02020')
      .setHorizontalAlignment('center');
  f += 2;

  if (quiebre) {
    hoja.getRange(f++, 1, 1, 5).merge()
        .setValue(quiebre.semana === 1
          ? 'El quiebre es esta semana.'
          : 'Ojo: la semana ' + quiebre.semana + ' (' + formatearFecha(quiebre.desde) +
            ') cierra en ' + pesos(-quiebre.faltan) + '. Tenés ' + quiebre.dias + ' días para resolverlo.')
        .setFontWeight('bold').setFontColor('#8A6100');
    f++;
  }

  // --- Lista de vencimientos ------------------------------------------------
  hoja.getRange(f, 1).setValue(resumen.alcanza
    ? 'Vencimientos de la semana'
    : 'En este orden, hasta donde alcance').setFontWeight('bold');
  f++;

  var titulos = def.columnas.map(function (c) { return c.titulo; });
  hoja.getRange(f, 1, 1, titulos.length).setValues([titulos])
      .setFontWeight('bold').setFontColor(COLOR.textoCabecera)
      .setBackground(COLOR.cabeceraEntrada).setWrap(true);
  var filaCabecera = f++;

  // Lo ya pagado va primero y en verde: la semana se lee completa.
  var listado = fila.yaPagados.map(function (v) { return { v: v, estado: ESTADO_PAGO.PAGADO }; })
    .concat(plan.orden.map(function (v) { return { v: v, estado: estadoDe(v, plan) }; }));

  if (!listado.length) {
    hoja.getRange(f, 1).setValue('No vence nada esta semana.').setFontStyle('italic');
  } else {
    var filas = listado.map(function (x) {
      return [x.v.fecha, x.v.concepto, x.v.acreedor, x.v.monto, x.v.criticidad,
              x.estado, x.v.consecuencia];
    });
    hoja.getRange(f, 1, filas.length, titulos.length).setValues(filas);

    listado.forEach(function (x, i) {
      var color = COLOR_PAGO[x.estado];
      hoja.getRange(f + i, 1, 1, titulos.length)
          .setBackground(color.fondo).setFontColor(color.texto);
    });

    hoja.getRange(f, 1, filas.length, 1).setNumberFormat(FECHA);
    hoja.getRange(f, 4, filas.length, 1).setNumberFormat(MONEDA);
    hoja.getRange(f, 7, filas.length, 1).setWrap(true);
    f += filas.length;
  }

  f += 2;
  escribirDeudas(hoja, f, deudas);

  def.columnas.forEach(function (c, i) { hoja.setColumnWidth(i + 1, c.ancho); });
  hoja.setFrozenRows(filaCabecera);
}

/** Saldo vivo y cuánto flujo mensual libera cada deuda al terminar. */
function escribirDeudas(hoja, f, deudas) {
  var lista = liberacionDeFlujo(deudas);
  if (!lista.length) return;

  hoja.getRange(f, 1).setValue('Deuda viva').setFontWeight('bold');
  f++;

  var titulos = ['Acreedor', 'Saldo', 'Cuota', 'Cuotas', 'Libera al terminar'];
  hoja.getRange(f, 1, 1, titulos.length).setValues([titulos])
      .setFontWeight('bold').setFontColor(COLOR.textoCabecera).setBackground(COLOR.cabeceraGenerada);
  f++;

  var filas = lista.map(function (d) {
    return [d.acreedor, d.saldo, d.cuota, d.cuotas,
            d.libera ? pesos(d.libera) + '/mes en ' + d.cuotas + ' cuotas' : ''];
  });
  hoja.getRange(f, 1, filas.length, titulos.length).setValues(filas);
  hoja.getRange(f, 2, filas.length, 2).setNumberFormat(MONEDA);
}

// --- Avisos -----------------------------------------------------------------

/** Texto del aviso. Puro: se testea sin mandar nada. */
function textoDelAviso(resumen, plan, quiebre) {
  var l = ['NUVELA · Semana del ' + formatearFecha(resumen.desde) + ' al ' + formatearFecha(resumen.hasta), ''];

  l.push('Tenés hoy: ' + pesos(resumen.tenesHoy));
  l.push('Va a entrar: ' + pesos(resumen.vaAEntrar));
  l.push('Tenés que pagar: ' + pesos(resumen.tenesQuePagar) + ' en ' + resumen.cuantos + ' vencimientos');
  l.push('');

  if (resumen.alcanza) {
    l.push('ALCANZA. Te sobran ' + pesos(plan.sobrante) + '.');
  } else {
    l.push('TE FALTAN ' + pesos(plan.deficit) + ' para pagar todo.');
    l.push('');
    l.push('Con lo que hay entra todo menos:');
    consecuenciasDe(plan).forEach(function (c) {
      l.push('· ' + c.concepto + ' ' + pesos(c.monto) + ' (' + c.acreedor + ')');
      l.push('  ' + c.consecuencia);
    });
  }

  if (quiebre && quiebre.semana > 1) {
    l.push('');
    l.push('Primer quiebre: semana ' + quiebre.semana + ' (' + formatearFecha(quiebre.desde) +
           '), faltan ' + pesos(quiebre.faltan) + '. Tenés ' + quiebre.dias + ' días.');
  }

  return l.join('\n');
}

/**
 * Manda el aviso semanal. Mail siempre; WhatsApp solo si están cargadas las
 * credenciales de CallMeBot en Config.
 */
function enviarAviso(texto, cfg) {
  var destinatarios = String(cfg.MAIL_AVISOS || '').trim() || Session.getActiveUser().getEmail();
  MailApp.sendEmail(destinatarios, 'NUVELA · Qué pagar esta semana', texto);

  var numero = String(cfg.WHATSAPP_NUMERO || '').trim();
  var apikey = String(cfg.CALLMEBOT_APIKEY || '').trim();
  if (!numero || !apikey) return false;

  var url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(numero) +
            '&apikey=' + encodeURIComponent(apikey) +
            '&text=' + encodeURIComponent(texto);
  try {
    UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return true;
  } catch (e) {
    // El mail ya salió: que falle WhatsApp no puede tumbar el aviso.
    console.error('WhatsApp falló: ' + e);
    return false;
  }
}

/** Corre la proyección y manda el aviso. Es lo que dispara el trigger dominical. */
function avisoSemanal() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var resultado = calcularTodo(ss);

  if (resultado.error) {
    MailApp.sendEmail(String(leerConfig(ss).MAIL_AVISOS || '').trim() || Session.getActiveUser().getEmail(),
                      'NUVELA · No pude calcular la semana',
                      'La proyección no corrió:\n\n' + resultado.error);
    return;
  }

  escribirCashflow(ss, resultado, new Date());
  escribirEstaSemana(ss, resultado, resultado.plan, resultado.deudas);
  enviarAviso(textoDelAviso(resumenSemanal(resultado.filas[0], resultado.plan),
                            resultado.plan, resultado.quiebre), resultado.cfg);
}

/** Programa el aviso para todos los domingos a la noche. */
function activarAvisoDominical() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'avisoSemanal') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('avisoSemanal')
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).create();

  SpreadsheetApp.getUi().alert(
    'Aviso activado',
    'Todos los domingos a las 20 hs te llega el resumen por mail.\n\n' +
    'Para que llegue también por WhatsApp, cargá WHATSAPP_NUMERO y CALLMEBOT_APIKEY en Config.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
