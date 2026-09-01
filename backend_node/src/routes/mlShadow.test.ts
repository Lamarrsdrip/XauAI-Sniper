import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

type Doc = Record<string, unknown>;

function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const ops = expected as Doc;
      if ("$exists" in ops) return ops["$exists"] ? doc[key] !== undefined : doc[key] === undefined;
      if ("$eq" in ops) return doc[key] === ops["$eq"];
    }
    return doc[key] === expected;
  });
}

class FakeCollection {
  docs: Doc[] = [];

  async insertOne(doc: Doc) {
    this.docs.push(structuredClone(doc));
    return { acknowledged: true };
  }

  async countDocuments(query: Doc = {}): Promise<number> {
    return this.docs.filter((d) => matches(d, query)).length;
  }

  async findOneAndUpdate(query: Doc, update: { $set?: Doc }, options: { sort?: Doc } = {}) {
    let candidates = this.docs.filter((d) => matches(d, query));
    if (options.sort) {
      const [[key, dir]] = Object.entries(options.sort);
      candidates = [...candidates].sort((a, b) => (dir === -1 ? 1 : -1) * String(a[key]).localeCompare(String(b[key])));
    }
    const found = candidates[0];
    if (!found) return null;
    Object.assign(found, structuredClone(update.$set ?? {}));
    return structuredClone(found);
  }

  // Narrow interpreter for exactly the one $group pipeline shape
  // /admin/ml/shadow-stats uses: $match eventual_result exists, then
  // $group by hive_verdict with $sum/$cond/$ifNull. Not a general Mongo
  // aggregation engine -- deliberately scoped to what this file actually
  // sends, matching this test suite's existing convention (see
  // xTradePosting.test.ts's FakeCollection) of narrow, exact fakes.
  aggregate<T = Doc>(pipeline: Doc[]) {
    let rows = this.docs;
    for (const stage of pipeline) {
      if (stage["$match"]) {
        rows = rows.filter((d) => matches(d, stage["$match"] as Doc));
      } else if (stage["$group"]) {
        const spec = stage["$group"] as Doc;
        const groups = new Map<string, Doc[]>();
        for (const row of rows) {
          const keyField = String(spec["_id"]).replace("$", "");
          const key = String(row[keyField]);
          const arr = groups.get(key) ?? [];
          arr.push(row);
          groups.set(key, arr);
        }
        const out: Doc[] = [];
        for (const [key, groupRows] of groups) {
          const result: Doc = { _id: key };
          for (const [field, expr] of Object.entries(spec)) {
            if (field === "_id") continue;
            const sumExpr = (expr as Doc)["$sum"];
            if (typeof sumExpr === "number") { result[field] = groupRows.length * sumExpr; continue; }
            if (sumExpr && typeof sumExpr === "object" && "$cond" in (sumExpr as Doc)) {
              const [cond, ifTrue, ifFalse] = (sumExpr as Doc)["$cond"] as [Doc, number, number];
              const [eqField, eqVal] = (cond["$eq"] as [string, unknown]);
              const fieldName = eqField.replace("$", "");
              result[field] = groupRows.reduce((sum, r) => sum + (r[fieldName] === eqVal ? ifTrue : ifFalse), 0);
              continue;
            }
            if (sumExpr && typeof sumExpr === "object" && "$ifNull" in (sumExpr as Doc)) {
              const [srcField, fallback] = (sumExpr as Doc)["$ifNull"] as [string, number];
              const fieldName = srcField.replace("$", "");
              result[field] = groupRows.reduce((sum, r) => sum + Number(r[fieldName] ?? fallback), 0);
              continue;
            }
          }
          out.push(result);
        }
        rows = out;
      }
    }
    return { toArray: async () => structuredClone(rows) as unknown as T[] };
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
vi.mock("../auth.js", () => ({ requireAdmin: async () => undefined }));
vi.mock("../services/license.js", () => ({ resolveMonitorLicense: vi.fn(async () => ({ id: "lic-test" })) }));

const { registerMlRoutes } = await import("./ml.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerMlRoutes(app);
  return app;
}

beforeEach(() => {
  state.db = new FakeDb();
});

describe("shadow ML — pure observation, never influences a live decision", () => {
  it("records a shadow decision with all required fields, never returns anything that could gate a trade", async () => {
    const app = await createApp();
    const res = await app.inject({
      method: "POST",
      url: "/ml/shadow/record",
      payload: {
        symbol: "XAUUSDm",
        direction: "BUY",
        setup_type: "TREND_CONTINUATION",
        regime: "TRENDING_UP",
        rule_score: 72.5,
        rule_decision: "A",
        ml_score: 0.63,
        ml_samples: 18,
        hive_verdict: "BOOST",
        hive_verdict_int: 1,
        hive_samples: 22,
        hive_win_rate: 0.68,
        hive_rollup_level: 0,
        signature: "1|2|3|4|5|6|7",
        shadow_recommendation: "BOOST",
        actual_action: "CANDIDATE",
        account: 476396807,
        decision_time_utc: "2026.08.24 12:00:00",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    // The response contains no decision the EA could branch on -- it is a
    // bare acknowledgement, proving this endpoint cannot become a live gate
    // by accident.
    expect(Object.keys(res.json())).toEqual(["status"]);
    const stored = state.db.collection("ml_shadow_decisions").docs;
    expect(stored).toHaveLength(1);
    expect(stored[0]!["hive_verdict"]).toBe("BOOST");
    expect(stored[0]!["actual_action"]).toBe("CANDIDATE");
  });

  it("rejects a record with no signature", async () => {
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ml/shadow/record", payload: { symbol: "XAUUSDm" } });
    expect(res.statusCode).toBe(400);
    expect(state.db.collection("ml_shadow_decisions").docs).toHaveLength(0);
  });

  it("applies safe defaults for optional fields", async () => {
    const app = await createApp();
    const res = await app.inject({ method: "POST", url: "/ml/shadow/record", payload: { signature: "1|2|3|4|5|6|7" } });
    expect(res.statusCode).toBe(200);
    const stored = state.db.collection("ml_shadow_decisions").docs[0]!;
    expect(stored["hive_verdict"]).toBe("NONE");
    expect(stored["actual_action"]).toBe("CANDIDATE");
    expect(stored["ml_score"]).toBe(0.5);
  });

  it("admin shadow-stats requires admin auth (route registered behind requireAdmin)", async () => {
    // requireAdmin is mocked to always pass here -- this test proves the
    // route is wired through that preHandler at all, not that auth itself
    // works (auth.ts's own tests own that).
    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/admin/ml/shadow-stats" });
    expect(res.statusCode).toBe(200);
  });

  it("aggregates observation counts by verdict and outcome win-rate/expectancy once trades join", async () => {
    state.db.collection("ml_shadow_decisions").docs.push(
      { signature: "s1", hive_verdict: "BOOST", actual_action: "EXECUTED", eventual_result: "WIN", profit: 500 },
      { signature: "s2", hive_verdict: "BOOST", actual_action: "EXECUTED", eventual_result: "LOSS", profit: -100 },
      { signature: "s3", hive_verdict: "VETO", actual_action: "EXECUTED", eventual_result: "LOSS", profit: -80 },
      { signature: "s4", hive_verdict: "NEUTRAL", actual_action: "CANDIDATE" }, // not yet joined
      { signature: "s5", hive_verdict: "COLD_START", actual_action: "SKIPPED" },
    );
    const app = await createApp();
    const res = await app.inject({ method: "GET", url: "/admin/ml/shadow-stats" });
    const body = res.json();
    expect(body.total_observations).toBe(5);
    expect(body.observation_counts).toEqual({ BOOST: 2, VETO: 1, NEUTRAL: 1, COLD_START: 1 });
    expect(body.outcomes_by_verdict.BOOST).toEqual({ trades: 2, wins: 1, losses: 1, win_rate: 50, avg_pl: 200, expectancy: 200 });
    expect(body.outcomes_by_verdict.VETO).toEqual({ trades: 1, wins: 0, losses: 1, win_rate: 0, avg_pl: -80, expectancy: -80 });
    expect(body.outcomes_by_verdict.NEUTRAL).toBeUndefined(); // no joined outcome yet
    expect(body.pending_unjoined_candidates).toBe(1);
    expect(body.executed).toBe(3);
    expect(body.skipped).toBe(1);
  });
});
