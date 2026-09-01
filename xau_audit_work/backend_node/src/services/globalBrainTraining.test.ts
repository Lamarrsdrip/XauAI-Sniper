import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";
import { GLOBAL_BRAIN_OBSERVATIONS_COLLECTION } from "../models/globalBrain.js";
import type { GlobalBrainObservation } from "../models/globalBrain.js";
import type { QuestionSpec } from "./globalBrainTraining.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const {
  runGlobalBrainDailyCycle,
  checkHoldoutStability,
  checkOverfiltering,
  checkAccountDiversity,
  computeOpportunityCapture,
  evaluateOnHoldout,
  evaluateBaselineOnHoldout,
  acquireCycleLock,
  releaseCycleLock,
} = await import("./globalBrainTraining.js");
const { getCurrentChampion, getLatestModelDoc } = await import("./globalBrainRegistry.js");
const { latestDriftAlert } = await import("./globalBrainDrift.js");

function makeObservation(i: number, overrides: Partial<GlobalBrainObservation> = {}): GlobalBrainObservation {
  // Chronologically spread, oldest first -- resolved_at index i, 1 hour apart.
  const resolvedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 3_600_000).toISOString();
  // Bucket "BUY|LONDON|TRENDING|BREAKOUT" wins 90% of the time; the other
  // bucket wins 20% -- a strong, unambiguous signal, large enough to clear
  // the promotion gate's noise-scaled statistical threshold (not just its
  // fixed practical-effect floor) at a few hundred holdout samples.
  const favoredBucket = i % 2 === 0; // even split between the two buckets
  const isWin = favoredBucket ? i % 10 !== 0 : i % 5 === 0;
  return {
    dedupe_key: `OBS:${i}`,
    source: "OUTLOOK",
    account_ref: `hash${i % 4}`,
    decision_action: "EXECUTED",
    features: {
      symbol: "XAUUSD",
      direction: "BUY",
      session: favoredBucket ? "LONDON" : "TOKYO",
      regime: favoredBucket ? "TRENDING" : "RANGE",
      structure_state: "",
      setup_type: favoredBucket ? "BREAKOUT" : "REVERSAL",
      confidence_pct: 70,
      hive_verdict: null,
      hive_win_rate: null,
    },
    outcome: {
      analytics_outcome: isWin ? "WIN" : "LOSS",
      r_multiple: isWin ? 1.0 : -1.0,
      mfe_r: isWin ? 1.0 : 0.1,
      mae_r: isWin ? -0.1 : -1.0,
      highest_tp_reached: isWin ? 1 : null,
      time_to_resolution_seconds: 600,
    },
    mistake_classification: isWin ? "CLEAN_WIN" : "WRONG_DIRECTION",
    counterfactual: null,
    decision_at: resolvedAt,
    resolved_at: resolvedAt,
    source_ref: { collection: "cloud_market_outlooks", id: `id${i}` },
    created_at: resolvedAt,
    ...overrides,
  };
}

async function seedObservations(count: number): Promise<void> {
  const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
  for (let i = 0; i < count; i++) {
    await collection.insertOne(makeObservation(i) as unknown as Record<string, unknown>);
  }
}

describe("runGlobalBrainDailyCycle", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("reports INSUFFICIENT_EVIDENCE and promotes nothing when there are no observations at all", async () => {
    const report = await runGlobalBrainDailyCycle();
    expect(report.success).toBe(true);
    expect(report.observations_eligible).toBe(0);
    for (const question of Object.values(report.questions)) {
      expect(question?.promoted).toBe(false);
      expect(question?.reason).toContain("INSUFFICIENT_EVIDENCE");
    }
  });

  it("promotes an initial champion once holdout sample size is cleared, using a real chronological (non-random) split", async () => {
    await seedObservations(1000); // holdout ~= 20% = 200, comfortably clears MIN_HOLDOUT_SAMPLE (30)
    const report = await runGlobalBrainDailyCycle();
    expect(report.success).toBe(true);
    expect(report.observations_eligible).toBe(1000);

    const dq = report.questions.DIRECTION_QUALITY!;
    expect(dq.promoted).toBe(true);
    expect(dq.champion_version).toBe(1);
    expect(dq.is_first_model).toBe(true);
    // Promotion required beating a real trivial baseline, not just sample size --
    // the seeded data has a genuine 90%-vs-20% bucket split, a strong signal.
    expect(dq.reason).toContain("PROMOTED");
    expect(dq.challenger_holdout_metrics.brier_score).toBeLessThan(dq.comparison_metrics!.brier_score);

    const champion = await getCurrentChampion("DIRECTION_QUALITY");
    expect(champion).not.toBeNull();
    expect(champion!.version).toBe(1);

    // Chronological, walk-forward: holdout window must be strictly AFTER
    // the training window (oldest-first split, never shuffled).
    expect(new Date(report.holdout_window.from!).getTime()).toBeGreaterThan(new Date(report.training_window.to!).getTime());
  });

  it("reports account concentration without vetoing statistically strong shared-XAU market learning", async () => {
    const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
    for (let i = 0; i < 1000; i++) {
      await collection.insertOne({ ...makeObservation(i), account_ref: "one-active-account" } as unknown as Record<string, unknown>);
    }
    const report = await runGlobalBrainDailyCycle();
    const dq = report.questions.DIRECTION_QUALITY!;
    expect(dq.promoted).toBe(true);
    expect(dq.account_diversity?.account_concentration_risk).toBe(true);
    expect(await getCurrentChampion("DIRECTION_QUALITY")).not.toBeNull();
  });

  it("does NOT promote a first-ever model that shows no real skill beyond the global rate (closes the bootstrap-promotion gap an adversarial review found)", async () => {
    // Every item shares one bucket key -- the trained model's prediction for
    // every item is therefore identical to the trivial baseline's constant
    // prediction (both equal the same global rate). No real skill exists to
    // measure, so promotion must not happen purely because n cleared 30.
    const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
    for (let i = 0; i < 200; i++) {
      const resolvedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 3_600_000).toISOString();
      const isWin = i % 2 === 0; // random-ish 50/50, no bucket-dependent pattern
      await collection.insertOne({
        dedupe_key: `SAMEBUCKET:${i}`,
        source: "OUTLOOK",
        account_ref: "hash1",
        decision_action: "EXECUTED",
        features: { symbol: "XAUUSD", direction: "BUY", session: "LONDON", regime: "TRENDING", structure_state: "", setup_type: "BREAKOUT", confidence_pct: 70, hive_verdict: null, hive_win_rate: null },
        outcome: { analytics_outcome: isWin ? "WIN" : "LOSS", r_multiple: isWin ? 1.0 : -1.0, mfe_r: isWin ? 1.0 : 0.1, mae_r: isWin ? -0.1 : -1.0, highest_tp_reached: isWin ? 1 : null, time_to_resolution_seconds: 600 },
        mistake_classification: isWin ? "CLEAN_WIN" : "WRONG_DIRECTION",
        counterfactual: null,
        decision_at: resolvedAt,
        resolved_at: resolvedAt,
        source_ref: { collection: "cloud_market_outlooks", id: `id${i}` },
        created_at: resolvedAt,
      } as unknown as Record<string, unknown>);
    }
    const report = await runGlobalBrainDailyCycle();
    const dq = report.questions.DIRECTION_QUALITY!;
    expect(dq.promoted).toBe(false);
    expect(dq.reason).toContain("INSUFFICIENT_EVIDENCE");
    expect(await getCurrentChampion("DIRECTION_QUALITY")).toBeNull();
  });

  it("does not re-promote on a second run over identical data -- the dataset_fingerprint short-circuit catches it before even training a challenger", async () => {
    await seedObservations(1000);
    await runGlobalBrainDailyCycle(); // v1 promoted
    const secondReport = await runGlobalBrainDailyCycle(); // same data, same fingerprint -- no new evidence
    const dq = secondReport.questions.DIRECTION_QUALITY!;
    expect(dq.promoted).toBe(false);
    expect(dq.reason).toContain("dataset_fingerprint match");
    expect(dq.champion_version).toBe(1); // still v1, never regressed to a worse challenger
  });

  it("evaluates a genuinely new challenger against a real held champion once new data arrives, and does not promote noise", async () => {
    await seedObservations(1000);
    await runGlobalBrainDailyCycle(); // v1 promoted
    // Append a handful more observations with the SAME underlying pattern --
    // real new data, but not enough of a signal shift to justify promoting
    // a "different" model over the one already champion.
    const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
    for (let i = 1000; i < 1010; i++) await collection.insertOne(makeObservation(i) as unknown as Record<string, unknown>);
    const secondReport = await runGlobalBrainDailyCycle();
    const dq = secondReport.questions.DIRECTION_QUALITY!;
    expect(dq.reason).not.toContain("dataset_fingerprint match");
    expect(dq.is_first_model).toBe(false);
    expect(dq.comparison_metrics).not.toBeNull();
    expect(dq.champion_version).toBe(1); // no meaningfully better challenger -- champion correctly retained
  });

  describe("multi-cycle maturity: evidence-based promotion below MIN_HOLDOUT_SAMPLE (globalBrainMaturity.ts)", () => {
    // A stronger, still-realistic favored/unfavored gap than makeObservation's
    // default (95% vs 20% here vs. 90%/20%) -- at the smaller N this describe
    // block deliberately uses to land holdout in the multi-cycle band, the
    // realized sample win rate in any one chronological slice (train-only,
    // validation-only, holdout-only) must stay clearly above 50% for the
    // comparison baseline to itself participate in enough opportunities to
    // be a fair drawdown comparison -- finite-sample noise at n<30 can
    // otherwise dip a slice's realized rate under 50%, at which point the
    // trivial "predict the global prior" baseline predicts "never enter"
    // and trivially shows zero drawdown, an unwinnable degenerate
    // comparison unrelated to anything this test is trying to verify.
    function smallSampleObservation(i: number): GlobalBrainObservation {
      const resolvedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 3_600_000).toISOString();
      const favoredBucket = i % 2 === 0;
      const isWin = favoredBucket ? i % 50 !== 0 : i % 5 < 2;
      return makeObservation(i, {
        features: {
          symbol: "XAUUSD",
          direction: "BUY",
          session: favoredBucket ? "LONDON" : "TOKYO",
          regime: favoredBucket ? "TRENDING" : "RANGE",
          structure_state: "",
          setup_type: favoredBucket ? "BREAKOUT" : "REVERSAL",
          confidence_pct: 70,
          hive_verdict: null,
          hive_win_rate: null,
        },
        outcome: {
          analytics_outcome: isWin ? "WIN" : "LOSS",
          r_multiple: isWin ? 1.0 : -1.0,
          mfe_r: isWin ? 1.0 : 0.1,
          mae_r: isWin ? -0.1 : -1.0,
          highest_tp_reached: isWin ? 1 : null,
          time_to_resolution_seconds: 600,
        },
        mistake_classification: isWin ? "CLEAN_WIN" : "WRONG_DIRECTION",
        decision_at: resolvedAt,
        resolved_at: resolvedAt,
      });
    }

    it("a small-but-strong holdout (below 30) accumulates a real streak across consecutive cycles on genuinely new data, through the actual daily-cycle pipeline -- never promotes on one cycle alone", async () => {
      // Chosen so eligible*0.2 (the chronological holdout slice) lands in the
      // multi-cycle band [MIN_HOLDOUT_SAMPLE_FLOOR=12, MIN_HOLDOUT_SAMPLE=30)
      // across consecutive cycles as N grows slowly, mirroring real
      // production observation accumulation. The full "streak reaches
      // REQUIRED_STREAK_CYCLES and promotes" arithmetic is exhaustively
      // proven in isolation by globalBrainMaturity.test.ts; this test's job
      // is proving the WIRING through the real pipeline (dataset_fingerprint
      // threading, getLatestModelDoc lookup, persistence) accumulates a
      // streak correctly across genuinely new data, not the statistical
      // edge case of also simultaneously clearing every other independent
      // safety gate (overfiltering, validation) at this exact small n --
      // those gates are exercised on their own elsewhere in this file.
      const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
      let cursor = 0;
      for (; cursor < 120; cursor++) await collection.insertOne(smallSampleObservation(cursor) as unknown as Record<string, unknown>);
      const cycle1 = await runGlobalBrainDailyCycle();
      const dq1 = cycle1.questions.DIRECTION_QUALITY!;
      expect(dq1.challenger_holdout_metrics.holdout_n).toBeGreaterThanOrEqual(12);
      expect(dq1.challenger_holdout_metrics.holdout_n).toBeLessThan(30);
      expect(dq1.promoted).toBe(false);
      expect(dq1.maturity?.meets_small_sample_criteria).toBe(true);
      expect(dq1.maturity?.streak_count).toBe(1);
      expect(dq1.reason).toContain("qualifies for multi-cycle confirmation, 1/3");

      for (; cursor < 125; cursor++) await collection.insertOne(smallSampleObservation(cursor) as unknown as Record<string, unknown>);
      const cycle2 = await runGlobalBrainDailyCycle();
      const dq2 = cycle2.questions.DIRECTION_QUALITY!;
      expect(dq2.promoted).toBe(false);
      expect(dq2.maturity?.streak_count).toBe(2); // accumulated from cycle 1, on genuinely new (larger) data
      expect(dq2.reason).toContain("qualifies for multi-cycle confirmation, 2/3");
      expect(await getCurrentChampion("DIRECTION_QUALITY")).toBeNull(); // still nothing promoted
    });

    it("a streak breaks (resets to 0) when a cycle's holdout no longer shows a qualifying effect, and must restart from 1", async () => {
      const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
      let cursor = 0;
      for (; cursor < 120; cursor++) await collection.insertOne(smallSampleObservation(cursor) as unknown as Record<string, unknown>);
      const cycle1 = await runGlobalBrainDailyCycle();
      expect(cycle1.questions.DIRECTION_QUALITY!.maturity?.streak_count).toBe(1);

      // Add pure noise (no bucket-dependent pattern) -- breaks the effect this cycle.
      for (let i = 0; i < 20; i++, cursor++) {
        const resolvedAt = new Date(Date.UTC(2026, 0, 5, 0, 0, 0) + i * 3_600_000).toISOString();
        const isWin = i % 2 === 0;
        await collection.insertOne({
          dedupe_key: `NOISE:${cursor}`,
          source: "OUTLOOK",
          account_ref: `hash${i % 4}`,
          decision_action: "EXECUTED",
          features: { symbol: "XAUUSD", direction: "BUY", session: "LONDON", regime: "TRENDING", structure_state: "", setup_type: "BREAKOUT", confidence_pct: 70, hive_verdict: null, hive_win_rate: null },
          outcome: { analytics_outcome: isWin ? "WIN" : "LOSS", r_multiple: isWin ? 1.0 : -1.0, mfe_r: isWin ? 1.0 : 0.1, mae_r: isWin ? -0.1 : -1.0, highest_tp_reached: isWin ? 1 : null, time_to_resolution_seconds: 600 },
          mistake_classification: isWin ? "CLEAN_WIN" : "WRONG_DIRECTION",
          counterfactual: null,
          decision_at: resolvedAt,
          resolved_at: resolvedAt,
          source_ref: { collection: "cloud_market_outlooks", id: `noise${cursor}` },
          created_at: resolvedAt,
        } as unknown as Record<string, unknown>);
      }
      const cycle2 = await runGlobalBrainDailyCycle();
      expect(cycle2.questions.DIRECTION_QUALITY!.maturity?.streak_count).toBe(0);
      expect(cycle2.questions.DIRECTION_QUALITY!.promoted).toBe(false);
    });

    it("dataset_fingerprint is NOT purely a function of which observations exist -- a label-schema change on the identical observation set must be able to invalidate an in-progress streak (regression for the historical-relabeling audit)", async () => {
      // A fingerprint computed from dedupe_keys alone would stay identical
      // across a label-computation logic change (e.g. the STOP_BEFORE_MOVE
      // fix), so a streak straddling that change would wrongly treat
      // old-logic and new-logic cycles as "the same evidence" -- silently
      // carrying a partially-invalid streak across a semantics change. This
      // proves the real, live fingerprint differs from the naive
      // dedupe-keys-only hash for the exact same observation set, i.e. a
      // schema-version bump genuinely changes the computed fingerprint (see
      // LABEL_SCHEMA_VERSION / datasetFingerprint in globalBrainTraining.ts).
      const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
      for (let i = 0; i < 120; i++) await collection.insertOne(smallSampleObservation(i) as unknown as Record<string, unknown>);
      await runGlobalBrainDailyCycle();

      const latest = await getLatestModelDoc("DIRECTION_QUALITY");
      expect(latest).not.toBeNull();

      const { createHash } = await import("node:crypto");
      const allDocs = (await collection.find({}).toArray()) as unknown as GlobalBrainObservation[];
      const eligibleDedupeKeys = allDocs
        .filter((o) => o.resolved_at !== null && o.features.direction !== "NONE" && o.features.symbol.startsWith("XAU"))
        .map((o) => o.dedupe_key)
        .sort();
      const naiveFingerprint = createHash("sha256").update(eligibleDedupeKeys.join("|")).digest("hex");

      expect(latest!.dataset_fingerprint).not.toBe(naiveFingerprint);
    });
  });

  describe("simulation: growing observation history at 50 / 100 / 200 / 500 (spec section 16)", () => {
    it("never gets structurally stuck as evidence accumulates -- evidence and holdout both grow, a genuinely strong effect eventually promotes, memory is never lost or reset between checkpoints", async () => {
      const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
      let cursor = 0;
      const checkpoints = [50, 100, 200, 500];
      let everPromoted = false;
      let lastHoldoutN = 0;
      const seenPromotions: number[] = [];

      for (const target of checkpoints) {
        for (; cursor < target; cursor++) await collection.insertOne(makeObservation(cursor) as unknown as Record<string, unknown>);
        const report = await runGlobalBrainDailyCycle();
        expect(report.success).toBe(true);
        expect(report.observations_eligible).toBe(target); // full accumulated history, never a rolling window or partial re-read
        const dq = report.questions.DIRECTION_QUALITY!;

        // Holdout must monotonically grow with accumulated history (chronological split of the FULL set).
        expect(dq.challenger_holdout_metrics.holdout_n).toBeGreaterThanOrEqual(lastHoldoutN);
        lastHoldoutN = dq.challenger_holdout_metrics.holdout_n;

        if (dq.promoted) {
          everPromoted = true;
          seenPromotions.push(target);
        }
      }

      // A genuinely strong, real signal (the seeded 90%-vs-20% bucket split)
      // must eventually clear the bar somewhere in this growth curve -- the
      // system is not structurally incapable of ever promoting.
      expect(everPromoted).toBe(true);
      const champion = await getCurrentChampion("DIRECTION_QUALITY");
      expect(champion).not.toBeNull();

      // Once promoted, later checkpoints' rejected/superseded challengers
      // never erase promotion history -- the full audit trail survives.
      const history = await (await import("./globalBrainRegistry.js")).listPromotionHistory("DIRECTION_QUALITY", 100);
      expect(history.length).toBeGreaterThan(0);
      expect(history.some((h) => h.action === "PROMOTE")).toBe(true);
    });

    it("noise (no real bucket-dependent signal) never promotes, no matter how much history accumulates", async () => {
      const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
      let cursor = 0;
      for (const target of [50, 100, 200, 500]) {
        for (; cursor < target; cursor++) {
          const resolvedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + cursor * 3_600_000).toISOString();
          const isWin = cursor % 2 === 0; // pure coin flip, no bucket-dependent pattern at all
          await collection.insertOne({
            dedupe_key: `PURE_NOISE:${cursor}`,
            source: "OUTLOOK",
            account_ref: `hash${cursor % 4}`,
            decision_action: "EXECUTED",
            features: { symbol: "XAUUSD", direction: "BUY", session: "LONDON", regime: "TRENDING", structure_state: "", setup_type: "BREAKOUT", confidence_pct: 70, hive_verdict: null, hive_win_rate: null },
            outcome: { analytics_outcome: isWin ? "WIN" : "LOSS", r_multiple: isWin ? 1.0 : -1.0, mfe_r: isWin ? 1.0 : 0.1, mae_r: isWin ? -0.1 : -1.0, highest_tp_reached: isWin ? 1 : null, time_to_resolution_seconds: 600 },
            mistake_classification: isWin ? "CLEAN_WIN" : "WRONG_DIRECTION",
            counterfactual: null,
            decision_at: resolvedAt,
            resolved_at: resolvedAt,
            source_ref: { collection: "cloud_market_outlooks", id: `noise${cursor}` },
            created_at: resolvedAt,
          } as unknown as Record<string, unknown>);
        }
        const report = await runGlobalBrainDailyCycle();
        expect(report.questions.DIRECTION_QUALITY!.promoted).toBe(false);
      }
      expect(await getCurrentChampion("DIRECTION_QUALITY")).toBeNull();
    });
  });

  it("never promotes anything and never writes a report in dry-run mode", async () => {
    await seedObservations(1000);
    const report = await runGlobalBrainDailyCycle({ dryRun: true });
    expect(report.dry_run).toBe(true);
    const champion = await getCurrentChampion("DIRECTION_QUALITY");
    expect(champion).toBeNull(); // dry run must not touch the registry
  });

  it("excludes observations with no resolved_at, no direction, or a non-XAU symbol from the eligible set (data-quality filter)", async () => {
    const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
    await collection.insertOne(makeObservation(0, { resolved_at: null }) as unknown as Record<string, unknown>);
    await collection.insertOne(makeObservation(1, { features: { ...makeObservation(1).features, direction: "NONE" } }) as unknown as Record<string, unknown>);
    await collection.insertOne(makeObservation(2, { features: { ...makeObservation(2).features, symbol: "EURUSD" } }) as unknown as Record<string, unknown>);
    const report = await runGlobalBrainDailyCycle();
    expect(report.observations_total).toBe(3);
    expect(report.observations_eligible).toBe(0);
  });

  it("DAILY JOB FAILURE rule: a read failure aborts the cycle, marks it unsuccessful, and never touches an existing champion", async () => {
    await seedObservations(1000);
    await runGlobalBrainDailyCycle(); // establish a real champion first
    const championBefore = await getCurrentChampion("DIRECTION_QUALITY");
    expect(championBefore).not.toBeNull();

    const realCollection = state.db.collection.bind(state.db);
    const brokenDb = {
      collection: (name: string) => {
        if (name === GLOBAL_BRAIN_OBSERVATIONS_COLLECTION) {
          return { find: () => ({ toArray: async () => { throw new Error("simulated Mongo outage"); } }) };
        }
        return realCollection(name);
      },
    };
    const originalDb = state.db;
    state.db = brokenDb as unknown as FakeDb;
    try {
      const report = await runGlobalBrainDailyCycle();
      expect(report.success).toBe(false);
      expect(report.error).toContain("simulated Mongo outage");
    } finally {
      state.db = originalDb;
    }

    const championAfter = await getCurrentChampion("DIRECTION_QUALITY");
    expect(championAfter?.version).toBe(championBefore!.version); // completely untouched
  });

  it("reports mistake counts and observation-by-source breakdown for the daily learning report", async () => {
    await seedObservations(1000);
    const report = await runGlobalBrainDailyCycle();
    expect(report.observations_by_source["OUTLOOK"]).toBe(1000);
    expect(report.mistakes_by_category["CLEAN_WIN"]).toBeGreaterThan(0);
    expect(report.mistakes_by_category["WRONG_DIRECTION"]).toBeGreaterThan(0);
  });

  it("lists the known data gaps honestly rather than silently proceeding as if they don't exist", async () => {
    const report = await runGlobalBrainDailyCycle();
    expect(report.known_gaps.some((g) => g.includes("M10"))).toBe(true);
    expect(report.known_gaps.some((g) => g.includes("tester"))).toBe(true);
  });

  it("detects and records drift when an existing champion's performance meaningfully degrades on fresh data (regime shift)", async () => {
    await seedObservations(1000);
    await runGlobalBrainDailyCycle(); // v1 promoted -- favored bucket wins 90%
    expect(await latestDriftAlert("DIRECTION_QUALITY")).toBeNull(); // nothing to detect drift against yet on the very first cycle

    // Simulate a regime shift: the SAME bucket that used to win 90% of the
    // time now loses 90% of the time in a large batch of brand-new data.
    const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
    for (let i = 1000; i < 1400; i++) {
      const resolvedAt = new Date(Date.UTC(2026, 1, 1, 0, 0, 0) + i * 3_600_000).toISOString();
      const favoredBucket = i % 2 === 0;
      const isWin = favoredBucket ? i % 10 === 0 : i % 5 !== 0; // roles reversed vs. makeObservation
      await collection.insertOne(
        makeObservation(i, {
          dedupe_key: `OBS:${i}`,
          resolved_at: resolvedAt,
          decision_at: resolvedAt,
          outcome: {
            analytics_outcome: isWin ? "WIN" : "LOSS",
            r_multiple: isWin ? 1.0 : -1.0,
            mfe_r: isWin ? 1.0 : 0.1,
            mae_r: isWin ? -0.1 : -1.0,
            highest_tp_reached: isWin ? 1 : null,
            time_to_resolution_seconds: 600,
          },
          mistake_classification: isWin ? "CLEAN_WIN" : "WRONG_DIRECTION",
        }) as unknown as Record<string, unknown>,
      );
    }

    await runGlobalBrainDailyCycle();
    const alert = await latestDriftAlert("DIRECTION_QUALITY");
    expect(alert).not.toBeNull();
    expect(alert!.champion_version).toBe(1);
    expect(alert!.current_metrics.brier_score).toBeGreaterThan(alert!.recorded_metrics.brier_score);
  });
});

describe("checkHoldoutStability", () => {
  const spec: QuestionSpec = {
    bucketKey: () => "A",
    isSuccess: (o) => Boolean((o as unknown as { _win: boolean })._win),
    r: () => null,
    eligible: () => true,
  };
  const challengerBuckets = {
    global_prior_rate: 0.5,
    global_n: 40,
    buckets: [{ bucket_key: "A", n: 40, successes: 30, raw_rate: 0.75, shrunk_rate: 0.9, avg_r: null, sample_sufficient: true }],
  };

  function fakeItem(win: boolean, resolvedAt: string): GlobalBrainObservation {
    return { _win: win, resolved_at: resolvedAt } as unknown as GlobalBrainObservation;
  }

  it("passes when the challenger is consistently at least as good as the baseline in every sub-window", () => {
    const window1 = Array.from({ length: 20 }, (_, i) => fakeItem(true, `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`));
    const window2 = Array.from({ length: 20 }, (_, i) => fakeItem(true, `2026-01-01T01:${String(i).padStart(2, "0")}:00.000Z`));
    const result = checkHoldoutStability(challengerBuckets, null, [...window1, ...window2], spec, 0.5);
    expect(result.stable).toBe(true);
  });

  it("rejects an aggregate-looking improvement that is actually carried entirely by one sub-window (closes the single-period-overfitting gap the spec calls out)", () => {
    // Window 1: challenger (predicts 0.9) is excellent -- everything wins.
    const window1 = Array.from({ length: 20 }, (_, i) => fakeItem(true, `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`));
    // Window 2: challenger is meaningfully worse than a 0.5 baseline would have been (mixed results against a confident 0.9 prediction).
    const window2 = Array.from({ length: 20 }, (_, i) => fakeItem(i % 2 === 0, `2026-01-01T01:${String(i).padStart(2, "0")}:00.000Z`));
    const allItems = [...window1, ...window2];

    // Confirm the premise: in AGGREGATE this looks like a clear improvement over baseline.
    const aggregate = evaluateOnHoldout(challengerBuckets, allItems, spec);
    const baselineAggregate = evaluateBaselineOnHoldout(0.5, allItems, spec);
    expect(aggregate.brier_score).toBeLessThan(baselineAggregate.brier_score);

    const result = checkHoldoutStability(challengerBuckets, null, allItems, spec, 0.5);
    expect(result.stable).toBe(false);
    expect(result.reason).toContain("unstable across time windows");
  });

  it("skips the check gracefully when the holdout is too small to split into two meaningful sub-windows", () => {
    const tiny = Array.from({ length: 10 }, (_, i) => fakeItem(true, `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`));
    const result = checkHoldoutStability(challengerBuckets, null, tiny, spec, 0.5);
    expect(result.stable).toBe(true);
    expect(result.reason).toContain("too small");
  });
});

describe("Global Brain kill switches", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("auto_training_enabled=false: the cycle reports success with training_disabled=true and touches nothing else", async () => {
    const { updateGlobalBrainSettings } = await import("./globalBrainSettings.js");
    await seedObservations(1000);
    await updateGlobalBrainSettings({ auto_training_enabled: false }, "admin@xaucloud.io");
    const report = await runGlobalBrainDailyCycle();
    expect(report.success).toBe(true);
    expect(report.training_disabled).toBe(true);
    expect(report.observations_eligible).toBe(0);
    expect(await getCurrentChampion("DIRECTION_QUALITY")).toBeNull();
  });

  it("auto_promotion_enabled=false: the challenger is still trained and reported, but never promoted", async () => {
    const { updateGlobalBrainSettings } = await import("./globalBrainSettings.js");
    await updateGlobalBrainSettings({ auto_promotion_enabled: false }, "admin@xaucloud.io");
    await seedObservations(1000);
    const report = await runGlobalBrainDailyCycle();
    const dq = report.questions.DIRECTION_QUALITY!;
    expect(dq.promoted).toBe(false);
    expect(dq.reason).toContain("NOT APPLIED: auto_promotion_enabled is OFF");
    expect(dq.challenger_holdout_metrics.holdout_n).toBeGreaterThan(0); // still genuinely trained and scored
    expect(await getCurrentChampion("DIRECTION_QUALITY")).toBeNull();
  });

  it("re-enabling auto_promotion_enabled after a disabled run lets the next cycle promote normally", async () => {
    const { updateGlobalBrainSettings } = await import("./globalBrainSettings.js");
    await updateGlobalBrainSettings({ auto_promotion_enabled: false }, "admin@xaucloud.io");
    await seedObservations(1000);
    await runGlobalBrainDailyCycle(); // withheld
    await updateGlobalBrainSettings({ auto_promotion_enabled: true }, "admin@xaucloud.io");
    // Same dataset -- the fingerprint short-circuit only fires once a
    // champion exists; since nothing was promoted yet, this is still a
    // genuine "first model" evaluation.
    const report = await runGlobalBrainDailyCycle();
    expect(report.questions.DIRECTION_QUALITY!.promoted).toBe(true);
    expect(await getCurrentChampion("DIRECTION_QUALITY")).not.toBeNull();
  });
});

describe("checkOverfiltering", () => {
  const spec: QuestionSpec = {
    bucketKey: (o) => (o as unknown as { _bucket: string })._bucket,
    isSuccess: (o) => Boolean((o as unknown as { _win: boolean })._win),
    r: (o) => (o as unknown as { _r: number | null })._r,
    eligible: () => true,
  };

  function item(bucket: string, win: boolean, r: number | null, i: number): GlobalBrainObservation {
    return { _bucket: bucket, _win: win, _r: r, resolved_at: `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z` } as unknown as GlobalBrainObservation;
  }

  // Challenger only favors bucket "A" (0.8); comparison favors BOTH "A" (0.7) and "B" (0.6) --
  // so challenger participates less by however many items are in bucket "B".
  const challengerBuckets = {
    global_prior_rate: 0.5,
    global_n: 40,
    buckets: [
      { bucket_key: "A", n: 20, successes: 16, raw_rate: 0.8, shrunk_rate: 0.8, avg_r: null, sample_sufficient: true },
      { bucket_key: "B", n: 20, successes: 6, raw_rate: 0.3, shrunk_rate: 0.3, avg_r: null, sample_sufficient: true },
    ],
  };
  const comparisonBuckets = {
    global_prior_rate: 0.5,
    global_n: 40,
    buckets: [
      { bucket_key: "A", n: 20, successes: 14, raw_rate: 0.7, shrunk_rate: 0.7, avg_r: null, sample_sufficient: true },
      { bucket_key: "B", n: 20, successes: 12, raw_rate: 0.6, shrunk_rate: 0.6, avg_r: null, sample_sufficient: true },
    ],
  };

  it("does not flag risk when participation barely changes", () => {
    // Only 1 of 20 "B" items excluded (a small, mostly-matching population) --
    // small enough to fall under the material-drop threshold.
    const items = [
      ...Array.from({ length: 19 }, (_, i) => item("A", true, 1.0, i)),
      item("B", true, 1.0, 19), // just one B item, participation drop is tiny
    ];
    const result = checkOverfiltering(challengerBuckets, comparisonBuckets, items, spec, 0.5);
    expect(result.overfiltering_risk).toBe(false);
  });

  it("does NOT flag risk when the excluded opportunities were genuinely poor with enough sample to be statistically confident (justified filtering)", () => {
    const items = [
      ...Array.from({ length: 20 }, (_, i) => item("A", true, 1.0, i)),
      ...Array.from({ length: 20 }, (_, i) => item("B", false, -1.0, 20 + i)), // excluded bucket loses consistently, n=20 >= min sample
    ];
    const result = checkOverfiltering(challengerBuckets, comparisonBuckets, items, spec, 0.5);
    expect(result.overfiltering_risk).toBe(false);
    expect(result.excluded_opportunities_avg_r).toBeLessThanOrEqual(0);
    expect(result.reason).toContain("justified filtering");
  });

  it("FLAGS risk (does not assume justified) when too few excluded opportunities exist to judge confidently, even if their raw average looks bad", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => item("A", true, 1.0, i)),
      ...Array.from({ length: 5 }, (_, i) => item("B", false, -1.0, 10 + i)), // only 5 excluded -- below the minimum sample
    ];
    const result = checkOverfiltering(challengerBuckets, comparisonBuckets, items, spec, 0.5);
    expect(result.overfiltering_risk).toBe(true);
    expect(result.reason).toContain("too few");
  });

  it("is one-sided: a challenger favoring MORE opportunities than the comparison model is never flagged, even with no evidence about the newly-included items (the brain must be free to discover good opportunities the rules currently reject)", () => {
    // Reverse of the fixtures above: the CHALLENGER now favors both buckets
    // while the comparison only favored "A" -- i.e. the challenger wants to
    // trade a bucket ("B") the existing model rejected.
    const expandedChallengerBuckets = {
      global_prior_rate: 0.5,
      global_n: 40,
      buckets: [
        { bucket_key: "A", n: 20, successes: 14, raw_rate: 0.7, shrunk_rate: 0.7, avg_r: null, sample_sufficient: true },
        { bucket_key: "B", n: 20, successes: 12, raw_rate: 0.6, shrunk_rate: 0.6, avg_r: null, sample_sufficient: true },
      ],
    };
    const restrictedComparisonBuckets = {
      global_prior_rate: 0.5,
      global_n: 40,
      buckets: [
        { bucket_key: "A", n: 20, successes: 16, raw_rate: 0.8, shrunk_rate: 0.8, avg_r: null, sample_sufficient: true },
        { bucket_key: "B", n: 20, successes: 6, raw_rate: 0.3, shrunk_rate: 0.3, avg_r: null, sample_sufficient: true },
      ],
    };
    const items = [
      ...Array.from({ length: 10 }, (_, i) => item("A", true, 1.0, i)),
      ...Array.from({ length: 10 }, (_, i) => item("B", false, -1.0, 10 + i)), // even if the newly-favored bucket looks bad in this sample
    ];
    const result = checkOverfiltering(expandedChallengerBuckets, restrictedComparisonBuckets, items, spec, 0.5);
    expect(result.overfiltering_risk).toBe(false);
    expect(result.challenger_participation_rate).toBeGreaterThan(result.comparison_participation_rate);
  });

  it("FLAGS OVERFILTERING_RISK when the excluded opportunities were actually fine (unjustified filtering)", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => item("A", true, 1.0, i)),
      ...Array.from({ length: 10 }, (_, i) => item("B", true, 1.2, 10 + i)), // excluded bucket was actually profitable
    ];
    const result = checkOverfiltering(challengerBuckets, comparisonBuckets, items, spec, 0.5);
    expect(result.overfiltering_risk).toBe(true);
    expect(result.reason).toContain("OVERFILTERING_RISK");
    expect(result.excluded_opportunities_avg_r).toBeGreaterThan(0);
  });

  it("reports accurate participation rates and excluded-opportunity counts", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => item("A", true, 1.0, i)),
      ...Array.from({ length: 10 }, (_, i) => item("B", true, 1.2, 10 + i)),
    ];
    const result = checkOverfiltering(challengerBuckets, comparisonBuckets, items, spec, 0.5);
    expect(result.challenger_participation_rate).toBeCloseTo(0.5, 5); // only bucket A (10/20)
    expect(result.comparison_participation_rate).toBeCloseTo(1.0, 5); // both buckets (20/20)
    expect(result.excluded_opportunities_n).toBe(10);
  });
});

describe("Anti-overfiltering wired into the promotion decision (integration)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("wires checkOverfiltering into every real daily-cycle run and does not false-flag a challenger when every bucket it trains on genuinely performs well", async () => {
    const collection = state.db.collection(GLOBAL_BRAIN_OBSERVATIONS_COLLECTION);
    let i = 0;
    const insert = async (obs: Partial<GlobalBrainObservation>) => {
      const resolvedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 3_600_000).toISOString();
      await collection.insertOne({
        dedupe_key: `OVF:${i}`,
        source: "OUTLOOK",
        account_ref: "hash1",
        decision_action: "EXECUTED",
        decision_at: resolvedAt,
        resolved_at: resolvedAt,
        source_ref: { collection: "cloud_market_outlooks", id: `id${i}` },
        created_at: resolvedAt,
        counterfactual: null,
        mistake_classification: "CLEAN_WIN",
        ...obs,
      } as unknown as Record<string, unknown>);
      i++;
    };

    // Bucket "BUY|LONDON|TRENDING|BREAKOUT" (favored): wins consistently, real signal.
    // Bucket "BUY|TOKYO|RANGE|REVERSAL" (the "excluded" bucket): ALSO wins
    // consistently and profitably -- there is no genuine reason to reject it,
    // so any challenger that stops favoring it is overfiltering, not learning.
    for (let k = 0; k < 500; k++) {
      await insert({
        features: { symbol: "XAUUSD", direction: "BUY", session: "LONDON", regime: "TRENDING", structure_state: "", setup_type: "BREAKOUT", confidence_pct: 70, hive_verdict: null, hive_win_rate: null },
        outcome: { analytics_outcome: "WIN", r_multiple: 1.0, mfe_r: 1.0, mae_r: -0.1, highest_tp_reached: 1, time_to_resolution_seconds: 600 },
      });
      await insert({
        features: { symbol: "XAUUSD", direction: "BUY", session: "TOKYO", regime: "RANGE", structure_state: "", setup_type: "REVERSAL", confidence_pct: 70, hive_verdict: null, hive_win_rate: null },
        outcome: { analytics_outcome: "WIN", r_multiple: 1.1, mfe_r: 1.1, mae_r: -0.1, highest_tp_reached: 1, time_to_resolution_seconds: 600 },
      });
    }

    const report = await runGlobalBrainDailyCycle();
    const dq = report.questions.DIRECTION_QUALITY!;
    // Both buckets are genuinely good (win consistently) -- a correctly-behaving
    // estimator should favor both, so no overfiltering risk should exist here,
    // and IF it promotes, it must be for real signal, not filtering.
    expect(dq.overfiltering).not.toBeNull();
    expect(dq.overfiltering!.overfiltering_risk).toBe(false);
  });
});

describe("24h cycle locking / idempotency (spec: no duplicate concurrent execution)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.db.uniqueIndexes["global_brain_cycle_lock"] = ["_id"];
  });

  it("skips a cycle that starts while another is already in flight, without touching any real state", async () => {
    await seedObservations(1000);
    // Simulate an in-flight cycle by holding the lock ourselves.
    await state.db.collection("global_brain_cycle_lock").insertOne({ _id: "cycle", acquired_at: Date.now() });
    const report = await runGlobalBrainDailyCycle();
    expect(report.success).toBe(true);
    expect(report.cycle_already_running).toBe(true);
    expect(report.observations_eligible).toBe(0); // did no real work
    expect(await getCurrentChampion("DIRECTION_QUALITY")).toBeNull(); // touched nothing
  });

  it("releases the lock after a successful run so the next real run proceeds normally", async () => {
    await seedObservations(1000);
    const first = await runGlobalBrainDailyCycle();
    expect(first.cycle_already_running).toBe(false);
    // A second call right after must not be blocked by a leftover lock.
    const second = await runGlobalBrainDailyCycle();
    expect(second.cycle_already_running).toBe(false);
  });

  it("releases the lock even after the cycle FAILS, so a duplicate/retry execution is never permanently blocked", async () => {
    const realCollection = state.db.collection.bind(state.db);
    const brokenDb = {
      collection: (name: string) => {
        if (name === GLOBAL_BRAIN_OBSERVATIONS_COLLECTION) return { find: () => ({ toArray: async () => { throw new Error("simulated failure"); } }) };
        return realCollection(name);
      },
    };
    const originalDb = state.db;
    state.db = brokenDb as unknown as FakeDb;
    const failed = await runGlobalBrainDailyCycle();
    expect(failed.success).toBe(false);
    state.db = originalDb;

    await seedObservations(1000);
    const retried = await runGlobalBrainDailyCycle();
    expect(retried.cycle_already_running).toBe(false);
    expect(retried.success).toBe(true);
  });

  it("does not block a new run if the previous lock is stale (crashed process recovery)", async () => {
    await seedObservations(1000);
    const staleAcquiredAt = Date.now() - 11 * 60_000; // older than the 10-minute staleness window
    await state.db.collection("global_brain_cycle_lock").insertOne({ _id: "cycle", acquired_at: staleAcquiredAt });
    const report = await runGlobalBrainDailyCycle();
    expect(report.cycle_already_running).toBe(false);
    expect(report.success).toBe(true);
  });

  it("a dry run is also serialized against a concurrent real run (no exception carved out)", async () => {
    await state.db.collection("global_brain_cycle_lock").insertOne({ _id: "cycle", acquired_at: Date.now() });
    const report = await runGlobalBrainDailyCycle({ dryRun: true });
    expect(report.cycle_already_running).toBe(true);
  });

  it("releaseCycleLock only deletes the exact lock it acquired, never a different holder's newer lock (closes the race an adversarial review found)", async () => {
    // Holder A acquires the lock long enough ago to be stale...
    const holderAAcquiredAt = await acquireCycleLock();
    // ...then Holder B legitimately reclaims it as stale (simulated directly,
    // since acquireCycleLock's own staleness check requires real elapsed time).
    await state.db.collection("global_brain_cycle_lock").deleteOne({ _id: "cycle" });
    const holderBAcquiredAt = await acquireCycleLock();
    expect(holderBAcquiredAt).not.toBe(holderAAcquiredAt);

    // Holder A's delayed cleanup must NOT delete Holder B's live lock.
    await releaseCycleLock(holderAAcquiredAt);
    const stillLocked = state.db.collection("global_brain_cycle_lock").docs.find((d) => d["_id"] === "cycle");
    expect(stillLocked).toBeDefined();
    expect(stillLocked!["holder_id"]).toBe(holderBAcquiredAt);

    // Holder B's own release correctly clears it.
    await releaseCycleLock(holderBAcquiredAt);
    expect(state.db.collection("global_brain_cycle_lock").docs.find((d) => d["_id"] === "cycle")).toBeUndefined();
  });
});

describe("checkAccountDiversity", () => {
  it("blocks promotion evidence dominated by one account, while accepting balanced hashed-account evidence", () => {
    const oneAccount = [makeObservation(1), makeObservation(2)].map((o) => ({ ...o, account_ref: "one" }));
    const concentrated = checkAccountDiversity(oneAccount, oneAccount);
    expect(concentrated.account_concentration_risk).toBe(true);
    expect(concentrated.reason).toContain("ACCOUNT_CONCENTRATION_RISK");

    const balanced = checkAccountDiversity(
      [makeObservation(1), makeObservation(2), makeObservation(3), makeObservation(4)],
      [makeObservation(5), makeObservation(6), makeObservation(7), makeObservation(8)],
    );
    expect(balanced.account_concentration_risk).toBe(false);
  });
});

describe("computeOpportunityCapture (positive-opportunity reporting)", () => {
  function obs(decision_action: "EXECUTED" | "SKIPPED" | "EXPIRED" | "CANDIDATE", mistake: string | null): GlobalBrainObservation {
    return { decision_action, mistake_classification: mistake } as unknown as GlobalBrainObservation;
  }

  it("reports null rates (never zero) when there is no resolvable evidence at all", () => {
    const summary = computeOpportunityCapture([]);
    expect(summary.false_rejection_rate).toBeNull();
    expect(summary.opportunity_capture_rate).toBeNull();
    expect(summary.missed_winner_count).toBe(0);
  });

  it("computes false_rejection_rate from resolvable MISSED_WINNER vs GOOD_REJECTION counts only", () => {
    const observations = [
      obs("SKIPPED", "MISSED_WINNER"),
      obs("SKIPPED", "MISSED_WINNER"),
      obs("SKIPPED", "GOOD_REJECTION"),
      obs("EXPIRED", "UNCLASSIFIED"), // not resolvable -- excluded from the rate's denominator
    ];
    const summary = computeOpportunityCapture(observations);
    expect(summary.missed_winner_count).toBe(2);
    expect(summary.good_rejection_count).toBe(1);
    expect(summary.non_executed_with_resolvable_outcome).toBe(3);
    expect(summary.false_rejection_rate).toBeCloseTo(2 / 3, 2);
  });

  it("computes opportunity_capture_rate as executed / (executed + skipped + expired)", () => {
    const observations = [obs("EXECUTED", null), obs("EXECUTED", null), obs("EXECUTED", null), obs("SKIPPED", null), obs("CANDIDATE", null)];
    const summary = computeOpportunityCapture(observations);
    // CANDIDATE (still pending) is excluded from both numerator and denominator.
    expect(summary.opportunity_capture_rate).toBeCloseTo(3 / 4, 5);
  });

  it("tracks WAIT_IMPROVED_ENTRY / WAIT_HURT_ENTRY counts symmetrically -- waiting is not assumed good or bad", () => {
    const observations = [obs("EXECUTED", "WAIT_IMPROVED_ENTRY"), obs("EXECUTED", "WAIT_IMPROVED_ENTRY"), obs("EXECUTED", "WAIT_HURT_ENTRY")];
    const summary = computeOpportunityCapture(observations);
    expect(summary.wait_improved_entry_count).toBe(2);
    expect(summary.wait_hurt_entry_count).toBe(1);
  });
});
