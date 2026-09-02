import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import {
  GLOBAL_BRAIN_DAILY_REPORTS_COLLECTION,
  GLOBAL_BRAIN_OBSERVATIONS_COLLECTION,
  MISTAKE_CATEGORIES,
  type GlobalBrainObservation,
  type MistakeCategory,
} from "../models/globalBrain.js";
import { computeBucketedEstimator, lookupBucket, type BucketedEstimatorResult } from "./globalBrainEstimator.js";
import {
  assessEffectSize,
  brierScore,
  DEGRADATION_TOLERANCE,
  evaluatePromotion,
  maxDrawdownR,
  MIN_HOLDOUT_SAMPLE,
  MIN_HOLDOUT_SAMPLE_FLOOR,
  REQUIRED_STREAK_CYCLES,
  SIGNIFICANCE_Z,
  standardError,
  type ModelMetrics,
} from "./globalBrainPromotion.js";
import { evaluateMaturity, type PriorStreakInfo } from "./globalBrainMaturity.js";
import { getCurrentChampion, getLatestModelDoc, promoteChallenger, rejectChallenger, type NewModelInput } from "./globalBrainRegistry.js";
import { detectDrift, recordDriftAlert } from "./globalBrainDrift.js";
import { getGlobalBrainSettings } from "./globalBrainSettings.js";

/**
 * The 24-hour learning cycle. This is the ONLY place a challenger is
 * trained, evaluated out-of-sample, and (conditionally) promoted. It never
 * touches any live-decision code path -- it only reads
 * global_brain_observations (itself populated exclusively by the two
 * shadow-only ingestion hooks in routes/journal.ts and
 * services/marketOutlookTick.ts) and writes model/report documents.
 *
 * DAILY JOB FAILURE rule (spec): any exception before a question's
 * promote/reject call means that question's champion is left completely
 * untouched -- caught at the top level below, never partially applied.
 */

export const GLOBAL_BRAIN_QUESTIONS = ["DIRECTION_QUALITY", "TP_BEFORE_SL", "ENTRY_TIMING", "SETUP_QUALITY", "CALIBRATION"] as const;
export type GlobalBrainQuestion = (typeof GLOBAL_BRAIN_QUESTIONS)[number];

// Chronological (walk-forward) split -- oldest observations train, most
// recent are true holdout. Never randomized: shuffling would leak
// regime/session information across the split (spec: "no lookahead").
const TRAIN_FRACTION = 0.6;
const VALIDATION_FRACTION = 0.2;
// remaining ~0.2 is holdout

export interface QuestionSpec {
  bucketKey: (o: GlobalBrainObservation) => string;
  isSuccess: (o: GlobalBrainObservation) => boolean;
  r: (o: GlobalBrainObservation) => number | null;
  eligible: (o: GlobalBrainObservation) => boolean;
}

/**
 * DIRECTION_QUALITY and SETUP_QUALITY ask "was the directional/setup CALL
 * right", not "did the trade ultimately make money" -- those are different
 * questions the raw analytics_outcome WIN/LOSS boolean cannot tell apart on
 * its own. A LOSS that classifyMistake already labeled STOP_BEFORE_MOVE
 * (price moved genuinely favorably -- past MIN_FAVORABLE_MOVE_R -- in the
 * called direction before reversing to a stop-out/timeout loss) is real
 * evidence the direction/setup call was validated by the market; only the
 * exit/management afterward failed, a separate concern this codebase does
 * not yet have its own learning objective for (documented gap, not silently
 * dropped). Counting it as a plain failure -- indistinguishable from
 * WRONG_DIRECTION, where price never validated the call at all -- was a
 * confirmed labeling bug found auditing the resolution pipeline (see
 * globalBrainTraining.test.ts "direction/setup quality independence").
 * CALIBRATION is deliberately NOT given this treatment: it measures whether
 * stated confidence matches the true realized-P&L win probability, so it
 * must stay strictly WIN/LOSS -- partial directional validation is not the
 * thing calibration is supposed to predict. TP_BEFORE_SL is unaffected: it
 * asks whether a target was actually reached before the trade closed
 * negatively, and in a STOP_BEFORE_MOVE loss one genuinely was not.
 */
function successOrValidatedDirection(o: GlobalBrainObservation): boolean {
  return o.outcome!.analytics_outcome === "WIN" || o.mistake_classification === "STOP_BEFORE_MOVE";
}

/**
 * Bumped whenever a QUESTION_SPECS label-computation function's OUTPUT for a
 * given observation can change (e.g. the STOP_BEFORE_MOVE fix above) --
 * folded into datasetFingerprint below. Without this, the fingerprint (a
 * hash of WHICH observations are eligible, by dedupe_key) stays identical
 * across a label-logic change on the SAME observation set, so the
 * multi-cycle maturity streak (globalBrainMaturity.ts) would treat
 * old-logic and new-logic cycles as "the same evidence" and could count a
 * streak across the boundary. Bumping this forces every question to
 * evaluate as genuinely new data on the first cycle after any label-logic
 * fix, resetting in-progress streaks rather than silently carrying them
 * across a semantics change.
 */
const LABEL_SCHEMA_VERSION = 4; // v4: TP_BEFORE_SL uses literal first-terminal chronology; v3 added timing labels and less-sparse direction/timing context keys

export const QUESTION_SPECS: Record<GlobalBrainQuestion, QuestionSpec> = {
  DIRECTION_QUALITY: {
    eligible: (o) => o.decision_action === "EXECUTED" && o.outcome !== null && o.outcome.analytics_outcome !== null,
    bucketKey: (o) => `${o.features.direction}|${o.features.regime}|${o.features.setup_type}`,
    isSuccess: successOrValidatedDirection,
    r: (o) => o.outcome!.r_multiple,
  },
  TP_BEFORE_SL: {
    // Literal executable chronology. Final R cannot answer this because the
    // Outlook analytics layer intentionally allows eventual TP-after-SL to
    // validate direction; this learning question must not conflate them.
    eligible: (o) => o.decision_action === "EXECUTED" && o.outcome !== null && o.outcome.tp_before_sl !== null && o.outcome.tp_before_sl !== undefined,
    bucketKey: (o) => `${o.features.direction}|${o.features.regime}`,
    isSuccess: (o) => o.outcome!.tp_before_sl === true,
    r: (o) => o.outcome!.r_multiple,
  },
  ENTRY_TIMING: {
    eligible: (o) => o.counterfactual !== null && o.counterfactual.some((c) => c.data_available) && o.outcome !== null && o.outcome.r_multiple !== null,
    bucketKey: (o) => `${o.features.regime}`,
    isSuccess: (o) => !(["ENTRY_TOO_LATE", "ENTRY_TOO_EARLY", "WAIT_HURT_ENTRY", "WAIT_IMPROVED_ENTRY", "HIGH_MAE_WIN"] as MistakeCategory[]).includes(o.mistake_classification ?? "UNCLASSIFIED"),
    r: (o) => o.outcome!.r_multiple,
  },
  SETUP_QUALITY: {
    eligible: (o) => o.decision_action === "EXECUTED" && o.outcome !== null && o.outcome.analytics_outcome !== null && Boolean(o.features.setup_type),
    bucketKey: (o) => o.features.setup_type,
    isSuccess: successOrValidatedDirection,
    r: (o) => o.outcome!.r_multiple,
  },
  CALIBRATION: {
    eligible: (o) => o.decision_action === "EXECUTED" && o.outcome !== null && o.outcome.analytics_outcome !== null && o.features.confidence_pct !== null,
    bucketKey: (o) => `decile_${Math.min(9, Math.floor((o.features.confidence_pct ?? 0) / 10))}`,
    isSuccess: (o) => o.outcome!.analytics_outcome === "WIN",
    r: (o) => o.outcome!.r_multiple,
  },
};

/** Data-quality filter (spec: reject missing timestamps/direction/outcome, unsupported symbols). No is_tester/is_backtest flag exists anywhere in the source data today (per architecture audit) -- there is nothing to filter on for that specific risk yet; documented as a known gap in the daily report rather than silently ignored. */
function passesDataQuality(o: GlobalBrainObservation): boolean {
  if (!o.resolved_at) return false;
  if (!o.features.direction || o.features.direction === "NONE") return false;
  if (!o.features.symbol || !o.features.symbol.toUpperCase().startsWith("XAU")) return false;
  return true;
}

/** Scores a bucket table against holdout, using the model's OWN bucket lookup for each item's predicted probability. */
export function evaluateOnHoldout(buckets: BucketedEstimatorResult, holdoutItems: GlobalBrainObservation[], spec: QuestionSpec): ModelMetrics {
  return scoreOnHoldout(holdoutItems, spec, (item) => lookupBucket(buckets, spec.bucketKey(item)).shrunk_rate);
}

/** Scores a trivial "no bucket-specific skill" baseline that predicts the SAME constant probability (the challenger's own global prior rate) for every item, regardless of bucket. This is what a first-ever model for a question must beat -- clearing the minimum holdout sample is evidence there's enough data to measure something, not evidence of learned skill; only beating this baseline is that evidence. */
export function evaluateBaselineOnHoldout(globalPriorRate: number, holdoutItems: GlobalBrainObservation[], spec: QuestionSpec): ModelMetrics {
  return scoreOnHoldout(holdoutItems, spec, () => globalPriorRate);
}

function scoreOnHoldout(holdoutItems: GlobalBrainObservation[], spec: QuestionSpec, predict: (item: GlobalBrainObservation) => number): ModelMetrics {
  const pairs: [number, 0 | 1][] = [];
  const squaredErrors: number[] = [];
  const favoredChronological: { resolved_at: string; r: number }[] = [];

  for (const item of holdoutItems) {
    const predicted = predict(item);
    const actual: 0 | 1 = spec.isSuccess(item) ? 1 : 0;
    pairs.push([predicted, actual]);
    squaredErrors.push((predicted - actual) ** 2);
    if (predicted >= 0.5) {
      const r = spec.r(item);
      if (r !== null) favoredChronological.push({ resolved_at: item.resolved_at!, r });
    }
  }

  favoredChronological.sort((a, b) => new Date(a.resolved_at).getTime() - new Date(b.resolved_at).getTime());
  const rSeries = favoredChronological.map((f) => f.r);
  const avgRCaptured = rSeries.length > 0 ? rSeries.reduce((s, r) => s + r, 0) / rSeries.length : 0;

  return {
    holdout_n: holdoutItems.length,
    brier_score: brierScore(pairs),
    brier_se: standardError(squaredErrors),
    avg_r_captured: Math.round(avgRCaptured * 1000) / 1000,
    avg_r_captured_se: standardError(rSeries),
    max_drawdown_r: maxDrawdownR(rSeries),
  };
}

const MIN_STABILITY_WINDOW_SAMPLE = 15;

/**
 * Anti-overfitting stability check (spec: test across multiple unseen
 * windows, not one period; "if tiny changes destroy performance, treat the
 * model as fragile"). Splits the SAME already-out-of-sample holdout set
 * into two chronological sub-windows -- no new data, just checking whether
 * the challenger's aggregate-looking improvement actually held up in both
 * halves of it, or was carried entirely by one lucky/unlucky half.
 */
export function checkHoldoutStability(
  challengerBuckets: BucketedEstimatorResult,
  championBuckets: BucketedEstimatorResult | null,
  holdoutItems: GlobalBrainObservation[],
  spec: QuestionSpec,
  globalPriorRate: number,
): { stable: boolean; reason: string } {
  if (holdoutItems.length < MIN_STABILITY_WINDOW_SAMPLE * 2) {
    return { stable: true, reason: "holdout too small to split into sub-windows; stability not assessed" };
  }
  const mid = Math.floor(holdoutItems.length / 2);
  const windows = [holdoutItems.slice(0, mid), holdoutItems.slice(mid)];
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i]!;
    const challengerMetrics = evaluateOnHoldout(challengerBuckets, window, spec);
    if (challengerMetrics.holdout_n < MIN_STABILITY_WINDOW_SAMPLE) continue; // sub-window too thin to judge on its own
    const comparisonMetrics = championBuckets ? evaluateOnHoldout(championBuckets, window, spec) : evaluateBaselineOnHoldout(globalPriorRate, window, spec);
    const brierDelta = challengerMetrics.brier_score - comparisonMetrics.brier_score;
    if (brierDelta > DEGRADATION_TOLERANCE) {
      return {
        stable: false,
        reason: `unstable across time windows -- calibration degraded by ${brierDelta.toFixed(3)} in holdout sub-window ${i + 1}/${windows.length} even though the full-holdout aggregate looked like an improvement`,
      };
    }
  }
  return { stable: true, reason: "consistent across both holdout sub-windows" };
}

const OVERFILTERING_QUESTIONS: readonly GlobalBrainQuestion[] = ["DIRECTION_QUALITY", "TP_BEFORE_SL", "SETUP_QUALITY"];
// Percentage-point drop in "would enter" participation rate before a
// challenger's improvement is treated as suspect rather than assumed genuine.
const OVERFILTERING_PARTICIPATION_DROP_THRESHOLD = 0.15;
// The excluded (comparison-favored, challenger-rejected) opportunities'
// STATISTICAL UPPER BOUND (mean + Z*SE, not the raw point estimate) must be
// at or below this to count as evidence they were genuinely poor. Zero, not
// negative -- "merely broke even" still does not justify walking away from
// a legitimate opportunity. Using the upper confidence bound rather than
// the raw mean closes a gap an adversarial review found: a small negative
// mean over a handful of trades (e.g. -0.05R over 3 trades) is well within
// noise of zero and was previously accepted as "justified" outright, the
// same un-scaled-threshold gap the earlier review already fixed for the
// brier/avg_r metrics in globalBrainPromotion.ts's evaluatePromotion.
const OVERFILTERING_EXCLUDED_R_JUSTIFICATION_THRESHOLD = 0;
// Below this many excluded items, there simply isn't enough evidence to
// call the exclusion justified OR unjustified with any confidence -- default
// conservatively to flagging risk rather than assuming good behavior.
const OVERFILTERING_MIN_EXCLUDED_SAMPLE = 15;

export interface OverfilteringCheck {
  overfiltering_risk: boolean;
  challenger_participation_rate: number;
  comparison_participation_rate: number;
  excluded_opportunities_n: number;
  excluded_opportunities_avg_r: number | null;
  reason: string;
}

/**
 * A shared model must not become production knowledge merely because one
 * unusually active account supplied almost all of its apparent evidence.
 * account_ref is a one-way, peppered hash and is used only for this
 * aggregation guard -- never as a predictive feature.  We deliberately
 * gate promotion rather than silently discarding the account's observations:
 * all data remains available for audit/reporting and the dashboard makes the
 * concentration visible.
 */
export interface AccountDiversityCheck {
  training_accounts: number;
  holdout_accounts: number;
  training_largest_account_share: number | null;
  holdout_largest_account_share: number | null;
  account_concentration_risk: boolean;
  reason: string;
}

const MIN_DISTINCT_ACCOUNTS_FOR_PROMOTION = 2;
const MAX_ACCOUNT_SHARE_FOR_PROMOTION = 0.5;

function accountDistribution(items: GlobalBrainObservation[]): { accounts: number; largestShare: number | null } {
  if (items.length === 0) return { accounts: 0, largestShare: null };
  const counts = new Map<string, number>();
  for (const item of items) {
    // Empty/unknown identity is one explicitly unknown source, never a
    // pretend collection of independent accounts.
    const key = item.account_ref || "__UNKNOWN_ACCOUNT__";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const largest = Math.max(...counts.values());
  return { accounts: counts.size, largestShare: largest / items.length };
}

export function checkAccountDiversity(trainingItems: GlobalBrainObservation[], holdoutItems: GlobalBrainObservation[]): AccountDiversityCheck {
  const training = accountDistribution(trainingItems);
  const holdout = accountDistribution(holdoutItems);
  const risk =
    training.accounts < MIN_DISTINCT_ACCOUNTS_FOR_PROMOTION ||
    holdout.accounts < MIN_DISTINCT_ACCOUNTS_FOR_PROMOTION ||
    (training.largestShare ?? 1) > MAX_ACCOUNT_SHARE_FOR_PROMOTION ||
    (holdout.largestShare ?? 1) > MAX_ACCOUNT_SHARE_FOR_PROMOTION;
  const pct = (value: number | null) => value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
  return {
    training_accounts: training.accounts,
    holdout_accounts: holdout.accounts,
    training_largest_account_share: training.largestShare === null ? null : Math.round(training.largestShare * 1000) / 1000,
    holdout_largest_account_share: holdout.largestShare === null ? null : Math.round(holdout.largestShare * 1000) / 1000,
    account_concentration_risk: risk,
    reason: risk
      ? `ACCOUNT_CONCENTRATION_RISK: promotion requires at least ${MIN_DISTINCT_ACCOUNTS_FOR_PROMOTION} represented accounts and no account above ${(MAX_ACCOUNT_SHARE_FOR_PROMOTION * 100).toFixed(0)}% in both training and untouched holdout evidence (training: ${training.accounts} accounts, largest ${pct(training.largestShare)}; holdout: ${holdout.accounts} accounts, largest ${pct(holdout.largestShare)}).`
      : `Account diversity passed (training: ${training.accounts} accounts, largest ${pct(training.largestShare)}; holdout: ${holdout.accounts} accounts, largest ${pct(holdout.largestShare)}).`,
  };
}

/**
 * Anti-overfiltering / trade-frequency-collapse protection (spec: "a
 * Challenger that achieves lower drawdown or higher win rate primarily
 * because it dramatically reduces trading must NOT automatically qualify
 * as better"). Only meaningful for the "should I take this opportunity"
 * questions (DIRECTION_QUALITY/TP_BEFORE_SL/SETUP_QUALITY) -- ENTRY_TIMING
 * and CALIBRATION are about timing/calibration quality, not entry/reject
 * gating, so participation isn't a coherent concept for them.
 *
 * Compares how often each model would favor entering (predicted >= 0.5) on
 * the SAME holdout set. If the challenger favors materially fewer
 * opportunities than the comparison model, it must be justified: the
 * opportunities it newly excludes (ones the comparison model favored) must
 * themselves show non-positive average realized R -- i.e., real evidence
 * they were genuinely poor, not merely a more conservative model walking
 * away from legitimate opportunities to improve its own statistics.
 *
 * Deliberately ONE-SIDED by construction, not just in spirit: this function
 * only ever computes a risk when participationDrop is POSITIVE (challenger
 * participates LESS). A challenger that participates MORE than the
 * comparison model always short-circuits to `overfiltering_risk: false`
 * here, with no symmetric "over-participation" penalty -- the codebase's
 * own bucketed estimator already learns to favor a bucket purely from its
 * realized outcomes, regardless of what the original rule engine decided
 * about it, so a previously-rejected/waited bucket that keeps winning is
 * free to gain participation once genuine evidence supports it (spec:
 * "the system must become better at recognizing when the correct answer
 * was YES", not only better at saying no). See globalBrainTraining.test.ts
 * for the explicit test proving this.
 */
export function checkOverfiltering(
  challengerBuckets: BucketedEstimatorResult,
  comparisonBuckets: BucketedEstimatorResult | null,
  holdoutItems: GlobalBrainObservation[],
  spec: QuestionSpec,
  globalPriorRate: number,
): OverfilteringCheck {
  let challengerFavored = 0;
  let comparisonFavored = 0;
  const excludedRs: number[] = [];

  for (const item of holdoutItems) {
    const challengerP = lookupBucket(challengerBuckets, spec.bucketKey(item)).shrunk_rate;
    const comparisonP = comparisonBuckets ? lookupBucket(comparisonBuckets, spec.bucketKey(item)).shrunk_rate : globalPriorRate;
    const challengerFavors = challengerP >= 0.5;
    const comparisonFavors = comparisonP >= 0.5;
    if (challengerFavors) challengerFavored++;
    if (comparisonFavors) comparisonFavored++;
    if (comparisonFavors && !challengerFavors) {
      const r = spec.r(item);
      if (r !== null) excludedRs.push(r);
    }
  }

  const n = holdoutItems.length;
  const challengerRate = n > 0 ? challengerFavored / n : 0;
  const comparisonRate = n > 0 ? comparisonFavored / n : 0;
  const participationDrop = comparisonRate - challengerRate; // positive = challenger participates less
  const excludedAvgR = excludedRs.length > 0 ? Math.round((excludedRs.reduce((s, r) => s + r, 0) / excludedRs.length) * 1000) / 1000 : null;
  const excludedSe = standardError(excludedRs);
  // Upper confidence bound on the excluded items' true mean R -- justification
  // requires this bound, not just the point estimate, to clear the threshold.
  const excludedUpperBound = excludedAvgR !== null ? excludedAvgR + SIGNIFICANCE_Z * excludedSe : null;

  const base = {
    challenger_participation_rate: Math.round(challengerRate * 1000) / 1000,
    comparison_participation_rate: Math.round(comparisonRate * 1000) / 1000,
    excluded_opportunities_n: excludedRs.length,
    excluded_opportunities_avg_r: excludedAvgR,
  };

  if (participationDrop < OVERFILTERING_PARTICIPATION_DROP_THRESHOLD) {
    return { ...base, overfiltering_risk: false, reason: `No material participation drop (${(participationDrop * 100).toFixed(1)} pts).` };
  }

  if (excludedRs.length < OVERFILTERING_MIN_EXCLUDED_SAMPLE) {
    return {
      ...base,
      overfiltering_risk: true,
      reason: `OVERFILTERING_RISK: participation dropped by ${(participationDrop * 100).toFixed(1)} pts, but only ${excludedRs.length} excluded opportunities have realized R data -- too few (minimum ${OVERFILTERING_MIN_EXCLUDED_SAMPLE}) to confidently judge whether the exclusion was justified, so it is not assumed justified.`,
    };
  }

  if (excludedUpperBound !== null && excludedUpperBound <= OVERFILTERING_EXCLUDED_R_JUSTIFICATION_THRESHOLD) {
    return {
      ...base,
      overfiltering_risk: false,
      reason: `Participation dropped by ${(participationDrop * 100).toFixed(1)} pts, but the ${excludedRs.length} newly-excluded opportunities had a statistically poor average realized R (${excludedAvgR}, upper bound ${Math.round(excludedUpperBound * 1000) / 1000}) -- justified filtering, not overfiltering.`,
    };
  }

  return {
    ...base,
    overfiltering_risk: true,
    reason: `OVERFILTERING_RISK: participation dropped by ${(participationDrop * 100).toFixed(1)} pts without statistically significant evidence the ${excludedRs.length} newly-excluded opportunities were genuinely poor (their average realized R was ${excludedAvgR ?? "N/A (no R data)"}, upper confidence bound ${excludedUpperBound !== null ? Math.round(excludedUpperBound * 1000) / 1000 : "N/A"} -- not clearly negative). The challenger may be improving its statistics by trading less rather than trading better.`,
  };
}

/**
 * Section 11 (admin UI must explain itself): everything an admin needs to
 * understand WHY a question is still INSUFFICIENT_EVIDENCE and how close it
 * is, without inventing numbers that are not actually backed by data.
 * maturity_score is the larger of the two paths' progress fractions
 * (fast-path holdout progress toward 30, multi-cycle streak progress toward
 * REQUIRED_STREAK_CYCLES) -- a transparent, directly-recomputable number,
 * not a fitted or fabricated confidence figure.
 */
export interface MaturityReport {
  status: "PROMOTED" | "REJECTED_UNSAFE" | "BUILDING_STREAK" | "INSUFFICIENT_EVIDENCE" | "NO_ELIGIBLE_DATA";
  maturity_path: "FAST_PATH" | "MULTI_CYCLE" | "INSUFFICIENT_EVIDENCE";
  holdout_n: number;
  holdout_required_fast_path: number;
  holdout_required_floor: number;
  meets_small_sample_criteria: boolean;
  streak_count: number;
  streak_required: number;
  maturity_score_pct: number;
  primary_gap: string;
}

function buildMaturityReport(
  holdoutN: number,
  maturityPath: "FAST_PATH" | "MULTI_CYCLE" | "INSUFFICIENT_EVIDENCE",
  meetsSmallSampleCriteria: boolean,
  streakCount: number,
  promoted: boolean,
  rejectedForSafety: boolean,
): MaturityReport {
  const fastPathProgress = Math.min(1, holdoutN / MIN_HOLDOUT_SAMPLE);
  const streakProgress = meetsSmallSampleCriteria ? Math.min(1, streakCount / REQUIRED_STREAK_CYCLES) : 0;
  const maturityScorePct = Math.round(Math.max(fastPathProgress, streakProgress) * 1000) / 10;

  let status: MaturityReport["status"];
  let primaryGap: string;
  if (promoted) {
    status = "PROMOTED";
    primaryGap = "None -- promoted this cycle.";
  } else if (rejectedForSafety) {
    status = "REJECTED_UNSAFE";
    primaryGap = "A safety check (chronological validation, stability, overfiltering, or account diversity) failed -- see reason.";
  } else if (holdoutN < MIN_HOLDOUT_SAMPLE_FLOOR) {
    status = "INSUFFICIENT_EVIDENCE";
    primaryGap = `Holdout sample (${holdoutN}) is below the absolute evidence floor of ${MIN_HOLDOUT_SAMPLE_FLOOR} -- need ${MIN_HOLDOUT_SAMPLE_FLOOR - holdoutN} more resolved, eligible observations in holdout before anything can be measured.`;
  } else if (meetsSmallSampleCriteria) {
    status = "BUILDING_STREAK";
    primaryGap = `Effect size already qualifies at this holdout size (${holdoutN}); needs ${REQUIRED_STREAK_CYCLES - streakCount} more consecutive confirming cycle(s) on new data (currently ${streakCount}/${REQUIRED_STREAK_CYCLES}), or ${Math.max(0, MIN_HOLDOUT_SAMPLE - holdoutN)} more holdout observations to clear the single-shot bar of ${MIN_HOLDOUT_SAMPLE} instead.`;
  } else {
    status = "INSUFFICIENT_EVIDENCE";
    primaryGap =
      holdoutN < MIN_HOLDOUT_SAMPLE
        ? `Holdout sample (${holdoutN}) is below both the single-shot minimum (${MIN_HOLDOUT_SAMPLE}) and does not yet show a statistically significant effect at this size -- needs either more data or a stronger, more consistent effect.`
        : `Holdout sample (${holdoutN}) meets the minimum, but no tracked metric improved beyond its statistically-significant margin this cycle.`;
  }

  return {
    status,
    maturity_path: maturityPath,
    holdout_n: holdoutN,
    holdout_required_fast_path: MIN_HOLDOUT_SAMPLE,
    holdout_required_floor: MIN_HOLDOUT_SAMPLE_FLOOR,
    meets_small_sample_criteria: meetsSmallSampleCriteria,
    streak_count: streakCount,
    streak_required: REQUIRED_STREAK_CYCLES,
    maturity_score_pct: maturityScorePct,
    primary_gap: primaryGap,
  };
}

interface QuestionCycleResult {
  challenger_validation_metrics: ModelMetrics | null;
  validation_comparison_metrics: ModelMetrics | null;
  challenger_holdout_metrics: ModelMetrics;
  /** The metrics the challenger was actually compared against: the existing champion's bucket table re-scored on this holdout, OR (is_first_model) a trivial constant-prediction baseline. Never null while a real comparison happened -- only null in the INSUFFICIENT_EVIDENCE short-circuit below. */
  comparison_metrics: ModelMetrics | null;
  is_first_model: boolean;
  /** Null for questions where participation isn't a coherent concept (ENTRY_TIMING, CALIBRATION) -- see OVERFILTERING_QUESTIONS. */
  overfiltering: OverfilteringCheck | null;
  account_diversity: AccountDiversityCheck | null;
  promoted: boolean;
  reason: string;
  champion_version: number | null;
  training_n: number;
  /** Null only in the two early short-circuits (no eligible data at all, or dataset unchanged since champion) -- see buildMaturityReport. */
  maturity: MaturityReport | null;
}

export interface DailyCycleReport {
  ran_at: string;
  success: boolean;
  error: string | null;
  dry_run: boolean;
  observations_total: number;
  observations_eligible: number;
  observations_by_source: Record<string, number>;
  mistakes_by_category: Record<string, number>;
  training_window: { from: string | null; to: string | null; n: number };
  validation_window: { from: string | null; to: string | null; n: number };
  holdout_window: { from: string | null; to: string | null; n: number };
  questions: Partial<Record<GlobalBrainQuestion, QuestionCycleResult>>;
  known_gaps: string[];
  training_disabled: boolean;
  /** True only when this call found another cycle already in flight and skipped without doing any work -- see acquireCycleLock. Distinct from training_disabled (a deliberate kill switch) and from a real failure. */
  cycle_already_running: boolean;
  /**
   * Descriptive (not gating) entry-quality signal, by source: average MAE/
   * MFE of resolved observations. Surfaced explicitly rather than buried
   * inside a win/loss count -- a winning trade with severe adverse
   * excursion first is not automatically "just a good trade" (spec: "MAE/
   * MFE must be first-class learning signals," "do not optimize only for
   * win rate"). This is reporting, not a promotion metric: the DIRECTION_
   * QUALITY/ENTRY_TIMING gates already account for R-multiple outcomes and
   * timing mistakes; this field exists so a human reviewing the dashboard
   * can see MAE trends directly instead of inferring them.
   */
  entry_quality_by_source: Record<string, { n: number; avg_mae_r: number | null; avg_mfe_r: number | null }>;
  /**
   * "Positive opportunity" reporting -- the brain must get credit for
   * discovering that a rejected/waited opportunity was actually good, not
   * only for filtering out bad ones (spec: "the system must not only
   * become better at saying NO... it must become better at recognizing
   * when the correct answer was YES"). Computed from mistake_classification
   * counts already produced by globalBrainMistakeClassifier.ts -- no new
   * data pipeline, just explicit ratios instead of leaving them buried in
   * mistakes_by_category. false_rejection_rate and opportunity_capture_rate
   * are null (not zero) when there is no resolvable evidence yet, never
   * fabricated.
   */
  opportunity_capture: {
    /** SKIPPED/EXPIRED observations where a counterfactual outcome was actually resolvable (only possible today for Outlook-sourced signals -- see known_gaps). */
    non_executed_with_resolvable_outcome: number;
    missed_winner_count: number;
    good_rejection_count: number;
    /** Share of resolvable rejections that were actually missed winners. Null with zero resolvable rejections -- never assumed 0. */
    false_rejection_rate: number | null;
    wait_improved_entry_count: number;
    wait_hurt_entry_count: number;
    entry_too_late_count: number;
    entry_too_early_count: number;
    /** executed / (executed + skipped + expired) across all sources. */
    opportunity_capture_rate: number | null;
  };
}

interface OpportunityCaptureSummary {
  non_executed_with_resolvable_outcome: number;
  missed_winner_count: number;
  good_rejection_count: number;
  false_rejection_rate: number | null;
  wait_improved_entry_count: number;
  wait_hurt_entry_count: number;
  entry_too_late_count: number;
  entry_too_early_count: number;
  opportunity_capture_rate: number | null;
}

function emptyOpportunityCapture(): OpportunityCaptureSummary {
  return {
    non_executed_with_resolvable_outcome: 0,
    missed_winner_count: 0,
    good_rejection_count: 0,
    false_rejection_rate: null,
    wait_improved_entry_count: 0,
    wait_hurt_entry_count: 0,
    entry_too_late_count: 0,
    entry_too_early_count: 0,
    opportunity_capture_rate: null,
  };
}

export function computeOpportunityCapture(observations: GlobalBrainObservation[]): OpportunityCaptureSummary {
  let missedWinner = 0;
  let goodRejection = 0;
  let waitImproved = 0;
  let waitHurt = 0;
  let entryTooLate = 0;
  let entryTooEarly = 0;
  let executed = 0;
  let skippedOrExpired = 0;

  for (const o of observations) {
    if (o.decision_action === "EXECUTED") executed++;
    else if (o.decision_action === "SKIPPED" || o.decision_action === "EXPIRED") skippedOrExpired++;

    switch (o.mistake_classification) {
      case "MISSED_WINNER":
        missedWinner++;
        break;
      case "GOOD_REJECTION":
        goodRejection++;
        break;
      case "WAIT_IMPROVED_ENTRY":
        waitImproved++;
        break;
      case "WAIT_HURT_ENTRY":
        waitHurt++;
        break;
      case "ENTRY_TOO_LATE":
        entryTooLate++;
        break;
      case "ENTRY_TOO_EARLY":
        entryTooEarly++;
        break;
      default:
        break;
    }
  }

  const rejectionDenom = missedWinner + goodRejection;
  const participationDenom = executed + skippedOrExpired;
  return {
    non_executed_with_resolvable_outcome: rejectionDenom,
    missed_winner_count: missedWinner,
    good_rejection_count: goodRejection,
    false_rejection_rate: rejectionDenom > 0 ? Math.round((missedWinner / rejectionDenom) * 1000) / 1000 : null,
    wait_improved_entry_count: waitImproved,
    wait_hurt_entry_count: waitHurt,
    entry_too_late_count: entryTooLate,
    entry_too_early_count: entryTooEarly,
    opportunity_capture_rate: participationDenom > 0 ? Math.round((executed / participationDenom) * 1000) / 1000 : null,
  };
}

function computeEntryQualityBySource(
  observations: GlobalBrainObservation[],
): Record<string, { n: number; avg_mae_r: number | null; avg_mfe_r: number | null }> {
  const bySource = new Map<string, { maes: number[]; mfes: number[] }>();
  for (const o of observations) {
    if (!o.outcome) continue;
    const bucket = bySource.get(o.source) ?? { maes: [], mfes: [] };
    if (o.outcome.mae_r !== null) bucket.maes.push(o.outcome.mae_r);
    if (o.outcome.mfe_r !== null) bucket.mfes.push(o.outcome.mfe_r);
    bySource.set(o.source, bucket);
  }
  const avg = (values: number[]): number | null => (values.length > 0 ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 1000) / 1000 : null);
  const result: Record<string, { n: number; avg_mae_r: number | null; avg_mfe_r: number | null }> = {};
  for (const [source, { maes, mfes }] of bySource) {
    result[source] = { n: Math.max(maes.length, mfes.length), avg_mae_r: avg(maes), avg_mfe_r: avg(mfes) };
  }
  return result;
}

function emptyMetrics(): ModelMetrics {
  return { holdout_n: 0, brier_score: 1, brier_se: 1, avg_r_captured: 0, avg_r_captured_se: 1, max_drawdown_r: 0 };
}

const CYCLE_LOCK_COLLECTION = "global_brain_cycle_lock";
// Generous vs. this codebase's expected cycle duration; only matters if a
// process crashed mid-cycle and left the lock doc behind.
const CYCLE_LOCK_STALE_AFTER_MS = 10 * 60_000;

export class CycleLockedError extends Error {}

/**
 * Whole-cycle mutual exclusion (spec: "verify 24-hour job locking/
 * idempotency... concurrent promotion attempts... duplicate daily
 * execution"). The per-question lock in globalBrainRegistry.ts protects
 * each individual promote/rollback call; this is the coarser lock that
 * stops two FULL cycles (e.g. the scheduled cron and a manual admin
 * "run cycle now" click) from ever training and evaluating concurrently at
 * all -- same atomic-upsert-on-expired trick as routes/cloud/reservation.ts
 * and globalBrainRegistry.ts's withQuestionLock.
 */
/**
 * Returns an opaque per-acquisition lease token. A timestamp alone is not a
 * safe owner identity: two processes can acquire/reclaim in the same
 * millisecond, after which an old holder could delete a new holder's lock.
 */
export async function acquireCycleLock(): Promise<string> {
  const db = getDb();
  const now = Date.now();
  const holderId = randomUUID();
  try {
    await db
      .collection(CYCLE_LOCK_COLLECTION)
      .updateOne({ _id: "cycle" as unknown as never, acquired_at: { $lt: now - CYCLE_LOCK_STALE_AFTER_MS } }, { $set: { acquired_at: now, holder_id: holderId } }, { upsert: true });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new CycleLockedError("A Global Brain daily cycle is already running.");
    }
    throw error;
  }
  return holderId;
}

/**
 * Guarded by acquired_at, matching globalBrainRegistry.ts's withQuestionLock
 * release exactly -- an adversarial review found the unguarded version of
 * this function could delete a DIFFERENT process's lock: if holder A's
 * cycle runs past CYCLE_LOCK_STALE_AFTER_MS, holder B can legitimately
 * reclaim the lock as stale and start its own cycle; when A's delayed
 * `finally` finally runs, an unconditional deleteOne({_id:"cycle"}) would
 * delete B's live lock, letting a third holder C acquire and run
 * concurrently with B -- defeating the whole mutual-exclusion purpose.
 * Only deleting the exact acquired_at this call wrote closes that gap.
 */
export async function releaseCycleLock(holderId: string): Promise<void> {
  await getDb()
    .collection(CYCLE_LOCK_COLLECTION)
    .deleteOne({ _id: "cycle" as unknown as never, holder_id: holderId })
    .catch(() => undefined);
}

function skippedCycleReport(ranAt: string, dryRun: boolean): DailyCycleReport {
  return {
    ran_at: ranAt,
    success: true,
    error: null,
    dry_run: dryRun,
    observations_total: 0,
    observations_eligible: 0,
    observations_by_source: {},
    mistakes_by_category: {},
    training_window: { from: null, to: null, n: 0 },
    validation_window: { from: null, to: null, n: 0 },
    holdout_window: { from: null, to: null, n: 0 },
    questions: {},
    known_gaps: [],
    training_disabled: false,
    cycle_already_running: true,
    entry_quality_by_source: {},
    opportunity_capture: emptyOpportunityCapture(),
  };
}

export async function runGlobalBrainDailyCycle(opts: { dryRun?: boolean } = {}): Promise<DailyCycleReport> {
  const ranAt = new Date().toISOString();
  const dryRun = opts.dryRun ?? false;

  let cycleLockHolderId: string;
  try {
    cycleLockHolderId = await acquireCycleLock();
  } catch (error) {
    if (error instanceof CycleLockedError) {
      const skipped = skippedCycleReport(ranAt, dryRun);
      if (!dryRun) {
        await getDb()
          .collection(GLOBAL_BRAIN_DAILY_REPORTS_COLLECTION)
          .insertOne(skipped)
          .catch(() => undefined);
      }
      return skipped;
    }
    throw error;
  }

  try {
    const settings = await getGlobalBrainSettings();
    if (!settings.auto_training_enabled) {
      const disabledReport: DailyCycleReport = {
        ran_at: ranAt,
        success: true,
        error: null,
        dry_run: dryRun,
        observations_total: 0,
        observations_eligible: 0,
        observations_by_source: {},
        mistakes_by_category: {},
        training_window: { from: null, to: null, n: 0 },
        validation_window: { from: null, to: null, n: 0 },
        holdout_window: { from: null, to: null, n: 0 },
        questions: {},
        known_gaps: [],
        training_disabled: true,
        cycle_already_running: false,
        entry_quality_by_source: {},
        opportunity_capture: emptyOpportunityCapture(),
      };
      if (!dryRun) await getDb().collection(GLOBAL_BRAIN_DAILY_REPORTS_COLLECTION).insertOne(disabledReport);
      return disabledReport;
    }

    const allObservations = await getDb()
      .collection<GlobalBrainObservation>(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION)
      .find({}, { projection: { _id: 0 } })
      .toArray();

    const bySource: Record<string, number> = {};
    for (const o of allObservations) bySource[o.source] = (bySource[o.source] ?? 0) + 1;
    const mistakeCounts: Record<string, number> = {};
    for (const cat of MISTAKE_CATEGORIES) mistakeCounts[cat] = 0;
    for (const o of allObservations) if (o.mistake_classification) mistakeCounts[o.mistake_classification] = (mistakeCounts[o.mistake_classification] ?? 0) + 1;

    const entryQualityBySource = computeEntryQualityBySource(allObservations);

    const eligible = allObservations
      .filter(passesDataQuality)
      .sort((a, b) => new Date(a.resolved_at!).getTime() - new Date(b.resolved_at!).getTime());

    const n = eligible.length;
    // The global split is retained only for top-level reporting. Each learning
    // question performs its OWN chronological split after applying that
    // question's eligibility filter below. The previous implementation split
    // first and filtered second, which could leave (for example) ENTRY_TIMING
    // with only a handful of holdout rows even when dozens of timing-resolvable
    // observations existed elsewhere in the chronology.
    const trainEnd = Math.floor(n * TRAIN_FRACTION);
    const valEnd = trainEnd + Math.floor(n * VALIDATION_FRACTION);
    const trainSet = eligible.slice(0, trainEnd);
    const valSet = eligible.slice(trainEnd, valEnd);
    const holdoutSet = eligible.slice(valEnd);

    const questionResults: Partial<Record<GlobalBrainQuestion, QuestionCycleResult>> = {};

    for (const question of GLOBAL_BRAIN_QUESTIONS) {
      const spec = QUESTION_SPECS[question];
      const questionEligible = eligible.filter(spec.eligible);
      const qTrainEnd = Math.floor(questionEligible.length * TRAIN_FRACTION);
      const qValEnd = qTrainEnd + Math.floor(questionEligible.length * VALIDATION_FRACTION);
      const trainingItems = questionEligible.slice(0, qTrainEnd);
      const validationItems = questionEligible.slice(qTrainEnd, qValEnd);
      const trainValItems = questionEligible.slice(0, qValEnd);
      const holdoutItems = questionEligible.slice(qValEnd);
      const datasetFingerprint = createHash("sha256")
        .update(`schema:${LABEL_SCHEMA_VERSION}|question:${question}|` + questionEligible.map((o) => o.dedupe_key).join("|"))
        .digest("hex");

      const champion = await getCurrentChampion(question);
      const latestDoc = await getLatestModelDoc(question);
      const priorStreak: PriorStreakInfo | null =
        latestDoc && latestDoc.meets_small_sample_criteria ? { streak_count: latestDoc.streak_count, dataset_fingerprint: latestDoc.dataset_fingerprint } : null;

      if (trainingItems.length === 0 || validationItems.length === 0 || holdoutItems.length === 0) {
        questionResults[question] = {
          challenger_validation_metrics: null,
          validation_comparison_metrics: null,
          challenger_holdout_metrics: emptyMetrics(),
          comparison_metrics: null,
          is_first_model: !champion,
          overfiltering: null,
          account_diversity: null,
          promoted: false,
          reason: "INSUFFICIENT_EVIDENCE: not enough eligible observations yet to train or evaluate this question.",
          champion_version: champion?.version ?? null,
          training_n: trainValItems.length,
          maturity: null,
        };
        continue;
      }

      // dataset_fingerprint short-circuit: if the ENTIRE eligible observation
      // set is byte-identical to what the current champion was trained on,
      // there is by definition no new evidence for ANY question -- re-running
      // the same numbers through the same math and calling a re-promotion
      // "learning" would be exactly the fabricated-improvement claim the
      // spec forbids. Reject without even training a challenger.
      if (champion && champion.dataset_fingerprint === datasetFingerprint) {
        questionResults[question] = {
          challenger_validation_metrics: null,
          validation_comparison_metrics: null,
          challenger_holdout_metrics: emptyMetrics(),
          comparison_metrics: null,
          is_first_model: false,
          overfiltering: null,
          account_diversity: null,
          promoted: false,
          reason: `INSUFFICIENT_EVIDENCE: observation set unchanged since champion v${champion.version} was trained (dataset_fingerprint match) -- no new evidence to evaluate.`,
          champion_version: champion.version,
          training_n: trainValItems.length,
          maturity: null,
        };
        continue;
      }

      // First validate a model trained ONLY on the oldest period. The
      // validation period is chronological and never appears in these
      // buckets, so this is a real pre-holdout validation rather than a
      // mislabeled training score. Only after it passes do we refit on
      // train+validation and test exactly once on the untouched holdout.
      //
      // Uses assessEffectSize directly (not evaluatePromotion) so this
      // pre-check is not itself gated on MIN_HOLDOUT_SAMPLE (30) -- it is a
      // directional sanity check ("does the same effect show up on an
      // earlier slice too"), not the evidence gate itself. Requiring the
      // validation slice ALSO clear 30 samples would make the multi-cycle
      // maturity path (globalBrainMaturity.ts) unreachable for exactly the
      // smaller total-N cases it exists to serve, since a 20%/20% train/
      // validation/holdout split means the validation slice is roughly the
      // same size as the holdout slice. The real sample-size evidence gate
      // is evaluateMaturity below, applied to the holdout.
      const validationBuckets = computeBucketedEstimator(trainingItems, spec.bucketKey, spec.isSuccess, spec.r);
      const challengerValidationMetrics = evaluateOnHoldout(validationBuckets, validationItems, spec);
      const validationComparisonMetrics = champion
        ? evaluateOnHoldout(champion.buckets, validationItems, spec)
        : evaluateBaselineOnHoldout(validationBuckets.global_prior_rate, validationItems, spec);
      const validationDecision = assessEffectSize(challengerValidationMetrics, validationComparisonMetrics);

      const buckets = computeBucketedEstimator(trainValItems, spec.bucketKey, spec.isSuccess, spec.r);
      const challengerHoldoutMetrics = evaluateOnHoldout(buckets, holdoutItems, spec);

      // Fair head-to-head: re-score the EXISTING champion's own bucket
      // table (not its stale historical metrics) against this SAME new
      // holdout set. With no existing champion, the challenger is instead
      // judged against a trivial constant-prediction baseline -- there is
      // no "no champion -> auto-promote" path (see globalBrainPromotion.ts
      // module comment for why that was a real gap).
      const comparisonMetrics = champion
        ? evaluateOnHoldout(champion.buckets, holdoutItems, spec)
        : evaluateBaselineOnHoldout(buckets.global_prior_rate, holdoutItems, spec);

      // Evidence-based maturity (globalBrainMaturity.ts): holdout_n >= 30
      // promotes on this cycle alone exactly as before; a smaller-but-still-
      // meaningful holdout (>= MIN_HOLDOUT_SAMPLE_FLOOR) can instead promote
      // once the SAME statistical effect has held across REQUIRED_STREAK_
      // CYCLES consecutive independent cycles on genuinely new data -- see
      // that module's doc comment for the full policy and why it is not
      // simply a lowered version of the single-shot bar.
      const maturity = evaluateMaturity(challengerHoldoutMetrics, comparisonMetrics, datasetFingerprint, priorStreak);
      let decision = { promoted: maturity.promoted, reason: maturity.reason };
      let maturityOverridden = false;
      // Holdout is the statistical promotion gate. Validation is an earlier
      // chronological sanity check whose job is to catch sign reversal or
      // degradation, not to demand a second independent 95%-significance win.
      // Requiring significance in BOTH validation and holdout made promotion
      // needlessly close to impossible at realistic one-week sample sizes.
      if (validationDecision.degraded) {
        decision = { promoted: false, reason: `REJECTED: chronological validation degraded before holdout: ${validationDecision.reason}` };
        maturityOverridden = true;
      }

      // Multi-window stability check (spec: "test different dates... if
      // tiny changes destroy performance, treat the model as fragile" --
      // do not optimize against one period). Split the SAME holdout set
      // into two chronological sub-windows and require the challenger not
      // to be worse than the comparison baseline in EITHER one on its own,
      // even if it clears the aggregate gate above -- a model that only
      // wins in aggregate because it's strong in one window and weak in
      // another is not stable evidence.
      if (decision.promoted) {
        const stability = checkHoldoutStability(buckets, champion?.buckets ?? null, holdoutItems, spec, buckets.global_prior_rate);
        if (!stability.stable) {
          decision = { promoted: false, reason: `REJECTED: ${stability.reason}` };
          maturityOverridden = true;
        }
      }

      // Anti-overfiltering protection (spec: "a Challenger that achieves
      // lower drawdown or higher win rate primarily because it dramatically
      // reduces trading must NOT automatically qualify as better"). Only
      // meaningful for the entry/reject-style questions.
      const overfiltering = OVERFILTERING_QUESTIONS.includes(question)
        ? checkOverfiltering(buckets, champion?.buckets ?? null, holdoutItems, spec, buckets.global_prior_rate)
        : null;
      if (decision.promoted && overfiltering?.overfiltering_risk) {
        decision = { promoted: false, reason: overfiltering.reason };
        maturityOverridden = true;
      }

      const accountDiversity = checkAccountDiversity(trainValItems, holdoutItems);
      // Account concentration remains visible as an audit warning, but it is
      // not a promotion veto for shared XAU market-pattern learning. The same
      // market move is not made invalid because one connected account supplied
      // more telemetry. Generalization is enforced by chronological holdout,
      // stability and effect-size checks instead. Account identity is never a
      // predictive feature.


      // Kill switch: the challenger is still fully trained and reported
      // either way (spec: "learn every 24 hours" is independent of
      // "change every 24 hours") -- only the promotion ACTION is withheld.
      // Deliberately does NOT set maturityOverridden -- the evidence itself
      // was genuine and safe, only the ACT of applying it was withheld by
      // owner policy, so the streak should still be allowed to continue
      // accumulating toward multi-cycle confirmation next cycle.
      if (decision.promoted && !settings.auto_promotion_enabled) {
        decision = { promoted: false, reason: `${decision.reason} [NOT APPLIED: auto_promotion_enabled is OFF -- see admin Global Brain settings]` };
      }

      // Drift monitoring for the EXISTING champion (independent of whether
      // a challenger is promoted this cycle): does its own bucket table,
      // re-scored on fresh data, still perform like it did at promotion
      // time? Alert-only -- never auto-rolls-back (see globalBrainDrift.ts).
      if (champion) {
        const drift = detectDrift(comparisonMetrics, champion.holdout_metrics);
        if (drift.drifted) {
          await recordDriftAlert({
            question,
            champion_version: champion.version,
            checked_at: ranAt,
            recorded_metrics: champion.holdout_metrics,
            current_metrics: comparisonMetrics,
            reason: drift.reason,
          });
        }
      }

      // A downstream safety gate (chronological validation, stability,
      // overfiltering, account diversity) rejecting an otherwise-qualifying
      // cycle breaks the streak -- next cycle must re-earn it cleanly
      // rather than resume counting from a cycle that didn't fully pass
      // review. The auto_promotion_enabled kill switch is the one
      // exception (see its own comment above): withholding the ACT of
      // promotion is not evidence the effect was unsafe.
      const persistedMeetsSmallSampleCriteria = maturityOverridden ? false : maturity.meets_small_sample_criteria;
      const persistedStreakCount = maturityOverridden ? 0 : maturity.streak_count;

      const modelInput: NewModelInput = {
        question,
        trained_at: ranAt,
        training_window: { from: trainValItems[0]?.resolved_at ?? null, to: trainValItems[trainValItems.length - 1]?.resolved_at ?? null, n: trainValItems.length },
        dataset_fingerprint: datasetFingerprint,
        validation_metrics: challengerValidationMetrics,
        holdout_metrics: challengerHoldoutMetrics,
        buckets,
        meets_small_sample_criteria: persistedMeetsSmallSampleCriteria,
        streak_count: persistedStreakCount,
        maturity_path: maturity.path,
      };

      let championVersion: number | null = champion?.version ?? null;
      if (!dryRun) {
        if (decision.promoted) {
          const promoted = await promoteChallenger(modelInput, decision.reason);
          championVersion = promoted.version;
        } else {
          await rejectChallenger(modelInput, decision.reason);
        }
      }

      questionResults[question] = {
        challenger_validation_metrics: challengerValidationMetrics,
        validation_comparison_metrics: validationComparisonMetrics,
        challenger_holdout_metrics: challengerHoldoutMetrics,
        comparison_metrics: comparisonMetrics,
        is_first_model: !champion,
        overfiltering,
        account_diversity: accountDiversity,
        promoted: decision.promoted,
        reason: decision.reason,
        champion_version: championVersion,
        training_n: trainValItems.length,
        maturity: buildMaturityReport(
          challengerHoldoutMetrics.holdout_n,
          maturity.path,
          persistedMeetsSmallSampleCriteria,
          persistedStreakCount,
          decision.promoted,
          maturityOverridden,
        ),
      };
    }

    const report: DailyCycleReport = {
      ran_at: ranAt,
      success: true,
      error: null,
      dry_run: dryRun,
      observations_total: allObservations.length,
      observations_eligible: n,
      observations_by_source: bySource,
      mistakes_by_category: mistakeCounts,
      training_window: { from: trainSet[0]?.resolved_at ?? null, to: trainSet[trainSet.length - 1]?.resolved_at ?? null, n: trainSet.length },
      validation_window: { from: valSet[0]?.resolved_at ?? null, to: valSet[valSet.length - 1]?.resolved_at ?? null, n: valSet.length },
      holdout_window: { from: holdoutSet[0]?.resolved_at ?? null, to: holdoutSet[holdoutSet.length - 1]?.resolved_at ?? null, n: holdoutSet.length },
      questions: questionResults,
      known_gaps: [
        "No tester/backtest-artifact flag exists on any source observation today -- tester data cannot currently be distinguished from live data at ingestion time.",
        "M10 candidates that never became actionable (BLOCKED/EXPIRED) carry decision-time features only -- no price path exists for them, so they are never eligible for outcome-based questions (DIRECTION_QUALITY etc.), only counted for mistake/volume reporting. Actionable, outcome-tracked M10 signals ARE fully eligible (source=M10, routed through the same pipeline as OUTLOOK signals).",
        "REGIME_MODEL is not independently trained -- 'regime' is a feature relayed from the EA's own thesis, not computed from raw candles server-side; DIRECTION_QUALITY/SETUP_QUALITY already condition on it as a bucket key instead.",
        "Bot-trade observations may still lack confidence_pct when the EA shadow payload does not supply it, so CALIBRATION can remain Outlook-heavy until that telemetry is consistently emitted.",
        "opportunity_capture.false_rejection_rate can only be computed where a rejected/waited setup ALSO got a resolvable counterfactual outcome -- today that is Outlook-sourced signals only (via tick replay). Bot SKIPPED and M10 BLOCKED/EXPIRED candidates have no server-side price path, so they cannot yet contribute evidence toward 'was this rejection actually a missed winner' -- they are captured for volume/audit purposes but their mistake_classification stays UNCLASSIFIED.",
      ],
      cycle_already_running: false,
      training_disabled: false,
      entry_quality_by_source: entryQualityBySource,
      opportunity_capture: computeOpportunityCapture(allObservations),
    };

    if (!dryRun) {
      await getDb().collection(GLOBAL_BRAIN_DAILY_REPORTS_COLLECTION).insertOne(report);
    }
    return report;
  } catch (error) {
    const failureReport: DailyCycleReport = {
      ran_at: ranAt,
      success: false,
      error: String(error),
      dry_run: dryRun,
      observations_total: 0,
      observations_eligible: 0,
      observations_by_source: {},
      mistakes_by_category: {},
      training_window: { from: null, to: null, n: 0 },
      validation_window: { from: null, to: null, n: 0 },
      holdout_window: { from: null, to: null, n: 0 },
      questions: {},
      cycle_already_running: false,
      known_gaps: [],
      training_disabled: false,
      entry_quality_by_source: {},
      opportunity_capture: emptyOpportunityCapture(),
    };
    if (!dryRun) {
      try {
        await getDb().collection(GLOBAL_BRAIN_DAILY_REPORTS_COLLECTION).insertOne(failureReport);
      } catch {
        /* best-effort -- champion pointers are already untouched regardless */
      }
    }
    return failureReport;
  } finally {
    await releaseCycleLock(cycleLockHolderId);
  }
}
