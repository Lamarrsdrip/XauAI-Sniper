import type { FastifyInstance } from "fastify";
import type { Document } from "mongodb";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db.js";
import { env } from "../../env.js";
import { resolveMonitorLicense } from "../../services/license.js";
import {
  LEASE_ALGORITHM_ID,
  LEASE_SCHEMA_VERSION,
  LeaseCryptoNotConfigured,
  loadSigningKey,
  newNonce,
  signLease,
} from "../../services/leaseService.js";
import { LeaseReconcileReqSchema, LeaseRequestReqSchema, LeaseSurrenderReqSchema } from "../../models/lease.js";

const RESERVATION_VALID_SYMBOLS = new Set(["XAUUSD", "XAUUSDM", "XAUUSD.", "GOLD"]);

/** Port of server.py `_lease_authority_key`. */
function leaseAuthorityKey(licenseId: string, account: string, brokerServer: string, symbol: string): string {
  return `${licenseId}:${(brokerServer || "").trim()}:${(account || "").trim()}:${(symbol || "").trim().toUpperCase()}`;
}

/** Port of server.py `get_lease_config`. */
function getLeaseConfig() {
  return {
    validitySeconds: env.XAUCLOUD_LEASE_VALIDITY_SECONDS || 900,
    renewalSecondsBeforeExpiry: env.XAUCLOUD_LEASE_RENEWAL_SECONDS || 300,
    maxOfflineCampaigns: env.XAUCLOUD_LEASE_MAX_OFFLINE_CAMPAIGNS || 1,
  };
}

export class LeaseHttpError extends Error {
  constructor(
    public statusCode: number,
    public detail: string | Record<string, unknown>,
  ) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

/** Port of server.py's `_issue_lease` -- shared atomic issue/renew logic for /lease/request and /lease/renew. */
async function issueLease(
  lic: Document,
  reqAccount: string,
  reqBrokerServer: string,
  reqSymbol: string,
  installationId: string,
  terminalInstanceId: string,
  allowedDirections: number[],
  allowedEntryFamilies: string[],
  isRenewal: boolean,
): Promise<Record<string, unknown>> {
  if (!installationId || !terminalInstanceId) {
    throw new LeaseHttpError(400, "installation_id and terminal_instance_id are required");
  }
  const symbolNorm = (reqSymbol || "").trim().toUpperCase();
  if (!RESERVATION_VALID_SYMBOLS.has(symbolNorm)) {
    throw new LeaseHttpError(400, { ok: false, reason: "INVALID_SYMBOL", symbol: reqSymbol });
  }

  const cfg = getLeaseConfig();
  const key = leaseAuthorityKey(String(lic["id"] ?? ""), reqAccount, reqBrokerServer, symbolNorm);
  const now = new Date();
  const nowIso = now.toISOString();

  const db = getDb();
  const authority = db.collection("lease_terminal_authority");
  const existing = await authority.findOne({ _id: key as unknown as never });

  if (existing) {
    const holderTerminal = String(existing["holder_terminal_id"] ?? "");
    const holderExpired = String(existing["lease_expires_at"] ?? "") <= nowIso;
    const surrendered = Boolean(existing["surrendered"]);
    if (holderTerminal !== terminalInstanceId && !holderExpired && !surrendered) {
      throw new LeaseHttpError(403, {
        ok: false,
        reason: "PRIMARY_TERMINAL_ALREADY_ASSIGNED",
        message: "Another terminal already holds an active offline lease for this account/symbol.",
        holder_terminal_id: holderTerminal,
        lease_expires_at: existing["lease_expires_at"],
      });
    }
    if (isRenewal && holderTerminal !== terminalInstanceId) {
      throw new LeaseHttpError(403, {
        ok: false,
        reason: "NOT_CURRENT_HOLDER",
        message: "Only the current primary terminal may renew this lease.",
      });
    }
  }

  let signingKey;
  try {
    signingKey = loadSigningKey();
  } catch (e) {
    if (e instanceof LeaseCryptoNotConfigured) {
      throw new LeaseHttpError(503, "Lease signing is not configured on this server.");
    }
    throw e;
  }

  const nextSequence = Number(existing?.["lease_sequence"] ?? 0) + 1;
  const revocationEpoch = Number(existing?.["revocation_epoch"] ?? 1);
  const leaseId = randomUUID();
  const expiresAt = new Date(now.getTime() + cfg.validitySeconds * 1000);
  const renewalAfter = new Date(expiresAt.getTime() - cfg.renewalSecondsBeforeExpiry * 1000);

  const leaseFields: Record<string, unknown> = {
    schema_version: LEASE_SCHEMA_VERSION,
    lease_id: leaseId,
    key_id: signingKey.keyId,
    tenant_id: lic["id"] ?? "",
    license_id: lic["id"] ?? "",
    account_login: reqAccount,
    account_server: reqBrokerServer,
    installation_id: installationId,
    terminal_instance_id: terminalInstanceId,
    normalized_symbol: symbolNorm,
    allowed_directions: allowedDirections,
    allowed_entry_families: allowedEntryFamilies,
    issued_at_unix: Math.trunc(now.getTime() / 1000),
    not_before_unix: Math.trunc(now.getTime() / 1000),
    expires_at_unix: Math.trunc(expiresAt.getTime() / 1000),
    renewal_after_unix: Math.trunc(renewalAfter.getTime() / 1000),
    maximum_offline_new_campaigns: cfg.maxOfflineCampaigns,
    remaining_offline_new_campaigns: cfg.maxOfflineCampaigns,
    lease_sequence: nextSequence,
    revocation_epoch: revocationEpoch,
    nonce: newNonce(),
  };
  const signatureHex = signLease(signingKey, leaseFields);

  const filterQuery = {
    _id: key as unknown as never,
    $or: [
      { holder_terminal_id: { $exists: false } },
      { holder_terminal_id: terminalInstanceId },
      { lease_expires_at: { $lte: nowIso } },
      { surrendered: true },
    ],
  };
  const updateResult = await authority.findOneAndUpdate(
    filterQuery,
    {
      $set: {
        holder_terminal_id: terminalInstanceId,
        holder_installation_id: installationId,
        lease_sequence: nextSequence,
        revocation_epoch: revocationEpoch,
        current_lease_id: leaseId,
        lease_expires_at: expiresAt.toISOString(),
        surrendered: false,
        updated_at: nowIso,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  if (!updateResult || updateResult["current_lease_id"] !== leaseId) {
    throw new LeaseHttpError(409, { ok: false, reason: "CONCURRENT_LEASE_ASSIGNMENT", message: "Lease assignment raced with another request; retry." });
  }

  const leaseDoc: Record<string, unknown> = {
    ...leaseFields,
    signature_algorithm: LEASE_ALGORITHM_ID,
    detached_signature: signatureHex,
    _history_id: randomUUID(),
    recorded_at: nowIso,
    issued_at_iso: nowIso,
    expires_at_iso: expiresAt.toISOString(),
    renewal_after_iso: renewalAfter.toISOString(),
  };
  await db.collection("lease_documents").insertOne({ ...leaseDoc });
  delete leaseDoc["_id"];
  return leaseDoc;
}

/** Port of server.py's bounded offline trading lease endpoints (lines 7573-7864) and thesis-status wiring context. */
export async function registerCloudLeaseRoutes(app: FastifyInstance): Promise<void> {
  app.post("/cloud/lease/request", async (request) => {
    const req = LeaseRequestReqSchema.parse(request.body);
    const lic = await resolveMonitorLicense(req.pin || req.license_key, req.account);
    const leaseDoc = await issueLease(lic, req.account, req.broker_server, req.symbol, req.installation_id, req.terminal_instance_id, req.allowed_directions, req.allowed_entry_families, false);
    return { issued: true, lease: leaseDoc };
  });

  app.post("/cloud/lease/renew", async (request) => {
    const req = LeaseRequestReqSchema.parse(request.body);
    const lic = await resolveMonitorLicense(req.pin || req.license_key, req.account);
    const leaseDoc = await issueLease(lic, req.account, req.broker_server, req.symbol, req.installation_id, req.terminal_instance_id, req.allowed_directions, req.allowed_entry_families, true);
    return { issued: true, lease: leaseDoc };
  });

  app.post("/cloud/lease/surrender", async (request) => {
    const req = LeaseSurrenderReqSchema.parse(request.body);
    const lic = await resolveMonitorLicense(req.pin || req.license_key, req.account);
    const key = leaseAuthorityKey(String(lic["id"] ?? ""), req.account, req.broker_server, req.symbol);
    const nowIso = new Date().toISOString();
    const result = await getDb()
      .collection("lease_terminal_authority")
      .updateOne(
        { _id: key as unknown as never, holder_terminal_id: req.terminal_instance_id, current_lease_id: req.lease_id },
        { $set: { surrendered: true, updated_at: nowIso } },
      );
    return { surrendered: result.modifiedCount > 0 };
  });

  app.get("/cloud/lease/status", async (request) => {
    const q = request.query as { pin?: string; account?: string; broker_server?: string; symbol?: string };
    const lic = await resolveMonitorLicense(q.pin ?? "", q.account ?? "");
    const key = leaseAuthorityKey(String(lic["id"] ?? ""), q.account ?? "", q.broker_server ?? "", q.symbol ?? "");
    const authority = await getDb().collection("lease_terminal_authority").findOne({ _id: key as unknown as never }, { projection: { _id: 0 } });
    if (!authority) return { has_authority_record: false };
    const nowIso = new Date().toISOString();
    return {
      has_authority_record: true,
      holder_terminal_id: authority["holder_terminal_id"],
      lease_sequence: authority["lease_sequence"],
      lease_expires_at: authority["lease_expires_at"],
      is_expired: String(authority["lease_expires_at"] ?? "") <= nowIso,
      surrendered: authority["surrendered"] ?? false,
      revocation_epoch: authority["revocation_epoch"],
    };
  });

  app.post("/cloud/lease/reconcile", async (request) => {
    const req = LeaseReconcileReqSchema.parse(request.body);
    const lic = await resolveMonitorLicense(req.pin || req.license_key, req.account);
    const nowIso = new Date().toISOString();
    const results: { execution_key: string; status: string }[] = [];
    const offlineEvents = getDb().collection("lease_offline_events");

    for (const ev of req.events) {
      const doc: Record<string, unknown> = {
        ...ev,
        _id: ev.execution_key,
        license_id: lic["id"] ?? "",
        account: req.account,
        broker_server: req.broker_server,
        symbol: req.symbol,
        installation_id: req.installation_id,
        terminal_instance_id: req.terminal_instance_id,
        reconciled_at: nowIso,
      };
      try {
        await offlineEvents.insertOne(doc as unknown as Document);
        results.push({ execution_key: ev.execution_key, status: "reconciled" });
      } catch {
        results.push({ execution_key: ev.execution_key, status: "already_reconciled" });
      }
    }
    return { reconciled: true, events: results };
  });
}
