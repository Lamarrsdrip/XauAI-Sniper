import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";
import { getSettings } from "../services/settings.js";
import { MARKET_EVIDENCE_COLLECTION } from "../services/marketIntelligenceConfig.js";
import {
  agentFamilyReadAuthorized,
  approvedAgentFamilyAccounts,
  assembleApprovedSources,
  decideNativeSignal,
  quoteExpiresAt,
  selectConnectedMt5Source,
} from "../services/agentFamilySource.js";

/** Read-only provider integration. Existing VPS/EA heartbeats are the source of truth.
 * No Remote Desktop, shell, broker credentials, or trading command surface.
 */
export async function registerAgentFamilySourceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/integrations/agent-family/market-snapshot", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!agentFamilyReadAuthorized(request.headers.authorization)) return reply.code(401).send({ detail: "Unauthorized" });
    const db = getDb();
    const settings = await getSettings();
    const accounts = approvedAgentFamilyAccounts(settings);
    if (!accounts.length) return reply.code(503).send({ status: "UNAVAILABLE", reason: "NO_OWNER_APPROVED_MT5_SOURCES" });
    const heartbeatRows = await db.collection("cloud_bot_heartbeats").find(
      { account_number: { $in: accounts } },
      { projection: { _id: 0, account_number: 1, ts: 1 }, sort: { ts: -1 }, limit: 200 },
    ).toArray();
    const evidence = await db.collection(MARKET_EVIDENCE_COLLECTION).find(
      { account: { $in: accounts }, normalized_symbol: "XAUUSD", quote_valid: true },
      { projection: { _id: 0, account: 1, observed_at: 1, bid: 1, ask: 1 }, sort: { observed_at: -1 }, limit: 200 },
    ).toArray();
    const selected = selectConnectedMt5Source(assembleApprovedSources(heartbeatRows as never, evidence as never));
    if (!selected) return reply.code(503).send({ status: "UNAVAILABLE", reason: "NO_FRESH_APPROVED_BROKER_SOURCE" });
    const latest = await db.collection("subscriber_signals").findOne(
      { source_account: selected.account, symbol: { $regex: "^(XAUUSD|GOLD)", $options: "i" } },
      { projection: { _id: 0, source_account: 1, signal_id: 1, engine: 1, status: 1, direction: 1, entry: 1, stop: 1, tp1: 1, rationale: 1, expires_at: 1, updated_at: 1 }, sort: { updated_at: -1 } },
    );
    const expiresAt = quoteExpiresAt(selected.quote_at);
    if (!expiresAt) return reply.code(503).send({ status: "UNAVAILABLE", reason: "SOURCE_EXPIRED" });
    const nativeSignal = { ...decideNativeSignal(latest), expiresAt };
    // No account IDs, license PINs, customer info, or broker secrets in responses.
    return {
      schemaVersion: 1, sourceKind: "broker", sourceFresh: true, noTradeExecution: true,
      source: "XauCloud owner-approved connected MT5 network", symbol: "XAUUSD",
      asOf: selected.quote_at, quote: { bid: selected.bid, ask: selected.ask, time: selected.quote_at },
      nativeSignal,
    };
  });
}
