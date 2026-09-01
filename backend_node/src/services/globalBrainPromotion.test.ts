import { describe, expect, it } from "vitest";
import { brierScore, evaluatePromotion, maxDrawdownR, standardError, MIN_HOLDOUT_SAMPLE, type ModelMetrics } from "./globalBrainPromotion.js";

// se: 0 throughout most cases below so the fixed practical-effect floor is
// what's being tested, isolated from the noise-scaled statistical
// threshold (which has its own dedicated tests further down).
function metrics(overrides: Partial<ModelMetrics> = {}): ModelMetrics {
  return { holdout_n: 100, brier_score: 0.2, brier_se: 0, avg_r_captured: 0.3, avg_r_captured_se: 0, max_drawdown_r: 1.0, ...overrides };
}

describe("evaluatePromotion", () => {
  it("rejects for INSUFFICIENT_EVIDENCE below the minimum holdout sample, even against a trivial baseline", () => {
    const decision = evaluatePromotion(metrics({ holdout_n: MIN_HOLDOUT_SAMPLE - 1 }), metrics());
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain("INSUFFICIENT_EVIDENCE");
  });

  it("does NOT auto-promote a first-ever model on sample size alone -- it must still beat the comparison baseline", () => {
    const baseline = metrics({ brier_score: 0.2, avg_r_captured: 0.3 });
    const noSkillChallenger = metrics({ holdout_n: MIN_HOLDOUT_SAMPLE, brier_score: 0.2, avg_r_captured: 0.3 }); // identical to baseline -- no skill demonstrated
    const decision = evaluatePromotion(noSkillChallenger, baseline);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain("INSUFFICIENT_EVIDENCE");
  });

  it("rejects when calibration (brier) degrades vs the comparison baseline", () => {
    const baseline = metrics({ brier_score: 0.1 });
    const challenger = metrics({ brier_score: 0.2 }); // worse (higher) brier
    const decision = evaluatePromotion(challenger, baseline);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain("calibration");
  });

  it("rejects when expectancy (avg_r_captured) degrades vs the comparison baseline", () => {
    const baseline = metrics({ avg_r_captured: 0.5, brier_score: 0.2 });
    const challenger = metrics({ avg_r_captured: 0.2, brier_score: 0.2 });
    const decision = evaluatePromotion(challenger, baseline);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain("avg_r_captured");
  });

  it("rejects when drawdown worsens vs the comparison baseline even if other metrics tie", () => {
    const baseline = metrics({ max_drawdown_r: 1.0 });
    const challenger = metrics({ max_drawdown_r: 3.0 });
    const decision = evaluatePromotion(challenger, baseline);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain("drawdown");
  });

  it("rejects as INSUFFICIENT_EVIDENCE when nothing improves beyond the noise margin (no promotion on a tie)", () => {
    const baseline = metrics();
    const challenger = metrics({ brier_score: 0.199, avg_r_captured: 0.301 }); // negligible, within tolerance
    const decision = evaluatePromotion(challenger, baseline);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain("INSUFFICIENT_EVIDENCE");
  });

  it("promotes when calibration improves beyond the minimum-detectable margin with nothing else degraded and se is negligible", () => {
    const baseline = metrics({ brier_score: 0.3 });
    const challenger = metrics({ brier_score: 0.25 }); // 0.05 improvement > 0.02 fixed floor, se=0 so no added statistical requirement
    const decision = evaluatePromotion(challenger, baseline);
    expect(decision.promoted).toBe(true);
  });

  it("promotes when expectancy improves beyond the minimum-detectable margin with nothing else degraded and se is negligible", () => {
    const baseline = metrics({ avg_r_captured: 0.1 });
    const challenger = metrics({ avg_r_captured: 0.2 }); // 0.1 improvement > 0.03 fixed floor
    const decision = evaluatePromotion(challenger, baseline);
    expect(decision.promoted).toBe(true);
  });

  it("rejects an improvement that clears the fixed floor but not the noise-scaled statistical threshold (closes the bootstrap-promotion gap)", () => {
    // 0.03 brier improvement clears the fixed 0.02 floor, but with se=0.03
    // on each side the noise-scaled requirement (1.96 * sqrt(0.03^2+0.03^2) ≈ 0.083) is much larger --
    // this exact gap (fixed margin smaller than sampling noise) is what an adversarial review found.
    const baseline = metrics({ brier_score: 0.3, brier_se: 0.03 });
    const challenger = metrics({ brier_score: 0.27, brier_se: 0.03 });
    const decision = evaluatePromotion(challenger, baseline);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain("INSUFFICIENT_EVIDENCE");
  });

  it("promotes when the improvement clears the larger, noise-scaled statistical threshold", () => {
    const baseline = metrics({ brier_score: 0.3, brier_se: 0.01 });
    const challenger = metrics({ brier_score: 0.2, brier_se: 0.01 }); // 0.1 improvement, well beyond 1.96*sqrt(0.01^2*2) ≈ 0.028
    const decision = evaluatePromotion(challenger, baseline);
    expect(decision.promoted).toBe(true);
  });
});

describe("standardError", () => {
  it("returns a conservative (large) value for fewer than 2 samples rather than pretending certainty", () => {
    expect(standardError([])).toBe(1);
    expect(standardError([0.5])).toBe(1);
  });

  it("computes sample-standard-deviation / sqrt(n) for a real sample", () => {
    const se = standardError([1, 2, 3, 4, 5]);
    expect(se).toBeCloseTo(Math.sqrt(2.5 / 5), 5); // variance of [1..5] is 2.5 (sample variance, n-1 denominator)
  });

  it("shrinks as sample size grows for the same underlying spread", () => {
    const small = standardError([1, 2, 3]);
    const large = standardError([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(large).toBeLessThan(small);
  });
});

describe("maxDrawdownR", () => {
  it("returns 0 for an all-winning sequence", () => {
    expect(maxDrawdownR([1, 1, 1])).toBe(0);
  });

  it("computes peak-to-trough drawdown correctly", () => {
    // cumulative: 1, 2, 1, -1, 0 -> peak 2, trough -1 -> drawdown 3
    expect(maxDrawdownR([1, 1, -1, -2, 1])).toBe(3);
  });
});

describe("brierScore", () => {
  it("is 0 for perfect predictions", () => {
    expect(brierScore([[1, 1], [0, 0]])).toBe(0);
  });

  it("is 1 for perfectly wrong confident predictions", () => {
    expect(brierScore([[1, 0], [0, 1]])).toBe(1);
  });

  it("defaults to the worst-case score (1) for an empty set rather than fabricating a good score", () => {
    expect(brierScore([])).toBe(1);
  });
});
