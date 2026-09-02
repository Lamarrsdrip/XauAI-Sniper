import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../auth.js";
import { getDb } from "../../db.js";
import {
  GLOBAL_BRAIN_DAILY_REPORTS_COLLECTION,
  GLOBAL_BRAIN_OBSERVATIONS_COLLECTION,
  GlobalBrainRollbackRequestSchema,
  GlobalBrainRunCycleRequestSchema,
  GlobalBrainSettingsPatchSchema,
} from "../../models/globalBrain.js";
import { getCurrentChampion, listPromotionHistory, rollbackToPreviousChampion, RegistryLockError, RollbackError } from "../../services/globalBrainRegistry.js";
import { GLOBAL_BRAIN_QUESTIONS, runGlobalBrainDailyCycle, type DailyCycleReport } from "../../services/globalBrainTraining.js";
import { latestDriftAlert } from "../../services/globalBrainDrift.js";
import { emergencyDisableGlobalBrain, getGlobalBrainSettings, updateGlobalBrainSettings } from "../../services/globalBrainSettings.js";

/**
 * Admin-only Global Learning Brain command-center endpoints. Read-only
 * status/history plus two explicitly admin-gated mutating actions
 * (manual cycle run, rollback) -- nothing here is reachable by an EA, a
 * customer, or any live-decision path. Never exposes raw account_login/
 * license_id: observations only ever carry the one-way account_ref hash
 * (see services/globalBrainIngest.ts).
 */
export async function registerAdminGlobalBrainRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/global-brain/status", { preHandler: requireAdmin }, async () => {
    const db = getDb();
    const observations = db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
    const totalObservations = await observations.countDocuments({});
    const bySource: Record<string, number> = {};
    for (const source of ["BOT_TRADE", "OUTLOOK", "M10"]) {
      bySource[source] = await observations.countDocuments({ source });
    }
    const resolvedCount = await observations.countDocuments({ resolved_at: { $ne: null } });
    const unresolvableCount = await observations.countDocuments({
      resolved_at: null,
      $or: [
        { resolution_state: "UNRESOLVABLE_NO_PATH" },
        { resolution_state: { $exists: false }, decision_action: { $in: ["SKIPPED", "EXPIRED"] }, source: { $in: ["BOT_TRADE", "M10"] } },
      ],
    });
    const pendingCount = Math.max(0, totalObservations - resolvedCount - unresolvableCount);

    const models: Record<string, unknown> = {};
    for (const question of GLOBAL_BRAIN_QUESTIONS) {
      const champion = await getCurrentChampion(question);
      const drift = champion ? await latestDriftAlert(question) : null;
      models[question] = champion
        ? {
            champion_version: champion.version,
            promoted_at: champion.promoted_at,
            trained_at: champion.trained_at,
            training_window: champion.training_window,
            holdout_metrics: champion.holdout_metrics,
            promotion_reason: champion.promotion_reason,
            promoted_via: champion.maturity_path, // FAST_PATH (single-shot, holdout >= 30) or MULTI_CYCLE (evidence-based, see globalBrainMaturity.ts)
            streak_count_at_promotion: champion.streak_count,
            drift_alert: drift && drift.champion_version === champion.version ? drift : null,
          }
        : { champion_version: null, note: "No champion promoted yet -- see last_cycle.questions[question].maturity for exactly why and how close it is." };
    }

    const lastReport = await db
      .collection<DailyCycleReport>(GLOBAL_BRAIN_DAILY_REPORTS_COLLECTION)
      .find({}, { projection: { _id: 0 } })
      .sort({ ran_at: -1 })
      .limit(1)
      .toArray();

    return {
      total_observations: totalObservations,
      observations_by_source: bySource,
      resolved_observations: resolvedCount,
      pending_observations: pendingCount,
      unresolvable_observations: unresolvableCount,
      models,
      last_cycle: lastReport[0] ?? null,
      note: "SHADOW/ADVISORY ONLY -- no model here has authority over live trades. See services/globalBrainTraining.ts and globalBrainIngest.ts for the enforced shadow-only boundary.",
    };
  });

  app.get("/admin/global-brain/promotions", { preHandler: requireAdmin }, async (request) => {
    const q = request.query as { question?: string; limit?: string };
    const history = await listPromotionHistory(q.question ?? null, q.limit ? Number(q.limit) : 50);
    return { promotions: history };
  });

  // Manual trigger so the daily cycle can be validated without waiting 24h.
  // Same code path the scheduled loop uses (services/globalBrainTraining.ts) --
  // this endpoint is not a separate implementation.
  app.post("/admin/global-brain/run-cycle", { preHandler: requireAdmin }, async (request) => {
    const req = GlobalBrainRunCycleRequestSchema.parse(request.body ?? {});
    const report = await runGlobalBrainDailyCycle({ dryRun: req.dry_run });
    return report;
  });

  app.post("/admin/global-brain/rollback", { preHandler: requireAdmin }, async (request, reply) => {
    const req = GlobalBrainRollbackRequestSchema.parse(request.body);
    try {
      const restored = await rollbackToPreviousChampion(req.question);
      return { status: "ok", restored_version: restored.version };
    } catch (error) {
      if (error instanceof RollbackError) return reply.code(400).send({ status: "error", detail: error.message });
      if (error instanceof RegistryLockError) return reply.code(409).send({ status: "error", detail: error.message });
      throw error;
    }
  });

  // Owner-controlled master switches / kill switches (services/globalBrainSettings.ts).
  app.get("/admin/global-brain/settings", { preHandler: requireAdmin }, async () => {
    return getGlobalBrainSettings();
  });

  app.patch("/admin/global-brain/settings", { preHandler: requireAdmin }, async (request) => {
    const req = GlobalBrainSettingsPatchSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin?: Record<string, unknown> }).admin;
    return updateGlobalBrainSettings(req, String(admin?.["email"] ?? "unknown-admin"));
  });

  // The single "return to stable baseline" action: every capability off in
  // one atomic write. Does not touch the champion/challenger registry --
  // existing champions stay in place, simply unreachable, so re-enabling
  // (via PATCH .../settings) restores prior behavior instantly.
  app.post("/admin/global-brain/emergency-disable", { preHandler: requireAdmin }, async (request) => {
    const admin = (request as typeof request & { admin?: Record<string, unknown> }).admin;
    const settings = await emergencyDisableGlobalBrain(String(admin?.["email"] ?? "unknown-admin"));
    return { status: "ok", settings };
  });
}
