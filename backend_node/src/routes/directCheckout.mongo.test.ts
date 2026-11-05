import Fastify, { type FastifyInstance } from "fastify";
import { Collection, MongoClient, MongoServerError, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown as Db,
  deliveries: [] as { to: string; subject: string; html: string; messageId?: string }[],
  emailResult: { ok: true } as { ok: boolean; error?: string; deliveryUnknown?: boolean },
}));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("../env.js", () => ({ env: { JWT_SECRET: "local-checkout-integration-secret", PUBLIC_SITE_URL: "https://xaucloud.io" } }));
vi.mock("../services/email.js", () => ({
  sendEmail: async () => true,
  sendEmailDetailed: async (to: string, subject: string, html: string, options: { messageId?: string } = {}) => {
    state.deliveries.push({ to, subject, html, messageId: options.messageId });
    return state.emailResult;
  },
}));
vi.mock("../services/paymentEmails.js", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  notifyAdminNewSale: async () => true,
  notifyAdminPaymentStarted: async () => true,
}));

const { registerDirectCheckoutRoutes, ensureDirectCheckoutIndexes } = await import("./directCheckout.js");
const { createAccessToken, createCloudToken } = await import("../auth.js");
const { effectiveEntitlement } = await import("../services/entitlements.js");
const EXISTING_REFERENCE = "XC-00000000000000000001";

// Opt in explicitly: this suite uses a real local MongoDB and never production data.
// DIRECT_CHECKOUT_MONGO_TESTS=1 npm test -- src/routes/directCheckout.mongo.test.ts
// CI may point CHECKOUT_TEST_MONGO_URL at its ephemeral Mongo service.
describe.skipIf(process.env["DIRECT_CHECKOUT_MONGO_TESTS"] !== "1")("manual checkout with real Mongo and real admin permissions", () => {
  let client: MongoClient;
  let app: FastifyInstance;
  let adminToken: string;
  beforeAll(async () => {
    client = new MongoClient(process.env["CHECKOUT_TEST_MONGO_URL"] ?? "mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    state.db = client.db("checkout_test_" + new ObjectId().toHexString());
    await ensureDirectCheckoutIndexes();
    app = Fastify({ logger: false });
    await registerDirectCheckoutRoutes(app);
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await state.db?.dropDatabase(); await client?.close(); });
  beforeEach(async () => {
    for (const name of ["users", "cloud_users", "payment_transactions", "pin_licenses", "payment_review_log", "admin_settings"]) {
      await state.db.collection(name).deleteMany({});
    }
    state.deliveries = [];
    state.emailResult = { ok: true };
    const id = new ObjectId();
    await state.db.collection("users").insertOne({ _id: id, email: "owner@example.com", role: "admin", is_active: true });
    adminToken = createAccessToken(id.toHexString(), "owner@example.com");
    await state.db.collection("admin_settings").insertOne({ key: "main", email_sender_name: "XauCloud", support_email: "support@xaucloud.io" });
  });
  async function seedExistingOrder(status = "MANUAL_SUBMITTED") {
    await state.db.collection("cloud_users").insertOne({ id: "existing-customer-test", email: "paid.customer@example.test", name: "Test Customer" });
    await state.db.collection("payment_transactions").insertOne({
      reference: EXISTING_REFERENCE, provider: "MANUAL_DIRECT", country: "NG", method: "CRYPTO",
      buyer_name: "Test Customer", buyer_email: "paid.customer@example.test", price_usd_cents: 25000,
      amount_minor: 25000, currency: "USDT", product_id: "BOT_LIFETIME", product_name: "One-Time XauCloud MT5 License",
      quote_details: { asset: "USDT", network: "TRC20", address: "T" + "A".repeat(33) },
      payment_status: status, created_at: new Date().toISOString(), expires_at: new Date(Date.now() - 3600000).toISOString(),
    });
  }
  function action(name: string, token = adminToken) {
    return app.inject({ method: "POST", url: `/admin/direct-checkout/${EXISTING_REFERENCE}/${name}`,
      headers: token ? { authorization: `Bearer ${token}` } : {} });
  }

  it("approves an existing customer's USD250 USDT purchase without fields and activates all purchased entitlements", async () => {
    await seedExistingOrder("MANUAL_PENDING");
    const pending = await app.inject({ method: "GET", url: "/admin/direct-checkout/orders?status=pending&q=paid.customer%40example.test", headers: { authorization: `Bearer ${adminToken}` } });
    expect(pending.json().total).toBe(1);
    expect(pending.json().entries[0]).toMatchObject({ reference: EXISTING_REFERENCE, product_name: "One-Time XauCloud MT5 License" });
    const response = await action("approve");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "FULFILLED", fulfillment_email_status: "SENT", account_link_status: "LINKED" });
    const license = await state.db.collection("pin_licenses").findOne({ payment_ref: EXISTING_REFERENCE });
    expect(license).toMatchObject({ is_active: true, buyer_email: "paid.customer@example.test" });
    const user = await state.db.collection("cloud_users").findOne({ id: "existing-customer-test" });
    expect(user?.["license_key"]).toBe(license?.["pin"]);
    expect(await effectiveEntitlement(user!)).toMatchObject({ bot_license: true, automation_access: true, performance_access: true, signals_access: true, source: "lifetime" });
    expect(state.deliveries).toHaveLength(1);
    expect(state.deliveries[0]).toMatchObject({ to: "paid.customer@example.test", subject: "Your XauCloud License PIN", messageId: `<xaucloud-license-${EXISTING_REFERENCE}@xaucloud.io>` });
    expect(state.deliveries[0]!.html).toContain(String(license?.["pin"]));
    expect(await state.db.collection("payment_review_log").countDocuments({ action: "APPROVE", reference: EXISTING_REFERENCE })).toBe(1);
    expect(await state.db.collection("payment_transactions").findOne({ reference: EXISTING_REFERENCE })).toMatchObject({ approved_by: "owner@example.com", approved_at: expect.any(String), payment_approved: true });
  });

  it("concurrent clicks mint one license, one official delivery, and one approval audit", async () => {
    await seedExistingOrder();
    const responses = await Promise.all(Array.from({ length: 12 }, () => action("approve")));
    expect(responses.filter((response) => response.json().status === "FULFILLED")).toHaveLength(1);
    expect(responses.every((response) => [200, 409].includes(response.statusCode))).toBe(true);
    expect(await state.db.collection("pin_licenses").countDocuments({ payment_ref: EXISTING_REFERENCE })).toBe(1);
    expect(state.deliveries).toHaveLength(1);
    expect(await state.db.collection("payment_review_log").countDocuments({ action: "APPROVE", reference: EXISTING_REFERENCE })).toBe(1);
    expect((await action("retry-fulfillment")).json().status).toBe("already_fulfilled");
    expect(state.deliveries).toHaveLength(1);
  });

  it("uses an existing customer's already issued license and retries definitive email failure without issuing another", async () => {
    await seedExistingOrder();
    await state.db.collection("pin_licenses").insertOne({ payment_ref: EXISTING_REFERENCE, pin: "ASE-PAID-TEST", buyer_email: "paid.customer@example.test", is_active: true });
    state.emailResult = { ok: false, error: "Delivery provider rejected the message (EAUTH)." };
    const approved = await action("approve");
    expect(approved.json()).toMatchObject({ status: "FULFILLMENT_FAILED", fulfillment_stage: "EMAIL", fulfillment_error: state.emailResult.error });
    state.emailResult = { ok: true };
    const retried = await Promise.all([action("retry-fulfillment"), action("retry-fulfillment")]);
    expect(retried.some((response) => response.json().status === "FULFILLED")).toBe(true);
    expect(await state.db.collection("pin_licenses").countDocuments({ payment_ref: EXISTING_REFERENCE })).toBe(1);
    expect(state.deliveries).toHaveLength(2); // First rejected by provider, second accepted.
    expect(state.deliveries.every((email) => email.html.includes("ASE-PAID-TEST"))).toBe(true);
    expect((await action("approve")).json().status).toBe("already_fulfilled");
    expect(state.deliveries).toHaveLength(2);
  });

  it("does not resend a message whose provider delivery outcome is unknown", async () => {
    await seedExistingOrder();
    state.emailResult = { ok: false, error: "Email delivery outcome is unknown (ETIMEDOUT).", deliveryUnknown: true };
    expect((await action("approve")).json().status).toBe("FULFILLMENT_FAILED");
    expect((await action("retry-fulfillment")).statusCode).toBe(409);
    expect(state.deliveries).toHaveLength(1);
  });

  it("recovers a database failure during license issuance with a single activated license", async () => {
    await seedExistingOrder();
    const originalInsert = Collection.prototype.insertOne;
    const fault = vi.spyOn(Collection.prototype, "insertOne").mockImplementationOnce(async function (this: Collection, ...args) {
      if (this.collectionName === "pin_licenses") throw new MongoServerError({ message: "Injected test write failure", code: 91 });
      return originalInsert.apply(this, args);
    });
    const failed = await action("approve");
    fault.mockRestore();
    expect(failed.json()).toMatchObject({ status: "FULFILLMENT_FAILED", fulfillment_stage: "LICENSE" });
    expect(await state.db.collection("pin_licenses").countDocuments({})).toBe(0);
    expect((await action("retry-fulfillment")).json().status).toBe("FULFILLED");
    expect(await state.db.collection("pin_licenses").countDocuments({})).toBe(1);
    expect(state.deliveries).toHaveLength(1);
  });

  it("recovers a stale approved claim after a crash without external reference input", async () => {
    await seedExistingOrder();
    await state.db.collection("payment_transactions").updateOne({ reference: EXISTING_REFERENCE }, { $set: {
      payment_status: "FULFILLING", approved_by: "owner@example.com", approved_at: new Date().toISOString(),
      fulfillment_claim_id: "crashed-worker", fulfillment_claimed_at: new Date(Date.now() - 12 * 60000).toISOString(),
    } });
    expect((await action("retry-fulfillment")).json().status).toBe("FULFILLED");
    expect(await state.db.collection("pin_licenses").countDocuments({})).toBe(1);
    expect(state.deliveries).toHaveLength(1);
  });

  it("never duplicates a previously assigned license with an absent payment_ref", async () => {
    await seedExistingOrder();
    await state.db.collection("pin_licenses").insertOne({ pin: "ASE-PAID-TEST", buyer_email: "paid.customer@example.test", is_active: true });
    await state.db.collection("payment_transactions").updateOne({ reference: EXISTING_REFERENCE }, { $set: { pin_generated: "ASE-PAID-TEST" } });
    expect((await action("approve")).json().status).toBe("FULFILLED");
    expect(await state.db.collection("pin_licenses").countDocuments({})).toBe(1);
    expect(await state.db.collection("pin_licenses").findOne({ payment_ref: EXISTING_REFERENCE })).toMatchObject({ pin: "ASE-PAID-TEST" });
  });

  it("rejects with no fields and blocks all subsequent approval and license issuance", async () => {
    await seedExistingOrder();
    expect((await action("reject")).json().status).toBe("MANUAL_REJECTED");
    expect((await action("reject")).json().status).toBe("MANUAL_REJECTED");
    expect((await action("approve")).statusCode).toBe(409);
    expect((await action("retry-fulfillment")).statusCode).toBe(409);
    expect(await state.db.collection("pin_licenses").countDocuments({})).toBe(0);
    expect(await state.db.collection("payment_review_log").countDocuments({ action: "REJECT" })).toBe(1);
  });

  it("reject/approve race has exactly one decision and never rejects a fulfilled license", async () => {
    await seedExistingOrder();
    const responses = await Promise.all([action("approve"), action("reject")]);
    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const order = await state.db.collection("payment_transactions").findOne({ reference: EXISTING_REFERENCE });
    const licenses = await state.db.collection("pin_licenses").countDocuments({});
    expect(licenses).toBe(order?.["payment_status"] === "FULFILLED" ? 1 : 0);
  });

  it("blocks unauthenticated, customer, inactive, non-admin and revoked sessions on every action", async () => {
    await seedExistingOrder();
    const memberId = new ObjectId();
    await state.db.collection("users").insertOne({ _id: memberId, email: "member@example.com", role: "user" });
    const inactiveId = new ObjectId();
    await state.db.collection("users").insertOne({ _id: inactiveId, email: "inactive@example.com", role: "admin", is_active: false });
    const tokens = ["", createCloudToken("existing-customer-test", "paid.customer@example.test"),
      createAccessToken(memberId.toHexString(), "member@example.com"), createAccessToken(inactiveId.toHexString(), "inactive@example.com")];
    for (const token of tokens) for (const name of ["approve", "reject", "retry-fulfillment"]) {
      expect([401, 403]).toContain((await action(name, token)).statusCode);
    }
    await state.db.collection("users").updateOne({ email: "owner@example.com" }, { $set: { session_version: 1 } });
    expect((await action("approve")).statusCode).toBe(401);
    expect(await state.db.collection("pin_licenses").countDocuments({})).toBe(0);
  });

  it("blocks invalid stored order amounts and bank transfer orders outside Nigeria", async () => {
    await seedExistingOrder();
    await state.db.collection("payment_transactions").updateOne({ reference: EXISTING_REFERENCE }, { $set: { amount_minor: 0 } });
    expect((await action("approve")).statusCode).toBe(409);
    await state.db.collection("payment_transactions").updateOne({ reference: EXISTING_REFERENCE }, { $set: { amount_minor: 25000, method: "BANK", country: "US", currency: "NGN" } });
    expect((await action("approve")).statusCode).toBe(409);
    expect(await state.db.collection("pin_licenses").countDocuments({})).toBe(0);
  });
});
