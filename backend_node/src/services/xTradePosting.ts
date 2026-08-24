import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { xOAuthConnection, xUserAccessToken } from "./xOAuth.js";
import { normalizeGoldSymbol } from "./goldSymbol.js";

export type FinalTrade = Record<string, unknown>;
type XPostStatus = "QUEUED" | "PROCESSING" | "POSTED" | "RETRYING" | "FAILED" | "BLOCKED_INVALID_TRADE_DATA";
type FinalTradeValidation = { valid: true; trade: FinalTrade } | { valid: false; reason: string; trade: FinalTrade };
const MAX_X_POST_LENGTH = 280;
const RETRYABLE_STATUSES = ["QUEUED", "RETRYING", "queued"];
const PROCESSING_STATUSES = ["PROCESSING", "posting"];
const asNumber = (v: unknown) => typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;

// Structured, secret- and account-number-free logging. The durable queue
// stores only a safe error category/status, never X credentials or responses.
function xPostLog(event: string, fields: Record<string, unknown> = {}): void {
  console.log(`[x-posting] ${event}`, JSON.stringify(fields));
}

export const normalizePublicSymbol = normalizeGoldSymbol;
export function canonicalTradeId(t: FinalTrade): string {
  return String(t["trade_identity"] ?? t["id"] ?? `${String(t["account_login"] ?? "")}:${String(t["ticket"] ?? t["deal_id"] ?? "")}`);
}

/**
 * The EA's broker-confirmed close is currently sent as `price`. Older
 * reconciled rows may use close_price/exit_price. Do not use `??` here: the
 * journal schema historically defaulted absent exit_price to zero, which hid
 * a valid EA price and produced a false `Exit: 0.00` preview.
 */
export function authoritativeExitPrice(t: FinalTrade): number {
  for (const field of ["actual_exit_price", "exit_price", "close_price", "price"] as const) {
    const value = asNumber(t[field]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return Number.NaN;
}

/** Canonicalize the existing authoritative trade record; no synthetic price. */
export function validateFinalTrade(t: FinalTrade): FinalTradeValidation {
  const entry = asNumber(t["entry_price"] ?? t["open_price"]);
  const exit = authoritativeExitPrice(t);
  const profit = asNumber(t["profit"]);
  const direction = String(t["direction"] ?? "").toUpperCase();
  const normalized: FinalTrade = { ...t };
  if (Number.isFinite(exit) && exit > 0) normalized["actual_exit_price"] = exit;
  if (!t["closed"] && !t["closed_at"]) return { valid: false, reason: "TRADE_NOT_FINAL", trade: normalized };
  if (!Number.isFinite(entry) || entry <= 0) return { valid: false, reason: "MISSING_OR_INVALID_ENTRY_PRICE", trade: normalized };
  if (!Number.isFinite(exit) || exit <= 0) return { valid: false, reason: "MISSING_OR_INVALID_ACTUAL_EXIT_PRICE", trade: normalized };
  if (!Number.isFinite(profit)) return { valid: false, reason: "MISSING_OR_INVALID_REALIZED_PROFIT", trade: normalized };
  if (!(["BUY", "SELL"] as string[]).includes(direction)) return { valid: false, reason: "MISSING_OR_INVALID_DIRECTION", trade: normalized };
  normalized["entry_price"] = entry;
  normalized["actual_exit_price"] = exit;
  normalized["direction"] = direction;
  normalized["profit"] = profit;
  return { valid: true, trade: normalized };
}

export function buildXTradePost(t: FinalTrade): string {
  const checked = validateFinalTrade(t);
  if (!checked.valid) throw new Error(`Final closed trade data is incomplete: ${checked.reason}.`);
  const { trade } = checked;
  const profit = asNumber(trade["profit"]);
  const entry = asNumber(trade["entry_price"]);
  const exit = asNumber(trade["actual_exit_price"]);
  const direction = String(trade["direction"]);
  const result = profit > 0 ? "WIN" : profit < 0 ? "LOSS" : "BREAKEVEN";
  const emoji = profit > 0 ? "🟢" : profit < 0 ? "🔴" : "⚪️";
  const text = `XauCloud Trade Closed ${emoji}\n\n${normalizePublicSymbol(trade["symbol"])} • ${direction}\nEntry: ${entry.toFixed(2)}\nExit: ${exit.toFixed(2)}\n\nResult: ${result}\nP/L: ${profit >= 0 ? "+" : "-"}$${Math.abs(profit).toFixed(2)}\n\nXauCloud — Built for Gold.`;
  if (text.length > MAX_X_POST_LENGTH) throw new Error("X post exceeds the character limit.");
  return text;
}

export async function xPostingConfigured(): Promise<boolean> {
  return Boolean(env.X_USER_ACCESS_TOKEN || await xOAuthConnection());
}

export async function xPostingSettings(): Promise<Record<string, unknown>> {
  const [row, connection] = await Promise.all([
    getDb().collection("x_posting_settings").findOne({ id: "trade_posts" }, { projection: { _id: 0 } }),
    xOAuthConnection(),
  ]);
  return {
    auto_post_enabled: Boolean(row?.["auto_post_enabled"]),
    post_wins: row?.["post_wins"] !== false,
    post_losses: row?.["post_losses"] !== false,
    post_breakeven: Boolean(row?.["post_breakeven"]),
    configured: Boolean(env.X_USER_ACCESS_TOKEN || connection),
    account_username: env.X_ACCOUNT_USERNAME || connection?.["account_username"] || null,
  };
}

export async function enqueueFinalTradeForXPost(trade: FinalTrade): Promise<void> {
  const id = canonicalTradeId(trade);
  if (!id || id.endsWith(":")) {
    xPostLog("skip_no_identity", {});
    return;
  }
  const checked = validateFinalTrade(trade);
  const status: XPostStatus = checked.valid ? "QUEUED" : "BLOCKED_INVALID_TRADE_DATA";
  const now = new Date().toISOString();
  const result = await getDb().collection("x_trade_posts").updateOne(
    { idempotency_key: `x_trade_post:${id}` },
    {
      $setOnInsert: {
        id: `xpost-${randomUUID()}`,
        idempotency_key: `x_trade_post:${id}`,
        closed_trade_id: id,
        trade: checked.trade,
        status,
        retry_count: 0,
        created_at: now,
        ...(checked.valid ? {} : { blocked_at: now, failure_category: checked.reason }),
      },
    },
    { upsert: true },
  );
  if (result.upsertedCount) xPostLog(status === "QUEUED" ? "queued" : "blocked_invalid_trade_data", { closed_trade_id: id, ...(checked.valid ? {} : { reason: checked.reason }) });
  else xPostLog("skip_already_queued", { closed_trade_id: id });
}

async function postToX(text: string): Promise<{ id: string }> {
  const accessToken = await xUserAccessToken();
  if (!accessToken) throw Object.assign(new Error("X user-context credentials are not configured."), { category: "X_NOT_CONFIGURED", statusCode: 503 });
  const response = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    xPostLog("x_api_response", { ok: false, status: response.status });
    throw Object.assign(new Error(`X API request failed (${response.status}).`), {
      category: `X_API_HTTP_${response.status}`,
      statusCode: response.status,
      retry_after: response.headers.get("retry-after"),
    });
  }
  const id = String((payload["data"] as Record<string, unknown> | undefined)?.["id"] ?? "");
  if (!id) throw Object.assign(new Error("X API did not return a post id."), { category: "X_API_MISSING_POST_ID", statusCode: response.status });
  xPostLog("x_api_response", { ok: true, status: response.status });
  return { id };
}

function eligibleForAutoPost(profit: number, settings: Record<string, unknown>): string | null {
  if (profit > 0 && !settings["post_wins"]) return "POST_WINS_DISABLED";
  if (profit < 0 && !settings["post_losses"]) return "POST_LOSSES_DISABLED";
  if (profit === 0 && !settings["post_breakeven"]) return "POST_BREAKEVEN_DISABLED";
  return null;
}

function retryDelaySeconds(retryCount: number, retryAfter: unknown): number {
  const requested = Number(retryAfter);
  return Number.isFinite(requested) && requested > 0 ? requested : Math.min(3600, 30 * 2 ** retryCount);
}

async function failXTradePost(row: Record<string, unknown>, error?: unknown): Promise<void> {
  const retries = Number(row["retry_count"] ?? 0) + 1;
  const category = String((error as { category?: unknown } | undefined)?.category ?? "X_POSTING_ERROR").slice(0, 80);
  const responseStatus = Number((error as { statusCode?: unknown } | undefined)?.statusCode);
  const delay = retryDelaySeconds(retries, (error as { retry_after?: unknown } | undefined)?.retry_after ?? row["retry_after"]);
  const status: XPostStatus = retries >= 5 ? "FAILED" : "RETRYING";
  const now = new Date();
  xPostLog("retry_state", { closed_trade_id: row["closed_trade_id"], retry_count: retries, next_status: status, category, delay_seconds: delay });
  await getDb().collection("x_trade_posts").updateOne(
    { idempotency_key: String(row["idempotency_key"] ?? ""), status: { $in: PROCESSING_STATUSES } },
    {
      $set: {
        status,
        retry_count: retries,
        attempted_at: now.toISOString(),
        last_attempt_at: now.toISOString(),
        next_attempt_at: status === "FAILED" ? null : new Date(now.getTime() + delay * 1000).toISOString(),
        failure_category: category,
        ...(Number.isFinite(responseStatus) ? { x_response_status: responseStatus } : {}),
      },
    },
  );
}

async function blockInvalidXTradePost(row: Record<string, unknown>, checked: Extract<FinalTradeValidation, { valid: false }>): Promise<void> {
  const now = new Date().toISOString();
  await getDb().collection("x_trade_posts").updateOne(
    { idempotency_key: String(row["idempotency_key"] ?? ""), status: { $in: [...RETRYABLE_STATUSES, ...PROCESSING_STATUSES] } },
    { $set: { status: "BLOCKED_INVALID_TRADE_DATA", trade: checked.trade, blocked_at: now, failure_category: checked.reason, last_attempt_at: now } },
  );
  xPostLog("blocked_invalid_trade_data", { closed_trade_id: row["closed_trade_id"], reason: checked.reason });
}

async function recoverInterruptedPosts(): Promise<void> {
  const staleAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const coll = getDb().collection("x_trade_posts");
  const rows = await coll.find({ status: { $in: PROCESSING_STATUSES }, attempted_at: { $lte: staleAt } }).limit(20).toArray();
  for (const row of rows) {
    await coll.updateOne(
      { idempotency_key: String(row["idempotency_key"] ?? ""), status: { $in: PROCESSING_STATUSES } },
      { $set: { status: "RETRYING", failure_category: "WORKER_RESTART_RECOVERY", next_attempt_at: staleAt } },
    );
    xPostLog("recovered_interrupted_post", { closed_trade_id: row["closed_trade_id"] });
  }
}

async function markJobsWaitingForXConfiguration(): Promise<void> {
  const now = new Date();
  const coll = getDb().collection("x_trade_posts");
  const rows = await coll.find({ status: { $in: RETRYABLE_STATUSES } }).limit(20).toArray();
  for (const row of rows) {
    await coll.updateOne(
      { idempotency_key: String(row["idempotency_key"] ?? ""), status: { $in: RETRYABLE_STATUSES } },
      { $set: { status: "RETRYING", failure_category: "X_NOT_CONFIGURED", last_attempt_at: now.toISOString(), next_attempt_at: new Date(now.getTime() + 300_000).toISOString() } },
    );
  }
}

async function processClaimedXTradePost(row: Record<string, unknown>, source: "auto" | "admin_manual"): Promise<Record<string, unknown>> {
  const checked = validateFinalTrade(row["trade"] as FinalTrade);
  if (!checked.valid) {
    await blockInvalidXTradePost(row, checked);
    return { status: "BLOCKED_INVALID_TRADE_DATA", closed_trade_id: row["closed_trade_id"] };
  }
  xPostLog("publishing", { closed_trade_id: row["closed_trade_id"], source });
  try {
    const postText = buildXTradePost(checked.trade);
    const posted = await postToX(postText);
    const result = { status: "POSTED", x_post_id: posted.id, posted_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), trade: checked.trade };
    await getDb().collection("x_trade_posts").updateOne({ idempotency_key: String(row["idempotency_key"] ?? ""), status: { $in: PROCESSING_STATUSES } }, { $set: result });
    xPostLog("posted", { closed_trade_id: row["closed_trade_id"], x_post_id: posted.id });
    return { ...result, closed_trade_id: row["closed_trade_id"] };
  } catch (error) {
    xPostLog("failed", { closed_trade_id: row["closed_trade_id"], category: String((error as { category?: unknown })?.category ?? "X_POSTING_ERROR") });
    await failXTradePost(row, error);
    throw error;
  }
}

export async function publishApprovedXTrade(trade: FinalTrade): Promise<Record<string, unknown>> {
  if (!await xPostingConfigured()) throw Object.assign(new Error("X user-context credentials are not configured."), { statusCode: 503 });
  const checked = validateFinalTrade(trade);
  if (!checked.valid) throw new Error(`Final closed trade data is incomplete: ${checked.reason}.`);
  const id = canonicalTradeId(checked.trade);
  const key = `x_trade_post:${id}`;
  const coll = getDb().collection("x_trade_posts");
  await coll.updateOne(
    { idempotency_key: key },
    { $setOnInsert: { id: `xpost-${randomUUID()}`, idempotency_key: key, closed_trade_id: id, trade: checked.trade, status: "QUEUED", retry_count: 0, created_at: new Date().toISOString(), source: "admin_manual" } },
    { upsert: true },
  );
  const claimed = await coll.findOneAndUpdate(
    { idempotency_key: key, status: { $in: [...RETRYABLE_STATUSES, "FAILED"] } },
    { $set: { status: "PROCESSING", attempted_at: new Date().toISOString(), trade: checked.trade } },
    { returnDocument: "after" },
  );
  if (!claimed) {
    const existing = await coll.findOne({ idempotency_key: key }, { projection: { _id: 0 } });
    xPostLog("skip_duplicate_publish", { closed_trade_id: id });
    return { ...(existing ?? {}), duplicate: true };
  }
  return processClaimedXTradePost(claimed, "admin_manual");
}

export async function processQueuedXTradePosts(limit = 20): Promise<void> {
  await recoverInterruptedPosts();
  const settings = await xPostingSettings();
  if (!settings["auto_post_enabled"]) { xPostLog("skip_auto_post_disabled", {}); return; }
  if (!await xPostingConfigured()) {
    await markJobsWaitingForXConfiguration();
    xPostLog("skip_not_configured", {});
    return;
  }
  const coll = getDb().collection("x_trade_posts");
  const now = new Date().toISOString();
  const rows = await coll.find({ status: { $in: RETRYABLE_STATUSES }, retry_count: { $lt: 5 }, $or: [{ next_attempt_at: { $exists: false } }, { next_attempt_at: null }, { next_attempt_at: { $lte: now } }] }).limit(limit).toArray();
  for (const row of rows) {
    const checked = validateFinalTrade(row["trade"] as FinalTrade);
    if (!checked.valid) { await blockInvalidXTradePost(row, checked); continue; }
    const ineligibleReason = eligibleForAutoPost(asNumber(checked.trade["profit"]), settings);
    if (ineligibleReason) {
      xPostLog("skip_ineligible", { closed_trade_id: row["closed_trade_id"], reason: ineligibleReason });
      continue;
    }
    const rateSlot = await getDb().collection("x_posting_settings").updateOne(
      { id: "trade_posts", auto_post_enabled: true, $or: [{ last_auto_post_at: { $exists: false } }, { last_auto_post_at: { $lte: new Date(Date.now() - 15_000).toISOString() } }] },
      { $set: { last_auto_post_at: now } },
    );
    if (!rateSlot.modifiedCount) break;
    const claimed = await coll.findOneAndUpdate(
      { idempotency_key: String(row["idempotency_key"] ?? ""), status: { $in: RETRYABLE_STATUSES } },
      { $set: { status: "PROCESSING", attempted_at: new Date().toISOString(), trade: checked.trade } },
      { returnDocument: "after" },
    );
    if (!claimed) continue;
    try { await processClaimedXTradePost(claimed, "auto"); } catch { /* retry state is already durable */ }
  }
}

export const xTradePostSnapshot = (trade: FinalTrade) => {
  const checked = validateFinalTrade(trade);
  if (!checked.valid) return { closed_trade_id: canonicalTradeId(trade), status: "BLOCKED_INVALID_TRADE_DATA", reason: checked.reason };
  const postText = buildXTradePost(checked.trade);
  return { closed_trade_id: canonicalTradeId(checked.trade), status: "QUEUED", post_text: postText, content_hash: createHash("sha256").update(postText).digest("hex") };
};
