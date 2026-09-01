/**
 * Generic bucketed win-rate/expectancy estimator with Beta-Binomial
 * shrinkage toward a global prior. This is the "model" implementation for
 * every one of the spec's named questions (direction quality, TP-before-SL,
 * setup quality, calibration) -- deliberately a transparent statistical
 * estimator, not an opaque trained model, because that is what the
 * codebase's own existing learning memory already is (hive_signatures'
 * GetHiveVerdict is exact/rollup win-rate counting; see routes/ml.ts). This
 * generalizes that same idea to be global (cross-account) and to carry
 * calibrated uncertainty via shrinkage, rather than inventing a new kind of
 * model this codebase has no precedent for and this session cannot
 * honestly validate as "learned" in one sitting.
 *
 * Reported PASS/FAIL in the final summary calls these "statistical
 * estimators (bucketed win-rate/expectancy with Beta shrinkage)", never
 * "neural network" or "trained model" -- do not let that framing drift.
 */

export interface BucketStats {
  bucket_key: string;
  n: number;
  successes: number;
  raw_rate: number;
  /** Beta-Binomial posterior mean: (successes + priorMean*priorStrength) / (n + priorStrength). Pulls small buckets toward the global rate; converges to raw_rate as n grows. */
  shrunk_rate: number;
  avg_r: number | null;
  sample_sufficient: boolean;
}

export interface BucketedEstimatorResult {
  global_prior_rate: number;
  global_n: number;
  buckets: BucketStats[];
}

export interface ComputeBucketedEstimatorOptions {
  minSample?: number;
  /** Pseudo-observation count the prior is weighted as; higher = more shrinkage for small buckets. */
  priorStrength?: number;
}

// A promoted model has already passed chronological out-of-sample validation.
// Requiring 20 examples AGAIN inside every exact bucket made validated knowledge
// practically unusable for weeks in a multi-dimensional XAU feature space. Eight
// observations is only the serving floor; Beta shrinkage (strength 12) still pulls
// a small bucket strongly toward the validated model's global prior, so this does
// not turn a handful of examples into high-confidence authority.
const DEFAULT_MIN_SAMPLE = 8;
const DEFAULT_PRIOR_STRENGTH = 12;

export function betaShrinkage(successes: number, n: number, priorMean: number, priorStrength: number): number {
  if (n + priorStrength <= 0) return priorMean;
  return (successes + priorMean * priorStrength) / (n + priorStrength);
}

/**
 * @param items Already-resolved, already-eligible items (caller filters out unresolved/tester/corrupted rows before calling).
 * @param bucketKeyFn Deterministic bucket key, e.g. `${direction}|${session}|${regime}|${setup_type}`.
 * @param isSuccessFn Boolean outcome for this question (e.g. "did highest_tp_reached > 0 before SL").
 * @param rFn R-multiple for this item, or null if not applicable to this question.
 */
export function computeBucketedEstimator<T>(
  items: T[],
  bucketKeyFn: (item: T) => string,
  isSuccessFn: (item: T) => boolean,
  rFn: (item: T) => number | null,
  opts: ComputeBucketedEstimatorOptions = {},
): BucketedEstimatorResult {
  const minSample = opts.minSample ?? DEFAULT_MIN_SAMPLE;
  const priorStrength = opts.priorStrength ?? DEFAULT_PRIOR_STRENGTH;

  const globalN = items.length;
  const globalSuccesses = items.filter((i) => isSuccessFn(i)).length;
  const globalPriorRate = globalN > 0 ? globalSuccesses / globalN : 0.5;

  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = bucketKeyFn(item);
    const arr = grouped.get(key) ?? [];
    arr.push(item);
    grouped.set(key, arr);
  }

  const buckets: BucketStats[] = [];
  for (const [key, bucketItems] of grouped) {
    const n = bucketItems.length;
    const successes = bucketItems.filter((i) => isSuccessFn(i)).length;
    const rValues = bucketItems.map(rFn).filter((r): r is number => r !== null);
    buckets.push({
      bucket_key: key,
      n,
      successes,
      raw_rate: n > 0 ? Math.round((successes / n) * 1000) / 1000 : 0,
      shrunk_rate: Math.round(betaShrinkage(successes, n, globalPriorRate, priorStrength) * 1000) / 1000,
      avg_r: rValues.length > 0 ? Math.round((rValues.reduce((s, r) => s + r, 0) / rValues.length) * 1000) / 1000 : null,
      sample_sufficient: n >= minSample,
    });
  }
  buckets.sort((a, b) => b.n - a.n);

  return { global_prior_rate: Math.round(globalPriorRate * 1000) / 1000, global_n: globalN, buckets };
}

/** Looks up the estimator's suggestion for one bucket key, falling back to the global prior when the bucket is unseen or below minSample -- mirrors hive/score's exact-then-rollup-then-cold-start fallback shape. */
export function lookupBucket(result: BucketedEstimatorResult, bucketKey: string): BucketStats | { bucket_key: string; n: 0; shrunk_rate: number; sample_sufficient: false } {
  const found = result.buckets.find((b) => b.bucket_key === bucketKey && b.sample_sufficient);
  if (found) return found;
  return { bucket_key: bucketKey, n: 0, shrunk_rate: result.global_prior_rate, sample_sufficient: false };
}
