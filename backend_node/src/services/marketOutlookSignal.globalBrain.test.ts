import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
// No EMERGENT_LLM_KEY is set in this file, so synthesizeNarrative and the
// AI budget guard both take their deterministic no-key fallback paths --
// no network calls, no LlmChat mocking needed for this test file.
vi.mock("./goldPrice.js", () => ({ fetchLiveGoldPrice: vi.fn(async () => ({ source: "live", bid: 0, ask: 0 })) }));

const { generateOutlookForAccount } = await import("./marketOutlookSignal.js");
const { promoteChallenger } = await import("./globalBrainRegistry.js");
const { updateGlobalBrainSettings } = await import("./globalBrainSettings.js");

function championInput(bucketKey: string, shrunkRate: number, n = 40) {
  return {
    question: "DIRECTION_QUALITY" as const,
    trained_at: new Date().toISOString(),
    training_window: { from: null, to: null, n },
    dataset_fingerprint: "fp",
    validation_metrics: { holdout_n: n, brier_score: 0.15, brier_se: 0.01, avg_r_captured: 0.4, avg_r_captured_se: 0.02, max_drawdown_r: 0.5 },
    holdout_metrics: { holdout_n: n, brier_score: 0.15, brier_se: 0.01, avg_r_captured: 0.4, avg_r_captured_se: 0.02, max_drawdown_r: 0.5 },
    buckets: {
      global_prior_rate: 0.5,
      global_n: n,
      buckets: [{ bucket_key: bucketKey, n, successes: Math.round(n * shrunkRate), raw_rate: shrunkRate, shrunk_rate: shrunkRate, avg_r: 0.2, sample_sufficient: true }],
    },
  };
}

/**
 * Seeds exactly enough real cloud_bot_activity evidence for
 * generateOutlookForAccount to resolve a clean, actionable BUY/SELL outlook
 * through its real code path (resolveHourlyBias -> zone construction ->
 * trackingAnchor) -- no mocking of the signal-generation logic itself, only
 * of its two true I/O boundaries (Mongo, the LLM narrative call).
 */
async function seedEaEvidence(account: string, direction: "BUY" | "SELL", overrides: Record<string, unknown> = {}): Promise<void> {
  const bid = direction === "BUY" ? 2650.0 : 2650.2;
  const ask = direction === "BUY" ? 2650.2 : 2650.4;
  await state.db.collection("cloud_bot_activity").insertOne({
    account,
    ts: new Date().toISOString(),
    details: {
      session: "LONDON",
      m10_signal: { decision: direction === "BUY" ? "BUY_CANDIDATE" : "SELL_CANDIDATE", freshness_state: "FRESH" },
      market_thesis: {
        live_bid: bid,
        live_ask: ask,
        evidence_time_utc: new Date().toISOString(),
        action: "ALLOW_CORE",
        market_regime: "TRENDING",
        buy_pressure: 50,
        sell_pressure: 50,
        location: "LOCATION_ACCEPTABLE",
        structure: "STRUCTURE_MIXED",
        ...overrides,
      },
    },
  });
}

const SETUP_TYPE = "TREND_CONTINUATION"; // ALLOW_CORE -> expectedPath DIRECT_CONTINUATION -> setup_type TREND_CONTINUATION

describe("generateOutlookForAccount -- Global Brain M10/OUTLOOK consumer (end-to-end, real code path)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("sanity: with no champion and switch off, a clean BUY publishes exactly as before Global Brain existed", async () => {
    await seedEaEvidence("acct-baseline", "BUY");
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-baseline", account_id: "acct-baseline" });
    expect(doc).not.toBeNull();
    expect(doc!["primary_direction"]).toBe("BUY");
    expect(doc!["direction"]).toBe(1);
    expect(doc!["expected_path"]).toBe("DIRECT_CONTINUATION");
    expect(doc!["setup_type"]).toBe(SETUP_TYPE);
    expect(doc!["global_brain_influence"]).toEqual({
      scope: "OUTLOOK",
      enabled: false,
      applied: false,
      recommendation: "NO_OPINION",
      reason: "outlook_learned_influence_enabled is OFF",
      direction_quality_bucket: null,
      direction_quality_shrunk_rate: null,
      direction_quality_n: 0,
    });
    expect(doc!["global_brain_blocked_direction"]).toBeNull();
  });

  it("OUTLOOK OFF (default): a REJECT-worthy champion has zero effect on the published BUY", async () => {
    await seedEaEvidence("acct-off", "BUY");
    await promoteChallenger(championInput(`BUY|LONDON|TRENDING|${SETUP_TYPE}`, 0.1, 40), "seed"); // would REJECT if consulted
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-off", account_id: "acct-off" });
    expect(doc!["primary_direction"]).toBe("BUY");
    expect((doc!["global_brain_influence"] as { enabled: boolean }).enabled).toBe(false);
  });

  it("OUTLOOK ON + REJECT: downgrades to BLOCKED and neutralizes expected_path/setup_type (regression for the ordering fix)", async () => {
    await seedEaEvidence("acct-reject", "BUY");
    await promoteChallenger(championInput(`BUY|LONDON|TRENDING|${SETUP_TYPE}`, 0.1, 40), "seed");
    await updateGlobalBrainSettings({ outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-reject", account_id: "acct-reject" });
    expect(doc!["primary_direction"]).toBe("BLOCKED");
    expect(doc!["direction"]).toBe(0);
    expect(doc!["global_brain_blocked_direction"]).toBe("BUY");
    // The bug this session found and fixed: before the fix, expected_path/setup_type
    // were computed before the reject check and stayed as the pre-reject directional
    // values, contradicting primary_direction=BLOCKED.
    expect(doc!["expected_path"]).toBe("RANGE_ROTATION"); // neutral value for effectiveDirection=0, LOCATION_ACCEPTABLE
    expect(doc!["setup_type"]).toBe("NONE");
    expect((doc!["global_brain_influence"] as { recommendation: string }).recommendation).toBe("REJECT");
  });

  it("M10 scope isolation: enabling M10 influence has zero effect on an OUTLOOK (HOURLY) publication", async () => {
    await seedEaEvidence("acct-scope-outlook", "BUY");
    await promoteChallenger(championInput(`BUY|LONDON|TRENDING|${SETUP_TYPE}`, 0.1, 40), "seed");
    await updateGlobalBrainSettings({ m10_learned_influence_enabled: true }, "admin@xaucloud.io");
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-scope-outlook", account_id: "acct-scope-outlook" });
    expect(doc!["primary_direction"]).toBe("BUY"); // unaffected -- this account's publication_mode is HOURLY/OUTLOOK, not M10_SIGNAL
    expect((doc!["global_brain_influence"] as { enabled: boolean; scope: string }).enabled).toBe(false);
    expect((doc!["global_brain_influence"] as { scope: string }).scope).toBe("OUTLOOK");
  });

  it("OUTLOOK scope isolation: enabling OUTLOOK influence has zero effect on an M10_SIGNAL publication", async () => {
    await seedEaEvidence("acct-scope-m10", "BUY");
    await promoteChallenger(championInput(`BUY|LONDON|TRENDING|${SETUP_TYPE}`, 0.1, 40), "seed");
    await updateGlobalBrainSettings({ outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-scope-m10", account_id: "acct-scope-m10", publication_mode: "M10_SIGNAL" });
    expect(doc!["primary_direction"]).toBe("BUY"); // unaffected -- OUTLOOK switch does not gate M10_SIGNAL publications
    expect((doc!["global_brain_influence"] as { enabled: boolean; scope: string }).scope).toBe("M10");
    expect((doc!["global_brain_influence"] as { enabled: boolean }).enabled).toBe(false);
  });

  it("M10 ON + REJECT (publication_mode=M10_SIGNAL) downgrades to BLOCKED, matching OUTLOOK's own REJECT behavior", async () => {
    await seedEaEvidence("acct-m10-reject", "BUY");
    await promoteChallenger(championInput(`BUY|LONDON|TRENDING|${SETUP_TYPE}`, 0.1, 40), "seed");
    await updateGlobalBrainSettings({ m10_learned_influence_enabled: true }, "admin@xaucloud.io");
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-m10-reject", account_id: "acct-m10-reject", publication_mode: "M10_SIGNAL" });
    expect(doc!["primary_direction"]).toBe("BLOCKED");
    expect(doc!["setup_type"]).toBe("NONE");
  });

  it("NO_OPINION (switch on, no champion promoted yet): BUY publishes unaffected, no mutation", async () => {
    await seedEaEvidence("acct-no-champion", "BUY");
    await updateGlobalBrainSettings({ outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-no-champion", account_id: "acct-no-champion" });
    expect(doc!["primary_direction"]).toBe("BUY");
    expect(doc!["expected_path"]).toBe("DIRECT_CONTINUATION");
    const influence = doc!["global_brain_influence"] as { recommendation: string; applied: boolean };
    expect(influence.recommendation).toBe("NO_OPINION");
    expect(influence.applied).toBe(false);
  });

  it("NO_OPINION (switch on, champion exists but this exact bucket has insufficient sample): BUY publishes unaffected", async () => {
    await seedEaEvidence("acct-thin-bucket", "BUY");
    await promoteChallenger(championInput("SELL|NY|RANGE|OPPOSITE_DIRECTION_REVERSAL", 0.1, 40), "seed"); // a different bucket entirely
    await updateGlobalBrainSettings({ outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-thin-bucket", account_id: "acct-thin-bucket" });
    expect(doc!["primary_direction"]).toBe("BUY");
    const influence = doc!["global_brain_influence"] as { recommendation: string; direction_quality_n: number };
    expect(influence.recommendation).toBe("NO_OPINION");
    expect(influence.direction_quality_n).toBe(0);
  });

  it("ENTER_NOW (switch on, healthy champion win rate): BUY publishes unaffected -- ENTER_NOW never mutates a decision", async () => {
    await seedEaEvidence("acct-enter-now", "BUY");
    await promoteChallenger(championInput(`BUY|LONDON|TRENDING|${SETUP_TYPE}`, 0.8, 40), "seed");
    await updateGlobalBrainSettings({ outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-enter-now", account_id: "acct-enter-now" });
    expect(doc!["primary_direction"]).toBe("BUY");
    expect((doc!["global_brain_influence"] as { recommendation: string }).recommendation).toBe("ENTER_NOW");
  });

  it("REJECT never reverses direction: a REJECT-worthy champion for a SELL setup produces BLOCKED, never BUY", async () => {
    await seedEaEvidence("acct-sell-reject", "SELL");
    await promoteChallenger(championInput(`SELL|LONDON|TRENDING|${SETUP_TYPE}`, 0.1, 40), "seed");
    await updateGlobalBrainSettings({ outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-sell-reject", account_id: "acct-sell-reject" });
    expect(doc!["primary_direction"]).toBe("BLOCKED");
    expect(doc!["global_brain_blocked_direction"]).toBe("SELL");
    expect(doc!["primary_direction"]).not.toBe("BUY");
  });

  it("failure fallback: a champion-registry read failure during influence evaluation never blocks publication (fails safe to baseline BUY)", async () => {
    await seedEaEvidence("acct-failure", "BUY");
    await updateGlobalBrainSettings({ outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const originalCollection = state.db.collection.bind(state.db);
    state.db.collection = ((name: string) => {
      if (name === "global_brain_models") throw new Error("simulated registry read failure");
      return originalCollection(name);
    }) as typeof state.db.collection;
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-failure", account_id: "acct-failure" });
    expect(doc).not.toBeNull();
    expect(doc!["primary_direction"]).toBe("BUY");
    expect((doc!["global_brain_influence"] as { applied: boolean; recommendation: string }).applied).toBe(false);
    expect((doc!["global_brain_influence"] as { applied: boolean; recommendation: string }).recommendation).toBe("NO_OPINION");
  });
});
