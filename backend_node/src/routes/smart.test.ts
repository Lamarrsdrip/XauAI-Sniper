import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const { registerSmartRoutes, _resetSmartCachesForTests } = await import("./smart.js");

const originalFetch = globalThis.fetch;

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerSmartRoutes(app);
  return app;
}

beforeEach(() => {
  _resetSmartCachesForTests();
});

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
});

describe("smart routes — no fabricated DXY or news calendar", () => {
  it("GET /smart/dxy reports unavailable instead of a hardcoded 99.5", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/smart/dxy" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(false);
    expect(body.dxy_price).toBeNull();
    expect(body.gold_bias).toBe("unknown");
    expect(JSON.stringify(body)).not.toContain("99.5");
  });

  it("GET /smart/dxy caches Yahoo so a poll storm does not fan out", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        chart: { result: [{ meta: { regularMarketPrice: 101.234, regularMarketChangePercent: -0.42 } }] },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = await createApp();
    await app.inject({ method: "GET", url: "/smart/dxy" });
    await app.inject({ method: "GET", url: "/smart/dxy" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET /smart/news-events does not invent NFP/CPI/FOMC rows when the calendar is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => [] })));
    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/smart/news-events" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("DEGRADED_UNKNOWN");
    expect(body.events).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/NFP|Non-Farm|FOMC|CPI/i);
  });

  it("GET /news/check degrades as unknown, not as a fake safe-to-trade", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/news/check" });
    const body = res.json();
    expect(body.status).toBe("DEGRADED_UNKNOWN");
    expect(body.safe_to_trade).toBeNull();
    expect(body.global_block).toBe(false);
  });
});
