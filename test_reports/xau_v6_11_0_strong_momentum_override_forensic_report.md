# XAUAI v6.11.0 Strong Momentum Override Forensic Report

Date: 2026-07-03

## Scope

Audited live MT5 Experts logs, Journal logs, Gate reports, ForwardTest reports, blocked-signal memory, scorecards, and trade history for XAUUSD around 2026-07-02 to 2026-07-03.

Primary question: why the EA blocked too many entries during the XAUUSD continuation move from the 4050/4060 area toward 4180+, then risked engaging only after the move was extended.

## Evidence

Sources reviewed:

- `MQL5/Logs/20260702.log`
- `MQL5/Logs/20260703.log`
- `logs/20260702.log`
- `logs/20260703.log`
- `ReportHistory.htm`
- `XAUAI_GateReport_2026.07.02.txt`
- `XAUAI_GateReport_2026.07.03.txt`
- `XAUAI_ForwardTest_2026.07.02.txt`
- `XAUAI_ForwardTest_2026.07.03.txt`
- `XAUAI_BlockedTradeMemory_XAUUSD.csv`
- `XAUAI_TradingIntelligence_XAUUSD.jsonl`
- Jul 2/3 scorecards and TradeBrain files.

Jul 2 gate report:

- Total signals: 45
- Allowed trades: 3
- Blocked trades: 42
- Pass rate: 6.7%
- Report diagnosis: severe over-filtering.

Jul 3 gate report:

- Total signals: 94
- Allowed trades: 3
- Blocked trades: 91
- Pass rate: 3.2%
- Report diagnosis: severe over-filtering.

Most repeated Jul 2 expert-log blocks:

- `B-GRADE QUALITY BLOCK`: 31
- `BAD-LOCATION BLOCK`: 15
- `FAILED-IMPULSE BLOCK`: 12
- `TRUE-LATE BLOCK`: 12
- `TREND-CONTINUATION MODE` qualification failures: 9
- `NEWS_OBSERVING`: 8
- `SMART-GUARD`: 5
- `CALENDAR`: 4
- `NEWS_ENTRY_BLOCKED_POOR_RR`: 4

Most repeated Jul 3 expert-log blocks:

- `FAILED-IMPULSE BLOCK`: 9
- `NEWS_OBSERVING`: 4
- `TRUE-LATE BLOCK`: 4
- `NEWS_ENTRY_BLOCKED_POOR_RR`: 3
- `BAD-LOCATION BLOCK`: 2
- Personality gate B blocks continued in scorecards.

Personality gate evidence:

- Jul 2 scorecards repeatedly show `TREND_PULLBACK BUY` blocked because grade was not A/A+ in RANGE/COMPRESSION.
- Jul 3 scorecards show `TREND_PULLBACK BUY` and `BREAKOUT BUY` blocked by personality mismatch in REVERSAL_ENV/RANGE/COMPRESSION.

Timing guard evidence:

- Some late-top blocks were correct. Blocked-memory rows near 4176-4184 showed `TRUE-LATE`, high exhaustion, poor room, or spread ratios around 3.68x baseline. Those should remain blocked.
- Some earlier continuation candidates were blocked before timing had enough room to classify them as valid, especially when B/personality or B-quality gates fired first.

Trade-history evidence:

- The EA did enter some buys early and mid-move, but multiple high-quality continuation reads were blocked between entries.
- This confirms the problem is not "never trades"; the problem is over-filtering during strong continuation and then requiring too much late confirmation.

## Root Cause

Root cause was a stack of cautious hard blocks firing before the EA could evaluate strong momentum as a separate context:

1. Personality gate hard-blocked many B-grade trend-pullback setups before timing/structure could evaluate continuation.
2. B-grade quality fast-confirm demanded strict confirmation and hard-blocked repeated trend-pullback buys.
3. TCM required a high continuation score before easing late/location blocks, so fresh early continuation could be missed while waiting for more evidence.
4. Adaptive news logic correctly protected the release, but post-news interpretation still allowed normal cautious filters to kill continuation too often.
5. Late-chase protection was partly correct and must not be removed; the fix must allow fresh/early momentum, not top-buying after missed moves.

## Fix Implemented

Version: `v6.11.0`

Build hash: `v6110-strong-momentum-override-20260703`

New engine: `STRONG_MOMENTUM_OVERRIDE`

New inputs:

- `InpXAU_StrongMomentumOverride`
- `InpXAU_SMO_MinTrendScore`
- `InpXAU_SMO_MinRoomATR`
- `InpXAU_SMO_EarlyMaxSignalAgeBars`
- `InpXAU_SMO_MaxMissedMoveATR`
- `InpXAU_SMO_MaxExhaustionProb`
- `InpXAU_SMO_MinRRQuality`
- `InpXAU_SMO_LotMulti`
- `InpXAU_SMO_AllowBGradeBalanced`

Behavior:

- B/personality blocks can become soft warnings only when the strong momentum precheck passes.
- B-quality fast-confirm blocks can become soft warnings only when the strong momentum precheck passes.
- Timing guard can qualify fresh early continuation when M5/M15 momentum, structure, HTF context, room, and RR agree.
- Controlled lot multiplier is applied to override entries.
- Late-top chasing remains blocked when the move is old, too extended, exhausted, failed-impulse, spike-cooldown, hostile HTF, or poor RR.

## Before / After Decision Replay

Before v6.11.0:

- Early continuation B setups in RANGE/COMPRESSION could be blocked by personality before momentum was evaluated.
- Post-news continuation could remain stuck behind `NEWS_OBSERVING`, `NEWS_ENTRY_BLOCKED_POOR_RR`, B-quality, or timing blocks.
- The timing report did not clearly label hard/soft blocks or what needed to change.

After v6.11.0:

- Fresh strong momentum can override cautious soft blocks if:
  - M5 momentum is directional and strong.
  - M15 momentum or HTF context is supportive.
  - Structure is breaking or post-news continuation is aligned.
  - HTF is not hostile.
  - Remaining room and RR quality are acceptable.
  - Exhaustion is below the configured max.
  - The signal is still early, not a late missed move.

- Still blocked:
  - Extreme spread.
  - Invalid RR or insufficient room.
  - Hostile HTF consensus.
  - Active release chaos.
  - Late chase after missed move without retest.
  - Failed impulse / spike rejection.
  - Exhaustion divergence.

## Report Upgrade

Gate/Forward reports now print:

- Strong Momentum Override status.
- Minimum score/room settings.
- B-grade balanced mode allowance.
- Block scoring policy.
- Missed-move protection statement.

Timing logs now include:

- `blockClass=`
- `whatNeedsToChange=`
- `missedMoveATR=`
- `smoQualified=`
- `STRONG_MOMENTUM_OVERRIDE`

## Verification

Static tests:

- `tests/test_xau_v6110_strong_momentum_override_static.py`
- `tests/test_download_release_metadata_static.py`
- `tests/test_release_labels_static.py`

Result:

- 13 passed.

MetaEditor compile:

- File: `XAUUSD_AI_Sniper_EA_v6.11.0.mq5`
- Log: `test_reports/metaeditor_v6110_strong_momentum_rerun.log`
- Result: 0 errors, 0 warnings.
- EX5 produced: `XAUUSD_AI_Sniper_EA_v6.11.0.ex5`

## File To Copy Into MT5

Use:

- `XAUUSD_AI_Sniper_EA_v6.11.0.ex5` for compiled EA.
- `XAUUSD_AI_Sniper_EA_v6.11.0.mq5` if compiling manually in MetaEditor.

Website/customer download source has also been synced to:

- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
