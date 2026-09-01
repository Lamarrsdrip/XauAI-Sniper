import { createHash } from "node:crypto";
import { Fernet } from "./fernet.js";
import { env } from "../env.js";

/**
 * Port of server.py:5817 `_FERNET_KEY = urlsafe_b64encode(sha256(JWT_SECRET))`
 * followed by `_fernet = Fernet(_FERNET_KEY)`. Since Fernet() base64url-decodes
 * its key argument right back to raw bytes, the effective key is simply
 * sha256(JWT_SECRET) -- no separate secret needed, deriving straight from
 * JWT_SECRET keeps this byte-for-byte compatible with values the Python
 * backend already encrypted (existing `mfa_secret_enc` documents).
 */
const fernetKey = createHash("sha256").update(env.JWT_SECRET, "utf8").digest();
const fernet = new Fernet(fernetKey);

export function cloudEncrypt(plaintext: string): string {
  return fernet.encrypt(plaintext);
}

export function cloudDecrypt(ciphertext: string): string {
  return fernet.decrypt(ciphertext);
}
