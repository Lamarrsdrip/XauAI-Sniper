import { describe, expect, it } from "vitest";
import { buildXTradePost, normalizePublicSymbol } from "./xTradePosting.js";

describe("X closed-trade post contract", () => {
  it("formats a final win without customer or account data", () => {
    const post = buildXTradePost({ id: "trade-a", ticket: 123, account_login: "476396807", symbol: "XAUUSDm", direction: "SELL", entry_price: 4394.76, exit_price: 4388.76, profit: 666, closed_at: 1_700_000_000, closed: true });
    expect(post).toContain("XAUUSD • SELL");
    expect(post).toContain("Result: WIN");
    expect(post).toContain("+$666.00");
    expect(post).not.toContain("476396807");
  });

  it("accepts the canonical EA close-price field without treating it as entry", () => {
    const post = buildXTradePost({ id: "trade-b", symbol: "XAUUSDm", direction: "BUY", entry_price: 4390.25, price: 4396.25, profit: 125, closed_at: 1_700_000_000 });
    expect(post).toContain("Entry: 4390.25");
    expect(post).toContain("Exit: 4396.25");
    expect(() => buildXTradePost({ id: "bad", symbol: "XAUUSD", direction: "BUY", price: 2, profit: 1, closed_at: 1 })).toThrow(/incomplete/i);
  });

  it("normalizes broker Gold suffixes and rejects an open/incomplete row", () => {
    expect(normalizePublicSymbol("XAUUSD.a")).toBe("XAUUSD");
    expect(() => buildXTradePost({ id: "open", symbol: "XAUUSD", direction: "BUY", entry_price: 1, exit_price: 2, profit: 1, closed: false })).toThrow(/final closed/i);
  });
});
