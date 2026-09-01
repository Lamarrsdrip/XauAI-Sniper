import * as cheerio from "cheerio";

/** Port of server.py:591 `fetch_live_gold_price`. */

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

let goldCache: GoldPriceResult | null = null;
let goldCacheTime = 0;

export async function fetchLiveGoldPrice(): Promise<GoldPriceResult> {
  const now = Date.now() / 1000;
  if (now - goldCacheTime < 30 && goldCache) return goldCache;

  let price: number | null = null;
  let change: number | null = null;
  let changePct: number | null = null;

  try {
    const resp = await fetch("https://www.google.com/finance/quote/GCW00:COMEX", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const html = await resp.text();
      const $ = cheerio.load(html);
      const priceText = $("div.YMlKec.fxKbKc").first().text().trim();
      if (priceText) {
        const parsed = Number(priceText.replace(/\$/g, "").replace(/,/g, ""));
        if (Number.isFinite(parsed)) price = parsed;
      }
      $("div.JwB6zf").each((_i, el) => {
        if (change !== null && changePct !== null) return false;
        const t = $(el).text().trim();
        if (t.includes("%") || t.includes("$")) {
          for (const p of t.replace(/\$/g, "").replace(/,/g, "").split(/\s+/)) {
            const c = p.replace(/\+/g, "").replace(/%/g, "");
            const v = Number(c);
            if (Number.isFinite(v)) {
              if (p.includes("%")) changePct = v;
              else change = v;
            }
          }
          return false;
        }
        return undefined;
      });
    }
  } catch {
    /* fall through to unavailable/cached path */
  }

  if (price === null) {
    if (goldCache?.available && goldCache.bid) {
      return { ...goldCache, source: "cached_live", stale: true };
    }
    return {
      symbol: "XAUUSD",
      available: false,
      bid: null,
      ask: null,
      spread: null,
      change: null,
      change_pct: null,
      timestamp: new Date().toISOString(),
      source: "unavailable",
      stale: false,
    };
  }
  if (change === null) change = 0.0;
  if (changePct === null) changePct = price ? Math.round((change / price) * 100 * 1000) / 1000 : 0.0;

  const result: GoldPriceResult = {
    symbol: "XAUUSD",
    available: true,
    bid: Math.round(price * 100) / 100,
    ask: null,
    spread: null,
    change: Math.round(change * 100) / 100,
    change_pct: Math.round(changePct * 1000) / 1000,
    timestamp: new Date().toISOString(),
    source: "live",
    stale: false,
  };
  goldCache = result;
  goldCacheTime = now;
  return result;
}
