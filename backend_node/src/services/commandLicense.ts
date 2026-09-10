import type { Document } from "mongodb";
import { getDb } from "../db.js";
import { LicenseError, normalizeLicenseKey } from "./license.js";

function normalizedEmail(user: Record<string, unknown>): string {
  return String(user["email"] ?? "").toLowerCase().trim();
}

export async function getUserLicense(user: Record<string, unknown>): Promise<Document | null> {
  const linked = normalizeLicenseKey(String(user["license_key"] ?? user["command_license_key"] ?? ""));
  const email = normalizedEmail(user);
  if (!email) return null;
  const db = getDb();
  if (linked) {
    return db.collection("pin_licenses").findOne(
      { pin: linked, is_active: true, buyer_email: email },
      { projection: { _id: 0 } },
    );
  }
  return db.collection("pin_licenses").findOne(
    { buyer_email: email, is_active: true },
    { projection: { _id: 0 }, sort: { created_at: -1 } },
  );
}

export async function verifyCommandLicense(user: Record<string, unknown>, key: string): Promise<Document> {
  const raw = normalizeLicenseKey(key);
  if (!raw.startsWith("ASE-") || raw.length < 10) {
    throw new LicenseError(400, "Enter your XauCloud license key, for example ASE-D4Q9-SUFW.");
  }
  const userEmail = normalizedEmail(user);
  const userId = String(user["id"] ?? "").trim();
  if (!userEmail || !userId) throw new LicenseError(401, "Authenticated customer identity is incomplete.");
  const db = getDb();
  const licenses = db.collection("pin_licenses");
  let lic = await licenses.findOne({ pin: raw, is_active: true }, { projection: { _id: 0 } });
  if (!lic) throw new LicenseError(403, "License key not found or inactive.");
  let owner = String(lic["buyer_email"] ?? "").toLowerCase().trim();
  if (!owner) {
    await licenses.updateOne(
      { pin: raw, is_active: true, $or: [{ buyer_email: { $exists: false } }, { buyer_email: null }, { buyer_email: "" }] },
      { $set: { buyer_email: userEmail, owner_claimed_at: new Date().toISOString() } },
    );
    lic = await licenses.findOne({ pin: raw, is_active: true }, { projection: { _id: 0 } });
    if (!lic) throw new LicenseError(403, "License key not found or inactive.");
    owner = String(lic["buyer_email"] ?? "").toLowerCase().trim();
  }
  if (owner !== userEmail) throw new LicenseError(403, "This license is linked to another Command Center account.");
  const linked = await db.collection("cloud_users").updateOne(
    { id: userId, email: userEmail },
    { $set: { license_key: raw, command_license_key: raw, license_linked_at: new Date().toISOString() } },
  );
  if (linked.matchedCount !== 1) throw new LicenseError(409, "Customer account changed while linking the license. Retry.");
  return lic;
} // ASTRA_REPAIR_V2_6287 / 003
