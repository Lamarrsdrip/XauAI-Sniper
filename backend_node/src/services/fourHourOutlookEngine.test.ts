import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeForecast, pipsOf, QUALIFYING_PIPS, type Direction } from "./fourHourOutlookEngine.js";
import type { Candle, EaSnapshot, MarketData } from "./fourHourFeed.js";

function genCandles(n: number, start: number, drift: number, range: number, bucket: number): Candle[] {
  const out: Candle[] = [];
  const t0 = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    const c = start + drift * i;
    out.push({ t: t0 + i * bucket, o: c - drift / 2, h: c + range / 2, l: c - range / 2, c });
  }
  return out;
}

function snap(ts: number, mid: number, over: Partial<EaSnapshot> = {}): EaSnapshot {
  return {
    ts, mid, thesisDir: "NONE", preferredDir: "NONE", buyP: 50, sellP: 50, trendHealth: 50,
    location: 60, exhaustion: 30, moveConsumed: 40, buyRoomR: 3, sellRoomR: 3, structuralSl: mid - 10,
    atr: 5, structureState: "", trendState: "", buyCase: 50, sellCase: 50, freshness: "FRESH", invalidated: false, ...over,
  };
}

function market(dir: "BUY" | "SELL" | "MIXED" | "FLAT", opts: { room?: number; range?: number } = {}): MarketData {
  const room = opts.room ?? 6;
  const range = opts.range ?? 15;
  const drift = dir === "BUY" ? 1.0 : dir === "SELL" ? -1.0 : 0;
  const h1 = genCandles(20, 4300, drift, dir === "FLAT" ? 1.5 : range, 3600);
  const h4 = genCandles(6, 4300, drift * 4, dir === "FLAT" ? 2 : range * 1.2, 4 * 3600);
  const price = h1[h1.length - 1]!.c;
  const base: Partial<EaSnapshot> =
    dir === "BUY" ? { thesisDir: "BUY", preferredDir: "BUY", buyCase: 72, sellCase: 28, buyP: 66, sellP: 34, trendHealth: 72, exhaustion: 25, moveConsumed: 40, buyRoomR: room, structuralSl: price - 10 }
    : dir === "SELL" ? { thesisDir: "SELL", preferredDir: "SELL", buyCase: 28, sellCase: 72, buyP: 34, sellP: 66, trendHealth: 70, exhaustion: 25, moveConsumed: 40, sellRoomR: room, structuralSl: price + 10 }
    : dir === "MIXED" ? { thesisDir: "BUY", preferredDir: "SELL", buyCase: 44, sellCase: 66, buyP: 49, sellP: 65, trendHealth: 29, exhaustion: 57, moveConsumed: 80, buyRoomR: 5, sellRoomR: 0.4 }
    : { thesisDir: "NONE", preferredDir: "NONE", buyCase: 50, sellCase: 50, buyP: 50, sellP: 50, trendHealth: 40 };
  const snaps: EaSnapshot[] = [];
  const t0 = 1_700_000_000;
  for (let i = 0; i < 10; i++) snaps.push(snap(t0 + i * 300, price, base));
  return { price, latestTs: t0 + 9 * 300, ageSec: 60, candlesH1: h1, candlesH4: h4, snapshots: snaps, latest: snaps[snaps.length - 1]!, account: "test", source: "ea-stream(spot)" };
}

describe("Manual Trading Intelligence engine (EA-driven)", () => {
  it("CASE BUY: aligned bullish EA read + room => BUY, qualifies, positive net", () => {
    const r = computeForecast(market("BUY"), "NEUTRAL");
    expect(r.direction).toBe("BUY");
    expect(r.netScore).toBeGreaterThan(0);
    expect(r.expectedMovePips![1]).toBeGreaterThanOrEqual(QUALIFYING_PIPS);
    expect(["ACTIVE", "WAIT_FOR_ENTRY"]).toContain(r.qualification);
    expect(r.invalidation).toBeLessThan(r.currentPrice);
    expect(r.confidence).toBeGreaterThan(55);
  });

  it("CASE SELL: aligned bearish EA read => SELL, invalidation above price", () => {
    const r = computeForecast(market("SELL"), "NEUTRAL");
    expect(r.direction).toBe("SELL");
    expect(r.netScore).toBeLessThan(0);
    expect(r.invalidation).toBeGreaterThan(r.currentPrice);
    expect(r.expectedMovePips![1]).toBeGreaterThanOrEqual(QUALIFYING_PIPS);
  });

  it("CASE MIXED: thesis vs M10 conflict + late/exhausted => NEUTRAL (no forced call)", () => {
    const r = computeForecast(market("MIXED"), "NEUTRAL");
    expect(r.direction).toBe("NEUTRAL");
    expect(r.qualification).toBe("NO_QUALIFYING_OPPORTUNITY");
    expect(r.expectedMovePips).toBeNull();
  });

  it("CASE hysteresis: a held BUY stays through a mild dip but flips on strong opposite", () => {
    // mildly-supportive read: not enough to ARM fresh, but enough to HOLD an existing BUY
    const mild = market("BUY");
    mild.snapshots = mild.snapshots.map((s) => ({ ...s, buyCase: 56, sellCase: 44, buyP: 54, sellP: 46, trendHealth: 45 }));
    mild.latest = mild.snapshots[mild.snapshots.length - 1]!;
    const held = computeForecast(mild, "BUY");
    expect(["BUY", "NEUTRAL"]).toContain(held.direction); // never spontaneously flips to SELL on a mild dip
    const flipped = computeForecast(market("SELL"), "BUY");
    expect(flipped.direction).toBe("SELL"); // strong opposite genuinely flips
  });

  it("CASE small room: aligned but sub-200-pip room => NO_QUALIFYING (no forced big-run call)", () => {
    const r = computeForecast(market("BUY", { room: 0.3, range: 1.2 }), "NEUTRAL");
    expect(r.qualification).toBe("NO_QUALIFYING_OPPORTUNITY");
    expect(r.direction).toBe("NEUTRAL");
  });

  it("source + pip convention", () => {
    expect(pipsOf(20)).toBeCloseTo(200, 6);
    expect(computeForecast(market("BUY"), "NEUTRAL").dataSource).toBe("ea-stream(spot)");
  });

  it("reasoning never claims certainty", () => {
    const r = computeForecast(market("BUY"), "NEUTRAL");
    expect(r.reasoning.toLowerCase()).not.toMatch(/guaranteed|risk-free|will definitely/);
  });
});

describe("Manual Trading Intelligence execution isolation (static)", () => {
  const files = ["fourHourFeed.ts", "fourHourOutlookEngine.ts", "fourHourOutlookService.ts"].map((f) =>
    readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), "utf8"),
  );
  const routeSrc = readFileSync(fileURLToPath(new URL("../routes/fourHourOutlook.ts", import.meta.url)), "utf8");
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const all = [...files, routeSrc].map(stripComments).join("\n");

  it("never references any trade-execution surface", () => {
    for (const forbidden of ["OpenTrade", "cloud_bot_commands", "outlookExecution", "commandStateMachine", "enqueueIfActionable", "TryManualOpenNow"]) {
      expect(all.includes(forbidden)).toBe(false);
    }
  });

  it("only writes its own collections + read-only context sources", () => {
    const writeMatches = [...all.matchAll(/collection\("([^"]+)"\)\.(insertOne|updateOne|replaceOne|deleteOne|deleteMany|insertMany)/g)].map((m) => m[1]);
    for (const col of writeMatches) {
      expect(["four_hour_outlooks", "four_hour_outlook_history", "cloud_notification_log"]).toContain(col);
    }
  });

  it("uses no external market-data API (bot stream only)", () => {
    for (const host of ["yahoo", "GC=F", "twelvedata", "kraken", "binance", "query1.finance", "api.twelvedata"]) {
      expect(all.toLowerCase().includes(host.toLowerCase())).toBe(false);
    }
  });
});
