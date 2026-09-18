import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { backfillAllSignalOutlookHistory, backfillSignalOutlookHistory } = await import("./marketOutlookHistoryRepair.js");

function legacy(overrides: Record<string, unknown> = {}) {
  return {
    id: "legacy-1",
    account: "111",
    license_key: "PIN-A",
    symbol: "XAUUSD",
    primary_direction: "BUY",
    generated_at: "2026-09-18T10:00:00.000Z",
    published_at: "2026-09-18T10:00:00.000Z",
    suggested_sl: 2990,
    original_sl: 2990,
    tp1_price: 3999,
    tp2_price: 4999,
    final_result: null,
    ...overrides,
  };
}

async function quote(at: string, bid: number, ask: number) {
  await state.db.collection("cloud_market_evidence").insertOne({
    id: "q-" + at + "-" + bid,
    account: "111",
    license_key: "PIN-A",
    quote_valid: true,
    observed_at: at,
    bid,
    ask,
  });
}

describe("Market Outlook legacy history repair", () => {
  beforeEach(() => { state.db = new FakeDb(); });

  it("reconstructs a legacy directional win from persisted broker quotes and is idempotent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00.000Z"));
    try {
      await state.db.collection("cloud_market_outlooks").insertOne(legacy());
      await quote("2026-09-18T10:00:00.000Z", 3000, 3000.2);
      await quote("2026-09-18T10:05:00.000Z", 3005.3, 3005.5);

      const first = await backfillSignalOutlookHistory(20);
      expect(first.examined).toBe(1);
      expect(first.reconstructed).toBe(1);
      expect(first.wins).toBe(1);

      const saved = await state.db.collection("cloud_market_outlooks").findOne({ id: "legacy-1" });
      expect(saved?.signal_tracking_version).toBe(2);
      expect(saved?.historical_repair_status).toBe("RECONSTRUCTED");
      expect(saved?.analytics_outcome).toBe("WIN");
      expect(saved?.tp1_price).toBe(3005.2);
      expect(saved?.notification_flags).toMatchObject({
        TRACKING_STARTED: "BACKFILL_SUPPRESSED",
        TP1_HIT: "BACKFILL_SUPPRESSED",
      });

      const second = await backfillSignalOutlookHistory(20);
      expect(second.examined).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks unverifiable legacy rows unavailable instead of inventing a loss", async () => {
    await state.db.collection("cloud_market_outlooks").insertOne(legacy({ id: "no-quotes" }));
    const report = await backfillSignalOutlookHistory(20);
    expect(report.unavailable).toBe(1);

    const saved = await state.db.collection("cloud_market_outlooks").findOne({ id: "no-quotes" });
    expect(saved?.analytics_outcome).toBe("HISTORICAL_DATA_UNAVAILABLE");
    expect(saved?.excluded_from_signal_analytics).toBe(true);
    expect(saved?.historical_data_unavailable_reason).toContain("no stored broker Bid/Ask history");
  });

  it("reconstructs when the legacy Outlook account is a string but persisted evidence used BSON numeric MT5 login", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00.000Z"));
    try {
      await state.db.collection("cloud_market_outlooks").insertOne(legacy({ id: "mixed-account" }));
      await state.db.collection("cloud_market_evidence").insertOne({
        id: "numeric-q0", account: 111, license_key: "PIN-A", quote_valid: true,
        observed_at: "2026-09-18T10:00:00.000Z", bid: 3000, ask: 3000.2,
      });
      await state.db.collection("cloud_market_evidence").insertOne({
        id: "numeric-q1", account: 111, license_key: "PIN-A", quote_valid: true,
        observed_at: "2026-09-18T10:05:00.000Z", bid: 3005.3, ask: 3005.5,
      });

      const report = await backfillSignalOutlookHistory(20);
      expect(report.reconstructed).toBe(1);
      const saved = await state.db.collection("cloud_market_outlooks").findOne({ id: "mixed-account" });
      expect(saved?.analytics_outcome).toBe("WIN");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains more than one repair batch instead of leaving later accounts permanently invisible", async () => {
    await state.db.collection("cloud_market_outlooks").insertOne(legacy({ id: "batch-1", generated_at: "2026-09-18T07:00:00.000Z", published_at: "2026-09-18T07:00:00.000Z" }));
    await state.db.collection("cloud_market_outlooks").insertOne(legacy({ id: "batch-2", generated_at: "2026-09-18T08:00:00.000Z", published_at: "2026-09-18T08:00:00.000Z" }));
    await state.db.collection("cloud_market_outlooks").insertOne(legacy({ id: "batch-3", generated_at: "2026-09-18T09:00:00.000Z", published_at: "2026-09-18T09:00:00.000Z" }));

    const report = await backfillAllSignalOutlookHistory(2, 5);
    expect(report.examined).toBe(3);
    expect(report.batches).toBe(2);
    expect(report.backlog_remaining).toBe(false);
    expect(report.unavailable).toBe(3);
    expect(await state.db.collection("cloud_market_outlooks").countDocuments({ signal_tracking_version: { $ne: 2 } })).toBe(0);
  });

});
