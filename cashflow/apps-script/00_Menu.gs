/**
 * NUVELA · Cashflow — Menú.
 * Se agrega solo al abrir la planilla.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('NUVELA Cashflow')
    .addItem('Actualizar proyección', 'actualizarProyeccion')
    .addSeparator()
    .addItem('Activar aviso de los domingos', 'activarAvisoDominical')
    .addItem('Mandarme el aviso ahora', 'avisoSemanal')
    .addSeparator()
    .addItem('Crear / reparar sistema', 'crearSistema')
    .addItem('Revisar carga', 'revisarCarga')
    .addToUi();
}

/**
 * Chequeo de integridad de lo cargado a mano.
 * No corrige nada: lista lo que está mal para que se arregle en la hoja.
 */
function revisarCarga() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var obligaciones = ss.getSheetByName(ESQUEMA.OBLIGACIONES.nombre).getDataRange().getValues().slice(1);
  var problemas = validarObligaciones(obligaciones);

  avisosDeObligaciones(obligaciones).forEach(function (a) {
    problemas.push(a.id + ' (' + a.concepto + '): ' + pesos(a.monto) + ' ' + a.motivo +
                   '. No frena nada, pero poné la fecha cuando la confirmes.');
  });

  var cfg = leerConfig(ss);
  if (!Number(cfg.SALDO_MERCADO_PAGO) && !Number(cfg.SALDO_EFECTIVO)) {
    problemas.push('Config: los dos saldos están en cero. Si es real, dejalo; si no, cargá el saldo de Mercado Pago.');
  }

  var pendientes = [];
  ss.getSheetByName(ESQUEMA.CONFIG.nombre).getDataRange().getValues().slice(1)
    .forEach(function (f) { if (f[4] === 'CONFIRMAR') pendientes.push(f[0]); });
  if (pendientes.length) {
    problemas.push('Sin confirmar en Config (' + pendientes.length + '): ' + pendientes.join(', '));
  }

  SpreadsheetApp.getUi().alert(
    'Revisión de carga',
    problemas.length ? problemas.join('\n\n') : 'Todo en orden. No encontré inconsistencias.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
