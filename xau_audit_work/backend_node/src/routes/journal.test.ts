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
  // Operator-aware (adds $exists) matcher, used only by findOneAndUpdate --
  // the plain-equality methods above are untouched, matching every existing
  // passing test's expectations exactly.
  private matchesWithOperators(doc: Doc, query: Doc): boolean {
    return Object.entries(query).every(([key, expected]) => {
      if (expected && typeof expected === "object" && !Array.isArray(expected) && "$exists" in (expected as Doc)) {
        return (expected as Doc)["$exists"] ? doc[key] !== undefined : doc[key] === undefined;
      }
      return doc[key] === expected;
    });
  }
  async findOneAndUpdate(query: Doc, update: { $set?: Doc }, options: { sort?: Doc } = {}) {
    let candidates = this.docs.filter((d) => this.matchesWithOperators(d, query));
    if (options.sort) {
      const [[key, dir]] = Object.entries(options.sort);
      candidates = [...candidates].sort((a, b) => (dir === -1 ? 1 : -1) * String(a[key]).localeCompare(String(b[key])));
    }
    const found = candidates[0];
    if (!found) return null;
    Object.assign(found, structuredClone(update.$set ?? {}));
    return structuredClone(found);
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

describe("v6.27.9 ShadowML — closed trade joins back to its pending shadow observation", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.db = new FakeDb();
    reconcileTradeJournalEntry.mockClear();
    reconcileTradeJournalEntry.mockResolvedValue(null);
    app = await createApp();
  });

  it("marks the matching pending shadow record EXECUTED with the real outcome", async () => {
    state.db.collection("ml_shadow_decisions").docs.push({
      signature: "1|2|3|4|5|6|7",
      account: 555111,
      hive_verdict: "BOOST",
      actual_action: "CANDIDATE",
      decision_time_utc: "2026.08.24 11:59:00",
    });
    const response = await app.inject({
      method: "POST",
      url: "/journal/log",
      payload: closedTradePayload({ signature: "1|2|3|4|5|6|7", result: "WIN", profit: 250 }),
    });
    expect(response.json()).toMatchObject({ status: "ok" });
    const shadow = state.db.collection("ml_shadow_decisions").docs[0]!;
    expect(shadow["actual_action"]).toBe("EXECUTED");
    expect(shadow["eventual_result"]).toBe("WIN");
    expect(shadow["profit"]).toBe(250);
    expect(shadow["trade_id"]).toBeTruthy();
  });


  it("never joins a same-signature shadow decision from a different account", async () => {
    state.db.collection("ml_shadow_decisions").docs.push({
      signature: "same-signature",
      account: 999999,
      hive_verdict: "BOOST",
      actual_action: "CANDIDATE",
      decision_time_utc: "2026.08.24 11:59:00",
    });
    const response = await app.inject({
      method: "POST",
      url: "/journal/log",
      payload: closedTradePayload({ signature: "same-signature", result: "WIN", profit: 250 }),
    });
    expect(response.statusCode).toBe(200);
    const shadow = state.db.collection("ml_shadow_decisions").docs[0]!;
    expect(shadow["actual_action"]).toBe("CANDIDATE");
    expect(shadow["eventual_result"]).toBeUndefined();
  });

  it("does not re-join an already-joined shadow record on a later unrelated close", async () => {
    state.db.collection("ml_shadow_decisions").docs.push({
      signature: "1|2|3|4|5|6|7",
      hive_verdict: "BOOST",
      actual_action: "EXECUTED",
      eventual_result: "WIN",
      profit: 250,
    });
    await app.inject({
      method: "POST",
      url: "/journal/log",
      payload: closedTradePayload({ ticket: 2002, signature: "1|2|3|4|5|6|7", result: "LOSS", profit: -90 }),
    });
    const shadow = state.db.collection("ml_shadow_decisions").docs[0]!;
    // Untouched -- still the original WIN/250, not overwritten by the second trade.
    expect(shadow["eventual_result"]).toBe("WIN");
    expect(shadow["profit"]).toBe(250);
  });

  it("a closed trade with no matching shadow observation still succeeds normally", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/journal/log",
      payload: closedTradePayload({ signature: "no-match-signature" }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
    expect(state.db.collection("ml_shadow_decisions").docs).toHaveLength(0);
  });

  it("a closed trade with no signature at all does not touch the shadow collection", async () => {
    const response = await app.inject({ method: "POST", url: "/journal/log", payload: closedTradePayload({ ticket: 3003 }) });
    expect(response.statusCode).toBe(200);
    expect(state.db.collection("ml_shadow_decisions").docs).toHaveLength(0);
  });
});
