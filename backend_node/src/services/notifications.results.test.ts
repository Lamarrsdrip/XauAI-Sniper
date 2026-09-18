import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("./webPush.js", () => ({
  getVapidPublicKey: async () => "test-public-key",
  sendWebPushToUser: async () => 1,
}));
vi.mock("./expoPush.js", () => ({ sendExpoPushToUser: async () => 0 }));
vi.mock("./marketCalendar.js", () => ({ isMarketOpen: () => false }));

const { sendClosedJournalTradeNotification, sendOutlookNotification, sendTradeActivityNotification } = await import("./notifications.js");

async function seedRecipient(tier = "HOURLY_PLUS_RESULTS") {
  await state.db.collection("pin_licenses").insertOne({
    id: "lic-1", pin: "PIN-A", buyer_email: "owner@example.com", mt5_account: "111", is_active: true,
  });
  await state.db.collection("cloud_users").insertOne({
    id: "user-1", email: "owner@example.com", license_key: "PIN-A",
  });
  await state.db.collection("cloud_notification_prefs").insertOne({
    user_id: "user-1", account: "111", tier, muted_categories: [],
  });
  await state.db.collection("web_push_subscriptions").insertOne({
    id: "web-1", user_id: "user-1", endpoint: "https://push.example/device",
  });
}

describe("result notification delivery contracts", () => {
  beforeEach(() => { state.db = new FakeDb(); });

  it("delivers a persisted Outlook TP result even when the current market/connectivity gate is closed", async () => {
    await seedRecipient();
    const sent = await sendOutlookNotification({
      id: "outlook-1", account: "111", primary_direction: "BUY", symbol: "XAUUSD",
      published_at: "2026-09-18T08:00:00.000Z", tracking_entry_price: 3600,
      tp1_price: 3605, tp1_hit_at: "2026-09-18T08:10:00.000Z",
      event_snapshots: { TP1_HIT: { event_at: "2026-09-18T08:10:00.000Z", hit_price: 3605, achieved_r: 0.5 } },
    }, "TP1_HIT", "HOURLY_PLUS_RESULTS");

    expect(sent).toBe(1);
    expect(state.db.collection("cloud_notification_log").docs).toHaveLength(1);
    expect(state.db.collection("cloud_notification_log").docs[0]).toMatchObject({
      notification_type: "TP1_HIT", delivery_status: "SENT", user_id: "user-1",
    });
  });

  it("still gates a new tracking-start alert when market/bot availability says it is not live", async () => {
    await seedRecipient();
    const sent = await sendOutlookNotification({
      id: "outlook-live", account: "111", primary_direction: "BUY", tracking_entry_price: 3600,
    }, "TRACKING_STARTED", "HOURLY_ONLY");
    expect(sent).toBeNull();
    expect(state.db.collection("cloud_notification_log").docs).toHaveLength(0);
  });

  it("sends broker-confirmed trade closes at HOURLY_PLUS_RESULTS and dedupes journal retries", async () => {
    await seedRecipient();
    const trade = {
      trade_identity: "[\"111\",\"9001\"]", account_login: "111", ticket: 9001,
      symbol: "XAUUSD", direction: "SELL", entry_price: 3610, price: 3604,
      profit: 150, final_r: 0.6, closed_at: 1_700_000_000, exit_reason: "BROKER_TP",
    };
    expect(await sendClosedJournalTradeNotification(trade)).toBe(1);
    expect(await sendClosedJournalTradeNotification(trade)).toBe(0);
    expect(state.db.collection("cloud_notification_log").docs).toHaveLength(1);
    expect(state.db.collection("cloud_notification_log").docs[0]).toMatchObject({
      notification_type: "TRADE_CLOSED", delivery_status: "SENT", ticket: "9001",
    });
  });

  it("keeps trade-open alerts at ALL_UPDATES so the results tier is not noisy", async () => {
    await seedRecipient();
    const sent = await sendTradeActivityNotification({
      id: "open-1", account: "111", symbol: "XAUUSD", event_type: "TRADE_OPENED",
      event_category: "entries", ticket: "9002", final_decision: "EXECUTED", price: 3600,
    });
    expect(sent).toBe(0);
    expect(state.db.collection("cloud_notification_log").docs).toHaveLength(0);
  });
});
