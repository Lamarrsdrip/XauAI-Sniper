import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("./manualTradingMarketStore.js", () => ({
  recordVerifiedManualTradingQuote: async () => ({ persisted: true }),
  recordAuditableEaDecision: async () => undefined,
}));

const {
  attestAccountEnvironment, normalizeRuntimeEnvironment, resolveTrustedRuntimeEnvironment, revokeAccountEnvironment, AccountProvenanceError,
} = await import("./accountProvenance.js");
const { buildBotTradeObservation, buildOutlookObservation } = await import("./globalBrainIngest.js");
const { runGlobalBrainDailyCycle } = await import("./globalBrainTraining.js");
const { storeBotActivity } = await import("./botActivity.js");
const { latestEaEvidence } = await import("./marketOutlookEvidence.js");
const { heartbeatMarketDetails } = await import("../routes/cloud/monitor.js");

const ADMIN = "owner@xaucloud.io";

function seedLicense(id: string, pin: string, account: string): void {
  void state.db.collection("pin_licenses").insertOne({ id, pin, mt5_account: account, is_active: true });
}

/** A resolved, resolvable closed trade exactly as routes/journal.ts stores it for a v6.28.6 close (no environment field sent). */
async function journalTrade(licenseId: string, account: string, identity: string, reported?: string): Promise<Record<string, unknown>> {
  const provenance = await resolveTrustedRuntimeEnvironment({ license_id: licenseId, account, reported_environment: reported });
  return {
    trade_identity: identity, license_id: licenseId, account_login: account, symbol: "XAUUSD", direction: "BUY", result: "WIN",
    final_r: 1, mfe_r: 1.2, mae_r: -0.2, closed_at: 1_789_000_000, opened_at: 1_788_999_000, ea_version: "6.28.6",
    runtime_environment: provenance.environment, environment_source: provenance.environment_source,
    environment_attestation_id: provenance.environment_attestation_id,
  };
}

async function eligibleCount(): Promise<number> {
  return (await runGlobalBrainDailyCycle({ dryRun: true })).observations_eligible;
}

describe("trusted LIVE provenance", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.db.uniqueIndexes.cloud_market_evidence = ["evidence_key"];
    seedLicense("lic-a", "PIN-A", "476396807");
    seedLicense("lic-b", "PIN-B", "5550001");
  });

  it("never turns a missing or unknown environment into LIVE", async () => {
    expect(normalizeRuntimeEnvironment(undefined)).toBe("UNKNOWN");
    expect(normalizeRuntimeEnvironment("")).toBe("UNKNOWN");
    expect(normalizeRuntimeEnvironment("CONTEST")).toBe("DEMO");
    expect(await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "476396807" })).toMatchObject({ environment: "UNKNOWN", environment_source: "NONE" });
  });

  it("does not accept an EA/client claim of LIVE as proof", async () => {
    const resolved = await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "476396807", reported_environment: "LIVE" });
    expect(resolved).toMatchObject({ environment: "UNKNOWN", environment_source: "NONE", reported_environment: "LIVE", environment_attestation_id: null });
  });

  it("establishes LIVE for the current v6.28.6 EA through the admin attestation on the license-bound account", async () => {
    const attestation = await attestAccountEnvironment({ license_pin: "pin-a", mt5_account: "476396807", environment: "LIVE", note: "verified broker statement" }, ADMIN);
    const resolved = await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "476396807", broker_server: "Exness-MT5Real8" });
    expect(resolved).toMatchObject({ environment: "LIVE", environment_source: "SERVER_ATTESTATION", environment_attestation_id: attestation.id });
    expect(state.db.collection("global_brain_account_provenance_audit").docs[0]).toMatchObject({ action: "ATTEST", environment: "LIVE", by: ADMIN });
  });

  it("lets DEMO / TESTER / REPLAY / a demo broker server downgrade even an attested LIVE account", async () => {
    await attestAccountEnvironment({ license_pin: "PIN-A", mt5_account: "476396807", environment: "LIVE" }, ADMIN);
    for (const reported of ["DEMO", "TESTER", "REPLAY"]) {
      expect((await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "476396807", reported_environment: reported })).environment).toBe(reported);
    }
    expect(await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "476396807", broker_server: "Exness-MT5Trial-Demo" })).toMatchObject({ environment: "DEMO", environment_source: "BROKER_SERVER_HINT" });
  });

  it("refuses to attest an account the license is not strictly bound to, and never leaks between accounts", async () => {
    await expect(attestAccountEnvironment({ license_pin: "PIN-A", mt5_account: "5550001", environment: "LIVE" }, ADMIN)).rejects.toThrow(AccountProvenanceError);
    await attestAccountEnvironment({ license_pin: "PIN-A", mt5_account: "476396807", environment: "LIVE" }, ADMIN);
    // Account B shares nothing with A's attestation -- not by account, not by license.
    expect((await resolveTrustedRuntimeEnvironment({ license_id: "lic-b", account: "5550001" })).environment).toBe("UNKNOWN");
    expect((await resolveTrustedRuntimeEnvironment({ license_id: "lic-b", account: "476396807" })).environment).toBe("UNKNOWN");
    expect((await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "5550001" })).environment).toBe("UNKNOWN");
  });

  it("distrusts a request from a different broker server than the one attested", async () => {
    await attestAccountEnvironment({ license_pin: "PIN-A", mt5_account: "476396807", environment: "LIVE", broker_server: "Exness-MT5Real8" }, ADMIN);
    expect((await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "476396807", broker_server: "OtherBroker-Live" })).environment).toBe("UNKNOWN");
    expect((await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "476396807", broker_server: "exness-mt5real8" })).environment).toBe("LIVE");
  });

  it("fails closed to UNKNOWN when the attestation store cannot be read", async () => {
    await attestAccountEnvironment({ license_pin: "PIN-A", mt5_account: "476396807", environment: "LIVE" }, ADMIN);
    const real = state.db.collection.bind(state.db);
    (state.db as unknown as { collection: (name: string) => unknown }).collection = (name: string) => {
      if (name === "global_brain_account_provenance") throw new Error("down");
      return real(name);
    };
    expect((await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "476396807" })).environment).toBe("UNKNOWN");
  });

  it("carries attested LIVE from a v6.28.6 trade close into trusted training, and revocation withdraws it", async () => {
    const observations = state.db.collection("global_brain_observations");
    // Before attestation: the same genuine live account trains nothing.
    await observations.insertOne(buildBotTradeObservation(await journalTrade("lic-a", "476396807", "pre-attest"), null) as unknown as Record<string, unknown>);
    expect(await eligibleCount()).toBe(0);

    await attestAccountEnvironment({ license_pin: "PIN-A", mt5_account: "476396807", environment: "LIVE" }, ADMIN);
    const trade = await journalTrade("lic-a", "476396807", "post-attest");
    const observation = buildBotTradeObservation(trade, null);
    expect(observation.provenance).toMatchObject({ environment: "LIVE", environment_source: "SERVER_ATTESTATION", integrity_epoch: "IMMUTABLE_EVIDENCE_V2_2026_09_11" });
    await observations.insertOne(observation as unknown as Record<string, unknown>);
    // Only the post-attestation trade; the earlier UNKNOWN one is NOT retroactively promoted.
    expect(await eligibleCount()).toBe(1);

    await revokeAccountEnvironment({ license_pin: "PIN-A", mt5_account: "476396807", reason: "attested in error" }, ADMIN);
    expect(await eligibleCount()).toBe(0);
    // Re-attesting issues a new id; records stamped under the revoked one stay untrusted.
    await attestAccountEnvironment({ license_pin: "PIN-A", mt5_account: "476396807", environment: "LIVE" }, ADMIN);
    expect(await eligibleCount()).toBe(0);
  });

  it("stamps attested provenance onto immutable heartbeat evidence and through to the Outlook observation", async () => {
    const attestation = await attestAccountEnvironment({ license_pin: "PIN-A", mt5_account: "476396807", environment: "LIVE" }, ADMIN);
    const provenance = await resolveTrustedRuntimeEnvironment({ license_id: "lic-a", account: "476396807", broker_server: "Exness-MT5Real8" });
    const details = heartbeatMarketDetails({
      license_key: "PIN-A", provenance, ea_version: "6.28.6", broker_server: "Exness-MT5Real8",
      market_thesis: { live_bid: 3000, live_ask: 3000.2, evidence_time_utc: new Date().toISOString() },
    });
    await storeBotActivity("MARKET_HEARTBEAT", "INFO", "heartbeat", "476396807", "XAUUSD", details);
    // Another account's heartbeat in the same instant stays UNKNOWN.
    const otherProvenance = await resolveTrustedRuntimeEnvironment({ license_id: "lic-b", account: "5550001" });
    await storeBotActivity("MARKET_HEARTBEAT", "INFO", "heartbeat", "5550001", "XAUUSD", heartbeatMarketDetails({
      license_key: "PIN-B", provenance: otherProvenance, market_thesis: { live_bid: 3000, live_ask: 3000.2, evidence_time_utc: new Date().toISOString() },
    }));

    const ledger = state.db.collection("cloud_market_evidence").docs;
    expect(ledger.find((r) => r["account"] === "476396807")?.["provenance"]).toMatchObject({ runtime_environment: "LIVE", environment_source: "SERVER_ATTESTATION", environment_attestation_id: attestation.id, ea_version: "6.28.6" });
    expect(ledger.find((r) => r["account"] === "5550001")?.["provenance"]).toMatchObject({ runtime_environment: "UNKNOWN", environment_source: "NONE", environment_attestation_id: null });

    const { evidence } = await latestEaEvidence("PIN-A", "476396807");
    expect(evidence).toMatchObject({ runtime_environment: "LIVE", environment_source: "SERVER_ATTESTATION", environment_attestation_id: attestation.id });
    // marketOutlookSignal.ts copies exactly these evidence fields onto the Outlook doc.
    const outlook = buildOutlookObservation({
      id: "outlook-1", account: "476396807", symbol: "XAUUSD", primary_direction: "BUY", analytics_outcome: "WIN", analytics_r: 1,
      published_quote_at: "2026-09-11T10:00:00.000Z", published_at: "2026-09-11T10:00:00.000Z", classification_at: "2026-09-11T10:30:00.000Z",
      evaluation_deadline: "2026-09-11T11:00:00.000Z", source_evidence_id: evidence?.["evidence_id"],
      runtime_environment: evidence?.["runtime_environment"], environment_source: evidence?.["environment_source"], environment_attestation_id: evidence?.["environment_attestation_id"],
    }, []);
    expect(outlook?.provenance).toMatchObject({ environment: "LIVE", environment_source: "SERVER_ATTESTATION", environment_attestation_id: attestation.id, integrity_epoch: "IMMUTABLE_EVIDENCE_V2_2026_09_11" });
  });
});
