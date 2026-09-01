import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { requireCloudUser } from "../../auth.js";
import { getUserLicense } from "../../services/commandLicense.js";
import { buildResultConversion } from "../../services/marketOutlookCore.js";
import { dedupeByTradeIdentity, isEligibleTrade } from "../../services/performanceEngine.js";

const MINIMUM_VERIFIED_TRADES_FOR_ANALYTICS = 5;

interface Bucket {
  trades: number;
  wins: number;
  profit: number;
  win_rate?: number;
}

function sessionTag(hour: number): string {
  if (hour >= 0 && hour < 8) return "ASIAN";
  if (hour >= 8 && hour < 13) return "LONDON";
  if (hour >= 13 && hour < 17) return "LONDON_NY_OVERLAP";
  if (hour >= 17 && hour < 21) return "NEW_YORK";
  return "LATE_NY";
}

function breakdown(trades: Record<string, unknown>[], key: string): Record<string, Bucket> {
  const buckets: Record<string, Bucket> = {};
  for (const t of trades) {
    const k = String(t[key] ?? "UNKNOWN");
    const b = (buckets[k] ??= { trades: 0, wins: 0, profit: 0 });
    b.trades += 1;
    if (t["result"] === "WIN") b.wins += 1;
    b.profit += Number(t["profit"] ?? 0);
  }
  for (const b of Object.values(buckets)) {
    b.profit = Math.round(b.profit * 100) / 100;
    b.win_rate = b.trades > 0 ? Math.round((b.wins / b.trades) * 1000) / 10 : 0;
  }
  return buckets;
}

/** Port of server.py:6110 `GET /cloud/performance/analytics` -- the Command Center's own-account trade analytics page. */
export async function registerCloudPerformanceAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/cloud/performance/analytics", { preHandler: requireCloudUser }, async (request, reply) => {
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const lic = await getUserLicense(user);
    if (!lic || !lic["pin"]) return reply.code(404).send({ detail: "No active license linked to this account." });
    const licenseId = String(lic["id"] ?? "");

    const rawTrades = await getDb()
      .collection("trade_journal")
      .find({ license_id: licenseId, has_rich_ledger_data: true }, { projection: { _id: 0 } })
      .sort({ closed_at: 1 })
      .limit(5000)
      .toArray();
    const trades = dedupeByTradeIdentity(
      rawTrades.filter((trade) => isEligibleTrade(trade) && Number(trade["closed_at"] ?? 0) > 0),
    );
    const total = trades.length;

    if (total < MINIMUM_VERIFIED_TRADES_FOR_ANALYTICS) {
      return {
        sufficient_data: false,
        verified_trade_count: total,
        minimum_required: MINIMUM_VERIFIED_TRADES_FOR_ANALYTICS,
        message: "NOT ENOUGH VERIFIED DATA",
      };
    }

    const closedWins = trades.filter((t) => t["result"] === "WIN");
    const profits = trades.map((t) => Number(t["profit"] ?? 0));
    const grossProfit = profits.filter((p) => p > 0).reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(profits.filter((p) => p < 0).reduce((s, p) => s + p, 0));

    const equityCurve: Record<string, unknown>[] = [];
    let running = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const t of trades) {
      running += Number(t["profit"] ?? 0);
      peak = Math.max(peak, running);
      maxDrawdown = Math.max(maxDrawdown, peak - running);
      equityCurve.push({ closed_at: t["closed_at"] ?? 0, ticket: t["ticket"] ?? 0, cumulative_profit: Math.round(running * 100) / 100 });
    }

    const rValues = trades.filter((t) => Number(t["original_risk_usd"] ?? 0) > 0).map((t) => Number(t["final_r"] ?? 0));
    const maeValues = trades.filter((t) => t["mae_r"]).map((t) => Number(t["mae_r"]));
    const mfeValues = trades.filter((t) => t["mfe_r"]).map((t) => Number(t["mfe_r"]));

    const pipsValues: number[] = [];
    const maePipsValues: number[] = [];
    const mfePipsValues: number[] = [];
    for (const t of trades) {
      const entry = Number(t["entry_price"] ?? 0);
      const exitPx = Number(t["price"] ?? 0);
      const finalR = Number(t["final_r"] ?? 0);
      const direction = String(t["direction"] ?? "").toUpperCase();
      if (entry <= 0 || exitPx <= 0 || finalR === 0 || (direction !== "BUY" && direction !== "SELL")) continue;
      const priceMove = direction === "BUY" ? exitPx - entry : entry - exitPx;
      const riskDistance = priceMove / finalR;
      if (riskDistance <= 0) continue;
      const conv = buildResultConversion({ r: finalR, risk_distance: riskDistance });
      if (conv.result_pips !== null) pipsValues.push(conv.result_pips);
      const maeR = t["mae_r"];
      if (maeR) {
        const maeConv = buildResultConversion({ r: Number(maeR), risk_distance: riskDistance });
        if (maeConv.result_pips !== null) maePipsValues.push(maeConv.result_pips);
      }
      const mfeR = t["mfe_r"];
      if (mfeR) {
        const mfeConv = buildResultConversion({ r: Number(mfeR), risk_distance: riskDistance });
        if (mfeConv.result_pips !== null) mfePipsValues.push(mfeConv.result_pips);
      }
    }

    const sessionBuckets: Record<string, Bucket> = {};
    for (const t of trades) {
      const tag = sessionTag(Number(t["hour"] ?? 0));
      const b = (sessionBuckets[tag] ??= { trades: 0, wins: 0, profit: 0 });
      b.trades += 1;
      if (t["result"] === "WIN") b.wins += 1;
      b.profit += Number(t["profit"] ?? 0);
    }
    for (const b of Object.values(sessionBuckets)) {
      b.profit = Math.round(b.profit * 100) / 100;
      b.win_rate = b.trades > 0 ? Math.round((b.wins / b.trades) * 1000) / 10 : 0;
    }

    const avg = (values: number[], decimals: number): number | null =>
      values.length > 0 ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10 ** decimals) / 10 ** decimals : null;

    const winningProfits = profits.filter((p) => p > 0);
    const losingProfits = profits.filter((p) => p < 0);

    return {
      sufficient_data: true,
      verified_trade_count: total,
      realized_pnl: Math.round(profits.reduce((s, p) => s + p, 0) * 100) / 100,
      win_rate: Math.round((closedWins.length / total) * 1000) / 10,
      profit_factor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? Math.round(grossProfit * 100) / 100 : 0,
      avg_r: avg(rValues, 3),
      avg_mae_r: avg(maeValues, 3),
      avg_mfe_r: avg(mfeValues, 3),
      avg_pips: avg(pipsValues, 1),
      avg_mae_pips: avg(maePipsValues, 1),
      avg_mfe_pips: avg(mfePipsValues, 1),
      max_drawdown: Math.round(maxDrawdown * 100) / 100,
      avg_win: winningProfits.length > 0 ? Math.round((winningProfits.reduce((s, p) => s + p, 0) / winningProfits.length) * 100) / 100 : 0,
      avg_loss: losingProfits.length > 0 ? Math.round((losingProfits.reduce((s, p) => s + p, 0) / losingProfits.length) * 100) / 100 : 0,
      equity_curve: equityCurve,
      setup_breakdown: breakdown(trades, "setup"),
      family_breakdown: breakdown(trades, "family"),
      machine_breakdown: breakdown(trades, "account_login"),
      session_breakdown: sessionBuckets,
    };
  });
}
