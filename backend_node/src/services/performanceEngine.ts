/** Port of backend/performance_engine.py -- performance-period calculation engine. */

export const DEFAULT_MINIMUM_SAMPLE = 20;
export const DEFAULT_BREAK_EVEN_TOLERANCE_USD = 1.0;

/** Port of performance_engine.py:39 `net_result` -- net realized result after commission, swap and fees. */
export function netResult(trade: Record<string, unknown>): number {
  const profit = Number(trade["profit"] ?? 0);
  const commission = Number(trade["commission"] ?? 0);
  const swap = Number(trade["swap"] ?? 0);
  return profit + commission + swap;
}

export type TradeOutcome = "WIN" | "LOSS" | "BE";

/** Port of performance_engine.py:48 `classify_trade`. */
export function classifyTrade(trade: Record<string, unknown>, beToleranceUsd = DEFAULT_BREAK_EVEN_TOLERANCE_USD): TradeOutcome {
  const net = netResult(trade);
  if (net > beToleranceUsd) return "WIN";
  if (net < -beToleranceUsd) return "LOSS";
  return "BE";
}

/** Port of performance_engine.py:59 `is_eligible_trade`. */
export function isEligibleTrade(trade: Record<string, unknown>): boolean {
  if (!trade["has_rich_ledger_data"]) return false;
  if (!trade["ticket"]) return false;
  if (!trade["opened_at"]) return false;
  return true;
}

/** Port of performance_engine.py:76 `dedupe_by_ticket` -- first-seen report per ticket wins (caller pre-sorts by opened_at ascending). */
export function dedupeByTicket(trades: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<unknown>();
  const result: Record<string, unknown>[] = [];
  for (const t of trades) {
    const ticket = t["ticket"];
    if (seen.has(ticket)) continue;
    seen.add(ticket);
    result.push(t);
  }
  return result;
}

export interface PeriodStats {
  total_trades: number;
  wins: number;
  losses: number;
  break_even: number;
  win_rate: number | null;
  gross_profit: number;
  gross_loss: number;
  net_profit: number;
  profit_factor_value: number | null;
  profit_factor_state: "ok" | "not_established" | "no_data";
  avg_win: number;
  avg_loss: number;
  largest_win: number;
  largest_loss: number;
  max_balance_drawdown_pct: number;
  max_balance_drawdown_usd: number;
  longest_winning_streak: number;
  longest_losing_streak: number;
  first_trade_at: string | null;
  last_trade_at: string | null;
  sufficient_data: boolean;
  minimum_sample: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoFromUnix(ts: unknown): string | null {
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Port of performance_engine.py:120 `compute_period_stats` -- pure function over an already-scoped, already-eligibility-filtered trade list. */
export function computePeriodStats(
  trades: Record<string, unknown>[],
  beToleranceUsd = DEFAULT_BREAK_EVEN_TOLERANCE_USD,
  minimumSample = DEFAULT_MINIMUM_SAMPLE,
): PeriodStats {
  const stats: PeriodStats = {
    total_trades: 0,
    wins: 0,
    losses: 0,
    break_even: 0,
    win_rate: null,
    gross_profit: 0,
    gross_loss: 0,
    net_profit: 0,
    profit_factor_value: null,
    profit_factor_state: "no_data",
    avg_win: 0,
    avg_loss: 0,
    largest_win: 0,
    largest_loss: 0,
    max_balance_drawdown_pct: 0,
    max_balance_drawdown_usd: 0,
    longest_winning_streak: 0,
    longest_losing_streak: 0,
    first_trade_at: null,
    last_trade_at: null,
    sufficient_data: false,
    minimum_sample: minimumSample,
  };
  if (trades.length === 0) return stats;

  const ordered = [...trades].sort((a, b) => Number(a["opened_at"] ?? 0) - Number(b["opened_at"] ?? 0));
  const outcomes = ordered.map((t) => ({ outcome: classifyTrade(t, beToleranceUsd), net: netResult(t), t }));
  const wins = outcomes.filter((o) => o.outcome === "WIN");
  const losses = outcomes.filter((o) => o.outcome === "LOSS");
  const be = outcomes.filter((o) => o.outcome === "BE");

  stats.total_trades = ordered.length;
  stats.wins = wins.length;
  stats.losses = losses.length;
  stats.break_even = be.length;

  const decisive = stats.wins + stats.losses;
  stats.win_rate = decisive > 0 ? Math.round((stats.wins / decisive) * 1000) / 10 : null;

  stats.gross_profit = round2(wins.reduce((sum, o) => sum + o.net, 0));
  stats.gross_loss = round2(Math.abs(losses.reduce((sum, o) => sum + o.net, 0)));
  stats.net_profit = round2(stats.gross_profit - stats.gross_loss + be.reduce((sum, o) => sum + o.net, 0));

  if (stats.gross_loss > 0) {
    stats.profit_factor_value = round2(stats.gross_profit / stats.gross_loss);
    stats.profit_factor_state = "ok";
  } else if (stats.gross_profit > 0) {
    stats.profit_factor_value = null;
    stats.profit_factor_state = "not_established";
  } else {
    stats.profit_factor_value = null;
    stats.profit_factor_state = "no_data";
  }

  stats.avg_win = wins.length > 0 ? round2(wins.reduce((sum, o) => sum + o.net, 0) / wins.length) : 0;
  stats.avg_loss = losses.length > 0 ? round2(losses.reduce((sum, o) => sum + o.net, 0) / losses.length) : 0;
  stats.largest_win = wins.length > 0 ? round2(Math.max(...wins.map((o) => o.net))) : 0;
  stats.largest_loss = losses.length > 0 ? round2(Math.min(...losses.map((o) => o.net))) : 0;

  let peakBalance: number | null = null;
  let maxDdPct = 0;
  let maxDdUsd = 0;
  for (const t of ordered) {
    const bal = Number(t["balance"] ?? 0);
    if (bal <= 0) continue;
    if (peakBalance === null || bal > peakBalance) peakBalance = bal;
    const drawdownUsd = peakBalance - bal;
    const drawdownPct = peakBalance > 0 ? (drawdownUsd / peakBalance) * 100 : 0;
    if (drawdownPct > maxDdPct) {
      maxDdPct = drawdownPct;
      maxDdUsd = drawdownUsd;
    }
  }
  stats.max_balance_drawdown_pct = round2(maxDdPct);
  stats.max_balance_drawdown_usd = round2(maxDdUsd);

  let winStreak = 0;
  let lossStreak = 0;
  for (const o of outcomes) {
    if (o.outcome === "WIN") {
      winStreak += 1;
      lossStreak = 0;
    } else if (o.outcome === "LOSS") {
      lossStreak += 1;
      winStreak = 0;
    } else {
      winStreak = 0;
      lossStreak = 0;
    }
    stats.longest_winning_streak = Math.max(stats.longest_winning_streak, winStreak);
    stats.longest_losing_streak = Math.max(stats.longest_losing_streak, lossStreak);
  }

  const openedAts = ordered.map((t) => t["opened_at"]).filter((v) => v);
  if (openedAts.length > 0) {
    stats.first_trade_at = isoFromUnix(Math.min(...openedAts.map(Number)));
    stats.last_trade_at = isoFromUnix(Math.max(...openedAts.map(Number)));
  }

  stats.sufficient_data = stats.total_trades >= minimumSample;
  return stats;
}

/** Port of performance_engine.py:227 `build_recent_trades`. */
export function buildRecentTrades(
  trades: Record<string, unknown>[],
  beToleranceUsd = DEFAULT_BREAK_EVEN_TOLERANCE_USD,
  limit = 20,
): Record<string, unknown>[] {
  const ordered = [...trades].sort((a, b) => Number(b["opened_at"] ?? 0) - Number(a["opened_at"] ?? 0));
  return ordered.slice(0, limit).map((t) => {
    const outcome = classifyTrade(t, beToleranceUsd);
    const net = round2(netResult(t));
    const openedAt = t["opened_at"];
    const d = new Date(Number(openedAt) * 1000);
    const dateStr = Number.isFinite(Number(openedAt)) && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    return {
      date: dateStr,
      direction: String(t["direction"] ?? "").toUpperCase(),
      price: t["price"] ?? null,
      net_result: net,
      outcome,
      exit_reason: t["exit_reason"] ?? "",
      ticket: t["ticket"] ?? null,
    };
  });
}

/** Port of performance_engine.py:261 `period_stats_to_dict`. */
export function periodStatsToDict(stats: PeriodStats): Record<string, unknown> {
  return {
    total_trades: stats.total_trades,
    wins: stats.wins,
    losses: stats.losses,
    break_even: stats.break_even,
    win_rate: stats.win_rate,
    gross_profit: stats.gross_profit,
    gross_loss: stats.gross_loss,
    net_profit: stats.net_profit,
    profit_factor: stats.profit_factor_value,
    profit_factor_state: stats.profit_factor_state,
    avg_win: stats.avg_win,
    avg_loss: stats.avg_loss,
    largest_win: stats.largest_win,
    largest_loss: stats.largest_loss,
    max_balance_drawdown_pct: stats.max_balance_drawdown_pct,
    max_balance_drawdown_usd: stats.max_balance_drawdown_usd,
    longest_winning_streak: stats.longest_winning_streak,
    longest_losing_streak: stats.longest_losing_streak,
    first_trade_at: stats.first_trade_at,
    last_trade_at: stats.last_trade_at,
    sufficient_data: stats.sufficient_data,
    minimum_sample: stats.minimum_sample,
  };
}
