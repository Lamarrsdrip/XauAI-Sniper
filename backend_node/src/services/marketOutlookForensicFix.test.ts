import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { extractEvidenceQuote, latestEaEvidence } = await import("./marketOutlookEvidence.js");
const { resolveHourlyBias, generateOutlookForAccount } = await import("./marketOutlookSignal.js");
const { computeConfidence } = await import("./marketOutlookConfidence.js");

describe("Outlook forensic correctness fixes", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("does not invent BUY when canonical direction is absent and pressure is balanced", () => {
    const bias = resolveHourlyBias({ actionable: false, direction: "" }, { buy_pressure: 50, sell_pressure: 50, structure: "STRUCTURE_MIXED" });
    expect(bias.direction_label).toBe("NEUTRAL");
    expect(bias.direction).toBe(0);
    expect(bias.automated_entry_approved).toBe(false);
  });

  it("does not invent a direction from a tiny pressure difference", () => {
    const bias = resolveHourlyBias({ actionable: false, direction: "" }, { buy_pressure: 53, sell_pressure: 47, structure: "STRUCTURE_MIXED" });
    expect(bias.direction_label).toBe("NEUTRAL");
    expect(bias.direction).toBe(0);
  });

  it("turns a strong contradiction into NEUTRAL instead of flipping BUY to SELL", () => {
    const bias = resolveHourlyBias({ actionable: true, direction: "BUY" }, { buy_pressure: 30, sell_pressure: 70, structure: "STRUCTURE_MIXED" });
    expect(bias.direction_label).toBe("NEUTRAL");
    expect(bias.direction).toBe(0);
    expect(bias.directional_conflict).toContain("contradicts the BUY candidate");
    expect(bias.automated_entry_approved).toBe(false);
  });

  it("preserves legitimate zero-valued evidence instead of silently replacing zero with defaults", () => {
    const c = computeConfidence(1, { buy_pressure: 0, sell_pressure: 100, exhaustion_pct: 0, remaining_room_r: 0 }, {});
    expect(c.pressure).toBe(0);
    expect(c.exhaustion).toBe(100);
    expect(c.remaining_room).toBe(0);
  });

  it("selects one freshest internally-consistent broker quote bundle instead of mixing Bid/Ask across payloads", () => {
    const quote = extractEvidenceQuote({
      ts: "2026-09-01T08:00:02.000Z",
      market_thesis: { live_bid: 2500, live_ask: 2500.2, evidence_time_utc: "2026-09-01T08:00:00.000Z" },
      m10_signal: { live_bid: 2600, live_ask: 2600.3, quote_time: "2026-09-01T08:00:02.000Z" },
    });
    expect(quote.bid).toBe(2600);
    expect(quote.ask).toBe(2600.3);
    expect(quote.mid).toBeCloseTo(2600.15, 8);
  });

  it("requires account and license to match the same activity row", async () => {
    await state.db.collection("cloud_bot_activity").insertOne({
      id: "wrong-account",
      account: "acct-B",
      license_key: "lic-1",
      ts: new Date().toISOString(),
      details: { market_thesis: { live_bid: 3000, live_ask: 3000.2 } },
    });
    await state.db.collection("cloud_bot_activity").insertOne({
      id: "right-account",
      account: "acct-A",
      license_key: "lic-1",
      ts: new Date().toISOString(),
      details: { market_thesis: { live_bid: 2500, live_ask: 2500.2 } },
    });
    const { evidence } = await latestEaEvidence("lic-1", "acct-A");
    const quote = extractEvidenceQuote(evidence);
    expect(quote.bid).toBe(2500);
  });

  it("refuses to substitute an external gold feed when account broker quote is missing", async () => {
    await state.db.collection("cloud_bot_activity").insertOne({
      id: "no-quote",
      account: "acct-no-quote",
      license_key: "lic-1",
      ts: new Date().toISOString(),
      details: {
        m10_signal: { decision: "BUY_CANDIDATE", freshness_state: "FRESH" },
        market_thesis: { action: "ALLOW_CORE", buy_pressure: 70, sell_pressure: 30, market_regime: "TRENDING" },
      },
    });
    const doc = await generateOutlookForAccount({ license_key: "lic-1", account: "acct-no-quote" });
    expect(doc!["primary_direction"]).toBe("NO_VALID_OUTLOOK");
    expect(doc!["no_valid_outlook_reason"]).toBe("BROKER_QUOTE_UNAVAILABLE");
    expect(doc!["current_price"]).toBe(0);
  });
});
