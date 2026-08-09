import nodemailer from "nodemailer";
import { getSettings } from "./settings.js";

export interface EmailSendOptions {
  text?: string;
  replyTo?: string;
  senderName?: string;
}

export interface EmailSendResult {
  ok: boolean;
  error?: string;
}

export interface ResolvedEmailSender {
  name: string;
  address: string;
  formatted: string;
}

/** Resolves only the public sender identity; credentials never leave this service. */
export async function resolveEmailSender(senderNameOverride?: string): Promise<ResolvedEmailSender> {
  const settings = await getSettings();
  const smtpEmail = String(settings["smtp_email"] ?? "").trim();
  const address = String(settings["mail_from"] ?? settings["support_email"] ?? smtpEmail).trim() || smtpEmail;
  const configuredName = String(settings["email_sender_name"] ?? "XauCloud").trim() || "XauCloud";
  const name = senderNameOverride?.trim() || configuredName;
  return { name, address, formatted: address ? `${name} <${address}>` : name };
}

/**
 * Shared SMTP sender. Defaults to Gmail SMTP_SSL (the original "Google app"
 * setup, kept working untouched), but host / port / from-address are now
 * configurable from admin_settings so the same account can instead send via
 * Hostinger (smtp.hostinger.com) as e.g. support@xaucloud.io. Auth always uses
 * smtp_email / smtp_password; only the visible From address can differ (mail_from).
 */
export async function sendEmailDetailed(
  toEmail: string,
  subject: string,
  html: string,
  options: EmailSendOptions = {},
): Promise<EmailSendResult> {
  const settings = await getSettings();
  const smtpEmail = String(settings["smtp_email"] ?? "");
  const smtpPassword = String(settings["smtp_password"] ?? "");
  if (!smtpEmail || !smtpPassword) return { ok: false, error: "Email delivery is not configured." };

  const host = String(settings["smtp_host"] ?? "").trim() || "smtp.gmail.com";
  const port = Number(settings["smtp_port"]) > 0 ? Number(settings["smtp_port"]) : 465;
  const secure = port === 465; // 465 = implicit TLS; 587 = STARTTLS
  const sender = await resolveEmailSender(options.senderName);
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: smtpEmail, pass: smtpPassword },
    });
    await transporter.sendMail({
      from: { name: sender.name, address: sender.address },
      // Some providers (incl. Hostinger) reject a From that differs from the
      // authenticated mailbox; keep replies flowing to the visible address.
      replyTo: options.replyTo?.trim() || sender.address,
      to: toEmail,
      subject,
      html,
      text: options.text,
    });
    return { ok: true };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "SMTP_ERROR";
    // Deliberately do not return server names, credentials, or provider responses.
    return { ok: false, error: `Delivery provider rejected the message (${code}).` };
  }
}

/** Backward-compatible boolean API used by existing transactional email flows. */
export async function sendEmail(toEmail: string, subject: string, html: string, options: EmailSendOptions = {}): Promise<boolean> {
  return (await sendEmailDetailed(toEmail, subject, html, options)).ok;
}
