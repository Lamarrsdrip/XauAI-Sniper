import { describe, expect, it } from "vitest";
import { isFourHourOutlookExpired, validateMarketData } from "./fourHourOutlookService.js";
import type { MarketData, MarketDataReadResult } from "./fourHourFeed.js";

function market(overrides: Partial<MarketData> = {}): MarketData {
  const latest = { ts: 1, mid: 4300, thesisDir: "NONE", preferredDir: "NONE", buyP: 50, sellP: 50, trendHealth: 0, location: 0, exhaustion: 0, moveConsumed: 0, buyRoomR: 0, sellRoomR: 0, structuralSl: 0, atr: 0, structureState: "", trendState: "", buyCase: 0, sellCase: 0, freshness: "FRESH", invalidated: false };
  return { price: 4300, latestTs: 1, ageSec: 10, candlesH1: [], candlesH4: [], candlesD1: [], snapshots: [latest, latest, latest], latest, account: "test", source: "ea-stream(spot)", dataStatus: "ACCUMULATING_BROKER_HISTORY", dataCoverage: { h1: 0, h4: 0, d1: 0, complete: false }, ...overrides };
}
function ok(data: MarketData): MarketDataReadResult { return { code: "LIVE_MARKET_OK", data, errorMessage: null }; }
function missing(): MarketDataReadResult { return { code: "EA_FEED_MISSING", data: null, errorMessage: null }; }
function dbTimeout(message = "connection timed out"): MarketDataReadResult { return { code: "DATABASE_READ_TIMEOUT", data: null, errorMessage: message }; }
function dbUnavailable(message = "topology closed"): MarketDataReadResult { return { code: "DATABASE_UNAVAILABLE", data: null, errorMessage: message }; }

describe("Manual Trading Intelligence data gate", () => {
  it("rejects stale broker prices instead of displaying them as current", () => {
    expect(validateMarketData(ok(market({ ageSec: 601 })))).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("LIVE_MARKET_STALE") }));
  });
  it("rejects malformed/out-of-range current prices", () => {
    expect(validateMarketData(ok(market({ price: 0 })))).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("PRICE_OUT_OF_RANGE") }));
  });
  it("allows early history only as a no-setup accumulation state", () => {
    expect(validateMarketData(ok(market()))).toEqual({ ok: true, reason: "LIVE_MARKET_OK" });
  });
  it("accepts one fresh verified quote; M10 snapshot count is not a 4H availability gate", () => {
    expect(validateMarketData(ok(market({ snapshots: [market().latest] })))).toEqual({ ok: true, reason: "LIVE_MARKET_OK" });
  });
  it("replaces an expired outlook even while broker history is still accumulating", () => {
    expect(isFourHourOutlookExpired({ expiresAt: "2026-08-19T01:46:35.828Z" }, Date.parse("2026-08-24T09:23:45.838Z"))).toBe(true);
  });

  // v6.28.1 audit (2026-08-25): readMarketData() previously collapsed "no EA
  // has posted a fresh quote" and "the database read itself threw" into the
  // same bare `null`, so EA_FEED_MISSING and a genuine Mongo outage were
  // indistinguishable everywhere downstream. These cases prove the fix.
  it("reports no EA quote anywhere as EA_FEED_MISSING, not a database code", () => {
    expect(validateMarketData(missing())).toEqual({ ok: false, reason: "EA_FEED_MISSING" });
  });
  it("reports a genuine database read timeout distinctly from a missing EA feed", () => {
    const result = validateMarketData(dbTimeout("connection timed out after 10000ms"));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("DATABASE_READ_TIMEOUT");
    expect(result.reason).not.toContain("EA_FEED_MISSING");
  });
  it("reports a database being unreachable distinctly from a missing EA feed", () => {
    const result = validateMarketData(dbUnavailable("MongoServerSelectionError"));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("DATABASE_UNAVAILABLE");
  });
});
