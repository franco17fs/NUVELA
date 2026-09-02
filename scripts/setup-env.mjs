#!/usr/bin/env node
/**
 * Prepara el archivo .env.
 *
 * Hace tres cosas que, hechas a mano, son fáciles de equivocar:
 *
 *   1. Crea el .env a partir de .env.example si todavía no existe.
 *   2. Genera los secretos criptográficos que faltan, con el formato exacto que
 *      espera la aplicación (ENCRYPTION_KEY tiene que ser 32 bytes en base64;
 *      si no, la app no arranca).
 *   3. Si le pasás la URL pública, completa las tres variables que dependen de
 *      ella y te imprime, ya armadas, las URLs que hay que pegar en el DevCenter
 *      de Mercado Libre — incluida la de notificaciones, que lleva el secreto
 *      adentro.
 *
 * Uso:
 *   npm run setup
 *   npm run setup -- https://mi-tunel.trycloudflare.com
 *
 * Es idempotente y conservador: NUNCA pisa un secreto ya generado ni una
 * credencial cargada a mano. Lo único que reemplaza es la URL, y sólo cuando se
 * la pasás explícitamente, porque la URL de un túnel cambia en cada reinicio.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(projectRoot, ".env");
const examplePath = join(projectRoot, ".env.example");

// Códigos ANSI: hacen legible la salida sin depender de ninguna dependencia.
const bold = (text) => `\u001b[1m${text}\u001b[0m`;
const green = (text) => `\u001b[32m${text}\u001b[0m`;
const yellow = (text) => `\u001b[33m${text}\u001b[0m`;
const dim = (text) => `\u001b[2m${text}\u001b[0m`;

function main() {
  const baseUrl = normalizeBaseUrl(process.argv[2]);

  if (!existsSync(examplePath)) {
    console.error("No encuentro .env.example. ¿Estás parado en la carpeta del proyecto?");
    process.exit(1);
  }

  const created = !existsSync(envPath);
  let content = created ? readFileSync(examplePath, "utf8") : readFileSync(envPath, "utf8");

  if (created) {
    console.log(`${green("✓")} Creé el archivo .env a partir de .env.example`);
  }

  const generated = [];

  // Los secretos sólo se generan si faltan: volver a correr el comando no
  // invalida los tokens ya guardados en la base, que están cifrados con la
  // ENCRYPTION_KEY actual.
  for (const { key, bytes, encoding, label } of SECRETS) {
    if (hasValue(content, key)) continue;
    content = setValue(content, key, randomBytes(bytes).toString(encoding));
    generated.push(label);
  }

  const urlKeys = [];
  if (baseUrl) {
    content = setValue(content, "APP_BASE_URL", baseUrl);
    content = setValue(content, "ML_REDIRECT_URI", `${baseUrl}/api/oauth/mercadolibre/callback`);
    content = setValue(content, "MP_REDIRECT_URI", `${baseUrl}/api/oauth/mercadopago/callback`);
    urlKeys.push("APP_BASE_URL", "ML_REDIRECT_URI", "MP_REDIRECT_URI");
  }

  writeFileSync(envPath, content, "utf8");

  report({ content, generated, urlKeys, baseUrl });
}

const SECRETS = [
  {
    key: "ENCRYPTION_KEY",
    bytes: 32,
    encoding: "base64",
    label: "ENCRYPTION_KEY (cifra los tokens de tus cuentas)",
  },
  {
    key: "ML_WEBHOOK_SECRET",
    bytes: 24,
    encoding: "hex",
    label: "ML_WEBHOOK_SECRET (protege la URL de notificaciones)",
  },
  {
    key: "CRON_SECRET",
    bytes: 24,
    encoding: "hex",
    label: "CRON_SECRET (protege el disparador de sincronización)",
  },
];

/** Credenciales que sólo puede generar el usuario en los paneles de cada plataforma. */
const MANUAL = [
  { key: "ML_CLIENT_ID", where: "DevCenter de Mercado Libre" },
  { key: "ML_CLIENT_SECRET", where: "DevCenter de Mercado Libre" },
  { key: "MP_CLIENT_ID", where: "Panel de Mercado Pago (opcional al principio)" },
  { key: "MP_CLIENT_SECRET", where: "Panel de Mercado Pago (opcional al principio)" },
];

function normalizeBaseUrl(raw) {
  if (!raw) return null;

  // Sin barra final: la app arma las rutas concatenando, y una barra de más
  // haría que el redirect_uri no coincida con el cargado en el DevCenter.
  const trimmed = raw.trim().replace(/\/+$/, "");

  if (!/^https:\/\//i.test(trimmed)) {
    console.error(
      `\nLa URL tiene que empezar con https:// — Mercado Libre no acepta http.\n` +
        `Recibí: ${trimmed}\n`,
    );
    process.exit(1);
  }

  return trimmed;
}

/** true si la clave ya tiene un valor real (no vacío ni comillas vacías). */
function hasValue(content, key) {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
  if (!match) return false;
  const value = match[1].trim().replace(/^["']|["']$/g, "");
  return value.length > 0;
}

function readValue(content, key) {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/** Reemplaza el valor conservando comentarios y orden; agrega la clave si falta. */
function setValue(content, key, value) {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}

function report({ content, generated, urlKeys, baseUrl }) {
  if (generated.length > 0) {
    console.log(`${green("✓")} Generé los secretos que faltaban:`);
    for (const label of generated) console.log(`    · ${label}`);
  } else {
    console.log(`${dim("·")} Los secretos ya estaban generados. No toqué ninguno.`);
  }

  if (urlKeys.length > 0) {
    console.log(`${green("✓")} Configuré la URL pública en: ${urlKeys.join(", ")}`);
  }

  const faltan = MANUAL.filter((entry) => !hasValue(content, entry.key));
  if (faltan.length > 0) {
    console.log(`\n${yellow("Falta cargar a mano en el .env:")}`);
    for (const entry of faltan) {
      console.log(`    · ${bold(entry.key)}  ${dim("→ " + entry.where)}`);
    }
  }

  if (!baseUrl) {
    console.log(
      `\n${yellow("Falta la URL pública.")} Cuando la tengas, volvé a correr:\n` +
        `    npm run setup -- https://TU-URL.trycloudflare.com`,
    );
    return;
  }

  const webhookSecret = readValue(content, "ML_WEBHOOK_SECRET");

  console.log(`\n${bold("Pegá esto en el DevCenter de Mercado Libre:")}\n`);
  console.log(`  ${dim("Redirect URI (Mercado Libre)")}`);
  console.log(`  ${baseUrl}/api/oauth/mercadolibre/callback\n`);
  console.log(`  ${dim("Redirect URI (Mercado Pago)")}`);
  console.log(`  ${baseUrl}/api/oauth/mercadopago/callback\n`);
  console.log(`  ${dim("Notificaciones callbacks URL")}`);
  console.log(`  ${baseUrl}/api/webhooks/mercadolibre/${webhookSecret}\n`);
  console.log(
    dim("Estas URLs tienen que quedar idénticas en el DevCenter y en el .env.\n"),
  );
}

main();
