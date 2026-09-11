import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { computeOutlookFreshness, latestEaEvidence } = await import("./marketOutlookEvidence.js");

function ledger(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(), license_key: "lic-a", account: "acct-a", symbol: "XAUUSD", normalized_symbol: "XAUUSD",
    received_at: "2026-09-11T10:01:00.000Z", observed_at: "2026-09-11T10:01:00.000Z",
    market_thesis: { live_bid: 3001, live_ask: 3001.2 }, entry_readiness: {}, m10_signal: {}, execution: {}, provenance: { runtime_environment: "LIVE" },
    ...overrides,
  };
}

describe("marketOutlook immutable-evidence reads", () => {
  beforeEach(() => { state.db = new FakeDb(); });

  it("is ledger-first and preserves the latest genuine M10 across quote-only heartbeats", async () => {
    await state.db.collection("cloud_market_evidence").insertOne(ledger({
      id: "m10", received_at: "2026-09-11T10:00:00.000Z", observed_at: "2026-09-11T10:00:00.000Z",
      m10_signal: { candidate_id: "c1", decision: "BUY_CANDIDATE", bar_time: "2026.09.11 10:00" },
    }));
    await state.db.collection("cloud_market_evidence").insertOne(ledger());
    // This newer mutable row must not replace a healthy ledger view.
    await state.db.collection("cloud_bot_activity").insertOne({ id: "mutable", license_key: "lic-a", account: "acct-a", ts: "2026-09-11T10:02:00.000Z", details: { market_thesis: { live_bid: 9999, live_ask: 9999.2 } } });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:02:00.000Z"));
    try {
      const result = await latestEaEvidence("lic-a", "acct-a");
      expect(result.reason).toBe("OK");
      expect(result.evidence?.market_thesis).toMatchObject({ live_bid: 3001 });
      expect(result.evidence?.m10_signal).toMatchObject({ candidate_id: "c1" });
    } finally { vi.useRealTimers(); }
  });

  it("enforces exact license/account scope and does not call stale evidence an offline EA", async () => {
    await state.db.collection("cloud_market_evidence").insertOne(ledger({ id: "other", license_key: "lic-b", account: "acct-b" }));
    await state.db.collection("cloud_market_evidence").insertOne(ledger({ id: "old", received_at: "2026-09-11T09:00:00.000Z", observed_at: "2026-09-11T09:00:00.000Z" }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:00:00.000Z"));
    try {
      expect((await latestEaEvidence("lic-a", "acct-a")).reason).toBe("STALE_EVIDENCE");
      expect((await latestEaEvidence("lic-a", "acct-b")).reason).toBe("NO_CONNECTED_EA");
      expect(computeOutlookFreshness(null, null, "STALE_EVIDENCE").state).toBe("NO_FRESH_SIGNAL");
    } finally { vi.useRealTimers(); }
  });

  it("resolves an activity-id source to that event, not an older ledger row linked to the same deduplicated activity", async () => {
    // Ledger insert for the newest event failed, so the pipeline could only
    // pass the (shared, deduplicated) activity row id.
    await state.db.collection("cloud_market_evidence").insertOne(ledger({
      id: "old-evidence", source_activity_id: "act-1", m10_signal: { candidate_id: "stale", decision: "BUY_CANDIDATE" },
    }));
    await state.db.collection("cloud_bot_activity").insertOne({
      id: "act-1", license_key: "lic-a", account: "acct-a", ts: "2026-09-11T10:20:00.000Z",
      details: { market_thesis: { live_bid: 3010, live_ask: 3010.2 }, m10_signal: { candidate_id: "current", decision: "SELL_CANDIDATE" } },
    });
    const byActivity = await latestEaEvidence("lic-a", "acct-a", "act-1");
    expect(byActivity.evidence?.m10_signal).toMatchObject({ candidate_id: "current" });
    const byEvidence = await latestEaEvidence("lic-a", "acct-a", "old-evidence");
    expect(byEvidence.evidence?.m10_signal).toMatchObject({ candidate_id: "stale" });
    // A different account can never resolve this account's evidence id.
    expect((await latestEaEvidence("lic-a", "acct-b", "old-evidence")).evidence).toBeNull();
  });
});
