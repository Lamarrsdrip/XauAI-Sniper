import { env } from "../env.js";
import { getSettings } from "./settings.js";

export const TELEGRAM_SUPPORT_URL = "https://t.me/emrizeth";

export interface EmailBranding {
  sender_name: string;
  admin_notification_email: string;
  support_email: string;
  support_phone: string;
  community_link: string;
  mt5_download_url: string;
  vps_guide_url: string;
  installation_guide_url: string;
  command_center_url: string;
}

/** Port of server.py:655 `_email_branding`. */
export async function emailBranding(): Promise<EmailBranding> {
  const s = await getSettings();
  const defaultCommandCenter = `${env.PUBLIC_SITE_URL}/command`;
  return {
    sender_name: String(s["email_sender_name"] ?? "XauCloud").trim() || "XauCloud",
    admin_notification_email: String(s["admin_notification_email"] ?? "").trim(),
    support_email: String(s["support_email"] ?? s["smtp_email"] ?? "").trim(),
    support_phone: String(s["support_phone"] ?? "").trim(),
    community_link: String(s["community_link"] ?? "").trim(),
    mt5_download_url: String(s["mt5_download_url"] ?? "https://www.metatrader5.com/en/download").trim(),
    vps_guide_url: String(s["vps_guide_url"] ?? defaultCommandCenter).trim(),
    installation_guide_url: String(s["installation_guide_url"] ?? defaultCommandCenter).trim(),
    command_center_url: String(s["command_center_url"] ?? defaultCommandCenter).trim(),
  };
}

/** Port of server.py:880 `_notify_admin`. */
export async function notifyAdmin(subject: string, html: string, sendEmailFn: (to: string, subject: string, html: string) => Promise<boolean>): Promise<boolean> {
  const to = (await emailBranding()).admin_notification_email;
  if (!to) return false;
  return sendEmailFn(to, subject, html);
}

function adminNotifyRow(label: string, value: string): string {
  return `<p style="margin:4px 0;font-family:Arial,sans-serif;font-size:13px;"><strong>${label}:</strong> ${value}</p>`;
}

function emailStep(n: number, title: string, bodyHtml: string): string {
  return `<tr><td style="padding:0 0 18px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="36" valign="top" style="padding-right:12px;">
<div style="width:28px;height:28px;border-radius:50%;background:#D4AF37;color:#0A0A0A;font-weight:800;font-size:13px;line-height:28px;text-align:center;font-family:Arial,sans-serif;">${n}</div>
</td>
<td valign="top">
<div style="color:#F5F0E1;font-weight:700;font-size:14px;font-family:Arial,sans-serif;margin-bottom:3px;">${title}</div>
<div style="color:#A8A29E;font-size:13px;line-height:19px;font-family:Arial,sans-serif;">${bodyHtml}</div>
</td>
</tr></table>
</td></tr>`;
}

function emailLinkButton(label: string, url: string, primary = false): string {
  if (!url) return "";
  const bg = primary ? "#D4AF37" : "#1C1C1E";
  const fg = primary ? "#0A0A0A" : "#F5F0E1";
  const border = primary ? "" : "border:1px solid #3A3A3C;";
  return `<tr><td style="padding-bottom:10px;">
<a href="${url}" style="display:block;${border}background:${bg};color:${fg};text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:700;font-size:14px;font-family:Arial,sans-serif;text-align:center;">${label}</a>
</td></tr>`;
}

export { adminNotifyRow, emailStep, emailLinkButton };
