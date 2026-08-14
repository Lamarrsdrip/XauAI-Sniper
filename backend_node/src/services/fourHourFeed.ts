/**
 * XauCloud 4H Outlook -- REAL external XAUUSD H1/H4 OHLC feed.
 *
 * DISPLAY/ANALYSIS ONLY. This module fetches market data for a manual-trader
 * forecast. It has ZERO connection to trade execution, the EA command channel,
 * or any position/risk logic. It never imports outlookExecution,
 * commandStateMachine, or anything under cloud_bot_commands.
 *
 * Source: Yahoo Finance chart API for COMEX gold futures (GC=F), the same
 * "fetch real public market data" approach the existing goldPrice.ts spot
 * scraper already uses. 1h candles are pulled and aggregated into UTC-aligned
 * 4h candles. Fail-safe: on any error it returns the last good cache (marked
 * stale) or null -- it NEVER fabricates candles.
 */

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
  spot: number; // most recent close
  source: string;
  fetchedAt: string; // ISO
  stale: boolean;
}

const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1h&range=1mo";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min -- H1 structure does not need faster
let cache: OhlcFeed | null = null;
let cacheTime = 0;

/** Aggregate 1h candles into UTC-aligned 4h candles (00,04,08,12,16,20). */
function aggregateH4(h1: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of h1) {
    const d = new Date(c.t * 1000);
    const alignedHour = Math.floor(d.getUTCHours() / 4) * 4;
    const bucketStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), alignedHour) / 1000;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, { t: bucketStart, o: c.o, h: c.h, l: c.l, c: c.c });
    } else {
      existing.h = Math.max(existing.h, c.h);
      existing.l = Math.min(existing.l, c.l);
      existing.c = c.c; // last close in the bucket
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}

function parseYahoo(json: unknown): Candle[] {
  const result = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { timestamp?: number[]; indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }[] } }
    | undefined;
  if (!result?.timestamp || !result.indicators?.quote?.[0]) return [];
  const ts = result.timestamp;
  const q = result.indicators.quote[0];
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    if (o <= 0 || c <= 0) continue;
    out.push({ t: ts[i]!, o, h, l, c });
  }
  return out;
}

/**
 * Returns a real OHLC feed or null. Cached 5 min. Never throws, never fakes.
 * `stale:true` when returned from cache after a failed refresh.
 */
export async function fetchXauOhlc(): Promise<OhlcFeed | null> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return cache;

  try {
    const resp = await fetch(YAHOO_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) throw new Error(`http ${resp.status}`);
    const json = await resp.json();
    const h1 = parseYahoo(json);
    // Need enough history for EMA50 on H4 (>=50 four-hour bars => ~200 h1 bars).
    if (h1.length < 60) throw new Error(`insufficient candles: ${h1.length}`);
    const h4 = aggregateH4(h1);
    if (h4.length < 20) throw new Error(`insufficient h4 candles: ${h4.length}`);
    const feed: OhlcFeed = {
      h1,
      h4,
      spot: h1[h1.length - 1]!.c,
      source: "yahoo:GC=F",
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
    cache = feed;
    cacheTime = now;
    return feed;
  } catch {
    if (cache) return { ...cache, stale: true };
    return null;
  }
}

/** Test/replay seam: lets tests inject deterministic candles without network. */
export function __setFeedCacheForTest(feed: OhlcFeed | null): void {
  cache = feed;
  cacheTime = feed ? Date.now() : 0;
}
