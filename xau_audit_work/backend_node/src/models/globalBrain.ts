import { z } from "zod";

/**
 * XauCloud Global Learning Brain -- shared schema.
 *
 * Unified observation record for the global, cross-account learning memory.
 * Deliberately NOT a new parallel ML system: every observation here is built
 * FROM an existing source-of-truth record (ml_shadow_decisions written by
 * routes/ml.ts's existing ShadowML endpoint, or a terminal
 * cloud_market_outlook_outcomes row written by
 * services/marketOutlookTick.ts's existing persistSignalOutcome) -- this
 * collection normalizes those into one global, queryable shape. It never
 * replaces or mutates those source collections.
 *
 * SAFETY: nothing in this file, or anything that reads/writes this
 * collection, may be called from a live trade-decision code path
 * (outlookExecution.ts's enqueueIfActionable, the EA command channel, or
 * any /ai|/ml endpoint the EA branches on). See services/globalBrainIngest.ts
 * and services/globalBrainTraining.ts module comments for the enforced
 * shadow-only boundary.
 */

export const GLOBAL_BRAIN_OBSERVATIONS_COLLECTION = "global_brain_observations";
export const GLOBAL_BRAIN_MODELS_COLLECTION = "global_brain_models";
export const GLOBAL_BRAIN_PROMOTIONS_COLLECTION = "global_brain_promotions";
export const GLOBAL_BRAIN_DAILY_REPORTS_COLLECTION = "global_brain_daily_reports";

/**
 * Where an observation originated.
 *  - BOT_TRADE: a closed trade or rejected/skipped candidate from
 *    ml_shadow_decisions (the EA's rule/hive decision log).
 *  - OUTLOOK: a terminal, outcome-tracked cloud_market_outlooks signal.
 *    This INCLUDES actionable M10 candidates that were published and
 *    outcome-tracked -- publishM10SignalFromActivity routes them through
 *    the exact same generateOutlookForAccount/persistSignalOutcome
 *    pipeline as hourly Outlook signals, so they already get full TP/SL/
 *    MAE/MFE tracking under this source rather than needing a duplicate one.
 *  - M10: an M10 candidate that was BLOCKED or EXPIRED before ever
 *    becoming an actionable, outcome-tracked signal -- sourced from
 *    cloud_outlook_signal_events (services/marketOutlookPublish.ts's
 *    lifecycle log). No price-path outcome exists for these (they never
 *    got a tracked entry/SL/TP), so they carry decision-time features only
 *    and mistake_classification is honestly UNCLASSIFIED. M10's still-
 *    transient WATCHING state is not ingested (not a decision, just an
 *    in-progress evaluation that would flood the log with near-duplicates).
 */
export const OBSERVATION_SOURCES = ["BOT_TRADE", "OUTLOOK", "M10"] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

/** What ultimately happened to the opportunity this observation describes. */
export const DECISION_ACTIONS = ["CANDIDATE", "EXECUTED", "SKIPPED", "EXPIRED"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/**
 * Mistake/success classification. Deliberately not WIN/LOSS -- see
 * services/globalBrainMistakeClassifier.ts for the deterministic rules that
 * assign these. Adapted to the categories the spec calls out; UNCLASSIFIED
 * is honest when there isn't enough evidence to say more (e.g. a rejected
 * setup with no counterfactual price data).
 */
export const MISTAKE_CATEGORIES = [
  "WRONG_DIRECTION",
  "STOP_BEFORE_MOVE",
  "ENTRY_TOO_LATE",
  "ENTRY_TOO_EARLY",
  "WAIT_HURT_ENTRY",
  "WAIT_IMPROVED_ENTRY",
  "GOOD_DECISION_BAD_OUTCOME",
  "GOOD_REJECTION",
  "GOOD_WAIT",
  "MISSED_WINNER",
  "HIGH_MAE_WIN",
  "CLEAN_WIN",
  "UNCLASSIFIED",
] as const;
export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

export const COUNTERFACTUAL_OFFSETS = ["IMMEDIATE", "PLUS_1MIN", "PLUS_2MIN", "PLUS_3MIN", "PLUS_5MIN", "PLUS_10MIN", "PLUS_15MIN", "PLUS_30MIN"] as const;
export type CounterfactualOffset = (typeof COUNTERFACTUAL_OFFSETS)[number];

export interface CounterfactualEntryResult {
  offset: CounterfactualOffset;
  entry_price: number | null;
  achieved_r: number | null;
  /** True only if there was an actual observed quote at/after this offset within the evaluation window -- never extrapolated. */
  data_available: boolean;
}

/** Bucketing/feature snapshot -- only fields the source record already computed, nothing re-derived from raw candles here (no independent regime/structure computation exists backend-side; see audit). */
export interface ObservationFeatures {
  symbol: string;
  direction: "BUY" | "SELL" | "NONE";
  session: string;
  regime: string;
  structure_state: string;
  setup_type: string;
  confidence_pct: number | null;
  hive_verdict: string | null;
  hive_win_rate: number | null;
}

export interface ObservationOutcome {
  analytics_outcome: string | null; // WIN | LOSS | PARTIAL_PROFIT | BREAK_EVEN | null (unresolved)
  r_multiple: number | null;
  mfe_r: number | null;
  mae_r: number | null;
  highest_tp_reached: number | null;
  time_to_resolution_seconds: number | null;
}

export interface GlobalBrainObservation {
  /** Stable idempotency key -- see globalBrainIngest.ts computeDedupeKey. Unique-indexed; re-ingesting the same source event upserts, never duplicates. */
  dedupe_key: string;
  source: ObservationSource;
  /** One-way hash of the owning account/license identity -- never the raw account_login/license_id. See globalBrainIngest.ts hashAccountRef. */
  account_ref: string;
  decision_action: DecisionAction;
  features: ObservationFeatures;
  outcome: ObservationOutcome | null;
  mistake_classification: MistakeCategory | null;
  counterfactual: CounterfactualEntryResult[] | null;
  /** When the decision was made -- the only instant whose information the features above may depend on. */
  decision_at: string;
  /** When the outcome became knowable (terminal classification time). Null while unresolved. This, not decision_at, is what the daily training job sorts/splits on -- an observation must never be used for training before its own outcome existed. */
  resolved_at: string | null;
  source_ref: { collection: string; id: string };
  created_at: string;
}

export const GlobalBrainRunCycleRequestSchema = z.object({
  dry_run: z.boolean().optional().default(false),
});

export const GlobalBrainRollbackRequestSchema = z.object({
  question: z.string(),
});

/** Owner-controlled master switches (services/globalBrainSettings.ts) -- every field optional so a PATCH can flip just one switch without restating the rest. */
export const GlobalBrainSettingsPatchSchema = z.object({
  global_learning_enabled: z.boolean().optional(),
  scheduled_cycle_enabled: z.boolean().optional(),
  auto_training_enabled: z.boolean().optional(),
  auto_promotion_enabled: z.boolean().optional(),
  shadow_serving_enabled: z.boolean().optional(),
  advisory_integration_enabled: z.boolean().optional(),
  bot_learned_influence_enabled: z.boolean().optional(),
  m10_learned_influence_enabled: z.boolean().optional(),
  outlook_learned_influence_enabled: z.boolean().optional(),
});
