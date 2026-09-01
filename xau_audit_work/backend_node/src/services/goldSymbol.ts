/**
 * Canonical public symbol for broker-specific Gold symbols.
 *
 * Keep the broker symbol separately for audit/execution.  Canonicalising here
 * is only for cross-broker market-data identity; it must never rewrite an EA
 * order symbol.
 */
export function normalizeGoldSymbol(symbol: unknown): string {
  const raw = String(symbol ?? "").trim();
  return /^XAUUSD(?:[._A-Z0-9-]+)?$/i.test(raw) ? "XAUUSD" : raw.toUpperCase().slice(0, 32);
}

export function isGoldSymbol(symbol: unknown): boolean {
  return normalizeGoldSymbol(symbol) === "XAUUSD";
}

export const GOLD_SYMBOL_QUERY = /^XAUUSD(?:[._A-Z0-9-]+)?$/i;
