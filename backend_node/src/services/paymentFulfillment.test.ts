import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, emailCalls: [] as string[] }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("./paymentEmails.js", () => ({
  sendPinEmail: vi.fn(async () => { state.emailCalls.push("sendPinEmail"); return true; }),
  recordFulfillmentEmailResult: vi.fn(async () => {}),
  notifyAdminNewSale: vi.fn(async () => { state.emailCalls.push("notifyAdminNewSale"); return true; }),
  sendSignalSubscriptionEmail: vi.fn(async () => { state.emailCalls.push("sendSignalSubscriptionEmail"); return true; }),
  recordSubscriptionEmailResult: vi.fn(async () => {}),
  notifyAdminNewSignalSale: vi.fn(async () => { state.emailCalls.push("notifyAdminNewSignalSale"); return true; }),
}));

const { approveBankTransfer } = await import("./paymentFulfillment.js");

function bankTransferTx(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx1", reference: "ASE-BT-TEST1", amount_kobo: 2_000_000, currency: "NGN", provider: "BANK_TRANSFER",
    buyer_name: "Ada Trader", buyer_email: "ada@example.com", payment_status: "BANK_TRANSFER_SUBMITTED",
    pin_generated: null, created_at: new Date().toISOString(), state_transitions: {},
    ...overrides,
  };
}

describe("payment plan branching (approveBankTransfer)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.db.uniqueIndexes["pin_licenses"] = ["pin"];
    state.db.uniqueIndexes["signal_subscriptions"] = ["source_payment_ref"];
    state.emailCalls = [];
  });

  it("BOT_LIFETIME (and legacy orders with no plan_id) mint a license exactly like before", async () => {
    await state.db.collection("payment_transactions").insertOne(bankTransferTx());
    const result = await approveBankTransfer("ASE-BT-TEST1", "admin@xaucloud.io");
    expect(result.status).toBe("approved");
    expect(result.pin).toBeTruthy();
    expect(state.db.collection("pin_licenses").docs).toHaveLength(1);
    expect(state.db.collection("signal_subscriptions").docs).toHaveLength(0);
    expect(state.emailCalls).toContain("sendPinEmail");
  });

  it("SIGNALS_WEEKLY never mints a license -- it activates a subscription instead", async () => {
    await state.db.collection("payment_transactions").insertOne(bankTransferTx({ reference: "ASE-SIGBT-1", plan_id: "SIGNALS_WEEKLY", user_id: "user-9" }));
    const result = await approveBankTransfer("ASE-SIGBT-1", "admin@xaucloud.io");
    expect(result.status).toBe("approved");
    expect(result.pin).toBeUndefined();
    expect(state.db.collection("pin_licenses").docs).toHaveLength(0);
    expect(state.db.collection("signal_subscriptions").docs).toHaveLength(1);
    expect(state.db.collection("signal_subscriptions").docs[0]!["plan"]).toBe("WEEKLY");
    expect(state.db.collection("signal_subscriptions").docs[0]!["user_id"]).toBe("user-9");
    expect(state.emailCalls).toContain("sendSignalSubscriptionEmail");
    expect(state.emailCalls).not.toContain("sendPinEmail");
  });

  it("approving the same signal-plan reference twice activates the subscription exactly once (idempotent)", async () => {
    await state.db.collection("payment_transactions").insertOne(bankTransferTx({ reference: "ASE-SIGBT-2", plan_id: "SIGNALS_MONTHLY", user_id: "user-10" }));
    const first = await approveBankTransfer("ASE-SIGBT-2", "admin@xaucloud.io");
    const second = await approveBankTransfer("ASE-SIGBT-2", "admin@xaucloud.io");
    expect(first.status).toBe("approved");
    expect(second.status).toBe("already_fulfilled");
    expect(state.db.collection("signal_subscriptions").docs).toHaveLength(1);
  });
});
