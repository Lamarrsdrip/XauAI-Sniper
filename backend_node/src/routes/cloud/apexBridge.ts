import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { z } from "zod";
import { getDb } from "../../db.js";
import { LicenseError, normalizeLicenseKey, resolveMonitorLicense } from "../../services/license.js";

const BridgeLicenseSchema = z.object({
  license: z.string(),
  active: z.boolean().default(true),
  account: z.string().optional().default(""),
  customer: z.string().optional().default(""),
  expiresAt: z.string().nullable().optional(),
  resetAccount: z.boolean().optional().default(false),
});

const BridgeConfigSchema = z.object({
  license: z.string(),
  config: z.record(z.string(), z.unknown()),
  commandRevision: z.number().int().nonnegative().optional().default(0),
});

const ApexEventSchema = z.object({
  license: z.string().optional().default(""),
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  account: z.union([z.string(), z.number()]).optional().default(""),
  account_number: z.union([z.string(), z.number()]).optional().default(""),
  type: z.string().optional().default("EA_EVENT"),
}).passthrough();

const BridgeStateSchema = z.object({
  kind: z.string().min(1).max(120),
  value: z.unknown(),
});

// Apex-only durability indexes. These are created LAZILY on first use and never during
// route registration: registerApexBridgeRoutes() runs long before connectDb(), so issuing
// Mongo commands at registration time would make the whole XauCloud backend's startup
// depend on Mongo being reachable. An index failure must degrade Apex, never block boot.
let indexesReady: Promise<void> | null = null;
function ensureApexIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      const db = getDb();
      await Promise.all([
        // Idempotent event ingestion. The partial filter deliberately ignores legacy rows
        // written before event_id existed, so this cannot fail on historical data.
        db.collection("apex_bridge_events").createIndex(
          { license_key: 1, event_id: 1 },
          { unique: true, partialFilterExpression: { event_id: { $type: "string" } } },
        ),
        db.collection("apex_bridge_state").createIndex({ kind: 1 }, { unique: true }),
      ]);
    })().catch((error) => {
      indexesReady = null; // let a later request retry
      throw error;
    });
  }
  return indexesReady;
}

function maskLicense(value: string): string {
  const key = normalizeLicenseKey(value);
  return key.length <= 8 ? "***" : `${key.slice(0, 5)}...${key.slice(-4)}`;
}

function bridgeAuthorization(request: FastifyRequest): { ok: boolean; status: number; error: string } {
  const expected = String(process.env.APEX_BRIDGE_SECRET || "");
  const supplied = String(request.headers["x-apex-bridge-secret"] || "");
  if (!expected) return { ok: false, status: 503, error: "bridge_secret_not_configured" };
  if (!supplied) return { ok: false, status: 401, error: "bridge_secret_missing" };
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return ok ? { ok: true, status: 200, error: "" } : { ok: false, status: 401, error: "bridge_secret_invalid" };
}

function requireBridgeAuthorization(request: FastifyRequest, reply: FastifyReply) {
  const auth = bridgeAuthorization(request);
  if (auth.ok) return null;
  return reply.code(auth.status).send({ ok: false, error: auth.error });
}

async function resolveApexRequest(request: FastifyRequest, key: string, account: string, route: string) {
  try {
    return await resolveMonitorLicense(key, account);
  } catch (error) {
    if (error instanceof LicenseError) {
      const detail = typeof error.detail === "object" ? error.detail : {};
      request.log.warn({ route, license: maskLicense(key), account, reason: detail["reason"] || "LICENSE_ERROR" }, "Apex license rejected");
    }
    throw error;
  }
}

function connectedState(lastSeen: unknown): "CONNECTED" | "STALE" | "DISCONNECTED" {
  if (!lastSeen) return "DISCONNECTED";
  const ms = Date.now() - Date.parse(String(lastSeen));
  if (!Number.isFinite(ms)) return "DISCONNECTED";
  if (ms < 45_000) return "CONNECTED";
  if (ms < 180_000) return "STALE";
  return "DISCONNECTED";
}

export async function registerApexBridgeRoutes(app: FastifyInstance): Promise<void> {
  // EA-facing config endpoint. Authentication/binding is EXACTLY XauCloud's resolveMonitorLicense().
  app.get("/cloud/apex/config", async (request) => {
    const q = z.object({
      license_key: z.string().optional().default(""),
      pin: z.string().optional().default(""),
      account: z.string().optional().default(""),
    }).parse(request.query);
    const key = normalizeLicenseKey(q.license_key || q.pin || "");
    await resolveApexRequest(request, key, q.account || "", "/api/cloud/apex/config");
    const doc = await getDb().collection("apex_bridge_configs").findOne({ license_key: key }, { projection: { _id: 0 } });
    const cfg = (doc?.["config"] && typeof doc["config"] === "object") ? doc["config"] as Record<string, unknown> : {};
    return {
      ok: true,
      licenseStatus: "ACTIVE",
      armed: cfg["armed"] === true,
      commandRevision: Number(doc?.["command_revision"] || 0),
      ...cfg,
      bridge: "XAUCLOUD_COMMAND_CENTER",
    };
  });

  // EA event telemetry stays on the same MT5-safe xaucloud.io transport.
  app.post("/cloud/apex/event", async (request) => {
    const req = ApexEventSchema.parse(request.body);
    const key = normalizeLicenseKey(req.license_key || req.pin || req.license || "");
    const account = String(req.account_number || req.account || "");
    await resolveApexRequest(request, key, account, "/api/cloud/apex/event");
    // Idempotent by the EA's own eventId, so a WebRequest retry after a timeout (or a
    // restart replaying its durable outbox) cannot duplicate a LAYER_OPEN or CAMPAIGN_END.
    await ensureApexIndexes().catch((error) => {
      request.log.warn({ err: error }, "Apex event index unavailable; ingesting without uniqueness");
    });
    const suppliedId = String((req as Record<string, unknown>)["eventId"] ?? (req as Record<string, unknown>)["event_id"] ?? "").trim();
    const eventId = suppliedId || randomUUID();
    const doc = { ...req, license_key: key, account, eventId, event_id: eventId, id: eventId, ts: new Date().toISOString() };
    const result = await getDb().collection("apex_bridge_events").updateOne(
      { license_key: key, event_id: eventId },
      { $setOnInsert: doc },
      { upsert: true },
    );
    return { ok: true, status: result.upsertedCount ? "received" : "duplicate", event_id: eventId };
  });

  // Server-to-server endpoints used ONLY by apex.xaucloud.io. MT5 never calls these.
  app.post("/cloud/apex/bridge/license/upsert", async (request, reply) => {
    const authError = requireBridgeAuthorization(request, reply);
    if (authError) return authError;
    const req = BridgeLicenseSchema.parse(request.body);
    const key = normalizeLicenseKey(req.license);
    if (!key) return reply.code(400).send({ ok: false, error: "license_required" });
    const now = new Date().toISOString();
    const licenses = getDb().collection("pin_licenses");
    const existing = await licenses.findOne({ pin: key }, { projection: { _id: 0 } });
    if (existing && existing["source"] !== "APEX" && existing["apex_license"] !== true) {
      return reply.code(409).send({ ok: false, error: "license_pin_conflicts_with_existing_xaucloud_license" });
    }
    const account = String(req.account || "").trim();
    const existingAccount = String(existing?.["mt5_account"] || "").trim();
    const effectiveAccount = account || (req.resetAccount ? "" : existingAccount);
    const set: Record<string, unknown> = {
      pin: key,
      is_active: req.active,
      mt5_account: effectiveAccount,
      is_used: Boolean(effectiveAccount),
      source: "APEX",
      apex_license: true,
      buyer_email: req.customer || "",
      updated_at: now,
    };
    if (req.expiresAt !== undefined) set["expires_at"] = req.expiresAt;
    // Blank account deliberately leaves the license unbound so XauCloud's canonical
    // first-claim logic can bind it atomically to whichever live/demo MT5 account uses it first.
    if (req.resetAccount && !account) set["activated_at"] = null;
    try {
      await licenses.updateOne(
        { pin: key, $or: [{ source: "APEX" }, { apex_license: true }] },
        { $set: set, $setOnInsert: { id: randomUUID(), created_at: now } },
        { upsert: true },
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        return reply.code(409).send({ ok: false, error: "license_pin_conflicts_with_existing_xaucloud_license" });
      }
      throw error;
    }
    return { ok: true, license: maskLicense(key), active: req.active };
  });

  app.post("/cloud/apex/bridge/config/upsert", async (request, reply) => {
    const authError = requireBridgeAuthorization(request, reply);
    if (authError) return authError;
    const req = BridgeConfigSchema.parse(request.body);
    const key = normalizeLicenseKey(req.license);
    if (!key) return reply.code(400).send({ ok: false, error: "license_required" });
    // A stale revision must never overwrite a newer config that already reached Mongo.
    const col = getDb().collection("apex_bridge_configs");
    const existing = await col.findOne({ license_key: key }, { projection: { _id: 0, command_revision: 1 } });
    const existingRevision = Number(existing?.["command_revision"] || 0);
    if (existingRevision > req.commandRevision) {
      return reply.code(409).send({
        ok: false, error: "stale_config_revision",
        currentRevision: existingRevision, suppliedRevision: req.commandRevision,
      });
    }
    const now = new Date().toISOString();
    await col.updateOne(
      { license_key: key },
      { $set: { license_key: key, config: req.config, command_revision: req.commandRevision, updated_at: now },
        $setOnInsert: { created_at: now } },
      { upsert: true },
    );
    return { ok: true, license: maskLicense(key), commandRevision: req.commandRevision };
  });

  // Canonical paginated event ledger. The status endpoint's fixed window is not enough
  // to rebuild campaign History after the Apex host loses its local cache.
  app.get("/cloud/apex/bridge/events", async (request, reply) => {
    const authError = requireBridgeAuthorization(request, reply);
    if (authError) return authError;
    const q = z.object({
      license: z.string(),
      before: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(250),
    }).parse(request.query);
    const key = normalizeLicenseKey(q.license);
    const filter: Record<string, unknown> = { license_key: key };
    if (q.before) filter["ts"] = { $lt: q.before };
    const rows = await getDb().collection("apex_bridge_events")
      .find(filter, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(q.limit).toArray();
    const nextBefore = rows.length === q.limit ? String(rows[rows.length - 1]?.["ts"] || "") : null;
    return { ok: true, license: maskLicense(key), events: rows, nextBefore };
  });

  // Mongo-backed mirror for Apex push subscriptions / preferences / outbox / VAPID, so a
  // redeploy that wipes the Apex host's local data directory does not silently create a
  // blank notification universe (and a fresh VAPID identity that invalidates iPhones).
  app.get("/cloud/apex/bridge/state", async (request, reply) => {
    const authError = requireBridgeAuthorization(request, reply);
    if (authError) return authError;
    const q = z.object({ kind: z.string().min(1).max(120) }).parse(request.query);
    const row = await getDb().collection("apex_bridge_state")
      .findOne({ kind: q.kind }, { projection: { _id: 0 } });
    return {
      ok: true, kind: q.kind, exists: Boolean(row),
      value: row?.["value"] ?? null, updatedAt: row?.["updated_at"] ?? null,
    };
  });

  app.post("/cloud/apex/bridge/state/upsert", async (request, reply) => {
    const authError = requireBridgeAuthorization(request, reply);
    if (authError) return authError;
    const req = BridgeStateSchema.parse(request.body);
    await ensureApexIndexes().catch((error) => {
      request.log.warn({ err: error }, "Apex state index unavailable");
    });
    const now = new Date().toISOString();
    await getDb().collection("apex_bridge_state").updateOne(
      { kind: req.kind },
      { $set: { kind: req.kind, value: req.value, updated_at: now }, $setOnInsert: { created_at: now } },
      { upsert: true },
    );
    return { ok: true, kind: req.kind, updatedAt: now };
  });

  // Lets Apex rebuild its local license/config cache after a redeploy WITHOUT deleting or
  // recreating anything. Read-only projection over the Apex-owned pin_licenses rows.
  app.get("/cloud/apex/bridge/licenses", async (request, reply) => {
    const authError = requireBridgeAuthorization(request, reply);
    if (authError) return authError;
    const rows = await getDb().collection("pin_licenses").find(
      { $or: [{ source: "APEX" }, { apex_license: true }] },
      { projection: { _id: 0, pin: 1, is_active: 1, mt5_account: 1, is_used: 1, buyer_email: 1, expires_at: 1, created_at: 1, updated_at: 1 } },
    ).toArray();
    return {
      ok: true,
      licenses: rows.map((r) => ({
        license: String(r["pin"] || ""),
        active: r["is_active"] === true,
        account: String(r["mt5_account"] || ""),
        isUsed: r["is_used"] === true,
        customer: String(r["buyer_email"] || ""),
        expiresAt: r["expires_at"] ?? null,
        createdAt: r["created_at"] ?? null,
        updatedAt: r["updated_at"] ?? null,
      })),
    };
  });

  app.get("/cloud/apex/bridge/status", async (request, reply) => {
    const authError = requireBridgeAuthorization(request, reply);
    if (authError) return authError;
    const q = z.object({ license: z.string() }).parse(request.query);
    const key = normalizeLicenseKey(q.license);
    const db = getDb();
    const lic = await db.collection("pin_licenses").findOne({ pin: key }, { projection: { _id: 0 } });
    const hb = await db.collection("cloud_bot_heartbeats").findOne(
      { $or: [{ license_key: key }, { pin: key }] },
      { sort: { ts: -1 }, projection: { _id: 0 } },
    );
    const cfg = await db.collection("apex_bridge_configs").findOne({ license_key: key }, { projection: { _id: 0 } });
    const events = await db.collection("apex_bridge_events")
      .find({ license_key: key }, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(250).toArray();
    return {
      ok: true,
      license: {
        key: maskLicense(key),
        exists: Boolean(lic),
        active: lic?.["is_active"] === true,
        account: String(lic?.["mt5_account"] || ""),
        isUsed: lic?.["is_used"] === true,
        source: lic?.["source"] || null,
        apexLicense: lic?.["apex_license"] === true,
        lastSeen: lic?.["last_heartbeat"] || hb?.["last_heartbeat"] || hb?.["ts"] || null,
      },
      mt5: {
        status: connectedState(lic?.["last_heartbeat"] || hb?.["last_heartbeat"] || hb?.["ts"]),
        lastSeen: lic?.["last_heartbeat"] || hb?.["last_heartbeat"] || hb?.["ts"] || null,
      },
      heartbeat: hb || null,
      config: cfg?.["config"] || {},
      configExists: Boolean(cfg),
      commandRevision: Number(cfg?.["command_revision"] || 0),
      recentEvents: events,
    };
  });
}
