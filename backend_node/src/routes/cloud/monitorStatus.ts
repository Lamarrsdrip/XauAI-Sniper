import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { requireCloudUser } from "../../auth.js";
import { getUserLicense } from "../../services/commandLicense.js";
import { normalizeLicenseKey } from "../../services/license.js";
import {
  buildPublicReleaseDisplay,
  currentEaRelease,
  loadEaReleaseManifest,
  reconcileProductionTimeframe,
  resolveUpdateStatus,
} from "../../services/releaseManifest.js";

function dtOrNull(iso: unknown): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Port of server.py:8099 `GET /cloud/monitor/status` -- the Command Center's main health/setup panel. */
export async function registerCloudMonitorStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/cloud/monitor/status", { preHandler: requireCloudUser }, async (request) => {
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const db = getDb();
    const lic = await getUserLicense(user);
    const licenseKey = normalizeLicenseKey(String(lic?.["pin"] ?? ""));
    let accountFilter = String(lic?.["mt5_account"] ?? "").trim();

    const hbFilters: Record<string, unknown>[] = [];
    if (licenseKey) {
      hbFilters.push({ license_key: licenseKey }, { pin: licenseKey });
    }
    if (accountFilter) hbFilters.push({ account_number: accountFilter });
    const hbQuery = hbFilters.length > 0 ? { $or: hbFilters } : null;
    const hb = hbQuery
      ? await db.collection("cloud_bot_heartbeats").findOne(hbQuery, { projection: { _id: 0 }, sort: { ts: -1 } })
      : null;

    if (hb && !accountFilter && hb["account_number"] && licenseKey) {
      accountFilter = String(hb["account_number"] ?? "");
      await db.collection("pin_licenses").updateOne(
        { pin: licenseKey, is_active: true },
        {
          $set: {
            mt5_account: accountFilter,
            ea_version: hb["ea_version"] ?? "",
            broker_server: hb["broker_server"] ?? "",
            last_heartbeat: hb["ts"] ?? "",
          },
        },
      );
    }

    const now = new Date();
    const hbTime = dtOrNull(hb?.["ts"]);
    const ageSec = hbTime ? Math.trunc((now.getTime() - hbTime.getTime()) / 1000) : null;
    const offline = ageSec === null || ageSec > 90;
    const statusLabel = offline ? "BOT OFFLINE / NO HEARTBEAT" : (hb?.["bot_state"] ?? "ONLINE");
    const hbLastError = String(hb?.["last_error"] ?? "").trim();
    const noisyStaleError = hbLastError.toUpperCase() === "MQL ERROR 5035";

    const alerts: Record<string, unknown>[] = [];
    if (offline) {
      let msg = "BOT OFFLINE / NO HEARTBEAT";
      if (lic && !hb) {
        msg =
          "License linked, but XauCloud has not received an EA heartbeat yet. In MT5 open Tools > Options > Expert Advisors, enable Allow WebRequest and add https://xaucloud.io. Then confirm Algo Trading is enabled and the latest XauCloud EA is attached.";
      }
      alerts.push({ severity: "CRITICAL", type: "BOT_OFFLINE_NO_HEARTBEAT", message: msg });
    }
    if (hb) {
      if (hb["algo_trading"] === false) alerts.push({ severity: "CRITICAL", type: "ALGO_DISABLED", message: "Algo Trading disabled" });
      if (hb["mt5_connected"] === false) alerts.push({ severity: "CRITICAL", type: "MT5_DISCONNECTED", message: "MT5 disconnected" });
      if (hb["trading_allowed"] === false) alerts.push({ severity: "ERROR", type: "TRADING_DISABLED", message: "Trading not allowed" });
      if (hbLastError && !noisyStaleError) alerts.push({ severity: "ERROR", type: "LAST_ERROR", message: hbLastError });
    }

    const setupChecks = [
      {
        key: "license",
        label: "License linked",
        ok: Boolean(lic && lic["is_active"]),
        detail: lic ? (lic["pin"] ?? "") : "Add your ASE activation key.",
      },
      {
        key: "heartbeat",
        label: "EA heartbeat",
        ok: Boolean(hb && !offline),
        detail: ageSec !== null ? `${ageSec}s ago` : "No heartbeat received yet.",
      },
      {
        key: "mt5_account",
        label: "MT5 account bound",
        ok: Boolean(lic?.["mt5_account"] || hb?.["account_number"]),
        detail: String(lic?.["mt5_account"] || hb?.["account_number"] || "Waiting for EA."),
      },
      {
        key: "ea_version",
        label: "EA version reporting",
        ok: Boolean(hb?.["ea_version"] || lic?.["ea_version"]),
        detail: hb?.["ea_version"] || lic?.["ea_version"] || "Attach latest EA.",
      },
      {
        key: "algo",
        label: "Algo trading allowed",
        ok: Boolean(hb && hb["algo_trading"] !== false && hb["trading_allowed"] !== false),
        detail:
          hb && hb["algo_trading"] !== false && hb["trading_allowed"] !== false
            ? "Allowed"
            : "Enable Algo Trading and allow live trading.",
      },
    ];

    let activityScope: Record<string, unknown> = {};
    if (accountFilter) activityScope = { account: accountFilter };
    else if (licenseKey) activityScope = { license_key: licenseKey };
    else if (hb?.["account_number"]) activityScope = { account: String(hb["account_number"]) };

    const activity = db.collection("cloud_bot_activity");
    const hasScope = Object.keys(activityScope).length > 0;
    const lastSignal = hasScope
      ? await activity.findOne({ ...activityScope, event_type: { $regex: "SIGNAL|FIRE|SETUP|FIRST_SIGNAL" } }, { projection: { _id: 0 }, sort: { ts: -1 } })
      : null;
    const lastTrade = hasScope
      ? await activity.findOne({ ...activityScope, severity: { $in: ["TRADE", "EXIT"] } }, { projection: { _id: 0 }, sort: { ts: -1 } })
      : null;
    const lastBlock = hasScope
      ? await activity.findOne(
          { ...activityScope, $or: [{ severity: "BLOCK" }, { event_type: { $regex: "BLOCK|VETO" } }] },
          { projection: { _id: 0 }, sort: { ts: -1 } },
        )
      : null;
    const lastError = hasScope
      ? await activity.findOne({ ...activityScope, severity: { $in: ["ERROR", "CRITICAL"] } }, { projection: { _id: 0 }, sort: { ts: -1 } })
      : null;

    const releaseDisplay = await buildPublicReleaseDisplay(String(hb?.["ea_version"] ?? ""));
    const productionStatus = reconcileProductionTimeframe(String(hb?.["timeframe"] ?? ""), Boolean(releaseDisplay["reported_build_recognized"]));
    const manifest = await loadEaReleaseManifest();
    const current = await currentEaRelease();
    releaseDisplay["update_status"] = resolveUpdateStatus(
      Boolean(manifest.current_version),
      Boolean(current),
      Boolean(lic?.["is_active"]),
      releaseDisplay["installed_version"] as string | null,
      Boolean(releaseDisplay["update_available"]),
    );

    return {
      status: statusLabel,
      offline,
      heartbeat_age_sec: ageSec,
      heartbeat: hb ?? {},
      release: releaseDisplay,
      production_status: productionStatus,
      license: {
        linked: Boolean(lic),
        activation_key: lic?.["pin"] ?? "",
        status: lic?.["is_active"] ? "active" : !lic ? "not_linked" : "inactive",
        mt5_account: lic?.["mt5_account"] ?? "",
        expiry: lic?.["expires_at"] ?? lic?.["subscription_ends_at"] ?? "",
      },
      alerts,
      setup_checks: setupChecks,
      open_trades: !offline ? (hb?.["open_positions"] ?? 0) : 0,
      last_trade: lastTrade,
      last_blocked_trade: lastBlock,
      last_signal: lastSignal,
      last_error: lastError,
      intelligence_sync_state: hb?.["sync_state"] ?? "",
      equity_protection_state: hb?.["epf_state"] ?? "",
    };
  });
}
