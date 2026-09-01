# M10 Timeframe: Structural SL vs. Fixed $10 Gold-Move SL — Isolated Comparison

**Branch:** `experiment/v62524-m10-fixed-sl` (the "10-minute bot with fixed $10 SL")
**Requested by:** owner, as a direct follow-up to the earlier SL-comparison work, specifically to isolate the SL-mechanism variable alone (holding the M10 primary timeframe constant), since the original comparison (`FINAL_REPORT.md` on `experiment/v62525-full-m5-scan`) changed BOTH the timeframe (M10→M5) AND the SL mechanism (structural→fixed) at once.
**Status: Real replay complete.** MT5-generated HTML report, not modeled or estimated: `analysis/m10_fixed_sl_experiment/v62524_m10fixedsl_30d_report.htm`.

---

## The direct answer

**Switching the M10 bot from its original structural/R-based SL to the fixed $10 Gold-move SL, alone, costs -$215.08 (-3.25%) over this exact 30-day window.** Both configurations remain profitable; the fixed SL is worse, not better, here.

```
M10 + fixed $10 SL net profit:      +$6,404.13
M10 + structural SL net profit:     +$6,619.21
                                     -----------
Difference (fixed - structural):      -$215.08
```

---

## Apples-to-apples verification

Both runs report **identical** `History Quality: 100%`, `Bars: 2755`, `Ticks: 110162` — the exact same underlying tick data was replayed for both, over the exact same window (`2026.06.21`–`2026.07.21`), same Symbol (XAUUSD), same Deposit ($10,000), same Leverage (1:100), same MetaQuotes-Demo account (109865659, credential provided out-of-band, never written to any tracked file). **Only the SL mechanism differs between the two runs** — this is a genuine single-variable isolation, not a multi-variable comparison stated as one.

Config used for this run: `tester_sandbox/MT5_Isolated/config/v62524_m10fixedsl_30d.ini` (outside any tracked git worktree, per the established convention for credential-bearing scratch configs), pointing at the `experiment/v62524-m10-fixed-sl` branch's compiled EX5 (checkpoint 1, commit `06f760f` — unchanged since that checkpoint; this run required no new code, only a new Tester invocation). Expert parameters: only `InpLicensePIN=ASE-TEST-0001` set explicitly (format-only license check, no live server contact — `WebRequest` is disabled in Tester mode); every other input, including `InpStopLossGoldMove`, left at its compiled default (`10.0`), matching the exact minimal-`.set` convention the original baseline run also used.

---

## Full side-by-side: M10+structuralSL vs. M10+fixedSL vs. M5+fixedSL

All three now real, all three over the identical 30-day window (2026-06-21 to 2026-07-21), same deposit/leverage/account.

| Metric | M10 + structural SL (baseline v6.25.24) | M10 + fixed $10 SL | M5 + fixed $10 SL |
|---|---|---|---|
| Total trades | 47 | 57 | 93 |
| Short trades (won %) | 19 (78.95%) | 20 (70.00%) | 43 (72.09%) |
| Long trades (won %) | 28 (71.43%) | 37 (67.57%) | 50 (60.00%) |
| Profit trades / Loss trades | 35 / 12 | 39 / 18 | 61 / 32 |
| Win rate | 74.47% | 68.42% | 65.59% |
| Gross profit | $16,165.64 | $16,645.03 | $13,886.15 |
| Gross loss | -$9,546.43 | -$10,240.90 | -$16,094.76 |
| **Net profit** | **+$6,619.21** | **+$6,404.13** | **-$2,208.61** |
| Profit factor | 1.69 | 1.63 | 0.86 |
| Expected payoff | $140.83 | $112.35 | -$23.75 |
| Balance drawdown maximal | $3,999.31 (39.99%) | $3,523.71 (35.24%) | $6,145.11 (61.45%) |
| Equity drawdown maximal | $4,249.00 (41.56%) | $3,775.14 (36.93%) | $6,803.01 (66.18%) |
| Average profit trade | $461.88 | $426.80 | $227.64 |
| Average loss trade | -$795.54 | -$568.94 | -$502.96 |
| Largest profit trade | $3,301.28 | $3,231.04 | $763.02 |
| Largest loss trade | -$1,143.18 | -$1,440.00 | -$1,360.00 |

Sources: baseline and M5+fixedSL=10 columns read directly from `tester_sandbox/MT5_Isolated/v62524_baseline_30d.htm` and `v62525_sl10_30d.htm` respectively (both already real, MT5-generated reports from prior work on `experiment/v62525-full-m5-scan`, re-verified here — see `FINAL_REPORT.md` Part B on that branch); M10+fixedSL column read directly from `v62524_m10fixedsl_30d_report.htm` (this replay, copied into this branch's `analysis/m10_fixed_sl_experiment/`).

---

## Honest reading, no spin

- **The SL-mechanism change alone (M10+structural → M10+fixed) is a small, real negative on this window**: -$215.08 net (-3.25%), profit factor down slightly (1.69→1.63), win rate down (74.47%→68.42%), and the fixed-SL run takes more trades (57 vs 47) to get there — meaning per-trade edge is meaningfully worse under the fixed SL, even though total drawdown happens to be a bit lower (35.24%/36.93% vs 39.99%/41.56%) and the largest single loss is worse (-$1,440.00 vs -$1,143.18).
- **The timeframe change (M10 → M5, on top of the same fixed SL) is where the real damage is, and it is an order of magnitude larger than the SL-mechanism effect alone**: net profit swings from +$6,404.13 (M10+fixed) to -$2,208.61 (M5+fixed) — an $8,612.74 difference, roughly 40× the size of the pure SL-mechanism effect (-$215.08). Trade count nearly doubles again (57→93), win rate drops further (68.42%→65.59%), profit factor collapses well below 1 (1.63→0.86), and drawdown roughly doubles (35-37%→61-66%).
- **Conclusion, stated plainly**: of the two changes the M5+fixed-SL experimental branch made relative to the untouched v6.25.24 baseline, the M10→M5 primary-timeframe conversion is overwhelmingly the larger driver of the negative result seen in the original SL-comparison work — not the fixed-SL policy itself. The fixed-SL policy alone, isolated on the M10 timeframe, is a real but modest negative (-3.25%) on this specific 30-day window, not the catastrophic failure the combined M5+fixed-SL numbers might suggest in isolation.
- **Scope of this claim, stated honestly**: this is ONE 30-day window. It is not claimed to generalize — the earlier three-arm SL-comparison work (`FINAL_REPORT.md` Part B) already found the fixed-SL policy losing across SL=10/15/20 on the M5 timeframe over this same window, and this new M10-isolated result shows a real but much smaller negative for the SL mechanism specifically when the timeframe variable is controlled for. A longer or different window could show a different split between the two effects; this report does not claim otherwise.

---

## No code changes

This replay required no source changes — `experiment/v62524-m10-fixed-sl` was already built and compiled clean at checkpoint 1 (`06f760f`), and this run reused that exact, unmodified EX5. Only a new Tester `.ini`/`.set` pair was created (outside any tracked worktree) and a new Tester invocation was run.

## Artifacts

- Real MT5 HTML report: `analysis/m10_fixed_sl_experiment/v62524_m10fixedsl_30d_report.htm` (copied from `tester_sandbox/MT5_Isolated/v62524_m10fixedsl_30d.htm`, UTF-16, MT5's native report format, not synthesized)
- Compile log (unchanged since checkpoint 1): `analysis/m10_fixed_sl_experiment/compile.log`
- Branch: `experiment/v62524-m10-fixed-sl`
- Checkpoint 1 commit: `06f760f`
- This report's checkpoint commit: see branch log
