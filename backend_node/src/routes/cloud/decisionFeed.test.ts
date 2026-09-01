import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, user: null as Record<string, unknown> | null }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", () => ({
  requireCloudUser: async (request: unknown) => { (request as { cloudUser?: unknown }).cloudUser = state.user; },
}));
vi.mock("../../services/commandLicense.js", () => ({
  getUserLicense: vi.fn(async () => ({ pin: "PIN-1", mt5_account: "476396807" })),
}));

const { registerDecisionFeedRoutes } = await import("./decisionFeed.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerDecisionFeedRoutes(app);
  return app;
}

function tradeOpenedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account: "476396807", event_type: "TRADE_OPENED", event_category: "entries", ticket: "3143809430", ts: "2026-08-26T22:22:32.000Z", ...overrides,
  };
}

describe("GET /cloud/monitor/activity -- ticket-level TRADE_OPENED dedup (forensic-incident fix)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.user = { id: "user-1", email: "trader@example.com" };
  });

  it("collapses multiple TRADE_OPENED-classified rows for the same ticket into one", async () => {
    await state.db.collection("cloud_bot_activity").insertOne(tradeOpenedRow({ event_type: "TRADE_EXECUTED", ts: "2026-08-26T22:22:32.000Z" }));
    await state.db.collection("cloud_bot_activity").insertOne(tradeOpenedRow({ event_type: "POSITION_OPENED", ts: "2026-08-26T22:22:33.000Z" }));
    await state.db.collection("cloud_bot_activity").insertOne(tradeOpenedRow({ event_type: "EXECUTION_CONFIRMED", ts: "2026-08-26T22:22:34.000Z" }));

    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/cloud/monitor/activity" });
    const body = res.json();

    expect(body.count).toBe(1);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].ticket).toBe("3143809430");
  });

  it("keeps the most recent row among duplicates (rows are sorted ts desc)", async () => {
    await state.db.collection("cloud_bot_activity").insertOne(tradeOpenedRow({ event_type: "TRADE_EXECUTED", ts: "2026-08-26T22:22:32.000Z", message: "first" }));
    await state.db.collection("cloud_bot_activity").insertOne(tradeOpenedRow({ event_type: "POSITION_OPENED", ts: "2026-08-26T22:22:33.000Z", message: "second" }));

    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/cloud/monitor/activity" });
    const body = res.json();

    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("second");
  });

  it("does NOT collapse TRADE_OPENED rows for two genuinely different tickets", async () => {
    await state.db.collection("cloud_bot_activity").insertOne(tradeOpenedRow({ ticket: "1111", ts: "2026-08-26T22:00:00.000Z" }));
    await state.db.collection("cloud_bot_activity").insertOne(tradeOpenedRow({ ticket: "2222", ts: "2026-08-26T22:05:00.000Z" }));

    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/cloud/monitor/activity" });
    const body = res.json();

    expect(body.count).toBe(2);
  });

  it("does NOT collapse non-TRADE_OPENED rows sharing a ticket (risk updates, AI thoughts, closes all remain distinct)", async () => {
    await state.db.collection("cloud_bot_activity").insertOne(tradeOpenedRow({ ts: "2026-08-26T22:22:32.000Z" }));
    await state.db.collection("cloud_bot_activity").insertOne({
      account: "476396807", event_type: "RISK_UPDATE", event_category: "risk", ticket: "3143809430", ts: "2026-08-26T22:23:00.000Z",
    });
    await state.db.collection("cloud_bot_activity").insertOne({
      account: "476396807", event_type: "TRADE_CLOSED", event_category: "exits", ticket: "3143809430", net_profit: -12.5, ts: "2026-08-26T23:00:00.000Z",
    });

    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/cloud/monitor/activity" });
    const body = res.json();

    expect(body.count).toBe(3);
  });

  it("never collapses TRADE_OPENED-classified rows that have no ticket to group by", async () => {
    await state.db.collection("cloud_bot_activity").insertOne({ account: "476396807", event_type: "TRADE_EXECUTED", event_category: "entries", ts: "2026-08-26T22:22:32.000Z" });
    await state.db.collection("cloud_bot_activity").insertOne({ account: "476396807", event_type: "TRADE_EXECUTED", event_category: "entries", ts: "2026-08-26T22:22:33.000Z" });

    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/cloud/monitor/activity" });
    const body = res.json();

    expect(body.count).toBe(2);
  });
});
