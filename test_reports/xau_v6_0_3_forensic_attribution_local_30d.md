# XAUAI Weekly Attribution Report

Generated: 2026-06-24 07:19:41
Window: last 30 days
Executed memory: `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_ExecutedTradeBrain_XAUUSD.csv`
Blocked memory: `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_BlockedTradeMemory_XAUUSD.csv`
Trading Intelligence dataset: `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_TradingIntelligence_XAUUSD.csv`

## Executive Summary

- Closed trades: 133
- Net profit: $228,874.96
- Win rate: 63.2%
- Profit factor: 1.78
- Expectancy per trade: $1,720.86
- Max realized drawdown from closes: -$122,474.89
- Average floating drawdown: -$5,707.38
- Largest floating loss: -$57,750.00
- Recovery wins: 32

## Protection Rankings

### Most Useful Protection

- `SPREAD_TOO_WIDE`: score 2.04 ATR, saved 3.20 ATR, missed 1.16 ATR
- `PG selective`: score 0.62 ATR, saved 1.44 ATR, missed 0.81 ATR
- `SMART-GUARD`: score 0.44 ATR, saved 1.96 ATR, missed 1.52 ATR
- `NEWS FILTER (high-impact event nearby)`: score 0.15 ATR, saved 2.28 ATR, missed 2.13 ATR
- `A+ TIMING DEMOTION`: score 0.14 ATR, saved 1.51 ATR, missed 1.37 ATR

### Most Expensive Protection

- `DIR-LOCK — SELL side locked until 04`: score -5.27 ATR, saved 0.00 ATR, missed 5.27 ATR
- `ANTI-BIAS BLOCK`: score -1.56 ATR, saved 0.55 ATR, missed 2.10 ATR
- `Trade blocked — momentum slowdown (close in opposite 30% of last`: score -1.48 ATR, saved 0.68 ATR, missed 2.16 ATR
- `EPF-T4 HARD LOCKDOWN`: score -1.25 ATR, saved 0.26 ATR, missed 1.51 ATR
- `Trade blocked — startup`: score -1.03 ATR, saved 0.07 ATR, missed 1.10 ATR

## Signal Grade Validation

| Key | Trades | WR | PF | Net | Exp/trade | Avg DD | Largest DD | Recovery wins | Early exits | Good exits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 65 | 69.2% | 63.28 | $262,026.84 | $4,031.18 | -$4,788.97 | -$47,946.16 | 20 | 74 | 113 |
| B | 23 | 69.6% | 1.92 | $49,155.30 | $2,137.19 | -$6,548.85 | -$28,096.75 | 4 | 44 | 38 |
| A+ | 45 | 51.1% | 0.65 | -$82,307.18 | -$1,829.05 | -$6,603.89 | -$57,750.00 | 8 | 52 | 91 |

## Setup Performance

| Key | Trades | WR | PF | Net | Exp/trade | Avg DD | Largest DD | Recovery wins | Early exits | Good exits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TREND_PULLBACK | 126 | 62.7% | 1.71 | $203,197.08 | $1,612.68 | -$5,842.67 | -$57,750.00 | 30 | 151 | 231 |
| LONDON_FIX_PIN | 2 | 100.0% | inf | $20,627.67 | $10,313.84 | -$7,818.90 | -$15,628.27 | 2 | 2 | 5 |
| UNKNOWN | 5 | 60.0% | 1.67 | $5,050.21 | $1,010.04 | -$1,453.57 | -$6,466.55 | 0 | 17 | 6 |

## Exit Reason Performance

| Key | Trades | WR | PF | Net | Exp/trade | Avg DD | Largest DD | Recovery wins | Early exits | Good exits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASKET HARD-CAP │ peak $52383.85 → $45843.05 (giveback $6540.80) | 2 | 100.0% | inf | $46,627.12 | $23,313.56 | -$15,403.48 | -$27,361.95 | 1 | 0 | 0 |
| BASKET HARD-CAP │ peak $32613.67 → $23546.05 (giveback $9067.62) | 2 | 100.0% | inf | $23,762.27 | $11,881.14 | -$10,570.81 | -$21,090.03 | 1 | 0 | 0 |
| BASKET HARD-CAP │ peak $29132.46 → $21697.20 (giveback $7435.26) | 1 | 100.0% | inf | $21,697.20 | $21,697.20 | -$9,869.58 | -$9,869.58 | 0 | 0 | 0 |
| BASKET HARD-CAP │ peak $32526.70 → $20979.82 (giveback $11546.88) | 2 | 100.0% | inf | $20,799.40 | $10,399.70 | -$14,257.70 | -$27,400.00 | 1 | 0 | 0 |
| BASKET HARD-CAP │ peak $32455.64 → $24301.76 (giveback $8153.88) | 2 | 50.0% | 6.57 | $17,486.63 | $8,743.32 | -$9,378.25 | -$15,628.27 | 1 | 0 | 0 |
| BASKET HARD-CAP │ peak $22304.80 → $17434.16 (giveback $4870.64) | 1 | 100.0% | inf | $17,229.32 | $17,229.32 | -$6,645.92 | -$6,645.92 | 0 | 0 | 0 |
| BASKET HARD-CAP │ peak $23463.60 → $16964.70 (giveback $6498.90) | 2 | 100.0% | inf | $16,606.20 | $8,303.10 | -$6,981.90 | -$13,020.00 | 1 | 0 | 0 |
| BASKET LOCK │ $27100.00 peak → $16150.00 banked | 1 | 100.0% | inf | $16,200.00 | $16,200.00 | -$1,750.00 | -$1,750.00 | 0 | 0 | 0 |
| BASKET HARD-CAP │ peak $21306.81 → $14846.79 (giveback $6460.02) | 2 | 100.0% | inf | $15,820.91 | $7,910.45 | -$712.67 | -$779.38 | 1 | 0 | 0 |
| BASKET LOCK │ $26648.35 peak → $15839.58 banked | 1 | 100.0% | inf | $15,739.96 | $15,739.96 | -$17,831.98 | -$17,831.98 | 1 | 0 | 0 |
| BASKET HARD-CAP │ peak $24354.15 → $14286.35 (giveback $10067.80) | 1 | 100.0% | inf | $14,286.35 | $14,286.35 | -$26,020.30 | -$26,020.30 | 1 | 0 | 0 |
| BASKET HARD-CAP │ peak $25440.80 → $16354.80 (giveback $9086.00) | 3 | 33.3% | 5.73 | $13,838.29 | $4,612.76 | -$1,183.09 | -$2,786.28 | 0 | 0 | 0 |

## Signature Performance

| Key | Trades | WR | PF | Net | Exp/trade | Avg DD | Largest DD | Recovery wins | Early exits | Good exits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TREND_DN|TREND_PULLBACK|-1|LATE|1|1|2 | 9 | 66.7% | 312.60 | $45,668.72 | $5,074.30 | -$5,608.81 | -$26,020.30 | 3 | 0 | 0 |
| TREND_DN|TREND_PULLBACK|-1|NY|1|1|0 | 10 | 60.0% | inf | $44,973.39 | $4,497.34 | -$5,293.49 | -$29,112.60 | 2 | 0 | 0 |
| TREND_DN|TREND_PULLBACK|-1|ASIA|1|1|2 | 13 | 69.2% | 7.66 | $31,445.72 | $2,418.90 | -$1,819.42 | -$9,869.58 | 2 | 0 | 0 |
| TREND_DN|TREND_PULLBACK|-1|LDN|1|2|2 | 3 | 100.0% | inf | $25,549.46 | $8,516.49 | -$16,226.07 | -$47,946.16 | 1 | 0 | 0 |
| TREND_DN|LONDON_FIX_PIN|-1|FIX|1|2|2 | 2 | 100.0% | inf | $20,627.67 | $10,313.84 | -$7,818.90 | -$15,628.27 | 2 | 0 | 0 |
| TREND_DN|TREND_PULLBACK|-1|LATE|1|1|0 | 5 | 80.0% | 827.19 | $19,952.41 | $3,990.48 | -$8,917.70 | -$21,596.90 | 2 | 0 | 0 |
| TREND_UP|TREND_PULLBACK|1|LDN|1|1|0 | 2 | 100.0% | inf | $18,250.13 | $9,125.06 | -$5,092.21 | -$9,490.16 | 0 | 0 | 0 |
| TREND_UP|TREND_PULLBACK|1|LATE|1|0|0 | 4 | 100.0% | inf | $16,532.48 | $4,133.12 | -$448.10 | -$1,750.00 | 0 | 0 | 0 |
| TREND_DN|TREND_PULLBACK|-1|LDN|1|1|1 | 8 | 62.5% | 75.73 | $16,396.70 | $2,049.59 | -$1,775.05 | -$13,020.00 | 2 | 0 | 0 |
| TREND_DN|TREND_PULLBACK|-1|LDN|1|2|1 | 2 | 100.0% | inf | $15,820.91 | $7,910.45 | -$712.67 | -$779.38 | 1 | 0 | 0 |

## Trading Intelligence Dataset QA

| Event | Rows |
|---|---:|
| BLOCK_CHECK | 4073 |
| MARKET_SNAPSHOT | 3018 |
| ACCEL_LEARNING | 907 |
| BLOCKED | 878 |
| POST_CLOSE | 567 |
| CLOSE | 121 |
| OPEN | 69 |
| DATASET_READY | 68 |
| STARTUP_SYNC | 67 |
| CLOUD_SIGNAL | 1 |
| CLOUD_CLOSE | 1 |

### Diagnostics

- Dataset closed trades: 121
- Dataset win rate sanity: 69.8% from 74 wins / 32 losses
- A/A+ losing trades: 27
- Profitable blocked trades: 327
- Late/missed-move executed trades: 62
- Green trades with bad drawdown-before-recovery: 16
- Post-close reports saying exit left profit: 138
- Cloud copy/fanout failures: 0

## Trading Intelligence Block Cost Ranking

| Block reason | Blocked | Checks | Missed 5m ATR | Missed 15m ATR | Missed 30m ATR | Missed 60m ATR | Saved 60m ATR | Protection score | Would-win | Would-loss |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| DIR-LOCK — SELL side locked until 04 | 0 | 5 | 0.75 | 3.21 | 5.27 | 5.27 | 0.00 | -5.27 | 2 | 0 |
| Trade blocked — momentum slowdown (close in opposite 30% of last | 0 | 21 | 0.88 | 1.26 | 1.34 | 2.50 | 0.76 | -1.74 | 3 | 2 |
| ANTI-BIAS BLOCK | 0 | 67 | 0.21 | 0.56 | 0.98 | 2.10 | 0.55 | -1.56 | 7 | 7 |
| EPF-T4 HARD LOCKDOWN | 0 | 5 | 0.00 | 0.00 | 1.48 | 1.51 | 0.26 | -1.25 | 0 | 0 |
| EPF-T4 guarded mode | 0 | 10 | 0.64 | 1.21 | 1.40 | 1.72 | 0.51 | -1.21 | 2 | 1 |
| Trade blocked — startup | 0 | 10 | 0.42 | 0.69 | 0.69 | 1.10 | 0.07 | -1.03 | 0 | 0 |
| A+ EVIDENCE DEMOTION | 0 | 159 | 0.27 | 0.58 | 0.94 | 1.89 | 1.11 | -0.78 | 15 | 20 |
| ANALYSIS-ONLY | 0 | 94 | 0.27 | 0.56 | 0.78 | 1.70 | 1.43 | -0.28 | 4 | 14 |
| NEWS_AFTERMATH | 0 | 10 | 0.10 | 0.30 | 0.91 | 1.55 | 1.35 | -0.20 | 1 | 2 |
| FAILED-IMPULSE BLOCK | 0 | 587 | 0.28 | 0.66 | 1.03 | 1.60 | 1.40 | -0.20 | 35 | 81 |

### A/A+ Losing Trade Samples

| Time | Dir | Setup | Grade | Profit | Worst floating | Entry reason | Exit reason |
|---|---|---|---|---:|---:|---|---|
| 2026.06.17 05:54:08 | BUY | TREND_PULLBACK | A+ | -$58,700.00 | -$57,750.00 | TREND_PULLBACK [A+] | A-grade timing confirmed: pullback continuation entry; not |  |
| 2026.06.17 05:54:08 | BUY | TREND_PULLBACK | A+ | -$58,700.00 | $0.00 | fallback: open record not found |  |
| 2026.06.09 04:06:36 | SELL | TREND_PULLBACK | A+ | -$46,096.00 | -$44,638.08 | TREND_PULLBACK [A+] | A-grade timing confirmed: pullback continuation entry; not |  |
| 2026.06.10 08:29:43 | SELL | TREND_PULLBACK | A+ | -$44,145.01 | -$42,420.95 | TREND_PULLBACK [A+] | A-grade timing confirmed: pullback continuation entry; not | BASKET HARD-CAP │ peak $34797.93 → $26826.45 (giveback $7971.48) |
| 2026.06.09 04:06:37 | SELL | TREND_PULLBACK | A+ | -$8,404.20 | -$8,049.24 | fallback: open record not found |  |
| 2026.06.10 08:29:43 | SELL | TREND_PULLBACK | A+ | -$5,812.30 | -$5,392.40 | fallback: open record not found | BASKET HARD-CAP │ peak $34797.93 → $26826.45 (giveback $7971.48) |
| 2026.06.17 05:54:09 | BUY | TREND_PULLBACK | A+ | -$5,074.89 | -$4,843.66 | fallback: open record not found |  |
| 2026.06.08 02:54:14 | SELL | TREND_PULLBACK | A+ | -$4,466.22 | -$4,419.99 | TREND_PULLBACK [A+] | A-grade timing confirmed: pullback continuation entry; not |  |
| 2026.06.08 14:14:54 | SELL | TREND_PULLBACK | A+ | -$3,137.89 | -$3,128.23 | TREND_PULLBACK [A+] | A-grade timing confirmed: pullback continuation entry; not | BASKET HARD-CAP │ peak $32455.64 → $24301.76 (giveback $8153.88) |
| 2026.06.11 08:32:35 | SELL | TREND_PULLBACK | A | -$2,925.38 | -$2,786.28 | TREND_PULLBACK [A] | A-grade timing confirmed: pullback continuation entry; not  | BASKET HARD-CAP │ peak $25440.80 → $16354.80 (giveback $9086.00) |

## Blocked Trade Intelligence

| Block reason | Blocked | Checks | Missed 5m ATR | Missed 15m ATR | Missed 30m ATR | Missed 60m ATR | Saved 60m ATR | Protection score | Would-win | Would-loss |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| DIR-LOCK — SELL side locked until 04 | 1 | 5 | 0.75 | 3.21 | 5.27 | 5.27 | 0.00 | -5.27 | 2 | 0 |
| ANTI-BIAS BLOCK | 15 | 67 | 0.21 | 0.56 | 0.98 | 2.10 | 0.55 | -1.56 | 7 | 7 |
| Trade blocked — momentum slowdown (close in opposite 30% of last | 6 | 26 | 0.73 | 1.14 | 1.24 | 2.16 | 0.68 | -1.48 | 3 | 2 |
| EPF-T4 HARD LOCKDOWN | 1 | 5 | 0.00 | 0.00 | 1.48 | 1.51 | 0.26 | -1.25 | 0 | 0 |
| Trade blocked — startup | 2 | 10 | 0.42 | 0.69 | 0.69 | 1.10 | 0.07 | -1.03 | 0 | 0 |
| A+ EVIDENCE DEMOTION | 34 | 159 | 0.27 | 0.58 | 0.94 | 1.89 | 1.11 | -0.78 | 15 | 20 |
| Trade blocked — spread | 6 | 30 | 0.40 | 0.45 | 0.84 | 2.01 | 1.47 | -0.54 | 3 | 5 |
| EPF-T4 guarded mode | 3 | 15 | 0.42 | 0.80 | 1.04 | 1.26 | 0.91 | -0.34 | 2 | 3 |
| ANALYSIS-ONLY | 22 | 104 | 0.34 | 0.62 | 0.83 | 1.72 | 1.39 | -0.32 | 5 | 15 |
| FAILED-IMPULSE BLOCK | 154 | 698 | 0.29 | 0.69 | 1.03 | 1.56 | 1.34 | -0.21 | 48 | 98 |
| NEWS_AFTERMATH | 2 | 10 | 0.10 | 0.30 | 0.91 | 1.55 | 1.35 | -0.20 | 1 | 2 |
| BAD-LOCATION BLOCK | 154 | 715 | 0.39 | 0.76 | 1.19 | 1.82 | 1.72 | -0.10 | 71 | 100 |
| B-GRADE QUALITY BLOCK | 154 | 709 | 0.25 | 0.54 | 0.96 | 1.47 | 1.49 | 0.02 | 53 | 118 |
| BAD-RR TIMING BLOCK | 134 | 632 | 0.31 | 0.69 | 1.09 | 1.65 | 1.70 | 0.05 | 63 | 101 |
| LATE-CHASE ENTRY BLOCK | 66 | 312 | 0.27 | 0.64 | 0.88 | 1.33 | 1.38 | 0.05 | 18 | 48 |

## Simplification Audit

| Overlapping protections | Count |
|---|---:|
| B-GRADE QUALITY BLOCK + SMART-GUARD | 11 |
| BAD-RR TIMING BLOCK + SMART-GUARD | 10 |
| BAD-LOCATION BLOCK + BAD-RR TIMING BLOCK | 10 |
| BAD-LOCATION BLOCK + FAILED-IMPULSE BLOCK | 9 |
| BAD-LOCATION BLOCK + SMART-GUARD | 7 |
| FAILED-IMPULSE BLOCK + SMART-GUARD | 7 |
| B-GRADE QUALITY BLOCK + BAD-LOCATION BLOCK | 7 |
| BAD-RR TIMING BLOCK + LATE-CHASE ENTRY BLOCK | 5 |
| B-GRADE QUALITY BLOCK + LATE-CHASE ENTRY BLOCK | 5 |
| FAILED-IMPULSE BLOCK + NEWS FILTER (high-impact event nearby) | 4 |
| A+ TIMING DEMOTION + SMART-GUARD | 4 |
| BAD-RR TIMING BLOCK + FAILED-IMPULSE BLOCK | 4 |

These are candidates for review only. The report does not remove or disable protections.

## Evidence-Based Recommendations

- Review grade `A+`: 45 trades, PF 0.65, expectancy -$1,829.05.
- Review setup `TREND_PULLBACK` entry timing: average floating drawdown -$5,842.67 is large versus expectancy $1,612.68.
- Review block `DIR-LOCK — SELL side locked until 04`: average missed move exceeds saved adverse move by 5.27 ATR.
- Review block `ANTI-BIAS BLOCK`: average missed move exceeds saved adverse move by 1.56 ATR.
- Review block `Trade blocked — momentum slowdown (close in opposite 30% of last`: average missed move exceeds saved adverse move by 1.48 ATR.

## Interpretation Rules

- This report is evidence, not an automatic tuning command.
- A high win rate with weak profit factor is not good enough.
- A green trade with large MAE and small profit is flagged as poor timing.
- A block reason with high missed ATR and low saved ATR should be reviewed.
- A redundant protection pair should be reviewed only after enough repeated overlaps.
