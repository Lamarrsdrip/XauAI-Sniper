import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, instructions: [] as Record<string, unknown>[] }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("../auth.js", () => ({ clientIp: () => "127.0.0.1", rateLimit: () => {}, requireAdmin: async () => {} }));
vi.mock("../services/settings.js", () => ({ getSettings: async () => state.db.collection("admin_settings").findOne({ key: "main" }) }));
vi.mock("../services/manualCheckoutInstructions.js", () => ({ sendDirectManualPaymentInstructions: async (order: Record<string, unknown>) => { state.instructions.push(order); return true; } }));
vi.mock("../services/paymentEmails.js", () => ({ notifyAdminPaymentStarted: async () => {}, notifyAdminNewSale: async () => {}, sendPinEmail: async () => true, recordFulfillmentEmailResult: async () => {} }));
const { registerDirectCheckoutRoutes } = await import("./directCheckout.js");
const wallets = [
  { asset: "USDT", network: "ERC20", address: "0x" + "a".repeat(40) },
  { asset: "USDT", network: "TRC20", address: "T" + "a".repeat(33) },
  { asset: "USDC", network: "ERC20", address: "0x" + "b".repeat(40) },
];

describe("country checkout and existing beneficiary configuration", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    state.db = new FakeDb(); state.instructions = [];
    await state.db.collection("admin_settings").insertOne({
      key: "main", direct_usd_cents: 25000, bank_transfer_enabled: true,
      bank_transfer_bank_name: "Test bank", bank_transfer_account_name: "Test beneficiary",
      bank_transfer_account_number: "0000000000", bank_transfer_instructions: "Include your order ID in the narration.",
      direct_usd_ngn_rate: "1500.50", direct_fx_as_of: new Date().toISOString(),
      direct_crypto_enabled: true, direct_wallets: wallets,
    });
  });
  async function appForTest() { const app = Fastify(); await registerDirectCheckoutRoutes(app); return app; }
  function quotePayload(country: string, method: string, option = wallets[0]!) {
    return { country, method, buyer_name: "Test Customer", buyer_email: "customer@example.com", asset: option.asset, network: option.network };
  }

  it("reuses a previously enabled bank configuration without replacing its details or FX", async () => {
    const app = await appForTest();
    const config = (await app.inject({ url: "/purchase/direct/config" })).json();
    expect(config).toMatchObject({ bank_enabled: true, bank_unavailable_reason: null, crypto_enabled: true });
    const result = await app.inject({ method: "POST", url: "/purchase/direct/quote", payload: quotePayload("NG", "BANK") });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ method: "BANK", amount_minor: 37512500, currency: "NGN", details: {
      bank_name: "Test bank", account_name: "Test beneficiary", account_number: "0000000000", fx_rate: "1500.50",
      instructions: "Include your order ID in the narration.",
    } });
    expect(state.instructions[0]?.details).toMatchObject(result.json().details);
    expect((await state.db.collection("payment_transactions").findOne({ reference: result.json().reference }))?.product_name).toBe("One-Time XauCloud MT5 License");
    expect(state.db.collection("pin_licenses").docs).toHaveLength(0);
    await app.close();
  });

  it("honors an explicit bank disable and gives an actionable cause for stale FX", async () => {
    const app = await appForTest();
    await state.db.collection("admin_settings").updateOne({ key: "main" }, { $set: { direct_bank_enabled: false } });
    expect((await app.inject({ url: "/purchase/direct/config" })).json()).toMatchObject({ bank_enabled: false, bank_unavailable_reason: "BANK_DISABLED" });
    await state.db.collection("admin_settings").updateOne({ key: "main" }, { $set: { direct_bank_enabled: true, direct_fx_as_of: new Date(Date.now() - 25 * 3600000).toISOString() } });
    expect((await app.inject({ url: "/purchase/direct/config" })).json()).toMatchObject({ bank_enabled: false, bank_unavailable_reason: "FX_RATE_STALE", crypto_enabled: true });
    expect((await app.inject({ method: "POST", url: "/purchase/direct/quote", payload: quotePayload("NG", "BANK") })).statusCode).toBe(503);
    expect(state.db.collection("payment_transactions").docs).toHaveLength(0);
    await app.close();
  });

  it("quotes every configured coin/network in Nigeria and international countries", async () => {
    const app = await appForTest();
    expect((await app.inject({ url: "/purchase/direct/config" })).json().crypto_options).toEqual(wallets.map(({ asset, network }) => ({ asset, network })));
    for (const country of ["NG", "US", "FR", "ZA"]) for (const option of wallets) {
      const response = await app.inject({ method: "POST", url: "/purchase/direct/quote", payload: quotePayload(country, "CRYPTO", option) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ method: "CRYPTO", currency: option.asset, amount_minor: 25000, details: option });
    }
    await app.close();
  });

  it("rejects bank for every non-Nigerian selection and rejects unconfigured crypto wallets", async () => {
    const app = await appForTest();
    for (const country of ["US", "GB", "FR", "GH", "ZA", "KE", "DE"]) {
      expect((await app.inject({ method: "POST", url: "/purchase/direct/quote", payload: quotePayload(country, "BANK") })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "POST", url: "/purchase/direct/quote", payload: quotePayload("NG", "CRYPTO", { asset: "USDC", network: "TRC20", address: "" }) })).statusCode).toBe(503);
    expect(state.db.collection("payment_transactions").docs).toHaveLength(0);
    await app.close();
  });
});
