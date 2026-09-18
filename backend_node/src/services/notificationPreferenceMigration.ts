import { getDb } from "../db.js";

export const NOTIFICATION_PREFS_SCHEMA_VERSION = "xaucloud-notification-prefs-v2-results";

/**
 * One-time compatibility migration for the old generic Home push toggle.
 *
 * That toggle wrote HOURLY_ONLY even though its UI promised Outlook/trade
 * alerts. New writes carry schema_version, so an explicit future choice of
 * HOURLY_ONLY is respected. Only unversioned legacy rows are upgraded.
 */
export async function migrateLegacyNotificationPrefs(now = new Date()): Promise<number> {
  const db = getDb();
  const migrated = await db.collection("cloud_notification_prefs").updateMany(
    { tier: "HOURLY_ONLY", schema_version: { $ne: NOTIFICATION_PREFS_SCHEMA_VERSION } },
    {
      $set: {
        tier: "HOURLY_PLUS_RESULTS",
        schema_version: NOTIFICATION_PREFS_SCHEMA_VERSION,
        results_tier_migrated_at: now.toISOString(),
      },
    },
  );
  await db.collection("cloud_notification_prefs").updateMany(
    { schema_version: { $ne: NOTIFICATION_PREFS_SCHEMA_VERSION } },
    { $set: { schema_version: NOTIFICATION_PREFS_SCHEMA_VERSION } },
  );
  return migrated.modifiedCount;
}
