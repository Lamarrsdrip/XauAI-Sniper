import type { CounterfactualEntryResult, DecisionAction, MistakeCategory } from "../models/globalBrain.js";

/**
 * Deterministic, rule-based mistake/success classification -- NOT a learned
 * model. Pure function over already-known outcome numbers so it is fully
 * unit-testable and auditable; it is itself an input feature to the daily
 * learning job, not something that job trains.
 *
 * Thresholds are intentionally simple and documented inline. They are a
 * starting point (spec: "Adapt categories to actual data") -- the daily
 * report's per-category counts are the evidence for tuning them later, not
 * this function pretending to already be tuned.
 */

const MIN_FAVORABLE_MOVE_R = 0.2; // below this, "moved favorably first" is noise, not a real move
const ENTRY_TIMING_MARGIN_R = 0.15; // minimum R difference before calling a counterfactual entry meaningfully better/worse
// A WIN that consumed at least half its stop distance against it before
// resolving favorably is entry-quality evidence, not just a clean win --
// spec: "Do NOT simply label WIN = GREAT ENTRY" for a -45 pip / +80 pip
// trade. mae_r is reported as a negative R value by the EA/Outlook tracker
// (see models/globalBrain.ts ObservationOutcome); a starting threshold, not
// a tuned one -- see this file's module comment.
const HIGH_MAE_WIN_THRESHOLD_R = -0.5;

export interface ClassifyMistakeInput {
  decision_action: DecisionAction;
  analytics_outcome: string | null; // WIN | LOSS | PARTIAL_PROFIT | BREAK_EVEN | null
  r_multiple: number | null;
  mfe_r: number | null;
  mae_r: number | null;
  counterfactual: CounterfactualEntryResult[] | null;
}

function bestCounterfactualR(counterfactual: CounterfactualEntryResult[] | null): { immediate: number | null; bestDelayed: number | null } {
  if (!counterfactual) return { immediate: null, bestDelayed: null };
  const immediate = counterfactual.find((c) => c.offset === "IMMEDIATE" && c.data_available)?.achieved_r ?? null;
  const delayed = counterfactual.filter((c) => c.offset !== "IMMEDIATE" && c.data_available).map((c) => c.achieved_r ?? -Infinity);
  const bestDelayed = delayed.length > 0 ? Math.max(...delayed) : null;
  return { immediate, bestDelayed };
}

export function classifyMistake(input: ClassifyMistakeInput): MistakeCategory {
  const { decision_action, analytics_outcome, r_multiple, mfe_r, mae_r } = input;

  if (decision_action === "SKIPPED" || decision_action === "EXPIRED") {
    const { immediate } = bestCounterfactualR(input.counterfactual);
    if (immediate === null) return "UNCLASSIFIED";
    if (immediate > 0) return "MISSED_WINNER";
    return "GOOD_REJECTION";
  }

  if (decision_action === "CANDIDATE") return "UNCLASSIFIED"; // outcome not yet known

  // decision_action === EXECUTED from here on.
  if (analytics_outcome === null || analytics_outcome === undefined) return "UNCLASSIFIED";

  if (analytics_outcome === "WIN") {
    // Entry-timing check first: even a winning trade can reveal that
    // waiting (or not waiting) would have captured meaningfully more R.
    const timing = classifyEntryTiming(r_multiple, input.counterfactual);
    if (timing) return timing;
    // Otherwise-clean win, but only after surviving significant adverse
    // excursion first -- direction/setup may still be good, but the entry
    // itself was poor (see HIGH_MAE_WIN_THRESHOLD_R above).
    if (mae_r !== null && mae_r <= HIGH_MAE_WIN_THRESHOLD_R) return "HIGH_MAE_WIN";
    return "CLEAN_WIN";
  }

  if (analytics_outcome === "PARTIAL_PROFIT" || analytics_outcome === "BREAK_EVEN") {
    return "GOOD_DECISION_BAD_OUTCOME";
  }

  if (analytics_outcome === "LOSS") {
    const favorableMoveFirst = (mfe_r ?? 0) >= MIN_FAVORABLE_MOVE_R;
    if (favorableMoveFirst) return "STOP_BEFORE_MOVE";
    return "WRONG_DIRECTION";
  }

  return "UNCLASSIFIED";
}

function classifyEntryTiming(actualR: number | null, counterfactual: CounterfactualEntryResult[] | null): MistakeCategory | null {
  if (actualR === null || !counterfactual) return null;
  const { immediate, bestDelayed } = bestCounterfactualR(counterfactual);
  if (immediate === null) return null;

  // Compare the ACTUAL result against the immediate-entry counterfactual:
  // if immediate entry would have captured meaningfully more R than what
  // actually happened, the real entry was effectively late.
  if (immediate - actualR >= ENTRY_TIMING_MARGIN_R) return "ENTRY_TOO_LATE";

  // If a delayed entry would have captured meaningfully more R than the
  // immediate/actual entry, entering sooner cost R -- waiting would have helped.
  if (bestDelayed !== null && bestDelayed - Math.max(actualR, immediate) >= ENTRY_TIMING_MARGIN_R) {
    return "WAIT_IMPROVED_ENTRY";
  }
  if (bestDelayed !== null && Math.max(actualR, immediate) - bestDelayed >= ENTRY_TIMING_MARGIN_R) {
    return "WAIT_HURT_ENTRY";
  }
  if (actualR - immediate >= ENTRY_TIMING_MARGIN_R) return "ENTRY_TOO_EARLY";

  return null;
}
