import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";
import { clientIp, rateLimit, requireCloudUser } from "../auth.js";
import { getUserLicense } from "../services/commandLicense.js";
import { normalizeLicenseKey } from "../services/license.js";
import { normalizePropFirmConfig } from "../services/propFirmConfig.js";
import { fetchLiveGoldPrice } from "../services/goldPrice.js";
import { currentEaRelease } from "../services/releaseManifest.js";
import { getSettings } from "../services/settings.js";

const EAConfigCreateSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable().optional().default("Default Configuration"),
  risk_percent: z.number().finite().min(0).max(100).nullable().optional().default(1.0),
  daily_loss_limit: z.number().finite().min(0).max(100).nullable().optional().default(3.0),
  weekly_drawdown_limit: z.number().finite().min(0).max(100).nullable().optional().default(5.0),
  weekly_profit_target: z.number().finite().min(0).max(1000).nullable().optional().default(35.0),
  max_open_trades: z.number().int().min(0).max(100).nullable().optional().default(2),
  max_trades_per_day: z.number().int().min(0).max(1000).nullable().optional().default(3),
  enable_trend_mode: z.boolean().nullable().optional().default(true),
  enable_range_mode: z.boolean().nullable().optional().default(true),
  enable_breakout_mode: z.boolean().nullable().optional().default(true),
  confidence_threshold: z.number().int().min(0).max(100).nullable().optional().default(75),
  ema_fast: z.number().int().min(1).max(10000).nullable().optional().default(50),
  ema_slow: z.number().int().min(1).max(10000).nullable().optional().default(200),
  min_rr_ratio: z.number().finite().min(0).max(100).nullable().optional().default(1.5),
  partial_close_percent: z.number().finite().min(0).max(100).nullable().optional().default(50.0),
  trailing_atr_multi: z.number().finite().min(0).max(100).nullable().optional().default(1.5),
  sl_atr_multiplier: z.number().finite().min(0).max(100).nullable().optional().default(2.0),
  trade_london: z.boolean().nullable().optional().default(true),
  trade_new_york: z.boolean().nullable().optional().default(true),
  equity_protection: z.number().finite().min(0).max(100).nullable().optional().default(70.0),
  profit_mode: z.string().trim().min(1).max(40).nullable().optional().default("moderate"),
}).strict();

const AdminMarketModeSettingsSchema = z.object({
  platform_gold_mode_enabled: z.boolean().default(true),
  platform_index_mode_enabled: z.boolean().default(false),
  allowed_index_symbols: z.array(z.string()).default([]),
  default_trading_universe: z.string().default("GOLD_ONLY"),
});

const ARCHITECTURE_PAYLOAD = {
  modules: [
    {
      name: "M10 Evidence Engine",
      description: "Builds immutable evidence from completed M10 bars and multi-timeframe context.",
      components: ["Completed-bar trend and pressure", "Market structure", "Volatility", "M10 evidence identity"],
    },
    {
      name: "Decision Authority",
      description:
        "M10 legacy is the sole authoritative decision mode in this release. An M30 three-snapshot consensus path exists in source for possible future use but is not selectable or executable in the current build.",
      components: ["M10 legacy mode (active)", "M30 three-snapshot consensus (dormant, not selectable)", "Immutable candidate identity", "No forming-candle evidence"],
    },
    {
      name: "Entry Lifecycle",
      description: "A qualifying candidate gets one 120–180 second observation window, followed by execute or cancel.",
      components: ["Single timer", "Final revalidation", "0.30R missed-move cancellation", "No retracement carry-forward"],
    },
    {
      name: "Risk and Execution",
      description: "Core orders require a structural invalidation, one 1.20 widening, 10% configured risk sizing, direction exclusivity, and confirmed broker truth.",
      components: ["Structural stop loss", "Margin and spread checks", "Cross-terminal reservation", "Broker reconciliation"],
    },
    {
      name: "Position Management",
      description: "Open-position and R-based exit management continues on every tick.",
      components: ["R-based protection", "Broker-confirmed close retries", "Restart state", "Exit audit"],
    },
    {
      name: "Command Center",
      description: "Licensed users can inspect heartbeat, evidence, candidates, positions, events, and acknowledged controls.",
      components: ["Tenant isolation", "Decision-mode visibility", "Audit trail", "Admin separation"],
    },
  ],
  filters: [
    { name: "Spread", description: "Current execution-risk check" },
    { name: "News", description: "Current local evidence plus honest provider status" },
    { name: "Structure", description: "Required core invalidation" },
    { name: "Margin", description: "Broker/account execution reality" },
  ],
};

const INSTALLATION_GUIDE = {
  steps: [
    { step: 1, title: "Download EA", description: "Sign in to Command Center and download the verified compiled .ex5 release." },
    { step: 2, title: "Open MT5", description: "Launch MetaTrader 5." },
    { step: 3, title: "Copy to Folder", description: "File > Open Data Folder > MQL5 > Experts. Paste the compiled file." },
    { step: 4, title: "Refresh Navigator", description: "In Navigator, refresh Expert Advisors. Customer-side source compilation is not required." },
    { step: 5, title: "Open Chart", description: "Open an XAUUSD M10 chart (including your broker's XAUUSD suffix)." },
    { step: 6, title: "Attach EA", description: "Drag the verified EA from Navigator onto the chart." },
    { step: 7, title: "Enter PIN", description: "Enter your license PIN. This release runs M10 legacy decision mode only — there is no M30 mode to select in the current build." },
    { step: 8, title: "Enable", description: "Enable Algo Trading only after demo verification and broker checks." },
  ],
  requirements: ["MetaTrader 5", "Supported XAUUSD symbol", "Valid PIN", "Stable internet/VPS", "Adequate broker margin", "Broker-compatible spread and stops"],
  warnings: ["Start with demo", "No guaranteed profits", "Risk only capital you can afford to lose", "Keep PIN private", "Confirm the active EA version and Decision Mode in the MT5 journal"],
};

/** Port of server.py's small static-content and misc public/cloud routes. */
export async function registerMiscRoutes(app: FastifyInstance): Promise<void> {
  // GET /gold/price -- server.py:1033
  app.get("/gold/price", async () => fetchLiveGoldPrice());

  // GET /architecture -- server.py:3001
  app.get("/architecture", async () => ARCHITECTURE_PAYLOAD);

  // GET /docs/installation -- server.py:3005
  app.get("/docs/installation", async () => INSTALLATION_GUIDE);

  // GET /docs/how-it-works -- server.py:3009
  app.get("/docs/how-it-works", async () => {
    const release = await currentEaRelease();
    const version = (release?.["version"] as string | undefined) ?? "current release";
    return {
      sections: [
        {
          title: `How XauCloud ${version} Works`,
          subtitle: "Completed M10 evidence with a single authoritative decision mode",
          steps: [
            { id: 1, title: "M10 Evidence", description: "The EA records one immutable snapshot for each completed M10 candle.", detail: "The forming candle is never used as evidence." },
            {
              id: 2,
              title: "Decision Mode",
              description: "M10 legacy is the only decision mode in this release. An M30 three-snapshot consensus path exists in source for possible future use but is not selectable or executable in the current build.",
              detail: "The journal and Command Center confirm M10 legacy is the active mode.",
            },
            { id: 3, title: "One Entry Timer", description: "A qualifying BUY or SELL immediately starts one 120–180 second timer.", detail: "There is no second retracement, candle, slot, or AI wait." },
            {
              id: 4,
              title: "Execute or Cancel",
              description: "At final revalidation the EA executes if valid and below 0.30R movement, otherwise it cancels.",
              detail: "A cancelled candidate cannot be carried or resurrected.",
            },
            {
              id: 5,
              title: "Risk and Broker Truth",
              description: "A core order requires structural SL, one 1.20 widening, configured 10% risk sizing, margin, direction exclusivity, and broker confirmation.",
              detail: "Ambiguous sends are reconciled and never immediately resent.",
            },
            { id: 6, title: "Tick-Based Management", description: "Once open, positions and exits continue to be managed on ticks.", detail: "Entry cadence does not slow exit management." },
          ],
        },
      ],
      faq: [
        { q: "Is M30 mode available?", a: "No. This release runs M10 legacy decision mode only; M30 is not a selectable option in the current build. Always confirm the active Decision Mode shown in the MT5 journal and Command Center." },
        { q: "Do I need to keep MT5 running?", a: "Yes. A properly monitored VPS can provide continuous terminal operation." },
        { q: "Does the EA guarantee profit?", a: "No. Trading can lose money; demo and broker-specific verification are required." },
        { q: "Which broker?", a: "Use an MT5 broker whose XAUUSD symbol, stops, volume steps, margin, spread, and execution behavior you have verified." },
        { q: "What if connectivity fails?", a: "Broker-held SL/TP remain important, but cloud features and EA-side management may be unavailable until connectivity returns." },
      ],
    };
  });

  // GET /docs/setup-guide -- server.py:3014
  app.get("/docs/setup-guide", async () => {
    const release = await currentEaRelease();
    const version = (release?.["version"] as string | undefined) ?? "current release";
    return {
      title: `XauCloud ${version} Setup Guide`,
      intro: "Install only the verified compiled EX5 and confirm the running inputs before enabling trading.",
      steps: [
        {
          step: 1,
          title: "Prepare MT5 Demo",
          instructions: ["Install your broker's MT5 terminal", "Sign in to a demo account", "Confirm the broker's exact XAUUSD symbol and trading specification"],
          tip: "Do not begin with a real-money account.",
        },
        {
          step: 2,
          title: "Download Verified EX5",
          instructions: ["Sign in to Command Center", "Link the active license", `Download ${version} compiled EX5`, "Compare the displayed checksum with the release manifest"],
          tip: "Customers do not need MQ5 source or MetaEditor compilation.",
        },
        {
          step: 3,
          title: "Install the EA",
          instructions: ["MT5: File > Open Data Folder", "Open MQL5 > Experts", "Copy the verified EX5", "Refresh Expert Advisors in Navigator"],
          tip: "Keep older builds clearly separated.",
        },
        {
          step: 4,
          title: "Open Gold Chart",
          instructions: ["Open your broker's XAUUSD chart", "Set the chart to M10", "Confirm live prices and normal broker spread"],
          tip: "M10 is the primary evidence timeframe.",
        },
        {
          step: 5,
          title: "Attach and Review Inputs",
          instructions: ["Drag XauCloud.io onto the chart", "Enter the license PIN", "Confirm Decision Mode shows M10 legacy", "Confirm risk, magic number, server URL, and stop-loss settings"],
          tip: "This release runs M10 legacy decision mode only; there is no M30 mode to select.",
        },
        {
          step: 6,
          title: "Verify Journal",
          instructions: ["Confirm the exact EA version and build hash", "Confirm the active Decision Mode", "Confirm license and indicator readiness", "Confirm there is no older EA attached to another XAUUSD chart"],
          tip: "The file name alone does not prove the running version.",
        },
        {
          step: 7,
          title: "Enable on Demo",
          instructions: ["Enable Allow Algo Trading", "Turn the MT5 Algo Trading button on", "Watch heartbeat and Command Center status", "Verify broker send/modify/close behavior on demo"],
          tip: "Move to live only after owner approval and broker-specific evidence.",
        },
      ],
      important_notes: [
        "No profit is guaranteed.",
        "The configured 10% risk is high and can produce large losses.",
        "Keep MT5 and connectivity monitored.",
        "Never share your PIN.",
        "Mac and VPS must use the same approved artifact and intentional Decision Mode.",
      ],
    };
  });

  // GET /docs/video-guide -- server.py:3019
  app.get("/docs/video-guide", async () => {
    const release = await currentEaRelease();
    const version = (release?.["version"] as string | undefined) ?? "current release";
    return {
      title: "Verified EX5 Installation Walkthrough",
      subtitle: `Screen-by-screen ${version} deployment checks`,
      scenes: [
        {
          scene: 1,
          title: "DOWNLOAD",
          duration: "2 min",
          frames: [
            { action: "SIGN IN", detail: "Open Command Center and link the active license", visual: "Licensed download panel" },
            { action: "DOWNLOAD EX5", detail: `Download the compiled ${version} artifact`, visual: "Version and checksum shown together" },
            { action: "VERIFY", detail: "Compare the artifact checksum with the release manifest", visual: "Matching SHA-256 values" },
          ],
        },
        {
          scene: 2,
          title: "INSTALL",
          duration: "2 min",
          frames: [
            { action: "DATA FOLDER", detail: "MT5: File > Open Data Folder", visual: "Terminal data directory" },
            { action: "COPY", detail: "Place the EX5 in MQL5 > Experts", visual: "Compiled artifact in Experts" },
            { action: "REFRESH", detail: "Refresh Expert Advisors in Navigator", visual: "EA appears without customer-side compilation" },
          ],
        },
        {
          scene: 3,
          title: "CHART AND INPUTS",
          duration: "3 min",
          frames: [
            { action: "OPEN GOLD", detail: "Open the broker's XAUUSD symbol on M10", visual: "Completed M10 candles" },
            { action: "ATTACH", detail: "Attach XAUUSD AI Sniper", visual: "EA input dialog" },
            { action: "LICENSE", detail: "Enter PIN and verify account binding", visual: "License input" },
            { action: "MODE", detail: "Confirm the published release's active Decision Mode", visual: "M10 legacy decision mode confirmation" },
          ],
        },
        {
          scene: 4,
          title: "PROVE THE RUNTIME",
          duration: "2 min",
          frames: [
            { action: "JOURNAL", detail: `Confirm ${version}, build hash, source/input hashes, and active Decision Mode`, visual: "MT5 journal startup evidence" },
            { action: "COMMAND CENTER", detail: "Confirm fresh heartbeat and matching mode/evidence", visual: "Online monitored instance" },
            { action: "DEMO FIRST", detail: "Verify signal, broker execution, SL/TP, and exits on demo before live approval", visual: "Audited demo lifecycle" },
          ],
        },
      ],
    };
  });

  // GET /market-mode-status -- server.py:3478. Public, unauthenticated -- the
  // website/download page reads this to know whether to advertise Index Mode.
  app.get("/market-mode-status", async () => {
    const s = (await getSettings()) as Record<string, unknown>;
    return AdminMarketModeSettingsSchema.parse(s);
  });

  // POST /configs -- server.py:3641. Public (unauthenticated) config
  // submission from the marketing-site Configurator.
  app.post("/configs", async (request) => {
    rateLimit(`public_config_submission_ip:${clientIp(request)}`, 10, 600);
    const data = EAConfigCreateSchema.parse(request.body ?? {});
    const id = randomUUID();
    const doc = {
      id,
      ...data,
      created_at: new Date().toISOString(),
      source: "public_configurator",
      submitted_at: new Date().toISOString(),
    };
    await getDb().collection("ea_configs").insertOne({ ...doc });
    return { ok: true, id };
  });

  // GET /cloud/command/recent -- server.py:8040
  app.get("/cloud/command/recent", { preHandler: requireCloudUser }, async (request) => {
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const q = z.object({ limit: z.coerce.number().int().optional().default(20) }).parse(request.query);
    const n = Math.max(1, Math.min(q.limit, 50));
    const rows = await getDb()
      .collection("cloud_bot_commands")
      .find({ user_id: user["id"] }, { projection: { _id: 0 } })
      .sort({ requested_at: -1 })
      .limit(n)
      .toArray();
    return { commands: rows, count: rows.length };
  });

  // GET /cloud/prop-firm/config -- server.py:8047
  app.get("/cloud/prop-firm/config", { preHandler: requireCloudUser }, async (request) => {
    const user = (request as typeof request & { cloudUser: Record<string, unknown> }).cloudUser;
    const db = getDb();
    const lic = await getUserLicense(user);
    const defaults = normalizePropFirmConfig({});
    if (!lic) {
      return {
        linked: false,
        defaults,
        requested: defaults,
        applied: defaults,
        apply_status: "NOT_LINKED",
        apply_message: "Link an active license before configuring Prop Firm Mode.",
      };
    }

    const licenseKey = normalizeLicenseKey(String(lic["pin"] ?? ""));
    const account = String(lic["mt5_account"] ?? "");
    const hbFilters: Record<string, unknown>[] = [{ license_key: licenseKey }, { pin: licenseKey }];
    if (account) hbFilters.push({ account_number: account });
    const hb = await db.collection("cloud_bot_heartbeats").findOne({ $or: hbFilters }, { projection: { _id: 0 }, sort: { ts: -1 } });

    const heartbeatFields: Record<string, string> = {
      enabled: "prop_firm_mode",
      daily_loss_pct: "prop_daily_loss_pct",
      max_loss_pct: "prop_max_loss_pct",
      safety_buffer_pct: "prop_safety_buffer_pct",
      risk_per_trade_pct: "prop_risk_per_trade_pct",
      max_basket_risk_pct: "prop_max_basket_risk_pct",
    };
    const heartbeatApplied: Record<string, unknown> = {};
    if (hb) {
      for (const [configKey, heartbeatKey] of Object.entries(heartbeatFields)) {
        if (hb[heartbeatKey] !== undefined) heartbeatApplied[configKey] = hb[heartbeatKey];
      }
    }

    const requested = normalizePropFirmConfig((lic["prop_firm_requested"] as Record<string, unknown> | undefined) ?? (defaults as unknown as Record<string, unknown>));
    const storedApplied = (lic["prop_firm_applied"] as Record<string, unknown> | undefined) ?? {};
    const applied = normalizePropFirmConfig({ ...requested, ...storedApplied, ...heartbeatApplied });

    return {
      linked: true,
      license_key: licenseKey,
      defaults,
      requested,
      requested_at: lic["prop_firm_requested_at"] ?? "",
      applied,
      applied_at: lic["prop_firm_applied_at"] ?? "",
      apply_status: lic["prop_firm_apply_status"] ?? "NOT_CONFIGURED",
      apply_message: lic["prop_firm_apply_message"] ?? "",
      heartbeat_at: hb?.["ts"] ?? "",
      ea_version: hb?.["ea_version"] ?? "",
    };
  });
}
