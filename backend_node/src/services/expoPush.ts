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
const EXPO_TOKEN_PREFIX = "ExponentPushToken";

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
    const json = (await res.json()) as { data?: { status: string }[] };
    const sent = (json.data ?? []).filter((r) => r.status === "ok").length;
    return sent;
  } catch {
    return 0;
  }
}
