import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";
import { EmailDocumentSchema, type EmailDocument } from "./emailCampaign.js";

const Email = z.string().trim().email().max(320);
export const CUSTOM_EMAIL_RECIPIENT_CAP = 250;
export const CustomAudienceSchema = z.enum(["single", "selected", "registered_users", "active_customers", "active_license_holders", "eligible_prospects", "pending_checkout"]);
export const CustomEmailDraftSchema = z.object({
  title: z.string().trim().min(1).max(160), subject: z.string().trim().min(1).max(300).refine((v) => !/[\r\n]/.test(v)),
  preheader: z.string().trim().max(300).default(""), recipient_mode: CustomAudienceSchema,
  to: Email.optional(), selected_recipients: z.array(Email).max(CUSTOM_EMAIL_RECIPIENT_CAP).default([]),
  document: EmailDocumentSchema, campaign_id: z.string().trim().max(160).optional(), reference_id: z.string().trim().max(160).optional(),
}).strict();
export type CustomEmailDraft = z.infer<typeof CustomEmailDraftSchema>;
export type CustomRecipientInput = Pick<CustomEmailDraft, "recipient_mode" | "to" | "selected_recipients">;
export type CustomRecipient = { account_email: string; first_name?: string; display_name?: string };

function unique(rows: CustomRecipient[]): CustomRecipient[] { const m = new Map<string, CustomRecipient>(); for (const r of rows) if (!m.has(r.account_email)) m.set(r.account_email, r); return [...m.values()]; }
function person(email: unknown, name?: unknown): CustomRecipient | null { const account_email = String(email ?? "").trim().toLowerCase(); if (!Email.safeParse(account_email).success) return null; const display_name = String(name ?? "").trim(); return { account_email, ...(display_name ? { display_name, first_name: display_name.split(/\s+/)[0] } : {}) }; }
async function removeOptedOut(rows: CustomRecipient[]): Promise<CustomRecipient[]> {
  if (!rows.length) return [];
  const optedOut = await getDb().collection("cloud_users").find({ email: { $in: rows.map((row) => row.account_email) }, marketing_opt_out: true }, { projection: { _id: 0, email: 1 } }).toArray();
  const suppressed = new Set(optedOut.map((row) => String(row["email"] ?? "").toLowerCase()));
  return rows.filter((row) => !suppressed.has(row.account_email));
}

/** Server-owned audience resolver. It never accepts a query, raw filter, or hidden recipient header. */
export async function resolveCustomEmailRecipients(input: CustomRecipientInput): Promise<CustomRecipient[]> {
  if (input.recipient_mode === "single") return removeOptedOut(unique([person(input.to)].filter((x): x is CustomRecipient => Boolean(x))));
  if (input.recipient_mode === "selected") return removeOptedOut(unique(input.selected_recipients.map((x) => person(x)).filter((x): x is CustomRecipient => Boolean(x))));
  const db = getDb();
  if (input.recipient_mode === "registered_users") {
    const rows = await db.collection("cloud_users").find({ marketing_opt_out: { $ne: true } }, { projection: { _id: 0, email: 1, full_name: 1 } }).toArray();
    return unique(rows.map((r) => person(r["email"], r["full_name"])).filter((x): x is CustomRecipient => Boolean(x)));
  }
  if (input.recipient_mode === "active_customers" || input.recipient_mode === "active_license_holders") {
    const rows = await db.collection("pin_licenses").find({ is_active: true }, { projection: { _id: 0, buyer_email: 1, buyer_name: 1 } }).toArray();
    return removeOptedOut(unique(rows.map((r) => person(r["buyer_email"], r["buyer_name"])).filter((x): x is CustomRecipient => Boolean(x))));
  }
  const paid = await db.collection("pin_licenses").find({}, { projection: { _id: 0, buyer_email: 1 } }).toArray();
  const buyers = new Set(paid.map((r) => String(r["buyer_email"] ?? "").toLowerCase()));
  const rows = await db.collection("payment_transactions").find({ payment_status: { $nin: ["SUCCESS", "FULFILLED", "PAID"] }, pin_generated: { $in: [null, "", false] }, buyer_email: { $exists: true, $ne: "" } }, { projection: { _id: 0, buyer_email: 1, buyer_name: 1, payment_status: 1, refund_status: 1, cancelled_at: 1 } }).toArray();
  return removeOptedOut(unique(rows.filter((r) => !buyers.has(String(r["buyer_email"] ?? "").toLowerCase()) && !r["cancelled_at"] && !["REFUNDED", "CANCELLED"].includes(String(r["refund_status"] ?? "").toUpperCase())).map((r) => person(r["buyer_email"], r["buyer_name"])).filter((x): x is CustomRecipient => Boolean(x))));
}

export async function saveCustomEmailDraft(input: CustomEmailDraft, kind: "custom" | "marketing"): Promise<Record<string, unknown>> {
  const now = new Date().toISOString(); const id = `email-${randomUUID()}`;
  const row = { id, kind, ...input, status: "draft", created_at: now, updated_at: now, source: "admin_gateway" };
  await getDb().collection("admin_custom_email_drafts").insertOne(row);
  return row;
}

/** Custom/marketing mail is intentionally a white XauCloud variant; a draft
 * cannot smuggle the old dark campaign shell back into a customer send. */
export function draftDocument(row: Record<string, unknown>): EmailDocument {
  const document = EmailDocumentSchema.parse(row["document"]);
  return { ...document, theme: { ...document.theme, background: "#FFFFFF", contentBackground: "#FFFFFF" } };
}

/** Live only: never substitutes replay/sample performance for a campaign. */
export async function liveTradingPerformanceSummary(): Promise<Record<string, unknown>> {
  const rows = await getDb().collection("trade_journal").aggregate([
    { $match: { has_rich_ledger_data: true, closed_at: { $gt: 0 }, profit: { $type: "number" } } },
    { $group: { _id: null, trades: { $sum: 1 }, net_usd: { $sum: "$profit" }, wins: { $sum: { $cond: [{ $gt: ["$profit", 0] }, 1, 0] } }, losses: { $sum: { $cond: [{ $lt: ["$profit", 0] }, 1, 0] } }, gross_profit: { $sum: { $cond: [{ $gt: ["$profit", 0] }, "$profit", 0] } }, gross_loss: { $sum: { $cond: [{ $lt: ["$profit", 0] }, "$profit", 0] } }, first_closed_at: { $min: "$closed_at" }, last_closed_at: { $max: "$closed_at" } } },
  ]).toArray() as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row || !Number(row["trades"])) return { available: false, reason: "No genuine closed-trade journal data is available." };
  const grossProfit = Number(row["gross_profit"]); const grossLoss = Math.abs(Number(row["gross_loss"]));
  return { available: true, source: "live_trade_journal", trades: row["trades"], net_usd: row["net_usd"], wins: row["wins"], losses: row["losses"], profit_factor: grossLoss ? Number((grossProfit / grossLoss).toFixed(2)) : null, first_closed_at: row["first_closed_at"], last_closed_at: row["last_closed_at"], updated_at: new Date().toISOString() };
}
