import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("./manualTradingMarketStore.js", () => ({
  recordVerifiedManualTradingQuote: async () => ({ persisted: true }),
  recordAuditableEaDecision: async () => undefined,
}));

const { hasMarketEvidence, recordImmutableMarketEvidence } = await import("./marketEvidenceLedger.js");
const { storeBotActivity } = await import("./botActivity.js");

describe("marketEvidenceLedger", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.db.uniqueIndexes.cloud_market_evidence = ["evidence_key"];
    // Fixtures are stamped 2026-09-11T10:0x; pin the receive clock just after
    // them so the future-clock-skew guard sees them as genuine observations.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-11T10:05:00.000Z"));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("distinguishes market evidence from ordinary operational noise", () => {
    expect(hasMarketEvidence({ reason: "still waiting" })).toBe(false);
    expect(hasMarketEvidence({ market_thesis: { live_bid: 4600, live_ask: 4600.2 } })).toBe(true);
    expect(hasMarketEvidence({ m10_signal: { evidence_id: 12, decision: "WATCHING" } })).toBe(true);
  });

  it("keeps every chronological quote when operational activity deduplicates, while exact delivery retry stays idempotent", async () => {
    const base = { license_key: "lic-a", market_thesis: { live_bid: 3000, live_ask: 3000.2, evidence_time_utc: "2026-09-11T10:00:00.000Z" } };
    await storeBotActivity("MARKET_HEARTBEAT", "INFO", "heartbeat", "acct-a", "XAUUSD", base);
    await storeBotActivity("MARKET_HEARTBEAT", "INFO", "heartbeat", "acct-a", "XAUUSD", {
      ...base, market_thesis: { live_bid: 3001, live_ask: 3001.2, evidence_time_utc: "2026-09-11T10:01:00.000Z" },
    });
    // A transport retry is the same immutable observation, not another tick.
    await storeBotActivity("MARKET_HEARTBEAT", "INFO", "heartbeat", "acct-a", "XAUUSD", {
      ...base, market_thesis: { live_bid: 3001, live_ask: 3001.2, evidence_time_utc: "2026-09-11T10:01:00.000Z" },
    });

    expect(state.db.collection("cloud_bot_activity").docs).toHaveLength(1);
    const evidence = state.db.collection("cloud_market_evidence").docs;
    expect(evidence).toHaveLength(2);
    expect(evidence.map((row) => row["bid"])).toEqual([3000, 3001]);
    // The first immutable source remains untouched after the activity row is
    // repeatedly updated by the UI dedupe mechanism.
    expect(evidence[0]).toMatchObject({ bid: 3000, ask: 3000.2, observed_at: "2026-09-11T10:00:00.000Z" });
  });

  it("deduplicates one M10 observation delivered through both activity and heartbeat routes", async () => {
    const details = {
      market_thesis: { live_bid: 3000, live_ask: 3000.2, evidence_time_utc: "2026-09-11T10:00:00.000Z" },
      m10_signal: { candidate_id: "m10-1", decision: "BUY_CANDIDATE", bar_time: "2026.09.11 10:00" },
    };
    const one = await recordImmutableMarketEvidence({ source_activity_id: "activity-event", license_key: "lic-a", account: "acct-a", symbol: "XAUUSD", event_type: "MARKET_ACTIVITY", received_at: new Date("2026-09-11T10:00:01.000Z"), details });
    const two = await recordImmutableMarketEvidence({ source_activity_id: "heartbeat-event", license_key: "lic-a", account: "acct-a", symbol: "XAUUSD", event_type: "MARKET_HEARTBEAT", received_at: new Date("2026-09-11T10:00:02.000Z"), details });
    expect(one.evidence_id).toBe(two.evidence_id);
    expect(state.db.collection("cloud_market_evidence").docs).toHaveLength(1);
  });

  it("stamps observed_at with the UTC quote time, never the broker-local M10 bar time", async () => {
    // Production v6.28.6: bar_time = TimeToString(closedBarTime) in broker
    // server time (e.g. UTC+3); evidence_time_utc = TimeGMT() at capture.
    const receipt = await recordImmutableMarketEvidence({
      source_activity_id: "a1", license_key: "lic-a", account: "acct-a", symbol: "XAUUSD", event_type: "BOT_DECISION",
      received_at: new Date("2026-09-11T10:07:06.000Z"),
      details: {
        market_thesis: { live_bid: 3000, live_ask: 3000.2, evidence_time_utc: "2026.09.11 10:07:05" },
        m10_signal: { evidence_id: 7, decision: "WATCHING", bar_time: "2026.09.11 13:00" },
      },
    });
    expect(receipt.observed_at).toBe("2026-09-11T10:07:05.000Z");
    expect(state.db.collection("cloud_market_evidence").docs[0]).toMatchObject({ observed_at: "2026-09-11T10:07:05.000Z", bid: 3000 });
  });

  it("falls back to receive time when the terminal clock claims a future observation", async () => {
    const receipt = await recordImmutableMarketEvidence({
      source_activity_id: "a2", license_key: "lic-a", account: "acct-a", symbol: "XAUUSD", event_type: "MARKET_HEARTBEAT",
      received_at: new Date("2026-09-11T10:00:00.000Z"),
      details: { market_thesis: { live_bid: 3000, live_ask: 3000.2, evidence_time_utc: "2026-09-11T13:00:00.000Z" } },
    });
    expect(receipt.observed_at).toBe("2026-09-11T10:00:00.000Z");
  });
});
