import { createHash, timingSafeEqual, verify as cryptoVerify, type KeyObject, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { LicenseError } from "./license.js";
import { SchemaError, parseDecision } from "./localAiSchema.js";
import type { Decision, Snapshot } from "./localAiSchema.js";

/** Port of backend/local_ai/remote_relay.py -- authenticated public relay for the private XauCloud VPS local-AI worker. */

export const COLLECTION_NAME = "local_ai_remote_jobs";
const SIGNATURE_RE = /^[0-9a-f]{64}$/;
const TERMINAL_STATUSES = new Set(["LOCAL_AI_TRUSTED", "LOCAL_AI_LOW_CONFIDENCE", "LOCAL_AI_FALLBACK", "LOCAL_AI_PARSE_FAILED"]);

const WORKER_PUBLIC_KEY_PATH = path.join(process.cwd(), "local_ai", "worker_public_key.pem");
let workerPublicKey: KeyObject | null = null;
try {
  workerPublicKey = createPublicKey(readFileSync(WORKER_PUBLIC_KEY_PATH, "utf8"));
} catch {
  workerPublicKey = null;
}

export const LEASE_SECONDS = Math.max(20, Math.min(180, env.XAU_LOCAL_AI_WORKER_LEASE_SECONDS));
export const JOB_DEADLINE_SECONDS = Math.max(60, Math.min(1800, env.XAU_LOCAL_AI_JOB_DEADLINE_SECONDS));
export const RETENTION_SECONDS = Math.max(3600, Math.min(604_800, env.XAU_LOCAL_AI_RESULT_RETENTION_SECONDS));
export const MAX_ATTEMPTS = Math.max(1, Math.min(10, env.XAU_LOCAL_AI_MAX_ATTEMPTS));
export const GLOBAL_QUEUE_LIMIT = Math.max(10, Math.min(10_000, env.XAU_LOCAL_AI_GLOBAL_QUEUE_LIMIT));
export const CONFIDENCE_THRESHOLD = Math.max(70, Math.min(100, env.XAU_LOCAL_AI_CONFIDENCE_THRESHOLD));

export function isExpired(value: unknown, now: Date): boolean {
  if (!(value instanceof Date)) return false;
  return value.getTime() <= now.getTime();
}

/** Port of remote_relay.py:80 `_tenant_key`. */
export function tenantKey(licenseId: string, account: string, signature: string): string {
  return createHash("sha256").update(`${licenseId}\0${account}\0${signature}`, "utf8").digest("hex");
}

function safeShortText(value: unknown, name: string, limit: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit || [...trimmed].some((c) => c.charCodeAt(0) < 32)) {
    throw new Error(`${name} must contain 1..${limit} printable characters`);
  }
  return trimmed;
}

/** Port of remote_relay.py:93 `sanitize_worker_result` -- validate and minimize an untrusted worker result before persistence. */
export function sanitizeWorkerResult(
  raw: unknown,
  expectedSignature: string,
  snapshot: Snapshot,
  confidenceThreshold = 70,
): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("worker result must be an object");
  const rawObj = raw as Record<string, unknown>;
  const status = rawObj["status"];
  if (typeof status !== "string" || !TERMINAL_STATUSES.has(status)) throw new Error("worker result is not terminal");
  if (rawObj["signature"] !== expectedSignature) throw new Error("worker result signature mismatch");

  if (status === "LOCAL_AI_TRUSTED" || status === "LOCAL_AI_LOW_CONFIDENCE") {
    let decision: Decision;
    try {
      decision = parseDecision(rawObj["decision"]);
    } catch (exc) {
      if (exc instanceof SchemaError) throw new Error(exc.message);
      throw exc;
    }
    if (
      decision.candidate_allowed &&
      (decision.preferred_direction === "NONE" ||
        decision.candidate_setup === "NONE" ||
        !snapshot.allowed_candidate_setups.includes(decision.candidate_setup))
    ) {
      throw new Error("worker decision violates the allowed setup relationship");
    }
    const trusted = decision.confidence >= confidenceThreshold;
    const normalizedStatus = trusted ? "LOCAL_AI_TRUSTED" : "LOCAL_AI_LOW_CONFIDENCE";
    let latency = rawObj["latency_ms"] ?? 0;
    if (typeof latency === "boolean" || typeof latency !== "number" || latency < 0 || latency > 120_000) latency = 0;
    return {
      status: normalizedStatus,
      fallback: trusted ? null : "DETERMINISTIC",
      signature: expectedSignature,
      cache_hit: Boolean(rawObj["cache_hit"] ?? false),
      latency_ms: Math.round((latency as number) * 100) / 100,
      confidence_threshold: confidenceThreshold,
      decision,
    };
  }

  const reason = safeShortText(rawObj["reason"] ?? status, "reason", 240);
  return { status, fallback: "DETERMINISTIC", reason, signature: expectedSignature };
}

/** Port of remote_relay.py:164 `require_worker` -- HMAC static-secret shortcut, or Ed25519-signed timestamp+nonce+body-hash. */
export async function requireWorker(request: FastifyRequest, token: string | null, rawBody: Buffer): Promise<void> {
  const workerSecret = env.XAU_LOCAL_AI_WORKER_SECRET;
  if (!workerSecret && !workerPublicKey) {
    throw new LicenseError(503, "Private local-AI worker is not configured.");
  }
  if (workerSecret && token) {
    const a = Buffer.from(token, "utf8");
    const b = Buffer.from(workerSecret, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) return;
  }

  const timestamp = String(request.headers["x-xau-worker-timestamp"] ?? "");
  const nonce = String(request.headers["x-xau-worker-nonce"] ?? "");
  const signatureB64 = String(request.headers["x-xau-worker-signature"] ?? "");
  try {
    const timestampInt = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(timestampInt) || Math.abs(Math.trunc(Date.now() / 1000) - timestampInt) > 90) {
      throw new Error("stale timestamp");
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new Error("invalid nonce");
    const signature = Buffer.from(signatureB64, "base64");
    const bodyHash = createHash("sha256").update(rawBody).digest("hex");
    const canonical = Buffer.from(`${request.method}\n${request.url.split("?")[0]}\n${timestamp}\n${nonce}\n${bodyHash}`, "utf8");
    if (!workerPublicKey) throw new Error("public key unavailable");
    const verified = cryptoVerify(null, canonical, workerPublicKey, signature);
    if (!verified) throw new Error("invalid signature");

    const db = getDb();
    try {
      await db.collection("local_ai_worker_nonces").insertOne({
        nonce,
        used_at: new Date(),
        expires_at: new Date(Date.now() + 5 * 60_000),
      });
    } catch (err) {
      const { MongoServerError } = await import("mongodb");
      if (err instanceof MongoServerError && err.code === 11000) {
        throw new LicenseError(401, "Replayed worker request.");
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof LicenseError) throw err;
    throw new LicenseError(401, "Invalid worker credential.");
  }
}

/** Port of remote_relay.py:342 `ensure_indexes`. */
export async function ensureLocalAiIndexes(): Promise<void> {
  const db = getDb();
  const jobs = db.collection(COLLECTION_NAME);
  await jobs.createIndex("tenant_key", { unique: true });
  await jobs.createIndex({ status: 1, job_deadline_at: 1, created_at: 1 });
  await jobs.createIndex("expires_at", { expireAfterSeconds: 0 });
  await db.collection("local_ai_worker_nonces").createIndex("nonce", { unique: true });
  await db.collection("local_ai_worker_nonces").createIndex("expires_at", { expireAfterSeconds: 0 });
}
