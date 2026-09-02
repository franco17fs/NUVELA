#!/usr/bin/env node
/**
 * Carga las credenciales en el .env de forma interactiva.
 *
 * Editar el .env a mano es la parte más frágil de la puesta en marcha: una
 * comilla de menos, una línea que no se guardó, o una URL pegada en el lugar
 * equivocado, y el error que aparece después no dice nada de eso. Este comando
 * pregunta cada valor, lo valida, y lo escribe él.
 *
 * También corrige el error más caro con Neon: la cadena "pooled" (con `-pooler`
 * en el host) hace fallar las migraciones de Prisma. Si la detecta, la convierte
 * a la conexión directa y avisa.
 *
 * Uso:
 *   npm run setup:creds          pregunta lo que falta
 *   npm run setup:creds -- --all pregunta todo, incluso lo ya cargado
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(projectRoot, ".env");

const ESC = "\u001b";
const bold = (t) => `${ESC}[1m${t}${ESC}[0m`;
const green = (t) => `${ESC}[32m${t}${ESC}[0m`;
const red = (t) => `${ESC}[31m${t}${ESC}[0m`;
const yellow = (t) => `${ESC}[33m${t}${ESC}[0m`;
const dim = (t) => `${ESC}[2m${t}${ESC}[0m`;

const FIELDS = [
  {
    key: "DATABASE_URL",
    title: "Cadena de conexión de la base de datos",
    help: "En Neon: botón Connect → copiar la cadena que empieza con postgresql://",
    required: true,
    validate: validateDatabaseUrl,
    // El .env.example trae la cadena de la base local en Docker. Si alguien no
    // usa Docker, ese valor "existe" pero es incorrecto, y el error que aparece
    // después (autenticación contra localhost) no lo deja ver. Se trata como
    // pendiente para que el comando lo pregunte igual.
    isPlaceholder: (value) => /localhost|127\.0\.0\.1|nuvela:nuvela@/i.test(value),
  },
  {
    key: "ML_CLIENT_ID",
    title: "App ID de Mercado Libre",
    help: "En el DevCenter, dentro de tu aplicación",
    required: true,
    validate: (value) =>
      /^\d+$/.test(value) ? null : "El App ID es un número. Revisá que no hayas copiado otra cosa.",
  },
  {
    key: "ML_CLIENT_SECRET",
    title: "Secret Key de Mercado Libre",
    help: "En el DevCenter, al lado del App ID (puede estar oculto tras un botón)",
    required: true,
    validate: (value) =>
      value.length >= 16 ? null : "El Secret Key es una cadena larga. Parece incompleto.",
  },
];

async function main() {
  const askAll = process.argv.includes("--all");

  if (!existsSync(envPath)) {
    console.error(
      red("\nNo existe el archivo .env.") + "\nCorré primero:  npm run setup\n",
    );
    process.exit(1);
  }

  let content = readFileSync(envPath, "utf8");

  console.log(`\n${bold("Estado actual del .env")}\n`);
  for (const field of FIELDS) {
    const current = readValue(content, field.key);
    const placeholder = current !== "" && field.isPlaceholder?.(current);

    if (placeholder) {
      console.log(
        `  ${yellow("⚠")} ${field.key.padEnd(18)} ${dim(mask(field.key, current))} ${yellow("← es el valor de ejemplo")}`,
      );
    } else if (current) {
      console.log(`  ${green("✓")} ${field.key.padEnd(18)} ${dim(mask(field.key, current))}`);
    } else {
      console.log(`  ${red("✗")} ${field.key.padEnd(18)} ${dim("sin cargar")}`);
    }
  }
  console.log();

  const pending = FIELDS.filter((field) => {
    if (askAll) return true;
    const current = readValue(content, field.key);
    return current === "" || Boolean(field.isPlaceholder?.(current));
  });

  if (pending.length === 0) {
    console.log(green("Ya está todo cargado.") + dim("  Para cambiar algo: npm run setup:creds -- --all\n"));
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let answered = 0;

  try {
    for (const field of pending) {
      const next = await askField(rl, content, field);

      // `null` = la entrada se cerró (Ctrl+C, o la terminal se fue). Se corta
      // sin perder lo ya respondido.
      if (next === null) {
        console.log(yellow("\nSe interrumpió la carga."));
        break;
      }

      content = next;
      answered += 1;

      // Se guarda después de CADA respuesta: si algo se corta a mitad de camino,
      // lo ya cargado queda en el archivo y no hay que volver a tipearlo.
      writeFileSync(envPath, content, "utf8");
    }
  } finally {
    rl.close();
  }

  if (answered === 0) {
    console.log(yellow("\nNo se guardó ningún cambio.\n"));
    return;
  }

  console.log(`\n${green("✓")} Guardé el archivo .env`);

  const missing = FIELDS.filter((field) => {
    const value = readValue(content, field.key);
    return value === "" || Boolean(field.isPlaceholder?.(value));
  });

  if (missing.length > 0) {
    console.log(
      yellow(`\nTodavía falta: ${missing.map((field) => field.key).join(", ")}`) +
        dim("\nVolvé a correr:  npm run setup:creds\n"),
    );
    return;
  }

  console.log("\nAhora podés crear las tablas:\n");
  console.log(`    ${bold("npm run db:migrate")}\n`);
}

/** Devuelve el contenido actualizado, o `null` si la entrada se cerró. */
async function askField(rl, content, field) {
  console.log(`${bold(field.title)}`);
  console.log(dim(`  ${field.help}`));

  // Con la entrada cerrada, `question` resuelve vacío para siempre: sin este
  // tope, un Ctrl+C dejaría el proceso girando en el caso obligatorio.
  let emptyAnswers = 0;

  for (;;) {
    const raw = await rl.question(`  ${field.key}: `);
    const answer = (raw ?? "").trim();

    if (answer === "" && !field.required) return content;
    if (answer === "") {
      emptyAnswers += 1;
      if (emptyAnswers >= 3) return null;
      console.log(red("  Este valor es obligatorio.\n"));
      continue;
    }
    emptyAnswers = 0;

    // Tolera que se pegue la línea entera del .env, con clave y comillas.
    const cleaned = answer
      .replace(new RegExp(`^${field.key}\\s*=\\s*`), "")
      .replace(/^["']|["']$/g, "")
      .trim();

    const result = field.validate ? field.validate(cleaned) : null;

    if (typeof result === "string") {
      console.log(red(`  ${result}\n`));
      continue;
    }

    // Un validador puede devolver un valor corregido en lugar de un error.
    const finalValue = result && typeof result === "object" ? result.value : cleaned;
    if (result && typeof result === "object" && result.notice) {
      console.log(yellow(`  ${result.notice}`));
    }

    console.log(green("  ✓ Guardado\n"));
    return setValue(content, field.key, finalValue);
  }
}

function validateDatabaseUrl(value) {
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    return "Tiene que empezar con postgresql:// — copiá la cadena completa desde Neon.";
  }

  if (!/@/.test(value) || !/\//.test(value.split("@")[1] ?? "")) {
    return "La cadena parece incompleta. Copiala de nuevo, entera.";
  }

  // La cadena "pooled" de Neon pasa por PgBouncer, que no soporta las sentencias
  // que usa `prisma migrate`. El host directo es el mismo sin el sufijo.
  if (value.includes("-pooler.")) {
    return {
      value: value.replace("-pooler.", "."),
      notice:
        "Era la cadena con pooler, que hace fallar las migraciones. La convertí a la conexión directa.",
    };
  }

  return null;
}

/** Oculta el valor: confirma que está cargado sin mostrarlo entero. */
function mask(key, value) {
  if (key === "DATABASE_URL") {
    const host = value.match(/@([^/]+)/);
    return host ? `→ ${host[1]}` : "cargada";
  }
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function readValue(content, key) {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function setValue(content, key, value) {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}

main().catch((error) => {
  console.error(red(`\nError: ${error.message}\n`));
  process.exit(1);
});
