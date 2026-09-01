import { describe, expect, it } from "vitest";
import { advancePersistedSignal } from "./marketOutlookLifecycle.js";

/**
 * advancePersistedSignal is the pure state machine that computes every
 * OUTLOOK-sourced observation's mae_r/mfe_r/analytics_outcome -- it feeds
 * directly into Global Brain training data, so its direction math,
 * terminal-condition freezing, and TP-priority rule are safety-critical.
 * Had no dedicated test file before this session.
 */

function baseDoc(direction: "BUY" | "SELL", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const entry = 2650.0;
  const risk = 5.0; // XAUCLOUD_R_UNIT_GOLD_MOVES convention used elsewhere in this codebase
  const tp1 = direction === "BUY" ? entry + 5 : entry - 5; // 1R
  const tp2 = direction === "BUY" ? entry + 10 : entry - 10; // 2R
  const tp3 = direction === "BUY" ? entry + 20 : entry - 20; // 4R
  const sl = direction === "BUY" ? entry - risk : entry + risk;
  return {
    primary_direction: direction,
    tracking_entry_price: entry,
    risk_distance: risk,
    original_sl: sl,
    tp1_price: tp1,
    tp2_price: tp2,
    tp3_price: tp3,
    analytics_outcome: null,
    current_r: 0,
    mfe_r: 0,
    mae_r: 0,
    milestones_hit: [],
    evaluation_deadline: null,
    expiry_at: null,
    ...overrides,
  };
}

describe("advancePersistedSignal -- MAE/MFE/outcome state machine", () => {
  it("BUY: values on bid, currentR/mfeR/maeR use symmetric (close-entry)/risk math", () => {
    const doc = baseDoc("BUY");
    const [u1] = advancePersistedSignal(doc, 2653, 2653.2, new Date("2026-01-01T00:01:00Z"));
    expect(u1["current_r"]).toBeCloseTo((2653 - 2650) / 5, 6);
    expect(u1["mfe_r"]).toBeCloseTo(0.6, 6);
    expect(u1["mae_r"]).toBe(0);
  });

  it("SELL: values on ask, currentR/mfeR/maeR mirror BUY's math exactly (entry-close)/risk", () => {
    const doc = baseDoc("SELL");
    const [u1] = advancePersistedSignal(doc, 2646.8, 2647, new Date("2026-01-01T00:01:00Z"));
    expect(u1["current_r"]).toBeCloseTo((2650 - 2647) / 5, 6);
    expect(u1["mfe_r"]).toBeCloseTo(0.6, 6);
    expect(u1["mae_r"]).toBe(0);
  });

  it("BUY: mae_r is the running worst excursion, floored at 0, and never recovers upward once set", () => {
    let doc = baseDoc("BUY");
    let [u1] = advancePersistedSignal(doc, 2647, 2647.2, new Date("2026-01-01T00:01:00Z")); // -0.6R adverse
    expect(u1["mae_r"]).toBeCloseTo(-0.6, 6);
    doc = { ...doc, ...u1 };
    const [u2] = advancePersistedSignal(doc, 2652, 2652.2, new Date("2026-01-01T00:02:00Z")); // recovers to +0.4R
    expect(u2["current_r"]).toBeCloseTo(0.4, 6);
    expect(u2["mae_r"]).toBeCloseTo(-0.6, 6); // the worst point survives, not overwritten by the recovery
    expect(u2["mfe_r"]).toBeCloseTo(0.4, 6);
  });

  it("SELL: mae_r worst-excursion tracking mirrors BUY's, direction-correctly (adverse = price moving up against a SELL)", () => {
    let doc = baseDoc("SELL");
    let [u1] = advancePersistedSignal(doc, 2652.8, 2653, new Date("2026-01-01T00:01:00Z")); // price up 3 -> -0.6R adverse for a SELL
    expect(u1["mae_r"]).toBeCloseTo(-0.6, 6);
    doc = { ...doc, ...u1 };
    const [u2] = advancePersistedSignal(doc, 2647.8, 2648, new Date("2026-01-01T00:02:00Z")); // ask down 2 from entry -> +0.4R favorable
    expect(u2["current_r"]).toBeCloseTo(0.4, 6);
    expect(u2["mae_r"]).toBeCloseTo(-0.6, 6);
  });

  it("TP1 touch classifies WIN immediately; a later SL touch in the same tracking window never flips a confirmed win back to a loss", () => {
    let doc = baseDoc("BUY");
    let [u1] = advancePersistedSignal(doc, 2655.5, 2655.7, new Date("2026-01-01T00:05:00Z")); // touches TP1 (2655)
    expect(u1["analytics_outcome"]).toBe("WIN");
    expect(u1["tp1_hit_at"]).toBeTruthy();
    expect(u1["monitoring_closed"]).toBe(false); // TP1 only -- still open for TP2/TP3
    doc = { ...doc, ...u1 };
    const [u2] = advancePersistedSignal(doc, 2643, 2643.2, new Date("2026-01-01T00:10:00Z")); // crashes through the SL afterward
    expect(u2["analytics_outcome"]).toBe("WIN"); // owner-approved rule: highest TP touched wins, never reverts
    expect(u2["latest_path_event"]).toBe("LATER_SL_AFTER_WIN");
  });

  it("TP3 touch closes monitoring immediately (the only mid-window terminal event besides an undeadlined SL)", () => {
    const doc = baseDoc("BUY");
    const [u1] = advancePersistedSignal(doc, 2670.5, 2670.7, new Date("2026-01-01T00:05:00Z")); // touches TP3 (2670)
    expect(u1["analytics_outcome"]).toBe("WIN");
    expect(u1["monitoring_closed"]).toBe(true);
  });

  it("no TP touched, undeadlined SL hit: classifies LOSS and closes monitoring immediately", () => {
    const doc = baseDoc("BUY");
    const [u1] = advancePersistedSignal(doc, 2644.5, 2644.7, new Date("2026-01-01T00:05:00Z")); // below SL (2645)
    expect(u1["analytics_outcome"]).toBe("LOSS");
    expect(u1["signal_state"]).toBe("LOSS_RED_SL");
    expect(u1["monitoring_closed"]).toBe(true);
  });

  it("deadline reached with no TP touched: freezes analytics_r/classification_at/resolved_at at the deadline moment, not a later re-observation", () => {
    const deadline = new Date("2026-01-01T01:00:00Z");
    const doc = baseDoc("BUY", { evaluation_deadline: deadline.toISOString() });
    // At the deadline tick itself, price is +0.3R (a genuine partial profit).
    const [u1] = advancePersistedSignal(doc, 2651.5, 2651.7, deadline);
    expect(u1["analytics_outcome"]).toBe("PARTIAL_PROFIT");
    expect(u1["analytics_r"]).toBeCloseTo(0.3, 6);
    expect(u1["classification_at"]).toBe(deadline.toISOString());
    expect(u1["resolved_at"]).toBe(deadline.toISOString());
    expect(u1["monitoring_closed"]).toBe(false); // deadline != expiry -- can stay open for late TP upgrades, but the outcome/R is already frozen
  });

  it("does not leak later price movement into an already-frozen deadline outcome: a subsequent tick after the deadline never changes analytics_r/classification_at once outcome is set (only current_r/mfe_r/mae_r, which the ingest boundary never re-reads once terminal)", async () => {
    const deadline = new Date("2026-01-01T01:00:00Z");
    let doc = baseDoc("BUY", { evaluation_deadline: deadline.toISOString() });
    const [u1] = advancePersistedSignal(doc, 2651.5, 2651.7, deadline);
    expect(u1["analytics_r"]).toBeCloseTo(0.3, 6);
    doc = { ...doc, ...u1 };
    // A much later, much more favorable tick -- simulates the market continuing
    // to move after this signal was already terminally classified.
    const [u2] = advancePersistedSignal(doc, 2665, 2665.2, new Date("2026-01-01T02:30:00Z"));
    expect(u2["analytics_r"]).toBeCloseTo(0.3, 6); // unchanged -- outcome was already non-null, so the classification branch never re-runs
    expect(u2["classification_at"]).toBe(deadline.toISOString()); // unchanged
    expect(u2["resolved_at"]).toBe(deadline.toISOString()); // unchanged
  });
});
