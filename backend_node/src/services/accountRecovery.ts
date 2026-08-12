import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { publishedTransactionalRender, renderTransactional } from "./adminOpsControl.js";
import { sendEmailDetailed } from "./email.js";
import { BUILT_IN_EMAIL_TEMPLATES, type EmailDocument } from "./emailCampaign.js";

type Row = Record<string, unknown>;
const JWT_ALGORITHM = "HS256" as const;
type TransactionalTemplateId = "welcome" | "account_verification" | "password_reset";

const verificationDocument: EmailDocument = {
  version: 1,
  theme: { width: 640, background: "#FFFFFF", contentBackground: "#FFFFFF", accent: "#D6B35A", radius: 10, spacing: "normal" },
  blocks: [
    { id: "verify-hero", type: "hero", badge: "Account verification", title: "Verify your XauCloud email", subtitle: "Confirm your account securely to keep your Command Center details protected." },
    { id: "verify-copy", type: "text", html: "<p>Hi {{first_name}},</p><p>Please verify the email address connected to your XauCloud account.</p>" },
    { id: "verify-cta", type: "button", text: "VERIFY EMAIL", url: "{{verify_url}}", style: "gold" },
    { id: "verify-note", type: "callout", title: "Secure link", text: "This verification link expires in 24 hours and can be used once.", tone: "gold" },
  ],
};

const passwordResetDocument: EmailDocument = {
  version: 1,
  theme: { width: 640, background: "#FFFFFF", contentBackground: "#FFFFFF", accent: "#D6B35A", radius: 10, spacing: "normal" },
  blocks: [
    { id: "reset-hero", type: "hero", badge: "Password reset", title: "Reset your XauCloud password", subtitle: "Use the secure link below to choose a new password." },
    { id: "reset-copy", type: "text", html: "<p>Hi {{first_name}},</p><p>If you requested a password reset, continue below. If not, you can safely ignore this email.</p>" },
    { id: "reset-cta", type: "button", text: "RESET PASSWORD", url: "{{reset_url}}", style: "gold" },
    { id: "reset-note", type: "callout", title: "Secure link", text: "This reset link expires in 30 minutes and can be used once.", tone: "gold" },
  ],
};

function defaultDocument(templateId: TransactionalTemplateId): EmailDocument {
  if (templateId === "welcome") {
    const welcome = BUILT_IN_EMAIL_TEMPLATES.find((template) => template.id === "welcome");
    if (welcome) return welcome.document;
  }
  return templateId === "account_verification" ? verificationDocument : passwordResetDocument;
}

function safeUser(user: Row): { id: string; email: string; name: string } {
  return {
    id: String(user["id"] ?? ""),
    email: String(user["email"] ?? "").toLowerCase().trim(),
    name: String(user["full_name"] ?? user["name"] ?? "").trim(),
  };
}

async function logDelivery(input: {
  template_id: string;
  user_id: string;
  email: string;
  source: string;
  ok: boolean;
  error?: string;
  event_key?: string;
}): Promise<string> {
  const id = `tx-${randomUUID()}`;
  await getDb().collection("admin_email_log").insertOne({
    id,
    delivery_id: id,
    template_id: input.template_id,
    template_version: "published_or_code_default",
    canonical_recipient: input.email,
    related_user_id: input.user_id,
    context_ref: { kind: input.template_id, user_id: input.user_id },
    original_event_id: `event-${randomUUID()}`,
    ...(input.event_key ? { event_key: input.event_key } : {}),
    status: input.ok ? "sent" : "failed",
    failed: input.ok ? 0 : 1,
    provider_response_summary: input.error ? String(input.error).slice(0, 240) : "accepted",
    canonical_retryable: true,
    source: input.source,
    created_at: new Date().toISOString(),
    at: new Date().toISOString(),
  });
  return id;
}

async function claimOneTimeDelivery(eventKey: string, templateId: TransactionalTemplateId, user: { id: string; email: string }): Promise<boolean> {
  try {
    await getDb().collection("transactional_email_events").insertOne({
      id: `tx-event-${randomUUID()}`,
      event_key: eventKey,
      template_id: templateId,
      user_id: user.id,
      canonical_recipient: user.email,
      status: "claimed",
      created_at: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    if (Number((error as { code?: unknown })?.code) === 11000) return false;
    throw error;
  }
}

async function completeOneTimeDelivery(eventKey: string, accepted: boolean): Promise<void> {
  await getDb().collection("transactional_email_events").updateOne(
    { event_key: eventKey },
    { $set: { status: accepted ? "sent" : "failed", completed_at: new Date().toISOString() } },
  );
}

function emailVerificationToken(userId: string, jti: string): string {
  return jwt.sign({ sub: userId, type: "email_verification", jti }, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: "24h",
  });
}

export function passwordResetToken(userId: string, jti: string): string {
  return jwt.sign({ sub: userId, type: "password_reset", jti }, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: "30m",
  });
}

async function renderOrFallback(
  templateId: TransactionalTemplateId,
  context: Record<string, string>,
  fallbackSubject: string,
  fallbackHtml: string,
  fallbackText: string,
): Promise<{ subject: string; html: string; text: string }> {
  const rendered = await publishedTransactionalRender(templateId, context);
  if (rendered) {
    return {
      subject: String(rendered["subject"] ?? fallbackSubject),
      html: String(rendered["html"] ?? fallbackHtml),
      text: String(rendered["text"] ?? fallbackText),
    };
  }
  const premiumRendered = await renderTransactional(defaultDocument(templateId), fallbackSubject, fallbackText, context);
  return {
    subject: fallbackSubject,
    html: String(premiumRendered["html"] ?? fallbackHtml),
    text: String(premiumRendered["text"] ?? fallbackText),
  };
}

export async function sendWelcomeEmailForUser(user: Row, source = "account_signup", eventKey?: string): Promise<Row> {
  const u = safeUser(user);
  if (!u.id || !u.email) throw Object.assign(new Error("User does not have a canonical account email."), { statusCode: 409 });
  if (eventKey && !await claimOneTimeDelivery(eventKey, "welcome", u)) return { accepted: true, duplicate: true, template_id: "welcome" };
  const ctx = { first_name: u.name || "Trader", account_email: u.email };
  const content = await renderOrFallback(
    "welcome",
    ctx,
    "Welcome to XauCloud",
    `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222"><h2>Welcome to XauCloud</h2><p>Hi ${u.name || "Trader"},</p><p>Your XauCloud Command Center account is ready.</p></div>`,
    `Welcome to XauCloud. Your Command Center account is ready.`,
  );
  const sent = await sendEmailDetailed(u.email, content.subject, content.html, { text: content.text });
  const deliveryId = await logDelivery({ template_id: "welcome", user_id: u.id, email: u.email, source, ok: sent.ok, error: sent.error, event_key: eventKey });
  if (eventKey) await completeOneTimeDelivery(eventKey, sent.ok);
  return { accepted: sent.ok, delivery_id: deliveryId, template_id: "welcome" };
}

export async function sendVerificationEmailForUser(user: Row, source = "account_verification", eventKey?: string): Promise<Row> {
  const u = safeUser(user);
  if (!u.id || !u.email) throw Object.assign(new Error("User does not have a canonical account email."), { statusCode: 409 });
  if (Boolean(user["email_verified"] ?? user["verified"])) return { accepted: true, already_verified: true, template_id: "account_verification" };
  if (eventKey && !await claimOneTimeDelivery(eventKey, "account_verification", u)) return { accepted: true, duplicate: true, template_id: "account_verification" };

  const jti = randomUUID();
  const token = emailVerificationToken(u.id, jti);
  const verifyUrl = `${env.PUBLIC_SITE_URL}/api/cloud/auth/verify-email?token=${encodeURIComponent(token)}`;
  const ctx = { first_name: u.name || "Trader", account_email: u.email, verify_url: verifyUrl };
  const content = await renderOrFallback(
    "account_verification",
    ctx,
    "Verify your XauCloud email",
    `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222"><h2>Verify your email</h2><p>Hi ${u.name || "Trader"},</p><p><a href="${verifyUrl}">Verify your XauCloud email</a></p><p>This link expires in 24 hours.</p></div>`,
    `Verify your XauCloud email: ${verifyUrl}`,
  );
  const sent = await sendEmailDetailed(u.email, content.subject, content.html, { text: content.text });
  const deliveryId = await logDelivery({ template_id: "account_verification", user_id: u.id, email: u.email, source, ok: sent.ok, error: sent.error, event_key: eventKey });
  if (eventKey) await completeOneTimeDelivery(eventKey, sent.ok);
  return { accepted: sent.ok, delivery_id: deliveryId, template_id: "account_verification" };
}

export async function sendPasswordResetEmailForUser(user: Row, source = "password_reset"): Promise<Row> {
  const u = safeUser(user);
  if (!u.id || !u.email) throw Object.assign(new Error("User does not have a canonical account email."), { statusCode: 409 });

  const jti = randomUUID();
  const token = passwordResetToken(u.id, jti);
  const resetUrl = `${env.PUBLIC_SITE_URL}/command/reset-password?token=${encodeURIComponent(token)}`;
  const ctx = { first_name: u.name || "Trader", account_email: u.email, reset_url: resetUrl };
  const content = await renderOrFallback(
    "password_reset",
    ctx,
    "Reset your XauCloud password",
    `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222"><h2>Reset your XauCloud password</h2><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 30 minutes and can only be used once.</p></div>`,
    `Reset your XauCloud password: ${resetUrl}`,
  );
  const sent = await sendEmailDetailed(u.email, content.subject, content.html, { text: content.text });
  const deliveryId = await logDelivery({ template_id: "password_reset", user_id: u.id, email: u.email, source, ok: sent.ok, error: sent.error });
  return { accepted: sent.ok, delivery_id: deliveryId, template_id: "password_reset" };
}

/** The signup route calls this once, after the account insert has succeeded. */
export async function sendSignupTransactionalEmails(user: Row): Promise<Row[]> {
  const u = safeUser(user);
  if (!u.id) return [];
  return Promise.all([
    sendWelcomeEmailForUser(user, "account_signup", `account_created:${u.id}:welcome`),
    sendVerificationEmailForUser(user, "account_signup", `account_created:${u.id}:account_verification`),
  ]);
}

export async function verifyEmailToken(token: string): Promise<Row> {
  let payload: { sub: string; type: string; jti: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as typeof payload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw Object.assign(new Error("Verification link has expired."), { statusCode: 400 });
    throw Object.assign(new Error("Invalid verification link."), { statusCode: 400 });
  }
  if (payload.type !== "email_verification") throw Object.assign(new Error("Invalid verification link."), { statusCode: 400 });

  const db = getDb();
  try {
    await db.collection("used_email_verification_tokens").insertOne({ jti: payload.jti, used_at: new Date() });
  } catch {
    throw Object.assign(new Error("This verification link has already been used."), { statusCode: 409 });
  }

  const result = await db.collection("cloud_users").updateOne(
    { id: payload.sub },
    { $set: { email_verified: true, email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() } },
  );
  if (!result.matchedCount) throw Object.assign(new Error("Account no longer exists."), { statusCode: 404 });
  return { ok: true, verified: true };
}

/** Validates and atomically burns a reset token without ever logging it. */
export async function consumePasswordResetToken(token: string): Promise<string> {
  let payload: { sub: string; type: string; jti: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as typeof payload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw Object.assign(new Error("Reset link has expired. Request a new one."), { statusCode: 400 });
    throw Object.assign(new Error("Invalid reset link."), { statusCode: 400 });
  }
  if (payload.type !== "password_reset") throw Object.assign(new Error("Invalid reset link."), { statusCode: 400 });
  try {
    await getDb().collection("used_password_reset_tokens").insertOne({ jti: payload.jti, used_at: new Date() });
  } catch {
    throw Object.assign(new Error("This reset link has already been used."), { statusCode: 400 });
  }
  return payload.sub;
}

export async function retryCanonicalTransactionalDelivery(deliveryId: string): Promise<Row> {
  const row = await getDb().collection("admin_email_log").findOne(
    { $or: [{ id: deliveryId }, { delivery_id: deliveryId }] },
    { projection: { _id: 0 } },
  ) as Row | null;
  if (!row) throw Object.assign(new Error("Email delivery record not found."), { statusCode: 404 });
  if (row["canonical_retryable"] !== true) throw Object.assign(new Error("This delivery does not have a canonical replay reference."), { statusCode: 409 });

  const userId = String(row["related_user_id"] ?? "");
  const user = userId
    ? await getDb().collection("cloud_users").findOne(
        { id: userId },
        { projection: { _id: 0, password_hash: 0, reset_token: 0, session_token: 0 } },
      ) as Row | null
    : null;
  if (!user) throw Object.assign(new Error("Canonical user for this delivery no longer exists."), { statusCode: 404 });

  const templateId = String(row["template_id"] ?? "");
  if (templateId === "welcome") return sendWelcomeEmailForUser(user, `retry:${deliveryId}`);
  if (templateId === "account_verification") return sendVerificationEmailForUser(user, `retry:${deliveryId}`);
  if (templateId === "password_reset") return sendPasswordResetEmailForUser(user, `retry:${deliveryId}`);
  throw Object.assign(new Error("This transactional category is not safely replayable yet."), { statusCode: 409 });
}
