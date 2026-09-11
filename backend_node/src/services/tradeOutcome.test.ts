import { describe, expect, it } from "vitest";
import { canonicalTradeOutcome, shadowOutcome } from "./tradeOutcome.js";

describe("tradeOutcome", () => {
  it("never turns unknown results into break-even", () => {
    expect(canonicalTradeOutcome("MANUAL_CLOSE")).toBeNull();
    expect(shadowOutcome("MANUAL_CLOSE")).toBe("UNCLASSIFIED");
  });
  it("normalizes supported outcomes", () => {
    expect(canonicalTradeOutcome("WIN")).toBe("WIN");
    expect(canonicalTradeOutcome("BE")).toBe("BREAK_EVEN");
    expect(canonicalTradeOutcome("PARTIAL_PROFIT")).toBe("PARTIAL_PROFIT");
  });
});
