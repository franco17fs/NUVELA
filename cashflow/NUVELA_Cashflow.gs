/**
 * NUVELA · Cashflow — archivo único.
 *
 * GENERADO: no editar acá. La fuente son los archivos de cashflow/apps-script/.
 * Para regenerarlo:  node cashflow/build/bundle.js
 *
 * Incluye: 00_Menu.gs, 01_Config.gs, 02_Esquema.gs, 03_Semilla.gs, 04_Setup.gs, 05_Validacion.gs, 06_Motor.gs, 07_Proyeccion.gs
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
    .addItem('Actualizar proyección', 'actualizarProyeccion')
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
  ['PCT_MOTOMENSAJERIA', 4.3, '%',
   'Motomensajería (Elimonca) sobre facturación bruta. Se paga por envío, así que sube y baja con las ventas. 4,3% son ~$120.000 sobre la venta semanal de referencia, el nivel declarado hoy. Junio corrió al 5,9% ($650.500/mes).',
   'DECLARADO'],

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
   'PCT_VENTAS', 4.3, 'SEMANAL', 'LUN', 'NO',
   'Sin moto no hay entrega. Sin entrega Mercado Libre no libera la plata de esas ventas: cortar la moto corta el ingreso con una semana de retraso.',
   'EFECTIVO',
   'Va como % porque se paga por envío: cuando la semana vende más, la moto cuesta más. 4,3% da ~$120.000 sobre la venta semanal de referencia, que es el nivel declarado hoy. Histórico más alto: junio 5,9% ($650.500/mes), mayo $954.700. Si la semana se dispara, revisar el %.'],

  ['OBL-004', 'SI', 'Compra de mercadería', 'Proveedores varios', 'MERCADERIA', 4,
   'PCT_VENTAS', 46.2, 'SEMANAL', 'LUN', 'NO',
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

// ========================================================================
// 06_Motor.gs
// ========================================================================

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
  );

  var filas = [];
  var saldo = saldoInicial;

  for (var i = 0; i < semanas.length; i++) {
    var delSemana = vencimientos.filter(function (v) {
      return v.semana === i && !(entrada.pagados || {})[v.id + '|' + i];
    });

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
      vencimientos: delSemana
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

// ========================================================================
// 07_Proyeccion.gs
// ========================================================================

/**
 * NUVELA · Cashflow — Lectura del Sheet, ejecución del motor y escritura.
 *
 * Toda la aritmética vive en 06_Motor.gs. Acá solo se lee, se llama y se pinta.
 */

var COLOR_ESTADO = {
  ROJO: { fondo: '#FBE3E3', texto: '#A02020' },
  ATENCION: { fondo: '#FFF6E0', texto: '#8A6100' },
  OK: { fondo: null, texto: null }
};

function actualizarProyeccion() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = leerConfig(ss);
  var hoy = new Date();

  var problemas = validarObligaciones(filasDe(ss, ESQUEMA.OBLIGACIONES));
  if (problemas.length) {
    SpreadsheetApp.getUi().alert(
      'No proyecto con datos rotos',
      'Arreglá esto primero:\n\n' + problemas.join('\n\n'),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  var ventas = filasDe(ss, ESQUEMA.VENTAS).filter(function (f) { return esFecha(f[COL_VENTAS.DESDE]); });
  if (!ventas.length) {
    SpreadsheetApp.getUi().alert('Falta cargar la hoja Ventas.');
    return;
  }

  var semanas = ventas.map(function (f, i) {
    return { numero: i + 1, desde: f[COL_VENTAS.DESDE], hasta: f[COL_VENTAS.HASTA] };
  });

  // El real manda sobre el proyectado: una semana ya cerrada no se estima.
  var brutoPorSemana = ventas.map(function (f) {
    return Number(f[COL_VENTAS.REAL]) || Number(f[COL_VENTAS.PROYECTADO]) || 0;
  });

  var resultado = proyectar({
    semanas: semanas,
    brutoPorSemana: brutoPorSemana,
    obligaciones: filasDe(ss, ESQUEMA.OBLIGACIONES),
    cfg: cfg,
    hoy: hoy,
    pagados: pagosPorSemana(filasDe(ss, ESQUEMA.MOVIMIENTOS), semanas)
  });

  escribirNetoEstimado(ss, brutoPorSemana, Number(cfg.PCT_NETO_SOBRE_BRUTO) || 0);
  escribirCashflow(ss, resultado, hoy);

  SpreadsheetApp.getUi().alert('NUVELA · Cashflow', mensajeResumen(resultado, cfg),
                               SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Filas con datos de una hoja, sin la cabecera. */
function filasDe(ss, definicion) {
  var hoja = ss.getSheetByName(definicion.nombre);
  if (!hoja || hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, definicion.columnas.length).getValues();
}

/**
 * Vencimientos ya pagados, indexados por "OBL-XXX|semana".
 * Se toma la semana del movimiento, no la del vencimiento: se paga cuando se
 * puede, no cuando vence, y lo que importa es que no se cuente dos veces.
 */
function pagosPorSemana(movimientos, semanas) {
  var pagados = {};
  movimientos.forEach(function (m) {
    var id = String(m[COL_MOV.OBLIGACION] || '').trim();
    if (!id || !esFecha(m[COL_MOV.FECHA])) return;
    var i = semanaDe(semanas, m[COL_MOV.FECHA]);
    if (i !== -1) pagados[id + '|' + i] = true;
  });
  return pagados;
}

function escribirNetoEstimado(ss, brutoPorSemana, pctNeto) {
  var hoja = ss.getSheetByName(ESQUEMA.VENTAS.nombre);
  hoja.getRange(2, COL_VENTAS.NETO + 1, brutoPorSemana.length, 1).setValues(
    brutoPorSemana.map(function (b) { return [Math.round(b * pctNeto / 100)]; })
  );
}

function escribirCashflow(ss, resultado, hoy) {
  var def = ESQUEMA.CASHFLOW;
  var hoja = ss.getSheetByName(def.nombre);
  var quiebre = resultado.quiebre;

  if (hoja.getLastRow() > 1) {
    hoja.getRange(2, 1, hoja.getLastRow() - 1, def.columnas.length).clear();
  }

  var filas = resultado.filas.map(function (f) {
    return [f.numero, f.desde, f.hasta, f.saldoInicial, f.ingresos, f.mercaderia,
            f.fijos, f.impuestos, f.deuda, f.saldoFinal, f.estado, detalleDe(f, quiebre, hoy)];
  });

  hoja.getRange(2, 1, filas.length, def.columnas.length).setValues(filas);

  resultado.filas.forEach(function (f, i) {
    var color = COLOR_ESTADO[f.estado];
    var rango = hoja.getRange(i + 2, 1, 1, def.columnas.length);
    rango.setBackground(color.fondo).setFontColor(color.texto);
    if (f.estado !== 'OK') hoja.getRange(i + 2, 11).setFontWeight('bold');
  });

  hoja.getRange(2, 12, filas.length, 1).setWrap(true);
}

function detalleDe(fila, quiebre, hoy) {
  var partes = [];

  if (fila.estado === 'ROJO') {
    partes.push('QUIEBRE: faltan ' + pesos(-fila.saldoFinal));
  } else if (fila.estado === 'ATENCION') {
    partes.push('Bajo el colchón mínimo');
  }

  // En la primera semana se avisa cuánto aire queda hasta el quiebre.
  if (fila.numero === 1 && quiebre) {
    partes.push(quiebre.semana === 1
      ? 'El quiebre es esta semana'
      : 'Primer quiebre en la semana ' + quiebre.semana + ', dentro de ' + quiebre.dias + ' días');
  }

  var resumen = resumenDeSemana(fila, 3);
  if (resumen) partes.push(resumen);
  return partes.join(' — ');
}

function mensajeResumen(resultado, cfg) {
  var quiebre = resultado.quiebre;
  var ultima = resultado.filas[resultado.filas.length - 1];
  var lineas = ['Proyección actualizada: ' + resultado.filas.length + ' semanas.', ''];

  if (quiebre) {
    lineas.push('QUIEBRE en la semana ' + quiebre.semana +
                ' (' + formatearFecha(quiebre.desde) + ' al ' + formatearFecha(quiebre.hasta) + ').');
    lineas.push('Faltan ' + pesos(quiebre.faltan) + '. Tenés ' + quiebre.dias + ' días de aviso.');
  } else {
    var atencion = primeraAtencion(resultado.filas);
    lineas.push(atencion
      ? 'Sin quiebre, pero la semana ' + atencion.numero + ' baja del colchón (' +
        pesos(atencion.saldoFinal) + ' contra un mínimo de ' + pesos(Number(cfg.COLCHON_MINIMO) || 0) + ').'
      : 'Ninguna semana cierra en negativo ni baja del colchón.');
  }

  lineas.push('', 'Saldo al cierre de la semana ' + ultima.numero + ': ' + pesos(ultima.saldoFinal) + '.');
  return lineas.join('\n');
}

function formatearFecha(d) {
  return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
}
