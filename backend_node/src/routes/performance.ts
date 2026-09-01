import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getDb } from "../db.js";
import { getNetworkDailyResults } from "../services/networkDailyResults.js";
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
    return getNetworkDailyResults(q.days);
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
