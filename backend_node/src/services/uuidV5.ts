import { createHash } from "node:crypto";

export const NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/** RFC 4122 v5 (SHA-1 based) UUID, matching Python's `uuid.uuid5`. */
export function uuidV5(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const hash = createHash("sha1").update(Buffer.concat([nsBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Matching `uuid.uuid5(...).hex` (no dashes). */
export function uuidV5Hex(namespace: string, name: string): string {
  return uuidV5(namespace, name).replace(/-/g, "");
}
