import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin } from "../../auth.js";
import { sendEmailDetailed } from "../../services/email.js";
import { emailBranding } from "../../services/emailBranding.js";
import {
  BUILT_IN_EMAIL_TEMPLATES,
  personalize,
} from "../../services/emailCampaign.js";
import {
  AudienceSchema,
  CampaignSchema,
  DraftSchema,
  EMAIL_RE,
  EmailCampaignError,
  SendSchema,
  TestSchema,
  audienceSummary,
  campaignParts,
  contact,
  deliverAdminCampaign,
  legacyDocument,
  publicDraft,
} from "../../services/adminEmailCampaign.js";

const CustomTemplateSchema = CampaignSchema.and(z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).default("Custom XauCloud template"),
}));

export async function registerAdminEmailRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/email/audience", { preHandler: requireAdmin }, async () => {
    const [summary, branding] = await Promise.all([audienceSummary(), emailBranding()]);
    return { ...summary, sender_name: branding.sender_name, reply_to: branding.support_email };
  });

  app.get("/admin/email/templates", { preHandler: requireAdmin }, async () => {
    const custom = await getDb().collection("admin_email_templates").find({}, { projection: { _id: 0 } }).sort({ updated_at: -1 }).toArray();
    return { templates: [...BUILT_IN_EMAIL_TEMPLATES, ...custom.map((row) => ({ ...row, builtIn: false }))] };
  });

  app.post("/admin/email/templates", { preHandler: requireAdmin }, async (request) => {
    const req = CustomTemplateSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const now = new Date().toISOString();
    const doc = {
      id: `custom-${randomUUID()}`,
      name: req.name,
      description: req.description,
      subject: req.subject,
      previewText: req.preview_text ?? "",
      senderName: req.sender_name ?? "",
      replyTo: req.reply_to ?? "",
      document: legacyDocument(req),
      builtIn: false,
      created_by: String(admin["email"] ?? ""),
      created_at: now,
      updated_at: now,
    };
    await getDb().collection("admin_email_templates").insertOne({ ...doc });
    return doc;
  });

  app.delete("/admin/email/templates/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id.startsWith("custom-")) return reply.code(400).send({ detail: "Built-in templates cannot be deleted." });
    const result = await getDb().collection("admin_email_templates").deleteOne({ id });
    if (!result.deletedCount) return reply.code(404).send({ detail: "Template not found." });
    return { deleted: true };
  });

  app.get("/admin/email/drafts", { preHandler: requireAdmin }, async () => {
    const rows = await getDb().collection("admin_email_drafts").find({}, { projection: { _id: 0 } }).sort({ updated_at: -1 }).limit(100).toArray();
    return { drafts: rows };
  });

  app.post("/admin/email/drafts", { preHandler: requireAdmin }, async (request) => {
    const req = DraftSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const now = new Date().toISOString();
    const id = req.id || `draft-${randomUUID()}`;
    const doc = {
      id,
      title: req.title,
      subject: req.subject,
      preview_text: req.preview_text ?? "",
      sender_name: req.sender_name ?? "",
      reply_to: req.reply_to ?? "",
      audience: req.audience,
      to: req.to,
      selected_recipients: req.selected_recipients,
      document: legacyDocument(req),
      updated_at: now,
      updated_by: String(admin["email"] ?? ""),
    };
    await getDb().collection("admin_email_drafts").updateOne({ id }, { $set: doc, $setOnInsert: { created_at: now } }, { upsert: true });
    return publicDraft(doc);
  });

  app.post("/admin/email/drafts/:id/duplicate", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = await getDb().collection("admin_email_drafts").findOne({ id });
    if (!source) return reply.code(404).send({ detail: "Draft not found." });
    const now = new Date().toISOString();
    const copy = { ...publicDraft(source), id: `draft-${randomUUID()}`, title: `${String(source["title"] ?? "Draft")} copy`, created_at: now, updated_at: now };
    await getDb().collection("admin_email_drafts").insertOne({ ...copy });
    return copy;
  });

  app.delete("/admin/email/drafts/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getDb().collection("admin_email_drafts").deleteOne({ id });
    if (!result.deletedCount) return reply.code(404).send({ detail: "Draft not found." });
    return { deleted: true };
  });

  app.post("/admin/email/preview", { preHandler: requireAdmin }, async (request, reply) => {
    const req = CampaignSchema.parse(request.body ?? {});
    const branding = await emailBranding();
    try {
      return campaignParts(req, branding, { account_email: "preview@xaucloud.io", display_name: "XauCloud Customer", first_name: "Customer" });
    } catch (error) {
      if (error instanceof EmailCampaignError) return reply.code(error.statusCode).send({ detail: error.detail });
      throw error;
    }
  });

  app.post("/admin/email/test", { preHandler: requireAdmin }, async (request, reply) => {
    const req = TestSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const branding = await emailBranding();
    const to = String(req.to ?? admin["email"] ?? branding.admin_notification_email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return reply.code(400).send({ detail: "Enter a valid test recipient." });
    let rendered;
    try {
      rendered = campaignParts(req, branding, contact(to, admin["name"]) ?? { account_email: to });
    } catch (error) {
      if (error instanceof EmailCampaignError) return reply.code(error.statusCode).send({ detail: error.detail });
      throw error;
    }
    const result = await sendEmailDetailed(to, `[TEST] ${personalize(req.subject, { account_email: to, display_name: String(admin["name"] ?? "") })}`, rendered.html, {
      text: rendered.text,
      replyTo: req.reply_to || undefined,
      senderName: req.sender_name || undefined,
    });
    if (!result.ok) return reply.code(502).send({ detail: result.error || "Test send failed." });
    return { sent: true, to };
  });

  app.post("/admin/email/send", { preHandler: requireAdmin }, async (request, reply) => {
    const req = SendSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const audience = req.audience ?? (req.mode === "single" ? "single" : "all_users");
    if (audience !== "single" && req.confirm !== true) return reply.code(400).send({ detail: "Broadcast requires explicit confirmation." });
    try {
      const outcome = await deliverAdminCampaign({
        req,
        actorEmail: String(admin["email"] ?? ""),
        actorName: String(admin["name"] ?? admin["email"] ?? "Admin"),
        source: "admin_dashboard",
      });
      if (outcome.record["sent"] === 0) return reply.code(502).send({ detail: outcome.lastError || "No emails were sent.", ...outcome.record });
      return outcome.record;
    } catch (error) {
      if (error instanceof EmailCampaignError) return reply.code(error.statusCode).send({ detail: error.detail });
      throw error;
    }
  });

  app.get("/admin/email/log", { preHandler: requireAdmin }, async () => {
    const rows = await getDb().collection("admin_email_log").find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(50).toArray();
    return { entries: rows };
  });
}
