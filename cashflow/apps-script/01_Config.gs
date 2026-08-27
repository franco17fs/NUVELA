/**
 * NUVELA · Cashflow — Parámetros del sistema.
 *
 * Cada parámetro lleva un ORIGEN, que dice cuánto hay que confiar en el número:
 *   MEDIDO    · sale de datos reales de NUVELA (facturas, informes de rentabilidad)
 *   DECLARADO · lo dijo Franco o Elian
 *   ESTIMADO  · lo puse yo con criterio, se puede cambiar sin romper nada
 *   CONFIRMAR · hay que verificarlo antes de tomar una decisión de plata con esto
 */

/**
 * Versión del modelo. Se sube cada vez que cambia la semilla de Config,
 * Obligaciones o Deudas.
 *
 * `crearSistema` no pisa datos ya cargados —y está bien que no lo haga—, pero
 * eso significa que una corrección de la semilla no llega sola a una planilla
 * que ya existe. Comparar esta versión contra la de la hoja es lo que hace que
 * el desfasaje se avise en vez de pasar desapercibido.
 */
var MODELO_VERSION = 5;

var CONFIG_SEMILLA = [
  ['MODELO_VERSION', MODELO_VERSION, 'versión',
   'Versión de la semilla cargada en esta planilla. Si no coincide con la del código, la proyección avisa: los datos quedaron viejos y hay que recargarlos desde el menú.',
   'MEDIDO'],

  // --- Saldos de arranque -------------------------------------------------
  ['SALDO_MERCADO_PAGO', 0, '$', 'Plata disponible hoy en Mercado Pago.', 'DECLARADO'],
  ['SALDO_EFECTIVO', 0, '$', 'Efectivo en el depósito.', 'DECLARADO'],
  ['COLCHON_MINIMO', 1370000, '$',
   'Piso de caja y objetivo del fondo colchón. Calculado como DIAS_COLCHON días de operación completa: reponer mercadería, pagar la moto y el prorrateo diario de los vencimientos del mes. Correr "Sugerir colchón" en el menú lo recalcula con los números de hoy.',
   'ESTIMADO'],
  ['DIAS_COLCHON', 5, 'días',
   'Cuántos días de operación tiene que cubrir el colchón. Es la respuesta a "si dejo de vender, ¿cuántos días aguanto sin romper nada?".',
   'ESTIMADO'],
  ['FONDO_MERCADERIA_INICIAL', 0, '$',
   'Plata que ya estaba apartada para comprar mercadería cuando arrancó el registro diario. Si se arranca de cero, queda en cero.',
   'DECLARADO'],
  ['PCT_BUFFER_MERCADERIA', 0, '%',
   'Extra sobre el costo de reposición, para crecer en stock en vez de solo reponer. En 0 se repone exactamente lo que se vendió.',
   'ESTIMADO'],
  ['HORIZONTE_FONDOS_DIAS', 60, 'días',
   'Hasta qué vencimientos se empieza a juntar plata. Más largo separa antes y deja menos libre; más corto libera plata pero llega más justo.',
   'ESTIMADO'],

  // --- Cómo entra la plata de Mercado Libre -------------------------------
  ['PCT_NETO_SOBRE_BRUTO', 67.3, '%',
   'De cada $100 que paga el comprador, esto es lo que llega a Mercado Pago. ML ya descontó comisión (19,0%), envío (11,2%) e impuestos (2,6%). Medido sobre junio 2026.',
   'MEDIDO'],
  ['LAG_ACREDITACION_DIAS', 1, 'días',
   'Días entre la venta y la plata disponible. Es 1 porque se paga el adelanto de dinero. Sin adelanto serían entre 7 y 14.',
   'MEDIDO'],
  ['PCT_ADELANTO_DINERO', 3.2, '%',
   'Lo que cuesta cobrar a 1 día en vez de 7 o 14. Agosto 2026: $384.033 sobre una facturación de $12.148.466. Ya está descontado dentro del 67,3%: el simulador lo devuelve cuando se prueba apagar el adelanto.',
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
  // --- Avisos -------------------------------------------------------------
  ['MAIL_AVISOS', '', 'mails',
   'A quién le llega el resumen de los domingos. Separar con coma para que le llegue también a Elian. Vacío = al dueño de la planilla.',
   'DECLARADO'],
  ['WHATSAPP_NUMERO', '', 'número',
   'Número con código de país y sin espacios, por ejemplo +5491122334455. Vacío = el aviso va solo por mail.',
   'DECLARADO'],
  ['CALLMEBOT_APIKEY', '', 'clave',
   'Clave de CallMeBot para mandar el aviso por WhatsApp. Se saca en 2 minutos desde el celular: mandarle "I allow callmebot to send me messages" al +34 644 51 95 23 y devuelve la clave.',
   'DECLARADO'],

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
