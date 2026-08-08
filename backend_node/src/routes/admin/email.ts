import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin } from "../../auth.js";
import { sendEmail } from "../../services/email.js";
import { emailBranding } from "../../services/emailBranding.js";

// Admin email console: compose + send a message to a single address or
// broadcast it to every registered customer (cloud_users). Sending always
// goes through the shared SMTP sender (services/email), so it honours whatever
// provider the admin configured (Gmail or Hostinger support@xaucloud.io).
// A broadcast requires an explicit confirm flag; every send is logged.

const BROADCAST_CAP = 5000; // safety ceiling for a single broadcast

const SendSchema = z.object({
  mode: z.enum(["single", "broadcast"]),
  to: z.string().nullable().optional(),
  subject: z.string().min(1).max(300),
  body_html: z.string().min(1).max(200_000),
  preview_text: z.string().max(300).nullable().optional(),
  confirm: z.boolean().nullable().optional(),
});

const TestSchema = z.object({
  subject: z.string().min(1).max(300),
  body_html: z.string().min(1).max(200_000),
  preview_text: z.string().max(300).nullable().optional(),
  to: z.string().nullable().optional(),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Wrap the admin's raw body in a minimal branded, mobile-safe shell. */
function renderEmail(bodyHtml: string, senderName: string, previewText: string): string {
  // If the body has no block-level tags, treat single newlines as line breaks
  // so a plain-text paste still reads correctly.
  const looksLikeHtml = /<(p|div|br|ul|ol|h[1-6]|table|a|img|strong|em|blockquote)\b/i.test(bodyHtml);
  const inner = looksLikeHtml ? bodyHtml : bodyHtml.replace(/\r?\n/g, "<br>");
  const preheader = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${previewText}</div>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#0A0A0C;padding:24px 0;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#101014;border-radius:16px;overflow:hidden;">
<tr><td style="padding:22px 26px;border-bottom:1px solid #23232A;">
<span style="font-family:Arial,sans-serif;font-size:16px;font-weight:800;color:#F5C452;letter-spacing:.3px;">${senderName}</span>
</td></tr>
<tr><td style="padding:26px;color:#E7E4DC;font-family:Arial,sans-serif;font-size:15px;line-height:23px;">
${inner}
</td></tr>
<tr><td style="padding:18px 26px;border-top:1px solid #23232A;color:#8A8A93;font-family:Arial,sans-serif;font-size:11px;line-height:17px;">
You're receiving this because you have a ${senderName} account. This message was sent by the ${senderName} team.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

async function broadcastRecipients(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .collection("cloud_users")
    .find({ email: { $exists: true, $ne: "" } }, { projection: { _id: 0, email: 1 } })
    .toArray();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const e = String(r["email"] ?? "").trim().toLowerCase();
    if (e && EMAIL_RE.test(e) && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

export async function registerAdminEmailRoutes(app: FastifyInstance): Promise<void> {
  // How many people a broadcast would reach.
  app.get("/admin/email/audience", { preHandler: requireAdmin }, async () => {
    const recipients = await broadcastRecipients();
    return { total: recipients.length, cap: BROADCAST_CAP };
  });

  // Send a test copy to the admin (or an explicit address) — never customers.
  app.post("/admin/email/test", { preHandler: requireAdmin }, async (request, reply) => {
    const req = TestSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const branding = await emailBranding();
    const to = String(req.to ?? admin["email"] ?? branding.admin_notification_email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return reply.code(400).send({ detail: "No valid test recipient (set an admin email first)." });
    const html = renderEmail(req.body_html, branding.sender_name, req.preview_text ?? "");
    const ok = await sendEmail(to, `[TEST] ${req.subject}`, html);
    if (!ok) return reply.code(502).send({ detail: "Send failed — check SMTP settings (host/port/login/password)." });
    return { sent: true, to };
  });

  // Send for real: one recipient, or a confirmed broadcast to all customers.
  app.post("/admin/email/send", { preHandler: requireAdmin }, async (request, reply) => {
    const req = SendSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const branding = await emailBranding();
    const html = renderEmail(req.body_html, branding.sender_name, req.preview_text ?? "");

    let recipients: string[];
    if (req.mode === "single") {
      const to = String(req.to ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(to)) return reply.code(400).send({ detail: "Enter a valid recipient email." });
      recipients = [to];
    } else {
      if (req.confirm !== true) return reply.code(400).send({ detail: "Broadcast requires explicit confirmation." });
      recipients = await broadcastRecipients();
      if (recipients.length === 0) return reply.code(400).send({ detail: "No customers with a valid email to send to." });
      if (recipients.length > BROADCAST_CAP) recipients = recipients.slice(0, BROADCAST_CAP);
    }

    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      // eslint-disable-next-line no-await-in-loop -- intentionally sequential to stay gentle on the SMTP provider
      const ok = await sendEmail(to, req.subject, html);
      if (ok) sent += 1;
      else failed += 1;
    }

    const record = {
      at: new Date().toISOString(),
      admin_email: String(admin["email"] ?? ""),
      mode: req.mode,
      subject: req.subject,
      recipients: recipients.length,
      sent,
      failed,
    };
    try {
      await getDb().collection("admin_email_log").insertOne({ ...record });
    } catch {
      /* logging must never fail the send result */
    }

    if (sent === 0) return reply.code(502).send({ detail: "No emails were sent — check SMTP settings.", ...record });
    return record;
  });

  // Recent send history for the console.
  app.get("/admin/email/log", { preHandler: requireAdmin }, async () => {
    const rows = await getDb()
      .collection("admin_email_log")
      .find({}, { projection: { _id: 0 } })
      .sort({ at: -1 })
      .limit(20)
      .toArray();
    return { entries: rows };
  });
}
