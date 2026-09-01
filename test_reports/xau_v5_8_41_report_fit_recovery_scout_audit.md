# XAU v5.8.41 Report-Fit Recovery Scout Audit

Generated: 2026-06-03

## Evidence Used

- Fresh weekly attribution report from live MT5 memory:
  - Closed trades: 10
  - Net profit: $42,489.48
  - Profit factor: 2.78
  - Largest realized loss: -$23,814.51
  - Largest floating loss: -$23,652.69
- Most expensive protections:
  - LATE-CHASE ENTRY BLOCK: missed 1.76 ATR vs saved 0.76 ATR
  - BAD-LOCATION BLOCK: missed 1.67 ATR vs saved 0.91 ATR
- Loss signature:
  - B-grade TREND_PULLBACK BUY after a hot winning cycle
  - Entry reason included cycle armor, but lot reduction was not strong enough

## Changes

1. Added report-fit blocked-memory scout logic.
   - Only activates when the exact blocked reason has enough samples.
   - Requires average favorable move to exceed average adverse move by at least 0.50 ATR.
   - Uses tiny scout sizing, not full-size entries.

2. Softened only the report-proven expensive blocks.
   - LATE-CHASE ENTRY BLOCK can become a tiny scout only if current timing is not extreme danger.
   - BAD-LOCATION BLOCK can become a tiny scout only if blocked-memory edge supports it.

3. Added hot-cycle B-grade risk cut.
   - If daily gain is already above 18% and grade is B, extra lot multiplier is 0.20.
   - This addresses the specific -$23.8k B-grade hot-cycle loss without banning B trades.

## What This Does Not Do

- Does not turn off Smart Guard.
- Does not turn off EPF.
- Does not remove timing guards.
- Does not chase full size after a missed move.
- Does not optimize for win rate alone.

## Expected Behavior

- The bot should stop sitting idle when its own blocked-memory says a specific block is consistently too expensive.
- Any recovered entry from an expensive block should be tiny, logged as `REPORT-FIT SCOUT`, and downgraded one grade.
- B-grade entries after a very strong day should be much smaller so one late B trade cannot erase a large winning cycle.
