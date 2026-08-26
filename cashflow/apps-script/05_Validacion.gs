/**
 * NUVELA · Cashflow — Validación de la carga manual.
 *
 * Funciones puras: reciben filas y devuelven texto. No tocan el Sheet.
 * Se testean con Node antes de subirlas.
 */

var COL_OBL = {
  ID: 0, ACTIVO: 1, CONCEPTO: 2, ACREEDOR: 3, CATEGORIA: 4, CRITICIDAD: 5,
  TIPO_MONTO: 6, MONTO: 7, PERIODICIDAD: 8, VENCIMIENTO: 9,
  AJUSTA: 10, CONSECUENCIA: 11, CUENTA: 12, NOTAS: 13
};

var DIAS_SEMANA = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'];

/**
 * Devuelve un array de problemas legibles. Vacío = todo bien.
 * Solo mira las filas activas: una obligación desactivada puede estar a medio cargar.
 */
function validarObligaciones(filas) {
  var problemas = [];
  var vistos = {};

  filas.forEach(function (f, i) {
    var linea = i + 2;
    var id = String(f[COL_OBL.ID] || '').trim();

    if (!id) {
      if (String(f[COL_OBL.CONCEPTO] || '').trim()) problemas.push('Fila ' + linea + ': falta el ID.');
      return;
    }
    if (vistos[id]) problemas.push('Fila ' + linea + ': el ID ' + id + ' está repetido.');
    vistos[id] = true;

    if (String(f[COL_OBL.ACTIVO]).toUpperCase() !== 'SI') return;

    var etiqueta = id + ' (' + (f[COL_OBL.CONCEPTO] || 'sin concepto') + ')';

    if (LISTAS.TIPO_MONTO.indexOf(f[COL_OBL.TIPO_MONTO]) === -1) {
      problemas.push(etiqueta + ': Tipo_Monto inválido. Tiene que ser ' + LISTAS.TIPO_MONTO.join(', ') + '.');
    }
    if (LISTAS.PERIODICIDAD.indexOf(f[COL_OBL.PERIODICIDAD]) === -1) {
      problemas.push(etiqueta + ': Periodicidad inválida. Tiene que ser ' + LISTAS.PERIODICIDAD.join(', ') + '.');
    }

    var monto = Number(f[COL_OBL.MONTO]);
    if (!isFinite(monto) || monto <= 0) {
      problemas.push(etiqueta + ': el Monto tiene que ser un número mayor que cero.');
    } else if (f[COL_OBL.TIPO_MONTO] === 'PCT_VENTAS' && monto > 100) {
      problemas.push(etiqueta + ': con Tipo_Monto PCT_VENTAS el Monto es un porcentaje, no puede ser ' + monto + '.');
    }

    problemas = problemas.concat(validarVencimiento(etiqueta, f[COL_OBL.PERIODICIDAD], f[COL_OBL.VENCIMIENTO]));

    var crit = Number(f[COL_OBL.CRITICIDAD]);
    if (!(crit >= 1 && crit <= 5)) {
      problemas.push(etiqueta + ': Criticidad tiene que ir de 1 a 5.');
    }
    if (!String(f[COL_OBL.CONSECUENCIA] || '').trim()) {
      problemas.push(etiqueta + ': falta Consecuencia_Atraso. Sin eso el motor de priorización no puede mostrar el trade-off.');
    }
    if (LISTAS.CUENTA.indexOf(f[COL_OBL.CUENTA]) === -1) {
      problemas.push(etiqueta + ': Cuenta inválida. Tiene que ser ' + LISTAS.CUENTA.join(' o ') + '.');
    }
  });

  return problemas;
}

function validarVencimiento(etiqueta, periodicidad, valor) {
  if (periodicidad === 'SEMANAL') {
    return DIAS_SEMANA.indexOf(String(valor).toUpperCase().trim()) === -1
      ? [etiqueta + ': con Periodicidad SEMANAL el Vencimiento tiene que ser ' + DIAS_SEMANA.join('/') + '.']
      : [];
  }
  if (periodicidad === 'MENSUAL' || periodicidad === 'BIMESTRAL') {
    var dia = Number(valor);
    return (dia >= 1 && dia <= 28)
      ? []
      : [etiqueta + ': con Periodicidad ' + periodicidad + ' el Vencimiento es el día del mes, de 1 a 28. ' +
         'Se corta en 28 para que febrero no lo corra solo.'];
  }
  if (periodicidad === 'UNICA') {
    return esFecha(valor)
      ? []
      : [etiqueta + ': con Periodicidad UNICA el Vencimiento tiene que ser una fecha.'];
  }
  return [];
}

/** `instanceof Date` falla entre contextos; esto no. */
function esFecha(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}
