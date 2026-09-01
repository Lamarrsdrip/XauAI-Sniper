import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { getDb } from "../../db.js";
import { resolveMonitorLicense } from "../../services/license.js";
import { DirectionReservationClaimReqSchema, DirectionReservationReleaseReqSchema } from "../../models/cloudActivity.js";

const RESERVATION_VALID_SYMBOLS = new Set(["XAUUSD", "XAUUSDM", "XAUUSD.", "GOLD"]);

/** Port of server.py `_reservation_key`. */
function reservationKey(brokerServer: string, account: string, symbol: string): string {
  return `${(brokerServer || "").trim()}:${(account || "").trim()}:${(symbol || "").trim()}`;
}

/**
 * Port of server.py:7456-7561 -- cross-instance atomic direction reservation.
 * Mac and VPS terminals are separate processes with no shared memory; this
 * backend (both terminals already call it for heartbeat/activity) is the
 * only place true cross-machine atomicity is possible. Atomicity comes from
 * MongoDB's unique `_id` constraint on the reservation key
 * (broker_server:account:symbol): an upsert whose filter requires the
 * existing document to be expired fails with a duplicate-key error when a
 * live (unexpired) reservation already holds that `_id` -- there is no
 * read-then-write race window.
 */
export async function registerCloudReservationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/cloud/reservation/claim", async (request, reply) => {
    const req = DirectionReservationClaimReqSchema.parse(request.body);
    if (req.direction !== 1 && req.direction !== -1) {
      return reply.code(400).send({ detail: "direction must be 1 or -1" });
    }
    if (!req.broker_server || !req.account || !req.symbol) {
      return reply.code(400).send({ detail: "broker_server, account, and symbol are required" });
    }
    if (!RESERVATION_VALID_SYMBOLS.has(req.symbol.toUpperCase())) {
      return reply.code(400).send({ detail: { ok: false, reason: "INVALID_SYMBOL", symbol: req.symbol } });
    }

    const lic = await resolveMonitorLicense(req.pin || req.license_key, req.account);
    const executionKey = (req.execution_key || "").trim();
    if (!executionKey || executionKey.length > 240) {
      return reply.code(400).send({ detail: "execution_key is required and must be at most 240 characters" });
    }

    const key = reservationKey(req.broker_server, req.account, req.symbol);
    const now = new Date();
    const ttl = Math.max(5, Math.min(Math.trunc(req.ttl_seconds || 30), 120));
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    const reservationId = randomUUID();

    const reservations = getDb().collection("cloud_direction_reservations");
    try {
      await reservations.findOneAndUpdate(
        { _id: key as unknown as never, expiresAt: { $lte: now.toISOString() } },
        {
          $set: {
            direction: req.direction,
            requestingFamily: req.requesting_family,
            executionKey,
            reservationId,
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            terminalIdentity: req.terminal_identity,
            brokerServer: req.broker_server,
            account: req.account,
            symbol: req.symbol,
            licenseId: lic?.["id"] ?? "",
          },
        },
        { upsert: true },
      );
      return { claimed: true, reservationId, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) {
        const existing = await reservations.findOne({ _id: key as unknown as never }, { projection: { _id: 0 } });
        return {
          claimed: false,
          reason: "ACTIVE_EXECUTION_RESERVED",
          existingDirection: existing?.["direction"] ?? null,
          existingFamily: existing?.["requestingFamily"] ?? null,
          existingTerminal: existing?.["terminalIdentity"] ?? null,
          sameExecution: Boolean(existing && existing["executionKey"] === executionKey),
        };
      }
      throw err;
    }
  });

  app.post("/cloud/reservation/release", async (request) => {
    const req = DirectionReservationReleaseReqSchema.parse(request.body);
    const lic = await resolveMonitorLicense(req.pin || req.license_key, req.account);
    const key = reservationKey(req.broker_server, req.account, req.symbol);
    const db = getDb();
    const reservations = db.collection("cloud_direction_reservations");

    const result = await reservations.deleteOne({
      _id: key as unknown as never,
      reservationId: req.reservation_id,
      licenseId: lic?.["id"] ?? "",
    });
    const released = result.deletedCount > 0;
    return { released };
  });
}
