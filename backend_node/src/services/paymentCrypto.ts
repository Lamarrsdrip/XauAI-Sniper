import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";

/**
 * Port of backend/payment_crypto.py -- AES-256-GCM encryption for payment
 * provider configuration secrets. Separate master key from the MFA Fernet
 * system (payment_crypto.ts derives from PAYMENT_CONFIG_ENCRYPTION_KEY
 * only, never JWT_SECRET) and separate cipher (AES-256-GCM, not AES-128-CBC).
 */

const CURRENT_KEY_VERSION = "v1";

export class PaymentCryptoNotConfigured extends Error {}

export interface EncryptedSecret {
  v: string;
  n: string;
  ct: string;
}

function loadMasterKey(): Buffer {
  const raw = env.PAYMENT_CONFIG_ENCRYPTION_KEY.trim();
  if (!raw) {
    throw new PaymentCryptoNotConfigured(
      "PAYMENT_CONFIG_ENCRYPTION_KEY is not set. Payment provider credentials cannot be encrypted or decrypted without it.",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch (exc) {
    throw new PaymentCryptoNotConfigured(`PAYMENT_CONFIG_ENCRYPTION_KEY is not valid base64: ${String(exc)}`);
  }
  if (key.length !== 32) {
    throw new PaymentCryptoNotConfigured(`PAYMENT_CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256), got ${key.length} bytes.`);
  }
  return key;
}

/** Port of payment_crypto.py:73 `encrypt_secret`. AESGCM's ciphertext already includes the auth tag appended -- matches `cryptography`'s AESGCM.encrypt() output format. */
export function encryptSecret(plaintext: string | null): EncryptedSecret {
  const text = plaintext ?? "";
  const key = loadMasterKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: CURRENT_KEY_VERSION,
    n: nonce.toString("base64"),
    ct: Buffer.concat([ciphertext, tag]).toString("base64"),
  };
}

/** Port of payment_crypto.py:91 `decrypt_secret`. Returns "" for null/empty input; throws for tampered/wrong-key ciphertext (never conflated). */
export function decryptSecret(enc: EncryptedSecret | null | undefined): string {
  if (!enc) return "";
  const key = loadMasterKey();
  if (enc.v !== CURRENT_KEY_VERSION) {
    throw new PaymentCryptoNotConfigured(`Encrypted payment secret has unknown key version ${JSON.stringify(enc.v)} (expected "${CURRENT_KEY_VERSION}").`);
  }
  try {
    const nonce = Buffer.from(enc.n, "base64");
    const raw = Buffer.from(enc.ct, "base64");
    const ciphertext = raw.subarray(0, raw.length - 16);
    const tag = raw.subarray(raw.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (exc) {
    throw new Error(
      "Failed to decrypt a stored payment secret -- either PAYMENT_CONFIG_ENCRYPTION_KEY has changed since it was encrypted, or the stored value is corrupted/tampered.",
      { cause: exc },
    );
  }
}

/** Port of payment_crypto.py:124 `mask_preview`. */
export function maskPreview(plaintext: string | null | undefined): string {
  if (!plaintext) return "";
  if (plaintext.length <= 12) return "set";
  return `${plaintext.slice(0, 6)}...${plaintext.slice(-4)}`;
}

/** Port of payment_crypto.py:135 `is_configured`. */
export function isConfigured(): boolean {
  try {
    loadMasterKey();
    return true;
  } catch (e) {
    if (e instanceof PaymentCryptoNotConfigured) return false;
    throw e;
  }
}
