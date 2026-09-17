import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", () => ({
  requireCloudUser: async () => undefined,
  rateLimit: () => undefined,
}));
vi.mock("../../services/license.js", () => ({
  normalizeLicenseKey: (k: string) => (k || "").trim().toUpperCase().replace(/ /g, ""),
  resolveEaMonitorLicense: vi.fn(async (_pin: string, account: string) => ({
    pin: "TESTPIN",
    mt5_account: String(account),
  })),
}));
vi.mock("../../services/commandStateMachine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/commandStateMachine.js")>();
  return {
    ...actual,
    expireStalePendingCommands: vi.fn(async () => 0),
  };
});

const { registerCloudCommandRoutes } = await import("./command.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerCloudCommandRoutes(app);
  return app;
}

describe("GET /cloud/command/pending — no empty-account leak", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("does not return PENDING commands with empty or missing mt5_account", async () => {
    state.db.collection("cloud_bot_commands").docs.push(
      { status: "PENDING", license_key: "TESTPIN", mt5_account: "111", command_id: "mine", requested_at: "2026-01-01T00:00:00.000Z" },
      { status: "PENDING", license_key: "TESTPIN", mt5_account: "", command_id: "leak-empty", requested_at: "2026-01-01T00:00:01.000Z" },
      { status: "PENDING", license_key: "TESTPIN", command_id: "leak-missing", requested_at: "2026-01-01T00:00:02.000Z" },
      { status: "PENDING", license_key: "TESTPIN", mt5_account: "999", command_id: "other-account", requested_at: "2026-01-01T00:00:03.000Z" },
    );
    const app = await createApp();
    const res = await app.inject({
      method: "GET",
      url: "/cloud/command/pending?pin=TESTPIN&account=111&limit=10",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = (body.commands as Array<{ command_id: string }>).map((c) => c.command_id);
    expect(ids).toEqual(["mine"]);
    expect(body.count).toBe(1);
  });
});
