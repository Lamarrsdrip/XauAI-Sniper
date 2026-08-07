import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { clientIp, rateLimit } from "../auth.js";
import { extractEvidenceQuoteFromDetails } from "../services/marketOutlookEvidence.js";

function secretMatches(provided: unknown): boolean {
  if (!env.PUBLIC_MARKET_FEED_API_KEY || typeof provided !== "string" || !provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(env.PUBLIC_MARKET_FEED_API_KEY, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Cross-project feed for talabeckglobal.com: the real live XAUUSD bid/ask
 * our own EAs report via POST /cloud/monitor/activity (not a scraped
 * price), gated by a shared API key since it's called server-to-server
 * from outside this codebase.
 */
export async function registerPublicMarketFeedRoutes(app: FastifyInstance): Promise<void> {
  app.get("/public/market-feed", async (request, reply) => {
    if (!env.PUBLIC_MARKET_FEED_API_KEY) {
      return reply.code(503).send({ error: "not_configured", message: "PUBLIC_MARKET_FEED_API_KEY is not set." });
    }
    rateLimit(`public_market_feed_ip:${clientIp(request)}`, 120, 60);
    if (!secretMatches(request.headers["x-api-key"])) {
      return reply.code(401).send({ error: "invalid_or_missing_api_key" });
    }

    const db = getDb();
    const settings = await db
      .collection("cloud_settings")
      .findOne({ key: "main" }, { projection: { _id: 0, monitor_last_activity: 1, monitor_last_activity_at: 1 } });
    const lastActivityAt = settings?.["monitor_last_activity_at"] as string | undefined;
    const details = ((settings?.["monitor_last_activity"] as Record<string, unknown> | undefined)?.["details"] as
      | Record<string, unknown>
      | undefined) ?? {};

    const ageSec = lastActivityAt ? Math.trunc((Date.now() - new Date(lastActivityAt).getTime()) / 1000) : null;
    const stale = ageSec === null || ageSec > 90;
    const quote = extractEvidenceQuoteFromDetails(details, lastActivityAt ?? null);
    const available = quote.valid && !stale;

    return {
      symbol: "XAUUSD",
      available,
      bid: available ? quote.bid : null,
      ask: available ? quote.ask : null,
      spread: available ? quote.spread : null,
      quote_at: quote.quote_at ?? lastActivityAt ?? null,
      age_sec: ageSec,
      stale,
      source: "xaucloud_bot_live",
    };
  });
}
