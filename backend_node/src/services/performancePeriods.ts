import type { Document, Filter } from "mongodb";
import { getDb } from "../db.js";
import { currentEaRelease } from "./releaseManifest.js";
import {
  DEFAULT_BREAK_EVEN_TOLERANCE_USD,
  DEFAULT_MINIMUM_SAMPLE,
  buildRecentTrades,
  computePeriodStats,
  dedupeByTicket,
  isEligibleTrade,
  periodStatsToDict,
} from "./performanceEngine.js";

export interface PerformancePeriodScope {
  account_logins?: string[] | null;
  ea_versions?: string[] | null;
  symbol?: string | null;
  break_even_tolerance_usd?: number;
  minimum_sample?: number;
}

export interface PerformancePeriod {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  epoch_started_at: string;
  epoch_started_at_unix: number;
  epoch_ended_at: string | null;
  epoch_ended_at_unix: number | null;
  scope: PerformancePeriodScope;
  created_by_admin_email?: string;
  reason?: string;
  created_at?: string;
  [key: string]: unknown;
}

/** Port of server.py:2665 `get_active_performance_period`. */
export async function getActivePerformancePeriod(): Promise<PerformancePeriod | null> {
  return (await getDb().collection("performance_periods").findOne({ status: "ACTIVE" }, { projection: { _id: 0 } })) as PerformancePeriod | null;
}

/** Port of server.py:2669 `_period_query`. */
export function periodQuery(period: PerformancePeriod): Filter<Document> {
  const query: Record<string, unknown> = {
    has_rich_ledger_data: true,
    opened_at: { $gte: period.epoch_started_at_unix },
  };
  if (period.epoch_ended_at_unix) {
    (query["opened_at"] as Record<string, unknown>)["$lt"] = period.epoch_ended_at_unix;
  }
  const scope = period.scope ?? {};
  if (scope.account_logins && scope.account_logins.length > 0) query["account_login"] = { $in: scope.account_logins };
  if (scope.ea_versions && scope.ea_versions.length > 0) query["ea_version"] = { $in: scope.ea_versions };
  if (scope.symbol) query["symbol"] = scope.symbol;
  return query as Filter<Document>;
}

/** Port of server.py:2686 `_fetch_period_trades`. */
export async function fetchPeriodTrades(period: PerformancePeriod): Promise<Record<string, unknown>[]> {
  const query = periodQuery(period);
  const raw = await getDb()
    .collection("trade_journal")
    .find(query, { projection: { _id: 0 } })
    .sort({ opened_at: 1 })
    .limit(20000)
    .toArray();
  const eligible = raw.filter((t) => isEligibleTrade(t));
  return dedupeByTicket(eligible);
}

/** Port of server.py:2693 `_period_summary_dict`. */
export async function periodSummaryDict(period: PerformancePeriod): Promise<Record<string, unknown>> {
  const trades = await fetchPeriodTrades(period);
  const scope = period.scope ?? {};
  const beTolerance = scope.break_even_tolerance_usd ?? DEFAULT_BREAK_EVEN_TOLERANCE_USD;
  const minimumSample = scope.minimum_sample ?? DEFAULT_MINIMUM_SAMPLE;
  const stats = computePeriodStats(trades, beTolerance, minimumSample);
  const d = periodStatsToDict(stats);
  const release = await currentEaRelease();
  return {
    ...d,
    source: "live_journal",
    verification: "first_party_ea_journal",
    independently_verified: false,
    drawdown_label: "Max Balance Drawdown",
    period_id: period.id,
    period_name: period.name,
    period_status: period.status,
    epoch_started_at: period.epoch_started_at,
    epoch_ended_at: period.epoch_ended_at,
    ea_version: release?.version ?? "",
    recalculated_at: new Date().toISOString(),
    recent_trades: buildRecentTrades(trades, beTolerance, 20),
  };
}
