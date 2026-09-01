# 50-Day Post-Exit 5/10/15/20/30/60-Minute Summary

## Method

- Exact replay window: 2026-05-29 00:00 through 2026-07-18 00:00 (50 days).
- Every broker-confirmed full close is anchored to its immutable original entry/SL/R state.
- BUY post-exit chronology uses executable Bid; SELL uses executable Ask.
- `missed_r` is the maximum additional favorable price movement after the actual exit divided by original risk distance.
- `total_favorable_r` is realized R at exit plus missed R.
- Clean continuation means +0.10R post-exit was reached before -0.10R; immediate reversal means -0.10R was reached first.
- TRANSITION/NO_TRADE messages are absent because this dataset contains executed closed positions only.

## Overall

| period | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_max_adverse_r_5m | avg_missed_r_10m | avg_max_adverse_r_10m | avg_missed_r_15m | avg_max_adverse_r_15m | avg_missed_r_20m | avg_max_adverse_r_20m | avg_missed_r_30m | avg_max_adverse_r_30m | avg_missed_r_60m | avg_max_adverse_r_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_50_DAYS | 96 | 0.06278 | 0.383726 | 0.178105 | 0.161166 | 0.240378 | 0.238328 | 0.282794 | 0.294677 | 0.319151 | 0.335404 | 0.415637 | 0.397866 | 0.690387 | 0.513759 |

## Checkpoint coverage

| period | trades | trades_with_5m_data | historical_data_unavailable_5m | trades_with_10m_data | historical_data_unavailable_10m | trades_with_15m_data | historical_data_unavailable_15m | trades_with_20m_data | historical_data_unavailable_20m | trades_with_30m_data | historical_data_unavailable_30m | trades_with_60m_data | historical_data_unavailable_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_50_DAYS | 96 | 96 | 0 | 96 | 0 | 96 | 0 | 96 | 0 | 96 | 0 | 96 | 0 |

## By regime

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_50_DAYS | BRKT_DN | 2 | -0.412954 | 0.288251 | 0.085509 | 0.112423 | 0.138161 | 0.160374 | 0.17386 | 0.318765 | 1 | 1 |
| FULL_50_DAYS | BRKT_UP | 1 | -1.010051 | 0.29741 | 0.011834 | 0.011834 | 0.011834 | 0.011834 | 0.011834 | 0.011834 | 0 | 1 |
| FULL_50_DAYS | TREND_DN | 56 | 0.055623 | 0.390912 | 0.191058 | 0.254878 | 0.305971 | 0.34935 | 0.47685 | 0.835037 | 25 | 31 |
| FULL_50_DAYS | TREND_UP | 37 | 0.128324 | 0.380343 | 0.168001 | 0.231526 | 0.262856 | 0.290334 | 0.346974 | 0.509885 | 20 | 17 |

## By exit authority

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_50_DAYS | BROKER_SL | 17 | -1.007294 | 0.158344 | 0.178532 | 0.276319 | 0.301042 | 0.329485 | 0.399604 | 0.632011 | 10 | 7 |
| FULL_50_DAYS | PROFIT_CLOSE | 41 | 0.180526 | 0.339513 | 0.11459 | 0.174695 | 0.214126 | 0.234716 | 0.294671 | 0.532131 | 21 | 20 |
| FULL_50_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 38 | 0.414456 | 0.532258 | 0.246444 | 0.295169 | 0.348719 | 0.40563 | 0.553325 | 0.887253 | 15 | 23 |

## By frozen owner-exit profile

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_50_DAYS | BREAKOUT | 3 | -0.611986 | 0.291304 | 0.060951 | 0.078894 | 0.096052 | 0.11086 | 0.119851 | 0.216455 | 1 | 2 |
| FULL_50_DAYS | GENERAL | 93 | 0.084547 | 0.386708 | 0.181884 | 0.245588 | 0.288818 | 0.325871 | 0.425178 | 0.705675 | 45 | 48 |

## By leg role

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_50_DAYS | CORE | 96 | 0.06278 | 0.383726 | 0.178105 | 0.240378 | 0.282794 | 0.319151 | 0.415637 | 0.690387 | 46 | 50 |
