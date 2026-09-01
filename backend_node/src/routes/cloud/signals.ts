import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { requireCloudUser } from "../../auth.js";
import { effectiveEntitlement, requireCapability } from "../../services/entitlements.js";
import { startTrial } from "../../services/signalTrial.js";
import { subscriberSourceHealth, type SubscriberSourceHealth } from "../../services/subscriberSignalFeed.js";
import { getSettings } from "../../services/settings.js";
import { publishedTransactionalRender } from "../../services/adminOpsControl.js";
import { emailBranding, emailLinkButton } from "../../services/emailBranding.js";
import { sendEmail } from "../../services/email.js";

function cloudUserOf(request: unknown): Record<string, unknown> {
  return (request as { cloudUser: Record<string, unknown> }).cloudUser;
}

/**
 * Diagnostic-only (never authorization): distinguishes "nobody has told the
 * subscriber feed which production account to mirror" (an admin setup gap --
 * see admin_settings.subscriber_signal_source_account) from "it's configured
 * but that account's heartbeat has gone stale" (a genuine outage). Both
 * still mean available:false to the customer -- the feed really is
 * unavailable either way -- but this makes the difference visible to
 * whoever is debugging it instead of requiring a raw DB query, which is
 * exactly what it took to find the 2026-08-25 incident (subscriber_signals
 * had zero documents ever because the source account was never set).
 */
function healthReason(health: SubscriberSourceHealth): string {
  if (!health.configured) return "SOURCE_NOT_CONFIGURED";
  if (!health.online) return "SOURCE_OFFLINE";
  return "OK";
}

/**
 * Subscriber rows deliberately contain only a safe snapshot of a signal.
 * Lifecycle truth (TP/SL timestamps, invalidation and terminal outcome) is
 * maintained by the existing cloud_market_outlooks lifecycle service.  Join
 * it at read time instead of inventing a second tracker or mutating an
 * archived signal row.  This makes Recent Signals show only milestones that
 * are already authoritative in the same record powering Outlook analytics.
 */
function withAuthoritativeOutcome(signal: Record<string, unknown>, outcome?: Record<string, unknown>): Record<string, unknown> {
  if (!outcome) return signal;
  const iso = (key: string) => typeof outcome[key] === "string" ? outcome[key] as string : null;
  const tp1At = iso("tp1_hit_at");
  const tp2At = iso("tp2_hit_at");
  const tp3At = iso("tp3_hit_at");
  const slAt = iso("sl_hit_at");
  const rawState = String(outcome["signal_state"] ?? outcome["status"] ?? "").toUpperCase();
  const analyticsOutcome = typeof outcome["analytics_outcome"] === "string" ? outcome["analytics_outcome"] : null;
  const invalidated = rawState.includes("INVALIDAT") || String(outcome["final_result"] ?? "").toUpperCase().includes("INVALIDAT");
  const status = slAt ? "SL_HIT" : tp3At ? "TP3_HIT" : tp2At ? "TP2_HIT" : tp1At ? "TP1_HIT" : invalidated ? "INVALIDATED" : analyticsOutcome ? "CLOSED" : signal["status"];
  const outcomeTime = [tp1At, tp2At, tp3At, slAt, iso("updated_at")]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  const timeline = [
    { event: "Signal opened", at: signal["effective_at"] ?? signal["created_at"] ?? null },
    ...(tp1At ? [{ event: "TP1 reached", at: tp1At }] : []),
    ...(tp2At ? [{ event: "TP2 reached", at: tp2At }] : []),
    ...(tp3At ? [{ event: "TP3 reached", at: tp3At }] : []),
    ...(slAt ? [{ event: "SL hit", at: slAt }] : []),
    ...(invalidated ? [{ event: "Signal invalidated", at: iso("invalidated_at") ?? iso("updated_at") }] : []),
    ...(analyticsOutcome && !tp1At && !tp2At && !tp3At && !slAt ? [{ event: "Signal closed", at: iso("updated_at") ?? iso("last_monitored_at") }] : []),
  ].filter((entry) => entry.at);
  return {
    ...signal,
    status,
    source_status: signal["status"],
    analytics_outcome: analyticsOutcome,
    signal_state: outcome["signal_state"] ?? null,
    tp1_hit_at: tp1At,
    tp2_hit_at: tp2At,
    tp3_hit_at: tp3At,
    sl_hit_at: slAt,
    outcome_time: outcomeTime,
    outcome_timeline: timeline,
    latest_update_at: iso("updated_at") ?? signal["updated_at"] ?? null,
  };
}

async function recentSignalsWithOutcomes(limit: number): Promise<Record<string, unknown>[]> {
  const db = getDb();
  const rows = await db.collection("subscriber_signals").find({}, { projection: { _id: 0 } }).sort({ updated_at: -1 }).limit(limit).toArray() as Record<string, unknown>[];
  const ids = [...new Set(rows.map((row) => String(row["signal_id"] ?? "")).filter(Boolean))];
  if (!ids.length) return rows;
  const outcomes = await db.collection("cloud_market_outlooks")
    .find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, signal_state: 1, analytics_outcome: 1, final_result: 1, tp1_hit_at: 1, tp2_hit_at: 1, tp3_hit_at: 1, sl_hit_at: 1, invalidated_at: 1, updated_at: 1, last_monitored_at: 1 } })
    .toArray() as Record<string, unknown>[];
  const byId = new Map(outcomes.map((outcome) => [String(outcome["id"]), outcome]));
  return rows.map((row) => withAuthoritativeOutcome(row, byId.get(String(row["signal_id"] ?? ""))));
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
    if (!health.configured || !health.online) return { available: false, signal: null, health, reason: healthReason(health) };
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
    const db = getDb();
    const [signal, health, lastActionable] = await Promise.all([
      db.collection("subscriber_signals").findOne({ engine: "M10_ENGINE" }, { projection: { _id: 0 }, sort: { updated_at: -1 } }),
      subscriberSourceHealth(),
      db.collection("subscriber_signals").findOne({ engine: "M10_ENGINE", status: "ACTIONABLE" }, { projection: { _id: 0, effective_at: 1 }, sort: { effective_at: -1 } }),
    ]);
    if (!health.configured || !health.online) return { available: false, signal: null, health, reason: healthReason(health) };
    // Three distinct timestamps a customer can trust (2026-08-25 fix): the
    // engine evaluates far more often than it produces a tradeable signal --
    // conflating "last touched" with "last actionable" made a genuinely
    // active engine look stalled for hours at a time.
    return {
      available: true,
      signal: signal ? {
        ...signal,
        last_evaluated_at: signal["last_evaluated_at"] ?? signal["updated_at"] ?? null,
        last_state_change_at: signal["created_at"] ?? null,
        last_actionable_at: lastActionable?.["effective_at"] ?? null,
      } : null,
      health,
    };
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
    return { signals: await recentSignalsWithOutcomes(50) };
  });

  // The detail payload is the same read-only, subscriber-safe representation
  // as Recent Signals. Keeping it in the API also lets mobile deep-link a
  // row without holding a stale client-side copy.
  app.get("/cloud/signals/recent/:signalId", { preHandler: requireCloudUser }, async (request, reply) => {
    const entitlement = await effectiveEntitlement(cloudUserOf(request));
    try { requireCapability(entitlement, "signals_access"); } catch (e) {
      const err = e as { statusCode: number; detail: unknown };
      return reply.code(err.statusCode).send(err.detail);
    }
    const signalId = String((request.params as { signalId?: string }).signalId ?? "").trim();
    if (!signalId) return reply.code(400).send({ detail: "signal id is required" });
    const signals = await recentSignalsWithOutcomes(200);
    const signal = signals.find((row) => String(row["signal_id"] ?? "") === signalId);
    if (!signal) return reply.code(404).send({ detail: "Signal not found." });
    return { signal };
  });

  // GET /purchase/plans is registered in routes/purchase.ts (public, no auth needed for pricing).
}
