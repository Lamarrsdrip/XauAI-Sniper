import type { Document } from "mongodb";
import { getDb } from "../db.js";
import { LicenseError, normalizeLicenseKey } from "./license.js";

/** Port of server.py:6087 `_get_user_license`. */
export async function getUserLicense(user: Record<string, unknown>): Promise<Document | null> {
  const linked = normalizeLicenseKey(String(user["license_key"] ?? user["command_license_key"] ?? ""));
  let query: Record<string, unknown> | null = null;
  if (linked) {
    query = { pin: linked, is_active: true };
  } else if (user["email"]) {
    query = { buyer_email: user["email"], is_active: true };
  }
  if (!query) return null;
  return getDb().collection("pin_licenses").findOne(query, { projection: { _id: 0 } });
}

/** Port of server.py:6286 `_verify_command_license` -- Command Center's own license-linking flow (distinct from the EA-facing _resolve_monitor_license). */
export async function verifyCommandLicense(user: Record<string, unknown>, key: string): Promise<Document> {
  const raw = normalizeLicenseKey(key);
  if (!raw.startsWith("ASE-") || raw.length < 10) {
    throw new LicenseError(400, "Enter your XauCloud license key, for example ASE-D4Q9-SUFW.");
  }
  const db = getDb();
  const licenses = db.collection("pin_licenses");
  const lic = await licenses.findOne({ pin: raw, is_active: true }, { projection: { _id: 0 } });
  if (!lic) throw new LicenseError(403, "License key not found or inactive.");

  const owner = String(lic["buyer_email"] ?? "").toLowerCase().trim();
  const userEmail = String(user["email"] ?? "").toLowerCase().trim();
  const linked = normalizeLicenseKey(String(user["license_key"] ?? user["command_license_key"] ?? ""));
  if (owner && owner !== userEmail && linked !== raw) {
    throw new LicenseError(403, "This license is linked to another Command Center account.");
  }

  await db.collection("cloud_users").updateOne(
    { id: user["id"] },
    { $set: { license_key: raw, command_license_key: raw, license_linked_at: new Date().toISOString() } },
  );
  if (!owner && userEmail) {
    await licenses.updateOne({ pin: raw }, { $set: { buyer_email: userEmail } });
  }
  return lic;
}
