import { describe, expect, it } from "vitest";
import { evaluateMaturity } from "./globalBrainMaturity.js";
import { MIN_HOLDOUT_SAMPLE, MIN_HOLDOUT_SAMPLE_FLOOR, REQUIRED_STREAK_CYCLES, type ModelMetrics } from "./globalBrainPromotion.js";

function metrics(overrides: Partial<ModelMetrics>): ModelMetrics {
  return { holdout_n: 40, brier_score: 0.15, brier_se: 0.02, avg_r_captured: 0.5, avg_r_captured_se: 0.05, max_drawdown_r: 1.0, ...overrides };
}

const STRONG_CHALLENGER = metrics({ holdout_n: 20, brier_score: 0.1, brier_se: 0.01, avg_r_captured: 0.8, avg_r_captured_se: 0.02 });
const WEAK_BASELINE = metrics({ holdout_n: 20, brier_score: 0.2, brier_se: 0.01, avg_r_captured: 0.3, avg_r_captured_se: 0.02 });

describe("evaluateMaturity", () => {
  it("fast path: holdout_n >= 30 with a qualifying effect promotes immediately, no streak needed", () => {
    const challenger = metrics({ holdout_n: MIN_HOLDOUT_SAMPLE, brier_score: 0.1, brier_se: 0.01, avg_r_captured: 0.8, avg_r_captured_se: 0.02 });
    const baseline = metrics({ holdout_n: MIN_HOLDOUT_SAMPLE, brier_score: 0.2, brier_se: 0.01, avg_r_captured: 0.3, avg_r_captured_se: 0.02 });
    const result = evaluateMaturity(challenger, baseline, "fp1", null);
    expect(result.promoted).toBe(true);
    expect(result.path).toBe("FAST_PATH");
    expect(result.streak_count).toBe(0);
  });

  it("fast path: holdout_n >= 30 with no real effect stays rejected, never falls through to multi-cycle", () => {
    const challenger = metrics({ holdout_n: MIN_HOLDOUT_SAMPLE, brier_score: 0.15, avg_r_captured: 0.5 });
    const baseline = metrics({ holdout_n: MIN_HOLDOUT_SAMPLE, brier_score: 0.15, avg_r_captured: 0.5 });
    const result = evaluateMaturity(challenger, baseline, "fp2", null);
    expect(result.promoted).toBe(false);
    expect(result.path).toBe("FAST_PATH");
  });

  it("below the absolute floor (12): always INSUFFICIENT_EVIDENCE regardless of how strong the apparent effect looks", () => {
    const challenger = metrics({ holdout_n: MIN_HOLDOUT_SAMPLE_FLOOR - 1, brier_score: 0.01, avg_r_captured: 2.0 });
    const baseline = metrics({ holdout_n: MIN_HOLDOUT_SAMPLE_FLOOR - 1, brier_score: 0.5, avg_r_captured: -1.0 });
    const result = evaluateMaturity(challenger, baseline, "fp3", null);
    expect(result.promoted).toBe(false);
    expect(result.path).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.meets_small_sample_criteria).toBe(false);
    expect(result.streak_count).toBe(0);
  });

  it("in the multi-cycle band (12-29) with no qualifying effect: streak stays broken, does not accumulate", () => {
    const flat = metrics({ holdout_n: 20, brier_score: 0.15, avg_r_captured: 0.5 });
    const result = evaluateMaturity(flat, flat, "fp4", { streak_count: 2, dataset_fingerprint: "old" });
    expect(result.promoted).toBe(false);
    expect(result.meets_small_sample_criteria).toBe(false);
    expect(result.streak_count).toBe(0);
  });

  it("first qualifying cycle in the multi-cycle band starts a streak of 1, not promoted yet", () => {
    const result = evaluateMaturity(STRONG_CHALLENGER, WEAK_BASELINE, "cycle1", null);
    expect(result.promoted).toBe(false);
    expect(result.path).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.meets_small_sample_criteria).toBe(true);
    expect(result.streak_count).toBe(1);
  });

  it("streak accumulates across consecutive qualifying cycles with genuinely new data each time, and promotes on reaching REQUIRED_STREAK_CYCLES", () => {
    let streak: { streak_count: number; dataset_fingerprint: string } | null = null;
    let last;
    for (let cycle = 1; cycle <= REQUIRED_STREAK_CYCLES; cycle++) {
      last = evaluateMaturity(STRONG_CHALLENGER, WEAK_BASELINE, `cycle${cycle}`, streak);
      expect(last.meets_small_sample_criteria).toBe(true);
      expect(last.streak_count).toBe(cycle);
      streak = { streak_count: last.streak_count, dataset_fingerprint: `cycle${cycle}` };
    }
    expect(last!.promoted).toBe(true);
    expect(last!.path).toBe("MULTI_CYCLE");
  });

  it("reusing the SAME dataset_fingerprint never extends the streak (no faking repeated confirmation with identical validation data)", () => {
    const first = evaluateMaturity(STRONG_CHALLENGER, WEAK_BASELINE, "same-fp", null);
    expect(first.streak_count).toBe(1);
    const priorStreak = { streak_count: first.streak_count, dataset_fingerprint: "same-fp" };
    const second = evaluateMaturity(STRONG_CHALLENGER, WEAK_BASELINE, "same-fp", priorStreak);
    // Same fingerprint as the counted cycle -- resets to a fresh streak of 1, never accumulates to 2.
    expect(second.streak_count).toBe(1);
    expect(second.promoted).toBe(false);
  });

  it("a single non-qualifying cycle in the middle of a streak resets it to zero, not just pauses it", () => {
    const cycle1 = evaluateMaturity(STRONG_CHALLENGER, WEAK_BASELINE, "c1", null);
    expect(cycle1.streak_count).toBe(1);
    const streakAfter1 = { streak_count: cycle1.streak_count, dataset_fingerprint: "c1" };

    const flat = metrics({ holdout_n: 20, brier_score: 0.15, avg_r_captured: 0.5 });
    const cycle2 = evaluateMaturity(flat, flat, "c2", streakAfter1); // no effect this cycle
    expect(cycle2.streak_count).toBe(0);
    expect(cycle2.meets_small_sample_criteria).toBe(false);

    // Even though cycle3 qualifies again, it starts a FRESH streak of 1, not 2 -- the break was real.
    const cycle3 = evaluateMaturity(STRONG_CHALLENGER, WEAK_BASELINE, "c3", null); // caller passes null after a reset, matching how globalBrainTraining.ts reads "no qualifying prior" from the last model doc
    expect(cycle3.streak_count).toBe(1);
  });

  it("never promotes below the single-shot minimum without reaching REQUIRED_STREAK_CYCLES, however strong a single cycle's effect is", () => {
    const veryStrong = metrics({ holdout_n: MIN_HOLDOUT_SAMPLE_FLOOR, brier_score: 0.01, brier_se: 0.001, avg_r_captured: 3.0, avg_r_captured_se: 0.01 });
    const veryWeak = metrics({ holdout_n: MIN_HOLDOUT_SAMPLE_FLOOR, brier_score: 0.5, brier_se: 0.001, avg_r_captured: -1.0, avg_r_captured_se: 0.01 });
    const result = evaluateMaturity(veryStrong, veryWeak, "one-shot", null);
    expect(result.promoted).toBe(false);
    expect(result.streak_count).toBe(1);
  });
});
