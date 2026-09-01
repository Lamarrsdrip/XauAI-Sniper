import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", () => ({
  requireAdmin: async (request: unknown) => {
    (request as { admin?: unknown }).admin = { email: "admin@xaucloud.io" };
  },
}));

const { registerAdminGlobalBrainRoutes } = await import("./globalBrain.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerAdminGlobalBrainRoutes(app);
  return app;
}

describe("admin global-brain command center", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.db = new FakeDb();
    app = await createApp();
  });

  it("reports SHADOW/ADVISORY ONLY and no champions when nothing has run yet", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/global-brain/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_observations).toBe(0);
    expect(body.note).toContain("SHADOW/ADVISORY ONLY");
    expect(body.models.DIRECTION_QUALITY.champion_version).toBeNull();
  });

  it("counts observations by source", async () => {
    await state.db.collection("global_brain_observations").insertOne({ dedupe_key: "a", source: "BOT_TRADE", resolved_at: "t" });
    await state.db.collection("global_brain_observations").insertOne({ dedupe_key: "b", source: "OUTLOOK", resolved_at: null });
    const res = await app.inject({ method: "GET", url: "/admin/global-brain/status" });
    const body = res.json();
    expect(body.total_observations).toBe(2);
    expect(body.observations_by_source).toEqual({ BOT_TRADE: 1, OUTLOOK: 1, M10: 0 });
    expect(body.resolved_observations).toBe(1);
    expect(body.pending_observations).toBe(1);
  });

  it("run-cycle endpoint executes the same daily-cycle code path and returns its report", async () => {
    const res = await app.inject({ method: "POST", url: "/admin/global-brain/run-cycle", payload: { dry_run: true } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dry_run).toBe(true);
    expect(body.success).toBe(true);
  });

  it("rollback returns 400 with a clear reason when there is nothing to roll back to, never a silent success", async () => {
    const res = await app.inject({ method: "POST", url: "/admin/global-brain/rollback", payload: { question: "DIRECTION_QUALITY" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain("No previous champion");
  });

  it("rollback restores the previous champion after a real promotion history exists", async () => {
    const { promoteChallenger } = await import("../../services/globalBrainRegistry.js");
    const modelInput = {
      question: "DIRECTION_QUALITY",
      trained_at: new Date().toISOString(),
      training_window: { from: null, to: null, n: 100 },
      dataset_fingerprint: "fp",
      validation_metrics: { holdout_n: 100, brier_score: 0.2, brier_se: 0.01, avg_r_captured: 0.3, avg_r_captured_se: 0.02, max_drawdown_r: 1 },
      holdout_metrics: { holdout_n: 100, brier_score: 0.2, brier_se: 0.01, avg_r_captured: 0.3, avg_r_captured_se: 0.02, max_drawdown_r: 1 },
      buckets: { global_prior_rate: 0.5, global_n: 100, buckets: [] },
    };
    await promoteChallenger(modelInput, "v1");
    await promoteChallenger(modelInput, "v2");

    const res = await app.inject({ method: "POST", url: "/admin/global-brain/rollback", payload: { question: "DIRECTION_QUALITY" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", restored_version: 1 });
  });

  it("promotions history endpoint returns the audit log", async () => {
    const { promoteChallenger } = await import("../../services/globalBrainRegistry.js");
    await promoteChallenger(
      {
        question: "DIRECTION_QUALITY",
        trained_at: new Date().toISOString(),
        training_window: { from: null, to: null, n: 1 },
        dataset_fingerprint: "fp",
        validation_metrics: { holdout_n: 1, brier_score: 0.2, brier_se: 1, avg_r_captured: 0, avg_r_captured_se: 1, max_drawdown_r: 0 },
        holdout_metrics: { holdout_n: 1, brier_score: 0.2, brier_se: 1, avg_r_captured: 0, avg_r_captured_se: 1, max_drawdown_r: 0 },
        buckets: { global_prior_rate: 0.5, global_n: 1, buckets: [] },
      },
      "first",
    );
    const res = await app.inject({ method: "GET", url: "/admin/global-brain/promotions?question=DIRECTION_QUALITY" });
    expect(res.statusCode).toBe(200);
    expect(res.json().promotions).toHaveLength(1);
  });

  it("GET settings returns safe defaults before anything has been configured", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/global-brain/settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json().global_learning_enabled).toBe(true);
    expect(res.json().bot_learned_influence_enabled).toBe(false);
  });

  it("PATCH settings updates exactly the given flags and records who changed them", async () => {
    const res = await app.inject({ method: "PATCH", url: "/admin/global-brain/settings", payload: { auto_promotion_enabled: false } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.auto_promotion_enabled).toBe(false);
    expect(body.global_learning_enabled).toBe(true);
    expect(body.updated_by).toBe("admin@xaucloud.io");
  });

  it("emergency-disable turns off every capability in one call, including a previously-enabled production-influence flag", async () => {
    await app.inject({ method: "PATCH", url: "/admin/global-brain/settings", payload: { bot_learned_influence_enabled: true } });
    const res = await app.inject({ method: "POST", url: "/admin/global-brain/emergency-disable" });
    expect(res.statusCode).toBe(200);
    const settings = res.json().settings;
    expect(settings.global_learning_enabled).toBe(false);
    expect(settings.scheduled_cycle_enabled).toBe(false);
    expect(settings.auto_training_enabled).toBe(false);
    expect(settings.auto_promotion_enabled).toBe(false);
    expect(settings.shadow_serving_enabled).toBe(false);
    expect(settings.advisory_integration_enabled).toBe(false);
    expect(settings.bot_learned_influence_enabled).toBe(false);
    expect(settings.m10_learned_influence_enabled).toBe(false);
    expect(settings.outlook_learned_influence_enabled).toBe(false);
  });
});
