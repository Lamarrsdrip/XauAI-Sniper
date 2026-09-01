import { describe, expect, it } from "vitest";
import type { GlobalBrainObservation } from "../models/globalBrain.js";
import { dryRunReprocess, reprocessObservation } from "./globalBrainHistoricalReprocess.js";

/**
 * Synthetic, clearly-labeled fixtures mirroring the deterministic cases
 * used to audit the resolution pipeline (see globalBrainLabelResolution
 * .test.ts's CASE A-I). These are NOT real production data -- this
 * environment has no production database access (documented in the audit
 * report this shipped with) -- they exist to prove the dry-run
 * reprocessing logic itself is correct against known-shape inputs, so it
 * can safely be pointed at real data by someone with DB access.
 */
function baseObservation(overrides: Partial<GlobalBrainObservation> = {}): GlobalBrainObservation {
  return {
    dedupe_key: "TEST:1",
    source: "OUTLOOK",
    account_ref: "hash1",
    decision_action: "EXECUTED",
    features: { symbol: "XAUUSD", direction: "BUY", session: "LONDON", regime: "TRENDING", structure_state: "", setup_type: "BREAKOUT", confidence_pct: 70, hive_verdict: null, hive_win_rate: null },
    outcome: { analytics_outcome: "WIN", r_multiple: 1.0, mfe_r: 1.0, mae_r: -0.1, highest_tp_reached: 3, time_to_resolution_seconds: 600 },
    mistake_classification: "CLEAN_WIN",
    counterfactual: null,
    decision_at: "2026-07-01T00:00:00.000Z",
    resolved_at: "2026-07-01T01:00:00.000Z",
    source_ref: { collection: "cloud_market_outlooks", id: "1" },
    created_at: "2026-07-01T01:00:00.000Z",
    ...overrides,
  } as GlobalBrainObservation;
}

describe("reprocessObservation", () => {
  it("CLEAN WIN (TP3): fully reprocessable, MAE/MFE reliable, no label change", () => {
    const o = baseObservation();
    const r = reprocessObservation(o);
    expect(r.reprocessability).toBe("FULLY_REPROCESSABLE");
    expect(r.mae_mfe_status).toBe("RELIABLE");
    expect(r.direction_setup_label_changed).toBe(false);
    expect(r.mistake_classification_changed).toBe(false);
    expect(r.new_mistake_classification).toBe("CLEAN_WIN");
  });

  it("STOP_BEFORE_MOVE recovery: an old LOSS mislabeled by the pre-fix bug becomes VALIDATED direction/setup -- the sanitized example this audit asked for", () => {
    // Old bug: this observation's stored mistake_classification is
    // WRONG_DIRECTION (what the pre-fix labeling would have produced by
    // ignoring mfe_r entirely at the training-label layer), but the raw
    // stored mfe_r=0.9 proves price moved 0.9R favorably before the stop --
    // classifyMistake (unchanged, always correct) already computes
    // STOP_BEFORE_MOVE from this; the bug was successOrValidatedDirection
    // ignoring that distinction, not classifyMistake itself.
    const o = baseObservation({
      dedupe_key: "TEST:stop-before-move",
      outcome: { analytics_outcome: "LOSS", r_multiple: -1.0, mfe_r: 0.9, mae_r: -1.0, highest_tp_reached: null, time_to_resolution_seconds: 900 },
      mistake_classification: "WRONG_DIRECTION", // <- old, incorrect stored label
    });
    const r = reprocessObservation(o);
    expect(r.reprocessability).toBe("FULLY_REPROCESSABLE");
    expect(r.new_mistake_classification).toBe("STOP_BEFORE_MOVE");
    expect(r.mistake_classification_changed).toBe(true);
    expect(r.old_direction_setup_validated).toBe(false); // old: Direction=BAD, Setup=BAD
    expect(r.new_direction_setup_validated).toBe(true); // corrected: Direction=VALIDATED, Setup=VALIDATED
    expect(r.mae_mfe_status).toBe("RELIABLE"); // a LOSS was never in the TP1/TP2-continued-monitoring path
  });

  it("genuine WRONG_DIRECTION loss remains BAD after reprocessing -- proof this isn't just making the Brain optimistic", () => {
    const o = baseObservation({
      dedupe_key: "TEST:genuinely-bad",
      outcome: { analytics_outcome: "LOSS", r_multiple: -1.0, mfe_r: 0.05, mae_r: -0.95, highest_tp_reached: null, time_to_resolution_seconds: 300 }, // never moved favorably (0.05R < 0.2R threshold)
      mistake_classification: "WRONG_DIRECTION",
    });
    const r = reprocessObservation(o);
    expect(r.new_mistake_classification).toBe("WRONG_DIRECTION"); // unchanged -- correctly still bad
    expect(r.mistake_classification_changed).toBe(false);
    expect(r.new_direction_setup_validated).toBe(false);
    expect(r.direction_setup_label_changed).toBe(false);
  });

  it("TP1 win (high-MAE winner): direction/setup label unaffected, but MAE/MFE flagged HISTORICAL_PATH_UNCERTAIN, not silently trusted", () => {
    const o = baseObservation({
      dedupe_key: "TEST:tp1-high-mae",
      outcome: { analytics_outcome: "WIN", r_multiple: 1.0, mfe_r: 1.0, mae_r: -0.8, highest_tp_reached: 1, time_to_resolution_seconds: 1200 },
      mistake_classification: "HIGH_MAE_WIN",
    });
    const r = reprocessObservation(o);
    expect(r.new_direction_setup_validated).toBe(true); // WIN -- direction/setup validated regardless
    expect(r.direction_setup_label_changed).toBe(false); // was already correctly validated (WIN)
    expect(r.mae_mfe_status).toBe("HISTORICAL_PATH_UNCERTAIN"); // TP1 win -- monitoring may have continued
    expect(r.reprocessability).toBe("FULLY_REPROCESSABLE"); // label itself is fine; only the MAE/MFE sub-metric is uncertain
  });

  it("TP2 win: same HISTORICAL_PATH_UNCERTAIN treatment as TP1", () => {
    const o = baseObservation({ outcome: { analytics_outcome: "WIN", r_multiple: 2.0, mfe_r: 2.0, mae_r: -0.1, highest_tp_reached: 2, time_to_resolution_seconds: 900 } });
    expect(reprocessObservation(o).mae_mfe_status).toBe("HISTORICAL_PATH_UNCERTAIN");
  });

  it("TP3 win: MAE/MFE reliable -- monitoring naturally stops at TP3, never affected by the continued-monitoring bug", () => {
    const o = baseObservation({ outcome: { analytics_outcome: "WIN", r_multiple: 3.0, mfe_r: 3.0, mae_r: -0.05, highest_tp_reached: 3, time_to_resolution_seconds: 1500 } });
    expect(reprocessObservation(o).mae_mfe_status).toBe("RELIABLE");
  });

  it("unresolved/candidate observations are NOT_REPROCESSABLE -- no outcome label exists yet to reprocess", () => {
    const o = baseObservation({ decision_action: "CANDIDATE", outcome: null, resolved_at: null, mistake_classification: null });
    const r = reprocessObservation(o);
    expect(r.reprocessability).toBe("NOT_REPROCESSABLE");
  });

  it("a rejected/skipped observation (GOOD_REJECTION/MISSED_WINNER territory) is NOT_REPROCESSABLE by this tool -- it uses a different classification branch entirely, untouched by either bug", () => {
    const o = baseObservation({
      decision_action: "SKIPPED",
      outcome: null,
      resolved_at: "2026-07-01T01:00:00.000Z",
      mistake_classification: "GOOD_REJECTION",
      counterfactual: [{ offset: "IMMEDIATE", data_available: true, achieved_r: -0.5 } as never],
    });
    expect(reprocessObservation(o).reprocessability).toBe("NOT_REPROCESSABLE");
  });
});

describe("dryRunReprocess", () => {
  it("aggregates a mixed batch correctly and never mutates its input", () => {
    const cleanWin = baseObservation({ dedupe_key: "A" });
    const stopBeforeMove = baseObservation({
      dedupe_key: "B",
      outcome: { analytics_outcome: "LOSS", r_multiple: -1.0, mfe_r: 0.9, mae_r: -1.0, highest_tp_reached: null, time_to_resolution_seconds: 900 },
      mistake_classification: "WRONG_DIRECTION",
    });
    const genuinelyBad = baseObservation({
      dedupe_key: "C",
      outcome: { analytics_outcome: "LOSS", r_multiple: -1.0, mfe_r: 0.05, mae_r: -0.95, highest_tp_reached: null, time_to_resolution_seconds: 300 },
      mistake_classification: "WRONG_DIRECTION",
    });
    const tp1Win = baseObservation({
      dedupe_key: "D",
      outcome: { analytics_outcome: "WIN", r_multiple: 1.0, mfe_r: 1.0, mae_r: -0.8, highest_tp_reached: 1, time_to_resolution_seconds: 1200 },
      mistake_classification: "HIGH_MAE_WIN",
    });
    const unresolved = baseObservation({ dedupe_key: "E", decision_action: "CANDIDATE", outcome: null, resolved_at: null, mistake_classification: null });

    const inputSnapshot = JSON.stringify([cleanWin, stopBeforeMove, genuinelyBad, tp1Win, unresolved]);
    const report = dryRunReprocess([cleanWin, stopBeforeMove, genuinelyBad, tp1Win, unresolved]);

    expect(JSON.stringify([cleanWin, stopBeforeMove, genuinelyBad, tp1Win, unresolved])).toBe(inputSnapshot); // no mutation

    expect(report.total_observations).toBe(5);
    expect(report.resolved).toBe(4); // unresolved excluded
    expect(report.reprocessable).toBe(4); // cleanWin, stopBeforeMove, genuinelyBad, tp1Win
    expect(report.not_reprocessable).toBe(0); // unresolved isn't counted here -- it's filtered out of `resolved` entirely, matching the report's own "resolved" denominator
    expect(report.stop_before_move_recovered).toBe(1);
    expect(report.direction_labels_changed).toBe(1);
    expect(report.setup_labels_changed).toBe(1);
    expect(report.mae_mfe_corruption_suspected).toBe(1); // tp1Win only
    expect(report.mae_mfe_safely_reconstructed).toBe(0); // never guessed -- see module doc
    expect(report.mae_mfe_not_reconstructable).toBe(1);
    expect(report.unchanged_correct_observations).toBe(2); // cleanWin, genuinelyBad
  });

  it("empty input produces a well-formed zeroed report, not a crash", () => {
    const report = dryRunReprocess([]);
    expect(report.total_observations).toBe(0);
    expect(report.resolved).toBe(0);
    expect(report.reprocessable).toBe(0);
  });
});
