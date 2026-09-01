import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { normalizeLicenseKey, resolveMonitorLicense } from "../services/license.js";
import { rateLimit } from "../auth.js";
import { TradeJournalEntrySchema, WeeklyReportEntrySchema } from "../models/journal.js";
import { reconcileTradeJournalEntry } from "../services/automatedTradeReconciliation.js";
import { canonicalTradeIdentity, classifyTrade, dedupeByTradeIdentity, netResult } from "../services/performanceEngine.js";
import { authoritativeExitPrice, enqueueFinalTradeForXPost } from "../services/xTradePosting.js";
import { buildBotTradeObservation, recordGlobalBrainObservation } from "../services/globalBrainIngest.js";

export const MAX_JOURNAL_TRADES_PAGE_SIZE = 200;

export function clampJournalTradesLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit), MAX_JOURNAL_TRADES_PAGE_SIZE));
}

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
      const isClosedTrade = Boolean(doc["has_rich_ledger_data"]) && Number(doc["closed_at"] ?? 0) > 0;
      if (isClosedTrade) {
        doc["trade_identity"] = canonicalTradeIdentity(doc);
        // `price` is the existing EA's broker DEAL_PRICE close field. Preserve
        // it as the explicit authoritative exit price before queueing/posting;
        // never substitute a strategy target or a frontend-derived value.
        const actualExitPrice = authoritativeExitPrice(doc);
        if (Number.isFinite(actualExitPrice) && actualExitPrice > 0) doc["actual_exit_price"] = actualExitPrice;
      }
      let journalWrite: { upsertedCount: number } = { upsertedCount: 1 };
      if (isClosedTrade) {
        try {
          journalWrite = await db.collection("trade_journal").updateOne(
            { trade_identity: doc["trade_identity"] },
            { $setOnInsert: doc },
            { upsert: true },
          );
        } catch (error) {
          // Concurrent retries can race; the unique account+ticket identity
          // makes the loser an idempotent success.
          if ((error as { code?: number }).code === 11000) return { status: "ok", duplicate: true };
          throw error;
        }
      } else {
        await db.collection("trade_journal").insertOne(doc);
      }

      // A retried close report is already persisted and reconciled. Keep the
      // endpoint idempotently successful without repeating side effects.
      if (journalWrite.upsertedCount === 0) return { status: "ok", duplicate: true };

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

        // v6.27.9 ShadowML: join this closed trade back to whichever pending
        // shadow observation (same signature, most recent, not yet joined)
        // this trade actually came from -- lets the admin shadow-stats view
        // measure real outcomes, not just verdict counts. Best-effort, never
        // affects this endpoint's own success response; a trade with no
        // matching shadow observation (e.g. from before this build) simply
        // matches nothing here.
        let joinedShadowDoc: Record<string, unknown> | null = null;
        try {
          const outcome = entry.result === "WIN" ? "WIN" : entry.result === "LOSS" ? "LOSS" : "BREAKEVEN";
          joinedShadowDoc = await db.collection("ml_shadow_decisions").findOneAndUpdate(
            { signature: entry.signature, actual_action: "CANDIDATE", eventual_result: { $exists: false } },
            {
              $set: {
                actual_action: "EXECUTED",
                eventual_result: outcome,
                profit: entry.profit,
                trade_id: doc["trade_identity"],
                joined_at: new Date().toISOString(),
              },
            },
            { sort: { decision_time_utc: -1 } },
          );
        } catch {
          /* best-effort */
        }

        // Global Learning Brain: build the unified observation from this
        // now-closed, now-durably-persisted trade (which already carries
        // the EA's own real R-multiple outcome -- final_r/mae_r/mfe_r, see
        // models/journal.ts) plus whichever pre-decision ShadowML features
        // were just joined above. Best-effort, never affects this
        // endpoint's response -- see globalBrainIngest.ts's shadow-only
        // boundary comment.
        if (isClosedTrade) {
          try {
            await recordGlobalBrainObservation(buildBotTradeObservation(doc, joinedShadowDoc));
          } catch {
            /* best-effort -- a build failure here must never turn an already-persisted trade close into an error response */
          }
        }
      }

      // Real-time Outlook signal reconciliation -- matches this closed trade
      // against any awaiting outlook signal for the same account/symbol/
      // direction, so the customer sees the confirmed automated result
      // within seconds of MT5 reporting the close (rather than waiting for
      // the hourly Outlook job). Strictly best-effort: never affects this
      // endpoint's own success response.
      if (isClosedTrade) {
        // Reconcile the canonical stored row, never the untrusted request
        // object. Both side effects below are explicitly best-effort: once
        // the write succeeds, this endpoint must remain successful for EA
        // retries, and one side effect failing must never block the other.
        const stored = await db
          .collection("trade_journal")
          .findOne({ trade_identity: doc["trade_identity"] }, { projection: { _id: 0 } })
          .catch(() => null);
        if (stored) {
          try {
            await reconcileTradeJournalEntry(stored);
          } catch {
            request.log.warn("journal reconciliation failed after a persisted trade");
          }
          // X auto-post eligibility is decided later by the queue processor
          // (auto_post_enabled + post_wins/post_losses/post_breakeven); this
          // only makes the authenticated final close visible to that check.
          // enqueueFinalTradeForXPost is itself idempotent on closed_trade_id,
          // so a retried close event can never create a duplicate queue entry.
          request.log.info({ closed_trade_id: doc["trade_identity"] }, "[x-posting] final closed trade received; queuing for auto-post eligibility check");
          try {
            await enqueueFinalTradeForXPost(stored);
          } catch (error) {
            request.log.warn({ error, closed_trade_id: doc["trade_identity"] }, "[x-posting] failed to queue closed trade for X posting");
          }
        }
      }

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
      // Limit is pagination only. Every summary value below is computed from
      // the complete canonical account-scoped journal dataset.
      const canonical = dedupeByTradeIdentity(
        await journal.find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray(),
      );
      const trades = canonical.slice(0, clampJournalTradesLimit(q.limit));
      const total = canonical.length;
      const outcomes = canonical.map((trade) => classifyTrade(trade));
      const winTrades = outcomes.filter((outcome) => outcome === "WIN").length;
      const lossTrades = outcomes.filter((outcome) => outcome === "LOSS").length;
      const breakEvenTrades = outcomes.filter((outcome) => outcome === "BE").length;
      const totalProfit = canonical.reduce((sum, trade) => sum + netResult(trade), 0);

      const hourStats: Record<number, { wins: number; losses: number; profit: number }> = {};
      for (const t of canonical) {
        const h = Number(t["hour"] ?? 0);
        hourStats[h] ??= { wins: 0, losses: 0, profit: 0 };
        hourStats[h].profit += netResult(t);
        if (classifyTrade(t) === "WIN") hourStats[h].wins += 1;
        else if (classifyTrade(t) === "LOSS") hourStats[h].losses += 1;
      }
      const hourKeys = Object.keys(hourStats).map(Number);
      const bestHour = hourKeys.length ? hourKeys.reduce((best, h) => (hourStats[h]!.profit > hourStats[best]!.profit ? h : best)) : 0;
      const worstHour = hourKeys.length ? hourKeys.reduce((worst, h) => (hourStats[h]!.profit < hourStats[worst]!.profit ? h : worst)) : 0;

      return {
        trades,
        total,
        wins: winTrades,
        losses: lossTrades,
        break_even: breakEvenTrades,
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
