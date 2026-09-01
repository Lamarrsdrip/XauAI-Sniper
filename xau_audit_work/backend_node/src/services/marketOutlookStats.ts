import { ANALYTICS_BREAKEVEN, ANALYTICS_LOSS, ANALYTICS_PARTIAL, ANALYTICS_TERMINAL_OUTCOMES, ANALYTICS_UNAVAILABLE, ANALYTICS_WIN, buildResultConversion } from "./marketOutlookCore.js";

type OutlookRow = Record<string, unknown>;

/** Port of market_outlook_routes.py:25 `group_meaningful_history` -- keeps signal lifecycle rows, collapses repetitive informational noise. */
export function groupMeaningfulHistory(rows: OutlookRow[]): OutlookRow[] {
  const grouped: OutlookRow[] = [];
  const buckets = new Map<string, OutlookRow>();
  for (const row of rows) {
    const directional = ["BUY", "SELL"].includes(String(row["primary_direction"]));
    if (directional || [ANALYTICS_WIN, ANALYTICS_LOSS].includes(String(row["analytics_outcome"]))) {
      grouped.push(row);
      continue;
    }
    const stamp = String(row["generated_at"] ?? row["published_at"] ?? "");
    const day = stamp.slice(0, 10);
    const reason = row["no_valid_outlook_reason"] ?? row["primary_direction"] ?? "INFORMATIONAL";
    const key = `${day}|${reason}`;
    const existing = buckets.get(key);
    if (!existing) {
      const collapsed: OutlookRow = { ...row, collapsed_count: 1, history_kind: "INFORMATIONAL_GROUP" };
      buckets.set(key, collapsed);
      grouped.push(collapsed);
    } else {
      existing["collapsed_count"] = Number(existing["collapsed_count"] ?? 1) + 1;
    }
  }
  return grouped;
}

/** Port of market_outlook_routes.py:49 `compute_outlook_stats` -- derives performance only from persisted authoritative outcomes. */
export function computeOutlookStats(rows: OutlookRow[]): Record<string, unknown> {
  const statsRows = rows.filter((o) => !o["excluded_from_stats"]);
  const unavailable = statsRows.filter((o) => o["historical_repair_status"] === ANALYTICS_UNAVAILABLE || o["analytics_outcome"] === ANALYTICS_UNAVAILABLE);
  const unavailableSet = new Set(unavailable);
  const actionable = statsRows.filter(
    (o) => ["BUY", "SELL"].includes(String(o["primary_direction"])) && !o["excluded_from_signal_analytics"] && !unavailableSet.has(o),
  );
  const completed = actionable.filter((o) => ANALYTICS_TERMINAL_OUTCOMES.has(String(o["analytics_outcome"])));
  const wins = completed.filter((o) => o["analytics_outcome"] === ANALYTICS_WIN);
  const losses = completed.filter((o) => o["analytics_outcome"] === ANALYTICS_LOSS);
  const partialProfits = completed.filter((o) => o["analytics_outcome"] === ANALYTICS_PARTIAL);
  const breakevens = completed.filter((o) => o["analytics_outcome"] === ANALYTICS_BREAKEVEN);
  const activeUnresolved = actionable.filter((o) => o["analytics_outcome"] === null || o["analytics_outcome"] === undefined);
  const informational = statsRows.filter((o) => !["BUY", "SELL"].includes(String(o["primary_direction"])));
  const tp1Count = completed.filter((o) => (Number(o["highest_tp_reached"]) || 0) >= 1).length;
  const tp2Count = completed.filter((o) => (Number(o["highest_tp_reached"]) || 0) >= 2).length;
  const tp3Count = completed.filter((o) => (Number(o["highest_tp_reached"]) || 0) >= 3).length;
  const resolvedRs = completed.map((o) => o["analytics_r"]).filter((v) => v !== null && v !== undefined).map(Number);
  const winRate = wins.length || losses.length ? Math.round((wins.length / (wins.length + losses.length)) * 1000) / 1000 : null;
  const winRs = wins.map((o) => o["analytics_r"]).filter((v) => v !== null && v !== undefined).map(Number);
  const lossRs = losses.map((o) => o["analytics_r"]).filter((v) => v !== null && v !== undefined).map(Number);
  const grossWin = winRs.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(lossRs.reduce((a, b) => a + b, 0));

  const pipsOf = (o: OutlookRow, key: string): number | null => {
    const val = o[key];
    if (val === null || val === undefined) return null;
    return buildResultConversion({ r: Number(val), risk_distance: o["risk_distance"] as number | null }).result_pips;
  };
  const resolvedPips = completed.map((o) => pipsOf(o, "analytics_r")).filter((p): p is number => p !== null);
  const winPips = wins.map((o) => pipsOf(o, "analytics_r")).filter((p): p is number => p !== null);
  const lossPips = losses.map((o) => pipsOf(o, "analytics_r")).filter((p): p is number => p !== null);
  const actionableMfePips = actionable.map((o) => pipsOf(o, "mfe_r")).filter((p): p is number => p !== null);
  const actionableMaePips = actionable.map((o) => pipsOf(o, "mae_r")).filter((p): p is number => p !== null);

  const avg = (arr: number[]): number | null => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const round = (v: number | null, d: number): number | null => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

  return {
    total_outlooks: statsRows.length,
    actionable_outlooks: actionable.length,
    activated_outlooks: actionable.length,
    informational_outlooks: informational.length,
    green_results: wins.length,
    red_results: losses.length,
    no_entry_results: 0,
    tp1_hit_rate: completed.length ? Math.round((tp1Count / completed.length) * 1000) / 1000 : 0,
    tp2_hit_rate: completed.length ? Math.round((tp2Count / completed.length) * 1000) / 1000 : 0,
    tp3_hit_rate: completed.length ? Math.round((tp3Count / completed.length) * 1000) / 1000 : 0,
    average_r: round(avg(resolvedRs), 3),
    average_mfe: round(
      avg(actionable.map((o) => Number(o["mfe_r"] ?? 0) || 0)),
      3,
    ),
    average_mae: round(
      avg(actionable.map((o) => Number(o["mae_r"] ?? 0) || 0)),
      3,
    ),
    resolved_count: completed.length,
    wins: wins.length,
    losses: losses.length,
    partial_profits: partialProfits.length,
    breakeven: breakevens.length,
    no_entry_count: 0,
    active_unresolved_count: activeUnresolved.length,
    unavailable_historical_count: unavailable.length,
    win_rate: winRate,
    total_r: resolvedRs.length ? round(resolvedRs.reduce((a, b) => a + b, 0), 3) : 0.0,
    average_win_r: round(avg(winRs), 3),
    average_loss_r: round(avg(lossRs), 3),
    total_pips: resolvedPips.length ? round(resolvedPips.reduce((a, b) => a + b, 0), 1) : 0.0,
    average_pips: round(avg(resolvedPips), 1),
    average_win_pips: round(avg(winPips), 1),
    average_loss_pips: round(avg(lossPips), 1),
    average_mfe_pips: round(avg(actionableMfePips), 1),
    average_mae_pips: round(avg(actionableMaePips), 1),
    profit_factor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 1000) / 1000 : null,
    best_result_r: resolvedRs.length ? Math.max(...resolvedRs) : null,
    worst_result_r: resolvedRs.length ? Math.min(...resolvedRs) : null,
    best_result_pips: resolvedPips.length ? Math.max(...resolvedPips) : null,
    worst_result_pips: resolvedPips.length ? Math.min(...resolvedPips) : null,
  };
}

/** Port of market_outlook_routes.py:136 `_outlook_to_signal_card`. */
function outlookToSignalCard(row: OutlookRow): Record<string, unknown> {
  const conversion = buildResultConversion({ r: row["analytics_r"] as number | null, risk_distance: row["risk_distance"] as number | null });
  const outcome = row["analytics_outcome"] ?? "LOSS";
  return {
    id: row["id"],
    direction: row["primary_direction"],
    closed_at: row["classification_at"],
    entry_price: row["tracking_entry_price"],
    stop_loss: row["original_sl"] ?? row["suggested_sl"],
    take_profit_1: row["tp1_price"],
    result: outcome,
    confidence_pct: row["confidence_pct"],
    setup_type: row["setup_type"],
    highest_tp_reached: row["highest_tp_reached"],
    ...conversion,
  };
}

/** Port of market_outlook_routes.py:159 `build_public_outlook_performance` -- unauthenticated public marketing-site feed. */
export async function buildPublicOutlookPerformance(db: import("mongodb").Db, limit = 10): Promise<Record<string, unknown>> {
  const query = {
    primary_direction: { $in: ["BUY", "SELL"] },
    analytics_outcome: { $in: Array.from(ANALYTICS_TERMINAL_OUTCOMES) },
    excluded_from_stats: { $ne: true },
    excluded_from_signal_analytics: { $ne: true },
  };
  const allRows = await db
    .collection("cloud_market_outlooks")
    .find(query, { projection: { _id: 0 } })
    .sort({ classification_at: -1 })
    .toArray();

  let totalPips = 0;
  let totalGoldMoves = 0;
  let wins = 0;
  let losses = 0;
  let partialProfits = 0;
  let breakevens = 0;
  const rs: number[] = [];
  const winRs: number[] = [];
  const lossRs: number[] = [];
  const pipsList: number[] = [];
  const winPips: number[] = [];
  const lossPips: number[] = [];

  for (const row of allRows) {
    const conversion = buildResultConversion({ r: row["analytics_r"] as number | null, risk_distance: row["risk_distance"] as number | null });
    const outcome = row["analytics_outcome"];
    const isWin = outcome === ANALYTICS_WIN;
    if (isWin) wins += 1;
    else if (outcome === ANALYTICS_LOSS) losses += 1;
    else if (outcome === ANALYTICS_PARTIAL) partialProfits += 1;
    else if (outcome === ANALYTICS_BREAKEVEN) breakevens += 1;

    if (conversion.result_r !== null) {
      rs.push(conversion.result_r);
      if (isWin) winRs.push(conversion.result_r);
      else if (outcome === ANALYTICS_LOSS) lossRs.push(conversion.result_r);
    }
    if (conversion.result_pips !== null) {
      totalPips += conversion.result_pips;
      pipsList.push(conversion.result_pips);
      if (isWin) winPips.push(conversion.result_pips);
      else if (outcome === ANALYTICS_LOSS) lossPips.push(conversion.result_pips);
    }
    if (conversion.result_gold_moves !== null) totalGoldMoves += conversion.result_gold_moves;
  }

  const signals = allRows.slice(0, limit).map(outlookToSignalCard);

  const cumulativeRCurve: { closed_at: unknown; cumulative_r: number }[] = [];
  let running = 0;
  for (const row of [...allRows].reverse()) {
    const conversion = buildResultConversion({ r: row["analytics_r"] as number | null, risk_distance: row["risk_distance"] as number | null });
    if (conversion.result_r === null) continue;
    running = Math.round((running + conversion.result_r) * 10000) / 10000;
    cumulativeRCurve.push({ closed_at: row["classification_at"], cumulative_r: running });
  }

  const winRate = wins + losses ? Math.round((wins / (wins + losses)) * 1000) / 1000 : null;
  const totalCount = wins + losses + partialProfits + breakevens;
  const avg = (arr: number[]): number | null => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const round = (v: number | null, d: number): number | null => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

  return {
    signals,
    cumulative_r_curve: cumulativeRCurve,
    stats: {
      count: totalCount,
      wins,
      losses,
      partial_profits: partialProfits,
      breakevens,
      win_rate: winRate,
      total_r: rs.length ? round(rs.reduce((a, b) => a + b, 0), 2) : null,
      average_r: round(avg(rs), 2),
      total_pips: totalCount ? round(totalPips, 1) : null,
      average_pips: round(avg(pipsList), 1),
      total_gold_moves: totalCount ? round(totalGoldMoves, 2) : null,
      average_win_r: round(avg(winRs), 2),
      average_loss_r: round(avg(lossRs), 2),
      best_trade_r: rs.length ? Math.max(...rs) : null,
      worst_trade_r: rs.length ? Math.min(...rs) : null,
      average_win_pips: round(avg(winPips), 1),
      average_loss_pips: round(avg(lossPips), 1),
      best_trade_pips: pipsList.length ? Math.max(...pipsList) : null,
      worst_trade_pips: pipsList.length ? Math.min(...pipsList) : null,
    },
  };
}
