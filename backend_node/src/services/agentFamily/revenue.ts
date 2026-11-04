import type { CommerceOrder } from "./orderEngine.js";
import { CATALOG } from "./catalog.js";

export interface RevenueTotals {
  definition: string;
  grossSales: number | null;
  marketplaceFees: number | null;
  netRevenue: number | null;
  refunds: number | null;
  estimatedComputationCost: number;
  settledOrders: number;
  incompleteSettlementRows: number;
  sandboxExcluded: number;
}

function decimal(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Revenue is counted only for live orders whose marketplace status is SETTLED
 * and whose provider payout was returned by the provider API. Sandbox orders
 * and chat claims are ignored. Fees are the marketplace protocolFee field,
 * never a hard-coded basis-point guess.
 */
export function summarizeRevenue(orders: readonly CommerceOrder[]): RevenueTotals {
  let gross = 0;
  let fees = 0;
  let net = 0;
  let refunds = 0;
  let cost = 0;
  let settled = 0;
  let incomplete = 0;
  let sandbox = 0;
  let refundsKnown = true;
  for (const order of orders) {
    if (order.mode !== "live") {
      sandbox += 1;
      continue;
    }
    if (order.status === "SETTLED") {
      const budget = decimal(order.budget);
      const fee = decimal(order.protocolFee);
      const payout = decimal(order.providerPayout);
      if (budget === null || fee === null || payout === null) {
        incomplete += 1;
        continue;
      }
      gross += budget;
      fees += fee;
      net += payout;
      settled += 1;
      const service = CATALOG.find((s) => s.id === order.serviceId);
      cost += service?.estimatedCostUsd ?? 0;
    } else if (order.status === "REFUNDED") {
      const budget = decimal(order.budget);
      if (budget === null) refundsKnown = false;
      else refunds += budget;
    } else if (order.status === "DELIVERED" || order.status === "AWAITING_SETTLEMENT" || order.status === "OUTPUT_VALIDATED" || order.status === "AWAITING_DELIVERY_TX") {
      const service = CATALOG.find((s) => s.id === order.serviceId);
      cost += service?.estimatedCostUsd ?? 0;
    }
  }
  return {
    definition: "Net revenue is the sum of providerPayout on live SETTLED orders only. Sandbox and unsettled orders are excluded. Refunds are displayed separately and are not subtracted twice.",
    grossSales: round2(gross),
    marketplaceFees: round2(fees),
    netRevenue: round2(net),
    refunds: refundsKnown ? round2(refunds) : null,
    estimatedComputationCost: round2(cost),
    settledOrders: settled,
    incompleteSettlementRows: incomplete,
    sandboxExcluded: sandbox,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function successRate(orders: readonly CommerceOrder[]): { rate: number | null; successes: number; failures: number; open: number } {
  let successes = 0;
  let failures = 0;
  let open = 0;
  for (const order of orders) {
    if (order.mode !== "live") continue;
    if (order.status === "SETTLED") successes += 1;
    else if (["CANCELLED", "REFUNDED", "FAILED", "SETTLEMENT_FAILED"].includes(order.status)) failures += 1;
    else open += 1;
  }
  const denom = successes + failures;
  return { rate: denom === 0 ? null : Math.round((successes / denom) * 1000) / 1000, successes, failures, open };
}

export function averageFulfillmentMs(orders: readonly CommerceOrder[]): number | null {
  const samples = orders.filter((o) => o.mode === "live" && o.fulfillmentMs !== null && (o.status === "DELIVERED" || o.status === "SETTLED" || o.status === "AWAITING_SETTLEMENT"));
  if (!samples.length) return null;
  const total = samples.reduce((s, o) => s + (o.fulfillmentMs ?? 0), 0);
  return Math.round(total / samples.length);
}
