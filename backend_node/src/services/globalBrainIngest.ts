import { createHash } from "node:crypto";
import { getDb } from "../db.js";
import { env } from "../env.js";
import {
  GLOBAL_BRAIN_OBSERVATIONS_COLLECTION,
  type DecisionAction,
  type GlobalBrainObservation,
  type ObservationSource,
} from "../models/globalBrain.js";
import { classifyMistake } from "./globalBrainMistakeClassifier.js";
import { computeCounterfactualTiming, type Quote } from "./globalBrainCounterfactual.js";
import { getGlobalBrainSettings } from "./globalBrainSettings.js";

/**
 * Ingestion layer for the Global Learning Brain's unified observation
 * store. Both normalizers below build a GlobalBrainObservation FROM an
 * already-persisted source-of-truth record -- they never originate new
 * trading/decision data themselves.
 *
 * SHADOW-ONLY BOUNDARY: nothing in this file may be imported by any
 * live-decision code path. It is called from exactly three places, all
 * strictly after a real decision/outcome was already recorded elsewhere:
 *  - routes/journal.ts, inside its existing best-effort ShadowML join block
 *    (after a trade closes)
 *  - services/marketOutlookTick.ts's persistSignalOutcome (after an Outlook
 *    signal -- including an actionable M10 publication, which is routed
 *    through the same pipeline -- reaches a terminal outcome)
 *  - services/marketOutlookPublish.ts's publishM10SignalFromActivity
 *    (after a BLOCKED/EXPIRED M10 candidate's lifecycle event is already
 *    durably persisted to cloud_outlook_signal_events)
 * recordGlobalBrainObservation() never returns anything; callers cannot
 * branch on it even by accident.
 *
 * M10's still-transient WATCHING state is intentionally NOT ingested (not
 * a decision, just an in-progress evaluation re-stamped on every EA
 * heartbeat -- ingesting it would flood the log with near-duplicates, not
 * add evidence). An M10 candidate's full tick-level price path (for
 * counterfactual timing) is not available once it never became a
 * tracked signal, so buildM10CandidateObservation below carries decision-
 * time features only, honestly UNCLASSIFIED rather than guessed.
 */

/**
 * Deliberately DETERMINISTIC (same rawId -> same hash every time), not a
 * fresh per-record salt: the spec calls for eventually detecting/capping
 * one account dominating the training set ("do not let one huge account
 * dominate learning"), which requires being able to tell that two
 * observations came from the same account. account_ref is not read back
 * anywhere yet (no bucket/filter/grouping uses it today), so this
 * capability is dormant, not wired up -- but a per-record random salt would
 * foreclose it permanently since the raw identity is never stored.
 * Trade-off, flagged by an adversarial security review: this means anyone
 * with read access to global_brain_observations can correlate/cluster one
 * customer's observations over time (a linkability risk), even though the
 * hash itself cannot be reversed to the raw account_login/license_id.
 */
function hashAccountRef(rawId: string): string {
  const pepper = env.GLOBAL_BRAIN_HASH_PEPPER || env.JWT_SECRET;
  return createHash("sha256").update(`${pepper}:${rawId}`).digest("hex").slice(0, 32);
}

export async function ensureGlobalBrainIndexes(): Promise<void> {
  const db = getDb();
  await db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION).createIndex("dedupe_key", { unique: true });
  await db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION).createIndex({ source: 1, resolved_at: 1 });
  await db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION).createIndex({ resolved_at: 1 });
}

/**
 * Best-effort upsert, matching the rest of this codebase's convention for
 * non-critical side effects (see journal.ts's ShadowML join comment) -- a
 * Global Brain ingestion failure must never affect the caller's own
 * response. This is the single choke point every ingestion hook writes
 * through, so it is also the kill-switch enforcement point for
 * global_learning_enabled (see globalBrainSettings.ts) -- flipping that one
 * flag off stops ALL new observation collection everywhere at once.
 *
 * FIRST RESOLUTION WINS (bug found auditing the resolution pipeline): an
 * Outlook/M10 signal that wins via TP1/TP2 does not stop being monitored --
 * services/marketOutlookTick.ts's tick loop only closes monitoring at TP3,
 * expiry, or an undeadlined SL, so persistSignalOutcome (and therefore this
 * function) can fire AGAIN, repeatedly, for the SAME already-terminal
 * signal, each time carrying whatever mae_r/mfe_r the price has done SINCE
 * the win -- price action the trade's outcome no longer has anything to do
 * with. Without this guard, a clean TP1 win could be silently rewritten
 * into a false HIGH_MAE_WIN (or vice versa) by unrelated post-resolution
 * volatility every time this upsert re-ran, corrupting the DIRECTION_
 * QUALITY/ENTRY_TIMING training signal with information that was never
 * actually part of this setup's entry risk. Once a dedupe_key's PRIOR
 * stored observation already has a resolved_at, that resolution snapshot
 * is treated as immutable -- this call becomes a no-op for it. An
 * unresolved observation (resolved_at: null -- a still-pending SKIPPED/
 * EXPIRED candidate) is unaffected and continues to upsert normally; only
 * an ALREADY-resolved record is protected from being overwritten.
 */
export async function recordGlobalBrainObservation(obs: GlobalBrainObservation): Promise<void> {
  try {
    const settings = await getGlobalBrainSettings();
    if (!settings.global_learning_enabled) return;
    const collection = getDb().collection<GlobalBrainObservation>(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
    if (obs.resolved_at !== null) {
      const existing = await collection.findOne({ dedupe_key: obs.dedupe_key }, { projection: { _id: 0, resolved_at: 1 } });
      if (existing && existing.resolved_at !== null) return; // already resolved -- first resolution wins, never overwritten
    }
    await collection.updateOne({ dedupe_key: obs.dedupe_key }, { $set: obs }, { upsert: true });
  } catch {
    /* best-effort */
  }
}

function normalizeDecisionAction(raw: string | undefined): DecisionAction {
  if (raw === "EXECUTED" || raw === "SKIPPED" || raw === "EXPIRED") return raw;
  return "CANDIDATE";
}

/**
 * Builds a BOT_TRADE observation from a closed trade_journal doc (already
 * has real R-multiple outcome fields the EA itself reports -- final_r,
 * mae_r, mfe_r; see models/journal.ts) plus, when available, the
 * pre-decision ShadowML features (hive_verdict/rule_decision/confidence)
 * from the matched ml_shadow_decisions doc. Called from routes/journal.ts
 * only after the trade is already durably persisted.
 */
export function buildBotTradeObservation(
  tradeDoc: Record<string, unknown>,
  shadowDoc: Record<string, unknown> | null,
): GlobalBrainObservation {
  const direction = String(tradeDoc["direction"] ?? "").toUpperCase();
  const outcome =
    tradeDoc["result"] !== undefined && tradeDoc["result"] !== ""
      ? {
          analytics_outcome: String(tradeDoc["result"]).toUpperCase() === "WIN" ? "WIN" : String(tradeDoc["result"]).toUpperCase() === "LOSS" ? "LOSS" : "BREAK_EVEN",
          r_multiple: Number.isFinite(Number(tradeDoc["final_r"])) ? Number(tradeDoc["final_r"]) : null,
          mfe_r: Number.isFinite(Number(tradeDoc["mfe_r"])) ? Number(tradeDoc["mfe_r"]) : null,
          mae_r: Number.isFinite(Number(tradeDoc["mae_r"])) ? Number(tradeDoc["mae_r"]) : null,
          highest_tp_reached: null,
          time_to_resolution_seconds:
            Number(tradeDoc["closed_at"] ?? 0) > 0 && Number(tradeDoc["opened_at"] ?? 0) > 0
              ? Number(tradeDoc["closed_at"]) - Number(tradeDoc["opened_at"])
              : null,
        }
      : null;

  const decisionAction = normalizeDecisionAction((shadowDoc?.["actual_action"] as string | undefined) ?? "EXECUTED");
  const mistake = classifyMistake({
    decision_action: decisionAction,
    analytics_outcome: outcome?.analytics_outcome ?? null,
    r_multiple: outcome?.r_multiple ?? null,
    mfe_r: outcome?.mfe_r ?? null,
    mae_r: outcome?.mae_r ?? null,
    counterfactual: null, // no tick-level quote replay available for bot trades server-side; see module comment
  });

  const decisionAtRaw = shadowDoc?.["decision_time_utc"] as string | undefined;
  const decisionAt = decisionAtRaw || (Number(tradeDoc["opened_at"] ?? 0) > 0 ? new Date(Number(tradeDoc["opened_at"]) * 1000).toISOString() : new Date().toISOString());
  const resolvedAt = Number(tradeDoc["closed_at"] ?? 0) > 0 ? new Date(Number(tradeDoc["closed_at"]) * 1000).toISOString() : new Date().toISOString();

  return {
    dedupe_key: `BOT_TRADE:${String(tradeDoc["trade_identity"] ?? tradeDoc["signature"] ?? "")}`,
    source: "BOT_TRADE",
    account_ref: hashAccountRef(String(tradeDoc["license_id"] ?? tradeDoc["account_login"] ?? "")),
    decision_action: decisionAction,
    features: {
      symbol: String(tradeDoc["symbol"] ?? "XAUUSD"),
      direction: direction === "BUY" || direction === "SELL" ? direction : "NONE",
      session: "", // not captured by the EA's journal/shadow payloads today -- honestly left empty, not guessed
      regime: String(shadowDoc?.["regime"] ?? tradeDoc["regime"] ?? ""),
      structure_state: "",
      setup_type: String(shadowDoc?.["setup_type"] ?? tradeDoc["setup"] ?? ""),
      confidence_pct: null,
      hive_verdict: (shadowDoc?.["hive_verdict"] as string | undefined) ?? null,
      hive_win_rate: shadowDoc?.["hive_win_rate"] !== undefined ? Number(shadowDoc["hive_win_rate"]) : null,
    },
    outcome,
    mistake_classification: mistake,
    counterfactual: null,
    decision_at: decisionAt,
    resolved_at: resolvedAt,
    resolution_state: "RESOLVED",
    source_ref: { collection: "trade_journal", id: String(tradeDoc["trade_identity"] ?? "") },
    created_at: new Date().toISOString(),
  };
}

/**
 * Builds a rejected/waited-setup BOT_TRADE observation directly from a
 * ml_shadow_decisions record at write time, for the case
 * (actual_action === "SKIPPED") that will never get a matching
 * trade_journal close event to join against later. No outcome/counterfactual
 * data exists for these -- mistake_classification is honestly UNCLASSIFIED
 * unless a later data source changes that; this still satisfies the spec's
 * requirement to capture rejected setups even where we can't yet judge them.
 */
export function buildShadowCandidateObservation(shadowDoc: Record<string, unknown>): GlobalBrainObservation {
  const direction = String(shadowDoc["direction"] ?? "").toUpperCase();
  const decisionAt = String(shadowDoc["decision_time_utc"] ?? new Date().toISOString());
  return {
    dedupe_key: `BOT_TRADE_CANDIDATE:${String(shadowDoc["signature"] ?? "")}:${decisionAt}`,
    source: "BOT_TRADE",
    account_ref: hashAccountRef(String(shadowDoc["account"] ?? "")),
    decision_action: "SKIPPED",
    features: {
      symbol: String(shadowDoc["symbol"] ?? "XAUUSD"),
      direction: direction === "BUY" || direction === "SELL" ? direction : "NONE",
      session: "",
      regime: String(shadowDoc["regime"] ?? ""),
      structure_state: "",
      setup_type: String(shadowDoc["setup_type"] ?? ""),
      confidence_pct: null,
      hive_verdict: (shadowDoc["hive_verdict"] as string | undefined) ?? null,
      hive_win_rate: shadowDoc["hive_win_rate"] !== undefined ? Number(shadowDoc["hive_win_rate"]) : null,
    },
    outcome: null,
    mistake_classification: "UNCLASSIFIED",
    counterfactual: null,
    decision_at: decisionAt,
    resolved_at: null,
    resolution_state: "UNRESOLVABLE_NO_PATH",
    source_ref: { collection: "ml_shadow_decisions", id: String(shadowDoc["signature"] ?? "") },
    created_at: new Date().toISOString(),
  };
}

/**
 * Builds an M10 observation from a BLOCKED/EXPIRED cloud_outlook_signal_events
 * lifecycle doc (services/marketOutlookPublish.ts's publishM10SignalFromActivity
 * -- this candidate never became an actionable, outcome-tracked signal, so
 * there is no price path to score it against; honestly UNCLASSIFIED rather
 * than fabricated. Returns null for any other event_type (ACTIONABLE flows
 * through buildOutlookObservation instead; WATCHING is not a decision).
 */
export function buildM10CandidateObservation(eventDoc: Record<string, unknown>): GlobalBrainObservation | null {
  const eventType = String(eventDoc["event_type"] ?? "");
  if (eventType !== "BLOCKED" && eventType !== "EXPIRED") return null;

  const direction = String(eventDoc["direction"] ?? "").toUpperCase();
  const decisionAction: DecisionAction = eventType === "EXPIRED" ? "EXPIRED" : "SKIPPED";
  const decisionAt = String(eventDoc["event_time"] ?? new Date().toISOString());

  return {
    dedupe_key: `M10:${String(eventDoc["candidate_id"] ?? "")}:${eventType}`,
    source: "M10",
    account_ref: hashAccountRef(String(eventDoc["account"] ?? "")),
    decision_action: decisionAction,
    features: {
      symbol: String(eventDoc["symbol"] ?? "XAUUSD"),
      direction: direction === "BUY" || direction === "SELL" ? direction : "NONE",
      session: "",
      regime: "",
      structure_state: String(eventDoc["blocker_code"] ?? ""),
      setup_type: "M10_CANDIDATE",
      confidence_pct: eventDoc["confidence"] !== undefined && eventDoc["confidence"] !== null ? Number(eventDoc["confidence"]) : null,
      hive_verdict: null,
      hive_win_rate: null,
    },
    outcome: null,
    mistake_classification: "UNCLASSIFIED",
    counterfactual: null,
    decision_at: decisionAt,
    resolved_at: null,
    resolution_state: "UNRESOLVABLE_NO_PATH",
    source_ref: { collection: "cloud_outlook_signal_events", id: String(eventDoc["candidate_id"] ?? "") },
    created_at: new Date().toISOString(),
  };
}

/**
 * Builds an OUTLOOK or M10 observation from a terminal cloud_market_outlooks
 * doc (the `merged` doc marketOutlookTick.ts's persistSignalOutcome already
 * receives) plus the same causally-ordered quote journey already used to
 * classify its real outcome, for counterfactual entry-timing analysis.
 *
 * source is M10 when publication_mode === "M10_SIGNAL" (an actionable M10
 * candidate published via marketOutlookPublish.ts's
 * publishM10SignalFromActivity), OUTLOOK otherwise (the hourly manual-bias
 * generator) -- both flow through the identical outcome-tracking pipeline,
 * this only labels which decision engine actually produced the signal.
 */
function terminalChronology(doc: Record<string, unknown>): {
  first_terminal_event: "TP" | "SL" | "TIMEOUT" | null;
  first_terminal_at: string | null;
  tp_before_sl: boolean | null;
} {
  const parse = (value: unknown): Date | null => {
    if (!value) return null;
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const tpTimes = [doc["tp1_hit_at"], doc["tp2_hit_at"], doc["tp3_hit_at"]]
    .map(parse)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const firstTp = tpTimes[0] ?? null;
  const sl = parse(doc["sl_hit_at"]);
  if (firstTp && (!sl || firstTp.getTime() < sl.getTime()))
    return { first_terminal_event: "TP", first_terminal_at: firstTp.toISOString(), tp_before_sl: true };
  if (sl && (!firstTp || sl.getTime() <= firstTp.getTime()))
    return { first_terminal_event: "SL", first_terminal_at: sl.toISOString(), tp_before_sl: false };
  const timeout = parse(doc["classification_at"]);
  return { first_terminal_event: timeout ? "TIMEOUT" : null, first_terminal_at: timeout?.toISOString() ?? null, tp_before_sl: null };
}

export function buildOutlookObservation(doc: Record<string, unknown>, quotes: readonly Quote[]): GlobalBrainObservation | null {
  const direction = String(doc["primary_direction"] ?? "").toUpperCase();
  if (direction !== "BUY" && direction !== "SELL") return null;
  const source: ObservationSource = doc["publication_mode"] === "M10_SIGNAL" ? "M10" : "OUTLOOK";

  const publishedQuoteAt = doc["published_quote_at"] ? new Date(String(doc["published_quote_at"])) : null;
  const evaluationDeadline = doc["evaluation_deadline"] ? new Date(String(doc["evaluation_deadline"])) : null;
  const tp1 = Number(doc["tp1_price"] ?? 0) || null;
  const tp2 = Number(doc["tp2_price"] ?? 0) || null;
  const tp3 = Number(doc["tp3_price"] ?? 0) || null;
  const sl = Number(doc["original_sl"] ?? 0) || null;

  const counterfactual =
    publishedQuoteAt && evaluationDeadline && quotes.length > 0
      ? computeCounterfactualTiming(quotes, { direction, tp1, tp2, tp3, sl, publishedQuoteAt, evaluationDeadline })
      : null;

  const chronology = terminalChronology(doc);
  const outcome = {
    analytics_outcome: (doc["analytics_outcome"] as string | null) ?? null,
    r_multiple: doc["analytics_r"] !== undefined && doc["analytics_r"] !== null ? Number(doc["analytics_r"]) : null,
    mfe_r: doc["mfe_r"] !== undefined ? Number(doc["mfe_r"]) : null,
    mae_r: doc["mae_r"] !== undefined ? Number(doc["mae_r"]) : null,
    highest_tp_reached: doc["highest_tp_reached"] !== undefined && doc["highest_tp_reached"] !== null ? Number(doc["highest_tp_reached"]) : null,
    time_to_resolution_seconds:
      publishedQuoteAt && doc["classification_at"] ? (new Date(String(doc["classification_at"])).getTime() - publishedQuoteAt.getTime()) / 1000 : null,
    ...chronology,
  };

  const mistake = classifyMistake({
    decision_action: "EXECUTED",
    analytics_outcome: outcome.analytics_outcome,
    r_multiple: outcome.r_multiple,
    mfe_r: outcome.mfe_r,
    mae_r: outcome.mae_r,
    counterfactual,
  });

  return {
    dedupe_key: `${source}:${String(doc["id"] ?? "")}`,
    source,
    account_ref: hashAccountRef(String(doc["account"] ?? "")),
    decision_action: "EXECUTED",
    features: {
      symbol: String(doc["symbol"] ?? "XAUUSD"),
      direction,
      session: String(doc["session"] ?? ""),
      regime: String(doc["market_regime"] ?? ""),
      structure_state: String(doc["structure_state"] ?? ""),
      setup_type: String(doc["setup_type"] ?? ""),
      confidence_pct: doc["confidence_pct"] !== undefined ? Number(doc["confidence_pct"]) : null,
      hive_verdict: null,
      hive_win_rate: null,
    },
    outcome,
    mistake_classification: mistake,
    counterfactual,
    decision_at: String(doc["published_at"] ?? doc["generated_at"] ?? new Date().toISOString()),
    resolved_at: String(doc["classification_at"] ?? new Date().toISOString()),
    resolution_state: "RESOLVED",
    source_ref: { collection: "cloud_market_outlooks", id: String(doc["id"] ?? "") },
    created_at: new Date().toISOString(),
  };
}
