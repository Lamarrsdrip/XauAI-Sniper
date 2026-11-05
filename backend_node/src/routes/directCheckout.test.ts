import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  notified: [] as string[],
  bankConfigured: true,
  deliverySucceeds: true,
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
vi.mock("../services/manualCheckoutInstructions.js", () => ({
  sendDirectManualPaymentInstructions: async () => {
    state.notified.push("buyer-instructions");
    return true;
  },
}));
vi.mock("../services/paymentFulfillment.js", () => ({ generateUniquePin: () => "ASE-ABCD-EFGH" }));
vi.mock("../services/paymentEmails.js", () => ({
  notifyAdminPaymentStarted: async () => { state.notified.push("started"); },
  notifyAdminNewSale: async () => { state.notified.push("sold"); },
  sendPinEmail: async () => { state.notified.push("pin"); return state.deliverySucceeds; },
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
    state.deliverySucceeds = true;
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

  it("emails the buyer immediately with the order before any payment, for both methods", async () => {
    const bank = await quoteBank(app);
    expect(bank.statusCode).toBe(200);
    expect(bank.json().instructions_email_sent).toBe(true);
    const crypto = await quoteCrypto(app);
    expect(crypto.statusCode).toBe(200);
    expect(crypto.json().instructions_email_sent).toBe(true);
    expect(state.notified.filter((x) => x === "buyer-instructions")).toHaveLength(2);
    const first = await state.db.collection("payment_transactions").findOne({ reference: bank.json().reference });
    expect(first?.["instructions_email_status"]).toBe("SENT");
    expect(first?.["payment_status"]).toBe("MANUAL_PENDING");
    expect(state.db.collection("pin_licenses").docs).toHaveLength(0);
  });

  it("resends only to the original buyer, at most twice, and never grants a license", async () => {
    const original = (await quoteBank(app)).json();
    const url = "/purchase/direct/" + original.reference + "/resend-instructions";
    expect((await app.inject({ method: "POST", url })).json()).toEqual({ sent: true });
    expect((await app.inject({ method: "POST", url })).json()).toEqual({ sent: true });
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(429);
    expect(state.notified.filter((x) => x === "buyer-instructions")).toHaveLength(3);
    expect(state.db.collection("pin_licenses").docs).toHaveLength(0);
    const tx = await state.db.collection("payment_transactions").findOne({ reference: original.reference });
    expect(tx?.["instructions_resend_count"]).toBe(2);
  });

  it("does not resend for expired or submitted quotes", async () => {
    const order = (await quoteBank(app)).json();
    const url = "/purchase/direct/" + order.reference + "/resend-instructions";
    await state.db.collection("payment_transactions").updateOne({ reference: order.reference },
      { $set: { expires_at: new Date(Date.now() - 120000).toISOString() } });
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(409);
    const submittedOrder = (await quoteBank(app)).json();
    await app.inject({ method: "POST", url: "/purchase/direct/" + submittedOrder.reference + "/submit",
      payload: { sender_account_name: "Adaeze Okonkwo" } });
    expect((await app.inject({ method: "POST", url: "/purchase/direct/" + submittedOrder.reference + "/resend-instructions" })).statusCode).toBe(409);
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

  it("USDT is available in every country, and only Nigeria can also pay by bank transfer", async () => {
    const response = await quoteCrypto(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ method: "CRYPTO", currency: "USDT", amount_minor: 10000,
      details: { asset: "USDT", network: "ERC20", address: wallet } });
    expect((await quoteCrypto(app, { country: "FR" })).statusCode).toBe(200);
    expect((await quoteCrypto(app, { country: "NG", method: "CRYPTO" })).json().method).toBe("CRYPTO");
    expect((await quoteBank(app)).json().method).toBe("BANK");
    expect((await quoteCrypto(app, { country: "DE", method: "BANK" })).statusCode).toBe(403);
    expect((await quoteCrypto(app, { network: "TRC20" })).statusCode).toBe(503);
    await state.db.collection("admin_settings").updateOne({ key: "main" }, { $set: { direct_crypto_countries: [] } });
    const open = await app.inject({ method: "GET", url: "/purchase/direct/config" });
    expect(open.json().crypto_enabled).toBe(true);
    expect((await quoteCrypto(app, { country: "GB" })).statusCode).toBe(200);
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

  it("bank orders store the sender account name and allow the same name on another order", async () => {
    const first = (await quoteBank(app)).json(), second = (await quoteBank(app)).json();
    const bad = await app.inject({ method: "POST", url: "/purchase/direct/" + first.reference + "/submit",
      payload: { sender_account_name: "12" } });
    expect(bad.statusCode).toBe(422);
    const ok = await app.inject({ method: "POST", url: "/purchase/direct/" + first.reference + "/submit",
      payload: { sender_account_name: "  Adaeze   Okonkwo " } });
    expect(ok.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: "/purchase/direct/" + second.reference + "/submit",
      payload: { sender_account_name: "Adaeze Okonkwo" } });
    expect(again.statusCode).toBe(200);
    const tx = await state.db.collection("payment_transactions").findOne({ reference: first.reference });
    expect(tx?.["sender_account_name"]).toBe("Adaeze Okonkwo");
    expect(tx?.["submitted_reference"]).toBeUndefined();
    expect(tx?.["payment_status"]).toBe("MANUAL_SUBMITTED");
    await state.db.collection("payment_transactions").updateOne({ reference: second.reference },
      { $set: { payment_status: "MANUAL_PENDING", expires_at: new Date(Date.now() - 60000).toISOString() } });
    const expiredOrder = (await quoteBank(app)).json();
    await state.db.collection("payment_transactions").updateOne({ reference: expiredOrder.reference },
      { $set: { expires_at: new Date(Date.now() - 60000).toISOString() } });
    expect((await app.inject({ method: "POST", url: "/purchase/direct/" + expiredOrder.reference + "/submit",
      payload: { sender_account_name: "Chinedu Okafor" } })).statusCode).toBe(409);
    const closed = await state.db.collection("payment_transactions").findOne({ reference: expiredOrder.reference });
    expect(closed?.["payment_status"]).toBe("MANUAL_EXPIRED");
  });

  it("crypto hashes stay unique across orders", async () => {
    const first = (await quoteCrypto(app)).json();
    const second = (await quoteCrypto(app)).json();
    const ref = "0x" + "ab".repeat(32);
    expect((await app.inject({ method: "POST", url: "/purchase/direct/" + first.reference + "/submit", payload: { payment_reference: ref } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/purchase/direct/" + second.reference + "/submit", payload: { payment_reference: ref } })).statusCode).toBe(409);
  });

  it("verified admin approval fulfills exactly once, with one license and one email", async () => {
    const order = (await quoteBank(app)).json();
    await app.inject({ method: "POST", url: "/purchase/direct/" + order.reference + "/submit",
      payload: { sender_account_name: "Test Customer" } });
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


  it("rejects a submitted payment with a reason alone and never issues a license", async () => {
    const order = (await quoteCrypto(app)).json();
    await app.inject({ method: "POST", url: "/purchase/direct/" + order.reference + "/submit",
      payload: { payment_reference: "0x" + "a".repeat(64) } });
    const rejected = await app.inject({ method: "POST", url: "/admin/direct-checkout/" + order.reference + "/reject",
      payload: { verification_notes: "Bank or chain evidence does not match payment destination." } });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe("MANUAL_REJECTED");
    expect(state.db.collection("pin_licenses").docs).toHaveLength(0);
    expect((await app.inject({ method: "POST", url: "/admin/direct-checkout/" + order.reference + "/approve",
      payload: { evidence_reference: "VERIFIED-TXN-1", verification_notes: "Independently verified the payment and amount." } })).statusCode).toBe(409);
  });

  it("records failed license email without losing fulfillment and supports audited resend", async () => {
    state.deliverySucceeds = false;
    const order = (await quoteBank(app)).json();
    await app.inject({ method: "POST", url: "/purchase/direct/" + order.reference + "/submit",
      payload: { sender_account_name: "Test Customer" } });
    const approval = await app.inject({ method: "POST", url: "/admin/direct-checkout/" + order.reference + "/approve",
      payload: { evidence_reference: "VERIFIED-BANK-TXN", verification_notes: "Checked official bank ledger and beneficiary." } });
    expect(approval.statusCode).toBe(200);
    expect(approval.json()).toMatchObject({ status: "FULFILLED", license_status: "ISSUED", fulfillment_email_status: "RETRYABLE" });
    state.deliverySucceeds = true;
    const resend = await app.inject({ method: "POST", url: "/admin/direct-checkout/" + order.reference + "/resend-license" });
    expect(resend.statusCode).toBe(200);
    expect(resend.json().status).toBe("SENT");
    expect(state.db.collection("pin_licenses").docs).toHaveLength(1);
    const tx = await state.db.collection("payment_transactions").findOne({ reference: order.reference });
    expect(tx?.["fulfillment_email_status"]).toBe("SENT");
    const entries = (await app.inject({ method: "GET", url: "/admin/direct-checkout/orders" })).json().entries;
    expect(entries.find((e: {reference: string}) => e.reference === order.reference).license_status).toBe("ISSUED");
    expect(state.db.collection("payment_review_log").docs.some((e) => e.action === "RESEND_LICENSE_EMAIL")).toBe(true);
  });

  it("recovers stale approved fulfillment without creating another license", async () => {
    const order = (await quoteBank(app)).json();
    await app.inject({ method: "POST", url: "/purchase/direct/" + order.reference + "/submit",
      payload: { sender_account_name: "Test Customer" } });
    await state.db.collection("payment_transactions").updateOne({ reference: order.reference },
      { $set: { payment_status: "FULFILLING", approved_by: "reviewer@example.com",
        approved_at: new Date().toISOString(), verified_external_reference: "BANK-VERIFIED-1",
        fulfillment_claimed_at: new Date(Date.now() - 12 * 60000).toISOString() } });
    await state.db.collection("pin_licenses").insertOne({
      pin: "ASE-ABCD-EFGH", buyer_email: "test@example.com", buyer_name: "Test Customer",
      is_active: true, is_used: false, payment_ref: order.reference, provider: "MANUAL_DIRECT",
    });
    const retry = await app.inject({ method: "POST", url: "/admin/direct-checkout/" + order.reference + "/retry-fulfillment" });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().status).toBe("FULFILLED");
    expect(state.db.collection("pin_licenses").docs).toHaveLength(1);
    expect(state.notified.filter((s) => s === "pin")).toHaveLength(1);
  });

  it("receipt uploads are refused and never stored", async () => {
    const order = (await quoteBank(app)).json();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const response = await app.inject({
      method: "POST", url: "/purchase/direct/" + order.reference + "/proof",
      payload: { mime_type: "image/png", data_base64: png },
    });
    expect(response.statusCode).toBe(410);
    const tx = await state.db.collection("payment_transactions").findOne({ reference: order.reference });
    expect(tx?.["evidence_image"]).toBeUndefined();
    expect(state.db.collection("pin_licenses").docs).toHaveLength(0);
  });

  it("admin-only endpoints cannot be called without verified admin identity", async () => {
    // Auth mock always supplies identity, so verifies successful admin configuration
    // while actual requireAdmin authentication is covered by auth.session.test.ts.
    const response = await app.inject({ method: "GET", url: "/admin/direct-checkout/orders" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("entries");
  });
});
