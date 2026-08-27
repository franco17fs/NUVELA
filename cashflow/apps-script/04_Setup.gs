/**
 * NUVELA · Cashflow — Construcción del Sheet.
 *
 * crearSistema() se puede correr las veces que haga falta: crea lo que falta,
 * reescribe cabeceras y formatos, y NO pisa datos ya cargados.
 */

var COLOR = {
  cabeceraEntrada: '#232B52',   // azul institucional NUVELA
  cabeceraGenerada: '#5A6070',  // gris: hoja de solo lectura
  textoCabecera: '#FFFFFF',
  aviso: '#ECF6FD',
  alerta: '#FFF3F3'
};

function crearSistema() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var creadas = [];

  ORDEN_HOJAS.forEach(function (clave, i) {
    var def = ESQUEMA[clave];
    var hoja = ss.getSheetByName(def.nombre);
    var esNueva = !hoja;
    if (esNueva) hoja = ss.insertSheet(def.nombre);
    ss.setActiveSheet(hoja);
    ss.moveActiveSheet(i + 1);

    escribirCabecera(hoja, def);
    aplicarFormatoColumnas(hoja, def);
    if (esNueva) creadas.push(def.nombre);
  });

  sembrarSiVacio(ss, ESQUEMA.CONFIG, CONFIG_SEMILLA);
  sembrarSiVacio(ss, ESQUEMA.OBLIGACIONES, OBLIGACIONES_SEMILLA);
  sembrarSiVacio(ss, ESQUEMA.DEUDAS, DEUDAS_SEMILLA);

  var cfg = leerConfig(ss);
  sembrarSiVacio(ss, ESQUEMA.VENTAS, ventasSemilla(
    new Date(),
    Number(cfg.SEMANAS_PROYECCION) || 13,
    Number(cfg.VENTA_BRUTA_SEMANAL_BASE) || 2800000,
    Number(cfg.PCT_NETO_SOBRE_BRUTO) || 67.3
  ));

  marcarGeneradas(ss);
  borrarHojaPorDefecto(ss);

  SpreadsheetApp.getUi().alert(
    'NUVELA · Cashflow',
    creadas.length
      ? 'Listo. Hojas creadas: ' + creadas.join(', ') + '.\n\nEmpezá por Config: cargá el saldo real de Mercado Pago y revisá lo marcado CONFIRMAR.'
      : 'Estructura y formatos actualizados. No se tocó ningún dato cargado.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function escribirCabecera(hoja, def) {
  if (def.libre) return;   // arma su propio layout al generarse
  var titulos = def.columnas.map(function (c) { return c.titulo; });
  var rango = hoja.getRange(1, 1, 1, titulos.length);
  rango.setValues([titulos])
       .setFontWeight('bold')
       .setFontColor(COLOR.textoCabecera)
       .setBackground(def.generada ? COLOR.cabeceraGenerada : COLOR.cabeceraEntrada)
       .setVerticalAlignment('middle')
       .setWrap(true);

  def.columnas.forEach(function (c, i) {
    if (c.nota) hoja.getRange(1, i + 1).setNote(c.nota);
  });

  hoja.setFrozenRows(1);
  hoja.setRowHeight(1, 42);
}

function aplicarFormatoColumnas(hoja, def) {
  var filas = Math.max(hoja.getMaxRows() - 1, 1);

  def.columnas.forEach(function (c, i) {
    var col = i + 1;
    hoja.setColumnWidth(col, c.ancho);
    var cuerpo = hoja.getRange(2, col, filas, 1);

    if (c.formato) cuerpo.setNumberFormat(c.formato);

    if (c.lista) {
      cuerpo.setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(c.lista.map(String), true)
          .setAllowInvalid(true)   // permisivo a propósito: avisa, no bloquea la carga
          .build()
      );
    }
  });

  // Sobran columnas a la derecha: se eliminan para que la hoja no invite a
  // agregar campos sueltos que después el motor ignora.
  var sobrantes = hoja.getMaxColumns() - def.columnas.length;
  if (sobrantes > 0) hoja.deleteColumns(def.columnas.length + 1, sobrantes);
}

/** Escribe la semilla solo si la hoja no tiene datos. Nunca pisa lo cargado. */
function sembrarSiVacio(ss, def, filas) {
  var hoja = ss.getSheetByName(def.nombre);
  if (hoja.getLastRow() > 1 || !filas.length) return false;
  hoja.getRange(2, 1, filas.length, def.columnas.length).setValues(filas);
  return true;
}

/** Aviso fijo arriba de las hojas que escribe el sistema. */
function marcarGeneradas(ss) {
  ORDEN_HOJAS.forEach(function (clave) {
    var def = ESQUEMA[clave];
    if (!def.generada) return;
    var hoja = ss.getSheetByName(def.nombre);
    if (hoja.getLastRow() > 1) return;
    hoja.getRange(def.libre ? 1 : 2, 1)
        .setValue('Esta hoja la escribe el sistema. Corré "Actualizar proyección" para llenarla.')
        .setFontColor('#8A8F9A')
        .setFontStyle('italic');
  });
}

function borrarHojaPorDefecto(ss) {
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (h && ss.getSheets().length > 1) ss.deleteSheet(h);
  });
}
