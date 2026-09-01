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
| FIRST_60_DAYS | 135 | -0.002304 | 0.362338 | 0.174072 | 0.184061 | 0.253045 | 0.24978 | 0.292997 | 0.307506 | 0.335649 | 0.362766 | 0.393987 | 0.451181 | 0.563328 | 0.613166 |
| LATEST_30_DAYS | 74 | 0.088904 | 0.388076 | 0.195749 | 0.182531 | 0.248614 | 0.259648 | 0.288821 | 0.319577 | 0.325521 | 0.359227 | 0.441193 | 0.449234 | 0.7885 | 0.605151 |
| FULL_90_DAYS | 209 | 0.029989 | 0.371451 | 0.181747 | 0.183519 | 0.251476 | 0.253274 | 0.291519 | 0.31178 | 0.332063 | 0.361513 | 0.410701 | 0.450492 | 0.643054 | 0.610328 |

## Checkpoint coverage

| period | trades | trades_with_5m_data | historical_data_unavailable_5m | trades_with_10m_data | historical_data_unavailable_10m | trades_with_15m_data | historical_data_unavailable_15m | trades_with_20m_data | historical_data_unavailable_20m | trades_with_30m_data | historical_data_unavailable_30m | trades_with_60m_data | historical_data_unavailable_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | 135 | 135 | 0 | 135 | 0 | 135 | 0 | 135 | 0 | 135 | 0 | 135 | 0 |
| LATEST_30_DAYS | 74 | 74 | 0 | 74 | 0 | 74 | 0 | 74 | 0 | 74 | 0 | 74 | 0 |
| FULL_90_DAYS | 209 | 209 | 0 | 209 | 0 | 209 | 0 | 209 | 0 | 209 | 0 | 209 | 0 |

## By regime

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | CHOPPY | 3 | 0.329995 | 0.422423 | 0.1034 | 0.1034 | 0.1034 | 0.1034 | 0.108801 | 0.359749 | 1 | 2 |
| FIRST_60_DAYS | RANGING | 2 | 0.392322 | 0.582993 | 0.208953 | 0.208953 | 0.208953 | 0.208953 | 0.208953 | 0.276151 | 1 | 1 |
| FIRST_60_DAYS | TREND_DN | 79 | -0.048077 | 0.356859 | 0.170131 | 0.27165 | 0.325322 | 0.378811 | 0.461555 | 0.675827 | 45 | 34 |
| FIRST_60_DAYS | TREND_UP | 51 | 0.033577 | 0.358637 | 0.182966 | 0.234757 | 0.257374 | 0.287421 | 0.313355 | 0.412302 | 31 | 20 |
| LATEST_30_DAYS | CHOPPY | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | RANGING | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| LATEST_30_DAYS | TREND_DN | 53 | 0.078795 | 0.400166 | 0.203451 | 0.262405 | 0.305421 | 0.348143 | 0.467817 | 0.865015 | 21 | 32 |
| LATEST_30_DAYS | TREND_UP | 21 | 0.114417 | 0.357564 | 0.176311 | 0.213809 | 0.246929 | 0.268426 | 0.373999 | 0.595391 | 11 | 10 |
| FULL_90_DAYS | CHOPPY | 3 | 0.329995 | 0.422423 | 0.1034 | 0.1034 | 0.1034 | 0.1034 | 0.108801 | 0.359749 | 1 | 2 |
| FULL_90_DAYS | RANGING | 2 | 0.392322 | 0.582993 | 0.208953 | 0.208953 | 0.208953 | 0.208953 | 0.208953 | 0.276151 | 1 | 1 |
| FULL_90_DAYS | TREND_DN | 132 | 0.002864 | 0.374248 | 0.18351 | 0.267938 | 0.317331 | 0.366498 | 0.464069 | 0.751789 | 66 | 66 |
| FULL_90_DAYS | TREND_UP | 72 | 0.057155 | 0.358324 | 0.181025 | 0.228648 | 0.254328 | 0.281881 | 0.331043 | 0.465703 | 42 | 30 |

## By exit authority

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | BROKER_SL | 31 | -1.010926 | 0.128123 | 0.223563 | 0.317328 | 0.341926 | 0.367186 | 0.438417 | 0.606105 | 20 | 11 |
| FIRST_60_DAYS | PROFIT_CLOSE | 54 | 0.187216 | 0.34732 | 0.154243 | 0.218157 | 0.236 | 0.285076 | 0.346628 | 0.520566 | 33 | 21 |
| FIRST_60_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 49 | 0.423039 | 0.527436 | 0.167194 | 0.255015 | 0.329862 | 0.377309 | 0.425137 | 0.591172 | 25 | 24 |
| FIRST_60_DAYS | WEEKEND_CLOSE | 1 | 0.189064 | 0.344192 | 0.047658 | 0.047658 | 0.047658 | 0.047658 | 0.047658 | 0.182055 | 0 | 1 |
| LATEST_30_DAYS | BROKER_SL | 12 | -1.005848 | 0.130613 | 0.198055 | 0.305052 | 0.349378 | 0.377382 | 0.451706 | 0.716242 | 8 | 4 |
| LATEST_30_DAYS | PROFIT_CLOSE | 32 | 0.181031 | 0.34302 | 0.123937 | 0.159745 | 0.201907 | 0.224149 | 0.296835 | 0.526422 | 13 | 19 |
| LATEST_30_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 30 | 0.428535 | 0.539121 | 0.271425 | 0.320832 | 0.357307 | 0.412907 | 0.590968 | 1.096952 | 11 | 19 |
| LATEST_30_DAYS | WEEKEND_CLOSE | 0 |  |  |  |  |  |  |  |  | 0 | 0 |
| FULL_90_DAYS | BROKER_SL | 43 | -1.009509 | 0.128818 | 0.216444 | 0.313902 | 0.344006 | 0.370032 | 0.442126 | 0.636841 | 28 | 15 |
| FULL_90_DAYS | PROFIT_CLOSE | 86 | 0.184915 | 0.34572 | 0.142967 | 0.196422 | 0.223315 | 0.262405 | 0.3281 | 0.522745 | 46 | 40 |
| FULL_90_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 79 | 0.425126 | 0.531874 | 0.206775 | 0.280009 | 0.340284 | 0.390827 | 0.488111 | 0.78324 | 36 | 43 |
| FULL_90_DAYS | WEEKEND_CLOSE | 1 | 0.189064 | 0.344192 | 0.047658 | 0.047658 | 0.047658 | 0.047658 | 0.047658 | 0.182055 | 0 | 1 |

## By frozen owner-exit profile

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | GENERAL | 135 | -0.002304 | 0.362338 | 0.174072 | 0.253045 | 0.292997 | 0.335649 | 0.393987 | 0.563328 | 78 | 57 |
| LATEST_30_DAYS | GENERAL | 74 | 0.088904 | 0.388076 | 0.195749 | 0.248614 | 0.288821 | 0.325521 | 0.441193 | 0.7885 | 32 | 42 |
| FULL_90_DAYS | GENERAL | 209 | 0.029989 | 0.371451 | 0.181747 | 0.251476 | 0.291519 | 0.332063 | 0.410701 | 0.643054 | 110 | 99 |

## By leg role

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIRST_60_DAYS | CORE | 135 | -0.002304 | 0.362338 | 0.174072 | 0.253045 | 0.292997 | 0.335649 | 0.393987 | 0.563328 | 78 | 57 |
| LATEST_30_DAYS | CORE | 74 | 0.088904 | 0.388076 | 0.195749 | 0.248614 | 0.288821 | 0.325521 | 0.441193 | 0.7885 | 32 | 42 |
| FULL_90_DAYS | CORE | 209 | 0.029989 | 0.371451 | 0.181747 | 0.251476 | 0.291519 | 0.332063 | 0.410701 | 0.643054 | 110 | 99 |
