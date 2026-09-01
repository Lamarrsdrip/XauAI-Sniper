import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireCloudUser, rateLimit } from "../../auth.js";
import { normalizeLicenseKey, resolveMonitorLicense } from "../../services/license.js";
import { storeBotActivity } from "../../services/botActivity.js";
import { verifyCommandLicense } from "../../services/commandLicense.js";
import { normalizePropFirmConfig } from "../../services/propFirmConfig.js";
import {
  COMMAND_ALLOWED_SOURCE_STATUSES,
  COMMAND_TERMINAL_STATUSES,
  SAFE_REMOTE_COMMANDS,
  expireStalePendingCommands,
  normalizeForceClosePayload,
  normalizeForceOpenPayload,
  normalizeManualOpenNowPayload,
} from "../../services/commandStateMachine.js";

const CloudCommandReqSchema = z.object({
  action: z.string(),
  pin: z.string(),
  confirm: z.boolean().optional().default(false),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotency_key: z.string().nullable().optional(),
});

const CloudCommandAckReqSchema = z.object({
  command_id: z.string(),
  status: z.string(),
  message: z.string().optional().default(""),
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  account: z.string().optional().default(""),
  details: z.record(z.string(), z.unknown()).optional().nullable(),
});

const PendingQuerySchema = z.object({
  limit: z.coerce.number().optional().default(5),
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  account: z.string().optional().default(""),
});

const VALID_ACK_STATUSES = new Set(["ACKED", "EXECUTED", "FAILED", "SKIPPED"]);

/** Port of server.py:7946 GET /cloud/command/pending and :7962 POST /cloud/command/ack -- the live EA command channel. */
export async function registerCloudCommandRoutes(app: FastifyInstance): Promise<void> {
  // POST /cloud/command/request -- server.py:7864. Command Center's queue-a-
  // remote-command entry point (MANUAL_OPEN_NOW, FORCE_CLOSE_TRADE, etc).
  app.post("/cloud/command/request", { preHandler: requireCloudUser }, async (request, reply) => {
    const req = CloudCommandReqSchema.parse(request.body);
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    rateLimit(`command_request_user:${user["id"]}`, 20, 300);

    const action = req.action.toUpperCase().trim();
    if (!(action in SAFE_REMOTE_COMMANDS)) {
      return reply.code(400).send({ detail: "Unsupported Command Center action." });
    }
    if (!req.confirm) {
      return reply.code(400).send({ detail: "Confirmation is required before queueing a remote command." });
    }
    const lic = await verifyCommandLicense(user, req.pin);

    const now = new Date();
    const commandId = randomUUID();
    let payload: Record<string, unknown> = req.payload ?? {};
    if (action === "UPDATE_PROP_FIRM_CONFIG") payload = normalizePropFirmConfig(payload) as unknown as Record<string, unknown>;
    else if (action === "FORCE_OPEN_TRADE") payload = normalizeForceOpenPayload(payload);
    else if (action === "MANUAL_OPEN_NOW") payload = normalizeManualOpenNowPayload(payload);
    else if (action === "FORCE_CLOSE_TRADE") payload = normalizeForceClosePayload(payload);

    const clientKey = (req.idempotency_key ?? "").trim().slice(0, 120) || commandId;
    const dedupeKey = `${user["id"]}:${action}:${clientKey}`;
    const doc = {
      id: commandId,
      user_id: user["id"],
      user_email: user["email"] ?? "",
      license_key: lic["pin"] ?? "",
      mt5_account: lic["mt5_account"] ?? "",
      action,
      label: SAFE_REMOTE_COMMANDS[action],
      status: "PENDING",
      requested_at: now.toISOString(),
      payload,
      ack_at: "",
      ack_status: "",
      ack_message: "",
      ack_details: {},
      dedupe_key: dedupeKey,
    };

    const commands = getDb().collection("cloud_bot_commands");
    try {
      await commands.insertOne({ ...doc });
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) {
        const existing = await commands.findOne({ dedupe_key: dedupeKey }, { projection: { _id: 0 } });
        if (existing) {
          return { ok: true, command_id: existing["id"], status: existing["status"], action: existing["action"], duplicate: true };
        }
        return reply.code(409).send({ detail: "Duplicate command request could not be reconciled." });
      }
      throw err;
    }

    if (action === "UPDATE_PROP_FIRM_CONFIG") {
      await getDb()
        .collection("pin_licenses")
        .updateOne(
          { pin: lic["pin"] ?? "", is_active: true },
          {
            $set: {
              prop_firm_requested: payload,
              prop_firm_requested_at: now.toISOString(),
              prop_firm_command_id: commandId,
              prop_firm_apply_status: "PENDING",
              prop_firm_apply_message: "Waiting for EA acknowledgement.",
            },
          },
        );
    }

    await storeBotActivity(
      "REMOTE_COMMAND_QUEUED",
      "COMMAND",
      `${SAFE_REMOTE_COMMANDS[action]} queued for EA acknowledgement`,
      String(lic["mt5_account"] ?? ""),
      "",
      { command_id: commandId, action, user: user["email"] ?? "", license_key: lic["pin"] ?? "" },
    );

    return { ok: true, command_id: commandId, status: "PENDING", action, duplicate: false };
  });

  app.get("/cloud/command/pending", async (request) => {
    const q = PendingQuerySchema.parse(request.query);
    const raw = normalizeLicenseKey(q.license_key || q.pin || "");
    const lic = await resolveMonitorLicense(raw, q.account || "");
    const expired = await expireStalePendingCommands();

    const n = Math.max(1, Math.min(Math.trunc(q.limit), 10));
    const db = getDb();
    const query: Record<string, unknown> = { status: "PENDING" };
    if (lic?.["pin"]) query["license_key"] = lic["pin"];
    if (q.account) {
      query["$or"] = [
        { mt5_account: String(q.account) },
        { account: String(q.account) },
        { mt5_account: "" },
        { mt5_account: { $exists: false } },
      ];
    }
    const rows = await db
      .collection("cloud_bot_commands")
      .find(query, { projection: { _id: 0 } })
      .sort({ requested_at: 1 })
      .limit(n)
      .toArray();

    return { ok: true, commands: rows, next: rows[0] ?? null, count: rows.length, expired };
  });

  app.post("/cloud/command/ack", async (request, reply) => {
    const req = CloudCommandAckReqSchema.parse(request.body);
    const raw = normalizeLicenseKey(req.license_key || req.pin || "");
    const lic = await resolveMonitorLicense(raw, req.account || "");
    const status = (req.status || "").toUpperCase().trim();
    if (!VALID_ACK_STATUSES.has(status)) {
      return reply.code(400).send({ detail: "Invalid command acknowledgement status." });
    }

    const db = getDb();
    const commands = db.collection("cloud_bot_commands");
    const now = new Date();
    const command = await commands.findOne({ id: req.command_id }, { projection: { _id: 0 } });
    if (!command) {
      return reply.code(404).send({ detail: "Command not found." });
    }
    if (lic?.["pin"] && command["license_key"] && command["license_key"] !== lic["pin"]) {
      return reply.code(403).send({
        detail: {
          ok: false,
          reason: "COMMAND_LICENSE_MISMATCH",
          message: "This command belongs to a different license.",
          command_id: req.command_id,
        },
      });
    }

    // Atomic conditional transition -- see commandStateMachine.ts. Terminal
    // statuses are never in any allowed-source set, so they can never be
    // overwritten by a late/replayed ack or a second racing EA instance.
    const allowedFrom = Array.from(COMMAND_ALLOWED_SOURCE_STATUSES[status] ?? []);
    const updateResult = await commands.findOneAndUpdate(
      { id: req.command_id, status: { $in: allowedFrom } },
      {
        $set: {
          status,
          ack_at: now.toISOString(),
          ack_status: status,
          ack_message: String(req.message ?? "").slice(0, 400),
          ack_details: req.details ?? {},
        },
      },
      { returnDocument: "after", projection: { _id: 0 } },
    );

    if (!updateResult) {
      const current = await commands.findOne({ id: req.command_id }, { projection: { _id: 0 } });
      const currentStatus = current ? String(current["status"]) : "UNKNOWN";
      const reason = COMMAND_TERMINAL_STATUSES.has(currentStatus) ? "TERMINAL_STATE_IMMUTABLE" : "INVALID_TRANSITION";
      return { ok: true, command_id: req.command_id, status: currentStatus, applied: false, reason };
    }

    if (command["action"] === "UPDATE_PROP_FIRM_CONFIG") {
      const propUpdate: Record<string, unknown> = {
        prop_firm_apply_status: status,
        prop_firm_apply_message: String(req.message ?? "").slice(0, 400),
        prop_firm_apply_at: now.toISOString(),
      };
      if (status === "EXECUTED") {
        propUpdate["prop_firm_applied"] = command["payload"] ?? {};
        propUpdate["prop_firm_applied_at"] = now.toISOString();
      }
      await db
        .collection("pin_licenses")
        .updateOne({ pin: command["license_key"] ?? "", is_active: true }, { $set: propUpdate });
    }

    const severity = status === "ACKED" || status === "EXECUTED" ? "COMMAND" : "ERROR";
    const label = command["label"] ?? command["action"] ?? "Remote command";
    await storeBotActivity(
      `REMOTE_COMMAND_${status}`,
      severity,
      `${label}: ${req.message || status}`,
      String(command["mt5_account"] ?? req.account ?? ""),
      "",
      {
        command_id: req.command_id,
        action: command["action"] as string,
        status,
        license_key: String(command["license_key"] ?? ""),
      },
    );

    return { ok: true, command_id: req.command_id, status, applied: true };
  });
}
