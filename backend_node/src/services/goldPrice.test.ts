import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { fetchLiveGoldPrice, _resetGoldCacheForTests } = await import("./goldPrice.js");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  state.db = new FakeDb();
  _resetGoldCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
});

describe("fetchLiveGoldPrice — never fabricates a quote", () => {
  it("uses a fresh EA heartbeat quote first", async () => {
    state.db.collection("cloud_market_evidence").docs.push({
      normalized_symbol: "XAUUSD",
      quote_valid: true,
      bid: 4362.74,
      ask: 4363.04,
      mid: 4362.89,
      received_at: new Date().toISOString(),
      observed_at: new Date().toISOString(),
    });
    const result = await fetchLiveGoldPrice();
    expect(result.available).toBe(true);
    expect(result.bid).toBe(4362.74);
    expect(result.source).toBe("ea_live");
    expect(result.stale).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns unavailable rather than a hardcoded price when every source fails", async () => {
    const result = await fetchLiveGoldPrice();
    expect(result.available).toBe(false);
    expect(result.bid).toBeNull();
    expect(result.source).toBe("unavailable");
    expect(result.stale).toBe(false);
  });

  it("falls back to gold-api spot when no EA quote exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("gold-api.com")) {
          return { ok: true, json: async () => ({ price: 3401.25 }) };
        }
        return { ok: false, json: async () => ({}) };
      }),
    );
    const result = await fetchLiveGoldPrice();
    expect(result.available).toBe(true);
    expect(result.bid).toBe(3401.25);
    expect(result.source).toBe("gold_api_spot");
  });
});
