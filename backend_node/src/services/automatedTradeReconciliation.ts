import { getDb } from "../db.js";
import { OUTLOOK_HORIZON_HOURS, OUTLOOK_SYMBOL, buildResultConversion } from "./marketOutlookCore.js";
import { asUtc } from "./marketOutlookEvidence.js";

/**
 * Port of market_outlook.py's automated-trade-result reconciliation
 * subsystem (lines 2857-3088). Links a published outlook signal to the
 * REAL automated trade (if any) that followed it, sourced from
 * trade_journal (broker-confirmed entry/exit/R/close-reason data). Kept
 * deliberately SEPARATE from the advisory price-tracking elsewhere in
 * Market Outlook (tracking_entry_price/tp1_hit_at/final_result/etc, which
 * represents "what if you had taken this advisory setup"): a prior owner
 * directive established outlook_type=HOURLY_MANUAL_BIAS /
 * execution_authority=False specifically so the advisory opinion is never
 * confused with "XauCloud opened/approved a trade." Both are surfaced to
 * the customer, clearly labeled, never merged into one field.
 */

const TRADE_MATCH_ENTRY_TOLERANCE_R = 0.5;
const TRADE_MATCH_GRACE_MINUTES = 30;

type MatchResult =
  | { status: "not_applicable" }
  | { status: "no_trade_found" }
  | { status: "uncertain"; candidate_tickets: unknown[] }
  | { status: "matched"; trade: Record<string, unknown> };

/** Port of market_outlook.py:2881 `_find_matching_automated_trade` -- deterministic match only, never guesses. */
async function findMatchingAutomatedTrade(doc: Record<string, unknown>): Promise<MatchResult> {
  const direction = String(doc["primary_direction"] ?? "").toUpperCase();
  const account = String(doc["account"] ?? "");
  if ((direction !== "BUY" && direction !== "SELL") || !account) return { status: "not_applicable" };

  const publishedAt = asUtc(doc["published_at"]);
  if (!publishedAt) return { status: "not_applicable" };
  const expiryAt = asUtc(doc["expiry_at"]) ?? new Date(publishedAt.getTime() + OUTLOOK_HORIZON_HOURS * 3_600_000);
  const windowStart = publishedAt.getTime() / 1000;
  const windowEnd = expiryAt.getTime() / 1000 + TRADE_MATCH_GRACE_MINUTES * 60;

  const db = getDb();
  let candidates = await db
    .collection("trade_journal")
    .find(
      {
        account_login: account,
        symbol: doc["symbol"] ?? OUTLOOK_SYMBOL,
        direction,
        closed_at: { $gt: 0 },
        opened_at: { $gte: windowStart, $lte: windowEnd },
      },
      { projection: { _id: 0 } },
    )
    .limit(20)
    .toArray();

  const entryRef = doc["tracking_entry_price"];
  const risk = doc["risk_distance"];
  if (entryRef && risk) {
    const tol = Number(risk) * TRADE_MATCH_ENTRY_TOLERANCE_R;
    candidates = candidates.filter((c) => Math.abs(Number(c["entry_price"] ?? 0) - Number(entryRef)) <= tol);
  }

  if (candidates.length === 0) return { status: "no_trade_found" };
  if (candidates.length > 1) {
    const tickets = [...new Set(candidates.map((c) => c["ticket"]).filter((t) => t))].sort();
    return { status: "uncertain", candidate_tickets: tickets };
  }
  return { status: "matched", trade: candidates[0]! };
}

/** Port of market_outlook.py:2923 `_classify_automated_close` -- WIN/LOSS/BE always from broker-confirmed realized profit, never inferred from exit_reason text alone. */
function classifyAutomatedClose(trade: Record<string, unknown>): string {
  const profit = Number(trade["profit"] ?? 0);
  const reason = String(trade["exit_reason"] ?? "").toUpperCase();
  const base = Math.abs(profit) < 0.01 ? "BREAK_EVEN" : profit > 0 ? "WIN" : "LOSS";
  if (base === "LOSS" && ["STOP_LOSS", "SL_HIT", "HARD_SL"].some((tag) => reason.includes(tag))) return "SL_HIT";
  if (base === "WIN" && ["TAKE_PROFIT", "TP_HIT", "TP1", "TP2", "TP3"].some((tag) => reason.includes(tag))) return "TP_HIT";
  return base;
}

/** Port of market_outlook.py:2944 `_build_automated_trade_result`. */
function buildAutomatedTradeResult(trade: Record<string, unknown>): Record<string, unknown> {
  const entryPrice = Number(trade["entry_price"] ?? 0) || null;
  const exitPrice = Number(trade["price"] ?? 0) || null;
  const direction = String(trade["direction"] ?? "").toUpperCase();
  let priceMove: number | null = null;
  if (entryPrice !== null && exitPrice !== null && (direction === "BUY" || direction === "SELL")) {
    priceMove = direction === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
  }
  const conversion = buildResultConversion({ r: (trade["final_r"] as number | null | undefined) ?? null, price_move: priceMove });
  const openedAt = trade["opened_at"] ? new Date(Number(trade["opened_at"]) * 1000).toISOString() : null;
  const closedAt = trade["closed_at"] ? new Date(Number(trade["closed_at"]) * 1000).toISOString() : null;
  return {
    ticket: trade["ticket"],
    direction: trade["direction"],
    symbol: trade["symbol"],
    entry_price: entryPrice,
    exit_price: exitPrice,
    realized_profit: trade["profit"],
    realized_r: trade["final_r"],
    ...conversion,
    close_reason: trade["exit_reason"] ?? "",
    result: classifyAutomatedClose(trade),
    opened_at: openedAt,
    closed_at: closedAt,
    account_login: trade["account_login"],
    reconciled_at: new Date().toISOString(),
  };
}

/**
 * Port of market_outlook.py:2973 `reconcile_automated_trade_result`.
 * Idempotent and fail-closed against overwrite: once a status="matched"
 * result exists, this is a no-op -- broker-confirmed truth outranks any
 * later recompute and can never flip back to "uncertain"/"no_trade_found".
 */
export async function reconcileAutomatedTradeResult(doc: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const existing = doc["automated_trade_result"] as Record<string, unknown> | undefined;
  if (existing?.["status"] === "matched") return null;

  const match = await findMatchingAutomatedTrade(doc);
  const db = getDb();
  let result: Record<string, unknown>;
  if (match.status === "matched") {
    result = { status: "matched", ...buildAutomatedTradeResult(match.trade) };
  } else if (match.status === "uncertain") {
    result = { status: "uncertain", candidate_tickets: match.candidate_tickets, reconciled_at: new Date().toISOString() };
  } else {
    result = { status: match.status, reconciled_at: new Date().toISOString() };
  }

  await db.collection("cloud_market_outlooks").updateOne({ id: doc["id"] }, { $set: { automated_trade_result: result } });
  if (result["status"] === "matched") {
    await dispatchAutomatedTradeNotification({ ...doc, automated_trade_result: result });
  }
  return result;
}

/** Port of market_outlook.py:3000 `_dispatch_automated_trade_notification` -- fires exactly once per outlook; never raises. */
async function dispatchAutomatedTradeNotification(doc: Record<string, unknown>): Promise<void> {
  const flags = (doc["notification_flags"] as Record<string, unknown> | undefined) ?? {};
  if (flags["AUTOMATED_TRADE_RESULT"]) return;
  let dispatchResult: number | null;
  try {
    const { sendAutomatedTradeResultNotification } = await import("./notifications.js");
    dispatchResult = await sendAutomatedTradeResultNotification(doc);
  } catch (exc) {
    console.error(`AUTOMATED_TRADE_NOTIFICATION_FAILED outlook_id=${doc["id"]}: ${String(exc)}`);
    return;
  }
  if (dispatchResult === null) return;
  const { RETRYABLE_FAILURES } = await import("./notifications.js");
  const db = getDb();
  const retryable = await db.collection("cloud_notification_log").findOne({
    outlook_id: doc["id"],
    notification_type: "AUTOMATED_TRADE_RESULT",
    failure_reason: { $in: Array.from(RETRYABLE_FAILURES) },
  });
  if (!retryable) {
    await db
      .collection("cloud_market_outlooks")
      .updateOne({ id: doc["id"] }, { $set: { "notification_flags.AUTOMATED_TRADE_RESULT": new Date().toISOString() } });
  }
}

/** Port of market_outlook.py:3027 `dispatch_pending_automated_trade_notifications` -- crash-recovery pass. */
export async function dispatchPendingAutomatedTradeNotifications(): Promise<number> {
  const rows = await getDb()
    .collection("cloud_market_outlooks")
    .find(
      { "automated_trade_result.status": "matched", "notification_flags.AUTOMATED_TRADE_RESULT": { $exists: false } },
      { projection: { _id: 0 } },
    )
    .sort({ published_at: -1 })
    .toArray();
  let dispatched = 0;
  for (const doc of rows) {
    await dispatchAutomatedTradeNotification(doc);
    dispatched += 1;
  }
  return dispatched;
}

/**
 * Port of market_outlook.py:3043 `reconcile_trade_journal_entry` --
 * real-time trigger called immediately when POST /journal/log receives a
 * CLOSED trade. Never raises: a reconciliation failure must never break
 * trade-journal logging.
 */
export async function reconcileTradeJournalEntry(entry: Record<string, unknown>): Promise<{ outlook_id: unknown; result: Record<string, unknown> } | null> {
  try {
    if (!entry["closed_at"]) return null;
    const direction = String(entry["direction"] ?? "").toUpperCase();
    const account = String(entry["account_login"] ?? "");
    if ((direction !== "BUY" && direction !== "SELL") || !account) return null;
    const openedAt = entry["opened_at"];
    if (!openedAt) return null;
    const openedDt = new Date(Number(openedAt) * 1000);

    const db = getDb();
    const candidates = await db
      .collection("cloud_market_outlooks")
      .find(
        { account, symbol: entry["symbol"] ?? OUTLOOK_SYMBOL, primary_direction: direction, automated_trade_result: { $exists: false } },
        { projection: { _id: 0 } },
      )
      .sort({ published_at: -1 })
      .limit(50)
      .toArray();

    for (const outlookDoc of candidates) {
      const publishedAt = asUtc(outlookDoc["published_at"]);
      if (!publishedAt) continue;
      const expiryAt = asUtc(outlookDoc["expiry_at"]) ?? new Date(publishedAt.getTime() + OUTLOOK_HORIZON_HOURS * 3_600_000);
      const windowEnd = new Date(expiryAt.getTime() + TRADE_MATCH_GRACE_MINUTES * 60_000);
      if (!(openedDt >= publishedAt && openedDt <= windowEnd)) continue;
      const result = await reconcileAutomatedTradeResult(outlookDoc);
      if (result && result["status"] === "matched") {
        return { outlook_id: outlookDoc["id"], result };
      }
    }
    return null;
  } catch (exc) {
    console.error(`AUTOMATED_TRADE_RECONCILIATION_FAILED ticket=${entry["ticket"]}: ${String(exc)}`);
    return null;
  }
}
