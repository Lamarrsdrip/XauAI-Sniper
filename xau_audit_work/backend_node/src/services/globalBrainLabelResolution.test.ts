import { describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "test-secret";
});
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
state.db = new FakeDb();

const { classifyMistake } = await import("./globalBrainMistakeClassifier.js");
const { QUESTION_SPECS } = await import("./globalBrainTraining.js");
import type { GlobalBrainObservation, CounterfactualEntryResult } from "../models/globalBrain.js";

/**
 * PHASE 0 AUDIT: proves the Global Brain learns from the full trade
 * experience (direction + entry timing + setup + TP/SL path + calibration
 * as five INDEPENDENT learning targets), not a single collapsed WIN/LOSS
 * boolean -- and specifically proves the two labeling bugs found during
 * this audit are fixed:
 *
 *  1. A LOSS with genuine favorable movement first (classifyMistake's
 *     STOP_BEFORE_MOVE) must count as a validated direction/setup call for
 *     DIRECTION_QUALITY/SETUP_QUALITY, not an indistinguishable failure --
 *     see globalBrainTraining.ts's successOrValidatedDirection.
 *  2. A resolved observation's outcome must never be silently overwritten
 *     by later re-ingestion (see globalBrainIngest.test.ts's "first
 *     resolution wins" tests for the ingestion-boundary half of this proof;
 *     marketOutlookLifecycle.test.ts already proves MFE is a monotonic
 *     running max/peak that a later reversal can never erase, and that a
 *     TP touch permanently locks in WIN regardless of a later SL touch).
 *
 * Test cases below are lettered to match the user-specified deterministic
 * scenarios (A-I) audited in this session; each constructs the
 * GlobalBrainObservation an already-tested upstream stage (marketOutlook
 * Lifecycle's advancePersistedSignal / globalBrainMistakeClassifier's
 * classifyMistake) would have produced for that price path, then checks
 * what the five QUESTION_SPECS actually label it.
 */

function cf(offset: CounterfactualEntryResult["offset"], achieved_r: number | null, data_available = true): CounterfactualEntryResult {
  return { offset, entry_price: achieved_r === null ? null : 2000, achieved_r, data_available };
}

function baseObservation(overrides: Partial<GlobalBrainObservation> = {}): GlobalBrainObservation {
  return {
    dedupe_key: "TEST:1",
    source: "OUTLOOK",
    account_ref: "hash1",
    decision_action: "EXECUTED",
    features: {
      symbol: "XAUUSD",
      direction: "BUY",
      session: "LONDON",
      regime: "TRENDING",
      structure_state: "",
      setup_type: "BREAKOUT",
      confidence_pct: 70,
      hive_verdict: null,
      hive_win_rate: null,
    },
    outcome: null,
    mistake_classification: null,
    counterfactual: null,
    decision_at: "2026-01-01T00:00:00.000Z",
    resolved_at: "2026-01-01T00:05:00.000Z",
    source_ref: { collection: "cloud_market_outlooks", id: "1" },
    created_at: "2026-01-01T00:05:01.000Z",
    ...overrides,
  };
}

/** Runs the item through every QUESTION_SPEC it is eligible for, returning the isSuccess label (or "N/A" if ineligible). */
function labelsFor(o: GlobalBrainObservation): Record<string, boolean | "N/A"> {
  const out: Record<string, boolean | "N/A"> = {};
  for (const [question, spec] of Object.entries(QUESTION_SPECS)) {
    out[question] = spec.eligible(o) ? spec.isSuccess(o) : "N/A";
  }
  return out;
}

describe("Phase 0: independent learning labels across the five objectives", () => {
  it("CASE A -- clean win: all applicable objectives GOOD", () => {
    // BUY 5000 -> 5002 -> 5005 -> 5008 -> 5010 (TP), SL 4990. No adverse excursion.
    const outcome = { analytics_outcome: "WIN", r_multiple: 1.0, mfe_r: 1.0, mae_r: 0.0, highest_tp_reached: 1, time_to_resolution_seconds: 300 };
    const mistake = classifyMistake({ decision_action: "EXECUTED", ...outcome, counterfactual: null });
    expect(mistake).toBe("CLEAN_WIN");
    const o = baseObservation({ outcome, mistake_classification: mistake });
    const labels = labelsFor(o);
    expect(labels["DIRECTION_QUALITY"]).toBe(true);
    expect(labels["TP_BEFORE_SL"]).toBe(true);
    expect(labels["SETUP_QUALITY"]).toBe(true);
    expect(labels["CALIBRATION"]).toBe(true);
  });

  it("CASE B -- high-drawdown winner: direction/TP-before-SL still GOOD, but entry timing must NOT equal Case A", () => {
    // BUY 5000, dips to 4991 (MAE -0.9R vs a 10-point stop), recovers, TP 5010.
    const outcome = { analytics_outcome: "WIN", r_multiple: 1.0, mfe_r: 1.0, mae_r: -0.9, highest_tp_reached: 1, time_to_resolution_seconds: 600 };
    const mistake = classifyMistake({ decision_action: "EXECUTED", ...outcome, counterfactual: null });
    expect(mistake).toBe("HIGH_MAE_WIN");
    expect(mistake).not.toBe("CLEAN_WIN"); // must not equal Case A's label
    const o = baseObservation({ outcome, mistake_classification: mistake, counterfactual: [cf("IMMEDIATE", 1.0)] });
    const labels = labelsFor(o);
    expect(labels["DIRECTION_QUALITY"]).toBe(true); // direction call was right
    expect(labels["TP_BEFORE_SL"]).toBe(true); // TP genuinely reached
    // ENTRY_TIMING explicitly excludes HIGH_MAE_WIN from success -- poor entry, not a clean one.
    expect(QUESTION_SPECS.ENTRY_TIMING.eligible(o)).toBe(true);
    expect(labels["ENTRY_TIMING"]).toBe(false);
  });

  it("CASE C -- profit first, then SL: direction/setup validated by real favorable movement, NOT collapsed to plain WRONG_DIRECTION", () => {
    // BUY 5000 -> +9pts favorable (MFE preserved as a running max per
    // marketOutlookLifecycle's Math.max) -> reverses -> SL. No TP defined.
    const outcome = { analytics_outcome: "LOSS", r_multiple: -1.0, mfe_r: 0.9, mae_r: -1.0, highest_tp_reached: 0, time_to_resolution_seconds: 900 };
    const mistake = classifyMistake({ decision_action: "EXECUTED", ...outcome, counterfactual: null });
    expect(mistake).toBe("STOP_BEFORE_MOVE"); // not WRONG_DIRECTION -- the fix under test
    const o = baseObservation({ outcome, mistake_classification: mistake });
    const labels = labelsFor(o);
    // DIRECTION GOOD (validated by real movement), EXIT/management is what failed --
    // this codebase does not yet have a separate exit-quality objective (documented gap).
    expect(labels["DIRECTION_QUALITY"]).toBe(true);
    expect(labels["SETUP_QUALITY"]).toBe(true);
    // TP_BEFORE_SL correctly still FALSE: no target was actually reached before the negative close.
    expect(labels["TP_BEFORE_SL"]).toBe(false);
  });

  it("CASE C (contrast) -- a genuine wrong-direction loss with no favorable move IS a DIRECTION_QUALITY failure", () => {
    const outcome = { analytics_outcome: "LOSS", r_multiple: -1.0, mfe_r: 0.05, mae_r: -1.0, highest_tp_reached: 0, time_to_resolution_seconds: 900 };
    const mistake = classifyMistake({ decision_action: "EXECUTED", ...outcome, counterfactual: null });
    expect(mistake).toBe("WRONG_DIRECTION");
    const o = baseObservation({ outcome, mistake_classification: mistake });
    expect(labelsFor(o)["DIRECTION_QUALITY"]).toBe(false);
  });

  it("CASE D -- bad trade: straight to SL, minimal MFE -- all applicable objectives BAD", () => {
    const outcome = { analytics_outcome: "LOSS", r_multiple: -1.0, mfe_r: 0.0, mae_r: -1.0, highest_tp_reached: 0, time_to_resolution_seconds: 400 };
    const mistake = classifyMistake({ decision_action: "EXECUTED", ...outcome, counterfactual: null });
    expect(mistake).toBe("WRONG_DIRECTION");
    const o = baseObservation({ outcome, mistake_classification: mistake });
    const labels = labelsFor(o);
    expect(labels["DIRECTION_QUALITY"]).toBe(false);
    expect(labels["SETUP_QUALITY"]).toBe(false);
    expect(labels["TP_BEFORE_SL"]).toBe(false);
  });

  it("CASE E -- high-MAE winner: winner, but poor entry quality (same shape as Case B, deeper MAE)", () => {
    const outcome = { analytics_outcome: "WIN", r_multiple: 1.2, mfe_r: 1.2, mae_r: -0.7, highest_tp_reached: 1, time_to_resolution_seconds: 500 };
    const mistake = classifyMistake({ decision_action: "EXECUTED", ...outcome, counterfactual: null });
    expect(mistake).toBe("HIGH_MAE_WIN");
    const o = baseObservation({ outcome, mistake_classification: mistake, counterfactual: [cf("IMMEDIATE", 1.2)] });
    const labels = labelsFor(o);
    expect(labels["DIRECTION_QUALITY"]).toBe(true); // still a winner
    expect(labels["ENTRY_TIMING"]).toBe(false); // but poor entry quality
  });

  it("CASE F -- WAIT would have helped: entry timing correctly flags WAIT_IMPROVED_ENTRY", () => {
    // Immediate entry gets chopped (+0.1R); waiting would have captured +1.5R.
    const mistake = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 0.1,
      mfe_r: 0.5,
      mae_r: -0.3,
      counterfactual: [cf("IMMEDIATE", 0.1), cf("PLUS_2MIN", 1.5)],
    });
    expect(mistake).toBe("WAIT_IMPROVED_ENTRY");
  });

  it("CASE G -- WAIT would have hurt (runaway winner): entry timing does NOT reward waiting", () => {
    // Immediate entry captures the full run; a delayed entry would have captured meaningfully less.
    const mistake = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 1.8,
      mfe_r: 1.8,
      mae_r: 0.0,
      counterfactual: [cf("IMMEDIATE", 1.8), cf("PLUS_2MIN", 0.6)],
    });
    expect(mistake).not.toBe("WAIT_IMPROVED_ENTRY");
    expect(mistake).toBe("WAIT_HURT_ENTRY");
  });

  it("CASE H -- rejected winner: FALSE_REJECTION / MISSED_WINNER, counts against over-filtering", () => {
    const mistake = classifyMistake({
      decision_action: "SKIPPED",
      analytics_outcome: null,
      r_multiple: null,
      mfe_r: null,
      mae_r: null,
      counterfactual: [cf("IMMEDIATE", 1.0)],
    });
    expect(mistake).toBe("MISSED_WINNER");
  });

  it("CASE I -- good rejection: system correctly avoided a loser", () => {
    const mistake = classifyMistake({
      decision_action: "SKIPPED",
      analytics_outcome: null,
      r_multiple: null,
      mfe_r: null,
      mae_r: null,
      counterfactual: [cf("IMMEDIATE", -1.0)],
    });
    expect(mistake).toBe("GOOD_REJECTION");
  });

  it("SECTION 8 -- one observation can produce a genuinely mixed label combination across the five objectives (not all collapsed from one WIN/LOSS boolean)", () => {
    // High-MAE winner with a confirmed setup_type: DIRECTION good, ENTRY bad, TP_BEFORE_SL true, SETUP good, CALIBRATION good.
    const outcome = { analytics_outcome: "WIN", r_multiple: 1.0, mfe_r: 1.0, mae_r: -0.8, highest_tp_reached: 1, time_to_resolution_seconds: 500 };
    const mistake = classifyMistake({ decision_action: "EXECUTED", ...outcome, counterfactual: null });
    const o = baseObservation({ outcome, mistake_classification: mistake, counterfactual: [cf("IMMEDIATE", 1.0)] });
    const labels = labelsFor(o);
    expect(labels).toMatchObject({
      DIRECTION_QUALITY: true,
      ENTRY_TIMING: false,
      TP_BEFORE_SL: true,
      SETUP_QUALITY: true,
      CALIBRATION: true,
    });
    // Proves at least one objective disagrees with the others -- not a single collapsed boolean.
    const values = Object.values(labels).filter((v): v is boolean => typeof v === "boolean");
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});
