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
import { getCachedLiveQuote } from "./liveQuoteCache.js";

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

/**
 * Observability codes for the market-data read path (see audit "URGENT FIX
 * XAUCLOUD MANUAL TRADING LIVE MARKET FEED", 2026-08-25). Distinguishing
 * these matters: a genuinely empty query result (no EA has posted a fresh
 * XAUUSD quote) and a thrown database error were previously both collapsed
 * into the same `null` return, so "the EA is offline" and "Mongo timed out"
 * were indistinguishable everywhere downstream -- including in the
 * MTI_DEGRADED log line an operator would actually look at during an
 * incident. They are root-cause-different and need different responses.
 */
export type MarketDataReadCode =
  | "LIVE_MARKET_OK"
  | "EA_FEED_MISSING"
  | "DATABASE_READ_TIMEOUT"
  | "DATABASE_UNAVAILABLE";

export interface MarketDataReadResult {
  code: MarketDataReadCode;
  data: MarketData | null;
  errorMessage: string | null;
}

/** Classify a thrown Mongo driver error into a diagnostic-friendly code. Best-effort: unknown error shapes still degrade safely to DATABASE_UNAVAILABLE. */
function classifyDbError(error: unknown): { code: "DATABASE_READ_TIMEOUT" | "DATABASE_UNAVAILABLE"; message: string } {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const isTimeout =
    name === "MongoServerSelectionError" ||
    name === "MongoNetworkTimeoutError" ||
    /timed?\s*out|timeout|ETIMEDOUT/i.test(message);
  return { code: isTimeout ? "DATABASE_READ_TIMEOUT" : "DATABASE_UNAVAILABLE", message: message.slice(0, 300) };
}

let lastLoggedReadCode: MarketDataReadCode | null = null;

export async function readMarketDataWithStatus(): Promise<MarketDataReadResult> {
  let result: MarketDataReadResult;
  try {
    const data = await readMarketDataInner();
    lastReadError = null;
    result = { code: data ? "LIVE_MARKET_OK" : "EA_FEED_MISSING", data, errorMessage: null };
  } catch (error) {
    const classified = classifyDbError(error);
    lastReadError = classified.message;
    recordDiagnostic("warning", "manual-trading-market-feed", error, { code: "BROKER_MARKET_READ_FAILED" });
    result = { code: classified.code, data: null, errorMessage: classified.message };
  }
  // Throttle: only log on a state transition, never on every ~20-40s tick,
  // so a sustained outage produces one line instead of spamming the journal.
  if (result.code !== lastLoggedReadCode) {
    console.log(`MARKET_FEED_STATUS code=${result.code}${result.errorMessage ? ` error=${result.errorMessage}` : ""}`);
    lastLoggedReadCode = result.code;
  }
  return result;
}

export async function readMarketData(): Promise<MarketData | null> {
  return (await readMarketDataWithStatus()).data;
}

export function marketDataReadError(): string | null { return lastReadError; }

// Matches EA_STALE_SEC in fourHourOutlookService.ts -- a cached heartbeat
// quote older than this is not "fresh" either, so the fallback below must
// not accept it just because Mongo happened to be unreachable at the time.
const CACHE_FALLBACK_STALE_SEC = 10 * 60;

/**
 * Degrade to the most recent quote the heartbeat path already validated in
 * memory (see liveQuoteCache.ts), when the durable "newest broker quote"
 * read failed or found nothing. Never fabricates a price: only a quote the
 * EA genuinely sent and the backend genuinely validated is ever returned
 * here, and only while it is still within the same freshness window a
 * database-backed read would have required.
 */
function cachedQuoteAsMarketData(): MarketData | null {
  const cached = getCachedLiveQuote();
  if (!cached || cached.normalizedSymbol !== "XAUUSD") return null;
  const ts = new Date(cached.sourceAtIso || cached.receivedAtIso).getTime() / 1000;
  const ageSec = Date.now() / 1000 - ts;
  if (!Number.isFinite(ts) || !(ageSec >= 0 && ageSec <= CACHE_FALLBACK_STALE_SEC)) return null;
  if (!(cached.mid >= GOLD_MIN && cached.mid <= GOLD_MAX)) return null;
  const snap: EaSnapshot = {
    ts, mid: cached.mid, thesisDir: "", preferredDir: "", buyP: 0, sellP: 0, trendHealth: 0, location: 0,
    exhaustion: 0, moveConsumed: 0, buyRoomR: 0, sellRoomR: 0, structuralSl: 0, atr: 0, structureState: "",
    trendState: "", buyCase: 0, sellCase: 0, freshness: "", invalidated: false,
  };
  return {
    price: cached.mid, latestTs: ts, ageSec, candlesH1: [], candlesH4: [], candlesD1: [],
    snapshots: [snap], latest: snap, account: cached.account, source: "ea-stream(spot)",
    dataStatus: "ACCUMULATING_BROKER_HISTORY", dataCoverage: { h1: 0, h4: 0, d1: 0, complete: false },
  };
}

async function readMarketDataInner(): Promise<MarketData | null> {
  // A transient failure on ANY of the three reads below (the initial quote
  // lookup, the windowed snapshot query, or the candle read) must not blank
  // the card when the backend already holds a fresh, verified quote from the
  // heartbeat path that just succeeded moments ago -- see liveQuoteCache.ts.
  // Scoped to this one function, not a blanket catch-and-hope: only a
  // genuinely fresh, symbol-matched, already-validated quote is ever used.
  try {
    return await readMarketDataFromDb();
  } catch (error) {
    const fallback = cachedQuoteAsMarketData();
    if (fallback) return fallback;
    throw error;
  }
}

async function readMarketDataFromDb(): Promise<MarketData | null> {
  const db = getDb();
  // Select one live broker stream. The earlier implementation combined all
  // accounts in one candle series, which is invalid whenever feeds differ.
  const newest = await db.collection("cloud_bot_activity")
    .find({ normalized_symbol: "XAUUSD", "details.market_thesis.live_bid": { $gt: 0 }, "details.market_thesis.live_ask": { $gt: 0 } }, { projection: PROJECTION })
    .sort({ ts: -1 }).limit(1).next() as Record<string, unknown> | null;
  if (!newest || !str(newest["account"])) {
    const fallback = cachedQuoteAsMarketData();
    if (fallback) return fallback;
    return null;
  }
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
  if (snaps.length === 0) {
    const fallback = cachedQuoteAsMarketData();
    if (fallback) return fallback;
    return null;
  }
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
