import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin, verifyPassword } from "../../auth.js";
import { DEFAULT_BREAK_EVEN_TOLERANCE_USD, DEFAULT_MINIMUM_SAMPLE, computePeriodStats, periodStatsToDict } from "../../services/performanceEngine.js";
import { fetchPeriodTrades, getActivePerformancePeriod, type PerformancePeriod } from "../../services/performancePeriods.js";

const StartPerformancePeriodRequestSchema = z.object({
  name: z.string(),
  reason: z.string(),
  account_logins: z.array(z.string()).nullable().optional(),
  ea_versions: z.array(z.string()).nullable().optional(),
  symbol: z.string().optional().default("XAUUSD"),
  break_even_tolerance_usd: z.number().optional().default(DEFAULT_BREAK_EVEN_TOLERANCE_USD),
  minimum_sample: z.number().int().optional().default(DEFAULT_MINIMUM_SAMPLE),
  current_password: z.string(),
  confirm: z.boolean().optional().default(false),
});

/** Port of server.py's admin performance-period routes (lines 2880-2999). */
export async function registerAdminPerformancePeriodsRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/performance/periods -- server.py:2880
  app.get("/admin/performance/periods", { preHandler: requireAdmin }, async () => {
    const periods = (await getDb()
      .collection("performance_periods")
      .find({}, { projection: { _id: 0 } })
      .sort({ epoch_started_at: -1 })
      .limit(200)
      .toArray()) as unknown as PerformancePeriod[];

    const enriched: Record<string, unknown>[] = [];
    for (const period of periods) {
      const scope = period.scope ?? {};
      let statsDict: Record<string, unknown>;
      try {
        const trades = await fetchPeriodTrades(period);
        statsDict = periodStatsToDict(
          computePeriodStats(trades, scope.break_even_tolerance_usd ?? DEFAULT_BREAK_EVEN_TOLERANCE_USD, scope.minimum_sample ?? DEFAULT_MINIMUM_SAMPLE),
        );
      } catch {
        statsDict = { total_trades: null, win_rate: null, sufficient_data: false, minimum_sample: scope.minimum_sample ?? DEFAULT_MINIMUM_SAMPLE };
      }
      enriched.push({
        ...period,
        ...statsDict,
        qualifying_trade_count: statsDict["total_trades"],
        period_id: period.id,
        period_name: period.name,
        account_logins: scope.account_logins,
        ea_versions: scope.ea_versions,
        started_by_admin: period.created_by_admin_email,
      });
    }
    return { periods: enriched };
  });

  // POST /admin/performance/periods/start -- server.py:2917
  app.post("/admin/performance/periods/start", { preHandler: requireAdmin }, async (request, reply) => {
    const req = StartPerformancePeriodRequestSchema.parse(request.body);
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const db = getDb();

    const full = await db.collection("users").findOne({ email: admin["email"] });
    if (!full || !(await verifyPassword(req.current_password, String(full["password_hash"] ?? "")))) {
      return reply.code(401).send({ detail: "Incorrect password." });
    }
    if (!req.confirm) {
      return reply.code(400).send({ detail: "Set confirm=true to acknowledge that the previous period will be archived, not deleted." });
    }
    if (!req.name.trim() || !req.reason.trim()) {
      return reply.code(400).send({ detail: "A period name and reason are both required." });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const nowUnix = now.getTime() / 1000;

    const currentActive = await getActivePerformancePeriod();

    if (currentActive === null) {
      const existingPeriodsCount = await db.collection("performance_periods").countDocuments({});
      if (existingPeriodsCount === 0) {
        const earliest = await db
          .collection("trade_journal")
          .find({ has_rich_ledger_data: true, ticket: { $gt: 0 }, opened_at: { $gt: 0 } }, { projection: { _id: 0, opened_at: 1 } })
          .sort({ opened_at: 1 })
          .limit(1)
          .toArray();
        const legacyStartUnix = earliest[0] ? Number(earliest[0]["opened_at"]) : nowUnix;
        const legacyPeriod = {
          id: randomUUID(),
          name: "Historical EA Journal",
          status: "ARCHIVED",
          epoch_started_at: new Date(legacyStartUnix * 1000).toISOString(),
          epoch_started_at_unix: legacyStartUnix,
          epoch_ended_at: nowIso,
          epoch_ended_at_unix: nowUnix,
          scope: {
            account_logins: null,
            ea_versions: null,
            symbol: null,
            break_even_tolerance_usd: DEFAULT_BREAK_EVEN_TOLERANCE_USD,
            minimum_sample: DEFAULT_MINIMUM_SAMPLE,
          },
          created_by_admin_email: admin["email"],
          reason: "Automatically created to preserve all pre-reset trade history as its own labeled, permanent, read-only period.",
          created_at: nowIso,
        };
        await db.collection("performance_periods").insertOne({ ...legacyPeriod });
      }
    } else {
      await db
        .collection("performance_periods")
        .updateOne({ id: currentActive.id }, { $set: { status: "ARCHIVED", epoch_ended_at: nowIso, epoch_ended_at_unix: nowUnix } });
    }

    const newPeriod = {
      id: randomUUID(),
      name: req.name.trim(),
      status: "ACTIVE",
      epoch_started_at: nowIso,
      epoch_started_at_unix: nowUnix,
      epoch_ended_at: null,
      epoch_ended_at_unix: null,
      scope: {
        account_logins: req.account_logins ?? null,
        ea_versions: req.ea_versions ?? null,
        symbol: req.symbol,
        break_even_tolerance_usd: req.break_even_tolerance_usd,
        minimum_sample: req.minimum_sample,
      },
      created_by_admin_email: admin["email"],
      reason: req.reason.trim(),
      created_at: nowIso,
    };
    await db.collection("performance_periods").insertOne({ ...newPeriod });
    app.log.info(`PERFORMANCE_PERIOD_STARTED id=${newPeriod.id} name=${newPeriod.name} by=${admin["email"]} epoch=${nowIso}`);
    return { started: true, period: newPeriod };
  });
}
