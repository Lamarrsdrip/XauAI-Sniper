# XAU AI Sniper — Full Lifecycle Forensic Audit (Phase 1: Root Causes Only)

**Generated:** 2026-07-09, revised same day after independent second-opinion review (Fable 5 advisor pass)
**Scope:** Read/analyze/report only. No `.mq5` files touched, no thresholds changed, no behavior modified. Matches the user's explicit Phase 1 instruction: forensic audit only, no fixes yet.
**Revision note:** An independent advisor re-derived every stat and re-checked every code claim in this report directly against the raw CSV and source file. Two of this report's original claims did not survive that check and have been corrected in place below (marked **[CORRECTED]**) rather than removed, so the audit trail of what was wrong and why is preserved. A second, previously-missed P0 data gap was also added as a result.
**EA version audited:** v6.20.2 (`XAUUSD_AI_Sniper_EA_v6.20.2.mq5`, build `v6202-command-safety-force-controls-20260709`)
**Account audited:** 436698921 / Exness-MT5Trial9, equity $6,177.62 at time of pull

## Data sources

1. **VPS live telemetry**, pulled via SSH from `C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\Common\Files\` on 173.212.249.202:
   - `XAUAI_ExecutedTradeBrain_XAUUSDm.csv` — 14 real executed trades, OPEN/CLOSE/POST_CLOSE rows, 2026-07-08 13:10 → 2026-07-09 12:47
   - `XAUAI_BlockedTradeMemory_XAUUSDm.csv`, `XAUAI_TradingIntelligence_XAUUSDm.csv/.jsonl`, `XAUAI_ConsciousMemory_436698921_XAUUSDm.csv`, `XAUAI_LiveHeartbeat`, `XAUAI_GateReport`, `XAUAI_ForwardTest`, `XAUAI_Scorecard` files — pulled, converted UTF-16LE→UTF-8, archived in `audits/raw/vps_data/`
2. **Source code**: `XAUUSD_AI_Sniper_EA_v6.20.2.mq5` (29,833 lines) — direct read of the live function bodies, not just grep matches
3. **Prior repo audits** (used for cross-reference, not re-derived): `xau_expectancy_inversion_audit`, `xau_opposite_direction_counterfactual_audit`, `xau_signal_counterfactual_audit`, `xau_direction_recognition_latency_audit`, `xau_growth_engine_forensic_audit`, `xauai_v6202_full_project_audit`, and this session's own `xau_watchdog_audit_2026-07-09.md` (5-hour live demo-account watchdog)

## Executive summary

The user's hypothesis — a lifecycle loop of *good entry → premature small exit → chase re-entry at worse price → tiny profit or large loss* — is **confirmed with real trade data**, but the actual mechanisms are more specific and more fixable than "the gates are too strict" or "the EA reverses direction." Three independent, evidence-backed root causes were found, each tied to a named function and each directly visible in the real trade sample (14 fully-recorded trades plus at least one more with an unrecorded outcome — see the data-completeness gap below, which should be resolved before treating any win-rate/P&L aggregate as final):

| # | Root cause | Function | Evidence |
|---|---|---|---|
| 1 | Regime classifier and the fast direction engine operate on incompatible timescales, with no reconciliation | `DetectRegime()` (line 7907) vs `ADAPTIVE-DIRECTION` structure logic | `regime=TREND_UP` unchanged for the full 5h8m watchdog window despite a confirmed reversal; downstream `weakRegime` checks (e.g. `AdaptivePyramidMaxAdds`, line 10676) can never activate during a real intraday reversal the classifier fails to detect |
| 2 | BASKET LOCK genuinely closes the whole basket at once (`CloseAll()`) on a peak-giveback floor breach; separately, on at least one single-position basket, two internal peak-trackers (`bestFloating` vs `g_basketPeakUSD`) disagreed by 3.7x on the same position's peak — cause not yet isolated | basket floor logic (lines 17564-17943), `CloseAll()` (line 17911), `UpdatePeakProfit()` (line 19436) | Winners-only MFE capture across all 11 winning trades: 30.1% ($459.85 of $1,527.58 peak) — real and severe, though the exact per-trade peak figures are less certain than first presented (see corrected write-up) |
| 3 | The recovery-of-blocked-signal path does not consult the EA's own existing same-direction-recent-loss guard (`XAU_AntiRepeatLossActive`), even though that guard already exists and is wired into other entry paths | `XAU_CheckPendingOpportunityRecovery()` (line 24833) vs `XAU_AntiRepeatLossActive()` (line 26887) | Trade 3 of the loss cluster was a SELL "RECOVERY of missed signal" opened 55 minutes after Trade 1 had already been stopped out on the identical SELL thesis — lost -$632.73 (though this specific trade would likely have passed the guard even if consulted; the wiring gap is the defensible finding, not proof this exact loss was caused by it) |

A fourth, narrower finding confirms the user's Section 10 suspicion, but scoped precisely: the **A+/A Full Size Enforcement Floor** (line 14910) already protects against AI-weak-agree, SMC-hard-conflict, and timing-risk reductions surviving to execution — but **not** against `brainLotMult`/`consciousLotMult`/`stiLotMulti`/`committeeSzMult` reductions, which get silently restored to full size on A+/A grade trades.

**None of these are "the gates are too strict" or "reverse the direction" problems.** All four are specific, nameable code paths with a clear evidence trail.

---

## Anchor Case A: the SELL loss cluster (07-08, 17:05–18:40, 95 minutes, -$1,563.25)

This single episode is bigger than the account's entire net loss (-$1,103.40) — every other trade combined was net positive.

| Trade | Time | Entry | Lot | SL | Exit | P&L | Notes |
|---|---|---|---|---|---|---|---|
| 1 (posId 2938423303) | 17:05:45–17:30:49 | 4061.79 | 0.59 | 4075.99 | 4075.99 (SL) | **-$836.91** | `entryReason` self-labels "not late confirmation chase," but its own field `missedMoveDistance=-22.14, candlesSinceSignal=9` proves entry was 9 candles / 22 points removed from `signalFirstSeenPrice=4038.95` — a direct self-contradiction. SL was only 2.5×ATR vs a TP nearly 16×ATR away — a skewed R:R that leaves little room for a late entry to survive normal volatility. |
| 2 (posId 2938698098) | ? – 18:40:40 | 4076.36 | 0.10 | 0.00 (missing) | 4076.36 | **-$93.61** | `entryReason: fallback: open record not found` — **the OPEN event for this trade is entirely absent from the EA's own trade brain.** A real telemetry/traceability gap, not just a small loss. |
| 3 (posId 2938693754) | 18:00:09–18:40:43 | 4064.66 | 0.52 | 4076.36 | 4076.36 (SL) | **-$632.73** | Explicitly `"[A] TREND_PULLBACK RECOVERY of missed signal ... (original blocker: SMART-GUARD ... fastScore=30/85 required=50 ...)"` — opened 55 minutes after Trade 1 had already been stopped out on the same directional thesis, with no check that the opposite (rising-price) side had gained ground since. |

Trades 2 and 3 closed **within 3 seconds of each other at the identical exit price (4076.36)**. **[CORRECTED]** The original report claimed this was a confirmed basket-wide `CloseAll()` event. That is contradicted by the data: both rows record `exitReason: BROKER_SL`, not a BASKET LOCK message, and Trade 3's exit price (4076.36) is exactly its own recorded SL from its OPEN row. The correct read is two coincidental, independent broker stop-outs that happened to sit at the same price level (Trade 3's SL was genuinely 4076.36 per its own OPEN row; Trade 2's SL wasn't captured due to its missing OPEN record, but its exit price matching 4076.36 exactly suggests its SL sat at the same round level) as price moved fast through that zone — not a proven basket-wide close mechanism. Post-close tracking shows price kept rising afterward (`EXIT_GOOD_AVOIDED_REVERSAL`, up to 4089-4090), meaning the stops themselves were correctly placed — the SELL thesis was genuinely wrong, not prematurely exited. **The failure is upstream: why the EA re-committed to (and stacked) the same SELL thesis after it had already failed once, not the exit logic on this specific episode.**

**Second data-completeness gap found on independent review:** a fourth position in this same trading window, **posId 2940184690** (SELL 0.92 lots, grade A+, "RECOVERY of missed signal" entry at 4059.61, opened 2026-07-09 04:30:14), has an **OPEN row but no CLOSE row anywhere** in the pulled telemetry (checked across `ExecutedTradeBrain`, `TradingIntelligence` CSV and JSONL). This means the "14 executed trades" this entire report's stats are built on is actually undercounting — there were at least 15 positions, and one has a completely unknown outcome that is silently excluded from every win-rate/avg-win/avg-loss/profit-factor figure above. This is at least as serious as the missing-OPEN gap already documented for posId 2938698098 and should be elevated to its own P0 item (see Priority section).

## Anchor Case B: the user's own 4103→4118 example, confirmed and quantified

All four BUY trades in this price zone were **"RECOVERY of missed signal"** entries — none were fresh signals:

| Time | Entry | Lot | Profit | Original blocker | bestFloating | % of peak banked |
|---|---|---|---|---|---|---|
| 06:57:51 | 4103.93 | 0.53 | $38.68 | TREND-CONTINUATION MODE (tcmScore 43 < required 72) | $95.93 | 40.3% |
| 08:18:02 | 4109.06 | 0.83 | $103.57 | RSI divergence (exhaustion vs price extreme) | $333.83 | 31.0% |
| 09:35:49 | 4106.70 | 0.93 | $2.99 | momentum slowdown (close in opposite 30% of 3-bar range) | $91.79 | **3.3%** |
| 11:47:39 | 4106.47 | 0.82 | $20.57 | TREND-CONTINUATION MODE (tcmScore 50 < required 72) | $113.90 | **18.1%** |

**[CORRECTED]** Three of the four exited via **BASKET LOCK**; the 08:18:02 trade ($103.57) actually exited via `SL_MOD:SMART_EXIT_FLOOR`, not BASKET LOCK — the original claim that "all four" shared an exit owner was checked against the raw exitReason text and was wrong for that one row. The giveback pattern (banking a small fraction of a much larger favorable move) still holds for it independently (31.0% captured of $333.83 peak).

The 09:35:49 trade was held only **40 seconds** yet is credited with `bestFloating=$91.79`. **[CORRECTED]** The original report claimed this proves the peak was inherited from other, concurrently-open legs in the same basket — that is factually wrong: a direct timestamp check confirms **no other position was open** at 09:35:09 (the prior trade closed 08:18:02, the next didn't open until 11:45:15), so there were no other legs to inherit from. What the raw row actually shows is stranger and better-defined: this trade's own `exitReason` text reads *"BASKET LOCK │ $24.93 peak → $2.99 banked"* — i.e. the basket engine's own internal peak tracker (`g_basketPeakUSD`) recorded a peak of **$24.93** for this exact position, while the separate per-ticket `bestFloating` field (populated by `UpdatePeakProfit()`, keyed by ticket) recorded **$91.79** for the same 40-second-old single-position basket. Two peak-tracking mechanisms disagree by 3.7x on what should be the identical quantity. The exact cause (a stale/phantom high recorded by one tracker, a tick-timing gap between them, or something in `XAU_ReconstructOpenBasketPeakUSD()` — already flagged by this codebase's own prior developer history, lines ~907, as "PHANTOM BASKET PEAK, bug #1, CRITICAL," fixed in v6.4.25 for a different manifestation) was not traced further in this pass and should not be assumed without direct instrumentation. See the corrected Root Cause 2 write-up below.

**[CORRECTED]** "Across all 11 winning trades, only 28.9% of total peak favorable excursion was ever captured ($459.85 of $1,588.72)" used the wrong denominator (it included the 3 losing trades' small `bestFloating` values, $61.14, which don't belong in a "peak favorable excursion of winners" figure) and, per the paragraph above, leans partly on a `bestFloating` field now shown to be unreliable for at least one basket-lock trade. The corrected, winners-only figure is **$459.85 of $1,527.58 = 30.1%** — same order of magnitude, same conclusion (severe giveback), but the precise number should be treated as directionally right rather than exact until the peak-tracker discrepancy above is resolved.

---

## Root Cause 1 — Regime classifier / direction engine timescale mismatch

**Function:** `DetectRegime()`, line 7907. Called fresh every scan (line 13056, `GATE 1`) and again independently inside recovery re-validation (line 24912) — **confirmed NOT a stale cache**. It recomputes from the current closed M5 bar every single time it's called.

**Actual mechanism:** TIER 3 ("TRENDING," line 7933-7943) fires whenever `EMA(InpEMAFast=50) vs EMA(InpEMASlow=200)` on M5 differ by more than 0.03%. A 50-period and 200-period EMA on the M5 chart represent roughly 4.2 and 16.7 hours of smoothing respectively. A ~5-hour, ~20-point intraday round trip on XAUUSD (trading near 4100, so ~0.5% of price) is **structurally incapable of flipping the relative order of a 200-period EMA against a 50-period one** within that same window — so `regime=TREND_UP` staying constant for the entire 5h8m watchdog session (62/62 decision cycles, confirmed in `xau_watchdog_audit_2026-07-09.md`) is not a bug in the sense of broken logic; it is the classifier answering a genuinely different, slower question than "has the market's tactical direction changed" — which is exactly what the separate `ADAPTIVE-DIRECTION` system (M5/M15 HH/HL structure, CHoCH, liquidity sweeps) is built to answer, and it *did* correctly track the reversal (STRONG BUY → STRONG SELL → TRANSITION_WAIT → BOTH_ALLOWED) in the same window.

**Concrete downstream impact:** `AdaptivePyramidMaxAdds()` (line 10669-10680) only caps pyramid/re-entry additions to 1 when `currentRegime` is CHOPPY/DEAD/LOW_VOL/RANGING. TREND_UP/DOWN and BRKT_UP/DOWN are **never** treated as "weak" by this check — meaning this specific safety brake cannot engage during a real intraday reversal that the regime classifier, by design, cannot see in time. There are ~15+ other consumers of `currentRegime` found via grep (personality gate, HTF bias derivation, exit weakDay/cleanTrend checks, breakout-direction eligibility, scoring) — a full enumeration of all of them was out of scope for this pass but the pattern (slow classifier feeding checks that assume it reflects current tactical conditions) likely repeats.

**Not yet answered / needs a decision, not a fix:** should downstream consumers that need a *fast* read consult `ADAPTIVE-DIRECTION`'s structural state directly instead of/in addition to `currentRegime`? Or should `DetectRegime()` gain an explicit "intraday disagreement" flag when the fast system and the slow EMA order disagree, so consumers can choose how to react? This audit does not recommend either implementation yet — it only proves the mechanism.

---

## Root Cause 2 — BASKET LOCK is basket-wide, not per-position

**Functions:** basket floor computation (lines 17564-17627), Guard 1/Guard 2 (lines 17629-17720+), `CloseAll()` (called from multiple basket-exit branches, e.g. line 17373, 17407, 17428), `XAU_ResetBasketProtectionState()` (only called after a basket goes fully flat — line 17374, 17409, 17429, etc.)

**Mechanism:** `g_basketPeakUSD` tracks the peak of the WHOLE basket's cumulative floating P&L across however many positions are open, and only resets to zero once the basket fully closes. The floor (`floorUSD = g_basketPeakUSD * lockPct/100`, `lockPct` defaulting to 52% via `InpBasketLockMinPct`, ratcheting to 60-70% as peak grows through tiers) is designed to "never give back more than ~40-48% of peak" — and the exit fires via `CloseAll()`, flattening **every** open position simultaneously, not just the one(s) whose individual profit has deteriorated.

**[CORRECTED] On the specific "proof" originally offered here:** this report first claimed posId 2941282863 (the $2.99-profit BUY, open 40 seconds) proved basket-wide peak inheritance because its `bestFloating=$91.79` couldn't have been reached independently in 40 seconds. An independent review checked concurrency directly from OPEN/CLOSE timestamps and found **no other position was open at that time** — so there were no other legs for it to inherit a peak from, and that specific proof does not hold. What the raw data actually shows, and what remains a genuine, unresolved anomaly: this trade's own `exitReason` text records the basket engine's internal peak (`g_basketPeakUSD`) as **$24.93** for this single-position basket, while the separate per-ticket `bestFloating` field (from `UpdatePeakProfit()`, keyed by ticket, sole call site line 19436) recorded **$91.79** — two different peak-tracking mechanisms disagreeing by 3.7x on what should be the same quantity for a lone position. The general mechanism (basket-wide floor computed from `g_basketPeakUSD`, closed via `CloseAll()` which flattens every open position at once) is still directly confirmed by reading lines 17564-17943 and 17911 — that part of the finding stands. What is **not** independently proven is that a freshly-opened leg inherits an elevated floor from other concurrent legs; that mechanism is plausible and worth checking in a true multi-leg basket, but this specific trade cannot be used as its evidence. The 3.7x bestFloating-vs-basket-peak discrepancy on a single-position basket is arguably the more interesting and more precisely-defined anomaly here, and should be traced at the code level (starting from `XAU_ReconstructOpenBasketPeakUSD()`, already flagged in this file's own history as "PHANTOM BASKET PEAK, bug #1, CRITICAL," lines ~907) before assuming either tracker is "the" correct one.

**This directly conflicts with the user's Section 11 requirement** ("let valid winners breathe... don't kill good trades just to book tiny profit") because `CloseAll()` cannot differentiate a structurally-still-fine leg from the one(s) that actually deteriorated — the whole basket goes at once.

**Important context:** this is not a newly-introduced bug. Prior developer history in this same file (lines 899-969, dated 2026-07-01, versions v6.4.24-25) already documents and partially fixed a related symptom class ("BASKET LOCK/HARD-CAP routinely banked only 37-59% of peak... zero structure check," "phantom basket peak," "basket soft-lock silently disabled") — and explicitly names `XAU_ReconstructOpenBasketPeakUSD()` as the source of a prior "PHANTOM BASKET PEAK" defect for young positions, which is a plausible (not yet confirmed) explanation for the $24.93-vs-$91.79 discrepancy found above. Whether the current 52%+ floor logic is being breached (a regression from the v6.4.24/25 fix) or is working exactly as designed and the design itself is the problem is a question that needs direct instrumentation (e.g. logging both `g_basketPeakUSD` and each position's `bestFloating` on every basket-lock decision) before any change is made — this audit found the discrepancy but did not root-cause it to a single line.

---

## Root Cause 3 — Recovery path re-validates direction but not "did I just fail this exact thesis"

**Function:** `XAU_CheckPendingOpportunityRecovery()`, line 24833.

This function is **well-built** and already does several things right, confirmed by reading the full body:
- Rejects if expired, max-open-trades, spread too wide, or no fresh data
- **Anti-chase check**: rejects if price moved more than 1×original-ATR further in the signal's favor since it was first seen
- **Thesis re-check**: rejects if fresh M15/M30 EMA direction has flipped against the recovery direction
- **Fresh M5 structure check**: re-runs `XAU_ClassifySetup()` and rejects on `LATE_CHASE`
- **Re-grades with current regime/session quality** (calls `DetectRegime()` fresh, not a stale value) and rejects if grade downgrades to SKIP
- **Re-checks SMART-GUARD** (`AdaptiveXAUConfirm`) before allowing

This is a real, carefully-engineered gate — not an unguarded blind resume. The comment block at lines 293-336 documents that this exact function was hardened in v6.17.25 specifically because a user-led trace found gaps in it.

**The gap that remains:** none of these checks ask *"has this exact EA, on this exact symbol/direction, been stopped out within the last N minutes?"* — a transaction-level fact that is much stronger evidence than an EMA-direction re-read.

**[CORRECTED/refined after independent review]** The original framing of this section implied no such primitive exists anywhere in the codebase and that Trade 3 of Anchor Case A is clean proof of the gap. Both need qualification:
- The EA **already has** a same-direction-recent-loss primitive: `XAU_AntiRepeatLossActive()` (line 26887, backed by `g_lastLossDir`/`g_lastLossClosePx`/`g_sameDirLossStreak`). It is simply **never consulted inside `XAU_CheckPendingOpportunityRecovery()`** — it's only wired into a handful of soft-bypass sites and the blocked-memory floor (lines 13224, 13236, 13607, 13700, 14150, 14572, 23237). So the actionable finding is narrower and more concrete than "build a new check": **wire the existing guard into the recovery path**, not invent new machinery.
- However, even if it had been consulted, **Trade 3 would likely have passed it anyway**: by 18:00:09, price (4064.66) had already moved roughly 11 points past Trade 1's stop-out price (4075.99) in the SELL's favor — well past the kind of small-recovery threshold (~0.25×ATR) that guard treats as fresh confirmation rather than a repeat chase. So this specific trade is a weaker proof of "the recovery path is dangerous" than first presented; the real, defensible finding is that **an existing, relevant safety primitive is not wired into one of the highest-risk entry paths**, independent of whether it would have changed this one outcome.

This is a real, narrower answer to the user's Section 15 question ("was the recovery path reusing stale directional assumptions") — yes, in the sense that a relevant existing guard isn't consulted there, but not provably the specific cause of the -$632.73 loss.

---

## Root Cause 4 (narrower than assumed) — Lot multiplier floor selectively un-protects certain reductions

**Function:** A+/A Full Size Enforcement Floor, lines 14910-14967, inside the `[LOT_TRACE]` audit block (lines 14969-15005 — this telemetry already satisfies most of the user's Section 10 logging request).

**Mechanism:** `finalSzMult = sizeMulti * pgLotMult * g_stiLotMulti * committeeSzMult` (plus `timingLotMult`/`confirmLotMult`/AI/brain/conscious layers feeding `sizeMulti` upstream). If an A+/A grade trade's size was reduced below the grade's baseline (`originalGradeSizeMulti`), the floor **restores it to full size** — **unless** the reduction came from:
- AI weak-agree verdict (`ALLOW_LOW_CONV`/`ALLOW_REDUCE`)
- SMC hard structural conflict (`g_smcHardBlockActive`)
- Entry-timing/location risk (`lta_timing < 0.999`)

Those three are explicitly protected and survive the floor. **`brainLotMult` (TradeBrain historical-expectancy memory), `consciousLotMult` (ConsciousMemory), `g_stiLotMulti` (STI), and `committeeSzMult` are not in the protected list** — if any of those alone caused the reduction, the floor silently restores full size on the next line, printing `[LOT_TRACE] A+/A FULL SIZE ENFORCED`.

This is the user's Section 10 contradiction ("AI Memory says reduce; a floor overrides it"), confirmed in code — but it is `brainLotMult`/`consciousLotMult` specifically, not a generic "any risk reduction gets erased" bug. The AI-verdict and structure-conflict paths were evidently already hardened against this in a prior iteration; the historical-pattern-memory paths were not.

---

## Priority (per the user's Section 18 process — P0/P1/P2/P3)

*(Revised after independent review — two data-completeness gaps are now both P0, and Root Cause 2/3's P1 framing is downgraded from "proven mechanism" to "confirmed general behavior + an unresolved specific anomaly.")*

- **P0 (direct correctness bugs — telemetry/data integrity, block any confident stats until resolved):**
  - Missing OPEN record for posId 2938698098 (SELL, -$93.61) — no traceable entry reasoning at all.
  - Missing CLOSE record for posId 2940184690 (SELL 0.92 lots, A+ recovery entry at 4059.61, opened 04:30:14) — an entire position's outcome is unknown and silently excluded from every stat in this report, including the headline win-rate/avg-win/avg-loss/profit-factor figures. **This should be resolved before treating any aggregate number in this report as final** — pull the account's full MT5 statement/history export to find this position's actual close.
- **P1 (major expectancy problem, confirmed mechanism, some specifics still open):**
  - Root Cause 2: BASKET LOCK's basket-wide `CloseAll()` is confirmed; the severe giveback pattern (30.1% winners-only MFE capture) is real; the *specific* 3.7x peak-tracker discrepancy needs direct instrumentation before its cause is confirmed.
  - Root Cause 3: the recovery path's failure to consult the existing `XAU_AntiRepeatLossActive()` guard is confirmed and actionable; its causal role in the -$632.73 loss specifically is not proven.
  - Root Cause 1 as it feeds Root Cause 3's thesis-recheck and `AdaptivePyramidMaxAdds` — an enabling condition for both, solidly confirmed on its own terms.
- **P2 (calibration opportunity, needs a product decision not a code fix):** Root Cause 4's brain/conscious/sti/committee floor gap — real, precisely scoped, but whether TradeBrain-style historical-pattern reductions *should* be protected the same way AI-verdict reductions are is a judgment call, not an obvious bug.
- **P3 (telemetry only):** none additional found beyond the P0s above — the existing `[LOT_TRACE]`, `DECISION_FINGERPRINT`, and trade-brain logging are already unusually thorough and were what made this entire audit (and its correction) possible without any new instrumentation.

## What this audit deliberately does not do

Per the user's explicit Phase 1 instruction: no thresholds changed, no TP/SL widened, no direction reversed, no gates loosened, no code touched. The three root causes above are traced to specific functions and line numbers with real-money evidence; deciding *how* to fix each (Phase 2/3 of the user's own process) is a separate step that should be prioritized and scoped individually — these four causes should not be fixed in one combined release per the user's explicit "don't stack several speculative changes into one release" instruction.
