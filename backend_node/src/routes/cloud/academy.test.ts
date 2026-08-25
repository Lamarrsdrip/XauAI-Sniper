import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => { process.env["ENVIRONMENT"] = "test"; });

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, user: null as Record<string, unknown> | null }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", () => ({
  requireCloudUser: async (request: unknown) => { (request as { cloudUser?: unknown }).cloudUser = state.user; },
}));
vi.mock("../../services/adminOpsControl.js", () => ({ publishedTransactionalRender: vi.fn(async () => null) }));
vi.mock("../../services/emailBranding.js", () => ({
  emailBranding: vi.fn(async () => ({ sender_name: "XauCloud", command_center_url: "https://xaucloud.io/command" })),
  emailLinkButton: () => "",
}));
vi.mock("../../services/email.js", () => ({ sendEmail: vi.fn(async () => true) }));
vi.mock("../../env.js", () => ({ env: { PUBLIC_SITE_URL: "https://xaucloud.io" } }));

const { registerAcademyRoutes } = await import("./academy.js");
const { REQUIRED_LESSON_IDS, CURRICULUM_VERSION } = await import("../../services/academyCurriculum.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerAcademyRoutes(app);
  return app;
}

function seedUser(id: string, fullName: string, email = `${id}@example.com`) {
  state.db.collection("cloud_users").docs.push({ id, full_name: fullName, email });
}
function seedCompleteProgress(userId: string) {
  state.db.collection("academy_progress").docs.push({ user_id: userId, curriculum_version: CURRICULUM_VERSION, completed_lesson_ids: [...REQUIRED_LESSON_IDS], updated_at: new Date().toISOString() });
}

describe("Academy routes -- server-authoritative eligibility and per-user isolation", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    state.db = new FakeDb();
    state.db.uniqueIndexes["academy_certificates"] = ["certificate_id"];
    app = await createApp();
  });

  it("reports not-eligible progress accurately for a partially-complete user", async () => {
    state.user = { id: "u1" };
    seedUser("u1", "Ada Lovelace");
    state.db.collection("academy_progress").docs.push({ user_id: "u1", curriculum_version: CURRICULUM_VERSION, completed_lesson_ids: REQUIRED_LESSON_IDS.slice(0, 10), updated_at: new Date().toISOString() });
    const res = await app.inject({ method: "GET", url: "/cloud/academy/progress" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ completed_count: 10, required_count: 21, is_complete: false });
  });

  it("rejects an unknown lesson id rather than silently accepting frontend drift", async () => {
    state.user = { id: "u1" };
    seedUser("u1", "Ada Lovelace");
    const res = await app.inject({ method: "POST", url: "/cloud/academy/lessons/not-a-real-lesson/complete" });
    expect(res.statusCode).toBe(400);
  });

  it("downloading a certificate you never earned returns 404, not another user's PDF", async () => {
    state.user = { id: "u2" };
    seedUser("u1", "Ada Lovelace");
    seedUser("u2", "Someone Else");
    seedCompleteProgress("u1");
    state.db.collection("academy_certificates").docs.push({
      certificate_id: "XC-ACADEMY-OWNEDBYU1", user_id: "u1", program: "forex_academy", curriculum_version: CURRICULUM_VERSION,
      recipient_name: "Ada Lovelace", completed_at: new Date().toISOString(), issued_at: new Date().toISOString(), status: "valid",
    });
    // u2 has never completed the curriculum and owns no certificate.
    const res = await app.inject({ method: "GET", url: "/cloud/academy/certificate/download" });
    expect(res.statusCode).toBe(404);
  });

  it("the owning user can download their own certificate as a real PDF", async () => {
    state.user = { id: "u1" };
    seedUser("u1", "Ada Lovelace");
    state.db.collection("academy_certificates").docs.push({
      certificate_id: "XC-ACADEMY-OWNEDBYU1", user_id: "u1", program: "forex_academy", curriculum_version: CURRICULUM_VERSION,
      recipient_name: "Ada Lovelace", completed_at: new Date().toISOString(), issued_at: new Date().toISOString(), status: "valid",
    });
    const res = await app.inject({ method: "GET", url: "/cloud/academy/certificate/download" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.from(res.rawPayload).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("view renders inline while download forces attachment -- same PDF, different disposition", async () => {
    state.user = { id: "u1" };
    seedUser("u1", "Ada Lovelace");
    state.db.collection("academy_certificates").docs.push({
      certificate_id: "XC-ACADEMY-OWNEDBYU1", user_id: "u1", program: "forex_academy", curriculum_version: CURRICULUM_VERSION,
      recipient_name: "Ada Lovelace", completed_at: new Date().toISOString(), issued_at: new Date().toISOString(), status: "valid",
    });
    const view = await app.inject({ method: "GET", url: "/cloud/academy/certificate/view" });
    expect(view.headers["content-disposition"]).toContain("inline");
    const download = await app.inject({ method: "GET", url: "/cloud/academy/certificate/download" });
    expect(download.headers["content-disposition"]).toContain("attachment");
  });

  it("confirming a certificate name issues the certificate exactly once, even if called twice", async () => {
    state.user = { id: "u1" };
    seedUser("u1", ""); // no name on file yet
    seedCompleteProgress("u1");
    const first = await app.inject({ method: "POST", url: "/cloud/academy/certificate/confirm-name", payload: { name: "Grace Hopper" } });
    expect(first.statusCode).toBe(200);
    expect(first.json().issued).toBe(true);
    const second = await app.inject({ method: "POST", url: "/cloud/academy/certificate/confirm-name", payload: { name: "Grace Hopper" } });
    expect(second.statusCode).toBe(200);
    expect(second.json().issued).toBe(false);
    expect(second.json().certificate.certificate_id).toBe(first.json().certificate.certificate_id);
  });

  it("refuses to confirm-name/issue when the curriculum genuinely isn't complete yet", async () => {
    state.user = { id: "u1" };
    seedUser("u1", "");
    state.db.collection("academy_progress").docs.push({ user_id: "u1", curriculum_version: CURRICULUM_VERSION, completed_lesson_ids: REQUIRED_LESSON_IDS.slice(0, 5), updated_at: new Date().toISOString() });
    const res = await app.inject({ method: "POST", url: "/cloud/academy/certificate/confirm-name", payload: { name: "Grace Hopper" } });
    expect(res.statusCode).toBe(409);
  });
});
