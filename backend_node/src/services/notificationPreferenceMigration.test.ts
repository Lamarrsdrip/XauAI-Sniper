import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { migrateLegacyNotificationPrefs, NOTIFICATION_PREFS_SCHEMA_VERSION } = await import("./notificationPreferenceMigration.js");

describe("legacy notification preference migration", () => {
  beforeEach(() => { state.db = new FakeDb(); });

  it("upgrades only unversioned legacy HOURLY_ONLY rows so existing users regain result alerts", async () => {
    const prefs = state.db.collection("cloud_notification_prefs");
    await prefs.insertOne({ user_id: "legacy", tier: "HOURLY_ONLY", muted_categories: [] });
    await prefs.insertOne({ user_id: "explicit-new", tier: "HOURLY_ONLY", schema_version: NOTIFICATION_PREFS_SCHEMA_VERSION, muted_categories: [] });
    await prefs.insertOne({ user_id: "already-results", tier: "HOURLY_PLUS_RESULTS", muted_categories: [] });
    await prefs.insertOne({ user_id: "off", tier: "OFF", muted_categories: [] });

    const changed = await migrateLegacyNotificationPrefs(new Date("2026-09-18T09:00:00.000Z"));
    expect(changed).toBe(1);

    expect(await prefs.findOne({ user_id: "legacy" })).toMatchObject({
      tier: "HOURLY_PLUS_RESULTS",
      schema_version: NOTIFICATION_PREFS_SCHEMA_VERSION,
      results_tier_migrated_at: "2026-09-18T09:00:00.000Z",
    });
    expect(await prefs.findOne({ user_id: "explicit-new" })).toMatchObject({ tier: "HOURLY_ONLY" });
    expect(await prefs.findOne({ user_id: "already-results" })).toMatchObject({
      tier: "HOURLY_PLUS_RESULTS", schema_version: NOTIFICATION_PREFS_SCHEMA_VERSION,
    });
    expect(await prefs.findOne({ user_id: "off" })).toMatchObject({
      tier: "OFF", schema_version: NOTIFICATION_PREFS_SCHEMA_VERSION,
    });

    expect(await migrateLegacyNotificationPrefs(new Date("2026-09-18T10:00:00.000Z"))).toBe(0);
  });
});
