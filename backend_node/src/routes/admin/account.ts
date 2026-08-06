import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin, verifyPassword, hashPassword, createAccessToken, setAdminSessionCookie } from "../../auth.js";

const AdminAccountUpdateSchema = z.object({
  new_email: z.string().nullable().optional(),
  new_password: z.string().nullable().optional(),
  current_password: z.string(),
});

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
      if (req.new_password.length < 6) return reply.code(400).send({ detail: "Password must be at least 6 characters" });
      updates["password_hash"] = await hashPassword(req.new_password);
    }
    if (Object.keys(updates).length === 0) {
      return { updated: false, message: "No changes provided" };
    }

    await db.collection("users").updateOne({ email: admin["email"] }, { $set: updates });
    const newEmail = (updates["email"] as string | undefined) ?? String(admin["email"]);
    const newToken = createAccessToken(String(user["_id"]), newEmail);
    setAdminSessionCookie(reply, newToken);
    return { updated: true, email: newEmail, message: "Account updated successfully" };
  });
}
