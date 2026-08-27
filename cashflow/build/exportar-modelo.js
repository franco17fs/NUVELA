/**
 * Vuelca el esquema y la semilla de los .gs a JSON.
 *
 * Es lo que le da a `construir_xlsx.py` una única fuente de verdad: la planilla
 * se arma con exactamente los mismos datos que después usa Apps Script, así que
 * no pueden quedar desincronizadas.
 *
 * Uso:  node cashflow/build/exportar-modelo.js > modelo.json
 */
const { cargar } = require('../test/cargar');

const G = cargar();
const cfg = Object.fromEntries(G.CONFIG_SEMILLA.map((f) => [f[0], f[1]]));

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ventas = G.ventasSemilla(
  new Date(),
  Number(cfg.SEMANAS_PROYECCION),
  Number(cfg.VENTA_BRUTA_SEMANAL_BASE),
  Number(cfg.PCT_NETO_SOBRE_BRUTO)
).map((f) => f.map((v) => (Object.prototype.toString.call(v) === '[object Date]' ? iso(v) : v)));

process.stdout.write(JSON.stringify({
  generado: iso(new Date()),
  orden: [...G.ORDEN_HOJAS],
  esquema: JSON.parse(JSON.stringify(G.ESQUEMA)),
  semillas: {
    CONFIG: JSON.parse(JSON.stringify(G.CONFIG_SEMILLA)),
    OBLIGACIONES: JSON.parse(JSON.stringify(G.OBLIGACIONES_SEMILLA)),
    DEUDAS: JSON.parse(JSON.stringify(G.DEUDAS_SEMILLA)),
    VENTAS: ventas
  }
}, null, 2));
