/**
 * Junta los .gs en un solo archivo para pegar de una sola vez en Apps Script.
 *
 * Se genera, no se edita: la fuente de verdad sigue siendo apps-script/*.gs.
 *
 * Uso:  node cashflow/build/bundle.js
 */
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'apps-script');
const SALIDA = path.join(__dirname, '..', 'NUVELA_Cashflow.gs');

// Apps Script evalúa los archivos por orden alfabético; al unirlos hay que
// respetarlo para que 02_Esquema quede definido antes de que lo usen los demás.
const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.gs')).sort();

const cabecera = `/**
 * NUVELA · Cashflow — archivo único.
 *
 * GENERADO: no editar acá. La fuente son los archivos de cashflow/apps-script/.
 * Para regenerarlo:  node cashflow/build/bundle.js
 *
 * Incluye: ${archivos.join(', ')}
 *
 * Instalación:
 *   1. En la planilla: Extensiones -> Apps Script
 *   2. Borrar el Código.gs que viene y pegar todo esto
 *   3. Guardar, volver a la planilla y recargar la pestaña
 *   4. Menú "NUVELA Cashflow" -> "Crear / reparar sistema"
 */

`;

const cuerpo = archivos
  .map((f) => `// ${'='.repeat(72)}\n// ${f}\n// ${'='.repeat(72)}\n\n${fs.readFileSync(path.join(DIR, f), 'utf8').trim()}\n`)
  .join('\n');

fs.writeFileSync(SALIDA, cabecera + cuerpo);
console.log(`${path.relative(process.cwd(), SALIDA)}: ${archivos.length} archivos, ${(cabecera + cuerpo).split('\n').length} líneas`);
