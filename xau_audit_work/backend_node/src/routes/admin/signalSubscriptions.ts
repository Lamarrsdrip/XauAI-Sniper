import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin } from "../../auth.js";

/** Read-only admin visibility into the trial/subscription product -- no entitlement-manipulation endpoints here; the only way to grant a paid plan is the existing audited bank-transfer/Paystack/Nomba approval flow. */
export async function registerAdminSignalSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/signals/overview -- aggregate counts for the admin dashboard.
  app.get("/admin/signals/overview", { preHandler: requireAdmin }, async () => {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const [activeTrials, expiredTrials, weeklyActive, monthlyActive, lifetimeLicenses, pendingSignalTransfers] = await Promise.all([
      db.collection("signal_trials").countDocuments({ trial_expires_at: { $gt: nowIso } }),
      db.collection("signal_trials").countDocuments({ trial_expires_at: { $lte: nowIso } }),
      db.collection("signal_subscriptions").countDocuments({ plan: "WEEKLY", status: { $ne: "CANCELLED" }, expires_at: { $gt: nowIso } }),
      db.collection("signal_subscriptions").countDocuments({ plan: "MONTHLY", status: { $ne: "CANCELLED" }, expires_at: { $gt: nowIso } }),
      db.collection("pin_licenses").countDocuments({ is_active: true }),
      db.collection("payment_transactions").countDocuments({ provider: "BANK_TRANSFER", payment_status: { $in: ["BANK_TRANSFER_SUBMITTED", "UNDER_ADMIN_REVIEW"] }, plan_id: { $in: ["SIGNALS_WEEKLY", "SIGNALS_MONTHLY"] } }),
    ]);
    return {
      active_trials: activeTrials,
      expired_trials: expiredTrials,
      weekly_subscribers: weeklyActive,
      monthly_subscribers: monthlyActive,
      lifetime_licenses: lifetimeLicenses,
      pending_signal_bank_transfers: pendingSignalTransfers,
    };
  });

  // GET /admin/signals/users -- per-user trial/subscription status, joined with the owning cloud_users
  // record for display (email/name only -- never balances/credentials/other sensitive fields).
  app.get("/admin/signals/users", { preHandler: requireAdmin }, async (request) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).optional().default(100) }).parse(request.query);
    const db = getDb();
    const nowIso = new Date().toISOString();

    const [trials, subscriptions] = await Promise.all([
      db.collection("signal_trials").find({}, { projection: { _id: 0 } }).sort({ trial_started_at: -1 }).limit(q.limit).toArray(),
      db.collection("signal_subscriptions").find({}, { projection: { _id: 0 } }).sort({ activated_at: -1 }).limit(q.limit).toArray(),
    ]);

    const userIds = [...new Set([...trials, ...subscriptions].map((r) => String(r["user_id"] ?? "")).filter(Boolean))];
    const users = userIds.length
      ? await db.collection("cloud_users").find({ id: { $in: userIds } }, { projection: { _id: 0, id: 1, email: 1, full_name: 1 } }).toArray()
      : [];
    const userById = new Map(users.map((u) => [String(u["id"]), u]));

    const rows = new Map<string, Record<string, unknown>>();
    for (const t of trials) {
      const userId = String(t["user_id"] ?? "");
      const row = rows.get(userId) ?? { user_id: userId, ...userById.get(userId) };
      row["trial"] = { ...t, status: new Date(String(t["trial_expires_at"])).getTime() > new Date(nowIso).getTime() ? "ACTIVE" : "EXPIRED" };
      rows.set(userId, row);
    }
    for (const s of subscriptions) {
      const userId = String(s["user_id"] ?? "");
      const row = rows.get(userId) ?? { user_id: userId, ...userById.get(userId) };
      const active = s["status"] !== "CANCELLED" && new Date(String(s["expires_at"])).getTime() > new Date(nowIso).getTime();
      const existing = row["subscription"] as Record<string, unknown> | undefined;
      // Keep the subscription with the latest expiry if a user has more than one row.
      if (!existing || new Date(String(s["expires_at"])).getTime() > new Date(String(existing["expires_at"])).getTime()) {
        row["subscription"] = { ...s, active };
      }
      rows.set(userId, row);
    }

    return { users: [...rows.values()] };
  });
}
