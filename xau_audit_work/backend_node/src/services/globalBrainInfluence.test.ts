import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { evaluateGlobalBrainInfluence, applyGlobalBrainToEntryVerdict } = await import("./globalBrainInfluence.js");
const { promoteChallenger } = await import("./globalBrainRegistry.js");
const { updateGlobalBrainSettings } = await import("./globalBrainSettings.js");

function championInput(bucketKey: string, shrunkRate: number, n = 40) {
  return {
    question: "DIRECTION_QUALITY",
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

const INPUT = { direction: "BUY" as const, session: "LONDON", regime: "TRENDING", setup_type: "BREAKOUT" };

describe("evaluateGlobalBrainInfluence", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  for (const scope of ["BOT", "M10", "OUTLOOK"] as const) {
    it(`${scope}: returns NO_OPINION/not-applied when the ${scope} influence switch is off (default)`, async () => {
      await promoteChallenger(championInput("BUY|TRENDING|BREAKOUT", 0.1), "seed"); // would REJECT if consulted
      const result = await evaluateGlobalBrainInfluence(scope, INPUT);
      expect(result.enabled).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.recommendation).toBe("NO_OPINION");
    });
  }

  it("does not cross-wire scopes: enabling BOT influence has no effect on an M10 evaluation", async () => {
    await promoteChallenger(championInput("BUY|TRENDING|BREAKOUT", 0.1), "seed");
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const m10Result = await evaluateGlobalBrainInfluence("M10", INPUT);
    expect(m10Result.enabled).toBe(false);
    expect(m10Result.applied).toBe(false);
  });

  it("returns NO_OPINION/not-applied when enabled but no champion has been promoted yet", async () => {
    await updateGlobalBrainSettings({ outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const result = await evaluateGlobalBrainInfluence("OUTLOOK", INPUT);
    expect(result.enabled).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.recommendation).toBe("NO_OPINION");
  });

  it("returns NO_OPINION when enabled but the bucket has insufficient sample", async () => {
    await promoteChallenger(championInput("SELL|NY|RANGE|REVERSAL", 0.1), "seed"); // different bucket than INPUT
    await updateGlobalBrainSettings({ outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const result = await evaluateGlobalBrainInfluence("OUTLOOK", INPUT);
    expect(result.applied).toBe(false);
    expect(result.recommendation).toBe("NO_OPINION");
    expect(result.direction_quality_n).toBe(0);
  });

  it("returns REJECT when enabled, sufficient sample, and shrunk win rate is at/below threshold", async () => {
    await promoteChallenger(championInput("BUY|TRENDING|BREAKOUT", 0.2, 50), "seed");
    await updateGlobalBrainSettings({ m10_learned_influence_enabled: true }, "admin@xaucloud.io");
    const result = await evaluateGlobalBrainInfluence("M10", INPUT);
    expect(result.applied).toBe(true);
    expect(result.recommendation).toBe("REJECT");
    expect(result.direction_quality_n).toBe(50);
  });

  it("returns ENTER_NOW when enabled, sufficient sample, and win rate is healthy", async () => {
    await promoteChallenger(championInput("BUY|TRENDING|BREAKOUT", 0.8, 50), "seed");
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const result = await evaluateGlobalBrainInfluence("BOT", INPUT);
    expect(result.applied).toBe(true);
    expect(result.recommendation).toBe("ENTER_NOW");
  });

  it("fails safe to NO_OPINION/not-applied if the registry throws", async () => {
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const originalCollection = state.db.collection.bind(state.db);
    state.db.collection = ((name: string) => {
      if (name === "global_brain_models") throw new Error("boom");
      return originalCollection(name);
    }) as typeof state.db.collection;
    const result = await evaluateGlobalBrainInfluence("BOT", INPUT);
    expect(result.applied).toBe(false);
    expect(result.recommendation).toBe("NO_OPINION");
  });
});

describe("applyGlobalBrainToEntryVerdict (routes/ai.ts POST /ai/analyze Bot consumer)", () => {
  const verdict = { action: "BUY", confidence: 82, reason: "dual AI consensus", sl_adjust: 1.5, tp_adjust: -0.5 };

  it("is a no-op when influence is null (switch off, never evaluated)", () => {
    expect(applyGlobalBrainToEntryVerdict(verdict, null)).toEqual(verdict);
  });

  it("is a no-op when the recommendation is NO_OPINION", () => {
    const influence = { scope: "BOT" as const, enabled: true, applied: true, recommendation: "NO_OPINION" as const, reason: "thin evidence", direction_quality_bucket: "k", direction_quality_shrunk_rate: 0.5, direction_quality_n: 3 };
    expect(applyGlobalBrainToEntryVerdict(verdict, influence)).toEqual(verdict);
  });

  it("is a no-op when the recommendation is ENTER_NOW", () => {
    const influence = { scope: "BOT" as const, enabled: true, applied: true, recommendation: "ENTER_NOW" as const, reason: "healthy win rate", direction_quality_bucket: "k", direction_quality_shrunk_rate: 0.7, direction_quality_n: 40 };
    expect(applyGlobalBrainToEntryVerdict(verdict, influence)).toEqual(verdict);
  });

  it("downgrades BUY/SELL to SKIP and zeroes sl_adjust/tp_adjust on REJECT, never inventing a new action", () => {
    const influence = { scope: "BOT" as const, enabled: true, applied: true, recommendation: "REJECT" as const, reason: "win rate 20% over 40 obs", direction_quality_bucket: "k", direction_quality_shrunk_rate: 0.2, direction_quality_n: 40 };
    const adjusted = applyGlobalBrainToEntryVerdict(verdict, influence);
    expect(adjusted.action).toBe("SKIP");
    expect(adjusted.confidence).toBe(0);
    expect(adjusted.sl_adjust).toBe(0);
    expect(adjusted.tp_adjust).toBe(0);
    expect(adjusted.reason).toContain("Global Brain REJECT");
  });

  it("never touches an already-SKIP verdict (nothing to downgrade)", () => {
    const skipVerdict = { ...verdict, action: "SKIP" };
    const influence = { scope: "BOT" as const, enabled: true, applied: true, recommendation: "REJECT" as const, reason: "x", direction_quality_bucket: "k", direction_quality_shrunk_rate: 0.1, direction_quality_n: 40 };
    expect(applyGlobalBrainToEntryVerdict(skipVerdict, influence)).toEqual(skipVerdict);
  });
});
