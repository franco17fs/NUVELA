/**
 * NUVELA · Cashflow — Pantalla "Hoy" y cálculo de la distribución diaria.
 *
 * Toda la aritmética vive en 11_Fondos.gs. Acá solo se lee, se llama y se pinta.
 */

var COLOR_SEMAFORO = {
  VERDE: { fondo: '#EDF7ED', texto: '#2C6B2F' },
  AMARILLO: { fondo: '#FFF6E0', texto: '#8A6100' },
  ROJO: { fondo: '#FBE3E3', texto: '#A02020' }
};

/** Lee los días cargados, arma los objetivos y reproduce toda la historia. */
function calcularFondos(ss) {
  var cfg = leerConfig(ss);
  var obligaciones = filasDe(ss, ESQUEMA.OBLIGACIONES);

  var problemas = validarObligaciones(obligaciones);
  if (problemas.length) return { error: 'Arreglá esto primero:\n\n' + problemas.join('\n\n') };

  var dias = filasDe(ss, ESQUEMA.DIA)
    .filter(function (f) { return esFecha(f[COL_DIA.FECHA]); })
    .map(function (f) {
      return { fecha: f[COL_DIA.FECHA], bruto: Number(f[COL_DIA.BRUTO]) || 0,
               compras: Number(f[COL_DIA.COMPRAS]) || 0 };
    });

  if (!dias.length) {
    return { error: 'Cargá al menos un día en la hoja "Dia": fecha y venta bruta.' };
  }

  var desde = dias[0].fecha;
  var hasta = sumarDias(new Date(), Number(cfg.HORIZONTE_FONDOS_DIAS) || 60);
  var brutoDiario = dias.reduce(function (a, d) { return a + d.bruto; }, 0) / dias.length;

  var objetivos = objetivosDeFinanciamiento(obligaciones, desde, hasta, cfg, brutoDiario);
  var pagados = objetivosPagados(filasDe(ss, ESQUEMA.MOVIMIENTOS), objetivos);

  var historia = reproducirDias(dias, objetivos, cfg, pagados);
  var ultimo = historia.dias[historia.dias.length - 1];
  var hoy = ultimo.fecha;
  var margen = margenDiarioPromedio(historia.dias);

  return {
    cfg: cfg,
    objetivos: objetivos,
    historia: historia,
    hoy: hoy,
    dia: ultimo,
    margenDiario: margen,
    reparto: reparto(historia.estado, objetivos),
    fondos: estadoDeObjetivos(objetivos, historia.estado, hoy),
    riesgos: riesgos(objetivos, historia.estado, hoy, margen),
    semaforo: semaforo(historia.estado, objetivos, hoy, margen, cfg),
    diagnostico: diagnostico(historia.estado, objetivos, historia.dias, cfg, hoy)
  };
}

/** Un objetivo ya pagado deja de juntar plata. */
function objetivosPagados(movimientos, objetivos) {
  var pagados = {};
  movimientos.forEach(function (m) {
    var id = String(m[COL_MOV.OBLIGACION] || '').trim();
    if (!id || !esFecha(m[COL_MOV.FECHA])) return;
    objetivos.forEach(function (o) {
      // Se da por pagado el vencimiento de esa obligación más cercano al movimiento.
      if (o.obligacionId === id && Math.abs(o.fecha - m[COL_MOV.FECHA]) < 10 * MS_DIA) {
        pagados[o.id] = true;
      }
    });
  });
  return pagados;
}

function actualizarHoy() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  if (versionDesactualizada(ss)) {
    ui.alert('Datos desactualizados', textoDesactualizado(ss), ui.ButtonSet.OK);
    return;
  }

  var r = calcularFondos(ss);
  if (r.error) { ui.alert('No puedo calcular el día', r.error, ui.ButtonSet.OK); return; }

  escribirHoy(ss, r);
  ss.setActiveSheet(ss.getSheetByName(ESQUEMA.HOY.nombre));
  ui.alert('NUVELA · Hoy', resumenDelDia(r), ui.ButtonSet.OK);
}

function escribirHoy(ss, r) {
  var hoja = ss.getSheetByName(ESQUEMA.HOY.nombre);
  var def = ESQUEMA.HOY;
  var d = r.dia;

  hoja.clear();
  hoja.clearFormats();
  var f = 1;

  hoja.getRange(f, 1).setValue('HOY').setFontSize(20).setFontWeight('bold')
      .setFontColor(COLOR.cabeceraEntrada);
  hoja.getRange(f++, 2).setValue(formatearFecha(r.hoy)).setFontSize(13).setFontColor('#6B7280');

  var color = COLOR_SEMAFORO[r.semaforo.estado];
  hoja.getRange(f, 1, 1, 6).merge()
      .setValue(r.semaforo.estado + ' — ' + r.semaforo.porque)
      .setFontWeight('bold').setBackground(color.fondo).setFontColor(color.texto).setWrap(true);
  hoja.setRowHeight(f, 40);
  f += 2;

  // --- De dónde sale la plata del día ---------------------------------------
  f = bloque(hoja, f, 'EL DÍA', [
    ['Ventas brutas', d.bruto],
    ['Ingreso neto', d.neto],
    ['Costo de lo vendido', -d.costoMercaderia],
    ['Margen real', d.margen]
  ]);
  f++;

  f = bloque(hoja, f, 'CÓMO SE REPARTE', [
    ['Reserva para mercadería', d.aMercaderia],
    ['Reserva para obligaciones', d.aObligaciones],
    ['Al colchón', d.aColchon],
    ['LIBRE DEL DÍA', d.libre]
  ]);
  if (d.adelantado > 0) {
    hoja.getRange(f++, 1, 1, 4).merge()
        .setValue('Día bueno: se adelantaron ' + pesos(d.adelantado) + ' de reservas futuras.')
        .setFontColor('#2C6B2F');
  }
  f++;

  // --- Caja partida en cuatro ------------------------------------------------
  f = bloque(hoja, f, 'CAJA TOTAL: ' + pesos(r.reparto.total), [
    ['Comprometido en mercadería', r.reparto.mercaderia],
    ['Reservado para obligaciones', r.reparto.obligaciones],
    ['Colchón de seguridad', r.reparto.colchon],
    ['LIBRE DE VERDAD', r.reparto.libre]
  ]);
  f++;

  // --- Cada obligación con su fondo -----------------------------------------
  hoja.getRange(f++, 1).setValue('FONDOS POR OBLIGACIÓN').setFontWeight('bold');
  var titulos = def.columnas.map(function (c) { return c.titulo; });
  hoja.getRange(f, 1, 1, titulos.length).setValues([titulos])
      .setFontWeight('bold').setFontColor(COLOR.textoCabecera).setBackground(COLOR.cabeceraEntrada);
  f++;

  if (r.fondos.length) {
    var filas = r.fondos.map(function (o) {
      return [o.concepto, o.fecha, o.total, o.reservado, o.pendiente,
              Math.round(d.asignado[o.id] || 0), o.dias, o.porDia];
    });
    hoja.getRange(f, 1, filas.length, titulos.length).setValues(filas);
    hoja.getRange(f, 2, filas.length, 1).setNumberFormat(FECHA);
    hoja.getRange(f, 3, filas.length, 4).setNumberFormat(MONEDA);
    hoja.getRange(f, 8, filas.length, 1).setNumberFormat(MONEDA);

    r.fondos.forEach(function (o, i) {
      if (o.vencido) hoja.getRange(f + i, 1, 1, titulos.length).setBackground('#FBE3E3').setFontColor('#A02020');
      else if (o.pendiente === 0) hoja.getRange(f + i, 1, 1, titulos.length).setBackground('#EDF7ED').setFontColor('#2C6B2F');
    });
    f += filas.length;
  } else {
    hoja.getRange(f++, 1).setValue('No hay vencimientos en el horizonte.').setFontStyle('italic');
  }
  f += 2;

  f = escribirRiesgos(hoja, f, r);
  escribirDiagnostico(hoja, f, r);

  def.columnas.forEach(function (c, i) { hoja.setColumnWidth(i + 1, c.ancho); });
}

/** Un bloque de etiqueta y monto, con la última fila resaltada. */
function bloque(hoja, f, titulo, filas) {
  hoja.getRange(f++, 1).setValue(titulo).setFontWeight('bold').setFontColor(COLOR.cabeceraEntrada);
  filas.forEach(function (par, i) {
    hoja.getRange(f, 1).setValue(par[0]).setFontColor('#6B7280');
    var celda = hoja.getRange(f, 2).setValue(par[1]).setNumberFormat(MONEDA);
    if (i === filas.length - 1) {
      hoja.getRange(f, 1, 1, 2).setFontWeight('bold');
      celda.setFontSize(13);
    }
    f++;
  });
  return f;
}

function escribirRiesgos(hoja, f, r) {
  if (!r.riesgos.length) return f;

  hoja.getRange(f++, 1, 1, 6).merge().setValue('ALERTAS')
      .setFontWeight('bold').setBackground('#FBE3E3').setFontColor('#A02020');

  r.riesgos.forEach(function (x) {
    hoja.getRange(f++, 1, 1, 6).merge()
        .setValue('Al ritmo actual no se llega a ' + x.concepto + ' del ' + formatearFecha(x.fecha) +
                  '. Falta reservar ' + pesos(x.pendiente) + ' en ' + x.dias + ' días: hacen falta ' +
                  pesos(x.necesarioPorDia) + ' por día y hay ' + pesos(x.disponiblePorDia) + '.')
        .setFontColor('#A02020').setWrap(true);
    hoja.setRowHeight(f - 1, 32);

    propuestasParaRiesgo(x, r.historia.estado, r.cfg, r.margenDiario).forEach(function (p) {
      hoja.getRange(f++, 1, 1, 6).merge().setValue('   → ' + p).setFontColor('#6B7280').setWrap(true);
    });
    f++;
  });

  return f;
}

function escribirDiagnostico(hoja, f, r) {
  if (!r.diagnostico.length) return;

  hoja.getRange(f++, 1, 1, 6).merge().setValue('LECTURA')
      .setFontWeight('bold').setBackground(COLOR.aviso).setFontColor(COLOR.cabeceraEntrada);

  r.diagnostico.forEach(function (o) {
    hoja.getRange(f++, 1, 1, 6).merge().setValue('· ' + o.texto).setWrap(true);
    hoja.setRowHeight(f - 1, 32);
  });
}

function resumenDelDia(r) {
  var d = r.dia;
  var l = [r.semaforo.estado + ' — ' + r.semaforo.porque, ''];

  l.push('Día ' + formatearFecha(r.hoy));
  l.push('Ventas ' + pesos(d.bruto) + ' · neto ' + pesos(d.neto) + ' · margen ' + pesos(d.margen));
  l.push('');
  l.push('Mercadería: ' + pesos(d.aMercaderia));
  l.push('Obligaciones: ' + pesos(d.aObligaciones) + (d.adelantado > 0 ? ' (adelanté ' + pesos(d.adelantado) + ')' : ''));
  l.push('Colchón: ' + pesos(d.aColchon));
  l.push('LIBRE DEL DÍA: ' + pesos(d.libre));
  l.push('');
  l.push('Caja total ' + pesos(r.reparto.total) + ' — libre de verdad: ' + pesos(r.reparto.libre));

  if (r.riesgos.length) {
    l.push('');
    l.push(r.riesgos.length + (r.riesgos.length === 1 ? ' alerta' : ' alertas') + '. Mirá la hoja "Hoy".');
  }
  return l.join('\n');
}

/** Recalcula el colchón con los números que mueve el negocio hoy. */
function sugerirColchon() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var cfg = leerConfig(ss);

  var desde = new Date();
  var hasta = sumarDias(desde, 30);
  var brutoDiario = (Number(cfg.VENTA_BRUTA_SEMANAL_BASE) || 0) / 7;
  var objetivos = objetivosDeFinanciamiento(filasDe(ss, ESQUEMA.OBLIGACIONES),
                                            desde, hasta, cfg, brutoDiario);
  var porDia = obligacionesPorDia(objetivos, desde, hasta);
  var sugerido = colchonSugerido(cfg, porDia);

  var respuesta = ui.alert('Colchón sugerido',
    'Con ' + cfg.DIAS_COLCHON + ' días de cobertura:\n\n' +
    '  Reposición de mercadería: ' + pesos(brutoDiario * cfg.PCT_COSTO_MERCADERIA / 100) + '/día\n' +
    '  Motomensajería: ' + pesos(brutoDiario * cfg.PCT_MOTOMENSAJERIA / 100) + '/día\n' +
    '  Obligaciones prorrateadas: ' + pesos(porDia) + '/día\n\n' +
    'COLCHÓN SUGERIDO: ' + pesos(sugerido) + '\n' +
    'Actual en Config: ' + pesos(Number(cfg.COLCHON_MINIMO) || 0) + '\n\n' +
    '¿Lo cargo?', ui.ButtonSet.YES_NO);

  if (respuesta !== ui.Button.YES) return;

  var hoja = ss.getSheetByName(ESQUEMA.CONFIG.nombre);
  var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i][0]).trim() === 'COLCHON_MINIMO') {
      hoja.getRange(i + 2, 2).setValue(sugerido);
      ui.alert('Listo', 'COLCHON_MINIMO quedó en ' + pesos(sugerido) + '.', ui.ButtonSet.OK);
      return;
    }
  }
}
