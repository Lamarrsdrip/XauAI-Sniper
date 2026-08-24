import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

type Doc = Record<string, unknown>;

class FakeCollection {
  docs: Doc[] = [];
  async findOne(query: Doc): Promise<Doc | null> {
    const found = this.docs.find((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    return found ? structuredClone(found) : null;
  }
  async insertOne(doc: Doc) { this.docs.push(structuredClone(doc)); return { acknowledged: true }; }
  async updateOne(query: Doc, update: { $set?: Doc; $setOnInsert?: Doc }, options: { upsert?: boolean } = {}) {
    const found = this.docs.find((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    if (found) {
      Object.assign(found, structuredClone(update.$set ?? {}));
      return { matchedCount: 1, upsertedCount: 0 };
    }
    if (options.upsert) {
      const created = { ...structuredClone(query), ...structuredClone(update.$set ?? {}), ...structuredClone(update.$setOnInsert ?? {}) };
      this.docs.push(created);
      return { matchedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, upsertedCount: 0 };
  }
  find(query: Doc = {}) {
    const rows = this.docs.filter((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    return { sort: () => ({ toArray: async () => structuredClone(rows) }) };
  }
}

class FakeDb {
  private map = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    if (!this.map.has(name)) this.map.set(name, new FakeCollection());
    return this.map.get(name)!;
  }
}

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));

vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("../services/license.js", () => ({
  resolveMonitorLicense: vi.fn(async () => ({ id: "lic-test" })),
  normalizeLicenseKey: (v: string) => (v || "").trim().toUpperCase(),
}));

const reconcileTradeJournalEntry = vi.fn(async () => null);
vi.mock("../services/automatedTradeReconciliation.js", () => ({ reconcileTradeJournalEntry: (doc: Doc) => reconcileTradeJournalEntry(doc) }));

const { registerJournalRoutes } = await import("./journal.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerJournalRoutes(app);
  return app;
}

function closedTradePayload(overrides: Doc = {}): Doc {
  return {
    pin: "TESTPIN1",
    account_login: "555111",
    symbol: "XAUUSD",
    direction: "BUY",
    ticket: 999,
    entry_price: 4390.25,
    price: 4396.25,
    exit_price: 4396.25,
    profit: 125,
    closed_at: 1_700_000_000,
    opened_at: 1_699_999_000,
    ...overrides,
  };
}

describe("POST /journal/log wires an authenticated final close into the X-post queue", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.db = new FakeDb();
    reconcileTradeJournalEntry.mockClear();
    reconcileTradeJournalEntry.mockResolvedValue(null);
    app = await createApp();
  });

  it("queues exactly one X-post job for a genuine final closed trade", async () => {
    const response = await app.inject({ method: "POST", url: "/journal/log", payload: closedTradePayload() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });

    const posts = state.db.collection("x_trade_posts").docs;
    expect(posts).toHaveLength(1);
    expect(posts[0]!["status"]).toBe("QUEUED");
    expect(posts[0]!["closed_trade_id"]).toBe(JSON.stringify(["555111", "999"]));

    // Preserved security rule: the queued job is keyed off the durably
    // stored trade_journal row, not the raw request body.
    const journalRows = state.db.collection("trade_journal").docs;
    expect(journalRows).toHaveLength(1);
    expect(journalRows[0]!["actual_exit_price"]).toBe(4396.25);
  });

  it("does not queue a duplicate job when the same close event is delivered twice", async () => {
    const payload = closedTradePayload();
    const first = await app.inject({ method: "POST", url: "/journal/log", payload });
    const second = await app.inject({ method: "POST", url: "/journal/log", payload });

    expect(first.json()).toMatchObject({ status: "ok" });
    expect(second.json()).toMatchObject({ status: "ok", duplicate: true });
    expect(state.db.collection("x_trade_posts").docs).toHaveLength(1);
    expect(state.db.collection("trade_journal").docs).toHaveLength(1);
  });

  it("still queues the X-post job even when Outlook reconciliation fails", async () => {
    reconcileTradeJournalEntry.mockRejectedValue(new Error("outlook reconciliation boom"));
    const response = await app.inject({ method: "POST", url: "/journal/log", payload: closedTradePayload({ ticket: 1000 }) });
    expect(response.json()).toMatchObject({ status: "ok" });
    expect(state.db.collection("x_trade_posts").docs).toHaveLength(1);
  });

  it("never queues an X-post job for a trade that is not yet closed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/journal/log",
      payload: closedTradePayload({ ticket: 1001, closed_at: 0 }),
    });
    expect(response.json()).toMatchObject({ status: "ok" });
    expect(state.db.collection("x_trade_posts").docs).toHaveLength(0);
  });
});
