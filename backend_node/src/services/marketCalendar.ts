/**
 * Single source of truth for "is the Gold/forex market open" across the
 * backend. Extracted from notifications.ts's `_market_open_and_bot_connected`
 * (market_outlook.py:515 port) so trial-day counting and notification gating
 * can never define market hours differently from each other.
 *
 * Weekday-only for now: Saturday, and the Fri-close/Sun-open UTC boundary.
 * There is no holiday calendar in this codebase -- a market holiday (e.g.
 * Christmas) will incorrectly count as an open day until one is added.
 */
export function isMarketOpen(now: Date): boolean {
  const weekday = (now.getUTCDay() + 6) % 7; // Monday=0 .. Sunday=6
  const marketClosed = weekday === 5 || (weekday === 4 && now.getUTCHours() >= 21) || (weekday === 6 && now.getUTCHours() < 21);
  return !marketClosed;
}

/**
 * Counts distinct UTC calendar days that were at least partly open-market
 * between trialStartedAt (inclusive) and now (inclusive), for the 3-market-day
 * signal trial. A day counts if the market was open at ANY sampled point
 * during it -- checked at 00:00 and 12:00 UTC, which is sufficient given
 * isMarketOpen's only closed window (Friday 21:00 UTC -> Sunday 21:00 UTC)
 * never fully spans a UTC calendar day without covering one of those samples.
 */
export function marketDaysElapsed(trialStartedAt: Date, now: Date): number {
  if (now.getTime() < trialStartedAt.getTime()) return 0;
  const startDay = Date.UTC(trialStartedAt.getUTCFullYear(), trialStartedAt.getUTCMonth(), trialStartedAt.getUTCDate());
  const endDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let count = 0;
  for (let day = startDay; day <= endDay; day += 86_400_000) {
    const morning = new Date(day);
    const noon = new Date(day + 12 * 3_600_000);
    if (isMarketOpen(morning) || isMarketOpen(noon)) count += 1;
  }
  return count;
}
