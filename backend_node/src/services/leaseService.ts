import { createPrivateKey, createPublicKey, randomBytes, sign as cryptoSign, verify as cryptoVerify, constants as cryptoConstants } from "node:crypto";
import { env } from "../env.js";

/**
 * Port of backend/lease_service.py -- XauCloud bounded offline trading
 * lease signing service. RSA-2048/SHA-256/PKCS#1v1.5 detached signature
 * ("XAUCLOUD-LEASE-RS256-v1") over a fixed-field-order canonical payload
 * that the EA's own from-scratch MQL5 verifier checks byte-for-byte
 * identically -- the field order and formatting here must never change
 * independently of backend/ea_code/lease/XauCloudLeaseCrypto.mqh.
 */

export const LEASE_ALGORITHM_ID = "XAUCLOUD-LEASE-RS256-v1";
export const LEASE_SCHEMA_VERSION = 1;
export const RSA_KEY_BITS = 2048;
export const RSA_PUBLIC_EXPONENT = 65537;

// Fixed field order -- MUST exactly match the EA's caller construction.
const CANONICAL_FIELD_ORDER = [
  "schema_version", "lease_id", "key_id", "tenant_id", "license_id",
  "account_login", "account_server", "installation_id", "terminal_instance_id",
  "normalized_symbol", "allowed_directions", "allowed_entry_families",
  "issued_at_unix", "not_before_unix", "expires_at_unix", "renewal_after_unix",
  "maximum_offline_new_campaigns", "remaining_offline_new_campaigns",
  "lease_sequence", "revocation_epoch", "nonce",
] as const;

export class LeaseCryptoNotConfigured extends Error {}

export interface LeaseSigningKey {
  keyId: string;
  privateKey: import("node:crypto").KeyObject;
  modulusHex: string;
  exponent: number;
}

function b64OrRawPem(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.startsWith("-----BEGIN")) return Buffer.from(trimmed, "utf8");
  return Buffer.from(trimmed, "base64");
}

/** Port of lease_service.py:82 `load_signing_key`. */
export function loadSigningKey(): LeaseSigningKey {
  const pemEnv = env.XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY;
  const keyId = env.XAUCLOUD_LEASE_SIGNING_KEY_ID;
  if (!pemEnv || !keyId) {
    throw new LeaseCryptoNotConfigured("XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY / XAUCLOUD_LEASE_SIGNING_KEY_ID not set");
  }
  const pemBytes = b64OrRawPem(pemEnv);
  const privateKey = createPrivateKey({ key: pemBytes, format: "pem" });
  const details = privateKey.asymmetricKeyDetails;
  if (privateKey.asymmetricKeyType !== "rsa" || !details?.modulusLength) {
    throw new LeaseCryptoNotConfigured("configured lease signing key is not an RSA private key");
  }
  if (details.modulusLength !== RSA_KEY_BITS) {
    throw new LeaseCryptoNotConfigured(`configured lease signing key is ${details.modulusLength} bits, expected ${RSA_KEY_BITS}`);
  }
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const modulusHex = Buffer.from(jwk.n, "base64url").toString("hex").padStart(512, "0");
  const exponent = Number(BigInt(`0x${Buffer.from(jwk.e, "base64url").toString("hex")}`));
  if (exponent !== RSA_PUBLIC_EXPONENT) {
    throw new LeaseCryptoNotConfigured("configured lease signing key does not use the fixed public exponent 65537");
  }
  return { keyId, privateKey, modulusHex, exponent };
}

function fmtField(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(",");
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Port of lease_service.py:118 `canonical_payload`. */
export function canonicalPayload(leaseFields: Record<string, unknown>): Buffer {
  const missing = CANONICAL_FIELD_ORDER.filter((f) => !(f in leaseFields));
  if (missing.length > 0) throw new Error(`canonical_payload missing required fields: ${missing.join(", ")}`);
  const parts = CANONICAL_FIELD_ORDER.map((name) => `${name}=${fmtField(leaseFields[name])}`);
  return Buffer.from(parts.join("|"), "utf8");
}

/** Port of lease_service.py:129 `sign_lease` -- RSA-2048/PKCS1v15/SHA-256 detached signature, 512-char hex. */
export function signLease(signingKey: LeaseSigningKey, leaseFields: Record<string, unknown>): string {
  const payload = canonicalPayload(leaseFields);
  const signature = cryptoSign("RSA-SHA256", payload, {
    key: signingKey.privateKey,
    padding: cryptoConstants.RSA_PKCS1_PADDING,
  });
  if (signature.length !== RSA_KEY_BITS / 8) throw new Error("unexpected RSA signature length");
  return signature.toString("hex");
}

/** Port of lease_service.py:139 `verify_lease_signature_backend_side`. */
export function verifyLeaseSignatureBackendSide(
  modulusHex: string,
  exponent: number,
  leaseFields: Record<string, unknown>,
  signatureHex: string,
): boolean {
  try {
    const n = Buffer.from(BigInt(`0x${modulusHex}`).toString(16).padStart(modulusHex.length, "0"), "hex");
    const e = Buffer.from(exponent.toString(16).padStart(exponent.toString(16).length % 2 === 0 ? exponent.toString(16).length : exponent.toString(16).length + 1, "0"), "hex");
    const jwk = { kty: "RSA", n: n.toString("base64url"), e: e.toString("base64url") };
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    const payload = canonicalPayload(leaseFields);
    return cryptoVerify("RSA-SHA256", payload, { key: publicKey, padding: cryptoConstants.RSA_PKCS1_PADDING }, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/** Port of lease_service.py:159 `new_nonce`. */
export function newNonce(): string {
  return randomBytes(16).toString("hex");
}
