import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { normalizeLicenseKey, resolveMonitorLicense } from "../services/license.js";
import { rateLimit } from "../auth.js";
import { TradeJournalEntrySchema, WeeklyReportEntrySchema } from "../models/journal.js";

/** Port of Python's `datetime.now(timezone.utc).strftime("%Y-W%W")` -- Monday-first week number, week 0 = days before the year's first Monday. */
function pythonYearWeek(date: Date): string {
  const jan1 = Date.UTC(date.getUTCFullYear(), 0, 1);
  const jan1Dow = (new Date(jan1).getUTCDay() + 6) % 7; // Monday=0..Sunday=6
  const dayOfYear = Math.floor((date.getTime() - jan1) / 86_400_000);
  const week = Math.floor((dayOfYear + jan1Dow) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Port of server.py journal/* endpoints (lines 5522-5764). */
export async function registerJournalRoutes(app: FastifyInstance): Promise<void> {
  // POST /journal/log -- server.py:5522 (EA-consumed)
  app.post("/journal/log", async (request) => {
    const entry = TradeJournalEntrySchema.parse(request.body);
    if (!entry.account_login) return { status: "error", detail: "account_login is required" };

    let lic;
    try {
      lic = await resolveMonitorLicense(entry.pin, entry.account_login);
    } catch {
      return { status: "error", detail: "Invalid or inactive license." };
    }

    // Not wrapped in try/catch -- matches server.py:5546, where
    // _rate_limit()'s HTTPException(429) is deliberately NOT caught by the
    // surrounding {"status":"error"} contract and propagates as a real 429.
    rateLimit(`journal_log_pin:${entry.pin}`, 60, 300);

    try {
      const { pin: _pin, ...rest } = entry;
      const db = getDb();
      const doc: Record<string, unknown> = { ...rest };
      doc["license_id"] = lic?.["id"] ?? "";
      doc["created_at"] = new Date().toISOString();
      doc["created_ts"] = Date.now() / 1000;
      doc["win_rate"] = entry.total_trades > 0 ? Math.round((entry.wins / entry.total_trades) * 1000) / 10 : 0;
      doc["has_rich_ledger_data"] = entry.ticket > 0;
      await db.collection("trade_journal").insertOne({ ...doc });

      if (entry.signature) {
        try {
          await db.collection("hive_signatures").insertOne({
            signature: entry.signature,
            license_id: lic?.["id"] ?? "",
            symbol: entry.symbol,
            result: entry.result,
            profit: entry.profit,
            created_ts: Date.now() / 1000,
            created_at: new Date().toISOString(),
          });
        } catch {
          /* best-effort, matches Python's logged-but-swallowed exception */
        }
      }

      // NOTE: Python calls market_outlook.reconcile_trade_journal_entry(doc)
      // here for real-time Outlook signal reconciliation when
      // has_rich_ledger_data && closed_at > 0. Deferred until the Market
      // Outlook engine itself is ported (NODE_MIGRATION_AUDIT.md Phase 3-4)
      // -- Python treats this as strictly best-effort and never lets it
      // affect this endpoint's own success response, so omitting it for now
      // does not change /journal/log's own behavior, only defers when
      // Outlook signals get reconciled (the existing hourly Outlook job
      // still catches it later once that engine is live here).

      return { status: "ok" };
    } catch {
      return { status: "error" };
    }
  });

  // GET /journal/trades -- server.py:5669
  app.get("/journal/trades", async (request) => {
    const q = z.object({ pin: z.string().optional().default(""), limit: z.coerce.number().optional().default(50) }).parse(request.query);
    const lic = await resolveMonitorLicense(q.pin, "");
    try {
      const db = getDb();
      const journal = db.collection("trade_journal");
      const query = { $or: [{ license_id: lic?.["id"] ?? "" }, { pin: normalizeLicenseKey(q.pin) }] };
      const trades = await journal.find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(q.limit).toArray();
      const total = await journal.countDocuments(query);
      const winTrades = await journal.countDocuments({ ...query, result: "WIN" });
      const lossTrades = await journal.countDocuments({ ...query, result: "LOSS" });
      const totalProfit = trades.reduce((s, t) => s + Number(t["profit"] ?? 0), 0);

      const hourStats: Record<number, { wins: number; losses: number; profit: number }> = {};
      const allTrades = await journal.find(query, { projection: { _id: 0, hour: 1, profit: 1, result: 1 } }).limit(500).toArray();
      for (const t of allTrades) {
        const h = Number(t["hour"] ?? 0);
        hourStats[h] ??= { wins: 0, losses: 0, profit: 0 };
        hourStats[h].profit += Number(t["profit"] ?? 0);
        if (t["result"] === "WIN") hourStats[h].wins += 1;
        else hourStats[h].losses += 1;
      }
      const hourKeys = Object.keys(hourStats).map(Number);
      const bestHour = hourKeys.length ? hourKeys.reduce((best, h) => (hourStats[h]!.profit > hourStats[best]!.profit ? h : best)) : 0;
      const worstHour = hourKeys.length ? hourKeys.reduce((worst, h) => (hourStats[h]!.profit < hourStats[worst]!.profit ? h : worst)) : 0;

      return {
        trades,
        total,
        wins: winTrades,
        losses: lossTrades,
        win_rate: total > 0 ? Math.round((winTrades / total) * 1000) / 10 : 0,
        total_profit: Math.round(totalProfit * 100) / 100,
        best_hour: bestHour,
        worst_hour: worstHour,
        hour_stats: hourStats,
      };
    } catch {
      return { trades: [], total: 0, wins: 0, losses: 0 };
    }
  });

  // POST /journal/weekly-report -- server.py:5726
  app.post("/journal/weekly-report", async (request, reply) => {
    const entry = WeeklyReportEntrySchema.parse(request.body);
    if (!entry.account_id) return reply.code(400).send({ detail: "account_id is required" });
    const lic = await resolveMonitorLicense(entry.pin, entry.account_id);
    try {
      const { pin: _pin, ...rest } = entry;
      const doc: Record<string, unknown> = { ...rest };
      doc["license_id"] = lic?.["id"] ?? "";
      doc["created_at"] = new Date().toISOString();
      doc["week"] = pythonYearWeek(new Date());
      await getDb().collection("weekly_reports").insertOne({ ...doc });
      return { status: "ok" };
    } catch {
      return { status: "error" };
    }
  });

  // GET /journal/weekly-reports -- server.py:5743
  app.get("/journal/weekly-reports", async (request) => {
    const q = z.object({ pin: z.string().optional().default(""), limit: z.coerce.number().optional().default(12) }).parse(request.query);
    const lic = await resolveMonitorLicense(q.pin, "");
    try {
      const query = { $or: [{ license_id: lic?.["id"] ?? "" }, { pin: normalizeLicenseKey(q.pin) }] };
      const reports = await getDb()
        .collection("weekly_reports")
        .find(query, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .limit(q.limit)
        .toArray();
      return { reports };
    } catch {
      return { reports: [] };
    }
  });
}
