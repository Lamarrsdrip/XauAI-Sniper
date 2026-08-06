import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin, verifyPassword } from "../../auth.js";
import { generateUniquePin } from "../../services/paymentFulfillment.js";

const PinGenerateRequestSchema = z.object({
  count: z.number().int().default(1),
  buyer_name: z.string().nullable().optional().default(""),
  buyer_email: z.string().nullable().optional().default(""),
  notes: z.string().nullable().optional().default(""),
});

const AdminLicenseResetRequestSchema = z.object({ admin_password: z.string(), reason: z.string() });

/** Port of server.py's admin PIN license management routes (lines 3486-3629). */
export async function registerAdminPinsRoutes(app: FastifyInstance): Promise<void> {
  // POST /admin/pins/generate -- server.py:3486
  app.post("/admin/pins/generate", { preHandler: requireAdmin }, async (request) => {
    const req = PinGenerateRequestSchema.parse(request.body ?? {});
    const count = Math.min(req.count, 50);
    const db = getDb();
    const pins: Record<string, unknown>[] = [];
    for (let i = 0; i < count; i++) {
      let pin = generateUniquePin();
      while (await db.collection("pin_licenses").findOne({ pin })) pin = generateUniquePin();
      const doc = {
        id: randomUUID(),
        pin,
        buyer_name: req.buyer_name ?? "",
        buyer_email: req.buyer_email ?? "",
        is_active: true,
        is_used: false,
        activated_at: null,
        mt5_account: null,
        created_at: new Date().toISOString(),
        notes: req.notes ?? "",
        payment_ref: null,
      };
      await db.collection("pin_licenses").insertOne({ ...doc });
      pins.push(doc);
    }
    return { pins_created: pins.length, pins };
  });

  // GET /admin/pins -- server.py:3499
  app.get("/admin/pins", { preHandler: requireAdmin }, async () => {
    const pins = await getDb().collection("pin_licenses").find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(100).toArray();
    return { total: pins.length, pins };
  });

  // GET /admin/pins/stats -- server.py:3504
  app.get("/admin/pins/stats", { preHandler: requireAdmin }, async () => {
    const [facet] = await getDb()
      .collection("pin_licenses")
      .aggregate<{
        total?: { c: number }[];
        active?: { c: number }[];
        used?: { c: number }[];
        revoked?: { c: number }[];
      }>([
        {
          $facet: {
            total: [{ $count: "c" }],
            active: [{ $match: { is_active: true } }, { $count: "c" }],
            used: [{ $match: { is_used: true } }, { $count: "c" }],
            revoked: [{ $match: { is_active: false } }, { $count: "c" }],
          },
        },
      ])
      .toArray();
    const r = facet ?? {};
    const total = r.total?.[0]?.c ?? 0;
    const active = r.active?.[0]?.c ?? 0;
    const used = r.used?.[0]?.c ?? 0;
    const revoked = r.revoked?.[0]?.c ?? 0;
    return { total, active, used, unused: active - used, revoked };
  });

  // PUT /admin/pins/:pin/revoke -- server.py:3570
  app.put("/admin/pins/:pin/revoke", { preHandler: requireAdmin }, async (request, reply) => {
    const { pin } = request.params as { pin: string };
    const r = await getDb().collection("pin_licenses").updateOne({ pin }, { $set: { is_active: false } });
    if (r.matchedCount === 0) return reply.code(404).send({ detail: "Not found" });
    return { revoked: true };
  });

  // PUT /admin/pins/:pin/activate -- server.py:3576
  app.put("/admin/pins/:pin/activate", { preHandler: requireAdmin }, async (request, reply) => {
    const { pin } = request.params as { pin: string };
    const r = await getDb().collection("pin_licenses").updateOne({ pin }, { $set: { is_active: true } });
    if (r.matchedCount === 0) return reply.code(404).send({ detail: "Not found" });
    return { activated: true };
  });

  // DELETE /admin/pins/:pin -- server.py:3582
  app.delete("/admin/pins/:pin", { preHandler: requireAdmin }, async (request, reply) => {
    const { pin } = request.params as { pin: string };
    const r = await getDb().collection("pin_licenses").deleteOne({ pin });
    if (r.deletedCount === 0) return reply.code(404).send({ detail: "Not found" });
    return { deleted: true };
  });

  // POST /admin/pins/:pin/reset-account -- server.py:3594
  app.post("/admin/pins/:pin/reset-account", { preHandler: requireAdmin }, async (request, reply) => {
    const { pin } = request.params as { pin: string };
    const req = AdminLicenseResetRequestSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const db = getDb();

    const user = await db.collection("users").findOne({ email: admin["email"] });
    if (!user || !(await verifyPassword(req.admin_password, String(user["password_hash"] ?? "")))) {
      return reply.code(401).send({ detail: "Admin password is incorrect" });
    }
    if (!req.reason || !req.reason.trim()) {
      return reply.code(400).send({ detail: "A reason is required for a license account reset." });
    }
    const lic = await db.collection("pin_licenses").findOne({ pin }, { projection: { _id: 0 } });
    if (!lic) return reply.code(404).send({ detail: "License not found" });

    const previousAccount = String(lic["mt5_account"] ?? "");
    const nowIso = new Date().toISOString();
    await db.collection("pin_licenses").updateOne({ pin }, { $set: { mt5_account: null, is_used: false, activated_at: null } });
    await db.collection("license_reset_audit_log").insertOne({
      id: randomUUID(),
      pin,
      previous_account: previousAccount,
      new_account: null,
      reason: req.reason.trim(),
      admin_email: admin["email"],
      reset_at: nowIso,
    });
    if (previousAccount) {
      await db.collection("cloud_direction_reservations").deleteMany({ account: previousAccount, licenseId: lic["id"] ?? "" });
    }
    return { reset: true, pin, previous_account: previousAccount };
  });
}
