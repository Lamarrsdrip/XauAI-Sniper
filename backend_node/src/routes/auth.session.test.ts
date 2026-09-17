import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "test-jwt-secret-for-session-revocation";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { createAccessToken, createCloudToken } = await import("../auth.js");
const { registerAuthRoutes } = await import("./auth.js");
const { registerCloudAuthRoutes } = await import("./cloud/auth.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerAuthRoutes(app);
  await registerCloudAuthRoutes(app);
  return app;
}

describe("session revocation on logout", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("admin logout bumps session_version so the previous access token is rejected", async () => {
    const id = new ObjectId();
    state.db.collection("users").docs.push({
      _id: id,
      email: "admin@xaucloud.io",
      role: "admin",
      is_active: true,
      session_version: 0,
      name: "Admin",
    });
    const token = createAccessToken(String(id), "admin@xaucloud.io", 0);
    const app = await createApp();

    const before = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(200);
    expect(state.db.collection("users").docs[0]!["session_version"]).toBe(1);

    const after = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().detail).toMatch(/revoked/i);
  });

  it("cloud logout bumps session_version so the previous cloud token is rejected", async () => {
    state.db.collection("cloud_users").docs.push({
      id: "user-1",
      email: "trader@example.com",
      session_version: 0,
    });
    const token = createCloudToken("user-1", "trader@example.com", 0);
    const app = await createApp();

    const before = await app.inject({
      method: "GET",
      url: "/cloud/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    const logout = await app.inject({
      method: "POST",
      url: "/cloud/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(200);
    expect(state.db.collection("cloud_users").docs[0]!["session_version"]).toBe(1);

    const after = await app.inject({
      method: "GET",
      url: "/cloud/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().detail).toMatch(/revoked/i);
  });
});
