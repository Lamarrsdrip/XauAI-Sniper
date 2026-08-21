import { beforeEach, describe, expect, it, vi } from "vitest";

type Doc = Record<string, unknown>;

function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const ops = expected as Doc;
      if ("$lt" in ops) return Number(doc[key] ?? 0) < Number(ops["$lt"]);
      if ("$exists" in ops) return ops["$exists"] ? doc[key] !== undefined : doc[key] === undefined;
      if ("$lte" in ops) return String(doc[key] ?? "") <= String(ops["$lte"]);
      if ("$in" in ops) return (ops["$in"] as unknown[]).includes(doc[key]);
    }
    return doc[key] === expected;
  });
}

function matchesOr(doc: Doc, query: Doc): boolean {
  const { $or, ...rest } = query as { $or?: Doc[] } & Doc;
  if (!matches(doc, rest)) return false;
  if (!$or) return true;
  return $or.some((clause) => matches(doc, clause));
}

class FakeCollection {
  docs: Doc[] = [];
  async findOne(query: Doc): Promise<Doc | null> {
    const found = this.docs.find((d) => matchesOr(d, query));
    return found ? structuredClone(found) : null;
  }
  find(query: Doc = {}) {
    const rows = this.docs.filter((d) => matchesOr(d, query));
    const cursor = {
      limit: (n: number) => { rows.length = Math.min(rows.length, n); return cursor; },
      toArray: async () => structuredClone(rows),
    };
    return cursor;
  }
  async updateOne(query: Doc, update: { $set?: Doc; $setOnInsert?: Doc }, options: { upsert?: boolean } = {}) {
    const found = this.docs.find((d) => matchesOr(d, query));
    if (found) {
      Object.assign(found, structuredClone(update.$set ?? {}));
      return { matchedCount: 1, upsertedCount: 0, modifiedCount: 1 };
    }
    if (options.upsert) {
      const { $or, ...rest } = query as { $or?: Doc[] } & Doc;
      const created = { ...structuredClone(rest), ...structuredClone(update.$set ?? {}), ...structuredClone(update.$setOnInsert ?? {}) };
      this.docs.push(created);
      return { matchedCount: 0, upsertedCount: 1, modifiedCount: 0 };
    }
    return { matchedCount: 0, upsertedCount: 0, modifiedCount: 0 };
  }
  async findOneAndUpdate(query: Doc, update: { $set?: Doc }) {
    const found = this.docs.find((d) => matchesOr(d, query));
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

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, accessToken: "test-x-token" as string | null }));

vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("../env.js", () => ({ env: { X_USER_ACCESS_TOKEN: "", X_ACCOUNT_USERNAME: "XauCloud" } }));
vi.mock("./xOAuth.js", () => ({
  xOAuthConnection: vi.fn(async () => (state.accessToken ? { account_username: "XauCloud" } : null)),
  xUserAccessToken: vi.fn(async () => state.accessToken),
}));

const {
  buildXTradePost,
  normalizePublicSymbol,
  enqueueFinalTradeForXPost,
  processQueuedXTradePosts,
  publishApprovedXTrade,
} = await import("./xTradePosting.js");

function closedTrade(overrides: Doc = {}): Doc {
  return {
    trade_identity: JSON.stringify(["476396807", "123"]),
    account_login: "476396807",
    ticket: 123,
    symbol: "XAUUSDm",
    direction: "SELL",
    entry_price: 4394.76,
    exit_price: 4388.76,
    profit: 666,
    closed_at: 1_700_000_000,
    closed: true,
    ...overrides,
  };
}

describe("X closed-trade post contract", () => {
  it("formats a final win without customer or account data", () => {
    const post = buildXTradePost(closedTrade());
    expect(post).toContain("XAUUSD • SELL");
    expect(post).toContain("Result: WIN");
    expect(post).toContain("+$666.00");
    expect(post).not.toContain("476396807");
  });

  it("accepts the canonical EA close-price field without treating it as entry", () => {
    const post = buildXTradePost({ id: "trade-b", symbol: "XAUUSDm", direction: "BUY", entry_price: 4390.25, price: 4396.25, profit: 125, closed_at: 1_700_000_000 });
    expect(post).toContain("Entry: 4390.25");
    expect(post).toContain("Exit: 4396.25");
    expect(() => buildXTradePost({ id: "bad", symbol: "XAUUSD", direction: "BUY", price: 2, profit: 1, closed_at: 1 })).toThrow(/incomplete/i);
  });

  it("normalizes broker Gold suffixes and rejects an open/incomplete row", () => {
    expect(normalizePublicSymbol("XAUUSD.a")).toBe("XAUUSD");
    expect(() => buildXTradePost({ id: "open", symbol: "XAUUSD", direction: "BUY", entry_price: 1, exit_price: 2, profit: 1, closed: false })).toThrow(/final closed/i);
  });
});

describe("X auto-post queue + eligibility", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.accessToken = "test-x-token";
    vi.restoreAllMocks();
  });

  async function setSettings(overrides: Doc): Promise<void> {
    await state.db.collection("x_posting_settings").updateOne(
      { id: "trade_posts" },
      { $set: { id: "trade_posts", auto_post_enabled: false, post_wins: true, post_losses: true, post_breakeven: false, ...overrides } },
      { upsert: true },
    );
  }

  it("enqueues exactly one job for a finalized winning trade", async () => {
    await enqueueFinalTradeForXPost(closedTrade({ profit: 500 }));
    const rows = state.db.collection("x_trade_posts").docs;
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("queued");
  });

  it("enqueues exactly one job for a finalized losing trade", async () => {
    await enqueueFinalTradeForXPost(closedTrade({ profit: -50 }));
    const rows = state.db.collection("x_trade_posts").docs;
    expect(rows).toHaveLength(1);
  });

  it("a duplicate close event does not create a duplicate queue job", async () => {
    const trade = closedTrade();
    await enqueueFinalTradeForXPost(trade);
    await enqueueFinalTradeForXPost(trade);
    expect(state.db.collection("x_trade_posts").docs).toHaveLength(1);
  });

  it("never publishes when auto posting is OFF, even with jobs queued", async () => {
    await setSettings({ auto_post_enabled: false });
    await enqueueFinalTradeForXPost(closedTrade({ profit: 500 }));
    await processQueuedXTradePosts();
    const row = state.db.collection("x_trade_posts").docs[0]!;
    expect(row["status"]).toBe("queued");
  });

  it("never publishes a breakeven trade when breakeven posting is OFF", async () => {
    await setSettings({ auto_post_enabled: true, post_breakeven: false });
    await enqueueFinalTradeForXPost(closedTrade({ profit: 0 }));
    vi.stubGlobal("fetch", vi.fn());
    await processQueuedXTradePosts();
    expect(fetch).not.toHaveBeenCalled();
    expect(state.db.collection("x_trade_posts").docs[0]!["status"]).toBe("queued");
  });

  it("publishes a winning trade when auto posting is ON and persists status + X post ID", async () => {
    await setSettings({ auto_post_enabled: true });
    await enqueueFinalTradeForXPost(closedTrade({ profit: 500 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 201, headers: new Headers(), json: async () => ({ data: { id: "17000000000" } }) })));
    await processQueuedXTradePosts();
    const row = state.db.collection("x_trade_posts").docs[0]!;
    expect(row["status"]).toBe("posted");
    expect(row["x_post_id"]).toBe("17000000000");
  });

  it("records a failure and safe retry state when the X API call fails", async () => {
    await setSettings({ auto_post_enabled: true });
    await enqueueFinalTradeForXPost(closedTrade({ profit: 500 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, headers: new Headers(), json: async () => ({}) })));
    await processQueuedXTradePosts();
    const row = state.db.collection("x_trade_posts").docs[0]!;
    expect(row["status"]).toBe("queued");
    expect(row["retry_count"]).toBe(1);
    expect(row["next_attempt_at"]).toBeTruthy();
    expect(row["x_post_id"]).toBeUndefined();
  });

  it("admin manual publish persists status + X post ID and is idempotent per trade", async () => {
    const trade = closedTrade({ profit: 250 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 201, headers: new Headers(), json: async () => ({ data: { id: "17000000001" } }) })));
    const first = await publishApprovedXTrade(trade);
    expect(first["status"]).toBe("posted");
    expect(first["x_post_id"]).toBe("17000000001");
    const second = await publishApprovedXTrade(trade);
    expect(second["duplicate"]).toBe(true);
    expect(state.db.collection("x_trade_posts").docs).toHaveLength(1);
  });
});
