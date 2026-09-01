import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { getDb } from "../db.js";

export type SignalPlan = "SIGNALS_WEEKLY" | "SIGNALS_MONTHLY";

const PLAN_DURATION_MS: Record<SignalPlan, number> = {
  // Weekly = 7 calendar days. Monthly = fixed 30 days (explicit owner
  // decision -- there is no recurring-billing convention elsewhere in this
  // codebase to inherit, and a fixed day-count avoids the Jan 31 -> Feb 31
  // ambiguity a "calendar month" definition would introduce).
  SIGNALS_WEEKLY: 7 * 86_400_000,
  SIGNALS_MONTHLY: 30 * 86_400_000,
};

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: "WEEKLY" | "MONTHLY";
  status: "ACTIVE" | "EXPIRED" | "CANCELLED";
  activated_at: string;
  expires_at: string;
  source_payment_ref: string;
}

/**
 * Activates a weekly/monthly signal subscription. Called from the SAME
 * FULFILLING-state choke point paymentFulfillment.ts already uses for
 * mintLicenseForReference, so it inherits that atomic per-reference lock --
 * this is the "SIGNALS_WEEKLY/SIGNALS_MONTHLY" sibling of mintLicenseForReference,
 * never a duplicate payment engine. A unique index on source_payment_ref is
 * defense-in-depth, matching mintLicenseForReference's own pin_licenses
 * unique-index-on-payment_ref belt-and-braces pattern.
 */
export async function activateSignalSubscription(reference: string, tx: Record<string, unknown>, planId: SignalPlan): Promise<SubscriptionRow> {
  const db = getDb();
  const existing = await db.collection("signal_subscriptions").findOne({ source_payment_ref: reference }, { projection: { _id: 0 } });
  if (existing) return existing as unknown as SubscriptionRow;

  const userId = String(tx["user_id"] ?? "");
  const now = new Date();
  const plan: SubscriptionRow["plan"] = planId === "SIGNALS_WEEKLY" ? "WEEKLY" : "MONTHLY";
  const doc: SubscriptionRow = {
    id: randomUUID(),
    user_id: userId,
    plan,
    status: "ACTIVE",
    activated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PLAN_DURATION_MS[planId]).toISOString(),
    source_payment_ref: reference,
  };
  try {
    await db.collection("signal_subscriptions").insertOne({ ...doc });
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      const fresh = await db.collection("signal_subscriptions").findOne({ source_payment_ref: reference }, { projection: { _id: 0 } });
      if (fresh) return fresh as unknown as SubscriptionRow;
    }
    throw err;
  }
  return doc;
}

/**
 * Current subscription status for a user, computed fresh against the server
 * clock (never trusting a stored ACTIVE status past its expires_at). Picks
 * the subscription with the latest expiry so a renewal always wins over an
 * older, now-expired row.
 */
export async function subscriptionStatus(userId: string): Promise<(SubscriptionRow & { active: boolean }) | null> {
  const rows = await getDb()
    .collection("signal_subscriptions")
    .find({ user_id: userId, status: { $ne: "CANCELLED" } }, { projection: { _id: 0 } })
    .sort({ expires_at: -1 })
    .limit(1)
    .toArray();
  const row = rows[0];
  if (!row) return null;
  const active = new Date().getTime() < new Date(String(row["expires_at"])).getTime();
  return { ...(row as unknown as SubscriptionRow), active };
}
