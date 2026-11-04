import { catalogBySkillTag } from "./catalog.js";
import { parseBuyerInput, type FulfillmentResult, type MarketContext } from "./fulfillment.js";
import {
  absorbRemote,
  applyFulfillment,
  blankOrder,
  decideNext,
  queueWallet,
  rememberDeadlines,
  serviceFor,
  stampStatus,
  type CommerceOrder,
  type RemoteOrderView,
  type WalletKind,
} from "./orderEngine.js";

export interface AdvanceDeps {
  now(): Date;
  market(): MarketContext;
  fulfill(serviceId: string, input: unknown, market: MarketContext, now: Date): FulfillmentResult;
  prepare(kind: WalletKind, order: CommerceOrder): Promise<{ intent: unknown; artifactIds?: string[] }>;
}

export async function ensureOrder(existing: CommerceOrder | null, remote: RemoteOrderView, mode: CommerceOrder["mode"], nowIso: string): Promise<CommerceOrder> {
  return existing ?? blankOrder(remote.id, mode, nowIso);
}

export async function advanceOrder(existing: CommerceOrder | null, remote: RemoteOrderView, deps: AdvanceDeps): Promise<CommerceOrder> {
  const now = deps.now();
  const nowIso = now.toISOString();
  let order = await ensureOrder(existing, remote, existing?.mode ?? "live", nowIso);
  if (order.marketplaceOrderId !== remote.id) throw new Error("Refusing to advance an order under a different marketplace id.");
  order = absorbRemote(order, remote, nowIso);
  order = rememberDeadlines(order, remote, nowIso);
  if (!order.serviceId && remote.skillTag) order = { ...order, serviceId: catalogBySkillTag(remote.skillTag)?.id ?? order.serviceId };
  if (order.input == null && remote.note) {
    const parsed = parseBuyerInput(remote.note);
    if (parsed.value !== null) order = { ...order, input: parsed.value };
    else if (parsed.error && serviceFor(order)?.needsBuyerInput) order = { ...order, failureDetail: parsed.error };
  }
  for (let step = 0; step < 6; step += 1) {
    const before = order.status + (order.outputHash ?? "") + order.walletActions.length;
    const market = deps.market();
    const effect = decideNext(order, serviceFor(order), market.fresh, now.getTime());
    if (effect.type === "none") break;
    if (effect.type === "request-input") {
      order = stampStatus(order, "INSUFFICIENT_INFORMATION", effect.missing.join("; "), nowIso);
    } else if (effect.type === "hold") {
      const status = effect.code === "SOURCE_UNAVAILABLE" ? "SOURCE_UNAVAILABLE" as const : "FAILED" as const;
      order = stampStatus(order, status, effect.code, nowIso);
    } else if (effect.type === "prepare") {
      const prepared = await deps.prepare(effect.kind, order);
      if (prepared.artifactIds?.length) order = { ...order, artifactIds: prepared.artifactIds };
      order = queueWallet(order, effect.kind, prepared.intent, nowIso);
      const nextStatus = effect.kind === "acceptOrder" ? "AWAITING_ACCEPT" as const
        : effect.kind === "submitDelivery" ? "AWAITING_DELIVERY_TX" as const
          : effect.kind === "claimAfterTimeout" ? "AWAITING_SETTLEMENT" as const
            : order.status;
      order = stampStatus(order, nextStatus, `Prepared ${effect.kind}. The owner must sign; XauCloud does not hold the wallet key.`, nowIso);
    } else if (effect.type === "fulfill") {
      if (order.outputHash && order.status === "OUTPUT_VALIDATED") break;
      const started = deps.now().getTime();
      order = stampStatus(order, "EXECUTING", "Fulfillment started.", nowIso);
      const result = deps.fulfill(order.serviceId ?? "", order.input, market, now);
      order = applyFulfillment(order, result, started, deps.now().getTime(), nowIso);
    }
    const after = order.status + (order.outputHash ?? "") + order.walletActions.length;
    if (after === before) break;
  }
  return order;
}

export function publicOrder(order: CommerceOrder): Record<string, unknown> {
  return {
    id: order.id,
    marketplaceOrderId: order.marketplaceOrderId,
    mode: order.mode,
    serviceId: order.serviceId,
    status: order.status,
    remoteStatus: order.remoteStatus,
    budget: order.budget,
    currency: order.currency,
    protocolFee: order.protocolFee,
    providerPayout: order.providerPayout,
    failureCode: order.failureCode,
    failureDetail: order.failureDetail,
    missing: order.missing,
    outputHash: order.outputHash,
    walletActions: order.walletActions.map((w) => ({ id: w.id, kind: w.kind, status: w.status, txHash: w.txHash, createdAt: w.createdAt, intent: w.intent })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    settledAt: order.settledAt,
    fulfillmentMs: order.fulfillmentMs,
    executionCount: order.executionCount,
    liveTrading: false,
  };
}
