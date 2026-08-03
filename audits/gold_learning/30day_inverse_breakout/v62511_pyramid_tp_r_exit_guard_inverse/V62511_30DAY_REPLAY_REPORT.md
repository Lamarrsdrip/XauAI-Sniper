# v6.25.11 30-Day Replay Report

## Run identity

- Window: 2026-06-18 00:00 through 2026-07-18 00:00.
- Symbol/timeframe: XAUUSD M10.
- Tick model: MT5 real ticks (`Model=4`).
- Starting balance: $10,000.00 USD.
- EA: v6.25.11, build `v62511-pyramid-tp-r-exit-state-guard-20260718`.
- Source commit: `b79118c`.
- EX5 SHA-256: `3087d3f1a10d05a3f9c0002df759eb5df7325ef549fd546de19c947ec07bfc16`.
- Input SHA-256: `bb63f7fd7658b9072737882a898d013a5ede5986531bdba9e8cf24c499f612c8`.
- Counter Excursion: OFF.
- BRKT_UP/BRKT_DN: inverse final execution direction.
- Non-breakout regimes: normal final execution direction.
- Structural stop: original 1.00R.
- Pyramid broker TP: restored.
- Campaign-to-single floor transfer: telemetry only; no foreign campaign floor is applied to the surviving leg.

## MT5 headline result

| Metric | Result |
|---|---:|
| Total trades | 79 |
| Wins | 62 |
| Losses | 17 |
| Win rate | 78.48% |
| Gross profit | $23,015.87 |
| Gross loss | -$23,101.50 |
| Net profit | -$85.63 |
| Profit factor | 1.00 (exact 0.9963) |
| Expected payoff | -$1.08/trade |
| Balance drawdown maximal | $8,154.07 (46.07%) |
| Equity drawdown maximal | $8,944.18 (49.84%) |

The run was essentially breakeven before considering whether this drawdown is acceptable. The high win rate did not translate into profit because the 17 broker-SL losses averaged approximately -$1,358.91 while the 62 wins averaged approximately +$371.22.

## Regime performance

| Regime | Trades | Wins | Losses | Win rate | Gross profit | Gross loss | Net | PF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| TREND_DN | 50 | 40 | 10 | 80.00% | $16,195.72 | -$13,295.44 | **+$2,900.28** | 1.218 |
| TREND_UP | 24 | 20 | 4 | 83.33% | $6,093.28 | -$6,182.20 | -$88.92 | 0.986 |
| BRKT_DN (inverse) | 2 | 1 | 1 | 50.00% | $413.85 | -$1,078.80 | -$664.95 | 0.384 |
| BRKT_UP (inverse) | 1 | 0 | 1 | 0.00% | $0.00 | -$1,062.66 | -$1,062.66 | 0.000 |
| RANGING | 2 | 1 | 1 | 50.00% | $313.02 | -$1,482.40 | **-$1,169.38** | 0.211 |

Findings:

- Most wins by count: TREND_DN (40).
- Highest win rate among regimes with material sample size: TREND_UP (83.33%, 20/24), though it still lost $88.92 net.
- Best net regime: TREND_DN (+$2,900.28).
- Most losses by count and gross-loss dollars: TREND_DN (10 losses, -$13,295.44), driven by its much larger 50-trade sample.
- Worst net regime: RANGING (-$1,169.38), narrowly worse than BRKT_UP (-$1,062.66).
- Breakout inverse combined: 3 trades, 1 win, 2 losses, $413.85 gross profit, -$2,141.46 gross loss, -$1,727.61 net. This sample is too small for a stable statistical conclusion, but it was negative in this run.

## CORE versus pyramid

| Role | Trades | Wins | Losses | Win rate | Gross profit | Gross loss | Net |
|---|---:|---:|---:|---:|---:|---:|---:|
| CORE | 53 | 45 | 8 | 84.91% | $16,477.16 | -$10,249.79 | **+$6,227.37** |
| PYRAMID | 26 | 17 | 9 | 65.38% | $6,538.71 | -$12,851.71 | **-$6,313.00** |

Pyramid performance remained the primary drag. By regime, TREND_DN pyramids were -$3,752.50 and TREND_UP pyramids were -$2,560.50. CORE legs were positive in both TREND_DN (+$6,652.78) and TREND_UP (+$2,471.58), while breakout and ranging CORE trades lost a combined -$2,896.99.

## Comparison with v6.25.10 restored-pyramid replay

| Metric | v6.25.10 | v6.25.11 | Change |
|---|---:|---:|---:|
| Total trades | 76 | 79 | +3 |
| Wins / losses | 48 / 28 | 62 / 17 | +14 wins / -11 losses |
| Net profit | -$6,162.45 | -$85.63 | **+$6,076.82** |
| CORE net | +$1,824.65 | +$6,227.37 | **+$4,402.72** |
| PYRAMID net | -$7,987.10 | -$6,313.00 | **+$1,674.10** |
| PYRAMID wins / losses | 15 / 17 | 17 / 9 | +2 wins / -8 losses |

The v6.25.11 replay materially improved the result versus v6.25.10, including the pyramid subset, but did not make pyramid expectancy positive.

## Exit and owner-floor audit

| Observed close classification | Trades | Wins | Losses | Net |
|---|---:|---:|---:|---:|
| SL_MOD:OWNER_R_EXIT_FLOOR | 30 | 30 | 0 | +$15,379.55 |
| PROFIT_CLOSE | 32 | 32 | 0 | +$7,636.32 |
| BROKER_SL | 17 | 0 | 17 | -$23,101.50 |

`PROFIT_CLOSE` is the forensic report classification for the restored canonical positive-R close rules; it is not evidence that the disabled independent legacy profit-close stack was re-enabled. The source keeps those decisions inside `XAU_RExit_RequestClose` and the `OWNER_R_EXIT_CLOSE_ONLY` chokepoint.

- Owner floor reached/armed: 30 trades.
- Observed floor violations: 0, using the exact GENERAL and TREND_UP trigger bands and a 0.03R execution/slippage tolerance.
- All 30 floor-classified exits were profitable.
- All 17 losing trades ended at physical broker SL.
- No historical checkpoint data was unavailable: 79/79 trades have 5, 10, 15, 20, 30, and 60-minute post-exit chronology.

## Post-exit R summary

Average additional favorable movement missed after exit was:

| Checkpoint | Average missed R |
|---|---:|
| 5 minutes | 0.128815R |
| 10 minutes | 0.172687R |
| 15 minutes | 0.214231R |
| 20 minutes | 0.256691R |
| 30 minutes | 0.344757R |
| 60 minutes | 0.555629R |

These figures measure later chronological opportunity; they do not by themselves prove an executable exit improvement because adverse movement and path ordering must also be considered. The companion all-trades CSV records each trade's favorable and adverse path at every checkpoint.

## Conclusion

TREND_DN carried the run and won the most trades. RANGING had the worst net result, while TREND_DN naturally produced the largest loss count and gross loss because it represented 63% of all trades. The larger production concern remains pyramid expectancy: profitable CORE legs (+$6,227.37) were almost exactly cancelled by pyramid legs (-$6,313.00).
