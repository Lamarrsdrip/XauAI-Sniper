import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  // These three unlock the real dual-AI code path instead of the
  // local-only cost-guard shortcut, so this test exercises the actual
  // /ai/analyze logic (including the new Global Brain block) rather than
  // a stub response.
  process.env["EMERGENT_LLM_KEY"] = "test-key";
  process.env["AI_COST_DAILY_CALL_LIMIT"] = "1000";
  process.env["AI_COST_MIN_SECONDS"] = "0";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, verdict: { action: "BUY", confidence: 80, reason: "bullish thesis" } }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("../services/license.js", () => ({
  normalizeLicenseKey: (k: string) => k,
  resolveMonitorLicense: vi.fn(async () => ({ id: "lic-test" })),
}));
// The only true external I/O boundary this route has besides Mongo -- stub
// it to return a deterministic, controllable verdict so the test exercises
// the REAL route logic (budget/cache/consensus/Global Brain) around it,
// not a fake route.
vi.mock("../services/llmClient.js", () => ({
  LlmChat: class {
    withModel(): this { return this; }
    async sendMessage(): Promise<string> { return JSON.stringify(state.verdict); }
  },
}));

const { registerAiRoutes } = await import("./ai.js");
const { promoteChallenger } = await import("../services/globalBrainRegistry.js");
const { updateGlobalBrainSettings } = await import("../services/globalBrainSettings.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerAiRoutes(app);
  return app;
}

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
 * A payload deliberately shaped to reach the real dual-AI path with only
 * Claude consulted (shouldCallDualAi stays false: grade "B" is not a
 * high-grade tier, combined_score/setup_score stay below their thresholds,
 * and there's no account-pressure signal) -- the simplest real path that
 * still exercises budget, cache, consensus, and the Global Brain block.
 * account_id must be unique per test: it flows into the AI response cache
 * key, so reusing one across tests would return a stale cached verdict
 * instead of re-invoking the (per-test-controlled) mocked LLM.
 */
function basePayload(accountId: string, overrides: Record<string, unknown> = {}) {
  return {
    pin: "1234",
    account_id: accountId,
    symbol: "XAUUSD",
    grade: "B",
    combined_score: 4.0,
    setup_score: 0,
    session: "LONDON",
    regime: "TRENDING",
    setup: "BREAKOUT",
    basket_float_pl: 0,
    daily_pct: 0,
    open_positions: 0,
    ...overrides,
  };
}

describe("POST /ai/analyze -- Global Brain BOT consumer (end-to-end, real route + real HTTP)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.verdict = { action: "BUY", confidence: 80, reason: "bullish thesis" };
  });

  it("sanity: with no champion and switch off, a clean BUY is returned exactly as before Global Brain existed", async () => {
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-baseline") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.action).toBe("BUY");
    expect(body.global_brain_influence).toEqual({
      scope: "BOT",
      enabled: false,
      applied: false,
      recommendation: "NO_OPINION",
      reason: "bot_learned_influence_enabled is OFF",
      direction_quality_bucket: null,
      direction_quality_shrunk_rate: null,
      direction_quality_n: 0,
      entry_timing_bucket: null,
      entry_timing_shrunk_rate: null,
      entry_timing_n: 0,
    });
  });

  it("BOT OFF (default): a REJECT-worthy champion has zero effect on the returned BUY", async () => {
    await promoteChallenger(championInput("BUY|TRENDING|BREAKOUT", 0.1, 40), "seed"); // would REJECT if consulted
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-off") });
    const body = res.json();
    expect(body.action).toBe("BUY");
    expect(body.global_brain_influence.enabled).toBe(false);
  });

  it("BOT ON + REJECT: downgrades BUY to SKIP, zeroes sl_adjust/tp_adjust, never invents a new action", async () => {
    state.verdict = { action: "BUY", confidence: 80, reason: "bullish thesis", sl_adjust: 1.5, tp_adjust: -0.5 };
    await promoteChallenger(championInput("BUY|TRENDING|BREAKOUT", 0.1, 40), "seed");
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-reject") });
    const body = res.json();
    expect(body.action).toBe("SKIP");
    expect(body.confidence).toBe(0);
    expect(body.sl_adjust).toBe(0);
    expect(body.tp_adjust).toBe(0);
    expect(body.reason).toContain("Global Brain REJECT");
    expect(body.global_brain_influence.recommendation).toBe("REJECT");
  });

  it("REJECT never reverses direction: a REJECT-worthy champion for a SELL setup produces SKIP, never BUY", async () => {
    state.verdict = { action: "SELL", confidence: 75, reason: "bearish thesis" };
    await promoteChallenger(championInput("SELL|TRENDING|BREAKOUT", 0.1, 40), "seed");
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-sell-reject") });
    const body = res.json();
    expect(body.action).toBe("SKIP");
    expect(body.action).not.toBe("BUY");
  });

  it("scope isolation: enabling M10/OUTLOOK influence has zero effect on BOT", async () => {
    await promoteChallenger(championInput("BUY|TRENDING|BREAKOUT", 0.1, 40), "seed");
    await updateGlobalBrainSettings({ m10_learned_influence_enabled: true, outlook_learned_influence_enabled: true }, "admin@xaucloud.io");
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-scope") });
    const body = res.json();
    expect(body.action).toBe("BUY"); // BOT switch itself is still off
    expect(body.global_brain_influence.enabled).toBe(false);
    expect(body.global_brain_influence.scope).toBe("BOT");
  });

  it("NO_OPINION (switch on, no champion promoted yet): BUY returned unaffected, no mutation", async () => {
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-no-champion") });
    const body = res.json();
    expect(body.action).toBe("BUY");
    expect(body.global_brain_influence.recommendation).toBe("NO_OPINION");
    expect(body.global_brain_influence.applied).toBe(false);
  });

  it("NO_OPINION (switch on, champion exists but this exact bucket has insufficient sample): BUY returned unaffected", async () => {
    await promoteChallenger(championInput("SELL|NY|RANGE|REVERSAL", 0.1, 40), "seed"); // a different bucket entirely
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-thin-bucket") });
    const body = res.json();
    expect(body.action).toBe("BUY");
    expect(body.global_brain_influence.recommendation).toBe("NO_OPINION");
    expect(body.global_brain_influence.direction_quality_n).toBe(0);
  });

  it("ENTER_NOW (switch on, healthy champion win rate): BUY returned unaffected -- ENTER_NOW never mutates a decision", async () => {
    await promoteChallenger(championInput("BUY|TRENDING|BREAKOUT", 0.8, 40), "seed");
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-enter-now") });
    const body = res.json();
    expect(body.action).toBe("BUY");
    expect(body.global_brain_influence.recommendation).toBe("ENTER_NOW");
  });

  it("does not evaluate Global Brain at all for a SKIP verdict (no BUY/SELL to downgrade)", async () => {
    state.verdict = { action: "SKIP", confidence: 0, reason: "no edge" };
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-native-skip") });
    const body = res.json();
    expect(body.action).toBe("SKIP");
    expect(body.global_brain_influence).toBeNull();
  });

  it("failure fallback: a champion-registry read failure during influence evaluation never blocks the trade (fails safe to baseline BUY)", async () => {
    await updateGlobalBrainSettings({ bot_learned_influence_enabled: true }, "admin@xaucloud.io");
    const originalCollection = state.db.collection.bind(state.db);
    state.db.collection = ((name: string) => {
      if (name === "global_brain_models") throw new Error("simulated registry read failure");
      return originalCollection(name);
    }) as typeof state.db.collection;
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ai/analyze", payload: basePayload("acct-failure") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.action).toBe("BUY");
    expect(body.global_brain_influence.applied).toBe(false);
    expect(body.global_brain_influence.recommendation).toBe("NO_OPINION");
  });
});
