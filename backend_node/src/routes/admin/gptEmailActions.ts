import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { clientIp, rateLimit } from "../../auth.js";
import { getDb } from "../../db.js";
import { env } from "../../env.js";
import {
  AudienceSchema,
  BROADCAST_CAP,
  EMAIL_RE,
  EmailCampaignError,
  audienceSummary,
  campaignFromDraft,
  campaignParts,
  contact,
  contactsForAudience,
  deliverAdminCampaign,
  publicDraft,
} from "../../services/adminEmailCampaign.js";
import { resolveEmailSender, sendEmailDetailed } from "../../services/email.js";
import { emailBranding } from "../../services/emailBranding.js";
import { EmailBlockSchema, EmailDocumentSchema, personalize } from "../../services/emailCampaign.js";

const ACTION_ACTOR_EMAIL = "chatgpt-action@xaucloud.internal";
const ACTION_ACTOR_NAME = "XauCloud Admin (ChatGPT Action)";
const TOKEN_PREFIX = "xc_confirm_";

// GPT Actions send content across an external request boundary. Keep raw HTML
// out of that request entirely: the trusted XauCloud renderer turns these
// structured fields into the same premium, responsive email HTML used by the
// Admin composer. The normal Admin composer remains backward-compatible with
// its sanitized rich-text `html` fields through EmailDocumentSchema.
const ActionEmailColumnSchema = z.object({
  title: z.string().max(300).optional(),
  text: z.string().max(5_000).optional(),
}).strict();

const ActionEmailBlockSchema = EmailBlockSchema
  .omit({ html: true, columns: true })
  .extend({ columns: z.array(ActionEmailColumnSchema).length(2).optional() })
  .strict();

const ActionEmailDocumentSchema = EmailDocumentSchema
  .extend({ blocks: z.array(ActionEmailBlockSchema).min(1).max(100) })
  .strict();

const DraftCreateSchema = z.object({
  campaign_id: z.string().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  subject: z.string().trim().min(1).max(300).refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks."),
  preheader: z.string().max(300).optional().default(""),
  audience: AudienceSchema,
  to: z.union([z.string().email().max(320), z.literal("")]).optional().default(""),
  selected_recipients: z.array(z.string().email().max(320)).max(250).optional().default([]),
  document: ActionEmailDocumentSchema,
}).superRefine((value, ctx) => {
  if (value.audience === "single" && !value.to) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "A single-recipient draft requires to." });
  if (value.audience === "selected" && value.selected_recipients.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["selected_recipients"], message: "A selected audience requires at least one recipient." });
});

const TestSendSchema = z.object({ to: z.string().email().max(320) });
const SendActionSchema = z.object({
  confirmation_token: z.string().min(20).max(200),
  idempotency_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/, "Use letters, numbers, dot, underscore, colon, or hyphen."),
});
const IdSchema = z.object({ id: z.string().min(1).max(100) });

interface ActionAuditMeta {
  campaignId?: string;
  audience?: string;
  recipientCount?: number;
}

type ActionRequest = FastifyRequest & { actionAuditMeta?: ActionAuditMeta };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyGptActionSecret(candidate: string, configured = env.XAUCLOUD_GPT_ACTION_SECRET): boolean {
  if (!configured || configured.length < 32 || !candidate) return false;
  const expected = createHash("sha256").update(configured).digest();
  const received = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expected, received);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function draftFingerprint(row: Record<string, unknown>): string {
  return sha256(JSON.stringify(canonical({
    id: row["id"],
    subject: row["subject"],
    preview_text: row["preview_text"] ?? "",
    sender_name: row["sender_name"] ?? "",
    reply_to: row["reply_to"] ?? "",
    audience: row["audience"],
    to: row["to"] ?? "",
    selected_recipients: [...((row["selected_recipients"] as string[] | undefined) ?? [])].map((email) => email.toLowerCase()).sort(),
    document: row["document"],
    updated_at: row["updated_at"],
  })));
}

function recipientFingerprint(emails: string[]): string {
  return sha256(JSON.stringify([...emails].map((email) => email.toLowerCase()).sort()));
}

function confirmationTtlSeconds(): number {
  const configured = env.XAUCLOUD_GPT_ACTION_CONFIRMATION_TTL_SECONDS;
  return Number.isFinite(configured) ? Math.min(1800, Math.max(60, Math.trunc(configured))) : 600;
}

export async function requireGptAction(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  rateLimit(`gpt-action-auth:${clientIp(request)}`, 30, 60);
  const configured = env.XAUCLOUD_GPT_ACTION_SECRET;
  if (!configured || configured.length < 32) {
    return void reply.code(503).send({ detail: "XauCloud GPT Actions are not configured." });
  }
  const header = request.headers.authorization;
  const match = typeof header === "string" ? /^Bearer\s+(.+)$/.exec(header) : null;
  if (!match || !verifyGptActionSecret(match[1] ?? "", configured)) {
    return void reply.code(401).send({ detail: "Invalid action credential." });
  }
  rateLimit(`gpt-action:${sha256(configured).slice(0, 16)}`, 120, 60);
}

function setAuditMeta(request: FastifyRequest, meta: ActionAuditMeta): void {
  (request as ActionRequest).actionAuditMeta = meta;
}

function routeConfig(action: string) {
  return { config: { gptActionName: action } };
}

function errorReply(reply: FastifyReply, error: unknown) {
  if (error instanceof EmailCampaignError) return reply.code(error.statusCode).send({ detail: error.detail });
  throw error;
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && Number((error as { code?: unknown }).code) === 11000);
}

function actionStatus(row: Record<string, unknown>, duplicate = false) {
  return {
    broadcast_id: row["id"],
    draft_id: row["draft_id"],
    subject: row["subject"],
    audience: row["audience"],
    recipient_count: row["recipients"],
    sender: `${String(row["sender_name"] ?? "XauCloud")} <${String(row["sender_address"] ?? row["reply_to"] ?? "")}>`,
    status: row["status"],
    sent: row["sent"],
    failed: row["failed"],
    accepted_at: row["at"],
    updated_at: row["updated_at"],
    source: row["source"],
    duplicate,
    ...(row["last_error"] ? { error: row["last_error"] } : {}),
  };
}

export async function ensureGptEmailActionIndexes(): Promise<void> {
  const db = getDb();
  await Promise.all([
    db.collection("admin_email_action_confirmations").createIndex({ token_hash: 1 }, { unique: true }),
    db.collection("admin_email_action_confirmations").createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    db.collection("admin_email_log").createIndex(
      { source: 1, idempotency_key: 1 },
      { unique: true, partialFilterExpression: { source: "chatgpt_action", idempotency_key: { $type: "string" } } },
    ),
  ]);
}

export async function registerGptEmailActionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireGptAction);
  app.addHook("onResponse", async (request, reply) => {
    const config = request.routeOptions.config as unknown as Record<string, unknown>;
    const action = String(config["gptActionName"] ?? request.routeOptions.url);
    const meta = (request as ActionRequest).actionAuditMeta ?? {};
    try {
      await getDb().collection("admin_email_action_audit").insertOne({
        at: new Date().toISOString(),
        action,
        campaign_id: meta.campaignId ?? null,
        audience: meta.audience ?? null,
        recipient_count: meta.recipientCount ?? null,
        result: reply.statusCode < 400 ? "success" : "error",
        status_code: reply.statusCode,
        request_id: request.id,
      });
    } catch (error) {
      request.log.warn({ error }, "Could not persist GPT Action audit metadata");
    }
  });

  app.get("/admin/actions/email/audiences", routeConfig("list_email_audiences"), async () => {
    const [summary, sender] = await Promise.all([audienceSummary(), resolveEmailSender()]);
    return { ...summary, sender: sender.formatted };
  });

  app.post("/admin/actions/email/drafts", routeConfig("create_email_draft"), async (request) => {
    const req = DraftCreateSchema.parse(request.body ?? {});
    const now = new Date().toISOString();
    const doc = {
      id: `draft-${randomUUID()}`,
      campaign_id: req.campaign_id ?? null,
      title: req.title || req.subject,
      subject: req.subject,
      preview_text: req.preheader,
      sender_name: "",
      reply_to: "",
      audience: req.audience,
      to: req.to.toLowerCase(),
      selected_recipients: [...new Set(req.selected_recipients.map((email) => email.toLowerCase()))],
      document: req.document,
      source: "chatgpt_action",
      created_by: ACTION_ACTOR_EMAIL,
      updated_by: ACTION_ACTOR_EMAIL,
      created_at: now,
      updated_at: now,
    };
    await getDb().collection("admin_email_drafts").insertOne({ ...doc });
    setAuditMeta(request, { campaignId: doc.id, audience: doc.audience });
    return publicDraft(doc);
  });

  app.get("/admin/actions/email/drafts/:id", routeConfig("get_email_draft"), async (request, reply) => {
    const { id } = IdSchema.parse(request.params);
    const draft = await getDb().collection("admin_email_drafts").findOne({ id }, { projection: { _id: 0 } });
    if (!draft) return reply.code(404).send({ detail: "Draft not found." });
    setAuditMeta(request, { campaignId: id, audience: String(draft["audience"] ?? "") });
    return publicDraft(draft);
  });

  app.post("/admin/actions/email/drafts/:id/preview", routeConfig("preview_email_draft"), async (request, reply) => {
    const { id } = IdSchema.parse(request.params);
    const draft = await getDb().collection("admin_email_drafts").findOne({ id });
    if (!draft) return reply.code(404).send({ detail: "Draft not found." });
    try {
      const req = campaignFromDraft(draft);
      const [branding, sender] = await Promise.all([emailBranding(), resolveEmailSender(req.sender_name || undefined)]);
      const rendered = campaignParts(req, branding, { account_email: "preview@xaucloud.io", display_name: "XauCloud Customer", first_name: "Customer" });
      setAuditMeta(request, { campaignId: id, audience: String(draft["audience"] ?? "") });
      return {
        draft_id: id,
        subject: req.subject,
        audience: req.audience,
        sender: sender.formatted,
        preview_text: req.preview_text ?? "",
        text: rendered.text,
        renderer: "xaucloud_admin_email_v1",
      };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.post("/admin/actions/email/drafts/:id/test", routeConfig("send_test_email"), async (request, reply) => {
    const { id } = IdSchema.parse(request.params);
    const { to } = TestSendSchema.parse(request.body ?? {});
    if (!EMAIL_RE.test(to)) return reply.code(400).send({ detail: "Enter a valid test recipient." });
    const draft = await getDb().collection("admin_email_drafts").findOne({ id });
    if (!draft) return reply.code(404).send({ detail: "Draft not found." });
    try {
      const req = campaignFromDraft(draft);
      const branding = await emailBranding();
      const recipient = contact(to) ?? { account_email: to.toLowerCase() };
      const rendered = campaignParts(req, branding, recipient);
      const result = await sendEmailDetailed(to.toLowerCase(), `[TEST] ${personalize(req.subject, recipient)}`, rendered.html, {
        text: rendered.text,
        replyTo: req.reply_to || undefined,
        senderName: req.sender_name || undefined,
      });
      setAuditMeta(request, { campaignId: id, audience: String(draft["audience"] ?? ""), recipientCount: 1 });
      if (!result.ok) return reply.code(502).send({ detail: result.error || "Test send failed." });
      return { sent: true, test_only: true, to: to.toLowerCase(), draft_id: id };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.post("/admin/actions/email/drafts/:id/prepare-send", routeConfig("prepare_email_broadcast"), async (request, reply) => {
    const { id } = IdSchema.parse(request.params);
    const draft = await getDb().collection("admin_email_drafts").findOne({ id });
    if (!draft) return reply.code(404).send({ detail: "Draft not found." });
    try {
      const req = campaignFromDraft(draft);
      const audience = AudienceSchema.parse(req.audience);
      const recipients = await contactsForAudience(audience, req.selected_recipients, String(req.to ?? ""));
      if (!recipients.length) throw new EmailCampaignError(400, "This audience has no valid recipient email addresses.");
      if (recipients.length > BROADCAST_CAP) throw new EmailCampaignError(400, `This audience exceeds the ${BROADCAST_CAP} recipient safety limit.`);
      const branding = await emailBranding();
      campaignParts(req, branding, recipients[0]!);
      const sender = await resolveEmailSender(req.sender_name || undefined);
      const rawToken = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + confirmationTtlSeconds() * 1000);
      await getDb().collection("admin_email_action_confirmations").insertOne({
        id: `confirmation-${randomUUID()}`,
        token_hash: sha256(rawToken),
        draft_id: id,
        campaign_fingerprint: draftFingerprint(draft),
        audience,
        recipient_count: recipients.length,
        recipient_fingerprint: recipientFingerprint(recipients.map((recipient) => recipient.account_email)),
        created_at: now,
        expires_at: expiresAt,
        used_at: null,
      });
      setAuditMeta(request, { campaignId: id, audience, recipientCount: recipients.length });
      return {
        draft_id: id,
        subject: req.subject,
        audience,
        recipient_count: recipients.length,
        sender: sender.formatted,
        warnings: [],
        confirmation_token: rawToken,
        confirmation_expiration: expiresAt.toISOString(),
      };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.post("/admin/actions/email/drafts/:id/send", routeConfig("send_email_broadcast"), async (request, reply) => {
    const { id } = IdSchema.parse(request.params);
    const { confirmation_token: token, idempotency_key: idempotencyKey } = SendActionSchema.parse(request.body ?? {});
    const log = getDb().collection("admin_email_log");
    const duplicate = await log.findOne({ source: "chatgpt_action", idempotency_key: idempotencyKey }, { projection: { _id: 0 } });
    if (duplicate) {
      setAuditMeta(request, { campaignId: String(duplicate["draft_id"] ?? id), audience: String(duplicate["audience"] ?? ""), recipientCount: Number(duplicate["recipients"] ?? 0) });
      return actionStatus(duplicate, true);
    }

    const tokenHash = sha256(token);
    const confirmations = getDb().collection("admin_email_action_confirmations");
    const confirmation = await confirmations.findOne({ token_hash: tokenHash });
    if (!confirmation || confirmation["draft_id"] !== id) return reply.code(400).send({ detail: "Invalid confirmation token." });
    if (confirmation["used_at"]) return reply.code(409).send({ detail: "Confirmation token has already been used." });
    const expiresAt = confirmation["expires_at"] instanceof Date ? confirmation["expires_at"] : new Date(String(confirmation["expires_at"]));
    if (expiresAt.getTime() <= Date.now()) return reply.code(410).send({ detail: "Confirmation token has expired. Prepare the campaign again." });

    const draft = await getDb().collection("admin_email_drafts").findOne({ id });
    if (!draft) return reply.code(404).send({ detail: "Draft not found." });
    if (draftFingerprint(draft) !== confirmation["campaign_fingerprint"]) {
      return reply.code(409).send({ detail: "The draft or audience changed after preparation. Prepare the campaign again." });
    }

    try {
      const req = campaignFromDraft(draft);
      const audience = AudienceSchema.parse(req.audience);
      const recipients = await contactsForAudience(audience, req.selected_recipients, String(req.to ?? ""));
      const currentRecipientFingerprint = recipientFingerprint(recipients.map((recipient) => recipient.account_email));
      if (recipients.length !== confirmation["recipient_count"] || currentRecipientFingerprint !== confirmation["recipient_fingerprint"]) {
        return reply.code(409).send({ detail: "The resolved recipient audience changed after preparation. Prepare the campaign again." });
      }
      if (!recipients.length || recipients.length > BROADCAST_CAP) return reply.code(409).send({ detail: "The prepared audience is no longer within the allowed recipient limits." });

      const reservedAt = new Date();
      const reserved = await confirmations.findOneAndUpdate(
        { token_hash: tokenHash, used_at: null, expires_at: { $gt: reservedAt } },
        { $set: { used_at: reservedAt, idempotency_key: idempotencyKey } },
        { returnDocument: "after" },
      );
      if (!reserved) return reply.code(409).send({ detail: "Confirmation token is no longer available." });

      const recordId = `send-${randomUUID()}`;
      let outcome;
      try {
        outcome = await deliverAdminCampaign({
          req,
          actorEmail: ACTION_ACTOR_EMAIL,
          actorName: ACTION_ACTOR_NAME,
          source: "chatgpt_action",
          draftId: id,
          campaignId: typeof draft["campaign_id"] === "string" ? draft["campaign_id"] : undefined,
          recordId,
          idempotencyKey,
          recipients,
          reserveHistoryBeforeDelivery: true,
        });
      } catch (error) {
        if (isDuplicateKey(error)) {
          const existing = await log.findOne({ source: "chatgpt_action", idempotency_key: idempotencyKey }, { projection: { _id: 0 } });
          if (existing) return actionStatus(existing, true);
        }
        throw error;
      }
      setAuditMeta(request, { campaignId: id, audience, recipientCount: recipients.length });
      const response = actionStatus(outcome.record);
      if (outcome.record["sent"] === 0) return reply.code(502).send(response);
      return response;
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.get("/admin/actions/email/broadcasts/:id", routeConfig("get_email_broadcast_status"), async (request, reply) => {
    const { id } = IdSchema.parse(request.params);
    const record = await getDb().collection("admin_email_log").findOne({ id, source: "chatgpt_action" }, { projection: { _id: 0 } });
    if (!record) return reply.code(404).send({ detail: "Broadcast not found." });
    setAuditMeta(request, { campaignId: String(record["draft_id"] ?? ""), audience: String(record["audience"] ?? ""), recipientCount: Number(record["recipients"] ?? 0) });
    return actionStatus(record);
  });
}
