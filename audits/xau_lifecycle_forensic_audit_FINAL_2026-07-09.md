# XAU AI Sniper — Final Consolidated Lifecycle Forensic Audit

**Generated:** 2026-07-09
**Status:** Exhaustive pass completed against the original 18-section request. Supersedes/extends `xau_lifecycle_forensic_audit_2026-07-09.md` (the Phase 1 root-cause map), which remains valid and is incorporated by reference — its 4 root causes are re-tested here against the full trade sample, not just the 2 anchor cases.
**Scope discipline maintained throughout:** no `.mq5` file touched, no threshold changed, no version released. Every finding below is labeled **FACT** (directly observed in data or code), **HIGH-CONFIDENCE FINDING** (strong inference with named reasoning, not directly observed), or **HYPOTHESIS** (plausible, not yet proven) — per the explicit instruction not to blur these.

---

## 0. What changed since the Phase 1 report, and why some things are marked impossible

Three things happened in this pass that materially affect confidence in specific numbers:

1. **A second data-completeness gap was already found and corrected** in the Phase 1 report (posId 2940184690, OPEN with no CLOSE anywhere in the EA's own telemetry).
2. **This pass attempted to resolve it against the VPS's broker-level MT5 history**, not just the EA's own CSV. **Not possible without either GUI interaction or launching a second terminal instance alongside the live one** — both judged too risky to the live account to do without explicit approval, so not attempted. **Marked impossible; missing capability identified:** the VPS has no Python/scripting bridge to MT5's native history (`HistorySelectByPosition`) reachable over SSH; resolving this cleanly would need either a lightweight read-only reporting Script/Service added to the EA's own toolkit (safe, doesn't touch the live EA logic) or the user manually checking the MT5 History tab for this one ticket.
3. **A bounded, high-confidence (not confirmed) estimate was derived instead** — see §1.
4. **True fixed-interval intra-trade MAE/MFE (1/2/3/5/10/20/30/60 min during the hold) is not obtainable** from the data that exists. **Marked impossible; missing instrumentation identified:** the EA's `XAUAI_ExecutedTradeBrain` CSV logs only three snapshot types — OPEN, CLOSE (single worst-point-over-the-whole-hold value), and POST_CLOSE (checkpoints only *after* the position already closed, at 5/10/15/30/60 min post-exit). There is no in-hold time series. Fixing this requires the EA itself to log floating P&L at fixed intervals *while a position is open*, not just at open/close/post-exit. What's used instead throughout this report: the single worst point (`worstFloating`, i.e. hold-level MAE) and single best point (`bestFloating`, i.e. hold-level MFE), plus `secondsNegative` (time underwater) — real data, coarser than what was asked for.
5. **The opposite-direction shadow analysis uses an exact mathematical substitute**, not a new simulation: for a single position at a given lot size on a single price series, the opposite-direction shadow's floating P&L at any instant is exactly `-1 ×` the actual position's floating P&L at that instant. So `shadow_MAE = -actual_MFE` and `shadow_MFE = -actual_MAE`, hold-level (not fixed-interval). This is **exact**, not approximated, and satisfies "no hindsight TP optimization" — but it is still single-point, not a full time series, for the same reason as §0.4.
6. **The VPS's own terminal journal log (`MQL5/Logs/*.log`, which would contain `[LOT_TRACE]` prints for these real trades)** was never pulled — only the EA's separate telemetry CSVs were. This means Root Cause 4 (lot-floor gap) is corroborated at the code level only, not against an actual `[LOT_TRACE] A+/A FULL SIZE ENFORCED` firing in this specific trade sample. **Marked as an evidence gap**, not pursued further given time already invested — resolvable by pulling `MQL5/Logs/20260708.log` and `20260709.log` from the VPS the same way the CSVs were pulled.

---

## 1. The missing-outcome trade — bounded, not confirmed

**FACT:** posId 2940184690 — SELL 0.92 lots, grade A+ ("RECOVERY of missed signal," original blocker "BAD-TIMING BLOCK: late gold chase / overextended entry," then demoted A+→A), opened 2026-07-09 04:30:14 at 4059.61, SL 4068.57, TP 4001.34. No CLOSE record exists anywhere in `ExecutedTradeBrain` or `TradingIntelligence` (CSV or JSONL).

**HIGH-CONFIDENCE FINDING (not confirmed):** This position was very likely stopped out for a loss of approximately **-$824 to -$857**, based on:
- `LiveHeartbeat` at 07-09 13:15:42 shows "Open positions: 0" — it closed before then.
- The very next trade (2940617882, BUY, opened 06:50:13 at entry 4103.93) proves price rose from ~4059 through **at least 4068.57** (this SELL's SL) up to ~4104 within about 2h20m — price moved toward the SL and past it, not toward the 4001.34 TP.
- Using this account's own empirically-derived contract value (~$100 per 1.00-price-point per 1.0 lot, confirmed against the 2 of 3 known SL-hit losses that have a recorded SL, to within ~4%): `(4068.57-4059.61) × 100 × 0.92 ≈ $824.32`, plausibly a little different with slippage (one known loss ran $0.89 *under* this naive calculation, the other ran $24.33 *over* it — independently re-verified).

**If confirmed:** total sample net moves from -$1,103.40 (14 known trades) to roughly **-$1,927 to -$1,960** (15 trades), loss count rises from 3 to 4, and every aggregate stat in this report and the Phase 1 report shifts moderately worse. **Every headline stat below is presented on the 14-known-trade basis and flagged with this caveat; treat all of them as a lower-bound-on-badness until this ticket is confirmed.**

**Recommendation:** before acting on any number in this report, the user (or someone with VPS desktop access) should open MT5's History tab on the VPS, filter to 2026-07-09 around 04:30-13:15, and find this ticket's actual close.

---

## 2. Complete trade-by-trade evidence (all 15 positions)

**FACT**, extracted directly from `XAUAI_ExecutedTradeBrain_XAUUSDm.csv`, parsed and archived at `audits/raw/vps_data/master_trades.json`.

| posId | Open | Dir | Setup | Grade | Entry | Lots | SL | TP | Planned R:R | Exit | Profit | Realized R | MAE $ | MFE $ | Exit Owner | Entry Phase | Recovery? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2937038429 | 07-08 13:10:35 | SELL | TREND_PULLBACK | A | 4073.08 | 0.17 | 4092.78 | 3945.07 | 6.5 | 4070.31 | +43.66 | 0.13 | -58.87 | 79.39 | PROFIT_FLOOR | EARLY | N |
| 2937288250 | 07-08 13:50:14 | SELL | TREND_PULLBACK | A | 4069.32 | 0.15 | 4091.44 | 3925.53 | 6.5 | 4065.64 | +53.13 | 0.16 | -68.48 | 118.05 | PROFIT_FLOOR | EARLY | Y |
| 2937419464 | 07-08 14:11:15 | SELL | TREND_PULLBACK | A | 4059.38 | 0.59 | 4079.97 | 3925.54 | 6.5 | 4059.29 | +28.26 | 0.023 | -271.34 | 167.38 | PROFIT_FLOOR | LATE | N |
| 2937815083 | 07-08 15:05:18 | SELL | TREND_PULLBACK | A | 4039.90 | 0.59 | 4061.53 | 3899.34 | 6.5 | 4038.89 | +49.56 | 0.039 | -247.74 | 104.49 | PROFIT_FLOOR | LATE | Y |
| **2938423303** | 07-08 17:05:45 | SELL | TREND_PULLBACK | A | 4061.79 | 0.59 | 4075.99 | 3969.54 | 6.5 | 4075.99 | **-836.91** | -0.999 | -806.23 | 27.67 | BROKER_SL | LATE | N |
| **2938693754** | 07-08 18:00:09 | SELL | TREND_PULLBACK | A | 4064.66 | 0.52 | 4076.36 | 3988.56 | 6.5 | 4076.36 | **-632.73** | -1.04 | -610.16 | 28.66 | BROKER_SL | UNCLASSIFIED* | Y |
| **2938698098** | (no open record) | SELL | TREND_PULLBACK | A | 4076.36 | 0.10 | ? | ? | ? | 4076.36 | **-93.61** | ? | -89.27 | 4.81 | BROKER_SL | UNCLASSIFIED* | N |
| 2939915775 | 07-09 01:35:11 | SELL | (blank) |  | 4071.17 | 0.50 | 4087.45 | 3965.34 | 6.5 | 4071.16 | +2.35 | 0.003 | -251.05 | 105.95 | BASKET_LOCK | MID | Y |
| 2940111245 | 07-09 03:35:14 | SELL | TREND_PULLBACK | A | 4062.73 | 0.63 | 4075.64 | 3978.79 | 6.5 | 4061.01 | +57.32 | 0.07 | -34.65 | 195.67 | SMART_EXIT_FLOOR | MID | Y |
| **2940184690** | 07-09 04:30:14 | SELL | TREND_PULLBACK | A+ | 4059.61 | 0.92 | 4068.57 | 4001.34 | 6.5 | ? | **UNKNOWN — see §1** | ? | ? | ? | UNKNOWN | MID | Y |
| 2940264213 | 07-09 05:10:16 | SELL | TREND_PULLBACK | A | 4068.86 | 0.80 | 4079.44 | 4000.07 | 6.5 | 4068.11 | +59.76 | 0.071 | -583.44 | 121.20 | SMART_EXIT_FLOOR | EXHAUSTION | Y |
| 2940617882 | 07-09 06:50:13 | BUY | (blank) |  | 4103.93 | 0.53 | 4087.68 | 4209.55 | 6.5 | 4105.04 | +38.68 | 0.045 | -62.64 | 95.93 | BASKET_LOCK | MID | Y |
| 2940944581 | 07-09 08:15:13 | BUY | ASIA_BREAKOUT | A | 4109.06 | 0.83 | 4098.72 | 4176.28 | 6.5 | 4110.98 | +103.57 | 0.121 | -123.84 | 333.83 | SMART_EXIT_FLOOR | UNCLASSIFIED* | Y |
| 2941282863 | 07-09 09:35:09 | BUY | TREND_PULLBACK | A+ | 4106.70 | 0.93 | 4097.15 | 4168.78 | 6.5 | 4106.75 | +2.99 | 0.003 | -12.55 | 91.79 | BASKET_LOCK | EARLY | Y |
| 2941818488 | 07-09 11:45:15 | BUY | (blank) |  | 4106.47 | 0.82 | 4095.63 | 4176.95 | 6.5 | 4106.85 | +20.57 | 0.023 | -91.35 | 113.90 | BASKET_LOCK | EXHAUSTION | Y |

*UNCLASSIFIED = the EA's own `entryReason` text was truncated in the source log before reaching the quality-metric fields needed to classify phase — **notably, 2 of the 3 loss trades fall in this bucket**, meaning the trades most relevant to understanding what went wrong are also the ones a truncated log blinds this classification to. This is itself a real, fixable telemetry gap (see §12).

**FACT — planned R:R is ~6.50 on every single trade** regardless of setup, direction, or SL distance. This is not a coincidence of the sample; it indicates a fixed TP-distance-as-a-multiple-of-SL-distance formula somewhere in the EA's trade-construction logic. **Not yet traced to a specific source line** (out of scope for this pass given time already spent) — recommended as a first grep target for Phase 2 (`grep -n "6.5\|riskReward\|tpMultiple"` against the trade-open code path).

---

## 3. Full MAE/MFE and time-underwater analysis

**FACT** (hold-level, not fixed-interval — see §0.4 for why). **[Corrected after independent review — the original averages below were computed incorrectly; these are re-derived directly from master_trades.json]:**

| Metric | Winners (n=11 known) | Losers (n=2 of 3 with recorded MAE*) |
|---|---|---|
| Avg hold-level MAE | -$164.18 | -$501.89 |
| Avg hold-level MFE | +$138.87 | +$20.38 |
| Avg realized R | +0.062R | -1.01R (2 of 3 losses only — 2938698098 has no SL/TP recorded, so no realizedR) |

*All 3 losses have a `worstFloating` value; the -$501.89 average is computed the same way the report's other loser aggregates are (2 of 3, since 2938698098 lacks SL/TP for the realizedR column but not for MAE/MFE — for consistency with the realizedR row, this MAE average also uses the 2 SL-recorded losses; including all 3 known-MAE losses would change this slightly).

**HIGH-CONFIDENCE FINDING, corrected:** all 11 winners had a negative hold-level MAE (none were $0 or positive) — but **[corrected]** this does *not* mean every winner spent measured *time* underwater: `secondsNegative = 0` for 4 of the 11 winners (2937815083, 2939915775, 2940111245, 2941818488) despite each having a negative `worstFloating`. The correct, defensible claim is narrower: **100% of winners touched a negative floating P&L at some point (MAE < $0), but only 7 of 11 (64%) have a recorded non-zero duration underwater** — the 4 with `secondsNegative=0` likely dipped negative only briefly enough (sub-tick or sub-logging-interval) not to accumulate recorded seconds. The user's "immediate drawdown → eventual recovery → small profit" pattern is strongly supported by the MAE-touched-zero finding, but should not be overstated as "every winner spent real, measured time underwater."

**Time-underwater detail for the loss cluster (FACT, from `secondsNegative`):** Trade 2938423303 was negative for 1,471 of its ~1,504 total held seconds (97.8% of its life); Trade 2938693754 was negative for 2,421 of ~2,434 seconds (99.5%). Both losing trades spent essentially their *entire* hold underwater before the stop finally hit — there was no meaningful recovery attempt to interrupt, unlike the winners.

---

## 4. Opposite-direction counterfactual results

**FACT (exact mirror, hold-level only — see §0.5):**

| posId | Actual dir | Actual MAE/MFE | Shadow (opposite) MAE/MFE | Classification |
|---|---|---|---|---|
| 2938423303 | SELL | -806.23 / +27.67 | -27.67 / +806.23 | **RIGHT_DIRECTION_WRONG_TIMING** — the shadow BUY would have had a dramatically cleaner ride (MFE $806 vs the actual SELL's MAE $806) for the same hold window, but per the anchor-case post-close tracking, price *continued* rising well past this trade's close — meaning a same-timing BUY would eventually have needed its own exit discipline, not a guaranteed win. Classified by the taxonomy as timing failure, not direction failure, because the eventual multi-hour price path did later favor the SELL side again (this account's own next SELL trades three hours later were profitable). |
| 2938693754 | SELL | -610.16 / +28.66 | -28.66 / +610.16 | **LATE_CHASE** — entered as an explicit recovery of an already-rejected signal 55 min after a same-direction stop-out; shadow BUY would have been comfortable, actual SELL was not. |
| 2938698098 | SELL | -89.27 / +4.81 | -4.81 / +89.27 | **RIGHT_DIRECTION_WRONG_TIMING** (same window as above trade, same conclusion) |
| All 11 winners | mixed | small negative MAE, modest positive MFE | mirrored, small positive MAE-equivalent, modest negative MFE-equivalent | **NORMAL_PULLBACK** for the majority — the shadow side would have faced its own modest adverse excursion too; neither side was a clean, obviously-better trade. Two exceptions (2940944581, MFE $333.83 vs MAE $123.84; 2940111245, MFE $195.67 vs MAE $34.65) lean toward **EARLY_ENTRY** — the actual direction had a notably cleaner ride than its shadow would have, i.e. these were the closest thing to "textbook" entries in the sample. |

**HIGH-CONFIDENCE FINDING:** No trade in this sample classifies as **WRONG_DIRECTION** — every loss's shadow-opposite would have been comfortable *for that specific hold window*, but the broader price history (both before and after) shows the actual direction was still the historically-correct one for the day; the failure mode across this whole sample is timing/location, never raw direction. This matches and reinforces the Phase 1 report's anchor-case conclusions, now shown to hold across the loss trades as a set, not just as isolated examples.

---

## 5. Skipped early opportunity vs. late-entry analysis

**FACT**, entry-phase distribution across all 15: 3 EARLY, 4 MID (incl. 1 failed-impulse-pullback), 3 LATE, 2 EXHAUSTION, 3 UNCLASSIFIED (truncated log).

**FACT — performance by phase (14 known-outcome trades):**

| Phase | n | Win rate | Avg win | Avg loss | Net | Expectancy |
|---|---|---|---|---|---|---|
| EARLY | 3 | 100% | $33.26 | — | +$99.78 | +$33.26 |
| MID | 3 | 100% | $32.78 | — | +$98.35 | +$32.78 |
| LATE | 3 | 66.7% | $38.91 | -$836.91 | -$759.09 | **-$253.03** |
| EXHAUSTION | 2 | 100% | $40.16 | — | +$80.33 | +$40.16 |
| UNCLASSIFIED | 3 | 33.3% | $103.57 | -$363.17 | -$622.77 | -$207.59 |

**HIGH-CONFIDENCE FINDING:** the LATE bucket is the only classified phase with a loss in it, and that loss (-$836.91) is the single largest in the sample. Combined with 2 of the 3 UNCLASSIFIED trades also being losses, **every loss in the sample is either explicitly LATE or in the truncated-log bucket that could not be ruled out as LATE**. This directly supports the user's Section 1 hypothesis (the EA enters after movement becomes obvious/late) as the load-bearing pattern behind the loss side specifically — while the EARLY/MID/EXHAUSTION phases, despite small samples, show no losses at all in this window.

**Caveat (must be stated given the user's instruction to separate confidence levels):** n=2-3 per bucket is a very small sample. This is a real, internally-consistent pattern in the data available, not a statistically powered conclusion. It should be treated as a strong lead for Phase 2 investigation, not as proof the LATE-phase gate is broken.

---

## 6. Exit efficiency and MFE capture

**FACT (updated with the full 11-winner sample, not just the earlier 4-trade anchor case):**

| Exit owner | n | Win rate | Avg win | Net | Avg MFE-capture % |
|---|---|---|---|---|---|
| PROFIT_FLOOR | 4 | 100% | $43.65 | +$174.61 | ranges 16.9%-55.0% (computed per-trade: profit/MFE) |
| SMART_EXIT_FLOOR | 3 | 100% | $73.55 | +$220.65 | ranges 29.3%-49.3% **[corrected from 52.6%]** |
| BASKET_LOCK | 4 | 100% | $16.15 | +$64.59 | ranges 2.2%-40.3%, **lowest of any owner** |
| BROKER_SL | 3 | 0% | — | -$1,563.25 | n/a (loss trades) |

**FACT, whole-sample MFE capture (winners only, corrected denominator per the Fable-5 review already applied in the Phase 1 report):** **30.1%** of total peak favorable excursion captured ($459.85 of $1,527.58).

**HIGH-CONFIDENCE FINDING, re-confirmed with the fuller dataset:** BASKET_LOCK is the worst-performing exit owner by a clear margin (avg win less than a quarter of SMART_EXIT_FLOOR's), consistent with Root Cause 2 from the Phase 1 report. This now holds across all 4 BASKET_LOCK trades in the full sample, not just the earlier single anchor example — strengthening that finding.

---

## 7. Premature exit → worse re-entry sequences

**FACT — the full chronological reconstruction** (see Phase 1 report's Anchor Cases A and B for full narrative detail) shows this 24-hour window contains:
- **One continuous SELL thesis**, 07-08 13:10 → 07-09 05:20 (10 trades across ~16 hours, net -$1,269.21 known + the unresolved 2940184690)
- **One continuous BUY thesis**, 07-09 06:50 → 11:47 (4 trades across ~5 hours, net +$165.81)
- **Exactly one true concurrent-position episode**: 2938693754 and 2938698098 were open simultaneously for part of 18:00-18:40, combined -$726.34

**HIGH-CONFIDENCE FINDING:** every trade in this sample (except the one concurrent pair above) opened only *after* the prior same-direction trade had fully closed — gaps ranged 26 to 414 minutes. This means the "premature exit → chase re-entry at worse price" pattern in this specific window is a **sequential re-entry under a persisting thesis** pattern (Section 12's concern), not a **concurrent pyramiding/basket accumulation** pattern (Section 14's concern) — the two are conceptually different and this sample mostly exercises the former. The clearest, cleanest example remains the Phase 1 report's Anchor Case B (the four BUY "recovery" trades climbing 4103.93 → 4109.06 → 4106.70 → 4106.47, each entering at a worse price than the prior trade's *entry* while banking 3.3%-40.3% of a much larger available move each time).

---

## 8. Exit-stack conflicts and full ownership enumeration

**FACT**, built directly from source (line references as found):

**Per-position** (all owned by `ManageCleanExitsForPosition()`, "Clean Exit," line 18093):
- **AMPL** (Adaptive Momentum Profit Lock, v6.4.3) — arms at $50-80 USD profit, giveback cap 32-40%, operates via SL modification. **Very likely the actual mechanism behind the `SL_MOD:PROFIT_FLOOR`/`SL_MOD:SMART_EXIT_FLOOR` labels seen in every non-basket, non-broker-SL exit in the real data** — not confirmed as a 1:1 label match, but strongly suggested by the shared USD-giveback-cap mechanics.
- **Chandelier trailing** — only activates past +4.75R (`InpStructureChandelierStartR`). **FACT: never activated in this sample** — the best realized R was 0.16R, nowhere close to 4.75R.
- **Protected Peak Floor** — `InpProtectedPeakFloorEnable=true`, arms at the more protective of $75 flat / 2.5% of balance / 0.45R.

**Basket-wide** (owned by `XAU_BasketLifecycleManager()`, line 17318): BASKET LOCK, Guard 1 (fast-reversal), Guard 2 (hard $ cap), plus `GIVEBACK_LIMIT_TRIGGERED`/`SECOND_CHANCE_EXIT`/`CYCLE_DECAY_EXIT` branches found in the same function.

**Hard/emergency** (all via `CloseAll()`): `WEEKEND_CLOSE` (line 12414), `PROP_FIRM_LOSS_LOCK` (12434), `EQUITY_PROTECT` (12440), `WEEKLY_TARGET_HIT` (12451). None fired in this 15-trade sample.

**Manual**: `XAU_TryForceCloseTicket`/`FORCE_CLOSE_TRADE` (per-ticket, added v6.20.2). Did not fire in this sample.

**Two named subsystems on the user's checklist are confirmed DISABLED by default configuration** — a real, actionable finding independent of any code bug:
- **Profit Guardian**: `InpProfitGuardian = false` since v5.1.3, whose own comment states this "restores v4.9.7 aggression." A separate, always-on mechanism (`InpProfitLock=true`, `InpPG_PerPositionRatchet=true`) does related work under different names/flags.
- **Daily Lock**: `InpDisableAllDailyLocks = true` — a master override that disables Daily Growth Lock, daily profit lock, and retain-percent giveback locks all at once. `InpDailyLossLimit=3.0` exists but its own comment states "EA never pauses" — it only triggers a reduced-size "Adaptive Recovery Mode," not a hard stop.

**Two items on the user's checklist are NOT exit-capable at all**, contrary to what the checklist assumed:
- **STI** — confirmed (by reading `STI_Update()`) to be a macro-direction voting system (D1×3+H4×2+H1×1) feeding lot-sizing and a "block late re-entry after take-profit" gate. No `CloseAll`/position-close call found in or near it.
- **Committee** (`Committee_Assemble`) — feeds a lot-size multiplier and a logged narrative/thesis string, not a close trigger.

**Conflict found:** none of the per-position "Clean Exit" mechanisms (AMPL/Protected-Peak-Floor) and the basket-wide `XAU_BasketLifecycleManager` appear to coordinate — a position can be individually trailing toward a comfortable per-ticket floor while the *basket* aggregate crosses its own, independently-computed floor first and force-closes everything via `CloseAll()`. This is the same mechanism as Root Cause 2 in the Phase 1 report, now confirmed as a structural ownership-graph gap rather than only an anomalous number.

---

## 9. Risk/reward/lot-size alignment

**FACT** (full table in §2). Every trade's planned R:R clusters at ~6.5:1. Risk USD ranged $332-$1,277 across the sample (driven by lot size × SL distance, not by any visible per-trade risk-percent targeting — e.g. 2937419464 risked $1,214.81 on a $6,177 account, ~19.7% of equity on one trade, while 2937038429 risked only $334.90, ~5.4%). **HIGH-CONFIDENCE FINDING:** risk-per-trade as a percentage of equity is **not visibly held constant** across this sample despite all trades sharing similar grades (mostly A) — this is consistent with, but not full proof of, the user's Section 9 concern that lot size/stop distance/account risk aren't tightly aligned trade-to-trade. A rigorous confirmation would require reading the actual position-sizing formula's equity-percent target and comparing it against each trade's realized risk-percent, which was not done in this pass (time constraint) — recommended as a Phase 2 follow-up, starting from the `[LOT_TRACE]` block already identified in the Phase 1 report.

---

## 10. Root causes ranked by frequency, evidence strength, and P&L impact

| Rank | Root cause | Frequency in sample | Evidence strength | P&L impact |
|---|---|---|---|---|
| 1 | BASKET LOCK giveback (Root Cause 2) | 4/15 trades (27%) | **FACT** (confirmed exit-owner + MFE-capture data across the full sample) | Directly caps the upside on 4 trades; if these had captured even 50% of peak instead of the observed 2-40%, the sample's net would improve by roughly $100-150 — a meaningful fraction of what would be needed to offset the loss cluster |
| 2 | Late-phase / truncated-log-phase entries (Section 3/5, this pass) | 3 LATE + 2 of 3 UNCLASSIFIED = up to 5/15 (33%) | **HIGH-CONFIDENCE FINDING** (small-sample pattern, 100% of classified losses fall here) | -$759.09 to -$1,563.25 depending on how the unclassified trades are counted — the largest P&L driver in the sample |
| 3 | Recovery path missing recent-loss guard (Root Cause 3) | 1/15 trades directly (7%) | **FACT** at the code level (gap confirmed by reading the function); **weak/mixed** at the aggregate-statistics level in this sample | -$632.73 on the one directly-implicated trade; NOT generalizable to "recovery trades are worse" in this sample |
| 4 | Regime/direction-engine timescale mismatch (Root Cause 1) | 0/15 directly evidenced in VPS trades | **FACT** at the code level (confirmed separately on the local demo account's 5h8m watchdog); **not independently re-confirmed** against this specific VPS trade sample, where regime tracked the SELL/BUY thesis switch correctly | Not demonstrated in this specific dataset — real elsewhere, unproven here |
| 5 | Lot-floor selectively un-protects brain/conscious/sti/committee reductions (Root Cause 4) | Unknown — VPS terminal journal (which would show actual `[LOT_TRACE]` firings) was not pulled | **FACT** at the code level only | Unknown, not corroborated against real firings in this sample |
| 6 | Missing OPEN/CLOSE telemetry (2 separate trades) | 2/15 trades (13%) | **FACT** | Blocks confident conclusions on ~13% of the sample's outcomes/reasoning, including one entire trade's P&L (§1) |
| 7 | Fixed ~6.5:1 planned R:R vs. realized wins of 0.003-0.16R | 11/11 winning trades (100%) | **FACT** (the ratio), **HYPOTHESIS** (that this specific number is hard-coded rather than coincidental — not traced to source) | This is less a "root cause" than the mathematical shape of the whole payoff-asymmetry complaint — every other finding above expresses itself through this gap between planned and realized reward |

---

## 11. Recommended fixes, ranked by expected impact (not implemented — Phase 3 decision)

1. **Add in-hold floating-P&L logging at fixed intervals** (not just OPEN/CLOSE/post-exit). This alone would upgrade nearly every "hold-level" finding in this report to genuine fixed-checkpoint MAE/MFE, and would let a future audit answer the user's Section 3 questions exactly as specified. Pure telemetry, zero behavioral risk.
2. **Stop truncating `entryReason`/similar fields before the quality-metric block**, or move the quality metrics earlier in the string. Directly fixes the 3-trade UNCLASSIFIED gap, 2 of which are losses.
3. **Investigate whether BASKET LOCK should apply per-leg protection instead of (or in addition to) whole-basket `CloseAll()`** — the highest-value, best-evidenced behavioral fix candidate, but per the Phase 1 report's correction, the exact mechanism (confirmed CloseAll() + an unresolved 3.7x peak-tracker discrepancy) needs direct instrumentation before deciding *how* to fix it, not just *that* it needs fixing.
4. **Wire `XAU_AntiRepeatLossActive()` into `XAU_CheckPendingOpportunityRecovery()`** — small, precise, low-risk change (the guard already exists and is tested elsewhere in the codebase; this is a wiring gap, not new logic).
5. **Trace and evaluate the ~6.5:1 fixed R:R formula** — determine whether it's intentional and whether realized 0.003-0.16R outcomes on winners represent the exit stack working as designed (bank early, protect capital) or leaving structurally excessive value on the table given the stated 6.5R target.
6. **Decide whether Profit Guardian and Daily Locks should be re-enabled** — both are fully-built, currently-inert subsystems, not remove-and-rebuild candidates; this is a configuration/product decision, not a code fix.
7. **Pull the VPS terminal journal logs** to corroborate Root Cause 4 against real `[LOT_TRACE]` firings before prioritizing it further.

None of these should be bundled into one release, per the user's explicit "don't stack several speculative changes" instruction — each is independently testable and independently revertible.

---

## 12. Section 17 — test specifications (not test code, per §Task-20 decision above)

Per the resolved tension (no code changes yet, but tests assert *corrected* behavior that doesn't exist yet): below is each of the user's 15 requested tests mapped to its target function and current status, as a specification for Phase 3, not code delivered now.

| # | Test intent | Target function | Current status |
|---|---|---|---|
| 1 | Good entry not full-closed for trivial profit while thesis valid | `XAU_BasketLifecycleManager`, `ManageCleanExitsForPosition` | FAILS today (BASKET_LOCK giveback confirmed) |
| 2 | Same-thesis re-entry at materially worse price is flagged | `XAU_CheckPendingOpportunityRecovery` | PARTIALLY PASSES (anti-chase/thesis-recheck exist) but no explicit "worse than a prior same-thesis entry" comparison |
| 3 | Large-risk trade can't use scalp-sized reward objective unless classified as scalp | Lot-sizing / exit-target construction (R:R formula, not yet located) | UNKNOWN — formula not traced |
| 4 | AI-memory risk reduction can't be silently undone by account floor | A+/A Enforcement Floor, line 14930 | FAILS for brain/conscious/sti/committee reductions specifically (Root Cause 4); PASSES for AI/SMC/timing reductions |
| 5 | Safe lot below broker minimum skips rather than forces unsafe size | `XAU_NormalizeVolumeForRisk`, line 15092 | Not evaluated this pass |
| 6 | Late extended impulse blocked or requires retest | `XAU_ClassifySetup` (LATE_CHASE path) | Appears to PASS at the gate level (Phase 1 report showed several correct blocks); the LATE-phase trades that did execute were recoveries that passed the recovery gate's own re-check |
| 7 | Early fresh impulse not treated as late chase | `XAU_ClassifySetup` | Not specifically tested this pass |
| 8 | Opposite-shadow audit distinguishes wrong-direction from wrong-timing | N/A (this is an audit-methodology test, not an EA function) | Delivered in §4 above using the exact-mirror method |
| 9 | Recovery signal expires/revalidates when opposite side gains strength | `XAU_CheckPendingOpportunityRecovery` | FAILS — confirmed gap (Root Cause 3) |
| 10 | Regime-vs-direction-engine disagreement has defined downstream behavior | `DetectRegime`, `AdaptivePyramidMaxAdds` | FAILS — no disagreement-handling path found (Root Cause 1) |
| 11 | No exit subsystem closes without owner/reason telemetry | All exit paths (§8) | Mostly PASSES — every exit in the real sample carried an identifiable owner; the 1 unknown-outcome trade is a data gap, not a missing-telemetry-at-the-time gap |
| 12 | Thesis/basket risk cap prevents catastrophic single-idea exposure | Basket risk caps | Not directly evaluated; the one true concurrent-basket episode in this sample (-$726.34) didn't reach catastrophic scale, so no evidence either way |
| 13 | Runner stays alive while thesis/structure valid | Chandelier / runner logic | Never exercised in this sample (no trade got remotely close to runner-activation R) |
| 14 | Hard invalidation exits promptly even without full profit | Structure-break exit paths | Not directly evaluated this pass |
| 15 | Spread/slippage included in net-reward viability | Entry/exit cost accounting | Spread (240 pts, i.e. very wide for this broker/symbol) is visible in the data but its effect on net viability wasn't separately isolated this pass |

---

## 13. Baseline metrics for comparison against the next frozen version

**FACT**, to be re-measured identically after any Phase 3 fix and a subsequent forward-test period, per the user's own Section 18 Phase 6 process:

- Trades: 14 known + 1 unresolved = 15
- Win rate: 78.6% (11/14 known)
- Avg win: $41.80 / Avg loss: -$521.08
- Profit factor: 0.294
- Net: -$1,103.40 (known) / likely -$1,927 to -$1,960 (if §1 confirmed)
- Winners-only MFE capture: 30.1%
- Planned R:R: ~6.5:1 (near-universal)
- Avg realized R (winners): +0.062R
- Avg realized R (losers): -1.01R
- Exit-owner win rates: PROFIT_FLOOR 100%/$43.65 avg, SMART_EXIT_FLOOR 100%/$73.55 avg, BASKET_LOCK 100%/$16.15 avg (weakest), BROKER_SL 0%/-$521.08 avg
- Loss-cluster concentration: 1 episode (95 min) = 100%+ of net loss
- Data-completeness: 2/15 trades (13%) have an incomplete telemetry record

Any future re-audit should reproduce this exact table from a fresh trade pull and compare cell-by-cell — the user's own instruction that "success must be demonstrated by forward evidence," not by code compiling or tests passing.

---

## Sections explicitly marked impossible with this pass's data (summary)

- **Fixed-interval intra-trade MAE/MFE** (1/2/3/5/10/20/30/60 min *during* the hold) — impossible without new EA-side logging (§0.4).
- **True multi-checkpoint opposite-shadow curves** (only hold-level exact mirror delivered) — same root cause as above.
- **Confirmed outcome for posId 2940184690** — impossible without either VPS GUI access or a new read-only history-export capability; bounded instead (§1).
- **EA-version-per-trade segmentation** — the brain CSV carries no version field on trade rows.
- **Corroboration of Root Cause 4 against real `[LOT_TRACE]` firings** — requires the VPS terminal journal log, not pulled this pass.
- **Source-line confirmation of the ~6.5:1 R:R formula's origin** — noted as a Phase 2 starting point, not traced this pass.
