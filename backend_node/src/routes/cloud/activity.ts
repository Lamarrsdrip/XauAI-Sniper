import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { normalizeLicenseKey, resolveMonitorLicense } from "../../services/license.js";
import { storeBotActivity } from "../../services/botActivity.js";
import { sendPatternActivityNotification, sendTradeActivityNotification } from "../../services/notifications.js";
import { extractEvidenceQuoteFromDetails } from "../../services/marketOutlookEvidence.js";
import { trackOutlookLifecycleTick } from "../../services/marketOutlookTick.js";
import { publishM10SignalFromActivity } from "../../services/marketOutlookPublish.js";
import { mirrorSubscriberM10Evaluation } from "../../services/subscriberSignalFeed.js";
import { hourlyGenerationTick } from "../../services/marketOutlookHourlyTick.js";
import { enqueueIfActionable } from "../../services/outlookExecution.js";
import { ACTIVITY_DETAIL_FIELDS, BotActivityReqSchema } from "../../models/cloudActivity.js";

/** Port of server.py:7343 `POST /cloud/monitor/activity` -- remote monitoring only, never executes trades. */
export async function registerCloudActivityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/cloud/monitor/activity", async (request) => {
    const req = BotActivityReqSchema.parse(request.body);
    const licenseKey = normalizeLicenseKey(req.license_key || req.pin || "");
    const lic = await resolveMonitorLicense(licenseKey, req.account || "");

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

    // Outlook quote-event monitor -- fire-and-forget, never affects this
    // endpoint's own response. Port of server.py:7387 `_monitor_outlook_quote_event`.
    const normalizedQuote = extractEvidenceQuoteFromDetails(details, doc["ts"]);
    const quoteBid = Number(normalizedQuote.bid ?? 0);
    const quoteAsk = Number(normalizedQuote.ask ?? 0);
    if (quoteBid > 0 && quoteAsk >= quoteBid && req.account) {
      void (async () => {
        try {
          await trackOutlookLifecycleTick({ account: req.account || "", bid: quoteBid, ask: quoteAsk, quote_at: doc["ts"] });
          const m10Signal = (details["m10_signal"] as Record<string, unknown> | undefined) ?? {};
          // Continuous evaluation-freshness mirror -- runs on every heartbeat
          // regardless of decision, so a subscriber's "last evaluated" never
          // goes stale just because the engine stayed in WATCHING. No-op for
          // every account except the configured subscriber-signal source.
          await mirrorSubscriberM10Evaluation(req.account || "", m10Signal, doc["ts"]);
          const m10Decision = String(m10Signal["decision"] ?? m10Signal["final_decision"] ?? "").toUpperCase();
          if (["BUY_CANDIDATE", "SELL_CANDIDATE", "ALLOW_CORE"].includes(m10Decision)) {
            const m10Doc = await publishM10SignalFromActivity(licenseKey, req.account || "", String(doc["id"]));
            if (m10Doc) await enqueueIfActionable(m10Doc);
          }
          const [, hourlyActionable] = await hourlyGenerationTick(req.account || "");
          for (const hDoc of hourlyActionable) await enqueueIfActionable(hDoc);
        } catch {
          /* best-effort, matches Python's logged-but-swallowed exception */
        }
      })();
    }

    return { ok: true, event_id: doc["id"] };
  });
}
