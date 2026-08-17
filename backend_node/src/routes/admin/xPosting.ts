import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth.js";
import { getDb } from "../../db.js";
import { xPostingConfigured, xPostingSettings } from "../../services/xTradePosting.js";

const UpdateSchema = z.object({ auto_post_enabled: z.boolean(), confirm: z.literal(true) }).strict();

/** Browser-admin surface for the server-owned X integration.  The OAuth user
 * token is deliberately an environment secret and is never accepted here. */
export async function registerAdminXPostingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/x-posting", { preHandler: requireAdmin }, async () => {
    const [settings, queued, posting, failed, posted] = await Promise.all([
      xPostingSettings(),
      getDb().collection("x_trade_posts").countDocuments({ status: "queued" }),
      getDb().collection("x_trade_posts").countDocuments({ status: "posting" }),
      getDb().collection("x_trade_posts").countDocuments({ status: "failed" }),
      getDb().collection("x_trade_posts").countDocuments({ status: "posted" }),
    ]);
    return { ...settings, queue: { queued, posting, failed, posted } };
  });

  app.put("/admin/x-posting", { preHandler: requireAdmin }, async (request, reply) => {
    const body = UpdateSchema.parse(request.body);
    if (body.auto_post_enabled && !xPostingConfigured()) {
      return reply.code(409).send({ detail: "X_USER_ACCESS_TOKEN is not configured in the production server environment." });
    }
    await getDb().collection("x_posting_settings").updateOne(
      { id: "trade_posts" },
      { $set: { id: "trade_posts", auto_post_enabled: body.auto_post_enabled, post_wins: true, post_losses: true, post_breakeven: false, last_auto_post_at: null, updated_at: new Date().toISOString(), updated_by: "admin_dashboard" } },
      { upsert: true },
    );
    return { ...(await xPostingSettings()), updated: true };
  });
}
