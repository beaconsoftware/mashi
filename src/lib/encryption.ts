import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * Output format: base64(iv ‖ authTag ‖ ciphertext)
 *   - iv:        12 bytes  (GCM nonce — random per-encryption)
 *   - authTag:   16 bytes  (GCM authentication tag)
 *   - ciphertext: variable
 *
 * Tokens never appear in plaintext outside this file's scope or memory
 * for the duration of a single request.
 *
 * ENCRYPTION_KEY: 32-byte (64 hex char) key. Generate with:
 *   openssl rand -hex 32
 */

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("ENCRYPTION_KEY is not set. Generate with `openssl rand -hex 32`.");
  }
  if (hex.length !== 64) {
    throw new Error(
      `ENCRYPTION_KEY must be 64 hex chars (32 bytes); got ${hex.length} chars.`
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  if (plaintext === "" || plaintext == null) return plaintext;
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(encoded: string): string {
  if (encoded === "" || encoded == null) return encoded;
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("ciphertext too short — not a valid encrypted token");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}

export function encryptOrNull(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  return encrypt(plaintext);
}

export function decryptOrNull(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  return decrypt(encoded);
}
