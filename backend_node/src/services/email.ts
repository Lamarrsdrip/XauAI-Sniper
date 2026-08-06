import nodemailer from "nodemailer";
import { getSettings } from "./settings.js";

/** Port of server.py:746 `_send_email` -- shared Gmail SMTP_SSL sender. */
export async function sendEmail(toEmail: string, subject: string, html: string): Promise<boolean> {
  const settings = await getSettings();
  const smtpEmail = String(settings["smtp_email"] ?? "");
  const smtpPassword = String(settings["smtp_password"] ?? "");
  if (!smtpEmail || !smtpPassword) return false;

  const senderName = String(settings["email_sender_name"] ?? "XauCloud").trim() || "XauCloud";
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: smtpEmail, pass: smtpPassword },
    });
    await transporter.sendMail({
      from: { name: senderName, address: smtpEmail },
      to: toEmail,
      subject,
      html,
    });
    return true;
  } catch {
    return false;
  }
}
