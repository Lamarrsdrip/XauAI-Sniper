import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";
import { getDb } from "./db.js";

const JWT_ALGORITHM = "HS256" as const;

// -------------------------------------------------------------------
// Password hashing -- port of server.py hash_password/verify_password.
// bcrypt cost factor 10 (bcryptjs default) matches Python's bcrypt.gensalt()
// default of 12... NOTE: Python's bcrypt.gensalt() default rounds is 12,
// not 10. Match it explicitly so existing password hashes created by the
// Python backend keep verifying correctly against this port.
// -------------------------------------------------------------------
const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

// -------------------------------------------------------------------
// JWT -- port of server.py create_access_token / get_current_admin /
// get_cloud_user. Payload shape, algorithm, and 24h expiry must match
// exactly: existing tokens issued by the Python backend must keep working
// during any overlap window, and both backends must be able to read each
// other's tokens if run side by side during Phase 8 verification.
// -------------------------------------------------------------------

interface AccessTokenPayload {
  sub: string;
  email: string;
  type: "access";
}

interface CloudTokenPayload {
  sub: string;
  email: string;
  type: "cloud";
}

export function createAccessToken(userId: string, email: string): string {
  const payload: AccessTokenPayload = { sub: userId, email, type: "access" };
  return jwt.sign(payload, env.JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: "24h" });
}

/** Port of server.py:5827 `_cloud_token` -- 30-day expiry (not 24h; distinct from the admin access token). */
export function createCloudToken(userId: string, email: string): string {
  const payload: CloudTokenPayload = { sub: userId, email, type: "cloud" };
  return jwt.sign(payload, env.JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: "30d" });
}

class AuthError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function extractToken(request: FastifyRequest, cookieName: string): string | null {
  const cookies = (request as { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[cookieName];
  if (fromCookie) return fromCookie;
  const auth = request.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

/** Port of server.py's `get_current_admin` FastAPI dependency, as a Fastify preHandler. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(request, "access_token");
  if (!token) return void reply.code(401).send({ detail: "Not authenticated" });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as AccessTokenPayload;
    const user = await getDb().collection("users").findOne(
      { email: payload.email },
      { projection: { _id: 0, password_hash: 0 } },
    );
    if (!user || user["role"] !== "admin") {
      return void reply.code(403).send({ detail: "Admin access required" });
    }
    (request as FastifyRequest & { admin?: Record<string, unknown> }).admin = user;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return void reply.code(401).send({ detail: "Token expired" });
    }
    return void reply.code(401).send({ detail: "Invalid token" });
  }
}

/** Port of server.py's `get_cloud_user` FastAPI dependency, as a Fastify preHandler. */
export async function requireCloudUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(request, "cloud_token");
  if (!token) return void reply.code(401).send({ detail: "Not authenticated" });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as CloudTokenPayload;
    if (payload.type !== "cloud") return void reply.code(401).send({ detail: "Wrong token type" });
    const user = await getDb().collection("cloud_users").findOne(
      { id: payload.sub },
      { projection: { _id: 0, password_hash: 0 } },
    );
    if (!user) return void reply.code(401).send({ detail: "User not found" });
    if (user["disabled_at"]) return void reply.code(403).send({ detail: "Account disabled. Contact XauCloud support." });
    (request as FastifyRequest & { cloudUser?: Record<string, unknown> }).cloudUser = user;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return void reply.code(401).send({ detail: "Token expired" });
    }
    return void reply.code(401).send({ detail: "Invalid token" });
  }
}

// -------------------------------------------------------------------
// Rate limiting -- port of server.py's in-memory sliding-window _rate_limit.
// Same semantics: per-key bucket of call timestamps, 429 once max_requests
// is reached inside window_seconds, occasional pruning of empty buckets.
// -------------------------------------------------------------------
const rateLimitBuckets = new Map<string, number[]>();

export function rateLimit(key: string, maxRequests: number, windowSeconds: number): void {
  const now = Date.now() / 1000;
  const cutoff = now - windowSeconds;
  let bucket = rateLimitBuckets.get(key);
  if (!bucket) {
    bucket = [];
    rateLimitBuckets.set(key, bucket);
  }
  while (bucket.length > 0 && bucket[0]! < cutoff) bucket.shift();
  if (bucket.length >= maxRequests) {
    throw new AuthError(429, "Too many requests. Please wait before trying again.");
  }
  bucket.push(now);
  if (rateLimitBuckets.size > 5000 && Math.random() < 0.01) {
    for (const [k, v] of rateLimitBuckets) {
      if (v.length === 0) rateLimitBuckets.delete(k);
    }
  }
}

/** Port of server.py's `_client_ip` -- X-Forwarded-For first (reverse proxy), else socket address. */
export function clientIp(request: FastifyRequest): string {
  const fwd = request.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return request.ip || "unknown";
}

/** Port of server.py's `_issue_admin_session` cookie semantics exactly (httponly/secure/strict/24h/path=/). */
export function setAdminSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie("access_token", token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    maxAge: 86400,
    path: "/",
  });
}

/** Port of server.py's cloud_token cookie semantics -- 30-day maxAge (not 24h; distinct from the admin cookie). */
export function setCloudSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie("cloud_token", token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export { AuthError };
