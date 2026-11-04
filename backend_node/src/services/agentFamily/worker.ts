import { fulfillService, type MarketContext } from "./fulfillment.js";
import { advanceOrder } from "./advance.js";
import { loadMarketContext } from "./marketContext.js";
import { findOrder, insertOrderIfAbsent, saveOrder } from "./store.js";
import { termixFromEnv, type TermixClient } from "./termix.js";
import { prepareOrderIntent, prepareSubmitDelivery } from "./delivery.js";
import { blankOrder, type CommerceOrder, type RemoteOrderView } from "./orderEngine.js";
import { AGENT_FAMILY_CATEGORY, publishableCatalog } from "./catalog.js";

let polling = false;
let timer: ReturnType<typeof setInterval> | null = null;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? v as Record<string, unknown> : null;
}

export function remoteFromApi(row: Record<string, unknown>): RemoteOrderView {
  const actions = asRecord(row["availableActions"]);
  return {
    id: String(row["id"] ?? ""),
    status: String(row["status"] ?? ""),
    budget: row["budget"] == null ? null : String(row["budget"]),
    protocolFee: row["protocolFee"] == null ? null : String(row["protocolFee"]),
    providerPayout: row["providerPayout"] == null ? null : String(row["providerPayout"]),
    currency: row["currency"] == null ? null : String(row["currency"]),
    listingId: row["listingId"] == null ? null : String(row["listingId"]),
    skillTag: row["skillTag"] == null ? null : String(row["skillTag"]),
    note: typeof row["note"] === "string" ? row["note"] : null,
    challengeWindowEndsAt: row["challengeWindowEndsAt"] == null ? null : String(row["challengeWindowEndsAt"]),
    deliveryDueAt: row["deliveryDueAt"] == null ? null : String(row["deliveryDueAt"]),
    canSubmitDelivery: actions?.["canSubmitDelivery"] === true,
  };
}

export async function syncMarketplaceOrders(client: TermixClient, market: MarketContext): Promise<{ seen: number; saved: number; conflicts: number }> {
  const page = asRecord(await client.request("GET", "/api/v1/orders", undefined, { side: "provider", pageSize: "50" }));
  const items = Array.isArray(page?.["items"]) ? page!["items"] as unknown[] : [];
  let saved = 0;
  let conflicts = 0;
  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;
    let remote = remoteFromApi(row);
    if (!remote.id) continue;
    if (remote.listingId && !remote.skillTag) {
      const listing = asRecord(await client.request("GET", `/api/v1/listings/${encodeURIComponent(remote.listingId)}`));
      remote = { ...remote, skillTag: listing?.["skillTag"] == null ? null : String(listing["skillTag"]) };
    }
    const existing = await findOrder(remote.id);
    const base = existing ?? await insertOrderIfAbsent(blankOrder(remote.id, "live", new Date().toISOString()));
    const version = base.version;
    const next = await advanceOrder(base, remote, {
      now: () => new Date(),
      market: () => market,
      fulfill: (serviceId, input, ctx, now) => fulfillService(serviceId, input, ctx, now),
      prepare: async (kind, order) => {
        if (kind === "submitDelivery") return prepareSubmitDelivery(client, order);
        return { intent: await prepareOrderIntent(client, kind, order.marketplaceOrderId) };
      },
    });
    if (await saveOrder(version, next)) saved += 1;
    else conflicts += 1;
  }
  return { seen: items.length, saved, conflicts };
}

export async function pollOnce(): Promise<{ ok: true; seen: number; saved: number; conflicts: number } | { ok: false; reason: string }> {
  if (process.env["XAUCLOUD_AGENT_FAMILY_ENABLED"] !== "true") return { ok: false, reason: "MARKETPLACE_DISABLED" };
  const client = termixFromEnv();
  if (!client) return { ok: false, reason: "MISSING_TERMIX_ACCESS_TOKEN" };
  if (polling) return { ok: false, reason: "POLL_ALREADY_RUNNING" };
  polling = true;
  try {
    const loaded = await loadMarketContext();
    return { ok: true, ...(await syncMarketplaceOrders(client, loaded.context)) };
  } finally {
    polling = false;
  }
}

export function startAgentFamilyPoller(): void {
  if (timer || process.env["XAUCLOUD_AGENT_FAMILY_ENABLED"] !== "true") return;
  const ms = Math.max(5000, Number(process.env["XAUCLOUD_AGENT_FAMILY_POLL_MS"] || 15000));
  timer = setInterval(() => {
    void pollOnce().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown poll error";
      console.error(`[agent-family] poll failed: ${message}`);
    });
  }, Number.isFinite(ms) ? ms : 15000);
  timer.unref?.();
}

export interface ListingSyncReport {
  enabled: boolean;
  publish: boolean;
  created: string[];
  alreadyPresent: string[];
  blocked: string[];
}

/** Creates DRAFT listings only. Publishing requires XAUCLOUD_AGENT_FAMILY_PUBLISH=true and a cover URL. */
export async function syncListings(client: TermixClient, agentId: string): Promise<ListingSyncReport> {
  const report: ListingSyncReport = { enabled: true, publish: process.env["XAUCLOUD_AGENT_FAMILY_PUBLISH"] === "true", created: [], alreadyPresent: [], blocked: [] };
  const cover = (process.env["XAUCLOUD_AGENT_FAMILY_COVER_URL"] || "").trim();
  const page = asRecord(await client.request("GET", "/api/v1/listings", undefined, { providerAgentId: agentId, pageSize: "100" }));
  const items = Array.isArray(page?.["items"]) ? page!["items"] as unknown[] : [];
  const tags = new Set(items.map((item) => String(asRecord(item)?.["skillTag"] ?? "")));
  for (const service of publishableCatalog()) {
    if (tags.has(service.skillTag)) {
      report.alreadyPresent.push(service.skillTag);
      continue;
    }
    if (!cover.startsWith("https://")) {
      report.blocked.push(`${service.skillTag}: cover image URL missing`);
      continue;
    }
    const created = asRecord(await client.request("POST", `/api/v1/agents/${encodeURIComponent(agentId)}/services`, {
      title: service.title,
      category: AGENT_FAMILY_CATEGORY,
      basePrice: String(service.priceUsd),
      currency: "USDC",
      deliveryDays: service.deliveryDays,
      description: service.description.slice(0, 5000),
      skillTag: service.skillTag,
      tags: ["xauusd", "xaucloud", service.skillTag],
      instantBuyable: true,
      publicSearch: false,
      coverImageUrl: cover,
      challengeWindowHours: 24,
      settlementType: "escrow",
      proofMethod: "optimistic",
    }));
    const id = String(created?.["id"] ?? "");
    report.created.push(service.skillTag);
    if (report.publish && id) {
      await client.request("POST", `/api/v1/listings/${encodeURIComponent(id)}/publish`);
    }
  }
  return report;
}

export function sandboxAdvance(serviceId: string, input: unknown, market: MarketContext, now = new Date()): Promise<CommerceOrder> {
  const remote: RemoteOrderView = {
    id: `sandbox-${serviceId}-${now.getTime()}`,
    status: "IN_PROGRESS",
    budget: "0",
    protocolFee: "0",
    providerPayout: "0",
    currency: "USDC",
    skillTag: null,
    note: null,
  };
  const seeded = { ...blankOrder(remote.id, "sandbox", now.toISOString()), serviceId, input };
  return advanceOrder(seeded, remote, {
    now: () => now,
    market: () => market,
    fulfill: (id, payload, ctx, at) => fulfillService(id, payload, ctx, at),
    prepare: async () => ({ intent: { sandbox: true } }),
  });
}
