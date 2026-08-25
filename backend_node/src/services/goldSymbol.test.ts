import { describe, expect, it } from "vitest";
import { normalizeGoldSymbol, isGoldSymbol } from "./goldSymbol.js";

describe("XAUUSD symbol normalization", () => {
  it("normalizes the Exness broker suffix XAUUSDm to the canonical symbol", () => {
    expect(normalizeGoldSymbol("XAUUSDm")).toBe("XAUUSD");
    expect(isGoldSymbol("XAUUSDm")).toBe(true);
  });
  it("normalizes other common broker suffixes without hard-coding a single broker", () => {
    for (const s of ["XAUUSD", "XAUUSD.a", "XAUUSD_i", "XAUUSDpro", "XAUUSD-ECN"]) {
      expect(normalizeGoldSymbol(s)).toBe("XAUUSD");
    }
  });
  it("leaves an unrelated symbol untouched (uppercased) rather than forcing it to XAUUSD", () => {
    expect(normalizeGoldSymbol("EURUSD")).toBe("EURUSD");
    expect(isGoldSymbol("EURUSD")).toBe(false);
  });
});
