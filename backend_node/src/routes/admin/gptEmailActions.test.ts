import { vi } from "vitest";

const state = vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "test-jwt-secret";
  process.env["XAUCLOUD_GPT_ACTION_SECRET"] = "test-action-secret-that-is-at-least-thirty-two-characters-long";
  return {
    db: null as unknown as FakeDb,
    sendResult: { ok: true } as { ok: boolean; error?: string },
    sendCalls: [] as Array<{ to: string; subject: string; html: string }>,
    pushCalls: [] as Array<{ userId: string; payload: Record<string, unknown> }>,
  };
});

vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../services/email.js", () => ({
  resolveEmailSender: vi.fn(async (name?: string) => ({
    name: name || "XauCloud",
    address: "support@xaucloud.io",
    formatted: `${name || "XauCloud"} <support@xaucloud.io>`,
  })),
  sendEmailDetailed: vi.fn(async (to: string, subject: string, html: string) => {
    state.sendCalls.push({ to, subject, html });
    return { ...state.sendResult };
  }),
}));
vi.mock("../../services/webPush.js", () => ({
  sendWebPushToUser: vi.fn(async (userId: string, payload: Record<string, unknown>) => {
    state.pushCalls.push({ userId, payload });
    return 1;
  }),
}));

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { registerGptEmailActionRoutes, verifyGptActionSecret } from "./gptEmailActions.js";
import { registerMarketingActionRoutes } from "./marketingActions.js";

type Doc = Record<string, unknown>;

function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = doc[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      const operators = expected as Doc;
      if ("$gt" in operators) return new Date(String(actual)).getTime() > new Date(String(operators["$gt"])).getTime();
    }
    return actual === expected;
  });
}

class FakeCursor {
  constructor(private rows: Doc[]) {}
  sort(): this { return this; }
  limit(count: number): this { this.rows = this.rows.slice(0, count); return this; }
  async toArray(): Promise<Doc[]> { return structuredClone(this.rows); }
}

class FakeCollection {
  constructor(public readonly docs: Doc[]) {}
  find(query: Doc = {}): FakeCursor { return new FakeCursor(this.docs.filter((doc) => matches(doc, query))); }
  async findOne(query: Doc): Promise<Doc | null> {
    const found = this.docs.find((doc) => matches(doc, query));
    return found ? structuredClone(found) : null;
  }
  async insertOne(input: Doc): Promise<{ insertedId: string }> {
    if (this.docs.some((doc) => input["token_hash"] && doc["token_hash"] === input["token_hash"])) throw Object.assign(new Error("duplicate"), { code: 11000 });
    if (this.docs.some((doc) => input["source"] === "chatgpt_action" && input["idempotency_key"] && doc["source"] === input["source"] && doc["idempotency_key"] === input["idempotency_key"])) throw Object.assign(new Error("duplicate"), { code: 11000 });
    this.docs.push(structuredClone(input));
    return { insertedId: String(input["id"] ?? this.docs.length) };
  }
  async updateOne(query: Doc, update: { $set?: Doc; $setOnInsert?: Doc }, options: { upsert?: boolean } = {}): Promise<{ matchedCount: number; upsertedCount: number }> {
    let found = this.docs.find((doc) => matches(doc, query));
    if (!found && options.upsert) {
      found = { ...structuredClone(query), ...structuredClone(update.$setOnInsert ?? {}) };
      this.docs.push(found);
    }
    if (!found) return { matchedCount: 0, upsertedCount: 0 };
    Object.assign(found, structuredClone(update.$set ?? {}));
    return { matchedCount: 1, upsertedCount: 0 };
  }
  async countDocuments(query: Doc = {}): Promise<number> { return this.docs.filter((doc) => matches(doc, query)).length; }
  async findOneAndUpdate(query: Doc, update: { $set?: Doc }): Promise<Doc | null> {
    const found = this.docs.find((doc) => matches(doc, query));
    if (!found) return null;
    Object.assign(found, structuredClone(update.$set ?? {}));
    return structuredClone(found);
  }
  async createIndex(): Promise<string> { return "fake_index"; }
}

class FakeDb {
  private readonly data = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    if (!this.data.has(name)) this.data.set(name, new FakeCollection([]));
    return this.data.get(name)!;
  }
}

const secret = "test-action-secret-that-is-at-least-thirty-two-characters-long";
const auth = { authorization: `Bearer ${secret}` };
const theme = { width: 640, background: "#08080A", contentBackground: "#FFFFFF", accent: "#D6B35A", radius: 10, spacing: "normal" };

function draftBody(audience = "all_users") {
  return {
    title: "Release update",
    subject: "A new XauCloud update is live",
    preheader: "Open Command Center for the details.",
    audience,
    document: {
      version: 1,
      theme,
      blocks: [
        { id: "hero-1", type: "hero", badge: "Product update", title: "The new update is live", subtitle: "A clearer XauCloud workflow." },
        { id: "text-1", type: "text", html: "<p>Hi {{first_name}},</p><p>Open your Command Center for details.</p><script>bad()</script>" },
        { id: "risk-1", type: "risk" },
      ],
    },
  };
}

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(422).send({ detail: error.issues });
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? Number((error as { statusCode: number }).statusCode) : 500;
    return reply.code(statusCode).send({ detail: error instanceof Error ? error.message : "Internal server error" });
  });
  await app.register(registerGptEmailActionRoutes);
  await registerMarketingActionRoutes(app);
  return app;
}

async function createDraft(app: FastifyInstance): Promise<Doc> {
  const response = await app.inject({ method: "POST", url: "/admin/actions/email/drafts", headers: { ...auth, "x-forwarded-for": `draft-${Math.random()}` }, payload: draftBody() });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

async function prepare(app: FastifyInstance, id: string): Promise<Doc> {
  const response = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${id}/prepare-send`, headers: { ...auth, "x-forwarded-for": `prepare-${Math.random()}` } });
  expect(response.statusCode).toBe(200);
  return response.json();
}

describe("private GPT email actions", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.db = new FakeDb();
    state.sendCalls.length = 0;
    state.pushCalls.length = 0;
    state.sendResult = { ok: true };
    state.db.collection("admin_settings").docs.push({
      key: "main",
      smtp_email: "support@xaucloud.io",
      smtp_password: "never-returned",
      smtp_host: "smtp.hostinger.com",
      smtp_port: 465,
      mail_from: "support@xaucloud.io",
      support_email: "support@xaucloud.io",
      email_sender_name: "XauCloud",
      command_center_url: "https://xaucloud.io/command",
    });
    state.db.collection("cloud_users").docs.push(
      { id: "u1", email: "one@example.test", full_name: "One User" },
      { id: "u2", email: "two@example.test", full_name: "Two User" },
    );
    state.db.collection("pin_licenses").docs.push(
      { buyer_email: "one@example.test", buyer_name: "One User", is_active: true },
      { buyer_email: "buyer@example.test", buyer_name: "Buyer", is_active: false },
    );
    app = await createApp();
  });

  afterEach(async () => { await app.close(); });

  it("rejects missing/invalid authentication and accepts the dedicated bearer secret", async () => {
    expect(verifyGptActionSecret("wrong", secret)).toBe(false);
    const rejected = await app.inject({ method: "GET", url: "/admin/actions/email/audiences", headers: { "x-forwarded-for": "auth-rejected" } });
    expect(rejected.statusCode).toBe(401);
    const accepted = await app.inject({ method: "GET", url: "/admin/actions/email/audiences", headers: { ...auth, "x-forwarded-for": "auth-accepted" } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().sender).toBe("XauCloud <support@xaucloud.io>");
    expect(JSON.stringify(accepted.json())).not.toContain("never-returned");
  });

  it("lists only supported audience counts", async () => {
    const response = await app.inject({ method: "GET", url: "/admin/actions/email/audiences", headers: { ...auth, "x-forwarded-for": "audiences" } });
    const body = response.json();
    expect(body.segments.find((item: Doc) => item["id"] === "all_users")["count"]).toBe(2);
    expect(body.segments.find((item: Doc) => item["id"] === "active_license")["count"]).toBe(1);
    expect(body.segments.map((item: Doc) => item["id"])).toEqual(["single", "all_users", "customers", "active_license", "inactive_license", "selected"]);
  });

  it("creates and retrieves the normal structured draft, then previews with the shared renderer", async () => {
    const draft = await createDraft(app);
    expect(draft["source"]).toBe("chatgpt_action");
    expect(state.db.collection("admin_email_drafts").docs).toHaveLength(1);
    const get = await app.inject({ method: "GET", url: `/admin/actions/email/drafts/${draft["id"]}`, headers: { ...auth, "x-forwarded-for": "get-draft" } });
    expect(get.statusCode).toBe(200);
    expect(get.json().subject).toBe(draftBody().subject);
    const preview = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${draft["id"]}/preview`, headers: { ...auth, "x-forwarded-for": "preview" } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().text).toContain("Questions? support@xaucloud.io");
    expect(preview.json().text).not.toContain("bad()");
  });

  it("sends a test only to the explicit validated address", async () => {
    const draft = await createDraft(app);
    const response = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${draft["id"]}/test`, headers: { ...auth, "x-forwarded-for": "test-email" }, payload: { to: "owner@example.test" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sent: true, test_only: true, to: "owner@example.test" });
    expect(state.sendCalls).toHaveLength(1);
    expect(state.sendCalls[0]?.subject).toMatch(/^\[TEST\]/);
  });

  it("rejects unsupported audiences", async () => {
    const response = await app.inject({ method: "POST", url: "/admin/actions/email/drafts", headers: { ...auth, "x-forwarded-for": "unsupported" }, payload: draftBody("arbitrary_sql_segment") });
    expect(response.statusCode).toBe(422);
  });

  it("rejects invalid, expired, changed-draft, changed-audience, and changed-recipient confirmations", async () => {
    const invalidDraft = await createDraft(app);
    const invalid = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${invalidDraft["id"]}/send`, headers: { ...auth, "x-forwarded-for": "invalid-token" }, payload: { confirmation_token: "xc_confirm_invalid-but-long-enough", idempotency_key: "invalid-token-1" } });
    expect(invalid.statusCode).toBe(400);

    const expiredDraft = await createDraft(app);
    const expiredPrepared = await prepare(app, String(expiredDraft["id"]));
    state.db.collection("admin_email_action_confirmations").docs.at(-1)!["expires_at"] = new Date(Date.now() - 1000);
    const expired = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${expiredDraft["id"]}/send`, headers: { ...auth, "x-forwarded-for": "expired-token" }, payload: { confirmation_token: expiredPrepared["confirmation_token"], idempotency_key: "expired-token-1" } });
    expect(expired.statusCode).toBe(410);

    const changedDraft = await createDraft(app);
    const changedPrepared = await prepare(app, String(changedDraft["id"]));
    state.db.collection("admin_email_drafts").docs.find((doc) => doc["id"] === changedDraft["id"])!["subject"] = "Changed after prepare";
    const changed = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${changedDraft["id"]}/send`, headers: { ...auth, "x-forwarded-for": "changed-draft" }, payload: { confirmation_token: changedPrepared["confirmation_token"], idempotency_key: "changed-draft-1" } });
    expect(changed.statusCode).toBe(409);

    const audienceDraft = await createDraft(app);
    const audiencePrepared = await prepare(app, String(audienceDraft["id"]));
    state.db.collection("admin_email_drafts").docs.find((doc) => doc["id"] === audienceDraft["id"])!["audience"] = "customers";
    const audienceChanged = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${audienceDraft["id"]}/send`, headers: { ...auth, "x-forwarded-for": "changed-audience" }, payload: { confirmation_token: audiencePrepared["confirmation_token"], idempotency_key: "changed-audience-1" } });
    expect(audienceChanged.statusCode).toBe(409);

    const recipientsDraft = await createDraft(app);
    const recipientsPrepared = await prepare(app, String(recipientsDraft["id"]));
    state.db.collection("cloud_users").docs.push({ id: "u3", email: "three@example.test", full_name: "Three User" });
    const recipientsChanged = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${recipientsDraft["id"]}/send`, headers: { ...auth, "x-forwarded-for": "changed-recipients" }, payload: { confirmation_token: recipientsPrepared["confirmation_token"], idempotency_key: "changed-recipients-1" } });
    expect(recipientsChanged.statusCode).toBe(409);
  });

  it("sends once, writes normal history with source, and returns the original result on retry", async () => {
    const draft = await createDraft(app);
    const prepared = await prepare(app, String(draft["id"]));
    const payload = { confirmation_token: prepared["confirmation_token"], idempotency_key: "broadcast-stable-key-1" };
    const first = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${draft["id"]}/send`, headers: { ...auth, "x-forwarded-for": "send-once" }, payload });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: "sent", sent: 2, failed: 0, source: "chatgpt_action", duplicate: false });
    expect(state.sendCalls).toHaveLength(2);
    const history = state.db.collection("admin_email_log").docs;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ draft_id: draft["id"], source: "chatgpt_action", idempotency_key: "broadcast-stable-key-1" });

    const retry = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${draft["id"]}/send`, headers: { ...auth, "x-forwarded-for": "send-retry" }, payload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ duplicate: true, broadcast_id: first.json().broadcast_id });
    expect(state.sendCalls).toHaveLength(2);

    const replayWithNewKey = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${draft["id"]}/send`, headers: { ...auth, "x-forwarded-for": "send-replay" }, payload: { ...payload, idempotency_key: "broadcast-different-key" } });
    expect(replayWithNewKey.statusCode).toBe(409);
  });

  it("persists and reports provider failure without retrying recipients", async () => {
    state.sendResult = { ok: false, error: "Delivery provider rejected the message (TEST)." };
    const draft = await createDraft(app);
    const prepared = await prepare(app, String(draft["id"]));
    const response = await app.inject({ method: "POST", url: `/admin/actions/email/drafts/${draft["id"]}/send`, headers: { ...auth, "x-forwarded-for": "provider-failure" }, payload: { confirmation_token: prepared["confirmation_token"], idempotency_key: "provider-failure-1" } });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ status: "failed", sent: 0, failed: 2 });
    expect(state.db.collection("admin_email_log").docs[0]).toMatchObject({ status: "failed", source: "chatgpt_action" });
  });

  it("retrieves only approved marketing facts and creates/updates one campaign", async () => {
    state.db.collection("approved_marketing_performance").docs.push({ id: "not-approved", approved_for_marketing: false, net_profit_usd: 999999 });
    const performance = await app.inject({ method: "GET", url: "/admin/actions/marketing/performance", headers: { ...auth, "x-forwarded-for": "marketing-facts" } });
    expect(performance.statusCode).toBe(200);
    expect(performance.json().results.some((row: Doc) => row["id"] === "current-30-day-gold-replay")).toBe(true);
    expect(performance.json().results.some((row: Doc) => row["id"] === "not-approved")).toBe(false);
    const create = await app.inject({ method: "POST", url: "/admin/actions/marketing/campaigns", headers: { ...auth, "x-forwarded-for": "campaign-create" }, payload: { name: "Pattern Intelligence launch", objective: "Coordinate this week's launch", core_message: "Pattern Intelligence and the approved replay", approved_fact_ids: ["feature-pattern-intelligence", "current-30-day-gold-replay"], target_audiences: ["existing_customers", "prospects"], cta: { label: "View replay", destination: "replay" } } });
    expect(create.statusCode, create.body).toBe(200);
    const id = create.json().id;
    const update = await app.inject({ method: "PATCH", url: `/admin/actions/marketing/campaigns/${id}`, headers: { ...auth, "x-forwarded-for": "campaign-update" }, payload: { objective: "Updated coordinated launch" } });
    expect(update.statusCode).toBe(200);
    expect(update.json().objective).toBe("Updated coordinated launch");
    expect(state.db.collection("marketing_action_audit").docs.some((row) => row["action"] === "MARKETING_CAMPAIGN_CREATED")).toBe(true);
  });

  it("previews, confirms, idempotently publishes, replaces, and rolls back a controlled website slot", async () => {
    const campaign = await app.inject({ method: "POST", url: "/admin/actions/marketing/campaigns", headers: { ...auth, "x-forwarded-for": "web-campaign" }, payload: { name: "Website campaign", objective: "Promote release", core_message: "Pattern Intelligence", approved_fact_ids: ["feature-pattern-intelligence"], target_audiences: ["prospects"] } });
    const campaignId = campaign.json().id;
    const makeAsset = async (headline: string) => (await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/website-drafts`, headers: { ...auth, "x-forwarded-for": `web-${headline}` }, payload: { slot: "homepage_hero_campaign", headline, body: "Approved campaign body", eyebrow: "XauCloud", cta_label: "View replay", destination: "replay", audience: "prospects", approved_fact_ids: ["feature-pattern-intelligence"] } })).json();
    const publish = async (asset: Doc, operation: string, key: string) => {
      const prepared = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/website-drafts/${asset["id"]}/prepare`, headers: { ...auth, "x-forwarded-for": `prepare-${key}` }, payload: { operation } });
      expect(prepared.statusCode, prepared.body).toBe(200);
      return app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/website-drafts/${asset["id"]}/publish`, headers: { ...auth, "x-forwarded-for": `publish-${key}` }, payload: { operation, confirmation_token: prepared.json().confirmation_token, idempotency_key: key } });
    };
    const first = await makeAsset("First headline");
    const preview = await app.inject({ method: "GET", url: `/admin/actions/marketing/campaigns/${campaignId}/website-drafts/${first["id"]}/preview`, headers: { ...auth, "x-forwarded-for": "web-preview" } });
    expect(preview.json().cta_url).toContain("utm_campaign=");
    expect((await publish(first, "publish", "website-publish-first")).statusCode).toBe(200);
    const second = await makeAsset("Second headline");
    const secondPublished = await publish(second, "publish", "website-publish-second");
    expect(secondPublished.statusCode).toBe(200);
    const duplicate = await publish(second, "publish", "website-publish-second");
    expect(duplicate.json().duplicate).toBe(true);
    const rolledBack = await publish(second, "rollback", "website-rollback-second");
    expect(rolledBack.statusCode).toBe(200);
    expect(state.db.collection("marketing_website_assets").docs.find((row) => row["id"] === first["id"])?.["status"]).toBe("published");
  });

  it("requires confirmation for announcements, push, and landing pages; push retries do not duplicate", async () => {
    const campaignResponse = await app.inject({ method: "POST", url: "/admin/actions/marketing/campaigns", headers: { ...auth, "x-forwarded-for": "multi-campaign" }, payload: { name: "Multi-channel", objective: "Reach customers", core_message: "A release is live", approved_fact_ids: [], target_audiences: ["active_customers"] } });
    const campaignId = campaignResponse.json().id;

    const announcement = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/announcements`, headers: { ...auth, "x-forwarded-for": "announcement-draft" }, payload: { title: "Update live", short_message: "Open Command Center", cta_label: "Open", destination: "command_center", audience: "active_customers", priority: "high", dismissible: true } });
    const announcementId = announcement.json().id;
    const announcementPrepare = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/announcements/${announcementId}/prepare`, headers: { ...auth, "x-forwarded-for": "announcement-prepare" } });
    const badAnnouncement = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/announcements/${announcementId}/publish`, headers: { ...auth, "x-forwarded-for": "announcement-bad" }, payload: { confirmation_token: "bad-confirmation-token-long-enough", idempotency_key: "announcement-bad" } });
    expect(badAnnouncement.statusCode).toBe(400);
    const announcementPublish = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/announcements/${announcementId}/publish`, headers: { ...auth, "x-forwarded-for": "announcement-publish" }, payload: { confirmation_token: announcementPrepare.json().confirmation_token, idempotency_key: "announcement-publish" } });
    expect(announcementPublish.statusCode).toBe(200);

    state.db.collection("web_push_subscriptions").docs.push({ user_id: "u1", endpoint: "safe-test" });
    state.db.collection("cloud_notification_prefs").docs.push({ user_id: "u1", tier: "ALL_UPDATES", muted_categories: [] });
    const push = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/push-drafts`, headers: { ...auth, "x-forwarded-for": "push-draft" }, payload: { title: "Update live", body: "Open Command Center", destination: "command_center", audience: "active_customers" } });
    const pushId = push.json().id;
    const count = await app.inject({ method: "GET", url: "/admin/actions/marketing/push/audience-count?audience=active_customers", headers: { ...auth, "x-forwarded-for": "push-count" } });
    expect(count.json().recipient_count).toBe(1);
    const pushPrepare = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/push-drafts/${pushId}/prepare`, headers: { ...auth, "x-forwarded-for": "push-prepare" } });
    const pushPayload = { confirmation_token: pushPrepare.json().confirmation_token, idempotency_key: "push-send-stable" };
    const pushSend = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/push-drafts/${pushId}/send`, headers: { ...auth, "x-forwarded-for": "push-send" }, payload: pushPayload });
    expect(pushSend.statusCode, pushSend.body).toBe(200);
    expect(state.pushCalls).toHaveLength(1);
    const pushRetry = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/push-drafts/${pushId}/send`, headers: { ...auth, "x-forwarded-for": "push-retry" }, payload: pushPayload });
    expect(pushRetry.json().duplicate).toBe(true);
    expect(state.pushCalls).toHaveLength(1);

    const landing = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/landing-pages`, headers: { ...auth, "x-forwarded-for": "landing-draft" }, payload: { slug: "pattern-intelligence-test", title: "Pattern Intelligence", audience: "prospects", approved_fact_ids: ["feature-pattern-intelligence"], blocks: [{ id: "hero", type: "hero", headline: "Pattern Intelligence", body: "Approved story", destination: "purchase", cta_label: "Get XauCloud" }, { id: "risk", type: "risk", body: "Trading involves risk." }] } });
    const landingId = landing.json().id;
    const landingPrepare = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/landing-pages/${landingId}/prepare`, headers: { ...auth, "x-forwarded-for": "landing-prepare" } });
    const landingPublish = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/landing-pages/${landingId}/publish`, headers: { ...auth, "x-forwarded-for": "landing-publish" }, payload: { confirmation_token: landingPrepare.json().confirmation_token, idempotency_key: "landing-publish-stable" } });
    expect(landingPublish.statusCode).toBe(200);
  });

  it("invalidates a marketing approval when controlled content changes", async () => {
    const campaign = await app.inject({ method: "POST", url: "/admin/actions/marketing/campaigns", headers: { ...auth, "x-forwarded-for": "changed-content-campaign" }, payload: { name: "Changed content", objective: "Test", core_message: "Test", approved_fact_ids: [], target_audiences: ["prospects"] } });
    const campaignId = campaign.json().id;
    const draft = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/website-drafts`, headers: { ...auth, "x-forwarded-for": "changed-content-draft" }, payload: { slot: "homepage_promo_banner", headline: "Original", body: "Body", cta_label: "Open", destination: "homepage", audience: "prospects", approved_fact_ids: [] } });
    const assetId = draft.json().id;
    const prepared = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/website-drafts/${assetId}/prepare`, headers: { ...auth, "x-forwarded-for": "changed-content-prepare" }, payload: { operation: "publish" } });
    state.db.collection("marketing_website_assets").docs.find((row) => row["id"] === assetId)!["headline"] = "Changed";
    const result = await app.inject({ method: "POST", url: `/admin/actions/marketing/campaigns/${campaignId}/website-drafts/${assetId}/publish`, headers: { ...auth, "x-forwarded-for": "changed-content-publish" }, payload: { operation: "publish", confirmation_token: prepared.json().confirmation_token, idempotency_key: "changed-content-key" } });
    expect(result.statusCode).toBe(409);
  });

  it("rate limits repeated action requests", async () => {
    let status = 200;
    for (let index = 0; index < 140 && status !== 429; index += 1) {
      const response = await app.inject({ method: "GET", url: "/admin/actions/email/audiences", headers: { ...auth, "x-forwarded-for": "rate-limit-test" } });
      status = response.statusCode;
    }
    expect(status).toBe(429);
  });
});
