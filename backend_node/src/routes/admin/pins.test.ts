import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "test-secret";
});

type Doc = Record<string, unknown>;
class FakeCollection {
  docs: Doc[] = [];
  async findOne(query: Doc): Promise<Doc | null> {
    const found = this.docs.find((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    return found ? structuredClone(found) : null;
  }
  async updateOne(query: Doc, update: { $set?: Doc }) {
    const found = this.docs.find((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    if (!found) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(found, structuredClone(update.$set ?? {}));
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async insertOne(doc: Doc) { this.docs.push(structuredClone(doc)); return { acknowledged: true }; }
  async deleteOne(query: Doc) {
    const i = this.docs.findIndex((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    if (i === -1) return { deletedCount: 0 };
    this.docs.splice(i, 1);
    return { deletedCount: 1 };
  }
  async deleteMany(query: Doc) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !Object.entries(query).every(([k, v]) => d[k] === v));
    return { deletedCount: before - this.docs.length };
  }
  aggregate() { return { toArray: async () => [{}] }; }
  find() { return { sort: () => ({ limit: () => ({ toArray: async () => this.docs }) }) }; }
}
class FakeDb {
  private map = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    if (!this.map.has(name)) this.map.set(name, new FakeCollection());
    return this.map.get(name)!;
  }
}
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", () => ({
  requireAdmin: async (request: { admin?: Record<string, unknown> }) => { request.admin = { email: "admin@xaucloud.io" }; },
  verifyPassword: async () => true,
}));
vi.mock("../../services/paymentFulfillment.js", () => ({ generateUniquePin: () => "TESTPIN1234" }));

const licenseStatusCalls = vi.hoisted(() => ({ calls: [] as { to: string; change: string }[] }));
vi.mock("../../services/accountLifecycleEmails.js", () => ({
  maskLicensePin: (pin: string) => `masked:${pin}`,
  sendLicenseStatusEmail: vi.fn(async (to: string, _name: string, change: string) => { licenseStatusCalls.calls.push({ to, change }); return true; }),
}));

const { registerAdminPinsRoutes } = await import("./pins.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerAdminPinsRoutes(app);
  return app;
}

describe("license_status email wiring (admin/pins.ts)", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    state.db = new FakeDb();
    licenseStatusCalls.calls = [];
    app = await createApp();
  });

  it("sends a deactivated notice on a genuine active -> revoked transition", async () => {
    state.db.collection("pin_licenses").docs.push({ pin: "PIN1", is_active: true, buyer_email: "buyer@example.com", buyer_name: "Ada" });
    const res = await app.inject({ method: "PUT", url: "/admin/pins/PIN1/revoke" });
    expect(res.statusCode).toBe(200);
    expect(licenseStatusCalls.calls).toEqual([{ to: "buyer@example.com", change: "deactivated" }]);
  });

  it("does not send a duplicate email when revoking an already-revoked license", async () => {
    state.db.collection("pin_licenses").docs.push({ pin: "PIN1", is_active: false, buyer_email: "buyer@example.com", buyer_name: "Ada" });
    const res = await app.inject({ method: "PUT", url: "/admin/pins/PIN1/revoke" });
    expect(res.statusCode).toBe(200);
    expect(licenseStatusCalls.calls).toHaveLength(0);
  });

  it("sends an activated notice on a genuine inactive -> active transition", async () => {
    state.db.collection("pin_licenses").docs.push({ pin: "PIN1", is_active: false, buyer_email: "buyer@example.com", buyer_name: "Ada" });
    const res = await app.inject({ method: "PUT", url: "/admin/pins/PIN1/activate" });
    expect(res.statusCode).toBe(200);
    expect(licenseStatusCalls.calls).toEqual([{ to: "buyer@example.com", change: "activated" }]);
  });

  it("still 404s for a genuinely missing license, not a false idempotent success", async () => {
    const res = await app.inject({ method: "PUT", url: "/admin/pins/NOPE/revoke" });
    expect(res.statusCode).toBe(404);
    expect(licenseStatusCalls.calls).toHaveLength(0);
  });

  it("sends an activation_reset notice on account reset", async () => {
    state.db.collection("users").docs.push({ email: "admin@xaucloud.io", password_hash: "x" });
    state.db.collection("pin_licenses").docs.push({ pin: "PIN1", id: "l1", is_active: true, mt5_account: "123", buyer_email: "buyer@example.com", buyer_name: "Ada" });
    const res = await app.inject({ method: "POST", url: "/admin/pins/PIN1/reset-account", payload: { admin_password: "x", reason: "customer requested" } });
    expect(res.statusCode).toBe(200);
    expect(licenseStatusCalls.calls).toEqual([{ to: "buyer@example.com", change: "activation_reset" }]);
  });

  it("does not email when the license has no buyer_email on file", async () => {
    state.db.collection("pin_licenses").docs.push({ pin: "PIN1", is_active: true, buyer_email: "" });
    const res = await app.inject({ method: "PUT", url: "/admin/pins/PIN1/revoke" });
    expect(res.statusCode).toBe(200);
    expect(licenseStatusCalls.calls).toHaveLength(0);
  });
});
