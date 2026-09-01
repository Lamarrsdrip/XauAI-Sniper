# XAU AI Sniper v6.12.0 Grade Calibration + Runner Audit

Date: 2026-07-03

## Live Trade Investigated

- Trade: XAUUSD BUY 0.31
- Order: 9415265274
- Entry: 4185.05
- SL: 4175.35
- TP: 4248.04
- Grade at entry: A+
- Final score: 8.04
- Setup: TREND_PULLBACK
- AI confidence shown in logs: 0 percent, provider unavailable/local rules continued
- Close: broker SL
- Result: -300.70 USD
- Best floating profit before SL: +40.61 USD
- Worst floating loss: -300.39 USD

## Evidence

The trade was not closed by Clean Exit, AI Exit, Daily Lock, or forced EA close. The executed trade memory shows `exitReason=BROKER_SL`.

The entry problem was upstream. Logs around the entry already showed:

- `badLoc=yes`
- `value=no`
- `localLiquidity=0.26ATR`
- `loc=93%`
- `ext=2.73ATR`
- AI unavailable/confidence 0
- `HTF_CONSENSUS_BONUS +2.5`
- `combinedScore=8.04`
- `A+/A FULL SIZE ENFORCED`
- `realRiskAtSL=$300.73 (8.48%)`

This means the EA correctly detected weak entry location, but late trend-confirmation bonuses still produced A+, and the A/A+ size floor restored full lot size after timing logic tried to reduce it.

## Grade Performance From Recent Small-Account Trade Memory

Period: 2026-06-29 onward.

| Grade | Trades | Win Rate | Net P/L | Profit Factor | Expectancy | Avg MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| B | 7 | 85.7% | +256.74 | 7.13 | +36.68 | 36.24 |
| A | 16 | 62.5% | +217.60 | 1.50 | +13.60 | 50.52 |
| A+ | 24 | 62.5% | -542.29 | 0.50 | -22.60 | 63.03 |

Period: 2026-07-02 onward.

| Grade | Trades | Win Rate | Net P/L | Profit Factor | Expectancy |
| --- | ---: | ---: | ---: | ---: | ---: |
| B | 3 | 100.0% | +156.79 | inf | +52.26 |
| A | 9 | 77.8% | +244.61 | 1.75 | +27.18 |
| A+ | 2 | 50.0% | -252.54 | 0.16 | -126.27 |

Conclusion: lower grades were not inherently smarter; many were earlier in the move. A/A+ had become too correlated with obvious late confirmation rather than better entry timing.

## Blocked Early Signal Evidence

Examples from 2026-07-03 blocked memory:

| Time | Candidate | Block Reason | Forward Outcome |
| --- | --- | --- | --- |
| 02:34 | B BUY TREND_PULLBACK 4126.85 | NEWS_ENTRY_BLOCKED_POOR_RR | +5.09 ATR max favorable, TP2R yes |
| 02:50 | B BUY TREND_PULLBACK 4130.40 | NEWS_OBSERVING | +5.11 ATR max favorable, TP2R yes |
| 02:55 | B BUY TREND_PULLBACK 4129.19 | FAILED-IMPULSE BLOCK | +5.93 ATR max favorable, TP2R yes |
| 03:05 | A BUY BREAKOUT 4132.28 | NEWS_OBSERVING | +8.04 ATR max favorable, TP2R yes |
| 03:45 | B BUY TREND_PULLBACK 4136.20 | BAD-LOCATION BLOCK | +9.15 ATR max favorable, TP2R yes |

This confirms the late-confirmation paradox: early B/B+ information was often blocked, then later trend evidence became obvious and inflated A/A+ near worse locations.

## Root Cause

1. `combinedScore` mixed multiple correlated trend-confirmation factors:
   - setup score
   - regime quality
   - session quality
   - regime-direction bonus
   - HTF consensus bonus

2. `XAUEntryTimingGuard()` knew the entry location was late, but trend-continuation qualification softened the penalties too much.

3. The A/A+ full-size floor restored lot size after timing risk reduced it, so stretched A+ entries could still become full-size trades.

4. Winner management was sometimes too tight. Recent evidence showed EV_PROTECT/AMPL stopped healthy winners while the move continued:
   - 9416318221 closed +48.16, later had +165 to +182 more within 10-30 minutes.
   - 9396586413 closed +77.44, later had much larger continuation.

## v6.12.0 Fixes

1. Added `XAU_APlusEntryLocationQualified()`:
   - A+ now requires clean location/value/room, not only direction confirmation.
   - Late trend continuation can still trade, but it should not be fake A+ when entry timing is poor.

2. Added calibrated decision telemetry:
   - setupQuality
   - entryTimingQuality
   - extensionRisk
   - expectedMAERisk
   - effectiveRRQuality
   - finalCalibratedConfidence

3. Preserved timing-risk lot reductions:
   - A/A+ full-size floor no longer overrides `lta_timing < 0.999`.
   - Logs: `A+/A FLOOR SKIPPED (TIMING-RISK)`.

4. Smarter winner runner behavior:
   - EV_PROTECT now allows a healthy positive-EV runner to breathe when holdEV is clearly better than exitEV and trend/structure are still aligned.
   - AMPL now widens the ATR trail for aligned healthy runners instead of clipping strong moves too quickly.

## Verification

- Focused regression tests: `18 passed`
- Broad static XAU/AI/download tests: `197 passed`
- MetaEditor compile: `0 errors, 0 warnings`
- Compile log: `test_reports/metaeditor_v6120_grade_calibration.log`

## Copy To MT5

Use:

`/Users/libertyelectronics/XauAI-Sniper/XAUUSD_AI_Sniper_EA_v6.12.0.mq5`

Compiled binary also exists:

`/Users/libertyelectronics/XauAI-Sniper/XAUUSD_AI_Sniper_EA_v6.12.0.ex5`
