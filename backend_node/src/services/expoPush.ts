import { getDb } from "../db.js";

// ── Native mobile push (iOS + Android) via Expo's push service ─────────────
// Expo's push API (https://exp.host/--/api/v2/push/send) fans an
// ExponentPushToken out to APNs (iOS) or FCM (Android) on our behalf — no
// APNs key or FCM server key needs to live in this backend or in the client
// app; Expo holds those credentials on its own infrastructure once the
// mobile project is registered with `eas build:configure`. This mirrors the
// existing first-party VAPID web-push module (webPush.ts) as a second,
// independent delivery channel — sendUserPush() in notifications.ts calls
// both and neither depends on the other.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const EXPO_TOKEN_PREFIX = "ExponentPushToken";
const RECEIPTS_COLLECTION = "cloud_push_receipts";
// Expo only guarantees receipts are available roughly 15 minutes to a few
// hours after send, and drops unclaimed tickets after about a day -- these
// bounds keep the periodic check from querying either too early (receipt
// not ready yet) or for tickets Expo has already discarded.
const RECEIPT_MIN_AGE_MS = 15 * 60_000;
const RECEIPT_MAX_AGE_MS = 20 * 3600_000;
const RECEIPT_BATCH_SIZE = 100; // Expo's own documented per-request cap is 1000; we stay well under it

interface DeviceTokenDoc {
  user_id: string;
  token: string;
  platform: "ios" | "android";
  created_at: string;
  updated_at: string;
}

/** Registers (or refreshes) a device's Expo push token for a customer. Idempotent per token. */
export async function registerDeviceToken(userId: string, token: string, platform: "ios" | "android"): Promise<void> {
  if (!token.startsWith(EXPO_TOKEN_PREFIX)) return; // ignore malformed/foreign tokens rather than storing garbage
  const now = new Date().toISOString();
  await getDb().collection("cloud_device_tokens").updateOne(
    { token },
    { $set: { user_id: userId, token, platform, updated_at: now } satisfies Partial<DeviceTokenDoc>, $setOnInsert: { created_at: now } },
    { upsert: true },
  );
}

/** Removes a device token — called on explicit sign-out so a discarded session stops receiving push. */
export async function removeDeviceToken(userId: string, token: string): Promise<void> {
  await getDb().collection("cloud_device_tokens").deleteOne({ user_id: userId, token });
}

export async function ensurePushReceiptIndexes(): Promise<void> {
  await getDb().collection(RECEIPTS_COLLECTION).createIndex("ticket_id", { unique: true });
  await getDb().collection(RECEIPTS_COLLECTION).createIndex("status");
}

/**
 * Permanent-failure errors Expo returns for a receipt (or, occasionally, an
 * immediate send-time rejection) that mean the token itself is dead and will
 * never succeed again — as opposed to MessageRateExceeded/MessageTooBig,
 * which are about this specific payload, not the token's validity.
 */
const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered", "InvalidCredentials"]);

async function pruneDeadToken(token: string): Promise<void> {
  await getDb().collection("cloud_device_tokens").deleteOne({ token });
}

/**
 * Sends one push payload to every registered device for a user. Best-effort
 * and silent on failure, exactly like the web-push channel it sits beside —
 * a native-push outage must never surface as a broken notification event
 * for the caller (Outlook/M10/trade-result triggers already treat push as
 * fire-and-forget).
 */
export async function sendExpoPushToUser(userId: string, payload: { title: string; body: string; data?: Record<string, unknown> }): Promise<number> {
  const devices = await getDb()
    .collection("cloud_device_tokens")
    .find({ user_id: userId }, { projection: { _id: 0, token: 1 } })
    .toArray();
  if (devices.length === 0) return 0;

  const messages = devices.map((d) => ({
    to: String(d["token"]),
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: "default",
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { data?: { status: string; id?: string; details?: { error?: string } }[] };
    const tickets = json.data ?? [];

    // "SENT" in cloud_notification_log only ever meant "Expo's send API
    // accepted the request" (this loop) -- it was never a delivery
    // confirmation. Persist each accepted ticket so checkExpoPushReceipts
    // can later ask Expo what actually happened, and prune any token Expo
    // already told us at send-time is dead (no need to wait for a receipt).
    const nowIso = new Date().toISOString();
    const pending: { ticket_id: string; token: string; user_id: string; sent_at: string; status: "pending" }[] = [];
    const deadTokens: string[] = [];
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const token = String(devices[i]?.["token"] ?? "");
      if (!token) continue;
      if (ticket?.status === "ok" && ticket.id) {
        pending.push({ ticket_id: ticket.id, token, user_id: userId, sent_at: nowIso, status: "pending" });
      } else if (ticket?.status === "error" && ticket.details?.error && DEAD_TOKEN_ERRORS.has(ticket.details.error)) {
        deadTokens.push(token);
      }
    }
    // Best-effort: a receipts-collection write/prune failure (including a
    // synchronous throw from getDb() itself) must never turn a
    // successfully-sent push into a reported failure for the caller.
    try {
      if (pending.length > 0) {
        await Promise.all(pending.map((doc) =>
          getDb().collection(RECEIPTS_COLLECTION).updateOne({ ticket_id: doc.ticket_id }, { $setOnInsert: doc }, { upsert: true }),
        ));
      }
      if (deadTokens.length > 0) {
        await Promise.all(deadTokens.map((token) => pruneDeadToken(token)));
      }
    } catch {
      /* the push itself already succeeded -- receipt tracking is a bonus, not a requirement */
    }

    return pending.length;
  } catch {
    return 0;
  }
}

interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/**
 * Periodic follow-up to sendExpoPushToUser: asks Expo what actually
 * happened to tickets it accepted RECEIPT_MIN_AGE_MS-RECEIPT_MAX_AGE_MS ago.
 * Updates each cloud_push_receipts doc with the real outcome, and prunes any
 * device token whose receipt reveals it's permanently dead
 * (DeviceNotRegistered/InvalidCredentials) -- closing the "stale token still
 * targeted on every future push" gap. Best-effort throughout: a receipt-check
 * failure must never affect live notification sending.
 */
export async function checkExpoPushReceipts(): Promise<{ checked: number; delivered: number; failed: number; pruned: number }> {
  const now = Date.now();
  const rows = await getDb()
    .collection(RECEIPTS_COLLECTION)
    .find(
      { status: "pending", sent_at: { $gte: new Date(now - RECEIPT_MAX_AGE_MS).toISOString(), $lte: new Date(now - RECEIPT_MIN_AGE_MS).toISOString() } },
      { projection: { _id: 0, ticket_id: 1, token: 1 } },
    )
    .limit(RECEIPT_BATCH_SIZE)
    .toArray();
  if (rows.length === 0) return { checked: 0, delivered: 0, failed: 0, pruned: 0 };

  const ticketIds = rows.map((r) => String(r["ticket_id"]));
  let delivered = 0;
  let failed = 0;
  let pruned = 0;
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids: ticketIds }),
    });
    if (!res.ok) return { checked: 0, delivered: 0, failed: 0, pruned: 0 };
    const json = (await res.json()) as { data?: Record<string, ExpoReceipt> };
    const receipts = json.data ?? {};
    const checkedAt = new Date().toISOString();

    for (const row of rows) {
      const ticketId = String(row["ticket_id"]);
      const token = String(row["token"]);
      const receipt = receipts[ticketId];
      if (!receipt) continue; // Expo hasn't produced this one yet -- leave pending, retry next cycle
      if (receipt.status === "ok") {
        delivered += 1;
        await getDb().collection(RECEIPTS_COLLECTION).updateOne({ ticket_id: ticketId }, { $set: { status: "delivered", checked_at: checkedAt } });
      } else {
        failed += 1;
        const error = receipt.details?.error ?? receipt.message ?? "unknown";
        await getDb().collection(RECEIPTS_COLLECTION).updateOne({ ticket_id: ticketId }, { $set: { status: "failed", error, checked_at: checkedAt } });
        if (DEAD_TOKEN_ERRORS.has(error)) {
          await pruneDeadToken(token);
          pruned += 1;
        }
      }
    }
  } catch {
    return { checked: 0, delivered: 0, failed: 0, pruned: 0 };
  }
  return { checked: rows.length, delivered, failed, pruned };
}
