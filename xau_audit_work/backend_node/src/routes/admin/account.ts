import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin, verifyPassword, hashPassword, createAccessToken, setAdminSessionCookie } from "../../auth.js";

const AdminAccountUpdateSchema = z.object({
  new_email: z.string().trim().email().max(320).nullable().optional(),
  new_password: z.string().min(8).max(256).nullable().optional(),
  current_password: z.string().min(1).max(256),
}).strict();

/** Port of server.py:3775 `update_admin_account` -- change admin email and/or password. */
export async function registerAdminAccountRoutes(app: FastifyInstance): Promise<void> {
  app.put("/admin/account", { preHandler: requireAdmin }, async (request, reply) => {
    const req = AdminAccountUpdateSchema.parse(request.body);
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const db = getDb();

    const user = await db.collection("users").findOne({ email: admin["email"] });
    if (!user) return reply.code(404).send({ detail: "Admin user not found" });
    if (!(await verifyPassword(req.current_password, String(user["password_hash"] ?? "")))) {
      return reply.code(401).send({ detail: "Current password is incorrect" });
    }

    const updates: Record<string, unknown> = {};
    if (req.new_email && req.new_email.trim()) {
      const newEmail = req.new_email.trim().toLowerCase();
      if (newEmail !== admin["email"]) {
        const existing = await db.collection("users").findOne({ email: newEmail });
        if (existing) return reply.code(400).send({ detail: "Email already in use" });
        updates["email"] = newEmail;
      }
    }
    if (req.new_password && req.new_password.trim()) {
      updates["password_hash"] = await hashPassword(req.new_password);
    }
    if (Object.keys(updates).length === 0) {
      return { updated: false, message: "No changes provided" };
    }

    const nextSessionVersion = Number(user["session_version"] ?? 0) + 1;
    await db.collection("users").updateOne(
      { email: admin["email"] },
      { $set: updates, $inc: { session_version: 1 } },
    );
    const newEmail = (updates["email"] as string | undefined) ?? String(admin["email"]);
    const newToken = createAccessToken(String(user["_id"]), newEmail, nextSessionVersion);
    setAdminSessionCookie(reply, newToken);
    return { updated: true, email: newEmail, message: "Account updated successfully" };
  });
}
