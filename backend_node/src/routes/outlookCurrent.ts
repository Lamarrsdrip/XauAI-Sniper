import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";
import { requireCloudUser } from "../auth.js";
import { getUserLicense } from "../services/commandLicense.js";
import { normalizeLicenseKey } from "../services/license.js";
import { buildResultConversion } from "../services/marketOutlookCore.js";
import { buildAuthoritativeOutlookContract, computeOutlookFreshness, latestEaEvidence } from "../services/marketOutlookEvidence.js";

function cloudUser(request: unknown): Record<string, unknown> {
  return (request as { cloudUser: Record<string, unknown> }).cloudUser;
}

/** Port of market_outlook_routes.py:285 `GET /outlook/current` -- the single authoritative "what should a customer see right now" endpoint. */
export async function registerOutlookCurrentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/outlook/current", { preHandler: requireCloudUser }, async (request) => {
    const db = getDb();
    const user = cloudUser(request);
    const lic = await getUserLicense(user);
    const account = String(lic?.["mt5_account"] ?? "").trim();
    const licenseKey = lic ? normalizeLicenseKey(String(lic["pin"] ?? "")) : "";
    if (!account && !licenseKey) return { outlook: null, reason: "license_not_linked" };

    const scope = account && licenseKey ? { $or: [{ account }, { license_key: licenseKey }] } : account ? { account } : { license_key: licenseKey };
    const outlooks = db.collection("cloud_market_outlooks");

    const doc = await outlooks.findOne(scope, { projection: { _id: 0 }, sort: { generated_at: -1 } });
    const hourlyDoc = await outlooks.findOne(
      { $and: [scope, { $or: [{ publication_mode: "HOURLY" }, { publication_mode: { $exists: false } }] }] },
      { projection: { _id: 0 }, sort: { generated_at: -1 } },
    );
    const signalDoc = await outlooks.findOne(
      { $and: [scope, { primary_direction: { $in: ["BUY", "SELL"] } }] },
      { projection: { _id: 0 }, sort: { generated_at: -1 } },
    );

    const { evidence, reason: evidenceReason } = await latestEaEvidence(licenseKey, account);
    const now = new Date();
    let evidenceAgeSeconds: number | null = null;
    if (evidence?.["ts"]) {
      const ts = new Date(String(evidence["ts"]).replace("Z", "+00:00"));
      if (!Number.isNaN(ts.getTime())) evidenceAgeSeconds = (now.getTime() - ts.getTime()) / 1000;
    }
    const nextSlot = new Date(now);
    nextSlot.setUTCMinutes(0, 0, 0);
    nextSlot.setUTCHours(nextSlot.getUTCHours() + 1);

    let latestNotification: Record<string, unknown> | null = null;
    if (signalDoc) {
      latestNotification = await db.collection("cloud_notification_log").findOne({ outlook_id: signalDoc["id"] }, { projection: { _id: 0 }, sort: { scheduled_time: -1 } });
    }

    const contract = buildAuthoritativeOutlookContract({
      evidence,
      evidence_reason: evidenceReason,
      hourly_doc: hourlyDoc,
      signal_doc: signalDoc,
      notification: latestNotification,
      now,
      latest_doc: doc,
    });

    const freshness = computeOutlookFreshness(doc, signalDoc, evidenceReason, now);
    let currentOutlook: Record<string, unknown> | null = null;
    if (freshness.outlook_id) {
      if (signalDoc && signalDoc["id"] === freshness.outlook_id) currentOutlook = signalDoc;
      else if (doc && doc["id"] === freshness.outlook_id) currentOutlook = doc;
    }

    const diagnostics = {
      last_ea_evidence_at: evidence?.["ts"] ?? null,
      evidence_age_seconds: evidenceAgeSeconds,
      evidence_symbol: evidence?.["symbol"] ?? null,
      evidence_status: evidenceReason,
      last_outlook_generated_at: doc?.["generated_at"] ?? null,
      next_outlook_at: nextSlot.toISOString(),
      generation_status: evidence ? "OK" : evidenceReason,
    };

    if (currentOutlook !== null) {
      const riskDistance = currentOutlook["risk_distance"];
      const fields: [string, string, string][] = [
        ["current_r", "current_pips", "current_gold_moves"],
        ["mfe_r", "mfe_pips", "mfe_gold_moves"],
        ["mae_r", "mae_pips", "mae_gold_moves"],
      ];
      for (const [rField, pipsField, goldField] of fields) {
        const rVal = currentOutlook[rField];
        if (rVal !== null && rVal !== undefined && riskDistance) {
          const conv = buildResultConversion({ r: Number(rVal), risk_distance: Number(riskDistance) });
          currentOutlook[pipsField] = conv.result_pips;
          currentOutlook[goldField] = conv.result_gold_moves;
        } else {
          currentOutlook[pipsField] = null;
          currentOutlook[goldField] = null;
        }
      }
    }

    return { contract, freshness, outlook: currentOutlook, hourly_context: hourlyDoc, diagnostics };
  });
}
