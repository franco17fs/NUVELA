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
