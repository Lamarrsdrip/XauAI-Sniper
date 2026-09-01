# XAU AI Sniper v6.25.24 — Final 90-Day Replay Audit

## Replay identity

- EA: `v6.25.24`
- Build: `v62524-replay-consolidated-root-repair-20260722`
- Run ID: `V62524_M10_90D_20260422_20260721_RUN1`
- Period: 2026-04-22 through 2026-07-21
- Symbol/timeframe: XAUUSD M10
- Model: Every tick based on real ticks
- Starting balance: $10,000
- TradeBrain mode: `GLOBAL_TRADEBRAIN_COLLECT_ONLY`
- Source SHA-256: `e3309d9faafba868c3b94e405fd6f31f819e970156c374c6c2a57d360232314d`

The tester completed successfully. The package contains one exact TradeBrain collection with 155 OPEN rows, 155 CLOSE rows, 775 POST_CLOSE rows, 144 timing-proof rows and 150 blocked-opportunity records.

## Executive verdict

**Do not enable TradeBrain hard blocking from this replay.**

The correct next production mode is:

`GLOBAL_TRADEBRAIN_ADVISOR`

There are **zero validated hard-block rules**. Among 144 CORE trades there are 111 distinct exact fingerprints. The most common exact fingerprint appears only 5 times overall and 4 times in the 60-day training section—far below the owner-required minimum of 20 decisive training samples.

The replay reveals three important engineering issues:

1. Position 130 is a catastrophic execution-gap/slippage anomaly and must be quarantined from entry-pattern learning.
2. Position 212 reached 0.435R before ending at -1.011R; the full June 19 log is required to verify the 0.40R owner floor.
3. Scanner completeness is excellent, but 4807 recovery churn remains abnormally high and needs a controlled lifecycle test rather than another blind retry change.

## Exact result

| Metric | Result |
|---|---:|
| Trades | 155 |
| Wins | 121 |
| Losses | 34 |
| Win rate | 78.06% |
| Gross profit | +$34,700.74 |
| Gross loss | -$35,344.15 |
| Net | -$643.41 |
| Profit factor | 0.9818 |
| Average win | +$286.78 |
| Average loss | -$1,039.53 |
| Expectancy | -$4.15 per trade |

The strategy won often, but loss size erased the edge.

## Correct chronological 60/30 split

The split is based on **OPEN/entry time**, not close time.

| Section | Trades | W/L | Net | PF | Expectancy |
|---|---:|---:|---:|---:|---:|
| First 60 days — training | 107 | 84/23 | -$4,494.52 | 0.8316 | -$42.00 |
| Final 30 days — untouched holdout | 48 | 37/11 | +$3,851.11 | 1.4451 | +$80.23 |

The untouched final 30 days were profitable. This is another reason not to manufacture broad blockers from the weaker first section.

## Critical execution anomaly — quarantine from learning

Position 130:

- Entry: 2026-06-01 22:52:30
- Close: 2026-06-02 01:00:00
- SELL Trend Pullback, A+, LATE, `ALLOW_CORE`
- Entry: 4481.11
- Structural SL: 4490.84
- Exit: 4535.29
- Intended risk: $1,147.61
- Final result: -$6,398.67 = -5.576R
- Recorded peak before the loss: +$208.86
- Recorded worst floating before the gap: -$34.93

The exit was 44.45 XAUUSD dollars beyond the structural SL. This is not a normal -1R entry failure. It is evidence of a tester/broker session gap, slippage or execution discontinuity.

Excluding only this anomaly:

- Net changes from -$643.41 to +$5,755.26
- PF changes from 0.9818 to 1.1988
- First-60-day net changes from -$4,494.52 to +$1,904.15

Do not block SELL, LATE or Trend Pullback broadly because of this one execution event.

## Performance by setup

| Group                    |   Trades |   Wins |   Losses | SL/Loss rate   | Net      | PF    |
|:-------------------------|---------:|-------:|---------:|:---------------|:---------|:------|
| PYRAMID_TWO_GATE         |       11 |     11 |        0 | 0.00%          | +$831.20 | ∞     |
| M10_ORIGINATED_CANDIDATE |       84 |     64 |       20 | 23.81%         | -$345.01 | 0.981 |
| TREND_PULLBACK           |       59 |     46 |       13 | 22.03%         | -$407.10 | 0.976 |
| SQUEEZE_RELEASE          |        1 |      0 |        1 | 100.00%        | -$722.50 | 0.000 |

## Performance by role

| Group   |   Trades |   Wins |   Losses | SL/Loss rate   | Net        | PF    |
|:--------|---------:|-------:|---------:|:---------------|:-----------|:------|
| PYRAMID |       11 |     11 |        0 | 0.00%          | +$831.20   | ∞     |
| CORE    |      144 |    110 |       34 | 23.61%         | -$1,474.61 | 0.958 |

All 11 pyramid legs won for a combined +$831.20. Keep PYRAMID outside TradeBrain hard-block authority.

## Performance by grade

| Group   |   Trades |   Wins |   Losses | SL/Loss rate   | Net        | PF    |
|:--------|---------:|-------:|---------:|:---------------|:-----------|:------|
| A+      |       40 |     34 |        6 | 15.00%         | +$2,464.42 | 1.241 |
| PYRAMID |       11 |     11 |        0 | 0.00%          | +$831.20   | ∞     |
| A       |       43 |     32 |       11 | 25.58%         | +$260.91   | 1.030 |
| B       |       61 |     44 |       17 | 27.87%         | -$4,199.94 | 0.744 |

## Performance by direction

| Group   |   Trades |   Wins |   Losses | SL/Loss rate   | Net        |    PF |
|:--------|---------:|-------:|---------:|:---------------|:-----------|------:|
| BUY     |       97 |     76 |       21 | 21.65%         | +$6,185.23 | 1.36  |
| SELL    |       58 |     45 |       13 | 22.41%         | -$6,828.64 | 0.624 |

The SELL result is dominated by the -$6,398.67 execution anomaly. Excluding that single trade, SELL is approximately -$429.97 rather than -$6,828.64.

## Performance by session

| Group   |   Trades |   Wins |   Losses | SL/Loss rate   | Net        | PF    |
|:--------|---------:|-------:|---------:|:---------------|:-----------|:------|
| ASIA    |       38 |     31 |        7 | 18.42%         | +$4,027.01 | 1.562 |
| FIX     |        9 |      9 |        0 | 0.00%          | +$1,462.79 | ∞     |
| NY      |       28 |     19 |        9 | 32.14%         | +$1,270.59 | 1.167 |
| LDN     |       65 |     51 |       14 | 21.54%         | -$2,479.99 | 0.802 |
| LATE    |       15 |     11 |        4 | 26.67%         | -$4,923.81 | 0.390 |

LATE is also distorted by the same outlier. Excluding it, LATE changes from -$4,923.81 to approximately +$1,474.86.

## Performance by thesis action

| Group                                   |   Trades |   Wins |   Losses | SL/Loss rate   | Net        | PF    |
|:----------------------------------------|---------:|-------:|---------:|:---------------|:-----------|:------|
| TRANSITION_WATCH                        |       91 |     71 |       20 | 21.98%         | +$4,949.91 | 1.271 |
| ALLOW_SCALP                             |        4 |      4 |        0 | 0.00%          | +$912.26   | ∞     |
| PYRAMID_TIMING_PLUS_EXHAUSTION_APPROVED |       11 |     11 |        0 | 0.00%          | +$831.20   | ∞     |
| OPPOSITE_DISCOVERY                      |       22 |     16 |        6 | 27.27%         | -$2,732.92 | 0.458 |
| ALLOW_CORE                              |       27 |     19 |        8 | 29.63%         | -$4,603.86 | 0.618 |

These are diagnostic aggregates—not permission to broad-block a thesis action.

## What the losing trades reached before SL

- Losing trades: 34
- Positive at some point: 33/34
- Combined recorded peak profit before losses: +$4,350.66
- Average recorded peak: +$127.96
- Median recorded peak: +$132.63
- At least 0.05R: 25
- At least 0.10R: 19
- At least 0.20R: 12
- At least 0.25R: 8
- At least 0.30R: 5
- At least 0.40R: 1

Only position 212 crossed 0.40R before ending in loss. The included tail does not contain that date, so do not claim the owner floor failed until the full log proves the exact management sequence. `shieldArmed=N` in the close text is not, by itself, proof about the owner R floor.

## All 34 losses

|   Pos | Entry               | Setup                    | Dir   | Grade   | Session   | Peak $   | Peak R   | Final P&L   | Final R   | Review                                                                                  |
|------:|:--------------------|:-------------------------|:------|:--------|:----------|:---------|:---------|:------------|:----------|:----------------------------------------------------------------------------------------|
|     8 | 2026-04-23 08:12:33 | TREND_PULLBACK           | BUY   | A       | LDN       | -$0.69   | -0.001R  | -$1,041.21  | -1.005R   |                                                                                         |
|    12 | 2026-04-23 11:02:33 | M10_ORIGINATED_CANDIDATE | BUY   | B       | LDN       | +$90.20  | 0.096R   | -$953.66    | -1.014R   |                                                                                         |
|    34 | 2026-05-01 04:02:33 | M10_ORIGINATED_CANDIDATE | SELL  | B       | ASIA      | +$262.40 | 0.225R   | -$1,174.24  | -1.005R   |                                                                                         |
|    50 | 2026-05-07 12:02:33 | TREND_PULLBACK           | SELL  | B       | LDN       | +$148.00 | 0.116R   | -$1,280.20  | -1.003R   |                                                                                         |
|    56 | 2026-05-08 07:42:33 | M10_ORIGINATED_CANDIDATE | SELL  | B       | LDN       | +$168.56 | 0.125R   | -$1,348.48  | -1.000R   |                                                                                         |
|    60 | 2026-05-11 04:32:33 | M10_ORIGINATED_CANDIDATE | BUY   | B       | ASIA      | +$211.27 | 0.174R   | -$1,216.93  | -1.000R   |                                                                                         |
|    70 | 2026-05-15 14:12:30 | M10_ORIGINATED_CANDIDATE | BUY   | B       | NY        | +$11.44  | 0.009R   | -$1,280.24  | -1.001R   |                                                                                         |
|    72 | 2026-05-15 15:52:33 | M10_ORIGINATED_CANDIDATE | BUY   | A       | NY        | +$18.04  | 0.016R   | -$1,159.48  | -1.001R   |                                                                                         |
|    76 | 2026-05-18 09:02:33 | TREND_PULLBACK           | SELL  | A+      | LDN       | +$97.52  | 0.093R   | -$1,051.56  | -1.004R   |                                                                                         |
|    80 | 2026-05-19 11:02:33 | TREND_PULLBACK           | BUY   | A       | LDN       | +$92.63  | 0.096R   | -$964.06    | -1.001R   |                                                                                         |
|   104 | 2026-05-27 03:02:30 | TREND_PULLBACK           | BUY   | B       | ASIA      | +$9.43   | 0.009R   | -$1,022.54  | -1.001R   |                                                                                         |
|   116 | 2026-05-29 02:42:35 | M10_ORIGINATED_CANDIDATE | SELL  | B       | ASIA      | +$132.87 | 0.118R   | -$1,136.49  | -1.006R   |                                                                                         |
|   120 | 2026-05-29 16:02:30 | M10_ORIGINATED_CANDIDATE | SELL  | B       | NY        | +$17.60  | 0.017R   | -$1,026.08  | -1.002R   |                                                                                         |
|   130 | 2026-06-01 22:52:30 | TREND_PULLBACK           | SELL  | A+      | LATE      | +$208.86 | 0.182R   | -$6,398.67  | -5.576R   | QUARANTINE: -5.58R session-gap/slippage anomaly; not a normal entry-pattern loss.       |
|   134 | 2026-06-02 13:22:33 | M10_ORIGINATED_CANDIDATE | SELL  | B       | NY        | +$33.28  | 0.062R   | -$546.56    | -1.022R   |                                                                                         |
|   142 | 2026-06-03 13:32:33 | M10_ORIGINATED_CANDIDATE | BUY   | B       | NY        | +$132.40 | 0.251R   | -$529.20    | -1.002R   |                                                                                         |
|   146 | 2026-06-04 19:32:33 | TREND_PULLBACK           | BUY   | A+      | LATE      | +$115.20 | 0.242R   | -$487.55    | -1.023R   |                                                                                         |
|   164 | 2026-06-10 09:52:33 | M10_ORIGINATED_CANDIDATE | BUY   | A       | LDN       | +$27.82  | 0.053R   | -$527.54    | -1.008R   |                                                                                         |
|   196 | 2026-06-16 12:12:33 | SQUEEZE_RELEASE          | BUY   | A+      | LDN       | +$187.50 | 0.260R   | -$722.50    | -1.001R   |                                                                                         |
|   204 | 2026-06-18 05:12:33 | TREND_PULLBACK           | BUY   | B       | ASIA      | +$177.48 | 0.228R   | -$779.28    | -1.001R   |                                                                                         |
|   210 | 2026-06-19 12:02:33 | M10_ORIGINATED_CANDIDATE | BUY   | B       | LDN       | +$9.10   | 0.012R   | -$738.50    | -1.000R   |                                                                                         |
|   212 | 2026-06-19 14:12:33 | TREND_PULLBACK           | SELL  | A+      | NY        | +$295.04 | 0.435R   | -$686.08    | -1.011R   | REVIEW: recorded peak 0.435R exceeded GENERAL 0.40R trigger; full June 19 log required. |
|   214 | 2026-06-19 18:52:33 | M10_ORIGINATED_CANDIDATE | BUY   | A       | LATE      | +$200.81 | 0.335R   | -$621.18    | -1.036R   |                                                                                         |
|   220 | 2026-06-22 07:42:33 | M10_ORIGINATED_CANDIDATE | SELL  | A       | LDN       | +$3.80   | 0.006R   | -$615.60    | -1.002R   |                                                                                         |
|   222 | 2026-06-22 22:12:33 | TREND_PULLBACK           | BUY   | A       | LATE      | +$193.02 | 0.345R   | -$563.88    | -1.007R   |                                                                                         |
|   224 | 2026-06-23 14:22:33 | M10_ORIGINATED_CANDIDATE | BUY   | A       | NY        | +$47.43  | 0.094R   | -$509.02    | -1.006R   |                                                                                         |
|   228 | 2026-06-24 11:32:33 | M10_ORIGINATED_CANDIDATE | BUY   | B       | LDN       | +$19.17  | 0.041R   | -$466.02    | -1.002R   |                                                                                         |
|   258 | 2026-07-03 09:42:30 | M10_ORIGINATED_CANDIDATE | SELL  | A       | LDN       | +$134.90 | 0.138R   | -$983.35    | -1.006R   |                                                                                         |
|   260 | 2026-07-06 13:52:34 | M10_ORIGINATED_CANDIDATE | BUY   | A+      | NY        | +$163.91 | 0.189R   | -$866.54    | -1.000R   |                                                                                         |
|   264 | 2026-07-07 01:42:35 | TREND_PULLBACK           | BUY   | A       | ASIA      | +$16.00  | 0.020R   | -$811.52    | -1.006R   |                                                                                         |
|   278 | 2026-07-09 14:12:30 | M10_ORIGINATED_CANDIDATE | SELL  | B       | NY        | +$322.74 | 0.325R   | -$1,008.81  | -1.015R   |                                                                                         |
|   282 | 2026-07-13 08:22:30 | TREND_PULLBACK           | BUY   | B       | LDN       | +$196.98 | 0.222R   | -$889.76    | -1.002R   |                                                                                         |
|   300 | 2026-07-17 04:32:30 | M10_ORIGINATED_CANDIDATE | BUY   | B       | ASIA      | +$364.21 | 0.357R   | -$1,021.02  | -1.000R   |                                                                                         |
|   302 | 2026-07-17 11:22:33 | TREND_PULLBACK           | SELL  | A       | LDN       | +$241.74 | 0.264R   | -$916.40    | -1.001R   |                                                                                         |

## TradeBrain warning cohorts

These cohorts overlap. They are **warning/advisory only** and must still be allowed to trade.

| Cohort                                               |   Samples | W/L   | SL rate   | Net        | Wilson lower   | Train       | Holdout    |   Winners affected | Authority    |
|:-----------------------------------------------------|----------:|:------|:----------|:-----------|:---------------|:------------|:-----------|-------------------:|:-------------|
| Entry hour 12–14 + reset pending + wait confirmation |        13 | 5/8   | 61.54%    | -$5,226.31 | 35.52%         | 5/10 losses | 3/3 losses |                  5 | WARNING ONLY |
| Entry hour 12–14 + structure opposes                 |        15 | 7/8   | 53.33%    | -$4,465.16 | 30.12%         | 5/10 losses | 3/5 losses |                  7 | WARNING ONLY |
| BUY + ASIA + BOS opposed                             |         8 | 3/5   | 62.50%    | -$3,020.77 | 30.57%         | 3/5 losses  | 2/3 losses |                  3 | WARNING ONLY |
| BUY Trend Pullback + structure opposes               |        10 | 5/5   | 50.00%    | -$2,252.10 | 23.66%         | 3/6 losses  | 2/4 losses |                  5 | WARNING ONLY |

No cohort above satisfies the 20-sample training requirement, confidence requirement or winner-protection requirement. Activating any of them as a blocker would knowingly reject historical winners.

## Feature-leakage warning

The TradeBrain CSV writes an `hour` value on every event. On CLOSE rows, that hour is the **exit hour**.

Therefore, never train directly from CLOSE-row `hour` or other fields that may have changed after entry.

The correct one-row dataset is built by:

1. taking all entry-time features from OPEN;
2. taking only outcome/future labels from CLOSE and POST_CLOSE;
3. joining by position ID;
4. splitting chronologically by entry time.

The included cleaned CSV follows that rule.

## Timing proof

- CORE timing-proof rows: 144
- Every row required timing: True
- Every required delay was 150 seconds: True
- Mean wait: 150.049s
- Maximum wait: 152s
- Every row revalidated freshness: True
- Any timing bypass used: False

The bounded timing lifecycle operated consistently in this replay.

## Scanner and 4807 verdict

`2026.07.20 23:59:45     Scan health: started=8206 completed=8206 deferredBars=6212 aborted=0 snapshotReuses=8378 m10Bars=8207 prepAttempts=26858 ready=8206 failedFinal=0 superseded=1 wrongHandleRecoveries=12435 transient4807Waits=37307 dataWaits=37307`

This proves:

- every started scan completed;
- zero failed-final snapshots;
- one superseded bar;
- no return of the old mass bar-loss problem.

But it also shows:

- 6,212 deferred bars;
- 26,858 preparation attempts;
- 12,435 wrong-handle recoveries;
- 37,307 transient 4807 waits.

The last 5,000 lines repeatedly show EMA_FAST_M10 and ATR_M10 being recreated after the current persistence threshold, then becoming ready one second later. Claude must test whether numeric-handle 4807 needs a slightly longer readiness grace period. Any repair must preserve zero failed-final snapshots and must recreate only the affected handle.

The counters `transient4807Waits` and `dataWaits` are identical in this replay. Audit whether they are incremented by the same path and rename/separate them so telemetry is truthful.

## Blocked-opportunity memory

Blocked ideas recorded:

- OWNER_LATE_SESSION_QUALITY_BLOCK: 78
- BREAKOUT_MARKET_NOT_ALLOWED: 57
- Protected scheduled release: 11
- Protected high-impact news window: 4

This is observational counterfactual telemetry, not completed-trade evidence. It must not be mixed with executed-trade SL statistics or used directly as hard-block training data.

## Required production actions

1. **Keep TradeBrain in `GLOBAL_TRADEBRAIN_ADVISOR`.**
2. **Create no active hard-block rule from this dataset.**
3. Quarantine position 130 from entry-pattern learning.
4. Investigate session-gap/slippage execution and record requested price, broker fill, structural SL, first tick after reopen and actual deal reason.
5. Obtain the complete June 19 log and prove position 212's 0.40R floor lifecycle.
6. Train only from OPEN entry features joined to CLOSE outcomes.
7. Fix UTF-16 log extraction so final evidence scripts do not silently produce empty key-event files.
8. Audit 4807 persistence/recreation under controlled tests; preserve complete M10 coverage.
9. Keep PYRAMID advisory-only and outside hard blocking.
10. Preserve all winning exact patterns and do not broad-block grade, setup, direction, session or thesis.
11. Prove advisor neutrality by replaying COLLECT_ONLY and ADVISOR with identical trades, lots, SL, TP and exits.
12. Collect more non-overlapping evidence before considering `HARD_BLOCK_70`.

## Evidence limitations

- The package does not contain the full Strategy Tester HTML report.
- It contains only the final 5,000 lines of the tester log.
- The key-events file is empty because the tester log was UTF-16.
- Exact floating-equity drawdown is not reconstructable from these files alone.
- Position 212's management sequence is unresolved until the full June 19 log is obtained.

## Final decision

The replay is valid and useful.

It proves v6.25.24 restored scanner completeness and generated a profitable untouched final 30-day holdout. It does **not** provide enough repeated exact evidence for any safe 70% hard blocker.

Use the data to improve advisory explanations, execution anomaly handling and telemetry integrity—not to create a broad filter that begins blocking good trades.
