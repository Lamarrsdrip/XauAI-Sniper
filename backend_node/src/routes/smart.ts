import type { FastifyInstance } from "fastify";
import * as cheerio from "cheerio";

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

/** Port of server.py:3937-4078 smart/* endpoints and :5440 /news/check. */
export async function registerSmartRoutes(app: FastifyInstance): Promise<void> {
  // GET /smart/news-events -- server.py:3937
  app.get("/smart/news-events", async () => {
    const now = Date.now() / 1000;
    if (now - newsCacheTime < 3600 && newsCache.length > 0) {
      return { events: newsCache, count: newsCache.length };
    }

    let events: Record<string, unknown>[] = [];
    try {
      const resp = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { signal: AbortSignal.timeout(10_000) });
      if (resp.ok) {
        const data = (await resp.json()) as CalendarEvent[];
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
          return { events, count: events.length };
        }
      }
    } catch {
      /* fall through to fallback */
    }

    if (events.length === 0) {
      events = [
        { title: "NFP (if first Friday)", country: "USD", date: "", impact: "high", forecast: "", previous: "" },
        { title: "CPI (monthly)", country: "USD", date: "", impact: "high", forecast: "", previous: "" },
        { title: "FOMC (6-weekly)", country: "USD", date: "", impact: "high", forecast: "", previous: "" },
      ];
    }
    newsCache = events;
    newsCacheTime = now;
    return { events, count: events.length };
  });

  // GET /smart/dxy -- server.py:3986
  app.get("/smart/dxy", async () => {
    let dxyPrice: number | null = null;
    let dxyChange: number | null = null;

    try {
      const resp = await fetch("https://www.google.com/finance/quote/DXY:INDEXNYSEGIS", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const html = await resp.text();
        const $ = cheerio.load(html);
        const priceText = $("div.YMlKec.fxKbKc").first().text().trim();
        if (priceText) {
          const parsed = Number(priceText.replace(/,/g, ""));
          if (Number.isFinite(parsed)) dxyPrice = parsed;
        }
        $("div.JwB6zf").each((_i, el) => {
          if (dxyChange !== null) return;
          const t = $(el).text().trim();
          if (t.includes("%") || /\d/.test(t)) {
            for (const p of t.replace(/,/g, "").split(/\s+/)) {
              const c = p.replace(/\+/g, "").replace(/%/g, "");
              const v = Number(c);
              if (Number.isFinite(v) && !p.includes("%") && dxyChange === null) {
                dxyChange = v;
              }
            }
            return false;
          }
          return undefined;
        });
      }
    } catch {
      /* fall through to defaults */
    }

    if (dxyPrice === null) {
      dxyPrice = 99.5;
      dxyChange = 0.0;
    }
    if (dxyChange === null) dxyChange = 0.0;

    const direction = dxyChange < 0 ? "weakening" : dxyChange > 0 ? "strengthening" : "neutral";
    const goldBias = dxyChange < 0 ? "bullish" : dxyChange > 0 ? "bearish" : "neutral";

    return {
      dxy_price: Math.round(dxyPrice * 100) / 100,
      dxy_change: Math.round(dxyChange * 100) / 100,
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

  // GET /news/check -- server.py:5440 (EA-consumed)
  app.get("/news/check", async () => {
    try {
      const resp = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        return {
          safe_to_trade: null,
          reason: "Calendar provider unavailable; state is unknown, not safe",
          status: "DEGRADED_UNKNOWN",
          retryable: true,
          global_block: false,
        };
      }
      const events = (await resp.json()) as CalendarEvent[];
      const now = Date.now();
      const highImpactSoon: { title: string; impact: string; currency: string; minutes: number }[] = [];
      for (const ev of events) {
        if (!["high", "medium"].includes((ev.impact ?? "").toLowerCase())) continue;
        try {
          const evTime = new Date((ev.date ?? "").replace("Z", "+00:00")).getTime();
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
    } catch {
      return {
        safe_to_trade: null,
        reason: "Calendar check failed; state is unknown, not safe",
        status: "DEGRADED_UNKNOWN",
        retryable: true,
        global_block: false,
      };
    }
  });
}
