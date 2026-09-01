import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { rateLimit, requireCloudUser } from "../auth.js";
import { getUserLicense } from "../services/commandLicense.js";
import { getVapidPublicKey, saveSubscription, removeSubscription, sendWebPushToUser } from "../services/webPush.js";
import { registerDeviceToken, removeDeviceToken, sendExpoPushToUser } from "../services/expoPush.js";
import {
  NOTIFICATION_CATEGORIES,
  completeActiveDevices,
  deactivateDeviceRegistration,
  getNotificationCenterPage,
  getNotificationStatus,
  getOnesignalStatus,
  markAllNotificationsRead,
  markNotificationRead,
  sendTestNotification,
  upsertDeviceRegistration,
} from "../services/notifications.js";

const NOTIFICATION_TIERS = ["OFF", "HOURLY_ONLY", "HOURLY_PLUS_RESULTS", "ALL_UPDATES"] as const;

const NotificationPrefsUpdateSchema = z.object({
  tier: z.string().optional().default("HOURLY_PLUS_RESULTS"),
  quiet_hours_start: z.number().nullable().optional(),
  quiet_hours_end: z.number().nullable().optional(),
  notify_all_devices: z.boolean().optional().default(true),
  muted_categories: z.array(z.string()).nullable().optional(),
});

const PushSubscriptionInSchema = z.object({
  onesignal_subscription_id: z.string(),
  onesignal_id: z.string(),
  external_id: z.string(),
  device_instance_id: z.string().optional().default(""),
  device_label: z.string().optional().default(""),
  platform: z.string().optional().default(""),
  browser: z.string().optional().default(""),
  timezone_offset_minutes: z.number().optional().default(0),
  permission_state: z.string(),
  opted_in: z.boolean(),
  token_present: z.boolean(),
  service_worker_scope: z.string().optional().default("/"),
  registration_version: z.string().optional().default("onesignal-web-v16-device-v1"),
});

const PushUnsubscribeInSchema = z.object({
  onesignal_subscription_id: z.string().nullable().optional(),
  device_instance_id: z.string().nullable().optional(),
  external_id: z.string().nullable().optional(),
});

function cloudUser(request: unknown): Record<string, unknown> {
  return (request as { cloudUser: Record<string, unknown> }).cloudUser;
}

/** Port of the pure-notification routes from market_outlook_routes.py (lines 480-615) -- prefs, device registration, center, status, test. */
export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/outlook/notifications/prefs", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUser(request);
    const prefs = await getDb().collection("cloud_notification_prefs").findOne({ user_id: user["id"] }, { projection: { _id: 0 } });
    return { prefs: prefs ?? { user_id: user["id"], tier: "OFF", notify_all_devices: true, muted_categories: [] } };
  });

  app.post("/outlook/notifications/prefs", { preHandler: requireCloudUser }, async (request, reply) => {
    const body = NotificationPrefsUpdateSchema.parse(request.body);
    const user = cloudUser(request);
    const db = getDb();
    if (!(NOTIFICATION_TIERS as readonly string[]).includes(body.tier)) {
      return reply.code(400).send({ detail: `tier must be one of ${NOTIFICATION_TIERS.join(", ")}` });
    }
    if (body.tier !== "OFF" && (await completeActiveDevices(String(user["id"]))).length < 1) {
      return reply.code(409).send({ detail: { code: "SUBSCRIPTION_MISSING", message: "Register and verify this device before enabling notification delivery." } });
    }
    const existing = await db.collection("cloud_notification_prefs").findOne({ user_id: user["id"] }, { projection: { _id: 0 } });
    let mutedCategories: string[];
    if (body.muted_categories != null) {
      const invalid = body.muted_categories.filter((c) => !NOTIFICATION_CATEGORIES.includes(c));
      if (invalid.length > 0) return reply.code(400).send({ detail: `unknown categories: ${invalid.join(", ")}` });
      mutedCategories = body.muted_categories;
    } else {
      mutedCategories = (existing?.["muted_categories"] as string[] | undefined) ?? [];
    }
    const lic = await getUserLicense(user);
    const account = String(lic?.["mt5_account"] ?? "").trim();
    const doc = {
      user_id: user["id"],
      account,
      tier: body.tier,
      quiet_hours_start: body.quiet_hours_start ?? null,
      quiet_hours_end: body.quiet_hours_end ?? null,
      notify_all_devices: body.notify_all_devices,
      muted_categories: mutedCategories,
      updated_at: new Date().toISOString(),
    };
    await db.collection("cloud_notification_prefs").updateOne({ user_id: user["id"] }, { $set: doc }, { upsert: true });
    return { ok: true, prefs: doc };
  });

  app.get("/outlook/notifications/onesignal-app-id", async () => getOnesignalStatus());

  app.get("/outlook/notifications/my-user-id", { preHandler: requireCloudUser }, async (request) => ({ user_id: cloudUser(request)["id"] }));

  // ── First-party Web Push (VAPID) — additive, OneSignal stays as fallback ──
  // Public: the browser needs the VAPID public key to create a subscription.
  app.get("/notifications/web-push/key", async () => ({ public_key: await getVapidPublicKey() }));
  app.post("/notifications/web-push/subscribe", { preHandler: requireCloudUser }, async (request, reply) => {
    const user = cloudUser(request);
    const body = (request.body ?? {}) as { subscription?: Record<string, unknown> };
    const ok = await saveSubscription(String(user["id"]), body.subscription, (request.headers["user-agent"] as string) ?? "");
    if (!ok) return reply.code(400).send({ detail: "Invalid push subscription." });
    return { ok: true };
  });
  app.post("/notifications/web-push/unsubscribe", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUser(request);
    const body = z.object({ endpoint: z.string().url().max(4096) }).strict().parse(request.body ?? {});
    await removeSubscription(body.endpoint, String(user["id"]));
    return { ok: true };
  });
  app.post("/notifications/web-push/test", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUser(request);
    const sent = await sendWebPushToUser(String(user["id"]), { title: "XauCloud", body: "Push notifications are working on this device.", deep_link: "/command/dashboard", category: "SYSTEM" });
    return { ok: true, sent };
  });

  // ── Native (iOS/Android) push via Expo — additive, sits beside VAPID web push, same sendUserPush() fan-out ──
  const DeviceTokenSchema = z.object({ token: z.string().min(10).max(400), platform: z.enum(["ios", "android"]) });
  app.post("/cloud/notifications/device-token", { preHandler: requireCloudUser }, async (request, reply) => {
    const user = cloudUser(request);
    const body = DeviceTokenSchema.parse(request.body);
    await registerDeviceToken(String(user["id"]), body.token, body.platform);
    return reply.code(201).send({ ok: true });
  });
  app.post("/cloud/notifications/device-token/remove", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUser(request);
    const body = z.object({ token: z.string().min(10).max(400) }).parse(request.body);
    await removeDeviceToken(String(user["id"]), body.token);
    return { ok: true };
  });
  app.post("/cloud/notifications/device-token/test", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUser(request);
    const sent = await sendExpoPushToUser(String(user["id"]), { title: "XauCloud", body: "Native push notifications are working on this device." });
    return { ok: true, sent };
  });

  app.post("/outlook/notifications/subscribe", { preHandler: requireCloudUser }, async (request, reply) => {
    const body = PushSubscriptionInSchema.parse(request.body);
    const user = cloudUser(request);
    const userAgent = (request.headers["user-agent"] as string) ?? "";
    const result = await upsertDeviceRegistration(String(user["id"]), body, userAgent);
    if (!result["ok"]) return reply.code(400).send({ detail: { code: result["code"], message: result["message"] } });
    return result;
  });

  app.post("/outlook/notifications/unsubscribe", { preHandler: requireCloudUser }, async (request, reply) => {
    const body = PushUnsubscribeInSchema.parse(request.body);
    const user = cloudUser(request);
    const suppliedExternal = String(body.external_id ?? "").trim();
    if (suppliedExternal && suppliedExternal !== user["id"]) {
      return reply.code(400).send({ detail: { code: "EXTERNAL_ID_MISMATCH", message: "External ID does not match authenticated user." } });
    }
    return deactivateDeviceRegistration(String(user["id"]), body);
  });

  app.delete("/outlook/notifications/subscribe/:device_id", { preHandler: requireCloudUser }, async (request) => {
    const { device_id: deviceId } = request.params as { device_id: string };
    const user = cloudUser(request);
    const nowIso = new Date().toISOString();
    const result = await getDb()
      .collection("cloud_push_subscriptions")
      .updateOne({ id: deviceId, user_id: user["id"] }, { $set: { active: false, opted_in: false, updated_at: nowIso, deactivated_reason: "USER_REQUEST" } });
    return { ok: true, deleted: result.modifiedCount > 0 };
  });

  app.get("/outlook/notifications/history", { preHandler: requireCloudUser }, async (request) => {
    const q = z.object({ limit: z.coerce.number().optional().default(30) }).parse(request.query);
    const user = cloudUser(request);
    const rows = await getDb()
      .collection("cloud_notification_log")
      .find({ user_id: user["id"] }, { projection: { _id: 0 } })
      .sort({ scheduled_time: -1 })
      .limit(Math.min(q.limit, 100))
      .toArray();
    return { log: rows };
  });

  app.get("/notifications/center", { preHandler: requireCloudUser }, async (request, reply) => {
    const q = z
      .object({ category: z.string().nullable().optional(), unread_only: z.coerce.boolean().optional().default(false), page: z.coerce.number().optional().default(1), limit: z.coerce.number().optional().default(20) })
      .parse(request.query);
    const user = cloudUser(request);
    if (q.category && !NOTIFICATION_CATEGORIES.includes(q.category) && q.category !== "ALL") {
      return reply.code(400).send({ detail: `unknown category: ${q.category}` });
    }
    return getNotificationCenterPage(String(user["id"]), q.category ?? undefined, q.unread_only, q.page, q.limit);
  });

  app.post("/notifications/:notification_id/read", { preHandler: requireCloudUser }, async (request) => {
    const { notification_id: notificationId } = request.params as { notification_id: string };
    const user = cloudUser(request);
    const marked = await markNotificationRead(String(user["id"]), notificationId);
    return { ok: true, marked };
  });

  app.post("/notifications/read-all", { preHandler: requireCloudUser }, async (request, reply) => {
    const q = z.object({ category: z.string().nullable().optional() }).parse(request.query);
    const user = cloudUser(request);
    if (q.category && !NOTIFICATION_CATEGORIES.includes(q.category) && q.category !== "ALL") {
      return reply.code(400).send({ detail: `unknown category: ${q.category}` });
    }
    const count = await markAllNotificationsRead(String(user["id"]), q.category ?? undefined);
    return { ok: true, marked: count };
  });

  app.get("/outlook/notifications/status", { preHandler: requireCloudUser }, async (request) => getNotificationStatus(String(cloudUser(request)["id"])));

  app.post("/outlook/notifications/test", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUser(request);
    rateLimit(`notification_test_user:${user["id"]}`, 5, 300);
    return sendTestNotification(String(user["id"]));
  });
}
