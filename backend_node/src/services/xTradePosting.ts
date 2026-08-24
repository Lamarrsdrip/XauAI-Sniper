import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { xOAuthConnection, xUserAccessToken } from "./xOAuth.js";
import { normalizeGoldSymbol } from "./goldSymbol.js";

export type FinalTrade = Record<string, unknown>;
const asNumber = (v: unknown) => typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;

// Structured, secret- and account-number-free logging so the Admin X Posting
// page (and server logs) can explain *why* a finalized trade did or did not
// produce a post. Never pass the raw `trade` object or credentials here --
// only the closed_trade_id and other non-identifying fields.
function xPostLog(event: string, fields: Record<string, unknown> = {}): void {
  console.log(`[x-posting] ${event}`, JSON.stringify(fields));
}

// Public X posts were the original canonical-symbol consumer.  Keep this
// export for callers, but share the exact normalizer with market ingestion.
export const normalizePublicSymbol = normalizeGoldSymbol;
export function canonicalTradeId(t: FinalTrade): string { return String(t["trade_identity"] ?? t["id"] ?? `${String(t["account_login"] ?? "")}:${String(t["ticket"] ?? t["deal_id"] ?? "")}`); }
export function buildXTradePost(t: FinalTrade): string {
  // The EA's durable journal schema calls its close quote `price`; older
  // reconciled rows used close_price/exit_price.  Entry must never borrow that
  // close quote, otherwise an incomplete trade could be posted as a fake zero move.
  const profit = asNumber(t["profit"]); const entry = asNumber(t["entry_price"] ?? t["open_price"]); const exit = asNumber(t["exit_price"] ?? t["close_price"] ?? t["price"]); const dir = String(t["direction"] ?? "").toUpperCase();
  if (!t["closed"] && !t["closed_at"]) throw new Error("Only a final closed trade can be posted.");
  if (!Number.isFinite(profit) || !Number.isFinite(entry) || !Number.isFinite(exit) || !["BUY", "SELL"].includes(dir)) throw new Error("Final closed trade data is incomplete.");
  const result = profit > 0 ? "WIN" : profit < 0 ? "LOSS" : "BREAKEVEN";
  return `XauCloud Trade Closed 🟡\n\n${normalizePublicSymbol(t["symbol"])} • ${dir}\nEntry: ${entry.toFixed(2)}\nExit: ${exit.toFixed(2)}\n\nResult: ${result}\nP/L: ${profit >= 0 ? "+" : "-"}$${Math.abs(profit).toFixed(2)}\n\nAutomatically recorded by XauCloud.\nWins and losses are both published.\n\nXauCloud — Built for Gold.`;
}
export async function xPostingConfigured(): Promise<boolean> { return Boolean(env.X_USER_ACCESS_TOKEN || await xOAuthConnection()); }
export async function xPostingSettings(): Promise<Record<string, unknown>> { const [row, connection] = await Promise.all([getDb().collection("x_posting_settings").findOne({ id: "trade_posts" }, { projection: { _id: 0 } }), xOAuthConnection()]); return { auto_post_enabled: Boolean(row?.["auto_post_enabled"]), post_wins: row?.["post_wins"] !== false, post_losses: row?.["post_losses"] !== false, post_breakeven: Boolean(row?.["post_breakeven"]), configured: Boolean(env.X_USER_ACCESS_TOKEN || connection), account_username: env.X_ACCOUNT_USERNAME || connection?.["account_username"] || null }; }

export async function enqueueFinalTradeForXPost(trade: FinalTrade): Promise<void> {
  const id = canonicalTradeId(trade);
  if (!id || id.endsWith(":")) {
    xPostLog("skip_no_identity", {});
    return;
  }
  const key = `x_trade_post:${id}`;
  const result = await getDb().collection("x_trade_posts").updateOne(
    { idempotency_key: key },
    { $setOnInsert: { id: `xpost-${randomUUID()}`, idempotency_key: key, closed_trade_id: id, trade, status: "queued", retry_count: 0, created_at: new Date().toISOString() } },
    { upsert: true },
  );
  if (result.upsertedCount) xPostLog("queued", { closed_trade_id: id });
  else xPostLog("skip_already_queued", { closed_trade_id: id });
}

async function postToX(text: string): Promise<{ id: string }> {
  const accessToken = await xUserAccessToken();
  if (!accessToken) throw Object.assign(new Error("X user-context credentials are not configured."), { statusCode: 503 });
  const response = await fetch("https://api.x.com/2/tweets", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    xPostLog("x_api_response", { ok: false, status: response.status });
    const e = Object.assign(new Error(`X API request failed (${response.status}).`), { status: response.status, retry_after: response.headers.get("retry-after") });
    throw e;
  }
  const id = String((payload["data"] as Record<string, unknown> | undefined)?.["id"] ?? "");
  if (!id) throw new Error("X API did not return a post id.");
  xPostLog("x_api_response", { ok: true, status: response.status });
  return { id };
}

export async function publishApprovedXTrade(trade: FinalTrade): Promise<Record<string, unknown>> {
  if (!await xPostingConfigured()) throw Object.assign(new Error("X user-context credentials are not configured."), { statusCode: 503 });
  const snapshot = xTradePostSnapshot(trade);
  const key = `x_trade_post:${snapshot.closed_trade_id}`;
  const coll = getDb().collection("x_trade_posts");
  await coll.updateOne({ idempotency_key: key }, { $setOnInsert: { id: `xpost-${randomUUID()}`, idempotency_key: key, closed_trade_id: snapshot.closed_trade_id, trade, status: "queued", retry_count: 0, created_at: new Date().toISOString(), source: "admin_manual" } }, { upsert: true });
  const claimed = await coll.findOneAndUpdate({ idempotency_key: key, status: { $in: ["queued", "failed"] } }, { $set: { status: "posting", attempted_at: new Date().toISOString(), trade } }, { returnDocument: "after" });
  if (!claimed) {
    const existing = await coll.findOne({ idempotency_key: key }, { projection: { _id: 0 } });
    xPostLog("skip_duplicate_publish", { closed_trade_id: snapshot.closed_trade_id });
    return { ...(existing ?? {}), duplicate: true };
  }
  xPostLog("publishing", { closed_trade_id: snapshot.closed_trade_id, source: "admin_manual" });
  try {
    const posted = await postToX(snapshot.post_text);
    const result = { status: "posted", x_post_id: posted.id, posted_at: new Date().toISOString() };
    await coll.updateOne({ idempotency_key: key, status: "posting" }, { $set: result });
    xPostLog("posted", { closed_trade_id: snapshot.closed_trade_id, x_post_id: posted.id });
    return { ...result, closed_trade_id: snapshot.closed_trade_id };
  } catch (error) {
    xPostLog("failed", { closed_trade_id: snapshot.closed_trade_id, error: String(error) });
    await failXTradePost(claimed);
    throw error;
  }
}

async function failXTradePost(row: Record<string, unknown>): Promise<void> {
  const retries = Number(row["retry_count"] ?? 0) + 1;
  const retryAfter = Number((row["retry_after"] ?? 0));
  const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : Math.min(3600, 30 * 2 ** retries);
  const status = retries >= 5 ? "failed" : "queued";
  xPostLog("retry_state", { closed_trade_id: row["closed_trade_id"], retry_count: retries, next_status: status, delay_seconds: delay });
  await getDb().collection("x_trade_posts").updateOne(
    { idempotency_key: String(row["idempotency_key"] ?? ""), status: "posting" },
    { $set: { status, retry_count: retries, attempted_at: new Date().toISOString(), next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(), failure_reason: `X posting failed; retryable=${retries < 5}` } },
  );
}

export async function processQueuedXTradePosts(limit = 20): Promise<void> {
  const settings = await xPostingSettings();
  if (!settings["auto_post_enabled"]) { xPostLog("skip_auto_post_disabled", {}); return; }
  if (!await xPostingConfigured()) { xPostLog("skip_not_configured", {}); return; }
  const coll = getDb().collection("x_trade_posts");
  const now = new Date().toISOString();
  const rows = await coll.find({ status: "queued", retry_count: { $lt: 5 }, $or: [{ next_attempt_at: { $exists: false } }, { next_attempt_at: { $lte: now } }] }).limit(limit).toArray();
  for (const row of rows) {
    const trade = row["trade"] as FinalTrade;
    const closedTradeId = row["closed_trade_id"];
    const profit = asNumber(trade["profit"]);
    if ((profit > 0 && !settings["post_wins"]) || (profit < 0 && !settings["post_losses"]) || (profit === 0 && !settings["post_breakeven"])) {
      xPostLog("skip_ineligible", { closed_trade_id: closedTradeId, reason: profit > 0 ? "post_wins_disabled" : profit < 0 ? "post_losses_disabled" : "post_breakeven_disabled" });
      continue;
    }
    const rateSlot = await getDb().collection("x_posting_settings").updateOne({ id: "trade_posts", auto_post_enabled: true, $or: [{ last_auto_post_at: { $exists: false } }, { last_auto_post_at: { $lte: new Date(Date.now() - 15_000).toISOString() } }] }, { $set: { last_auto_post_at: now } });
    if (!rateSlot.modifiedCount) break;
    const claimed = await coll.findOneAndUpdate({ _id: row["_id"], status: "queued" }, { $set: { status: "posting", attempted_at: new Date().toISOString() } }, { returnDocument: "after" });
    if (!claimed) continue;
    xPostLog("publishing", { closed_trade_id: closedTradeId, source: "auto" });
    try {
      const posted = await postToX(buildXTradePost(trade));
      await coll.updateOne({ _id: row["_id"], status: "posting" }, { $set: { status: "posted", x_post_id: posted.id, posted_at: new Date().toISOString(), attempted_at: new Date().toISOString() } });
      xPostLog("posted", { closed_trade_id: closedTradeId, x_post_id: posted.id });
    } catch (error) {
      xPostLog("failed", { closed_trade_id: closedTradeId, error: String(error) });
      const retryAfter = Number((error as { retry_after?: unknown }).retry_after ?? 0);
      await failXTradePost({ ...claimed, retry_after: retryAfter });
    }
  }
}

export const xTradePostSnapshot = (trade: FinalTrade) => ({ closed_trade_id: canonicalTradeId(trade), post_text: buildXTradePost(trade), content_hash: createHash("sha256").update(buildXTradePost(trade)).digest("hex") });
