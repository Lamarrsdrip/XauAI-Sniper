import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getDb } from "../db.js";
import { buildResultConversion } from "../services/marketOutlookCore.js";
import { classifyTrade, netResult } from "../services/performanceEngine.js";
import { fetchPeriodTrades, getActivePerformancePeriod, periodSummaryDict, type PerformancePeriod } from "../services/performancePeriods.js";

const GOLD_REPLAY_PATH = path.join(process.cwd(), "data", "gold_replay_current.json");

/** Port of server.py's public /performance/* routes (lines 2723-2877). */
export async function registerPerformanceRoutes(app: FastifyInstance): Promise<void> {
  // GET /performance/summary -- server.py:2723
  app.get("/performance/summary", async () => {
    let period: PerformancePeriod | null;
    try {
      period = await getActivePerformancePeriod();
    } catch (e) {
      app.log.error(`Performance summary error (period lookup): ${String(e)}`);
      return { status: "unavailable" };
    }
    if (!period) return { status: "unavailable" };
    let d: Record<string, unknown>;
    try {
      d = await periodSummaryDict(period);
    } catch (e) {
      app.log.error(`Performance summary error (calculation): ${String(e)}`);
      return { status: "unavailable" };
    }
    d["status"] = d["sufficient_data"] ? "active" : "collecting";
    return d;
  });

  // GET /performance/full -- server.py:2754
  app.get("/performance/full", async (request) => {
    const q = z.object({ period_id: z.string().nullable().optional() }).parse(request.query);
    const period = q.period_id
      ? ((await getDb().collection("performance_periods").findOne({ id: q.period_id }, { projection: { _id: 0 } })) as PerformancePeriod | null)
      : await getActivePerformancePeriod();
    if (!period) return { status: "unavailable" };
    const d = await periodSummaryDict(period);
    d["status"] = d["sufficient_data"] ? "active" : "collecting";
    return d;
  });

  // GET /performance/daily-results -- server.py:2770
  app.get("/performance/daily-results", async (request) => {
    const q = z.object({ days: z.coerce.number().int().optional().default(30) }).parse(request.query);
    const days = Math.max(1, Math.min(q.days, 90));
    const period = await getActivePerformancePeriod();
    if (!period) return { status: "unavailable", days: [] };

    const trades = await fetchPeriodTrades(period);
    const cutoffUnix = Date.now() / 1000 - days * 86400;
    const recent = trades.filter((t) => Number(t["closed_at"] ?? t["opened_at"] ?? 0) >= cutoffUnix);

    interface DayBucket {
      date: string;
      trades: number;
      wins: number;
      losses: number;
      breakeven: number;
      net_pips: number;
      net_gold_moves: number;
      net_r: number;
      net_usd: number;
    }
    const byDay = new Map<string, DayBucket>();
    for (const t of recent) {
      const closedAt = Number(t["closed_at"] ?? t["opened_at"] ?? 0);
      if (closedAt <= 0) continue;
      const dateStr = new Date(closedAt * 1000).toISOString().slice(0, 10);
      const direction = String(t["direction"] ?? "").toUpperCase();
      const entry = Number(t["entry_price"] ?? 0);
      const exitPrice = Number(t["price"] ?? 0);
      let priceMove: number | null = null;
      if (entry > 0 && exitPrice > 0 && (direction === "BUY" || direction === "SELL")) {
        priceMove = direction === "BUY" ? exitPrice - entry : entry - exitPrice;
      }
      const conversion = buildResultConversion({ r: Number(t["final_r"] ?? 0) || null, price_move: priceMove });
      const netUsd = Math.round(netResult(t) * 100) / 100;
      const outcome = classifyTrade(t);

      let day = byDay.get(dateStr);
      if (!day) {
        day = { date: dateStr, trades: 0, wins: 0, losses: 0, breakeven: 0, net_pips: 0, net_gold_moves: 0, net_r: 0, net_usd: 0 };
        byDay.set(dateStr, day);
      }
      day.trades += 1;
      if (outcome === "WIN") day.wins += 1;
      else if (outcome === "LOSS") day.losses += 1;
      else day.breakeven += 1;
      if (conversion.result_pips !== null) day.net_pips = Math.round((day.net_pips + conversion.result_pips) * 10) / 10;
      if (conversion.result_gold_moves !== null) day.net_gold_moves = Math.round((day.net_gold_moves + conversion.result_gold_moves) * 100) / 100;
      if (conversion.result_r !== null) day.net_r = Math.round((day.net_r + conversion.result_r) * 100) / 100;
      day.net_usd = Math.round((day.net_usd + netUsd) * 100) / 100;
    }

    const daysList = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
    const round2 = (n: number): number => Math.round(n * 100) / 100;
    const totals = {
      trades: daysList.reduce((s, d) => s + d.trades, 0),
      wins: daysList.reduce((s, d) => s + d.wins, 0),
      losses: daysList.reduce((s, d) => s + d.losses, 0),
      net_pips: round2(daysList.reduce((s, d) => s + d.net_pips, 0)),
      net_gold_moves: round2(daysList.reduce((s, d) => s + d.net_gold_moves, 0)),
      net_r: round2(daysList.reduce((s, d) => s + d.net_r, 0)),
      net_usd: round2(daysList.reduce((s, d) => s + d.net_usd, 0)),
    };
    return { status: "ok", days_requested: days, period_id: period.id, period_name: period.name, days: daysList, totals };
  });

  // GET /performance/gold-replay -- server.py:2839. Served as-is from a
  // checked-in snapshot generated from a real MT5 Strategy Tester replay --
  // never computed here.
  app.get("/performance/gold-replay", async () => {
    if (!existsSync(GOLD_REPLAY_PATH)) return { status: "unavailable" };
    try {
      const data = JSON.parse(await readFile(GOLD_REPLAY_PATH, "utf8")) as Record<string, unknown>;
      data["status"] = "ok";
      return data;
    } catch (e) {
      app.log.error(`gold_replay_current.json read failed: ${String(e)}`);
      return { status: "unavailable" };
    }
  });

  // GET /performance/historical -- server.py:2862
  app.get("/performance/historical", async () => {
    const periods = (await getDb()
      .collection("performance_periods")
      .find({ status: "ARCHIVED" }, { projection: { _id: 0 } })
      .sort({ epoch_started_at: 1 })
      .limit(200)
      .toArray()) as unknown as PerformancePeriod[];
    const results: Record<string, unknown>[] = [];
    for (const period of periods) {
      try {
        results.push(await periodSummaryDict(period));
      } catch (e) {
        app.log.error(`Historical performance error for period ${period.id}: ${String(e)}`);
      }
    }
    return { periods: results };
  });
}
