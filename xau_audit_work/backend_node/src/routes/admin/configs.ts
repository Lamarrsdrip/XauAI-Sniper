import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin } from "../../auth.js";

const EAConfigCreateSchema = z.object({
  name: z.string().nullable().optional().default("Default Configuration"),
  risk_percent: z.number().nullable().optional().default(1.0),
  daily_loss_limit: z.number().nullable().optional().default(3.0),
  weekly_drawdown_limit: z.number().nullable().optional().default(5.0),
  weekly_profit_target: z.number().nullable().optional().default(35.0),
  max_open_trades: z.number().int().nullable().optional().default(2),
  max_trades_per_day: z.number().int().nullable().optional().default(3),
  enable_trend_mode: z.boolean().nullable().optional().default(true),
  enable_range_mode: z.boolean().nullable().optional().default(true),
  enable_breakout_mode: z.boolean().nullable().optional().default(true),
  confidence_threshold: z.number().int().nullable().optional().default(75),
  ema_fast: z.number().int().nullable().optional().default(50),
  ema_slow: z.number().int().nullable().optional().default(200),
  min_rr_ratio: z.number().nullable().optional().default(1.5),
  partial_close_percent: z.number().nullable().optional().default(50.0),
  trailing_atr_multi: z.number().nullable().optional().default(1.5),
  sl_atr_multiplier: z.number().nullable().optional().default(2.0),
  trade_london: z.boolean().nullable().optional().default(true),
  trade_new_york: z.boolean().nullable().optional().default(true),
  equity_protection: z.number().nullable().optional().default(70.0),
  profit_mode: z.string().nullable().optional().default("moderate"),
});

/** Port of server.py:3631/3639 admin EA-config CRUD (distinct from the public /configs Configurator submission). */
export async function registerAdminConfigsRoutes(app: FastifyInstance): Promise<void> {
  // POST /admin/configs -- server.py:3631
  app.post("/admin/configs", { preHandler: requireAdmin }, async (request) => {
    const data = EAConfigCreateSchema.parse(request.body ?? {});
    const doc = { id: randomUUID(), ...data, created_at: new Date().toISOString() };
    await getDb().collection("ea_configs").insertOne({ ...doc });
    return doc;
  });

  // GET /admin/configs -- server.py:3639
  app.get("/admin/configs", { preHandler: requireAdmin }, async () => {
    return getDb().collection("ea_configs").find({}, { projection: { _id: 0 } }).limit(100).toArray();
  });
}
