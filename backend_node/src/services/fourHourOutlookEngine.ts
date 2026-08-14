/**
 * Manual Trading Intelligence -- forecasting engine (PURE, DISPLAY-ONLY).
 *
 * Forms a STABLE ~4-hour directional bias for manual traders from the bot's
 * OWN genuine evidence stream (EA market_thesis + M10 read on the real broker
 * XAUUSD) plus broker-price H1/H4 candles. Aims high like a longer-horizon
 * trader: it smooths the bot's read over a window and uses hysteresis so the
 * bias only flips on a genuine trend change, and it sizes the expected move
 * from the EA's own directional room_R (big-run potential). It returns data
 * only -- it can never open/close/modify a trade.
 *
 * Pip convention: 1 pip = $0.10 gold move (matches the production EA).
 */
import type { Candle, EaSnapshot, MarketData } from "./fourHourFeed.js";

export const PIP_USD = 0.10;
export const pipsOf = (priceMove: number): number => priceMove / PIP_USD;
export const QUALIFYING_PIPS = 200; // a qualifying manual "big run" needs ~200+ pips of room

export type Direction = "BUY" | "SELL" | "NEUTRAL";
export type Qualification = "ACTIVE" | "WAIT_FOR_ENTRY" | "NO_QUALIFYING_OPPORTUNITY";

export interface FourHourForecast {
  direction: Direction;
  qualification: Qualification;
  confidence: number;
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

const ENTER_THRESHOLD = 34; // arm a fresh BUY/SELL only on strong, aligned evidence
const HOLD_THRESHOLD = 16; // keep an existing bias while it stays reasonably supported

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Directional score for one EA snapshot: -100 (SELL) .. +100 (BUY). */
function snapshotScore(s: EaSnapshot): number {
  let score = 0;
  if (s.thesisDir === "BUY") score += 25 + s.trendHealth * 0.25;
  else if (s.thesisDir === "SELL") score -= 25 + s.trendHealth * 0.25;
  score += clamp((s.buyCase - s.sellCase) * 0.55, -35, 35); // M10 case scores
  if (s.preferredDir === "BUY") score += 12;
  else if (s.preferredDir === "SELL") score -= 12;
  score += clamp((s.buyP - s.sellP) * 0.45, -25, 25); // pressure
  // Late / exhausted continuation is genuinely weaker -> damp magnitude.
  const lateDamp = 1 - 0.35 * (clamp(s.exhaustion, 0, 100) / 100) * (clamp(s.moveConsumed, 0, 100) / 100);
  return clamp(score * lateDamp, -100, 100);
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0]!;
  for (let i = 1; i < values.length; i++) e = values[i]! * k + e * (1 - k);
  return e;
}

/** Broker-candle trend confirmation: -100..100. */
function candleTrend(h1: Candle[], h4: Candle[]): number {
  const c1 = h1.map((c) => c.c);
  if (c1.length < 6) return 0;
  const price = c1[c1.length - 1]!;
  const emaFast = ema(c1, Math.min(8, c1.length));
  const emaSlow = ema(c1, Math.min(20, c1.length));
  let s = 0;
  s += price > emaSlow ? 25 : -25;
  s += emaFast > emaSlow ? 20 : -20;
  // H4 direction over the retained window (first vs last close).
  if (h4.length >= 2) s += h4[h4.length - 1]!.c > h4[0]!.c ? 20 : -20;
  return clamp(s, -100, 100);
}

function swingLow(h1: Candle[], n = 12): number {
  const w = h1.slice(-n);
  return w.length ? Math.min(...w.map((c) => c.l)) : (h1[h1.length - 1]?.l ?? 0);
}
function swingHigh(h1: Candle[], n = 12): number {
  const w = h1.slice(-n);
  return w.length ? Math.max(...w.map((c) => c.h)) : (h1[h1.length - 1]?.h ?? 0);
}
function atr(h1: Candle[], period = 14): number {
  if (h1.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < h1.length; i++) trs.push(Math.max(h1[i]!.h - h1[i]!.l, Math.abs(h1[i]!.h - h1[i - 1]!.c), Math.abs(h1[i]!.l - h1[i - 1]!.c)));
  const w = trs.slice(-period);
  return w.reduce((a, b) => a + b, 0) / w.length;
}

export function computeForecast(md: MarketData, previousDirection: Direction = "NEUTRAL"): FourHourForecast {
  const price = md.price;
  const snaps = md.snapshots;

  // Time-weighted smoothed evidence score (more recent = more weight) -> stable.
  let wsum = 0;
  let acc = 0;
  const agree = { buy: 0, sell: 0 };
  snaps.forEach((s, i) => {
    const w = i + 1; // linear recency weight
    const sc = snapshotScore(s);
    acc += sc * w;
    wsum += w;
    if (sc > 8) agree.buy += 1;
    else if (sc < -8) agree.sell += 1;
  });
  const evidenceScore = wsum ? acc / wsum : 0;
  const trendConfirm = candleTrend(md.candlesH1, md.candlesH4);
  const net = clamp(evidenceScore * 0.7 + trendConfirm * 0.3, -100, 100);

  // Direction with hysteresis: arm high, hold while still supported.
  let direction: Direction = "NEUTRAL";
  if (previousDirection === "BUY") {
    direction = net > HOLD_THRESHOLD ? "BUY" : net < -ENTER_THRESHOLD ? "SELL" : "NEUTRAL";
  } else if (previousDirection === "SELL") {
    direction = net < -HOLD_THRESHOLD ? "SELL" : net > ENTER_THRESHOLD ? "BUY" : "NEUTRAL";
  } else {
    direction = net >= ENTER_THRESHOLD ? "BUY" : net <= -ENTER_THRESHOLD ? "SELL" : "NEUTRAL";
  }

  const latest = md.latest;
  const atrH1 = atr(md.candlesH1);
  const rDist = Math.max(Math.abs(latest.mid - latest.structuralSl), atrH1, 4); // EA's own 1R distance (broker scale)
  const roomR = direction === "SELL" ? latest.sellRoomR : latest.buyRoomR;

  // Expected big-run move: the EA's directional room (in R) x R-distance,
  // grounded against realised H4 range, sized by conviction.
  const conviction = Math.abs(net) / 100;
  const roomUsd = clamp(roomR, 0, 12) * rDist; // cap runaway room
  const h4Ranges = md.candlesH4.slice(-6).map((c) => c.h - c.l);
  const typicalH4 = h4Ranges.length ? h4Ranges.reduce((a, b) => a + b, 0) / h4Ranges.length : rDist * 2;
  const baseMove = Math.max(typicalH4 * (1.1 + conviction), roomUsd * 0.6);
  const lowMovePips = Math.round(pipsOf(baseMove * 0.6) / 10) * 10;
  const highMovePips = Math.round(pipsOf(baseMove) / 10) * 10;

  // Confidence: conviction + how consistent the window is + the bot's own trend health.
  const total = Math.max(1, agree.buy + agree.sell);
  const consistency = Math.max(agree.buy, agree.sell) / total; // 0.5..1
  let confidence = Math.round(38 + conviction * 34 + (consistency - 0.5) * 40 + clamp(latest.trendHealth, 0, 100) * 0.08);
  confidence = clamp(confidence, 0, 95);

  // Preferred value zone (pullback) + invalidation, all in broker/spot scale.
  const pull = Math.max(atrH1 * 0.8, rDist * 0.35, 1.5);
  let preferredZone: [number, number] | null = null;
  let invalidation: number | null = null;
  if (direction === "BUY") {
    preferredZone = [round2(price - pull), round2(price - pull * 0.35)];
    invalidation = round2(Math.min(latest.structuralSl > 0 ? latest.structuralSl : price, swingLow(md.candlesH1)) - atrH1 * 0.3);
  } else if (direction === "SELL") {
    preferredZone = [round2(price + pull * 0.35), round2(price + pull)];
    invalidation = round2(Math.max(latest.structuralSl > 0 ? latest.structuralSl : price, swingHigh(md.candlesH1)) + atrH1 * 0.3);
  }

  // Qualification: only a genuine, high-conviction, big-room setup goes ACTIVE.
  let qualification: Qualification = "NO_QUALIFYING_OPPORTUNITY";
  const qualifies = direction !== "NEUTRAL" && highMovePips >= QUALIFYING_PIPS && Math.abs(net) >= (previousDirection === direction ? HOLD_THRESHOLD : ENTER_THRESHOLD) && confidence >= 55;
  if (!qualifies) {
    direction = "NEUTRAL";
    qualification = "NO_QUALIFYING_OPPORTUNITY";
  } else if (preferredZone && ((direction === "BUY" && price > preferredZone[1] + pull) || (direction === "SELL" && price < preferredZone[0] - pull))) {
    qualification = "WAIT_FOR_ENTRY";
  } else {
    qualification = "ACTIVE";
  }

  const evidence = buildEvidence(direction, latest, trendConfirm, atrH1, roomR);
  const regimeLabel = regimeName(direction, latest, net);
  const reasoning = buildReasoning(direction, qualification, latest, price, preferredZone, lowMovePips, highMovePips);

  return {
    direction,
    qualification,
    confidence,
    expectedMovePips: direction === "NEUTRAL" ? null : [lowMovePips, highMovePips],
    preferredZone: direction === "NEUTRAL" ? null : preferredZone,
    invalidation: direction === "NEUTRAL" ? null : invalidation,
    currentPrice: round2(price),
    regimeLabel,
    netScore: Math.round(net),
    evidence,
    reasoning,
    dataSource: md.source,
    dataStale: md.ageSec > 600,
  };
}

function tag(v: number, up: string, down: string, flat: string, band = 15): string {
  return v > band ? up : v < -band ? down : flat;
}

function regimeName(dir: Direction, s: EaSnapshot, net: number): string {
  if (dir === "NEUTRAL") return Math.abs(net) < 12 ? "Range / Balanced" : "Transition / Indecisive";
  const late = s.exhaustion >= 70 || s.moveConsumed >= 80;
  if (dir === "BUY") return late ? "Bullish (late-stage, mind exhaustion)" : "Bullish trend";
  return late ? "Bearish (late-stage, mind exhaustion)" : "Bearish trend";
}

function buildEvidence(dir: Direction, s: EaSnapshot, trendConfirm: number, atrH1: number, roomR: number): Record<string, string> {
  return {
    h4_bias: s.thesisDir === "BUY" ? "Bullish" : s.thesisDir === "SELL" ? "Bearish" : "Neutral",
    h1_trend: tag(trendConfirm, "Bullish", "Bearish", "Neutral"),
    m10_read: `${s.trendState || "n/a"} · ${s.preferredDir || "NONE"}`,
    structure: s.structureState || "n/a",
    momentum: tag(s.buyP - s.sellP, "Buyers in control", "Sellers in control", "Balanced"),
    trend_health: `${Math.round(s.trendHealth)}/100`,
    location: s.location >= 70 ? "Good" : s.location >= 45 ? "Acceptable" : "Poor",
    exhaustion: s.exhaustion >= 70 ? "High" : s.exhaustion >= 45 ? "Moderate" : "Low",
    room_to_run: `${(dir === "SELL" ? s.sellRoomR : dir === "BUY" ? s.buyRoomR : roomR).toFixed(1)}R`,
    volatility: atrH1 > 0 ? `H1 ATR ${atrH1.toFixed(2)}` : "n/a",
  };
}

function buildReasoning(dir: Direction, qual: Qualification, s: EaSnapshot, price: number, zone: [number, number] | null, lowPips: number, highPips: number): string {
  if (dir === "NEUTRAL") {
    return `No high-conviction 4-hour direction from the bot's live read right now (${s.trendState || "mixed"}, ${s.structureState || "mixed structure"}). XauCloud is not calling a big directional run yet — monitoring for a cleaner trend.`;
  }
  const side = dir === "BUY" ? "higher" : "lower";
  const bias = dir === "BUY" ? "bullish" : "bearish";
  const zoneTxt = zone ? `${zone[0]}–${zone[1]}` : "current value";
  const wait = qual === "WAIT_FOR_ENTRY" ? ` Price ${price} is extended from value — XauCloud favors waiting for a pullback toward ${zoneTxt} rather than chasing.` : "";
  return `The bot's live read on the real broker XAUUSD is ${bias} over the next ~4 hours (${s.trendState || "trend"}, buyers vs sellers ${Math.round(s.buyP)}/${Math.round(s.sellP)}), with room to run toward a larger move of roughly ${lowPips}–${highPips} pips. Preferred value is around ${zoneTxt}.${wait} This is a higher-probability current bias for a manual trader, not a guarantee.`;
}
