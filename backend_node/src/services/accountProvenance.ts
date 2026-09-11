import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { normalizeLicenseKey } from "./license.js";
import { recordPersistentDiagnostic } from "./persistentDiagnostics.js";

/**
 * Global Brain runtime-environment provenance.
 *
 * WHY A SERVER-SIDE ATTESTATION IS THE SOURCE OF TRUTH FOR "LIVE":
 * every EA payload is client-controlled text -- anyone holding a license key
 * can POST `runtime_environment: "LIVE"` -- and the shared Global Brain must
 * not let one licensee's claim steer learning for everyone. Production
 * v6.28.6 (XauCloud.mq5) sends no environment field at all (it only Prints
 * ACCOUNT_TRADE_MODE at startup), and there is no server-side LIVE/DEMO
 * classification anywhere else in the backend. The one authenticated identity
 * the backend has is the license, strictly bound to exactly one MT5 account by
 * resolveMonitorLicense. So LIVE is established by an admin attestation keyed
 * on that binding (license_id + MT5 account), made through the admin-only API
 * after the owner verifies the account.
 *
 * Precedence is most-restrictive-wins: an EA-reported DEMO/TESTER/REPLAY (or
 * a broker server named "...demo...") always downgrades and can never be
 * overridden upward; LIVE is only ever returned from an active attestation.
 * Missing/unknown environment is UNKNOWN, never LIVE.
 *
 * The resolved value is stamped at INGESTION onto the immutable evidence /
 * trade record, so a later attestation never retroactively promotes older
 * UNKNOWN records. Training additionally re-checks that the stamped
 * attestation is still active, so revoking a mistaken attestation withdraws
 * every observation that relied on it.
 */

export const ACCOUNT_PROVENANCE_COLLECTION = "global_brain_account_provenance";
export const ACCOUNT_PROVENANCE_AUDIT_COLLECTION = "global_brain_account_provenance_audit";

export type RuntimeEnvironment = "LIVE" | "DEMO" | "TESTER" | "REPLAY" | "UNKNOWN";
export type AttestableEnvironment = "LIVE" | "DEMO";
export type EnvironmentSource = "SERVER_ATTESTATION" | "EA_REPORTED" | "BROKER_SERVER_HINT" | "NONE";

export interface ResolvedRuntimeProvenance {
  environment: RuntimeEnvironment;
  environment_source: EnvironmentSource;
  environment_attestation_id: string | null;
  /** What the client claimed, kept for audit only -- never a basis for trust. */
  reported_environment: RuntimeEnvironment;
}

export interface AccountProvenanceDoc {
  id: string;
  license_id: string;
  account: string;
  environment: AttestableEnvironment;
  broker_server: string;
  note: string;
  active: boolean;
  attested_by: string;
  attested_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export class AccountProvenanceError extends Error {}

/** The single normalizer for every runtime-environment string in the backend. */
export function normalizeRuntimeEnvironment(raw: unknown): RuntimeEnvironment {
  const value = String(raw ?? "").trim().toUpperCase();
  if (["LIVE", "REAL", "PRODUCTION"].includes(value)) return "LIVE";
  // MT5 ACCOUNT_TRADE_MODE_CONTEST is not real money either.
  if (["DEMO", "PAPER", "CONTEST"].includes(value)) return "DEMO";
  if (["TESTER", "BACKTEST", "STRATEGY_TESTER"].includes(value)) return "TESTER";
  if (["REPLAY", "SIMULATION", "SIMULATOR"].includes(value)) return "REPLAY";
  return "UNKNOWN";
}

const ENVIRONMENT_SOURCES = new Set<EnvironmentSource>(["SERVER_ATTESTATION", "EA_REPORTED", "BROKER_SERVER_HINT", "NONE"]);

/** Reads a server-stamped source back off a stored record; anything unrecognized is NONE. */
export function normalizeEnvironmentSource(raw: unknown): EnvironmentSource {
  const value = String(raw ?? "").trim().toUpperCase() as EnvironmentSource;
  return ENVIRONMENT_SOURCES.has(value) ? value : "NONE";
}

function normalizeBrokerServer(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export async function ensureAccountProvenanceIndexes(): Promise<void> {
  const db = getDb();
  await db.collection(ACCOUNT_PROVENANCE_COLLECTION).createIndex({ license_id: 1, account: 1 }, { unique: true });
  await db.collection(ACCOUNT_PROVENANCE_COLLECTION).createIndex({ id: 1 }, { unique: true });
  await db.collection(ACCOUNT_PROVENANCE_AUDIT_COLLECTION).createIndex({ license_id: 1, account: 1, at: -1 });
}

/**
 * Resolves the trusted runtime environment for one authenticated EA request.
 * `license_id`/`account` must come from the server-side license binding the
 * route has ALREADY enforced -- never from free request text. Never throws:
 * an attestation-store failure fails closed to UNKNOWN with a diagnostic.
 */
export async function resolveTrustedRuntimeEnvironment(input: {
  license_id: string;
  account: string;
  reported_environment?: unknown;
  broker_server?: unknown;
}): Promise<ResolvedRuntimeProvenance> {
  const reported = normalizeRuntimeEnvironment(input.reported_environment);
  const result = (environment: RuntimeEnvironment, environment_source: EnvironmentSource, environment_attestation_id: string | null = null): ResolvedRuntimeProvenance => ({
    environment, environment_source, environment_attestation_id, reported_environment: reported,
  });

  // Downgrades are always honored, whoever reports them.
  if (reported === "DEMO" || reported === "TESTER" || reported === "REPLAY") return result(reported, "EA_REPORTED");
  const brokerServer = normalizeBrokerServer(input.broker_server);
  if (brokerServer.includes("demo")) return result("DEMO", "BROKER_SERVER_HINT");

  const licenseId = String(input.license_id ?? "").trim();
  const account = String(input.account ?? "").trim();
  if (!licenseId || !account) return result("UNKNOWN", "NONE");

  let attestation: AccountProvenanceDoc | null = null;
  try {
    attestation = await getDb().collection<AccountProvenanceDoc>(ACCOUNT_PROVENANCE_COLLECTION).findOne(
      { license_id: licenseId, account, active: true },
      { projection: { _id: 0 } },
    );
  } catch (error) {
    await recordPersistentDiagnostic("error", "account-provenance", error, { code: "ACCOUNT_PROVENANCE_READ_FAILED", account });
    return result("UNKNOWN", "NONE");
  }
  if (!attestation) return result("UNKNOWN", "NONE");

  // MT5 logins are only unique per broker server. When the attestation pins a
  // server and the request reports a different one, trust nothing.
  const attestedServer = normalizeBrokerServer(attestation.broker_server);
  if (attestedServer && brokerServer && attestedServer !== brokerServer) {
    await recordPersistentDiagnostic("warning", "account-provenance", "reported broker server does not match the attested server", {
      code: "ACCOUNT_PROVENANCE_BROKER_MISMATCH", account, details: { attested_broker_server: attestation.broker_server },
    });
    return result("UNKNOWN", "NONE");
  }
  if (attestation.environment === "DEMO") return result("DEMO", "SERVER_ATTESTATION", attestation.id);
  if (attestation.environment === "LIVE") return result("LIVE", "SERVER_ATTESTATION", attestation.id);
  return result("UNKNOWN", "NONE");
}

/** Ids of attestations that currently vouch for LIVE. Throws on read failure so callers can fail closed explicitly. */
export async function activeLiveAttestationIds(): Promise<Set<string>> {
  const rows = await getDb()
    .collection<AccountProvenanceDoc>(ACCOUNT_PROVENANCE_COLLECTION)
    .find({ active: true, environment: "LIVE" }, { projection: { _id: 0, id: 1 } })
    .toArray();
  return new Set(rows.map((row) => String(row.id)));
}

async function writeProvenanceAudit(entry: Record<string, unknown>): Promise<void> {
  await getDb().collection(ACCOUNT_PROVENANCE_AUDIT_COLLECTION).insertOne({ id: randomUUID(), at: new Date().toISOString(), ...entry });
}

/** Resolves the license the same way the EA routes do and requires it to be bound to exactly this MT5 account. */
async function boundLicenseId(input: { license_pin?: string; license_id?: string; account: string }): Promise<string> {
  const account = String(input.account ?? "").trim();
  if (!account) throw new AccountProvenanceError("mt5_account is required.");
  const pin = normalizeLicenseKey(input.license_pin ?? "");
  const id = String(input.license_id ?? "").trim();
  if (!pin && !id) throw new AccountProvenanceError("license_pin or license_id is required.");
  const license = await getDb().collection("pin_licenses").findOne(pin ? { pin } : { id }, { projection: { _id: 0, id: 1, mt5_account: 1, is_active: 1 } });
  if (!license || license["is_active"] !== true) throw new AccountProvenanceError("License not found or inactive.");
  if (String(license["mt5_account"] ?? "").trim() !== account) {
    throw new AccountProvenanceError("License is not bound to this MT5 account; attest only the account the license is strictly bound to.");
  }
  const licenseId = String(license["id"] ?? "").trim();
  if (!licenseId) throw new AccountProvenanceError("License has no id.");
  return licenseId;
}

/**
 * Admin attestation that a license-bound MT5 account is LIVE (or DEMO).
 * Re-attesting the same environment keeps the attestation id; changing the
 * environment, or re-attesting after a revocation, issues a NEW id so records
 * stamped under the superseded attestation are no longer trusted.
 */
export async function attestAccountEnvironment(
  input: { license_pin?: string; license_id?: string; mt5_account: string; environment: AttestableEnvironment; broker_server?: string; note?: string },
  adminEmail: string,
): Promise<AccountProvenanceDoc> {
  if (input.environment !== "LIVE" && input.environment !== "DEMO") throw new AccountProvenanceError("environment must be LIVE or DEMO.");
  const account = String(input.mt5_account ?? "").trim();
  const licenseId = await boundLicenseId({ license_pin: input.license_pin, license_id: input.license_id, account });
  const collection = getDb().collection<AccountProvenanceDoc>(ACCOUNT_PROVENANCE_COLLECTION);
  const existing = await collection.findOne({ license_id: licenseId, account }, { projection: { _id: 0 } });
  const keepId = existing && existing.active && existing.environment === input.environment;
  const nowIso = new Date().toISOString();
  const doc: AccountProvenanceDoc = {
    id: keepId ? existing.id : randomUUID(),
    license_id: licenseId,
    account,
    environment: input.environment,
    broker_server: String(input.broker_server ?? "").trim(),
    note: String(input.note ?? "").slice(0, 500),
    active: true,
    attested_by: adminEmail,
    attested_at: nowIso,
    revoked_by: null,
    revoked_at: null,
    revoke_reason: null,
  };
  await collection.updateOne({ license_id: licenseId, account }, { $set: doc }, { upsert: true });
  await writeProvenanceAudit({
    action: "ATTEST", license_id: licenseId, account, environment: doc.environment, attestation_id: doc.id,
    previous_attestation_id: existing?.id ?? null, previous_environment: existing?.active ? existing.environment : null,
    broker_server: doc.broker_server, note: doc.note, by: adminEmail,
  });
  return doc;
}

/** Withdraws an attestation. Every observation stamped with its id stops being trusted at the next training cycle. */
export async function revokeAccountEnvironment(
  input: { license_pin?: string; license_id?: string; mt5_account: string; reason: string },
  adminEmail: string,
): Promise<AccountProvenanceDoc> {
  const account = String(input.mt5_account ?? "").trim();
  const pin = normalizeLicenseKey(input.license_pin ?? "");
  let licenseId = String(input.license_id ?? "").trim();
  // Revocation must still work after a license is unbound/rebound, so it does
  // not require the binding to be current -- only that the attestation exists.
  if (!licenseId && pin) {
    const license = await getDb().collection("pin_licenses").findOne({ pin }, { projection: { _id: 0, id: 1 } });
    licenseId = String(license?.["id"] ?? "").trim();
  }
  if (!licenseId || !account) throw new AccountProvenanceError("license and mt5_account are required.");
  const collection = getDb().collection<AccountProvenanceDoc>(ACCOUNT_PROVENANCE_COLLECTION);
  const existing = await collection.findOne({ license_id: licenseId, account }, { projection: { _id: 0 } });
  if (!existing || !existing.active) throw new AccountProvenanceError("No active attestation exists for this license/account.");
  const nowIso = new Date().toISOString();
  const reason = String(input.reason ?? "").slice(0, 500);
  await collection.updateOne({ license_id: licenseId, account }, { $set: { active: false, revoked_by: adminEmail, revoked_at: nowIso, revoke_reason: reason } });
  await writeProvenanceAudit({ action: "REVOKE", license_id: licenseId, account, environment: existing.environment, attestation_id: existing.id, reason, by: adminEmail });
  return { ...existing, active: false, revoked_by: adminEmail, revoked_at: nowIso, revoke_reason: reason };
}

export async function listAccountProvenance(): Promise<AccountProvenanceDoc[]> {
  return getDb().collection<AccountProvenanceDoc>(ACCOUNT_PROVENANCE_COLLECTION).find({}, { projection: { _id: 0 } }).sort({ attested_at: -1 }).limit(500).toArray();
}
