import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("../auth.js", () => ({ requireAdmin: async () => undefined }));
vi.mock("../services/license.js", () => ({ resolveMonitorLicense: vi.fn(async () => ({ id: "lic-test" })) }));

const { registerMlRoutes } = await import("./ml.js");
const { promoteChallenger } = await import("../services/globalBrainRegistry.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerMlRoutes(app);
  return app;
}

describe("global brain -- ml.ts wiring", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("records a global-brain observation for a SKIPPED shadow decision (rejected setup)", async () => {
    const app = await createApp();
    const res = await app.inject({
      method: "POST",
      url: "/ml/shadow/record",
      payload: { signature: "1|2|3|4|5|6|7", actual_action: "SKIPPED", direction: "SELL", symbol: "XAUUSDm", account: 111, decision_time_utc: "2026-01-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    const observations = state.db.collection("global_brain_observations").docs;
    expect(observations).toHaveLength(1);
    expect(observations[0]!["decision_action"]).toBe("SKIPPED");
    expect(observations[0]!["source"]).toBe("BOT_TRADE");
  });

  it("does NOT record a global-brain observation for a CANDIDATE (still-pending) shadow decision", async () => {
    const app = await createApp();
    await app.inject({ method: "POST", url: "/ml/shadow/record", payload: { signature: "1|2|3|4|5|6|7", actual_action: "CANDIDATE" } });
    expect(state.db.collection("global_brain_observations").docs).toHaveLength(0);
  });

  it("GET /ml/brain/suggestion is read-only, advisory-labeled, and defaults safely when no champion exists yet", async () => {
    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/ml/brain/suggestion?direction=BUY&session=LONDON&regime=TRENDING&setup_type=BREAKOUT" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.note).toContain("SHADOW/ADVISORY ONLY");
    expect(body.direction_quality.bucket_key).toBe("NO_CHAMPION_YET");
    expect(body.direction_quality.shrunk_rate).toBe(0.5);
  });

  it("GET /ml/brain/suggestion returns the current champion's bucket lookup once one is promoted", async () => {
    await promoteChallenger(
      {
        question: "DIRECTION_QUALITY",
        trained_at: new Date().toISOString(),
        training_window: { from: null, to: null, n: 40 },
        dataset_fingerprint: "fp",
        validation_metrics: { holdout_n: 40, brier_score: 0.15, brier_se: 0.01, avg_r_captured: 0.4, avg_r_captured_se: 0.02, max_drawdown_r: 0.5 },
        holdout_metrics: { holdout_n: 40, brier_score: 0.15, brier_se: 0.01, avg_r_captured: 0.4, avg_r_captured_se: 0.02, max_drawdown_r: 0.5 },
        buckets: {
          global_prior_rate: 0.5,
          global_n: 40,
          buckets: [{ bucket_key: "BUY|TRENDING|BREAKOUT", n: 30, successes: 24, raw_rate: 0.8, shrunk_rate: 0.75, avg_r: 0.9, sample_sufficient: true }],
        },
      },
      "seed",
    );
    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/ml/brain/suggestion?direction=BUY&session=LONDON&regime=TRENDING&setup_type=BREAKOUT" });
    const body = res.json();
    expect(body.direction_quality.bucket_key).toBe("BUY|TRENDING|BREAKOUT");
    expect(body.direction_quality.shrunk_rate).toBe(0.75);
    expect(body.note).toContain("must never gate a live trade");
  });

  it("kill switch: advisory_integration_enabled=false always returns the safe default, even with a real champion promoted", async () => {
    const { updateGlobalBrainSettings } = await import("../services/globalBrainSettings.js");
    await promoteChallenger(
      {
        question: "DIRECTION_QUALITY",
        trained_at: new Date().toISOString(),
        training_window: { from: null, to: null, n: 40 },
        dataset_fingerprint: "fp",
        validation_metrics: { holdout_n: 40, brier_score: 0.15, brier_se: 0.01, avg_r_captured: 0.4, avg_r_captured_se: 0.02, max_drawdown_r: 0.5 },
        holdout_metrics: { holdout_n: 40, brier_score: 0.15, brier_se: 0.01, avg_r_captured: 0.4, avg_r_captured_se: 0.02, max_drawdown_r: 0.5 },
        buckets: {
          global_prior_rate: 0.5,
          global_n: 40,
          buckets: [{ bucket_key: "BUY|TRENDING|BREAKOUT", n: 30, successes: 24, raw_rate: 0.8, shrunk_rate: 0.75, avg_r: 0.9, sample_sufficient: true }],
        },
      },
      "seed",
    );
    await updateGlobalBrainSettings({ advisory_integration_enabled: false }, "admin@xaucloud.io");
    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/ml/brain/suggestion?direction=BUY&session=LONDON&regime=TRENDING&setup_type=BREAKOUT" });
    const body = res.json();
    expect(body.direction_quality.bucket_key).toBe("NO_CHAMPION_YET");
    expect(body.note).toContain("ADVISORY INTEGRATION DISABLED");
  });
});
