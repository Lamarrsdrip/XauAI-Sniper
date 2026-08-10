import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { canonicalTradeIdentity, dedupeByTradeIdentity } from "./performanceEngine.js";
import {
  buildNetworkDailyResults,
  journalClosePrice,
  networkClosedTradeQuery,
} from "./networkDailyResults.js";

const NOW = Date.parse("2026-08-10T12:00:00Z") / 1000;

function closedTrade(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account_login: "A",
    license_id: "private-license",
    ticket: 123,
    has_rich_ledger_data: true,
    opened_at: Date.parse("2026-08-05T09:00:00Z") / 1000,
    closed_at: Date.parse("2026-08-05T10:00:00Z") / 1000,
    direction: "BUY",
    account_currency: "USD",
    entry_price: 4000,
    price: 4010,
    profit: 50,
    commission: 0,
    swap: 0,
    final_r: 1,
    ...overrides,
  };
}

describe("network-wide Daily Trading Results", () => {
  test("same ticket on two accounts remains two trades", () => {
    const trades = [closedTrade({ account_login: "A" }), closedTrade({ account_login: "B" })];
    expect(dedupeByTradeIdentity(trades)).toHaveLength(2);
    expect(canonicalTradeIdentity(trades[0]!)).not.toBe(canonicalTradeIdentity(trades[1]!));
  });

  test("same account and ticket retry counts once", () => {
    const trades = [closedTrade(), closedTrade({ profit: 999, closed_at: closedTrade()["closed_at"] })];
    expect(dedupeByTradeIdentity(trades)).toHaveLength(1);
  });

  test("historical Aug 5 journal rows inside the window are included without a performance period", () => {
    const result = buildNetworkDailyResults([closedTrade()], 30, NOW);
    expect(result.status).toBe("ok");
    expect(result.days.map((day) => day.date)).toContain("2026-08-05");
    expect(result.totals.trades).toBe(1);

    const query = networkClosedTradeQuery(NOW - 30 * 86400) as Record<string, unknown>;
    expect(query).not.toHaveProperty("period_id");
    expect(query).not.toHaveProperty("license_id");
    expect(JSON.stringify(query)).not.toContain("account_logins");
  });

  test("daily route calls the network source, not active-period account scope", () => {
    const route = readFileSync(new URL("../routes/performance.ts", import.meta.url), "utf8");
    const dailyBlock = route.slice(route.indexOf('app.get("/performance/daily-results"'), route.indexOf('// GET /performance/gold-replay'));
    expect(dailyBlock).toContain("getNetworkDailyResults");
    expect(dailyBlock).not.toContain("getActivePerformancePeriod");
    expect(dailyBlock).not.toContain("fetchPeriodTrades");
    expect(dailyBlock).not.toContain("account_logins");
  });

  test("preserves math, account counts, close-price compatibility, and response privacy", () => {
    const trades = [
      closedTrade(),
      closedTrade({ profit: 999 }), // same A+123 retry: ignored
      closedTrade({ account_login: "B", price: 0, exit_price: 3995, direction: "SELL", profit: 25, final_r: 0.5 }),
      closedTrade({ account_login: "A", ticket: 124, price: 0, close_price: 3998, profit: -10, final_r: -0.2 }),
      closedTrade({ account_login: "C", ticket: 125, price: 4000, profit: 0.5, final_r: 0 }),
      closedTrade({ account_login: "D", ticket: 126, closed_at: 0 }),
      closedTrade({ account_login: "E", ticket: 0 }),
    ];
    const result = buildNetworkDailyResults(trades, 30, NOW);

    expect(journalClosePrice(trades[2]!)).toBe(3995);
    expect(journalClosePrice(trades[3]!)).toBe(3998);
    expect(result.account_count).toBe(3);
    expect(result.days[0]!.account_count).toBe(3);
    expect(result.totals).toMatchObject({
      trades: 4,
      wins: 2,
      losses: 1,
      breakeven: 1,
      account_count: 3,
      net_gold_moves: 13,
      net_pips: 130,
      net_r: 1.3,
      net_usd: 65.5,
      net_usd_available: true,
    });
    const publicJson = JSON.stringify(result);
    expect(publicJson).not.toContain("account_login");
    expect(publicJson).not.toContain("license_id");
    expect(publicJson).not.toContain("private-license");
    expect(publicJson).not.toContain('"A"');
  });

  test("suppresses the network USD total when any trade currency is unknown or non-USD", () => {
    const result = buildNetworkDailyResults([closedTrade(), closedTrade({ account_login: "B", ticket: 124, account_currency: "EUR" })], 30, NOW);
    expect(result.totals.net_usd).toBeNull();
    expect(result.totals.net_usd_available).toBe(false);
  });
});
