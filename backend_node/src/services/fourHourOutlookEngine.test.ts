import { describe, expect, it } from "vitest";
import { computeForecast, pipsOf, type Direction } from "./fourHourOutlookEngine.js";
import type { Candle, EaSnapshot, MarketData } from "./fourHourFeed.js";

function candles(n: number, start: number, drift: number, range: number, seconds: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = start + drift * i;
    return { t: 1_700_000_000 + i * seconds, o: c - drift / 2, h: c + range / 2, l: c - range / 2, c };
  });
}
function md(side: "BUY" | "SELL" | "FLAT", ready = true): MarketData {
  const drift = side === "BUY" ? 2 : side === "SELL" ? -2 : 0;
  const h1 = candles(100, 4300, drift / 5, 3, 3600);
  const h4 = candles(40, 4300, drift / 5, 8, 14_400);
  const d1 = candles(25, 4300, drift / 15, 24, 86_400);
  const price = h1.at(-1)!.c;
  // Give the trend a real opposing level sufficiently far away for runway.
  if (side === "BUY") { h4[5]!.h = price + 45; d1[5]!.h = price + 55; }
  if (side === "SELL") { h4[5]!.l = price - 45; d1[5]!.l = price - 55; }
  const latest: EaSnapshot = { ts: 1_700_000_000, mid: price, thesisDir: "SELL", preferredDir: "SELL", buyP: 20, sellP: 80, trendHealth: 20, location: 20, exhaustion: 10, moveConsumed: 10, buyRoomR: 0, sellRoomR: 10, structuralSl: price + 10, atr: 5, structureState: "STRUCTURE_OPPOSES", trendState: "TREND_CONTINUING", buyCase: 20, sellCase: 80, freshness: "FRESH", invalidated: false };
  return { price, latestTs: latest.ts, ageSec: 20, candlesH1: h1, candlesH4: h4, candlesD1: d1, snapshots: [latest, latest, latest], latest, account: "test", source: "ea-stream(spot)", dataStatus: ready ? "READY" : "ACCUMULATING_BROKER_HISTORY", dataCoverage: { h1: ready ? 100 : 3, h4: ready ? 40 : 1, d1: ready ? 25 : 1, complete: ready } };
}

describe("Manual Trading Intelligence swing engine", () => {
  it("returns NO SETUP until verified daily/H4 history exists", () => {
    const r = computeForecast(md("BUY", false));
    expect(r.direction).toBe("NEUTRAL");
    expect(r.thesisStatus).toBe("NO_SETUP");
    expect(r.reasoning).toContain("accumulating verified broker candle history");
  });
  it("uses Daily/H4 structure, not the opposing M10 snapshot, for a BUY thesis", () => {
    const r = computeForecast(md("BUY"), "NEUTRAL");
    expect(r.direction).toBe("BUY");
    expect(r.htfScores.d1).toBeGreaterThan(0);
    expect(r.targets).toHaveLength(3);
    expect(r.invalidation).toBeLessThan(r.currentPrice);
    expect(r.directionalRunwayPips).toBeGreaterThanOrEqual(100);
  });
  it("creates a SELL only from aligned bearish HTF structure", () => {
    const r = computeForecast(md("SELL"), "NEUTRAL");
    expect(r.direction).toBe("SELL");
    expect(r.invalidation).toBeGreaterThan(r.currentPrice);
    expect(r.targets[2]!.price).toBeLessThan(r.currentPrice);
  });
  it("does not flip a held BUY on a mild opposing read", () => {
    const m = md("BUY");
    m.candlesH1 = candles(100, 4300, -0.05, 3, 3600); // lower-timeframe pullback only
    const r = computeForecast(m, "BUY");
    expect(r.direction).not.toBe("SELL");
  });
  it("requires explicit opposing Daily/H4/H1 structure before a held BUY may flip", () => {
    const m = md("SELL");
    m.candlesH1 = candles(100, 4300, -2, 3, 3600);
    const r = computeForecast(m, "BUY");
    expect(r.opposingStructureConfirmed).toBe(true);
    expect(r.direction).toBe("SELL");
  });
  it("keeps a thesis but never claims an entry without an actual opposing-structure runway", () => {
    const m = md("BUY");
    for (const c of [...m.candlesH4, ...m.candlesD1]) c.h = Math.min(c.h, m.price - 1);
    const r = computeForecast(m, "NEUTRAL");
    expect(r.direction).toBe("BUY");
    expect(r.opportunity).toBeNull();
    expect(r.qualification).toBe("WAIT_FOR_ENTRY");
  });
  it("keeps the declared pip convention", () => expect(pipsOf(20)).toBeCloseTo(200));
});
