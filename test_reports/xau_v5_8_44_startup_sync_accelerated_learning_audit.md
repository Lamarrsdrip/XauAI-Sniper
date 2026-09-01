# XAUAI Sniper v5.8.44 Startup Sync + Accelerated Learning Audit

## Goal

Upgrade the local Trading Intelligence system without adding reckless live-risk behavior.

## Implemented

- Startup Intelligence Sync now runs on EA attach/restart and logs a `STARTUP_SYNC` row.
- Startup recovery restores open-position quality tracking, checks recent history, loads local report counts, and samples M5 chart context before fresh entries.
- The 200-candle startup target is soft. Trading only blocks if fewer than 100 M5 candles are available or memory/context recovery critically fails.
- Market snapshots now write `MARKET_SNAPSHOT` rows for scan evaluations so reports show what the chart looked like when the EA made a decision.
- Accelerated Learning Mode starts collecting immediately and can make tiny score-only adjustments after 24 hours and 50 qualified observations.
- Accelerated Learning never changes lot sizing, stop loss, take profit, max risk, drawdown protection, equity protection, or emergency locks.
- The website/backend download labels now point to v5.8.44.
- Latest MQ5 source was placed in `/Applications`. The compiled EX5 was verified, then removed from `/Applications` per owner preference.

## Safety Design

- No 4-hour shadow checkpoint was added as a live gate.
- Startup sync does not wait for 4 hours and does not wait for 200 candles when 100 candles are already available.
- Pattern promotion is evidence-gated by sample count, time, expectancy, profit factor, win rate, and multi-session coverage.
- Adjustments are capped at 0.25 score points and are logged as `ACCEL_LEARNING`.

## Verification

- `python3 -m pytest tests -q`: 13 passed.
- `python3 -m py_compile backend/analytics/xau_attribution_report.py backend/server.py`: passed.
- `git diff --check`: passed.
- `npm run build`: passed with existing AdminPortal React hook dependency warnings.
- MetaEditor/Wine compile: `Result: 0 errors, 7 warnings`.

## Applications Files

- `/Applications/XAUUSD_AI_Sniper_EA_MASTER_v5.8.44_STARTUP_SYNC_INTELLIGENCE.mq5`
- Compiled `.ex5` is not kept in `/Applications`.
