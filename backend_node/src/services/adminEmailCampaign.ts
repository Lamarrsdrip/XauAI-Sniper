import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";
import { resolveEmailSender, sendEmailDetailed, type EmailSendResult } from "./email.js";
import { emailBranding, type EmailBranding } from "./emailBranding.js";
import {
  EmailDocumentSchema,
  personalize,
  renderEmailCampaign,
  type EmailDocument,
  type Personalization,
} from "./emailCampaign.js";

export const BROADCAST_CAP = 5000;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const AudienceSchema = z.enum(["single", "all_users", "customers", "active_license", "inactive_license", "selected"]);

const LegacyBodyFields = z.object({
  body_html: z.string().max(200_000).optional(),
  cta_label: z.string().max(80).nullable().optional(),
  cta_url: z.string().max(2_000).nullable().optional(),
});

export const CampaignSchema = z.object({
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

export const SendSchema = CampaignSchema.and(z.object({
  mode: z.enum(["single", "broadcast"]).optional(),
  audience: AudienceSchema.optional(),
  to: z.string().nullable().optional(),
  selected_recipients: z.array(z.string().email()).max(250).optional(),
  confirm: z.boolean().nullable().optional(),
}));

export const TestSchema = CampaignSchema.and(z.object({ to: z.string().nullable().optional() }));

export const DraftSchema = CampaignSchema.and(z.object({
  id: z.string().max(100).optional(),
  title: z.string().trim().min(1).max(160),
  audience: AudienceSchema.default("single"),
  to: z.string().max(320).default(""),
  selected_recipients: z.array(z.string().email()).max(250).default([]),
}));

export type Audience = z.infer<typeof AudienceSchema>;
export type CampaignInput = z.infer<typeof CampaignSchema>;
export type SendInput = z.infer<typeof SendSchema>;
export type DraftInput = z.infer<typeof DraftSchema>;
export interface Contact extends Personalization { account_email: string; }

export class EmailCampaignError extends Error {
  constructor(public readonly statusCode: number, public readonly detail: string) {
    super(detail);
  }
}

export function legacyDocument(req: CampaignInput): EmailDocument {
  if (req.document) return req.document;
  const blocks: EmailDocument["blocks"] = [{ id: "legacy-body", type: "text", html: req.body_html || "" }];
  if (req.cta_label && req.cta_url) blocks.push({ id: "legacy-cta", type: "button", text: req.cta_label, url: req.cta_url, style: "gold" });
  return {
    version: 1,
    theme: { width: 640, background: "#08080A", contentBackground: "#FFFFFF", accent: "#D6B35A", radius: 10, spacing: "normal" },
    blocks,
  };
}

export function hasContent(document: EmailDocument): boolean {
  return document.blocks.some((block) => {
    if (["divider", "spacer", "footer"].includes(block.type)) return false;
    return Boolean(block.text?.trim() || block.title?.trim() || block.subtitle?.trim() || block.html?.replace(/<[^>]+>/g, "").trim() || block.url?.trim() || block.items?.length || block.columns?.length);
  });
}

export function contact(emailValue: unknown, fullNameValue?: unknown): Contact | null {
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

export async function contactsForAudience(audience: Audience, selected: string[] = [], single = ""): Promise<Contact[]> {
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

export async function audienceSummary() {
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
    total: allUsers.length,
  };
}

export function campaignParts(req: CampaignInput, branding: EmailBranding, recipient: Contact) {
  const document = legacyDocument(req);
  if (!hasContent(document)) throw new EmailCampaignError(400, "Add at least one content block before continuing.");
  return renderEmailCampaign(document, { previewText: req.preview_text, senderName: req.sender_name }, branding, recipient);
}

export function publicDraft(row: Record<string, unknown>) {
  const { _id, ...rest } = row;
  return rest;
}

export function campaignFromDraft(row: Record<string, unknown>): SendInput {
  return SendSchema.parse({
    subject: row["subject"],
    preview_text: row["preview_text"] ?? "",
    sender_name: row["sender_name"] || undefined,
    reply_to: row["reply_to"] || undefined,
    document: row["document"],
    audience: row["audience"],
    to: row["to"] ?? "",
    selected_recipients: row["selected_recipients"] ?? [],
  });
}

type SendFunction = typeof sendEmailDetailed;

export interface DeliverAdminCampaignOptions {
  req: SendInput;
  actorEmail: string;
  actorName: string;
  source: "admin_dashboard" | "chatgpt_action";
  draftId?: string;
  campaignId?: string;
  recordId?: string;
  idempotencyKey?: string;
  recipients?: Contact[];
  branding?: EmailBranding;
  reserveHistoryBeforeDelivery?: boolean;
  send?: SendFunction;
}

export interface DeliveryOutcome {
  record: Record<string, unknown>;
  lastError: string;
}

/** Shared delivery/history path used by the dashboard and GPT Action. */
export async function deliverAdminCampaign(options: DeliverAdminCampaignOptions): Promise<DeliveryOutcome> {
  const { req } = options;
  const audience = req.audience ?? (req.mode === "single" ? "single" : "all_users");
  const recipients = options.recipients ?? await contactsForAudience(audience, req.selected_recipients, String(req.to ?? ""));
  if (!recipients.length) throw new EmailCampaignError(400, "This audience has no valid recipient email addresses.");
  if (recipients.length > BROADCAST_CAP) {
    throw new EmailCampaignError(400, `This audience contains ${recipients.length} recipients, above the ${BROADCAST_CAP} recipient safety limit. Narrow the audience before sending.`);
  }
  const document = legacyDocument(req);
  if (!hasContent(document)) throw new EmailCampaignError(400, "Add at least one content block before sending.");

  const branding = options.branding ?? await emailBranding();
  const resolvedSender = await resolveEmailSender(req.sender_name || undefined);
  const now = new Date().toISOString();
  const record: Record<string, unknown> = {
    id: options.recordId ?? `send-${randomUUID()}`,
    at: now,
    updated_at: now,
    admin_email: options.actorEmail,
    creator: options.actorName || options.actorEmail || "Admin",
    source: options.source,
    mode: audience === "single" ? "single" : "broadcast",
    audience,
    subject: req.subject,
    preview_text: req.preview_text ?? "",
    sender_name: req.sender_name || branding.sender_name,
    sender_address: resolvedSender.address,
    reply_to: req.reply_to || branding.support_email,
    document,
    recipients: recipients.length,
    sent: 0,
    failed: 0,
    status: "sending",
    ...(options.draftId ? { draft_id: options.draftId } : {}),
    ...(options.campaignId ? { campaign_id: options.campaignId } : {}),
    ...(options.idempotencyKey ? { idempotency_key: options.idempotencyKey } : {}),
  };

  const log = getDb().collection("admin_email_log");
  if (options.reserveHistoryBeforeDelivery) await log.insertOne({ ...record });

  let sent = 0;
  let failed = 0;
  let lastError = "";
  const send = options.send ?? sendEmailDetailed;
  for (const recipient of recipients) {
    const rendered = renderEmailCampaign(document, { previewText: req.preview_text, senderName: req.sender_name }, branding, recipient);
    const result: EmailSendResult = await send(recipient.account_email, personalize(req.subject, recipient), rendered.html, {
      text: rendered.text,
      replyTo: req.reply_to || undefined,
      senderName: req.sender_name || undefined,
    });
    if (result.ok) sent += 1;
    else { failed += 1; lastError = result.error || "Delivery failed."; }
  }

  Object.assign(record, {
    updated_at: new Date().toISOString(),
    sent,
    failed,
    status: sent === 0 ? "failed" : failed ? "partial" : "sent",
    ...(lastError ? { last_error: lastError } : {}),
  });
  if (options.reserveHistoryBeforeDelivery) {
    await log.updateOne({ id: record["id"] }, { $set: { ...record } });
  } else {
    try { await log.insertOne({ ...record }); } catch { /* Preserve the dashboard's existing send-result semantics. */ }
  }
  return { record, lastError };
}
