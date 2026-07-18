# v6.25.12 50-Day Secondary Replay Report

This is the optional secondary study requested alongside the mandatory 30-day
replay. It uses the exact same EA build/settings as the 30-day run over a
wider window, and does not replace or contaminate the 30-day comparison
against v6.25.11.

## Run identity

- Window: 2026-05-29 00:00 through 2026-07-18 00:00 (50 days).
- Symbol/timeframe: XAUUSD M10.
- Tick model: MT5 real ticks (`Model=4`); tester report confirms **100% real ticks**, 21,058,611 ticks over 4,718 bars — real-tick history was available for the full extended window.
- Starting balance: $10,000.00 USD.
- EA: v6.25.12, `XAUUSD_AI_Sniper_EA_v62512_owner_profiles_strict_pyramid`.
- Source commit: `f0f2c9696658d25f1150b0c355940d86a3165fac` (same commit, same EX5 as the 30-day run — SHA-256 `46b3fb2a0e8af3951d2c29e50cc4b193bc480e4db68b18adb4f1d115039710b9`).
- Counter Excursion: OFF. BRKT_UP/BRKT_DN inverse execution ON. Same owner exit profiles and strict pyramid gate as the 30-day run.
- Replay executed cleanly on the first launch (Windows-style `Z:\` config path, same method validated by the 30-day run): journal shows `automatic testing started` → 26% → 48% → 77% → 95% → `"successfully finished" in 0:21:57.124`, terminal exit code 0. No relaunch was needed for this run.

## MT5 headline result

| Metric | Result |
|---|---:|
| Total trades | 96 |
| Total deals | 192 |
| Wins | 79 |
| Losses | 17 |
| Win rate | 82.29% |
| Gross profit | $26,732.89 |
| Gross loss | -$20,761.86 |
| Net profit | $5,971.03 |
| Profit factor | 1.29 |
| Expected payoff | $62.20/trade |
| Balance drawdown maximal | $5,048.86 (42.07%) |
| Equity drawdown maximal | $5,215.20 (43.00%) |
| Final balance / equity (no open positions at test end) | $15,971.03 |
| Average realized R (all 96) | +0.0628R |
| Average winning-trade R | +0.2930R (n=79) |
| Average losing-trade R | -1.0073R (n=17) |

## CORE versus pyramid

| Role | Trades | Wins | Losses | Net |
|---|---:|---:|---:|---:|
| CORE | 96 | 79 | 17 | **+$5,971.03** |
| PYRAMID | 0 | 0 | 0 | $0.00 |

Same structural finding as the 30-day run, at larger scale: **all 96 closed positions were CORE; zero pyramid adds executed.**

## Strict pyramid gate

| Metric | Result |
|---|---:|
| Total pyramid opportunities evaluated | 4,729,801 |
| Approvals | 0 |
| Rejections/blocks | 4,729,801 |

| Reason | Count | Share |
|---|---:|---:|
| `CORE_FLOOR_NOT_CONFIRMED_R_EXIT_STATE_MISSING_OR_UNARMED` | 4,454,714 | 94.18% |
| `PYRAMID_BLOCKED_POST_TRADE_COOLDOWN` | 231,477 | 4.89% |
| `CORE_FLOOR_NOT_CONFIRMED_BROKER_SL` | 13,557 | 0.29% |
| `CAMPAIGN_EXHAUSTION` / `PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION` | 10,944 + 10,944 | 0.46% |
| `DIRECTION_NOT_CURRENTLY_APPROVED` | 8,164 | 0.17% |
| `TIMING_OR_LOCATION_NOT_CLEAN_CONTINUATION` | 1 | ~0% |

Reason distribution is essentially identical in proportion to the 30-day run (94.24% vs 94.18% stuck at the core-floor-confirmation gate), confirming this is a stable structural property of the gate over a longer window, not a short-sample artifact.

## Regime performance

| Regime | Trades | Wins | Losses | Win rate | Gross profit | Gross loss | Net | PF | Avg R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TREND_DN | 56 | 45 | 11 | 80.36% | $17,056.65 | -$13,052.86 | **+$4,003.79** | 1.307 | +0.0556 |
| TREND_UP | 37 | 33 | 4 | 89.19% | $9,491.51 | -$4,255.70 | **+$5,235.81** | 2.230 | +0.1283 |
| BRKT_DN (inverse) | 2 | 1 | 1 | 50.00% | $184.73 | -$1,753.05 | -$1,568.32 | 0.105 | -0.4130 |
| BRKT_UP (inverse) | 1 | 0 | 1 | 0.00% | $0.00 | -$1,700.25 | -$1,700.25 | 0.000 | -1.0101 |
| RANGING | 0 | — | — | — | — | — | — | — | — |
| CHOPPY | 0 | — | — | — | — | — | — | — | — |

Breakout inverse combined: 3 trades, 1 win, 2 losses, $184.73 gross profit, -$3,453.30 gross loss, **-$3,268.57 net**. As in the 30-day run, no RANGING or CHOPPY closes occurred.

## Breakout inverse detail

| Position | Original signal | Frozen entry regime | Final execution | Entry | Original structural SL | Peak R | Realized R | Gross/net | Exit authority |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| 20 (CAMP-10) | SELL (inverted) | BRKT_DN | SELL executed... see note | 4462.87 | 4499.20403 | +0.321R | +0.1753R | +$184.73 | PROFIT_CLOSE |
| 176 (CAMP-88) | SELL (inverted) | BRKT_DN | BUY | 4084.21 | 4057.27304 | +0.255R | -1.0012R | -$1,753.05 | BROKER_SL |
| 188 (CAMP-94) | SELL (inverted) | BRKT_UP | BUY | 4079.81 | 4009.67124 | +0.297R | -1.0101R | -$1,700.25 | BROKER_SL |

Note on position 20: direction in the closed-trade row is SELL, meaning the entered/executed side was SELL; correlating against the 297-row `OWNER_BREAKOUT_INVERSE_EXECUTION` telemetry (15 `BRKT_DN` inversion events, all `inversion_applied=true`, all `original_signal=BUY`/`execution=SELL`) confirms this was the inverted leg of an original BUY signal.

Confirmed again from the full 297-row telemetry set: `inversion_applied=true` occurred **only** for `BRKT_UP`/`BRKT_DN` regime rows (23 of 23 true-inversion rows: 15 BRKT_DN + 8 BRKT_UP). All 165 `TREND_DN`, 107 `TREND_UP`, and 2 `RANGING` evaluation rows logged `inversion_applied=false`. Non-breakout regimes never inverted.

Two of the three breakout trades (176, 188) are the identical two BROKER_SL losses already reported in the 30-day window (same entry prices, timestamps, and exit prices) — they fall inside both windows. Position 20 (2026-06-03) is new to the 50-day window and is the first breakout trade to close profitably in either replay, though it exited via `PROFIT_CLOSE` (peak +0.321R, still below the +0.50R BREAKOUT arm threshold) rather than the owner floor.

## Owner R-exit compliance

| Exit classification | Trades | Wins | Losses | Net |
|---|---:|---:|---:|---:|
| `SL_MOD:OWNER_R_EXIT_FLOOR` | 38 | 38 | 0 | +$17,910.42 |
| `PROFIT_CLOSE` | 41 | 41 | 0 | +$8,822.47 |
| `BROKER_SL` | 17 | 0 | 17 | -$20,761.86 |

- All 38 floor-classified exits were profitable and closed above their protected floor.
- All 17 losing trades ended at physical broker SL (avg -1.0073R).
- 520 `OWNER_R_EXIT_FLOOR_RATCHET` events recorded as peak R advanced.
- One `OWNER_R_EXIT_CLOSE_REJECTED_BELOW_FLOOR` retry (`attempted_exit_r=0.370` vs `protected_floor_r=0.371`, `action=RETRY_BROKER_FLOOR`) — traced to position 106, the same underlying trade as the 30-day run's near-miss (2026-06-26 entry). It self-corrected and closed at `realized_r_at_exit=0.374123`, above its floor. **Not a violation**, in either window.
- One additional `OWNER_R_EXIT_CLOSE_REJECTED_LEGACY_AUTHORITY` event logged (telemetry-only, per source comments this authority is never the enforcement path — no live impact).
- No `OWNER_R_EXIT_CLOSE_FAILED` (unresolved SL-modification failure) was logged in this run.

## MFE/MAE

Same limitation as the 30-day report: the EA logs `peakRWhileOpen` per closed position but does not log adverse excursion while a position is still open, so "drawdown before profit" / "peak before SL" cannot be reconstructed from existing telemetry without either an EA logging change (out of scope) or full tick-level reconstruction (not performed). Available instead: losing trades' average peak R while open was +0.158R (from the exit-authority breakdown, `BROKER_SL` row), meaning losers on average got less than halfway to the GENERAL arm threshold (+0.40R) before reversing to the full stop.

## Post-exit missed R

| Checkpoint | Avg missed R (all 96) | BROKER_SL (n=17) | SL_MOD:OWNER_R_EXIT_FLOOR (n=38) | PROFIT_CLOSE (n=41) |
|---|---:|---:|---:|---:|
| 5 min | 0.1781 | 0.1785 | 0.2464 | 0.1146 |
| 10 min | 0.2404 | 0.2763 | 0.2952 | 0.1747 |
| 15 min | 0.2828 | 0.3010 | 0.3487 | 0.2141 |
| 20 min | 0.3192 | 0.3295 | 0.4056 | 0.2347 |
| 30 min | 0.4156 | 0.3996 | 0.5533 | 0.2947 |
| 60 min | 0.6904 | 0.6320 | 0.8873 | 0.5321 |

By regime (avg missed R, 5/10/15/20/30/60m): TREND_DN 0.191/0.255/0.306/0.349/0.477/0.835R; TREND_UP 0.168/0.232/0.263/0.290/0.347/0.510R; BRKT_DN 0.086/0.112/0.138/0.160/0.174/0.319R; BRKT_UP flat at 0.012R throughout.

Clean continuation vs. immediate reversal (60-minute, all 96): 46 clean / 50 reversal.

## Comparison note

This 50-day study is directional context only, not a replacement for the mandatory 30-day-vs-v6.25.11 comparison (v6.25.11 was never replayed over 50 days, so no matched-window comparison exists here). Internally, the 50-day figures are consistent with the 30-day figures for the same underlying trades: the two BROKER_SL breakout losses and the near-miss floor retry are identical positions appearing in both windows, and rejection-reason proportions in the strict pyramid gate are stable within ~0.1 percentage point between the 30-day and 50-day samples (94.24% vs 94.18% core-floor-not-confirmed). Net profit per trade is lower over 50 days ($62.20 expected payoff vs $145.32 for the 30-day window) because the additional 20 days at the start of the window contain a materially worse stretch — 17 broker-SL losses across 50 days vs 9 across the most recent 30 days, i.e. 8 of the 17 losses (47%) occurred in the extra 20 days outside the 30-day window.

## Remaining defect or limitation

Same as the 30-day report: no EA code was modified or repaired. The strict-pyramid-gate zero-approval finding is confirmed stable at larger scale (4.7M evaluations, 0 approvals) and remains a finding for owner review, not a defect fixed here. The MFE/MAE-while-open telemetry gap is confirmed to affect this window too.
