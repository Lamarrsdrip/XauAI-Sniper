# XauAI Sniper — Growth Engine Forensic Audit (Phase 1: Report Only)

**Scope:** Understand what made the bot grow the $100k→~$450k+ account (May 19–June 17), separate genuine trading edge from leverage/exposure, and produce an architecture-safe integration plan for a "grows small accounts the way it grew that one" capability in v6.17.25 — without forking a second engine.

**Status: NO PRODUCTION CODE HAS BEEN MODIFIED.** This is the evidence report requested before any implementation. `XAUUSD_AI_Sniper_EA_v6.17.25.mq5` is untouched.

**Data sources used:** git history (`/Users/libertyelectronics/XauAI-Sniper`, all commits May 15–Jul 8 2026), `XAUUSD_AI_Sniper_EA_v6.17.25.mq5` (28,751 lines, current HEAD), surviving historical builds (`v6.0.2`, `v6.0.3`), six existing forensic audits in `audits/` and `test_reports/`, `docs/superpowers/specs/2026-06-11-xau-v5850-evidence-refactor-design.md`, `memory/PRD.md`, `RELEASE_CHECKLIST.md`, and — most importantly — the **live MT5 trade log** `XAUAI_ExecutedTradeBrain_XAUUSD.csv` (232 real closed trades, 2026-06-01 → 2026-07-08, pulled directly from the Wine MT5 terminal's Common Files directory, not from any repo file). Corroborated by a live independent risk-advisor review (Fable 5).

**Important scope caveat:** the live trade-brain CSV only goes back to 2026-06-01 (it was itself added by commit `0b0882b` "Add XAU trade brain memory" on that date). There is **no raw per-trade log for May 19–31**. Everything about that period comes from commit messages and code comments, not verified trade data. Treat May 19–31 conclusions as directional, not proven.

**Account clarification (confirmed by owner):** the big account run **ended around June 17** — the owner then switched to trading a **separate ~$3,000 account** from June 18 onward. The two are different accounts, not one account that blew up. This turned out to be extremely useful: it means the June 18–July 8 data in the log is a real, live, natural experiment in how this exact codebase (versions v5.8.51 through v6.17.25, i.e. nearly the entire post-growth version history) performed on a small account — see §3.

---

## 1. Version Timeline, May 15 – June 19, 2026

RELEASE_CHECKLIST.md's earliest entry is v6.4.1 (2026-06-28) — it does not cover this period at all. The real timeline had to be reconstructed from `git log` and code comments:

| Date | Commit | What changed |
|---|---|---|
| 2026-05-15 | `0296075`…`757d19a` (7 commits) | Scan watchdog, cloud stats, worker stale-close cleanup, lot scaling fix, indicator recovery, cloud signal fanout, EA "expectancy loss armor" |
| 2026-05-16 | `1dae660`,`3af8ac6`,`89a1c3d`,`91e090e` | Rebalance breathing expectancy, **basket runner soft lock added**, risk-sync audit, **gold exits made structure-aware** |
| 2026-05-18 | `c6c2040` | Adaptive XAU confirmation build |
| **2026-05-19** | `3e797dc`,`1ff7f09`,`e40f958`,`e90c8bd`,`fc66312` | Cloud broker health checks, **XAU entry timing guard added**, **smart pyramid engine added** + indicator recovery backoff, trade cycle guard + broker aliases, adaptive volatility guard — **this is the date the owner remembers as the start; it is a real, active development day, and it's the day the pyramid engine was born** |
| 2026-05-20 | `36d5fe9`,`659c7f1` | Isolate failed cloud accounts, **fix XAU pullback entry timing** + cloud-safe lifecycle |
| 2026-05-25 | `d0a761a`,`f6aa406`,`964bd61`,`a861199`,`9088a01` | Entry quality + smart loss guards, **"Refactor XAU EA decision authority"** (the first explicit attempt at what this audit is also trying to do), idle-reason dashboard, **fix XAU pyramid and post-loss reentry** |
| 2026-05-26 | `9f2ee2d`,`353708d`,`20d8430` | **Add XAU retest rescue pyramid logic — this is the literal birth of PYR+RETEST_RESCUE**, timing-quality grading for A signals, block post-sweep A+ continuation traps |
| 2026-05-31 | `471ef98`,`bfc1178` | Entry timing memory guard, harden blocked-memory persistence |
| **2026-06-01** | `0b0882b`,`e4979ae`,`2e0bd7c`,`401ffa3` | **Add XAU trade brain memory (the CSV this audit is built from)**, exit learning brain, attribution reporting engine, weekly attribution report |
| 06-02→06-04 | 10 commits | Command Center / cloud infrastructure work — not core strategy |
| **2026-06-05** | `43faa41` | **"Add Command Center prop firm mode" — this is what the owner recalled as "v5.8.49 Prop Firm Mode"** |
| **2026-06-11** | `de2984c` | **"Refine XAU prop risk and entry grading" — this is "v5.8.50 Evidence Refactor."** Corroborated by `docs/superpowers/specs/2026-06-11-xau-v5850-evidence-refactor-design.md`, which cites real numbers: *"61 closed trades: 72.1% win rate, +$192,502.77 net, profit factor 2.16"* as of that date. |
| 06-12 → 06-16 | — | No commits found in this window in `git log`. The EA kept trading (per the CSV) but no source changes landed. |
| **2026-06-17** | — | **Big-account trading day ends** (per owner). Real trade-log evidence for this day is in §2.3 below. |
| **2026-06-18** | `5291d2e`,`ae8213c`,`3862763`,`746cfd2` | **v5.8.51 "A+ Profit Shield," v5.8.52 "A+ Profit Shield on top of Live Readiness base," v5.8.53 "smart two-tier shield, stops early exits on pullbacks"** — three shield-behavior commits landed the day the small $3k account started. |
| 2026-06-19 | `29f15e8`,`b70fe72` | v5.8.54 "patient profit shield," "Restore runner behavior for A+ trades" |

**Reconciling the version-number confusion:** the file's internal comments (still visible in `v6.17.25.mq5`'s header) reference v5.8.49 through v5.8.55 as a coherent sequence culminating in a "Runner Restore Shield" design that is **still the live shield design today** (see §5). The exact commit-to-version-number mapping for v5.8.49 is uncertain (no commit message literally says "v5.8.49"), but the Prop Firm Mode (06-05) → Evidence Refactor (06-11) → four rapid shield iterations (06-18/19) sequence is solid and dated.

---

## 2. Quantitative Evidence — Real Trade Log

### 2.1 Growth window (2026-06-01 → 2026-06-15), 77 closed trades

| Metric | Value |
|---|---|
| Net profit | **+$351,118.29** |
| Win rate | 74.0% (57/77) |
| Profit factor | **3.07** |
| Avg win / avg loss | $9,131.63 / **–$12,098.91** |
| Max win / max loss | $36,981.12 / –$46,096.00 |
| Avg time in trade | 27.9 min (n=50 with matched OPEN record; range up to 154.8 min) |
| Setup contribution | **TREND_PULLBACK: 73 trades, +$325,946.30** (92.8% of net profit). LONDON_FIX_PIN: 1 trade, +$20,624.52. Everything else: negligible. |
| Grade contribution | A: 36 trades, +$262,121.99. B: 20 trades, +$48,681.26. A+: 21 trades, +$40,315.04. |
| Exit reason mix | BASKET HARD-CAP: 58, BASKET LOCK: 8, blank/other: 11 |

**Cumulative daily P/L (real, from the log):**
`06-01 +18,198 → 06-02 +24,292 → 06-03 +31,124 → 06-04 +12,046 → 06-05 +34,416 → 06-08 +71,750 → 06-09 –23,327 → 06-10 –10,252 → 06-11 +127,434 → 06-15 +65,439` → **cumulative +$351,118 by end of day 06-15.**

This is the account's real equity curve floor as of 06-15, prior to the missing 06-16/06-17 gap in daily granularity below. Starting from the owner's stated ~$100k, this alone implies equity around $450k by June 15 — consistent with "almost $500k," and there was more trading on 06-16/06-17 before the account stopped.

**One number nearly everyone will want and I will not guess:** an exact starting balance and exact peak balance are not independently in this repo. The $351k figure above is a verified sum of real logged trade P/L, not an estimate.

### 2.2 Overwhelming strategy concentration

Across the *entire* dataset (June 1 – July 8, all 232 trades, both accounts):

| Setup | Trades | Net P/L |
|---|---|---|
| **TREND_PULLBACK** | 175 | **+$202,732.89** (dominated by growth window; see §3 for why it goes negative on the small account) |
| LONDON_FIX_PIN | 2 | +$20,627.67 |
| HTF_TREND_FOLLOW | 29 | +$23.83 (essentially breakeven despite 29 trades) |
| UNKNOWN | 15 | +$4,847.56 |
| MULTI_EXTREME | 1 | +$95.92 |
| RE_ENTRY | 6 | –$37.14 |
| BREAKOUT | 1 | –$82.46 |
| RANGE_REVERSAL | 1 | –$260.28 |

**Direct answer to "did the old growth come primarily from TREND_PULLBACK alone?": yes, overwhelmingly.** BREAKOUT and RANGE_REVERSAL each fired exactly once in 5.5 weeks of live trading — they are not proven contributors either way; there isn't enough data to say they helped or hurt. HTF_TREND_FOLLOW fired 29 times and made essentially nothing, which matches an existing audit finding (`xau_expectancy_inversion_audit`: "HTF_TREND_FOLLOW had an 80% win rate and was still net negative... a stop-distance/exit-management question, not a blocking-filter question"). **Any redesign should focus almost entirely on TREND_PULLBACK; there is not enough real evidence to justify tuning around the other setups from this dataset.**

### 2.3 The June 17 event (real trades, exact log rows)

At 04:55:51 the EA opened a 50.00-lot BUY TREND_PULLBACK A+ at 4343.10 (posId `57115047149`). A second 50-lot BUY A+ appears to have been opened around the same window (a 12.17-lot leg, posId `57115451390`, entered at 4331.38 — **below** the first entry, i.e. added into an adverse move) plus a third leg tracked under `57115132481`. Gold then continued down. At 05:54:08–05:54:09 the basket closed:

```
CLOSE 57115047149  50.00 lots  entry 4343.10 → exit 4331.38   profit -$58,700.00
CLOSE 57115451390  12.17 lots  entry 4331.38 → exit 4331.38   profit  -$5,074.89
```

(A duplicate-looking CLOSE row for the same posId/profit also appears in the raw log — this looks like the EA's basket-close routine logging the same economic leg twice, a **data-quality caveat**, not necessarily two separate $58,700 losses. I am flagging this rather than picking a number and presenting it as fact.) Net day P/L for 06-17, computed straight from every CLOSE row that date, is **–$122,142.41**, but if the duplicate row is real double-logging, the true realized loss that morning is closer to **–$63,775**. Either reading, it is the single worst day in the dataset, and it happened same-day as the four rapid shield-behavior patches (§1) and, per the owner, the last day that account traded.

**Sizing context, not a bug:** `InpMaxTotalLots` (line 1813) defaults to 0, meaning "auto = 3% of equity worst-case," computed at `equity * 0.03 / 160.0` (line 15316–15318). At an equity around $450–600k, that formula authorizes roughly 84–112 total open lots — i.e., the ~112 lots stacked that morning (50 + 50-ish + 12.17) was **at or near the system's own designed worst-case tolerance**, not a bypass of it. This is the report's most important nuance for §7 (what should never be restored): **the growth-era pyramid/exposure design was already running near its own stated risk ceiling before this trade**, so "restore old pyramid aggressiveness" is not free of the exact tail risk that (coincidentally or not) ended that account's run.

### 2.4 The $3,000 account, June 18 – July 8 (148 closed trades) — the small-account natural experiment

This is real, not hypothetical: the **same codebase**, evolving live through v5.8.51 → v5.8.52 → v5.8.53 → v5.8.54 → … → v6.17.25, traded a real ~$3,000 account for three weeks.

| Metric | Value |
|---|---|
| Net profit | **–$1,058.50 (–35.3% of a $3,000 base)** |
| Win rate | 58.1% (86/148, 9 breakeven) |
| Profit factor | **0.80** (a losing system) |
| Avg win / avg loss | $50.70 / **–$102.23** (losses roughly 2x the size of wins) |
| TREND_PULLBACK on this account | 95 trades, **net –$1,071.00** — the strategy that made +92.8% of the big account's profit is the single largest loss contributor on the small account |
| Avg planned risk per trade | ≈6.4% of balance (vs. ≈15.5% of balance on the growth-window account, using SL-distance × lot as a proxy) |

**Exit-reason breakdown on the small account (this is the important part):**

| Exit reason | n | Net $ |
|---|---|---|
| BROKER_SL (hard stop hit) | 25 | **–$3,654.40** |
| BASKET HARD-CAP | 15 | +$992.17 |
| SL_MOD:PROFIT_FLOOR | 11 | +$697.87 |
| SL_MOD:EV_PROTECT | 11 | +$691.86 |
| SL_MOD:AMPL | 4 | +$351.06 |
| THESIS_BROKEN_EXIT | 4 | +$278.00 |
| BASKET LOCK | 6 | +$81.55 |
| GROWTH_DAILY_LOCK_EXIT | 2 | +$156.75 |
| everything else | ~70 | roughly flat |

**This is the single most important quantitative finding in this audit.** Every profit-protection/exit-management mechanism that fired on the small account was **net positive** — the shields, EV-protect, profit-floor ratchet, basket locks, and thesis-break exits all did their job and banked real (if small) gains. **The account lost money because of BROKER_SL hits (raw stop-losses getting hit outright) — one category alone (–$3,654.40) outweighs every positive exit category combined.** This directly contradicts the intuitive assumption that "the exit engine is cutting winners too early and that's why small accounts underperform." On this real evidence, the exit engine is not the small account's problem. **Entry quality/timing and stop placement are.**

---

## 3. Strategy Contribution — Direct Answer to "What Grew the Account?"

Ranking the candidate explanations the owner asked about, against the evidence:

1. **Genuinely superior entries (TREND_PULLBACK specifically): confirmed primary driver.** 73/77 growth-window trades, 92.8% of profit, 74% win rate, PF 3.07.
2. **Better entry timing:** partially confirmed — avg time-in-trade was short (28 min average), consistent with the "not late confirmation chase" language already in the entry-reason string logged on every growth-window trade (`ScoreSetups` / `XAUEntryTimingGuard`, unchanged core scoring math since `v6.0.2`, see §5).
3. **Larger risk (leverage):** **confirmed as a major, probably underweighted, contributor.** Avg planned risk ≈15.5% of equity per trade in the growth window vs. ≈6.4% on the small account. That is a large multiple, not a rounding difference, and it directly explains part of why avg win ($9,131) so dramatically outweighs typical small-account $ figures even before any account-scaling logic is touched.
4. **Pyramiding:** contributed to the size of wins (the two 50-lot legs on 06-15 that closed for +$13,600 and +$7,199 are pyramid-scale) but also produced the worst loss of the dataset (§2.3). **Net contribution is genuinely ambiguous from this data — it amplified both tails.**
5. **Rescue averaging:** the 12.17-lot add at a worse price on 06-17 (§2.3) is a rescue-style add, and it added to the loss, not away from it, in the one clear example this dataset contains. **No evidence in this dataset that rescue averaging saved a basket; the one traceable instance made a bad basket worse.** (This does not prove rescue averaging never helps — the sample is one event.)
6. **Better winner holding:** plausible given the "Runner Restore Shield" design philosophy (§5) but not cleanly separable from raw lot size in this data — a $9,131 avg win on 20+ lot positions is mostly a sizing effect, not necessarily a "held longer" effect.
7. **Better exits:** **not clearly differentiated from the small-account data (§2.4) — exit mechanics performed fine on the small account.** This is a correction to the working hypothesis Fable 5 and I started with: the exit engine is probably not where most of the account-relative fix belongs.
8. **Favorable market regime:** cannot be ruled out. Gold trended hard for both good and bad reasons in June 2026 per the audits already in this repo; this is a real, unquantified confound the owner flagged and it's fair.
9. **Combination:** **the honest answer.** Superior TREND_PULLBACK entries + materially larger risk-per-trade + amplifying pyramid sizing, in a trending regime. The edge (entry selection) is real and evidenced. The leverage (risk %, pyramid stacking near the system's own 3%-equity-worst-case ceiling) is also real and is what nearly certainly explains the June 17 event.

---

## 4. Entry Engine: Old vs. Current (function-level)

**Old era (`v6.0.2`/`v6.0.3`, chronologically closest surviving full source to the growth period):**
- `ScoreSetups()` — `v6.0.2:3484`. TREND_PULLBACK direction = `currentRegime==REGIME_TRENDING_UP ? 1 : -1`, a one-line ternary. Score built from EMA alignment, H1 MTF alignment, pullback-bounce-into-EMA, RSI band, candle strength, M15 RSI band — this scoring math is **unchanged today** (byte-identical in v6.17.25:9374–9455).
- Grading inline in `OnTick()`, thresholds A+=5.5/A=4.0/B=3.0 — **unchanged today** (v6.17.25:12790, same constants).
- Pipeline: **score → grade threshold → `OpenTrade()`.** Roughly 3 steps.

**Current (`v6.17.25.mq5`):**
Same scoring math, but direction now comes from an Active-Direction state machine (`XAU_ComputeActiveDirection`, called 9359) plus a fresh-M15/M30 override (`TFDirectionByEMA`, 9430–9439), and the pipeline between score and `OpenTrade()` grew to roughly 10 sequential stages: Active-Direction → Personality Gate (`StrategyFitsPersonality`, 8433/12561) → grade threshold (12790) → anti-bias correction (~12945) → SmartGuard + symmetric recheck (13030–13241, second `StrategyFitsPersonality` call at 13154) → A+ demotion-without-HTF-alignment (13254–13273) → `XAUEntryTimingGuard()` (24883/13302) → hedge guard → spread/news filters → `ContextGateAllows()` (HTF-bias gate + `XAU_ClassifySetup()` countertrend classifier + S/R proximity, def 6323/6162, call 14131) → `XAU_TimingEngineConfirmsEntry()` (one-bar reconfirmation wait, def 23724, call 14420) → `OpenTrade()` (def 15200, call 14427).

**Why old entries fired faster: there were fewer sequential gates between "score computed" and "order sent," not a fundamentally different scoring algorithm.** The underlying TREND_PULLBACK math the owner remembers as good is still in the file, unchanged.

**Which of today's gates the existing forensic audits (`audits/xau_opposite_direction_counterfactual_audit`, `audits/xau_signal_counterfactual_audit`) found to be low-value, with real numbers:**
- `SMART-GUARD` block → 43% "would have won if flipped" rate (n=7)
- `Personality mismatch` block → 47% "would have won if flipped" rate (n=17)
- `A+ EVIDENCE DEMOTION` block → only 20% (1/5) "would have won" — **this one is a good blocker, do not touch it.**
- 44% of all blocked A/A+ signals in that sample "would have won" if allowed.
- Separately: 47% of sampled winners left ≥1R further favorable movement on the table (early exit), and the EA has a confirmed blind spot — it logs **zero** market/block-check events for the entire duration any position is open, in 8 of 8 sampled trades (`audits/xau_direction_recognition_latency_audit`).

---

## 5. Exit Engine: Old vs. Current

**This is the one place where "old" and "current" are not actually different systems.** The "A+ Profit Shield" design that shipped as v5.8.55 ("Runner Restore Shield," per the header comments in v6.17.25.mq5) — tier1 observe-only by default (no SL move unless `InpAPlusShieldMoveBEOnTier1=true`), tier2 only trails/closes on a *confirmed* reversal, a plain pullback just logs and holds — **is still the live design today**, both in the surviving `v6.0.2` code (7567–7750) and current `v6.17.25` (5392+ / tier logic in `ManageCleanExitsForPosition`, 17461). The exit *philosophy* was never reverted.

What changed is **calibration, not architecture**, and the §2.4 data confirms this is largely already working:
- `XAU_AssessProfitQuality()` (5054, v6.17.18) and `XAU_ProtectPeakProfitFloor()` (5107) — added after live telemetry showed 43% of winners were tagged `EXIT_EARLY_LEFT_PROFIT`. Root cause was a flat 45%-of-peak SL ratchet with no thesis-health check.
- `XAU_MinArmUSDForOwnR()` (10025, v6.17.20) — floors every exit-arm $ threshold at `rDollars * InpExitArmMinOwnR` (0.20R) so a bigger lot can't arm protection sooner in R-terms than a smaller one. **This only ever raises a threshold, never lowers one** (Fable 5 caught this): on a small account with a small `rDollars`, the pre-existing flat-$ constants (e.g. `InpAPlusShieldMinArmUSD=30.0`) still dominate, meaning **the shield is effectively very hard to arm on a small account today** (Fable 5: "a $200 account with a $4-risk position doesn't arm the A+ Shield until +7.5R").
- **A pre-existing, currently orphaned, genuinely account-relative system already exists**: `InpAutoScale` / `RecomputeAutoScale()` (from v4.4.4, code at line 5810+), which converts hard-stop, profit-take min/max, and peak-arm-min into `balance * pct/100` — literally commented "TRUE proportional scaling — works on $10 or $100k equally." **The newer v6.17.18-20 exit code does not consult this system.** This is the gap, not a missing feature — the feature exists, it's just disconnected from the code that needs it.

**Given §2.4's real evidence (every exit-management category on the $3k account was net positive), the exit engine is not the primary lever for small-account growth. It needs to be made genuinely proportional (finishing what `InpAutoScale` and `XAU_MinArmUSDForOwnR` each started, separately) but it is not broken.**

---

## 6. Pyramid/Rescue: Old vs. Current

`CheckPyramidOpportunity()` exists in both eras at similar size (`v6.0.2:3956`, 827 lines; `v6.17.25:10131`, 909 lines — additive growth, not a rewrite). The rescue-specific numeric thresholds (`InpPyramidRescueMaxATR=1.80`, `InpPyramidRescueSizeMulti=0.42`, `InpPyramidRescueMinScore=3.60`, `InpPyramidRescueEliteScore=4.70`, `InpPyramidRetestRescueSizeMulti=0.35`) are **byte-identical** between `v6.0.2` and `v6.17.25`. The journal tags `PYR+TRN`/`PYR+RESCUE`/`PYR+RETEST_RESCUE`/`PYR+ADV` (composed at v6.17.25:10828–10845) didn't exist as labels in `v6.0.2` but the underlying boolean logic they describe is the same code, just labeled later.

**What's new since the growth era:**
- `EffectiveMaxPyramidAdds()` (v6.17.25:10031) — hard equity cutoffs: max 1 add below $25k equity, up to 3 adds above $25k (if trend-quality conditions met), up to 4 above $50k. **A small account structurally cannot pyramid the way the big account did, by design, regardless of setup quality.** This did not exist in `v6.0.2`.
- `XAU_GrowthGuardCanPyramid()` (14968) — pause/daily-lock/protected-base gates, mostly equity-% based already, added post-growth-era.
- `InpMaxTotalLots` auto-cap at 3% equity worst-case (1813, 15316) — this is old (v4.7.6) and, per §2.3, was already close to its own designed ceiling on the trade that ended the big account's run.

**Direct evidence on danger, not hypothetical (§2.3):** the one clearly-traceable rescue/pyramid add in this dataset — a 12.17-lot add at a *worse* price than the base position, into an already-adverse move — made the loss bigger, not smaller, and the combined basket (~112 lots) sat close to the system's own 3%-equity-worst-case authorization. **Fable 5's independent read on this, before I had this specific trade in hand:** *"quantized adds are exposure-doubling steps... a %-scaled timing curve cannot fix a size granularity problem... if you replace the equity cutoffs, gate each add on a projected post-add margin level, not equity tiers."* The real trade confirms the concern was not theoretical.

**Recommendation direction (detail in §9):** the rescue/trend-add *math* (ATR trigger, size multiplier, score thresholds) looks fine and is unchanged since the good era — it does not need to be touched. What needs to change is the *gate* in front of it: replace the hard $25k/$50k equity cutoffs with a margin-projection-aware, %-of-equity-scaled add-timing curve, so a small account gets proportional (not zero) pyramid capability, and add a hard rule that no rescue add may be authorized into an *already-adverse* move without a confirmed reversal signal — which would have blocked the one bad add this dataset actually contains.

---

## 7. Current Architectural Conflicts — Ownership Map

Per the owner's explicit framework (one final authority per responsibility, other modules provide evidence only):

| Responsibility | Current owner(s) | Conflict? |
|---|---|---|
| Market state / regime | `currentRegime` global, computed once per tick | Single owner. OK. |
| Direction / opportunity | `XAU_ComputeActiveDirection()` + `TFDirectionByEMA()` override (9359, 9430) | **Two functions can each independently flip direction** — the override exists specifically because Active-Direction can go neutral/stale; this is evidence-then-override, not two competing authorities, but it should be documented as such, not assumed obviously safe. |
| Setup selection | `ScoreSetups()` (9303) | Single owner. OK. |
| Entry timing / "enter now?" | **Three separate functions weigh in**: `XAUEntryTimingGuard()` (24883, an older "BAD-TIMING" quality gate), `XAU_ClassifySetup()` (6162, countertrend evidence classifier, used inside `ContextGateAllows`), `XAU_TimingEngineConfirmsEntry()` (23724, one-bar reconfirmation wait) | **This is the clearest real duplication in the file.** All three answer variations of "is this entry timing acceptable right now," added in three different eras (pre-v6, v6.17.23, v6.17.22) without being merged. This is the single best candidate for consolidation under §9 — not because any one of them is wrong, but because they were layered rather than unified, exactly the pattern the owner asked me to find. |
| Setup-quality soft opinion | `StrategyFitsPersonality()` (8433, called twice — 12561 and again at 13154 for a "symmetric recheck") | Called twice in one entry pipeline; the second call is a deliberate recheck (not accidental duplication) but worth confirming it can't disagree with itself mid-pipeline. |
| Hard structural block | SmartGuard block (13030–13241) + `ContextGateAllows` Gate 1 (HTF-bias, 6323) | Two different named systems can each independently reject on structure. Not proven contradictory, but not proven non-overlapping either — flagged for §9 investigation, not a confirmed bug. |
| Risk / position sizing | `AccountSizeRiskMultiplier()` (v5.8.8-era) → `XAU_ReconcileFinalRisk` → `InpMinAccountLotFloor` lot floor (16261, **applied last, deliberately overrides the risk-% cap** — "explicit user choice... minimum lot ALWAYS wins over risk cap on wide-SL trades," per its own comment) | **This is a real, self-acknowledged authority override, not a bug** — but per Fable 5, on a sub-$1-2k account this specific override (`InpMinAccountLotFloor=0.10` regardless of account size) can force a risk % far above anything the growth account ever took. Needs an equity floor of its own, not removal. |
| Pyramid/add authority | `CheckPyramidOpportunity()` (10131) gated by `EffectiveMaxPyramidAdds()` (10031) and `XAU_GrowthGuardCanPyramid()` (14968) | Single clear owner (`CheckPyramidOpportunity`), two independent gate functions feeding it. Not contradictory, just two sequential checks — fine as designed. |
| Trade management / exit | `ManageCleanExitsForPosition()` (17461) orchestrates: `XAU_AssessProfitQuality` (5054) → `XAU_ProtectPeakProfitFloor` (5107) → A+ Shield tiers → `XAU_EvaluateExitEV` (4305) → `XAU_ReversalConfirmed` (4586) → `XAU_GateEarlyLossClose` (4493) | Single top-level owner with clean sub-delegation. This is actually the best-organized part of the file. |
| Hard safety | Checks live *inside* `OpenTrade()` itself (margin, lot step, max-risk cap, broker rejection) so every caller inherits them regardless of entry point | Single owner by construction. Good design — this is exactly why the v6.17.25 "entry-path consistency" fix (§8) mattered: anything that called `OpenTrade()` got these checks; anything that bypassed `OpenTrade()` didn't. |
| AI advisory | AI committee (advisory-only since v6.17.11, "AI can never veto a trade again") | Explicitly demoted to advice-only already. Good — matches the owner's target architecture. |

**Bottom line: the file is not nearly as chaotic as "ten bots fighting" would suggest.** Most responsibilities do have a single real owner. The one clear, evidenced duplication is **entry timing** (three functions, three eras, overlapping question). Direction has one legitimate evidence-then-override relationship worth documenting explicitly. Everything else is closer to "needs recalibration" than "needs merging."

---

## 8. The Six Named Fixes — What They Are, Confirmed Intact

| Fix | Function(s) | Line(s) | What it prevents |
|---|---|---|---|
| Scan recovery fix | `g_recoveryState` machine | 3473, 7054, 7187, 7337 | Doomed indicator-retry log-spam loop (744→3 aborts in a 400s test) |
| Countertrend classifier fix | `XAU_ClassifySetup()` | 6162 (v6.17.24 fixed a direction-inversion bug from v6.17.23) | Countertrend evidence being built from the wrong side's direction, making it "nearly impossible to satisfy in an actual downtrend" |
| OpenTrade bool/state fix | `OpenTrade()` return value | 15200, caller guards e.g. 14427, 7921 | Callers committing state (re-entry counters, dashboard) even when the trade silently failed a gate |
| Entry-path consistency fix | `CheckReEntryOpportunity` (7782), `XAU_CheckPendingOpportunityRecovery` (23815), `ContextGateAllows` setupName threading (6323), `XAU_TryForceOpenTrade` (23943) | v6.17.25, whole release | Four different `OpenTrade()` callers each bypassing the classifier/timing gates in their own way |
| Force-open hard safety | `XAU_TryForceOpenTrade()` | 23943 | Explicitly skips only the soft/AI/personality pipeline; margin, lot-step, max-risk, broker-rejection checks still run because they live inside `OpenTrade()` itself |
| Stale recovery protection | `XAU_BlockerIsHardReason()` (24049) + staleness checks (23860–23891, 23972–23977) | v6.17.16, v6.17.21, v6.17.25 | A signal already self-labeled `blockClass=HARD_BLOCK` being re-admitted via the missed-signal recovery path at a worse price |

All six are bug fixes tied to specific, cited runtime evidence (position IDs, dollar losses, %-of-winners stats) — **none of them are "caution for its own sake."** None should be touched. None were touched in producing this report.

---

## 9. What Should Be Preserved / Improved / Never Restored

**Preserve as-is (latest bot's genuine advancements — confirmed valuable, keep exactly as built):**
- All six fixes in §8.
- `XAU_ExhaustionReversalGuard` (6047) and `XAU_GateEarlyLossClose` (4493) — both are backstops against specific realized losses (posId 9483784022, 9477557258), not speculative caution.
- `A+ EVIDENCE DEMOTION` blocking logic — the one blocker the audits proved reliable (only 20% "would have won" if bypassed).
- The exit-management orchestration under `ManageCleanExitsForPosition` (§7) — best-organized subsystem in the file, and §2.4 shows it's already net-positive on a real small account.
- AI advisory-only architecture (can't veto trades).
- The `InpMaxTotalLots` 3%-equity-worst-case aggregate exposure cap — it is *the* thing standing between "aggressive pyramiding" and an uncapped basket; it should be tightened for small accounts (margin-aware, see §6), not removed.

**Improve using old-bot evidence (recalibrate, don't replace):**
- **Entry timing**: three overlapping functions (`XAUEntryTimingGuard`, `XAU_ClassifySetup`, `XAU_TimingEngineConfirmsEntry`) should become one clear pipeline stage with one output, feeding evidence from all three but making one decision — this is the real "systems fighting" the owner is worried about, concretely located.
- **SMART-GUARD and Personality-mismatch strictness** — evidenced as the two lowest-value blockers (43%/47% "would have won"); loosen these two specifically, one at a time, measuring between changes, per Fable 5's caution that "would-have-won rate is not expectancy" — the audits that produced those numbers didn't weight by R, so treat the direction as right and the magnitude as unproven.
- **`XAU_MinArmUSDForOwnR` / A+ Shield arm thresholds / `InpAutoScale`** — unify into one equity-%-and-R-aware arming system instead of three independently-calibrated mechanisms; this finishes work that's already half-built rather than adding a new one.
- **`InpMinAccountLotFloor`** — needs its own equity floor (Fable 5: this override is lethal below roughly $1-2k as currently written); it was a deliberate, correct choice for the $1k-$6k band and should stay for that band.
- **`EffectiveMaxPyramidAdds`'s hard equity cutoffs** — replace with a margin-projection-aware, %-scaled curve (not simply deleting the cutoffs — §6 explains why deletion alone is dangerous).

**Should never be restored / never introduced:**
- Uncapped or loosely-capped simultaneous same-direction stacking near the account's own worst-case exposure ceiling (§2.3 — this is the closest thing in this dataset to "what actually went wrong," and it happened on the *big*, cushioned account; it would be worse on a small one).
- Rescue/averaging adds into an *already-adverse*, *unconfirmed* move — the one clear example in this dataset made a loss worse, not better.
- Any change that reintroduces the pre-v6.4.18 "9 stacked lot-reduction modules" behavior (multiplicative punitive lot cuts after losses) — that's a different failure mode (crushes recovery), already fixed once, not relevant to this work but worth naming so nobody re-adds it by accident while touching sizing code.

---

## 10. Integration Plan Preview (for Phase 2 approval — not yet implemented)

Per the owner's instruction, every proposed change will be written up, before any code is touched, in this exact form: old behavior / current behavior / evidence / expected benefit / risk / exact function affected / replace-vs-modify / proof it doesn't create duplicate authority. That write-up is the next deliverable, gated on sign-off on this report, and will cover — in priority order suggested by the evidence above:

1. **Risk-per-trade proportionality** (highest priority — §2.4's data says this, not the exit engine, is where the small account actually lost money): make risk-% per trade consistent across account sizes, respecting quantization limits Fable 5 flagged (lot-step floor, spread-as-%-of-R).
2. **Entry-timing consolidation** (§7): merge `XAUEntryTimingGuard` / `XAU_ClassifySetup` / `XAU_TimingEngineConfirmsEntry` into one authority, evidence-in/decision-out, rather than three sequential gates.
3. **SMART-GUARD / Personality-mismatch recalibration**, one at a time, per Fable 5's staging advice.
4. **Exit-arm unification** (`XAU_MinArmUSDForOwnR` + `InpAutoScale` + A+ Shield thresholds → one equity-%-and-R-aware system) — lower priority than #1-3 given §2.4 shows exits are not currently the small-account problem, but still needed to finish the proportionality work correctly.
5. **Pyramid gate redesign** (margin-projection-aware, not equity-tier-based) — last, and most carefully, given §2.3/§6.

No implementation will begin until this report and the Phase 2 write-up for each item are reviewed and approved.
