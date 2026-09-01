/**
 * Champion/challenger promotion gate. Pure function, no DB access, so the
 * gate logic itself is directly unit-testable without a database -- the
 * daily training job (globalBrainTraining.ts) is the only caller that wires
 * this to real data.
 *
 * Metrics are prediction-quality metrics, not raw holdout-data stats:
 * success_rate/avg_r of the holdout SET would be identical regardless of
 * which bucket table produced them (they describe the data, not the
 * model), so they cannot distinguish a better model from a worse one.
 * Instead:
 *  - brier_score: mean squared error between each model's own predicted
 *    probability (its bucket table's shrunk_rate for that item's bucket)
 *    and the actual 0/1 outcome, over the SAME holdout set. Lower is
 *    better-calibrated -- this is exactly the spec's "does 80% confidence
 *    behave like ~80%" calibration question, generalized to every question.
 *  - avg_r_captured / max_drawdown_r: if a bucket's shrunk_rate is used as
 *    a simple filter (favor buckets predicted >= 0.5), what R sequence
 *    would that have produced on holdout, in chronological order. This is
 *    the decision-relevant "would following this model's opinion have
 *    helped" metric.
 *
 * Core rule (spec: "NO_EVIDENCE = NO_PROMOTION"): a challenger is promoted
 * only if it clears a minimum out-of-sample sample size AND does not
 * degrade any tracked metric beyond noise tolerance AND improves at least
 * one tracked metric by more than the LARGER of (a) a fixed
 * minimum-practical-effect margin and (b) a noise-scaled statistical
 * threshold derived from each metric's own standard error. (b) exists
 * because an adversarial review of the first version of this gate showed
 * the fixed margins alone (0.02 Brier, 0.03R) are smaller than one standard
 * error of either metric at the minimum holdout sample size -- meaning a
 * genuinely no-skill model could clear the old bar on noise alone. Ties and
 * marginal/noisy differences default to REJECTED, not PROMOTED.
 *
 * There is deliberately no "no existing champion -> auto-promote" branch:
 * the FIRST model for a question is judged by this exact same gate against
 * a trivial baseline (always predict the global observed rate, i.e. "no
 * bucket-specific skill") -- see globalBrainTraining.ts's
 * evaluateBaselineOnHoldout. Clearing a sample-size floor is evidence there
 * is enough data to measure something, not evidence the model learned
 * anything; only beating the baseline is that evidence.
 */

export interface ModelMetrics {
  holdout_n: number;
  brier_score: number; // 0..1, lower is better
  brier_se: number; // standard error of brier_score's estimate (sd of per-item squared errors / sqrt(n))
  avg_r_captured: number; // expectancy in R of holdout items the model would have favored
  avg_r_captured_se: number; // standard error of avg_r_captured (sd of favored items' R / sqrt(count))
  max_drawdown_r: number; // >= 0, larger = worse
}

export interface PromotionDecision {
  promoted: boolean;
  reason: string;
}

export const MIN_HOLDOUT_SAMPLE = 30;
export const MIN_DETECTABLE_BRIER_IMPROVEMENT = 0.02;
export const MIN_DETECTABLE_R_IMPROVEMENT = 0.03;
export const DEGRADATION_TOLERANCE = 0.01; // noise-level slack before a metric counts as "degraded"
export const SIGNIFICANCE_Z = 1.96; // ~95% two-sided normal-approximation threshold

/**
 * Evidence-based maturity floor (spec: "do not simply change 30 to 5" --
 * MIN_HOLDOUT_SAMPLE above is UNCHANGED and remains the single-shot bar; a
 * challenger clearing it is promoted exactly as before, no new mechanism
 * involved). Below MIN_HOLDOUT_SAMPLE_FLOOR there simply is not enough data
 * to measure ANYTHING -- standardError() itself already returns a
 * conservative worst-case for n<2, but a handful of holdout items is still
 * too thin to trust even with a wide error bar, so promotion is refused
 * outright regardless of how good the apparent numbers look.
 *
 * Between the floor and the single-shot bar, a challenger may still promote
 * via MULTI-CYCLE CONFIRMATION (see globalBrainMaturity.ts): the SAME
 * statistically-significant effect-size test used above (not a weaker one)
 * must pass on genuinely new data across REQUIRED_STREAK_CYCLES consecutive
 * daily cycles before promotion is allowed. Requiring repetition rather
 * than lowering the bar is strictly MORE conservative per-cycle (a single
 * lucky small sample is not enough; sustained agreement across independent
 * evaluation windows is real evidence noise cannot easily produce), even
 * though it accepts a smaller n than the single-shot path.
 */
export const MIN_HOLDOUT_SAMPLE_FLOOR = 12;
export const REQUIRED_STREAK_CYCLES = 3;

/** The larger of a fixed practical-significance floor and a noise-scaled statistical-significance threshold. Treats challenger/champion holdout scores as independent estimates (a conservative simplification -- they're evaluated on the same items but with different predictions, not a truly independent resample; treating them as independent yields a larger, safer combined SE than a paired estimate would). */
function requiredImprovementMargin(fixedFloor: number, challengerSe: number, championSe: number): number {
  const combinedSe = Math.sqrt(challengerSe ** 2 + championSe ** 2);
  return Math.max(fixedFloor, SIGNIFICANCE_Z * combinedSe);
}

export interface EffectSizeAssessment {
  /** True only when no tracked metric degraded AND at least one improved beyond its statistically-significant margin. Sample-size-independent -- callers decide what sample size is required to trust this. */
  qualifies: boolean;
  degraded: boolean;
  brier_delta: number;
  avg_r_delta: number;
  drawdown_delta: number;
  brier_margin_required: number;
  avg_r_margin_required: number;
  reason: string;
}

/**
 * The statistical core of the promotion gate, deliberately factored out of
 * any sample-size gate: whether an effect is real (no degradation on any
 * tracked metric, and a statistically-significant improvement on at least
 * one) does not depend on how large the holdout was -- requiredImprovement
 * Margin already widens automatically as standardError grows with a
 * smaller n, so a small, noisy sample is held to a proportionally harder
 * bar, never a lenient one. Callers (evaluatePromotion's single-shot path,
 * globalBrainMaturity.ts's multi-cycle path) are what decide whether THIS
 * MANY qualifying results is enough evidence to act on.
 */
export function assessEffectSize(challenger: ModelMetrics, comparisonBaseline: ModelMetrics): EffectSizeAssessment {
  const brierDelta = challenger.brier_score - comparisonBaseline.brier_score; // negative = improvement
  const avgRDelta = challenger.avg_r_captured - comparisonBaseline.avg_r_captured; // positive = improvement
  const drawdownDelta = challenger.max_drawdown_r - comparisonBaseline.max_drawdown_r; // positive = worse

  const brierMargin = requiredImprovementMargin(MIN_DETECTABLE_BRIER_IMPROVEMENT, challenger.brier_se, comparisonBaseline.brier_se);
  const rMargin = requiredImprovementMargin(MIN_DETECTABLE_R_IMPROVEMENT, challenger.avg_r_captured_se, comparisonBaseline.avg_r_captured_se);

  if (brierDelta > DEGRADATION_TOLERANCE) {
    return {
      qualifies: false,
      degraded: true,
      brier_delta: brierDelta,
      avg_r_delta: avgRDelta,
      drawdown_delta: drawdownDelta,
      brier_margin_required: brierMargin,
      avg_r_margin_required: rMargin,
      reason: `REJECTED: calibration (brier_score) degraded by ${brierDelta.toFixed(3)} vs the comparison baseline.`,
    };
  }
  if (avgRDelta < -DEGRADATION_TOLERANCE) {
    return {
      qualifies: false,
      degraded: true,
      brier_delta: brierDelta,
      avg_r_delta: avgRDelta,
      drawdown_delta: drawdownDelta,
      brier_margin_required: brierMargin,
      avg_r_margin_required: rMargin,
      reason: `REJECTED: avg_r_captured degraded by ${(-avgRDelta).toFixed(3)}R vs the comparison baseline.`,
    };
  }
  if (drawdownDelta > DEGRADATION_TOLERANCE) {
    return {
      qualifies: false,
      degraded: true,
      brier_delta: brierDelta,
      avg_r_delta: avgRDelta,
      drawdown_delta: drawdownDelta,
      brier_margin_required: brierMargin,
      avg_r_margin_required: rMargin,
      reason: `REJECTED: max_drawdown_r worsened by ${drawdownDelta.toFixed(3)}R vs the comparison baseline.`,
    };
  }

  const meaningfulImprovement = -brierDelta >= brierMargin || avgRDelta >= rMargin;
  if (!meaningfulImprovement) {
    return {
      qualifies: false,
      degraded: false,
      brier_delta: brierDelta,
      avg_r_delta: avgRDelta,
      drawdown_delta: drawdownDelta,
      brier_margin_required: brierMargin,
      avg_r_margin_required: rMargin,
      reason: `INSUFFICIENT_EVIDENCE: no tracked metric improved beyond its statistically-significant margin (brier delta ${brierDelta.toFixed(3)} vs required ${brierMargin.toFixed(3)}; avg_r_captured delta ${avgRDelta.toFixed(3)} vs required ${rMargin.toFixed(3)}).`,
    };
  }

  return {
    qualifies: true,
    degraded: false,
    brier_delta: brierDelta,
    avg_r_delta: avgRDelta,
    drawdown_delta: drawdownDelta,
    brier_margin_required: brierMargin,
    avg_r_margin_required: rMargin,
    reason: `brier_score ${brierDelta <= 0 ? "" : "+"}${brierDelta.toFixed(3)} (required ${brierMargin.toFixed(3)}), avg_r_captured ${avgRDelta >= 0 ? "+" : ""}${avgRDelta.toFixed(3)}R (required ${rMargin.toFixed(3)}), drawdown delta ${drawdownDelta.toFixed(3)}R`,
  };
}

/** Unchanged single-shot fast path: holdout_n >= MIN_HOLDOUT_SAMPLE (30) and a qualifying effect size promotes immediately, exactly as before this audit. Smaller samples are INSUFFICIENT_EVIDENCE here -- see globalBrainMaturity.ts for the multi-cycle path that is the only other way a smaller sample can promote. */
export function evaluatePromotion(challenger: ModelMetrics, comparisonBaseline: ModelMetrics): PromotionDecision {
  if (challenger.holdout_n < MIN_HOLDOUT_SAMPLE) {
    return { promoted: false, reason: `INSUFFICIENT_EVIDENCE: holdout sample ${challenger.holdout_n} below minimum ${MIN_HOLDOUT_SAMPLE}.` };
  }
  const effect = assessEffectSize(challenger, comparisonBaseline);
  if (!effect.qualifies) return { promoted: false, reason: effect.reason };
  return { promoted: true, reason: `PROMOTED: ${effect.reason}, holdout_n=${challenger.holdout_n}.` };
}

/** Max cumulative drawdown of a chronologically-ordered R-multiple sequence. */
export function maxDrawdownR(chronologicalRs: number[]): number {
  let cumulative = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of chronologicalRs) {
    cumulative += r;
    peak = Math.max(peak, cumulative);
    maxDd = Math.max(maxDd, peak - cumulative);
  }
  return Math.round(maxDd * 1000) / 1000;
}

/** Mean squared error between predicted probabilities and actual 0/1 outcomes -- the standard Brier score. */
export function brierScore(predictedActualPairs: readonly [predicted: number, actual: 0 | 1][]): number {
  if (predictedActualPairs.length === 0) return 1; // worst-case default when there's nothing to score, never a fabricated "good" score
  const sumSq = predictedActualPairs.reduce((sum, [p, a]) => sum + (p - a) ** 2, 0);
  return Math.round((sumSq / predictedActualPairs.length) * 1000) / 1000;
}

/** Standard error of the mean of a sample: sample standard deviation / sqrt(n). Returns a large, conservative value for n<2 (an unmeasurable spread must never look like a tight, confident estimate). */
export function standardError(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 1; // conservative: forces requiredImprovementMargin to demand a large delta when there's essentially no data to estimate spread from
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance / n);
}
