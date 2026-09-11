import type { FastifyInstance } from "fastify";
import { readinessSnapshot } from "../services/readiness.js";
import { getDb } from "../db.js";
import { normalizeGoldSymbol } from "../services/goldSymbol.js";
import { BROKER_QUOTE_FRESH_SECONDS, MARKET_EVIDENCE_COLLECTION } from "../services/marketIntelligenceConfig.js";

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
  // storage -> M10 pipeline. This observes the canonical pipeline; it is
  // not a market-data source and cannot generate or execute a signal.
  app.get("/health/market-intelligence", async () => {
    const db = getDb();
    const latest = await db.collection(MARKET_EVIDENCE_COLLECTION).findOne(
      { normalized_symbol: "XAUUSD", quote_valid: true },
      { projection: { _id: 0, account: 1, symbol: 1, received_at: 1, observed_at: 1, bid: 1, ask: 1, mid: 1 }, sort: { received_at: -1 } },
    ) as Record<string, unknown> | null;
    const evidenceAt = latest?.["observed_at"] ?? latest?.["received_at"] ?? null;
    const dataAge = ageSeconds(evidenceAt);
    const account = String(latest?.["account"] ?? "");
    const [latestCandle, m10] = await Promise.all([
      account ? db.collection("manual_trading_broker_candles").findOne(
        { account, symbol: "XAUUSD", source: "ea-stream(spot)" },
        { projection: { _id: 0, lastSourceAt: 1 }, sort: { lastSourceAt: -1 } },
      ) : null,
      account ? db.collection(MARKET_EVIDENCE_COLLECTION).findOne(
        { account, normalized_symbol: "XAUUSD", "m10_signal.evidence_id": { $gt: 0 } },
        { projection: { _id: 0, received_at: 1, m10_signal: 1 }, sort: { received_at: -1 } },
      ) as Promise<Record<string, unknown> | null> : null,
    ]);
    const m10Signal = (m10?.["m10_signal"] as Record<string, unknown> | undefined) ?? null;
    return {
      generated_at: new Date().toISOString(),
      market_data: {
        source: "EA_HEARTBEAT",
        received_at: latest?.["received_at"] ?? null,
        evidence_at: evidenceAt,
        normalized_symbol: normalizeGoldSymbol(latest?.["symbol"]),
        latest_verified_close: latest?.["mid"] ?? (latest ? (Number(latest["bid"] ?? 0) + Number(latest["ask"] ?? 0)) / 2 : null),
        age_seconds: dataAge,
        freshness_state: latest && dataAge !== null && dataAge <= BROKER_QUOTE_FRESH_SECONDS ? "FRESH" : latest ? "STALE" : "UNAVAILABLE",
        persistence_state: latestCandle ? "PERSISTED" : "PERSISTENCE_UNAVAILABLE",
      },
      m10: m10Signal ? {
        input_status: "AVAILABLE",
        evidence_id: m10Signal["evidence_id"],
        bar_time: m10Signal["bar_time"],
        freshness_state: m10Signal["freshness_state"],
        output_status: m10Signal["decision"] ?? m10Signal["final_decision"] ?? "UNKNOWN",
      } : { input_status: "UNAVAILABLE", output_status: "DATA_UNAVAILABLE" },
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
