import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

type Doc = Record<string, unknown>;

// A minimal fake matching only the shape fourHourFeed.ts actually queries:
// .find(query, projection).sort(...).limit(...).next()/.toArray().
class FakeCursor {
  constructor(private rows: Doc[]) {}
  sort() { return this; }
  limit(n: number) { this.rows = this.rows.slice(0, n); return this; }
  async next() { return this.rows[0] ?? null; }
  async toArray() { return this.rows; }
}
class FakeCollection {
  docs: Doc[] = [];
  throwOnFind: Error | null = null;
  find(query: Doc) {
    if (this.throwOnFind) throw this.throwOnFind;
    const rows = this.docs
      .filter((d) => Object.entries(query).every(([k, v]) => {
        if (v && typeof v === "object" && "$gt" in (v as Doc)) {
          const path = k.split(".");
          let cur: unknown = d;
          for (const p of path) cur = (cur as Doc | undefined)?.[p];
          return typeof cur === "number" && cur > (v as Doc)["$gt"]!;
        }
        if (v && typeof v === "object" && "$gte" in (v as Doc)) {
          const path = k.split(".");
          let cur: unknown = d;
          for (const p of path) cur = (cur as Doc | undefined)?.[p];
          return typeof cur === "string" && cur >= (v as Doc)["$gte"]!;
        }
        const path = k.split(".");
        let cur: unknown = d;
        for (const p of path) cur = (cur as Doc | undefined)?.[p];
        return cur === v;
      }))
      .sort((a, b) => String(a["ts"]).localeCompare(String(b["ts"])) * -1);
    return new FakeCursor(rows);
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
vi.mock("./diagnostics.js", () => ({ recordDiagnostic: vi.fn() }));

const { readMarketDataWithStatus } = await import("./fourHourFeed.js");

function freshQuoteDoc(tsIso: string, account = "476396807"): Doc {
  return {
    ts: tsIso,
    account,
    normalized_symbol: "XAUUSD",
    details: { market_thesis: { live_bid: 4300.1, live_ask: 4300.6, direction: "BUY" } },
  };
}

describe("Manual Trading market-feed read status", () => {
  beforeEach(() => { state.db = new FakeDb(); });

  it("reports LIVE_MARKET_OK with data when a fresh EA quote exists", async () => {
    const now = new Date().toISOString();
    state.db.collection("cloud_bot_activity").docs.push(freshQuoteDoc(now));
    const result = await readMarketDataWithStatus();
    expect(result.code).toBe("LIVE_MARKET_OK");
    expect(result.data).not.toBeNull();
    expect(result.data?.price).toBeCloseTo(4300.35, 2);
  });

  it("reports EA_FEED_MISSING (not a database code) when the query succeeds but finds nothing", async () => {
    const result = await readMarketDataWithStatus();
    expect(result.code).toBe("EA_FEED_MISSING");
    expect(result.data).toBeNull();
    expect(result.errorMessage).toBeNull();
  });

  it("classifies a thrown Mongo timeout as DATABASE_READ_TIMEOUT, distinct from EA_FEED_MISSING", async () => {
    const err = new Error("connection timed out after 10000ms");
    err.name = "MongoServerSelectionError";
    state.db.collection("cloud_bot_activity").throwOnFind = err;
    const result = await readMarketDataWithStatus();
    expect(result.code).toBe("DATABASE_READ_TIMEOUT");
    expect(result.data).toBeNull();
    expect(result.errorMessage).toContain("timed out");
  });

  it("classifies an unrecognized thrown Mongo error as DATABASE_UNAVAILABLE", async () => {
    const err = new Error("topology was destroyed");
    err.name = "MongoTopologyClosedError";
    state.db.collection("cloud_bot_activity").throwOnFind = err;
    const result = await readMarketDataWithStatus();
    expect(result.code).toBe("DATABASE_UNAVAILABLE");
  });

  it("recovers automatically once the database read succeeds again", async () => {
    const err = new Error("timeout");
    state.db.collection("cloud_bot_activity").throwOnFind = err;
    const first = await readMarketDataWithStatus();
    expect(first.code).toBe("DATABASE_READ_TIMEOUT");

    state.db.collection("cloud_bot_activity").throwOnFind = null;
    state.db.collection("cloud_bot_activity").docs.push(freshQuoteDoc(new Date().toISOString()));
    const second = await readMarketDataWithStatus();
    expect(second.code).toBe("LIVE_MARKET_OK");
    expect(second.data).not.toBeNull();
  });

  it("never fabricates a price when no genuine source is available", async () => {
    const result = await readMarketDataWithStatus();
    expect(result.data).toBeNull();
    // No hardcoded/synthetic price anywhere in a missing-feed result.
    expect(JSON.stringify(result)).not.toMatch(/\b1900(\.0+)?\b|\b2000(\.0+)?\b/);
  });
});
