import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { normalizeLicenseKey, resolveMonitorLicense } from "../../services/license.js";
import { storeBotActivity } from "../../services/botActivity.js";
import { sendTradeActivityNotification } from "../../services/notifications.js";
import { extractEvidenceQuoteFromDetails } from "../../services/marketOutlookEvidence.js";
import { trackOutlookLifecycleTick } from "../../services/marketOutlookTick.js";
import { publishM10SignalFromActivity } from "../../services/marketOutlookPublish.js";
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
