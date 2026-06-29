# XAU AI Sniper v6.4.7 Trend Continuation Audit

Date: 2026-06-29  
Source file: `XAUUSD_AI_Sniper_EA_v6.4.6.mq5`  
Runtime version after fix: `v6.4.7`  
Build hash: `v647-trend-continuation-20260629`

## Files Inspected

- `XAUUSD_AI_Sniper_EA_v6.4.6.mq5`
- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- `tests/test_xau_v646_live_audit_static.py`
- `tests/test_xau_v647_trend_continuation_static.py`
- Prior reports under `test_reports/`, including v6.4.6 live/AI-cost audit reports

## Primary Finding

The EA treated an extended XAUUSD sell move as finished because the timing guard measured directional room from the current price back to the just-broken local low/high. On a fresh bearish breakdown, that local low is naturally very close to price, so:

- `directionalRoomATR` became near zero.
- `rrQ` became zero or very low.
- `nearLiquiditySweep` became true.
- `missedMove`, `postSweep`, `late`, and `exhaustion` penalties stacked.
- `BAD-RR TIMING BLOCK` fired even when `breakoutContinuation=Y` and `failedImpulse=N`.

Risk level: High  
Live trading impact: High. This can block the exact continuation trades that gold often gives after breakdowns/news.

## Exact Logic Responsible

- A+ demotion and BAD-RR block: `XAUEntryTimingGuard()`
- `timingQ`, `late`, `exhaustion`, `rrQ`: `XAUEntryTimingGuard()`
- Directional room: old `directionalRoomATR = lowClearanceATR/highClearanceATR`
- `missedMove`: `extensionDriveATR >= InpXAU_MissedMoveDriveATR` with insufficient reset
- `cleanContinuation`: old pullback/rejection-only definition
- `breakoutContinuation`: `IsXAUConfirmedBreakoutContinuation()`
- Post-news spread aftermath: OnTick spread classifier and `NEWS_AFTERMATH` block
- Blocked-trade learning: `XAU_AppendBlockedMemory()`, `XAU_BlockedMemoryStats()`

## Fixes Implemented

1. Added Adaptive Trend Continuation Mode:
   - New remaining-room estimator: `XAU_EstimatedContinuationRoomATR()`
   - New continuation scorer: `XAU_TrendContinuationScore()`
   - New aggregate blocked-memory bias: `XAU_BlockedContinuationMissedProfitBias()`

2. BAD-RR now checks estimated remaining room:
   - Uses ATR, older structure, fresh structure break, HTF alignment, post-news bias, and breakout continuation.
   - `BAD-RR TRUE BLOCK` only fires when continuation qualification fails.

3. `missedMove=Y` no longer automatically kills the trade:
   - It triggers `continuationCandidate`.
   - If trend score and remaining room pass, entry can continue at reduced lot.

4. `cleanContinuation` now includes real breakdown/breakout structure:
   - Pullback continuation remains valid.
   - Fresh structure break with directional pressure can also qualify.

5. Broker-noise spread spikes no longer arm fake news pauses:
   - `BROKER_NOISE` logs `BROKER-SPREAD-NOISE`.
   - It does not set `g_newsAftermathUntil`.
   - Example from user log, spread `32pts` vs baseline `12pts` ratio `2.6x`, is now broker noise, not a 10-minute news pause.

6. Post-news aftermath can fast-track:
   - `XAU_NewsAftermathCanFastTrack()` converts stale aftermath pause into post-news confirmation when spread normalizes, no scheduled high-impact window remains, and signal/regime/HTF align.

7. Version/reporting consistency:
   - `#property version` is now `6.4.7`.
   - `XAUAI_EA_VERSION` and `XAUAI_EA_VERSION_NUM` are now `v6.4.7` / `6.4.7`.
   - Input hash includes broker-noise and continuation-mode settings.

## New Inputs

- `InpNewsAftermathArmMulti = 3.5`
- `InpNewsAftermathIgnoreBrokerNoise = true`
- `InpXAU_TrendContinuationMode = true`
- `InpXAU_TCM_MinTrendScore = 72.0`
- `InpXAU_TCM_MinRemainingRoomATR = 0.85`
- `InpXAU_TCM_LotMulti = 0.60`
- `InpXAU_TCM_NewsFastTrack = true`
- `InpXAU_TCM_MemoryMinMissedProfitATR = 2.0`

## Example New Logs

- `BROKER-SPREAD-NOISE: spread=32pts baseline=12pts ratio=2.6x | no NEWS_AFTERMATH timer armed`
- `TREND-CONTINUATION MODE: CONTINUATION QUALIFIED ... remainingRoom=... tcmScore=...`
- `BAD-RR TRUE BLOCK: ... localLiquidity=... remainingRoom=... tcmScore=...`
- `TRUE-LATE BLOCK: ... continuation qualification failed`
- `POST_NEWS_FAST_TRACK: spread normalized ... NEWS_AFTERMATH converted to POST_NEWS_CONFIRMATION`

## Verification

- Focused trend-continuation static tests: 7 passed.
- Existing EA live-audit, AI dashboard, AI cost/memory static tests: 15 passed.
- Combined relevant EA tests: 22 passed.
- `git diff --check`: passed.
- MetaEditor/Wine compile: `0 errors, 1 warning`.
- Compile warning: MQL5 Market version format warning for `6.4.7`; not a runtime error.

## What To Test Next

1. Replay or forward-test the next strong XAUUSD breakdown.
2. Confirm broker-noise logs do not create a 10-minute entry pause.
3. Confirm valid continuation logs show `tcmQualified=Y`, reduced lot, and nonzero `remainingRoom`.
4. Confirm weak/reversal setups still block as `BAD-RR TRUE BLOCK`, `TRUE-LATE BLOCK`, or `TRUE-EXHAUSTION BLOCK`.
5. Compare Mac/VPS dashboards for version, build hash, input hash, broker, spread, symbol, timeframe, and magic number.
