import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Node port of Python's `cryptography.fernet.Fernet`, used by server.py's
 * `_cloud_encrypt`/`_cloud_decrypt` (line 5817-5824) to protect admin MFA
 * TOTP secrets at rest. Re-implemented here (rather than pulled in as a
 * dependency) because the spec is small, fixed, and must byte-for-byte
 * match the existing Python-encrypted `mfa_secret_enc` values already
 * stored in MongoDB -- this is NOT a new encryption scheme, it is the
 * standard Fernet token format: 0x80 version byte + 8-byte big-endian
 * timestamp + 16-byte IV + AES-128-CBC ciphertext + 32-byte HMAC-SHA256,
 * all base64url-encoded.
 */
export class Fernet {
  private readonly signingKey: Buffer;
  private readonly encryptionKey: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error(`Fernet key must be 32 bytes, got ${key.length}`);
    }
    this.signingKey = key.subarray(0, 16);
    this.encryptionKey = key.subarray(16, 32);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-128-cbc", this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    const timestamp = Buffer.alloc(8);
    timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));

    const version = Buffer.from([0x80]);
    const unsigned = Buffer.concat([version, timestamp, iv, ciphertext]);
    const hmac = createHmac("sha256", this.signingKey).update(unsigned).digest();
    return Buffer.concat([unsigned, hmac]).toString("base64url");
  }

  decrypt(token: string): string {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 1 + 8 + 16 + 32) throw new Error("Fernet token too short");

    const version = raw[0];
    if (version !== 0x80) throw new Error("Invalid Fernet token version");

    const signature = raw.subarray(raw.length - 32);
    const unsigned = raw.subarray(0, raw.length - 32);
    const expectedSig = createHmac("sha256", this.signingKey).update(unsigned).digest();
    if (!expectedSig.equals(signature)) throw new Error("Invalid Fernet signature");

    const iv = raw.subarray(9, 25);
    const ciphertext = raw.subarray(25, raw.length - 32);
    const decipher = createDecipheriv("aes-128-cbc", this.encryptionKey, iv);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  }
}
