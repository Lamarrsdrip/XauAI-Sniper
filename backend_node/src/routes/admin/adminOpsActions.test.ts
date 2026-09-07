import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

// The draft must reflect whatever release the manifest currently promotes.
// Derived rather than pinned: hard-coding a version made this test fail on
// every promotion (it still said v6.28.3 when v6.28.6 shipped), which is noise,
// not a regression signal. Same manifest-reading convention as
// services/manualTradingEaContract.test.ts.
const CURRENT_VERSION = (
  JSON.parse(readFileSync(resolve(process.cwd(), "../backend/ea_releases/manifest.json"), "utf8")) as {
    current_version: string;
  }
).current_version;

vi.hoisted(() => { process.env["ENVIRONMENT"] = "test"; });

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("./gptEmailActions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gptEmailActions.js")>();
  return { ...actual, requireGptAction: async () => {} };
});

const { registerAdminOpsActionRoutes } = await import("./adminOpsActions.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerAdminOpsActionRoutes(app);
  return app;
}

// The "automatic bot-version email" system (2026-08-25): promoting a release
// through ea_releases/manifest.json should let an admin get a ready-to-review
// email draft in one call, instead of hand-writing the announcement -- but it
// must never send anything itself. This exercises the real current manifest
// on disk (same convention as releaseManifest.production.test.ts).
describe("POST /admin/actions/ops/releases/version-email-draft", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    state.db = new FakeDb();
    app = await createApp();
  });

  it("drafts a real email from the current production release, targeting licensed users only, without sending anything", async () => {
    const res = await app.inject({ method: "POST", url: "/admin/actions/ops/releases/version-email-draft" });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.duplicate).toBe(false);
    expect(body.audience).toBe("active_license");
    expect(body.subject).toBe("A new XauCloud Bot update is available");
    expect(body.title).toContain(CURRENT_VERSION);

    const stored = await state.db.collection("admin_email_drafts").findOne({ source: "bot_version_release" });
    expect(stored).toBeTruthy();
    expect(stored?.["source_version"]).toBe(CURRENT_VERSION);
    // Never actually sent -- only ever a draft record, exactly like a
    // human-composed draft would be, so it goes through the same existing
    // preview -> prepare-send -> confirm flow.
    expect((await state.db.collection("admin_email_delivery_log").find({}).toArray()).length).toBe(0);
  });

  it("is idempotent per version -- calling it again returns the existing draft instead of duplicating", async () => {
    const first = await app.inject({ method: "POST", url: "/admin/actions/ops/releases/version-email-draft" });
    const second = await app.inject({ method: "POST", url: "/admin/actions/ops/releases/version-email-draft" });
    expect(second.json().duplicate).toBe(true);
    expect(second.json().id).toBe(first.json().id);
    expect(await state.db.collection("admin_email_drafts").find({ source: "bot_version_release" }).toArray()).toHaveLength(1);
  });
});
