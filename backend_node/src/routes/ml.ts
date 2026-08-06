import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { requireAdmin } from "../auth.js";
import { resolveMonitorLicense } from "../services/license.js";

const HiveScoreRequestSchema = z.object({ signature: z.string().optional().default(""), window_days: z.number().optional().default(7) });
const PatternDataSchema = z.object({
  pin: z.string().optional().default(""),
  account_id: z.string().optional().default(""),
  symbol: z.string().optional().default("XAUUSD"),
  patterns: z.array(z.unknown()).optional().default([]),
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Port of server.py:3835-3910 (retired ML endpoints), :5595 hive score, :5764/5782 pattern save/load, :3910 admin ML stats. */
export async function registerMlRoutes(app: FastifyInstance): Promise<void> {
  // Retired endpoints -- server.py:3835,3847,3853 (v6.25.4 owner directive, no EA caller, unsegmented global collection)
  app.post("/ml/submit-pattern", async (_request, reply) => reply.code(410).send({ detail: "This endpoint is retired." }));
  app.post("/ml/get-confidence", async (_request, reply) => reply.code(410).send({ detail: "This endpoint is retired." }));
  app.get("/ml/stats", async (_request, reply) => reply.code(410).send({ detail: "This endpoint is retired." }));

  // GET /admin/ml/stats -- server.py:3910
  app.get("/admin/ml/stats", { preHandler: requireAdmin }, async () => {
    const db = getDb();
    const patterns = db.collection("ml_patterns");
    const total = await patterns.countDocuments({});
    if (total === 0) {
      return {
        total_patterns: 0,
        global_win_rate: 0,
        contributors: 0,
        strategies: {},
        hourly_performance: [],
        message: "No patterns yet. As users trade, the AI gets smarter.",
        recent_patterns: [],
      };
    }
    const wins = await patterns.countDocuments({ was_winner: true });
    const contributors = (await patterns.distinct("pin")).length;

    const strategyNames: Record<number, string> = { 0: "Trend", 1: "Range", 2: "Breakout" };
    const strategies: Record<string, { trades: number; win_rate: number }> = {};
    const strategyAgg = await patterns
      .aggregate<{ _id: { strategy: number; was_winner: boolean }; count: number }>([
        { $group: { _id: { strategy: "$strategy", was_winner: "$was_winner" }, count: { $sum: 1 } } },
      ])
      .toArray();
    const strategyData = new Map<number, { total: number; wins: number }>();
    for (const r of strategyAgg) {
      const sid = r._id.strategy;
      const entry = strategyData.get(sid) ?? { total: 0, wins: 0 };
      entry.total += r.count;
      if (r._id.was_winner) entry.wins += r.count;
      strategyData.set(sid, entry);
    }
    for (const [sid, sname] of Object.entries(strategyNames)) {
      const data = strategyData.get(Number(sid));
      if (data && data.total > 0) {
        strategies[sname] = { trades: data.total, win_rate: Math.round((data.wins / data.total) * 1000) / 10 };
      }
    }

    const hourly: { hour: number; trades: number; win_rate: number }[] = [];
    const hourAgg = await patterns
      .aggregate<{ _id: { hour: number; winner: boolean }; count: number }>([
        { $group: { _id: { hour: "$hour_of_day", winner: "$was_winner" }, count: { $sum: 1 } } },
      ])
      .toArray();
    const hourData = new Map<number, { total: number; wins: number }>();
    for (const r of hourAgg) {
      const h = r._id.hour;
      const entry = hourData.get(h) ?? { total: 0, wins: 0 };
      entry.total += r.count;
      if (r._id.winner) entry.wins += r.count;
      hourData.set(h, entry);
    }
    for (const h of Array.from(hourData.keys()).sort((a, b) => a - b)) {
      const data = hourData.get(h)!;
      if (data.total >= 3) {
        hourly.push({ hour: h, trades: data.total, win_rate: Math.round((data.wins / data.total) * 1000) / 10 });
      }
    }

    const recent = await patterns
      .find({}, { projection: { _id: 0, market_state: 1, strategy: 1, was_winner: 1, created_at: 1, confidence: 1 } })
      .sort({ created_at: -1 })
      .limit(20)
      .toArray();

    return {
      total_patterns: total,
      global_win_rate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
      contributors,
      strategies,
      hourly_performance: hourly,
      recent_patterns: recent,
    };
  });

  // POST /ml/hive/score -- server.py:5595
  app.post("/ml/hive/score", async (request) => {
    const req = HiveScoreRequestSchema.parse(request.body);
    try {
      if (!req.signature) return { wins: 0, losses: 0, total: 0, wr: 0.5, verdict: "NONE", level: -1, matched_signature: "" };
      const window = Math.max(1, Math.trunc(req.window_days));
      const cutoff = Date.now() / 1000 - window * 86400;

      const parts = req.signature.split("|");
      if (parts.length !== 7) {
        return { wins: 0, losses: 0, total: 0, wr: 0.5, verdict: "NONE", level: -1, matched_signature: req.signature };
      }

      const rollups: [number, string, string][] = [
        [0, req.signature, "exact"],
        [1, parts.slice(0, 6).join("|"), "drop_mom"],
        [2, parts.slice(0, 5).join("|"), "drop_stoch"],
        [3, parts.slice(0, 4).join("|"), "drop_rsi"],
        [4, parts.slice(0, 3).join("|"), "drop_session"],
      ];

      const hive = getDb().collection("hive_signatures");
      for (const [level, sig, label] of rollups) {
        const filt: Record<string, unknown> =
          level === 0
            ? { signature: sig, created_ts: { $gte: cutoff } }
            : { signature: { $regex: `^${escapeRegex(sig)}\\|` }, created_ts: { $gte: cutoff } };
        const wins = await hive.countDocuments({ ...filt, result: "WIN" });
        const losses = await hive.countDocuments({ ...filt, result: "LOSS" });
        const total = wins + losses;
        if (total >= 5) {
          const wr = wins / total;
          let verdict: string;
          if (wr >= 0.6) verdict = "BOOST";
          else if (total >= 10 && wr <= 0.25) verdict = "VETO";
          else verdict = "NEUTRAL";
          return { wins, losses, total, wr: Math.round(wr * 1000) / 1000, verdict, level, label, matched_signature: sig, window_days: window };
        }
      }

      return { wins: 0, losses: 0, total: 0, wr: 0.5, verdict: "COLD_START", level: -1, matched_signature: req.signature, window_days: window };
    } catch {
      return { wins: 0, losses: 0, total: 0, wr: 0.5, verdict: "NONE", level: -1, matched_signature: "" };
    }
  });

  // POST /ml/patterns/save -- server.py:5764
  app.post("/ml/patterns/save", async (request, reply) => {
    const req = PatternDataSchema.parse(request.body);
    if (!req.account_id) return reply.code(400).send({ detail: "account_id is required" });
    const lic = await resolveMonitorLicense(req.pin, req.account_id);
    try {
      const ownerId = lic?.["id"] ?? "";
      const key = `${ownerId}_${req.symbol}`;
      await getDb()
        .collection("ml_cloud_patterns")
        .updateOne(
          { key },
          {
            $set: {
              key,
              license_id: ownerId,
              symbol: req.symbol,
              patterns: req.patterns,
              count: req.patterns.length,
              updated_at: new Date().toISOString(),
            },
          },
          { upsert: true },
        );
      return { status: "ok", saved: req.patterns.length };
    } catch {
      return { status: "error", saved: 0 };
    }
  });

  // POST /ml/patterns/load -- server.py:5782
  app.post("/ml/patterns/load", async (request, reply) => {
    const req = PatternDataSchema.parse(request.body);
    if (!req.account_id) return reply.code(400).send({ detail: "account_id is required" });
    const lic = await resolveMonitorLicense(req.pin, req.account_id);
    try {
      const key = `${lic?.["id"] ?? ""}_${req.symbol}`;
      const doc = await getDb().collection("ml_cloud_patterns").findOne({ key }, { projection: { _id: 0 } });
      const patterns = (doc?.["patterns"] as unknown[] | undefined) ?? [];
      return { status: "ok", patterns, count: patterns.length };
    } catch {
      return { status: "ok", patterns: [], count: 0 };
    }
  });
}
