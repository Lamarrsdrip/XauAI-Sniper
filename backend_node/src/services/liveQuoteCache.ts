/**
 * In-process fallback for the single most recent verified live XAUUSD quote.
 *
 * Root cause (2026-08-25 production incident): fourHourFeed.ts's read of
 * cloud_bot_activity was intermittently hitting DATABASE_READ_TIMEOUT against
 * one specific Atlas node, while the EA's heartbeat write path (which already
 * validates and briefly holds the exact same quote in memory before
 * persisting it) kept succeeding continuously throughout. That asymmetry is
 * exactly the case the architecture review called out: Manual Trading was
 * requiring a fresh synchronous Mongo read for data the backend had already
 * received and verified moments earlier.
 *
 * This is not a second market-data pipeline -- it holds only the single
 * latest quote already produced by the existing heartbeat ingestion path,
 * purely as a resilience fallback for a transient read failure. Mongo
 * (cloud_bot_activity, manual_trading_broker_candles) remains the
 * authoritative persistence/history layer; this cache never substitutes for
 * it when Mongo is healthy, and it never fabricates a quote -- only a quote
 * the EA genuinely sent and the backend genuinely validated is ever stored.
 */
export interface CachedLiveQuote {
  account: string;
  normalizedSymbol: string;
  bid: number;
  ask: number;
  mid: number;
  /** EA-reported evidence time, ISO. Falls back to receivedAtIso if absent. */
  sourceAtIso: string;
  receivedAtIso: string;
}

let cached: CachedLiveQuote | null = null;

export function recordLiveQuote(quote: CachedLiveQuote): void {
  cached = quote;
}

export function getCachedLiveQuote(): CachedLiveQuote | null {
  return cached;
}

/** Test-only: reset between cases so one test's cache can't leak into another. */
export function _resetLiveQuoteCacheForTests(): void {
  cached = null;
}
