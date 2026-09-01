import { describe, expect, it } from "vitest";
import { classifyMistake } from "./globalBrainMistakeClassifier.js";
import type { CounterfactualEntryResult } from "../models/globalBrain.js";

function cf(offset: CounterfactualEntryResult["offset"], achieved_r: number | null, data_available = true): CounterfactualEntryResult {
  return { offset, entry_price: achieved_r === null ? null : 2000, achieved_r, data_available };
}

describe("classifyMistake", () => {
  it("classifies a rejected setup that would have won as MISSED_WINNER", () => {
    const result = classifyMistake({
      decision_action: "SKIPPED",
      analytics_outcome: null,
      r_multiple: null,
      mfe_r: null,
      mae_r: null,
      counterfactual: [cf("IMMEDIATE", 1.2)],
    });
    expect(result).toBe("MISSED_WINNER");
  });

  it("classifies a rejected setup that would have lost as GOOD_REJECTION", () => {
    const result = classifyMistake({
      decision_action: "SKIPPED",
      analytics_outcome: null,
      r_multiple: null,
      mfe_r: null,
      mae_r: null,
      counterfactual: [cf("IMMEDIATE", -1.0)],
    });
    expect(result).toBe("GOOD_REJECTION");
  });

  it("classifies a rejected setup with no counterfactual data as UNCLASSIFIED, never guessed", () => {
    const result = classifyMistake({
      decision_action: "SKIPPED",
      analytics_outcome: null,
      r_multiple: null,
      mfe_r: null,
      mae_r: null,
      counterfactual: null,
    });
    expect(result).toBe("UNCLASSIFIED");
  });

  it("classifies a pending CANDIDATE as UNCLASSIFIED regardless of other fields", () => {
    const result = classifyMistake({
      decision_action: "CANDIDATE",
      analytics_outcome: null,
      r_multiple: null,
      mfe_r: null,
      mae_r: null,
      counterfactual: null,
    });
    expect(result).toBe("UNCLASSIFIED");
  });

  it("classifies a loss with barely any favorable move as WRONG_DIRECTION", () => {
    const result = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "LOSS",
      r_multiple: -1.0,
      mfe_r: 0.05,
      mae_r: -1.0,
      counterfactual: null,
    });
    expect(result).toBe("WRONG_DIRECTION");
  });

  it("classifies a loss that moved favorably first as STOP_BEFORE_MOVE", () => {
    const result = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "LOSS",
      r_multiple: -1.0,
      mfe_r: 0.6,
      mae_r: -1.0,
      counterfactual: null,
    });
    expect(result).toBe("STOP_BEFORE_MOVE");
  });

  it("classifies partial profit / break-even as GOOD_DECISION_BAD_OUTCOME", () => {
    expect(
      classifyMistake({ decision_action: "EXECUTED", analytics_outcome: "PARTIAL_PROFIT", r_multiple: 0.2, mfe_r: 0.3, mae_r: 0, counterfactual: null }),
    ).toBe("GOOD_DECISION_BAD_OUTCOME");
    expect(
      classifyMistake({ decision_action: "EXECUTED", analytics_outcome: "BREAK_EVEN", r_multiple: 0.0, mfe_r: 0.1, mae_r: -0.1, counterfactual: null }),
    ).toBe("GOOD_DECISION_BAD_OUTCOME");
  });

  it("classifies a clean win with no timing signal as CLEAN_WIN", () => {
    const result = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 1.0,
      mfe_r: 1.0,
      mae_r: -0.1,
      counterfactual: [cf("IMMEDIATE", 1.02)], // within margin of actual -- no meaningful timing difference
    });
    expect(result).toBe("CLEAN_WIN");
  });

  it("classifies a win where immediate entry would have captured meaningfully more R as ENTRY_TOO_LATE", () => {
    const result = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 0.5,
      mfe_r: 0.5,
      mae_r: 0,
      counterfactual: [cf("IMMEDIATE", 1.0)],
    });
    expect(result).toBe("ENTRY_TOO_LATE");
  });

  it("classifies a win where waiting would have captured more R as WAIT_IMPROVED_ENTRY", () => {
    const result = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 0.5,
      mfe_r: 0.5,
      mae_r: 0,
      counterfactual: [cf("IMMEDIATE", 0.48), cf("PLUS_1MIN", 1.2), cf("PLUS_2MIN", 1.1), cf("PLUS_3MIN", 0.9)],
    });
    expect(result).toBe("WAIT_IMPROVED_ENTRY");
  });

  it("classifies a win where a delayed entry would have captured meaningfully less R as WAIT_HURT_ENTRY", () => {
    const result = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 1.0,
      mfe_r: 1.0,
      mae_r: 0,
      counterfactual: [cf("IMMEDIATE", 1.0), cf("PLUS_1MIN", 0.7), cf("PLUS_2MIN", 0.6), cf("PLUS_3MIN", 0.5)],
    });
    expect(result).toBe("WAIT_HURT_ENTRY");
  });

  it("classifies a win with deep adverse excursion first as HIGH_MAE_WIN, not CLEAN_WIN", () => {
    const result = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 1.0,
      mfe_r: 1.4,
      mae_r: -0.8, // consumed 80% of the stop distance before turning around
      counterfactual: [cf("IMMEDIATE", 1.02)], // no meaningful timing signal
    });
    expect(result).toBe("HIGH_MAE_WIN");
  });

  it("Trade A (small MAE, R=1.2 winner) vs Trade B (large MAE, the SAME R=1.2 winner): these must not be treated as equivalent entry quality", () => {
    const tradeA = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 1.2,
      mfe_r: 1.2,
      mae_r: -0.1, // barely dipped before running
      counterfactual: null,
    });
    const tradeB = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 1.2,
      mfe_r: 1.3,
      mae_r: -0.7, // same eventual winner, but survived deep adverse excursion first
      counterfactual: null,
    });
    expect(tradeA).toBe("CLEAN_WIN");
    expect(tradeB).toBe("HIGH_MAE_WIN");
    expect(tradeA).not.toBe(tradeB);
  });

  it("keeps a win with shallow adverse excursion as CLEAN_WIN (threshold boundary)", () => {
    const result = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 1.0,
      mfe_r: 1.0,
      mae_r: -0.49,
      counterfactual: null,
    });
    expect(result).toBe("CLEAN_WIN");
  });

  it("prefers an entry-timing mistake over HIGH_MAE_WIN when both are present", () => {
    const result = classifyMistake({
      decision_action: "EXECUTED",
      analytics_outcome: "WIN",
      r_multiple: 0.5,
      mfe_r: 0.5,
      mae_r: -0.9,
      counterfactual: [cf("IMMEDIATE", 1.0)],
    });
    expect(result).toBe("ENTRY_TOO_LATE");
  });

  it("returns UNCLASSIFIED for an EXECUTED item with no outcome yet", () => {
    const result = classifyMistake({ decision_action: "EXECUTED", analytics_outcome: null, r_multiple: null, mfe_r: null, mae_r: null, counterfactual: null });
    expect(result).toBe("UNCLASSIFIED");
  });
});
