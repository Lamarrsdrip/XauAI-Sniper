/**
 * Wires the three existing-but-unwired transactional templates
 * (payment_failed, license_status, account_notice) plus the one real
 * password-security event the system can legitimately detect
 * (password_changed, via the existing forgot/reset-password flow).
 *
 * Same override-or-code-default pattern as paymentEmails.ts /
 * signalLifecycleEmails.ts -- no new send/log/retry infrastructure.
 */
import { emailBranding, emailLinkButton } from "./emailBranding.js";
import { sendEmail } from "./email.js";
import { publishedTransactionalRender } from "./adminOpsControl.js";

export function maskLicensePin(pin: string): string {
  return pin.length > 4 ? `${pin.slice(0, 2)}${"*".repeat(pin.length - 4)}${pin.slice(-2)}` : pin;
}

async function renderOrDefault(templateId: string, toEmail: string, vars: Record<string, string>, subject: string, html: string): Promise<boolean> {
  const override = await publishedTransactionalRender(templateId, vars);
  if (override) return sendEmail(toEmail, String(override["subject"]), String(override["html"]), { text: String(override["text"] ?? "") });
  return sendEmail(toEmail, subject, html);
}

/** Port target: purchase.ts's Nomba webhook payment_failed branch. */
export async function sendPaymentFailedEmail(toEmail: string, buyerName: string, reference: string, reason = ""): Promise<boolean> {
  const b = await emailBranding();
  return renderOrDefault(
    "payment_failed",
    toEmail,
    { buyer_name: buyerName, first_name: buyerName, buyer_email: toEmail, account_email: toEmail, reference, reason },
    `Your ${b.sender_name} payment could not be completed`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
<h2 style="color:#B8860B;">Your payment could not be completed</h2>
<p>Hello ${buyerName || "Trader"},</p>
<p>We were unable to process your payment (reference <strong>${reference}</strong>).</p>
${reason ? `<p style="color:#555;">Reason: ${reason}</p>` : ""}
<p style="font-size:13px;color:#333;">No charge was completed. You can try again, or use a different payment method.</p>
<div style="text-align:center;margin:20px 0;">${emailLinkButton("Try Again", b.command_center_url, true)}</div>
<p style="font-size:12px;color:#6E6E73;">Need help? Contact support and reference ${reference}.</p>
</div>`,
  );
}

export type LicenseStatusChange = "activated" | "deactivated" | "transferred" | "activation_reset";

const LICENSE_STATUS_COPY: Record<LicenseStatusChange, { verb: string; detail: string }> = {
  activated: { verb: "activated", detail: "Your XauCloud license is active again." },
  deactivated: { verb: "deactivated", detail: "Your XauCloud license has been deactivated and can no longer be used to trade." },
  transferred: { verb: "transferred", detail: "Your XauCloud license has been transferred to a new account." },
  activation_reset: { verb: "reset", detail: "Your XauCloud license activation has been reset -- you can now attach it to a new MT5 account." },
};

/** Port targets: admin/pins.ts (revoke/activate/reset-account) and the equivalent gateway license actions. */
export async function sendLicenseStatusEmail(toEmail: string, buyerName: string, change: LicenseStatusChange, pinMasked: string): Promise<boolean> {
  const b = await emailBranding();
  const copy = LICENSE_STATUS_COPY[change];
  return renderOrDefault(
    "license_status",
    toEmail,
    { buyer_name: buyerName, first_name: buyerName, buyer_email: toEmail, account_email: toEmail, status_change: copy.verb, license_pin_masked: pinMasked },
    `Your ${b.sender_name} license was ${copy.verb}`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
<h2 style="color:#B8860B;">License ${copy.verb}</h2>
<p>Hello ${buyerName || "Trader"},</p>
<p>${copy.detail}</p>
<p style="font-size:13px;color:#555;">License: ${pinMasked}</p>
<div style="text-align:center;margin:20px 0;">${emailLinkButton("Open Command Center", b.command_center_url, true)}</div>
<p style="font-size:12px;color:#6E6E73;">If you didn't expect this change, contact support immediately.</p>
</div>`,
  );
}

/** Admin-triggered only -- there is no single deterministic "account notice" system event, by design (see spec: "not a generic catch-all"). */
export async function sendAccountNoticeEmail(toEmail: string, buyerName: string, noticeSubject: string, message: string): Promise<boolean> {
  const b = await emailBranding();
  return renderOrDefault(
    "account_notice",
    toEmail,
    { buyer_name: buyerName, first_name: buyerName, buyer_email: toEmail, account_email: toEmail, notice_subject: noticeSubject, message },
    noticeSubject || `Important notice about your ${b.sender_name} account`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
<h2 style="color:#B8860B;">${noticeSubject || "Important account notice"}</h2>
<p>Hello ${buyerName || "Trader"},</p>
<p style="white-space:pre-line;">${message}</p>
<div style="text-align:center;margin:20px 0;">${emailLinkButton("Open Command Center", b.command_center_url, true)}</div>
<p style="font-size:12px;color:#6E6E73;">Questions? Contact support.</p>
</div>`,
  );
}

/**
 * Port target: cloud/auth.ts POST /cloud/auth/reset-password, right after a
 * successful reset. This is the only password-change path that genuinely
 * exists in this system today (there is no separate "change password while
 * logged in" endpoint) -- do not fabricate a second event for it.
 *
 * New-device/unusual-login alerts are intentionally NOT implemented: the
 * system has no device fingerprinting, IP-geolocation, or session-history
 * signal to legitimately base that on (per the spec's own instruction not to
 * invent one). session_version is a real signal ("all prior sessions were
 * just revoked"), and this email covers that too -- the reset IS the
 * revocation.
 */
export async function sendPasswordChangedEmail(toEmail: string, buyerName: string): Promise<boolean> {
  const b = await emailBranding();
  const when = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return renderOrDefault(
    "password_changed",
    toEmail,
    { buyer_name: buyerName, first_name: buyerName, buyer_email: toEmail, account_email: toEmail, changed_at: when },
    `Your ${b.sender_name} password was changed`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
<h2 style="color:#B8860B;">Your password was changed</h2>
<p>Hello ${buyerName || "Trader"},</p>
<p>Your ${b.sender_name} account password was changed on ${when}. All other sessions have been signed out.</p>
<p style="font-size:13px;color:#333;">If this was you, no action is needed.</p>
<p style="font-size:13px;color:#B8860B;font-weight:bold;">If this wasn't you, contact support immediately.</p>
</div>`,
  );
}
