import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin } from "../../auth.js";
import { sendEmailDetailed } from "../../services/email.js";
import { emailBranding } from "../../services/emailBranding.js";
import {
  BUILT_IN_EMAIL_TEMPLATES,
  EmailDocumentSchema,
  personalize,
  renderEmailCampaign,
  type EmailDocument,
  type Personalization,
} from "../../services/emailCampaign.js";

const BROADCAST_CAP = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AudienceSchema = z.enum(["single", "all_users", "customers", "active_license", "inactive_license", "selected"]);

const LegacyBodyFields = z.object({
  body_html: z.string().max(200_000).optional(),
  cta_label: z.string().max(80).nullable().optional(),
  cta_url: z.string().max(2_000).nullable().optional(),
});

const CampaignSchema = z.object({
  subject: z.string().trim().min(1).max(300).refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks."),
  preview_text: z.string().max(300).nullable().optional(),
  sender_name: z.string().trim().min(1).max(80).refine((value) => !/[\r\n]/.test(value), "Sender name cannot contain line breaks.").nullable().optional(),
  reply_to: z.union([z.string().email().max(320), z.literal(""), z.null()]).optional(),
  document: EmailDocumentSchema.optional(),
}).merge(LegacyBodyFields).superRefine((value, ctx) => {
  if (!value.document && !value.body_html?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Email content cannot be empty.", path: ["document"] });
  }
});

const SendSchema = CampaignSchema.and(z.object({
  mode: z.enum(["single", "broadcast"]).optional(),
  audience: AudienceSchema.optional(),
  to: z.string().nullable().optional(),
  selected_recipients: z.array(z.string().email()).max(250).optional(),
  confirm: z.boolean().nullable().optional(),
}));

const TestSchema = CampaignSchema.and(z.object({ to: z.string().nullable().optional() }));

const DraftSchema = CampaignSchema.and(z.object({
  id: z.string().max(100).optional(),
  title: z.string().trim().min(1).max(160),
  audience: AudienceSchema.default("single"),
  to: z.string().max(320).default(""),
  selected_recipients: z.array(z.string().email()).max(250).default([]),
}));

const CustomTemplateSchema = CampaignSchema.and(z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).default("Custom XauCloud template"),
}));

interface Contact extends Personalization { account_email: string; }

function legacyDocument(req: z.infer<typeof CampaignSchema>): EmailDocument {
  if (req.document) return req.document;
  const blocks: EmailDocument["blocks"] = [{ id: "legacy-body", type: "text", html: req.body_html || "" }];
  if (req.cta_label && req.cta_url) blocks.push({ id: "legacy-cta", type: "button", text: req.cta_label, url: req.cta_url, style: "gold" });
  return {
    version: 1,
    theme: { width: 640, background: "#08080A", contentBackground: "#FFFFFF", accent: "#D6B35A", radius: 10, spacing: "normal" },
    blocks,
  };
}

function hasContent(document: EmailDocument): boolean {
  return document.blocks.some((block) => {
    if (["divider", "spacer", "footer"].includes(block.type)) return false;
    return Boolean(block.text?.trim() || block.title?.trim() || block.subtitle?.trim() || block.html?.replace(/<[^>]+>/g, "").trim() || block.url?.trim() || block.items?.length || block.columns?.length);
  });
}

function contact(emailValue: unknown, fullNameValue?: unknown): Contact | null {
  const email = String(emailValue ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  const display = String(fullNameValue ?? "").trim();
  return { account_email: email, display_name: display || undefined, first_name: display.split(/\s+/)[0] || undefined };
}

function uniqueContacts(values: Contact[]): Contact[] {
  const out = new Map<string, Contact>();
  for (const value of values) if (!out.has(value.account_email)) out.set(value.account_email, value);
  return [...out.values()];
}

async function accountNames(): Promise<Map<string, string>> {
  const rows = await getDb().collection("cloud_users").find({}, { projection: { _id: 0, email: 1, full_name: 1 } }).toArray();
  return new Map(rows.map((row) => [String(row["email"] ?? "").trim().toLowerCase(), String(row["full_name"] ?? "").trim()]));
}

async function contactsForAudience(audience: z.infer<typeof AudienceSchema>, selected: string[] = [], single = ""): Promise<Contact[]> {
  const db = getDb();
  if (audience === "single") return uniqueContacts([contact(single)].filter((value): value is Contact => Boolean(value)));
  if (audience === "selected") return uniqueContacts(selected.map((email) => contact(email)).filter((value): value is Contact => Boolean(value)));
  if (audience === "all_users") {
    const rows = await db.collection("cloud_users").find({}, { projection: { _id: 0, email: 1, full_name: 1 } }).toArray();
    return uniqueContacts(rows.map((row) => contact(row["email"], row["full_name"])).filter((value): value is Contact => Boolean(value)));
  }
  const names = await accountNames();
  const query = audience === "active_license" ? { is_active: true } : audience === "inactive_license" ? { is_active: false } : {};
  const rows = await db.collection("pin_licenses").find(query, { projection: { _id: 0, buyer_email: 1, buyer_name: 1 } }).toArray();
  return uniqueContacts(rows.map((row) => {
    const email = String(row["buyer_email"] ?? "").trim().toLowerCase();
    return contact(email, names.get(email) || row["buyer_name"]);
  }).filter((value): value is Contact => Boolean(value)));
}

async function audienceSummary() {
  const [allUsers, customers, active, inactive] = await Promise.all([
    contactsForAudience("all_users"), contactsForAudience("customers"), contactsForAudience("active_license"), contactsForAudience("inactive_license"),
  ]);
  return {
    cap: BROADCAST_CAP,
    segments: [
      { id: "single", label: "One recipient", description: "One validated email address", count: null },
      { id: "all_users", label: "All users", description: "Every registered Command Center account", count: allUsers.length },
      { id: "customers", label: "Customers", description: "Unique buyer emails attached to a license", count: customers.length },
      { id: "active_license", label: "Active license holders", description: "Buyer emails on licenses currently marked active", count: active.length },
      { id: "inactive_license", label: "Inactive license holders", description: "Buyer emails on licenses currently marked inactive", count: inactive.length },
      { id: "selected", label: "Selected recipients", description: "A validated list entered by the admin", count: null },
    ],
    // Backward-compatible field used by the previous console.
    total: allUsers.length,
  };
}

function campaignParts(req: z.infer<typeof CampaignSchema>, branding: Awaited<ReturnType<typeof emailBranding>>, recipient: Contact) {
  const document = legacyDocument(req);
  if (!hasContent(document)) throw new Error("EMPTY_EMAIL");
  return renderEmailCampaign(document, { previewText: req.preview_text, senderName: req.sender_name }, branding, recipient);
}

function publicDraft(row: Record<string, unknown>) {
  const { _id, ...rest } = row;
  return rest;
}

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
      if (error instanceof Error && error.message === "EMPTY_EMAIL") return reply.code(400).send({ detail: "Add at least one content block before previewing." });
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
      if (error instanceof Error && error.message === "EMPTY_EMAIL") return reply.code(400).send({ detail: "Add at least one content block before sending a test." });
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
    const branding = await emailBranding();
    const audience = req.audience ?? (req.mode === "single" ? "single" : "all_users");
    if (audience !== "single" && req.confirm !== true) return reply.code(400).send({ detail: "Broadcast requires explicit confirmation." });
    let recipients = await contactsForAudience(audience, req.selected_recipients, String(req.to ?? ""));
    if (!recipients.length) return reply.code(400).send({ detail: "This audience has no valid recipient email addresses." });
    if (recipients.length > BROADCAST_CAP) {
      return reply.code(400).send({
        detail: `This audience contains ${recipients.length} recipients, above the ${BROADCAST_CAP} recipient safety limit. Narrow the audience before sending.`,
      });
    }

    const document = legacyDocument(req);
    if (!hasContent(document)) return reply.code(400).send({ detail: "Add at least one content block before sending." });
    let sent = 0;
    let failed = 0;
    let lastError = "";
    for (const recipient of recipients) {
      const rendered = renderEmailCampaign(document, { previewText: req.preview_text, senderName: req.sender_name }, branding, recipient);
      const result = await sendEmailDetailed(recipient.account_email, personalize(req.subject, recipient), rendered.html, {
        text: rendered.text,
        replyTo: req.reply_to || undefined,
        senderName: req.sender_name || undefined,
      });
      if (result.ok) sent += 1;
      else { failed += 1; lastError = result.error || "Delivery failed."; }
    }

    const record = {
      id: `send-${randomUUID()}`,
      at: new Date().toISOString(),
      admin_email: String(admin["email"] ?? ""),
      creator: String(admin["name"] ?? admin["email"] ?? "Admin"),
      mode: audience === "single" ? "single" : "broadcast",
      audience,
      subject: req.subject,
      preview_text: req.preview_text ?? "",
      sender_name: req.sender_name || branding.sender_name,
      reply_to: req.reply_to || branding.support_email,
      document,
      recipients: recipients.length,
      sent,
      failed,
      status: sent === 0 ? "failed" : failed ? "partial" : "sent",
    };
    try { await getDb().collection("admin_email_log").insertOne({ ...record }); } catch { /* send result remains authoritative */ }
    if (sent === 0) return reply.code(502).send({ detail: lastError || "No emails were sent.", ...record });
    return record;
  });

  app.get("/admin/email/log", { preHandler: requireAdmin }, async () => {
    const rows = await getDb().collection("admin_email_log").find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(50).toArray();
    return { entries: rows };
  });
}
