import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => { process.env["ENVIRONMENT"] = "test"; });

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", () => ({
  requireAdmin: async (request: unknown) => { (request as { admin?: unknown }).admin = { email: "admin@xaucloud.io" }; },
}));

const { registerAdminSignalSubscriptionRoutes } = await import("./signalSubscriptions.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerAdminSignalSubscriptionRoutes(app);
  return app;
}

describe("admin signal subscription visibility", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.db = new FakeDb();
    app = await createApp();
  });

  it("overview counts active trials/subscribers/licenses correctly", async () => {
    await state.db.collection("signal_trials").insertOne({ user_id: "u1", trial_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    await state.db.collection("signal_trials").insertOne({ user_id: "u2", trial_expires_at: new Date(Date.now() - 86_400_000).toISOString() });
    await state.db.collection("signal_subscriptions").insertOne({ user_id: "u3", plan: "WEEKLY", status: "ACTIVE", expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    await state.db.collection("signal_subscriptions").insertOne({ user_id: "u4", plan: "MONTHLY", status: "ACTIVE", expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    await state.db.collection("pin_licenses").insertOne({ pin: "ASE-A", is_active: true });
    await state.db.collection("payment_transactions").insertOne({ reference: "r1", provider: "BANK_TRANSFER", payment_status: "BANK_TRANSFER_SUBMITTED", plan_id: "SIGNALS_WEEKLY" });

    const res = await app.inject({ method: "GET", url: "/admin/signals/overview" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      active_trials: 1, expired_trials: 1, weekly_subscribers: 1, monthly_subscribers: 1, lifetime_licenses: 1, pending_signal_bank_transfers: 1,
    });
  });

  it("users view joins trial/subscription rows with the owning cloud_users record", async () => {
    await state.db.collection("cloud_users").insertOne({ id: "u1", email: "trader@example.com", full_name: "Trader One" });
    await state.db.collection("signal_trials").insertOne({ user_id: "u1", trial_started_at: new Date().toISOString(), trial_expires_at: new Date(Date.now() + 86_400_000).toISOString() });

    const res = await app.inject({ method: "GET", url: "/admin/signals/users" });
    expect(res.statusCode).toBe(200);
    const row = res.json().users[0];
    expect(row.email).toBe("trader@example.com");
    expect(row.trial.status).toBe("ACTIVE");
  });
});
