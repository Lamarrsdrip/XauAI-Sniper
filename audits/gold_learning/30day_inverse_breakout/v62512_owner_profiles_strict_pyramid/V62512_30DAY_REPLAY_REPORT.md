# v6.25.12 30-Day Replay Report

## Run identity

- Window: 2026-06-18 00:00 through 2026-07-18 00:00 (30 days), identical to the v6.25.11 comparison window.
- Symbol/timeframe: XAUUSD M10.
- Tick model: MT5 real ticks (`Model=4`), 100% real ticks per the tester report, 13,243,910 ticks over 2,870 bars.
- Starting balance: $10,000.00 USD.
- EA: v6.25.12, `XAUUSD_AI_Sniper_EA_v62512_owner_profiles_strict_pyramid`.
- Source commit: `f0f2c9696658d25f1150b0c355940d86a3165fac` — `fix(ea): apply owner exit profiles and strict pyramid gate`.
- Canonical source SHA-256 (root == `backend/ea_code/`, byte-identical): `9a3c3d0057dc85c49b08855f3e2795b80726a16ff08fff642555381bbfac0501`.
- Compiled EX5 SHA-256: `46b3fb2a0e8af3951d2c29e50cc4b193bc480e4db68b18adb4f1d115039710b9` (0 errors, 0 warnings).
- Counter Excursion: OFF.
- BRKT_UP/BRKT_DN: inverse final execution direction (`InpOwnerBreakoutExecutionMode=OWNER_BREAKOUT_INVERSE`).
- Non-breakout regimes: normal (non-inverted) final execution direction.
- Structural stop: original 1.00R.
- Owner exit profiles (new in this build): TREND_UP/TREND_DN campaigns use **GENERAL** (arm 0.30R floor at +0.40R peak, then 70% of peak from +0.50R); BRKT_UP/BRKT_DN campaigns use **BREAKOUT** (arm 0.40R floor at +0.50R peak, then 70% of peak from +0.70R).
- Strict pyramid gate (new in this build): a pyramid add requires the core position's owner R-exit floor to already be armed and live-broker-confirmed before any other gate (direction/structure/pressure/timing/margin) is even evaluated.

## Recovery note (replay execution, not EA behavior)

The first launch attempt of this replay (config `tester_config_v62512_owner_profiles_strict_pyramid_inverse.ini`, PID 83361) stalled: the terminal reached "expert loaded successfully" and then produced no further journal growth, no `AutoTesting` percentage messages, and a tight `toolbar:ToolbarWindowProc unknown msg 0465` redraw loop in Wine's stdout for 23+ minutes at ~95-99% CPU with zero forward progress. This matched the pattern of every other successful compile/launch in this project's history, which invoke Wine with a **Windows-style `Z:\` backslash path** (e.g. `/compile:Z:\tmp\...`), whereas this stalled launch used a Unix-style forward-slash `/config:/Users/...` path. The stalled process was terminated (`SIGTERM`, exited cleanly, no live/VPS trading terminal was touched) and relaunched with `/config:Z:\Users\libertyelectronics\XauAI-Sniper\tester_sandbox\v6255_backtest\tester_config_v62512_owner_profiles_strict_pyramid_inverse.ini`. The relaunch authorized, synchronized, and started testing within 10 seconds, progressed 21% → 65% → 91% → 93% over the run, and finished with journal line `last test passed with result "successfully finished" in 0:23:07.040`, terminal exit code 0. This is a replay-tooling note only; **no EA logic, inputs, or settings were changed**, and the accepted run is the one reported below.

## MT5 headline result

| Metric | Result |
|---|---:|
| Total trades | 62 |
| Total deals | 124 |
| Wins | 53 |
| Losses | 9 |
| Win rate | 85.48% |
| Gross profit | $24,647.50 |
| Gross loss | -$15,637.58 |
| Net profit | $9,009.92 |
| Profit factor | 1.58 |
| Expected payoff | $145.32/trade |
| Balance drawdown maximal | $4,239.63 (18.81%) |
| Equity drawdown maximal | $5,471.99 (24.08%) |
| Final balance (10,000 + net profit) | $19,009.92 |
| Final equity (no open positions at test end) | $19,009.92 |
| Long trades (won %) | 21 (80.95%) |
| Short trades (won %) | 41 (87.80%) |

There were 0 breakeven positions (every closed position had a strictly positive or strictly negative realized P/L; the classification cutoff was P/L ≤ $0.00 = loss).

Average realized R (all 62 trades): **+0.1166R**. Average winning-trade R: **+0.3072R** (n=53). Average losing-trade R: **-1.0058R** (n=9, i.e. essentially exact 1R structural stops).

## CORE versus pyramid

| Role | Trades | Wins | Losses | Win rate | Gross profit | Gross loss | Net |
|---|---:|---:|---:|---:|---:|---:|---:|
| CORE | 62 | 53 | 9 | 85.48% | $24,647.50 | -$15,637.58 | **+$9,009.92** |
| PYRAMID | 0 | 0 | 0 | n/a | $0.00 | $0.00 | $0.00 |

**Every one of the 62 closed positions this run was a CORE leg. Zero pyramid adds executed.** This is the single most important structural fact about this replay: the strict pyramid gate rejected every pyramid opportunity it evaluated (see next section). Because there were no pyramid legs, there is nothing to report for "campaigns made better by pyramids," "profitable core campaigns turned into losses by pyramids," or CORE-vs-PYRAMID average-R comparison — all are N/A (0 pyramid trades), not zero-by-omission.

Maximum simultaneous campaign exposure: each of the 62 closed positions belongs to a distinct `campaign_id` (CAMP-1 .. CAMP-62 range) with no more than one open position per campaign observed in the entry-capture log (consistent with zero pyramids); BUY and SELL campaigns are tracked in separate slots (`g_campaign[0]`/`g_campaign[1]`) so at most 2 campaigns (one per direction) could be simultaneously active by construction, and no evidence of both directions holding a position at once was found in the entry-capture timestamps reviewed.

## Strict pyramid gate

| Metric | Result |
|---|---:|
| Total pyramid opportunities evaluated (gate + pre-gate block events) | 3,324,492 |
| Approvals (`PYRAMID_GATE_APPROVED`) | 0 |
| Rejections/blocks | 3,324,492 |

Rejection breakdown by reason family:

| Reason | Count | Share |
|---|---:|---:|
| `CORE_FLOOR_NOT_CONFIRMED_R_EXIT_STATE_MISSING_OR_UNARMED` (core's owner floor never armed) | 3,132,747 | 94.24% |
| `PYRAMID_BLOCKED_POST_TRADE_COOLDOWN` | 157,775 | 4.75% |
| `CORE_FLOOR_NOT_CONFIRMED_BROKER_SL` (floor computed but live broker SL doesn't yet reflect it) | 10,230 | 0.31% |
| `CAMPAIGN_EXHAUSTION` / `PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION` (logged twice per event) | 9,269 + 9,269 | 0.56% |
| `DIRECTION_NOT_CURRENTLY_APPROVED` | 5,202 | 0.16% |

No rejection reached the later gates (structure opposition, pressure opposition, late/chased timing, exhaustion-threshold, margin buffer) in measurable volume — the run never got past the **core-floor-confirmation gate** (Gate A, the very first check) or the post-trade cooldown in the overwhelming majority of evaluations. This is a direct, mechanical consequence of the gate ordering: the strict gate requires the core leg's owner R-exit floor to already be *armed* (peak R ≥ the GENERAL/BREAKOUT arm threshold, live broker SL confirmed at or beyond the floor price) before any pyramid add can even be considered — and most open time on a position happens before it reaches +0.40R/+0.50R peak, so the gate is closed for most of every campaign's life by design.

**Proof that every approved pyramid had a live broker-confirmed core floor:** vacuously true — there were 0 approvals, so there is no approved pyramid to check. This is reported honestly rather than as "100% compliant," since there is no positive evidence to point to.

This is reported as a finding requiring owner review, not repaired: whether "strict gate essentially never opens in a 30-day window" is the intended severity of "strict" is an owner design decision, not something inferred from this replay alone. No EA code was touched.

## Regime performance

| Regime | Trades | Wins | Losses | Win rate | Gross profit | Gross loss | Net | PF | Avg R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TREND_DN | 44 | 38 | 6 | 86.36% | $18,696.92 | -$9,652.19 | **+$9,044.73** | 1.937 | +0.1511 |
| TREND_UP | 16 | 15 | 1 | 93.75% | $5,950.58 | -$1,898.10 | **+$4,052.48** | 3.135 | +0.1620 |
| BRKT_DN (inverse) | 1 | 0 | 1 | 0.00% | $0.00 | -$2,103.66 | -$2,103.66 | 0.000 | -1.0012 |
| BRKT_UP (inverse) | 1 | 0 | 1 | 0.00% | $0.00 | -$1,983.63 | -$1,983.63 | 0.000 | -1.0101 |
| RANGING | 0 | — | — | — | — | — | — | — | — |
| CHOPPY | 0 | — | — | — | — | — | — | — | — |

Breakout inverse combined: 2 trades, 0 wins, 2 losses, $0 gross profit, -$4,087.29 gross loss, **-$4,087.29 net**. Both were the only two BRKT_UP/BRKT_DN entries all run — a sample of 2 is not statistically meaningful, but both were negative in this run (each exited at essentially exact -1.00R broker SL).

No RANGING or CHOPPY trades occurred this run (0 closed positions in either regime).

## Breakout inverse detail

For every BRKT_UP/BRKT_DN closed position (2 total):

| Position | Original signal | Frozen entry regime | Final execution | Entry | Original structural SL | Peak R | Realized R | Gross/net | Exit authority |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| 108 (CAMP-54) | SELL (inverted) | BRKT_DN | BUY | 4084.21 | 4057.27304 | +0.255R | -1.0012R | -$2,103.66 | BROKER_SL |
| 120 (CAMP-60) | SELL (inverted) | BRKT_UP | BUY | 4079.81 | 4009.67124 | +0.297R | -1.0101R | -$1,983.63 | BROKER_SL |

(Original signal direction inferred from `OWNER_BREAKOUT_INVERSE_EXECUTION` telemetry: both executions were BUY with `original_signal=SELL`, `inversion_applied=true`, `reason=OWNER_BREAKOUT_OPPOSITE_DIRECTION_POLICY`.)

Confirmed from the full 174-row `OWNER_BREAKOUT_INVERSE_EXECUTION` telemetry set: **`inversion_applied=true` occurred only when `regime` was `BRKT_UP` or `BRKT_DN`** (14 of 14 true-inversion log rows). Every `TREND_DN` (116 rows), `TREND_UP` (43 rows), and `RANGING` (1 row) evaluation logged `inversion_applied=false`. Non-breakout regimes' execution direction always equaled their original signal in this telemetry. Both entries reached a positive peak R (+0.255R, +0.297R) before reversing to the full structural stop — both would have been protected by the BREAKOUT owner floor (arms at +0.50R) had they reached it, but neither did.

## Owner R-exit compliance

Confirmed directly from `OWNER_EXIT_PROFILE` telemetry (source, not inferred): GENERAL = arm at +0.40R with 0.30R floor, then 70% of peak from +0.50R; BREAKOUT = arm at +0.50R with 0.40R floor, then 70% of peak from +0.70R. 60 of 62 closed positions were tagged `GENERAL` (TREND_UP/TREND_DN entries); 2 of 62 were tagged `BREAKOUT` (the two BRKT_UP/BRKT_DN entries above).

| Exit classification | Trades | Wins | Losses | Net |
|---|---:|---:|---:|---:|
| `SL_MOD:OWNER_R_EXIT_FLOOR` | 27 | 27 | 0 | +$17,093.65 |
| `PROFIT_CLOSE` | 26 | 26 | 0 | +$7,553.85 |
| `BROKER_SL` | 9 | 0 | 9 | -$15,637.58 |

- Owner floor armed/reached: 27 trades (all `GENERAL` profile — matches: no `BREAKOUT` position reached +0.50R peak).
- All 27 floor-classified exits were profitable (0 losses among owner-floor exits) and all realized above their protected floor.
- All 9 losing trades ended at the physical broker SL, at essentially exact -1.00R (avg -1.0058R).
- 368 `OWNER_R_EXIT_FLOOR_RATCHET` events recorded across those 27+ positions as peak R advanced and the floor tightened toward 70% of peak.
- **One near-miss, self-corrected, not a violation:** ticket/position 38 logged a single `OWNER_R_EXIT_CLOSE_REJECTED_BELOW_FLOOR` (`attempted_exit_r=0.370` vs `protected_floor_r=0.371`, `action=RETRY_BROKER_FLOOR`). Traced to its actual exit: position 38 closed via `SL_MOD:OWNER_R_EXIT_FLOOR` at `realized_r_at_exit=0.374123`, i.e. **above** its 0.371R floor. The retry mechanism worked as designed; this is not a floor breach.
- No other trade in the 522 recorded floor events triggered a floor and later exited below it, and no unresolved SL-modification failure (`OWNER_R_EXIT_CLOSE_FAILED`) was logged this run.

## MFE/MAE

Peak R while open (all 62 CORE trades, no PYRAMID trades exist to compare): average +0.4034R.

**Limitation, reported honestly rather than fabricated:** the EA logs `peakRWhileOpen` (maximum favorable excursion while a position was open) per closed position, but it does **not** log a corresponding "maximum adverse excursion while open" (drawdown before profit, or peak-before-SL for losers) at any point in the source. The `FORENSIC_POST_EXIT_*` telemetry only covers movement *after* exit, and no in-source counterpart tracks intra-trade adverse excursion. Reconstructing "how many winners entered drawdown before profit" or "average peak before SL for losers" would require either (a) an EA logging enhancement (out of scope — no EA changes permitted this task) or (b) full tick-by-tick reconstruction against the 13.2M-tick history for all 62 positions, which was not performed. This section is therefore **not available** from existing telemetry rather than estimated.

What is available: peak R while open by outcome —

| Group | n | Avg peak R while open |
|---|---:|---:|
| Winners | 53 | data available per-trade in `..._ALL_TRADES.csv` (`peak_r_while_open` column); aggregate not separately computed here pending owner direction on whether an EA MAE-while-open field should be added |
| Losers | 9 | avg +0.170R peak before the eventual -1.00R broker SL (from `V62512_..._POST_EXIT_BY_EXIT_AUTHORITY.csv`, BROKER_SL row `avg_peak_r_while_open=0.170371`) |

All 9 losing trades' peak R stayed below the GENERAL arm threshold (+0.40R) — consistent with the owner-floor-exit set (27 trades, all winners) being exactly the positions that reached arming, and the loss set being exactly the positions that never did.

## Post-exit missed R

| Checkpoint | Avg missed R (all 62) | Avg missed R (BROKER_SL, n=9) | Avg missed R (SL_MOD:OWNER_R_EXIT_FLOOR, n=27) | Avg missed R (PROFIT_CLOSE, n=26) |
|---|---:|---:|---:|---:|
| 5 min | 0.1866 | 0.1308 | 0.2739 | 0.1154 |
| 10 min | 0.2300 | 0.2704 | 0.2978 | 0.1456 |
| 15 min | 0.2740 | 0.3094 | 0.3384 | 0.1948 |
| 20 min | 0.3075 | 0.3167 | 0.3886 | 0.2202 |
| 30 min | 0.4290 | 0.3719 | 0.5712 | 0.3011 |
| 60 min | 0.7707 | 0.5906 | 1.0258 | 0.5682 |

By regime (avg missed R): TREND_DN 0.197/0.240/0.287/0.324/0.458/0.850R at 5/10/15/20/30/60m; TREND_UP 0.174/0.222/0.262/0.287/0.389/0.637R; BRKT_DN 0.089→0.193R by 20m (flat after); BRKT_UP 0.012R flat throughout (essentially no post-exit continuation captured).

Since 0 pyramid trades exist, CORE and "overall" missed-R figures are identical (both are the same 62 trades) — reported once, not duplicated as if independent.

Clean continuation vs. immediate reversal (60-minute classification, all 62 trades): 24 clean continuations, 38 immediate reversals. By exit authority: owner-floor exits were the closest to balanced (9 clean / 18 reversal); PROFIT_CLOSE skewed toward reversal (10/16); BROKER_SL exits were the most balanced of all (5/4). All figures are chronological-opportunity measurements only — per the extraction method notes, they are not by themselves proof of an executable improvement, since adverse path and ordering must also be considered.

## Comparison with v6.25.11 (committed 30-day report, commit `1fd33a0`, same window/settings)

| Metric | v6.25.11 | v6.25.12 | Change |
|---|---:|---:|---:|
| Total trades | 79 | 62 | -17 |
| CORE count / net | 53 / +$6,227.37 | 62 / +$9,009.92 | +9 trades / +$2,782.55 |
| PYRAMID count / net | 26 / -$6,313.00 | 0 / $0.00 | -26 trades / +$6,313.00 (eliminated, not improved) |
| Breakout count / net | 3 / -$1,727.61 | 2 / -$4,087.29 | -1 trade / -$2,359.68 |
| Broker-SL count | 17 | 9 | -8 |
| Owner-floor count | 30 | 27 | -3 |
| Gross profit | $23,015.87 | $24,647.50 | +$1,631.63 |
| Gross loss | -$23,101.50 | -$15,637.58 | +$7,463.92 (smaller loss) |
| Net | -$85.63 | +$9,009.92 | **+$9,095.55** |
| Profit factor | 1.00 (0.9963) | 1.58 | +0.58 |
| Average realized R | not separately stated (win rate 78.48%) | +0.1166 | — |
| Maximum equity drawdown | $8,944.18 (49.84%) | $5,471.99 (24.08%) | -$3,472.19 (-25.76 pts) |
| 10-min missed R (avg) | 0.1727 | 0.2300 | +0.0573 |
| 30-min missed R (avg) | 0.3448 | 0.4290 | +0.0842 |
| 60-min missed R (avg) | 0.5556 | 0.7707 | +0.2151 |

### Attribution — evidence-supported only

1. **TREND_UP/TREND_DN moving to GENERAL profile:** cannot be isolated in this replay, because v6.25.11 already used a functionally similar restored-R-exit-state guard across all regimes without the GENERAL/BREAKOUT split; the two builds are not a controlled single-variable comparison. What is directly observable: TREND_DN and TREND_UP were both net-positive and higher-PF in v6.25.12 (TREND_DN 1.937 PF vs v6.25.11's 1.218; TREND_UP 3.135 PF vs v6.25.11's 0.986), but this run also has zero pyramids diluting/dragging those regimes, so the regime-level improvement cannot be attributed to the exit-profile change alone — the removal of the pyramid drag is a confounding, and likely larger, factor.
2. **Breakout-only exit profile impact:** not attributable with confidence from n=2 (this run) vs n=3 (v6.25.11) breakout trades. Both runs were net-negative on breakout trades; both v6.25.12 breakout losses were full -1.00R broker SL exits (peak R only reached +0.26R/+0.30R, below the +0.50R BREAKOUT arm threshold), so the new BREAKOUT profile never actually got the chance to protect these particular trades — the sample never reached its own arm point. No conclusion about the BREAKOUT profile's effectiveness can be drawn from this data; it was simply never triggered in either loss.
3. **Strict pyramid gate impact:** this is the one change with clear, direct, large evidence. v6.25.11 had 26 pyramid trades netting -$6,313.00 (a direct drag on an otherwise +$6,227.37 CORE result, producing a near-breakeven -$85.63 total). v6.25.12's strict gate rejected all 3,324,492 pyramid opportunities it evaluated (94.24% never got past core-floor confirmation), producing exactly 0 pyramid trades. The elimination of the pyramid drag (+$6,313.00 swing) accounts for roughly 69% of the total net-profit swing between the two runs (+$9,095.55); the remaining improvement sits in the CORE-only comparison (+$2,782.55, 53→62 CORE trades, higher win rate) and cannot be further decomposed from this replay alone since CORE-path logic itself was not the target of this commit.

## Any remaining defect or limitation

- **No code defect found or repaired.** No EA source, entry logic, exit thresholds, risk, lot sizing, SL, pyramid qualification, breakout inversion, AI, news, timing, backend, frontend, or deployment behavior was modified for this task.
- **Load-bearing finding for owner review (not a code change):** the strict pyramid gate produced 0 pyramid trades across a full 30-day, 3.3M-evaluation real-tick window, with 94.24% of rejections stopping at the very first check (core floor not yet armed). If the owner's intent was "pyramids should still happen sometimes, just more safely," this replay shows the gate as currently ordered may be effectively prohibitive rather than merely stricter. If the owner's intent was exactly what shipped ("no pyramid until the core has already proven a protected floor, which is rare"), then this run is working exactly as designed. This is presented as evidence for owner judgment, not as a bug to fix.
- **MFE/MAE-while-open (drawdown-before-profit, peak-before-SL breakdowns) cannot be fully produced** from existing telemetry — see the MFE/MAE section above. This is a telemetry coverage gap, not a trading-logic defect.
- **Sample sizes for breakout regimes remain very small** (2 trades this run, 3 in v6.25.11) — no statistically reliable conclusion about the new BREAKOUT exit profile is possible yet, since neither run's breakout losses ever reached the profile's own arm threshold.
