import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";
import { AuthError } from "../auth.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("../auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth.js")>();
  return {
    ...actual,
    requireCloudUser: async () => undefined,
  };
});
vi.mock("../services/settings.js", () => ({ getSettings: async () => ({}) }));
vi.mock("../services/goldPrice.js", () => ({ fetchLiveGoldPrice: async () => ({ available: false }) }));
vi.mock("../services/releaseManifest.js", () => ({ currentEaRelease: () => ({ version: "6.28.6" }) }));
vi.mock("../services/commandLicense.js", () => ({ getUserLicense: async () => null }));
vi.mock("../services/propFirmConfig.js", () => ({ normalizePropFirmConfig: (v: unknown) => v }));

const { registerMiscRoutes } = await import("./misc.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) return reply.code(error.statusCode).send({ detail: error.message });
    throw error;
  });
  await registerMiscRoutes(app);
  return app;
}

describe("retired copy-trading master routes", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it.each([
    ["POST", "/cloud/master/signal"],
    ["POST", "/cloud/master/signal-close"],
    ["POST", "/cloud/master/signal-partial"],
    ["POST", "/cloud/master/heartbeat"],
    ["GET", "/cloud/master/config"],
    ["POST", "/cloud/master/reasoning"],
  ] as const)("%s %s returns 410 retired", async (method, url) => {
    const app = await createApp();
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ detail: "retired" });
  });

  it("POST /configs accepts a public submission", async () => {
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/configs", payload: { name: "demo" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(state.db.collection("ea_configs").docs).toHaveLength(1);
  });
});
