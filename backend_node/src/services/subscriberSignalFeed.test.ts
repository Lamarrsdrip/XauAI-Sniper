import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, notifyCalls: [] as Record<string, unknown>[] }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("./notifications.js", () => ({
  sendSubscriberSignalNotification: vi.fn(async (signal: Record<string, unknown>) => { state.notifyCalls.push(signal); return 1; }),
}));

const { mirrorSubscriberSignal, isConfiguredSubscriberSource, subscriberSourceHealth, outlookDocAsSubscriberSignal, mirrorSubscriberM10Evaluation } = await import("./subscriberSignalFeed.js");

function baseSignal(overrides: Record<string, unknown> = {}) {
  return {
    signal_id: "sig-1", engine: "OUTLOOK" as const, symbol: "XAUUSD", direction: "BUY", status: "ACTIONABLE" as const,
    confidence: 70, entry: 2400, stop: 2390, tp1: 2410, tp2: 2420, tp3: 2430, rationale: null,
    effective_at: new Date().toISOString(), expires_at: null, isNewActionable: true,
    ...overrides,
  };
}

describe("subscriber signal mirror -- source-account gate", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.notifyCalls = [];
  });

  it("does nothing when no source account is configured", async () => {
    const configured = await isConfiguredSubscriberSource("999");
    expect(configured).toBe(false);
    await mirrorSubscriberSignal("999", baseSignal());
    expect(state.db.collection("subscriber_signals").docs).toHaveLength(0);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("mirrors only the configured source account -- every other account is untouched", async () => {
    await state.db.collection("admin_settings").insertOne({ key: "main", subscriber_signal_source_account: "SOURCE-ACC" });

    await mirrorSubscriberSignal("SOME-OTHER-LICENSED-ACCOUNT", baseSignal({ signal_id: "sig-other" }));
    expect(state.db.collection("subscriber_signals").docs).toHaveLength(0);

    await mirrorSubscriberSignal("SOURCE-ACC", baseSignal({ signal_id: "sig-mine" }));
    expect(state.db.collection("subscriber_signals").docs).toHaveLength(1);
    expect(state.db.collection("subscriber_signals").docs[0]!["signal_id"]).toBe("sig-mine");
  });

  it("mirroring the same signal_id twice upserts, never duplicates", async () => {
    await state.db.collection("admin_settings").insertOne({ key: "main", subscriber_signal_source_account: "SOURCE-ACC" });
    await mirrorSubscriberSignal("SOURCE-ACC", baseSignal({ signal_id: "sig-dup", status: "WATCHING", isNewActionable: false }));
    await mirrorSubscriberSignal("SOURCE-ACC", baseSignal({ signal_id: "sig-dup", status: "ACTIONABLE", isNewActionable: true }));
    const rows = state.db.collection("subscriber_signals").docs;
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("ACTIONABLE");
  });

  it("notifies only for a genuinely new actionable signal, never for a WATCHING/BLOCKED update", async () => {
    await state.db.collection("admin_settings").insertOne({ key: "main", subscriber_signal_source_account: "SOURCE-ACC" });
    await mirrorSubscriberSignal("SOURCE-ACC", baseSignal({ signal_id: "sig-watch", status: "WATCHING", isNewActionable: false }));
    expect(state.notifyCalls).toHaveLength(0);
    await mirrorSubscriberSignal("SOURCE-ACC", baseSignal({ signal_id: "sig-go", status: "ACTIONABLE", isNewActionable: true }));
    expect(state.notifyCalls).toHaveLength(1);
    expect(state.notifyCalls[0]!["signal_id"]).toBe("sig-go");
  });

  it("never exposes account-identifying fields in the stored subscriber signal", async () => {
    await state.db.collection("admin_settings").insertOne({ key: "main", subscriber_signal_source_account: "SOURCE-ACC" });
    await mirrorSubscriberSignal("SOURCE-ACC", baseSignal());
    const stored = state.db.collection("subscriber_signals").docs[0]!;
    expect(stored).not.toHaveProperty("account");
    expect(stored).not.toHaveProperty("license_key");
    expect(stored).not.toHaveProperty("mt5_account");
  });
});

describe("subscriberSourceHealth", () => {
  beforeEach(() => { state.db = new FakeDb(); });

  it("reports not configured when no source account is set", async () => {
    const health = await subscriberSourceHealth();
    expect(health.configured).toBe(false);
  });

  it("reports online when the source account has a fresh heartbeat", async () => {
    await state.db.collection("admin_settings").insertOne({ key: "main", subscriber_signal_source_account: "SRC1" });
    await state.db.collection("cloud_bot_heartbeats").insertOne({ account_number: "SRC1", ts: new Date().toISOString() });
    const health = await subscriberSourceHealth();
    expect(health.online).toBe(true);
    expect(health.account).toBe("SRC1");
  });

  it("reports offline (never fabricates) when the heartbeat is stale, with no working backup", async () => {
    await state.db.collection("admin_settings").insertOne({ key: "main", subscriber_signal_source_account: "SRC1" });
    await state.db.collection("cloud_bot_heartbeats").insertOne({ account_number: "SRC1", ts: new Date(Date.now() - 10 * 60_000).toISOString() });
    const health = await subscriberSourceHealth();
    expect(health.online).toBe(false);
  });

  it("fails over to a configured backup account when the primary is stale", async () => {
    await state.db.collection("admin_settings").insertOne({
      key: "main", subscriber_signal_source_account: "SRC1", subscriber_signal_backup_source_account: "SRC2",
    });
    await state.db.collection("cloud_bot_heartbeats").insertOne({ account_number: "SRC1", ts: new Date(Date.now() - 10 * 60_000).toISOString() });
    await state.db.collection("cloud_bot_heartbeats").insertOne({ account_number: "SRC2", ts: new Date().toISOString() });
    const health = await subscriberSourceHealth();
    expect(health.online).toBe(true);
    expect(health.account).toBe("SRC2");
  });
});

describe("mirrorSubscriberM10Evaluation -- continuous freshness (2026-08-25 fix)", () => {
  beforeEach(async () => {
    state.db = new FakeDb();
    state.notifyCalls = [];
    await state.db.collection("admin_settings").insertOne({ key: "main", subscriber_signal_source_account: "SOURCE-ACC" });
  });

  const watching = (overrides: Record<string, unknown> = {}) => ({
    decision: "WAIT_FOR_BUY_RETRACE", preferred_direction: "BUY", freshness_state: "FRESH",
    buy_case_score: 62, sell_case_score: 18, confidence: 62, reason: "Buy evidence forming, pullback not confirmed.",
    trend_state: "UP", structure_state: "HH_HL", location_state: "MID_RANGE", exhaustion_decision: "NONE",
    evidence_id: 101, bar_time: "2026.08.25 21:00",
    ...overrides,
  });

  it("is a no-op for every account except the configured subscriber source", async () => {
    await mirrorSubscriberM10Evaluation("SOME-OTHER-ACCOUNT", watching(), new Date().toISOString());
    expect(state.db.collection("subscriber_signals").docs).toHaveLength(0);
  });

  it("creates the current-state doc on the first evaluation", async () => {
    await mirrorSubscriberM10Evaluation("SOURCE-ACC", watching(), new Date().toISOString());
    const rows = state.db.collection("subscriber_signals").docs;
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("WATCHING");
    expect(rows[0]!["buy_evidence"]).toBe(62);
    expect(rows[0]!["decision"]).toBe("WAIT_FOR_BUY_RETRACE");
    expect(rows[0]!["last_evaluated_at"]).toBeTruthy();
  });

  it("a repeated same-state evaluation refreshes the SAME doc in place -- no duplicate Recent Signals rows", async () => {
    await mirrorSubscriberM10Evaluation("SOURCE-ACC", watching({ evidence_id: 101, buy_case_score: 60 }), new Date().toISOString());
    const firstCreatedAt = state.db.collection("subscriber_signals").docs[0]!["created_at"];

    await mirrorSubscriberM10Evaluation("SOURCE-ACC", watching({ evidence_id: 102, buy_case_score: 71 }), new Date().toISOString());
    const rows = state.db.collection("subscriber_signals").docs;
    expect(rows).toHaveLength(1); // still one doc, not two
    expect(rows[0]!["buy_evidence"]).toBe(71); // evidence refreshed
    expect(rows[0]!["created_at"]).toBe(firstCreatedAt); // last-state-change timestamp untouched
  });

  it("never sends a notification -- notification ownership stays with mirrorSubscriberSignal's candidate-gated path", async () => {
    await mirrorSubscriberM10Evaluation("SOURCE-ACC", watching(), new Date().toISOString());
    await mirrorSubscriberM10Evaluation("SOURCE-ACC", { ...watching(), decision: "BUY_CANDIDATE" }, new Date().toISOString());
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("a genuine status/direction transition (a new evidence_id going actionable) creates a new doc, correctly surfacing as a distinct Recent Signals entry", async () => {
    await mirrorSubscriberM10Evaluation("SOURCE-ACC", watching({ evidence_id: 101 }), new Date().toISOString());
    await mirrorSubscriberM10Evaluation("SOURCE-ACC", { ...watching({ evidence_id: 102 }), decision: "BUY_CANDIDATE" }, new Date().toISOString());
    const rows = state.db.collection("subscriber_signals").docs;
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r["status"] === "ACTIONABLE")).toBe(true);
  });
});

describe("outlookDocAsSubscriberSignal", () => {
  it("maps an Outlook doc without leaking account-identifying fields", () => {
    const doc = { id: "out-1", symbol: "XAUUSDm", account: "476396807", license_key: "ASE-XXXX", primary_direction: "BUY", confidence_pct: 55, tracking_entry_price: 2400, suggested_sl: 2390, tp1_price: 2410 };
    const mapped = outlookDocAsSubscriberSignal(doc, "OUTLOOK", true);
    expect(mapped.signal_id).toBe("out-1");
    expect(mapped.status).toBe("ACTIONABLE");
    expect(mapped).not.toHaveProperty("account");
    expect(mapped).not.toHaveProperty("license_key");
  });
});
