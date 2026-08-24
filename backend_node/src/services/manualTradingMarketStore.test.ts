import { beforeEach, describe, expect, it, vi } from "vitest";

type Update = { key: Record<string, unknown>; update: Record<string, unknown> };
const state = vi.hoisted(() => ({ writes: [] as Update[] }));

vi.mock("../db.js", () => ({
  getDb: () => ({
    collection: () => ({
      updateOne: async (key: Record<string, unknown>, update: Record<string, unknown>) => {
        state.writes.push({ key, update });
      },
    }),
  }),
}));

const { recordVerifiedManualTradingQuote } = await import("./manualTradingMarketStore.js");

describe("Manual Trading Intelligence broker quote persistence", () => {
  beforeEach(() => { state.writes = []; });

  it("accepts XAUUSDm as canonical XAUUSD and retains its broker symbol", async () => {
    await recordVerifiedManualTradingQuote({
      account: "476396807", symbol: "XAUUSDm", receivedAt: new Date("2026-08-23T12:00:00Z"),
      marketThesis: { live_bid: 4380.123, live_ask: 4380.456, evidence_time_utc: "2026.08.23 12:00:00" },
    });
    expect(state.writes).toHaveLength(3);
    for (const write of state.writes) {
      expect(write.key).toMatchObject({ account: "476396807", symbol: "XAUUSD" });
      expect(write.update.$set).toMatchObject({ brokerSymbol: "XAUUSDm", source: "ea-stream(spot)" });
    }
  });

  it("rejects a non-Gold quote instead of remapping it to Gold", async () => {
    await recordVerifiedManualTradingQuote({
      account: "476396807", symbol: "EURUSD", receivedAt: new Date(),
      marketThesis: { live_bid: 4380, live_ask: 4381 },
    });
    expect(state.writes).toHaveLength(0);
  });
});
