import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { requireCloudUser } from "../../auth.js";
import { effectiveEntitlement, requireCapability } from "../../services/entitlements.js";
import { startTrial } from "../../services/signalTrial.js";
import { subscriberSourceHealth } from "../../services/subscriberSignalFeed.js";
import { getSettings } from "../../services/settings.js";
import { publishedTransactionalRender } from "../../services/adminOpsControl.js";
import { emailBranding, emailLinkButton } from "../../services/emailBranding.js";
import { sendEmail } from "../../services/email.js";

function cloudUserOf(request: unknown): Record<string, unknown> {
  return (request as { cloudUser: Record<string, unknown> }).cloudUser;
}

/** Best-effort welcome+trial-started email -- never blocks trial activation on a send failure. */
async function sendTrialStartedEmail(toEmail: string, buyerName: string): Promise<void> {
  try {
    const override = await publishedTransactionalRender("trial_started", { buyer_name: buyerName, first_name: buyerName, buyer_email: toEmail, account_email: toEmail });
    if (override) {
      await sendEmail(toEmail, String(override["subject"]), String(override["html"]), { text: String(override["text"] ?? "") });
      return;
    }
    const b = await emailBranding();
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
<h2 style="color:#B8860B;">Welcome to ${b.sender_name} — your 3-day signal trial is live</h2>
<p>Hello ${buyerName || "Trader"},</p>
<p>Your free signal trial is now active and covers <strong>3 market days</strong> (weekends don't count).</p>
<p>You do not need to purchase the XauCloud bot to use it. During your trial you can:</p>
<ul style="font-size:14px;color:#333;">
<li>See the current XauCloud Market Outlook</li>
<li>See the permitted 10-minute engine view</li>
<li>Receive eligible signal notifications</li>
</ul>
<div style="text-align:center;margin:20px 0;">${emailLinkButton("Open Command Center", b.command_center_url, true)}</div>
<p style="font-size:12px;color:#6E6E73;">This trial covers XauCloud's signal experience only -- it does not include the XauCloud bot/EA license or automated MT5 execution.</p>
</div>`;
    await sendEmail(toEmail, `Welcome to ${b.sender_name} — your 3-day signal trial is live`, html);
  } catch {
    /* best-effort */
  }
}

/** Trial start, entitlement, billing, and subscriber-safe Outlook/10m-engine/recent-signals read APIs. Every route is entitlement-gated server-side -- never a frontend-only hide. */
export async function registerCloudSignalRoutes(app: FastifyInstance): Promise<void> {
  // POST /cloud/signals/trial/start -- once-per-account, idempotent (see signalTrial.ts).
  app.post("/cloud/signals/trial/start", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUserOf(request);
    const userId = String(user["id"] ?? "");
    const alreadyExisted = Boolean((await getDb().collection("signal_trials").findOne({ user_id: userId })));
    const trial = await startTrial(userId);
    if (!alreadyExisted) {
      await sendTrialStartedEmail(String(user["email"] ?? ""), String(user["full_name"] ?? ""));
    }
    return { trial, entitlement: await effectiveEntitlement(user) };
  });

  // GET /cloud/entitlement -- the single source of truth the Command Center UI renders from.
  app.get("/cloud/entitlement", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUserOf(request);
    return effectiveEntitlement(user);
  });

  // GET /cloud/billing -- current plan/status/dates, payment history, available plans. Reuses the
  // existing payment_transactions collection; no second billing datastore.
  app.get("/cloud/billing", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUserOf(request);
    const userId = String(user["id"] ?? "");
    const email = String(user["email"] ?? "").toLowerCase();
    const db = getDb();
    const settings = await getSettings();

    const [entitlement, payments] = await Promise.all([
      effectiveEntitlement(user),
      db.collection("payment_transactions")
        .find({ $or: [{ user_id: userId }, { buyer_email: email }] }, { projection: { _id: 0, bank_transfer_proof: 0 } })
        .sort({ created_at: -1 })
        .limit(25)
        .toArray(),
    ]);

    return {
      entitlement,
      payment_history: payments,
      plans: {
        trial: { plan_id: "TRIAL", price_kobo: 0 },
        signals_weekly: { plan_id: "SIGNALS_WEEKLY", price_kobo: Number(settings["signals_weekly_price_kobo"] ?? 2_000_000) },
        signals_monthly: { plan_id: "SIGNALS_MONTHLY", price_kobo: Number(settings["signals_monthly_price_kobo"] ?? 5_000_000) },
        bot_lifetime: { plan_id: "BOT_LIFETIME", price_kobo: Number(settings["pin_price_kobo"] ?? 30_000_000) },
      },
    };
  });

  // GET /cloud/signals/outlook -- subscriber-safe current Market Outlook. 403 if not entitled.
  app.get("/cloud/signals/outlook", { preHandler: requireCloudUser }, async (request, reply) => {
    const entitlement = await effectiveEntitlement(cloudUserOf(request));
    try {
      requireCapability(entitlement, "outlook_access");
    } catch (e) {
      const err = e as { statusCode: number; detail: unknown };
      return reply.code(err.statusCode).send(err.detail);
    }
    const [signal, health] = await Promise.all([
      getDb().collection("subscriber_signals").findOne({ engine: "OUTLOOK" }, { projection: { _id: 0 }, sort: { updated_at: -1 } }),
      subscriberSourceHealth(),
    ]);
    if (!health.configured || !health.online) return { available: false, signal: null, health };
    return { available: true, signal, health };
  });

  // GET /cloud/signals/engine -- subscriber-safe current 10-minute engine view. 403 if not entitled.
  app.get("/cloud/signals/engine", { preHandler: requireCloudUser }, async (request, reply) => {
    const entitlement = await effectiveEntitlement(cloudUserOf(request));
    try {
      requireCapability(entitlement, "engine_10m_access");
    } catch (e) {
      const err = e as { statusCode: number; detail: unknown };
      return reply.code(err.statusCode).send(err.detail);
    }
    const [signal, health] = await Promise.all([
      getDb().collection("subscriber_signals").findOne({ engine: "M10_ENGINE" }, { projection: { _id: 0 }, sort: { updated_at: -1 } }),
      subscriberSourceHealth(),
    ]);
    if (!health.configured || !health.online) return { available: false, signal: null, health };
    return { available: true, signal, health };
  });

  // GET /cloud/signals/recent -- recent subscriber-safe signal history. 403 if not entitled.
  app.get("/cloud/signals/recent", { preHandler: requireCloudUser }, async (request, reply) => {
    const entitlement = await effectiveEntitlement(cloudUserOf(request));
    try {
      requireCapability(entitlement, "signals_access");
    } catch (e) {
      const err = e as { statusCode: number; detail: unknown };
      return reply.code(err.statusCode).send(err.detail);
    }
    const rows = await getDb().collection("subscriber_signals").find({}, { projection: { _id: 0 } }).sort({ updated_at: -1 }).limit(20).toArray();
    return { signals: rows };
  });

  // GET /purchase/plans is registered in routes/purchase.ts (public, no auth needed for pricing).
}
