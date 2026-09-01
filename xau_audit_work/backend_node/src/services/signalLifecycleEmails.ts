import { getDb } from "../db.js";
import { emailBranding, emailLinkButton } from "./emailBranding.js";
import { sendEmail } from "./email.js";
import { publishedTransactionalRender } from "./adminOpsControl.js";

const TRIAL_ENDING_WINDOW_MS = 12 * 3_600_000; // send once, inside the final 12h of the trial

async function renderOrDefault(template: string, vars: Record<string, string>, subject: string, html: string): Promise<void> {
  const override = await publishedTransactionalRender(template, vars);
  if (override) {
    await sendEmail(vars["buyer_email"] ?? "", String(override["subject"]), String(override["html"]), { text: String(override["text"] ?? "") });
    return;
  }
  await sendEmail(vars["buyer_email"] ?? "", subject, html);
}

async function buyerFields(userId: string): Promise<{ email: string; name: string } | null> {
  const user = await getDb().collection("cloud_users").findOne({ id: userId }, { projection: { _id: 0, email: 1, full_name: 1 } });
  if (!user) return null;
  return { email: String(user["email"] ?? ""), name: String(user["full_name"] ?? "") };
}

/**
 * One sweep pass, safe to run on a timer (mirrors the existing
 * processQueuedXTradePosts 30s-interval pattern in index.ts). Idempotency
 * is a flag on the trial/subscription document itself -- no separate log
 * collection needed for something this small ("less code, not more code").
 * Never spams: each lifecycle email fires at most once per trial/subscription.
 */
export async function sweepSignalLifecycleEmails(): Promise<void> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const b = await emailBranding();

  // Trial ending soon (once, inside the final 12h).
  const endingSoonCutoff = new Date(Date.now() + TRIAL_ENDING_WINDOW_MS).toISOString();
  const endingSoon = await db.collection("signal_trials").find({
    trial_expires_at: { $gt: nowIso, $lte: endingSoonCutoff },
    ending_email_sent_at: { $exists: false },
  }, { projection: { _id: 0 } }).toArray();
  for (const trial of endingSoon) {
    const buyer = await buyerFields(String(trial["user_id"]));
    if (buyer?.email) {
      await renderOrDefault("trial_ending", { buyer_email: buyer.email, buyer_name: buyer.name, first_name: buyer.name, expires_at: String(trial["trial_expires_at"]) },
        `Your ${b.sender_name} trial ends soon`,
        `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;"><h2 style="color:#B8860B;">Your free signal trial ends soon</h2><p>Hello ${buyer.name || "Trader"},</p><p>Your XauCloud signal trial ends at ${trial["trial_expires_at"]}.</p><p>Continue with Weekly (₦20,000) or Monthly (₦50,000) signals, or unlock the full XauCloud bot (₦300,000 lifetime).</p><div style="text-align:center;margin:20px 0;">${emailLinkButton("Open Command Center", b.command_center_url, true)}</div></div>`);
    }
    await db.collection("signal_trials").updateOne({ user_id: trial["user_id"] }, { $set: { ending_email_sent_at: new Date().toISOString() } });
  }

  // Trial expired (once, after expiry).
  const justExpiredTrials = await db.collection("signal_trials").find({
    trial_expires_at: { $lte: nowIso },
    expired_email_sent_at: { $exists: false },
  }, { projection: { _id: 0 } }).toArray();
  for (const trial of justExpiredTrials) {
    const buyer = await buyerFields(String(trial["user_id"]));
    if (buyer?.email) {
      await renderOrDefault("trial_expired", { buyer_email: buyer.email, buyer_name: buyer.name, first_name: buyer.name },
        `Your ${b.sender_name} signal trial has ended`,
        `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;"><h2 style="color:#B8860B;">Your free XauCloud signal trial has ended</h2><p>Hello ${buyer.name || "Trader"},</p><p>Your account remains active. Live signal access is paused.</p><p>Continue with Weekly — ₦20,000, Monthly — ₦50,000, or unlock the complete XauCloud bot — Lifetime ₦300,000.</p><div style="text-align:center;margin:20px 0;">${emailLinkButton("View Plans", b.command_center_url, true)}</div></div>`);
    }
    await db.collection("signal_trials").updateOne({ user_id: trial["user_id"] }, { $set: { expired_email_sent_at: new Date().toISOString() } });
  }

  // Subscription expiring soon (once, inside the final 24h).
  const subEndingCutoff = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const subEndingSoon = await db.collection("signal_subscriptions").find({
    status: { $ne: "CANCELLED" }, expires_at: { $gt: nowIso, $lte: subEndingCutoff }, ending_email_sent_at: { $exists: false },
  }, { projection: { _id: 0 } }).toArray();
  for (const sub of subEndingSoon) {
    const buyer = await buyerFields(String(sub["user_id"]));
    const planLabel = sub["plan"] === "WEEKLY" ? "Weekly Signals" : "Monthly Signals";
    if (buyer?.email) {
      await renderOrDefault("subscription_expiring", { buyer_email: buyer.email, buyer_name: buyer.name, first_name: buyer.name, plan: planLabel, expires_at: String(sub["expires_at"]) },
        `Your ${planLabel} subscription expires soon`,
        `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;"><h2 style="color:#B8860B;">${planLabel} expires soon</h2><p>Hello ${buyer.name || "Trader"},</p><p>Your ${planLabel} subscription expires at ${sub["expires_at"]}. Renew to keep your XauCloud signal access.</p><div style="text-align:center;margin:20px 0;">${emailLinkButton("Open Billing", b.command_center_url, true)}</div></div>`);
    }
    await db.collection("signal_subscriptions").updateOne({ source_payment_ref: sub["source_payment_ref"] }, { $set: { ending_email_sent_at: new Date().toISOString() } });
  }

  // Subscription expired (once, after expiry).
  const justExpiredSubs = await db.collection("signal_subscriptions").find({
    status: { $ne: "CANCELLED" }, expires_at: { $lte: nowIso }, expired_email_sent_at: { $exists: false },
  }, { projection: { _id: 0 } }).toArray();
  for (const sub of justExpiredSubs) {
    const buyer = await buyerFields(String(sub["user_id"]));
    const planLabel = sub["plan"] === "WEEKLY" ? "Weekly Signals" : "Monthly Signals";
    if (buyer?.email) {
      await renderOrDefault("subscription_expired", { buyer_email: buyer.email, buyer_name: buyer.name, first_name: buyer.name, plan: planLabel },
        `Your ${planLabel} subscription has expired`,
        `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;"><h2 style="color:#B8860B;">${planLabel} has expired</h2><p>Hello ${buyer.name || "Trader"},</p><p>Your account remains active. Renew Weekly (₦20,000) or Monthly (₦50,000) signals, or unlock the complete XauCloud bot — Lifetime ₦300,000.</p><div style="text-align:center;margin:20px 0;">${emailLinkButton("View Plans", b.command_center_url, true)}</div></div>`);
    }
    await db.collection("signal_subscriptions").updateOne({ source_payment_ref: sub["source_payment_ref"] }, { $set: { expired_email_sent_at: new Date().toISOString() } });
  }
}
