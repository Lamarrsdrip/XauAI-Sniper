import type { Document, Filter } from "mongodb";
import { getDb } from "../db.js";
import { buildResultConversion } from "./marketOutlookCore.js";
import { classifyTrade, dedupeByTradeIdentity, isEligibleTrade, netResult } from "./performanceEngine.js";

export interface DailyResultBucket {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  account_count: number;
  net_pips: number;
  net_gold_moves: number;
  net_r: number;
  net_usd: number;
}

export interface NetworkDailyResults {
  status: "ok";
  source: "network_trade_journal";
  scope: "all_authenticated_ea_accounts";
  days_requested: number;
  account_count: number;
  days: DailyResultBucket[];
  totals: {
    trades: number;
    wins: number;
    losses: number;
    breakeven: number;
    account_count: number;
    net_pips: number;
    net_gold_moves: number;
    net_r: number;
    net_usd: number;
  };
}

export function clampDailyResultDays(days: number): number {
  return Math.max(1, Math.min(Math.trunc(days), 90));
}

/** Global journal query: intentionally has no performance-period, account, user, or license scope. */
export function networkClosedTradeQuery(cutoffUnix: number): Filter<Document> {
  return {
    has_rich_ledger_data: true,
    account_login: { $exists: true, $nin: ["", null] },
    ticket: { $exists: true, $nin: [0, "0", null] },
    opened_at: { $gt: 0 },
    closed_at: { $gte: cutoffUnix },
  };
}

export function isEligibleNetworkClosedTrade(trade: Record<string, unknown>): boolean {
  return (
    isEligibleTrade(trade) &&
    String(trade["account_login"] ?? "").trim().length > 0 &&
    Number.isFinite(Number(trade["closed_at"])) &&
    Number(trade["closed_at"]) > 0
  );
}

/** Historical journal schemas used each of these genuine broker close-price fields. */
export function journalClosePrice(trade: Record<string, unknown>): number | null {
  for (const field of ["price", "exit_price", "close_price"] as const) {
    const value = Number(trade[field]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildNetworkDailyResults(
  rawTrades: Record<string, unknown>[],
  requestedDays: number,
  nowUnix = Date.now() / 1000,
): NetworkDailyResults {
  const daysRequested = clampDailyResultDays(requestedDays);
  const cutoffUnix = nowUnix - daysRequested * 86400;
  const trades = dedupeByTradeIdentity(
    rawTrades.filter((trade) => isEligibleNetworkClosedTrade(trade) && Number(trade["closed_at"]) >= cutoffUnix),
  );

  type InternalBucket = DailyResultBucket & { accounts: Set<string> };
  const byDay = new Map<string, InternalBucket>();
  const allAccounts = new Set<string>();

  for (const trade of trades) {
    const closedAt = Number(trade["closed_at"]);
    const date = new Date(closedAt * 1000);
    if (Number.isNaN(date.getTime())) continue;
    const dateStr = date.toISOString().slice(0, 10);
    const account = String(trade["account_login"] ?? "").trim();
    const direction = String(trade["direction"] ?? "").toUpperCase();
    const entryPrice = Number(trade["entry_price"] ?? 0);
    const exitPrice = journalClosePrice(trade);
    let priceMove: number | null = null;
    if (entryPrice > 0 && exitPrice !== null && (direction === "BUY" || direction === "SELL")) {
      priceMove = direction === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
    }
    const finalR = Number(trade["final_r"] ?? 0);
    const conversion = buildResultConversion({
      r: Number.isFinite(finalR) && finalR !== 0 ? finalR : null,
      price_move: priceMove,
    });
    const outcome = classifyTrade(trade);

    let day = byDay.get(dateStr);
    if (!day) {
      day = {
        date: dateStr,
        trades: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        account_count: 0,
        net_pips: 0,
        net_gold_moves: 0,
        net_r: 0,
        net_usd: 0,
        accounts: new Set<string>(),
      };
      byDay.set(dateStr, day);
    }

    day.trades += 1;
    if (outcome === "WIN") day.wins += 1;
    else if (outcome === "LOSS") day.losses += 1;
    else day.breakeven += 1;
    day.accounts.add(account);
    allAccounts.add(account);
    if (conversion.result_pips !== null) day.net_pips = round1(day.net_pips + conversion.result_pips);
    if (conversion.result_gold_moves !== null) day.net_gold_moves = round2(day.net_gold_moves + conversion.result_gold_moves);
    if (conversion.result_r !== null) day.net_r = round2(day.net_r + conversion.result_r);
    day.net_usd = round2(day.net_usd + netResult(trade));
  }

  const days = [...byDay.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ accounts, ...day }) => ({ ...day, account_count: accounts.size }));
  const totals = {
    trades: days.reduce((sum, day) => sum + day.trades, 0),
    wins: days.reduce((sum, day) => sum + day.wins, 0),
    losses: days.reduce((sum, day) => sum + day.losses, 0),
    breakeven: days.reduce((sum, day) => sum + day.breakeven, 0),
    account_count: allAccounts.size,
    net_pips: round2(days.reduce((sum, day) => sum + day.net_pips, 0)),
    net_gold_moves: round2(days.reduce((sum, day) => sum + day.net_gold_moves, 0)),
    net_r: round2(days.reduce((sum, day) => sum + day.net_r, 0)),
    net_usd: round2(days.reduce((sum, day) => sum + day.net_usd, 0)),
  };

  return {
    status: "ok",
    source: "network_trade_journal",
    scope: "all_authenticated_ea_accounts",
    days_requested: daysRequested,
    account_count: allAccounts.size,
    days,
    totals,
  };
}

export async function getNetworkDailyResults(requestedDays: number, nowUnix = Date.now() / 1000): Promise<NetworkDailyResults> {
  const days = clampDailyResultDays(requestedDays);
  const cutoffUnix = nowUnix - days * 86400;
  const trades = await getDb()
    .collection("trade_journal")
    .find(networkClosedTradeQuery(cutoffUnix), {
      projection: {
        _id: 0,
        account_login: 1,
        ticket: 1,
        opened_at: 1,
        closed_at: 1,
        created_ts: 1,
        has_rich_ledger_data: 1,
        direction: 1,
        entry_price: 1,
        price: 1,
        exit_price: 1,
        close_price: 1,
        final_r: 1,
        profit: 1,
        commission: 1,
        swap: 1,
      },
    })
    .sort({ closed_at: 1, opened_at: 1, created_ts: 1 })
    .toArray();
  return buildNetworkDailyResults(trades, days, nowUnix);
}
