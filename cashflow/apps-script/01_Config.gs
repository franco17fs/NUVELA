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
