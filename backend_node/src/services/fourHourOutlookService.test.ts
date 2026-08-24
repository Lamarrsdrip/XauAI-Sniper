import { describe, expect, it } from "vitest";
import { isFourHourOutlookExpired, validateMarketData } from "./fourHourOutlookService.js";
import type { MarketData } from "./fourHourFeed.js";

function market(overrides: Partial<MarketData> = {}): MarketData {
  const latest = { ts: 1, mid: 4300, thesisDir: "NONE", preferredDir: "NONE", buyP: 50, sellP: 50, trendHealth: 0, location: 0, exhaustion: 0, moveConsumed: 0, buyRoomR: 0, sellRoomR: 0, structuralSl: 0, atr: 0, structureState: "", trendState: "", buyCase: 0, sellCase: 0, freshness: "FRESH", invalidated: false };
  return { price: 4300, latestTs: 1, ageSec: 10, candlesH1: [], candlesH4: [], candlesD1: [], snapshots: [latest, latest, latest], latest, account: "test", source: "ea-stream(spot)", dataStatus: "ACCUMULATING_BROKER_HISTORY", dataCoverage: { h1: 0, h4: 0, d1: 0, complete: false }, ...overrides };
}

describe("Manual Trading Intelligence data gate", () => {
  it("rejects stale broker prices instead of displaying them as current", () => {
    expect(validateMarketData(market({ ageSec: 601 }))).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("STALE") }));
  });
  it("rejects malformed/out-of-range current prices", () => {
    expect(validateMarketData(market({ price: 0 }))).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("OUT_OF_RANGE") }));
  });
  it("allows early history only as a no-setup accumulation state", () => {
    expect(validateMarketData(market())).toEqual({ ok: true, reason: "" });
  });
  it("accepts one fresh verified quote; M10 snapshot count is not a 4H availability gate", () => {
    expect(validateMarketData(market({ snapshots: [market().latest] }))).toEqual({ ok: true, reason: "" });
  });
  it("replaces an expired outlook even while broker history is still accumulating", () => {
    expect(isFourHourOutlookExpired({ expiresAt: "2026-08-19T01:46:35.828Z" }, Date.parse("2026-08-24T09:23:45.838Z"))).toBe(true);
  });
});
