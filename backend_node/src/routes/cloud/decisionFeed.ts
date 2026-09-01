import type { FastifyInstance } from "fastify";
import { getDb } from "../../db.js";
import { requireCloudUser } from "../../auth.js";
import { getUserLicense } from "../../services/commandLicense.js";
import { normalizeLicenseKey } from "../../services/license.js";
import { classifyTradeActivity } from "../../services/notifications.js";
import { aiBuildThoughtCard, aiClassifyCardType, aiGroupRepeatedCards, aiWouldEnterAgain, type ThoughtCard } from "../../services/thoughtCards.js";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function activityTicket(row: Record<string, unknown>): string {
  return String(row["ticket"] ?? row["position_id"] ?? row["position_ticket"] ?? "").trim();
}

/**
 * Forensic-incident fix: this feed is a raw, undeduplicated pass-through of
 * cloud_bot_activity, so a single physical trade open that the EA reports
 * across multiple pipeline-stage events (order confirmation, position
 * confirmation, risk update, ...) previously rendered as several separate
 * "Trade opened"-looking rows. Collapse to the most recent row per ticket
 * for rows that classifyTradeActivity (the same classifier the notification
 * pipeline already uses, which is why pushes were never duplicated) agrees
 * are a TRADE_OPENED event -- every other event kind (blocks, risk, AI,
 * errors, TRADE_CLOSED, ...) is left completely untouched.
 */
function dedupeTradeOpenedRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seenOpenTickets = new Set<string>();
  return rows.filter((row) => {
    if (classifyTradeActivity(row) !== "TRADE_OPENED") return true;
    const ticket = activityTicket(row);
    if (!ticket) return true; // nothing to group duplicates by -- never collapse
    if (seenOpenTickets.has(ticket)) return false;
    seenOpenTickets.add(ticket);
    return true;
  });
}

function cloudUser(request: unknown): Record<string, unknown> {
  return (request as { cloudUser: Record<string, unknown> }).cloudUser;
}

const DECISION_FEED_EXCLUDED_EVENT_TYPES = ["BOT_STATUS_HEARTBEAT"];

/** Port of server.py's cloud monitor GET endpoints: activity feed (8233), decision-feed (8317), bot-status (8366), current-opinion (8401). */
export async function registerDecisionFeedRoutes(app: FastifyInstance): Promise<void> {
  // GET /cloud/monitor/activity -- server.py:8233 (the raw, filterable Support Diagnostics feed)
  app.get("/cloud/monitor/activity", { preHandler: requireCloudUser }, async (request) => {
    const q = request.query as { kind?: string; limit?: string; search?: string };
    const n = Math.max(1, Math.min(Number(q.limit ?? 80), 200));
    const k = (q.kind || "all").toLowerCase();
    const user = cloudUser(request);
    const lic = await getUserLicense(user);
    const licenseKey = normalizeLicenseKey(String(lic?.["pin"] ?? ""));
    const accountFilter = String(lic?.["mt5_account"] ?? "").trim();
    if (!accountFilter && !licenseKey) {
      return { events: [], count: 0, kind: k, reason: "license_not_linked" };
    }

    let kindQuery: Record<string, unknown> = {};
    if (["entries", "trades", "entry"].includes(k)) {
      kindQuery = { $or: [{ event_category: "entries" }, { severity: { $in: ["ENTRY", "TRADE"] } }, { event_type: { $regex: "TRADE_EXECUTED|FIRE|PYR|ENTRY" } }] };
    } else if (k === "blocks") {
      kindQuery = { $or: [{ event_category: "blocks" }, { severity: "BLOCK" }, { event_type: { $regex: "BLOCK|VETO" } }] };
    } else if (k === "errors") {
      kindQuery = { $or: [{ event_category: "errors" }, { severity: { $in: ["ERROR", "CRITICAL"] } }] };
    } else if (k === "sync") {
      kindQuery = { $or: [{ severity: "SYNC" }, { event_type: { $regex: "SYNC" } }] };
    } else if (["exit", "exits"].includes(k)) {
      kindQuery = { $or: [{ event_category: "exits" }, { severity: "EXIT" }, { event_type: { $regex: "EXIT|CLOSE" } }] };
    } else if (k === "shadow") {
      kindQuery = { event_type: { $regex: "SHADOW|BLOCK_CHECK" } };
    } else if (k === "risk") {
      kindQuery = { $or: [{ event_category: "risk" }, { event_type: { $regex: "EPF|DRAWDOWN|RISK|LOCK|LOT|MARGIN" } }] };
    } else if (k === "ai") {
      kindQuery = {
        $or: [
          { event_category: "ai" },
          { event_type: { $regex: "AI|DIRECTOR|ML|BRAIN|CONFIDENCE" } },
          { message: { $regex: "AI|DIRECTOR|ML|BRAIN|CONFIDENCE", $options: "i" } },
        ],
      };
    } else if (k === "overrides") {
      kindQuery = { $or: [{ event_category: "overrides" }, { severity: "OVERRIDE" }, { event_type: { $regex: "OVERRIDE|LOSS_CLOSE_BLOCKED|IGNORED" } }] };
    }

    const scope =
      accountFilter && licenseKey
        ? { $or: [{ account: accountFilter }, { license_key: licenseKey }] }
        : accountFilter
          ? { account: accountFilter }
          : { license_key: licenseKey };

    let query: Record<string, unknown> = Object.keys(kindQuery).length > 0 ? { $and: [scope, kindQuery] } : scope;

    const search = String(q.search ?? "").trim();
    if (search) {
      const safe = escapeRegex(search.slice(0, 80));
      const searchQuery = {
        $or: [
          { event_type: { $regex: safe, $options: "i" } },
          { severity: { $regex: safe, $options: "i" } },
          { event_category: { $regex: safe, $options: "i" } },
          { message: { $regex: safe, $options: "i" } },
          { symbol: { $regex: safe, $options: "i" } },
          { module: { $regex: safe, $options: "i" } },
          { decision: { $regex: safe, $options: "i" } },
          { reason: { $regex: safe, $options: "i" } },
          { blocked_by: { $regex: safe, $options: "i" } },
          { ticket: { $regex: safe, $options: "i" } },
          { ts: { $regex: safe, $options: "i" } },
          { "details.ticket": { $regex: safe, $options: "i" } },
          { "details.reason": { $regex: safe, $options: "i" } },
          { "details.module": { $regex: safe, $options: "i" } },
        ],
      };
      query = { $and: [query, searchQuery] };
    }

    const rows = await getDb()
      .collection("cloud_bot_activity")
      .find(query, { projection: { _id: 0 } })
      .sort({ ts: -1 })
      .limit(n)
      .toArray();
    const events = dedupeTradeOpenedRows(rows as Record<string, unknown>[]);
    return { events, count: events.length, kind: k };
  });

  // GET /cloud/monitor/decision-feed -- server.py:8317 (the Trading-page conversational AI feed)
  app.get("/cloud/monitor/decision-feed", { preHandler: requireCloudUser }, async (request) => {
    const q = request.query as { limit?: string; ticket?: string };
    const n = Math.max(1, Math.min(Number(q.limit ?? 60), 20));
    const emptyMessage = "No fresh AI decision yet. Waiting for the next completed M10 evaluation.";
    const freshCutoffIso = new Date(Date.now() - 24 * 3600_000).toISOString();
    const user = cloudUser(request);
    const lic = await getUserLicense(user);
    const licenseKey = normalizeLicenseKey(String(lic?.["pin"] ?? ""));
    const accountFilter = String(lic?.["mt5_account"] ?? "").trim();
    if (!accountFilter && !licenseKey) {
      return { cards: [], timeline: [], reason: "license_not_linked", empty_message: emptyMessage };
    }
    const scope =
      accountFilter && licenseKey
        ? { $or: [{ account: accountFilter }, { license_key: licenseKey }] }
        : accountFilter
          ? { account: accountFilter }
          : { license_key: licenseKey };
    const freshness = { ts: { $gte: freshCutoffIso } };
    const ticket = String(q.ticket ?? "").trim();
    const query = ticket
      ? { $and: [scope, { ticket }, { event_type: { $nin: DECISION_FEED_EXCLUDED_EVENT_TYPES } }, freshness] }
      : { $and: [scope, { event_type: { $nin: DECISION_FEED_EXCLUDED_EVENT_TYPES } }, freshness] };

    let rows = await getDb()
      .collection("cloud_bot_activity")
      .find(query, { projection: { _id: 0 } })
      .sort({ ts: 1 })
      .limit(n * 3)
      .toArray();
    rows = rows.slice(-n);

    const prevConfByTicket = new Map<string, number>();
    let cards = rows.map((ev) => aiBuildThoughtCard(ev, prevConfByTicket));
    cards = cards.reverse();
    cards = aiGroupRepeatedCards(cards);
    const timeline = cards.map((c) => ({ ts: c.ts, label: c.decision_text || c.headline, tone: c.tone }));

    return {
      cards,
      timeline,
      count: cards.length,
      fresh_since: freshCutoffIso,
      max_age_hours: 24,
      source_priority: [
        "latest EA heartbeat/live decision JSON",
        "latest M10 decision cycle",
        "latest open trade thinking",
        "recent decision history fallback",
      ],
      empty_message: emptyMessage,
    };
  });

  // GET /cloud/monitor/bot-status -- server.py:8366 (Current Bot Decision panel)
  app.get("/cloud/monitor/bot-status", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUser(request);
    const lic = await getUserLicense(user);
    const licenseKey = normalizeLicenseKey(String(lic?.["pin"] ?? ""));
    const accountFilter = String(lic?.["mt5_account"] ?? "").trim();
    if (!accountFilter && !licenseKey) return { available: false, reason: "license_not_linked" };
    const scope =
      accountFilter && licenseKey
        ? { $or: [{ account: accountFilter }, { license_key: licenseKey }] }
        : accountFilter
          ? { account: accountFilter }
          : { license_key: licenseKey };
    const latest = await getDb()
      .collection("cloud_bot_activity")
      .findOne({ $and: [scope, { event_type: "BOT_STATUS_HEARTBEAT" }] }, { projection: { _id: 0 }, sort: { ts: -1 } });
    if (!latest) return { available: false, reason: "no_heartbeat_yet" };

    const category = String(latest["blocked_by"] ?? latest["mode"] ?? "SCANNING").toUpperCase();
    let ageSec: number | null = null;
    const ts = latest["ts"];
    if (typeof ts === "string") {
      const parsed = new Date(ts);
      if (!Number.isNaN(parsed.getTime())) ageSec = Math.trunc((Date.now() - parsed.getTime()) / 1000);
    }
    return {
      available: true,
      category,
      status_text: latest["decision"] ?? latest["message"],
      reason: latest["reason"],
      ts: latest["ts"],
      age_sec: ageSec,
      stale: ageSec !== null && ageSec > 360,
    };
  });

  // GET /cloud/monitor/current-opinion -- server.py:8401 (Current Trade panel)
  app.get("/cloud/monitor/current-opinion", { preHandler: requireCloudUser }, async (request) => {
    const q = request.query as { ticket?: string };
    const user = cloudUser(request);
    const db = getDb();
    const lic = await getUserLicense(user);
    const licenseKey = normalizeLicenseKey(String(lic?.["pin"] ?? ""));
    const accountFilter = String(lic?.["mt5_account"] ?? "").trim();
    if (!accountFilter && !licenseKey) return { open: false, reason: "license_not_linked" };

    const scope =
      accountFilter && licenseKey
        ? { $or: [{ account: accountFilter }, { license_key: licenseKey }] }
        : accountFilter
          ? { account: accountFilter }
          : { license_key: licenseKey };
    const t = String(q.ticket ?? "").trim();
    const freshCutoffIso = new Date(Date.now() - 24 * 3600_000).toISOString();

    const thesisFilters: Record<string, unknown>[] = [scope, { updated_at: { $gte: freshCutoffIso } }];
    if (t) thesisFilters.push({ ticket: t });
    const thesis = await db.collection("cloud_trade_thesis_status").findOne({ $and: thesisFilters }, { projection: { _id: 0 }, sort: { updated_at: -1 } });

    let activeTicket = String(thesis?.["ticket"] ?? t ?? "");
    const activityQuery = activeTicket
      ? { $and: [scope, { ticket: activeTicket }] }
      : { $and: [scope, { ticket: { $ne: "" } }, { ts: { $gte: freshCutoffIso } }] };
    const rows = await db
      .collection("cloud_bot_activity")
      .find(activityQuery, { projection: { _id: 0 } })
      .sort({ ts: 1 })
      .limit(400)
      .toArray();

    if (!thesis && rows.length === 0) {
      const hbFilters: Record<string, unknown>[] = [];
      if (licenseKey) hbFilters.push({ license_key: licenseKey }, { pin: licenseKey });
      if (accountFilter) hbFilters.push({ account_number: accountFilter });
      const hb = hbFilters.length > 0 ? await db.collection("cloud_bot_heartbeats").findOne({ $or: hbFilters }, { projection: { _id: 0 }, sort: { ts: -1 } }) : null;
      if (Number(hb?.["open_positions"] ?? 0) > 0) {
        return {
          open: true,
          source: "heartbeat_pending",
          reason: "open_trade_thesis_pending",
          message: "Open trade detected. Waiting for EA trade thesis status.",
          current_bot_decision: "WAIT",
          thesis_health: "WARNING",
          what_would_close: "Waiting for the EA to send the live thesis snapshot.",
        };
      }
      return { open: false, reason: "no_open_trade" };
    }

    let ticketRows: Record<string, unknown>[];
    if (!thesis) {
      const byTicket = new Map<string, Record<string, unknown>[]>();
      for (const r of rows) {
        const key = String(r["ticket"] ?? "");
        const arr = byTicket.get(key) ?? [];
        arr.push(r);
        byTicket.set(key, arr);
      }
      if (!activeTicket) {
        for (const [candidate, candidateRows] of Array.from(byTicket.entries()).reverse()) {
          if (candidate && aiClassifyCardType(candidateRows.at(-1)!) !== "TRADE_CLOSED") {
            activeTicket = candidate;
            break;
          }
        }
      }
      ticketRows = byTicket.get(activeTicket) ?? [];
      if (ticketRows.length === 0 || aiClassifyCardType(ticketRows.at(-1)!) === "TRADE_CLOSED") {
        return { open: false, reason: "trade_already_closed" };
      }
    } else {
      ticketRows = rows;
    }

    const prevConfByTicket = new Map<string, number>();
    const cards = ticketRows.map((ev) => aiBuildThoughtCard(ev, prevConfByTicket));
    const latest: Partial<ThoughtCard> = cards.at(-1) ?? {};
    const entryCard: Partial<ThoughtCard> = cards.find((c) => c.type === "TRADE_EXECUTED") ?? cards[0] ?? {};

    const thesisConf = thesis?.["ai_confidence"];
    const conf = typeof thesisConf === "number" ? thesisConf : (latest.confidence ?? null);
    let holdProbability = thesis?.["hold_probability"];
    if (holdProbability === undefined || holdProbability === null) holdProbability = conf ?? null;
    let exitProbability = thesis?.["exit_probability"];
    if (exitProbability === undefined || exitProbability === null) exitProbability = conf !== null ? 100 - conf : null;
    const reversalProbability = conf !== null ? Math.max(0, 100 - conf - 20) : null;
    const verdict = Object.keys(latest).length > 0 ? aiWouldEnterAgain(latest) : { answer: "WAIT", reason: "Waiting for live confidence reading." };

    const direction = String(
      thesis?.["direction"] ?? (thesis?.["is_buy"] === true ? "BUY" : thesis?.["is_buy"] === false ? "SELL" : ""),
    ).toUpperCase();
    const entryReason = thesis?.["entry_reason"] ?? (entryCard.reason_bullets?.join(". ") || entryCard.decision_text) ?? null;
    const currentBotDecision = thesis?.["next_action"] ?? latest.decision_text ?? "WAIT";
    const whatWouldClose = thesis?.["exit_reason"] ?? "Broker SL/TP, manual close, emergency margin protection, or confirmed thesis invalidation.";
    const currentReason = thesis?.["hold_reason"] ?? thesis?.["protect_reason"] ?? latest.decision_text ?? "Waiting for the next M10 decision cycle.";

    return {
      open: true,
      source: thesis ? "thesis_status" : "activity_fallback",
      ticket: activeTicket,
      symbol: thesis?.["symbol"] ?? (latest.advanced as Record<string, unknown> | undefined)?.["symbol"],
      direction,
      lot_size: thesis?.["lots"] ?? null,
      entry_price: thesis?.["open_price"] ?? null,
      current_price: thesis?.["current_price"] ?? null,
      sl: thesis?.["sl"] ?? null,
      tp: thesis?.["tp"] ?? null,
      floating_pl: thesis?.["current_profit"] ?? null,
      peak_profit: thesis?.["peak_profit"] ?? null,
      protected_profit: thesis?.["protected_profit"] ?? null,
      distance_to_sl: thesis?.["dist_to_sl"] ?? null,
      distance_to_tp: thesis?.["dist_to_tp"] ?? null,
      trade_age_minutes: thesis?.["trade_age_minutes"] ?? null,
      entry_reason: entryReason,
      setup_type: thesis?.["setup_type"] ?? thesis?.["expected_type"] ?? null,
      grade: thesis?.["grade"] ?? null,
      ai_confidence: conf,
      current_bias: latest.bias || direction,
      confidence: conf,
      current_risk: (latest.advanced as Record<string, unknown> | undefined)?.["regime"] ?? null,
      hold_probability: holdProbability,
      exit_probability: exitProbability,
      reversal_probability: reversalProbability,
      thesis_health: String(thesis?.["state"] ?? "WARNING").toUpperCase(),
      current_bot_decision: currentBotDecision,
      current_reason: currentReason,
      what_would_close: whatWouldClose,
      what_would_keep_holding: thesis?.["hold_reason"] ?? "Trend thesis remains valid with acceptable risk.",
      would_enter_again: verdict.answer,
      would_enter_again_reason: verdict.reason,
      latest_card: latest,
      hold_reason: thesis?.["hold_reason"] ?? null,
      protect_reason: thesis?.["protect_reason"] ?? null,
      exit_trigger_reason: whatWouldClose,
      next_action: thesis?.["next_action"] ?? null,
      recovery_mode: thesis?.["recovery_mode"] ?? "NONE",
      recovery_worst_pct: thesis?.["recovery_worst_pct"] ?? null,
      recovery_classification: thesis?.["recovery_classification"] ?? null,
      updated_at: thesis?.["updated_at"] ?? null,
    };
  });
}
