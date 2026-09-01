# M10 Bot — Its Own TradeBrain Model

**Branch:** `experiment/v62524-m10-fixed-sl` (the "10-minute bot with fixed $10 SL")
**Owner directive:** build a SEPARATE TradeBrain model for the M10 bot, trained ONLY on the M10 bot's own real trade history — no shared fingerprints, no pooling with the M5 bot's model. Reuse the exact same pipeline code as the M5 model (`scripts/tradebrain_learning/tradebrain_model.py` / `run_phases.py`, canonical location on `experiment/v62525-m5-tradebrain-learning`), pointed at this branch's own data with its own collection-run ID (`V62524_M10_FIXEDSL_EXPERIMENT`, vs. the M5 branch's `V62525_M5_EXPERIMENT`).
**Status: Model built and evaluated with real data, same walk-forward/holdout rigor as the M5 model. Honest headline: the dataset is too small to trust this model's decisions — reported plainly, not engineered around.**

Cross-linked from `analysis/m5_experiment/TWO_BOT_TRADEBRAIN_COMPARISON.md` on the M5-tradebrain branch, which carries the full side-by-side comparison and the owner-requested drawdown/entry-timing feasibility analysis for both bots.

---

## 0. What had to happen first: porting TradeBrain telemetry onto this branch

This branch (`experiment/v62524-m10-fixed-sl`, checkpoint 1) previously carried ONLY the fixed-Gold-move-SL mechanism, ported from the M5 branch — it never had the TradeBrain learning-system telemetry (drawdown/timing-milestone tracking, `outcomeLabel` classification, the MAE/MFE CSV columns) that `experiment/v62525-m5-tradebrain-learning` built on top of the M5 branch. **The 57-trade dataset the owner referenced already exists as a Strategy Tester result (net trades/wins/losses), but the RAW `.htm` Tester report does not contain fingerprint/thesis/MAE-MFE telemetry — only basic order/deal data.** Building a real TradeBrain model requires the CSV telemetry columns (`signature`, `thesisLocation`, `maeR`, `mfeR`, `outcomeLabel`, etc.), which did not exist on this branch until now.

**What was done, stated plainly:** ported the complete, ALREADY-CORRECTED TradeBrain telemetry code (struct, tracking function, CSV columns, outcome-label classification, and the execution-anomaly-classifier fix) verbatim from `experiment/v62525-m5-tradebrain-learning`'s checkpoint 6 onto this branch (checkpoint 3 here — see commit history), compiled clean (0 errors, 0 warnings — `analysis/m10_tradebrain/checkpoint1_tradebrain_port_compile.log`), and **re-ran the exact same 30-day Strategy Tester window** (2026-06-21 to 2026-07-21, same account/deposit/leverage/tick data as every prior run on this branch) to capture the telemetry.

**This is NOT new data collection in the sense the owner meant to avoid** — it is the identical historical window, replayed deterministically against the same tick data, with TradeBrain telemetry being pure read-only observation that changes no entry/exit/lot-sizing decision (verified: the resulting run produced **exactly** the same 57 trades, same $6,404.13 net profit, same 68.42% win rate as the original, non-instrumented run — confirmed by direct comparison of both `.htm` reports). No new trading activity occurred; this was a technical requirement to capture the fingerprint data the model needs, using data that was already, in substance, "already collected."

---

## 1. Baseline metrics (real)

```
total_close_rows:        57
trustworthy_rows:        57   (all of them -- 0 execution outliers, 0 gap-slippage outliers, 0 data-incomplete)
  wins:                  39
  losses:                18
date_range:              2026-06-22T02:08:20 -- 2026-07-20T17:35:40
net_profit_all_57_rows:  +$6,404.13   (matches the official Tester report exactly)
```

**Every loss has an honest classification — nothing is an unexamined black box** (per the owner's explicit "anything that made a bot lose should be looked into" instruction): all 18 losses are labeled `NORMAL_STRATEGY_LOSS` (trustworthy, no execution-quality issue found) and further broken down by the 5-way entry-timing classification below. 0 trades fell into `EXECUTION_OUTLIER`, `GAP_SLIPPAGE_OUTLIER`, or `DATA_INCOMPLETE` — the classifier that (on the M5 dataset) required a real bugfix was already correct on this branch from day one, and this real 30-day window happened to contain no genuine execution anomalies or session gaps either way.

---

## 2. Knowledge model — real structural finding: even more fragmented than M5

```json
{
  "source_ea_version": "V62524_M10_FIXEDSL_EXPERIMENT",
  "fingerprint_count": 50,
  "sample_count": 57,
  "source_data_sha256": "5084ecb788a1c67e22fa5bbcf19349ccbf2f7e6e53d52b9fcfdedcf208cd9a33"
}
```

**50 distinct exact fingerprints among only 57 trades — an average of 1.14 trades per exact signature, even MORE fragmented than the M5 model's already-thin 203/273 (1.35/signature).** This is the first, and most important, honest structural finding: at this sample size, the fingerprint space is almost entirely unique per trade. There is essentially no repeated-pattern evidence for the EXACT tier to work with at all.

---

## 3. Phase 3 — honest chronological walk-forward (all 57 trades)

| | Blocked | Reduced | Untouched |
|---|---|---|---|
| Losers (18 total) | 0 | 3 | 15 |
| Winners (39 total) | 5 | 4 | 30 |

- loser_capture_rate: **16.67%**
- winner_false_block_rate: **12.82%**
- Authority growth by third: first 19 trades — **0 evidence-valid decisions at all** (the model starts with zero memory and this bot's history is short); middle 19 — 4 evidence-valid; final 19 — 8 evidence-valid. **For roughly the first third of this bot's own trading history, TradeBrain could say nothing at all**, plainly illustrating how little historical depth a 30-day/57-trade bot accumulates even by its own end.
- AS-IS net profit: +$6,404.13, profit factor 1.63; POLICY-applied: +$5,259.60, profit factor 1.54 — the policy reduces net profit relative to doing nothing on the whole-history walk-forward.

---

## 4. Phase 4 — the primary proof (train/holdout, proportionally-scaled split)

The M5 model uses a 60-day train / 30-day holdout split (from a 90-day dataset — a 2:1 ratio). This M10 dataset is only 30 days long; naively reusing a 60-day split would leave a **zero-trade holdout window** (everything falls into "train"), which would be a meaningless, degenerate "proof." `phase4_holdout()` was extended with a configurable `train_days` parameter (defaulting to 60, unchanged for the M5 model) so the SAME proportional rigor (~2:1 train:holdout) could be honestly applied here: **`train_days=20`**, giving a 20-day train window / 10-day holdout window — the same ratio as the M5 model's 60/30 split on its 90-day dataset. This is a real, tested code change (`TierPoolingTests` sibling: `test_train_days_is_configurable_for_shorter_datasets`, 61/61 Python tests passing on the M5-tradebrain worktree where this shared pipeline code lives), not a special-cased fudge for this one report.

**Real result, 18 holdout trades (2026-07-12 to 2026-07-20):**

| | Blocked | Reduced | Untouched |
|---|---|---|---|
| Losers (**3 total**) | 0 | 1 | 2 |
| Winners (15 total) | 1 | 3 | 11 |

- loser_capture_rate: **33.33%** — this is **1 out of 3** decisive losers. This is not a statistically meaningful percentage; it is reported as the honest arithmetic result, not as evidence of real predictive skill.
- winner_false_block_rate: **6.67%**
- AS-IS net profit: +$5,343.78, profit factor 4.45; POLICY-applied: +$4,710.65, profit factor 4.66 — policy reduces net profit by $633.13 relative to doing nothing on this holdout window.

**Honest conclusion, stated exactly as the owner asked, not engineered around: with only 3 decisive losers in the entire honest holdout window, no percentage computed from this Phase 4 result is statistically meaningful. This is not "the M10 model works" or "the M10 model fails" — it is "this dataset is too small to support a real conclusion either way," and that is reported as the finding.**

---

## 5. Sensitivity sweep — the evidence-bar problem, in numbers

| min_decisive_matches | loser_capture_rate | winner_false_block_rate | net_effect_usd | Real meaning |
|---|---|---|---|---|
| 5 | 100.0% | 6.67% | -$513.92 | **3/3 losers "captured" — a sample of 3.** Looks perfect; is not evidence of anything. |
| 10 (production default) | 33.33% | 6.67% | -$633.13 | 1/3 losers captured. |
| 15 | 0.0% | 0.0% | $0.00 | **Every single candidate fails open** — the evidence bar is never cleared by anyone at this threshold on this dataset. |
| 20 | 0.0% | 0.0% | $0.00 | Same — complete fail-open. |

**This is exactly the outcome the owner anticipated and asked to have reported honestly rather than engineered around: at `min_decisive_matches=10` (the SAME production default used for the M5 model — not lowered to force a result), the M10 model's "real" evidence consists of a 3-loser holdout sample, and at more conservative thresholds (15, 20) the model produces literally zero decisions of any kind. The evidence-validity floor is working exactly as designed — failing open rather than fabricating confidence from too little data — and the honest conclusion is that this bot's own 57-trade history is not yet enough to build a trustworthy model, full stop.**

---

## 6. Phase 5 — in-sample ceiling (not proof, reported for completeness only)

| | Blocked | Reduced | Untouched |
|---|---|---|---|
| Losers (18 total) | 0 | 8 | 10 |
| Winners (39 total) | 2 | 14 | 23 |

loser_capture_rate: 44.44%; AS-IS net +$6,404.13 vs POLICY net +$5,714.22 (policy still worse than doing nothing, even with maximum theoretical in-sample recognition on this tiny dataset).

---

## 7. Entry-timing and drawdown classification — every loss examined

Full breakdown (all 57 trades, 5-way classification): **CLEAN_WIN 25, GOOD_SETUP_BAD_TIMING 14, TRUE_INVALIDATION 18, RECOVERABLE_LOSS 0.** All 57 trades accounted for — nothing unclassified.

| outcomeLabel | n | avg MAE(R) | avg MFE(R) | pct recovered after drawdown |
|---|---|---|---|---|
| NORMAL_STRATEGY_WIN | 39 | 0.210 | 0.589 | 35.9% |
| NORMAL_STRATEGY_LOSS | 18 | 0.572 | 0.138 | 0.0% (by definition) |

**Real, notable finding distinct from the M5 dataset: every single one of this bot's 18 losses is `TRUE_INVALIDATION` (avg MFE only 0.138R — none of them ever got meaningfully close to profit). `RECOVERABLE_LOSS` (a loss that got meaningfully favorable before still losing) has ZERO trades on this bot, vs. 12/113 (10.6%) on the M5 bot.** This is real evidence, not a labeling artifact (the same corrected classifier is used for both, and this bot never had the execution-anomaly mislabeling bug to begin with) — on this specific 30-day window, this bot's losses were consistently and cleanly wrong from entry, not near-misses.

**The full drawdown-timing feasibility analysis (how much of this could plausibly have been reduced by evidence-gated better entry timing, no lookahead) is in `analysis/m5_experiment/TWO_BOT_TRADEBRAIN_COMPARISON.md` §3, covering both bots side by side.**

---

## 8. Model identity

- Branch: `experiment/v62524-m10-fixed-sl`
- TradeBrain port + real replay checkpoint: see branch commit log
- Model file: `analysis/m10_tradebrain/phase_results/tradebrain_knowledge_model_full90.json`
- Source data SHA-256: `5084ecb788a1c67e22fa5bbcf19349ccbf2f7e6e53d52b9fcfdedcf208cd9a33`
- Collection run ID: `V62524_M10_FIXEDSL_EXPERIMENT` (deliberately distinct from the M5 branch's `V62525_M5_EXPERIMENT` — no shared fingerprints, no pooling, verified by construction: separate CSV files, separate model files, separate `InpTradeBrainCollectionRunId` baked into each branch's own compiled EX5)
- Pipeline code: reused, unmodified in logic, from `scripts/tradebrain_learning/{tradebrain_model.py,run_phases.py}` on `experiment/v62525-m5-tradebrain-learning` (the one addition, `train_days` parameterization, is a real, tested, backward-compatible extension — M5's own results are unaffected, verified by the existing 60/60 tests plus the new one still passing)
- MQL5-side static tests: `tests/test_xau_v62524_m10_tradebrain_learning_phase1.py`, ported and adapted from the M5 branch's equivalent suite, **30/30 passing** against this branch's own source
- Compile: 0 errors, 0 warnings

## 9. Remaining limitations (stated plainly)

1. **The single most important limitation: 57 trades is not enough data to build a trustworthy TradeBrain model for this bot.** This is not a design flaw in the pipeline (the SAME code, at the SAME evidence-validity settings, produces a real, if imperfect, signal on the 273-trade M5 dataset) — it is a genuine sample-size ceiling. Phase 4's headline number (33.33% loser capture) is arithmetically a 1-in-3 result and should never be quoted as if it were a validated rate.
2. **No sensitivity value tested (5/10/15/20) produces a trustworthy result** — 5 "succeeds" only because n=3; 15 and 20 fail open on literally everything.
3. **Zero RECOVERABLE_LOSS trades** — every loss on this bot, in this window, was a clean invalidation. This is real, not a data gap, but it does mean there is no drawdown-recovery pattern to learn from on this bot specifically (contrast with M5, see the comparison doc).
4. **The TradeBrain telemetry required a source port and a re-run of the same historical window** — stated in §0, not hidden. The resulting 57 trades are verified identical to the original, non-instrumented run.
5. **No live execution authority exists or was built** — same standing rule as the M5 branch.
6. This report reflects ONE 30-day window. No claim of generalization is made.
