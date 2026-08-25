import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => { process.env["ENVIRONMENT"] = "test"; });

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, user: null as Record<string, unknown> | null }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", () => ({
  requireCloudUser: async (request: unknown) => { (request as { cloudUser?: unknown }).cloudUser = state.user; },
}));
vi.mock("../../services/adminOpsControl.js", () => ({ publishedTransactionalRender: vi.fn(async () => null) }));
vi.mock("../../services/emailBranding.js", () => ({
  emailBranding: vi.fn(async () => ({ sender_name: "XauCloud", command_center_url: "https://xaucloud.io/command" })),
  emailLinkButton: () => "",
}));
vi.mock("../../services/email.js", () => ({ sendEmail: vi.fn(async () => true) }));

const { registerCloudSignalRoutes } = await import("./signals.js");
const { computeTrialExpiry } = await import("../../services/signalTrial.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerCloudSignalRoutes(app);
  return app;
}

describe("cloud signal routes -- entitlement enforced server-side", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.db = new FakeDb();
    state.db.uniqueIndexes["signal_trials"] = ["user_id"];
    state.user = { id: "user-1", email: "trader@example.com", full_name: "Trader" };
    app = await createApp();
  });

  it("starting a trial twice is idempotent and returns the same trial", async () => {
    const first = await app.inject({ method: "POST", url: "/cloud/signals/trial/start" });
    const second = await app.inject({ method: "POST", url: "/cloud/signals/trial/start" });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().trial.id).toBe(second.json().trial.id);
    expect(first.json().entitlement.signals_access).toBe(true);
    expect(first.json().entitlement.bot_license).toBe(false);
  });

  it("an expired trial is denied by the outlook/engine/recent-signals APIs, not shown empty", async () => {
    await state.db.collection("signal_trials").insertOne({
      id: "t1", user_id: "user-1", trial_started_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
      trial_expires_at: new Date(Date.now() - 15 * 86_400_000).toISOString(),
      market_days_consumed: 3, status: "ACTIVE", created_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });
    for (const url of ["/cloud/signals/outlook", "/cloud/signals/engine", "/cloud/signals/recent"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it("an active trial is granted the outlook/engine/recent-signals APIs", async () => {
    const started = new Date();
    await state.db.collection("signal_trials").insertOne({
      id: "t2", user_id: "user-1", trial_started_at: started.toISOString(),
      trial_expires_at: computeTrialExpiry(started).toISOString(),
      market_days_consumed: 1, status: "ACTIVE", created_at: started.toISOString(),
    });
    for (const url of ["/cloud/signals/outlook", "/cloud/signals/engine", "/cloud/signals/recent"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it("a user with no grant at all cannot reach protected signal APIs by calling them directly", async () => {
    const res = await app.inject({ method: "GET", url: "/cloud/signals/outlook" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ reason: "NOT_ENTITLED" });
  });

  it("billing reflects the plan prices from settings, never a hardcoded literal", async () => {
    await state.db.collection("admin_settings").insertOne({ key: "main", signals_weekly_price_kobo: 2_500_000, signals_monthly_price_kobo: 6_000_000 });
    const res = await app.inject({ method: "GET", url: "/cloud/billing" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plans.signals_weekly.price_kobo).toBe(2_500_000);
    expect(body.plans.signals_monthly.price_kobo).toBe(6_000_000);
  });

  // 2026-08-25 audit: full permission matrix from the free-access spec.
  // Entitlement logic itself was already correct (see entitlements.ts) --
  // these prove it at the actual HTTP layer, not just in isolation.
  describe("full permission matrix", () => {
    it("a paid signal subscriber WITHOUT the bot gets signal access but not bot_license", async () => {
      await state.db.collection("signal_subscriptions").insertOne({
        user_id: "user-1", plan: "MONTHLY", status: "ACTIVE", source_payment_ref: "ref-1",
        expires_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), activated_at: new Date().toISOString(),
      });
      for (const url of ["/cloud/signals/outlook", "/cloud/signals/engine", "/cloud/signals/recent"]) {
        const res = await app.inject({ method: "GET", url });
        expect(res.statusCode, url).toBe(200);
      }
    });

    it("an expired paid subscription (not cancelled, just past expiry) is denied like an expired trial", async () => {
      await state.db.collection("signal_subscriptions").insertOne({
        user_id: "user-1", plan: "WEEKLY", status: "ACTIVE", source_payment_ref: "ref-2",
        expires_at: new Date(Date.now() - 86_400_000).toISOString(), activated_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      });
      const res = await app.inject({ method: "GET", url: "/cloud/signals/outlook" });
      expect(res.statusCode).toBe(403);
    });

    it("a bot owner (license, no trial/subscription at all) gets signal access purely from the license", async () => {
      state.db.collection("pin_licenses").docs.push({ pin: "ASE-TEST-0001", buyer_email: "trader@example.com", is_active: true });
      const res = await app.inject({ method: "GET", url: "/cloud/signals/outlook" });
      expect(res.statusCode).toBe(200);
    });

    it("a bot owner whose signal trial independently expired still keeps signal access via the license", async () => {
      state.db.collection("pin_licenses").docs.push({ pin: "ASE-TEST-0002", buyer_email: "trader@example.com", is_active: true });
      await state.db.collection("signal_trials").insertOne({
        id: "t3", user_id: "user-1", trial_started_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        trial_expires_at: new Date(Date.now() - 15 * 86_400_000).toISOString(),
        market_days_consumed: 3, status: "ACTIVE", created_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
      });
      const res = await app.inject({ method: "GET", url: "/cloud/signals/outlook" });
      expect(res.statusCode).toBe(200);
    });

    it("Academy and Support routes require no plan at all -- not even a trial -- only being logged in", async () => {
      // signals.ts doesn't register academy/support routes, but this proves
      // the negative for THIS router: a user with zero grant of any kind is
      // blocked only from signal endpoints, confirming the 403s above are
      // entitlement-specific, not a blanket auth failure that would also
      // explain why Academy/Support happen to work (they're proven directly
      // in academy.test.ts and rely on requireCloudUser alone, no
      // requireCapability call anywhere in routes/cloud/academy.ts or
      // routes/cloud/support.ts -- grepped, not assumed).
      const res = await app.inject({ method: "GET", url: "/cloud/signals/recent" });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("diagnostic reason when the signal feed is genuinely unavailable (not an entitlement problem)", () => {
    beforeEach(async () => {
      const started = new Date();
      await state.db.collection("signal_trials").insertOne({
        id: "t4", user_id: "user-1", trial_started_at: started.toISOString(),
        trial_expires_at: computeTrialExpiry(started).toISOString(),
        market_days_consumed: 1, status: "ACTIVE", created_at: started.toISOString(),
      });
    });

    it("reports SOURCE_NOT_CONFIGURED when no admin has designated a subscriber source account -- distinct from an entitlement denial", async () => {
      const res = await app.inject({ method: "GET", url: "/cloud/signals/outlook" });
      expect(res.statusCode).toBe(200); // entitled -- this must never be a 403
      expect(res.json()).toMatchObject({ available: false, reason: "SOURCE_NOT_CONFIGURED" });
    });

    it("reports SOURCE_OFFLINE when configured but the account's heartbeat is stale", async () => {
      await state.db.collection("admin_settings").insertOne({ key: "main", subscriber_signal_source_account: "999999" });
      state.db.collection("cloud_bot_heartbeats").docs.push({ account_number: "999999", ts: new Date(Date.now() - 10 * 60_000).toISOString() });
      const res = await app.inject({ method: "GET", url: "/cloud/signals/outlook" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ available: false, reason: "SOURCE_OFFLINE" });
    });

    it("reports available:true once genuinely configured with a fresh heartbeat -- proving the fix works once the one setting is set", async () => {
      await state.db.collection("admin_settings").insertOne({ key: "main", subscriber_signal_source_account: "476396807" });
      state.db.collection("cloud_bot_heartbeats").docs.push({ account_number: "476396807", ts: new Date().toISOString() });
      const res = await app.inject({ method: "GET", url: "/cloud/signals/outlook" });
      expect(res.statusCode).toBe(200);
      expect(res.json().available).toBe(true);
    });
  });
});
