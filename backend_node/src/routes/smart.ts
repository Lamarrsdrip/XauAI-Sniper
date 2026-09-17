import type { FastifyInstance } from "fastify";

interface CalendarEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

let newsCache: Record<string, unknown>[] = [];
let newsCacheTime = 0;

type NewsCheckResult = Record<string, unknown>;
let newsCheckCache: NewsCheckResult | null = null;
let newsCheckCacheTime = 0;
let newsCheckCacheTtlSec = 0;

const NEWS_EVENTS_TTL_SEC = 3600;
const NEWS_CHECK_OK_TTL_SEC = 90;
const NEWS_CHECK_DEGRADED_TTL_SEC = 20;
const DXY_HTTP_TIMEOUT_MS = 5000;

export function _resetSmartCachesForTests(): void {
  newsCache = [];
  newsCacheTime = 0;
  newsCheckCache = null;
  newsCheckCacheTime = 0;
  newsCheckCacheTtlSec = 0;
}

const DEGRADED_NEWS_CHECK: NewsCheckResult = {
  safe_to_trade: null,
  reason: "Calendar provider unavailable; state is unknown, not safe",
  status: "DEGRADED_UNKNOWN",
  retryable: true,
  global_block: false,
};

function evaluateNewsCheck(events: CalendarEvent[]): NewsCheckResult {
  const now = Date.now();
  const highImpactSoon: { title: string; impact: string; currency: string; minutes: number }[] = [];
  for (const ev of events) {
    if (!["high", "medium"].includes((ev.impact ?? "").toLowerCase())) continue;
    try {
      const evTime = new Date((ev.date ?? "").replace("Z", "+00:00")).getTime();
      if (!Number.isFinite(evTime)) continue;
      const diffMins = (evTime - now) / 60000;
      if (diffMins >= -15 && diffMins <= 30) {
        highImpactSoon.push({ title: ev.title ?? "Unknown", impact: ev.impact ?? "", currency: ev.country ?? "", minutes: Math.trunc(diffMins) });
      }
    } catch {
      continue;
    }
  }
  if (highImpactSoon.length > 0) {
    return {
      safe_to_trade: false,
      reason: `High impact: ${highImpactSoon[0]!.title} in ${highImpactSoon[0]!.minutes}min`,
      status: "CURRENT_RISK",
      events: highImpactSoon,
    };
  }
  return { safe_to_trade: true, reason: "No high-impact events nearby", status: "AVAILABLE" };
}

async function fetchYahooDxy(): Promise<{ price: number; change: number } | null> {
  try {
    const resp = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1m&range=1d", {
      headers: { "User-Agent": "XauCloud/1.0 (+https://xaucloud.io)" },
      signal: AbortSignal.timeout(DXY_HTTP_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } };
    const meta = data.chart?.result?.[0]?.meta;
    const price = Number(meta?.["regularMarketPrice"] ?? 0);
    if (!(price > 0)) return null;
    const changePct = Number(meta?.["regularMarketChangePercent"] ?? 0);
    const change = Number.isFinite(changePct) ? changePct : 0;
    return { price, change };
  } catch {
    return null;
  }
}

/** Port of server.py:3937-4078 smart/* endpoints and :5440 /news/check. */
export async function registerSmartRoutes(app: FastifyInstance): Promise<void> {
  // GET /smart/news-events -- server.py:3937
  app.get("/smart/news-events", async () => {
    const now = Date.now() / 1000;
    if (now - newsCacheTime < NEWS_EVENTS_TTL_SEC && newsCache.length > 0) {
      return { events: newsCache, count: newsCache.length, status: "AVAILABLE" };
    }

    try {
      const resp = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { signal: AbortSignal.timeout(10_000) });
      if (resp.ok) {
        const data = (await resp.json()) as CalendarEvent[];
        const events: Record<string, unknown>[] = [];
        for (const ev of data) {
          const impact = (ev.impact ?? "").toLowerCase();
          if (impact === "high" || impact === "medium") {
            events.push({
              title: ev.title ?? "",
              country: ev.country ?? "",
              date: ev.date ?? "",
              impact,
              forecast: ev.forecast ?? "",
              previous: ev.previous ?? "",
            });
          }
        }
        if (events.length > 0) {
          newsCache = events;
          newsCacheTime = now;
          return { events, count: events.length, status: "AVAILABLE" };
        }
      }
    } catch {
      /* fall through to stale-or-empty, never fabricate dated events */
    }

    if (newsCache.length > 0) {
      return { events: newsCache, count: newsCache.length, status: "STALE", stale: true };
    }
    return { events: [], count: 0, status: "DEGRADED_UNKNOWN" };
  });

  // GET /smart/dxy -- never fabricates a price. EA GetDXYBias only keys off
  // gold_bias bullish/bearish; unknown/unavailable is treated as no bias.
  app.get("/smart/dxy", async () => {
    const quote = await fetchYahooDxy();
    if (!quote) {
      return {
        available: false,
        dxy_price: null,
        dxy_change: null,
        dxy_direction: "unknown",
        gold_bias: "unknown",
        recommendation: "DXY unavailable. No bias.",
      };
    }
    const direction = quote.change < 0 ? "weakening" : quote.change > 0 ? "strengthening" : "neutral";
    const goldBias = quote.change < 0 ? "bullish" : quote.change > 0 ? "bearish" : "neutral";
    return {
      available: true,
      dxy_price: Math.round(quote.price * 1000) / 1000,
      dxy_change: Math.round(quote.change * 1000) / 1000,
      dxy_direction: direction,
      gold_bias: goldBias,
      recommendation: `DXY ${direction} -> Gold ${goldBias}. ${goldBias === "bullish" ? "Favor BUY trades" : goldBias === "bearish" ? "Favor SELL trades" : "No bias"}.`,
    };
  });

  // GET /smart/session-config -- server.py:4034
  app.get("/smart/session-config", async () => ({
    london: {
      hours: "08:00-16:00 GMT",
      preferred_strategies: ["trend", "breakout"],
      confidence_threshold: 75,
      description: "London = trend continuation. Best for directional trades.",
      risk_multiplier: 1.0,
    },
    new_york: {
      hours: "13:00-21:00 GMT",
      preferred_strategies: ["trend", "range"],
      confidence_threshold: 80,
      description: "NY = volatility + reversals. Higher confidence needed.",
      risk_multiplier: 0.8,
    },
    overlap: {
      hours: "13:00-16:00 GMT",
      preferred_strategies: ["breakout"],
      confidence_threshold: 70,
      description: "London-NY overlap = highest liquidity. Best breakout window.",
      risk_multiplier: 1.2,
    },
    asian: {
      hours: "00:00-08:00 GMT",
      preferred_strategies: ["range"],
      confidence_threshold: 85,
      description: "Asian = low volatility ranging. Very selective.",
      risk_multiplier: 0.5,
    },
  }));

  // POST /smart/check-trade -- server.py:4068 (retired)
  app.post("/smart/check-trade", async (_request, reply) => reply.code(410).send({ detail: "This endpoint is retired." }));

  // GET /news/check -- server.py:5440 (EA-consumed). Cached so ForexFactory
  // 429s do not flap the EA every poll. Degraded results cache shorter so we retry.
  app.get("/news/check", async () => {
    const now = Date.now() / 1000;
    if (newsCheckCache && now - newsCheckCacheTime < newsCheckCacheTtlSec) return newsCheckCache;

    try {
      const resp = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        newsCheckCache = DEGRADED_NEWS_CHECK;
        newsCheckCacheTime = now;
        newsCheckCacheTtlSec = NEWS_CHECK_DEGRADED_TTL_SEC;
        return newsCheckCache;
      }
      const events = (await resp.json()) as CalendarEvent[];
      const result = evaluateNewsCheck(events);
      newsCheckCache = result;
      newsCheckCacheTime = now;
      newsCheckCacheTtlSec = NEWS_CHECK_OK_TTL_SEC;
      return result;
    } catch {
      newsCheckCache = {
        ...DEGRADED_NEWS_CHECK,
        reason: "Calendar check failed; state is unknown, not safe",
      };
      newsCheckCacheTime = now;
      newsCheckCacheTtlSec = NEWS_CHECK_DEGRADED_TTL_SEC;
      return newsCheckCache;
    }
  });
}
