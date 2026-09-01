import { describe, expect, it } from "vitest";
import { heartbeatMarketDetails } from "./monitor.js";

describe("monitor heartbeat market details", () => {
  it("does not let an empty heartbeat M10 block overwrite completed scan evidence", () => {
    const details = heartbeatMarketDetails({
      license_key: "license",
      market_thesis: { live_bid: 4633.2, live_ask: 4633.4 },
      m10_signal: {},
    });

    expect(details).not.toHaveProperty("m10_signal");
    expect(details.market_thesis).toEqual({ live_bid: 4633.2, live_ask: 4633.4 });
  });

  it("preserves genuine EA-computed M10 evidence", () => {
    const m10 = {
      evidence_id: 6,
      bar_time: "2026.08.24 10:00",
      decision: "SELL_CANDIDATE",
      freshness_state: "FRESH",
    };

    expect(heartbeatMarketDetails({ m10_signal: m10 })).toMatchObject({ m10_signal: m10 });
  });
});
