/**
 * Carga los .gs de Apps Script en un sandbox de Node para poder testearlos.
 * Los .gs son JavaScript plano con variables globales, así que alcanza con
 * evaluarlos en orden dentro de un mismo contexto.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, '..', 'apps-script');

function cargar(archivos = ['02_Esquema.gs', '01_Config.gs', '03_Semilla.gs', '05_Validacion.gs']) {
  const sandbox = { console };
  vm.createContext(sandbox);
  for (const a of archivos) {
    const codigo = fs.readFileSync(path.join(DIR, a), 'utf8');
    vm.runInContext(codigo, sandbox, { filename: a });
  }
  return sandbox;
}

module.exports = { cargar, DIR };
