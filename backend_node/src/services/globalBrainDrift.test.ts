import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";
import type { ModelMetrics } from "./globalBrainPromotion.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { detectDrift, recordDriftAlert, latestDriftAlert, DRIFT_MIN_SAMPLE } = await import("./globalBrainDrift.js");

function metrics(overrides: Partial<ModelMetrics> = {}): ModelMetrics {
  return { holdout_n: 100, brier_score: 0.2, brier_se: 0.01, avg_r_captured: 0.3, avg_r_captured_se: 0.02, max_drawdown_r: 1, ...overrides };
}

describe("detectDrift", () => {
  it("reports no drift when current performance matches promotion-time performance", () => {
    const result = detectDrift(metrics(), metrics());
    expect(result.drifted).toBe(false);
  });

  it("flags drift when calibration meaningfully degrades vs. promotion-time metrics", () => {
    const recorded = metrics({ brier_score: 0.2 });
    const current = metrics({ brier_score: 0.3 }); // +0.1, well beyond the 0.05 drift threshold
    const result = detectDrift(current, recorded);
    expect(result.drifted).toBe(true);
    expect(result.reason).toContain("Calibration degraded");
  });

  it("flags drift when captured expectancy meaningfully drops vs. promotion-time metrics", () => {
    const recorded = metrics({ avg_r_captured: 0.4 });
    const current = metrics({ avg_r_captured: 0.1 }); // -0.3, beyond the 0.15 drift threshold
    const result = detectDrift(current, recorded);
    expect(result.drifted).toBe(true);
    expect(result.reason).toContain("expectancy");
  });

  it("does not flag drift on a small degradation within normal noise", () => {
    const recorded = metrics({ brier_score: 0.2, avg_r_captured: 0.3 });
    const current = metrics({ brier_score: 0.22, avg_r_captured: 0.28 }); // small, within threshold
    expect(detectDrift(current, recorded).drifted).toBe(false);
  });

  it("does not flag drift when there isn't enough current data to assess it", () => {
    const recorded = metrics({ brier_score: 0.1 });
    const current = metrics({ brier_score: 0.5, holdout_n: DRIFT_MIN_SAMPLE - 1 }); // huge apparent degradation, but too few samples to trust
    const result = detectDrift(current, recorded);
    expect(result.drifted).toBe(false);
    expect(result.reason).toContain("Not enough current data");
  });
});

describe("drift alert persistence", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("records and retrieves the latest drift alert for a question", async () => {
    await recordDriftAlert({
      question: "DIRECTION_QUALITY",
      champion_version: 3,
      checked_at: "2026-01-01T00:00:00.000Z",
      recorded_metrics: metrics(),
      current_metrics: metrics({ brier_score: 0.4 }),
      reason: "test drift",
    });
    const alert = await latestDriftAlert("DIRECTION_QUALITY");
    expect(alert?.champion_version).toBe(3);
    expect(alert?.reason).toBe("test drift");
  });

  it("returns null when no drift has ever been recorded for a question", async () => {
    expect(await latestDriftAlert("NEVER_CHECKED")).toBeNull();
  });

  it("never throws even if the underlying write fails (best-effort, matches other Global Brain side effects)", async () => {
    state.db = { collection: () => { throw new Error("boom"); } } as unknown as FakeDb;
    await expect(
      recordDriftAlert({ question: "X", champion_version: 1, checked_at: "t", recorded_metrics: metrics(), current_metrics: metrics(), reason: "r" }),
    ).resolves.toBeUndefined();
  });
});
