import type { FastifyInstance } from "fastify";
import { readinessSnapshot } from "../services/readiness.js";
import { getDb } from "../db.js";
import { normalizeGoldSymbol } from "../services/goldSymbol.js";
import { extractEvidenceQuoteFromDetails } from "../services/marketOutlookEvidence.js";
import { getFourHourCurrent } from "../services/fourHourOutlookService.js";
import { marketDataReadError, readMarketData } from "../services/fourHourFeed.js";
import { validateMarketData } from "../services/fourHourOutlookService.js";

function ageSeconds(iso: unknown): number | null {
  const time = new Date(String(iso ?? "")).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 1000)) : null;
}

/**
 * Port of server.py `GET /api/` (line 1025) and `GET /api/health` (line 1029).
 * Registered under the /api prefix scope in index.ts, matching api_router.
 */
export async function registerApiHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({ message: "XauCloud EA API v2.0" }));
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/readiness", async (_request, reply) => {
    const snapshot = readinessSnapshot();
    return reply.code(snapshot.state === "READY" ? 200 : 503).send(snapshot);
  });
  // Read-only, account-redacted production proof for the existing EA ->
  // storage -> M10/4H pipeline. This observes the canonical pipeline; it is
  // not a market-data source and cannot generate or execute a signal.
  app.get("/health/market-intelligence", async () => {
    const db = getDb();
    const latest = await db.collection("cloud_bot_activity").findOne(
      { normalized_symbol: "XAUUSD", "details.market_thesis.live_bid": { $gt: 0 }, "details.market_thesis.live_ask": { $gt: 0 } },
      { projection: { _id: 0, account: 1, symbol: 1, ts: 1, details: 1 }, sort: { ts: -1 } },
    ) as Record<string, unknown> | null;
    const details = (latest?.["details"] as Record<string, unknown> | undefined) ?? {};
    const quote = extractEvidenceQuoteFromDetails(details, String(latest?.["ts"] ?? ""));
    const evidenceAt = quote.quote_at ?? latest?.["ts"] ?? null;
    const dataAge = ageSeconds(evidenceAt);
    const account = String(latest?.["account"] ?? "");
    const [latestCandle, m10, outlook, rawOutlook, feed, h1, h4, d1] = await Promise.all([
      account ? db.collection("manual_trading_broker_candles").findOne(
        { account, symbol: "XAUUSD", source: "ea-stream(spot)" },
        { projection: { _id: 0, lastSourceAt: 1 }, sort: { lastSourceAt: -1 } },
      ) : null,
      account ? db.collection("cloud_bot_activity").findOne(
        { account, normalized_symbol: "XAUUSD", "details.m10_signal.evidence_id": { $gt: 0 } },
        { projection: { _id: 0, ts: 1, "details.m10_signal": 1 }, sort: { ts: -1 } },
      ) as Promise<Record<string, unknown> | null> : null,
      getFourHourCurrent(),
      db.collection("four_hour_outlooks").findOne({ symbol: "XAUUSD" }, { projection: { _id: 0, dataSource: 1, dataStatus: 1, status: 1, direction: 1, marketDataAt: 1, expiresAt: 1, lastReviewedAt: 1 } }),
      readMarketData(),
      account ? db.collection("manual_trading_broker_candles").countDocuments({ account, symbol: "XAUUSD", timeframe: "H1", source: "ea-stream(spot)" }) : 0,
      account ? db.collection("manual_trading_broker_candles").countDocuments({ account, symbol: "XAUUSD", timeframe: "H4", source: "ea-stream(spot)" }) : 0,
      account ? db.collection("manual_trading_broker_candles").countDocuments({ account, symbol: "XAUUSD", timeframe: "D1", source: "ea-stream(spot)" }) : 0,
    ]);
    const m10Signal = ((m10?.["details"] as Record<string, unknown> | undefined)?.["m10_signal"] as Record<string, unknown> | undefined) ?? null;
    return {
      generated_at: new Date().toISOString(),
      market_data: {
        source: "EA_HEARTBEAT",
        received_at: latest?.["ts"] ?? null,
        evidence_at: evidenceAt,
        normalized_symbol: normalizeGoldSymbol(latest?.["symbol"]),
        latest_verified_close: quote.valid ? quote.mid : null,
        age_seconds: dataAge,
        freshness_state: quote.valid && dataAge !== null && dataAge <= 600 ? "FRESH" : quote.valid ? "STALE" : "UNAVAILABLE",
        persistence_state: latestCandle ? "PERSISTED" : "PERSISTENCE_UNAVAILABLE",
      },
      broker_history: { h1, h4, d1, input_status: h1 >= 80 && h4 >= 30 && d1 >= 20 ? "READY" : latestCandle ? "ACCUMULATING_BROKER_HISTORY" : "UNAVAILABLE" },
      feed_validation: {
        ...validateMarketData(feed),
        read_error: marketDataReadError(),
        age_seconds: feed ? Math.max(0, Math.floor(feed.ageSec)) : null,
        snapshot_count: feed?.snapshots.length ?? 0,
        data_status: feed?.dataStatus ?? null,
      },
      m10: m10Signal ? {
        input_status: "AVAILABLE",
        evidence_id: m10Signal["evidence_id"],
        bar_time: m10Signal["bar_time"],
        freshness_state: m10Signal["freshness_state"],
        output_status: m10Signal["decision"] ?? m10Signal["final_decision"] ?? "UNKNOWN",
      } : { input_status: "UNAVAILABLE", output_status: "DATA_UNAVAILABLE" },
      four_hour: outlook ? {
        input_status: outlook.dataStatus,
        output_status: outlook.status,
        direction: outlook.direction,
        last_reviewed_at: outlook.lastReviewedAt,
      } : {
        input_status: latestCandle ? "ACCUMULATING_BROKER_HISTORY" : "UNAVAILABLE",
        output_status: "DATA_UNAVAILABLE",
        stored_output: rawOutlook ? {
          source: rawOutlook["dataSource"], status: rawOutlook["status"], direction: rawOutlook["direction"],
          data_status: rawOutlook["dataStatus"], market_data_at: rawOutlook["marketDataAt"], expires_at: rawOutlook["expiresAt"],
        } : null,
      },
    };
  });
}

/**
 * Port of server.py's root-level `GET /health` (line 8611) -- for load
 * balancers / Cloud Run health checks, deliberately outside the /api prefix.
 */
export async function registerRootHealthRoute(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
}
