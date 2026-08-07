import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { getSettings } from "./settings.js";
import { NAMESPACE_URL, uuidV5 } from "./uuidV5.js";
import { sendWebPushToUser } from "./webPush.js";
import { buildResultConversion } from "./marketOutlookCore.js";

/** Port of backend/notifications.py -- push notification dispatch via OneSignal. */

const ONESIGNAL_API_URL = "https://api.onesignal.com/notifications";

async function onesignalConfig(): Promise<{ app_id: string; api_key: string }> {
  const s = await getSettings();
  return {
    app_id: String(s["onesignal_app_id"] ?? "").trim(),
    api_key: String(s["onesignal_api_key"] ?? "").trim(),
  };
}

export async function getOnesignalStatus(): Promise<Record<string, unknown>> {
  const cfg = await onesignalConfig();
  const configured = Boolean(cfg.app_id && cfg.api_key);
  return { configured, app_id: configured ? cfg.app_id : "", initialization_state: configured ? "READY" : "NOT_CONFIGURED" };
}

export async function getOnesignalAppId(): Promise<string> {
  return (await onesignalConfig()).app_id;
}

const TIER_RANK: Record<string, number> = { OFF: 0, HOURLY_ONLY: 1, HOURLY_PLUS_RESULTS: 2, ALL_UPDATES: 3 };
const EVENT_MIN_TIER: Record<string, string> = {
  TRACKING_STARTED: "HOURLY_ONLY",
  HALF_R_REACHED: "HOURLY_PLUS_RESULTS",
  TIMEOUT_60M: "HOURLY_PLUS_RESULTS",
  OUTLOOK_PUBLISHED: "HOURLY_ONLY",
  TP1_HIT: "HOURLY_PLUS_RESULTS",
  TP2_HIT: "HOURLY_PLUS_RESULTS",
  TP3_HIT: "HOURLY_PLUS_RESULTS",
  SL_HIT: "HOURLY_PLUS_RESULTS",
  AUTOMATED_TRADE_RESULT: "HOURLY_PLUS_RESULTS",
};

export const NOTIFICATION_CATEGORIES = ["TRADES", "MARKET_OUTLOOK", "SIGNALS", "LICENSE", "BOT_UPDATES", "PAYMENTS", "SYSTEM", "SUPPORT"];
const EVENT_CATEGORY: Record<string, string> = {
  OUTLOOK_PUBLISHED: "MARKET_OUTLOOK",
  TRACKING_STARTED: "MARKET_OUTLOOK",
  HALF_R_REACHED: "SIGNALS",
  TIMEOUT_60M: "SIGNALS",
  TP1_HIT: "SIGNALS",
  TP2_HIT: "SIGNALS",
  TP3_HIT: "SIGNALS",
  SL_HIT: "SIGNALS",
  TRADE_OPENED: "TRADES",
  TRADE_CLOSED: "TRADES",
  AUTOMATED_TRADE_RESULT: "TRADES",
};

export function notificationCategory(event: string): string {
  return EVENT_CATEGORY[event] ?? "SYSTEM";
}

function categoryMuted(prefs: Record<string, unknown>, category: string): boolean {
  const muted = (prefs["muted_categories"] as string[] | undefined) ?? [];
  return muted.includes(category);
}

function idempotencyKey(outlookId: string, event: string, userId: string): string {
  return `${event}:${outlookId}:${userId}`;
}

/** Port of notifications.py:133 `_build_payload`. */
function buildPayload(doc: Record<string, unknown>, event: string): Record<string, unknown> {
  const direction = doc["primary_direction"] ?? "NO_VALID_OUTLOOK";
  const confidence = doc["confidence_pct"] ?? 0;
  const deepLink = `/ai-market-outlook?outlook_id=${doc["id"]}`;

  const signalTime = doc["published_at"] ?? doc["generated_at"];
  const entry = doc["tracking_entry_price"];
  const eventSnapshots = (doc["event_snapshots"] as Record<string, Record<string, unknown>> | undefined) ?? {};
  const snapshot = eventSnapshots[event] ?? {};
  const eventAtFallbacks: Record<string, unknown> = {
    HALF_R_REACHED: doc["first_half_r_at"],
    TP1_HIT: doc["tp1_hit_at"],
    TP2_HIT: doc["tp2_hit_at"],
    TP3_HIT: doc["tp3_hit_at"],
    SL_HIT: doc["sl_hit_at"],
    TIMEOUT_60M: doc["evaluation_deadline"],
  };
  const eventAt = snapshot["event_at"] ?? eventAtFallbacks[event] ?? signalTime;
  const hitPrice = "hit_price" in snapshot ? snapshot["hit_price"] : doc["last_tracked_price"];
  const achievedR = "achieved_r" in snapshot ? snapshot["achieved_r"] : doc["current_r"];
  const timedOut =
    ["LOSS", "PARTIAL_PROFIT", "BREAK_EVEN"].includes(String(doc["analytics_outcome"])) &&
    ["LOSS_RED_TIMEOUT", "PARTIAL_PROFIT", "BREAK_EVEN"].includes(String(doc["signal_state"]));

  let title = "XauCloud";
  let body = event;

  if (event === "TRACKING_STARTED") {
    title = `${direction} outlook tracking started`;
    body = `Signal ${signalTime} · entry ${entry} · Bid ${doc["published_bid"]} · Ask ${doc["published_ask"]}`;
  } else if (event === "HALF_R_REACHED") {
    title = timedOut ? `${direction} outlook reached late +0.50R` : `${direction} outlook reached +0.50R`;
    const lateText = timedOut ? " after its 60-minute deadline" : "";
    body = `Signal ${signalTime} reached +0.50R${lateText} at ${eventAt} · entry ${entry} · hit ${hitPrice} · R ${achievedR}`;
  } else if (event === "TIMEOUT_60M") {
    const outcome = doc["analytics_outcome"];
    const conversion = buildResultConversion({ r: achievedR as number | null, risk_distance: doc["risk_distance"] as number | null | undefined });
    const resultText =
      conversion.result_pips === null
        ? `${achievedR}R`
        : `${conversion.result_pips} pips / ${conversion.result_gold_moves} Gold moves / ${conversion.result_r}R`;
    if (outcome === "PARTIAL_PROFIT") {
      title = `${direction} outlook closed PARTIAL PROFIT`;
      body = `Signal ${signalTime} closed positive but below TP1 at ${eventAt} · entry ${entry} · last ${hitPrice} · ${resultText}`;
    } else if (outcome === "BREAK_EVEN") {
      title = `${direction} outlook closed BREAK-EVEN`;
      body = `Signal ${signalTime} closed near entry at ${eventAt} · entry ${entry} · last ${hitPrice} · ${resultText}`;
    } else {
      title = `${direction} outlook missed the 60-minute target`;
      body = `Signal ${signalTime} closed negative within 60 minutes · entry ${entry} · last ${hitPrice} · ${resultText}`;
    }
  } else if (event === "OUTLOOK_PUBLISHED") {
    if (["NO_VALID_OUTLOOK", "NEUTRAL", "RANGE", "TRANSITION"].includes(String(direction))) {
      title = "XauCloud — Hourly Outlook";
      body = `No trade right now. Market regime: ${doc["market_regime"] ?? direction}. Evidence strength: ${doc["evidence_strength_pct"] ?? 0}%`;
    } else {
      title = "XauCloud — Hourly Outlook";
      body =
        `${direction} outlook · ${confidence}% confidence\n` +
        `Entry: ${doc["preferred_entry_zone_low"]}–${doc["preferred_entry_zone_high"]}\n` +
        `SL: ${doc["suggested_sl"]} | TP1: ${doc["tp1_price"]} TP2: ${doc["tp2_price"]} TP3: ${doc["tp3_price"]}`;
    }
  } else if ((event === "TP1_HIT" || event === "TP2_HIT") && timedOut) {
    title = "XAU Outlook Late Path Event";
    body = `Signal ${signalTime} hit ${event.replace("_HIT", "")} after its 60-minute deadline at ${eventAt} · entry ${entry} · hit ${hitPrice} · R ${achievedR}`;
  } else if (event === "TP1_HIT" || event === "TP2_HIT") {
    const tpNumber = event === "TP1_HIT" ? "1" : "2";
    const tpPrice = doc[`tp${tpNumber}_price`];
    const fixedPips = tpNumber === "1" ? 50 : 100;
    const fixedGold = tpNumber === "1" ? 5.0 : 10.0;
    const fixedR = tpNumber === "1" ? 0.5 : 1.0;
    title = `XauCloud Outlook TP${tpNumber} reached`;
    body = `${direction} · entry ${entry} · TP${tpNumber} ${tpPrice} · +${fixedPips} pips · +${fixedGold.toFixed(2)} Gold moves · +${fixedR.toFixed(2)}R · touched at ${eventAt}`;
  } else if (event === "TP3_HIT") {
    title = timedOut ? "XAU Outlook Late Path Event" : "XAU Outlook Result";
    const lateText = timedOut ? " after its 60-minute deadline" : "";
    body = `Signal ${signalTime} hit TP3${lateText} at ${eventAt} · entry ${entry} · hit ${hitPrice} · R ${achievedR ?? doc["tp3_r"]}`;
  } else if (event === "SL_HIT") {
    title = timedOut ? "XAU Outlook Late Path Event" : "XAU Outlook Result";
    const lateText = timedOut ? " after its 60-minute deadline" : "";
    body = `Signal ${signalTime} hit SL${lateText} at ${eventAt} · entry ${entry} · hit ${hitPrice} · R ${achievedR}`;
  }

  return { title, body, deep_link: deepLink, outlook_id: doc["id"], event };
}

export const SERVER_NOT_CONFIGURED = "SERVER_NOT_CONFIGURED";
export const NO_ACTIVE_ONESIGNAL_RECIPIENT = "NO_ACTIVE_ONESIGNAL_RECIPIENT";
export const NO_DEVICE_REGISTERED = NO_ACTIVE_ONESIGNAL_RECIPIENT;
export const AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED";
export const INVALID_PAYLOAD = "INVALID_PAYLOAD";
export const TEMPORARY_DELIVERY_FAILURE = "TEMPORARY_DELIVERY_FAILURE";
export const UNKNOWN_FAILURE = "UNKNOWN_FAILURE";
export const RETRYABLE_FAILURES = new Set([SERVER_NOT_CONFIGURED, AUTHENTICATION_FAILED, INVALID_PAYLOAD, TEMPORARY_DELIVERY_FAILURE, UNKNOWN_FAILURE]);

export const REGISTRATION_VERSION = "onesignal-web-v16-device-v1";

function cleanText(value: unknown, limit = 240): string {
  return String(value ?? "").trim().slice(0, limit);
}

function deviceIsComplete(doc: Record<string, unknown> | null | undefined): boolean {
  const d = doc ?? {};
  return Boolean(
    (d["active"] ?? true) &&
      d["opted_in"] === true &&
      d["token_present"] === true &&
      cleanText(d["permission_state"], 24) === "granted" &&
      cleanText(d["onesignal_subscription_id"]) &&
      cleanText(d["onesignal_id"]) &&
      cleanText(d["external_id"]),
  );
}

function maskedId(value: unknown): string {
  const text = cleanText(value);
  if (!text) return "";
  if (text.length <= 10) return `${text.slice(0, 3)}…${text.slice(-2)}`;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

async function ensureDeviceIndex(): Promise<void> {
  try {
    await getDb()
      .collection("cloud_push_subscriptions")
      .createIndex(
        { user_id: 1, onesignal_subscription_id: 1 },
        { unique: true, name: "uniq_user_onesignal_subscription", partialFilterExpression: { onesignal_subscription_id: { $type: "string" } } },
      );
  } catch {
    /* best-effort */
  }
}

export function validateDeviceRegistration(payload: Record<string, unknown>, authenticatedUserId: string): [boolean, string, string] {
  const subscriptionId = cleanText(payload["onesignal_subscription_id"]);
  const onesignalId = cleanText(payload["onesignal_id"]);
  const externalId = cleanText(payload["external_id"]);
  const permission = cleanText(payload["permission_state"], 24);
  const optedIn = payload["opted_in"] === true;
  const tokenPresent = payload["token_present"] === true;

  if (externalId !== String(authenticatedUserId)) return [false, "EXTERNAL_ID_MISMATCH", "OneSignal External ID does not match the authenticated user."];
  if (!subscriptionId) return [false, "SUBSCRIPTION_ID_MISSING", "OneSignal did not provide a device Subscription ID."];
  if (!onesignalId) return [false, "ONESIGNAL_ID_MISSING", "OneSignal did not provide a user ID."];
  if (permission !== "granted") return [false, "PERMISSION_NOT_GRANTED", "Browser notification permission is not granted."];
  if (!optedIn) return [false, "SUBSCRIPTION_NOT_OPTED_IN", "OneSignal reports that this device is not opted in."];
  if (!tokenPresent) return [false, "PUSH_TOKEN_MISSING", "OneSignal has not created a push token for this device."];
  return [true, "DEVICE_VALID", "Device registration is complete."];
}

export async function upsertDeviceRegistration(authenticatedUserId: string, payload: Record<string, unknown>, userAgent = ""): Promise<Record<string, unknown>> {
  const [valid, code, message] = validateDeviceRegistration(payload, authenticatedUserId);
  if (!valid) return { ok: false, code, message };

  await ensureDeviceIndex();
  const db = getDb();
  const nowIso = new Date().toISOString();
  const subscriptionId = cleanText(payload["onesignal_subscription_id"]);
  const deviceInstanceId = cleanText(payload["device_instance_id"]);

  if (deviceInstanceId) {
    await db.collection("cloud_push_subscriptions").updateMany(
      { user_id: authenticatedUserId, device_instance_id: deviceInstanceId, onesignal_subscription_id: { $ne: subscriptionId }, active: true },
      { $set: { active: false, opted_in: false, updated_at: nowIso, deactivated_reason: "SUBSCRIPTION_REPLACED" } },
    );
  }

  const query = { user_id: authenticatedUserId, onesignal_subscription_id: subscriptionId };
  const existing = await db.collection("cloud_push_subscriptions").findOne(query);
  const record: Record<string, unknown> = {
    user_id: authenticatedUserId,
    onesignal_subscription_id: subscriptionId,
    onesignal_id: cleanText(payload["onesignal_id"]),
    external_id: authenticatedUserId,
    device_instance_id: deviceInstanceId,
    opted_in: true,
    token_present: true,
    permission_state: "granted",
    active: true,
    device_label: cleanText(payload["device_label"], 160),
    user_agent: cleanText(userAgent || payload["user_agent"], 300),
    platform: cleanText(payload["platform"], 80),
    browser: cleanText(payload["browser"], 80),
    timezone_offset_minutes: Number(payload["timezone_offset_minutes"] ?? 0) || 0,
    service_worker_scope: cleanText(payload["service_worker_scope"], 160),
    registration_version: cleanText(payload["registration_version"], 80) || REGISTRATION_VERSION,
    registration_state: "COMPLETE",
    updated_at: nowIso,
    last_seen_at: nowIso,
  };

  let deviceId: string;
  let created: boolean;
  if (existing) {
    deviceId = String(existing["id"] ?? randomUUID());
    record["id"] = deviceId;
    await db.collection("cloud_push_subscriptions").updateOne(query, { $set: record });
    created = false;
  } else {
    deviceId = randomUUID();
    record["id"] = deviceId;
    record["created_at"] = nowIso;
    record["last_test_status"] = null;
    record["last_test_at"] = null;
    await db.collection("cloud_push_subscriptions").insertOne({ ...record });
    created = true;
  }

  return {
    ok: true,
    code: "DEVICE_REGISTERED",
    message: "OneSignal device registration stored.",
    device_id: deviceId,
    created,
    active_device_count: await countCompleteActiveDevices(authenticatedUserId),
  };
}

export async function deactivateDeviceRegistration(authenticatedUserId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const clauses: Record<string, unknown>[] = [];
  const subscriptionId = cleanText(payload["onesignal_subscription_id"]);
  const deviceInstanceId = cleanText(payload["device_instance_id"]);
  if (subscriptionId) clauses.push({ onesignal_subscription_id: subscriptionId });
  if (deviceInstanceId) clauses.push({ device_instance_id: deviceInstanceId });
  const query: Record<string, unknown> = { user_id: authenticatedUserId };
  if (clauses.length > 0) query["$or"] = clauses;
  const result = await db.collection("cloud_push_subscriptions").updateMany(query, {
    $set: { active: false, opted_in: false, updated_at: nowIso, deactivated_reason: "USER_LOGOUT" },
  });
  return { ok: true, deactivated: result.modifiedCount };
}

export async function completeActiveDevices(userId: string): Promise<Record<string, unknown>[]> {
  const rows = await getDb()
    .collection("cloud_push_subscriptions")
    .find({ user_id: userId, active: true, opted_in: true }, { projection: { _id: 0 } })
    .sort({ last_seen_at: -1 })
    .limit(100)
    .toArray();
  return rows.filter((row) => deviceIsComplete(row));
}

export async function countCompleteActiveDevices(userId: string): Promise<number> {
  return (await completeActiveDevices(userId)).length;
}

interface SendResult {
  ok: boolean;
  failureClass: string | null;
  provider: Record<string, unknown>;
}

// OneSignal has been removed as the push provider. Every push now routes
// through the app's own first-party Web Push (VAPID) subscriptions. Kept the
// SendResult shape so all existing callers are unchanged.
async function sendUserPush(userId: string, payload: Record<string, unknown>): Promise<SendResult> {
  try {
    const sent = await sendWebPushToUser(String(userId), {
      title: String(payload["title"] ?? "XauCloud"),
      body: String(payload["body"] ?? ""),
      deep_link: String(payload["deep_link"] ?? (payload["outlook_id"] ? "/ai-market-outlook" : "/command/dashboard")),
      category: String(payload["category"] ?? notificationCategory(String(payload["event"] ?? ""))),
    });
    if (sent > 0) return { ok: true, failureClass: null, provider: { channel: "web_push", sent } };
    return { ok: false, failureClass: NO_ACTIVE_ONESIGNAL_RECIPIENT, provider: { channel: "web_push", sent: 0 } };
  } catch {
    return { ok: false, failureClass: TEMPORARY_DELIVERY_FAILURE, provider: { channel: "web_push", error: "send_failed" } };
  }
}

const HEARTBEAT_STALE_SECONDS = 90;

/** Port of notifications.py:515 `_market_open_and_bot_connected`. */
async function marketOpenAndBotConnected(account: string, now: Date = new Date()): Promise<[boolean, string]> {
  const weekday = (now.getUTCDay() + 6) % 7; // Monday=0 .. Sunday=6
  const marketClosed = weekday === 5 || (weekday === 4 && now.getUTCHours() >= 21) || (weekday === 6 && now.getUTCHours() < 21);
  if (marketClosed) return [false, "MARKET_CLOSED_WEEKEND"];
  if (!account) return [false, "NO_ACCOUNT_CONTEXT"];

  const hb = await getDb().collection("cloud_bot_heartbeats").findOne({ account_number: account }, { projection: { _id: 0, ts: 1 }, sort: { ts: -1 } });
  const hbTs = hb?.["ts"];
  const hbTime = typeof hbTs === "string" ? new Date(hbTs) : null;
  const ageSec = hbTime && !Number.isNaN(hbTime.getTime()) ? (now.getTime() - hbTime.getTime()) / 1000 : null;
  if (ageSec === null || ageSec > HEARTBEAT_STALE_SECONDS) return [false, "BOT_OFFLINE_NO_HEARTBEAT"];
  return [true, ""];
}

/** Port of notifications.py:563 `send_outlook_notification`. */
export async function sendOutlookNotification(doc: Record<string, unknown>, event: string, minTier: string): Promise<number | null> {
  try {
    const db = getDb();
    const account = String(doc["account"] ?? "");
    const outlookId = String(doc["id"] ?? "");

    const [allowed] = await marketOpenAndBotConnected(account);
    if (!allowed) return null;

    const prefsCursor = db.collection("cloud_notification_prefs").find({ account });
    let sent = 0;
    for await (const prefs of prefsCursor) {
      const userId = String(prefs["user_id"] ?? "");
      const tier = String(prefs["tier"] ?? "OFF");
      const requiredTier = EVENT_MIN_TIER[event] ?? minTier;
      if ((TIER_RANK[tier] ?? 0) < (TIER_RANK[requiredTier] ?? 99)) continue;
      if (categoryMuted(prefs, notificationCategory(event))) continue;

      const idemKey = idempotencyKey(outlookId, event, userId);
      const already = await db.collection("cloud_notification_log").findOne({ idempotency_key: idemKey });
      if (already && (already["delivery_status"] === "SENT" || !RETRYABLE_FAILURES.has(String(already["failure_reason"])))) continue;

      const payload = buildPayload(doc, event);
      const devices = await completeActiveDevices(userId);
      const logEntry: Record<string, unknown> = {
        id: already?.["id"] ?? randomUUID(),
        idempotency_key: idemKey,
        user_id: userId,
        outlook_id: outlookId,
        notification_type: event,
        category: notificationCategory(event),
        title: payload["title"],
        body: payload["body"],
        scheduled_time: already?.["scheduled_time"] ?? new Date().toISOString(),
        sent_time: null,
        delivery_status: "PENDING",
        opened_time: null,
        read_at: already?.["read_at"] ?? null,
        device_count: devices.length,
        retry_count: Number(already?.["retry_count"] ?? 0),
        failure_reason: null,
      };
      if (devices.length === 0) {
        logEntry["delivery_status"] = "NO_DEVICE";
        logEntry["failure_reason"] = "SUBSCRIPTION_MISSING";
      } else {
        const { ok, failureClass, provider } = await sendUserPush(userId, payload);
        Object.assign(logEntry, {
          sent_time: new Date().toISOString(),
          delivery_status: ok ? "SENT" : "FAILED",
          failure_reason: ok ? null : (failureClass ?? UNKNOWN_FAILURE),
          provider_http_status: provider["http_status"],
          provider_message_id: provider["message_id"],
          provider_errors: provider["errors"],
          provider_warnings: provider["warnings"],
        });
        if (ok) sent += 1;
      }
      if (already) {
        logEntry["retry_count"] = Number(already["retry_count"] ?? 0) + 1;
        await db.collection("cloud_notification_log").updateOne({ idempotency_key: idemKey }, { $set: logEntry });
      } else {
        await db.collection("cloud_notification_log").insertOne({ ...logEntry });
      }
    }
    return sent;
  } catch {
    return null;
  }
}

function fmtNumber(value: unknown, digits = 2): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Port of notifications.py:637 `_build_automated_trade_payload`. */
function buildAutomatedTradePayload(doc: Record<string, unknown>): Record<string, unknown> {
  const result = (doc["automated_trade_result"] as Record<string, unknown> | undefined) ?? {};
  const outcome = String(result["result"] ?? "");
  const direction = result["direction"] ?? doc["primary_direction"] ?? "";
  const symbol = result["symbol"] ?? doc["symbol"] ?? "XAUUSD";
  const profitRaw = result["realized_profit"];
  const resultPips = fmtNumber(result["result_pips"], 1);
  const entry = result["entry_price"];
  const exitPrice = result["exit_price"];
  const closeReason = result["close_reason"] ?? "";
  const deepLink = `/ai-market-outlook?outlook_id=${doc["id"]}`;

  const icon: Record<string, string> = { TP_HIT: "✅", WIN: "✅", SL_HIT: "❌", LOSS: "❌", BREAK_EVEN: "➖" };
  const label: Record<string, string> = { TP_HIT: "hit take-profit", SL_HIT: "hit stop-loss", WIN: "closed in profit", LOSS: "closed at a loss", BREAK_EVEN: "closed break-even" };
  const title = `${icon[outcome] ?? "📊"} ${direction} ${symbol} automated trade ${label[outcome] ?? "closed"}`;

  const parts: string[] = [];
  const numericProfit = Number(profitRaw);
  if (Number.isFinite(numericProfit)) {
    parts.push(`P/L ${numericProfit >= 0 ? `+$${numericProfit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-$${Math.abs(numericProfit).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}`);
  }
  if (resultPips) parts.push(`${resultPips} pips`);
  if (entry !== undefined && entry !== null) parts.push(`Entry ${entry}`);
  if (exitPrice !== undefined && exitPrice !== null) parts.push(`Exit ${exitPrice}`);
  if (closeReason) parts.push(String(closeReason));
  if (result["ticket"]) parts.push(`Ticket ${result["ticket"]}`);
  const body = parts.length > 0 ? parts.join(" · ") : "Your automated trade result has been confirmed by your broker.";

  return { title, body, deep_link: deepLink, outlook_id: doc["id"], event: "AUTOMATED_TRADE_RESULT" };
}

/** Port of notifications.py:685 `send_automated_trade_result_notification` -- never suppressed by market-open/bot-heartbeat gate. */
export async function sendAutomatedTradeResultNotification(doc: Record<string, unknown>): Promise<number | null> {
  try {
    const db = getDb();
    const account = String(doc["account"] ?? "");
    const outlookId = String(doc["id"] ?? "");
    const event = "AUTOMATED_TRADE_RESULT";
    const prefsCursor = db.collection("cloud_notification_prefs").find({ account });
    let sent = 0;
    for await (const prefs of prefsCursor) {
      const userId = String(prefs["user_id"] ?? "");
      const tier = String(prefs["tier"] ?? "OFF");
      const requiredTier = EVENT_MIN_TIER[event] ?? "HOURLY_PLUS_RESULTS";
      if ((TIER_RANK[tier] ?? 0) < (TIER_RANK[requiredTier] ?? 99)) continue;
      if (categoryMuted(prefs, notificationCategory(event))) continue;

      const idemKey = idempotencyKey(outlookId, event, userId);
      const already = await db.collection("cloud_notification_log").findOne({ idempotency_key: idemKey });
      if (already && (already["delivery_status"] === "SENT" || !RETRYABLE_FAILURES.has(String(already["failure_reason"])))) continue;

      const payload = buildAutomatedTradePayload(doc);
      const devices = await completeActiveDevices(userId);
      const logEntry: Record<string, unknown> = {
        id: already?.["id"] ?? randomUUID(),
        idempotency_key: idemKey,
        user_id: userId,
        outlook_id: outlookId,
        notification_type: event,
        category: notificationCategory(event),
        title: payload["title"],
        body: payload["body"],
        scheduled_time: already?.["scheduled_time"] ?? new Date().toISOString(),
        sent_time: null,
        delivery_status: "PENDING",
        opened_time: null,
        read_at: already?.["read_at"] ?? null,
        device_count: devices.length,
        retry_count: Number(already?.["retry_count"] ?? 0),
        failure_reason: null,
      };
      if (devices.length === 0) {
        logEntry["delivery_status"] = "NO_DEVICE";
        logEntry["failure_reason"] = "SUBSCRIPTION_MISSING";
      } else {
        const { ok, failureClass, provider } = await sendUserPush(userId, payload);
        Object.assign(logEntry, {
          sent_time: new Date().toISOString(),
          delivery_status: ok ? "SENT" : "FAILED",
          failure_reason: ok ? null : (failureClass ?? UNKNOWN_FAILURE),
          provider_http_status: provider["http_status"],
          provider_message_id: provider["message_id"],
          provider_errors: provider["errors"],
          provider_warnings: provider["warnings"],
        });
        if (ok) sent += 1;
      }
      if (already) {
        logEntry["retry_count"] = Number(already["retry_count"] ?? 0) + 1;
        await db.collection("cloud_notification_log").updateOne({ idempotency_key: idemKey }, { $set: logEntry });
      } else {
        await db.collection("cloud_notification_log").insertOne({ ...logEntry });
      }
    }
    return sent;
  } catch {
    return null;
  }
}

const BROKER_SUCCESS_RETCODES = new Set([10008, 10009, 10010]);

function activityValue(activity: Record<string, unknown>, ...names: string[]): unknown {
  const details = (activity["details"] as Record<string, unknown> | undefined) ?? {};
  for (const name of names) {
    let value = activity[name];
    if (value === null || value === undefined || value === "") value = details[name];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return undefined;
}

/** Port of notifications.py:776 `classify_trade_activity`. */
export function classifyTradeActivity(activity: Record<string, unknown>): string | null {
  const eventType = String(activity["event_type"] ?? "").toUpperCase();
  const category = String(activity["event_category"] ?? "").toLowerCase();
  const ticket = cleanText(activityValue(activity, "ticket", "position_id", "position_ticket"), 80);
  if (!ticket) return null;

  const retcode = activityValue(activity, "broker_retcode");
  if (retcode !== undefined && retcode !== null && retcode !== "") {
    const n = Number(retcode);
    if (!Number.isFinite(n) || !BROKER_SUCCESS_RETCODES.has(n)) return null;
  }

  const finalDecision = String(activityValue(activity, "final_decision") ?? "").toUpperCase();
  const openConfirmed =
    ["EXECUTED", "FILLED", "BROKER_CONFIRMED"].includes(finalDecision) ||
    ["TRADE_EXECUTED", "POSITION_OPENED", "TRADE_OPENED", "EXECUTION_CONFIRMED"].some((t) => eventType.includes(t));
  if (openConfirmed) return "TRADE_OPENED";

  const profit = activityValue(activity, "profit", "net_profit", "realized_profit");
  const closeConfirmed =
    ["TRADE_CLOSED", "POSITION_CLOSED", "CLOSE_CONFIRMED", "DEAL_CLOSED"].some((t) => eventType.includes(t)) ||
    (category === "exits" && Boolean(activityValue(activity, "close_reason_exact", "close_reason")));
  if (closeConfirmed) {
    if (!Number.isFinite(Number(profit))) return null;
    return "TRADE_CLOSED";
  }
  return null;
}

/** Port of notifications.py:821 `build_trade_notification_payload`. */
export function buildTradeNotificationPayload(activity: Record<string, unknown>, event: string): Record<string, unknown> {
  const symbol = cleanText(activity["symbol"] ?? activityValue(activity, "symbol") ?? "XAUUSD", 32);
  const direction = cleanText(activityValue(activity, "position_direction", "direction", "signal_direction"), 12).toUpperCase();
  const ticket = cleanText(activityValue(activity, "ticket", "position_id", "position_ticket"), 80);
  const price = fmtNumber(activityValue(activity, "price", "entry_price", "open_price"));
  const closePrice = fmtNumber(activityValue(activity, "close_price", "price"));
  const lots = fmtNumber(activityValue(activity, "lots", "volume", "lot_size"));
  const sl = fmtNumber(activityValue(activity, "sl", "stop_loss"));
  const tp = fmtNumber(activityValue(activity, "tp", "take_profit"));
  const setup = cleanText(activityValue(activity, "setup", "setup_type", "family"), 80);
  const campaign = cleanText(activityValue(activity, "campaign_id", "campaign"), 80);
  const reason = cleanText(activityValue(activity, "close_reason_exact", "close_reason", "reason"), 140);

  // v6.26.0: customer notifications must show pips/Gold moves, never a bare
  // "R" label -- buildResultConversion derives result_pips from real
  // entry/exit prices when available, falling back to the raw final_r/
  // r_multiple activity field only when prices aren't posted.
  let finalPips: string | null = null;
  const rawEntry = activityValue(activity, "entry_price", "open_price");
  // Deliberately NOT "price" for the entry side: on a TRADE_CLOSED activity
  // record, this event's own "price" field is the CLOSE price -- if
  // entry_price/open_price isn't separately posted, there is no reliable
  // entry price here at all.
  const rawExit = activityValue(activity, "close_price", "price");
  const rawR = activityValue(activity, "final_r", "r_multiple");
  let priceMove: number | null = null;
  if (rawEntry !== null && rawEntry !== undefined && rawExit !== null && rawExit !== undefined && (direction === "BUY" || direction === "SELL")) {
    const entryF = Number(rawEntry);
    const exitF = Number(rawExit);
    if (Number.isFinite(entryF) && Number.isFinite(exitF)) {
      priceMove = direction === "BUY" ? exitF - entryF : entryF - exitF;
    }
  }
  if (priceMove !== null || (rawR !== null && rawR !== undefined)) {
    const rNum = rawR !== null && rawR !== undefined ? Number(rawR) : null;
    if (rNum === null || Number.isFinite(rNum)) {
      const conversion = buildResultConversion({ r: rNum, price_move: priceMove });
      finalPips = fmtNumber(conversion.result_pips, 1);
    }
  }
  const duration = cleanText(activityValue(activity, "duration", "duration_text", "trade_duration"), 60);
  const balance = fmtNumber(activityValue(activity, "balance", "account_balance"));
  const profitRaw = activityValue(activity, "profit", "net_profit", "realized_profit");
  const profit = fmtNumber(profitRaw);

  let title: string;
  let parts: string[];
  if (event === "TRADE_OPENED") {
    const side = direction || "TRADE";
    title = `${side === "BUY" ? "🟢" : side === "SELL" ? "🔴" : "📈"} ${side} ${symbol} opened`;
    parts = [];
    if (price) parts.push(`Entry ${price}`);
    if (lots) parts.push(`Lots ${lots}`);
    if (sl) parts.push(`SL ${sl}`);
    if (tp) parts.push(`TP ${tp}`);
    if (setup) parts.push(setup);
    if (campaign) parts.push(`Campaign ${campaign}`);
    parts.push(`Ticket ${ticket}`);
  } else {
    const numericProfit = Number(profitRaw);
    const icon = numericProfit > 0 ? "✅" : numericProfit < 0 ? "❌" : "➖";
    const outcome = numericProfit > 0 ? "profit" : numericProfit < 0 ? "loss" : "break-even";
    title = `${icon} ${symbol} trade closed — ${outcome}`;
    const signedAmount = numericProfit > 0 ? `+$${profit}` : numericProfit < 0 ? `-$${Math.abs(numericProfit).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
    parts = [`P/L ${signedAmount}`];
    if (direction) parts.push(direction);
    if (closePrice) parts.push(`Close ${closePrice}`);
    if (finalPips) parts.push(`${finalPips} pips`);
    if (duration) parts.push(duration);
    if (reason) parts.push(reason);
    if (balance) parts.push(`Balance $${balance}`);
    parts.push(`Ticket ${ticket}`);
  }

  const activityId = cleanText(activity["id"], 120);
  const notificationKey = `${event}:${activity["account"] ?? ""}:${symbol}:${ticket}`;
  return {
    title,
    body: parts.join(" · "),
    deep_link: `/activity?ticket=${ticket}`,
    outlook_id: null,
    activity_id: activityId,
    ticket,
    event,
    notification_key: notificationKey,
  };
}

/** Port of notifications.py:906 `send_trade_activity_notification`. */
export async function sendTradeActivityNotification(activity: Record<string, unknown>): Promise<number | null> {
  try {
    const event = classifyTradeActivity(activity);
    if (!event) return 0;
    const db = getDb();
    const account = String(activity["account"] ?? "");
    const symbol = String(activity["symbol"] ?? activityValue(activity, "symbol") ?? "XAUUSD");
    const ticket = String(activityValue(activity, "ticket", "position_id", "position_ticket") ?? "");
    const prefsCursor = db.collection("cloud_notification_prefs").find({ account });
    let sent = 0;
    for await (const prefs of prefsCursor) {
      const userId = String(prefs["user_id"] ?? "");
      if (!userId || (TIER_RANK[String(prefs["tier"] ?? "OFF")] ?? 0) < TIER_RANK["ALL_UPDATES"]!) continue;
      if (categoryMuted(prefs, notificationCategory(event))) continue;

      const idemKey = `${event}:${account}:${symbol}:${ticket}:${userId}`;
      const already = await db.collection("cloud_notification_log").findOne({ idempotency_key: idemKey });
      if (already) {
        const status = String(already["delivery_status"] ?? "");
        const failure = already["failure_reason"];
        if (status === "SENT" || status === "NO_DEVICE") continue;
        if (status === "FAILED" && !RETRYABLE_FAILURES.has(String(failure))) continue;
        if (status === "PENDING") {
          const scheduled = new Date(String(already["scheduled_time"] ?? ""));
          if (!Number.isNaN(scheduled.getTime()) && Date.now() - scheduled.getTime() < 2 * 60_000) continue;
        }
      }

      const devices = await completeActiveDevices(userId);
      const nowIso = new Date().toISOString();
      const payload = buildTradeNotificationPayload(activity, event);
      const logEntry: Record<string, unknown> = {
        id: already?.["id"] ?? randomUUID(),
        idempotency_key: idemKey,
        user_id: userId,
        outlook_id: null,
        activity_id: activity["id"],
        account,
        symbol,
        ticket,
        notification_type: event,
        category: notificationCategory(event),
        title: payload["title"],
        body: payload["body"],
        scheduled_time: already?.["scheduled_time"] ?? nowIso,
        sent_time: null,
        delivery_status: "PENDING",
        opened_time: null,
        read_at: already?.["read_at"] ?? null,
        device_count: devices.length,
        retry_count: Number(already?.["retry_count"] ?? 0),
        failure_reason: null,
      };

      if (!already) {
        try {
          await db.collection("cloud_notification_log").insertOne({ ...logEntry });
        } catch {
          continue; // another worker owns this exact trade event (unique index conflict)
        }
      }

      if (devices.length === 0) {
        logEntry["delivery_status"] = "NO_DEVICE";
        logEntry["failure_reason"] = "SUBSCRIPTION_MISSING";
      } else {
        payload["notification_key"] = `${idemKey}:provider`;
        const { ok, failureClass, provider } = await sendUserPush(userId, payload);
        Object.assign(logEntry, {
          sent_time: new Date().toISOString(),
          delivery_status: ok ? "SENT" : "FAILED",
          failure_reason: ok ? null : (failureClass ?? UNKNOWN_FAILURE),
          provider_http_status: provider["http_status"],
          provider_message_id: provider["message_id"],
          provider_errors: provider["errors"],
          provider_warnings: provider["warnings"],
        });
        if (ok) sent += 1;
      }
      if (already) logEntry["retry_count"] = Number(already["retry_count"] ?? 0) + 1;
      await db.collection("cloud_notification_log").updateOne({ idempotency_key: idemKey }, { $set: logEntry });
    }
    return sent;
  } catch {
    return null;
  }
}

/** Port of notifications.py:999 `dispatch_pending_trade_notifications`. */
export async function dispatchPendingTradeNotifications(limit = 100): Promise<number> {
  const db = getDb();
  const rows = await db
    .collection("cloud_notification_log")
    .find(
      {
        notification_type: { $in: ["TRADE_OPENED", "TRADE_CLOSED"] },
        $or: [{ delivery_status: "PENDING" }, { delivery_status: "FAILED", failure_reason: { $in: Array.from(RETRYABLE_FAILURES) } }],
        activity_id: { $ne: null },
      },
      { projection: { _id: 0, activity_id: 1 } },
    )
    .sort({ scheduled_time: 1 })
    .limit(limit)
    .toArray();

  let dispatched = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const activityId = String(row["activity_id"] ?? "");
    if (!activityId || seen.has(activityId)) continue;
    seen.add(activityId);
    const activity = await db.collection("cloud_bot_activity").findOne({ id: activityId }, { projection: { _id: 0 } });
    if (activity) {
      const result = await sendTradeActivityNotification(activity);
      if (result) dispatched += result;
    }
  }
  return dispatched;
}

/** Port of notifications.py:1033 `get_notification_center_page`. */
export async function getNotificationCenterPage(
  userId: string,
  category?: string,
  unreadOnly = false,
  page = 1,
  limit = 20,
): Promise<Record<string, unknown>> {
  const db = getDb();
  const query: Record<string, unknown> = { user_id: userId, delivery_status: { $in: ["SENT", "NO_DEVICE", "PENDING", "FAILED"] } };
  if (category && category !== "ALL") query["category"] = category;
  if (unreadOnly) query["read_at"] = null;
  const p = Math.max(1, page);
  const n = Math.max(1, Math.min(limit, 100));
  const notificationLog = db.collection("cloud_notification_log");
  const total = await notificationLog.countDocuments(query);
  const unreadTotal = await notificationLog.countDocuments({ ...query, read_at: null });
  const rows = await notificationLog
    .find(query, { projection: { _id: 0 } })
    .sort({ scheduled_time: -1 })
    .skip((p - 1) * n)
    .limit(n)
    .toArray();

  const categoryCounts: Record<string, { total: number; unread: number }> = {};
  for (const cat of NOTIFICATION_CATEGORIES) {
    const catQuery = { user_id: userId, category: cat };
    categoryCounts[cat] = {
      total: await notificationLog.countDocuments(catQuery),
      unread: await notificationLog.countDocuments({ ...catQuery, read_at: null }),
    };
  }
  return { items: rows, page: p, limit: n, total, unread_total: unreadTotal, has_more: p * n < total, category_counts: categoryCounts };
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  const result = await getDb()
    .collection("cloud_notification_log")
    .updateOne({ id: notificationId, user_id: userId, read_at: null }, { $set: { read_at: new Date().toISOString() } });
  return result.modifiedCount > 0;
}

export async function markAllNotificationsRead(userId: string, category?: string): Promise<number> {
  const query: Record<string, unknown> = { user_id: userId, read_at: null };
  if (category && category !== "ALL") query["category"] = category;
  const result = await getDb()
    .collection("cloud_notification_log")
    .updateMany(query, { $set: { read_at: new Date().toISOString() } });
  return result.modifiedCount;
}

export async function sendTestNotification(userId: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const status = await getOnesignalStatus();
  if (!status["configured"]) {
    return { status: "SERVER_NOT_CONFIGURED", message: "OneSignal is not configured. Enter the App ID and REST API Key in Admin settings." };
  }
  const devices = await completeActiveDevices(userId);
  if (devices.length === 0) {
    return { status: "NO_DEVICE", message: "No complete registered device subscription exists for this user." };
  }
  const payload = { title: "XauCloud Test", body: "Phone alerts are working.", deep_link: "/ai-market-outlook", outlook_id: null, event: "TEST_NOTIFICATION" };
  const { ok, failureClass, provider } = await sendUserPush(userId, payload);
  const nowIso = new Date().toISOString();
  const deliveryStatus = ok ? "SENT" : "FAILED";
  await db.collection("cloud_notification_log").insertOne({
    id: randomUUID(),
    idempotency_key: `TEST:${userId}:${nowIso}`,
    user_id: userId,
    outlook_id: null,
    notification_type: "TEST_NOTIFICATION",
    scheduled_time: nowIso,
    sent_time: nowIso,
    delivery_status: deliveryStatus,
    device_count: devices.length,
    retry_count: 0,
    failure_reason: ok ? null : (failureClass ?? UNKNOWN_FAILURE),
    provider_http_status: provider["http_status"],
    provider_message_id: provider["message_id"],
    provider_errors: provider["errors"],
    provider_warnings: provider["warnings"],
  });
  await db.collection("cloud_push_subscriptions").updateMany(
    { user_id: userId, active: true, opted_in: true },
    { $set: { last_test_status: deliveryStatus, last_test_at: nowIso, last_seen_at: nowIso } },
  );
  if (ok) return { status: "SENT", message: "Test notification sent.", provider_message_id: provider["message_id"] };
  if (failureClass === NO_ACTIVE_ONESIGNAL_RECIPIENT) {
    return { status: "NO_DEVICE", code: "NO_ACTIVE_ONESIGNAL_RECIPIENT", message: "OneSignal found no active subscribed recipient for this account. Retry device registration." };
  }
  if (failureClass === AUTHENTICATION_FAILED) return { status: "FAILED", message: "OneSignal rejected the REST API Key. Check Admin settings." };
  return { status: "FAILED", message: `Delivery failed (${failureClass ?? UNKNOWN_FAILURE}).` };
}

export async function getNotificationStatus(userId: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const prefs = await db.collection("cloud_notification_prefs").findOne({ user_id: userId }, { projection: { _id: 0 } });
  const savedTier = prefs?.["tier"] ?? "OFF";
  const allActive = await db
    .collection("cloud_push_subscriptions")
    .find({ user_id: userId, active: { $ne: false }, opted_in: true }, { projection: { _id: 0 } })
    .sort({ last_seen_at: -1 })
    .limit(100)
    .toArray();
  const complete = allActive.filter((row) => deviceIsComplete(row));
  const incomplete = allActive.filter((row) => !deviceIsComplete(row));
  const mostRecent = complete[0] ?? incomplete[0] ?? null;

  const lastLog = await db.collection("cloud_notification_log").findOne({ user_id: userId }, { projection: { _id: 0 }, sort: { scheduled_time: -1 } });
  const registrationAt = mostRecent?.["updated_at"] ?? mostRecent?.["created_at"] ?? "";
  const sentQuery: Record<string, unknown> = { user_id: userId, delivery_status: "SENT" };
  if (registrationAt) sentQuery["scheduled_time"] = { $gte: registrationAt };
  const lastSentOk = await db.collection("cloud_notification_log").findOne(sentQuery, { projection: { _id: 0 }, sort: { scheduled_time: -1 } });
  const onesignalStatus = await getOnesignalStatus();
  const serverReady = Boolean(onesignalStatus["configured"]);

  let finalStatus: string;
  let remediation: string;
  if (savedTier === "OFF") {
    [finalStatus, remediation] = ["OFF", "NONE"];
  } else if (!serverReady) {
    [finalStatus, remediation] = ["SERVER_NOT_CONFIGURED", "CONFIGURE_ONESIGNAL"];
  } else if (complete.length === 0 && incomplete.length > 0) {
    [finalStatus, remediation] = ["REGISTRATION_INCOMPLETE", "RETRY_DEVICE_REGISTRATION"];
  } else if (complete.length === 0) {
    [finalStatus, remediation] = ["SUBSCRIPTION_MISSING", "REGISTER_DEVICE"];
  } else if (lastLog && [NO_ACTIVE_ONESIGNAL_RECIPIENT, NO_DEVICE_REGISTERED].includes(String(lastLog["failure_reason"]))) {
    [finalStatus, remediation] = ["NO_ACTIVE_ONESIGNAL_RECIPIENT", "RETRY_DEVICE_REGISTRATION"];
  } else if (lastLog && lastLog["delivery_status"] === "FAILED") {
    [finalStatus, remediation] = ["DELIVERY_FAILED", "RETRY_TEST"];
  } else if (!lastSentOk) {
    [finalStatus, remediation] = ["READY_NOT_TESTED", "SEND_TEST"];
  } else {
    [finalStatus, remediation] = ["ON_VERIFIED", "NONE"];
  }

  const deviceSummaries = [...complete, ...incomplete].slice(0, 10).map((row) => ({
    device_id: row["id"],
    subscription_id_masked: maskedId(row["onesignal_subscription_id"]),
    onesignal_id_masked: maskedId(row["onesignal_id"]),
    device_label: row["device_label"] ?? "",
    platform: row["platform"] ?? "",
    browser: row["browser"] ?? "",
    registration_state: deviceIsComplete(row) ? "COMPLETE" : "INCOMPLETE",
    last_seen_at: row["last_seen_at"],
    last_test_status: row["last_test_status"],
    last_test_at: row["last_test_at"],
  }));

  return {
    saved_tier: savedTier,
    active_device_count: complete.length,
    incomplete_device_count: incomplete.length,
    registered_devices: deviceSummaries,
    most_recent_registration: registrationAt || null,
    push_server_configured: serverReady,
    push_server_initialization_state: onesignalStatus["initialization_state"],
    latest_notification_status: lastLog?.["delivery_status"] ?? null,
    latest_failure_reason: lastLog?.["failure_reason"] ?? null,
    latest_provider_message_id: lastLog?.["provider_message_id"] ?? null,
    latest_sent_time: lastLog?.["sent_time"] ?? null,
    latest_opened_time: lastLog?.["opened_time"] ?? null,
    final_status: finalStatus,
    remediation_code: remediation,
  };
}
