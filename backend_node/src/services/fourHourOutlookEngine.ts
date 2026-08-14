/**
 * XauCloud 4H Outlook -- forecasting engine (PURE, DISPLAY-ONLY).
 *
 * Independent H4/H1 aggregation layer for a manual-trader directional forecast.
 * It consumes real OHLC (fourHourFeed) plus, as supporting context only, the
 * EA's already-computed regime/location/M10 evidence and the existing
 * short-term Outlook (READ-ONLY). It produces a forecast object. It CANNOT and
 * does NOT open/close/modify trades: it returns data, nothing else. No imports
 * from any execution/command/EA-write module.
 *
 * Weighting priorities (conceptual, adaptive -- not a naive fixed score):
 *   60% trend / structure   (H4 + H1 EMA alignment, slope, swing structure, BOS)
 *   20% price action        (displacement, breakout/retest, rejection, pullback)
 *   20% supporting context  (EA regime/location/exhaustion/room + existing outlook)
 *
 * Pip convention: 1 pip = $0.10 gold move (matches the production EA's own
 * peakPips convention). pips = priceMove / 0.10.
 */
import type { Candle, OhlcFeed } from "./fourHourFeed.js";

export const PIP_USD = 0.10;
export const pipsOf = (priceMove: number): number => priceMove / PIP_USD;
export const QUALIFYING_PIPS = 200; // ~$20 credible 4h room for an ACTIVE signal

export interface EaContext {
  regime?: string; // TREND_UP / TREND_DOWN / RANGE ...
  trendHealth?: number; // 0..100
  location?: number; // 0..100 location quality
  exhaustion?: number; // 0..100
  buyPressure?: number; // 0..100
  sellPressure?: number; // 0..100
  roomR?: number; // remaining room in R
  htfState?: string;
  m10Direction?: string; // BUY / SELL / NONE
  ageSeconds?: number | null;
}

export interface ExistingOutlook {
  direction?: string; // BUY / SELL / NEUTRAL
  confidence?: number; // 0..100
}

export type Direction = "BUY" | "SELL" | "NEUTRAL";
export type Qualification = "ACTIVE" | "WAIT_FOR_ENTRY" | "NO_QUALIFYING_OPPORTUNITY";

export interface FourHourForecast {
  direction: Direction;
  qualification: Qualification;
  confidence: number; // 0..100
  expectedMovePips: [number, number] | null;
  preferredZone: [number, number] | null;
  invalidation: number | null;
  currentPrice: number;
  regimeLabel: string;
  netScore: number; // -100..100 (BUY positive)
  evidence: Record<string, string>;
  reasoning: string;
  dataSource: string;
  dataStale: boolean;
}

// ----------------------------- indicators --------------------------------
function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) out.push(values[i]! * k + out[i - 1]! * (1 - k));
  return out;
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const window = trs.slice(-period);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

/** Fractal swing points (2-bar) -> returns highs and lows in chronological order. */
function swings(candles: Candle[]): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i]!.h;
    const l = candles[i]!.l;
    if (h > candles[i - 1]!.h && h > candles[i - 2]!.h && h > candles[i + 1]!.h && h > candles[i + 2]!.h) highs.push(h);
    if (l < candles[i - 1]!.l && l < candles[i - 2]!.l && l < candles[i + 1]!.l && l < candles[i + 2]!.l) lows.push(l);
  }
  return { highs, lows };
}

/** Trend read for one timeframe: -100..100 (bullish positive). */
function tfTrend(candles: Candle[]): { score: number; emaFast: number; emaSlow: number; slope: number } {
  const closes = candles.map((c) => c.c);
  if (closes.length < 55) return { score: 0, emaFast: closes.at(-1) ?? 0, emaSlow: closes.at(-1) ?? 0, slope: 0 };
  const f = ema(closes, 20);
  const s = ema(closes, 50);
  const emaFast = f.at(-1)!;
  const emaSlow = s.at(-1)!;
  const price = closes.at(-1)!;
  const slopeRaw = (s.at(-1)! - s.at(-6)!) / 5; // EMA50 slope over last 5 bars
  const sep = emaSlow > 0 ? ((emaFast - emaSlow) / emaSlow) * 10000 : 0; // separation in bp
  let score = 0;
  score += price > emaSlow ? 30 : -30; // price side of trend EMA
  score += emaFast > emaSlow ? 25 : -25; // fast/slow alignment
  score += Math.max(-25, Math.min(25, sep * 2.5)); // magnitude of separation
  score += Math.max(-20, Math.min(20, slopeRaw * 8)); // slope contribution
  return { score: Math.max(-100, Math.min(100, score)), emaFast, emaSlow, slope: slopeRaw };
}

/** Market structure from H4 swings: HH/HL (bullish) vs LH/LL (bearish). */
function structureScore(candles: Candle[]): { score: number; label: string; lastLow: number; lastHigh: number } {
  const { highs, lows } = swings(candles);
  const lastHigh = highs.at(-1) ?? candles.at(-1)!.h;
  const lastLow = lows.at(-1) ?? candles.at(-1)!.l;
  let score = 0;
  let label = "Range";
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs.at(-1)! > highs.at(-2)!;
    const hl = lows.at(-1)! > lows.at(-2)!;
    const lh = highs.at(-1)! < highs.at(-2)!;
    const ll = lows.at(-1)! < lows.at(-2)!;
    if (hh && hl) { score = 80; label = "Higher highs / higher lows"; }
    else if (lh && ll) { score = -80; label = "Lower highs / lower lows"; }
    else if (hh || hl) { score = 35; label = "Constructive (partial bullish structure)"; }
    else if (lh || ll) { score = -35; label = "Deteriorating (partial bearish structure)"; }
    else { score = 0; label = "Range / mixed structure"; }
  }
  return { score, label, lastLow, lastHigh };
}

/** Price-action read on the recent H1 tail: displacement + pullback + breakout. */
function priceAction(h1: Candle[]): { score: number; note: string } {
  if (h1.length < 6) return { score: 0, note: "insufficient" };
  const tail = h1.slice(-6);
  const body = tail.reduce((a, c) => a + (c.c - c.o), 0); // net displacement
  const range = Math.max(...tail.map((c) => c.h)) - Math.min(...tail.map((c) => c.l)) || 1;
  const disp = Math.max(-60, Math.min(60, (body / range) * 120));
  const last = h1.at(-1)!;
  const wickUp = last.h - Math.max(last.o, last.c);
  const wickDn = Math.min(last.o, last.c) - last.l;
  const rejection = wickDn > wickUp ? 15 : wickUp > wickDn ? -15 : 0; // lower-wick rejection = bullish
  const score = Math.max(-100, Math.min(100, disp + rejection));
  const note = body > 0 ? "bullish displacement" : body < 0 ? "bearish displacement" : "balanced";
  return { score, note };
}

/** Context read from EA evidence + existing outlook. -100..100. */
function contextScore(ea: EaContext | null, existing: ExistingOutlook | null): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;
  let n = 0;
  if (ea) {
    if (ea.regime) {
      if (/UP|BULL/i.test(ea.regime)) { score += 40; notes.push(`EA regime ${ea.regime}`); n++; }
      else if (/DOWN|BEAR/i.test(ea.regime)) { score -= 40; notes.push(`EA regime ${ea.regime}`); n++; }
      else { notes.push(`EA regime ${ea.regime}`); n++; }
    }
    if (typeof ea.buyPressure === "number" && typeof ea.sellPressure === "number") {
      score += Math.max(-30, Math.min(30, (ea.buyPressure - ea.sellPressure) * 0.6));
      n++;
    }
    if (ea.m10Direction === "BUY") { score += 15; n++; notes.push("M10 bias BUY"); }
    else if (ea.m10Direction === "SELL") { score -= 15; n++; notes.push("M10 bias SELL"); }
  }
  if (existing?.direction === "BUY") { score += 12; notes.push("short-term Outlook BUY"); n++; }
  else if (existing?.direction === "SELL") { score -= 12; notes.push("short-term Outlook SELL"); n++; }
  if (n === 0) return { score: 0, notes: ["no EA/outlook context available"] };
  return { score: Math.max(-100, Math.min(100, score)), notes };
}

// ------------------------------- engine ----------------------------------
export function computeForecast(feed: OhlcFeed, ea: EaContext | null, existing: ExistingOutlook | null): FourHourForecast {
  const price = feed.spot;
  const h4Trend = tfTrend(feed.h4);
  const h1Trend = tfTrend(feed.h1);
  const struct = structureScore(feed.h4);
  const pa = priceAction(feed.h1);
  const ctx = contextScore(ea, existing);

  // 60% trend/structure, 20% price action, 20% context.
  const trendStructure = h4Trend.score * 0.55 + h1Trend.score * 0.2 + struct.score * 0.25; // internally weighted
  const netScore = Math.max(-100, Math.min(100, trendStructure * 0.6 + pa.score * 0.2 + ctx.score * 0.2));

  const atrH4 = atr(feed.h4, 14);
  const atrH1 = atr(feed.h1, 14);
  // Recent realized H4 ranges (typical achievable swing over ~4h horizon).
  const recentRanges = feed.h4.slice(-10).map((c) => c.h - c.l);
  const medRange = recentRanges.slice().sort((a, b) => a - b)[Math.floor(recentRanges.length / 2)] ?? atrH4;

  // Expected credible move over next ~4h. A realistic horizon target is on the
  // order of a typical H4 candle range (not a large ATR multiple), so we anchor
  // on the median recent H4 range blended with ATR(H4), scaled modestly by
  // conviction. This keeps qualifying signals in a believable ~200-400 pip band
  // and lets genuinely quiet markets fall below the 200-pip qualifier.
  const conviction = Math.abs(netScore) / 100; // 0..1
  const baseMove = medRange * 0.5 + atrH4 * 0.5;
  const lowMove = baseMove * (0.8 + conviction * 0.3);
  const highMove = baseMove * (1.4 + conviction * 0.8);
  const expLowPips = Math.round(pipsOf(lowMove) / 10) * 10;
  const expHighPips = Math.round(pipsOf(highMove) / 10) * 10;

  const dirThreshold = 30;
  let direction: Direction = "NEUTRAL";
  if (netScore >= dirThreshold) direction = "BUY";
  else if (netScore <= -dirThreshold) direction = "SELL";

  // Confidence: calibrated from cross-timeframe agreement + conviction, penalised
  // for H1/H4 conflict and mixed structure.
  const agree = (Math.sign(h4Trend.score) === Math.sign(h1Trend.score) ? 1 : 0) + (Math.sign(h4Trend.score) === Math.sign(struct.score) ? 1 : 0);
  const conflictPenalty = Math.sign(h1Trend.score) !== 0 && Math.sign(h1Trend.score) !== Math.sign(h4Trend.score) ? 12 : 0;
  let confidence = Math.round(40 + conviction * 35 + agree * 8 - conflictPenalty);
  confidence = Math.max(0, Math.min(95, confidence));

  // Preferred entry zone: pull-back value area toward H1 EMA20 / recent swing.
  let preferredZone: [number, number] | null = null;
  let invalidation: number | null = null;
  const buffer = Math.max(atrH1 * 0.6, 1.0);
  if (direction === "BUY") {
    const zoneMid = Math.min(price, (h1Trend.emaFast + struct.lastLow) / 2 + buffer);
    preferredZone = [round2(zoneMid - buffer), round2(Math.min(price, zoneMid + buffer))];
    invalidation = round2(struct.lastLow - buffer);
  } else if (direction === "SELL") {
    const zoneMid = Math.max(price, (h1Trend.emaFast + struct.lastHigh) / 2 - buffer);
    preferredZone = [round2(Math.max(price, zoneMid - buffer)), round2(zoneMid + buffer)];
    invalidation = round2(struct.lastHigh + buffer);
  }

  // Qualification.
  let qualification: Qualification = "NO_QUALIFYING_OPPORTUNITY";
  const roomQualifies = expHighPips >= QUALIFYING_PIPS && Math.abs(netScore) >= dirThreshold && confidence >= 55;
  if (direction === "NEUTRAL" || !roomQualifies) {
    qualification = "NO_QUALIFYING_OPPORTUNITY";
    if (direction !== "NEUTRAL" && !roomQualifies) direction = "NEUTRAL"; // do not force a signal without room
  } else if (preferredZone && ((direction === "BUY" && price > preferredZone[1] + buffer) || (direction === "SELL" && price < preferredZone[0] - buffer))) {
    qualification = "WAIT_FOR_ENTRY"; // right bias, price extended away from value
  } else {
    qualification = "ACTIVE";
  }

  const regimeLabel = regimeName(direction, struct, netScore, ea);
  const evidence = buildEvidence(direction, h4Trend, h1Trend, struct, pa, ea, atrH4, atrH1);
  const reasoning = buildReasoning(direction, qualification, struct, price, preferredZone, expLowPips, expHighPips, ctx);

  return {
    direction,
    qualification,
    confidence,
    expectedMovePips: direction === "NEUTRAL" ? null : [expLowPips, expHighPips],
    preferredZone: direction === "NEUTRAL" ? null : preferredZone,
    invalidation: direction === "NEUTRAL" ? null : invalidation,
    currentPrice: round2(price),
    regimeLabel,
    netScore: Math.round(netScore),
    evidence,
    reasoning,
    dataSource: feed.source,
    dataStale: feed.stale,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function regimeName(dir: Direction, struct: { score: number }, net: number, ea: EaContext | null): string {
  if (dir === "NEUTRAL") return Math.abs(net) < 15 ? "Range / Chop" : "Indecisive";
  const reversal = ea?.exhaustion != null && ea.exhaustion >= 75;
  if (dir === "BUY") return reversal ? "Bullish Reversal (late-stage caution)" : struct.score >= 60 ? "Bullish Continuation" : "Bullish Bias";
  return reversal ? "Bearish Reversal (late-stage caution)" : struct.score <= -60 ? "Bearish Continuation" : "Bearish Bias";
}

function tag(score: number, up: string, down: string, flat: string): string {
  return score > 20 ? up : score < -20 ? down : flat;
}

function buildEvidence(
  dir: Direction,
  h4: { score: number },
  h1: { score: number },
  struct: { label: string },
  pa: { note: string },
  ea: EaContext | null,
  atrH4: number,
  atrH1: number,
): Record<string, string> {
  return {
    h4_trend: tag(h4.score, "Bullish", "Bearish", "Neutral"),
    h1_structure: tag(h1.score, "Bullish", "Bearish", "Neutral"),
    market_structure: struct.label,
    momentum: tag(h1.score + h4.score, "Strengthening", "Weakening", "Flat"),
    price_action: pa.note,
    location: ea?.location != null ? qualBand(ea.location) : "n/a",
    volatility: atrH1 > 0 ? `${atrH1 >= atrH4 * 0.35 ? "Healthy" : "Compressed"} (H1 ATR ${atrH1.toFixed(2)})` : "n/a",
    exhaustion: ea?.exhaustion != null ? qualBandInverse(ea.exhaustion) : "n/a",
    ea_regime: ea?.regime ?? "n/a",
    bias: dir,
  };
}

function qualBand(v: number): string {
  return v >= 80 ? "Excellent" : v >= 60 ? "Good" : v >= 40 ? "Acceptable" : "Poor";
}
function qualBandInverse(v: number): string {
  return v >= 75 ? "High" : v >= 45 ? "Moderate" : "Low";
}

function buildReasoning(
  dir: Direction,
  qual: Qualification,
  struct: { label: string },
  price: number,
  zone: [number, number] | null,
  lowPips: number,
  highPips: number,
  ctx: { notes: string[] },
): string {
  if (dir === "NEUTRAL") {
    return `Gold shows no high-probability 4-hour directional edge right now. H4/H1 trend and structure are mixed or lack the ~${QUALIFYING_PIPS}-pip room XauCloud requires. Monitoring for a cleaner setup.`;
  }
  const side = dir === "BUY" ? "higher" : "lower";
  const bias = dir === "BUY" ? "bullish" : "bearish";
  const zoneTxt = zone ? `${zone[0]}–${zone[1]}` : "current value";
  const waitTxt = qual === "WAIT_FOR_ENTRY" ? ` Price is currently extended from value — XauCloud favors waiting for a pullback toward ${zoneTxt} rather than chasing.` : "";
  return `Gold is ${bias} on H1/H4 (${struct.label.toLowerCase()}). XauCloud expects continuation ${side} over the next four hours, roughly ${lowPips}–${highPips} pips of realistic room, with preferred value around ${zoneTxt}.${waitTxt} Context: ${ctx.notes.slice(0, 3).join(", ")}. This is a higher-probability current bias, not a guarantee.`;
}
