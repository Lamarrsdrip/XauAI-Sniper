import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { effectiveEntitlement, requireCapability } = await import("./entitlements.js");
const { computeTrialExpiry } = await import("./signalTrial.js");

function futureIso(ms: number): string { return new Date(Date.now() + ms).toISOString(); }
function pastIso(ms: number): string { return new Date(Date.now() - ms).toISOString(); }

describe("effectiveEntitlement (centralized authorization)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("a brand-new user with no grants has no access at all", async () => {
    const e = await effectiveEntitlement({ id: "u1", email: "new@example.com" });
    expect(e.signals_access).toBe(false);
    expect(e.bot_license).toBe(false);
    expect(e.source).toBe("none");
  });

  it("an active trial grants signals but never bot capabilities", async () => {
    const started = new Date();
    await state.db.collection("signal_trials").insertOne({
      id: "t1", user_id: "u2", trial_started_at: started.toISOString(),
      trial_expires_at: computeTrialExpiry(started).toISOString(),
      market_days_consumed: 1, status: "ACTIVE", created_at: started.toISOString(),
    });
    const e = await effectiveEntitlement({ id: "u2", email: "trial@example.com" });
    expect(e.signals_access).toBe(true);
    expect(e.outlook_access).toBe(true);
    expect(e.engine_10m_access).toBe(true);
    expect(e.bot_license).toBe(false);
    expect(e.bot_operations).toBe(false);
    expect(e.automation_access).toBe(false);
    expect(e.source).toBe("trial");
  });

  it("an expired trial with no other grant loses signal access", async () => {
    await state.db.collection("signal_trials").insertOne({
      id: "t2", user_id: "u3", trial_started_at: pastIso(20 * 86_400_000),
      trial_expires_at: pastIso(15 * 86_400_000),
      market_days_consumed: 3, status: "ACTIVE", created_at: pastIso(20 * 86_400_000),
    });
    const e = await effectiveEntitlement({ id: "u3", email: "expired@example.com" });
    expect(e.signals_access).toBe(false);
    expect(e.source).toBe("none");
  });

  it("an active weekly subscription grants signals but never bot capabilities", async () => {
    await state.db.collection("signal_subscriptions").insertOne({
      id: "s1", user_id: "u4", plan: "WEEKLY", status: "ACTIVE",
      activated_at: new Date().toISOString(), expires_at: futureIso(5 * 86_400_000), source_payment_ref: "ref-1",
    });
    const e = await effectiveEntitlement({ id: "u4", email: "sub@example.com" });
    expect(e.signals_access).toBe(true);
    expect(e.bot_license).toBe(false);
    expect(e.source).toBe("subscription");
  });

  it("a lifetime license grants full access regardless of trial/subscription state", async () => {
    await state.db.collection("pin_licenses").insertOne({ pin: "ASE-AAAA-BBBB", buyer_email: "lifetime@example.com", is_active: true });
    const e = await effectiveEntitlement({ id: "u5", email: "lifetime@example.com" });
    expect(e.signals_access).toBe(true);
    expect(e.bot_license).toBe(true);
    expect(e.bot_operations).toBe(true);
    expect(e.bot_activity).toBe(true);
    expect(e.performance_access).toBe(true);
    expect(e.automation_access).toBe(true);
    expect(e.source).toBe("lifetime");
  });

  it("a lifetime licensed customer is NEVER downgraded by an expired signal subscription -- boolean OR across grants", async () => {
    await state.db.collection("pin_licenses").insertOne({ pin: "ASE-CCCC-DDDD", buyer_email: "both@example.com", is_active: true });
    await state.db.collection("signal_subscriptions").insertOne({
      id: "s2", user_id: "u6", plan: "MONTHLY", status: "ACTIVE",
      activated_at: pastIso(40 * 86_400_000), expires_at: pastIso(10 * 86_400_000), source_payment_ref: "ref-2",
    });
    const e = await effectiveEntitlement({ id: "u6", email: "both@example.com" });
    expect(e.bot_license).toBe(true);
    expect(e.signals_access).toBe(true); // still true, via the lifetime grant, not the expired subscription
    expect(e.source).toBe("lifetime");
  });

  it("requireCapability throws 403 for a missing capability and passes silently when granted", async () => {
    const denied = await effectiveEntitlement({ id: "u7", email: "none@example.com" });
    expect(() => requireCapability(denied, "signals_access")).toThrow();
    try {
      requireCapability(denied, "signals_access");
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(403);
    }

    await state.db.collection("pin_licenses").insertOne({ pin: "ASE-EEEE-FFFF", buyer_email: "granted@example.com", is_active: true });
    const granted = await effectiveEntitlement({ id: "u8", email: "granted@example.com" });
    expect(() => requireCapability(granted, "bot_operations")).not.toThrow();
  });
});
