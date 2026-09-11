import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  lifecycle: [] as unknown[],
  published: [] as string[],
  hourlyDelayMs: 0,
  lifecycleThrows: false,
}));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("./marketOutlookTick.js", () => ({
  trackOutlookLifecycleTick: async (tick: unknown) => {
    if (state.lifecycleThrows) throw new Error("lifecycle exploded");
    state.lifecycle.push(tick);
    return true;
  },
}));
vi.mock("./marketOutlookPublish.js", () => ({
  publishM10SignalFromActivity: async (_license: string, _account: string, sourceEventId: string) => {
    state.published.push(sourceEventId);
    return null;
  },
}));
vi.mock("./subscriberSignalFeed.js", () => ({ mirrorSubscriberM10Evaluation: async () => undefined }));
vi.mock("./marketOutlookHourlyTick.js", () => ({
  hourlyGenerationTick: async () => {
    if (state.hourlyDelayMs) await new Promise((resolve) => setTimeout(resolve, state.hourlyDelayMs));
    return [0, []];
  },
}));
vi.mock("./outlookExecution.js", () => ({ publishOutlookThesis: async () => undefined }));

const { processMarketIntelligenceEvidence, runMarketIntelligenceForEaRequest } = await import("./marketIntelligencePipeline.js");

const QUOTE = { live_bid: 3000, live_ask: 3000.2, evidence_time_utc: "2026-09-11T10:00:00.000Z" };
const input = (details: Record<string, unknown>) => ({
  license_key: "lic-a", account: "acct-a", source_event_id: "ev-1", event_at: "2026-09-11T10:00:01.000Z", details,
  route: "/api/cloud/monitor/heartbeat",
});

describe("canonical market-intelligence pipeline", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.lifecycle = [];
    state.published = [];
    state.hourlyDelayMs = 0;
    state.lifecycleThrows = false;
  });

  it("keeps a quiet quote-only heartbeat fresh without fabricating an M10 signal", async () => {
    const result = await processMarketIntelligenceEvidence(input({ market_thesis: QUOTE }));
    expect(result.quote_processed).toBe(true);
    expect(state.lifecycle).toHaveLength(1);
    expect(result.m10_mirrored).toBe(false);
    expect(state.published).toEqual([]);
    expect(result.m10_published).toBe(false);
  });

  it("does not attempt publication for a non-candidate M10 reading", async () => {
    await processMarketIntelligenceEvidence(input({ market_thesis: QUOTE, m10_signal: { decision: "WATCHING", preferred_direction: "BUY" } }));
    expect(state.published).toEqual([]);
  });

  it("routes a genuine M10 candidate to publication keyed by the immutable evidence id", async () => {
    await processMarketIntelligenceEvidence(input({ market_thesis: QUOTE, m10_signal: { decision: "BUY_CANDIDATE", preferred_direction: "BUY" } }));
    expect(state.published).toEqual(["ev-1"]);
  });

  it("records a durable diagnostic for a failed stage and still runs the remaining stages", async () => {
    state.lifecycleThrows = true;
    const result = await processMarketIntelligenceEvidence(input({ market_thesis: QUOTE, m10_signal: { decision: "BUY_CANDIDATE", preferred_direction: "BUY" } }));
    expect(result.failures).toEqual(["OUTLOOK_LIFECYCLE"]);
    expect(state.published).toEqual(["ev-1"]);
    const diagnostics = state.db.collection("cloud_intelligence_diagnostics").docs;
    expect(diagnostics[0]).toMatchObject({ code: "MARKET_INTELLIGENCE_STAGE_FAILED", stage: "OUTLOOK_LIFECYCLE", account: "acct-a", source_event_id: "ev-1" });
  });

  it("never holds the EA request beyond the response budget; slow work completes in the background", async () => {
    state.hourlyDelayMs = 200;
    const started = Date.now();
    const result = await runMarketIntelligenceForEaRequest(input({ market_thesis: QUOTE }), 20);
    expect(result.deferred).toBe(true);
    expect(Date.now() - started).toBeLessThan(150);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.lifecycle).toHaveLength(1);
  });

  it("returns the finished result inside the budget", async () => {
    const result = await runMarketIntelligenceForEaRequest(input({ market_thesis: QUOTE }), 1_000);
    expect(result.deferred).toBeUndefined();
    expect(result.quote_processed).toBe(true);
  });
});
