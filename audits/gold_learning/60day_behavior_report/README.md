# 60-Day M30-Postfix Trade Behavior Report — Index

Phase 1 evidence-only extraction. No trading logic, threshold, SL, exit, or
pyramid behavior was changed to produce this report. Source run: the
verified 60-day (2026-05-18 → 2026-07-17) M30-consensus Strategy Tester
replay on the trade-frequency-fix build, EX5 SHA-256
`430f8d11478d2d0a80df89f0baf0daa7a8a94534fad3c3d4b96e7a1bffc80bc9`
(191 closed positions, 152 tester-counted wins / 39 losses, +$3,478.69 net
per the tester's own summary).

## Start here

- **`60DAY_EXECUTIVE_REPORT.md`** — the main plain-English report: top-line
  numbers, average SL/risk, exit-authority breakdown, every single losing
  trade individually (entry time, hold time, MFE before the loss, whether
  it ever reached +0.20R), winner summary statistics, pyramid contribution,
  session/hour/day-of-week performance, market-regime and entry-timing
  evidence (see below), and 8 embedded charts.
- **`60DAY_RUN_METADATA.json`** — exact identity of the run: branch, EA
  build string, EX5/MQ5 hashes, symbol/period/model, date range, deposit,
  leverage, and the tester's own reported totals (for cross-checking).
- **`60DAY_METHOD_AND_LIMITATIONS.md`** — what every field actually is,
  where it came from, and what was explicitly NOT attempted in this pass.

## Data files

- **`60DAY_ALL_POSITIONS.csv`** — all 191 individual positions, one row
  each: campaign ID, leg role (CORE/PYRAMID), direction, lots, entry/exit
  time and price, structural SL price and distance, risk $, exit reason
  (EA's own classification), exit authority (broker SL vs EA-managed),
  hold time, commission/swap, realized profit/R, MFE (R and $), MAE (R and
  $), MFE-capture %, and which R-checkpoints (0.20/0.30/0.40/0.50/0.75/1.00)
  were ever reached.
- **`60DAY_ALL_CAMPAIGNS.csv`** — all 153 real EA-assigned campaigns
  (`CAMP-N`): direction, setup tag, position/core/pyramid counts, open/close
  time, core-only vs pyramid-only vs combined realized profit, campaign
  result, campaign-level peak floating/MFE/MAE/given-back, whether any leg
  hit a broker SL.
- **`60DAY_ENTRY_TIMING_AND_REGIME.csv`** — all 152 CORE positions joined to
  the EA's own real-time market classification: regime (`ENUM_REGIME`) and
  market-lifecycle state (`ENUM_XAU_MARKET_LIFECYCLE`) at both signal time
  and entry time, entry-timer checkpoint (150s/180s) and exact price drift
  during the wait, plus location/exhaustion/timing/HTF/structure/pressure
  state labels and the EA's own learned-entry-quality trace fields
  (trend health, pullback completion %, trap risk %, liquidity-sweep flag,
  breakout acceptance).
- **`60DAY_MARKET_REGIME_RESULTS.csv`**, **`60DAY_ENTRY_LIFECYCLE_RESULTS.csv`**,
  **`60DAY_TIMER_CHECKPOINT_RESULTS.csv`**, **`60DAY_ENTRY_TIMING_CLASSIFICATION_RESULTS.csv`**
  — aggregated win-rate/realized-R/MFE/MAE performance grouped by each of
  those real classifications.

## Charts (also embedded in the executive report)

- `60DAY_REALIZED_R_DISTRIBUTION.png` — realized R histogram, wins vs losses.
- `60DAY_REALIZED_R_VS_MFE.png` — realized R vs MFE R scatter (distance
  below the diagonal = R given back before exit).
- `60DAY_RISK_USD_DISTRIBUTION.png` — risk-per-position ($) histogram.
- `60DAY_SESSION_PERFORMANCE.png` — net R by broker-server-time session.
- `60DAY_HOURLY_NET_R.png` — net R by entry hour.
- `60DAY_MARKET_REGIME_EXPECTANCY.png` — average realized R by market regime
  at signal time.
- `60DAY_LIFECYCLE_STATE_EXPECTANCY.png` — average realized R by market
  lifecycle state at entry (the `OPPOSITE_DIRECTION_FORMING` finding).
- `60DAY_TIMER_CHECKPOINT_COMPARISON.png` — 150s vs 180s entry-timer
  checkpoint performance comparison.

## Reproducing this report

```
python3 scripts/gold_learning/extract_60day_postfix_trades.py \
    --journal <UTF-8-decoded preserved journal> \
    --report-html <tester HTML report> \
    --out-dir audits/gold_learning/60day_behavior_report

python3 scripts/gold_learning/build_60day_report.py \
    --out-dir audits/gold_learning/60day_behavior_report

python3 scripts/gold_learning/extract_60day_regime_and_timing.py \
    --journal <UTF-8-decoded preserved journal> \
    --out-dir audits/gold_learning/60day_behavior_report

python3 scripts/gold_learning/build_regime_and_timing_report.py \
    --out-dir audits/gold_learning/60day_behavior_report
```

The journal must first be decoded from UTF-16LE to UTF-8 (it is captured by
MetaTester in UTF-16LE); this repo does not commit the raw 15GB/7.5GB
journal files themselves — only the CSVs, report, and metadata derived from
them are committed.
