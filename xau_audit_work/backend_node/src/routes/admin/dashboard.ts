import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { requireAdmin } from "../../auth.js";
import { sendPinEmail } from "../../services/paymentEmails.js";

/** Port of server.py:3665 `admin_dashboard` -- bots sold, active, performance, revenue. */
export async function registerAdminDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/dashboard", { preHandler: requireAdmin }, async () => {
    const db = getDb();
    const pins = db.collection("pin_licenses");

    const [pinFacet] = await pins
      .aggregate<{
        total?: { c: number }[];
        active_used?: { c: number }[];
        active_unused?: { c: number }[];
        revoked?: { c: number }[];
        purchased?: { c: number }[];
        free_generated?: { c: number }[];
      }>([
        {
          $facet: {
            total: [{ $count: "c" }],
            active_used: [{ $match: { is_active: true, is_used: true } }, { $count: "c" }],
            active_unused: [{ $match: { is_active: true, is_used: false } }, { $count: "c" }],
            revoked: [{ $match: { is_active: false } }, { $count: "c" }],
            purchased: [{ $match: { payment_ref: { $ne: null } } }, { $count: "c" }],
            free_generated: [{ $match: { payment_ref: null } }, { $count: "c" }],
          },
        },
      ])
      .toArray();
    const pr = pinFacet ?? {};
    const totalPins = pr.total?.[0]?.c ?? 0;
    const activeTrading = pr.active_used?.[0]?.c ?? 0;
    const activeUnused = pr.active_unused?.[0]?.c ?? 0;
    const revoked = pr.revoked?.[0]?.c ?? 0;
    const purchased = pr.purchased?.[0]?.c ?? 0;
    const freeGiven = pr.free_generated?.[0]?.c ?? 0;

    const txs = db.collection("payment_transactions");
    const [txFacet] = await txs
      .aggregate<{
        total?: { c: number }[];
        paid?: { c: number }[];
        pending?: { c: number }[];
        total_revenue?: { sum: number }[];
      }>([
        {
          $facet: {
            total: [{ $count: "c" }],
            paid: [{ $match: { payment_status: "success" } }, { $count: "c" }],
            pending: [{ $match: { payment_status: "pending" } }, { $count: "c" }],
            total_revenue: [{ $match: { payment_status: "success" } }, { $group: { _id: null, sum: { $sum: "$amount_kobo" } } }],
          },
        },
      ])
      .toArray();
    const tr = txFacet ?? {};
    const totalTxs = tr.total?.[0]?.c ?? 0;
    const paidTxs = tr.paid?.[0]?.c ?? 0;
    const pendingTxs = tr.pending?.[0]?.c ?? 0;
    const revenueKobo = tr.total_revenue?.[0]?.sum ?? 0;
    const revenueNaira = revenueKobo / 100;

    const mlPatterns = db.collection("ml_patterns");
    const mlTotal = await mlPatterns.countDocuments({});
    const mlWins = await mlPatterns.countDocuments({ was_winner: true });
    const mlLosses = mlTotal - mlWins;
    const mlWinRate = mlTotal > 0 ? Math.round((mlWins / mlTotal) * 1000) / 10 : 0;
    const contributors = mlTotal > 0 ? (await mlPatterns.distinct("pin")).length : 0;

    const pipsResult = await mlPatterns
      .aggregate<{ _id: boolean; total_pips: number; count: number }>([
        { $group: { _id: "$was_winner", total_pips: { $sum: "$profit_pips" }, count: { $sum: 1 } } },
      ])
      .toArray();
    let totalProfitPips = 0;
    let totalLossPips = 0;
    for (const p of pipsResult) {
      if (p._id === true) totalProfitPips = Math.round(p.total_pips * 10) / 10;
      else totalLossPips = Math.round(Math.abs(p.total_pips) * 10) / 10;
    }
    const netPips = Math.round((totalProfitPips - totalLossPips) * 10) / 10;

    const strategyNames: Record<number, string> = { 0: "Trend", 1: "Range", 2: "Breakout" };
    const strategyResults = await mlPatterns
      .aggregate<{ _id: { strategy: number; winner: boolean }; count: number; pips: number }>([
        { $group: { _id: { strategy: "$strategy", winner: "$was_winner" }, count: { $sum: 1 }, pips: { $sum: "$profit_pips" } } },
      ])
      .toArray();
    const strategies: Record<string, { trades: number; wins: number; profit_pips: number; loss_pips: number; win_rate?: number; net_pips?: number }> = {};
    for (const r of strategyResults) {
      const sname = strategyNames[r._id.strategy] ?? `S${r._id.strategy}`;
      if (!strategies[sname]) strategies[sname] = { trades: 0, wins: 0, profit_pips: 0, loss_pips: 0 };
      const s = strategies[sname]!;
      s.trades += r.count;
      if (r._id.winner) {
        s.wins += r.count;
        s.profit_pips += Math.round(r.pips * 10) / 10;
      } else {
        s.loss_pips += Math.round(Math.abs(r.pips) * 10) / 10;
      }
    }
    for (const s of Object.values(strategies)) {
      s.win_rate = s.trades > 0 ? Math.round((s.wins / s.trades) * 1000) / 10 : 0;
      s.net_pips = Math.round((s.profit_pips - s.loss_pips) * 10) / 10;
    }

    const recent = await mlPatterns
      .find({}, { projection: { _id: 0, was_winner: 1, profit_pips: 1, strategy: 1, confidence: 1, created_at: 1 } })
      .sort({ created_at: -1 })
      .limit(10)
      .toArray();
    const recentWithNames = recent.map((r) => ({ ...r, strategy_name: strategyNames[r["strategy"] as number] ?? "Unknown" }));

    return {
      bots: {
        total_sold: totalPins,
        actively_trading: activeTrading,
        purchased_not_activated: activeUnused,
        revoked,
        sold_via_payment: purchased,
        free_generated: freeGiven,
      },
      revenue: {
        total_transactions: totalTxs,
        successful_payments: paidTxs,
        pending_payments: pendingTxs,
        total_revenue_naira: revenueNaira,
        formatted_revenue: `₦${revenueNaira.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      },
      performance: {
        total_trades: mlTotal,
        wins: mlWins,
        losses: mlLosses,
        win_rate: mlWinRate,
        total_profit_pips: totalProfitPips,
        total_loss_pips: totalLossPips,
        net_pips: netPips,
        active_traders: contributors,
        profit_factor: totalLossPips > 0 ? Math.round((totalProfitPips / totalLossPips) * 100) / 100 : 0,
      },
      strategies,
      recent_trades: recentWithNames,
    };
  });

  // POST /admin/orders/:reference/resend-fulfillment-email -- server.py:1009
  app.post("/admin/orders/:reference/resend-fulfillment-email", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const db = getDb();
    const tx = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Not found" });
    if (!tx["pin_generated"]) return reply.code(409).send({ detail: "This order has no license to resend yet." });
    const sent = await sendPinEmail(String(tx["buyer_email"] ?? ""), String(tx["buyer_name"] ?? ""), String(tx["pin_generated"]));
    if (sent) await db.collection("payment_transactions").updateOne({ reference }, { $unset: { fulfillment_email_failed: "" } });
    return { sent };
  });

  // GET /admin/transactions -- server.py:3660
  app.get("/admin/transactions", { preHandler: requireAdmin }, async () => {
    const txs = await getDb()
      .collection("payment_transactions")
      .find({}, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray();
    return { total: txs.length, transactions: txs };
  });

  // GET /admin/command-center/overview -- server.py:3520
  app.get("/admin/command-center/overview", { preHandler: requireAdmin }, async () => {
    const db = getDb();
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90_000);
    const latestHb: Record<string, unknown> = (await db.collection("cloud_bot_heartbeats").findOne({}, { projection: { _id: 0 }, sort: { ts: -1 } })) ?? {};
    const hbTimeRaw = latestHb["ts"];
    const hbTime = typeof hbTimeRaw === "string" ? new Date(hbTimeRaw) : hbTimeRaw instanceof Date ? hbTimeRaw : null;
    const online = Boolean(hbTime && !Number.isNaN(hbTime.getTime()) && hbTime > cutoff);

    const totalLicenses = await db.collection("pin_licenses").countDocuments({});
    const activeLicenses = await db.collection("pin_licenses").countDocuments({ is_active: true });
    const activatedLicenses = await db.collection("pin_licenses").countDocuments({ is_active: true, is_used: true });
    const revokedLicenses = await db.collection("pin_licenses").countDocuments({ is_active: false });
    const linkedAccounts = await db.collection("pin_licenses").countDocuments({ mt5_account: { $nin: [null, ""] } });
    const pendingCommands = await db.collection("cloud_bot_commands").countDocuments({ status: "PENDING" });
    const executedCommands = await db.collection("cloud_bot_commands").countDocuments({ status: "EXECUTED" });
    const failedCommands = await db.collection("cloud_bot_commands").countDocuments({ status: "FAILED" });
    const recentEvents = await db.collection("cloud_bot_activity").find({}, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(30).toArray();
    const recentCommands = await db.collection("cloud_bot_commands").find({}, { projection: { _id: 0 } }).sort({ requested_at: -1 }).limit(20).toArray();

    return {
      licenses: {
        total: totalLicenses,
        active: activeLicenses,
        activated: activatedLicenses,
        revoked: revokedLicenses,
        linked_accounts: linkedAccounts,
      },
      bot: {
        online,
        status: latestHb["bot_state"] || (online ? "ONLINE" : "OFFLINE"),
        last_heartbeat: latestHb["ts"] || "",
        ea_version: latestHb["ea_version"] || "",
        account_number: latestHb["account_number"] || "",
        broker_server: latestHb["broker_server"] || "",
        symbol: latestHb["symbol"] || "",
        timeframe: latestHb["timeframe"] || "",
        equity: latestHb["equity"] || 0,
        balance: latestHb["balance"] || 0,
        open_positions: latestHb["open_positions"] || 0,
        algo_trading: Boolean(latestHb["algo_trading"]),
        trading_allowed: Boolean(latestHb["trading_allowed"]),
        mt5_connected: Boolean(latestHb["mt5_connected"]),
      },
      commands: {
        pending: pendingCommands,
        executed: executedCommands,
        failed: failedCommands,
        recent: recentCommands,
      },
      activity: recentEvents,
    };
  });
}
