/**
 * Manual Trading Intelligence -- market data from the EA's OWN genuine stream.
 *
 * DISPLAY/ANALYSIS ONLY. Zero connection to trade execution.
 *
 * 2026-08 architecture: NO external market-data API. The live production EA
 * already streams, from the real broker feed customers trade, the genuine
 * XAUUSD price plus its own higher-timeframe read (thesis direction, HTF
 * state, trend health, buy/sell pressure, exhaustion, move-consumed,
 * directional room_R, structural SL) into cloud_bot_activity every few
 * seconds. This module reads that stream, builds H1/H4 candles from the broker
 * price series, and hands the engine the bot's genuine evidence. Perfect price
 * alignment (it IS the broker feed) -- no futures basis, no third-party, no
 * fabricated data. If the EA is offline/stale, this returns null and the
 * engine refuses to publish (degraded).
 */
import { getDb } from "../db.js";

export interface Candle {
  t: number; // bar open time, unix seconds (UTC)
  o: number;
  h: number;
  l: number;
  c: number;
}

/** One genuine EA evidence snapshot on the real broker XAUUSD. */
export interface EaSnapshot {
  ts: number; // unix seconds
  mid: number;
  thesisDir: string; // market_thesis.direction (BUY/SELL/NONE)
  preferredDir: string; // m10_signal.preferred_direction
  buyP: number; // buy_pressure 0..100
  sellP: number; // sell_pressure 0..100
  trendHealth: number; // 0..100
  location: number; // location_quality 0..100
  exhaustion: number; // 0..100 (higher = more exhausted / late)
  moveConsumed: number; // move_consumed_pct 0..100
  buyRoomR: number; // remaining room in R if long
  sellRoomR: number; // remaining room in R if short
  structuralSl: number; // EA's own structural stop (broker scale)
  atr: number; // atr_m5 (broker scale)
  structureState: string;
  trendState: string;
  buyCase: number; // m10 buy_case_score
  sellCase: number; // m10 sell_case_score
  freshness: string;
  invalidated: boolean;
}

export interface MarketData {
  price: number; // latest broker mid (the market customers trade)
  latestTs: number;
  ageSec: number; // age of the newest EA snapshot
  candlesH1: Candle[];
  candlesH4: Candle[];
  snapshots: EaSnapshot[]; // recent window (chronological)
  latest: EaSnapshot;
  account: string;
  source: string; // always "ea-stream(spot)"
}

const WINDOW_HOURS = 24; // retained EA history is ~17h; read up to 24h
const SNAPSHOT_WINDOW_MIN = 90; // smoothing window for the directional read
const GOLD_MIN = 1000;
const GOLD_MAX = 20000;

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function buildCandles(px: { t: number; mid: number }[], bucketSec: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const p of px) {
    const start = Math.floor(p.t / bucketSec) * bucketSec;
    const ex = buckets.get(start);
    if (!ex) buckets.set(start, { t: start, o: p.mid, h: p.mid, l: p.mid, c: p.mid });
    else { ex.h = Math.max(ex.h, p.mid); ex.l = Math.min(ex.l, p.mid); ex.c = p.mid; }
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}

/** Read the EA's genuine broker-fed market data + evidence. Null when the EA is offline/stale. */
export async function readMarketData(): Promise<MarketData | null> {
  const db = getDb();
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  const rows = await db
    .collection("cloud_bot_activity")
    .find(
      { ts: { $gte: sinceIso }, "details.market_thesis.live_bid": { $gt: 0 }, "details.market_thesis.live_ask": { $gt: 0 } },
      { projection: { _id: 0, ts: 1, account: 1, "details.market_thesis": 1, "details.m10_signal": 1 } },
    )
    .sort({ ts: 1 })
    .toArray();
  if (rows.length < 30) return null; // not enough genuine evidence to form a view

  const px: { t: number; mid: number }[] = [];
  const snaps: EaSnapshot[] = [];
  let account = "";
  for (const r of rows) {
    const tsMs = new Date(String(r["ts"])).getTime();
    if (!Number.isFinite(tsMs)) continue;
    const ts = Math.floor(tsMs / 1000);
    const mt = ((r["details"] as Record<string, unknown> | undefined)?.["market_thesis"] as Record<string, unknown>) ?? {};
    const m10 = ((r["details"] as Record<string, unknown> | undefined)?.["m10_signal"] as Record<string, unknown>) ?? {};
    const bid = num(mt["live_bid"]);
    const ask = num(mt["live_ask"]);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : num(mt["live_mid"]);
    if (!(mid >= GOLD_MIN && mid <= GOLD_MAX)) continue;
    account = str(r["account"]) || account;
    px.push({ t: ts, mid });
    snaps.push({
      ts, mid,
      thesisDir: str(mt["direction"]).toUpperCase(),
      preferredDir: str(m10["preferred_direction"]).toUpperCase(),
      buyP: num(mt["buy_pressure"] ?? m10["buy_pressure"]),
      sellP: num(mt["sell_pressure"] ?? m10["sell_pressure"]),
      trendHealth: num(mt["trend_health"]),
      location: num(mt["location_quality"]),
      exhaustion: num(mt["exhaustion_pct"] ?? m10["exhaustion_score"]),
      moveConsumed: num(mt["move_consumed_pct"]),
      buyRoomR: num(m10["buy_room_r"] ?? mt["remaining_room_r"]),
      sellRoomR: num(m10["sell_room_r"] ?? mt["remaining_room_r"]),
      structuralSl: num(mt["final_structural_sl"] ?? mt["structural_sl"]),
      atr: num(mt["atr_m5"]),
      structureState: str(m10["structure_state"]),
      trendState: str(m10["trend_state"]),
      buyCase: num(m10["buy_case_score"]),
      sellCase: num(m10["sell_case_score"]),
      freshness: str(m10["freshness_state"]),
      invalidated: Boolean(mt["invalidated"]),
    });
  }
  if (px.length < 30 || snaps.length === 0) return null;

  const latest = snaps[snaps.length - 1]!;
  const ageSec = Date.now() / 1000 - latest.ts;
  const windowStart = latest.ts - SNAPSHOT_WINDOW_MIN * 60;
  const recent = snaps.filter((s) => s.ts >= windowStart);

  return {
    price: latest.mid,
    latestTs: latest.ts,
    ageSec,
    candlesH1: buildCandles(px, 3600),
    candlesH4: buildCandles(px, 4 * 3600),
    snapshots: recent.length >= 3 ? recent : snaps.slice(-Math.min(snaps.length, 20)),
    latest,
    account,
    source: "ea-stream(spot)",
  };
}
