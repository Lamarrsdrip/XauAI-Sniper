import type { Document } from "mongodb";
import { getDb } from "../db.js";

export class LicenseError extends Error {
  statusCode: number;
  detail: string | Record<string, unknown>;
  constructor(statusCode: number, detail: string | Record<string, unknown>) {
    super(typeof detail === "string" ? detail : String(detail["message"] ?? detail["reason"] ?? "License error"));
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/** Port of server.py:6084 `_normalize_license_key`. */
export function normalizeLicenseKey(value: string): string {
  return (value || "").trim().toUpperCase().replace(/ /g, "");
}

/**
 * Port of server.py:6307 `_resolve_monitor_license` -- THE canonical license
 * authentication + binding service. Every EA-facing or license-gated
 * endpoint must call this, not roll its own check (matches the v6.25.3
 * owner directive that unified /pins/validate, heartbeat, activity, thesis
 * status, direction reservation, command polling, Outlook evidence, and
 * download authorization onto one implementation).
 *
 * Rules preserved exactly: unbound license -> first valid MT5 account to
 * present it claims it ATOMICALLY (findOneAndUpdate's filter re-checks
 * mt5_account is still empty at write time, so two accounts racing to
 * first-claim the same never-used PIN cannot both win). Bound license ->
 * every future request must match the bound account exactly, or fails
 * closed with LICENSE_BOUND_TO_DIFFERENT_MT5_ACCOUNT.
 */
export async function resolveMonitorLicense(pin: string, account: string): Promise<Document> {
  const raw = normalizeLicenseKey(pin);
  const acct = (account || "").trim();
  const db = getDb();
  const licenses = db.collection("pin_licenses");

  if (raw) {
    let lic = await licenses.findOne({ pin: raw, is_active: true }, { projection: { _id: 0 } });
    if (!lic) {
      throw new LicenseError(403, {
        ok: false,
        reason: "INVALID_OR_INACTIVE_LICENSE_PIN",
        message: "License PIN was not found or is inactive.",
        license_pin: raw,
        account: acct,
      });
    }

    let bound = String(lic["mt5_account"] ?? "").trim();
    if (!bound && acct) {
      const nowIso = new Date().toISOString();
      // Atomic first-claim -- filter requires mt5_account to STILL be
      // empty/missing at the moment of this write.
      const claimResult = await licenses.updateOne(
        { pin: raw, is_active: true, mt5_account: { $in: [null, ""] } },
        { $set: { mt5_account: acct, is_used: true, activated_at: nowIso } },
      );
      if (claimResult.modifiedCount === 1) {
        lic["mt5_account"] = acct;
        lic["is_used"] = true;
        lic["activated_at"] = nowIso;
        bound = acct;
      } else {
        const reread = await licenses.findOne({ pin: raw, is_active: true }, { projection: { _id: 0 } });
        lic = reread ?? lic;
        bound = String(lic["mt5_account"] ?? "").trim();
      }
    }

    if (bound && acct && bound !== acct) {
      throw new LicenseError(403, {
        ok: false,
        reason: "LICENSE_BOUND_TO_DIFFERENT_MT5_ACCOUNT",
        message: `License is already bound to MT5 account ${bound}.`,
        license_pin: raw,
        bound_account: bound,
        account: acct,
      });
    }

    return lic;
  }

  throw new LicenseError(403, {
    ok: false,
    reason: "MISSING_LICENSE_PIN",
    message: "EA monitor requests must include license_pin/pin. Put your ASE license key in InpLicensePIN.",
    account: acct,
  });
}
