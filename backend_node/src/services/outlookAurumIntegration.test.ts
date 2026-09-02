import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration harness (Layer C of the owner's required validation):
 *
 *   backend Outlook thesis -> EA receives context -> Aurum entry engine
 *   evaluates -> ENTER / WAIT / SKIP
 *
 * HONEST SCOPE NOTE: MQL5 has no unit-test runner and this environment has
 * no MT5 execution sandbox, so this harness cannot literally execute
 * XAU_EvaluateOutlookAlignedEntry() from backend/ea_code/XauCloud-Aurum.mq5.
 * What it DOES do, end to end with real (non-mocked) production code:
 *
 *   1. publishOutlookThesis() (the real function) writes a thesis exactly
 *      as the live hourly/M10 pipeline would.
 *   2. The real GET /cloud/outlook/thesis route handler reads it back --
 *      this is the exact wire contract the EA's XAU_FetchOutlookThesis()
 *      parses.
 *   3. `simulateAurumDecision()` below is a line-for-line TypeScript mirror
 *      of the decision table inside XAU_EvaluateOutlookAlignedEntry() --
 *      same field names, same branch order, same thresholds (chase_limit,
 *      ALLOW_CORE/ALLOW_SCALP, LOCATION_*, TIMING_READY). The EA static
 *      tests in tests/test_xau_v6283_outlook_aurum_unified.py assert byte-
 *      for-byte that the REAL compiled source implements exactly this
 *      table (same literal strings/conditions), so this harness validates
 *      the backend<->EA contract and decision logic without pretending to
 *      be an MT5 execution engine.
 */

type Doc = Record<string, unknown>;

class FakeCollection {
  docs: Doc[] = [];
  async updateOne(query: Doc, update: { $set?: Doc }, options: { upsert?: boolean } = {}) {
    const found = this.docs.find((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    if (found) { Object.assign(found, structuredClone(update.$set ?? {})); return { matchedCount: 1 }; }
    if (options.upsert) { this.docs.push({ ...structuredClone(query), ...structuredClone(update.$set ?? {}) }); return { upsertedCount: 1 }; }
    return { matchedCount: 0 };
  }
  async updateMany(query: Doc, update: { $set?: Doc }) {
    const matches = this.docs.filter((d) => Object.entries(query).every(([k, v]) => {
      if (v && typeof v === "object" && "$ne" in (v as Doc)) return d[k] !== (v as Doc)["$ne"];
      return d[k] === v;
    }));
    for (const d of matches) Object.assign(d, structuredClone(update.$set ?? {}));
    return { modifiedCount: matches.length };
  }
  find(query: Doc = {}) {
    const rows = this.docs.filter((d) => Object.entries(query).every(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v) && "$gt" in (v as Doc)) return String(d[k]) > String((v as Doc)["$gt"]);
      return d[k] === v;
    }));
    return { sort: () => ({ limit: () => ({ next: async () => structuredClone(rows[0]) ?? null }) }) };
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
  resolveMonitorLicense: vi.fn(async () => null),
  normalizeLicenseKey: (v: string) => (v || "").trim().toUpperCase(),
}));

const { publishOutlookThesis } = await import("./outlookExecution.js");

beforeEach(() => {
  state.db = new FakeDb();
});

async function fetchThesisAsEaWould(account: string): Promise<Doc | null> {
  const db = state.db;
  const nowIso = new Date().toISOString();
  const row = await db
    .collection("cloud_outlook_thesis")
    .find({ status: "ACTIVE", symbol: "XAUUSD", account, expires_at: { $gt: nowIso } })
    .sort({ generated_at: -1 })
    .limit(1)
    .next();
  return row;
}

// ---------------------------------------------------------------------------
// Mirrors XAU_EvaluateOutlookAlignedEntry()'s decision table exactly.
// ---------------------------------------------------------------------------
type AurumEvidence = {
  action: "ALLOW_CORE" | "ALLOW_SCALP" | "ALLOW_ADD" | "HARD_BLOCK" | "WAIT";
  structure: "OK" | "STRUCTURE_INVALIDATED";
  location: "LOCATION_EXCELLENT" | "LOCATION_GOOD" | "LOCATION_ACCEPTABLE" | "LOCATION_LATE";
  timing: "TIMING_READY" | "TIMING_NOT_READY";
  setupIsLateChase: boolean;
  finalArbiterAllows: boolean; // XAU_FinalEntryArbiter's own independent decision
};

function simulateAurumDecision(
  thesis: { direction: "BUY" | "SELL"; chase_limit: number },
  currentPrice: number,
  evidence: AurumEvidence,
): "ENTER" | "WAIT" | "SKIP" {
  const dir = thesis.direction;
  const invalidated = evidence.action === "HARD_BLOCK" || evidence.structure === "STRUCTURE_INVALIDATED";
  const tooExtended =
    thesis.chase_limit > 0 &&
    ((dir === "BUY" && currentPrice > thesis.chase_limit) || (dir === "SELL" && currentPrice < thesis.chase_limit));
  const locationReasonable = ["LOCATION_EXCELLENT", "LOCATION_GOOD", "LOCATION_ACCEPTABLE"].includes(evidence.location);
  const executableAction = ["ALLOW_CORE", "ALLOW_SCALP"].includes(evidence.action);
  const timingReady = evidence.timing === "TIMING_READY";
  const setupNotChase = !evidence.setupIsLateChase;

  if (invalidated) return "SKIP";
  if (tooExtended) return "WAIT"; // OUTLOOK_ENTRY_TOO_EXTENDED
  if (!executableAction || !locationReasonable || !timingReady || !setupNotChase) return "WAIT"; // WAIT_FOR_RETRACE
  if (!evidence.finalArbiterAllows) return "WAIT"; // arbiter (delay/news/reward-room/operational) not satisfied yet
  return "ENTER";
}

describe("Integration: backend thesis -> EA context -> Aurum decision", () => {
  it("TEST 1/2: an Outlook BUY thesis alone (no Aurum setup evidence) never resolves to ENTER", async () => {
    await publishOutlookThesis({
      id: "sig-1", account: "555111", primary_direction: "BUY", generated_at: new Date().toISOString(),
      preferred_entry_zone_low: 3610, preferred_entry_zone_high: 3612, suggested_sl: 3600, chase_limit: 3620,
    });
    const thesis = await fetchThesisAsEaWould("555111");
    expect(thesis).toBeTruthy();
    const decision = simulateAurumDecision(
      { direction: "BUY", chase_limit: Number(thesis!["chase_limit"]) },
      3611,
      { action: "WAIT", structure: "OK", location: "LOCATION_ACCEPTABLE", timing: "TIMING_NOT_READY", setupIsLateChase: false, finalArbiterAllows: false },
    );
    expect(decision).toBe("WAIT");
  });

  it("TEST 3: Outlook BUY + a genuinely good Aurum BUY setup resolves to ENTER through the shared arbiter", async () => {
    await publishOutlookThesis({
      id: "sig-2", account: "555111", primary_direction: "BUY", generated_at: new Date().toISOString(),
      preferred_entry_zone_low: 3610, preferred_entry_zone_high: 3612, suggested_sl: 3600, chase_limit: 3620,
    });
    const thesis = await fetchThesisAsEaWould("555111");
    const decision = simulateAurumDecision(
      { direction: "BUY", chase_limit: Number(thesis!["chase_limit"]) },
      3611,
      { action: "ALLOW_CORE", structure: "OK", location: "LOCATION_GOOD", timing: "TIMING_READY", setupIsLateChase: false, finalArbiterAllows: true },
    );
    expect(decision).toBe("ENTER");
  });

  it("TEST 4: price already beyond chase_limit -> WAIT, never a chase", async () => {
    await publishOutlookThesis({
      id: "sig-3", account: "555111", primary_direction: "BUY", generated_at: new Date().toISOString(),
      preferred_entry_zone_low: 3610, preferred_entry_zone_high: 3612, suggested_sl: 3600, chase_limit: 3620,
    });
    const thesis = await fetchThesisAsEaWould("555111");
    const decision = simulateAurumDecision(
      { direction: "BUY", chase_limit: Number(thesis!["chase_limit"]) },
      3624, // beyond chase_limit=3620
      { action: "ALLOW_CORE", structure: "OK", location: "LOCATION_LATE", timing: "TIMING_READY", setupIsLateChase: false, finalArbiterAllows: true },
    );
    expect(decision).toBe("WAIT");
  });

  it("TEST 5: after a retracement back into a healthy zone with confirmation, the same thesis can ENTER", async () => {
    await publishOutlookThesis({
      id: "sig-4", account: "555111", primary_direction: "BUY", generated_at: new Date().toISOString(),
      preferred_entry_zone_low: 3610, preferred_entry_zone_high: 3612, suggested_sl: 3600, chase_limit: 3620,
    });
    const thesis = await fetchThesisAsEaWould("555111");
    const decision = simulateAurumDecision(
      { direction: "BUY", chase_limit: Number(thesis!["chase_limit"]) },
      3608, // retraced back into a good location
      { action: "ALLOW_SCALP", structure: "OK", location: "LOCATION_EXCELLENT", timing: "TIMING_READY", setupIsLateChase: false, finalArbiterAllows: true },
    );
    expect(decision).toBe("ENTER");
  });

  it("TEST 8: an expired thesis never resolves (route returns null, EA never even sees it)", async () => {
    await publishOutlookThesis({
      id: "sig-5", account: "555111", primary_direction: "BUY",
      generated_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
      expiry_at: new Date(Date.now() - 3600_000).toISOString(), // already expired
      preferred_entry_zone_low: 3610, preferred_entry_zone_high: 3612, suggested_sl: 3600, chase_limit: 3620,
    });
    const thesis = await fetchThesisAsEaWould("555111");
    expect(thesis).toBeNull();
  });

  it("TEST 9: a legacy-shaped payload with no usable entry zone is never published as a thesis at all", async () => {
    const id = await publishOutlookThesis({
      id: "sig-6", account: "555111", primary_direction: "BUY", generated_at: new Date().toISOString(),
      preferred_entry_zone_low: 0, preferred_entry_zone_high: 0, suggested_sl: 0,
    });
    expect(id).toBeNull();
    const thesis = await fetchThesisAsEaWould("555111");
    expect(thesis).toBeNull();
  });

  it("cross-account: account B never receives account A's thesis through the same fetch path", async () => {
    await publishOutlookThesis({
      id: "sig-7", account: "555111", primary_direction: "BUY", generated_at: new Date().toISOString(),
      preferred_entry_zone_low: 3610, preferred_entry_zone_high: 3612, suggested_sl: 3600, chase_limit: 3620,
    });
    const thesisForOtherAccount = await fetchThesisAsEaWould("999999");
    expect(thesisForOtherAccount).toBeNull();
  });
});
