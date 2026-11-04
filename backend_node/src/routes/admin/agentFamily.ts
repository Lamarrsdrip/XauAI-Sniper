import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth.js";
import { CATALOG } from "../../services/agentFamily/catalog.js";
import { publicOrder } from "../../services/agentFamily/advance.js";
import { loadMarketContext } from "../../services/agentFamily/marketContext.js";
import { averageFulfillmentMs, successRate, summarizeRevenue } from "../../services/agentFamily/revenue.js";
import { ensureAgentFamilyOrderIndexes, findOrder, insertOrderIfAbsent, listOrders, saveOrder } from "../../services/agentFamily/store.js";
import { pollOnce, sandboxAdvance, syncListings } from "../../services/agentFamily/worker.js";
import { getAgentFamilyConfig, publicAgentFamilyConfig, saveAgentFamilyConfig, createAgentFamilyClient } from "../../services/agentFamily/config.js";

let indexesReady: Promise<void> | null = null;
function indexes(): Promise<void> {
  indexesReady ??= ensureAgentFamilyOrderIndexes().catch((error: unknown) => { indexesReady = null; throw error; });
  return indexesReady;
}

export async function registerAdminAgentFamilyRoutes(app: FastifyInstance): Promise<void> {
  const ConfigPatch = z.object({
    enabled: z.boolean().optional(),
    publishEnabled: z.boolean().optional(),
    agentId: z.string().max(128).optional(),
    coverUrl: z.string().max(1200).optional(),
    accessToken: z.string().min(20).max(8192).optional(),
    refreshToken: z.string().min(20).max(8192).optional(),
    clearAccessToken: z.boolean().optional(),
    clearRefreshToken: z.boolean().optional(),
  }).strict();

  app.get("/admin/agent-family/config", { preHandler: requireAdmin }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return publicAgentFamilyConfig(await getAgentFamilyConfig());
  });

  app.put("/admin/agent-family/config", { preHandler: requireAdmin }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const patch = ConfigPatch.parse(request.body ?? {});
    try {
      const config = await saveAgentFamilyConfig(patch);
      return { ok: true, config: publicAgentFamilyConfig(config) };
    } catch (error) {
      return reply.code(409).send({ detail: error instanceof Error ? error.message : "Configuration could not be saved" });
    }
  });

  app.post("/admin/agent-family/config/test", { preHandler: requireAdmin }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const config = await getAgentFamilyConfig();
    const client = createAgentFamilyClient(config, undefined, true);
    if (!client) return reply.code(409).send({ connected: false, detail: "Configure your Agent ID and access token before testing the connection." });
    try {
      // Safe, read-only authenticated check. Does not prove wallet ownership
      // or that services have been published.
      await client.request("GET", "/api/v1/orders", undefined, { side: "provider", pageSize: "1" });
      return { connected: true, agentId: config.agentId, detail: "TermiX authenticated order API reachable. Wallet ownership and settlement remain unverified." };
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number((error as {status:unknown}).status) : null;
      return reply.code(502).send({ connected: false, status, detail: "TermiX authentication or API check failed. Verify credentials and backend connectivity." });
    }
  });

  app.get("/admin/agent-family/overview", { preHandler: requireAdmin }, async () => {
    await indexes();
    const [orders, market, config] = await Promise.all([listOrders(500), loadMarketContext(), getAgentFamilyConfig()]);
    const rate = successRate(orders);
    return {
      marketplaceEnabled: config.enabled,
      publishEnabled: config.publishEnabled,
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
    const config = await getAgentFamilyConfig();
    const client = createAgentFamilyClient(config);
    const agentId = config.agentId;
    if (!client || !agentId) {
      return reply.code(409).send({
        detail: "Listings were not created. Set XAUCLOUD_AGENT_FAMILY_ENABLED=true, TERMIX_ACCESS_TOKEN and TERMIX_AGENT_ID. Publishing also requires XAUCLOUD_AGENT_FAMILY_PUBLISH=true and an https XAUCLOUD_AGENT_FAMILY_COVER_URL.",
      });
    }
    return syncListings(client, agentId, { publish: config.publishEnabled, cover: config.coverUrl });
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
    const client = createAgentFamilyClient(await getAgentFamilyConfig());
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
