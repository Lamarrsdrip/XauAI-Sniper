# 90-Day Post-Exit 5/10/15/20/30/60-Minute Summary

## Method

- Exact replay window: 2026-04-19 00:00 through 2026-07-18 00:00 (90 days).
- First 60 days: 2026-04-19 through 2026-06-18; latest 30 days: 2026-06-18 through 2026-07-18.
- Every broker-confirmed full close is anchored to its immutable original entry/SL/R state.
- BUY post-exit chronology uses executable Bid; SELL uses executable Ask.
- `missed_r` is the maximum additional favorable price movement after the actual exit divided by original risk distance.
- `total_favorable_r` is realized R at exit plus missed R.
- Clean continuation means +0.10R post-exit was reached before -0.10R; immediate reversal means -0.10R was reached first.
- TRANSITION/NO_TRADE messages are absent because this dataset contains executed closed positions only.

## Overall

| period | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_max_adverse_r_5m | avg_missed_r_10m | avg_max_adverse_r_10m | avg_missed_r_15m | avg_max_adverse_r_15m | avg_missed_r_20m | avg_max_adverse_r_20m | avg_missed_r_30m | avg_max_adverse_r_30m | avg_missed_r_60m | avg_max_adverse_r_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | 120 | 0.008415 | 0.335354 | 0.174501 | 0.206683 | 0.246949 | 0.25202 | 0.285981 | 0.306014 | 0.313948 | 0.370057 | 0.367553 | 0.477599 | 0.530278 | 0.663492 |
| LATEST_30_DAYS | 0 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| FULL_90_DAYS | 120 | 0.008415 | 0.335354 | 0.174501 | 0.206683 | 0.246949 | 0.25202 | 0.285981 | 0.306014 | 0.313948 | 0.370057 | 0.367553 | 0.477599 | 0.530278 | 0.663492 |

## Checkpoint coverage

| period | trades | trades_with_5m_data | historical_data_unavailable_5m | trades_with_10m_data | historical_data_unavailable_10m | trades_with_15m_data | historical_data_unavailable_15m | trades_with_20m_data | historical_data_unavailable_20m | trades_with_30m_data | historical_data_unavailable_30m | trades_with_60m_data | historical_data_unavailable_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | 120 | 120 | 0 | 120 | 0 | 120 | 0 | 120 | 0 | 120 | 0 | 120 | 0 |
| LATEST_30_DAYS | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| FULL_90_DAYS | 120 | 120 | 0 | 120 | 0 | 120 | 0 | 120 | 0 | 120 | 0 | 120 | 0 |

## By regime

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | CHOPPY | 4 | 0.27404 | 0.361585 | 0.031481 | 0.031481 | 0.031481 | 0.055623 | 0.078237 | 0.317823 | 0 | 4 |
| FIRST_60_DAYS | RANGING | 2 | 0.194494 | 0.576564 | 0.011929 | 0.011929 | 0.011929 | 0.011929 | 0.011929 | 0.011929 | 0 | 1 |
| FIRST_60_DAYS | TREND_DN | 78 | -0.016887 | 0.32866 | 0.174212 | 0.264013 | 0.307721 | 0.336192 | 0.404311 | 0.609861 | 42 | 36 |
| FIRST_60_DAYS | TREND_UP | 36 | 0.023386 | 0.333544 | 0.200051 | 0.246973 | 0.28238 | 0.311234 | 0.339814 | 0.410251 | 21 | 15 |
| LATEST_30_DAYS | CHOPPY | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | RANGING | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | TREND_DN | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | TREND_UP | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FULL_90_DAYS | CHOPPY | 4 | 0.27404 | 0.361585 | 0.031481 | 0.031481 | 0.031481 | 0.055623 | 0.078237 | 0.317823 | 0 | 4 |
| FULL_90_DAYS | RANGING | 2 | 0.194494 | 0.576564 | 0.011929 | 0.011929 | 0.011929 | 0.011929 | 0.011929 | 0.011929 | 0 | 1 |
| FULL_90_DAYS | TREND_DN | 78 | -0.016887 | 0.32866 | 0.174212 | 0.264013 | 0.307721 | 0.336192 | 0.404311 | 0.609861 | 42 | 36 |
| FULL_90_DAYS | TREND_UP | 36 | 0.023386 | 0.333544 | 0.200051 | 0.246973 | 0.28238 | 0.311234 | 0.339814 | 0.410251 | 21 | 15 |

## By exit authority

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | BROKER_SL | 24 | -1.011239 | 0.119329 | 0.211233 | 0.323739 | 0.350841 | 0.361847 | 0.424143 | 0.509244 | 14 | 10 |
| FIRST_60_DAYS | PROFIT_CLOSE | 66 | 0.208914 | 0.336843 | 0.175793 | 0.222276 | 0.244089 | 0.268359 | 0.320397 | 0.493247 | 32 | 34 |
| FIRST_60_DAYS | SL_MOD:PRIMARY_EXIT_FLOOR | 29 | 0.406086 | 0.515848 | 0.14718 | 0.248066 | 0.337505 | 0.388886 | 0.440714 | 0.650247 | 17 | 12 |
| FIRST_60_DAYS | WEEKEND_CLOSE | 1 | -0.285236 | 0.187298 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0 | 0 |
| LATEST_30_DAYS | BROKER_SL | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | PROFIT_CLOSE | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | SL_MOD:PRIMARY_EXIT_FLOOR | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | WEEKEND_CLOSE | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FULL_90_DAYS | BROKER_SL | 24 | -1.011239 | 0.119329 | 0.211233 | 0.323739 | 0.350841 | 0.361847 | 0.424143 | 0.509244 | 14 | 10 |
| FULL_90_DAYS | PROFIT_CLOSE | 66 | 0.208914 | 0.336843 | 0.175793 | 0.222276 | 0.244089 | 0.268359 | 0.320397 | 0.493247 | 32 | 34 |
| FULL_90_DAYS | SL_MOD:PRIMARY_EXIT_FLOOR | 29 | 0.406086 | 0.515848 | 0.14718 | 0.248066 | 0.337505 | 0.388886 | 0.440714 | 0.650247 | 17 | 12 |
| FULL_90_DAYS | WEEKEND_CLOSE | 1 | -0.285236 | 0.187298 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0 | 0 |

## By frozen owner-exit profile

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | GENERAL | 84 | 0.001999 | 0.33613 | 0.163552 | 0.246938 | 0.287524 | 0.315111 | 0.379441 | 0.581718 | 42 | 41 |
| FIRST_60_DAYS | TREND_UP | 36 | 0.023386 | 0.333544 | 0.200051 | 0.246973 | 0.28238 | 0.311234 | 0.339814 | 0.410251 | 21 | 15 |
| LATEST_30_DAYS | GENERAL | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | TREND_UP | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FULL_90_DAYS | GENERAL | 84 | 0.001999 | 0.33613 | 0.163552 | 0.246938 | 0.287524 | 0.315111 | 0.379441 | 0.581718 | 42 | 41 |
| FULL_90_DAYS | TREND_UP | 36 | 0.023386 | 0.333544 | 0.200051 | 0.246973 | 0.28238 | 0.311234 | 0.339814 | 0.410251 | 21 | 15 |

## By leg role

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | CORE | 93 | 0.00996 | 0.368689 | 0.176571 | 0.253675 | 0.295884 | 0.328306 | 0.385247 | 0.549862 | 49 | 43 |
| FIRST_60_DAYS | PYRAMID | 27 | 0.003095 | 0.220532 | 0.167373 | 0.22378 | 0.251871 | 0.264493 | 0.306607 | 0.462822 | 14 | 13 |
| LATEST_30_DAYS | CORE | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | PYRAMID | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FULL_90_DAYS | CORE | 93 | 0.00996 | 0.368689 | 0.176571 | 0.253675 | 0.295884 | 0.328306 | 0.385247 | 0.549862 | 49 | 43 |
| FULL_90_DAYS | PYRAMID | 27 | 0.003095 | 0.220532 | 0.167373 | 0.22378 | 0.251871 | 0.264493 | 0.306607 | 0.462822 | 14 | 13 |
