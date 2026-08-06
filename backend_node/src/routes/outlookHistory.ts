import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { clientIp, rateLimit, requireCloudUser } from "../auth.js";
import { getUserLicense } from "../services/commandLicense.js";
import { normalizeLicenseKey } from "../services/license.js";
import { buildPublicOutlookPerformance, computeOutlookStats, groupMeaningfulHistory } from "../services/marketOutlookStats.js";

function cloudUser(request: unknown): Record<string, unknown> {
  return (request as { cloudUser: Record<string, unknown> }).cloudUser;
}

const HistoryQuerySchema = z.object({
  direction: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  tp: z.string().nullable().optional(),
  result: z.string().nullable().optional(),
  min_confidence: z.coerce.number().nullable().optional(),
  max_confidence: z.coerce.number().nullable().optional(),
  from_date: z.string().nullable().optional(),
  to_date: z.string().nullable().optional(),
  limit: z.coerce.number().min(1).max(200).optional().default(50),
});

/** Port of market_outlook_routes.py:379 GET /outlook/history, :450 GET /outlook/public-performance, :455 GET /outlook/{outlook_id}. */
export async function registerOutlookHistoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/outlook/history", { preHandler: requireCloudUser }, async (request) => {
    const q = HistoryQuerySchema.parse(request.query);
    const db = getDb();
    const user = cloudUser(request);
    const lic = await getUserLicense(user);
    const account = String(lic?.["mt5_account"] ?? "").trim();
    const licenseKey = lic ? normalizeLicenseKey(String(lic["pin"] ?? "")) : "";
    if (!account && !licenseKey) {
      return { outlooks: [], timeline: [], signal_events: [], stats: {}, reason: "license_not_linked" };
    }

    const scope = account && licenseKey ? { $or: [{ account }, { license_key: licenseKey }] } : account ? { account } : { license_key: licenseKey };
    const conditions: Record<string, unknown>[] = [scope];
    if (q.direction && q.direction !== "All") conditions.push({ primary_direction: q.direction });
    if (q.color && q.color !== "All") conditions.push({ color_state: q.color });
    if (q.tp) {
      conditions.push(q.tp.startsWith("TP") ? { highest_tp_reached: { $gte: Number(q.tp.replace("TP", "")) } } : { status: q.tp });
    }
    if (q.result) conditions.push({ final_result: q.result });
    if (q.min_confidence !== null && q.min_confidence !== undefined) conditions.push({ confidence_pct: { $gte: q.min_confidence } });
    if (q.max_confidence !== null && q.max_confidence !== undefined) conditions.push({ confidence_pct: { $lte: q.max_confidence } });
    if (q.from_date) conditions.push({ generated_at: { $gte: q.from_date } });
    if (q.to_date) conditions.push({ generated_at: { $lte: q.to_date } });
    const query = { $and: conditions };

    const outlooks = db.collection("cloud_market_outlooks");
    const rows = await outlooks.find(query, { projection: { _id: 0 } }).sort({ generated_at: -1 }).limit(q.limit).toArray();

    const statsProjection = {
      _id: 0,
      excluded_from_stats: 1,
      historical_repair_status: 1,
      analytics_outcome: 1,
      primary_direction: 1,
      excluded_from_signal_analytics: 1,
      highest_tp_reached: 1,
      analytics_r: 1,
      mfe_r: 1,
      mae_r: 1,
      risk_distance: 1,
    };
    const statsRows = await outlooks.find(query, { projection: statsProjection }).toArray();
    const stats = computeOutlookStats(statsRows);

    const signalEvents = await db
      .collection("cloud_outlook_signal_events")
      .find(scope, { projection: { _id: 0 } })
      .sort({ event_time: -1 })
      .limit(q.limit)
      .toArray();

    return { outlooks: rows, timeline: groupMeaningfulHistory(rows), signal_events: signalEvents, stats };
  });

  // Public marketing-site feed -- unauthenticated by design, no caching layer.
  app.get("/outlook/public-performance", async (request) => {
    const q = z.object({ limit: z.coerce.number().min(1).max(200).optional().default(10) }).parse(request.query);
    rateLimit(`outlook_public_performance_ip:${clientIp(request)}`, 60, 60);
    return buildPublicOutlookPerformance(getDb(), q.limit);
  });

  app.get("/outlook/:outlook_id", { preHandler: requireCloudUser }, async (request, reply) => {
    const { outlook_id: outlookId } = request.params as { outlook_id: string };
    const db = getDb();
    const user = cloudUser(request);
    const lic = await getUserLicense(user);
    const account = String(lic?.["mt5_account"] ?? "").trim();
    const licenseKey = lic ? normalizeLicenseKey(String(lic["pin"] ?? "")) : "";
    if (!account && !licenseKey) return reply.code(404).send({ detail: "outlook not found" });

    const scope = account && licenseKey ? { $or: [{ account }, { license_key: licenseKey }] } : account ? { account } : { license_key: licenseKey };
    const doc = await db.collection("cloud_market_outlooks").findOne({ $and: [{ id: outlookId }, scope] }, { projection: { _id: 0 } });
    if (!doc) return reply.code(404).send({ detail: "outlook not found" });

    const revisions = await db
      .collection("cloud_market_outlook_revisions")
      .find({ outlook_id: outlookId }, { projection: { _id: 0 } })
      .sort({ revision_time: 1 })
      .limit(200)
      .toArray();
    return { outlook: doc, revisions };
  });
}
