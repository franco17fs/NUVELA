/**
 * NUVELA · Cashflow — archivo único.
 *
 * GENERADO: no editar acá. La fuente son los archivos de cashflow/apps-script/.
 * Para regenerarlo:  node cashflow/build/bundle.js
 *
 * Incluye: 00_Menu.gs, 01_Config.gs, 02_Esquema.gs, 03_Semilla.gs, 04_Setup.gs, 05_Validacion.gs
 *
 * Instalación:
 *   1. En la planilla: Extensiones -> Apps Script
 *   2. Borrar el Código.gs que viene y pegar todo esto
 *   3. Guardar, volver a la planilla y recargar la pestaña
 *   4. Menú "NUVELA Cashflow" -> "Crear / reparar sistema"
 */

// ========================================================================
// 00_Menu.gs
// ========================================================================

/**
 * NUVELA · Cashflow — Menú.
 * Se agrega solo al abrir la planilla.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('NUVELA Cashflow')
    .addItem('Crear / reparar sistema', 'crearSistema')
    .addSeparator()
    .addItem('Revisar carga', 'revisarCarga')
    .addToUi();
}

/**
 * Chequeo de integridad de lo cargado a mano.
 * No corrige nada: lista lo que está mal para que se arregle en la hoja.
 */
function revisarCarga() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var problemas = validarObligaciones(
    ss.getSheetByName(ESQUEMA.OBLIGACIONES.nombre).getDataRange().getValues().slice(1)
  );

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

// ========================================================================
// 01_Config.gs
// ========================================================================

/**
 * NUVELA · Cashflow — Parámetros del sistema.
 *
 * Cada parámetro lleva un ORIGEN, que dice cuánto hay que confiar en el número:
 *   MEDIDO    · sale de datos reales de NUVELA (facturas, informes de rentabilidad)
 *   DECLARADO · lo dijo Franco o Elian
 *   ESTIMADO  · lo puse yo con criterio, se puede cambiar sin romper nada
 *   CONFIRMAR · hay que verificarlo antes de tomar una decisión de plata con esto
 */

var CONFIG_SEMILLA = [
  // --- Saldos de arranque -------------------------------------------------
  ['SALDO_MERCADO_PAGO', 0, '$', 'Plata disponible hoy en Mercado Pago.', 'DECLARADO'],
  ['SALDO_EFECTIVO', 0, '$', 'Efectivo en el depósito.', 'DECLARADO'],
  ['COLCHON_MINIMO', 500000, '$',
   'Piso de caja. La proyección avisa cuando la semana cae por debajo, sin esperar a que dé negativo. Equivale a dos semanas de moto.',
   'ESTIMADO'],

  // --- Cómo entra la plata de Mercado Libre -------------------------------
  ['PCT_NETO_SOBRE_BRUTO', 67.3, '%',
   'De cada $100 que paga el comprador, esto es lo que llega a Mercado Pago. ML ya descontó comisión (19,0%), envío (11,2%) e impuestos (2,6%). Medido sobre junio 2026.',
   'MEDIDO'],
  ['LAG_ACREDITACION_DIAS', 1, 'días',
   'Días entre la venta y la plata disponible. Es 1 porque se paga el adelanto de dinero (~$384.000/mes). Sin adelanto serían entre 7 y 14.',
   'MEDIDO'],
  ['PCT_COSTO_MERCADERIA', 46.2, '%',
   'Costo de la mercadería sobre facturación bruta. Junio 2026: $5.073.318 sobre $10.980.981.',
   'MEDIDO'],
  ['PCT_MOTOMENSAJERIA', 5.9, '%',
   'Motomensajería (Elimonca) sobre facturación bruta. Junio $650.500. Referencia por si conviene proyectarla como % en vez de monto semanal fijo.',
   'MEDIDO'],

  // --- Impuestos ----------------------------------------------------------
  ['ALICUOTA_IVA', 21, '%',
   'Alícuota general, la que aplica a blanquería, cosmética, mascotas y juguetería.',
   'MEDIDO'],
  ['PCT_MERCADERIA_CON_FACTURA_A', 100, '%',
   'Qué proporción de la mercadería viene con factura A. Es LA variable que define el IVA: al 100% el IVA queda en ~$78.000/mes, al 50% se va a ~$518.000/mes.',
   'CONFIRMAR'],
  ['PCT_CREDITO_IVA_FACTURA_ML', 15.8, '%',
   'Crédito fiscal de IVA que dejan las facturas de ML, sobre el total facturado. Medido sobre las 7 facturas del ciclo de agosto 2026.',
   'MEDIDO'],
  ['PCT_PERCEPCION_IVA_FACTURA_ML', 3.78, '%',
   'Percepciones de IVA que retiene ML. Son pago a cuenta: restan del IVA a pagar. Agosto 2026: $154.732.',
   'MEDIDO'],
  ['PCT_PERCEPCION_IIBB_FACTURA_ML', 5.11, '%',
   'Percepciones de IIBB que retiene ML (CABA, Buenos Aires, La Pampa, Neuquén). Agosto 2026: $209.321.',
   'MEDIDO'],

  // --- Vencimientos -------------------------------------------------------
  // CUIT de Elian 20-44998120-1 → terminación 1.
  ['DIA_VENC_IVA', 18, 'día del mes',
   'DDJJ de IVA. Terminación de CUIT 0-1. La primera es por el período agosto 2026 y vence en septiembre.',
   'CONFIRMAR'],
  ['DIA_VENC_IIBB', 15, 'día del mes', 'Convenio Multilateral (CM03/CM05).', 'CONFIRMAR'],
  ['DIA_VENC_AUTONOMOS', 5, 'día del mes', 'Aportes de autónomos, terminación de CUIT 0-1.', 'CONFIRMAR'],

  // --- Proyección ---------------------------------------------------------
  ['SEMANAS_PROYECCION', 13, 'semanas', 'Largo del cashflow rolling.', 'DECLARADO'],
  ['INFLACION_MENSUAL_PCT', 2.5, '%',
   'Se aplica solo a las obligaciones marcadas Ajusta_Inflacion = SI, y crece con los meses de distancia.',
   'ESTIMADO'],
  ['VENTA_BRUTA_SEMANAL_BASE', 2800000, '$',
   'Facturación bruta semanal de referencia. Promedio real 01/05 al 26/08/2026: $2.793.668/semana ($46.694.168 en 117 días).',
   'MEDIDO']
];

/** Lee la hoja Config y devuelve un objeto { CLAVE: valor }. */
function leerConfig(ss) {
  var hoja = ss.getSheetByName(ESQUEMA.CONFIG.nombre);
  var filas = hoja.getDataRange().getValues().slice(1);
  var cfg = {};
  filas.forEach(function (f) {
    if (f[0]) cfg[String(f[0]).trim()] = f[1];
  });
  return cfg;
}

// ========================================================================
// 02_Esquema.gs
// ========================================================================

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

// ========================================================================
// 03_Semilla.gs
// ========================================================================

/**
 * NUVELA · Cashflow — Carga inicial con las obligaciones reales.
 *
 * Fuentes de cada número:
 *   · Facturas del ciclo 06/07–06/08/2026 (7 PDFs de ML y Meli Log)
 *   · vendedores.mercadolibre.com.ar/billing/resume (facturado y adeudado por ciclo)
 *   · Informe de rentabilidad de junio 2026 (documento maestro NUVELA)
 *   · Lo declarado por Franco en la Fase 0
 *
 * Todo lo que diga CONFIRMAR es un número que hay que verificar antes de
 * tomar una decisión de plata apoyándose en él.
 */

// Orden de columnas: ID, Activo, Concepto, Acreedor, Categoria, Criticidad,
// Tipo_Monto, Monto, Periodicidad, Vencimiento, Ajusta_Inflacion,
// Consecuencia_Atraso, Cuenta, Notas
var OBLIGACIONES_SEMILLA = [

  ['OBL-001', 'SI', 'Alquiler del depósito', 'Dueño del depósito', 'ALQUILER', 5,
   'FIJO', 400000, 'MENSUAL', 10, 'SI',
   'Perder el depósito. Sin depósito no hay dónde guardar la mercadería ni desde dónde despachar: se para todo.',
   'MERCADO_PAGO',
   'Se paga entre el 01 y el 10. Sin ajuste pactado por ahora — si acuerdan uno, poner Ajusta_Inflacion en NO y actualizar el monto a mano.'],

  ['OBL-002', 'SI', 'Saldo factura Mercado Libre', 'Mercado Libre', 'PLATAFORMA', 5,
   'ESTIMADO', 550000, 'MENSUAL', 12, 'NO',
   'Primero intereses y a los pocos días suspensión de la cuenta. Si suspenden la cuenta la facturación se va a cero: es el único vencimiento que apaga el ingreso.',
   'MERCADO_PAGO',
   'NO es el total facturado (~$4.400.000/mes). ML descuenta casi todo de las liquidaciones diarias; esto es el "Total adeudado" que queda a pagar. Histórico: $400.000–$700.000. Se lee en vendedores.mercadolibre.com.ar/billing/resume. YA INCLUYE ADS: no cargar publicidad aparte.'],

  ['OBL-003', 'SI', 'Motomensajería (Flex)', 'Elimonca', 'LOGISTICA', 5,
   'ESTIMADO', 250000, 'SEMANAL', 'LUN', 'SI',
   'Sin moto no hay entrega. Sin entrega Mercado Libre no libera la plata de esas ventas: cortar la moto corta el ingreso con una semana de retraso.',
   'EFECTIVO',
   'Declarado $200.000–$300.000/semana. Real de junio: $650.500/mes (~$150.000/semana); mayo $954.700 (~$220.000/semana). Alternativa: Tipo_Monto = PCT_VENTAS con 5,9.'],

  ['OBL-004', 'SI', 'Compra de mercadería', 'Proveedores varios', 'MERCADERIA', 4,
   'PCT_VENTAS', 46.2, 'SEMANAL', 'LUN', 'SI',
   'Sin reposición caen las ventas en 2 o 3 semanas. Es la única obligación cuyo timing elegís vos: todos los proveedores son de contado.',
   'MERCADO_PAGO',
   '46,2% de la facturación bruta (junio 2026: $5.073.318 sobre $10.980.981). Es la palanca principal del simulador: correr una compra una semana es la forma más rápida de destrabar una semana en rojo.'],

  ['OBL-005', 'SI', 'IVA', 'ARCA', 'IMPUESTOS', 3,
   'ESTIMADO', 300000, 'MENSUAL', 18, 'NO',
   'Interés resarcitorio y la DDJJ queda presentada sin pagar. No frena la operación en lo inmediato, pero se acumula y complica cualquier trámite posterior.',
   'MERCADO_PAGO',
   'PRIMERA DDJJ: período agosto 2026, vence a mediados de septiembre. El monto depende casi por completo de PCT_MERCADERIA_CON_FACTURA_A: al 100% son ~$78.000/mes, al 50% ~$518.000/mes, al 0% ~$958.000/mes. Puse $300.000 como marcador prudente. CONFIRMAR CON LA CONTADORA.'],

  ['OBL-006', 'SI', 'IIBB Convenio Multilateral', 'Rentas (Convenio Multilateral)', 'IMPUESTOS', 3,
   'ESTIMADO', 120000, 'MENSUAL', 15, 'NO',
   'Interés y, si se acumula, más percepciones en cada liquidación de ML: el atraso se paga dos veces.',
   'MERCADO_PAGO',
   'Declarado "100 y pico". ML ya retiene ~$209.000/mes de percepciones de IIBB (CABA, Buenos Aires, La Pampa, Neuquén) que son pago a cuenta: es posible que haya saldo a favor en vez de saldo a pagar. CONFIRMAR CON LA CONTADORA.'],

  ['OBL-007', 'SI', 'Autónomos', 'ARCA', 'IMPUESTOS', 2,
   'FIJO', 100000, 'MENSUAL', 5, 'SI',
   'Interés y se pierde el aporte del mes. Es de los que más aguantan sin consecuencia operativa.',
   'MERCADO_PAGO',
   'Declarado $100.000/mes. Aporta Elian (CUIT 20-44998120-1).'],

  ['OBL-008', 'SI', 'Honorarios contadora', 'Contadora', 'PROFESIONALES', 2,
   'FIJO', 130000, 'MENSUAL', 15, 'SI',
   'Se atrasan las presentaciones. Es la obligación que más margen de conversación tiene: se avisa y se corre.',
   'MERCADO_PAGO', ''],

  ['OBL-009', 'SI', 'Retiro de Elian', 'Elian', 'RETIRO', 3,
   'FIJO', 400000, 'MENSUAL', 5, 'SI',
   'Con este retiro se paga la cuota del auto en Galicia. Si no sale, la mora es bancaria y va a Veraz.',
   'MERCADO_PAGO',
   'Mínimo para cubrir la cuota del Galicia (ver DEU-003). NO cargar la cuota del auto como obligación aparte: se pagaría dos veces. Subir este monto cuando definan un retiro real por encima del auto.'],

  ['OBL-010', 'SI', 'Devolución a la madre de Elian', 'Madre de Elian', 'DEUDA_FAMILIAR', 3,
   'ESTIMADO', 200000, 'MENSUAL', 20, 'NO',
   'No hay interés ni consecuencia formal. El costo es la relación, y por eso no puede quedar sin plan.',
   'MERCADO_PAGO',
   'Deuda total $1.200.000 (ver DEU-002), prestada para cubrir alquileres atrasados. Propuse 6 cuotas de $200.000 para que entre en el flujo. AJUSTAR AL PLAN QUE ACUERDEN CON ELLA.'],

  ['OBL-011', 'SI', 'Crédito Mercado Pago', 'Mercado Pago', 'DEUDA_FINANCIERA', 4,
   'FIJO', 900000, 'UNICA', '', 'NO',
   'Punitorios de Mercado Pago y golpe al scoring crediticio de la cuenta, que es de donde sale el financiamiento cuando hace falta.',
   'MERCADO_PAGO',
   'Cuota única de $900.000. Se tomó para pagar la factura de ML del ciclo en que aplicaron la alícuota extra del 7% por exceso de facturación como monotributista. CONFIRMAR FECHA DE VENCIMIENTO y si Mercado Pago lo cobra por descuento de las ventas diarias — si fuera así, no es un egreso: es menos ingreso, y hay que sacarlo de acá.'],

  ['OBL-012', 'NO', 'Mercado Ads', 'Mercado Libre', 'PUBLICIDAD', 2,
   'ESTIMADO', 300000, 'MENSUAL', 12, 'NO',
   'Caen las visitas y con ellas las ventas, con unos días de retraso.',
   'MERCADO_PAGO',
   'DESACTIVADA A PROPÓSITO. Ads ya viene dentro de la factura de Mercado Libre (OBL-002): activarla contaría el gasto dos veces. Junio 2026: $240.947. Techo definido ~$350.000/mes. Activar solo si algún día se factura por separado.']
];

// Orden: ID, Activo, Acreedor, Concepto, Monto_Original, Saldo_Actual,
// Valor_Cuota, Cuotas_Restantes, Proximo_Vencimiento, Interes_Punitorio,
// Forma_Cobro, Criticidad, Notas
var DEUDAS_SEMILLA = [

  ['DEU-001', 'SI', 'Mercado Pago', 'Crédito tomado para pagar la factura de ML',
   900000, 900000, 900000, 1, '', 'CONFIRMAR',
   'CONFIRMAR: cuota única por transferencia, o descuento automático de las ventas.',
   4,
   'Vinculado a OBL-011. Si resulta que se descuenta de las ventas diarias, hay que desactivar OBL-011 y bajar PCT_NETO_SOBRE_BRUTO en su lugar.'],

  ['DEU-002', 'SI', 'Madre de Elian', 'Préstamo para cubrir alquileres atrasados',
   1200000, 1200000, 200000, 6, '', 'Sin interés',
   'Transferencia. Plan propuesto, todavía no acordado.',
   3,
   'Vinculado a OBL-010. Es la deuda más flexible del mapa y por eso la más fácil de dejar caer: queda a la vista para que no desaparezca.'],

  ['DEU-003', 'SI', 'Banco Galicia', 'Crédito del auto (personal de Elian)',
   3600000, 3600000, 400000, 9, '', 'CONFIRMAR',
   'SE PAGA DEL RETIRO (OBL-009) — no genera egreso propio en la proyección.',
   4,
   'Informativo: muestra que se liberan $400.000/mes de retiro cuando termine, dentro de 9 cuotas. Monto_Original estimado como 9 x $400.000, CONFIRMAR el total y la fecha de la primera cuota.']
];

/** 13 semanas arrancando desde el lunes de la semana en curso. */
function ventasSemilla(hoy, semanas, brutoBase, pctNeto) {
  return generarSemanas(hoy, semanas).map(function (s) {
    return [s.numero, s.desde, s.hasta, brutoBase, '',
            Math.round(brutoBase * pctNeto / 100),
            s.numero === 1 ? 'Semana en curso. Ajustar el proyectado con lo que ya lleva vendido.' : ''];
  });
}

// ========================================================================
// 04_Setup.gs
// ========================================================================

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
    hoja.getRange(2, 1)
        .setValue('Esta hoja la escribe el sistema. Se completa en la etapa siguiente.')
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

// ========================================================================
// 05_Validacion.gs
// ========================================================================

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
