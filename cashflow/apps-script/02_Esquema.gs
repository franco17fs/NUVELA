/**
 * NUVELA · Cashflow — Estructura de las hojas.
 *
 * Cinco hojas se cargan a mano, tres las escribe el sistema.
 * Las generadas son de solo lectura: si algo sale mal, se arregla en las de entrada.
 */

var LISTAS = {
  SI_NO: ['SI', 'NO'],
  TIPO_MONTO: ['FIJO', 'ESTIMADO', 'PCT_VENTAS'],
  PERIODICIDAD: ['UNICA', 'SEMANAL', 'MENSUAL', 'BIMESTRAL'],
  CATEGORIA: ['ALQUILER', 'PLATAFORMA', 'LOGISTICA', 'MERCADERIA', 'IMPUESTOS',
              'PROFESIONALES', 'PUBLICIDAD', 'RETIRO', 'DEUDA_FAMILIAR',
              'DEUDA_FINANCIERA', 'SERVICIOS', 'OTROS'],
  CUENTA: ['MERCADO_PAGO', 'EFECTIVO'],
  CRITICIDAD: [1, 2, 3, 4, 5],
  TIPO_MOV: ['INGRESO', 'EGRESO']
};

var MONEDA = '"$"#,##0';
var FECHA = 'dd/mm/yyyy';

var ESQUEMA = {

  CONFIG: {
    nombre: 'Config',
    generada: false,
    descripcion: 'Parámetros. Tocá la columna Valor; el resto es documentación.',
    columnas: [
      { titulo: 'Clave', ancho: 240 },
      { titulo: 'Valor', ancho: 120 },
      { titulo: 'Unidad', ancho: 90 },
      { titulo: 'Qué significa', ancho: 520 },
      { titulo: 'Origen', ancho: 100, lista: ['MEDIDO', 'DECLARADO', 'ESTIMADO', 'CONFIRMAR'] }
    ]
  },

  OBLIGACIONES: {
    nombre: 'Obligaciones',
    generada: false,
    descripcion: 'Todo lo que hay que pagar. Una fila por concepto, no por vencimiento.',
    columnas: [
      { titulo: 'ID', ancho: 80 },
      { titulo: 'Activo', ancho: 70, lista: LISTAS.SI_NO },
      { titulo: 'Concepto', ancho: 230 },
      { titulo: 'Acreedor', ancho: 170 },
      { titulo: 'Categoria', ancho: 150, lista: LISTAS.CATEGORIA },
      { titulo: 'Criticidad', ancho: 90, lista: LISTAS.CRITICIDAD,
        nota: '5 = te corta el ingreso o la operación. 1 = se puede diferir sin costo real.' },
      { titulo: 'Tipo_Monto', ancho: 110, lista: LISTAS.TIPO_MONTO,
        nota: 'FIJO: monto exacto. ESTIMADO: aproximado, se recalibra. PCT_VENTAS: la columna Monto lleva un porcentaje de la facturación bruta.' },
      { titulo: 'Monto', ancho: 120, formato: MONEDA },
      { titulo: 'Periodicidad', ancho: 110, lista: LISTAS.PERIODICIDAD },
      { titulo: 'Vencimiento', ancho: 110,
        nota: 'MENSUAL o BIMESTRAL: día del mes (1 a 28). SEMANAL: LUN MAR MIE JUE VIE SAB DOM. UNICA: fecha dd/mm/aaaa.' },
      { titulo: 'Ajusta_Inflacion', ancho: 120, lista: LISTAS.SI_NO,
        nota: 'SI: el monto proyectado crece con la inflación configurada. Los impuestos van en NO porque se calculan sobre ventas.' },
      { titulo: 'Consecuencia_Atraso', ancho: 420,
        nota: 'Qué pasa DE VERDAD si no lo pagás. Escribilo con tus palabras: el motor de priorización lo muestra tal cual.' },
      { titulo: 'Cuenta', ancho: 130, lista: LISTAS.CUENTA },
      { titulo: 'Notas', ancho: 460 }
    ]
  },

  DEUDAS: {
    nombre: 'Deudas',
    generada: false,
    descripcion: 'Saldo vivo de cada crédito. Muestra cuánto flujo se libera al terminar cada uno.',
    columnas: [
      { titulo: 'ID', ancho: 80 },
      { titulo: 'Activo', ancho: 70, lista: LISTAS.SI_NO },
      { titulo: 'Acreedor', ancho: 180 },
      { titulo: 'Concepto', ancho: 280 },
      { titulo: 'Monto_Original', ancho: 130, formato: MONEDA },
      { titulo: 'Saldo_Actual', ancho: 130, formato: MONEDA },
      { titulo: 'Valor_Cuota', ancho: 120, formato: MONEDA },
      { titulo: 'Cuotas_Restantes', ancho: 130 },
      { titulo: 'Proximo_Vencimiento', ancho: 150, formato: FECHA },
      { titulo: 'Interes_Punitorio', ancho: 250 },
      { titulo: 'Forma_Cobro', ancho: 330,
        nota: 'Clave: si se descuenta de las ventas es MENOS INGRESO, no un egreso. Confundirlo rompe la proyección.' },
      { titulo: 'Criticidad', ancho: 90, lista: LISTAS.CRITICIDAD },
      { titulo: 'Notas', ancho: 420 }
    ]
  },

  VENTAS: {
    nombre: 'Ventas',
    generada: false,
    descripcion: 'Una fila por semana. Es la única carga que se repite: proyectás y después completás el real.',
    columnas: [
      { titulo: 'Semana', ancho: 80 },
      { titulo: 'Desde', ancho: 110, formato: FECHA },
      { titulo: 'Hasta', ancho: 110, formato: FECHA },
      { titulo: 'Bruto_Proyectado', ancho: 150, formato: MONEDA,
        nota: 'Lo que estimás que van a pagar los compradores esta semana (precio de venta completo).' },
      { titulo: 'Bruto_Real', ancho: 150, formato: MONEDA,
        nota: 'Se completa cuando la semana termina. Sirve para medir cuánto le erramos y ajustar.' },
      { titulo: 'Neto_Estimado', ancho: 150, formato: MONEDA,
        nota: 'Calculado: bruto x PCT_NETO_SOBRE_BRUTO. Es la plata que realmente entra a Mercado Pago.' },
      { titulo: 'Notas', ancho: 380 }
    ]
  },

  MOVIMIENTOS: {
    nombre: 'Movimientos',
    generada: false,
    descripcion: 'Lo que efectivamente se pagó o cobró. Sirve para que la semana en curso no cuente dos veces lo ya pagado.',
    columnas: [
      { titulo: 'Fecha', ancho: 110, formato: FECHA },
      { titulo: 'Tipo', ancho: 100, lista: LISTAS.TIPO_MOV },
      { titulo: 'Concepto', ancho: 280 },
      { titulo: 'Obligacion_ID', ancho: 130, nota: 'Opcional. Vinculá con el ID de Obligaciones para marcar ese vencimiento como pagado.' },
      { titulo: 'Monto', ancho: 130, formato: MONEDA },
      { titulo: 'Cuenta', ancho: 130, lista: LISTAS.CUENTA },
      { titulo: 'Notas', ancho: 380 }
    ]
  },

  ESTA_SEMANA: {
    nombre: 'Esta Semana',
    generada: true,
    // Es la pantalla de inicio, no una tabla: arriba lleva el resumen y abajo
    // la lista. Por eso no se le fuerza una fila de cabecera.
    libre: true,
    descripcion: 'La pantalla del domingo. La escribe el sistema — no editar.',
    columnas: [
      { titulo: 'Vence', ancho: 110, formato: FECHA },
      { titulo: 'Concepto', ancho: 260 },
      { titulo: 'Acreedor', ancho: 170 },
      { titulo: 'Monto', ancho: 130, formato: MONEDA },
      { titulo: 'Criticidad', ancho: 90 },
      { titulo: 'Estado', ancho: 130 },
      { titulo: 'Si no lo pagás', ancho: 460 }
    ]
  },

  CASHFLOW: {
    nombre: 'Cashflow 13S',
    generada: true,
    descripcion: 'Proyección rolling. La escribe el sistema — no editar.',
    columnas: [
      { titulo: 'Semana', ancho: 80 },
      { titulo: 'Desde', ancho: 110, formato: FECHA },
      { titulo: 'Hasta', ancho: 110, formato: FECHA },
      { titulo: 'Saldo_Inicial', ancho: 140, formato: MONEDA },
      { titulo: 'Ingresos', ancho: 140, formato: MONEDA },
      { titulo: 'Mercaderia', ancho: 140, formato: MONEDA },
      { titulo: 'Egresos_Fijos', ancho: 140, formato: MONEDA },
      { titulo: 'Impuestos', ancho: 140, formato: MONEDA },
      { titulo: 'Deuda', ancho: 140, formato: MONEDA },
      { titulo: 'Saldo_Final', ancho: 140, formato: MONEDA },
      { titulo: 'Estado', ancho: 130 },
      { titulo: 'Detalle', ancho: 460 }
    ]
  },

  SIMULADOR: {
    nombre: 'Simulador',
    generada: true,
    descripcion: 'Escenarios. Se completa en la Etapa 4.',
    columnas: [
      { titulo: 'Parámetro', ancho: 260 },
      { titulo: 'Valor', ancho: 160 },
      { titulo: 'Qué significa', ancho: 560 }
    ]
  }
};

/** Orden en que se crean las pestañas. */
var ORDEN_HOJAS = ['ESTA_SEMANA', 'CASHFLOW', 'SIMULADOR', 'VENTAS',
                   'OBLIGACIONES', 'DEUDAS', 'MOVIMIENTOS', 'CONFIG'];

// --- Utilidades de fecha (puras: se testean en Node) ------------------------

/** Lunes de la semana que contiene a la fecha dada. */
function lunesDeLaSemana(fecha) {
  var d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  var dow = d.getDay();                  // 0 domingo … 6 sábado
  var retroceso = (dow === 0) ? 6 : dow - 1;
  d.setDate(d.getDate() - retroceso);
  return d;
}

function sumarDias(fecha, dias) {
  var d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  d.setDate(d.getDate() + dias);
  return d;
}

/** Genera n semanas de lunes a domingo a partir del lunes de `desde`. */
function generarSemanas(desde, n) {
  var lunes = lunesDeLaSemana(desde);
  var out = [];
  for (var i = 0; i < n; i++) {
    var ini = sumarDias(lunes, i * 7);
    out.push({ numero: i + 1, desde: ini, hasta: sumarDias(ini, 6) });
  }
  return out;
}
