import nodemailer from "nodemailer";
import { getSettings } from "./settings.js";

/**
 * Shared SMTP sender. Defaults to Gmail SMTP_SSL (the original "Google app"
 * setup, kept working untouched), but host / port / from-address are now
 * configurable from admin_settings so the same account can instead send via
 * Hostinger (smtp.hostinger.com) as e.g. support@xaucloud.io. Auth always uses
 * smtp_email / smtp_password; only the visible From address can differ (mail_from).
 */
export async function sendEmail(toEmail: string, subject: string, html: string): Promise<boolean> {
  const settings = await getSettings();
  const smtpEmail = String(settings["smtp_email"] ?? "");
  const smtpPassword = String(settings["smtp_password"] ?? "");
  if (!smtpEmail || !smtpPassword) return false;

  const host = String(settings["smtp_host"] ?? "").trim() || "smtp.gmail.com";
  const port = Number(settings["smtp_port"]) > 0 ? Number(settings["smtp_port"]) : 465;
  const secure = port === 465; // 465 = implicit TLS; 587 = STARTTLS
  const senderName = String(settings["email_sender_name"] ?? "XauCloud").trim() || "XauCloud";
  // Visible From: explicit mail_from, else support_email, else the SMTP login.
  const fromAddress = String(settings["mail_from"] ?? settings["support_email"] ?? smtpEmail).trim() || smtpEmail;
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: smtpEmail, pass: smtpPassword },
    });
    await transporter.sendMail({
      from: { name: senderName, address: fromAddress },
      // Some providers (incl. Hostinger) reject a From that differs from the
      // authenticated mailbox; keep replies flowing to the visible address.
      replyTo: fromAddress,
      to: toEmail,
      subject,
      html,
    });
    return true;
  } catch {
    return false;
  }
}
