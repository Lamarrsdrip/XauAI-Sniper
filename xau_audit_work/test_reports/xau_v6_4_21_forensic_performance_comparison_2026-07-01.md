# XAU AI Sniper v6.4.21 Forensic Performance Comparison

Date: 2026-07-01

## Evidence Sources

- MT5 Common Files: `XAUAI_ExecutedTradeBrain_XAUUSD.csv`
- MT5 Common Files: `XAUAI_BlockedTradeMemory_XAUUSD.csv`
- MT5 Common Files: `XAUAI_TradingIntelligence_XAUUSD.jsonl`
- MT5 forward reports: `XAUAI_ForwardTest_2026.06.26.txt`, `XAUAI_ForwardTest_2026.06.29.txt`, `XAUAI_ForwardTest_2026.06.30.txt`, `XAUAI_ForwardTest_2026.07.01.txt`
- User MT5 screenshots from June 17-19 and June 29-30.

## Period Definitions

- Period A: 2026.06.17 through 2026.06.19, before the heavy AI Director/protection stack on the $3k retail account.
- Period B: 2026.06.28 through 2026.07.01, after AI Director/protection stack was active in reports/logs.

## Data Integrity Note

The raw Period A trade memory contains big-account rows, including `50.00` lot losses of `-$58,700` and `12.17` lot losses of `-$5,074.89`, around early 2026.06.17. These records do not match the $3k account screenshots or normal retail XAUUSD lot behavior. Per user correction, June 16 was a big account, and the memory file shows that big-account contamination continues into the early June 17 raw rows. For this reason the audit reports both:

- Raw memory result: all rows as recorded.
- Retail-filtered result: rows with lot size <= 1.00, matching the $3k account context shown in MT5 screenshots.

The retail-filtered result is the fair comparison for the user's $3k account behavior.

## Performance Summary

| Metric | Period A raw | Period A retail-filtered | Period B |
|---|---:|---:|---:|
| Trades | 33 | 29 | 30 |
| Net profit | -$122,126.01 | +$348.88 | -$264.90 |
| Gross profit | +$744.17 | +$744.17 | +$653.72 |
| Gross loss | -$122,870.18 | -$395.29 | -$918.62 |
| Profit factor | 0.01 | 1.88 | 0.71 |
| Win rate | 57.6% | 65.5% | 63.3% |
| Average win | +$39.17 | +$39.17 | +$34.41 |
| Average loss | -$12,287.02 | -$56.47 | -$83.51 |
| Max drawdown by closed P/L | -$122,474.89 | -$366.99 | -$573.71 |
| Average lot | 3.812 | 0.050 | 0.108 |
| Median lot | 0.060 | 0.040 | 0.075 |
| Min lot | 0.010 | 0.010 | 0.010 |
| Max lot | 50.000 | 0.150 | 0.400 |

## Grade Performance

### Period A Retail-Filtered

| Grade | Trades | Net | Win rate | Avg lot |
|---|---:|---:|---:|---:|
| A | 20 | +$179.03 | 65.0% | 0.049 |
| A+ | 7 | -$31.55 | 71.4% | 0.050 |
| B | 2 | +$201.40 | 50.0% | 0.060 |

### Period B

| Grade | Trades | Net | Win rate | Avg lot |
|---|---:|---:|---:|---:|
| A | 4 | -$75.10 | 50.0% | 0.085 |
| A+ | 22 | -$289.75 | 63.6% | 0.113 |
| B | 4 | +$99.95 | 75.0% | 0.108 |

## Lot Behavior Evidence

Period A retail-filtered lots were usually 0.01-0.15 in the local trade memory, while the screenshots show the same June window also had normal $3k account trades such as 0.16, 0.23, 0.27 and strong closes of +$303, +$318 and +$530. Period B still had some 0.15-0.40 lots on June 29-30, but the latest v6.4.20 behavior collapsed to 0.01-0.05 because real XAU SL-risk math was introduced and wide stops reduced raw lot size.

Confirmed v6.4.20 examples from live logs:

| Trade | Grade | Entry | SL | SL distance | Real-risk result | Final lot | Root cause |
|---|---|---:|---:|---:|---:|---:|---|
| SELL | A | 4042.09 | 4061.36 | 19.27 | raw lot about 0.019 | 0.02 | OrderCalcProfit SL-risk math |
| SELL | A+ | 3986.60 | 3994.80 | 8.20 | raw lot about 0.049 | 0.05 | OrderCalcProfit SL-risk math |
| SELL | A | 4101.11 | 4138.18 | 37.07 | raw lot about 0.0098 | 0.01 | wide SL + real-risk math |

Conclusion: the small lots were not mainly caused by confidence multipliers. The dominant cause was real XAU risk math combined with wide SL distance. That math is safer, but it does not reproduce June 16-19 balance-based aggression.

## Blocked And Missed Trade Evidence

| Metric | Period A | Period B |
|---|---:|---:|
| Block/check rows | 1,084 | 1,069 |
| Intelligence rows | 2,358 | 2,022 |
| Block-like intelligence rows | 1,078 | 999 |
| `wouldTP2R` blocked/check rows | 106 | 135 |
| `wouldSL1R` blocked/check rows | 254 | 210 |

Period B forward reports confirm over-filtering:

- `XAUAI_ForwardTest_2026.06.30.txt`: v6.4.14, 26 signals, 0 trades opened, AI Director blocked 10, report diagnosis: severe over-filtering.
- `XAUAI_ForwardTest_2026.07.01.txt`: v6.4.20, managing 1 position, report had 0 generated signals because indicator recovery backoff was active, so gate reporting undercounted live intelligence activity.

## Entry Timing And Signal Quality

- Period A retail-filtered entries had average parsed timing quality around 96.2 where available.
- Period B had average parsed timing quality around 86.0 where available.
- Period B had higher parsed setup/combined score around 6.60 versus Period A around 5.34, meaning the newer system was stricter about quality, but did not translate that strictness into better net profit.

This supports the user's concern: later filtering improved score strictness, but the system became too selective and still allowed losses large enough to erase many wins.

## Exit Giveback Evidence

The executed trade memory contains post-close review markers, but not a consistent numeric peak-profit/giveback field for all trades. Marker counts:

- Period A post-close review rows: 143; early-exit markers: 50.
- Period B post-close review rows: 134; early-exit markers: 82.

This supports the hypothesis that the newer system often cut or reviewed exits as early, increasing re-entry pressure. The screenshots also show this pattern: profitable sells were closed for moderate profit, then later sells were opened lower and caught reversal losses.

## Which System Grew Better

Using the retail-filtered $3k-account evidence:

1. Old strategy without heavy AI Director/protection grew better in Period A: +$348.88, profit factor 1.88.
2. Current AI Director/protection stack was worse in Period B: -$264.90, profit factor 0.71.
3. Hybrid strategy is the correct path: keep improved scoring and real-risk mode available, but make AI Director an advisor/score input in normal growth modes, restore June balance-based lot behavior as a selectable/default mode, and downgrade soft blockers to warnings when the market context is strong.

## v6.4.21 Implementation Decision

v6.4.21 implements the hybrid:

- Adds `InpTradeMode`: `SAFE_MODE`, `BALANCED_MODE`, `AGGRESSIVE_GROWTH_MODE`.
- Adds `InpLotSizingMode`: `REAL_RISK_MODE`, `JUNE_16_19_BALANCE_MODE`.
- Defaults to `JUNE_16_19_BALANCE_MODE` to restore June-style balance-based lots.
- Keeps `REAL_RISK_MODE` available for stricter SL-dollar sizing.
- In June mode, lot size is based mainly on account balance and grade, not wide SL distance.
- In June mode, Growth Guard lot cap, single-risk cap, aggregate basket cap, and OrderCalcProfit raw sizing no longer force micro-lots.
- Keeps broker min/max, `InpMaxLots`, and margin safety.
- Pyramids scale from the restored base behavior and do not default to 0.01 solely because of real-risk caps.
- AI Director low-confidence skips, normal news aftermath, Smart Guard fast-confirm waits, and STI re-entry waits are downgraded from hard veto to contextual warning in Balanced/Aggressive modes.
- True danger remains hard-blocked: extreme spread, hard scheduled news, invalid SL/RR, failed impulse, no margin, and true high-conviction AI contradiction.

## Root Cause

The bot became too defensive through two stacked changes:

1. Lot sizing changed from June-style balance-based sizing to real XAU SL-risk sizing. With wide XAU stops, correct real-dollar risk math naturally produces 0.01-0.05 lots on a $3k account.
2. AI Director/protection blockers became boss/veto layers instead of advisor layers. Forward reports and intelligence logs show heavy blocking and missed 2R candidates.

## Risk Note

June balance mode intentionally restores growth aggression. It can risk materially more at the SL than real-risk mode when the stop is wide. That is the behavior requested, and it is now explicit, visible in logs, and selectable instead of hidden.
