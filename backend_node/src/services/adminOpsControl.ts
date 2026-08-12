import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { EmailDocumentSchema, renderEmailCampaign, type EmailDocument } from "./emailCampaign.js";
import { emailBranding } from "./emailBranding.js";
import { currentEaRelease, loadEaReleaseManifest } from "./releaseManifest.js";
import { resolveEmailSender, sendEmailDetailed } from "./email.js";

export const ADMIN_OPS_PERMISSIONS = [
  "admin.read", "admin.users.write", "admin.licenses.write", "admin.orders.read", "admin.payments.write",
  "admin.email.read", "admin.email.write", "admin.email.publish", "admin.system.read", "admin.releases.write",
  "admin.support.write", "admin.analytics.read", "admin.notifications.write",
] as const;
export type AdminOpsPermission = typeof ADMIN_OPS_PERMISSIONS[number];

const DEFAULT_PERMISSIONS = new Set<AdminOpsPermission>([
  "admin.read", "admin.users.write", "admin.licenses.write", "admin.orders.read",
  "admin.email.read", "admin.email.write", "admin.email.publish", "admin.system.read",
  "admin.support.write", "admin.analytics.read", "admin.notifications.write",
]);

export function actionPermissions(): Set<AdminOpsPermission> {
  const raw = (process.env["XAUCLOUD_GPT_ACTION_PERMISSIONS"] ?? "").trim();
  if (!raw) return new Set(DEFAULT_PERMISSIONS);
  const out = new Set<AdminOpsPermission>();
  for (const item of raw.split(",").map((x) => x.trim()).filter(Boolean)) {
    if ((ADMIN_OPS_PERMISSIONS as readonly string[]).includes(item)) out.add(item as AdminOpsPermission);
  }
  return out;
}

export function requireActionPermission(permission: AdminOpsPermission): void {
  if (!actionPermissions().has(permission)) {
    throw Object.assign(new Error("This XauCloud Admin integration is not permitted to perform that action."), { statusCode: 403 });
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function safeText(value: unknown, max = 500): string {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function maskEmail(value: unknown): string {
  const email = String(value ?? "").toLowerCase();
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "";
  return `${local.slice(0, 2)}${local.length > 2 ? "***" : "*"}@${domain}`;
}

export function sanitizeUser(row: Record<string, unknown>, includeEmail = true): Record<string, unknown> {
  return {
    id: String(row["id"] ?? row["_id"] ?? ""),
    ...(includeEmail ? { email: String(row["email"] ?? "").toLowerCase() } : { email_masked: maskEmail(row["email"]) }),
    name: String(row["full_name"] ?? row["name"] ?? ""),
    status: row["disabled_at"] ? "disabled" : "active",
    created_at: row["created_at"] ?? null,
    last_login_at: row["last_login_at"] ?? null,
    email_verified: Boolean(row["email_verified"] ?? row["verified"] ?? false),
  };
}

export function sanitizeLicense(row: Record<string, unknown>, includePin = false): Record<string, unknown> {
  const pin = String(row["pin"] ?? "");
  const sourceText = `${String(row["source"] ?? "")} ${String(row["source_type"] ?? "")} ${String(row["issued_by"] ?? "")}`.toLowerCase();
  const provider = String(row["payment_provider"] ?? row["provider"] ?? "").toLowerCase();
  const paymentRef = String(row["payment_ref"] ?? row["payment_reference"] ?? "").trim();
  const sourceType =
    sourceText.includes("promo") ? "promotional" :
    sourceText.includes("bank") || provider.includes("bank") ? "bank_transfer" :
    sourceText.includes("manual") || sourceText.includes("admin") ? "manual_admin" :
    sourceText.includes("legacy") || sourceText.includes("migration") ? "legacy_migration" :
    paymentRef ? "paid_order" : "unknown_legacy";
  return {
    id: String(row["id"] ?? row["_id"] ?? ""),
    pin: includePin && pin ? pin : pin ? `${pin.slice(0, 3)}***${pin.slice(-2)}` : "",
    buyer_email: String(row["buyer_email"] ?? "").toLowerCase(),
    buyer_name: String(row["buyer_name"] ?? ""),
    active: Boolean(row["is_active"]),
    used: Boolean(row["is_used"]),
    mt5_account: row["mt5_account"] ? String(row["mt5_account"]) : null,
    source_type: sourceType,
    order_id: row["order_id"] ?? (paymentRef || null),
    payment_reference: paymentRef || null,
    payment_provider: row["payment_provider"] ?? row["provider"] ?? null,
    fulfillment_event_id: row["fulfillment_event_id"] ?? null,
    issued_by: row["issued_by"] ?? null,
    issued_at: row["issued_at"] ?? row["created_at"] ?? null,
    payment_ref: row["payment_ref"] ?? null,
    created_at: row["created_at"] ?? null,
    activated_at: row["activated_at"] ?? null,
    revoked_at: row["revoked_at"] ?? null,
  };
}

export function sanitizeOrder(row: Record<string, unknown>): Record<string, unknown> {
  return {
    reference: String(row["reference"] ?? ""),
    provider: String(row["provider"] ?? ""),
    buyer_email: String(row["buyer_email"] ?? "").toLowerCase(),
    buyer_name: String(row["buyer_name"] ?? ""),
    amount_minor: Number(row["amount_kobo"] ?? 0),
    currency: String(row["currency"] ?? "NGN"),
    payment_status: String(row["payment_status"] ?? ""),
    fulfillment_status: row["pin_generated"] ? "fulfilled" : "not_fulfilled",
    fulfillment_email_failed: Boolean(row["fulfillment_email_failed"]),
    created_at: row["created_at"] ?? null,
    updated_at: row["updated_at"] ?? null,
  };
}

export async function auditAdminAction(request: FastifyRequest, action: string, target: string, result: string, detail: Record<string, unknown> = {}): Promise<void> {
  const sanitized = Object.fromEntries(Object.entries(detail).filter(([key]) => !/secret|password|token|credential|key/i.test(key)).map(([k, v]) => [k, typeof v === "string" ? safeText(v, 300) : v]));
  await getDb().collection("admin_action_audit").insertOne({
    id: `audit-${randomUUID()}`, at: new Date().toISOString(), actor: "chatgpt-action@xaucloud.internal", source: "chatgpt_action",
    request_id: request.id, correlation_id: String(request.headers["x-correlation-id"] ?? request.id), action, target, result, detail: sanitized,
  });
}

export async function issueAdminConfirmation(kind: string, target: string, operation: string, snapshot: unknown): Promise<Record<string, unknown>> {
  const token = `xc_admin_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const ttl = Math.min(1800, Math.max(60, env.XAUCLOUD_GPT_ACTION_CONFIRMATION_TTL_SECONDS || 600));
  const expires = new Date(now.getTime() + ttl * 1000);
  await getDb().collection("admin_ops_confirmations").insertOne({ id: `confirm-${randomUUID()}`, token_hash: hash(token), kind, target, operation, snapshot_hash: hash(snapshot), created_at: now, expires_at: expires, used_at: null });
  return { confirmation_token: token, confirmation_expiration: expires.toISOString() };
}

export async function consumeAdminConfirmation(token: string, kind: string, target: string, operation: string, snapshot: unknown): Promise<void> {
  const coll = getDb().collection("admin_ops_confirmations");
  const row = await coll.findOne({ token_hash: hash(token) });
  if (!row || row["kind"] !== kind || row["target"] !== target || row["operation"] !== operation) throw Object.assign(new Error("Invalid confirmation token."), { statusCode: 400 });
  if (row["used_at"]) throw Object.assign(new Error("Confirmation token has already been used."), { statusCode: 409 });
  if (new Date(String(row["expires_at"])).getTime() <= Date.now()) throw Object.assign(new Error("Confirmation token has expired."), { statusCode: 410 });
  if (row["snapshot_hash"] !== hash(snapshot)) throw Object.assign(new Error("Resource changed after preparation. Prepare again."), { statusCode: 409 });
  const used = await coll.findOneAndUpdate({ token_hash: hash(token), used_at: null, expires_at: { $gt: new Date() } }, { $set: { used_at: new Date() } }, { returnDocument: "after" });
  if (!used) throw Object.assign(new Error("Confirmation token is no longer available."), { statusCode: 409 });
}

export async function idempotentResult(key: string, action: string): Promise<Record<string, unknown> | null> {
  return getDb().collection("admin_ops_idempotency").findOne({ key, action }, { projection: { _id: 0 } });
}
export async function saveIdempotentResult(key: string, action: string, result: Record<string, unknown>): Promise<void> {
  try { await getDb().collection("admin_ops_idempotency").insertOne({ key, action, result, at: new Date().toISOString() }); } catch (e) { if (Number((e as { code?: unknown })?.code) !== 11000) throw e; }
}

export const TransactionalTemplateIdSchema = z.enum(["license_delivery", "bank_transfer_instructions", "bank_transfer_rejected", "welcome", "account_verification", "password_reset", "payment_failed", "license_status", "account_notice"]);
export const TransactionalTemplateDraftSchema = z.object({
  template_id: TransactionalTemplateIdSchema,
  subject: z.string().min(1).max(300).refine((v) => !/[\r\n]/.test(v)),
  preheader: z.string().max(300).optional().default(""),
  document: EmailDocumentSchema,
}).strict();

const WIRED_TRANSACTIONAL = new Set([
  "license_delivery",
  "bank_transfer_instructions",
  "bank_transfer_rejected",
  "welcome",
  "account_verification",
  "password_reset",
]);

export async function listTransactionalTemplates(): Promise<Record<string, unknown>[]> {
  const db = getDb();
  const overrides = await db.collection("transactional_email_templates").find({}, { projection: { _id: 0, document: 0 } }).toArray();
  const byId = new Map(overrides.map((r) => [String(r["template_id"]), r]));
  return TransactionalTemplateIdSchema.options.map((templateId) => ({
    template_id: templateId,
    live_wiring: WIRED_TRANSACTIONAL.has(templateId) ? "wired" : "not_currently_wired",
    published_version: byId.get(templateId)?.["published_version"] ?? null,
    has_published_override: Boolean(byId.get(templateId)?.["published_document"]),
    updated_at: byId.get(templateId)?.["updated_at"] ?? null,
  }));
}

export async function transactionalTemplate(templateId: string): Promise<Record<string, unknown>> {
  const row = await getDb().collection("transactional_email_templates").findOne({ template_id: templateId }, { projection: { _id: 0 } });
  return row ?? { template_id: templateId, live_wiring: WIRED_TRANSACTIONAL.has(templateId) ? "wired" : "not_currently_wired", status: "using_code_default" };
}

function applyTransactionalContext<T>(value: T, context: Record<string, string>): T {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (all, key: string) => Object.prototype.hasOwnProperty.call(context, key.toLowerCase()) ? String(context[key.toLowerCase()] ?? "") : all) as T;
  }
  if (Array.isArray(value)) return value.map((item) => applyTransactionalContext(item, context)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k,v]) => [k, applyTransactionalContext(v, context)])) as T;
  return value;
}

export async function renderTransactional(document: EmailDocument, subject: string, preheader: string, context: Record<string, string>): Promise<Record<string, unknown>> {
  const branding = await emailBranding();
  const normalizedContext = Object.fromEntries(Object.entries(context).map(([k,v]) => [k.toLowerCase(), String(v)]));
  const contextualDocument = EmailDocumentSchema.parse(applyTransactionalContext(document, normalizedContext));
  const contextualSubject = applyTransactionalContext(subject, normalizedContext);
  const contextualPreheader = applyTransactionalContext(preheader, normalizedContext);
  const rendered = renderEmailCampaign(contextualDocument, { previewText: contextualPreheader }, branding, { first_name: normalizedContext["first_name"] ?? normalizedContext["buyer_name"] ?? "Trader", account_email: normalizedContext["account_email"] ?? normalizedContext["buyer_email"] ?? "customer@example.com" });
  return { subject: contextualSubject, preheader: contextualPreheader, html: rendered.html, text: rendered.text };
}

export async function publishedTransactionalRender(templateId: string, context: Record<string, string>): Promise<Record<string, unknown> | null> {
  const row = await getDb().collection("transactional_email_templates").findOne({ template_id: templateId, published_document: { $exists: true } });
  if (!row) return null;
  return renderTransactional(EmailDocumentSchema.parse(row["published_document"]), String(row["published_subject"] ?? "XauCloud"), String(row["published_preheader"] ?? ""), context);
}

export async function replayData(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(process.cwd(), "data", "gold_replay_current.json"), "utf8")) as Record<string, unknown>;
}

export async function releaseSummary(): Promise<Record<string, unknown>> {
  const [current, manifest] = await Promise.all([currentEaRelease(), loadEaReleaseManifest()]);
  return { current: current ?? null, current_version: manifest.current_version ?? null, release_count: Object.keys(manifest.releases ?? {}).length };
}

export async function emailDeliverySummary(limit = 100): Promise<Record<string, unknown>> {
  const db = getDb();
  const rows = await db.collection("admin_email_log").find({}, { projection: { _id: 0, html: 0, document: 0 } }).sort({ at: -1 }).limit(Math.min(limit, 500)).toArray();
  const failed = rows.filter((r) => Number(r["failed"] ?? 0) > 0 || String(r["status"] ?? "").toLowerCase().includes("fail"));
  return { total_returned: rows.length, failed_count: failed.length, deliveries: rows };
}

export async function safeSendTransactional(to: string, subject: string, html: string, text: string): Promise<Record<string, unknown>> {
  const sender = await resolveEmailSender();
  const result = await sendEmailDetailed(to, subject, html, { text });
  return { accepted: result.ok, sender: sender.formatted, ...(result.error ? { error: result.error } : {}) };
}

export async function ensureAdminOpsInfrastructure(): Promise<void> {
  const db = getDb();
  await Promise.all([
    db.collection("admin_ops_confirmations").createIndex({ token_hash: 1 }, { unique: true }),
    db.collection("admin_ops_confirmations").createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    db.collection("admin_ops_idempotency").createIndex({ key: 1, action: 1 }, { unique: true }),
    db.collection("admin_action_audit").createIndex({ at: -1 }),
    db.collection("transactional_email_templates").createIndex({ template_id: 1 }, { unique: true }),
    db.collection("used_email_verification_tokens").createIndex({ jti: 1 }, { unique: true }),
    db.collection("used_password_reset_tokens").createIndex({ jti: 1 }, { unique: true }),
    db.collection("admin_email_log").createIndex({ delivery_id: 1 }),
    db.collection("transactional_email_events").createIndex({ event_key: 1 }, { unique: true }),
    db.collection("support_tickets").createIndex({ id: 1 }, { unique: true }),
  ]);
}
