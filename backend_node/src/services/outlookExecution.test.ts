import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Outlook+Aurum Unified Coordination fix (2026-09-02). Regression coverage
 * for the root-cause change: a fresh actionable Outlook/M10 doc must
 * publish passive OUTLOOK_THESIS context, never an OUTLOOK_SIGNAL_OPEN
 * execution command. See TEST 1/2/8/9 in the owner's mission spec.
 */

type Doc = Record<string, unknown>;

class FakeCollection {
  docs: Doc[] = [];

  async insertOne(doc: Doc) {
    this.docs.push(structuredClone(doc));
    return { acknowledged: true };
  }

  async updateOne(query: Doc, update: { $set?: Doc }, options: { upsert?: boolean } = {}) {
    const found = this.docs.find((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    if (found) {
      Object.assign(found, structuredClone(update.$set ?? {}));
      return { matchedCount: 1, upsertedCount: 0 };
    }
    if (options.upsert) {
      this.docs.push({ ...structuredClone(query), ...structuredClone(update.$set ?? {}) });
      return { matchedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, upsertedCount: 0 };
  }

  async updateMany(query: Doc, update: { $set?: Doc }) {
    const matches = this.docs.filter((d) =>
      Object.entries(query).every(([k, v]) => {
        if (v && typeof v === "object" && !Array.isArray(v) && "$ne" in (v as Doc)) return d[k] !== (v as Doc)["$ne"];
        return d[k] === v;
      }),
    );
    for (const d of matches) Object.assign(d, structuredClone(update.$set ?? {}));
    return { matchedCount: matches.length, modifiedCount: matches.length };
  }

  find(query: Doc = {}) {
    const rows = this.docs.filter((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    return rows;
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

const { publishOutlookThesis } = await import("./outlookExecution.js");

function actionableDoc(overrides: Doc = {}): Doc {
  return {
    id: "outlook-abc-123",
    account: "555111",
    license_key: "TESTPIN1",
    primary_direction: "BUY",
    generated_at: "2026-09-02T10:00:00.000Z",
    preferred_entry_zone_low: 3610.0,
    preferred_entry_zone_high: 3612.0,
    suggested_sl: 3600.0,
    chase_limit: 3618.0,
    confidence_pct: 62,
    market_regime: "TRENDING",
    setup_type: "CONTINUATION",
    tp1_price: 3620.0,
    tp2_price: 3630.0,
    tp3_price: 3645.0,
    ...overrides,
  };
}

beforeEach(() => {
  state.db = new FakeDb();
});

describe("publishOutlookThesis -- OUTLOOK_SIGNAL_OPEN replaced by passive thesis context", () => {
  it("TEST 1/2: an actionable BUY publication never writes a cloud_bot_commands row", async () => {
    await publishOutlookThesis(actionableDoc());
    const commands = state.db.collection("cloud_bot_commands").find();
    expect(commands).toHaveLength(0);
  });

  it("writes exactly one ACTIVE cloud_outlook_thesis row with the full thesis contract, not an execution command", async () => {
    const id = await publishOutlookThesis(actionableDoc());
    expect(id).toBeTruthy();
    const rows = state.db.collection("cloud_outlook_thesis").find();
    expect(rows).toHaveLength(1);
    const thesis = rows[0];
    expect(thesis["direction"]).toBe("BUY");
    expect(thesis["status"]).toBe("ACTIVE");
    expect(thesis["outlook_id"]).toBe("outlook-abc-123");
    expect(thesis["account"]).toBe("555111");
    expect(thesis["reference_price"]).toBeCloseTo(3611.0, 2);
    expect(thesis["confidence"]).toBe(62);
    expect(thesis["regime"]).toBe("TRENDING");
    expect(thesis["setup_type"]).toBe("CONTINUATION");
    expect(thesis["chase_limit"]).toBe(3618.0);
    expect(thesis["tp1_price"]).toBe(3620.0);
    // suggested_sl is clamped through the same $10 Gold-move ceiling the EA
    // uses -- unchanged production safety rule, not weakened here.
    expect(Number(thesis["suggested_sl"])).toBeGreaterThanOrEqual(3601.0);
  });

  it("does not fabricate a thesis when the doc has no usable entry zone (no invented information)", async () => {
    const id = await publishOutlookThesis(actionableDoc({ preferred_entry_zone_low: 0, preferred_entry_zone_high: 0 }));
    expect(id).toBeNull();
    expect(state.db.collection("cloud_outlook_thesis").find()).toHaveLength(0);
  });

  it("does not publish for NEUTRAL/non-actionable directions", async () => {
    const id = await publishOutlookThesis(actionableDoc({ primary_direction: "NEUTRAL" }));
    expect(id).toBeNull();
  });

  it("a fresh thesis for the same account supersedes the prior active one instead of deleting it", async () => {
    await publishOutlookThesis(actionableDoc({ id: "first-signal" }));
    await publishOutlookThesis(actionableDoc({ id: "second-signal", generated_at: "2026-09-02T11:00:00.000Z" }));
    const rows = state.db.collection("cloud_outlook_thesis").find() as Doc[];
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r["outlook_id"] === "first-signal");
    const second = rows.find((r) => r["outlook_id"] === "second-signal");
    expect(first?.["status"]).toBe("SUPERSEDED");
    expect(second?.["status"]).toBe("ACTIVE");
  });

  it("defaults expires_at to generated_at + 1h when the doc carries no explicit expiry (matches the EA's original ~1h Outlook opportunity window)", async () => {
    await publishOutlookThesis(actionableDoc());
    const thesis = state.db.collection("cloud_outlook_thesis").find()[0];
    const generated = new Date(thesis["generated_at"] as string).getTime();
    const expires = new Date(thesis["expires_at"] as string).getTime();
    expect(expires - generated).toBe(3600_000);
  });

  it("M10-sourced actionable docs are tagged with a distinct source, still no command row", async () => {
    await publishOutlookThesis(actionableDoc({ id: "m10-candidate-1" }), "M10_SIGNAL_ENGINE");
    const thesis = state.db.collection("cloud_outlook_thesis").find()[0];
    expect(thesis["source"]).toBe("M10_SIGNAL_ENGINE");
    expect(state.db.collection("cloud_bot_commands").find()).toHaveLength(0);
  });
});
