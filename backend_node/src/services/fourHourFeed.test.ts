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
  /** Throw only starting from the Nth .find() call (1-indexed) instead of every call. */
  throwOnFindFromCallN: number | null = null;
  findCallCount = 0;
  find(query: Doc) {
    this.findCallCount += 1;
    if (this.throwOnFind) throw this.throwOnFind;
    if (this.throwOnFindFromCallN !== null && this.findCallCount >= this.throwOnFindFromCallN) throw new Error("timeout on later query");
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
const { recordLiveQuote, _resetLiveQuoteCacheForTests } = await import("./liveQuoteCache.js");

function freshQuoteDoc(tsIso: string, account = "476396807"): Doc {
  return {
    ts: tsIso,
    account,
    normalized_symbol: "XAUUSD",
    details: { market_thesis: { live_bid: 4300.1, live_ask: 4300.6, direction: "BUY" } },
  };
}

describe("Manual Trading market-feed read status", () => {
  beforeEach(() => { state.db = new FakeDb(); _resetLiveQuoteCacheForTests(); });

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

  // v6.28.2 (2026-08-25 production incident): the "newest broker quote" read
  // was intermittently timing out against one specific Atlas node while the
  // heartbeat write path kept succeeding continuously. LIVE_MARKET_OK must
  // survive that using the quote the heartbeat already validated in memory
  // -- never a fabricated price, and never past its own freshness window.
  describe("in-memory live-quote fallback (survives a transient DB read failure)", () => {
    it("falls back to the heartbeat-cached quote when the durable read throws", async () => {
      const err = new Error("connection 4 to 65.62.2.183:27017 timed out");
      err.name = "MongoServerSelectionError";
      state.db.collection("cloud_bot_activity").throwOnFind = err;
      recordLiveQuote({ account: "476396807", normalizedSymbol: "XAUUSD", bid: 4630.2, ask: 4630.7, mid: 4630.45, sourceAtIso: new Date().toISOString(), receivedAtIso: new Date().toISOString() });

      const result = await readMarketDataWithStatus();
      expect(result.code).toBe("LIVE_MARKET_OK");
      expect(result.data?.price).toBeCloseTo(4630.45, 2);
      expect(result.data?.source).toBe("ea-stream(spot)");
      expect(result.data?.dataStatus).toBe("ACCUMULATING_BROKER_HISTORY");
    });

    it("falls back to the cache when the durable read succeeds but finds nothing yet", async () => {
      recordLiveQuote({ account: "476396807", normalizedSymbol: "XAUUSD", bid: 4630.2, ask: 4630.7, mid: 4630.45, sourceAtIso: new Date().toISOString(), receivedAtIso: new Date().toISOString() });
      const result = await readMarketDataWithStatus();
      expect(result.code).toBe("LIVE_MARKET_OK");
      expect(result.data?.account).toBe("476396807");
    });

    it("does not use a stale cached quote (older than the freshness window) as a fallback", async () => {
      state.db.collection("cloud_bot_activity").throwOnFind = new Error("timeout");
      const staleIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      recordLiveQuote({ account: "476396807", normalizedSymbol: "XAUUSD", bid: 4630.2, ask: 4630.7, mid: 4630.45, sourceAtIso: staleIso, receivedAtIso: staleIso });

      const result = await readMarketDataWithStatus();
      expect(result.code).toBe("DATABASE_READ_TIMEOUT");
      expect(result.data).toBeNull();
    });

    it("does not fall back to a cached quote for a different symbol", async () => {
      state.db.collection("cloud_bot_activity").throwOnFind = new Error("timeout");
      recordLiveQuote({ account: "1", normalizedSymbol: "EURUSD", bid: 1.08, ask: 1.081, mid: 1.0805, sourceAtIso: new Date().toISOString(), receivedAtIso: new Date().toISOString() });

      const result = await readMarketDataWithStatus();
      expect(result.code).toBe("DATABASE_READ_TIMEOUT");
      expect(result.data).toBeNull();
    });

    it("falls back to the cache when the SECOND read (windowed snapshots) throws, not just the first", async () => {
      // Regression: the first version of this fallback only wrapped the
      // initial "newest quote" lookup. cloud_bot_activity's second call (the
      // windowed snapshot read) is a separate round-trip that can fail on
      // its own -- and did, in production, while the first happened to
      // succeed. The fallback must cover the whole read, not just call #1.
      state.db.collection("cloud_bot_activity").docs.push(freshQuoteDoc(new Date().toISOString()));
      state.db.collection("cloud_bot_activity").throwOnFindFromCallN = 2;
      recordLiveQuote({ account: "476396807", normalizedSymbol: "XAUUSD", bid: 4630.2, ask: 4630.7, mid: 4630.45, sourceAtIso: new Date().toISOString(), receivedAtIso: new Date().toISOString() });

      const result = await readMarketDataWithStatus();
      expect(result.code).toBe("LIVE_MARKET_OK");
      expect(result.data).not.toBeNull();
    });

    it("prefers a genuine durable read over the cache when Mongo is healthy", async () => {
      const dbTs = new Date(Date.now() - 5000).toISOString();
      state.db.collection("cloud_bot_activity").docs.push(freshQuoteDoc(dbTs, "999999"));
      recordLiveQuote({ account: "476396807", normalizedSymbol: "XAUUSD", bid: 1.0, ask: 1.0, mid: 1.0, sourceAtIso: new Date().toISOString(), receivedAtIso: new Date().toISOString() });

      const result = await readMarketDataWithStatus();
      expect(result.code).toBe("LIVE_MARKET_OK");
      expect(result.data?.account).toBe("999999");
      expect(result.data?.price).not.toBeCloseTo(1.0, 2);
    });
  });
});
