import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db.js";
import { normalizeLicenseKey, resolveMonitorLicense } from "../../services/license.js";
import { storeBotActivity } from "../../services/botActivity.js";
import { BotHeartbeatReqSchema } from "../../models/cloudMonitor.js";
import { extractEvidenceQuoteFromDetails } from "../../services/marketOutlookEvidence.js";

const NOISY_STALE_ERRORS = new Set(["MQL ERROR 5035"]);

/** Port of server.py:7277 `POST /cloud/monitor/heartbeat` -- remote monitoring only, never executes trades. */
export async function registerCloudMonitorRoutes(app: FastifyInstance): Promise<void> {
  app.post("/cloud/monitor/heartbeat", async (request) => {
    const req = BotHeartbeatReqSchema.parse(request.body);
    const db = getDb();
    const now = new Date();

    const licenseKey = normalizeLicenseKey(req.license_key || req.pin || "");
    const account = req.account_number || "";
    const lic = await resolveMonitorLicense(licenseKey, account);
    const licenseId = lic?.["id"] ?? "";

    const doc: Record<string, unknown> = { ...req };
    if (licenseKey) {
      doc["license_key"] = licenseKey;
      doc["pin"] = licenseKey;
    }
    if (licenseId) doc["license_id"] = licenseId;
    doc["id"] = randomUUID();
    doc["ts"] = now.toISOString();
    doc["last_heartbeat"] = now.toISOString();

    if (licenseKey) {
      const updateResult = await db.collection("pin_licenses").updateOne(
        { pin: licenseKey, is_active: true },
        {
          $set: {
            is_used: true,
            activated_at: now.toISOString(),
            mt5_account: account,
            ea_version: req.ea_version || "",
            broker_server: req.broker_server || "",
            last_heartbeat: now.toISOString(),
            last_symbol: req.symbol || "",
            last_timeframe: req.timeframe || "",
          },
        },
      );
      doc["license_update_matched"] = updateResult.matchedCount;
      doc["license_update_modified"] = updateResult.modifiedCount;
    }

    await db.collection("cloud_bot_heartbeats").insertOne({ ...doc });
    await db.collection("cloud_settings").updateOne(
      { key: "main" },
      {
        $set: {
          master_last_heartbeat: now.toISOString(),
          master_ea_status: "online",
          monitor_last_heartbeat: now.toISOString(),
          monitor_last_status: doc,
        },
      },
      { upsert: true },
    );

    // The production EA already owns the genuine broker Bid/Ask.  Preserve
    // that exact quote through the existing activity/candle pipeline whenever
    // a heartbeat arrives; this is not a second price source.  A quiet M10
    // decision loop must never make a connected terminal look market-stale.
    const marketDetails = {
      license_key: licenseKey,
      market_thesis: req.market_thesis ?? {},
      m10_signal: req.m10_signal ?? {},
      source: "HEARTBEAT",
    };
    const quote = extractEvidenceQuoteFromDetails(marketDetails, now.toISOString());
    if (quote.valid && account && req.symbol) {
      const marketActivity = await storeBotActivity(
        "MARKET_HEARTBEAT",
        "INFO",
        "Verified broker market heartbeat",
        account,
        req.symbol,
        marketDetails,
      );
      await db.collection("cloud_settings").updateOne(
        { key: "main" },
        { $set: { monitor_last_activity_at: marketActivity["ts"], monitor_last_activity: marketActivity } },
        { upsert: true },
      );
    }

    const noisyStaleError = NOISY_STALE_ERRORS.has(String(req.last_error || "").trim().toUpperCase());
    if (req.last_error && !noisyStaleError) {
      await storeBotActivity("ERROR", "ERROR", req.last_error, account, req.symbol || "", doc);
    }
    if (req.algo_trading === false) {
      await storeBotActivity("ALGO_DISABLED", "CRITICAL", "Algo Trading disabled", account, req.symbol || "", doc);
    }
    if (req.mt5_connected === false) {
      await storeBotActivity("MT5_DISCONNECTED", "CRITICAL", "MT5 disconnected", account, req.symbol || "", doc);
    }

    const heartbeats = db.collection("cloud_bot_heartbeats");
    const total = await heartbeats.estimatedDocumentCount();
    if (total > 1500) {
      const oldest = await heartbeats
        .find({}, { projection: { _id: 1, ts: 1 } })
        .sort({ ts: 1 })
        .limit(total - 1000)
        .toArray();
      if (oldest.length > 0) {
        await heartbeats.deleteMany({ _id: { $in: oldest.map((o) => o["_id"]) } });
      }
    }

    return {
      ok: true,
      status: "received",
      auth: licenseKey ? "license_pin" : "agent_token",
      license_pin: licenseKey,
      license_id: licenseId,
      account,
      heartbeat_id: doc["id"],
      bound: Boolean(account),
    };
  });
}
