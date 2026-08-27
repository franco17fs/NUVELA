/**
 * NUVELA · Cashflow — Motor de proyección.
 *
 * Funciones puras: no tocan el Sheet. Reciben datos, devuelven datos.
 * Todo lo que sea leer o escribir celdas vive en 07_Proyeccion.gs.
 *
 * La proyección es un arrastre semanal simple:
 *   saldo_final = saldo_inicial + ingresos - egresos
 *   saldo_inicial de la semana siguiente = saldo_final de esta
 *
 * Lo que no es simple, y por eso está acá, es cómo se arma cada término.
 */

var COL_VENTAS = { NUMERO: 0, DESDE: 1, HASTA: 2, PROYECTADO: 3, REAL: 4, NETO: 5, NOTAS: 6 };
var COL_MOV = { FECHA: 0, TIPO: 1, CONCEPTO: 2, OBLIGACION: 3, MONTO: 4, CUENTA: 5, NOTAS: 6 };

/** Categorías que se muestran en su propia columna del cashflow. */
var COLUMNA_POR_CATEGORIA = {
  MERCADERIA: 'mercaderia',
  IMPUESTOS: 'impuestos',
  DEUDA_FAMILIAR: 'deuda',
  DEUDA_FINANCIERA: 'deuda'
};

var ESTADO = { OK: 'OK', ATENCION: 'ATENCION', ROJO: 'ROJO' };

var MS_DIA = 86400000;

// --- Fechas -----------------------------------------------------------------

function mismaFecha(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function enRango(fecha, desde, hasta) {
  return fecha >= desde && fecha <= hasta;
}

/** Meses fraccionarios entre dos fechas. Negativo si `fecha` es anterior. */
function mesesEntre(base, fecha) {
  return ((fecha - base) / MS_DIA) / 30.44;
}

/**
 * Cuánto crece un monto por inflación de acá a `fecha`.
 * Nunca achica: una obligación de esta semana vale lo que vale hoy.
 */
function factorInflacion(base, fecha, pctMensual) {
  var meses = mesesEntre(base, fecha);
  if (!(pctMensual > 0) || meses <= 0) return 1;
  return Math.pow(1 + pctMensual / 100, meses);
}

// --- Expansión de obligaciones ----------------------------------------------

/**
 * Convierte una obligación (una fila) en las fechas concretas en que vence
 * dentro del rango. Es el paso que traduce "todos los lunes" a fechas reales.
 */
function ocurrenciasDeObligacion(obl, desde, hasta) {
  var periodicidad = obl[COL_OBL.PERIODICIDAD];
  var vencimiento = obl[COL_OBL.VENCIMIENTO];
  var fechas = [];

  if (periodicidad === 'SEMANAL') {
    var objetivo = DIAS_SEMANA.indexOf(String(vencimiento).toUpperCase().trim());
    if (objetivo === -1) return [];
    // DIAS_SEMANA arranca en lunes; getDay() arranca en domingo.
    var dow = (objetivo + 1) % 7;
    for (var d = new Date(desde.getTime()); d <= hasta; d = sumarDias(d, 1)) {
      if (d.getDay() === dow) fechas.push(new Date(d.getTime()));
    }
    return fechas;
  }

  if (periodicidad === 'MENSUAL' || periodicidad === 'BIMESTRAL') {
    var dia = Number(vencimiento);
    if (!(dia >= 1 && dia <= 28)) return [];
    var paso = periodicidad === 'BIMESTRAL' ? 2 : 1;
    // Se arranca un mes antes por si el rango empieza pasado el día de vencimiento.
    var cursor = new Date(desde.getFullYear(), desde.getMonth() - paso, dia);
    while (cursor <= hasta) {
      if (enRango(cursor, desde, hasta)) fechas.push(new Date(cursor.getTime()));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + paso, dia);
    }
    return fechas;
  }

  if (periodicidad === 'UNICA') {
    return esFecha(vencimiento) && enRango(vencimiento, desde, hasta)
      ? [new Date(vencimiento.getFullYear(), vencimiento.getMonth(), vencimiento.getDate())]
      : [];
  }

  return [];
}

/** Índice de la semana que contiene la fecha, o -1. */
function semanaDe(semanas, fecha) {
  for (var i = 0; i < semanas.length; i++) {
    if (enRango(fecha, semanas[i].desde, sumarDias(semanas[i].hasta, 1))) {
      if (fecha <= semanas[i].hasta) return i;
    }
  }
  return -1;
}

/**
 * Todas las obligaciones activas convertidas en vencimientos concretos, con el
 * monto ya resuelto: porcentaje sobre las ventas de esa semana si corresponde,
 * y ajuste por inflación si la obligación lo pide.
 */
function expandirObligaciones(obligaciones, semanas, brutoPorSemana, cfg, hoy) {
  if (!semanas.length) return [];
  var desde = semanas[0].desde;
  var hasta = semanas[semanas.length - 1].hasta;
  var inflacion = Number(cfg.INFLACION_MENSUAL_PCT) || 0;
  var vencimientos = [];

  obligaciones.forEach(function (obl) {
    if (String(obl[COL_OBL.ACTIVO]).toUpperCase() !== 'SI') return;

    ocurrenciasDeObligacion(obl, desde, hasta).forEach(function (fecha) {
      var semana = semanaDe(semanas, fecha);
      if (semana === -1) return;

      var monto;
      if (obl[COL_OBL.TIPO_MONTO] === 'PCT_VENTAS') {
        monto = (brutoPorSemana[semana] || 0) * Number(obl[COL_OBL.MONTO]) / 100;
      } else {
        monto = Number(obl[COL_OBL.MONTO]) || 0;
      }

      if (String(obl[COL_OBL.AJUSTA]).toUpperCase() === 'SI') {
        monto *= factorInflacion(hoy, fecha, inflacion);
      }

      vencimientos.push({
        id: obl[COL_OBL.ID],
        fecha: fecha,
        semana: semana,
        concepto: obl[COL_OBL.CONCEPTO],
        acreedor: obl[COL_OBL.ACREEDOR],
        categoria: obl[COL_OBL.CATEGORIA],
        criticidad: Number(obl[COL_OBL.CRITICIDAD]) || 0,
        consecuencia: obl[COL_OBL.CONSECUENCIA],
        cuenta: obl[COL_OBL.CUENTA],
        monto: Math.round(monto)
      });
    });
  });

  return vencimientos.sort(function (a, b) { return a.fecha - b.fecha; });
}

/**
 * Movimientos de un escenario ("qué pasa si compro $X el día D"), convertidos
 * al mismo formato que los vencimientos reales para que el motor no distinga.
 * Se descartan los que caen fuera de las 13 semanas.
 */
function extrasComoVencimientos(extras, semanas) {
  if (!extras || !extras.length) return [];

  return extras.map(function (e, i) {
    return {
      id: 'SIM-' + (i + 1),
      fecha: e.fecha,
      semana: semanaDe(semanas, e.fecha),
      concepto: e.concepto || 'Movimiento simulado',
      acreedor: e.acreedor || 'Escenario',
      categoria: e.categoria || 'MERCADERIA',
      criticidad: e.criticidad || 4,
      consecuencia: e.consecuencia || 'Movimiento del escenario.',
      cuenta: 'MERCADO_PAGO',
      monto: Math.round(Number(e.monto) || 0)
    };
  }).filter(function (e) { return e.semana !== -1 && e.monto > 0; });
}

// --- Ingresos ---------------------------------------------------------------

/**
 * Reparte las ventas de cada semana en las semanas en que la plata se acredita.
 *
 * Con LAG_ACREDITACION_DIAS = 1, lo vendido de lunes a sábado se cobra en la
 * misma semana y lo del domingo cae en la siguiente: 6/7 y 1/7. La misma
 * cuenta sirve para un plazo de 7 o 14 días, que desplaza semanas enteras.
 */
function distribuirIngresos(brutoPorSemana, pctNeto, lagDias) {
  var n = brutoPorSemana.length;
  var ingresos = new Array(n).fill(0);
  var corrimiento = Math.floor(lagDias / 7);
  var resto = lagDias % 7;
  var fraccionSiguiente = resto / 7;

  for (var i = 0; i < n; i++) {
    var neto = (brutoPorSemana[i] || 0) * pctNeto / 100;
    var destino = i + corrimiento;
    if (destino < n) ingresos[destino] += neto * (1 - fraccionSiguiente);
    if (destino + 1 < n) ingresos[destino + 1] += neto * fraccionSiguiente;
  }

  // La cola que entra desde antes del arranque: lo vendido justo antes del
  // lunes de la semana 1, que todavía no está en el saldo. Se estima con el
  // ritmo de la primera semana.
  if (n > 0 && fraccionSiguiente > 0) {
    ingresos[0] += (brutoPorSemana[0] || 0) * pctNeto / 100 * fraccionSiguiente;
  }

  return ingresos.map(function (v) { return Math.round(v); });
}

// --- Proyección -------------------------------------------------------------

/**
 * Arma las 13 filas del cashflow.
 *
 * `pagados` es un set de "OBL-XXX|semana": vencimientos que ya se pagaron y no
 * hay que volver a restar. Sin esto la semana en curso miente siempre.
 */
function proyectar(entrada) {
  var semanas = entrada.semanas;
  var cfg = entrada.cfg;
  var saldoInicial = (Number(cfg.SALDO_MERCADO_PAGO) || 0) + (Number(cfg.SALDO_EFECTIVO) || 0);
  var colchon = Number(cfg.COLCHON_MINIMO) || 0;

  var ingresos = distribuirIngresos(
    entrada.brutoPorSemana,
    Number(cfg.PCT_NETO_SOBRE_BRUTO) || 0,
    Number(cfg.LAG_ACREDITACION_DIAS) || 0
  );

  var vencimientos = expandirObligaciones(
    entrada.obligaciones, semanas, entrada.brutoPorSemana, cfg, entrada.hoy
  ).concat(extrasComoVencimientos(entrada.extras, semanas));

  var filas = [];
  var saldo = saldoInicial;

  for (var i = 0; i < semanas.length; i++) {
    var pagados = entrada.pagados || {};
    var todos = vencimientos.filter(function (v) { return v.semana === i; });
    // Los ya pagados no se restan de nuevo, pero se guardan: "Esta Semana"
    // tiene que mostrar la semana completa, incluido lo que ya se hizo.
    var yaPagados = todos.filter(function (v) { return pagados[v.id + '|' + i]; });
    var delSemana = todos.filter(function (v) { return !pagados[v.id + '|' + i]; });

    var egresos = { mercaderia: 0, impuestos: 0, deuda: 0, fijos: 0 };
    delSemana.forEach(function (v) {
      var destino = COLUMNA_POR_CATEGORIA[v.categoria] || 'fijos';
      egresos[destino] += v.monto;
    });

    var total = egresos.mercaderia + egresos.impuestos + egresos.deuda + egresos.fijos;
    var saldoFinal = saldo + ingresos[i] - total;

    filas.push({
      numero: semanas[i].numero,
      desde: semanas[i].desde,
      hasta: semanas[i].hasta,
      saldoInicial: Math.round(saldo),
      ingresos: ingresos[i],
      mercaderia: egresos.mercaderia,
      fijos: egresos.fijos,
      impuestos: egresos.impuestos,
      deuda: egresos.deuda,
      saldoFinal: Math.round(saldoFinal),
      estado: saldoFinal < 0 ? ESTADO.ROJO : (saldoFinal < colchon ? ESTADO.ATENCION : ESTADO.OK),
      vencimientos: delSemana,
      yaPagados: yaPagados
    });

    saldo = saldoFinal;
  }

  return { filas: filas, quiebre: primerQuiebre(filas, entrada.hoy) };
}

/**
 * La primera semana que cierra en negativo, y cuántos días faltan.
 * Es el número que contesta "¿cuánto aire me queda?".
 */
function primerQuiebre(filas, hoy) {
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].estado !== ESTADO.ROJO) continue;
    return {
      semana: filas[i].numero,
      desde: filas[i].desde,
      hasta: filas[i].hasta,
      faltan: -filas[i].saldoFinal,
      dias: Math.max(0, Math.round((filas[i].hasta - hoy) / MS_DIA))
    };
  }
  return null;
}

/** Primera semana que perfora el colchón, aunque no llegue a negativo. */
function primeraAtencion(filas) {
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].estado === ESTADO.ATENCION) return filas[i];
  }
  return null;
}

/** Los vencimientos más grandes de la semana, para la columna Detalle. */
function resumenDeSemana(fila, cuantos) {
  return fila.vencimientos
    .slice()
    .sort(function (a, b) { return b.monto - a.monto; })
    .slice(0, cuantos || 3)
    .map(function (v) { return v.concepto + ' ' + pesos(v.monto); })
    .join(' · ');
}

function formatearFecha(d) {
  return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function pesos(n) {
  var entero = Math.round(Math.abs(n)).toString();
  var partes = [];
  while (entero.length > 3) {
    partes.unshift(entero.slice(-3));
    entero = entero.slice(0, -3);
  }
  partes.unshift(entero);
  return (n < 0 ? '-$' : '$') + partes.join('.');
}
