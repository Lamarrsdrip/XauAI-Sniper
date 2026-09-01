import { describe, expect, it, vi } from "vitest";

// globalBrainCounterfactual.ts imports marketOutlookSignal.js for
// targetsHaveValidGeometry, which transitively imports db.js/env.js --
// env.ts fails closed on a missing JWT_SECRET outside development/test.
vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const { computeCounterfactualTiming } = await import("./globalBrainCounterfactual.js");
type Quote = readonly [number, number, Date];

const T0 = new Date("2026-01-01T00:00:00.000Z");
function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

describe("computeCounterfactualTiming", () => {
  it("simulates a BUY that runs straight to TP1 for every offset that still has time before deadline", () => {
    // Price marches from 2000 up to 2010 steadily; BUY entry, TP1 at 2005 (0.5R), SL at 1995 (risk=5).
    const quotes: Quote[] = [
      [2000, 2000.2, at(0)],
      [2002, 2002.2, at(1)],
      [2004, 2004.2, at(2)],
      [2006, 2006.2, at(3)],
      [2008, 2008.2, at(4)],
      [2010, 2010.2, at(5)],
    ];
    const result = computeCounterfactualTiming(quotes, {
      direction: "BUY",
      tp1: 2005,
      tp2: 2010,
      tp3: 2015,
      sl: 1995,
      publishedQuoteAt: at(0),
      evaluationDeadline: at(60),
    });

    const immediate = result.find((r) => r.offset === "IMMEDIATE")!;
    expect(immediate.data_available).toBe(true);
    expect(immediate.achieved_r).toBeGreaterThanOrEqual(0.5); // reached TP1

    const plus1 = result.find((r) => r.offset === "PLUS_1MIN")!;
    expect(plus1.data_available).toBe(true);
    // Entering 1 minute later still has time to reach TP1 before the run continues.
    expect(plus1.achieved_r).toBeGreaterThanOrEqual(0.5);
  });

  it("marks an offset unavailable when it falls after the evaluation deadline", () => {
    const quotes: Quote[] = [[2000, 2000.2, at(0)]];
    const result = computeCounterfactualTiming(quotes, {
      direction: "BUY",
      tp1: 2005,
      tp2: 2010,
      tp3: 2015,
      sl: 1995,
      publishedQuoteAt: at(0),
      evaluationDeadline: at(2), // PLUS_3MIN falls after this
    });
    const plus3 = result.find((r) => r.offset === "PLUS_3MIN")!;
    expect(plus3.data_available).toBe(false);
    expect(plus3.achieved_r).toBeNull();
  });

  it("marks an offset unavailable when there is no quote at or after that entry time", () => {
    const quotes: Quote[] = [[2000, 2000.2, at(0)]]; // only one quote, at t=0
    const result = computeCounterfactualTiming(quotes, {
      direction: "BUY",
      tp1: 2005,
      tp2: 2010,
      tp3: 2015,
      sl: 1995,
      publishedQuoteAt: at(0),
      evaluationDeadline: at(10),
    });
    const plus1 = result.find((r) => r.offset === "PLUS_1MIN")!;
    expect(plus1.data_available).toBe(false);
  });

  it("computes a losing result (-1R) for a SELL that runs straight to SL", () => {
    const quotes: Quote[] = [
      [2005, 2005.2, at(0)],
      [2008, 2008.2, at(1)],
      [2011, 2011.2, at(2)],
    ];
    const result = computeCounterfactualTiming(quotes, {
      direction: "SELL",
      tp1: 1995,
      tp2: 1990,
      tp3: 1985,
      sl: 2010,
      publishedQuoteAt: at(0),
      evaluationDeadline: at(10),
    });
    const immediate = result.find((r) => r.offset === "IMMEDIATE")!;
    expect(immediate.data_available).toBe(true);
    expect(immediate.achieved_r).toBe(-1);
  });

  it("returns every configured offset even when only IMMEDIATE has data", () => {
    const quotes: Quote[] = [[2000, 2000.2, at(0)]];
    const result = computeCounterfactualTiming(quotes, {
      direction: "BUY",
      tp1: 2005,
      tp2: 2010,
      tp3: 2015,
      sl: 1995,
      publishedQuoteAt: at(0),
      evaluationDeadline: at(0.5),
    });
    expect(result.map((r) => r.offset)).toEqual(["IMMEDIATE", "PLUS_1MIN", "PLUS_2MIN", "PLUS_3MIN", "PLUS_5MIN", "PLUS_10MIN", "PLUS_15MIN", "PLUS_30MIN"]);
  });
});
