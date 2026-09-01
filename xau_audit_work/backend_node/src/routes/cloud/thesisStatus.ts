import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { normalizeLicenseKey, resolveMonitorLicense } from "../../services/license.js";
import { TradeThesisStatusReqSchema } from "../../models/lease.js";

/** Port of server.py:7846 `POST /cloud/monitor/thesis-status` -- upserted per-ticket live state, not appended. */
export async function registerCloudThesisStatusRoutes(app: FastifyInstance): Promise<void> {
  app.post("/cloud/monitor/thesis-status", async (request, reply) => {
    const req = TradeThesisStatusReqSchema.parse(request.body);
    const licenseKey = normalizeLicenseKey(req.license_key || req.pin || "");
    const lic = await resolveMonitorLicense(licenseKey, req.account || "");
    if (!req.ticket) return reply.code(400).send({ detail: "ticket is required" });

    const doc: Record<string, unknown> = { ...req };
    doc["license_key"] = licenseKey;
    doc["license_id"] = lic?.["id"] ?? "";
    doc["updated_at"] = new Date().toISOString();

    await getDb()
      .collection("cloud_trade_thesis_status")
      .updateOne({ license_key: licenseKey, ticket: req.ticket }, { $set: doc }, { upsert: true });
    return { ok: true };
  });
}
