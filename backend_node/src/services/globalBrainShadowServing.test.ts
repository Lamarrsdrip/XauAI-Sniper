import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { logOutlookShadowComparison, logBotTradeShadowComparison } = await import("./globalBrainShadowServing.js");
const { promoteChallenger } = await import("./globalBrainRegistry.js");

function championInput(question: string, bucketKey: string) {
  return {
    question,
    trained_at: new Date().toISOString(),
    training_window: { from: null, to: null, n: 40 },
    dataset_fingerprint: "fp",
    validation_metrics: { holdout_n: 40, brier_score: 0.15, brier_se: 0.01, avg_r_captured: 0.4, avg_r_captured_se: 0.02, max_drawdown_r: 0.5 },
    holdout_metrics: { holdout_n: 40, brier_score: 0.15, brier_se: 0.01, avg_r_captured: 0.4, avg_r_captured_se: 0.02, max_drawdown_r: 0.5 },
    buckets: {
      global_prior_rate: 0.5,
      global_n: 40,
      buckets: [{ bucket_key: bucketKey, n: 30, successes: 24, raw_rate: 0.8, shrunk_rate: 0.75, avg_r: 0.9, sample_sufficient: true }],
    },
  };
}

describe("logOutlookShadowComparison", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("does nothing for a non-actionable (NO_TRADE) Outlook doc", async () => {
    await logOutlookShadowComparison({ id: "o1", primary_direction: "NO_VALID_OUTLOOK" });
    expect(state.db.collection("global_brain_shadow_serving_log").docs).toHaveLength(0);
  });

  it("logs the rule decision with a NULL brain suggestion when no champion exists yet", async () => {
    await logOutlookShadowComparison({ id: "o1", primary_direction: "BUY", session: "LONDON", market_regime: "TRENDING", setup_type: "BREAKOUT", confidence_pct: 70 });
    const docs = state.db.collection("global_brain_shadow_serving_log").docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]!["rule_decision"]).toBe("BUY");
    expect((docs[0]!["brain_suggestions"] as Record<string, unknown>)["DIRECTION_QUALITY"]).toBeNull();
  });

  it("logs the current champion's real bucket suggestion once one is promoted", async () => {
    await promoteChallenger(championInput("DIRECTION_QUALITY", "BUY|TRENDING|BREAKOUT"), "seed");
    await logOutlookShadowComparison({ id: "o2", primary_direction: "BUY", session: "LONDON", market_regime: "TRENDING", setup_type: "BREAKOUT", confidence_pct: 70 });
    const doc = state.db.collection("global_brain_shadow_serving_log").docs[0]!;
    const suggestions = doc["brain_suggestions"] as Record<string, { bucket_key: string; shrunk_rate: number }>;
    expect(suggestions.DIRECTION_QUALITY?.bucket_key).toBe("BUY|TRENDING|BREAKOUT");
    expect(suggestions.DIRECTION_QUALITY?.shrunk_rate).toBe(0.75);
  });

  it("never throws even if the write fails (rides along with, never blocks, the real Outlook decision)", async () => {
    state.db = { collection: () => { throw new Error("boom"); } } as unknown as FakeDb;
    await expect(logOutlookShadowComparison({ id: "o3", primary_direction: "SELL" })).resolves.toBeUndefined();
  });
});

describe("logBotTradeShadowComparison", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("enriches the existing CANDIDATE ml_shadow_decisions doc with a brain suggestion, never creates a new doc", async () => {
    await promoteChallenger(championInput("DIRECTION_QUALITY", "SELL||RANGE|REVERSAL"), "seed");
    state.db.collection("ml_shadow_decisions").docs.push({ signature: "sig1", actual_action: "CANDIDATE", decision_time_utc: "2026-01-01T00:00:00.000Z" });
    await logBotTradeShadowComparison({ signature: "sig1", direction: "SELL", regime: "RANGE", setup_type: "REVERSAL" });
    const docs = state.db.collection("ml_shadow_decisions").docs;
    expect(docs).toHaveLength(1);
    expect((docs[0]!["global_brain_suggestion"] as { bucket_key: string }).bucket_key).toBe("SELL||RANGE|REVERSAL");
  });

  it("does nothing when no champion exists yet", async () => {
    state.db.collection("ml_shadow_decisions").docs.push({ signature: "sig2", actual_action: "CANDIDATE" });
    await logBotTradeShadowComparison({ signature: "sig2", direction: "BUY", regime: "TRENDING", setup_type: "BREAKOUT" });
    expect(state.db.collection("ml_shadow_decisions").docs[0]!["global_brain_suggestion"]).toBeUndefined();
  });

  it("kill switch: shadow_serving_enabled=false silences both real-time comparison logs", async () => {
    const { updateGlobalBrainSettings } = await import("./globalBrainSettings.js");
    await promoteChallenger(championInput("DIRECTION_QUALITY", "BUY|TRENDING|BREAKOUT"), "seed");
    await updateGlobalBrainSettings({ shadow_serving_enabled: false }, "admin@xaucloud.io");

    await logOutlookShadowComparison({ id: "o-off", primary_direction: "BUY", session: "LONDON", market_regime: "TRENDING", setup_type: "BREAKOUT" });
    expect(state.db.collection("global_brain_shadow_serving_log").docs).toHaveLength(0);

    state.db.collection("ml_shadow_decisions").docs.push({ signature: "sig-off", actual_action: "CANDIDATE" });
    await logBotTradeShadowComparison({ signature: "sig-off", direction: "BUY", regime: "TRENDING", setup_type: "BREAKOUT" });
    expect(state.db.collection("ml_shadow_decisions").docs[0]!["global_brain_suggestion"]).toBeUndefined();
  });
});
