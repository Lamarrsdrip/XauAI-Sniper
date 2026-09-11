import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { normalizeLicenseKey, resolveEaMonitorLicense } from "../../services/license.js";
import { storeBotActivity } from "../../services/botActivity.js";
import { sendPatternActivityNotification, sendTradeActivityNotification } from "../../services/notifications.js";
import { ACTIVITY_DETAIL_FIELDS, BotActivityReqSchema } from "../../models/cloudActivity.js";
import { runMarketIntelligenceForEaRequest } from "../../services/marketIntelligencePipeline.js";

/** Port of server.py:7343 `POST /cloud/monitor/activity` -- remote monitoring only, never executes trades. */
export async function registerCloudActivityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/cloud/monitor/activity", async (request) => {
    const req = BotActivityReqSchema.parse(request.body);
    const licenseKey = normalizeLicenseKey(req.license_key || req.pin || "");
    const lic = await resolveEaMonitorLicense(licenseKey, req.account || "");

    const details: Record<string, unknown> = { ...(req.details ?? {}) };
    for (const field of ACTIVITY_DETAIL_FIELDS) {
      const value = req[field];
      if (value !== null && value !== undefined && value !== "") {
        details[field] = value;
      }
    }
    if (licenseKey) {
      details["license_key"] = licenseKey;
      details["license_id"] = lic?.["id"] ?? "";
    }

    // Production EA pattern telemetry:
    // PATTERN_CONFIRMED|name=...|score=...|timeframe=M10|symbol=XAUUSD
    //
    // Parsing lives here so Pattern Scanner receives structured fields while
    // the EA can continue using the existing BotMonitorActivity transport.
    if (String(req.event_type ?? "").toUpperCase().includes("PATTERN")) {
      const patternFields: Record<string, string> = {};

      for (const token of String(req.message ?? "").split("|").slice(1)) {
        const eq = token.indexOf("=");
        if (eq <= 0) continue;

        const key = token.slice(0, eq).trim();
        const value = token.slice(eq + 1).trim();

        if (key && value) patternFields[key] = value;
      }

      if (patternFields["name"] && !details["pattern_name"]) {
        details["pattern_name"] = patternFields["name"];
      }

      if (patternFields["timeframe"] && !details["pattern_timeframe"]) {
        details["pattern_timeframe"] = patternFields["timeframe"];
      }

      if (patternFields["symbol"] && !details["pattern_symbol"]) {
        details["pattern_symbol"] = patternFields["symbol"];
      }

      if (patternFields["direction"] && !details["pattern_direction"]) {
        details["pattern_direction"] = patternFields["direction"];
      }

      const patternScore = Number(patternFields["score"]);
      if (
        Number.isFinite(patternScore) &&
        details["pattern_score"] == null
      ) {
        details["pattern_score"] = patternScore;
      }

      details["pattern_confirmed"] = true;
    }

    const doc = await storeBotActivity(req.event_type, req.severity, req.message, req.account || "", req.symbol || "", details);

    const db = getDb();
    await db.collection("cloud_settings").updateOne(
      { key: "main" },
      { $set: { monitor_last_activity_at: doc["ts"], monitor_last_activity: doc } },
      { upsert: true },
    );

    // Push dispatch is observational and isolated from the EA response --
    // fire-and-forget, matches server.py's asyncio.create_task pattern.
    void (async () => {
      try {
        await sendTradeActivityNotification(doc);
        await sendPatternActivityNotification(doc);
      } catch {
        /* best-effort, matches Python's logged-but-swallowed exception */
      }
    })();

    const evidenceReceipt = (doc["market_evidence"] && typeof doc["market_evidence"] === "object")
      ? doc["market_evidence"] as Record<string, unknown>
      : {};
    // Canonical market-intelligence pipeline. Unlike the old fire-and-forget
    // block, failures are durably recorded and the next heartbeat/activity
    // can safely retry because all downstream writes are idempotent. The EA
    // is never held beyond the response budget (see marketIntelligenceConfig).
    const intelligence = await runMarketIntelligenceForEaRequest({
      license_key: licenseKey,
      account: req.account || "",
      source_event_id: String(evidenceReceipt["evidence_id"] ?? doc["id"] ?? ""),
      event_at: String(doc["ts"] ?? new Date().toISOString()),
      details,
      route: "/api/cloud/monitor/activity",
      request_id: request.id,
    });

    return { ok: true, event_id: doc["id"], evidence_id: evidenceReceipt["evidence_id"] ?? null, intelligence };
  });
}
