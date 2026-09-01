import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { MongoServerError } from "mongodb";
import { z } from "zod";
import { getDb } from "../db.js";
import { clientIp, rateLimit } from "../auth.js";
import { LicenseError, normalizeLicenseKey, resolveMonitorLicense } from "../services/license.js";
import { parseSnapshot, snapshotSignature, SchemaError, type Snapshot } from "../services/localAiSchema.js";
import {
  CONFIDENCE_THRESHOLD,
  GLOBAL_QUEUE_LIMIT,
  JOB_DEADLINE_SECONDS,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  RETENTION_SECONDS,
  isExpired,
  requireWorker,
  sanitizeWorkerResult,
  tenantKey,
} from "../services/localAiRelay.js";

const RemoteSubmitRequestSchema = z.object({
  pin: z.string().min(8).max(64),
  account: z.string().min(1).max(32),
  broker_server: z.string().max(96).optional().default(""),
  terminal_instance_id: z.string().max(128).optional().default(""),
  snapshot: z.record(z.string(), z.unknown()),
});

const RemoteResultRequestSchema = z.object({
  pin: z.string().min(8).max(64),
  account: z.string().min(1).max(32),
  signature: z.string().min(64).max(64),
});

const WorkerClaimRequestSchema = z.object({ worker_id: z.string().min(1).max(96) });
const WorkerCompleteRequestSchema = z.object({
  worker_id: z.string().min(1).max(96),
  job_id: z.string().min(1).max(96),
  lease_token: z.string().min(32).max(128),
  result: z.record(z.string(), z.unknown()),
});

/** Port of remote_relay.py's `tenant()` helper -- resolves the license and rate-limits by tenant + IP. */
async function tenant(pin: string, account: string, request: FastifyRequest): Promise<{ lic: Record<string, unknown>; licenseId: string }> {
  const lic = await resolveMonitorLicense(normalizeLicenseKey(pin), account);
  const licenseId = String(lic["id"] ?? "").trim();
  if (!licenseId) throw new LicenseError(403, "License identity is unavailable.");
  const opaque = createHash("sha256").update(`${licenseId}:${account}`).digest("hex").slice(0, 24);
  rateLimit(`local_ai_tenant:${opaque}`, 12, 3600);
  rateLimit(`local_ai_ip:${clientIp(request)}`, 60, 3600);
  return { lic, licenseId };
}

/** Port of backend/local_ai/remote_relay.py's `build_router` -- 4 routes under /local-ai/*. */
export async function registerLocalAiRoutes(app: FastifyInstance): Promise<void> {
  const jobs = getDb().collection("local_ai_remote_jobs");

  // POST /local-ai/remote/submit -- remote_relay.py:203
  app.post("/local-ai/remote/submit", async (request, reply) => {
    const req = RemoteSubmitRequestSchema.parse(request.body);
    const { licenseId } = await tenant(req.pin, req.account, request);

    let snapshot: Snapshot;
    try {
      snapshot = parseSnapshot(req.snapshot);
    } catch (exc) {
      if (exc instanceof SchemaError) return reply.code(400).send({ detail: `INVALID_SNAPSHOT: ${exc.message}` });
      throw exc;
    }
    const symbol = snapshot.symbol.toUpperCase();
    if (!symbol.includes("XAU") && !symbol.includes("GOLD")) {
      return reply.code(400).send({ detail: "Pure-M10 local AI accepts gold symbols only." });
    }

    const signature = snapshotSignature(snapshot);
    const now = new Date();
    const key = tenantKey(licenseId, req.account, signature);
    const existing = await jobs.findOne({ tenant_key: key }, { projection: { _id: 0 } });
    if (existing) {
      if (existing["status"] === "COMPLETE" && typeof existing["result"] === "object" && existing["result"] !== null) {
        return { ...(existing["result"] as Record<string, unknown>), cache_hit: true };
      }
      return { status: "LOCAL_AI_PENDING", fallback: "DETERMINISTIC", signature };
    }

    const active = await jobs.countDocuments({
      license_id: licenseId,
      account: req.account,
      status: { $in: ["QUEUED", "LEASED"] },
      job_deadline_at: { $gt: now },
    });
    if (active >= 2) {
      return { status: "LOCAL_AI_FALLBACK", fallback: "DETERMINISTIC", reason: "TENANT_QUEUE_FULL", signature };
    }
    const globalActive = await jobs.countDocuments({ status: { $in: ["QUEUED", "LEASED"] }, job_deadline_at: { $gt: now } });
    if (globalActive >= GLOBAL_QUEUE_LIMIT) {
      return { status: "LOCAL_AI_FALLBACK", fallback: "DETERMINISTIC", reason: "REMOTE_AI_CAPACITY_GUARD", signature };
    }

    const doc = {
      job_id: randomUUID(),
      tenant_key: key,
      license_id: licenseId,
      account: req.account,
      broker_server: req.broker_server,
      terminal_instance_id: req.terminal_instance_id,
      signature,
      snapshot,
      status: "QUEUED",
      attempts: 0,
      created_at: now,
      updated_at: now,
      job_deadline_at: new Date(now.getTime() + JOB_DEADLINE_SECONDS * 1000),
      expires_at: new Date(now.getTime() + RETENTION_SECONDS * 1000),
    };
    try {
      await jobs.insertOne({ ...doc });
    } catch (err) {
      if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
    }
    return { status: "LOCAL_AI_PENDING", fallback: "DETERMINISTIC", signature };
  });

  // POST /local-ai/remote/result -- remote_relay.py:263
  app.post("/local-ai/remote/result", async (request, reply) => {
    const req = RemoteResultRequestSchema.parse(request.body);
    if (!/^[0-9a-f]{64}$/.test(req.signature)) return reply.code(400).send({ detail: "Invalid local-AI signature." });
    const { licenseId } = await tenant(req.pin, req.account, request);

    const job = await jobs.findOne({ tenant_key: tenantKey(licenseId, req.account, req.signature) }, { projection: { _id: 0 } });
    if (!job) return { status: "LOCAL_AI_NOT_FOUND", fallback: "DETERMINISTIC", signature: req.signature };
    if (job["status"] === "COMPLETE" && typeof job["result"] === "object" && job["result"] !== null) {
      return { ...(job["result"] as Record<string, unknown>), cache_hit: true };
    }
    if (isExpired(job["job_deadline_at"], new Date())) {
      return { status: "LOCAL_AI_FALLBACK", fallback: "DETERMINISTIC", reason: "REMOTE_AI_DEADLINE_EXPIRED", signature: req.signature };
    }
    return { status: "LOCAL_AI_PENDING", fallback: "DETERMINISTIC", signature: req.signature };
  });

  // POST /local-ai/worker/claim -- remote_relay.py:282
  app.post("/local-ai/worker/claim", async (request, reply) => {
    const req = WorkerClaimRequestSchema.parse(request.body);
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    try {
      await requireWorker(request, (request.headers["x-xau-worker-token"] as string | undefined) ?? null, rawBody);
    } catch (err) {
      if (err instanceof LicenseError) return reply.code(err.statusCode).send({ detail: err.detail });
      throw err;
    }

    const now = new Date();
    const leaseToken = randomBytes(24).toString("base64url");
    const updated = await jobs.findOneAndUpdate(
      {
        job_deadline_at: { $gt: now },
        attempts: { $lt: MAX_ATTEMPTS },
        $or: [{ status: "QUEUED" }, { status: "LEASED", lease_until: { $lte: now } }],
      },
      {
        $set: { status: "LEASED", worker_id: req.worker_id, lease_token: leaseToken, lease_until: new Date(now.getTime() + LEASE_SECONDS * 1000), updated_at: now },
        $inc: { attempts: 1 },
      },
      {
        sort: { created_at: 1 },
        returnDocument: "after",
        projection: { _id: 0, job_id: 1, signature: 1, snapshot: 1, lease_token: 1, lease_until: 1, attempts: 1 },
      },
    );
    if (!updated) return { status: "IDLE" };
    return { status: "CLAIMED", ...updated };
  });

  // POST /local-ai/worker/complete -- remote_relay.py:311
  app.post("/local-ai/worker/complete", async (request, reply) => {
    const req = WorkerCompleteRequestSchema.parse(request.body);
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    try {
      await requireWorker(request, (request.headers["x-xau-worker-token"] as string | undefined) ?? null, rawBody);
    } catch (err) {
      if (err instanceof LicenseError) return reply.code(err.statusCode).send({ detail: err.detail });
      throw err;
    }

    const job = await jobs.findOne({ job_id: req.job_id, status: "LEASED", worker_id: req.worker_id, lease_token: req.lease_token });
    if (!job) return reply.code(409).send({ detail: "Job lease is missing, expired, or owned by another worker." });

    let result: Record<string, unknown>;
    try {
      const snapshot = parseSnapshot(job["snapshot"]);
      result = sanitizeWorkerResult(req.result, String(job["signature"]), snapshot, CONFIDENCE_THRESHOLD);
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc);
      return reply.code(400).send({ detail: `INVALID_WORKER_RESULT: ${message}` });
    }

    const now = new Date();
    const completed = await jobs.findOneAndUpdate(
      { job_id: req.job_id, status: "LEASED", worker_id: req.worker_id, lease_token: req.lease_token },
      { $set: { status: "COMPLETE", result, completed_at: now, updated_at: now }, $unset: { lease_token: "", lease_until: "" } },
      { returnDocument: "after", projection: { _id: 0, job_id: 1 } },
    );
    if (!completed) return reply.code(409).send({ detail: "Job lease changed before completion." });
    return { status: "ACCEPTED", job_id: req.job_id };
  });
}
