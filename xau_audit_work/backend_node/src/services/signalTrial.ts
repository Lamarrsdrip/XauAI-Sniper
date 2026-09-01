import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { isMarketOpen, marketDaysElapsed } from "./marketCalendar.js";

export const TRIAL_MARKET_DAY_LIMIT = 3;

/**
 * Deterministically computes the instant the 3-market-day trial ends, given
 * a start time. Weekends are skipped exactly as marketDaysElapsed() counts
 * them, so this can never disagree with live day-counting. No holiday
 * calendar exists in this codebase (documented limitation, matches the
 * owner's explicit allowance) -- a holiday between start and expiry will
 * still count as an open day.
 */
export function computeTrialExpiry(startedAt: Date, marketDayLimit = TRIAL_MARKET_DAY_LIMIT): Date {
  let count = 0;
  let day = Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate());
  for (;;) {
    const morning = new Date(day);
    const noon = new Date(day + 12 * 3_600_000);
    if (isMarketOpen(morning) || isMarketOpen(noon)) count += 1;
    if (count >= marketDayLimit) break;
    day += 86_400_000;
  }
  return new Date(day + 86_400_000); // midnight UTC at the end of the day the Nth market day falls on
}

export interface TrialRow {
  id: string;
  user_id: string;
  trial_started_at: string;
  trial_expires_at: string;
  market_days_consumed: number;
  status: "ACTIVE" | "EXPIRED";
  created_at: string;
}

/**
 * Starts the once-only 3-market-day trial for a user. Idempotent: if a
 * trial row already exists for this user_id it is returned unchanged --
 * this is the ONLY thing that prevents a repeat trial (logout/new session/
 * cleared cookies/new device cannot create a second row because the lookup
 * and the unique index are both keyed on the verified account's user_id,
 * never on anything client-supplied).
 */
export async function startTrial(userId: string): Promise<TrialRow> {
  const db = getDb();
  const existing = await db.collection("signal_trials").findOne({ user_id: userId }, { projection: { _id: 0 } });
  if (existing) return existing as unknown as TrialRow;

  const now = new Date();
  const expiresAt = computeTrialExpiry(now);
  const doc: TrialRow = {
    id: randomUUID(),
    user_id: userId,
    trial_started_at: now.toISOString(),
    trial_expires_at: expiresAt.toISOString(),
    market_days_consumed: 1,
    status: "ACTIVE",
    created_at: now.toISOString(),
  };
  try {
    await db.collection("signal_trials").insertOne({ ...doc });
  } catch (err) {
    // Unique-index race: another concurrent request already created it.
    const fresh = await db.collection("signal_trials").findOne({ user_id: userId }, { projection: { _id: 0 } });
    if (fresh) return fresh as unknown as TrialRow;
    throw err;
  }
  return doc;
}

/**
 * Computes current trial status. Never trusts a stored "active" flag past
 * its expiry -- status/days-remaining are recomputed from trial_started_at
 * on every call using the server clock.
 */
export async function trialStatus(userId: string): Promise<(TrialRow & { days_remaining: number }) | null> {
  const row = await getDb().collection("signal_trials").findOne({ user_id: userId }, { projection: { _id: 0 } });
  if (!row) return null;
  const now = new Date();
  const startedAt = new Date(String(row["trial_started_at"]));
  const expiresAt = new Date(String(row["trial_expires_at"]));
  const active = now.getTime() < expiresAt.getTime();
  const consumed = Math.min(TRIAL_MARKET_DAY_LIMIT, marketDaysElapsed(startedAt, now));
  return {
    id: String(row["id"]),
    user_id: userId,
    trial_started_at: row["trial_started_at"] as string,
    trial_expires_at: row["trial_expires_at"] as string,
    market_days_consumed: consumed,
    status: active ? "ACTIVE" : "EXPIRED",
    created_at: row["created_at"] as string,
    days_remaining: active ? Math.max(0, TRIAL_MARKET_DAY_LIMIT - consumed) : 0,
  };
}
