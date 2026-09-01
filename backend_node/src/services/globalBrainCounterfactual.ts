import { COUNTERFACTUAL_OFFSETS, type CounterfactualEntryResult, type CounterfactualOffset } from "../models/globalBrain.js";
import { targetsHaveValidGeometry } from "./marketOutlookSignal.js";

/**
 * Counterfactual entry-timing analysis for a TERMINAL, already-classified
 * Outlook signal. This is retrospective analysis over data that was already
 * fully observed and causally ordered by the time it runs (the same quote
 * journey services/marketOutlookTick.ts's accountQuotesSince already
 * fetched for the real outcome) -- it introduces no new lookahead risk: the
 * signal's own entry/SL/TP geometry is already frozen at publish time
 * (marketOutlookSignal.ts), and this function only asks "what if the entry
 * timestamp had been different", replaying the SAME already-terminal quote
 * stream against that SAME frozen geometry.
 *
 * Bot-trade-sourced observations have no equivalent tick-level quote
 * journey available server-side, so counterfactual timing is NOT computed
 * for them (globalBrainIngest.ts passes null rather than fabricating one).
 */

const OFFSET_MINUTES: Record<CounterfactualOffset, number> = {
  IMMEDIATE: 0,
  PLUS_1MIN: 1,
  PLUS_2MIN: 2,
  PLUS_3MIN: 3,
  PLUS_5MIN: 5,
  PLUS_10MIN: 10,
  PLUS_15MIN: 15,
  PLUS_30MIN: 30,
};

export type Quote = readonly [number, number, Date]; // [bid, ask, observedAt] -- matches marketOutlookTick.ts's Quote shape

export interface CounterfactualGeometry {
  direction: "BUY" | "SELL";
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  sl: number | null;
  publishedQuoteAt: Date;
  evaluationDeadline: Date;
}

/** Simulates one hypothetical entry timestamp against the real, already-frozen TP/SL geometry and the real observed quote journey. Highest-TP-touched-wins, matching advancePersistedSignal's owner-approved rule. */
function simulateEntry(quotes: readonly Quote[], geometry: CounterfactualGeometry, entryAt: Date): { entryPrice: number; achievedR: number } | null {
  const { direction, tp1, tp2, tp3, sl } = geometry;
  const entryQuote = quotes.find(([, , ts]) => ts.getTime() >= entryAt.getTime());
  if (!entryQuote) return null;
  const entryPrice = direction === "BUY" ? entryQuote[1] : entryQuote[0]; // enter on the executable side (ask for BUY, bid for SELL)
  if (!(entryPrice > 0)) return null;
  const risk = direction === "BUY" ? entryPrice - (sl ?? 0) : (sl ?? 0) - entryPrice;
  if (!(risk > 0)) return null;
  const geometryValid = targetsHaveValidGeometry(direction, entryPrice, tp1 ?? 0, tp2 ?? 0, tp3 ?? 0);

  let highestTpR = 0;
  let slHit = false;
  let lastR = 0;
  for (const [bid, ask, ts] of quotes) {
    if (ts.getTime() < entryQuote[2].getTime()) continue;
    if (ts.getTime() > geometry.evaluationDeadline.getTime()) break;
    const closePrice = direction === "BUY" ? bid : ask;
    const r = direction === "BUY" ? (closePrice - entryPrice) / risk : (entryPrice - closePrice) / risk;
    lastR = r;
    if (geometryValid) {
      const reached = (target: number) => (direction === "BUY" ? closePrice >= target : closePrice <= target);
      if (tp3 && reached(tp3)) highestTpR = Math.max(highestTpR, 2.0);
      else if (tp2 && reached(tp2)) highestTpR = Math.max(highestTpR, 1.0);
      else if (tp1 && reached(tp1)) highestTpR = Math.max(highestTpR, 0.5);
    }
    if (sl) {
      const hitSl = direction === "BUY" ? closePrice <= sl : closePrice >= sl;
      if (hitSl) slHit = true;
    }
  }

  // Highest TP touched wins over a later SL touch, mirroring the real
  // signal's own owner-approved classification rule.
  const achievedR = highestTpR > 0 ? highestTpR : slHit ? -1.0 : lastR;
  return { entryPrice, achievedR };
}

export function computeCounterfactualTiming(quotes: readonly Quote[], geometry: CounterfactualGeometry): CounterfactualEntryResult[] {
  const sorted = [...quotes].sort((a, b) => a[2].getTime() - b[2].getTime());
  return COUNTERFACTUAL_OFFSETS.map((offset) => {
    const entryAt = new Date(geometry.publishedQuoteAt.getTime() + OFFSET_MINUTES[offset] * 60_000);
    if (entryAt.getTime() > geometry.evaluationDeadline.getTime()) {
      return { offset, entry_price: null, achieved_r: null, data_available: false };
    }
    const sim = simulateEntry(sorted, geometry, entryAt);
    if (!sim) return { offset, entry_price: null, achieved_r: null, data_available: false };
    return { offset, entry_price: Math.round(sim.entryPrice * 1e6) / 1e6, achieved_r: Math.round(sim.achievedR * 1e6) / 1e6, data_available: true };
  });
}
