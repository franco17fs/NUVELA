import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getEnv } from "./env";

/**
 * Cifrado de credenciales en reposo.
 *
 * AES-256-GCM: además de confidencialidad da autenticación (tag), así que un
 * token manipulado en la base falla al descifrar en vez de usarse.
 *
 * Formato almacenado: `v1.<iv_b64>.<tag_b64>.<ciphertext_b64>`
 * El prefijo de versión permite rotar el algoritmo sin ambigüedad.
 */
const VERSION = "v1";
const IV_LENGTH = 12; // Recomendado para GCM
const ALGORITHM = "aes-256-gcm";

function key(): Buffer {
  return Buffer.from(getEnv().ENCRYPTION_KEY, "base64");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Formato de secreto cifrado inválido");
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Comparación en tiempo constante, para secretos que viajan en URL o header. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // timingSafeEqual exige la misma longitud; comparamos contra un hash para no
    // filtrar la longitud del secreto por la vía del early return.
    const hashA = createHash("sha256").update(bufA).digest();
    const hashB = createHash("sha256").update(bufB).digest();
    return timingSafeEqual(hashA, hashB);
  }
  return timingSafeEqual(bufA, bufB);
}

/** Trunca un token para logs: nunca se registra el valor completo. */
export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
