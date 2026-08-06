import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { requireCloudUser } from "../../auth.js";
import { TradingUniverseSettingsSchema } from "../../models/tradingUniverse.js";

/** Port of server.py:6648 GET/POST /cloud/trading-universe. */
export async function registerTradingUniverseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/cloud/trading-universe", { preHandler: requireCloudUser }, async (request) => {
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const doc = await getDb().collection("trading_universe_settings").findOne({ user_id: user["id"] }, { projection: { _id: 0 } });
    return TradingUniverseSettingsSchema.parse(doc ?? {});
  });

  app.post("/cloud/trading-universe", { preHandler: requireCloudUser }, async (request) => {
    const req = TradingUniverseSettingsSchema.parse(request.body);
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const doc: Record<string, unknown> = { ...req, user_id: user["id"], updated_at: new Date().toISOString() };
    await getDb().collection("trading_universe_settings").updateOne({ user_id: user["id"] }, { $set: doc }, { upsert: true });
    return { ok: true, settings: doc };
  });
}
