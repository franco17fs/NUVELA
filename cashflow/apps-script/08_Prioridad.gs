/**
 * NUVELA · Cashflow — Motor de priorización.
 *
 * Cuando la plata no alcanza para todos los vencimientos de la semana, esto
 * ordena y parte la lista en dos: lo que entra y lo que queda afuera.
 *
 * No decide nada. Ordena según el criterio cargado en la planilla y muestra el
 * trade-off con la consecuencia escrita al lado. La decisión es de Franco.
 *
 * Funciones puras: no tocan el Sheet.
 */

var ESTADO_PAGO = { PAGADO: 'PAGADO', ALCANZA: 'ALCANZA', NO_ALCANZA: 'NO ALCANZA' };

/**
 * Orden en que se pagan los vencimientos de una semana:
 *
 *   1. Criticidad, de mayor a menor. Es el criterio principal y está cargado a
 *      mano en Obligaciones, así que se cambia editando la planilla y no el código.
 *   2. A igual criticidad, lo que vence antes.
 *   3. A igual fecha, lo más barato primero: con plata limitada, pagar los chicos
 *      deja menos acreedores golpeados que pagar uno grande.
 *
 * El tercer criterio es una heurística, no una ley. Está acá a la vista para
 * que se pueda discutir, y se sobreescribe subiendo la criticidad de una fila.
 */
function ordenarPorPrioridad(vencimientos) {
  return vencimientos.slice().sort(function (a, b) {
    if (b.criticidad !== a.criticidad) return b.criticidad - a.criticidad;
    if (a.fecha - b.fecha !== 0) return a.fecha - b.fecha;
    return a.monto - b.monto;
  });
}

/**
 * Reparte la plata disponible entre los vencimientos, en orden de prioridad.
 *
 * Si un vencimiento no entra, se sigue con los que siguen: uno grande que no
 * entra no tiene por qué bloquear a tres chicos que sí. Eso deja más
 * obligaciones cubiertas, que es lo que importa cuando falta plata.
 */
function planDePago(vencimientos, disponible) {
  var orden = ordenarPorPrioridad(vencimientos);
  var restante = disponible;
  var pagados = [];
  var sinPagar = [];

  orden.forEach(function (v) {
    if (v.monto <= restante) {
      restante -= v.monto;
      pagados.push(v);
    } else {
      sinPagar.push(v);
    }
  });

  var comprometido = orden.reduce(function (a, v) { return a + v.monto; }, 0);
  var faltante = sinPagar.reduce(function (a, v) { return a + v.monto; }, 0);

  return {
    orden: orden,
    pagados: pagados,
    sinPagar: sinPagar,
    disponible: disponible,
    comprometido: comprometido,

    // Dos números distintos, y confundirlos lleva a decisiones equivocadas:
    //
    //   deficit  — cuánta plata hay que conseguir para pagar TODO.
    //   faltante — cuánto suma lo que queda entero sin pagar.
    //
    // Son distintos porque un vencimiento entra o no entra: si faltan $47.000
    // para una compra de $1.293.600, el déficit es $47.000 pero lo que queda
    // afuera es la compra completa. El déficit es el número para salir a
    // buscar plata; el faltante es lo que se deja de hacer si no aparece.
    deficit: Math.max(0, comprometido - disponible),
    faltante: faltante,

    sobrante: Math.max(0, restante),
    alcanza: sinPagar.length === 0
  };
}

/**
 * Lo que se pierde por no pagar: las consecuencias de lo que quedó afuera,
 * de lo más crítico a lo menos. Es el texto que Franco cargó, sin reescribir.
 */
function consecuenciasDe(plan) {
  return plan.sinPagar.map(function (v) {
    return { concepto: v.concepto, acreedor: v.acreedor, monto: v.monto,
             criticidad: v.criticidad, consecuencia: v.consecuencia };
  });
}

/** Estado de un vencimiento no pagado: entra o no entra con la plata que hay. */
function estadoDe(v, plan) {
  return plan.sinPagar.indexOf(v) === -1 ? ESTADO_PAGO.ALCANZA : ESTADO_PAGO.NO_ALCANZA;
}

/**
 * Las tres respuestas de la pantalla de inicio:
 * qué hay que pagar, cuánta plata va a haber, y si falta, cuánto.
 */
function resumenSemanal(fila, plan) {
  return {
    desde: fila.desde,
    hasta: fila.hasta,
    tenesHoy: fila.saldoInicial,
    vaAEntrar: fila.ingresos,
    tenesQuePagar: plan.comprometido,
    disponible: plan.disponible,
    deficit: plan.deficit,
    falta: plan.alcanza ? 0 : plan.faltante,
    alcanza: plan.alcanza,
    cuantos: plan.orden.length,
    sinPagar: plan.sinPagar.length
  };
}

/**
 * Cuánto flujo mensual se libera cuando termina cada deuda.
 * Contesta "¿cuándo dejo de estar ahogado?" sin tener que hacer la cuenta.
 */
function liberacionDeFlujo(deudas) {
  return deudas
    .filter(function (d) { return String(d[COL_DEU.ACTIVO]).toUpperCase() === 'SI'; })
    .map(function (d) {
      var cuotas = Number(d[COL_DEU.CUOTAS]) || 0;
      return {
        acreedor: d[COL_DEU.ACREEDOR],
        concepto: d[COL_DEU.CONCEPTO],
        saldo: Number(d[COL_DEU.SALDO]) || 0,
        cuota: Number(d[COL_DEU.CUOTA]) || 0,
        cuotas: cuotas,
        libera: cuotas > 0 ? Number(d[COL_DEU.CUOTA]) || 0 : 0
      };
    })
    .sort(function (a, b) { return a.cuotas - b.cuotas; });
}

var COL_DEU = {
  ID: 0, ACTIVO: 1, ACREEDOR: 2, CONCEPTO: 3, ORIGINAL: 4, SALDO: 5,
  CUOTA: 6, CUOTAS: 7, PROXIMO: 8, INTERES: 9, FORMA: 10, CRITICIDAD: 11, NOTAS: 12
};
