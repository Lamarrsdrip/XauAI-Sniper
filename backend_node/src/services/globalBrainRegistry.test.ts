import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { getCurrentChampion, promoteChallenger, rejectChallenger, rollbackToPreviousChampion, RollbackError, RegistryLockError, listPromotionHistory } = await import(
  "./globalBrainRegistry.js"
);

function modelInput(question: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    question,
    trained_at: new Date().toISOString(),
    training_window: { from: null, to: null, n: 100 },
    dataset_fingerprint: "fp1",
    validation_metrics: { holdout_n: 100, brier_score: 0.2, brier_se: 0.01, avg_r_captured: 0.3, avg_r_captured_se: 0.02, max_drawdown_r: 1 },
    holdout_metrics: { holdout_n: 100, brier_score: 0.2, brier_se: 0.01, avg_r_captured: 0.3, avg_r_captured_se: 0.02, max_drawdown_r: 1 },
    buckets: { global_prior_rate: 0.5, global_n: 100, buckets: [] },
    meets_small_sample_criteria: false,
    streak_count: 0,
    maturity_path: "FAST_PATH" as const,
    ...overrides,
  };
}

describe("globalBrainRegistry", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("has no champion for an untrained question", async () => {
    expect(await getCurrentChampion("DIRECTION_QUALITY")).toBeNull();
  });

  it("promotes the first challenger as version 1 with no prior champion to demote", async () => {
    const doc = await promoteChallenger(modelInput("DIRECTION_QUALITY"), "first champion");
    expect(doc.version).toBe(1);
    expect(doc.status).toBe("CHAMPION");
    const champion = await getCurrentChampion("DIRECTION_QUALITY");
    expect(champion?.version).toBe(1);
  });

  it("demotes the prior champion to SUPERSEDED when a new one is promoted", async () => {
    await promoteChallenger(modelInput("DIRECTION_QUALITY"), "v1");
    await promoteChallenger(modelInput("DIRECTION_QUALITY"), "v2");
    const docs = state.db.collection("global_brain_models").docs;
    const v1 = docs.find((d) => d["version"] === 1)!;
    const v2 = docs.find((d) => d["version"] === 2)!;
    expect(v1["status"]).toBe("SUPERSEDED");
    expect(v2["status"]).toBe("CHAMPION");
  });

  it("keeps the champion untouched when a challenger is rejected", async () => {
    await promoteChallenger(modelInput("DIRECTION_QUALITY"), "v1");
    await rejectChallenger(modelInput("DIRECTION_QUALITY"), "INSUFFICIENT_EVIDENCE");
    const champion = await getCurrentChampion("DIRECTION_QUALITY");
    expect(champion?.version).toBe(1);
    const rejected = state.db.collection("global_brain_models").docs.find((d) => d["status"] === "REJECTED");
    expect(rejected?.["version"]).toBe(2);
  });

  it("rolls back to the previous champion and marks the current one ROLLED_BACK", async () => {
    await promoteChallenger(modelInput("DIRECTION_QUALITY"), "v1");
    await promoteChallenger(modelInput("DIRECTION_QUALITY"), "v2");
    const restored = await rollbackToPreviousChampion("DIRECTION_QUALITY");
    expect(restored.version).toBe(1);
    expect(restored.status).toBe("CHAMPION");
    const docs = state.db.collection("global_brain_models").docs;
    expect(docs.find((d) => d["version"] === 2)?.["status"]).toBe("ROLLED_BACK");
    expect(docs.find((d) => d["version"] === 1)?.["status"]).toBe("CHAMPION");
    const champion = await getCurrentChampion("DIRECTION_QUALITY");
    expect(champion?.version).toBe(1);
  });

  it("throws RollbackError instead of silently no-oping when there is nothing to roll back to", async () => {
    await promoteChallenger(modelInput("DIRECTION_QUALITY"), "only version");
    await expect(rollbackToPreviousChampion("DIRECTION_QUALITY")).rejects.toThrow(RollbackError);
  });

  it("throws RollbackError for a question with no models at all", async () => {
    await expect(rollbackToPreviousChampion("NEVER_TRAINED")).rejects.toThrow(RollbackError);
  });

  it("records every promote/reject/rollback in the audit log, most recent first", async () => {
    // Fake timers so each audit entry gets a strictly increasing timestamp --
    // three real-clock calls in the same test can land in the same
    // millisecond, which would make "most recent first" unverifiable.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      await promoteChallenger(modelInput("DIRECTION_QUALITY"), "v1");
      vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
      await rejectChallenger(modelInput("DIRECTION_QUALITY"), "middle");
      vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
      await promoteChallenger(modelInput("DIRECTION_QUALITY"), "v2");
    } finally {
      vi.useRealTimers();
    }
    const history = await listPromotionHistory("DIRECTION_QUALITY");
    expect(history.map((h) => h.reason)).toEqual(["v2", "middle", "v1"]);
  });

  it("refuses a concurrent promotion for the same question while one is already in flight (closes the race an adversarial review found)", async () => {
    state.db.uniqueIndexes["global_brain_registry_locks"] = ["_id"];
    // Simulate a lock already held by an in-flight operation for this question.
    await state.db.collection("global_brain_registry_locks").insertOne({ _id: "lock:DIRECTION_QUALITY", acquired_at: Date.now() });
    await expect(promoteChallenger(modelInput("DIRECTION_QUALITY"), "racing promotion")).rejects.toThrow(RegistryLockError);
    // The lock holder's own operation is untouched by the rejected racer.
    expect(await getCurrentChampion("DIRECTION_QUALITY")).toBeNull();
  });

  it("releases the lock after a successful promotion so a later, non-concurrent promotion succeeds normally", async () => {
    state.db.uniqueIndexes["global_brain_registry_locks"] = ["_id"];
    await promoteChallenger(modelInput("DIRECTION_QUALITY"), "v1");
    await promoteChallenger(modelInput("DIRECTION_QUALITY"), "v2"); // would throw RegistryLockError if the first lock were never released
    expect((await getCurrentChampion("DIRECTION_QUALITY"))?.version).toBe(2);
  });

  it("also serializes rejected challengers, so a concurrent rejection cannot race model version assignment", async () => {
    state.db.uniqueIndexes["global_brain_registry_locks"] = ["_id"];
    await state.db.collection("global_brain_registry_locks").insertOne({ _id: "lock:DIRECTION_QUALITY", acquired_at: Date.now(), holder_id: "other-process" });
    await expect(rejectChallenger(modelInput("DIRECTION_QUALITY"), "racing rejection")).rejects.toThrow(RegistryLockError);
    expect(state.db.collection("global_brain_models").docs).toHaveLength(0);
  });

  it("keeps question histories independent of each other", async () => {
    await promoteChallenger(modelInput("DIRECTION_QUALITY"), "dq v1");
    await promoteChallenger(modelInput("TP_BEFORE_SL"), "tp v1");
    expect((await getCurrentChampion("DIRECTION_QUALITY"))?.version).toBe(1);
    expect((await getCurrentChampion("TP_BEFORE_SL"))?.version).toBe(1);
    const dqHistory = await listPromotionHistory("DIRECTION_QUALITY");
    expect(dqHistory).toHaveLength(1);
  });
});
