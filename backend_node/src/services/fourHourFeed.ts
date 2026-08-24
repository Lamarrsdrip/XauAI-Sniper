/**
 * Manual Trading Intelligence market-data boundary.
 *
 * Direction is built from verified broker OHLC, never from an M10 decision.
 * M10 fields are retained only as optional entry-timing context. Candles are
 * account-scoped: mixing a VPS feed with a Mac feed would fabricate a market
 * series, so the most recently live account is selected and used exclusively.
 */
import { getDb } from "../db.js";
import { recordDiagnostic } from "./diagnostics.js";

export interface Candle { t: number; o: number; h: number; l: number; c: number; }
export interface EaSnapshot {
  ts: number; mid: number; thesisDir: string; preferredDir: string; buyP: number; sellP: number;
  trendHealth: number; location: number; exhaustion: number; moveConsumed: number; buyRoomR: number;
  sellRoomR: number; structuralSl: number; atr: number; structureState: string; trendState: string;
  buyCase: number; sellCase: number; freshness: string; invalidated: boolean;
}
export interface MarketData {
  price: number; latestTs: number; ageSec: number; candlesH1: Candle[]; candlesH4: Candle[];
  candlesD1: Candle[]; snapshots: EaSnapshot[]; latest: EaSnapshot; account: string; source: string;
  dataStatus: "READY" | "ACCUMULATING_BROKER_HISTORY";
  dataCoverage: { h1: number; h4: number; d1: number; complete: boolean };
}

const GOLD_MIN = 1000;
const GOLD_MAX = 20_000;
const RAW_WINDOW_HOURS = 48;
const SNAPSHOT_WINDOW_MIN = 90;
const REQUIRED = { h1: 80, h4: 30, d1: 20 };
let lastReadError: string | null = null;

function num(v: unknown, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function str(v: unknown): string { return v == null ? "" : String(v); }
function asCandle(row: Record<string, unknown>): Candle | null {
  const t = new Date(String(row["openTime"] ?? "")).getTime() / 1000;
  const o = num(row["o"], NaN), h = num(row["h"], NaN), l = num(row["l"], NaN), c = num(row["c"], NaN);
  return [t, o, h, l, c].every(Number.isFinite) && h >= l && o >= l && o <= h && c >= l && c <= h ? { t, o, h, l, c } : null;
}
function buildCandles(px: { t: number; mid: number }[], bucketSec: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const p of px) {
    const start = Math.floor(p.t / bucketSec) * bucketSec;
    const old = buckets.get(start);
    if (!old) buckets.set(start, { t: start, o: p.mid, h: p.mid, l: p.mid, c: p.mid });
    else { old.h = Math.max(old.h, p.mid); old.l = Math.min(old.l, p.mid); old.c = p.mid; }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}
function snapshot(row: Record<string, unknown>): EaSnapshot | null {
  const ts = new Date(String(row["ts"] ?? "")).getTime() / 1000;
  const details = (row["details"] as Record<string, unknown> | undefined) ?? {};
  const mt = (details["market_thesis"] as Record<string, unknown> | undefined) ?? {};
  const m10 = (details["m10_signal"] as Record<string, unknown> | undefined) ?? {};
  const bid = num(mt["live_bid"]), ask = num(mt["live_ask"]);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : num(mt["live_mid"]);
  if (!Number.isFinite(ts) || !(mid >= GOLD_MIN && mid <= GOLD_MAX)) return null;
  return {
    ts, mid, thesisDir: str(mt["direction"]).toUpperCase(), preferredDir: str(m10["preferred_direction"]).toUpperCase(),
    buyP: num(mt["buy_pressure"] ?? m10["buy_pressure"]), sellP: num(mt["sell_pressure"] ?? m10["sell_pressure"]),
    trendHealth: num(mt["trend_health"]), location: num(mt["location_quality"]),
    exhaustion: num(mt["exhaustion_pct"] ?? m10["exhaustion_score"]), moveConsumed: num(mt["move_consumed_pct"]),
    buyRoomR: num(m10["buy_room_r"] ?? mt["remaining_room_r"]), sellRoomR: num(m10["sell_room_r"] ?? mt["remaining_room_r"]),
    structuralSl: num(mt["final_structural_sl"] ?? mt["structural_sl"]), atr: num(mt["atr_m5"]),
    structureState: str(m10["structure_state"]), trendState: str(m10["trend_state"]), buyCase: num(m10["buy_case_score"]),
    sellCase: num(m10["sell_case_score"]), freshness: str(m10["freshness_state"]), invalidated: Boolean(mt["invalidated"]),
  };
}

const PROJECTION = { _id: 0, ts: 1, account: 1, details: 1 } as const;

export async function readMarketData(): Promise<MarketData | null> {
  try {
    const data = await readMarketDataInner();
    lastReadError = null;
    return data;
  } catch (error) {
    lastReadError = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
    recordDiagnostic("warning", "manual-trading-market-feed", error, { code: "BROKER_MARKET_READ_FAILED" });
    return null;
  }
}

export function marketDataReadError(): string | null { return lastReadError; }

async function readMarketDataInner(): Promise<MarketData | null> {
  const db = getDb();
  // Select one live broker stream. The earlier implementation combined all
  // accounts in one candle series, which is invalid whenever feeds differ.
  const newest = await db.collection("cloud_bot_activity")
    .find({ normalized_symbol: "XAUUSD", "details.market_thesis.live_bid": { $gt: 0 }, "details.market_thesis.live_ask": { $gt: 0 } }, { projection: PROJECTION })
    .sort({ ts: -1 }).limit(1).next() as Record<string, unknown> | null;
  if (!newest || !str(newest["account"])) return null;
  const account = str(newest["account"]);
  const since = new Date(Date.now() - RAW_WINDOW_HOURS * 3600_000).toISOString();
  const rows = await db.collection("cloud_bot_activity")
    .find({ account, normalized_symbol: "XAUUSD", ts: { $gte: since }, "details.market_thesis.live_bid": { $gt: 0 }, "details.market_thesis.live_ask": { $gt: 0 } }, { projection: PROJECTION })
    .sort({ ts: 1 }).limit(5000).toArray() as Record<string, unknown>[];
  const snaps = rows.map(snapshot).filter((x): x is EaSnapshot => x !== null);
  // One current, verified broker quote is sufficient to report healthy data
  // and an honest history-accumulation/no-setup state.  Three transient
  // activity documents are not a market-data requirement and deduplication
  // can legitimately leave fewer than three while the terminal is live.
  if (snaps.length === 0) return null;
  const latest = snaps.at(-1)!;
  const priceSeries = snaps.map(({ ts, mid }) => ({ t: ts, mid }));
  const stored = await db.collection("manual_trading_broker_candles")
    .find({ account, symbol: "XAUUSD", source: "ea-stream(spot)" }, { projection: { _id: 0, openTime: 1, o: 1, h: 1, l: 1, c: 1, timeframe: 1 } })
    .sort({ openTime: 1 }).limit(4000).toArray() as Record<string, unknown>[];
  const storedBy = (tf: string) => stored.filter((row) => row["timeframe"] === tf).map(asCandle).filter((x): x is Candle => x !== null);
  // Before the durable collector has accumulated sufficient history, show a
  // genuine price but fail closed as NO SETUP rather than inventing HTF data.
  const h1 = storedBy("H1"); const h4 = storedBy("H4"); const d1 = storedBy("D1");
  const candlesH1 = h1.length ? h1 : buildCandles(priceSeries, 3600);
  const candlesH4 = h4.length ? h4 : buildCandles(priceSeries, 4 * 3600);
  const candlesD1 = d1.length ? d1 : buildCandles(priceSeries, 24 * 3600);
  const coverage = { h1: candlesH1.length, h4: candlesH4.length, d1: candlesD1.length, complete: candlesH1.length >= REQUIRED.h1 && candlesH4.length >= REQUIRED.h4 && candlesD1.length >= REQUIRED.d1 };
  const recentStart = latest.ts - SNAPSHOT_WINDOW_MIN * 60;
  return {
    price: latest.mid, latestTs: latest.ts, ageSec: Date.now() / 1000 - latest.ts,
    candlesH1, candlesH4, candlesD1, snapshots: snaps.filter((s) => s.ts >= recentStart), latest, account,
    source: "ea-stream(spot)", dataStatus: coverage.complete ? "READY" : "ACCUMULATING_BROKER_HISTORY", dataCoverage: coverage,
  };
}
