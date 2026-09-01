import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";
import { env } from "../env.js";
import {
  clientIp,
  createAccessToken,
  rateLimit,
  requireAdmin,
  setAdminSessionCookie,
  verifyPassword,
} from "../auth.js";
import { cloudDecrypt, cloudEncrypt } from "../services/cloudCrypto.js";

const JWT_ALGORITHM = "HS256" as const;

const LoginRequestSchema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(256) });
const AdminMfaLoginSchema = z.object({ mfa_token: z.string().min(1).max(4096), code: z.string().regex(/^\d{6}$/) });
const AdminMfaEnableSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const AdminMfaDisableSchema = z.object({ password: z.string().min(1).max(256), code: z.string().regex(/^\d{6}$/) });

authenticator.options = { step: 30, window: 1 };

/** Port of server.py:1069 `_admin_mfa_pending_token`. */
function adminMfaPendingToken(email: string): string {
  return jwt.sign({ email, type: "admin_mfa_pending" }, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: "5m",
  });
}

interface AdminUser {
  _id: unknown;
  email: string;
  name?: string;
  role?: string;
  password_hash: string;
  mfa_enabled?: boolean;
  mfa_secret_enc?: string;
  session_version?: number;
}

/** Port of server.py:1078 `_issue_admin_session`. */
function issueAdminSession(reply: import("fastify").FastifyReply, user: AdminUser) {
  const token = createAccessToken(String(user._id), user.email, Number(user.session_version ?? 0));
  setAdminSessionCookie(reply, token);
  return {
    email: user.email,
    name: user.name ?? "Admin",
    role: user.role ?? "admin",
    mfa_enabled: Boolean(user.mfa_enabled),
  };
}

/** Port of server.py routes: POST /auth/login, POST /auth/login/mfa, GET /auth/me, POST /auth/logout. */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/login -- server.py:1098
  app.post("/auth/login", async (request, reply) => {
    const body = LoginRequestSchema.parse(request.body);
    const ip = clientIp(request);
    rateLimit(`admin_login_ip:${ip}`, 10, 300);
    rateLimit(`admin_login_email:${body.email.toLowerCase()}`, 5, 300);

    const db = getDb();
    const user = (await db.collection("users").findOne({ email: body.email.toLowerCase() })) as AdminUser | null;

    if (!user || user.role !== "admin" || !(await verifyPassword(body.password, user.password_hash))) {
      await db.collection("login_audit_log").insertOne({
        id: randomUUID(),
        email: body.email.toLowerCase(),
        ip,
        ok: false,
        role: "admin",
        ts: new Date(),
      });
      return reply.code(401).send({ detail: "Invalid email or password" });
    }

    if (user.mfa_enabled) {
      await db.collection("login_audit_log").insertOne({
        id: randomUUID(),
        email: user.email,
        ip,
        ok: false,
        role: "admin",
        ts: new Date(),
        stage: "password_ok_awaiting_mfa",
      });
      return { mfa_required: true, mfa_token: adminMfaPendingToken(user.email) };
    }

    await db.collection("login_audit_log").insertOne({
      id: randomUUID(),
      email: user.email,
      ip,
      ok: true,
      role: "admin",
      ts: new Date(),
    });
    return issueAdminSession(reply, user);
  });

  // POST /auth/login/mfa -- server.py:1133
  app.post("/auth/login/mfa", async (request, reply) => {
    const body = AdminMfaLoginSchema.parse(request.body);
    const ip = clientIp(request);
    rateLimit(`admin_mfa_ip:${ip}`, 10, 300);

    let payload: { email: string; type: string };
    try {
      payload = jwt.verify(body.mfa_token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as typeof payload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return reply.code(401).send({ detail: "MFA session expired. Log in again." });
      }
      return reply.code(401).send({ detail: "Invalid MFA session." });
    }
    if (payload.type !== "admin_mfa_pending") {
      return reply.code(401).send({ detail: "Invalid MFA session." });
    }

    const db = getDb();
    const user = (await db.collection("users").findOne({ email: payload.email })) as AdminUser | null;
    if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
      return reply.code(401).send({ detail: "MFA is not active on this account." });
    }

    rateLimit(`admin_mfa_email:${user.email}`, 8, 300);

    let secret = "";
    try {
      secret = cloudDecrypt(user.mfa_secret_enc);
    } catch {
      secret = "";
    }
    if (!secret || !authenticator.verify({ token: body.code.trim(), secret })) {
      await db.collection("login_audit_log").insertOne({
        id: randomUUID(),
        email: user.email,
        ip,
        ok: false,
        role: "admin",
        ts: new Date(),
        stage: "mfa_code_rejected",
      });
      return reply.code(401).send({ detail: "Incorrect code." });
    }

    await db.collection("login_audit_log").insertOne({
      id: randomUUID(),
      email: user.email,
      ip,
      ok: true,
      role: "admin",
      ts: new Date(),
      stage: "mfa_verified",
    });
    return issueAdminSession(reply, user);
  });

  // POST /auth/mfa/setup -- server.py:1169. Generates a NEW pending secret
  // every call (not yet enabled) -- lets the admin re-scan if a previous
  // setup attempt was abandoned, without ever activating a secret the admin
  // never confirmed possession of.
  app.post("/auth/mfa/setup", { preHandler: requireAdmin }, async (request) => {
    const admin = (request as typeof request & { admin: AdminUser }).admin;
    const secret = authenticator.generateSecret(20);
    await getDb()
      .collection("users")
      .updateOne({ email: admin.email }, { $set: { mfa_pending_secret_enc: cloudEncrypt(secret) } });
    const issuer = "XauCloudAdmin";
    const otpauthUri = authenticator.keyuri(admin.email, issuer, secret);
    return { secret, otpauth_uri: otpauthUri };
  });

  // POST /auth/mfa/enable -- server.py:1182
  app.post("/auth/mfa/enable", { preHandler: requireAdmin }, async (request, reply) => {
    const body = AdminMfaEnableSchema.parse(request.body);
    const admin = (request as typeof request & { admin: AdminUser & { mfa_pending_secret_enc?: string } }).admin;
    const pending = admin.mfa_pending_secret_enc;
    if (!pending) {
      return reply.code(400).send({ detail: "No MFA setup in progress. Call /auth/mfa/setup first." });
    }
    let secret = "";
    try {
      secret = cloudDecrypt(pending);
    } catch {
      secret = "";
    }
    if (!secret || !authenticator.verify({ token: body.code.trim(), secret })) {
      return reply.code(400).send({ detail: "Incorrect code. Scan the QR code again and try the current 6-digit code." });
    }
    await getDb()
      .collection("users")
      .updateOne(
        { email: admin.email },
        { $set: { mfa_enabled: true, mfa_secret_enc: pending }, $unset: { mfa_pending_secret_enc: "" } },
      );
    return { ok: true, message: "MFA enabled." };
  });

  // POST /auth/mfa/disable -- server.py:1197
  app.post("/auth/mfa/disable", { preHandler: requireAdmin }, async (request, reply) => {
    const body = AdminMfaDisableSchema.parse(request.body);
    const admin = (request as typeof request & { admin: AdminUser }).admin;
    const full = (await getDb().collection("users").findOne({ email: admin.email })) as AdminUser | null;
    if (!full || !(await verifyPassword(body.password, full.password_hash))) {
      return reply.code(401).send({ detail: "Incorrect password." });
    }
    let secret = "";
    try {
      secret = cloudDecrypt(full.mfa_secret_enc ?? "");
    } catch {
      secret = "";
    }
    if (!full.mfa_enabled || !secret || !authenticator.verify({ token: body.code.trim(), secret })) {
      return reply.code(400).send({ detail: "Incorrect code." });
    }
    await getDb()
      .collection("users")
      .updateOne(
        { email: admin.email },
        { $set: { mfa_enabled: false }, $unset: { mfa_secret_enc: "", mfa_pending_secret_enc: "" } },
      );
    return { ok: true, message: "MFA disabled." };
  });

  // GET /auth/me -- server.py:1212
  app.get("/auth/me", { preHandler: requireAdmin }, async (request) => {
    const admin = (request as typeof request & { admin: AdminUser }).admin;
    return {
      email: admin.email,
      name: admin.name ?? "Admin",
      role: admin.role ?? "admin",
      mfa_enabled: Boolean(admin.mfa_enabled),
    };
  });

  // POST /auth/logout -- server.py:1225
  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie("access_token", { path: "/" });
    return { message: "Logged out" };
  });
}
