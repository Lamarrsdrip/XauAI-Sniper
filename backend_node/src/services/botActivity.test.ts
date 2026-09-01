import { describe, expect, it } from "vitest";
import { categorizeBotActivity } from "./botActivity.js";

describe("activity execution classification", () => {
  it("does not turn a no-entry M10 decision into a trade-open event", () => {
    expect(categorizeBotActivity("INFO", "PRIMARY_DECISION NONE no entry created")).toBe("info");
  });

  it("keeps explicit broker execution events in the trade-open feed", () => {
    expect(categorizeBotActivity("ENTRY", "TRADE_EXECUTED BUY accepted by broker")).toBe("entries");
    expect(categorizeBotActivity("TRADE", "PYRAMID_ADD BUY accepted by broker")).toBe("entries");
  });
});
