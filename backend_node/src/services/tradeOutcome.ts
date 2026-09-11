export type CanonicalTradeOutcome = "WIN" | "LOSS" | "BREAK_EVEN" | "PARTIAL_PROFIT" | null;

/**
 * Canonicalizes only outcomes the analytics layer actually understands.
 * Unknown/typo/custom values remain null/UNCLASSIFIED; they must never be
 * silently converted into break-even training labels.
 */
export function canonicalTradeOutcome(raw: unknown): CanonicalTradeOutcome {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "WIN") return "WIN";
  if (value === "LOSS") return "LOSS";
  if (["BREAK_EVEN", "BREAKEVEN", "BE"].includes(value)) return "BREAK_EVEN";
  if (["PARTIAL_PROFIT", "PARTIAL", "PROFIT_PARTIAL"].includes(value)) return "PARTIAL_PROFIT";
  return null;
}

export function shadowOutcome(raw: unknown): "WIN" | "LOSS" | "BREAKEVEN" | "PARTIAL_PROFIT" | "UNCLASSIFIED" {
  const canonical = canonicalTradeOutcome(raw);
  if (canonical === "BREAK_EVEN") return "BREAKEVEN";
  if (canonical === "PARTIAL_PROFIT") return "PARTIAL_PROFIT";
  return canonical ?? "UNCLASSIFIED";
}
