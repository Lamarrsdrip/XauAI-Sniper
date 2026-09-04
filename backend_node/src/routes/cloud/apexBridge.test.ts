import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { FakeDb } from "../../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));

import { LicenseError } from "../../services/license.js";
import { registerApexBridgeRoutes } from "./apexBridge.js";
import { registerCloudMonitorRoutes } from "./monitor.js";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(422).send({ detail: error.issues });
    if (error instanceof LicenseError) return reply.code(error.statusCode).send({ detail: error.detail });
    return reply.code(500).send({ detail: error.message });
  });
  const heartbeats = state.db.collection("cloud_bot_heartbeats") as unknown as { docs: unknown[]; estimatedDocumentCount: () => Promise<number> };
  heartbeats.estimatedDocumentCount = async () => heartbeats.docs.length;
  await app.register(async (api) => {
    await registerCloudMonitorRoutes(api);
    await registerApexBridgeRoutes(api);
  }, { prefix: "/api" });
  return app;
}

function bridgeHeaders(secret = "test-bridge-secret") {
  return { "content-type": "application/json", "x-apex-bridge-secret": secret };
}

async function assertEaRoutesAlwaysPass(app: FastifyInstance, pin: string, account: string): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/cloud/monitor/heartbeat",
      payload: {
        license_key: pin,
        account_number: account,
        bot_online: true,
        algo_trading: true,
        trading_allowed: true,
        mt5_connected: true,
        account_connected: true,
        symbol: "XAUUSD",
      },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json()).toMatchObject({ ok: true, account });

    const config = await app.inject({
      method: "GET",
      url: `/api/cloud/apex/config?license_key=${encodeURIComponent(pin)}&account=${account}`,
    });
    expect(config.statusCode).toBe(200);
    expect(config.json()).toMatchObject({ ok: true, licenseStatus: "ACTIVE", armed: false });

    const event = await app.inject({
      method: "POST",
      url: "/api/cloud/apex/event",
      payload: { license_key: pin, account, type: "SELF_TEST", sequence: i },
    });
    expect(event.statusCode).toBe(200);
    expect(event.json()).toMatchObject({ ok: true, status: "received" });
  }
}

describe("Apex canonical license bridge", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.db.uniqueIndexes.pin_licenses = ["pin"];
    process.env.APEX_BRIDGE_SECRET = "test-bridge-secret";
  });

  afterEach(() => {
    delete process.env.APEX_BRIDGE_SECRET;
  });

  it("mirrors one normalized PIN and never alternates 200/403 across heartbeat, config, event, or restart", async () => {
    let app = await buildApp();
    const upsert = await app.inject({
      method: "POST",
      url: "/api/cloud/apex/bridge/license/upsert",
      headers: bridgeHeaders(),
      payload: { license: "  apex-ab cd-1234  ", active: true, account: "", customer: "Apex owner" },
    });
    expect(upsert.statusCode).toBe(200);

    const configUpsert = await app.inject({
      method: "POST",
      url: "/api/cloud/apex/bridge/config/upsert",
      headers: bridgeHeaders(),
      payload: { license: "APEX-ABCD-1234", config: { armed: false }, commandRevision: 4 },
    });
    expect(configUpsert.statusCode).toBe(200);

    const stored = await state.db.collection("pin_licenses").findOne({ pin: "APEX-ABCD-1234" });
    expect(stored).toMatchObject({
      pin: "APEX-ABCD-1234",
      is_active: true,
      mt5_account: "",
      is_used: false,
      source: "APEX",
      apex_license: true,
    });
    expect(stored?.["created_at"]).toEqual(expect.any(String));
    expect(stored?.["updated_at"]).toEqual(expect.any(String));

    await assertEaRoutesAlwaysPass(app, " apex-ab cd-1234 ", "476885386");
    expect(await state.db.collection("pin_licenses").findOne({ pin: "APEX-ABCD-1234" })).toMatchObject({
      mt5_account: "476885386",
      is_used: true,
    });

    const disabled = await app.inject({
      method: "POST",
      url: "/api/cloud/apex/bridge/license/upsert",
      headers: bridgeHeaders(),
      payload: { license: "APEX-ABCD-1234", active: false, account: "" },
    });
    expect(disabled.statusCode).toBe(200);
    const deniedWhileDisabled = await app.inject({
      method: "GET",
      url: "/api/cloud/apex/config?license_key=APEX-ABCD-1234&account=476885386",
    });
    expect(deniedWhileDisabled.statusCode).toBe(403);
    expect(deniedWhileDisabled.json().detail.reason).toBe("INVALID_OR_INACTIVE_LICENSE_PIN");
    const enabled = await app.inject({
      method: "POST",
      url: "/api/cloud/apex/bridge/license/upsert",
      headers: bridgeHeaders(),
      payload: { license: "APEX-ABCD-1234", active: true, account: "" },
    });
    expect(enabled.statusCode).toBe(200);
    await assertEaRoutesAlwaysPass(app, "APEX-ABCD-1234", "476885386");

    await app.close();
    app = await buildApp();
    await assertEaRoutesAlwaysPass(app, "APEX-ABCD-1234", "476885386");

    const wrongPin = await app.inject({
      method: "GET",
      url: "/api/cloud/apex/config?license_key=APEX-WRONG-0000&account=476885386",
    });
    expect(wrongPin.statusCode).toBe(403);
    expect(wrongPin.json().detail.reason).toBe("INVALID_OR_INACTIVE_LICENSE_PIN");

    const wrongAccount = await app.inject({
      method: "POST",
      url: "/api/cloud/apex/event",
      payload: { license_key: "APEX-ABCD-1234", account: "999999999", type: "SELF_TEST" },
    });
    expect(wrongAccount.statusCode).toBe(403);
    expect(wrongAccount.json().detail.reason).toBe("LICENSE_BOUND_TO_DIFFERENT_MT5_ACCOUNT");

    const status = await app.inject({
      method: "GET",
      url: "/api/cloud/apex/bridge/status?license=APEX-ABCD-1234",
      headers: bridgeHeaders(),
    });
    expect(status.json()).toMatchObject({
      ok: true,
      license: { key: "APEX-...1234", exists: true, active: true, account: "476885386", source: "APEX", apexLicense: true },
      configExists: true,
    });
    await app.close();
  });

  it("returns explicit JSON for bridge-secret failures", async () => {
    const app = await buildApp();
    const missing = await app.inject({ method: "POST", url: "/api/cloud/apex/bridge/license/upsert", payload: { license: "APEX-TEST-0001" } });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ ok: false, error: "bridge_secret_missing" });

    const invalid = await app.inject({
      method: "POST", url: "/api/cloud/apex/bridge/license/upsert", headers: bridgeHeaders("wrong"), payload: { license: "APEX-TEST-0001" },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ ok: false, error: "bridge_secret_invalid" });

    delete process.env.APEX_BRIDGE_SECRET;
    const unconfigured = await app.inject({
      method: "POST", url: "/api/cloud/apex/bridge/license/upsert", headers: bridgeHeaders(), payload: { license: "APEX-TEST-0001" },
    });
    expect(unconfigured.statusCode).toBe(503);
    expect(unconfigured.json()).toEqual({ ok: false, error: "bridge_secret_not_configured" });
    await app.close();
  });

  it("allows exactly one atomic first-account claim", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/cloud/apex/bridge/license/upsert",
      headers: bridgeHeaders(),
      payload: { license: "APEX-FIRST-CLAIM", active: true, account: "" },
    });
    await app.inject({
      method: "POST",
      url: "/api/cloud/apex/bridge/config/upsert",
      headers: bridgeHeaders(),
      payload: { license: "APEX-FIRST-CLAIM", config: { armed: false }, commandRevision: 0 },
    });

    const attempts = await Promise.all([
      app.inject({ method: "GET", url: "/api/cloud/apex/config?license_key=APEX-FIRST-CLAIM&account=111" }),
      app.inject({ method: "GET", url: "/api/cloud/apex/config?license_key=APEX-FIRST-CLAIM&account=222" }),
    ]);
    expect(attempts.map((response) => response.statusCode).sort()).toEqual([200, 403]);
    const loser = attempts.find((response) => response.statusCode === 403);
    expect(loser?.json().detail.reason).toBe("LICENSE_BOUND_TO_DIFFERENT_MT5_ACCOUNT");
    const stored = await state.db.collection("pin_licenses").findOne({ pin: "APEX-FIRST-CLAIM" });
    expect(["111", "222"]).toContain(stored?.["mt5_account"]);
    expect(stored?.["is_used"]).toBe(true);
    await app.close();
  });

  it("never overwrites an existing normal XauCloud license", async () => {
    await state.db.collection("pin_licenses").insertOne({ pin: "APEX-COLLISION-1", is_active: true, source: "PAYMENT" });
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/cloud/apex/bridge/license/upsert",
      headers: bridgeHeaders(),
      payload: { license: "APEX-COLLISION-1", active: false },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("license_pin_conflicts_with_existing_xaucloud_license");
    expect(await state.db.collection("pin_licenses").findOne({ pin: "APEX-COLLISION-1" })).toMatchObject({ is_active: true, source: "PAYMENT" });
    await app.close();
  });
});
