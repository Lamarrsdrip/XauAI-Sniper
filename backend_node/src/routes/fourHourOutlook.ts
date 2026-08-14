/**
 * XauCloud 4H Outlook -- HTTP routes (READ-ONLY + mark-seen).
 * Registered under the global /api prefix. Serves the dashboard card and the
 * expanded analysis view. No execution surface of any kind.
 */
import type { FastifyInstance } from "fastify";
import { requireCloudUser } from "../auth.js";
import { getFourHourCurrent, getFourHourHistory, markFourHourSeen } from "../services/fourHourOutlookService.js";

export async function registerFourHourOutlookRoutes(app: FastifyInstance): Promise<void> {
  // Current forecast for the dashboard card + expanded view.
  app.get("/cloud/4h-outlook/current", { preHandler: requireCloudUser }, async () => {
    const doc = await getFourHourCurrent();
    if (!doc) return { available: false, reason: "TEMPORARILY_UNAVAILABLE" };
    return { available: true, outlook: doc };
  });

  // Last N forecasts for accountability / history.
  app.get("/cloud/4h-outlook/history", { preHandler: requireCloudUser }, async (request) => {
    const q = (request.query as { limit?: string }) ?? {};
    const limit = Math.max(1, Math.min(100, Number(q.limit) || 30));
    return { history: await getFourHourHistory(limit) };
  });

  // Clear the "NEW" badge once the user has viewed the latest forecast.
  app.post("/cloud/4h-outlook/seen", { preHandler: requireCloudUser }, async () => {
    await markFourHourSeen();
    return { ok: true };
  });
}
