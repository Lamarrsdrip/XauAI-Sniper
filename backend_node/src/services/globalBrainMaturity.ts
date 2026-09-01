import { assessEffectSize, MIN_HOLDOUT_SAMPLE, MIN_HOLDOUT_SAMPLE_FLOOR, REQUIRED_STREAK_CYCLES, type ModelMetrics } from "./globalBrainPromotion.js";

/**
 * Evidence-based maturity policy (replaces a single rigid "holdout >= 30"
 * gate with TWO safe paths, neither of which is weaker than the original
 * bar for a single evaluation):
 *
 *  FAST PATH: holdout_n >= MIN_HOLDOUT_SAMPLE (30) and a statistically-
 *  significant effect -- promotes immediately, byte-identical to this
 *  codebase's original behavior before this audit.
 *
 *  MULTI-CYCLE PATH: MIN_HOLDOUT_SAMPLE_FLOOR (12) <= holdout_n < 30. The
 *  SAME statistical bar (assessEffectSize -- no degradation on any tracked
 *  metric, a real improvement on at least one, at a margin that scales up
 *  as the sample shrinks via each metric's own standard error) must be met
 *  on genuinely NEW data across REQUIRED_STREAK_CYCLES (3) consecutive
 *  daily cycles before promotion. A cycle whose dataset_fingerprint matches
 *  the streak's last counted cycle contributes no new evidence and cannot
 *  extend the streak -- this is what stops reusing the same validation
 *  data from faking repeated confirmation. Any cycle that fails the
 *  statistical bar, or drops below the floor, resets the streak to zero.
 *
 * Below the floor, nothing can promote through either path -- there simply
 * is not enough data to measure anything.
 */

export interface MaturityAssessment {
  promoted: boolean;
  reason: string;
  meets_small_sample_criteria: boolean;
  streak_count: number;
  path: "FAST_PATH" | "MULTI_CYCLE" | "INSUFFICIENT_EVIDENCE";
}

export interface PriorStreakInfo {
  streak_count: number;
  dataset_fingerprint: string;
}

export function evaluateMaturity(
  challenger: ModelMetrics,
  comparisonBaseline: ModelMetrics,
  datasetFingerprint: string,
  priorStreak: PriorStreakInfo | null,
): MaturityAssessment {
  if (challenger.holdout_n >= MIN_HOLDOUT_SAMPLE) {
    const effect = assessEffectSize(challenger, comparisonBaseline);
    if (!effect.qualifies) return { promoted: false, reason: effect.reason, meets_small_sample_criteria: false, streak_count: 0, path: "FAST_PATH" };
    return {
      promoted: true,
      reason: `PROMOTED (fast path): ${effect.reason}, holdout_n=${challenger.holdout_n}.`,
      meets_small_sample_criteria: false,
      streak_count: 0,
      path: "FAST_PATH",
    };
  }

  if (challenger.holdout_n < MIN_HOLDOUT_SAMPLE_FLOOR) {
    return {
      promoted: false,
      reason: `INSUFFICIENT_EVIDENCE: holdout sample ${challenger.holdout_n} is below the absolute evidence floor of ${MIN_HOLDOUT_SAMPLE_FLOOR} -- too thin to measure anything, regardless of apparent effect size.`,
      meets_small_sample_criteria: false,
      streak_count: 0,
      path: "INSUFFICIENT_EVIDENCE",
    };
  }

  const effect = assessEffectSize(challenger, comparisonBaseline);
  if (!effect.qualifies) {
    return {
      promoted: false,
      reason: `INSUFFICIENT_EVIDENCE: holdout sample ${challenger.holdout_n} is below the single-shot minimum of ${MIN_HOLDOUT_SAMPLE}, and this cycle's evidence does not clear the statistical bar for multi-cycle confirmation either (${effect.reason}).`,
      meets_small_sample_criteria: false,
      streak_count: 0,
      path: "INSUFFICIENT_EVIDENCE",
    };
  }

  const continuesStreak = priorStreak !== null && priorStreak.dataset_fingerprint !== datasetFingerprint;
  const streakCount = continuesStreak ? priorStreak!.streak_count + 1 : 1;

  if (streakCount >= REQUIRED_STREAK_CYCLES) {
    return {
      promoted: true,
      reason: `PROMOTED (multi-cycle confirmation): holdout sample ${challenger.holdout_n} is below the single-shot minimum of ${MIN_HOLDOUT_SAMPLE}, but this same effect (${effect.reason}) has now held across ${streakCount} consecutive independent cycles, each evaluated on genuinely new data.`,
      meets_small_sample_criteria: true,
      streak_count: streakCount,
      path: "MULTI_CYCLE",
    };
  }

  return {
    promoted: false,
    reason: `INSUFFICIENT_EVIDENCE: holdout sample ${challenger.holdout_n} is below the single-shot minimum of ${MIN_HOLDOUT_SAMPLE} (this cycle's evidence: ${effect.reason}); qualifies for multi-cycle confirmation, ${streakCount}/${REQUIRED_STREAK_CYCLES} consecutive independent cycles so far -- ${REQUIRED_STREAK_CYCLES - streakCount} more needed.`,
    meets_small_sample_criteria: true,
    streak_count: streakCount,
    path: "INSUFFICIENT_EVIDENCE",
  };
}
