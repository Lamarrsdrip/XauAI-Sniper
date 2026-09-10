import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

type Doc = Record<string, unknown>;

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../services/license.js", () => ({
  resolveMonitorLicense: vi.fn(async () => null),
  resolveEaMonitorLicense: vi.fn(async () => ({ pin: "TESTPIN" })),
  normalizeLicenseKey: (v: string) => (v || "").trim().toUpperCase(),
}));

const { registerCloudOutlookThesisRoutes } = await import("./outlookThesis.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerCloudOutlookThesisRoutes(app);
  return app;
}

function thesisDoc(overrides: Doc = {}): Doc {
  const now = Date.now();
  return {
    id: "t1",
    outlook_id: "outlook-1",
    account: "555111",
    symbol: "XAUUSD",
    direction: "BUY",
    status: "ACTIVE",
    license_key: "TESTPIN",
    generated_at: new Date(now - 5 * 60_000).toISOString(),
    expires_at: new Date(now + 55 * 60_000).toISOString(),
    ...overrides,
  };
}

describe("GET /cloud/outlook/thesis", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    state.db = new FakeDb();
    app = await createApp();
  });

  it("does not deliver another account's thesis when queried for a different account", async () => {
    state.db.collection("cloud_outlook_thesis").docs.push(thesisDoc({ account: "999999" }));
    const res = await app.inject({ method: "GET", url: "/cloud/outlook/thesis?account=555111" });
    expect(res.statusCode).toBe(200);
    expect(res.json().thesis).toBeNull();
  });

  it("delivers the thesis for the matching account", async () => {
    state.db.collection("cloud_outlook_thesis").docs.push(thesisDoc({ account: "555111" }));
    const res = await app.inject({ method: "GET", url: "/cloud/outlook/thesis?account=555111" });
    const body = res.json();
    expect(body.thesis).toBeTruthy();
    expect(body.thesis.outlook_id).toBe("outlook-1");
  });

  it("never delivers an expired thesis (stale context cannot trigger a trade)", async () => {
    const expired = thesisDoc({ account: "555111", expires_at: new Date(Date.now() - 60_000).toISOString() });
    state.db.collection("cloud_outlook_thesis").docs.push(expired);
    const res = await app.inject({ method: "GET", url: "/cloud/outlook/thesis?account=555111" });
    expect(res.json().thesis).toBeNull();
  });

  it("never delivers a SUPERSEDED thesis, only the current ACTIVE one", async () => {
    state.db.collection("cloud_outlook_thesis").docs.push(thesisDoc({ account: "555111", status: "SUPERSEDED", outlook_id: "old" }));
    state.db.collection("cloud_outlook_thesis").docs.push(thesisDoc({ account: "555111", status: "ACTIVE", outlook_id: "new" }));
    const res = await app.inject({ method: "GET", url: "/cloud/outlook/thesis?account=555111" });
    expect(res.json().thesis.outlook_id).toBe("new");
  });
});
