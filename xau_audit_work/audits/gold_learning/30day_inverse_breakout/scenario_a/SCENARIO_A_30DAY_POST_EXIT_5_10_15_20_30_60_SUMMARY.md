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
| FIRST_60_DAYS | 0 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| LATEST_30_DAYS | 83 | -0.092697 | 0.436486 | 0.168727 | 0.178958 | 0.228257 | 0.234195 | 0.259694 | 0.303609 | 0.3172 | 0.33972 | 0.421954 | 0.453601 | 0.617052 | 0.606937 |
| FULL_90_DAYS | 83 | -0.092697 | 0.436486 | 0.168727 | 0.178958 | 0.228257 | 0.234195 | 0.259694 | 0.303609 | 0.3172 | 0.33972 | 0.421954 | 0.453601 | 0.617052 | 0.606937 |

## Checkpoint coverage

| period | trades | trades_with_5m_data | historical_data_unavailable_5m | trades_with_10m_data | historical_data_unavailable_10m | trades_with_15m_data | historical_data_unavailable_15m | trades_with_20m_data | historical_data_unavailable_20m | trades_with_30m_data | historical_data_unavailable_30m | trades_with_60m_data | historical_data_unavailable_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| LATEST_30_DAYS | 83 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 |
| FULL_90_DAYS | 83 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 | 83 | 0 |

## By regime

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | CHOPPY | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FIRST_60_DAYS | RANGING | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FIRST_60_DAYS | TREND_DN | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FIRST_60_DAYS | TREND_UP | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | CHOPPY | 1 | 0.508976 | 0.711652 | 0.231628 | 0.231628 | 0.231628 | 0.231628 | 0.554688 | 1.231286 | 0 | 1 |
| LATEST_30_DAYS | RANGING | 5 | 0.099282 | 0.49973 | 0.199605 | 0.25131 | 0.273713 | 0.295991 | 0.307863 | 0.360402 | 3 | 2 |
| LATEST_30_DAYS | TREND_DN | 52 | -0.126272 | 0.404533 | 0.170138 | 0.21544 | 0.245244 | 0.293719 | 0.414726 | 0.610994 | 24 | 28 |
| LATEST_30_DAYS | TREND_UP | 25 | -0.085324 | 0.479293 | 0.157102 | 0.250169 | 0.288069 | 0.373703 | 0.454498 | 0.656413 | 16 | 9 |
| FULL_90_DAYS | CHOPPY | 1 | 0.508976 | 0.711652 | 0.231628 | 0.231628 | 0.231628 | 0.231628 | 0.554688 | 1.231286 | 0 | 1 |
| FULL_90_DAYS | RANGING | 5 | 0.099282 | 0.49973 | 0.199605 | 0.25131 | 0.273713 | 0.295991 | 0.307863 | 0.360402 | 3 | 2 |
| FULL_90_DAYS | TREND_DN | 52 | -0.126272 | 0.404533 | 0.170138 | 0.21544 | 0.245244 | 0.293719 | 0.414726 | 0.610994 | 24 | 28 |
| FULL_90_DAYS | TREND_UP | 25 | -0.085324 | 0.479293 | 0.157102 | 0.250169 | 0.288069 | 0.373703 | 0.454498 | 0.656413 | 16 | 9 |

## By exit authority

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | BROKER_SL | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FIRST_60_DAYS | PROFIT_CLOSE | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FIRST_60_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | BROKER_SL | 32 | -0.955416 | 0.206551 | 0.202592 | 0.260044 | 0.292584 | 0.331515 | 0.387309 | 0.514288 | 20 | 12 |
| LATEST_30_DAYS | PROFIT_CLOSE | 5 | 0.562174 | 0.562174 | 0.142599 | 0.186764 | 0.214794 | 0.298833 | 0.373297 | 0.627165 | 2 | 3 |
| LATEST_30_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 46 | 0.436274 | 0.582779 | 0.148009 | 0.210654 | 0.241694 | 0.309238 | 0.451343 | 0.687441 | 21 | 25 |
| FULL_90_DAYS | BROKER_SL | 32 | -0.955416 | 0.206551 | 0.202592 | 0.260044 | 0.292584 | 0.331515 | 0.387309 | 0.514288 | 20 | 12 |
| FULL_90_DAYS | PROFIT_CLOSE | 5 | 0.562174 | 0.562174 | 0.142599 | 0.186764 | 0.214794 | 0.298833 | 0.373297 | 0.627165 | 2 | 3 |
| FULL_90_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 46 | 0.436274 | 0.582779 | 0.148009 | 0.210654 | 0.241694 | 0.309238 | 0.451343 | 0.687441 | 21 | 25 |

## By frozen owner-exit profile

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | GENERAL | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FIRST_60_DAYS | TREND_UP | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | GENERAL | 57 | -0.104737 | 0.41348 | 0.176786 | 0.222363 | 0.251518 | 0.297695 | 0.414796 | 0.610327 | 27 | 30 |
| LATEST_30_DAYS | TREND_UP | 26 | -0.066302 | 0.486924 | 0.151059 | 0.241176 | 0.277618 | 0.359959 | 0.437646 | 0.631796 | 16 | 10 |
| FULL_90_DAYS | GENERAL | 57 | -0.104737 | 0.41348 | 0.176786 | 0.222363 | 0.251518 | 0.297695 | 0.414796 | 0.610327 | 27 | 30 |
| FULL_90_DAYS | TREND_UP | 26 | -0.066302 | 0.486924 | 0.151059 | 0.241176 | 0.277618 | 0.359959 | 0.437646 | 0.631796 | 16 | 10 |

## By leg role

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | CORE | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FIRST_60_DAYS | PYRAMID | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | CORE | 50 | 0.052172 | 0.478808 | 0.171592 | 0.222861 | 0.257256 | 0.306137 | 0.414079 | 0.615277 | 29 | 21 |
| LATEST_30_DAYS | PYRAMID | 33 | -0.312196 | 0.372362 | 0.164387 | 0.236432 | 0.263388 | 0.33396 | 0.433886 | 0.619742 | 14 | 19 |
| FULL_90_DAYS | CORE | 50 | 0.052172 | 0.478808 | 0.171592 | 0.222861 | 0.257256 | 0.306137 | 0.414079 | 0.615277 | 29 | 21 |
| FULL_90_DAYS | PYRAMID | 33 | -0.312196 | 0.372362 | 0.164387 | 0.236432 | 0.263388 | 0.33396 | 0.433886 | 0.619742 | 14 | 19 |
