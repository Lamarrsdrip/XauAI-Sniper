import { randomUUID } from "node:crypto";
import { catalogById, catalogBySkillTag, type CatalogService } from "./catalog.js";
import { deliverableHash, type FulfillmentResult } from "./fulfillment.js";

export const LOCAL_STATUSES = [
  "DISCOVERED", "FUNDED", "AWAITING_ACCEPT", "ACCEPTED", "INSUFFICIENT_INFORMATION",
  "INPUT_READY", "QUEUED", "EXECUTING", "OUTPUT_VALIDATED", "AWAITING_DELIVERY_TX",
  "DELIVERED", "AWAITING_SETTLEMENT", "SETTLED", "EXPIRED_DATA", "SOURCE_UNAVAILABLE",
  "FAILED", "RETRY_WAIT", "CANCELLED", "DISPUTED", "REFUNDED", "SETTLEMENT_FAILED",
] as const;
export type LocalStatus = typeof LOCAL_STATUSES[number];

export type WalletKind = "acceptOrder" | "submitDelivery" | "claimAfterTimeout" | "cancelExpired";

export interface WalletAction {
  id: string;
  kind: WalletKind;
  status: "PENDING" | "REPORTED" | "CONFIRMED";
  intent: unknown;
  txHash: string | null;
  createdAt: string;
}

export interface HistoryEntry { at: string; status: string; detail: string }

export interface CommerceOrder {
  id: string;
  marketplaceOrderId: string;
  mode: "live" | "sandbox";
  serviceId: string | null;
  status: LocalStatus;
  remoteStatus: string | null;
  budget: string | null;
  currency: string | null;
  protocolFee: string | null;
  providerPayout: string | null;
  listingId: string | null;
  input: unknown;
  attempt: number;
  output: Record<string, unknown> | null;
  outputHash: string | null;
  failureCode: string | null;
  failureDetail: string | null;
  missing: string[];
  leaseOwner: string | null;
  leaseUntil: number | null;
  walletActions: WalletAction[];
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
  deliveredAt: string | null;
  fulfillmentMs: number | null;
  executionCount: number;
  artifactIds: string[];
  version: number;
}

export interface RemoteOrderView {
  id: string;
  status: string;
  budget?: string | null;
  protocolFee?: string | null;
  providerPayout?: string | null;
  currency?: string | null;
  listingId?: string | null;
  skillTag?: string | null;
  note?: string | null;
  challengeWindowEndsAt?: string | null;
  deliveryDueAt?: string | null;
  canSubmitDelivery?: boolean;
}

export type EngineEffect =
  | { type: "none" }
  | { type: "prepare"; kind: WalletKind }
  | { type: "fulfill" }
  | { type: "request-input"; missing: string[] }
  | { type: "hold"; code: string };

const MAX_ATTEMPTS = 3;

export function blankOrder(marketplaceOrderId: string, mode: CommerceOrder["mode"], nowIso: string): CommerceOrder {
  return {
    id: randomUUID(),
    marketplaceOrderId,
    mode,
    serviceId: null,
    status: "DISCOVERED",
    remoteStatus: null,
    budget: null,
    currency: null,
    protocolFee: null,
    providerPayout: null,
    listingId: null,
    input: null,
    attempt: 0,
    output: null,
    outputHash: null,
    failureCode: null,
    failureDetail: null,
    missing: [],
    leaseOwner: null,
    leaseUntil: null,
    walletActions: [],
    history: [{ at: nowIso, status: "DISCOVERED", detail: "Order recorded." }],
    createdAt: nowIso,
    updatedAt: nowIso,
    settledAt: null,
    deliveredAt: null,
    fulfillmentMs: null,
    executionCount: 0,
    artifactIds: [],
    version: 0,
  };
}

export function stampStatus(order: CommerceOrder, status: LocalStatus, detail: string, nowIso: string): CommerceOrder {
  if (order.status === status && order.history[order.history.length - 1]?.detail === detail) {
    return { ...order, updatedAt: nowIso };
  }
  return {
    ...order,
    status,
    updatedAt: nowIso,
    history: [...order.history, { at: nowIso, status, detail }].slice(-80),
  };
}

function money(v: string | null | undefined): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

/** Verified provider-side order fields overwrite local copies. Chat claims are not accepted here. */
export function absorbRemote(order: CommerceOrder, remote: RemoteOrderView, nowIso: string): CommerceOrder {
  let next: CommerceOrder = {
    ...order,
    remoteStatus: remote.status,
    budget: money(remote.budget) ?? order.budget,
    currency: remote.currency ?? order.currency,
    protocolFee: money(remote.protocolFee) ?? order.protocolFee,
    providerPayout: money(remote.providerPayout) ?? order.providerPayout,
    listingId: remote.listingId ?? order.listingId,
    updatedAt: nowIso,
  };
  if (!next.serviceId && remote.skillTag) next = { ...next, serviceId: catalogBySkillTag(remote.skillTag)?.id ?? null };
  if (remote.status === "SETTLED") {
    return stampStatus({ ...next, settledAt: next.settledAt ?? nowIso, failureCode: null }, "SETTLED", "Marketplace order is SETTLED.", nowIso);
  }
  if (remote.status === "IN_DISPUTE") return stampStatus(next, "DISPUTED", "Buyer opened a challenge.", nowIso);
  if (remote.status === "CANCELLED") {
    const funded = next.budget !== null || ["FUNDED", "AWAITING_ACCEPT", "ACCEPTED", "DELIVERED", "AWAITING_SETTLEMENT", "REFUNDED"].includes(order.status);
    return stampStatus(next, funded ? "REFUNDED" : "CANCELLED", "Marketplace order is CANCELLED.", nowIso);
  }
  if (remote.status === "DELIVERED") {
    return stampStatus({ ...next, deliveredAt: next.deliveredAt ?? nowIso }, "DELIVERED", "Delivery is on the marketplace order.", nowIso);
  }
  if (remote.status === "PENDING_ACCEPT") return stampStatus(next, next.status === "DISCOVERED" ? "FUNDED" : next.status, "Escrow is funded and waiting for provider acceptance.", nowIso);
  if (remote.status === "FUNDED" || remote.status === "IN_PROGRESS") {
    if (["DELIVERED", "AWAITING_SETTLEMENT", "SETTLED", "OUTPUT_VALIDATED", "AWAITING_DELIVERY_TX"].includes(next.status)) return next;
    return stampStatus(next, "ACCEPTED", "Provider acceptance is confirmed by the marketplace order.", nowIso);
  }
  return next;
}

export function pendingWallet(order: CommerceOrder, kind: WalletKind): WalletAction | null {
  return order.walletActions.find((w) => w.kind === kind && w.status !== "CONFIRMED") ?? null;
}

export function queueWallet(order: CommerceOrder, kind: WalletKind, intent: unknown, nowIso: string): CommerceOrder {
  if (pendingWallet(order, kind)) return order;
  const action: WalletAction = { id: randomUUID(), kind, status: "PENDING", intent, txHash: null, createdAt: nowIso };
  return stampStatus({ ...order, walletActions: [...order.walletActions, action] }, order.status, `Wallet action ${kind} is waiting for the owner.`, nowIso);
}

export function decideNext(order: CommerceOrder, service: CatalogService | null, marketFresh: boolean, nowMs: number): EngineEffect {
  if (order.status === "FAILED" && (order.remoteStatus === "FUNDED" || order.remoteStatus === "IN_PROGRESS")) {
    const due = historyTime(order, "delivery-due:");
    if (Number.isFinite(due) && nowMs >= due && !pendingWallet(order, "cancelExpired")) return { type: "prepare", kind: "cancelExpired" };
  }
  if (["SETTLED", "CANCELLED", "REFUNDED", "DISPUTED", "FAILED", "SETTLEMENT_FAILED"].includes(order.status)) return { type: "none" };
  if (!service || !service.publishable) return { type: "hold", code: "NOT_PUBLISHABLE" };
  if (order.remoteStatus === "PENDING_ACCEPT") {
    if (service.needsBuyerInput && order.input == null) return { type: "request-input", missing: ["buyer JSON, CSV or HTML in the order note or a linked message"] };
    if (service.needsFreshBrokerSource && !marketFresh) return { type: "hold", code: "SOURCE_UNAVAILABLE" };
    if (pendingWallet(order, "acceptOrder")) return { type: "none" };
    return { type: "prepare", kind: "acceptOrder" };
  }
  if (order.status === "INSUFFICIENT_INFORMATION") {
    if (order.input == null) return { type: "none" };
    if (order.remoteStatus === "FUNDED" || order.remoteStatus === "IN_PROGRESS") return { type: "fulfill" };
    if (pendingWallet(order, "acceptOrder")) return { type: "none" };
    return { type: "prepare", kind: "acceptOrder" };
  }
  if (order.status === "SOURCE_UNAVAILABLE" || order.status === "EXPIRED_DATA" || order.status === "RETRY_WAIT") {
    if (service.needsFreshBrokerSource && !marketFresh) return { type: "hold", code: "SOURCE_UNAVAILABLE" };
    if (order.remoteStatus === "FUNDED" || order.remoteStatus === "IN_PROGRESS") return { type: "fulfill" };
    if (!pendingWallet(order, "acceptOrder")) return { type: "prepare", kind: "acceptOrder" };
    return { type: "none" };
  }
  if (order.status === "ACCEPTED" || order.status === "INPUT_READY" || order.status === "QUEUED") {
    if (order.attempt >= MAX_ATTEMPTS) return { type: "hold", code: "FAILED" };
    return { type: "fulfill" };
  }
  if (order.status === "OUTPUT_VALIDATED") {
    if (order.mode === "sandbox") return { type: "none" };
    if (pendingWallet(order, "submitDelivery")) return { type: "none" };
    return { type: "prepare", kind: "submitDelivery" };
  }
  if (order.status === "AWAITING_DELIVERY_TX" || order.status === "AWAITING_ACCEPT" || order.status === "AWAITING_SETTLEMENT" && pendingWallet(order, "claimAfterTimeout")) {
    return { type: "none" };
  }
  if (order.status === "DELIVERED" || order.status === "AWAITING_SETTLEMENT") {
    const windowEnd = historyTime(order, "challenge-window:");
    if (Number.isFinite(windowEnd) && nowMs >= windowEnd && !pendingWallet(order, "claimAfterTimeout")) {
      return { type: "prepare", kind: "claimAfterTimeout" };
    }
    return { type: "none" };
  }
  return { type: "none" };
}

function historyTime(order: CommerceOrder, prefix: string): number {
  const entry = [...order.history].reverse().find((h) => h.detail.startsWith(prefix));
  return Date.parse(entry?.detail.slice(prefix.length) ?? "");
}

export function rememberDeadlines(order: CommerceOrder, remote: RemoteOrderView, nowIso: string): CommerceOrder {
  let next = order;
  for (const [prefix, value] of [["challenge-window:", remote.challengeWindowEndsAt], ["delivery-due:", remote.deliveryDueAt]] as const) {
    if (!value) continue;
    const detail = `${prefix}${value}`;
    if (next.history.some((h) => h.detail === detail)) continue;
    next = { ...next, history: [...next.history, { at: nowIso, status: next.status, detail }] };
  }
  return next;
}

/** @deprecated use rememberDeadlines */
export const rememberChallengeWindow = rememberDeadlines;

export function applyFulfillment(order: CommerceOrder, result: FulfillmentResult, startedMs: number, finishedMs: number, nowIso: string): CommerceOrder {
  if (order.outputHash && result.ok && deliverableHash(result.deliverable) === order.outputHash) {
    return { ...order, executionCount: order.executionCount };
  }
  if (!result.ok) {
    const status: LocalStatus = result.code === "INSUFFICIENT_INFORMATION" ? "INSUFFICIENT_INFORMATION"
      : result.code === "SOURCE_UNAVAILABLE" ? "SOURCE_UNAVAILABLE"
        : result.code === "EXPIRED_DATA" ? "EXPIRED_DATA"
          : result.code === "NOT_PUBLISHABLE" ? "FAILED"
            : order.attempt + 1 >= MAX_ATTEMPTS ? "FAILED" : "RETRY_WAIT";
    return stampStatus({
      ...order,
      attempt: order.attempt + 1,
      failureCode: result.code,
      failureDetail: result.detail,
      missing: result.missing ?? [],
      fulfillmentMs: finishedMs - startedMs,
    }, status, result.detail, nowIso);
  }
  const hash = deliverableHash(result.deliverable);
  return stampStatus({
    ...order,
    output: result.deliverable,
    outputHash: hash,
    failureCode: null,
    failureDetail: null,
    missing: [],
    fulfillmentMs: finishedMs - startedMs,
    executionCount: order.executionCount + 1,
  }, "OUTPUT_VALIDATED", `Output validated ${hash.slice(0, 12)}.`, nowIso);
}

export function serviceFor(order: CommerceOrder): CatalogService | null {
  return catalogById(order.serviceId);
}

/** In-process claim. A second worker receives null until the lease expires. */
export function tryClaim(order: CommerceOrder, worker: string, nowMs: number, leaseMs: number): CommerceOrder | null {
  if (order.leaseUntil !== null && order.leaseUntil > nowMs && order.leaseOwner !== worker) return null;
  return { ...order, leaseOwner: worker, leaseUntil: nowMs + leaseMs };
}

export function releaseClaim(order: CommerceOrder): CommerceOrder {
  return { ...order, leaseOwner: null, leaseUntil: null };
}
