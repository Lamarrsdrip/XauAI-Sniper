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
| FULL_30_DAYS | 79 | 0.019299 | 0.383119 | 0.128815 | 0.180886 | 0.172687 | 0.233472 | 0.214231 | 0.293657 | 0.256691 | 0.316155 | 0.344757 | 0.370228 | 0.555629 | 0.488686 |

## Checkpoint coverage

| period | trades | trades_with_5m_data | historical_data_unavailable_5m | trades_with_10m_data | historical_data_unavailable_10m | trades_with_15m_data | historical_data_unavailable_15m | trades_with_20m_data | historical_data_unavailable_20m | trades_with_30m_data | historical_data_unavailable_30m | trades_with_60m_data | historical_data_unavailable_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | 79 | 79 | 0 | 79 | 0 | 79 | 0 | 79 | 0 | 79 | 0 | 79 | 0 |

## By regime

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | BRKT_DN | 2 | -0.347033 | 0.337246 | 0.050968 | 0.077883 | 0.090134 | 0.103127 | 0.103127 | 0.103127 | 0 | 2 |
| FULL_30_DAYS | BRKT_UP | 1 | -1.010054 | 0.29741 | 0.011834 | 0.011834 | 0.011834 | 0.011834 | 0.011834 | 0.011834 | 0 | 1 |
| FULL_30_DAYS | RANGING | 2 | -0.398032 | 0.322883 | 0.116468 | 0.163014 | 0.202382 | 0.242676 | 0.242676 | 0.320022 | 1 | 1 |
| FULL_30_DAYS | TREND_DN | 50 | 0.074511 | 0.412443 | 0.132421 | 0.178088 | 0.217485 | 0.240996 | 0.34709 | 0.609594 | 21 | 29 |
| FULL_30_DAYS | TREND_UP | 24 | 0.01247 | 0.334439 | 0.133693 | 0.176843 | 0.227214 | 0.313555 | 0.382411 | 0.523205 | 14 | 10 |

## By exit authority

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | BROKER_SL | 17 | -1.004042 | 0.173067 | 0.158331 | 0.255159 | 0.290961 | 0.330397 | 0.395042 | 0.580369 | 12 | 5 |
| FULL_30_DAYS | PROFIT_CLOSE | 32 | 0.187163 | 0.351458 | 0.106607 | 0.130282 | 0.179208 | 0.239011 | 0.305689 | 0.513684 | 14 | 18 |
| FULL_30_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 30 | 0.420137 | 0.535919 | 0.135778 | 0.171183 | 0.208109 | 0.233783 | 0.357935 | 0.586352 | 10 | 20 |

## By frozen owner-exit profile

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | GENERAL | 54 | 0.018736 | 0.404573 | 0.128587 | 0.173592 | 0.211983 | 0.235726 | 0.333961 | 0.579884 | 22 | 32 |
| FULL_30_DAYS | TREND_UP | 25 | 0.020516 | 0.336777 | 0.129307 | 0.170731 | 0.219088 | 0.301975 | 0.368077 | 0.503239 | 14 | 11 |

## By leg role

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | CORE | 53 | 0.101395 | 0.406094 | 0.131144 | 0.175757 | 0.220378 | 0.2583 | 0.346055 | 0.57103 | 23 | 30 |
| FULL_30_DAYS | PYRAMID | 26 | -0.14805 | 0.336285 | 0.124068 | 0.166429 | 0.201702 | 0.253411 | 0.342111 | 0.524236 | 13 | 13 |
