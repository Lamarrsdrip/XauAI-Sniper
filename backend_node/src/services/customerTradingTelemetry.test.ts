import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { getCustomerTradingHistory } = await import("./customerTradingTelemetry.js");

describe("customerTradingTelemetry -- MT5 account-mapping fallback (forensic-incident fix)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("resolves via the most-recent license when it already carries mt5_account (unchanged baseline behavior)", async () => {
    await state.db.collection("pin_licenses").insertOne({
      id: "lic-2", pin: "PIN-2", buyer_email: "trader@example.com", mt5_account: "555111", created_at: "2026-08-01T00:00:00.000Z",
    });
    await state.db.collection("cloud_bot_activity").insertOne({
      account: "555111", event_category: "entries", ts: "2026-08-26T22:22:00.000Z", event_type: "TRADE_OPENED",
    });
    const result = await getCustomerTradingHistory({ email: "trader@example.com" });
    expect(result["available"]).toBe(true);
    expect(result["mt5_account"]).toBe("555111");
  });

  it("falls back to an OLDER license's mt5_account when the newest license for this email lacks one", async () => {
    // Older license (e.g. original purchase) DOES carry the real MT5 account,
    // matching what the EA's own live activity is keyed under.
    await state.db.collection("pin_licenses").insertOne({
      id: "lic-1", pin: "PIN-1", buyer_email: "trader@example.com", mt5_account: "476396807", created_at: "2026-06-01T00:00:00.000Z",
    });
    // Newest license (renewal/re-link) never got its mt5_account backfilled --
    // this is exactly the "No MT5 account or linked license is available" gap.
    await state.db.collection("pin_licenses").insertOne({
      id: "lic-2", pin: "PIN-2", buyer_email: "trader@example.com", mt5_account: "", created_at: "2026-08-20T00:00:00.000Z",
    });
    await state.db.collection("cloud_bot_activity").insertOne({
      account: "476396807", event_category: "entries", ts: "2026-08-26T22:22:00.000Z", event_type: "TRADE_OPENED",
    });

    const result = await getCustomerTradingHistory({ email: "trader@example.com" });

    expect(result["available"]).toBe(true);
    expect(result["mt5_account"]).toBe("476396807");
    expect((result["events"] as unknown[]).length).toBe(1);
  });

  it("still reports the genuine unavailable reason when no license record exists for this email at all", async () => {
    const result = await getCustomerTradingHistory({ email: "nobot@example.com" });
    expect(result["available"]).toBe(false);
    expect(result["unavailable_reason"]).toBe("No MT5 account or linked license is available.");
  });

  it("an explicit mt5_account input still takes priority over any license lookup", async () => {
    await state.db.collection("pin_licenses").insertOne({
      id: "lic-4", pin: "PIN-4", buyer_email: "trader2@example.com", mt5_account: "111111", created_at: "2026-08-01T00:00:00.000Z",
    });
    await state.db.collection("cloud_bot_activity").insertOne({
      account: "999999", event_category: "entries", ts: "2026-08-26T22:22:00.000Z", event_type: "TRADE_OPENED",
    });
    const result = await getCustomerTradingHistory({ email: "trader2@example.com", mt5_account: "999999" });
    expect(result["mt5_account"]).toBe("999999");
    expect(result["available"]).toBe(true);
  });
});
