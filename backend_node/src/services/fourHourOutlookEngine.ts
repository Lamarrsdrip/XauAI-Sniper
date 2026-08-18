/**
 * Regime-first XAUUSD swing intelligence.
 *
 * The direction calculation deliberately has no M10/EA-decision input. Daily,
 * H4 and H1 broker candles establish a thesis; the latest M10 snapshot can
 * only say whether entry timing is extended or still forming.
 */
import type { Candle, EaSnapshot, MarketData } from "./fourHourFeed.js";

export const PIP_USD = 0.10;
export const pipsOf = (move: number): number => move / PIP_USD;
export const QUALIFYING_PIPS = 100;
export type Direction = "BUY" | "SELL" | "NEUTRAL";
export type Qualification = "ACTIVE" | "WAIT_FOR_ENTRY" | "NO_QUALIFYING_OPPORTUNITY";
export type ThesisState = "FORMING" | "CONFIRMED" | "ACTIVE" | "PULLBACK_WITHIN_THESIS" | "WEAKENING" | "INVALIDATED" | "TARGET_REACHED" | "NO_SETUP";
export type Regime = "STRONG_BULL_TREND" | "STRONG_BEAR_TREND" | "BULL_PULLBACK" | "BEAR_PULLBACK" | "RANGE" | "BREAKOUT_FORMING" | "BREAKOUT_CONFIRMED" | "TREND_EXHAUSTION" | "REVERSAL_FORMING" | "REVERSAL_CONFIRMED" | "NO_CLEAR_REGIME";

export interface Target { label: "T1" | "T2" | "T3"; price: number; pips: number; }
export interface FourHourForecast {
  direction: Direction; qualification: Qualification; thesisStatus: ThesisState; confidence: number;
  expectedMovePips: [number, number] | null; preferredZone: [number, number] | null; invalidation: number | null;
  targets: Target[]; directionalRunwayPips: number | null; currentPrice: number; regimeLabel: Regime;
  netScore: number; htfScores: { d1: number; h4: number; h1: number }; opposingStructureConfirmed: boolean;
  evidence: Record<string, string>; reasoning: string; invalidationReason: string; dataSource: string; dataStale: boolean;
  dataStatus: MarketData["dataStatus"]; entryTiming: "READY" | "WAIT_FOR_PULLBACK" | "FORMING";
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
function levels(c: Candle[], above: boolean, price: number): number[] {
  return c.slice(0, -1).flatMap((x) => [x.h, x.l]).filter((x) => above ? x > price : x < price).sort((a, b) => above ? a - b : b - a);
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
function timing(direction: Direction, h1: Candle[], latest: EaSnapshot): "READY" | "WAIT_FOR_PULLBACK" | "FORMING" {
  if (direction === "NEUTRAL" || h1.length < 8) return "FORMING";
  const c = h1.map((x) => x.c), a = Math.max(atr(h1), 0.1), gap = latest.mid - ema(c, 8);
  if ((direction === "BUY" && gap > a * 0.8) || (direction === "SELL" && gap < -a * 0.8)) return "WAIT_FOR_PULLBACK";
  return "READY";
}

export function computeForecast(md: MarketData, previousDirection: Direction = "NEUTRAL"): FourHourForecast {
  const d1 = score(md.candlesD1), h4 = score(md.candlesH4), h1 = score(md.candlesH1);
  const net = Math.round(clamp(d1 * 0.45 + h4 * 0.4 + h1 * 0.15, -100, 100));
  const marketRegime = regime(d1, h4, h1);
  const historyReady = md.dataCoverage.complete;
  let direction: Direction = !historyReady ? "NEUTRAL" : net >= 35 ? "BUY" : net <= -35 ? "SELL" : "NEUTRAL";
  const opposed = previousDirection === "BUY" ? d1 < -30 && h4 < -35 && h1 < -20 : previousDirection === "SELL" ? d1 > 30 && h4 > 35 && h1 > 20 : false;
  // An opposite candle score cannot reverse a persisted thesis alone.
  if (previousDirection !== "NEUTRAL" && direction !== previousDirection && !opposed) direction = previousDirection;
  const a4 = Math.max(atr(md.candlesH4), 0.1), price = md.price;
  const above = levels([...md.candlesH4, ...md.candlesD1], true, price), below = levels([...md.candlesH4, ...md.candlesD1], false, price);
  const obstacle = direction === "BUY" ? above[0] : direction === "SELL" ? below[0] : undefined;
  const runway = obstacle == null ? 0 : Math.abs(obstacle - price);
  const runwayPips = runway ? Math.round(pipsOf(runway)) : null;
  const invBase = direction === "BUY" ? Math.min(...md.candlesH4.slice(-8).map((x) => x.l), ...md.candlesD1.slice(-4).map((x) => x.l)) : direction === "SELL" ? Math.max(...md.candlesH4.slice(-8).map((x) => x.h), ...md.candlesD1.slice(-4).map((x) => x.h)) : 0;
  const invalidation = direction === "BUY" ? r2(invBase - a4 * 0.25) : direction === "SELL" ? r2(invBase + a4 * 0.25) : null;
  const confidence = direction === "NEUTRAL" ? clamp(Math.round(35 + Math.abs(net) * 0.25), 0, 60) : clamp(Math.round(45 + Math.abs(net) * 0.4 + (Math.sign(d1) === Math.sign(h4) ? 15 : 0)), 0, 92);
  const expectedHigh = runwayPips == null ? 0 : Math.floor(runwayPips * 0.8 / 10) * 10;
  const expectedLow = Math.min(expectedHigh, Math.max(100, Math.floor(expectedHigh * 0.55 / 10) * 10));
  const qualifying = direction !== "NEUTRAL" && confidence >= 65 && runwayPips != null && runwayPips >= QUALIFYING_PIPS && expectedHigh >= QUALIFYING_PIPS && !["RANGE", "NO_CLEAR_REGIME", "TREND_EXHAUSTION"].includes(marketRegime);
  if (!qualifying) direction = "NEUTRAL";
  const entryTiming = timing(direction, md.candlesH1, md.latest);
  const pull = Math.max(atr(md.candlesH1) * 0.55, a4 * 0.18, 1);
  const preferredZone = direction === "BUY" ? [r2(price - pull), r2(price - pull * 0.2)] as [number, number] : direction === "SELL" ? [r2(price + pull * 0.2), r2(price + pull)] as [number, number] : null;
  const targetDistances = [0.4, 0.62, 0.8];
  const targets: Target[] = direction === "NEUTRAL" || !runway ? [] : targetDistances.map((ratio, i) => {
    const delta = runway * ratio * (direction === "BUY" ? 1 : -1);
    return { label: (["T1", "T2", "T3"] as const)[i]!, price: r2(price + delta), pips: Math.round(pipsOf(Math.abs(delta))) };
  });
  const qualification: Qualification = direction === "NEUTRAL" ? "NO_QUALIFYING_OPPORTUNITY" : entryTiming === "WAIT_FOR_PULLBACK" ? "WAIT_FOR_ENTRY" : "ACTIVE";
  const thesisStatus: ThesisState = direction === "NEUTRAL" ? "NO_SETUP" : entryTiming === "WAIT_FOR_PULLBACK" ? "PULLBACK_WITHIN_THESIS" : previousDirection === direction ? "ACTIVE" : "CONFIRMED";
  const evidence = {
    daily_structure: d1 > 20 ? "Bullish" : d1 < -20 ? "Bearish" : "Balanced",
    h4_structure: h4 > 20 ? "Bullish" : h4 < -20 ? "Bearish" : "Balanced",
    h1_structure: h1 > 20 ? "Bullish" : h1 < -20 ? "Bearish" : "Balanced",
    m10_entry_context: `${md.latest.preferredDir || "NONE"} · ${md.latest.structureState || "n/a"}`,
    runway: runwayPips == null ? "No verified opposing structure" : `${runwayPips} pips to opposing structure`,
    data_coverage: `D1 ${md.dataCoverage.d1}/20 · H4 ${md.dataCoverage.h4}/30 · H1 ${md.dataCoverage.h1}/80`,
  };
  const reasoning = direction === "NEUTRAL"
    ? (historyReady ? "NO HIGH-CONVICTION SETUP — Daily/H4 structure and available directional runway do not align strongly enough." : "NO HIGH-CONVICTION SETUP — accumulating verified broker candle history; no higher-timeframe call is permitted yet.")
    : `${marketRegime.replaceAll("_", " ")}. Daily/H4 structure agrees, with ${runwayPips} pips of verified room before the nearest opposing structure. ${entryTiming === "WAIT_FOR_PULLBACK" ? "Thesis is active, but price is extended; wait for value." : "Entry timing is acceptable."}`;
  return {
    direction, qualification, thesisStatus, confidence, expectedMovePips: direction === "NEUTRAL" ? null : [expectedLow, expectedHigh], preferredZone,
    invalidation: direction === "NEUTRAL" ? null : invalidation, targets, directionalRunwayPips: direction === "NEUTRAL" ? null : runwayPips,
    currentPrice: r2(price), regimeLabel: marketRegime, netScore: net, htfScores: { d1, h4, h1 }, opposingStructureConfirmed: opposed,
    evidence, reasoning, invalidationReason: direction === "NEUTRAL" ? "No active thesis." : `A ${direction === "BUY" ? "H4/D1 close below" : "H4/D1 close above"} ${invalidation} invalidates this structure.`,
    dataSource: md.source, dataStale: md.ageSec > 600, dataStatus: md.dataStatus, entryTiming,
  };
}
