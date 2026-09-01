import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "auth-security-test-secret";
});
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("./db.js", () => ({ getDb: () => state.db }));

const { createAccessToken, createCloudToken, requireAdmin } = await import("./auth.js");

async function appWithAdminGuard() {
  const app = Fastify({ logger: false });
  app.get("/guarded", { preHandler: requireAdmin }, async () => ({ ok: true }));
  return app;
}

describe("admin JWT boundary", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.db.collection("users").docs.push({ email: "admin@test.local", role: "admin", name: "Admin" });
  });

  it("rejects a cloud-session JWT even when its email belongs to an admin", async () => {
    const app = await appWithAdminGuard();
    const token = createCloudToken("cloud-user-id", "admin@test.local", 0);
    const res = await app.inject({ method: "GET", url: "/guarded", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ detail: "Wrong token type" });
  });

  it("rejects an access token issued before the admin session version was rotated", async () => {
    state.db = new FakeDb();
    state.db.collection("users").docs.push({ email: "admin@test.local", role: "admin", name: "Admin", session_version: 1 });
    const app = await appWithAdminGuard();
    const stale = createAccessToken("admin-id", "admin@test.local", 0);
    const res = await app.inject({ method: "GET", url: "/guarded", headers: { authorization: `Bearer ${stale}` } });
    expect(res.statusCode).toBe(401);
  });

  it("accepts the intended admin access-token type", async () => {
    const app = await appWithAdminGuard();
    const token = createAccessToken("admin-id", "admin@test.local");
    const res = await app.inject({ method: "GET", url: "/guarded", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });
});
