import { describe, expect, it } from "vitest";
import { decideNativeSignal, selectConnectedMt5Source, agentFamilyReadAuthorized } from "../agentFamilySource.js";
import { advanceOrder } from "./advance.js";
import { catalogById } from "./catalog.js";
import { fulfillService, type MarketContext } from "./fulfillment.js";
import { blankOrder, tryClaim, type CommerceOrder, type RemoteOrderView } from "./orderEngine.js";
import { summarizeRevenue } from "./revenue.js";
import { TermixClient, TermixError } from "./termix.js";

const NOW = new Date("2026-11-04T12:00:00.000Z");

function market(partial: Partial<MarketContext> = {}): MarketContext {
  return {
    fresh: true,
    quote: { bid: 3099.8, ask: 3100.05, time: NOW.toISOString() },
    nativeSignal: {
      status: "NO_TRADE", direction: "NO_TRADE", engine: "M10_ENGINE", signalId: "sig-1",
      entry: null, stop: null, takeProfit: null, rationale: "No fresh native actionable signal",
    },
    spreadSamples: [],
    marketOpen: true,
    capturedAt: NOW.toISOString(),
    ...partial,
  };
}

function deps(ctx: MarketContext, prepares: string[] = []) {
  return {
    now: () => NOW,
    market: () => ctx,
    fulfill: (id: string, input: unknown, current: MarketContext) => fulfillService(id, input, current, NOW),
    prepare: async (kind: string) => {
      prepares.push(kind);
      return { intent: { kind, unsigned: true }, artifactIds: kind === "submitDelivery" ? ["artifact-1"] : undefined };
    },
  };
}

describe("native XauCloud signal", () => {
  it("keeps a fresh actionable signal and refuses to invent levels", () => {
    const decision = decideNativeSignal({
      status: "ACTIONABLE", direction: "buy", engine: "M10_ENGINE", signal_id: "abc",
      entry: 3100, stop: 3090, tp1: 3110, rationale: "native", updated_at: NOW.toISOString(),
    }, NOW.getTime());
    expect(decision).toMatchObject({ direction: "BUY", entry: 3100, stop: 3090, takeProfit: 3110 });
    const stale = decideNativeSignal({ status: "ACTIONABLE", direction: "BUY", entry: 1, stop: 1, tp1: 1, updated_at: "2020-01-01T00:00:00Z" }, NOW.getTime());
    expect(stale.direction).toBe("NO_TRADE");
    expect(stale.entry).toBeNull();
  });

  it("does not deliver a signal when the approved source is offline", () => {
    const result = fulfillService("xauusd-signal", null, market({ fresh: false, quote: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SOURCE_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("BUY");
  });
});

describe("paid computations", () => {
  it("sizes lots from the supplied risk without assuming a contract", () => {
    const result = fulfillService("position-sizing", {
      equity: 10000, riskPercent: 1, entry: 3100, stop: 3090, valuePerLotPerPriceUnit: 100,
    }, market({ fresh: false, quote: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const risk = 10000 * 0.01;
    const lots = risk / (10 * 100);
    expect(result.deliverable["lots"]).toBe(lots);
    expect(result.deliverable["riskAmount"]).toBe(100);
  });

  it("recomputes journal net from the uploaded rows", () => {
    const result = fulfillService("mt5-journal-audit", {
      trades: [
        { ticket: "1", opened_at: "2026-10-01T00:00:00Z", net_profit: 10, balance: 10010 },
        { ticket: "2", opened_at: "2026-10-02T00:00:00Z", net_profit: -4, balance: 10006 },
      ],
    }, market({ fresh: false, quote: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = result.deliverable["stats"] as { net_profit: number };
    expect(stats.net_profit).toBe(6);
    expect(result.deliverable["independentNetCheck"]).toBe(6);
  });

  it("bootstraps a constant series to the same total on every path", () => {
    const pnls = Array.from({ length: 30 }, () => 1);
    const result = fulfillService("trade-result-bootstrap", { pnls }, market({ fresh: false, quote: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const terminal = result.deliverable["terminalPnl"] as { p05: number; p50: number; p95: number };
    expect(terminal).toEqual({ p05: 30, p50: 30, p95: 30 });
  });

  it("measures adverse slippage independently", () => {
    const result = fulfillService("broker-slippage-analysis", {
      fills: [
        { side: "BUY", requestedPrice: 100, fillPrice: 100.3 },
        { side: "SELL", requestedPrice: 100, fillPrice: 99.8 },
      ],
    }, market({ fresh: false, quote: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deliverable["meanAdverseSlippage"]).toBe(0.25);
  });

  it("fails a signal review whose stop is on the wrong side", () => {
    const result = fulfillService("signal-quality-review", {
      direction: "BUY", entry: 3100, stop: 3110, takeProfit: 3120,
    }, market(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deliverable["verdict"]).toBe("FAIL");
    const risk = 10;
    const reward = 20;
    expect(result.deliverable["rewardToRisk"]).toBe(reward / risk);
  });

  it("refuses a spread audit below 20 quotes and a backtest entirely", () => {
    const spread = fulfillService("broker-spread-health", { quotes: [{ bid: 1, ask: 1.1, time: NOW.toISOString() }] }, market({ fresh: false, quote: null, spreadSamples: [] }));
    expect(spread.ok).toBe(false);
    const backtest = fulfillService("strategy-backtest-diagnostics", {}, market());
    expect(backtest.ok).toBe(false);
    if (!backtest.ok) expect(backtest.code).toBe("NOT_PUBLISHABLE");
    expect(catalogById("event-risk-research")?.publishable).toBe(false);
  });

  it("nets uploaded gold exposure and does not read a terminal", () => {
    const result = fulfillService("open-position-exposure", {
      positions: [
        { symbol: "XAUUSD", side: "BUY", lots: 1.5, price: 3100, stop: 3090 },
        { symbol: "XAUUSD", side: "SELL", lots: 0.5, price: 3102 },
      ],
    }, market({ fresh: false, quote: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deliverable["netLots"]).toBe(1);
    expect(result.deliverable["unprotectedStops"]).toBe(1);
    expect(result.deliverable["customerTerminalsRead"]).toBe(false);
  });
});

describe("order lifecycle", () => {
  it("funds, accepts, delivers once, and settles without a second execution", async () => {
    const prepares: string[] = [];
    const ctx = market({
      nativeSignal: {
        status: "ACTIONABLE", direction: "BUY", engine: "M10_ENGINE", signalId: "sig-9",
        entry: 3100, stop: 3090, takeProfit: 3110, rationale: "native setup",
      },
    });
    const remote: RemoteOrderView = { id: "order-1", status: "PENDING_ACCEPT", budget: "8", currency: "USDC", skillTag: "xaucloud-xauusd-signal" };
    let order = await advanceOrder(null, remote, deps(ctx, prepares));
    expect(order.status).toBe("AWAITING_ACCEPT");
    expect(prepares).toEqual(["acceptOrder"]);
    order = await advanceOrder(order, { ...remote, status: "IN_PROGRESS", canSubmitDelivery: true }, deps(ctx, prepares));
    expect(order.status).toBe("AWAITING_DELIVERY_TX");
    expect(order.executionCount).toBe(1);
    expect(order.output?.["decision"]).toBe("BUY");
    expect(JSON.stringify(order.output)).not.toContain("account");
    const again = await advanceOrder(order, { ...remote, status: "IN_PROGRESS" }, deps(ctx, prepares));
    expect(again.executionCount).toBe(1);
    expect(prepares.filter((p) => p === "submitDelivery")).toHaveLength(1);
    const delivered = await advanceOrder(again, {
      ...remote, status: "DELIVERED", challengeWindowEndsAt: "2026-11-04T11:00:00.000Z",
    }, deps(ctx, prepares));
    expect(delivered.status).toBe("AWAITING_SETTLEMENT");
    expect(prepares).toContain("claimAfterTimeout");
    const settled = await advanceOrder(delivered, { ...remote, status: "SETTLED", protocolFee: "0.16", providerPayout: "7.84" }, deps(ctx, prepares));
    expect(settled.status).toBe("SETTLED");
    const totals = summarizeRevenue([settled, { ...settled, id: "sand", mode: "sandbox", marketplaceOrderId: "sand" }]);
    expect(totals.netRevenue).toBe(7.84);
    expect(totals.grossSales).toBe(8);
    expect(totals.marketplaceFees).toBe(0.16);
    expect(totals.sandboxExcluded).toBe(1);
  });

  it("does not accept a file-backed order until the buyer input exists", async () => {
    const prepares: string[] = [];
    const remote: RemoteOrderView = { id: "order-2", status: "PENDING_ACCEPT", budget: "6", currency: "USDC", skillTag: "xaucloud-position-sizing" };
    const waiting = await advanceOrder(null, remote, deps(market(), prepares));
    expect(waiting.status).toBe("INSUFFICIENT_INFORMATION");
    expect(prepares).toEqual([]);
    const funded = await advanceOrder(waiting, { ...remote, note: "{\"equity\":10000,\"riskPercent\":1,\"entry\":3100,\"stop\":3090,\"valuePerLotPerPriceUnit\":100}" }, deps(market(), prepares));
    expect(funded.status).toBe("AWAITING_ACCEPT");
    expect(funded.output).toBeNull();
  });

  it("holds a paid signal instead of fabricating one when every source is stale", async () => {
    const offline = selectConnectedMt5Source([{
      account: "123456", heartbeat_at: "2026-11-04T10:00:00.000Z", quote_at: "2026-11-04T10:00:00.000Z", bid: 3100, ask: 3100.2,
    }], NOW.getTime());
    expect(offline).toBeNull();
    const order = await advanceOrder(null, {
      id: "order-3", status: "PENDING_ACCEPT", skillTag: "xaucloud-xauusd-signal", budget: "8",
    }, deps(market({ fresh: false, quote: null })));
    expect(order.status).toBe("SOURCE_UNAVAILABLE");
    expect(order.output).toBeNull();
  });

  it("claims an order once and rejects a second worker until the lease expires", () => {
    const order = blankOrder("order-4", "live", NOW.toISOString());
    const first = tryClaim(order, "worker-a", NOW.getTime(), 1000);
    expect(first?.leaseOwner).toBe("worker-a");
    expect(tryClaim(first as CommerceOrder, "worker-b", NOW.getTime() + 10, 1000)).toBeNull();
    expect(tryClaim(first as CommerceOrder, "worker-b", NOW.getTime() + 1001, 1000)?.leaseOwner).toBe("worker-b");
  });

  it("does not count a cancelled refund as revenue", () => {
    const cancelled = { ...blankOrder("order-5", "live", NOW.toISOString()), status: "REFUNDED" as const, budget: "8" };
    const totals = summarizeRevenue([cancelled]);
    expect(totals.netRevenue).toBe(0);
    expect(totals.refunds).toBe(8);
    expect(totals.settledOrders).toBe(0);
  });
});

describe("marketplace client boundaries", () => {
  it("refuses undocumented hosts and paths", async () => {
    expect(() => new TermixClient({ baseUrl: "https://evil.example", accessToken: "x" })).toThrow(TermixError);
    const client = new TermixClient({ baseUrl: "http://127.0.0.1:9", accessToken: "x", allowLoopback: true, fetchImpl: async () => new Response("{}", { status: 200 }) });
    await expect(client.request("POST", "/api/v1/orders/1/shell")).rejects.toThrow(/Undocumented/);
  });

  it("rejects a missing or short read token", () => {
    const previous = process.env["XAUCLOUD_AGENT_FAMILY_READ_TOKEN"];
    process.env["XAUCLOUD_AGENT_FAMILY_READ_TOKEN"] = "short";
    expect(agentFamilyReadAuthorized("Bearer short")).toBe(false);
    process.env["XAUCLOUD_AGENT_FAMILY_READ_TOKEN"] = "12345678901234567890123456789012";
    expect(agentFamilyReadAuthorized("Bearer 12345678901234567890123456789012")).toBe(true);
    expect(agentFamilyReadAuthorized("Bearer someone-else-token-of-equal-size")).toBe(false);
    if (previous === undefined) delete process.env["XAUCLOUD_AGENT_FAMILY_READ_TOKEN"];
    else process.env["XAUCLOUD_AGENT_FAMILY_READ_TOKEN"] = previous;
  });
});
