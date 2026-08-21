import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { activateSignalSubscription, subscriptionStatus } = await import("./signalSubscriptions.js");

describe("signal subscriptions", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.db.uniqueIndexes["signal_subscriptions"] = ["source_payment_ref"];
  });

  it("weekly plan activates for 7 days", async () => {
    const before = Date.now();
    const row = await activateSignalSubscription("ref-1", { user_id: "user-1" }, "SIGNALS_WEEKLY");
    expect(row.plan).toBe("WEEKLY");
    const spanMs = new Date(row.expires_at).getTime() - new Date(row.activated_at).getTime();
    expect(spanMs).toBe(7 * 86_400_000);
    expect(new Date(row.activated_at).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("monthly plan activates for a fixed 30 days", async () => {
    const row = await activateSignalSubscription("ref-2", { user_id: "user-1" }, "SIGNALS_MONTHLY");
    expect(row.plan).toBe("MONTHLY");
    const spanMs = new Date(row.expires_at).getTime() - new Date(row.activated_at).getTime();
    expect(spanMs).toBe(30 * 86_400_000);
  });

  it("activating twice with the same payment reference does not create a duplicate subscription", async () => {
    const first = await activateSignalSubscription("ref-3", { user_id: "user-2" }, "SIGNALS_WEEKLY");
    const second = await activateSignalSubscription("ref-3", { user_id: "user-2" }, "SIGNALS_WEEKLY");
    expect(second.id).toBe(first.id);
    expect(state.db.collection("signal_subscriptions").docs).toHaveLength(1);
  });

  it("reports inactive once expires_at has passed, without needing a background job", async () => {
    await state.db.collection("signal_subscriptions").insertOne({
      id: "s1", user_id: "user-3", plan: "WEEKLY", status: "ACTIVE",
      activated_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      expires_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      source_payment_ref: "ref-old",
    });
    const status = await subscriptionStatus("user-3");
    expect(status?.active).toBe(false);
  });

  it("a renewal (later expiry) wins over an older expired row for the same user", async () => {
    await activateSignalSubscription("ref-old", { user_id: "user-4" }, "SIGNALS_WEEKLY");
    // Force the first row's expiry into the past directly (simulating time passing).
    state.db.collection("signal_subscriptions").docs[0]!["expires_at"] = new Date(Date.now() - 86_400_000).toISOString();
    await activateSignalSubscription("ref-new", { user_id: "user-4" }, "SIGNALS_MONTHLY");

    const status = await subscriptionStatus("user-4");
    expect(status?.active).toBe(true);
    expect(status?.plan).toBe("MONTHLY");
  });

  it("no subscription row -> null status", async () => {
    expect(await subscriptionStatus("nobody")).toBeNull();
  });
});
