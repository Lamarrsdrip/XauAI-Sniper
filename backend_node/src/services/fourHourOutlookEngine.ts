/**
 * Regime-first XAUUSD manual intelligence.
 *
 * A higher-timeframe thesis is deliberately independent from a trade entry.
 * D1/H4/H1 establish direction. H1 locates selective entries inside that
 * direction. This module is display-only and has no EA execution surface.
 */
import type { Candle, MarketData } from "./fourHourFeed.js";

export const PIP_USD = 0.10;
export const pipsOf = (move: number): number => move / PIP_USD;
export const QUALIFYING_PIPS = 70;
export type Direction = "BUY" | "SELL" | "NEUTRAL";
export type Qualification = "ACTIVE" | "WAIT_FOR_ENTRY" | "NO_QUALIFYING_OPPORTUNITY";
export type ThesisState = "FORMING" | "CONFIRMED" | "ACTIVE" | "PULLBACK_WITHIN_THESIS" | "WEAKENING" | "INVALIDATED" | "TARGET_REACHED" | "NO_SETUP";
export type Regime = "STRONG_BULL_TREND" | "STRONG_BEAR_TREND" | "BULL_PULLBACK" | "BEAR_PULLBACK" | "RANGE" | "BREAKOUT_FORMING" | "BREAKOUT_CONFIRMED" | "TREND_EXHAUSTION" | "REVERSAL_FORMING" | "REVERSAL_CONFIRMED" | "NO_CLEAR_REGIME";
export type EntryFamily = "PULLBACK_CONTINUATION" | "LIQUIDITY_SWEEP_RECLAIM" | "BREAKOUT_RETEST" | "COMPRESSION_EXPANSION" | "CONTINUATION_AFTER_CONSOLIDATION" | "DEEP_RETRACEMENT_CONTINUATION";

export interface Target { label: "T1" | "T2" | "T3"; price: number; pips: number; }
export interface TradeOpportunity {
  setupKey: string; family: EntryFamily; direction: Exclude<Direction, "NEUTRAL">;
  entryZone: [number, number]; invalidation: number; targets: Target[];
  expectedMovePips: [number, number]; confidence: number; detectedAt: number;
}
export interface FourHourForecast {
  direction: Direction; qualification: Qualification; thesisStatus: ThesisState; confidence: number;
  expectedMovePips: [number, number] | null; preferredZone: [number, number] | null; invalidation: number | null;
  targets: Target[]; directionalRunwayPips: number | null; currentPrice: number; regimeLabel: Regime;
  netScore: number; htfScores: { d1: number; h4: number; h1: number }; opposingStructureConfirmed: boolean;
  evidence: Record<string, string>; reasoning: string; invalidationReason: string; dataSource: string; dataStale: boolean;
  dataStatus: MarketData["dataStatus"]; entryTiming: "READY" | "WAIT_FOR_PULLBACK" | "FORMING"; opportunity: TradeOpportunity | null; rejectionReasons: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
function ema(v: number[], period: number): number { let e = v[0] ?? 0; const k = 2 / (Math.min(period, v.length) + 1); for (let i = 1; i < v.length; i++) e = v[i]! * k + e * (1 - k); return e; }
function atr(c: Candle[], n = 14): number {
  const tr = c.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - c[i]!.c), Math.abs(x.l - c[i]!.c))).slice(-n);
  return tr.length ? tr.reduce((a, b) => a + b, 0) / tr.length : 0;
}
function score(c: Candle[]): number {
  if (c.length < 8) return 0;
  const close = c.map((x) => x.c), last = close.at(-1)!;
  const slow = ema(close, Math.min(20, close.length)), fast = ema(close, Math.min(8, close.length));
  const a = Math.max(atr(c), 0.01), base = close[Math.max(0, close.length - 8)]!;
  let s = clamp(((last - base) / a) * 11, -45, 45);
  s += last > slow ? 20 : -20; s += fast > slow ? 15 : -15;
  const previous = c.slice(-8, -1);
  if (last > Math.max(...previous.map((x) => x.h))) s += 20;
  if (last < Math.min(...previous.map((x) => x.l))) s -= 20;
  return clamp(s, -100, 100);
}
function levels(c: Candle[], direction: Exclude<Direction, "NEUTRAL">, price: number): number[] {
  return c.slice(0, -1).flatMap((x) => [x.h, x.l]).filter((x) => direction === "BUY" ? x > price : x < price)
    .sort((a, b) => direction === "BUY" ? a - b : b - a);
}
function regime(d1: number, h4: number, h1: number): Regime {
  if (d1 >= 35 && h4 >= 30 && h1 >= -20) return "STRONG_BULL_TREND";
  if (d1 <= -35 && h4 <= -30 && h1 <= 20) return "STRONG_BEAR_TREND";
  if (d1 >= 30 && h4 < -20) return "BULL_PULLBACK";
  if (d1 <= -30 && h4 > 20) return "BEAR_PULLBACK";
  if (Math.abs(d1) < 20 && Math.abs(h4) < 20) return "RANGE";
  if (Math.abs(h4) >= 45 && Math.abs(h1) >= 30) return "BREAKOUT_CONFIRMED";
  if (Math.abs(h4) >= 30) return "BREAKOUT_FORMING";
  return "NO_CLEAR_REGIME";
}
function stableDirection(net: number, d1: number, h4: number, h1: number, previous: Direction, complete: boolean): { direction: Direction; opposed: boolean } {
  if (!complete) return { direction: "NEUTRAL", opposed: false };
  const proposed: Direction = net >= 35 ? "BUY" : net <= -35 ? "SELL" : "NEUTRAL";
  const opposed = previous === "BUY" ? d1 < -30 && h4 < -35 && h1 < -20 : previous === "SELL" ? d1 > 30 && h4 > 35 && h1 > 20 : false;
  if (previous !== "NEUTRAL" && proposed !== previous && !opposed) return { direction: previous, opposed: false };
  return { direction: proposed, opposed };
}
function targetSet(direction: Exclude<Direction, "NEUTRAL">, price: number, runway: number): Target[] {
  return [0.4, 0.62, 0.8].map((ratio, i) => {
    const delta = runway * ratio * (direction === "BUY" ? 1 : -1);
    return { label: (["T1", "T2", "T3"] as const)[i]!, price: r2(price + delta), pips: Math.round(pipsOf(Math.abs(delta))) };
  });
}
function opportunityFor(direction: Exclude<Direction, "NEUTRAL">, h1: Candle[], price: number, invalidation: number, runway: number, confidence: number): TradeOpportunity | null {
  if (h1.length < 14 || pipsOf(runway) < QUALIFYING_PIPS) return null;
  const recent = h1.slice(-7), prior = h1.slice(-13, -1), last = recent.at(-1)!;
  const a = Math.max(atr(h1), 0.1), e = ema(h1.map((x) => x.c), 8), bullish = direction === "BUY";
  const priorLow = Math.min(...prior.map((x) => x.l)), priorHigh = Math.max(...prior.map((x) => x.h));
  const previous = recent.at(-2)!, beforePrevious = recent.at(-3)!;
  const confirm = bullish ? last.c > last.o && last.c > previous.h && (last.c - last.o) >= a * 0.22 : last.c < last.o && last.c < previous.l && (last.o - last.c) >= a * 0.22;
  // A real pullback needs a local counter-trend leg, then a fresh close back
  // through the preceding H1 range; a drifting trend is not an entry per bar.
  const pullback = bullish ? beforePrevious.c < recent.at(-4)!.c && previous.l <= e + a * 0.08 : beforePrevious.c > recent.at(-4)!.c && previous.h >= e - a * 0.08;
  const sweep = bullish ? last.l < priorLow - a * 0.08 && last.c > priorLow + a * 0.28 : last.h > priorHigh + a * 0.08 && last.c < priorHigh - a * 0.28;
  const breakout = bullish ? last.c > priorHigh && previous.c <= priorHigh && (last.c - last.o) >= a * 0.45 : last.c < priorLow && previous.c >= priorLow && (last.o - last.c) >= a * 0.45;
  const compressed = Math.max(...recent.slice(1, -1).map((x) => x.h)) - Math.min(...recent.slice(1, -1).map((x) => x.l)) <= a * 1.35;
  const family: EntryFamily | null = sweep && confirm ? "LIQUIDITY_SWEEP_RECLAIM" : breakout ? "BREAKOUT_RETEST" : pullback && confirm ? "PULLBACK_CONTINUATION" : compressed && confirm ? "COMPRESSION_EXPANSION" : null;
  if (!family) return null;
  const width = Math.max(a * 0.3, 0.25), entryZone: [number, number] = bullish ? [r2(price - width), r2(price + width * 0.2)] : [r2(price - width * 0.2), r2(price + width)];
  const targets = targetSet(direction, price, runway);
  return { setupKey: direction + ":" + family + ":" + last.t, family, direction, entryZone, invalidation, targets,
    expectedMovePips: [Math.max(70, targets[0]!.pips), targets[2]!.pips], confidence: clamp(confidence + (sweep || breakout ? 4 : 0), 0, 95), detectedAt: last.t };
}

export function computeForecast(md: MarketData, previousDirection: Direction = "NEUTRAL"): FourHourForecast {
  const d1 = score(md.candlesD1), h4 = score(md.candlesH4), h1 = score(md.candlesH1);
  const net = Math.round(clamp(d1 * 0.45 + h4 * 0.4 + h1 * 0.15, -100, 100)), marketRegime = regime(d1, h4, h1);
  const { direction, opposed } = stableDirection(net, d1, h4, h1, previousDirection, md.dataCoverage.complete);
  const price = md.price, a4 = Math.max(atr(md.candlesH4), 0.1), dir = direction === "NEUTRAL" ? null : direction;
  const obstacle = dir ? levels([...md.candlesH4, ...md.candlesD1], dir, price).find((level) => pipsOf(Math.abs(level - price)) >= QUALIFYING_PIPS) : undefined;
  const runway = obstacle == null ? 0 : Math.abs(obstacle - price), runwayPips = runway ? Math.round(pipsOf(runway)) : null;
  const invBase = dir === "BUY" ? Math.min(...md.candlesH4.slice(-8).map((x) => x.l), ...md.candlesD1.slice(-4).map((x) => x.l)) : dir === "SELL" ? Math.max(...md.candlesH4.slice(-8).map((x) => x.h), ...md.candlesD1.slice(-4).map((x) => x.h)) : 0;
  const invalidation = dir === "BUY" ? r2(invBase - a4 * 0.25) : dir === "SELL" ? r2(invBase + a4 * 0.25) : null;
  const confidence = direction === "NEUTRAL" ? clamp(Math.round(35 + Math.abs(net) * 0.25), 0, 60) : clamp(Math.round(45 + Math.abs(net) * 0.4 + (Math.sign(d1) === Math.sign(h4) ? 15 : 0)), 0, 92);
  const rejectionReasons: string[] = [];
  if (!md.dataCoverage.complete) rejectionReasons.push("DATA_INSUFFICIENT");
  if (direction === "NEUTRAL") rejectionReasons.push("INSUFFICIENT_HTF_ALIGNMENT");
  if (["RANGE", "NO_CLEAR_REGIME", "TREND_EXHAUSTION"].includes(marketRegime)) rejectionReasons.push("REGIME_UNCLEAR");
  if (runwayPips == null) rejectionReasons.push("INSUFFICIENT_RUNWAY");
  const opportunity = dir && invalidation != null && rejectionReasons.length === 0 ? opportunityFor(dir, md.candlesH1, price, invalidation, runway, confidence) : null;
  if (dir && !opportunity && rejectionReasons.length === 0) rejectionReasons.push("NO_ENTRY_CONFIRMATION");
  const targets = dir && runway ? targetSet(dir, price, runway) : [];
  const expectedMovePips: [number, number] | null = dir && runwayPips != null ? [Math.max(70, targets[0]!.pips), targets[2]!.pips] : null;
  const entryTiming = direction === "NEUTRAL" ? "FORMING" : opportunity ? "READY" : "WAIT_FOR_PULLBACK";
  const qualification: Qualification = direction === "NEUTRAL" ? "NO_QUALIFYING_OPPORTUNITY" : opportunity ? "ACTIVE" : "WAIT_FOR_ENTRY";
  const thesisStatus: ThesisState = direction === "NEUTRAL" ? "NO_SETUP" : previousDirection === direction ? (opportunity ? "ACTIVE" : "PULLBACK_WITHIN_THESIS") : "CONFIRMED";
  const preferredZone = opportunity?.entryZone ?? (dir ? (() => { const pull = Math.max(atr(md.candlesH1) * 0.55, a4 * 0.18, 1); return dir === "BUY" ? [r2(price - pull), r2(price - pull * 0.2)] as [number, number] : [r2(price + pull * 0.2), r2(price + pull)] as [number, number]; })() : null);
  const evidence = { daily_structure: d1 > 20 ? "Bullish" : d1 < -20 ? "Bearish" : "Balanced", h4_structure: h4 > 20 ? "Bullish" : h4 < -20 ? "Bearish" : "Balanced", h1_structure: h1 > 20 ? "Bullish" : h1 < -20 ? "Bearish" : "Balanced", m10_entry_context: (md.latest.preferredDir || "NONE") + " · " + (md.latest.structureState || "n/a"), runway: runwayPips == null ? "No verified 70-pip opposing structure" : String(runwayPips) + " pips to opposing structure", data_coverage: "D1 " + md.dataCoverage.d1 + "/20 · H4 " + md.dataCoverage.h4 + "/30 · H1 " + md.dataCoverage.h1 + "/80" };
  const reasoning = direction === "NEUTRAL" ? (md.dataCoverage.complete ? "NO CLEAR HTF THESIS — Daily/H4 structure does not align strongly enough." : "NO HIGH-CONVICTION SETUP — accumulating verified broker candle history; no higher-timeframe call is permitted yet.") : opportunity ? marketRegime.replaceAll("_", " ") + ". " + opportunity.family.replaceAll("_", " ") + " entry is confirmed within the stable " + direction + " thesis." : marketRegime.replaceAll("_", " ") + ". " + direction + " HTF thesis remains active; waiting for a separate lower-timeframe entry confirmation.";
  return { direction, qualification, thesisStatus, confidence, expectedMovePips, preferredZone, invalidation, targets, directionalRunwayPips: runwayPips, currentPrice: r2(price), regimeLabel: marketRegime, netScore: net, htfScores: { d1, h4, h1 }, opposingStructureConfirmed: opposed, evidence, reasoning, invalidationReason: direction === "NEUTRAL" ? "No active thesis." : "A " + (direction === "BUY" ? "H4/D1 close below " : "H4/D1 close above ") + invalidation + " invalidates this structure.", dataSource: md.source, dataStale: md.ageSec > 600, dataStatus: md.dataStatus, entryTiming, opportunity, rejectionReasons };
}
