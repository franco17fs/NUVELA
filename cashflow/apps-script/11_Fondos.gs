/**
 * NUVELA · Cashflow — Distribución diaria en fondos.
 *
 * La idea: ningún peso entra sin destino. Cada día la plata que generan las
 * ventas se reparte en este orden, y lo que sobra recién ahí es libre.
 *
 *   1. MERCADERÍA   — el costo de reponer lo que se vendió. No es ganancia.
 *   2. OBLIGACIONES — lo que hay que separar hoy para llegar a cada vencimiento.
 *   3. COLCHÓN      — hasta el objetivo de seguridad.
 *   4. ADELANTOS    — en días buenos, se adelantan reservas futuras.
 *   5. LIBRE        — lo único que es realmente disponible.
 *
 * El orden importa y es la Regla 1: separar para una obligación nunca puede
 * dejar al negocio sin plata para comprar mercadería, porque la mercadería se
 * descuenta primero.
 *
 * Todo es función pura sobre el registro de días: el estado se recalcula
 * reproduciendo la historia, nunca se acumula a mano. Así correr el cálculo
 * dos veces el mismo día no duplica nada.
 */

var COL_DIA = { FECHA: 0, BRUTO: 1, COMPRAS: 2, NOTAS: 3 };

var SEMAFORO = { VERDE: 'VERDE', AMARILLO: 'AMARILLO', ROJO: 'ROJO' };

// --- Colchón ----------------------------------------------------------------

/**
 * Cuánto debería ser el colchón, en función de lo que mueve el negocio.
 *
 * Se calcula como N días de operación completa: reponer mercadería, pagar la
 * moto y el prorrateo diario de todo lo que vence en el mes. Es lo que hace
 * falta para aguantar N días sin vender nada y no romper nada.
 */
function colchonSugerido(cfg, obligacionesDiarias) {
  var brutoDiario = (Number(cfg.VENTA_BRUTA_SEMANAL_BASE) || 0) / 7;
  var mercaderia = brutoDiario * (Number(cfg.PCT_COSTO_MERCADERIA) || 0) / 100;
  var moto = brutoDiario * (Number(cfg.PCT_MOTOMENSAJERIA) || 0) / 100;
  var dias = Number(cfg.DIAS_COLCHON) || 5;

  return Math.round((mercaderia + moto + (obligacionesDiarias || 0)) * dias);
}

/** Prorrateo diario de las obligaciones que no dependen de las ventas. */
function obligacionesPorDia(objetivos, desde, hasta) {
  var dias = Math.max(1, Math.round((hasta - desde) / MS_DIA));
  var total = objetivos.reduce(function (a, o) { return a + o.monto; }, 0);
  return total / dias;
}

// --- Objetivos de financiamiento --------------------------------------------

/**
 * Cada vencimiento concreto que hay que ir juntando, dentro del horizonte.
 *
 * La mercadería queda afuera a propósito: no se junta para comprarla, se
 * descuenta de cada venta. Meterla acá la contaría dos veces.
 */
function objetivosDeFinanciamiento(obligaciones, desde, hasta, cfg, brutoDiario) {
  var semanas = generarSemanas(desde, Math.ceil((hasta - desde) / MS_DIA / 7) + 1);
  var brutos = semanas.map(function () { return brutoDiario * 7; });

  return expandirObligaciones(obligaciones, semanas, brutos, cfg, desde)
    .filter(function (v) {
      // `generarSemanas` arranca el lunes de `desde`, así que puede traer
      // vencimientos anteriores al primer día registrado. Esos ya se pagaron
      // antes de que existiera este sistema y no hay que juntar plata para ellos.
      return v.categoria !== 'MERCADERIA' && v.fecha >= desde && v.fecha <= hasta && v.monto > 0;
    })
    .map(function (v) {
      return { id: v.id + '@' + formatearFecha(v.fecha), obligacionId: v.id, concepto: v.concepto,
               acreedor: v.acreedor, fecha: v.fecha, monto: v.monto,
               criticidad: v.criticidad, consecuencia: v.consecuencia };
    });
}

/** Días que faltan para el vencimiento. Nunca menos de 1: hoy también cuenta. */
function diasHasta(fecha, hoy) {
  return Math.max(1, Math.ceil((fecha - hoy) / MS_DIA));
}

/**
 * Orden de atención cuando la plata no alcanza para todos (Regla 2):
 * vencimiento más cercano, después criticidad, después el más descubierto.
 */
function ordenarObjetivos(objetivos, reservas, hoy) {
  return objetivos.slice().sort(function (a, b) {
    var da = diasHasta(a.fecha, hoy), db = diasHasta(b.fecha, hoy);
    if (da !== db) return da - db;
    if (b.criticidad !== a.criticidad) return b.criticidad - a.criticidad;
    var pa = 1 - (reservas[a.id] || 0) / a.monto;
    var pb = 1 - (reservas[b.id] || 0) / b.monto;
    return pb - pa;
  });
}

// --- Un día -----------------------------------------------------------------

/**
 * Reparte la plata de un día. No modifica el estado que recibe: devuelve el
 * detalle de la distribución y el estado nuevo.
 */
function distribuirDia(dia, estado, objetivos, cfg) {
  var bruto = Number(dia.bruto) || 0;
  var compras = Number(dia.compras) || 0;

  var neto = bruto * (Number(cfg.PCT_NETO_SOBRE_BRUTO) || 0) / 100;
  var reposicion = bruto * (Number(cfg.PCT_COSTO_MERCADERIA) || 0) / 100
                        * (1 + (Number(cfg.PCT_BUFFER_MERCADERIA) || 0) / 100);
  var margen = neto - reposicion;

  var reservas = {};
  for (var k in estado.reservas) reservas[k] = estado.reservas[k];
  var pagados = {};
  for (var p in estado.pagados) pagados[p] = estado.pagados[p];

  var fondoColchon = estado.fondoColchon;
  var fondoLibre = estado.fondoLibre;
  var fondoMercaderia = estado.fondoMercaderia;

  // 0. Liquidar lo que ya venció. La reserva existe para gastarse: si no se
  // vacía cuando llega el vencimiento, el fondo crece para siempre y no queda
  // nunca plata libre. Lo que faltó se saca del fondo menos doloroso primero.
  var liquidados = [];
  objetivos.forEach(function (o) {
    if (pagados[o.id] || o.fecha >= dia.fecha) return;

    var reservado = Math.min(reservas[o.id] || 0, o.monto);
    var faltante = o.monto - reservado;
    var origen = { reserva: reservado, libre: 0, colchon: 0, mercaderia: 0 };

    var deLibre = Math.min(faltante, fondoLibre);
    fondoLibre -= deLibre; origen.libre = deLibre; faltante -= deLibre;

    var deColchon = Math.min(faltante, fondoColchon);
    fondoColchon -= deColchon; origen.colchon = deColchon; faltante -= deColchon;

    if (faltante > 0) { fondoMercaderia -= faltante; origen.mercaderia = faltante; }

    reservas[o.id] = 0;
    pagados[o.id] = true;
    liquidados.push({ concepto: o.concepto, fecha: o.fecha, monto: o.monto,
                      origen: origen, saleDeMercaderia: origen.mercaderia });
  });

  // 1. Mercadería: entra la reposición, sale lo que se compró de verdad.
  fondoMercaderia += reposicion - compras;

  // 2 y 4. Obligaciones. Primero lo necesario de cada una, después adelantos.
  var disponible = Math.max(0, margen);
  var vigentes = objetivos.filter(function (o) { return !pagados[o.id]; });
  var orden = ordenarObjetivos(vigentes, reservas, dia.fecha);
  var asignado = {};

  orden.forEach(function (o) {
    var pendiente = Math.max(0, o.monto - (reservas[o.id] || 0));
    if (pendiente <= 0 || disponible <= 0) return;
    var necesario = Math.min(pendiente, pendiente / diasHasta(o.fecha, dia.fecha));
    var monto = Math.min(necesario, disponible);
    reservas[o.id] = (reservas[o.id] || 0) + monto;
    asignado[o.id] = monto;
    disponible -= monto;
  });

  // 3. Colchón, antes de adelantar nada y antes de liberar plata.
  var objetivoColchon = Number(cfg.COLCHON_MINIMO) || 0;
  var aColchon = Math.min(Math.max(0, objetivoColchon - fondoColchon), disponible);
  disponible -= aColchon;

  // 4. Día bueno: se adelantan reservas para descomprimir los días que vienen.
  var adelantado = 0;
  if (disponible > 0) {
    orden.forEach(function (o) {
      var pendiente = Math.max(0, o.monto - (reservas[o.id] || 0));
      if (pendiente <= 0 || disponible <= 0) return;
      var monto = Math.min(pendiente, disponible);
      reservas[o.id] = (reservas[o.id] || 0) + monto;
      asignado[o.id] = (asignado[o.id] || 0) + monto;
      adelantado += monto;
      disponible -= monto;
    });
  }

  var aObligaciones = orden.reduce(function (a, o) { return a + (asignado[o.id] || 0); }, 0);

  return {
    fecha: dia.fecha,
    bruto: Math.round(bruto),
    neto: Math.round(neto),
    costoMercaderia: Math.round(reposicion),
    margen: Math.round(margen),
    compras: Math.round(compras),
    aMercaderia: Math.round(reposicion),
    aObligaciones: Math.round(aObligaciones),
    adelantado: Math.round(adelantado),
    aColchon: Math.round(aColchon),
    libre: Math.round(Math.max(0, disponible)),
    asignado: asignado,
    liquidados: liquidados,
    estado: {
      fondoMercaderia: fondoMercaderia,
      fondoColchon: fondoColchon + aColchon,
      fondoLibre: fondoLibre + Math.max(0, disponible),
      reservas: reservas,
      pagados: pagados
    }
  };
}

// --- La historia completa ---------------------------------------------------

/**
 * Reproduce todos los días en orden y devuelve el estado final más el detalle
 * de cada día. Recalcular desde cero es lo que hace que el sistema sea
 * idempotente: no hay saldos escritos a mano que se puedan desincronizar.
 */
function reproducirDias(dias, objetivos, cfg, pagados) {
  var estado = { fondoMercaderia: Number(cfg.FONDO_MERCADERIA_INICIAL) || 0,
                 fondoColchon: 0, fondoLibre: 0, reservas: {}, pagados: pagados || {} };
  var detalle = [];

  dias.slice().sort(function (a, b) { return a.fecha - b.fecha; }).forEach(function (d) {
    var r = distribuirDia(d, estado, objetivos, cfg);
    estado = r.estado;
    detalle.push(r);
  });

  return { estado: estado, dias: detalle };
}

// --- Estado de cada fondo ---------------------------------------------------

/** Objetivos todavía vigentes: lo ya liquidado sale del cuadro. */
function objetivosVigentes(objetivos, estado) {
  return objetivos.filter(function (o) { return !estado.pagados[o.id]; });
}

function estadoDeObjetivos(objetivos, estado, hoy) {
  return ordenarObjetivos(objetivosVigentes(objetivos, estado), estado.reservas, hoy).map(function (o) {
    var reservado = Math.round(estado.reservas[o.id] || 0);
    var pendiente = Math.max(0, o.monto - reservado);
    var dias = diasHasta(o.fecha, hoy);
    return {
      id: o.id, concepto: o.concepto, acreedor: o.acreedor, fecha: o.fecha,
      total: o.monto, reservado: reservado, pendiente: pendiente,
      cubierto: o.monto > 0 ? reservado / o.monto : 1,
      dias: dias,
      porDia: Math.round(pendiente / dias),
      criticidad: o.criticidad, consecuencia: o.consecuencia,
      vencido: o.fecha < hoy && pendiente > 0
    };
  });
}

/** Plata en caja partida en cuatro: nunca todo junto. */
function reparto(estado, objetivos) {
  var enObligaciones = objetivosVigentes(objetivos, estado).reduce(function (a, o) {
    return a + Math.min(estado.reservas[o.id] || 0, o.monto);
  }, 0);

  return {
    mercaderia: Math.round(estado.fondoMercaderia),
    obligaciones: Math.round(enObligaciones),
    colchon: Math.round(estado.fondoColchon),
    libre: Math.round(estado.fondoLibre),
    total: Math.round(estado.fondoMercaderia + enObligaciones + estado.fondoColchon + estado.fondoLibre)
  };
}

// --- Riesgo -----------------------------------------------------------------

/** Margen promedio por día de los últimos días con ventas. */
function margenDiarioPromedio(dias, cuantos) {
  var ultimos = dias.slice(-(cuantos || 14)).filter(function (d) { return d.bruto > 0; });
  if (!ultimos.length) return 0;
  return ultimos.reduce(function (a, d) { return a + d.margen; }, 0) / ultimos.length;
}

/**
 * Obligaciones que no se llegan a cubrir al ritmo actual (Regla 5).
 *
 * Cada una se mide contra lo que queda de margen después de las que vencen
 * antes: la que vence primero se come el margen primero.
 */
function riesgos(objetivos, estado, hoy, margenDiario) {
  var lista = estadoDeObjetivos(objetivos, estado, hoy);
  var comprometido = 0;
  var out = [];

  lista.forEach(function (o) {
    if (o.pendiente <= 0) return;
    var disponiblePorDia = margenDiario - comprometido;
    comprometido += o.porDia;
    if (o.porDia > disponiblePorDia) {
      out.push({
        concepto: o.concepto, fecha: o.fecha, pendiente: o.pendiente, dias: o.dias,
        necesarioPorDia: o.porDia,
        disponiblePorDia: Math.round(Math.max(0, disponiblePorDia)),
        faltantePorDia: Math.round(o.porDia - Math.max(0, disponiblePorDia)),
        consecuencia: o.consecuencia
      });
    }
  });

  return out;
}

/** Qué hacer con cada riesgo, en orden de menor a mayor daño. */
function propuestasParaRiesgo(riesgo, estado, cfg, margenDiario) {
  var p = [];

  if (estado.fondoLibre > 0) {
    p.push('Usar ' + pesos(Math.min(estado.fondoLibre, riesgo.pendiente)) +
           ' del fondo libre: es lo único que no le saca nada al negocio.');
  }

  var deMasDias = Math.ceil(riesgo.faltantePorDia * riesgo.dias / Math.max(1, margenDiario));
  if (margenDiario > 0) {
    p.push('Separar ' + pesos(riesgo.faltantePorDia) + ' más por día durante ' + riesgo.dias +
           ' días. Equivale a ' + deMasDias + ' días de margen completo.');
  }

  p.push('Postergar compras de mercadería no urgentes: cada ' +
         pesos(riesgo.faltantePorDia * riesgo.dias) + ' que no se compra cubre este vencimiento, ' +
         'pero baja las ventas de las semanas siguientes.');

  if (estado.fondoColchon > 0) {
    p.push('Tocar el colchón (' + pesos(estado.fondoColchon) + '). Es lo último: ' +
           'te deja sin red para el próximo día malo.');
  }

  return p;
}

// --- Semáforo ---------------------------------------------------------------

function semaforo(estado, objetivos, hoy, margenDiario, cfg) {
  var lista = estadoDeObjetivos(objetivos, estado, hoy);
  var enRiesgo = riesgos(objetivos, estado, hoy, margenDiario);
  var vencidos = lista.filter(function (o) { return o.vencido; });
  var necesarioTotal = lista.reduce(function (a, o) { return a + o.porDia; }, 0);
  var objetivoColchon = Number(cfg.COLCHON_MINIMO) || 0;

  if (estado.fondoMercaderia < 0) {
    return { estado: SEMAFORO.ROJO,
             porque: 'El fondo de mercadería está en ' + pesos(estado.fondoMercaderia) +
                     ': se compró más de lo que las ventas repusieron.' };
  }
  if (vencidos.length) {
    return { estado: SEMAFORO.ROJO,
             porque: vencidos.length + (vencidos.length === 1 ? ' obligación venció' : ' obligaciones vencieron') +
                     ' sin estar cubiertas: ' +
                     vencidos.slice(0, 3).map(function (o) { return o.concepto; }).join(', ') +
                     (vencidos.length > 3 ? ' y ' + (vencidos.length - 3) + ' más' : '') + '.' };
  }
  if (enRiesgo.length) {
    return { estado: SEMAFORO.ROJO,
             porque: 'Al ritmo actual no se llega a ' + enRiesgo[0].concepto + ' del ' +
                     formatearFecha(enRiesgo[0].fecha) + ': hacen falta ' +
                     pesos(enRiesgo[0].necesarioPorDia) + ' por día y hay ' +
                     pesos(enRiesgo[0].disponiblePorDia) + '.' };
  }
  if (margenDiario > 0 && necesarioTotal > margenDiario * 0.8) {
    return { estado: SEMAFORO.AMARILLO,
             porque: 'Se llega, pero las obligaciones se comen el ' +
                     Math.round(necesarioTotal / margenDiario * 100) + '% del margen diario. ' +
                     'Un par de días flojos y pasa a rojo.' };
  }
  if (estado.fondoColchon < objetivoColchon) {
    return { estado: SEMAFORO.AMARILLO,
             porque: 'Las obligaciones están cubiertas, pero el colchón tiene ' +
                     pesos(estado.fondoColchon) + ' de un objetivo de ' + pesos(objetivoColchon) + '.' };
  }
  return { estado: SEMAFORO.VERDE,
           porque: 'Mercadería, obligaciones y colchón cubiertos. Lo que sobra es realmente libre.' };
}

// --- Criterio ---------------------------------------------------------------

/**
 * Lectura del estado, no solo los números. Es la parte que dice si estamos
 * separando de más, comprando de más o juntando plata sin sentido.
 */
function diagnostico(estado, objetivos, dias, cfg, hoy) {
  var obs = [];
  var lista = estadoDeObjetivos(objetivos, estado, hoy);
  var margenDiario = margenDiarioPromedio(dias);
  var reparto_ = reparto(estado, objetivos);
  var comprasDiarias = dias.length
    ? dias.reduce(function (a, d) { return a + d.compras; }, 0) / dias.length : 0;
  var reposicionDiaria = dias.length
    ? dias.reduce(function (a, d) { return a + d.costoMercaderia; }, 0) / dias.length : 0;

  if (comprasDiarias > reposicionDiaria * 1.15 && dias.length >= 7) {
    obs.push({ tipo: 'COMPRAS',
      texto: 'Estás comprando ' + pesos(comprasDiarias) + ' por día contra una reposición de ' +
             pesos(reposicionDiaria) + '. Comprás más rápido de lo que vendés: eso es stock ' +
             'inmovilizado y sale de la plata de las obligaciones.' });
  } else if (comprasDiarias > 0 && comprasDiarias < reposicionDiaria * 0.85 && dias.length >= 7) {
    obs.push({ tipo: 'COMPRAS',
      texto: 'Estás comprando ' + pesos(comprasDiarias) + ' por día contra una reposición de ' +
             pesos(reposicionDiaria) + '. Si no es a propósito, en 2 o 3 semanas se va a notar en las ventas.' });
  }

  if (estado.fondoMercaderia > reposicionDiaria * 20 && reposicionDiaria > 0) {
    obs.push({ tipo: 'CAJA',
      texto: 'El fondo de mercadería tiene ' + pesos(estado.fondoMercaderia) + ', más de 20 días de ' +
             'reposición. Es plata quieta: o se compra, o se pasa a adelantar obligaciones.' });
  }

  var todoCubierto = lista.every(function (o) { return o.pendiente === 0; });
  if (todoCubierto && reparto_.libre > 0) {
    obs.push({ tipo: 'LIBRE',
      texto: 'Todas las obligaciones del horizonte están cubiertas y hay ' + pesos(reparto_.libre) +
             ' libres. Esta plata sí se puede retirar sin comprometer nada.' });
  }

  if (!todoCubierto && reparto_.libre > margenDiario * 3 && margenDiario > 0) {
    obs.push({ tipo: 'LIBRE',
      texto: 'Hay ' + pesos(reparto_.libre) + ' en el fondo libre con obligaciones todavía ' +
             'descubiertas. Conviene adelantar reservas antes de retirar.' });
  }

  var objetivoColchon = Number(cfg.COLCHON_MINIMO) || 0;
  if (estado.fondoColchon < objetivoColchon * 0.5 && objetivoColchon > 0) {
    obs.push({ tipo: 'COLCHON',
      texto: 'El colchón está en ' + pesos(estado.fondoColchon) + ' de un objetivo de ' +
             pesos(objetivoColchon) + '. Sin red, un día malo se paga sacando de mercadería.' });
  }

  return obs;
}
