import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../auth.js";
import { CATALOG } from "../../services/agentFamily/catalog.js";
import { publicOrder } from "../../services/agentFamily/advance.js";
import { loadMarketContext } from "../../services/agentFamily/marketContext.js";
import { averageFulfillmentMs, successRate, summarizeRevenue } from "../../services/agentFamily/revenue.js";
import { ensureAgentFamilyOrderIndexes, findOrder, insertOrderIfAbsent, listOrders, saveOrder } from "../../services/agentFamily/store.js";
import { pollOnce, sandboxAdvance, syncListings } from "../../services/agentFamily/worker.js";
import { termixFromEnv } from "../../services/agentFamily/termix.js";

let indexesReady: Promise<void> | null = null;
function indexes(): Promise<void> {
  indexesReady ??= ensureAgentFamilyOrderIndexes().catch((error: unknown) => { indexesReady = null; throw error; });
  return indexesReady;
}

export async function registerAdminAgentFamilyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/agent-family/overview", { preHandler: requireAdmin }, async () => {
    await indexes();
    const [orders, market] = await Promise.all([listOrders(500), loadMarketContext()]);
    const rate = successRate(orders);
    return {
      marketplaceEnabled: process.env["XAUCLOUD_AGENT_FAMILY_ENABLED"] === "true",
      publishEnabled: process.env["XAUCLOUD_AGENT_FAMILY_PUBLISH"] === "true",
      liveTrading: false,
      services: CATALOG.map((s) => ({
        id: s.id, title: s.title, priceUsd: s.priceUsd, publishable: s.publishable,
        disabledReason: s.disabledReason, skillTag: s.skillTag, estimatedCostUsd: s.estimatedCostUsd,
      })),
      sources: market.health,
      orders: {
        total: orders.length,
        byStatus: orders.reduce<Record<string, number>>((acc, order) => {
          acc[order.status] = (acc[order.status] ?? 0) + 1;
          return acc;
        }, {}),
        awaitingInput: orders.filter((o) => o.status === "INSUFFICIENT_INFORMATION").length,
        active: orders.filter((o) => ["ACCEPTED", "QUEUED", "EXECUTING", "AWAITING_ACCEPT", "AWAITING_DELIVERY_TX"].includes(o.status)).length,
        pendingWalletActions: orders.reduce((sum, o) => sum + o.walletActions.filter((w) => w.status === "PENDING" || w.status === "REPORTED").length, 0),
      },
      revenue: summarizeRevenue(orders),
      successRate: rate,
      averageFulfillmentMs: averageFulfillmentMs(orders),
    };
  });

  app.get("/admin/agent-family/orders", { preHandler: requireAdmin }, async () => {
    await indexes();
    const orders = await listOrders(200);
    return { orders: orders.map(publicOrder) };
  });

  app.get("/admin/agent-family/orders/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await indexes();
    const id = String((request.params as { id?: string }).id ?? "");
    const orders = await listOrders(500);
    const order = orders.find((o) => o.id === id || o.marketplaceOrderId === id);
    if (!order) return reply.code(404).send({ detail: "Order not found." });
    return { order: { ...publicOrder(order), input: order.input, output: order.output } };
  });

  app.post("/admin/agent-family/sandbox", { preHandler: requireAdmin }, async (request, reply) => {
    await indexes();
    const body = request.body as { serviceId?: unknown; input?: unknown };
    const service = CATALOG.find((s) => s.id === body?.serviceId);
    if (!service) return reply.code(400).send({ detail: "Unknown service." });
    if (!service.publishable) return reply.code(409).send({ detail: service.disabledReason });
    const market = await loadMarketContext();
    const advanced = await sandboxAdvance(service.id, body.input ?? null, market.context);
    const stored = await insertOrderIfAbsent(advanced);
    if (stored.id !== advanced.id) return reply.code(409).send({ detail: "Sandbox id collided. Retry." });
    return { order: publicOrder(stored), sandbox: true, revenueCounted: false };
  });

  app.post("/admin/agent-family/sync", { preHandler: requireAdmin }, async () => pollOnce());

  app.post("/admin/agent-family/listings/sync", { preHandler: requireAdmin }, async (_request, reply) => {
    const client = termixFromEnv();
    const agentId = (process.env["TERMIX_AGENT_ID"] || "").trim();
    if (!client || !agentId) {
      return reply.code(409).send({
        detail: "Listings were not created. Set XAUCLOUD_AGENT_FAMILY_ENABLED=true, TERMIX_ACCESS_TOKEN and TERMIX_AGENT_ID. Publishing also requires XAUCLOUD_AGENT_FAMILY_PUBLISH=true and an https XAUCLOUD_AGENT_FAMILY_COVER_URL.",
      });
    }
    return syncListings(client, agentId);
  });

  app.post("/admin/agent-family/wallet-actions/:id/report-tx", { preHandler: requireAdmin }, async (request, reply) => {
    await indexes();
    const actionId = String((request.params as { id?: string }).id ?? "");
    const txHash = String((request.body as { txHash?: unknown })?.txHash ?? "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return reply.code(400).send({ detail: "txHash must be a 0x-prefixed 32-byte hash." });
    const orders = await listOrders(500);
    const order = orders.find((o) => o.walletActions.some((w) => w.id === actionId));
    if (!order) return reply.code(404).send({ detail: "Wallet action not found." });
    const version = order.version;
    const walletActions = order.walletActions.map((w) => w.id === actionId ? { ...w, status: "REPORTED" as const, txHash } : w);
    const next = { ...order, walletActions };
    const saved = await saveOrder(version, next);
    if (!saved) return reply.code(409).send({ detail: "Order changed. Reload and retry." });
    let indexed: unknown = null;
    const client = termixFromEnv();
    if (client) {
      try { indexed = await client.request("GET", `/api/v1/onchain/tx/${txHash}`); }
      catch (error) { indexed = { error: error instanceof Error ? error.message : "lookup failed" }; }
    }
    const reloaded = await findOrder(order.marketplaceOrderId);
    return {
      settled: reloaded?.status === "SETTLED",
      note: "A reported hash is not settlement. Revenue counts only after the marketplace order status is SETTLED.",
      indexed,
      order: reloaded ? publicOrder(reloaded) : null,
    };
  });
}
