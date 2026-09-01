import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth.js";
import { getDb } from "../../db.js";
import { xPostingConfigured, xPostingSettings } from "../../services/xTradePosting.js";
import { completeXOAuthConnection, startXOAuthConnection, xOAuthClientConfigured } from "../../services/xOAuth.js";

const UpdateSchema = z.object({ auto_post_enabled: z.boolean(), confirm: z.literal(true) }).strict();

/** Browser-admin surface for the server-owned X integration.  The OAuth user
 * token is deliberately an environment secret and is never accepted here. */
export async function registerAdminXPostingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/x-posting/oauth/connect", { preHandler: requireAdmin }, async (request, reply) => {
    const admin = (request as typeof request & { admin?: Record<string, unknown> }).admin;
    const url = await startXOAuthConnection(String(admin?.["id"] ?? admin?.["email"] ?? "admin"));
    return reply.redirect(url);
  });

  app.get("/admin/x-posting/oauth/callback", async (request, reply) => {
    const query = z.object({ state: z.string().min(20).max(300), code: z.string().min(20).max(4000), error: z.string().optional() }).parse(request.query);
    if (query.error) return reply.code(400).send({ detail: "X account connection was declined." });
    await completeXOAuthConnection({ state: query.state, code: query.code });
    return reply.redirect("/admin?x_connected=1");
  });

  app.get("/admin/x-posting", { preHandler: requireAdmin }, async () => {
    const [settings, queued, posting, retrying, failed, blocked, posted] = await Promise.all([
      xPostingSettings(),
      getDb().collection("x_trade_posts").countDocuments({ status: { $in: ["QUEUED", "queued"] } }),
      getDb().collection("x_trade_posts").countDocuments({ status: { $in: ["PROCESSING", "posting"] } }),
      getDb().collection("x_trade_posts").countDocuments({ status: "RETRYING" }),
      getDb().collection("x_trade_posts").countDocuments({ status: { $in: ["FAILED", "failed"] } }),
      getDb().collection("x_trade_posts").countDocuments({ status: "BLOCKED_INVALID_TRADE_DATA" }),
      getDb().collection("x_trade_posts").countDocuments({ status: { $in: ["POSTED", "posted"] } }),
    ]);
    return { ...settings, oauth_client_configured: xOAuthClientConfigured(), queue: { queued, posting, retrying, failed, blocked, posted } };
  });

  app.put("/admin/x-posting", { preHandler: requireAdmin }, async (request, reply) => {
    const body = UpdateSchema.parse(request.body);
    if (body.auto_post_enabled && !await xPostingConfigured()) {
      return reply.code(409).send({ detail: "Connect the official X account before enabling automatic posting." });
    }
    await getDb().collection("x_posting_settings").updateOne(
      { id: "trade_posts" },
      { $set: { id: "trade_posts", auto_post_enabled: body.auto_post_enabled, post_wins: true, post_losses: true, post_breakeven: false, last_auto_post_at: null, updated_at: new Date().toISOString(), updated_by: "admin_dashboard" } },
      { upsert: true },
    );
    return { ...(await xPostingSettings()), updated: true };
  });
}
