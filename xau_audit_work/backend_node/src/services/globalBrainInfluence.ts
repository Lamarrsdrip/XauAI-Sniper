import { lookupBucket } from "./globalBrainEstimator.js";
import { getCurrentChampion } from "./globalBrainRegistry.js";
import { getGlobalBrainSettings, type GlobalBrainSettings } from "./globalBrainSettings.js";

/**
 * Global Learning Brain -- PRODUCTION INFLUENCE evaluator (AGENTS spec
 * sections 19-23). This is the ONLY function in the codebase that may turn
 * a validated Champion's opinion into something a live decision path
 * consults. It is deliberately narrow:
 *
 *  - Gated per-scope by the existing, already-wired
 *    {bot,m10,outlook}_learned_influence_enabled settings (see
 *    globalBrainSettings.ts) -- all three default to and remain false.
 *    When the relevant switch is off this function is a guaranteed no-op:
 *    it returns { enabled: false, applied: false, recommendation:
 *    "NO_OPINION" } WITHOUT reading the registry at all, so a caller that
 *    ignores everything except `applied` behaves identically to before
 *    this file existed.
 *  - The only decisions this may ever justify are REJECT or WAIT, applied by the
 *    caller exactly like the pre-existing owner-policy block
 *    (marketOutlookSignal.ts's evaluateOwnerPolicy) -- same shape, same
 *    "BLOCKED" outcome, same reasoning field surfaced to the customer. It
 *    NEVER invents a BUY/SELL the rule engine did not already independently
 *    produce, and never touches SL/TP/lot size/risk (spec section 19).
 *  - REJECT requires the DIRECTION_QUALITY champion's own holdout-validated,
 *    shrinkage-adjusted win rate for this EXACT bucket to be resting on
 *    sufficient sample (lookupBucket's own sample_sufficient gate, the same
 *    bar every promoted Champion bucket already had to clear) AND at/below
 *    REJECT_RATE_THRESHOLD. Anything thinner than that -- no champion, no
 *    bucket match, insufficient sample -- returns NO_OPINION, never REJECT
 *    or WAIT (spec section 7: "do not force a WAIT or REJECT").
 *  - Fails safe: any exception (missing DB, corrupt champion, etc.) is
 *    caught and returns the same NO_OPINION/not-applied default as the
 *    switch-off case (spec section 21).
 */

export type GlobalBrainInfluenceScope = "BOT" | "M10" | "OUTLOOK";
export type GlobalBrainRecommendation = "ENTER_NOW" | "WAIT" | "NO_OPINION" | "REJECT";

export interface GlobalBrainInfluenceInput {
  direction: "BUY" | "SELL";
  session: string;
  regime: string;
  setup_type: string;
}

export interface GlobalBrainInfluenceResult {
  scope: GlobalBrainInfluenceScope;
  /** Was the scope's *_learned_influence_enabled switch on for this call. */
  enabled: boolean;
  /** True only when `enabled` AND a champion with sufficient evidence for this bucket was actually consulted. */
  applied: boolean;
  recommendation: GlobalBrainRecommendation;
  reason: string;
  direction_quality_bucket: string | null;
  direction_quality_shrunk_rate: number | null;
  direction_quality_n: number;
  entry_timing_bucket?: string | null;
  entry_timing_shrunk_rate?: number | null;
  entry_timing_n?: number;
}

// A validated Champion win rate at/below this for the bucket, resting on
// sufficient sample (see lookupBucket), is required before REJECT is ever
// returned. Deliberately conservative and documented as a starting point,
// same convention as globalBrainMistakeClassifier.ts's thresholds -- this
// is infrastructure for a switch that stays OFF in production; the owner
// tunes this once there is enough shadow evidence to justify a value.
const REJECT_SHRUNK_RATE_THRESHOLD = 0.35;
// ENTRY_TIMING success means the observed entry did not exhibit a material timing mistake.
// A validated bucket at/below this rate says "do not enter immediately"; callers re-evaluate
// on the next normal decision cycle rather than inventing an entry or changing risk.
const WAIT_TIMING_RATE_THRESHOLD = 0.45;

function influenceEnabledFor(scope: GlobalBrainInfluenceScope, settings: GlobalBrainSettings): boolean {
  if (scope === "BOT") return settings.bot_learned_influence_enabled;
  if (scope === "M10") return settings.m10_learned_influence_enabled;
  return settings.outlook_learned_influence_enabled;
}

function notApplied(scope: GlobalBrainInfluenceScope, enabled: boolean, reason: string): GlobalBrainInfluenceResult {
  return {
    scope,
    enabled,
    applied: false,
    recommendation: "NO_OPINION",
    reason,
    direction_quality_bucket: null,
    direction_quality_shrunk_rate: null,
    direction_quality_n: 0,
    entry_timing_bucket: null,
    entry_timing_shrunk_rate: null,
    entry_timing_n: 0,
  };
}

export async function evaluateGlobalBrainInfluence(
  scope: GlobalBrainInfluenceScope,
  input: GlobalBrainInfluenceInput,
): Promise<GlobalBrainInfluenceResult> {
  try {
    const settings = await getGlobalBrainSettings();
    const enabled = influenceEnabledFor(scope, settings);
    if (!enabled) return notApplied(scope, false, `${scope.toLowerCase()}_learned_influence_enabled is OFF`);

    const [champion, timingChampion] = await Promise.all([
      getCurrentChampion("DIRECTION_QUALITY"),
      getCurrentChampion("ENTRY_TIMING"),
    ]);
    if (!champion) return notApplied(scope, true, "no DIRECTION_QUALITY champion has been promoted yet");

    const bucketKey = `${input.direction}|${input.regime}|${input.setup_type}`;
    const bucket = lookupBucket(champion.buckets, bucketKey);
    if (!bucket.sample_sufficient) {
      return {
        scope,
        enabled: true,
        applied: false,
        recommendation: "NO_OPINION",
        reason: `insufficient validated evidence for bucket "${bucketKey}" (n=${bucket.n}) -- deferring to the baseline strategy`,
        direction_quality_bucket: bucketKey,
        direction_quality_shrunk_rate: bucket.shrunk_rate,
        direction_quality_n: bucket.n,
        entry_timing_bucket: null,
        entry_timing_shrunk_rate: null,
        entry_timing_n: 0,
      };
    }

    if (bucket.shrunk_rate <= REJECT_SHRUNK_RATE_THRESHOLD) {
      return {
        scope,
        enabled: true,
        applied: true,
        recommendation: "REJECT",
        reason: `validated Champion win rate for "${bucketKey}" is ${(bucket.shrunk_rate * 100).toFixed(1)}% over ${bucket.n} observations, at/below the ${(REJECT_SHRUNK_RATE_THRESHOLD * 100).toFixed(0)}% reject threshold`,
        direction_quality_bucket: bucketKey,
        direction_quality_shrunk_rate: bucket.shrunk_rate,
        direction_quality_n: bucket.n,
        entry_timing_bucket: null,
        entry_timing_shrunk_rate: null,
        entry_timing_n: 0,
      };
    }

    const timingBucketKey = `${input.regime}`;
    const timingBucket = timingChampion ? lookupBucket(timingChampion.buckets, timingBucketKey) : null;
    if (timingBucket && timingBucket.sample_sufficient && timingBucket.shrunk_rate <= WAIT_TIMING_RATE_THRESHOLD) {
      return {
        scope,
        enabled: true,
        applied: true,
        recommendation: "WAIT",
        reason: `validated ENTRY_TIMING quality for regime "${timingBucketKey}" is ${(timingBucket.shrunk_rate * 100).toFixed(1)}% over ${timingBucket.n} observations -- waiting for a cleaner re-evaluation is preferred to entering immediately`,
        direction_quality_bucket: bucketKey,
        direction_quality_shrunk_rate: bucket.shrunk_rate,
        direction_quality_n: bucket.n,
        entry_timing_bucket: timingBucketKey,
        entry_timing_shrunk_rate: timingBucket.shrunk_rate,
        entry_timing_n: timingBucket.n,
      };
    }

    return {
      scope,
      enabled: true,
      applied: true,
      recommendation: "ENTER_NOW",
      reason: `validated Champion direction quality for "${bucketKey}" is ${(bucket.shrunk_rate * 100).toFixed(1)}% over ${bucket.n} observations${timingBucket && timingBucket.sample_sufficient ? `; entry-timing quality ${(timingBucket.shrunk_rate * 100).toFixed(1)}% over ${timingBucket.n}` : ""} -- no learned reject/wait signal`,
      direction_quality_bucket: bucketKey,
      direction_quality_shrunk_rate: bucket.shrunk_rate,
      direction_quality_n: bucket.n,
      entry_timing_bucket: timingBucket && timingBucket.sample_sufficient ? timingBucketKey : null,
      entry_timing_shrunk_rate: timingBucket && timingBucket.sample_sufficient ? timingBucket.shrunk_rate : null,
      entry_timing_n: timingBucket && timingBucket.sample_sufficient ? timingBucket.n : 0,
    };
  } catch {
    return notApplied(scope, false, "evaluation failed -- failing safe to NO_OPINION");
  }
}

export interface EntryVerdict {
  action: string;
  confidence: number;
  reason: string;
  sl_adjust: number;
  tp_adjust: number;
}

/**
 * Applies an already-computed GlobalBrainInfluenceResult to an entry
 * verdict (routes/ai.ts's POST /ai/analyze dual-AI result). Pure function,
 * directly unit-testable without mocking the LLM pipeline -- see
 * globalBrainInfluence.test.ts.
 *
 * Only ever DOWNGRADES an already-decided BUY/SELL to SKIP on REJECT/WAIT; never
 * invents a trade, never touches sl_adjust/tp_adjust except zeroing them
 * alongside the downgrade to SKIP (spec section 19).
 */
export function applyGlobalBrainToEntryVerdict(verdict: EntryVerdict, influence: GlobalBrainInfluenceResult | null): EntryVerdict {
  if (!influence || !["REJECT", "WAIT"].includes(influence.recommendation) || !["BUY", "SELL"].includes(verdict.action)) return verdict;
  return {
    action: "SKIP",
    confidence: 0,
    reason: `Global Brain ${influence.recommendation}: ${influence.reason} (was ${verdict.action} ${verdict.confidence}%: ${verdict.reason.slice(0, 120)})`,
    sl_adjust: 0,
    tp_adjust: 0,
  };
}
