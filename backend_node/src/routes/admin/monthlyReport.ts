import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { requireAdmin } from "../../auth.js";
import { getSettings } from "../../services/settings.js";

interface HourStat {
  hour: number;
  win_rate: number;
  trades: number;
}

/** Port of server.py:4078 `admin_monthly_report`. */
export async function registerAdminMonthlyReportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/monthly-report", { preHandler: requireAdmin }, async () => {
    const db = getDb();
    const patterns = db.collection("ml_patterns");
    const totalPatterns = await patterns.countDocuments({});
    const wins = await patterns.countDocuments({ was_winner: true });
    const totalTxs = await db.collection("payment_transactions").countDocuments({});
    const paidTxs = await db.collection("payment_transactions").countDocuments({ payment_status: "success" });
    const totalPins = await db.collection("pin_licenses").countDocuments({});
    const activePins = await db.collection("pin_licenses").countDocuments({ is_active: true, is_used: true });

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

    const allHours: HourStat[] = [...hourData.entries()]
      .filter(([, d]) => d.total >= 3)
      .map(([h, d]) => ({ hour: h, win_rate: Math.round((d.wins / d.total) * 1000) / 10, trades: d.total }));

    const bestHours = [...allHours].sort((a, b) => b.win_rate - a.win_rate).slice(0, 5);
    const worstHours = [...allHours].sort((a, b) => a.win_rate - b.win_rate).slice(0, 5);

    const s = await getSettings();
    const priceNaira = Number(s["pin_price_kobo"] ?? 30_000_000) / 100;

    const bestStr = bestHours
      .slice(0, 3)
      .map((h) => `${h.hour}:00 (${h.win_rate}%)`)
      .join(", ");
    const worstStr = worstHours
      .slice(0, 3)
      .map((h) => `${h.hour}:00 (${h.win_rate}%)`)
      .join(", ");
    const revenueNaira = paidTxs * priceNaira;

    return {
      ml_stats: {
        total_patterns: totalPatterns,
        global_win_rate: totalPatterns > 0 ? Math.round((wins / totalPatterns) * 1000) / 10 : 0,
      },
      sales: {
        total_transactions: totalTxs,
        successful_payments: paidTxs,
        revenue_naira: revenueNaira,
        total_pins: totalPins,
        active_users: activePins,
      },
      best_trading_hours: bestHours,
      worst_trading_hours: worstHours,
      recommendations:
        bestHours.length > 0
          ? [
              `Best trading hours: ${bestStr}`,
              `Avoid trading at: ${worstStr}`,
              `Revenue so far: ₦${revenueNaira.toLocaleString("en-US", { maximumFractionDigits: 0 })} from ${paidTxs} sales`,
            ]
          : ["Not enough data yet. As more users trade, insights will appear."],
    };
  });
}
