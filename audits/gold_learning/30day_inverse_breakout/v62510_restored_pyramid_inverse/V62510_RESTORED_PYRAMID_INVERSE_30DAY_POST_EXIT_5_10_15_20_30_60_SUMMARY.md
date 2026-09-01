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
| FULL_30_DAYS | 76 | -0.091551 | 0.45288 | 0.171169 | 0.178059 | 0.232758 | 0.231151 | 0.267794 | 0.278872 | 0.315936 | 0.314381 | 0.410186 | 0.415737 | 0.598363 | 0.548946 |

## Checkpoint coverage

| period | trades | trades_with_5m_data | historical_data_unavailable_5m | trades_with_10m_data | historical_data_unavailable_10m | trades_with_15m_data | historical_data_unavailable_15m | trades_with_20m_data | historical_data_unavailable_20m | trades_with_30m_data | historical_data_unavailable_30m | trades_with_60m_data | historical_data_unavailable_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | 76 | 76 | 0 | 76 | 0 | 76 | 0 | 76 | 0 | 76 | 0 | 76 | 0 |

## By regime

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | BRKT_DN | 3 | -0.094941 | 0.450727 | 0.033979 | 0.057374 | 0.065542 | 0.074204 | 0.074204 | 0.074204 | 0 | 3 |
| FULL_30_DAYS | CHOPPY | 1 | 0.508976 | 0.711652 | 0.231628 | 0.231628 | 0.231628 | 0.231628 | 0.554688 | 1.231286 | 0 | 1 |
| FULL_30_DAYS | RANGING | 6 | -0.32134 | 0.382062 | 0.174441 | 0.214802 | 0.244363 | 0.295737 | 0.30563 | 0.382221 | 3 | 3 |
| FULL_30_DAYS | TREND_DN | 42 | -0.046883 | 0.445067 | 0.162906 | 0.212183 | 0.243671 | 0.294097 | 0.419671 | 0.614529 | 20 | 22 |
| FULL_30_DAYS | TREND_UP | 24 | -0.136872 | 0.473745 | 0.199441 | 0.295223 | 0.342655 | 0.392934 | 0.455703 | 0.663256 | 17 | 7 |

## By exit authority

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | BROKER_SL | 29 | -0.949984 | 0.224593 | 0.167296 | 0.226939 | 0.261829 | 0.300974 | 0.341839 | 0.451031 | 17 | 12 |
| FULL_30_DAYS | PROFIT_CLOSE | 6 | 0.529167 | 0.529167 | 0.132431 | 0.257949 | 0.329186 | 0.399219 | 0.461272 | 0.7096 | 2 | 4 |
| FULL_30_DAYS | SL_MOD:OWNER_R_EXIT_FLOOR | 41 | 0.424796 | 0.603188 | 0.179578 | 0.233187 | 0.263029 | 0.314331 | 0.451052 | 0.686295 | 21 | 20 |

## By frozen owner-exit profile

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | GENERAL | 51 | -0.080044 | 0.438653 | 0.161221 | 0.207605 | 0.237495 | 0.285576 | 0.396488 | 0.579237 | 23 | 28 |
| FULL_30_DAYS | TREND_UP | 25 | -0.115027 | 0.481903 | 0.191463 | 0.284068 | 0.329603 | 0.377871 | 0.438129 | 0.63738 | 17 | 8 |

## By leg role

| period | value | trades | avg_realized_r | avg_peak_r_while_open | avg_missed_r_5m | avg_missed_r_10m | avg_missed_r_15m | avg_missed_r_20m | avg_missed_r_30m | avg_missed_r_60m | clean_continuation_count_60m | immediate_reversal_count_60m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FULL_30_DAYS | CORE | 44 | 0.066258 | 0.498258 | 0.169021 | 0.223788 | 0.259686 | 0.313549 | 0.422793 | 0.620951 | 25 | 19 |
| FULL_30_DAYS | PYRAMID | 32 | -0.30854 | 0.390486 | 0.174124 | 0.24509 | 0.278943 | 0.319218 | 0.392851 | 0.567304 | 15 | 17 |
