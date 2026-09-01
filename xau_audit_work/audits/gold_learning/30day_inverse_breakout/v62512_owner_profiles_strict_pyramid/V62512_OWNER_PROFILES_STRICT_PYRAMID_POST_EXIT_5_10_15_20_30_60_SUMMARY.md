# 30-Day Post-Exit 5/10/15/20/30/60-Minute Summary

## Method

- Exact replay window: 2026-06-18 00:00 through 2026-07-18 00:00 (30 days).
- Every broker-confirmed full close is anchored to its immutable original entry/SL/R state.
- BUY post-exit chronology uses executable Bid; SELL uses executable Ask.
- `missed_r` is the maximum additional favorable price movement after the actual exit divided by original risk distance.
- `total_favorable_r` is realized R at exit plus missed R.
- Clean continuation means +0.10R post-exit was reached before -0.10R; immediate reversal means -0.10R was reached first.
- TRANSITION/NO_TRADE messages are absent because this dataset contains executed closed positions only.

## Overall

| period | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_max_adverse_r_5m | avg_missed_r_10m | avg_max_adverse_r_10m | avg_missed_r_15m | avg_max_adverse_r_15m | avg_missed_r_20m | avg_max_adverse_r_20m | avg_missed_r_30m | avg_max_adverse_r_30m | avg_missed_r_60m | avg_max_adverse_r_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | 62 | 0.116585 | 0.403364 | 0.186648 | 0.181028 | 0.230034 | 0.258552 | 0.273966 | 0.319369 | 0.307542 | 0.355081 | 0.429023 | 0.418563 | 0.77069 | 0.540473 |

## Checkpoint coverage

| period | trades | trades_with_5m_data | historical_data_unavailable_5m | trades_with_10m_data | historical_data_unavailable_10m | trades_with_15m_data | historical_data_unavailable_15m | trades_with_20m_data | historical_data_unavailable_20m | trades_with_30m_data | historical_data_unavailable_30m | trades_with_60m_data | historical_data_unavailable_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | 62 | 62 | 0 | 62 | 0 | 62 | 0 | 62 | 0 | 62 | 0 | 62 | 0 |

## By regime

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | BRKT_DN | 1 | -1.001225 | 0.25504 | 0.088726 | 0.142555 | 0.167057 | 0.193043 | 0.193043 | 0.193043 | 0 | 1 |
| FULL_30_DAYS | BRKT_UP | 1 | -1.010053 | 0.29741 | 0.011834 | 0.011834 | 0.011834 | 0.011834 | 0.011834 | 0.011834 | 0 | 1 |
| FULL_30_DAYS | TREND_DN | 44 | 0.151098 | 0.422108 | 0.197474 | 0.239928 | 0.286648 | 0.324289 | 0.458447 | 0.849762 | 15 | 29 |
| FULL_30_DAYS | TREND_UP | 16 | 0.161953 | 0.367711 | 0.173923 | 0.22193 | 0.262154 | 0.287125 | 0.388932 | 0.636773 | 9 | 7 |

## By exit authority

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | BROKER_SL | 9 | -1.005773 | 0.170371 | 0.13082 | 0.270434 | 0.309449 | 0.31668 | 0.371923 | 0.59058 | 5 | 4 |
| FULL_30_DAYS | PROFIT_CLOSE | 26 | 0.18369 | 0.346608 | 0.115357 | 0.145628 | 0.194799 | 0.220176 | 0.301129 | 0.568162 | 10 | 16 |
| FULL_30_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 27 | 0.426086 | 0.535682 | 0.273908 | 0.297846 | 0.338373 | 0.388626 | 0.571214 | 1.025753 | 9 | 18 |

## By frozen owner-exit profile

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | BREAKOUT | 2 | -1.005639 | 0.276225 | 0.05028 | 0.077194 | 0.089446 | 0.102439 | 0.102439 | 0.102439 | 0 | 2 |
| FULL_30_DAYS | GENERAL | 60 | 0.153993 | 0.407602 | 0.191193 | 0.235128 | 0.280117 | 0.314379 | 0.439909 | 0.792965 | 24 | 36 |

## By leg role

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | CORE | 62 | 0.116585 | 0.403364 | 0.186648 | 0.230034 | 0.273966 | 0.307542 | 0.429023 | 0.77069 | 24 | 38 |
