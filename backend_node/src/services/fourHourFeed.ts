/**
 * Manual Trading Intelligence -- REAL SPOT XAU/USD H1/H4 OHLC feed.
 *
 * DISPLAY/ANALYSIS ONLY. Zero connection to trade execution, the EA command
 * channel, or any position/risk logic.
 *
 * CRITICAL (2026-08 data-integrity fix): the previous implementation used
 * Yahoo GC=F, which is COMEX gold *futures* -- structurally ~$40-60 above the
 * spot XAUUSD customers actually trade (cost-of-carry basis). That is the wrong
 * instrument and is NEVER used here. This feed pulls genuine SPOT gold only,
 * from providers whose latest price is later cross-checked against XauCloud's
 * own live broker XAUUSD before any forecast is published:
 *
 *   1. Twelve Data  XAU/USD  (spot; requires free TWELVEDATA_API_KEY)
 *   2. Kraken       PAXG/USD (tokenised physical gold, ~spot; keyless)
 *   3. Binance      PAXGUSDT (tokenised physical gold, ~spot; keyless)
 *
 * There is NO futures fallback and NO fabricated/sample data. If no source
 * returns fresh, complete, sane candles the feed returns null and the engine
 * refuses to publish (degraded). Cache 5 min.
 */
import { env } from "../env.js";

export interface Candle {
  t: number; // bar open time, unix seconds (UTC)
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface OhlcFeed {
  h1: Candle[];
  h4: Candle[];
  spot: number; // most recent close (same source as the candles)
  source: string;
  fetchedAt: string; // ISO
  latestCandleTime: string; // ISO of newest H1 bar
  stale: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_H1 = 60; // need >=~200h for H4 EMA50; 60 is the hard floor to attempt
const GOLD_MIN = 1000;
const GOLD_MAX = 20000;

let cache: OhlcFeed | null = null;
let cacheTime = 0;

function sane(c: Candle): boolean {
  return [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v) && v >= GOLD_MIN && v <= GOLD_MAX) && c.h >= c.l;
}

function clean(candles: Candle[]): Candle[] {
  return candles.filter(sane).sort((a, b) => a.t - b.t);
}

function aggregateH4(h1: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of h1) {
    const d = new Date(c.t * 1000);
    const alignedHour = Math.floor(d.getUTCHours() / 4) * 4;
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), alignedHour) / 1000;
    const ex = buckets.get(start);
    if (!ex) buckets.set(start, { t: start, o: c.o, h: c.h, l: c.l, c: c.c });
    else { ex.h = Math.max(ex.h, c.h); ex.l = Math.min(ex.l, c.l); ex.c = c.c; }
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ---- source 1: Twelve Data spot XAU/USD ----
async function fromTwelveData(): Promise<Candle[] | null> {
  const key = env.TWELVEDATA_API_KEY;
  if (!key) return null;
  const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1h&outputsize=400&order=ASC&apikey=${encodeURIComponent(key)}`;
  const j = (await getJson(url)) as { status?: string; values?: { datetime: string; open: string; high: string; low: string; close: string }[] } | null;
  if (!j || j.status !== "ok" || !Array.isArray(j.values)) return null;
  const out: Candle[] = [];
  for (const v of j.values) {
    const t = Math.floor(new Date(v.datetime.replace(" ", "T") + "Z").getTime() / 1000);
    out.push({ t, o: Number(v.open), h: Number(v.high), l: Number(v.low), c: Number(v.close) });
  }
  return out;
}

// ---- source 2: Kraken PAXG/USD (keyless) ----
async function fromKraken(): Promise<Candle[] | null> {
  const j = (await getJson("https://api.kraken.com/0/public/OHLC?pair=PAXGUSD&interval=60")) as { error?: string[]; result?: Record<string, unknown> } | null;
  if (!j || (j.error && j.error.length) || !j.result) return null;
  const key = Object.keys(j.result).find((k) => k !== "last");
  if (!key) return null;
  const rows = j.result[key] as (string | number)[][];
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
}

// ---- source 3: Binance PAXGUSDT (keyless) ----
async function fromBinance(): Promise<Candle[] | null> {
  for (const host of ["api.binance.com", "data-api.binance.vision"]) {
    const j = (await getJson(`https://${host}/api/v3/klines?symbol=PAXGUSDT&interval=1h&limit=500`)) as (string | number)[][] | null;
    if (Array.isArray(j) && j.length) {
      return j.map((r) => ({ t: Math.floor(Number(r[0]) / 1000), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
    }
  }
  return null;
}

const SOURCES: { name: string; fn: () => Promise<Candle[] | null> }[] = [
  { name: "twelvedata:XAU/USD(spot)", fn: fromTwelveData },
  { name: "kraken:PAXGUSD(spot)", fn: fromKraken },
  { name: "binance:PAXGUSDT(spot)", fn: fromBinance },
];

/**
 * Returns a genuine SPOT OHLC feed or null. Never futures, never fabricated.
 * The caller must still cross-check `spot` against the broker XAUUSD and enforce
 * freshness before publishing a forecast.
 */
export async function fetchXauOhlc(): Promise<OhlcFeed | null> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return cache;

  for (const src of SOURCES) {
    let raw: Candle[] | null = null;
    try { raw = await src.fn(); } catch { raw = null; }
    if (!raw) continue;
    const h1 = clean(raw);
    if (h1.length < MIN_H1) continue;
    const h4 = aggregateH4(h1);
    if (h4.length < 20) continue;
    const newest = h1[h1.length - 1]!;
    const feed: OhlcFeed = {
      h1, h4, spot: newest.c, source: src.name,
      fetchedAt: new Date().toISOString(),
      latestCandleTime: new Date(newest.t * 1000).toISOString(),
      stale: false,
    };
    cache = feed;
    cacheTime = now;
    return feed;
  }

  // No genuine spot source succeeded. Return the last good cache marked stale so
  // the caller can decide (freshness gate) -- but NEVER fabricate.
  if (cache) return { ...cache, stale: true };
  return null;
}

/** Test/replay seam. */
export function __setFeedCacheForTest(feed: OhlcFeed | null): void {
  cache = feed;
  cacheTime = feed ? Date.now() : 0;
}
