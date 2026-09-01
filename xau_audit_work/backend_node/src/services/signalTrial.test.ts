import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { startTrial, trialStatus, computeTrialExpiry, TRIAL_MARKET_DAY_LIMIT } = await import("./signalTrial.js");

describe("signal trial (server-side, once-per-account)", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.db.uniqueIndexes["signal_trials"] = ["user_id"];
  });

  it("starts a trial and records trial_started_at + a deterministic trial_expires_at", async () => {
    const row = await startTrial("user-1");
    expect(row.user_id).toBe("user-1");
    expect(row.status).toBe("ACTIVE");
    expect(new Date(row.trial_expires_at).getTime()).toBeGreaterThan(new Date(row.trial_started_at).getTime());
  });

  it("is granted only once per account -- a second start returns the SAME row, never a new one", async () => {
    const first = await startTrial("user-2");
    const second = await startTrial("user-2");
    expect(second.id).toBe(first.id);
    expect(second.trial_started_at).toBe(first.trial_started_at);
    expect(state.db.collection("signal_trials").docs).toHaveLength(1);
  });

  it("a user with no trial row has no trial status", async () => {
    expect(await trialStatus("nobody")).toBeNull();
  });

  it("stays ACTIVE through the 3rd market day and flips EXPIRED on the 4th", async () => {
    // Monday start (2024-01-01) -> active through Wed 2024-01-03, expired by Thu 2024-01-04.
    const started = new Date("2024-01-01T09:00:00Z");
    await state.db.collection("signal_trials").insertOne({
      id: "t1", user_id: "user-3", trial_started_at: started.toISOString(),
      trial_expires_at: computeTrialExpiry(started).toISOString(),
      market_days_consumed: 1, status: "ACTIVE", created_at: started.toISOString(),
    });

    const vi_now = vi.useFakeTimers();
    try {
      vi_now.setSystemTime(new Date("2024-01-03T10:00:00Z"));
      const day3 = await trialStatus("user-3");
      expect(day3?.status).toBe("ACTIVE");
      expect(day3?.market_days_consumed).toBe(TRIAL_MARKET_DAY_LIMIT);

      vi_now.setSystemTime(new Date("2024-01-04T10:00:00Z"));
      const day4 = await trialStatus("user-3");
      expect(day4?.status).toBe("EXPIRED");
      expect(day4?.days_remaining).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
