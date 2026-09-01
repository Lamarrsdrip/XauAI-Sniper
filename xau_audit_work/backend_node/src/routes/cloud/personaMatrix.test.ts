/**
 * The persona/entitlement acceptance matrix requested for the "ONE Command
 * Center" redesign (2026-08-25) -- run as real HTTP requests against the
 * actual route handlers (not re-derived assertions), so this is proof, not
 * documentation. Covers the 6 personas that differ in entitlement (Admin is
 * a separate surface -- requireAdmin, not requireCloudUser -- so it isn't
 * part of this Command Center matrix).
 *
 * What this proves per persona:
 *   - GET /cloud/entitlement -- the exact capability flags the frontend
 *     branches its BotRequiredPage locks on.
 *   - GET /cloud/signals/{outlook,engine,recent} -- 200 vs 403 NOT_ENTITLED.
 *   - GET /cloud/academy/progress, GET /cloud/support/tickets -- always 200,
 *     regardless of plan (these must never be capability-gated).
 *   - POST /cloud/command/request -- the REAL security boundary behind the
 *     frontend's bot-only lock. A user with no valid, owned license PIN
 *     gets rejected here even if they somehow reached the UI action; a bot
 *     owner's own PIN is accepted. This is what makes the frontend's
 *     "visible but locked" pattern safe: the lock is UX, this is auth.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => { process.env["ENVIRONMENT"] = "test"; });

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, user: null as Record<string, unknown> | null }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth.js")>();
  return {
    ...actual,
    requireCloudUser: async (request: unknown) => { (request as { cloudUser?: unknown }).cloudUser = state.user; },
    rateLimit: () => {},
  };
});
vi.mock("../../services/adminOpsControl.js", () => ({ publishedTransactionalRender: vi.fn(async () => null) }));
vi.mock("../../services/emailBranding.js", () => ({
  emailBranding: vi.fn(async () => ({ sender_name: "XauCloud", command_center_url: "https://xaucloud.io/command" })),
  emailLinkButton: () => "",
}));
vi.mock("../../services/email.js", () => ({ sendEmail: vi.fn(async () => true) }));
vi.mock("../../services/botActivity.js", () => ({ storeBotActivity: vi.fn(async () => {}) }));

const { registerCloudSignalRoutes } = await import("./signals.js");
const { registerAcademyRoutes } = await import("./academy.js");
const { registerCloudSupportRoutes } = await import("./support.js");
const { registerCloudCommandRoutes } = await import("./command.js");
const { computeTrialExpiry } = await import("../../services/signalTrial.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerCloudSignalRoutes(app);
  await registerAcademyRoutes(app);
  await registerCloudSupportRoutes(app);
  await registerCloudCommandRoutes(app);
  return app;
}

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("persona/entitlement acceptance matrix", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.db = new FakeDb();
    state.db.uniqueIndexes["signal_trials"] = ["user_id"];
    state.user = { id: "persona-user", email: "persona@example.com", full_name: "Persona Tester" };
    app = await createApp();
  });

  async function entitlement() {
    return (await app.inject({ method: "GET", url: "/cloud/entitlement" })).json();
  }
  async function signalStatus(path: string) {
    return (await app.inject({ method: "GET", url: path })).statusCode;
  }
  async function commandBoundary(pin: string) {
    return (await app.inject({
      method: "POST", url: "/cloud/command/request",
      payload: { action: "RESUME_TRADING", pin, confirm: true },
    })).statusCode;
  }
  async function alwaysOpenSurfaces() {
    return {
      academy: (await app.inject({ method: "GET", url: "/cloud/academy/progress" })).statusCode,
      support: (await app.inject({ method: "GET", url: "/cloud/support/tickets" })).statusCode,
      billing: (await app.inject({ method: "GET", url: "/cloud/billing" })).statusCode,
    };
  }

  it("Persona 1 -- Active free-trial user: signals YES, bot-personal NO", async () => {
    await state.db.collection("signal_trials").insertOne({
      id: "t1", user_id: "persona-user", trial_started_at: new Date().toISOString(),
      trial_expires_at: computeTrialExpiry(new Date()).toISOString(),
      market_days_consumed: 1, status: "ACTIVE", created_at: new Date().toISOString(),
    });
    const ent = await entitlement();
    expect(ent).toMatchObject({ signals_access: true, outlook_access: true, engine_10m_access: true, bot_license: false, bot_operations: false });
    expect(await signalStatus("/cloud/signals/outlook")).toBe(200);
    expect(await signalStatus("/cloud/signals/engine")).toBe(200);
    expect(await signalStatus("/cloud/signals/recent")).toBe(200);
    expect(await commandBoundary("ASE-NOPE-0000")).toBe(403);
    const open = await alwaysOpenSurfaces();
    expect(open).toMatchObject({ academy: 200, support: 200, billing: 200 });
  });

  it("Persona 2 -- Expired trial, no subscription: signals NO, everything else open", async () => {
    await state.db.collection("signal_trials").insertOne({
      id: "t2", user_id: "persona-user", trial_started_at: ago(20),
      trial_expires_at: ago(15), market_days_consumed: 3, status: "ACTIVE", created_at: ago(20),
    });
    const ent = await entitlement();
    expect(ent).toMatchObject({ signals_access: false, outlook_access: false, engine_10m_access: false, bot_license: false });
    expect(await signalStatus("/cloud/signals/outlook")).toBe(403);
    expect(await signalStatus("/cloud/signals/engine")).toBe(403);
    expect(await signalStatus("/cloud/signals/recent")).toBe(403);
    expect(await commandBoundary("ASE-NOPE-0000")).toBe(403);
    const open = await alwaysOpenSurfaces();
    expect(open).toMatchObject({ academy: 200, support: 200, billing: 200 });
  });

  it("Persona 3 -- Weekly signal subscriber, no bot: signals YES, bot-personal NO", async () => {
    await state.db.collection("signal_subscriptions").insertOne({
      user_id: "persona-user", plan: "WEEKLY", status: "ACTIVE", source_payment_ref: "ref-w1",
      expires_at: ahead(5), activated_at: new Date().toISOString(),
    });
    const ent = await entitlement();
    expect(ent).toMatchObject({ signals_access: true, bot_license: false, source: "subscription" });
    expect(await signalStatus("/cloud/signals/outlook")).toBe(200);
    expect(await signalStatus("/cloud/signals/engine")).toBe(200);
    expect(await signalStatus("/cloud/signals/recent")).toBe(200);
    expect(await commandBoundary("ASE-NOPE-0000")).toBe(403);
  });

  it("Persona 4 -- Monthly signal subscriber, no bot: same signal access as weekly", async () => {
    await state.db.collection("signal_subscriptions").insertOne({
      user_id: "persona-user", plan: "MONTHLY", status: "ACTIVE", source_payment_ref: "ref-m1",
      expires_at: ahead(20), activated_at: new Date().toISOString(),
    });
    const ent = await entitlement();
    expect(ent).toMatchObject({ signals_access: true, bot_license: false, source: "subscription" });
    expect(await signalStatus("/cloud/signals/outlook")).toBe(200);
    expect(await commandBoundary("ASE-NOPE-0000")).toBe(403);
  });

  it("Persona 5 -- Bot owner (lifetime license, no trial/subscription at all): everything YES", async () => {
    state.db.collection("pin_licenses").docs.push({ pin: "ASE-OWNS-0001", buyer_email: "persona@example.com", is_active: true });
    const ent = await entitlement();
    expect(ent).toMatchObject({
      signals_access: true, outlook_access: true, engine_10m_access: true,
      bot_license: true, bot_operations: true, bot_activity: true, performance_access: true, automation_access: true,
      source: "lifetime",
    });
    expect(await signalStatus("/cloud/signals/outlook")).toBe(200);
    // The real security boundary: their OWN pin is accepted (not a 403 from
    // verifyCommandLicense); some other unowned pin is still rejected.
    expect(await commandBoundary("ASE-OWNS-0001")).toBe(200);
    expect(await commandBoundary("ASE-NOT-OWNED9")).toBe(403);
  });

  it("Persona 6 -- Bot owner with a connected/heartbeating account: license entitlement unaffected by connection state", async () => {
    state.db.collection("pin_licenses").docs.push({ pin: "ASE-CONN-0002", buyer_email: "persona@example.com", is_active: true, mt5_account: "555001" });
    state.db.collection("cloud_bot_heartbeats").docs.push({ account_number: "555001", pin: "ASE-CONN-0002", ts: new Date().toISOString(), bot_state: "RUNNING" });
    const ent = await entitlement();
    expect(ent.bot_license).toBe(true);
    expect(await commandBoundary("ASE-CONN-0002")).toBe(200);
  });

  it("cross-persona: a bot owner whose signal trial independently expired keeps signal access via the license alone", async () => {
    state.db.collection("pin_licenses").docs.push({ pin: "ASE-BOTH-0003", buyer_email: "persona@example.com", is_active: true });
    await state.db.collection("signal_trials").insertOne({
      id: "t3", user_id: "persona-user", trial_started_at: ago(20), trial_expires_at: ago(15),
      market_days_consumed: 3, status: "ACTIVE", created_at: ago(20),
    });
    const ent = await entitlement();
    expect(ent).toMatchObject({ signals_access: true, bot_license: true, source: "lifetime" });
    expect(await signalStatus("/cloud/signals/outlook")).toBe(200);
  });
});
