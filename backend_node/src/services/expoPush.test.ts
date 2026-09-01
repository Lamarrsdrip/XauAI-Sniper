import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { registerDeviceToken, sendExpoPushToUser, checkExpoPushReceipts } = await import("./expoPush.js");

describe("expoPush -- receipt verification / stale-token pruning (forensic-incident fix)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists a pending receipt for every accepted send-time ticket", async () => {
    await registerDeviceToken("user-1", "ExponentPushToken[aaa]", "ios");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] }),
    })));

    const sent = await sendExpoPushToUser("user-1", { title: "Trade opened", body: "BUY XAUUSDm" });

    expect(sent).toBe(1);
    const receipts = state.db.collection("cloud_push_receipts").docs;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ ticket_id: "ticket-1", token: "ExponentPushToken[aaa]", user_id: "user-1", status: "pending" });
  });

  it("prunes a token immediately if Expo rejects it at send-time as DeviceNotRegistered", async () => {
    await registerDeviceToken("user-2", "ExponentPushToken[dead]", "ios");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }] }),
    })));

    const sent = await sendExpoPushToUser("user-2", { title: "x", body: "y" });

    expect(sent).toBe(0);
    expect(state.db.collection("cloud_device_tokens").docs).toHaveLength(0);
  });

  it("checkExpoPushReceipts marks a delivered ticket as delivered and leaves the token alone", async () => {
    await registerDeviceToken("user-3", "ExponentPushToken[ok]", "ios");
    const sentAt = new Date(Date.now() - 30 * 60_000).toISOString(); // 30 min ago -- inside the check window
    await state.db.collection("cloud_push_receipts").insertOne({ ticket_id: "ticket-ok", token: "ExponentPushToken[ok]", user_id: "user-3", sent_at: sentAt, status: "pending" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { "ticket-ok": { status: "ok" } } }),
    })));

    const result = await checkExpoPushReceipts();

    expect(result).toEqual({ checked: 1, delivered: 1, failed: 0, pruned: 0 });
    expect(state.db.collection("cloud_push_receipts").docs[0]?.["status"]).toBe("delivered");
    expect(state.db.collection("cloud_device_tokens").docs).toHaveLength(1); // untouched
  });

  it("checkExpoPushReceipts prunes the device token when the receipt reveals DeviceNotRegistered", async () => {
    await registerDeviceToken("user-4", "ExponentPushToken[stale]", "ios");
    const sentAt = new Date(Date.now() - 30 * 60_000).toISOString();
    await state.db.collection("cloud_push_receipts").insertOne({ ticket_id: "ticket-stale", token: "ExponentPushToken[stale]", user_id: "user-4", sent_at: sentAt, status: "pending" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { "ticket-stale": { status: "error", details: { error: "DeviceNotRegistered" } } } }),
    })));

    const result = await checkExpoPushReceipts();

    expect(result).toEqual({ checked: 1, delivered: 0, failed: 1, pruned: 1 });
    expect(state.db.collection("cloud_push_receipts").docs[0]?.["status"]).toBe("failed");
    expect(state.db.collection("cloud_device_tokens").docs).toHaveLength(0);
  });

  it("does not prune the token for a payload-specific error like MessageRateExceeded", async () => {
    await registerDeviceToken("user-5", "ExponentPushToken[rate]", "ios");
    const sentAt = new Date(Date.now() - 30 * 60_000).toISOString();
    await state.db.collection("cloud_push_receipts").insertOne({ ticket_id: "ticket-rate", token: "ExponentPushToken[rate]", user_id: "user-5", sent_at: sentAt, status: "pending" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { "ticket-rate": { status: "error", details: { error: "MessageRateExceeded" } } } }),
    })));

    const result = await checkExpoPushReceipts();

    expect(result).toEqual({ checked: 1, delivered: 0, failed: 1, pruned: 0 });
    expect(state.db.collection("cloud_device_tokens").docs).toHaveLength(1); // not a dead-token error -- token survives
  });

  it("ignores receipts that are too fresh (inside Expo's own processing window) and too old (past Expo's retention)", async () => {
    await state.db.collection("cloud_push_receipts").insertOne({
      ticket_id: "too-fresh", token: "t1", user_id: "u1", sent_at: new Date(Date.now() - 60_000).toISOString(), status: "pending",
    });
    await state.db.collection("cloud_push_receipts").insertOne({
      ticket_id: "too-old", token: "t2", user_id: "u2", sent_at: new Date(Date.now() - 25 * 3600_000).toISOString(), status: "pending",
    });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkExpoPushReceipts();

    expect(result).toEqual({ checked: 0, delivered: 0, failed: 0, pruned: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a receipts-collection write failure never turns a successful send into a reported failure", async () => {
    await registerDeviceToken("user-6", "ExponentPushToken[ok2]", "ios");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ status: "ok", id: "ticket-2" }] }) })));
    const originalCollection = state.db.collection.bind(state.db);
    state.db.collection = ((name: string) => {
      if (name === "cloud_push_receipts") throw new Error("simulated write failure");
      return originalCollection(name);
    }) as typeof state.db.collection;

    const sent = await sendExpoPushToUser("user-6", { title: "x", body: "y" });
    expect(sent).toBe(1); // the push itself still succeeded
  });
});
