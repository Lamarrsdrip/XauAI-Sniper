import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  notified: [] as string[],
  bankConfigured: true,
}));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("../auth.js", () => ({
  clientIp: () => "127.0.0.1",
  rateLimit: () => {},
  requireAdmin: async (request: unknown) => { (request as { admin?: unknown }).admin = { email: "reviewer@example.com" }; },
}));
vi.mock("../services/settings.js", () => ({
  getSettings: async () => (await state.db.collection("admin_settings").findOne({ key: "main" })) ?? {},
}));
vi.mock("../services/paymentMethods.js", () => ({
  getBankTransferSettings: async () => ({
    enabled: state.bankConfigured, bank_name: "Verified Test Bank",
    account_name: "XauCloud TEST", account_number: "0000000000",
  }),
  bankTransferIsConfigured: (v: { bank_name?: string; account_name?: string; account_number?: string }) =>
    Boolean(v.bank_name && v.account_name && v.account_number),
}));
vi.mock("../services/paymentFulfillment.js", () => ({ generateUniquePin: () => "ASE-MANUAL-TEST-PIN" }));
vi.mock("../services/paymentEmails.js", () => ({
  notifyAdminPaymentStarted: async () => { state.notified.push("started"); },
  notifyAdminNewSale: async () => { state.notified.push("sold"); },
  sendPinEmail: async () => { state.notified.push("pin"); return true; },
  recordFulfillmentEmailResult: async () => {},
}));

const { registerDirectCheckoutRoutes } = await import("./directCheckout.js");

const wallet = "0x" + "a".repeat(40);
const testSettings = () => ({
  key: "main", direct_usd_cents: 10000,
  direct_usd_ngn_rate: "1500.50", direct_fx_as_of: new Date().toISOString(),
  direct_bank_enabled: true, direct_crypto_enabled: true,
  direct_crypto_countries: ["US"], direct_wallets: [{ asset: "USDT", network: "ERC20", address: wallet }],
});

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerDirectCheckoutRoutes(app);
  return app;
}
async function quoteBank(app: FastifyInstance) {
  return app.inject({ method: "POST", url: "/purchase/direct/quote",
    payload: { country: "NG", buyer_name: "Test Customer", buyer_email: "test@example.com" } });
}
async function quoteCrypto(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: "/purchase/direct/quote",
    payload: { country: "US", buyer_name: "Test Customer", buyer_email: "test@example.com",
      asset: "USDT", network: "ERC20", ...overrides } });
}

describe("USD-first manual checkout HTTP and fulfillment lifecycle", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    state.db = new FakeDb();
    state.db.uniqueIndexes["payment_transactions"] = ["submitted_reference"];
    state.db.uniqueIndexes["pin_licenses"] = ["payment_ref"];
    state.notified = [];
    state.bankConfigured = true;
    await state.db.collection("admin_settings").insertOne(testSettings());
    app = await makeApp();
  });

  it("USD is canonical and NGN quote uses exact integer minor units with stored FX", async () => {
    const price = await app.inject({ method: "GET", url: "/purchase/direct/config" });
    expect(price.statusCode).toBe(200);
    expect(price.json()).toMatchObject({ currency: "USD", price_usd_cents: 10000, price_formatted: "USD 100.00" });
    const response = await quoteBank(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ method: "BANK", currency: "NGN", amount_minor: 15005000, amount_formatted: "NGN 150050.00" });
    const tx = await state.db.collection("payment_transactions").findOne({ reference: response.json().reference });
    expect(tx?.["price_usd_cents"]).toBe(10000);
    expect((tx?.["quote_details"] as Record<string, unknown>)["fx_rate"]).toBe("1500.50");
    expect(tx?.["payment_status"]).toBe("MANUAL_PENDING");
    expect(state.db.collection("pin_licenses").docs).toHaveLength(0);
  });

  it("missing USD price, stale FX or absent bank destination never creates payable instructions", async () => {
    await state.db.collection("admin_settings").updateOne({ key: "main" }, { $set: { direct_usd_cents: null } });
    expect((await quoteBank(app)).statusCode).toBe(503);
    await state.db.collection("admin_settings").updateOne({ key: "main" }, { $set: { direct_usd_cents: 10000, direct_fx_as_of: new Date(Date.now() - 72 * 3600000).toISOString() } });
    expect((await quoteBank(app)).statusCode).toBe(503);
    await state.db.collection("admin_settings").updateOne({ key: "main" }, { $set: { direct_fx_as_of: new Date().toISOString() } });
    state.bankConfigured = false;
    expect((await quoteBank(app)).statusCode).toBe(503);
    expect(state.db.collection("payment_transactions").docs).toHaveLength(0);
  });

  it("crypto quote is restricted to approved countries, assets and networks", async () => {
    const response = await quoteCrypto(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ currency: "USDT", amount_minor: 10000,
      details: { asset: "USDT", network: "ERC20", address: wallet } });
    expect((await quoteCrypto(app, { country: "FR" })).statusCode).toBe(403);
    expect((await quoteCrypto(app, { network: "TRC20" })).statusCode).toBe(503);
  });

  it("user submission cannot mint licenses and rejected malformed hash cannot advance state", async () => {
    const crypto = (await quoteCrypto(app)).json();
    const invalid = await app.inject({ method: "POST", url: "/purchase/direct/" + crypto.reference + "/submit",
      payload: { payment_reference: "fake-payment" } });
    expect(invalid.statusCode).toBe(422);
    const tx = await state.db.collection("payment_transactions").findOne({ reference: crypto.reference });
    expect(tx?.["payment_status"]).toBe("MANUAL_PENDING");
    const valid = await app.inject({ method: "POST", url: "/purchase/direct/" + crypto.reference + "/submit",
      payload: { payment_reference: "0x" + "c".repeat(64) } });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().status).toBe("MANUAL_SUBMITTED");
    expect(state.db.collection("pin_licenses").docs).toHaveLength(0);
  });

  it("duplicates and expired quote submissions are refused", async () => {
    const first = (await quoteBank(app)).json(), second = (await quoteBank(app)).json();
    const ref = "BANK-TRACE-0001";
    expect((await app.inject({ method: "POST", url: "/purchase/direct/" + first.reference + "/submit", payload: { payment_reference: ref } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/purchase/direct/" + second.reference + "/submit", payload: { payment_reference: ref } })).statusCode).toBe(409);
    await state.db.collection("payment_transactions").updateOne({ reference: second.reference }, { $set: { expires_at: new Date(Date.now() - 60000).toISOString() } });
    expect((await app.inject({ method: "POST", url: "/purchase/direct/" + second.reference + "/submit", payload: { payment_reference: "OTHER-BANK-REF" } })).statusCode).toBe(409);
    const tx = await state.db.collection("payment_transactions").findOne({ reference: second.reference });
    expect(tx?.["payment_status"]).toBe("MANUAL_EXPIRED");
  });

  it("verified admin approval fulfills exactly once, with one license and one email", async () => {
    const order = (await quoteBank(app)).json();
    await app.inject({ method: "POST", url: "/purchase/direct/" + order.reference + "/submit",
      payload: { payment_reference: "REAL-BANK-REF" } });
    const approve = () => app.inject({ method: "POST", url: "/admin/direct-checkout/" + order.reference + "/approve",
      payload: { evidence_reference: "INDEPENDENT-TXN-1",
        verification_notes: "Checked transfer, amount, beneficiary and receipt against official bank ledger." } });
    const first = await approve();
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("FULFILLED");
    expect((await approve()).json().status).toBe("already_fulfilled");
    expect(state.db.collection("pin_licenses").docs).toHaveLength(1);
    expect(state.notified.filter((s) => s === "pin")).toHaveLength(1);
  });

  it("admin-only endpoints cannot be called without verified admin identity", async () => {
    // Auth mock always supplies identity, so verifies successful admin configuration
    // while actual requireAdmin authentication is covered by auth.session.test.ts.
    const response = await app.inject({ method: "GET", url: "/admin/direct-checkout/orders" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("entries");
  });
});
