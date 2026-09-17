import { getDb } from "../db.js";
import { BROKER_QUOTE_FRESH_SECONDS, MARKET_EVIDENCE_COLLECTION } from "./marketIntelligenceConfig.js";

/** Live XAUUSD quote for the public dashboard. Never fabricates a number. */

export interface GoldPriceResult {
  symbol: string;
  available: boolean;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  change: number | null;
  change_pct: number | null;
  timestamp: string;
  source: string;
  stale: boolean;
}

const UNAVAILABLE: GoldPriceResult = {
  symbol: "XAUUSD",
  available: false,
  bid: null,
  ask: null,
  spread: null,
  change: null,
  change_pct: null,
  timestamp: new Date(0).toISOString(),
  source: "unavailable",
  stale: false,
};

let goldCache: GoldPriceResult | null = null;
let goldCacheTime = 0;

const DISPLAY_FRESH_SECONDS = 90;
const HTTP_TIMEOUT_MS = 5000;

export function _resetGoldCacheForTests(): void {
  goldCache = null;
  goldCacheTime = 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function unavailable(): GoldPriceResult {
  return { ...UNAVAILABLE, timestamp: new Date().toISOString() };
}

function fromQuote(input: {
  bid: number | null;
  ask: number | null;
  mid?: number | null;
  change?: number | null;
  changePct?: number | null;
  source: string;
  stale: boolean;
}): GoldPriceResult {
  const bid = input.bid != null && Number.isFinite(input.bid) && input.bid > 0 ? round2(input.bid) : null;
  const ask = input.ask != null && Number.isFinite(input.ask) && input.ask > 0 ? round2(input.ask) : null;
  const mid = input.mid != null && Number.isFinite(input.mid) && input.mid > 0 ? round2(input.mid) : bid;
  const price = bid ?? mid;
  if (price == null) return unavailable();
  const spread = bid != null && ask != null ? round2(ask - bid) : null;
  return {
    symbol: "XAUUSD",
    available: true,
    bid: bid ?? price,
    ask,
    spread,
    change: input.change != null && Number.isFinite(input.change) ? round2(input.change) : null,
    change_pct: input.changePct != null && Number.isFinite(input.changePct) ? Math.round(input.changePct * 1000) / 1000 : null,
    timestamp: new Date().toISOString(),
    source: input.source,
    stale: input.stale,
  };
}

async function fromEaHeartbeat(): Promise<GoldPriceResult | null> {
  try {
    const latest = (await getDb().collection(MARKET_EVIDENCE_COLLECTION).findOne(
      { normalized_symbol: "XAUUSD", quote_valid: true },
      { projection: { _id: 0, bid: 1, ask: 1, mid: 1, received_at: 1, observed_at: 1 }, sort: { received_at: -1 } },
    )) as Record<string, unknown> | null;
    if (!latest) return null;
    const at = String(latest["observed_at"] ?? latest["received_at"] ?? "");
    const ageSec = Number.isFinite(Date.parse(at)) ? Math.max(0, (Date.now() - Date.parse(at)) / 1000) : null;
    if (ageSec == null || ageSec > BROKER_QUOTE_FRESH_SECONDS) return null;
    const bid = Number(latest["bid"] ?? 0);
    const ask = Number(latest["ask"] ?? 0);
    const mid = Number(latest["mid"] ?? 0);
    return fromQuote({
      bid: bid > 0 ? bid : null,
      ask: ask > 0 ? ask : null,
      mid: mid > 0 ? mid : null,
      source: ageSec <= DISPLAY_FRESH_SECONDS ? "ea_live" : "ea_heartbeat",
      stale: ageSec > DISPLAY_FRESH_SECONDS,
    });
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "XauCloud/1.0 (+https://xaucloud.io)" },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function fromGoldApiSpot(): Promise<GoldPriceResult | null> {
  const data = (await fetchJson("https://api.gold-api.com/price/XAU")) as Record<string, unknown> | null;
  const price = Number(data?.["price"] ?? 0);
  if (!data || !(price > 0)) return null;
  return fromQuote({ bid: price, ask: null, source: "gold_api_spot", stale: false });
}

async function fromYahooFutures(): Promise<GoldPriceResult | null> {
  const data = (await fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d")) as {
    chart?: { result?: Array<{ meta?: Record<string, unknown> }> };
  } | null;
  const meta = data?.chart?.result?.[0]?.meta;
  const price = Number(meta?.["regularMarketPrice"] ?? 0);
  if (!(price > 0)) return null;
  const change = Number(meta?.["regularMarketChange"] ?? NaN);
  const changePct = Number(meta?.["regularMarketChangePercent"] ?? NaN);
  return fromQuote({
    bid: price,
    ask: null,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    source: "yahoo_gc_futures",
    stale: false,
  });
}

export async function fetchLiveGoldPrice(): Promise<GoldPriceResult> {
  const now = Date.now() / 1000;
  if (now - goldCacheTime < 30 && goldCache) return goldCache;

  const ea = await fromEaHeartbeat();
  const result = ea ?? (await fromGoldApiSpot()) ?? (await fromYahooFutures()) ?? unavailable();

  if (result.available) {
    goldCache = result;
    goldCacheTime = now;
    return result;
  }
  if (goldCache?.available) return { ...goldCache, source: `${goldCache.source}_cached`, stale: true };
  return result;
}
