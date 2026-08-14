import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeForecast, pipsOf, QUALIFYING_PIPS } from "./fourHourOutlookEngine.js";
import type { Candle, OhlcFeed } from "./fourHourFeed.js";

/** Deterministic candle series: drift + sine oscillation (so fractal swings exist). */
function series(n: number, start: number, drift: number, amp: number, rangeHL: number): Candle[] {
  const out: Candle[] = [];
  const t0 = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    const mid = start + drift * i + Math.sin(i / 3) * amp;
    const o = mid - drift * 0.3;
    const c = mid + drift * 0.3;
    const h = Math.max(o, c) + rangeHL / 2;
    const l = Math.min(o, c) - rangeHL / 2;
    out.push({ t: t0 + i * 3600, o, h, l, c });
  }
  return out;
}

function feed(h4: Candle[], h1: Candle[]): OhlcFeed {
  return { h4, h1, spot: h1[h1.length - 1]!.c, source: "test", fetchedAt: new Date().toISOString(), stale: false };
}

describe("4H Outlook engine", () => {
  it("CASE BUY: strong uptrend + room => BUY, qualifies, positive move", () => {
    const f = feed(series(70, 4000, 1.8, 6, 17), series(280, 4300, 0.4, 5, 6));
    const r = computeForecast(f, { regime: "TREND_UP", buyPressure: 70, sellPressure: 30, location: 75, exhaustion: 20 }, { direction: "BUY", confidence: 70 });
    expect(r.direction).toBe("BUY");
    expect(r.netScore).toBeGreaterThan(0);
    expect(r.expectedMovePips![1]).toBeGreaterThanOrEqual(QUALIFYING_PIPS);
    expect(["ACTIVE", "WAIT_FOR_ENTRY"]).toContain(r.qualification);
    expect(r.invalidation).toBeLessThan(r.currentPrice);
    expect(r.confidence).toBeGreaterThan(55);
  });

  it("CASE SELL: strong downtrend => SELL, invalidation above price", () => {
    const f = feed(series(70, 4100, -1.8, 6, 17), series(280, 3800, -0.4, 5, 6));
    const r = computeForecast(f, { regime: "TREND_DOWN", buyPressure: 30, sellPressure: 70, location: 70, exhaustion: 20 }, { direction: "SELL", confidence: 68 });
    expect(r.direction).toBe("SELL");
    expect(r.netScore).toBeLessThan(0);
    expect(r.invalidation).toBeGreaterThan(r.currentPrice);
    expect(r.expectedMovePips![1]).toBeGreaterThanOrEqual(QUALIFYING_PIPS);
  });

  it("CASE NEUTRAL: flat range, tiny ranges => NEUTRAL / NO_QUALIFYING_OPPORTUNITY", () => {
    const f = feed(series(70, 4000, 0, 1.2, 1.5), series(280, 4000, 0, 1, 1));
    const r = computeForecast(f, { regime: "RANGE", buyPressure: 50, sellPressure: 50 }, null);
    expect(r.direction).toBe("NEUTRAL");
    expect(r.qualification).toBe("NO_QUALIFYING_OPPORTUNITY");
    expect(r.expectedMovePips).toBeNull();
    expect(r.preferredZone).toBeNull();
  });

  it("CASE conflicting H1/H4: bullish H4 vs bearish H1 => reduced confidence", () => {
    const strong = computeForecast(feed(series(70, 4000, 1.8, 6, 17), series(280, 4300, 0.4, 5, 6)), null, null);
    const conflict = computeForecast(feed(series(70, 4000, 1.4, 5, 10), series(280, 4400, -0.4, 4, 4)), null, null);
    expect(conflict.confidence).toBeLessThan(strong.confidence);
  });

  it("CASE small room: strong bias but sub-200-pip room => NO_QUALIFYING (no forced signal)", () => {
    const f = feed(series(70, 4000, 0.35, 0.6, 0.7), series(280, 4020, 0.05, 0.4, 0.4));
    const r = computeForecast(f, null, null);
    expect(r.qualification).toBe("NO_QUALIFYING_OPPORTUNITY");
    expect(r.direction).toBe("NEUTRAL");
  });

  it("CASE stale data: forecast still computes and flags dataStale", () => {
    const f = { ...feed(series(70, 4000, 1.8, 6, 17), series(280, 4300, 0.4, 5, 6)), stale: true };
    const r = computeForecast(f, null, null);
    expect(r.dataStale).toBe(true);
  });

  it("pip convention: 1 pip = $0.10", () => {
    expect(pipsOf(1)).toBeCloseTo(10, 6);
    expect(pipsOf(20)).toBeCloseTo(200, 6);
  });

  it("reasoning never claims certainty", () => {
    const r = computeForecast(feed(series(70, 4000, 1.8, 6, 17), series(280, 4300, 0.4, 5, 6)), null, null);
    expect(r.reasoning.toLowerCase()).not.toMatch(/guaranteed|risk-free|will definitely/);
  });
});

describe("4H Outlook execution isolation (static)", () => {
  const files = ["fourHourFeed.ts", "fourHourOutlookEngine.ts", "fourHourOutlookService.ts"].map((f) =>
    readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), "utf8"),
  );
  const routeSrc = readFileSync(fileURLToPath(new URL("../routes/fourHourOutlook.ts", import.meta.url)), "utf8");
  // Strip comments so the check targets real code, not prose describing what
  // the module deliberately does NOT do.
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const all = [...files, routeSrc].map(stripComments).join("\n");

  it("never references any trade-execution surface", () => {
    for (const forbidden of ["OpenTrade", "cloud_bot_commands", "outlookExecution", "commandStateMachine", "enqueueIfActionable", "TryManualOpenNow"]) {
      expect(all.includes(forbidden)).toBe(false);
    }
  });

  it("only touches its own collections + read-only context sources", () => {
    // Writes must be confined to four_hour_* collections; other collections are read-only.
    const writeMatches = [...all.matchAll(/collection\("([^"]+)"\)\.(insertOne|updateOne|replaceOne|deleteOne|deleteMany|insertMany)/g)].map((m) => m[1]);
    for (const col of writeMatches) {
      expect(["four_hour_outlooks", "four_hour_outlook_history", "cloud_notification_log"]).toContain(col);
    }
  });
});
