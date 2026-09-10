import { getDb } from "../db.js";
import { getSettings } from "./settings.js";

// ── First-party Web Push (VAPID) ──────────────────────────────────────────────
// XauCloud owns push delivery directly through the Web Push protocol.
// No third-party push provider is an authority in this module.
// Delivery is best-effort and dead browser subscriptions are pruned automatically.

let _wp: any = null;
let _wpTried = false;
async function wp(): Promise<any | null> {
  if (_wp || _wpTried) return _wp;
  _wpTried = true;
  try { _wp = (await import("web-push")).default ?? (await import("web-push")); } catch { _wp = null; }
  return _wp;
}

let _keys: { publicKey: string; privateKey: string; subject: string } | null = null;

/** Self-managed VAPID keys — read from admin_settings, generate + persist on first use. */
export async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string; subject: string } | null> {
  if (_keys) return _keys;
  const lib = await wp();
  if (!lib) return null;
  try {
    const s = await getSettings();
    let publicKey = String(s["vapid_public_key"] ?? "").trim();
    let privateKey = String(s["vapid_private_key"] ?? "").trim();
    let subject = String(s["vapid_subject"] ?? s["support_email"] ?? s["smtp_email"] ?? "").trim();
    if (!subject) subject = "support@xaucloud.io";
    if (!subject.startsWith("mailto:") && !subject.startsWith("http")) subject = `mailto:${subject}`;
    if (!publicKey || !privateKey) {
      const gen = lib.generateVAPIDKeys();
      publicKey = gen.publicKey;
      privateKey = gen.privateKey;
      await getDb().collection("admin_settings").updateOne({ key: "main" }, { $set: { vapid_public_key: publicKey, vapid_private_key: privateKey } }, { upsert: true });
    }
    _keys = { publicKey, privateKey, subject };
    return _keys;
  } catch {
    return null;
  }
}

export async function getVapidPublicKey(): Promise<string> {
  const k = await getVapidKeys();
  return k?.publicKey ?? "";
}

const COLL = "web_push_subscriptions";

/** Store/refresh a browser PushSubscription for a user (endpoint is the unique key). */
export async function saveSubscription(userId: string, subscription: Record<string, any> | null | undefined, userAgent = ""): Promise<boolean> {
  try {
    const endpoint = String(subscription?.["endpoint"] ?? "").trim();
    const keys = subscription?.["keys"] ?? {};
    const p256dh = String(keys?.["p256dh"] ?? "").trim();
    const auth = String(keys?.["auth"] ?? "").trim();
    if (!endpoint || !p256dh || !auth) return false;
    await getDb().collection(COLL).updateOne(
      { endpoint },
      {
        $set: { user_id: String(userId), endpoint, p256dh, auth, user_agent: String(userAgent).slice(0, 300), updated_at: new Date().toISOString() },
        $setOnInsert: { created_at: new Date().toISOString() },
      },
      { upsert: true },
    );
    return true;
  } catch {
    return false;
  }
}

export async function removeSubscription(endpoint: string, userId?: string): Promise<void> {
  try {
    if (!endpoint) return;
    const query: Record<string, unknown> = { endpoint: String(endpoint) };
    if (userId) query["user_id"] = String(userId);
    await getDb().collection(COLL).deleteOne(query);
  } catch { /* explicit unsubscribe/prune remains best-effort */ }
} // ASTRA_REPAIR_V2_6287 / 026

export interface WebPushPayload { title: string; body: string; deep_link?: string; tag?: string; category?: string }

/** Best-effort push to every subscription a user has. Never throws; prunes dead (404/410) subs. */
export async function sendWebPushToUser(userId: string, payload: WebPushPayload): Promise<number> {
  const lib = await wp(); const keys = await getVapidKeys();
  if (!lib || !keys) return 0;
  lib.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  const subs = await getDb().collection(COLL).find({ user_id: String(userId) }).toArray();
  if (!subs.length) return 0;
  const body = JSON.stringify({ title: payload.title, body: payload.body, deep_link: payload.deep_link ?? "/command/dashboard", tag: payload.tag ?? payload.category ?? "xaucloud", category: payload.category ?? "SYSTEM" });
  const outcomes = await Promise.allSettled(subs.map(async (sub: any) => {
    try { await lib.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body); return 1; }
    catch (err: any) { if (err?.statusCode === 404 || err?.statusCode === 410) { await removeSubscription(sub.endpoint); return 0; } throw err; }
  }));
  const sent = outcomes.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
  const retryable = outcomes.find((r) => r.status === "rejected");
  if (sent === 0 && retryable?.status === "rejected") throw retryable.reason;
  return sent;
} // ASTRA_REPAIR_V2_6287 / 022
