import { getDb } from "../db.js";
import { env } from "../env.js";
import { sendEmail } from "./email.js";
import { adminNotifyRow, emailBranding, emailLinkButton, emailStep, notifyAdmin, TELEGRAM_SUPPORT_URL } from "./emailBranding.js";
import { currentEaRelease } from "./releaseManifest.js";

/** Port of server.py:803 `send_pin_email` -- fulfillment/onboarding email. */
export async function sendPinEmail(toEmail: string, buyerName: string, pin: string): Promise<boolean> {
  const b = await emailBranding();
  const release = await currentEaRelease();
  const versionText = release ? release.version : "your Command Center dashboard";
  const filenameText = release ? String(release["customer_filename"] ?? "XauCloud.io.ex5") : "XauCloud.io.ex5";
  const supportLine = b.support_email
    ? `<a href="mailto:${b.support_email}" style="color:#D4AF37;text-decoration:none;">${b.support_email}</a>`
    : "your Command Center Support button";

  const steps = [
    emailStep(1, "Download MetaTrader 5", `If you don't already have it installed, grab the free official app. <a href="${b.mt5_download_url}" style="color:#D4AF37;">Download MT5 &rarr;</a>`),
    emailStep(2, "Connect or purchase a VPS (optional)", "A VPS keeps MetaTrader 5 running 24/7 so XauCloud can trade around the clock, even when your computer is off."),
    emailStep(3, "Download XauCloud.io", `Sign in to Command Center to get the current verified build (${versionText}), delivered as <strong>${filenameText}</strong>.`),
    emailStep(4, "Copy the EA into your Experts folder", "In MetaTrader 5: File &rarr; Open Data Folder &rarr; MQL5 &rarr; Experts. Paste the downloaded file there."),
    emailStep(5, "Restart MetaTrader 5", "So it picks up the new Expert Advisor."),
    emailStep(6, "Open an XAUUSD chart", "Attach XauCloud to the chart from the Navigator panel."),
    emailStep(7, "Enter your License PIN", "Paste the PIN above into the EA's settings."),
    emailStep(8, "Enable Algo Trading", "Click ✅ Allow Algo Trading in the MT5 toolbar so the EA can place trades."),
    emailStep(9, "Open your Command Center", "This is where you monitor XauCloud live -- signals, positions, and history."),
    emailStep(10, "Turn on Signal Notifications", "In Command Center, open Notifications and enable alerts so you never miss a signal."),
  ].join("");

  const links = [
    emailLinkButton("Download Latest XauCloud", b.command_center_url, true),
    emailLinkButton("Open Command Center", b.command_center_url),
    emailLinkButton("Download MT5", b.mt5_download_url),
    emailLinkButton("Installation Guide", b.installation_guide_url),
    emailLinkButton("Contact Support", b.support_email ? `mailto:${b.support_email}` : TELEGRAM_SUPPORT_URL),
    b.community_link ? emailLinkButton("Join Community", b.community_link) : "",
  ].join("");

  const html = `<div style="background:#0A0A0A;padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
<tr><td style="text-align:center;padding-bottom:22px;">
<div style="color:#D4AF37;font-family:Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:0.5px;">${b.sender_name}</div>
</td></tr>
<tr><td style="background:#131313;border:1px solid #2A2A2A;border-radius:20px;padding:28px 24px;">
<div style="color:#F5F0E1;font-family:Arial,sans-serif;font-size:22px;font-weight:800;text-align:center;margin-bottom:6px;">Payment Confirmed</div>
<div style="color:#A8A29E;font-family:Arial,sans-serif;font-size:14px;text-align:center;margin-bottom:22px;">Welcome${buyerName ? `, ${buyerName}` : ""} -- your license is ready.</div>

<div style="background:#0A0A0A;border:1.5px solid #D4AF37;border-radius:14px;padding:18px;text-align:center;margin-bottom:24px;">
<div style="color:#A8A29E;font-family:Arial,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Your License PIN</div>
<div style="color:#F5F0E1;font-family:'Courier New',monospace;font-size:26px;font-weight:800;letter-spacing:2px;">${pin}</div>
</div>

<div style="color:#D4AF37;font-family:Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">Getting Started</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>

<div style="height:1px;background:#2A2A2A;margin:8px 0 20px 0;"></div>
<div style="color:#D4AF37;font-family:Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">Helpful Links</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${links}</table>

<div style="color:#6E6E73;font-family:Arial,sans-serif;font-size:12px;line-height:18px;margin-top:20px;">
Need help? Email ${supportLine} and we'll walk you through it.
</div>
</td></tr>
<tr><td style="padding:20px 8px 0 8px;text-align:center;">
<div style="color:#5A5A5E;font-family:Arial,sans-serif;font-size:11px;line-height:17px;">
Keep this PIN private -- it works on one MT5 account. Trading involves risk; past results do not guarantee future performance.
</div>
</td></tr>
</table>
</div>`;
  return sendEmail(toEmail, `Your ${b.sender_name} License PIN`, html);
}

/** Port of server.py:898 `notify_admin_payment_started`. */
export async function notifyAdminPaymentStarted(channel: string, reference: string, buyerName: string, buyerEmail: string, amountFormatted: string, plan = ""): Promise<boolean> {
  const now = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;">
<h3 style="color:#B8860B;margin-bottom:12px;">Payment Started</h3>
${adminNotifyRow("Customer Name", buyerName || "-")}
${adminNotifyRow("Customer Email", buyerEmail || "-")}
${adminNotifyRow("Plan", plan || "XauCloud EA License")}
${adminNotifyRow("Amount", amountFormatted)}
${adminNotifyRow("Payment Method", channel)}
${adminNotifyRow("Date &amp; Time", now)}
${adminNotifyRow("Status", "Payment Started")}
${adminNotifyRow("Reference", reference)}
</div>`;
  return notifyAdmin(`Payment Started — ${reference}`, html, sendEmail);
}

/** Port of server.py:920 `notify_admin_new_sale`. */
export async function notifyAdminNewSale(
  reference: string,
  buyerName: string,
  buyerEmail: string,
  amountFormatted: string,
  pin: string,
  gateway: string,
  plan = "",
  transactionId = "",
): Promise<boolean> {
  const now = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;">
<h3 style="color:#1a7f37;margin-bottom:12px;">✅ New XauCloud Sale</h3>
${adminNotifyRow("Customer Name", buyerName || "-")}
${adminNotifyRow("Customer Email", buyerEmail || "-")}
${adminNotifyRow("Amount", amountFormatted)}
${adminNotifyRow("Plan Purchased", plan || "XauCloud EA License")}
${adminNotifyRow("License PIN Generated", pin)}
${adminNotifyRow("Transaction ID", transactionId || reference)}
${adminNotifyRow("Payment Gateway", gateway)}
${adminNotifyRow("Date &amp; Time", now)}
</div>`;
  return notifyAdmin(`✅ New XauCloud Sale — ${reference}`, html, sendEmail);
}

export interface BankTransferOrder {
  amount_formatted: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  reference: string;
  expires_at: string;
}

/** Port of server.py:939 `send_bank_transfer_instructions_email`. */
export async function sendBankTransferInstructionsEmail(toEmail: string, buyerName: string, order: BankTransferOrder): Promise<boolean> {
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#B8860B;">XauCloud - Bank Transfer Instructions</h2>
<p>Hello ${buyerName || "Trader"},</p>
<p>Please transfer the exact amount below to complete your XauCloud purchase:</p>
<div style="background:#f5f5f5;border:2px solid #B8860B;padding:16px;margin:16px 0;font-size:14px;">
<p style="margin:4px 0;"><strong>Amount:</strong> ${order.amount_formatted}</p>
<p style="margin:4px 0;"><strong>Bank:</strong> ${order.bank_name}</p>
<p style="margin:4px 0;"><strong>Account name:</strong> ${order.account_name}</p>
<p style="margin:4px 0;"><strong>Account number:</strong> ${order.account_number}</p>
<p style="margin:4px 0;"><strong>Reference:</strong> ${order.reference}</p>
</div>
<p style="font-size:13px;color:#333;">This order expires at ${order.expires_at}. Once you've transferred, return to the site and click "I have made the transfer," then wait for admin approval -- you'll receive your license PIN by email once approved.</p>
<div style="text-align:center;margin:20px 0;">
<a href="${TELEGRAM_SUPPORT_URL}" style="display:inline-block;background:#229ED9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold;font-size:13px;">Message XauCloud Support on Telegram</a>
</div>
</div>`;
  return sendEmail(toEmail, `XauCloud Bank Transfer Instructions — ${order.reference}`, html);
}

/** Port of server.py:963 `send_bank_transfer_rejected_email`. */
export async function sendBankTransferRejectedEmail(toEmail: string, buyerName: string, reference: string, reason: string): Promise<boolean> {
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#B8860B;">XauCloud - Bank Transfer Not Approved</h2>
<p>Hello ${buyerName || "Trader"},</p>
<p>Your bank transfer order <strong>${reference}</strong> could not be approved.</p>
${reason ? `<p style="color:#555;">Reason: ${reason}</p>` : ""}
<p style="font-size:13px;">If you believe this is a mistake, please contact support with your reference number.</p>
<div style="text-align:center;margin:20px 0;">
<a href="${TELEGRAM_SUPPORT_URL}" style="display:inline-block;background:#229ED9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold;font-size:13px;">Message XauCloud Support on Telegram</a>
</div>
</div>`;
  return sendEmail(toEmail, `XauCloud Bank Transfer Not Approved — ${reference}`, html);
}

/** Port of server.py:976 `notify_admin_bank_transfer_submitted`. */
export async function notifyAdminBankTransferSubmitted(tx: Record<string, unknown>): Promise<boolean> {
  const naira = Number(tx["amount_kobo"] ?? 0) / 100;
  const adminUrl = `${env.PUBLIC_SITE_URL}/admin`;
  const html = `<div style="font-family:Arial,sans-serif;">
<h3>Bank transfer marked as paid — needs review</h3>
<p>Reference: ${tx["reference"]}<br>Buyer: ${tx["buyer_name"]} &lt;${tx["buyer_email"]}&gt;<br>Amount: ₦${naira.toLocaleString("en-US")}</p>
<p><a href="${adminUrl}">Review in Admin Dashboard</a></p>
</div>`;
  return notifyAdmin(`Bank transfer submitted — ${tx["reference"]}`, html, sendEmail);
}

/** Port of server.py:986 `_record_fulfillment_email_result` -- a failed send must never be silently lost. */
export async function recordFulfillmentEmailResult(reference: string, buyerName: string, buyerEmail: string, pin: string, emailSent: boolean): Promise<void> {
  if (emailSent) return;
  await getDb()
    .collection("payment_transactions")
    .updateOne({ reference }, { $set: { fulfillment_email_failed: true, fulfillment_email_failed_at: new Date().toISOString() } });
  const adminUrl = `${env.PUBLIC_SITE_URL}/admin`;
  const html = `<div style="font-family:Arial,sans-serif;">
<h3>Fulfillment email failed to send</h3>
<p>Reference: ${reference}<br>Buyer: ${buyerName} &lt;${buyerEmail}&gt;<br>PIN: ${pin}</p>
<p>The order is fulfilled and the license exists, but the customer may not have received it. Please resend manually or check SMTP configuration.</p>
<p><a href="${adminUrl}">Review in Admin Dashboard</a></p>
</div>`;
  await notifyAdmin(`Fulfillment email FAILED — ${reference}`, html, sendEmail);
}
