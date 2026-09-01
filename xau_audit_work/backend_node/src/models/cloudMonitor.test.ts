import { describe, expect, it } from "vitest";
import { BotHeartbeatReqSchema } from "./cloudMonitor.js";

describe("EA heartbeat market contract", () => {
  it("accepts a verified XAUUSDm broker quote without requiring a literal XAUUSD symbol", () => {
    const parsed = BotHeartbeatReqSchema.parse({
      account_number: "476396807",
      symbol: "XAUUSDm",
      market_thesis: {
        live_bid: 4380.123,
        live_ask: 4380.456,
        evidence_time_utc: "2026.08.23 12:00:00",
      },
    });
    expect(parsed.symbol).toBe("XAUUSDm");
    expect(parsed.market_thesis).toMatchObject({ live_bid: 4380.123, live_ask: 4380.456 });
  });
});
