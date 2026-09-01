import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
// dispatchSignalEvent does push/email dispatch work irrelevant to this
// test -- stub it out so persistSignalOutcome's own behavior is isolated.
vi.mock("./marketOutlookPublish.js", () => ({ dispatchSignalEvent: vi.fn(async () => undefined) }));

const { persistSignalOutcome } = await import("./marketOutlookTick.js");

function terminalOutlookDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "outlook-terminal-1",
    account: "acct-1",
    symbol: "XAUUSD",
    primary_direction: "BUY",
    analytics_outcome: "WIN",
    analytics_r: 0.5,
    signal_state: "TP1_WIN",
    classification_at: "2026-01-01T00:10:00.000Z",
    tracking_entry_price: 2000,
    original_sl: 1995,
    risk_distance: 5,
    mfe_r: 0.5,
    mae_r: -0.1,
    highest_tp_reached: 1,
    confidence_pct: 70,
    setup_type: "BREAKOUT",
    session: "LONDON",
    market_regime: "TRENDING",
    current_r: 0.5,
    published_quote_at: "2026-01-01T00:00:00.000Z",
    published_at: "2026-01-01T00:00:00.000Z",
    evaluation_deadline: "2026-01-01T01:00:00.000Z",
    tp1_price: 2005,
    tp2_price: 2010,
    tp3_price: 2015,
    ...overrides,
  };
}

describe("persistSignalOutcome -- Global Brain observation hook", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("still persists cloud_market_outlook_outcomes exactly as before (unchanged behavior)", async () => {
    await persistSignalOutcome(terminalOutlookDoc());
    const outcomes = state.db.collection("cloud_market_outlook_outcomes").docs;
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!["outlook_id"]).toBe("outlook-terminal-1");
    expect(outcomes[0]!["analytics_outcome"]).toBe("WIN");
  });

  it("also records a global-brain observation for an actionable terminal signal, using the same quote journey", async () => {
    await state.db.collection("cloud_bot_activity").insertOne({
      account: "acct-1",
      ts: "2026-01-01T00:05:00.000Z",
      details: { market_thesis: { live_bid: 2006, live_ask: 2006.2 } },
    });

    await persistSignalOutcome(terminalOutlookDoc());

    const observations = state.db.collection("global_brain_observations").docs;
    expect(observations).toHaveLength(1);
    expect(observations[0]!["source"]).toBe("OUTLOOK");
    expect(observations[0]!["dedupe_key"]).toBe("OUTLOOK:outlook-terminal-1");
    expect(observations[0]!["counterfactual"]).not.toBeNull();
  });

  it("does not record a global-brain observation for a non-terminal outcome (persistSignalOutcome itself no-ops)", async () => {
    await persistSignalOutcome(terminalOutlookDoc({ analytics_outcome: null }));
    expect(state.db.collection("cloud_market_outlook_outcomes").docs).toHaveLength(0);
    expect(state.db.collection("global_brain_observations").docs).toHaveLength(0);
  });

  it("a Global Brain ingestion failure never breaks the outcome-persistence write it rides along with", async () => {
    const realCollection = state.db.collection.bind(state.db);
    const brokenDb = {
      collection: (name: string) => {
        if (name === "cloud_bot_activity") throw new Error("simulated read failure");
        return realCollection(name);
      },
    };
    state.db = brokenDb as unknown as FakeDb;
    await expect(persistSignalOutcome(terminalOutlookDoc())).resolves.toBeUndefined();
  });
});
