import type { GlobalBrainObservation, MistakeCategory } from "../models/globalBrain.js";
import { classifyMistake } from "./globalBrainMistakeClassifier.js";

/**
 * DRY-RUN ONLY. Recomputes DIRECTION_QUALITY/SETUP_QUALITY labels and
 * MAE/MFE trustworthiness for already-resolved Global Brain observations
 * using the CURRENT (post-audit) label logic, without writing anything.
 * Nothing in this file mutates the observations collection -- see
 * globalBrainHistoricalReprocess.test.ts and the audit report this shipped
 * with for why: recovering historical evidence after the two label-
 * resolution bugs (STOP_BEFORE_MOVE collapsed to plain WIN/LOSS; TP1/TP2
 * wins re-touched by continued monitoring) must be reviewed before any
 * production data changes, per the owner's explicit instruction.
 *
 * WHY BOTH BUGS ARE MECHANICALLY REPROCESSABLE FOR MOST DATA:
 * `classifyMistake` and `successOrValidatedDirection` (globalBrainTraining.ts)
 * are PURE functions over fields already durably stored on every resolved
 * observation (analytics_outcome, r_multiple, mfe_r, mae_r,
 * highest_tp_reached, counterfactual) -- they are not cached/stale derived
 * values, so simply re-applying them against already-stored data recovers
 * the corrected DIRECTION_QUALITY/SETUP_QUALITY label with no missing-data
 * risk. The two bugs affect DISJOINT observation subsets:
 *   - STOP_BEFORE_MOVE mislabeling (bug 1) only ever applies to LOSS
 *     outcomes (globalBrainMistakeClassifier.ts's LOSS branch, keyed on
 *     mfe_r). A LOSS observation, by definition, never reached TP1/TP2, so
 *     it was never in the "already won, kept monitoring" path bug 2
 *     describes -- its mfe_r is NOT suspect.
 *   - MAE/MFE post-resolution corruption (bug 2) only ever applies to WIN
 *     outcomes that resolved via TP1 or TP2 (highest_tp_reached 1 or 2) --
 *     monitoring only continues past those, never past TP3/SL/expiry. A
 *     TP3 win, or any loss/expiry, was never re-touched after resolution.
 * So: LOSS observations are fully reprocessable for direction/setup labels
 * with no MAE/MFE caveat. TP3-or-better wins and all non-win terminal
 * states are fully reprocessable and MAE/MFE-reliable. Only TP1/TP2 WIN
 * observations carry a real, admitted evidence gap: the record has no
 * stored trace of whether mae_r/mfe_r were captured at the moment of
 * resolution or drifted afterward, so this file marks those
 * HISTORICAL_PATH_UNCERTAIN rather than guessing either way.
 */

export type ReprocessabilityClass = "FULLY_REPROCESSABLE" | "PARTIALLY_REPROCESSABLE" | "NOT_REPROCESSABLE";
export type MaeMfeStatus = "RELIABLE" | "HISTORICAL_PATH_UNCERTAIN";

export interface ReprocessedObservation {
  dedupe_key: string;
  reprocessability: ReprocessabilityClass;
  reprocessability_reason: string;
  old_mistake_classification: MistakeCategory | null;
  new_mistake_classification: MistakeCategory | null;
  mistake_classification_changed: boolean;
  old_direction_setup_validated: boolean | null;
  new_direction_setup_validated: boolean | null;
  direction_setup_label_changed: boolean;
  mae_mfe_status: MaeMfeStatus;
  mae_mfe_reason: string;
}

function isTp1OrTp2Win(o: GlobalBrainObservation): boolean {
  return o.outcome?.analytics_outcome === "WIN" && (o.outcome.highest_tp_reached === 1 || o.outcome.highest_tp_reached === 2);
}

function successOrValidatedDirection(analyticsOutcome: string | null | undefined, mistake: MistakeCategory | null): boolean {
  return analyticsOutcome === "WIN" || mistake === "STOP_BEFORE_MOVE";
}

/**
 * Recomputes one observation's labels under the current (corrected) logic
 * and compares against what is currently stored. Pure, read-only -- takes
 * an observation, returns an assessment; never writes anything anywhere.
 */
export function reprocessObservation(o: GlobalBrainObservation): ReprocessedObservation {
  if (!o.resolved_at || o.decision_action !== "EXECUTED" || !o.outcome || o.outcome.analytics_outcome == null) {
    // Not an executed+resolved trade outcome (e.g. a CANDIDATE, or a
    // SKIPPED/EXPIRED rejection observation -- those already use a
    // different, unaffected classification branch in classifyMistake).
    // No direction/setup outcome label exists to reprocess for these.
    return {
      dedupe_key: o.dedupe_key,
      reprocessability: "NOT_REPROCESSABLE",
      reprocessability_reason: "not an executed trade with a known outcome -- no DIRECTION_QUALITY/SETUP_QUALITY label applies",
      old_mistake_classification: o.mistake_classification,
      new_mistake_classification: o.mistake_classification,
      mistake_classification_changed: false,
      old_direction_setup_validated: null,
      new_direction_setup_validated: null,
      direction_setup_label_changed: false,
      mae_mfe_status: "RELIABLE",
      mae_mfe_reason: "not applicable",
    };
  }

  const newMistake = classifyMistake({
    decision_action: o.decision_action,
    analytics_outcome: o.outcome.analytics_outcome,
    r_multiple: o.outcome.r_multiple,
    mfe_r: o.outcome.mfe_r,
    mae_r: o.outcome.mae_r,
    counterfactual: o.counterfactual,
  });

  const oldValidated = successOrValidatedDirection(o.outcome.analytics_outcome, o.mistake_classification);
  const newValidated = successOrValidatedDirection(o.outcome.analytics_outcome, newMistake);

  const affected = isTp1OrTp2Win(o);

  return {
    dedupe_key: o.dedupe_key,
    reprocessability: "FULLY_REPROCESSABLE",
    reprocessability_reason: affected
      ? "direction/setup label fully recomputable from stored fields; MAE/MFE-derived sub-metrics uncertain (see mae_mfe_status)"
      : "direction/setup label and MAE/MFE both fully recomputable from stored fields",
    old_mistake_classification: o.mistake_classification,
    new_mistake_classification: newMistake,
    mistake_classification_changed: o.mistake_classification !== newMistake,
    old_direction_setup_validated: oldValidated,
    new_direction_setup_validated: newValidated,
    direction_setup_label_changed: oldValidated !== newValidated,
    mae_mfe_status: affected ? "HISTORICAL_PATH_UNCERTAIN" : "RELIABLE",
    mae_mfe_reason: affected
      ? `WIN resolved via TP${o.outcome.highest_tp_reached} -- monitoring may have continued afterward (bug fixed in globalBrainIngest.ts's first-resolution-wins guard); no stored trace of whether mae_r/mfe_r reflect price action at resolution or later, so these are not fed into MAE/MFE-derived training as reliable`
      : "resolution point for this outcome (TP3, SL, or expiry) is the natural end of monitoring -- unaffected by the continued-monitoring bug",
  };
}

export interface DryRunReport {
  total_observations: number;
  resolved: number;
  reprocessable: number;
  partially_reprocessable: number;
  not_reprocessable: number;
  direction_labels_changed: number;
  setup_labels_changed: number;
  stop_before_move_recovered: number;
  mae_mfe_corruption_suspected: number;
  mae_mfe_safely_reconstructed: number;
  mae_mfe_not_reconstructable: number;
  unchanged_correct_observations: number;
  results: ReprocessedObservation[];
}

/**
 * Runs the dry-run classification/relabeling pass over a set of
 * observations already fetched by the caller (read-only query). Does not
 * touch the database itself -- callers decide whether/how to fetch, and
 * this function only ever computes a report from what it is given.
 *
 * DIRECTION_QUALITY and SETUP_QUALITY currently share the same underlying
 * successOrValidatedDirection() label, so "direction labels changed" and
 * "setup labels changed" are reported identically -- this mirrors
 * production (globalBrainTraining.ts's QUESTION_SPECS), not a shortcut
 * taken here. ENTRY_TIMING/TP_BEFORE_SL/CALIBRATION are unaffected by
 * either bug (verified in the audit this shipped with) so are not
 * recomputed here; MAE/MFE reliability is reported separately since it
 * bears specifically on ENTRY_TIMING's HIGH_MAE_WIN sub-classification.
 */
export function dryRunReprocess(observations: GlobalBrainObservation[]): DryRunReport {
  const resolved = observations.filter((o) => o.resolved_at !== null);
  const results = resolved.map(reprocessObservation);

  const reprocessable = results.filter((r) => r.reprocessability === "FULLY_REPROCESSABLE").length;
  const partiallyReprocessable = results.filter((r) => r.reprocessability === "PARTIALLY_REPROCESSABLE").length;
  const notReprocessable = results.filter((r) => r.reprocessability === "NOT_REPROCESSABLE").length;

  const directionSetupChanged = results.filter((r) => r.direction_setup_label_changed).length;
  const stopBeforeMoveRecovered = results.filter(
    (r) => r.new_mistake_classification === "STOP_BEFORE_MOVE" && r.old_mistake_classification !== "STOP_BEFORE_MOVE",
  ).length;

  const maeMfeSuspected = results.filter((r) => r.mae_mfe_status === "HISTORICAL_PATH_UNCERTAIN").length;

  const unchangedCorrect = results.filter(
    (r) => !r.direction_setup_label_changed && !r.mistake_classification_changed && r.mae_mfe_status === "RELIABLE",
  ).length;

  return {
    total_observations: observations.length,
    resolved: resolved.length,
    reprocessable,
    partially_reprocessable: partiallyReprocessable,
    not_reprocessable: notReprocessable,
    direction_labels_changed: directionSetupChanged,
    setup_labels_changed: directionSetupChanged,
    stop_before_move_recovered: stopBeforeMoveRecovered,
    // Every TP1/TP2 win is flagged HISTORICAL_PATH_UNCERTAIN out of caution
    // (bug 2) -- there is no stored per-observation trace of whether it was
    // actually re-touched after resolution, so none can be safely
    // reconstructed and none are excluded from the "suspected" count.
    mae_mfe_corruption_suspected: maeMfeSuspected,
    mae_mfe_safely_reconstructed: 0,
    mae_mfe_not_reconstructable: maeMfeSuspected,
    unchanged_correct_observations: unchangedCorrect,
    results,
  };
}
