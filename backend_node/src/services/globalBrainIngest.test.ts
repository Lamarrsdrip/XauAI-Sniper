import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "test-secret";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { buildBotTradeObservation, buildOutlookObservation, buildShadowCandidateObservation, buildM10CandidateObservation, recordGlobalBrainObservation } =
  await import("./globalBrainIngest.js");

describe("buildBotTradeObservation", () => {
  it("uses the EA's own real R-multiple outcome fields, never re-derives them", () => {
    const tradeDoc = {
      trade_identity: '["12345","999"]',
      license_id: "lic-abc",
      symbol: "XAUUSDm",
      direction: "BUY",
      result: "WIN",
      final_r: 1.4,
      mae_r: -0.2,
      mfe_r: 1.6,
      closed_at: 1_700_003_600,
      opened_at: 1_700_000_000,
      regime: "TRENDING",
      setup: "BREAKOUT",
    };
    const shadowDoc = { hive_verdict: "BOOST", hive_win_rate: 0.65, decision_time_utc: "2023-11-14T22:13:20.000Z", actual_action: "EXECUTED" };
    const obs = buildBotTradeObservation(tradeDoc, shadowDoc);

    expect(obs.source).toBe("BOT_TRADE");
    expect(obs.decision_action).toBe("EXECUTED");
    expect(obs.outcome?.r_multiple).toBe(1.4);
    expect(obs.outcome?.mae_r).toBe(-0.2);
    expect(obs.outcome?.mfe_r).toBe(1.6);
    expect(obs.outcome?.analytics_outcome).toBe("WIN");
    expect(obs.mistake_classification).toBe("CLEAN_WIN");
    expect(obs.features.hive_verdict).toBe("BOOST");
    expect(obs.dedupe_key).toBe('BOT_TRADE:["12345","999"]');
  });

  it("never stores the raw account identity -- only a one-way hash", () => {
    const obs = buildBotTradeObservation({ trade_identity: "t1", license_id: "SUPER-SECRET-LICENSE-ID", symbol: "XAUUSD", direction: "SELL" }, null);
    expect(obs.account_ref).not.toContain("SUPER-SECRET-LICENSE-ID");
    expect(obs.account_ref).toMatch(/^[0-9a-f]{32}$/);
  });

  it("classifies a loss with an early favorable move as STOP_BEFORE_MOVE using the EA's own mfe_r", () => {
    const obs = buildBotTradeObservation(
      { trade_identity: "t2", symbol: "XAUUSD", direction: "SELL", result: "LOSS", final_r: -1.0, mfe_r: 0.7, mae_r: -1.0 },
      null,
    );
    expect(obs.mistake_classification).toBe("STOP_BEFORE_MOVE");
  });

  it("has no outcome for a trade with no result yet (defensive -- should not normally be called before close)", () => {
    const obs = buildBotTradeObservation({ trade_identity: "t3", symbol: "XAUUSD", direction: "BUY", result: "" }, null);
    expect(obs.outcome).toBeNull();
  });
});

describe("buildShadowCandidateObservation", () => {
  it("captures a rejected/skipped setup with no outcome, honestly UNCLASSIFIED", () => {
    const obs = buildShadowCandidateObservation({
      signature: "1|2|3|4|5|6|7",
      account: 12345,
      symbol: "XAUUSDm",
      direction: "SELL",
      regime: "RANGE",
      setup_type: "REVERSAL",
      hive_verdict: "VETO",
      decision_time_utc: "2026-01-01T00:00:00.000Z",
    });
    expect(obs.source).toBe("BOT_TRADE");
    expect(obs.decision_action).toBe("SKIPPED");
    expect(obs.outcome).toBeNull();
    expect(obs.mistake_classification).toBe("UNCLASSIFIED");
    expect(obs.dedupe_key).toContain("BOT_TRADE_CANDIDATE:1|2|3|4|5|6|7");
  });
});

describe("buildOutlookObservation", () => {
  it("returns null for a non-actionable (NO_TRADE) outlook doc", () => {
    expect(buildOutlookObservation({ id: "o1", primary_direction: "NO_VALID_OUTLOOK" }, [])).toBeNull();
  });

  it("builds a full OUTLOOK observation with counterfactual data from the quote journey", () => {
    const publishedAt = "2026-01-01T00:00:00.000Z";
    const deadline = "2026-01-01T01:00:00.000Z";
    const doc = {
      id: "outlook-1",
      account: "acct-1",
      symbol: "XAUUSD",
      primary_direction: "BUY",
      session: "LONDON",
      market_regime: "TRENDING",
      structure_state: "STRUCTURE_SUPPORTS",
      setup_type: "BREAKOUT",
      confidence_pct: 72,
      published_quote_at: publishedAt,
      published_at: publishedAt,
      evaluation_deadline: deadline,
      classification_at: "2026-01-01T00:10:00.000Z",
      tp1_price: 2005,
      tp2_price: 2010,
      tp3_price: 2015,
      original_sl: 1995,
      analytics_outcome: "WIN",
      analytics_r: 0.5,
      mfe_r: 0.5,
      mae_r: -0.1,
      highest_tp_reached: 1,
    };
    const quotes: [number, number, Date][] = [
      [2000, 2000.2, new Date(publishedAt)],
      [2006, 2006.2, new Date("2026-01-01T00:05:00.000Z")],
    ];
    const obs = buildOutlookObservation(doc, quotes);
    expect(obs).not.toBeNull();
    expect(obs!.source).toBe("OUTLOOK");
    expect(obs!.outcome?.analytics_outcome).toBe("WIN");
    expect(obs!.counterfactual).not.toBeNull();
    expect(obs!.counterfactual!.length).toBe(4);
    expect(obs!.dedupe_key).toBe("OUTLOOK:outlook-1");
  });

  it("tags the observation source as M10 when publication_mode is M10_SIGNAL -- same pipeline, correct attribution", () => {
    const publishedAt = "2026-01-01T00:00:00.000Z";
    const obs = buildOutlookObservation(
      {
        id: "m10-outlook-1",
        account: "acct-1",
        symbol: "XAUUSD",
        primary_direction: "BUY",
        publication_mode: "M10_SIGNAL",
        published_quote_at: publishedAt,
        published_at: publishedAt,
        evaluation_deadline: "2026-01-01T01:00:00.000Z",
        classification_at: "2026-01-01T00:10:00.000Z",
        analytics_outcome: "WIN",
        analytics_r: 0.5,
      },
      [],
    );
    expect(obs!.source).toBe("M10");
    expect(obs!.dedupe_key).toBe("M10:m10-outlook-1");
  });
});

describe("buildM10CandidateObservation", () => {
  it("returns null for a still-transient WATCHING event (not a decision)", () => {
    expect(buildM10CandidateObservation({ event_type: "WATCHING", candidate_id: "c1" })).toBeNull();
  });

  it("returns null for an ACTIONABLE event (already captured by buildOutlookObservation instead)", () => {
    expect(buildM10CandidateObservation({ event_type: "ACTIONABLE_SIGNAL", candidate_id: "c1" })).toBeNull();
  });

  it("builds an EXPIRED M10 observation with decision-time features only, honestly UNCLASSIFIED", () => {
    const obs = buildM10CandidateObservation({
      event_type: "EXPIRED",
      candidate_id: "cand-1",
      account: "acct-1",
      symbol: "XAUUSD",
      direction: "BUY",
      confidence: 55,
      blocker_code: "STALE",
      event_time: "2026-01-01T00:00:00.000Z",
    });
    expect(obs).not.toBeNull();
    expect(obs!.source).toBe("M10");
    expect(obs!.decision_action).toBe("EXPIRED");
    expect(obs!.outcome).toBeNull();
    expect(obs!.counterfactual).toBeNull();
    expect(obs!.mistake_classification).toBe("UNCLASSIFIED");
    expect(obs!.dedupe_key).toBe("M10:cand-1:EXPIRED");
  });

  it("builds a BLOCKED M10 observation as decision_action SKIPPED", () => {
    const obs = buildM10CandidateObservation({ event_type: "BLOCKED", candidate_id: "cand-2", account: "acct-1", symbol: "XAUUSD", direction: "SELL" });
    expect(obs!.decision_action).toBe("SKIPPED");
    expect(obs!.features.direction).toBe("SELL");
  });

  it("never stores the raw account identity -- only a one-way hash, matching every other Global Brain observation", () => {
    const obs = buildM10CandidateObservation({ event_type: "BLOCKED", candidate_id: "cand-3", account: "SECRET-ACCOUNT-ID", symbol: "XAUUSD" });
    expect(obs!.account_ref).not.toContain("SECRET-ACCOUNT-ID");
    expect(obs!.account_ref).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("recordGlobalBrainObservation", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("upserts by dedupe_key -- re-recording the same observation never creates a duplicate", async () => {
    const obs = buildShadowCandidateObservation({ signature: "sig1", account: 1, symbol: "XAUUSD", direction: "BUY", decision_time_utc: "t1" });
    await recordGlobalBrainObservation(obs);
    await recordGlobalBrainObservation({ ...obs, features: { ...obs.features, regime: "UPDATED" } });
    const docs = state.db.collection("global_brain_observations").docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]!["features"]).toMatchObject({ regime: "UPDATED" });
  });

  it("first resolution wins: a resolved observation's outcome is never overwritten by a later re-ingestion of the same dedupe_key (bug found auditing the resolution pipeline -- a TP1/TP2 win keeps being monitored toward TP3 and can re-trigger ingestion with mae_r/mfe_r contaminated by price action AFTER the trade already won)", async () => {
    const baseDoc = {
      id: "resolve-1",
      account: "acct-1",
      symbol: "XAUUSD",
      primary_direction: "BUY",
      published_quote_at: "2026-01-01T00:00:00.000Z",
      published_at: "2026-01-01T00:00:00.000Z",
      evaluation_deadline: "2026-01-01T01:00:00.000Z",
      classification_at: "2026-01-01T00:05:00.000Z",
      tp1_price: 2005,
      original_sl: 1995,
      analytics_outcome: "WIN",
      analytics_r: 1.0,
      highest_tp_reached: 1,
    };
    const cleanWin = buildOutlookObservation({ ...baseDoc, mfe_r: 1.0, mae_r: -0.05 }, [])!; // clean entry -- barely any adverse excursion
    await recordGlobalBrainObservation(cleanWin);

    // Same dedupe_key (same outlook id), re-ingested after continued
    // monitoring saw a hard post-win dump while still watching for TP2/TP3 --
    // this must NOT be allowed to retroactively turn a clean win into a
    // false HIGH_MAE_WIN.
    const contaminated = buildOutlookObservation({ ...baseDoc, mfe_r: 1.0, mae_r: -0.9 }, [])!; // post-win volatility unrelated to entry quality
    await recordGlobalBrainObservation(contaminated);

    const docs = state.db.collection("global_brain_observations").docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]!["outcome"]).toMatchObject({ mae_r: -0.05 });
    expect(docs[0]!["mistake_classification"]).toBe("CLEAN_WIN"); // not HIGH_MAE_WIN
  });

  it("an unresolved observation (resolved_at: null) is unaffected by the first-resolution-wins guard and keeps updating normally", async () => {
    const pending = buildShadowCandidateObservation({ signature: "sig-pending", account: 1, symbol: "XAUUSD", direction: "BUY", decision_time_utc: "t1" });
    expect(pending.resolved_at).toBeNull();
    await recordGlobalBrainObservation(pending);
    await recordGlobalBrainObservation({ ...pending, features: { ...pending.features, regime: "UPDATED" } });
    const docs = state.db.collection("global_brain_observations").docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]!["features"]).toMatchObject({ regime: "UPDATED" });
  });

  it("never throws even if the underlying write fails (best-effort)", async () => {
    state.db = { collection: () => { throw new Error("boom"); } } as unknown as FakeDb;
    const obs = buildShadowCandidateObservation({ signature: "sig2", account: 1, symbol: "XAUUSD", direction: "BUY", decision_time_utc: "t2" });
    await expect(recordGlobalBrainObservation(obs)).resolves.toBeUndefined();
  });

  it("kill switch: writes nothing when global_learning_enabled is OFF -- the single choke point every ingestion hook shares", async () => {
    const { updateGlobalBrainSettings } = await import("./globalBrainSettings.js");
    await updateGlobalBrainSettings({ global_learning_enabled: false }, "admin@xaucloud.io");
    const obs = buildShadowCandidateObservation({ signature: "sig3", account: 1, symbol: "XAUUSD", direction: "BUY", decision_time_utc: "t3" });
    await recordGlobalBrainObservation(obs);
    expect(state.db.collection("global_brain_observations").docs).toHaveLength(0);
  });
});
