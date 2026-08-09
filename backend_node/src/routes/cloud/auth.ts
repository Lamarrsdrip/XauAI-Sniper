import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../db.js";
import { env } from "../../env.js";
import {
  clientIp,
  createCloudToken,
  hashPassword,
  rateLimit,
  requireCloudUser,
  setCloudSessionCookie,
  verifyPassword,
} from "../../auth.js";
import { getUserLicense, verifyCommandLicense } from "../../services/commandLicense.js";
import {
  sendPasswordResetEmailForUser,
  sendVerificationEmailForUser,
  sendWelcomeEmailForUser,
  verifyEmailToken,
} from "../../services/accountRecovery.js";

const JWT_ALGORITHM = "HS256" as const;

const CloudSignupSchema = z.object({
  email: z.string(),
  password: z.string(),
  full_name: z.string().optional().default(""),
  country: z.string().optional().default(""),
});
const CloudLoginSchema = z.object({ email: z.string(), password: z.string() });
const CloudForgotPasswordSchema = z.object({ email: z.string() });
const CloudResetPasswordSchema = z.object({ token: z.string(), new_password: z.string() });
const CloudDeleteAccountSchema = z.object({ password: z.string(), confirm: z.boolean().optional().default(false) });
const CloudLicenseLinkSchema = z.object({ license_key: z.string() });

function hasStrongPassword(password: string): { ok: boolean; error?: string } {
  if (password.length < 8) return { ok: false, error: "Password must be 8+ characters" };
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, error: "Password must include at least one letter and one number" };
  }
  return { ok: true };
}

/** Port of server.py cloud auth endpoints (lines 6396-6611) and license link/status (5893, 6611). */
export async function registerCloudAuthRoutes(app: FastifyInstance): Promise<void> {
  // POST /cloud/auth/signup -- server.py:6396
  app.post("/cloud/auth/signup", async (request, reply) => {
    const body = CloudSignupSchema.parse(request.body);
    rateLimit(`cloud_signup_ip:${clientIp(request)}`, 10, 600);

    const email = body.email.toLowerCase().trim();
    const domain = email.split("@").at(-1) ?? "";
    if (!email.includes("@") || !domain.includes(".") || email.length < 5) {
      return reply.code(400).send({ detail: "Invalid email format" });
    }

    const db = getDb();
    if (await db.collection("cloud_users").findOne({ email })) {
      return reply.code(400).send({ detail: "Email already registered" });
    }

    const strength = hasStrongPassword(body.password);
    if (!strength.ok) return reply.code(400).send({ detail: strength.error });

    const uid = randomUUID();
    const now = new Date();
    const doc: Record<string, unknown> = {
      id: uid,
      email,
      password_hash: await hashPassword(body.password),
      full_name: (body.full_name || "").trim(),
      country: (body.country || "").trim(),
      created_at: now.toISOString(),
      last_login_at: now.toISOString(),
      email_verified: false,
      session_version: 0,
    };
    try {
      await db.collection("cloud_users").insertOne({ ...doc });
    } catch {
      return reply.code(400).send({ detail: "Email already registered" });
    }

    const token = createCloudToken(uid, email, 0);
    setCloudSessionCookie(reply, token);
    await Promise.allSettled([
      sendWelcomeEmailForUser(doc, "account_signup"),
      sendVerificationEmailForUser(doc, "account_signup"),
    ]);
    const { password_hash: _ph, ...userOut } = doc;
    return { ok: true, user: userOut };
  });

  // POST /cloud/auth/login -- server.py:6428
  app.post("/cloud/auth/login", async (request, reply) => {
    const body = CloudLoginSchema.parse(request.body);
    const ip = clientIp(request);
    const email = body.email.toLowerCase().trim();
    rateLimit(`cloud_login_ip:${ip}`, 10, 300);
    rateLimit(`cloud_login_email:${email}`, 5, 300);

    const db = getDb();
    const u = await db.collection("cloud_users").findOne({ email });
    if (!u || !(await verifyPassword(body.password, String(u["password_hash"] ?? "")))) {
      await db.collection("login_audit_log").insertOne({ id: randomUUID(), email, ip, ok: false, role: "cloud_user", ts: new Date() });
      return reply.code(401).send({ detail: "Invalid email or password" });
    }
    if (u["disabled_at"]) {
      await db.collection("login_audit_log").insertOne({ id: randomUUID(), email: u["email"], ip, ok: false, role: "cloud_user", ts: new Date(), stage: "account_disabled" });
      return reply.code(403).send({ detail: "Account disabled. Contact XauCloud support." });
    }
    await db.collection("login_audit_log").insertOne({ id: randomUUID(), email: u["email"], ip, ok: true, role: "cloud_user", ts: new Date() });
    await db.collection("cloud_users").updateOne({ id: u["id"] }, { $set: { last_login_at: new Date().toISOString() } });

    const token = createCloudToken(String(u["id"]), String(u["email"]), Number(u["session_version"] ?? 0));
    setCloudSessionCookie(reply, token);
    const { _id, password_hash, ...userOut } = u;
    return { ok: true, user: userOut };
  });

  // POST /cloud/auth/logout -- server.py:6456
  app.post("/cloud/auth/logout", async (_request, reply) => {
    reply.clearCookie("cloud_token", { path: "/" });
    return { ok: true };
  });

  // GET /cloud/auth/me -- server.py:6461
  app.get("/cloud/auth/me", { preHandler: requireCloudUser }, async (request) => {
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const u = { ...user };
    delete u["_id"];
    const ends = u["subscription_ends_at"];
    if (ends) {
      try {
        const endDt = new Date(String(ends).replace("Z", "+00:00"));
        const remainingMs = endDt.getTime() - Date.now();
        u["subscription_active"] = remainingMs > 0;
        u["days_remaining"] = Math.max(0, Math.floor((remainingMs / 1000 + 86399) / 86400));
      } catch {
        u["days_remaining"] = 0;
        u["subscription_active"] = false;
      }
    }
    return u;
  });

  // GET /cloud/auth/verify-email -- canonical token-safe verification flow.
  app.get("/cloud/auth/verify-email", async (request, reply) => {
    const token = z.object({ token: z.string().min(20).max(3000) }).parse(request.query).token;
    try {
      await verifyEmailToken(token);
      return reply.type("text/html").send("<!doctype html><html><body style=\"font-family:Arial;background:#07080B;color:#fff;padding:40px\"><h1>Email verified</h1><p>Your XauCloud email is verified. You can return to Command Center.</p></body></html>");
    } catch (error) {
      const status = Number((error as { statusCode?: unknown })?.statusCode ?? 400);
      return reply.code(status).type("text/html").send("<!doctype html><html><body style=\"font-family:Arial;background:#07080B;color:#fff;padding:40px\"><h1>Verification failed</h1><p>The verification link is invalid, expired, or already used.</p></body></html>");
    }
  });

  // POST /cloud/auth/forgot-password -- server.py:6499
  app.post("/cloud/auth/forgot-password", async (request) => {
    const body = CloudForgotPasswordSchema.parse(request.body);
    const ip = clientIp(request);
    const email = body.email.toLowerCase().trim();
    rateLimit(`forgot_password_ip:${ip}`, 5, 600);
    rateLimit(`forgot_password_email:${email}`, 3, 600);

    const user = await getDb().collection("cloud_users").findOne({ email });
    if (user) await sendPasswordResetEmailForUser(user as Record<string, unknown>, "customer_forgot_password");
    return { ok: true, message: "If an account exists for that email, a reset link has been sent." };
  });

  // POST /cloud/auth/reset-password -- server.py:6522
  app.post("/cloud/auth/reset-password", async (request, reply) => {
    const body = CloudResetPasswordSchema.parse(request.body);
    rateLimit(`reset_password_ip:${clientIp(request)}`, 10, 600);

    let payload: { sub: string; type: string; jti: string };
    try {
      payload = jwt.verify(body.token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as typeof payload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) return reply.code(400).send({ detail: "Reset link has expired. Request a new one." });
      return reply.code(400).send({ detail: "Invalid reset link." });
    }
    if (payload.type !== "password_reset") return reply.code(400).send({ detail: "Invalid reset link." });

    const db = getDb();
    try {
      await db.collection("used_password_reset_tokens").insertOne({ jti: payload.jti, used_at: new Date() });
    } catch {
      return reply.code(400).send({ detail: "This reset link has already been used." });
    }

    const strength = hasStrongPassword(body.new_password);
    if (!strength.ok) return reply.code(400).send({ detail: strength.error });

    const result = await db.collection("cloud_users").updateOne(
      { id: payload.sub },
      { $set: { password_hash: await hashPassword(body.new_password), updated_at: new Date().toISOString() }, $inc: { session_version: 1 } },
    );
    if (result.matchedCount === 0) return reply.code(404).send({ detail: "Account no longer exists." });
    return { ok: true, message: "Password updated. You can now log in with your new password." };
  });

  // GET /cloud/account/export -- server.py:6553
  app.get("/cloud/account/export", { preHandler: requireCloudUser }, async (request) => {
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const u = { ...user };
    delete u["_id"];
    delete u["password_hash"];
    const lic = await getUserLicense(user);
    if (lic) delete lic["_id"];
    const loginHistory = await getDb()
      .collection("login_audit_log")
      .find({ email: user["email"], role: "cloud_user" }, { projection: { _id: 0 } })
      .sort({ ts: -1 })
      .limit(200)
      .toArray();
    for (const entry of loginHistory) {
      if (entry["ts"] instanceof Date) entry["ts"] = entry["ts"].toISOString();
    }
    return { exported_at: new Date().toISOString(), account: u, linked_license: lic, login_history: loginHistory };
  });

  // POST /cloud/account/delete -- server.py:6573
  app.post("/cloud/account/delete", { preHandler: requireCloudUser }, async (request, reply) => {
    const body = CloudDeleteAccountSchema.parse(request.body);
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    if (!body.confirm) return reply.code(400).send({ detail: "Confirmation is required to delete your account." });
    if (!(await verifyPassword(body.password, String(user["password_hash"] ?? "")))) {
      return reply.code(401).send({ detail: "Incorrect password." });
    }
    const db = getDb();
    await db.collection("account_deletion_audit_log").insertOne({
      id: randomUUID(),
      user_id: user["id"],
      email: user["email"],
      deleted_at: new Date(),
    });
    await db.collection("cloud_users").deleteOne({ id: user["id"] });
    reply.clearCookie("cloud_token", { path: "/" });
    return { ok: true, message: "Account deleted." };
  });

  // POST /cloud/license/link -- server.py:5893 -> wired near line 6593
  app.post("/cloud/license/link", { preHandler: requireCloudUser }, async (request) => {
    const body = CloudLicenseLinkSchema.parse(request.body);
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    rateLimit(`license_link_user:${user["id"]}`, 10, 300);
    const lic = await verifyCommandLicense(user, body.license_key);
    return {
      ok: true,
      license: {
        license_id: lic["id"] ?? "",
        activation_key: lic["pin"] ?? "",
        status: lic["is_active"] ? "active" : "inactive",
        is_used: Boolean(lic["is_used"]),
        activated_at: lic["activated_at"] ?? "",
        mt5_account: lic["mt5_account"] ?? "",
        buyer_email: lic["buyer_email"] ?? user["email"] ?? "",
        created_at: lic["created_at"] ?? "",
        expiry: lic["expires_at"] ?? lic["subscription_ends_at"] ?? "",
      },
    };
  });

  // GET /cloud/license/status -- server.py:6611
  app.get("/cloud/license/status", { preHandler: requireCloudUser }, async (request) => {
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const lic = await getUserLicense(user);
    if (!lic) {
      return { linked: false, license: null, message: "No license linked. Add your ASE activation key to connect this Command Center to your EA." };
    }
    return {
      linked: true,
      license: {
        license_id: lic["id"] ?? "",
        activation_key: lic["pin"] ?? "",
        status: lic["is_active"] ? "active" : "inactive",
        is_used: Boolean(lic["is_used"]),
        activated_at: lic["activated_at"] ?? "",
        mt5_account: lic["mt5_account"] ?? "",
        account_binding: lic["mt5_account"] || "Not bound yet",
        vps_binding: lic["vps_binding"] || "Not bound yet",
        ea_version: lic["ea_version"] ?? "",
        buyer_email: lic["buyer_email"] ?? user["email"] ?? "",
        created_at: lic["created_at"] ?? "",
        expiry: lic["expires_at"] ?? lic["subscription_ends_at"] ?? "Lifetime / manual",
      },
    };
  });
}
