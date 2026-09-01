import { createHash } from "node:crypto";
import { env } from "../env.js";

/** Port of server.py:150-382 -- AI cost/cache/budget tracking (in-process state, matches Python's module-level globals). */

interface AiCostReason {
  ts: string;
  purpose: string;
  provider: string;
  model: string;
  tokens: number;
  cost: number;
  reason: string;
  cache_key: string;
}

const aiCostStats = {
  day: new Date().toISOString().slice(0, 10),
  calls: 0,
  tokens: 0,
  estimated_cost: 0,
  cache_hits: 0,
  skipped: 0,
  last_call_at: 0,
  reasons: [] as AiCostReason[],
};

interface CacheEntry {
  createdAt: number;
  result: Record<string, unknown>;
  purpose: string;
  tokens: number;
}
const aiCostCache = new Map<string, CacheEntry>();

interface AccountBucket {
  day: string;
  calls: number;
  lastCallAt: number;
}
const aiCostStatsByAccount = new Map<string, AccountBucket>();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetIfNewDay(): void {
  const today = todayUtc();
  if (aiCostStats.day === today) return;
  aiCostStats.day = today;
  aiCostStats.calls = 0;
  aiCostStats.tokens = 0;
  aiCostStats.estimated_cost = 0;
  aiCostStats.cache_hits = 0;
  aiCostStats.skipped = 0;
  aiCostStats.last_call_at = 0;
  aiCostStats.reasons = [];
  aiCostCache.clear();
}

function estimateAiTokens(...texts: string[]): number {
  const chars = texts.reduce((sum, t) => sum + (t || "").length, 0);
  return Math.max(1, Math.floor(chars / 4) + 1);
}

function estimateAiCost(tokens: number): number {
  return Math.round((tokens / 1000) * env.AI_COST_TOKEN_PRICE_PER_1K * 1e6) / 1e6;
}

/** Port of server.py:189 `classify_market_mode` -- mirrors the EA's XAU_DetectMarketMode() name-pattern logic. */
const INDEX_SYMBOL_KEYWORDS = ["INDEX", "VOLATILITY", "VOL", "BOOM", "CRASH", "STEP", "JUMP", "RANGE", "SPREDIX", "VIX", "SYNTHETIC", "DERIV"];
export function classifyMarketMode(symbol: string): "GOLD_MODE" | "INDEX_MODE" {
  const s = (symbol || "").toUpperCase();
  if (s.includes("XAU") || s.includes("GOLD")) return "GOLD_MODE";
  if (INDEX_SYMBOL_KEYWORDS.some((kw) => s.includes(kw))) return "INDEX_MODE";
  return "GOLD_MODE";
}

function bucket(value: unknown, size: number, dflt = "0"): string {
  const v = Number(value);
  if (!Number.isFinite(v)) return dflt;
  if (size <= 0) return String(Math.round(v * 100) / 100);
  return String(Math.round(v / size));
}

/** Port of server.py:211 `_ai_cost_state_hash`. */
export function aiCostStateHash(purpose: string, payload: Record<string, unknown>): string {
  const symbol = String(payload["symbol"] ?? "XAUUSD").toUpperCase();
  const setup = String(payload["setup"] ?? payload["setup_name"] ?? "NA").toUpperCase();
  const regime = String(payload["regime"] ?? "NA").toUpperCase();
  const session = String(payload["session"] ?? "NA").toUpperCase();
  const grade = String(payload["grade"] ?? "NA").toUpperCase();
  const direction = String(payload["direction"] ?? payload["h1_trend"] ?? "NA").toUpperCase();
  const htf = String(payload["htf_consensus"] ?? payload["h1_trend"] ?? "NA").toUpperCase();
  const sig = String(payload["signature"] ?? "").slice(0, 80);

  const features: Record<string, string> = {
    purpose,
    symbol,
    setup,
    regime,
    session,
    grade,
    direction,
    htf,
    signature: sig,
    spread_b: bucket(payload["spread"] ?? 0, 5),
    atr_b: bucket(payload["atr"] ?? 0, 0.25),
    price_b: bucket(payload["price"] ?? payload["current_price"] ?? payload["entry_price"], 0.5),
    rsi_b: bucket(payload["rsi"] ?? 0, 5),
    score_b: bucket(payload["combined_score"] ?? 0, 1),
    profit_b: bucket(payload["profit"] ?? 0, 25),
    pending_exit: String(payload["pending_exit_reason"] ?? "").slice(0, 40),
    daily_pct_b: bucket(payload["daily_pct"] ?? 0, 0.5),
    basket_pl_b: bucket(payload["basket_float_pl"] ?? 0, 25),
    loss_streak_b: String(Math.min(Number(payload["recent_losses"] ?? 0) || 0, 5)),
    open_pos_b: String(Math.min(Number(payload["open_positions"] ?? 0) || 0, 4)),
  };
  const raw = JSON.stringify(features, Object.keys(features).sort());
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 24);
}

/** Port of server.py:263 `_ai_cache_get`. */
export function aiCacheGet(cacheKey: string): Record<string, unknown> | null {
  resetIfNewDay();
  const item = aiCostCache.get(cacheKey);
  if (!item) return null;
  if ((Date.now() - item.createdAt) / 1000 > env.AI_COST_CACHE_TTL_SECONDS) {
    aiCostCache.delete(cacheKey);
    return null;
  }
  aiCostStats.cache_hits += 1;
  return {
    ...item.result,
    ai_status: "Cache Reuse",
    ai_cost: {
      cache_hit: true,
      cache_key: cacheKey,
      reason: "AI_COST_CACHE_HIT",
      calls_today: aiCostStats.calls,
      tokens_today: aiCostStats.tokens,
      estimated_cost_today: Math.round(aiCostStats.estimated_cost * 1e6) / 1e6,
    },
  };
}

/** Port of server.py:285 `_ai_cache_put`. */
export function aiCachePut(cacheKey: string, result: Record<string, unknown>, purpose: string, tokens: number): void {
  aiCostCache.set(cacheKey, { createdAt: Date.now(), result, purpose, tokens });
  if (aiCostCache.size > 500) {
    const sorted = Array.from(aiCostCache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [key] of sorted.slice(0, 100)) aiCostCache.delete(key);
  }
}

function aiAccountKey(accountId: string): string {
  return (accountId || "").trim() || "_shared";
}

/** Port of server.py:300 `_ai_account_bucket` -- per-account daily-call/throttle buckets. */
function aiAccountBucket(accountId: string): AccountBucket {
  const key = aiAccountKey(accountId);
  const today = todayUtc();
  let b = aiCostStatsByAccount.get(key);
  if (!b || b.day !== today) {
    b = { day: today, calls: 0, lastCallAt: 0 };
    aiCostStatsByAccount.set(key, b);
  }
  return b;
}

/** Port of server.py:318 `_ai_budget_allows`. */
export function aiBudgetAllows(
  _purpose: string,
  _cacheKey: string,
  highImpact = false,
  accountId = "",
): [boolean, string] {
  resetIfNewDay();
  const b = aiAccountBucket(accountId);
  if (b.calls >= env.AI_COST_DAILY_CALL_LIMIT) {
    aiCostStats.skipped += 1;
    return [false, `AI_COST_SKIP daily_limit ${env.AI_COST_DAILY_CALL_LIMIT} reached (account=${aiAccountKey(accountId)})`];
  }
  const elapsed = (Date.now() - b.lastCallAt) / 1000;
  if (env.AI_COST_MIN_SECONDS > 0 && elapsed < env.AI_COST_MIN_SECONDS) {
    aiCostStats.skipped += 1;
    const impact = highImpact ? "high_impact" : "normal";
    return [
      false,
      `AI_COST_SKIP throttle ${elapsed.toFixed(1)}s < ${env.AI_COST_MIN_SECONDS}s (${impact}; local rules continue, account=${aiAccountKey(accountId)})`,
    ];
  }
  return [true, "ok"];
}

/** Port of server.py:331 `_record_ai_cost`. */
export function recordAiCost(
  provider: string,
  model: string,
  prompt: string,
  responseText: string,
  purpose: string,
  cacheKey: string,
  reason: string,
  accountId = "",
): Record<string, unknown> {
  resetIfNewDay();
  const tokens = estimateAiTokens(prompt, responseText);
  const cost = estimateAiCost(tokens);
  aiCostStats.calls += 1;
  aiCostStats.tokens += tokens;
  aiCostStats.estimated_cost = Math.round((aiCostStats.estimated_cost + cost) * 1e6) / 1e6;
  aiCostStats.last_call_at = Date.now() / 1000;

  const accountBucket = aiAccountBucket(accountId);
  accountBucket.calls += 1;
  accountBucket.lastCallAt = Date.now();

  aiCostStats.reasons.push({
    ts: new Date().toISOString(),
    purpose,
    provider,
    model,
    tokens,
    cost,
    reason,
    cache_key: cacheKey,
  });
  aiCostStats.reasons = aiCostStats.reasons.slice(-50);

  return {
    cache_hit: false,
    cache_key: cacheKey,
    tokens,
    estimated_cost: cost,
    calls_today: aiCostStats.calls,
    tokens_today: aiCostStats.tokens,
    estimated_cost_today: Math.round(aiCostStats.estimated_cost * 1e6) / 1e6,
    reason,
  };
}

/** Port of server.py:369 `_ai_cost_snapshot`. */
export function aiCostSnapshot(): Record<string, unknown> {
  resetIfNewDay();
  return {
    day: aiCostStats.day,
    daily_call_limit: env.AI_COST_DAILY_CALL_LIMIT,
    min_seconds: env.AI_COST_MIN_SECONDS,
    cache_ttl_seconds: env.AI_COST_CACHE_TTL_SECONDS,
    calls_today: aiCostStats.calls,
    estimated_tokens_today: aiCostStats.tokens,
    estimated_cost_today: Math.round(aiCostStats.estimated_cost * 1e6) / 1e6,
    cache_hits_today: aiCostStats.cache_hits,
    skipped_today: aiCostStats.skipped,
    recent_reasons: aiCostStats.reasons.slice(-20),
  };
}
