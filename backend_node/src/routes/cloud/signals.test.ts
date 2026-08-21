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
});
