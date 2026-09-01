import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { normalizeLicenseKey } from "./license.js";
import { recordAuditableEaDecision, recordVerifiedManualTradingQuote } from "./manualTradingMarketStore.js";
import { recordDiagnostic } from "./diagnostics.js";
import { normalizeGoldSymbol } from "./goldSymbol.js";

export interface BotActivityDetails {
  license_key?: string;
  reason?: string;
  module?: string;
  decision?: string;
  blocked_by?: string;
  ticket?: string | number;
  allowed?: unknown;
  trade_allowed?: unknown;
  mode?: string;
  market_bias?: string;
  signal_direction?: string;
  ai_confidence?: unknown;
  score?: unknown;
  candidate_allowed?: unknown;
  final_execution_allowed?: unknown;
  final_decision?: string;
  final_blocker?: string;
  open_trade_called?: unknown;
  trade_buy_called?: unknown;
  trade_sell_called?: unknown;
  broker_retcode?: unknown;
  broker_error?: unknown;
  pipeline_stage?: string;
  [key: string]: unknown;
}

export function categorizeBotActivity(sev: string, text: string): string {
  if (sev === "OVERRIDE" || ["OVERRIDE", "IGNORED", "LOSS_CLOSE_BLOCKED"].some((k) => text.includes(k))) {
    return "overrides";
  }
  // A primary decision can truthfully say "no entry"/"waiting for entry".
  // It is not a broker execution.  Only the EA's explicit execution events
  // (or the legacy TRADE/ENTRY severities) belong in the trade-open feed.
  if (["ENTRY", "TRADE"].includes(sev) || ["TRADE_EXECUTED", "FIRE", "PYR"].some((k) => text.includes(k))) {
    return "entries";
  }
  if (sev === "EXIT" || ["EXIT", "CLOSE", "CLOSED"].some((k) => text.includes(k))) return "exits";
  if (sev === "BLOCK" || ["BLOCK", "VETO"].some((k) => text.includes(k))) return "blocks";
  if (["ERROR", "CRITICAL"].includes(sev) || ["ERROR", "FAILED"].some((k) => text.includes(k))) return "errors";
  if (["RISK", "LOT", "GROWTH", "LOCK", "DRAWDOWN", "MARGIN"].some((k) => text.includes(k))) return "risk";
  if (["AI", "DIRECTOR", "CONFIDENCE", "ML", "BRAIN"].some((k) => text.includes(k))) return "ai";
  return "info";
}

/**
 * Port of server.py:6829 `_store_bot_activity` -- dedupes identical events
 * within a 15-minute window (same license/account/symbol/type/severity/
 * module/decision/reason/blocked_by/ticket hashes to the same dedupe_key),
 * bumping repeat_count instead of inserting a duplicate row; otherwise
 * inserts a new categorized activity document and prunes the collection
 * back to 2000 once it exceeds 2500 documents.
 */
export async function storeBotActivity(
  eventType: string,
  severity: string,
  message: string,
  account = "",
  symbol = "",
  details: BotActivityDetails = {},
): Promise<Record<string, unknown>> {
  const db = getDb();
  const now = new Date();
  const sev = (severity || "INFO").toUpperCase();
  const licenseKey = normalizeLicenseKey(String(details.license_key ?? ""));
  const ev = (eventType || "INFO").toUpperCase();
  const reason = String(details.reason ?? message ?? "").slice(0, 300);
  const moduleName = String(details.module ?? "").slice(0, 80);
  const decision = String(details.decision ?? "").slice(0, 160);
  const blockedBy = String(details.blocked_by ?? "").slice(0, 120);
  const ticket = String(details.ticket ?? "");
  const text = `${ev} ${sev} ${moduleName} ${decision} ${reason} ${blockedBy}`.toUpperCase();
  const category = categorizeBotActivity(sev, text);

  const dedupeSource = [licenseKey, account || "", symbol || "", ev, sev, moduleName, decision, reason, blockedBy, ticket].join("|");
  const dedupeKey = createHash("sha256").update(dedupeSource, "utf8").digest("hex");
  const windowStart = new Date(now.getTime() - 15 * 60_000).toISOString();

  const activity = db.collection("cloud_bot_activity");
  const existing = await activity.findOne(
    { dedupe_key: dedupeKey, ts: { $gte: windowStart } },
    { projection: { _id: 0 }, sort: { ts: -1 } },
  );
  if (existing) {
    const repeatCount = Number(existing["repeat_count"] ?? 1) + 1;
    const patch = {
      ts: now.toISOString(),
      last_repeat_at: now.toISOString(),
      repeat_count: repeatCount,
      message: String(message ?? "").slice(0, 600),
      details,
      normalized_symbol: normalizeGoldSymbol(symbol),
    };
    await activity.updateOne({ id: existing["id"] as string }, { $set: patch });
    let manualMarketQuote: Record<string, unknown> = { persisted: false };
    try {
      manualMarketQuote = { ...(await recordVerifiedManualTradingQuote({ account: account || "", symbol: symbol || "", receivedAt: now, marketThesis: details["market_thesis"] })) };
      await recordAuditableEaDecision({ at: now, account: account || "", symbol: symbol || "", eventType: ev, severity: sev, category, message: String(message ?? ""), details });
    } catch (error) {
      recordDiagnostic("warning", "manual-trading-market-store", error, { code: "BROKER_CANDLE_PERSIST_FAILED" });
      /* A candle-store failure must not affect an EA acknowledgement. */
    }
    return { ...existing, ...patch, manual_market_quote: manualMarketQuote };
  }

  const doc: Record<string, unknown> = {
    id: randomUUID(),
    ts: now.toISOString(),
    first_seen_at: now.toISOString(),
    last_repeat_at: now.toISOString(),
    repeat_count: 1,
    dedupe_key: dedupeKey,
    event_type: ev,
    severity: sev,
    event_category: category,
    license_key: licenseKey,
    account: account || "",
    symbol: symbol || "",
    normalized_symbol: normalizeGoldSymbol(symbol),
    message: String(message ?? "").slice(0, 600),
    details,
    module: moduleName,
    decision,
    reason,
    blocked_by: blockedBy,
    ticket,
    allowed: details.allowed ?? details.trade_allowed,
    mode: details.mode ?? "",
    market_bias: details.market_bias ?? "",
    signal_direction: details.signal_direction ?? "",
    ai_confidence: details.ai_confidence,
    score: details.score,
    candidate_allowed: details.candidate_allowed,
    final_execution_allowed: details.final_execution_allowed,
    final_decision: details.final_decision ?? "",
    final_blocker: details.final_blocker ?? "",
    open_trade_called: details.open_trade_called,
    trade_buy_called: details.trade_buy_called,
    trade_sell_called: details.trade_sell_called,
    broker_retcode: details.broker_retcode,
    broker_error: details.broker_error,
    pipeline_stage: details.pipeline_stage ?? "",
  };
  await activity.insertOne({ ...doc });

  // Retain verified broker candles separately from short-lived operational
  // activity. This is deliberately best-effort: a storage failure can never
  // make an EA heartbeat or trade decision fail.
  let manualMarketQuote: Record<string, unknown> = { persisted: false };
  try {
    manualMarketQuote = { ...(await recordVerifiedManualTradingQuote({
      account: account || "",
      symbol: symbol || "",
      receivedAt: now,
      marketThesis: details["market_thesis"],
    })) };
    await recordAuditableEaDecision({ at: now, account: account || "", symbol: symbol || "", eventType: ev, severity: sev, category, message: String(message ?? ""), details });
  } catch (error) {
    recordDiagnostic("warning", "manual-trading-market-store", error, { code: "BROKER_CANDLE_PERSIST_FAILED" });
    /* Manual Trading Intelligence will fail closed until its candle history exists. */
  }

  const total = await activity.estimatedDocumentCount();
  if (total > 2500) {
    const oldest = await activity
      .find({}, { projection: { _id: 1, ts: 1 } })
      .sort({ ts: 1 })
      .limit(total - 2000)
      .toArray();
    if (oldest.length > 0) {
      await activity.deleteMany({ _id: { $in: oldest.map((o) => o["_id"]) } });
    }
  }
  return { ...doc, manual_market_quote: manualMarketQuote };
}

/**
 * Correct rows written before execution classification was tightened.  This
 * changes persisted source metadata (not frontend rendering), is idempotent,
 * and deliberately leaves genuine broker execution rows untouched.
 */
export async function repairMisclassifiedActivityCategories(): Promise<number> {
  const activity = getDb().collection("cloud_bot_activity");
  const rows = await activity
    .find({ event_category: "entries" }, { projection: { _id: 0, id: 1, event_type: 1, severity: 1, module: 1, decision: 1, reason: 1, blocked_by: 1 } })
    .limit(2500)
    .toArray() as Record<string, unknown>[];
  let repaired = 0;
  for (const row of rows) {
    const text = [row["event_type"], row["severity"], row["module"], row["decision"], row["reason"], row["blocked_by"]]
      .map((value) => String(value ?? "")).join(" ").toUpperCase();
    const category = categorizeBotActivity(String(row["severity"] ?? "INFO").toUpperCase(), text);
    if (category !== "entries" && row["id"]) {
      await activity.updateOne({ id: row["id"] }, { $set: { event_category: category, category_repaired_at: new Date().toISOString() } });
      repaired += 1;
    }
  }
  return repaired;
}
