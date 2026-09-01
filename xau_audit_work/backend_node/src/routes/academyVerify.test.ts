import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => { process.env["ENVIRONMENT"] = "test"; });
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { registerAcademyVerifyRoutes } = await import("./academyVerify.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerAcademyVerifyRoutes(app);
  return app;
}

describe("public certificate verification -- no auth, safe fields only", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    state.db = new FakeDb();
    app = await createApp();
  });

  it("returns only the allowed safe fields for a valid certificate", async () => {
    state.db.collection("academy_certificates").docs.push({
      certificate_id: "XC-ACADEMY-VERIFY0001", user_id: "u1", program: "forex_academy", curriculum_version: "v1",
      recipient_name: "Ada Lovelace", completed_at: "2026-08-20T00:00:00.000Z", issued_at: "2026-08-20T00:00:00.000Z", status: "valid",
    });
    const res = await app.inject({ method: "GET", url: "/academy/verify/XC-ACADEMY-VERIFY0001" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ found: true, certificate: { recipient_name: "Ada Lovelace", certificate_id: "XC-ACADEMY-VERIFY0001", status: "valid" } });
    expect(JSON.stringify(body)).not.toMatch(/user_id|u1|payment|license/i);
  });

  it("returns 404 for an unknown certificate id", async () => {
    const res = await app.inject({ method: "GET", url: "/academy/verify/XC-ACADEMY-NOPE0000" });
    expect(res.statusCode).toBe(404);
    expect(res.json().found).toBe(false);
  });

  it("shows revoked status clearly for a revoked certificate", async () => {
    state.db.collection("academy_certificates").docs.push({
      certificate_id: "XC-ACADEMY-REVOKED001", user_id: "u1", program: "forex_academy", curriculum_version: "v1",
      recipient_name: "Ada Lovelace", completed_at: "2026-08-20T00:00:00.000Z", issued_at: "2026-08-20T00:00:00.000Z",
      status: "revoked", revoked_at: "2026-08-21T00:00:00.000Z", revoked_reason: "issued in error",
    });
    const res = await app.inject({ method: "GET", url: "/academy/verify/XC-ACADEMY-REVOKED001" });
    expect(res.statusCode).toBe(200);
    expect(res.json().certificate.status).toBe("revoked");
  });
});
