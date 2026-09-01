# Counter-Excursion Capture — Phase 0 Historical Proof

Read-only counterfactual analysis. No EA changed, nothing deployed, no live/demo trade placed.

## Verdict, upfront

**Do not build live execution. The evidence does not support it.**

Expectancy across every target/stop policy tested is statistically indistinguishable from zero (-0.005R to +0.017R, before transaction costs — which would push most of these negative). The one population that clears a real threshold (+0.115R, news-filter blocks) is explicitly excluded by your own stated safety rules. This is exactly the outcome your Phase 0 gate was designed to catch, and it caught it.

## What was tested, and on what data

**Sample:** 2,060 real blocked candidates with forward-tracked outcomes, drawn from `XAUAI_BlockedTradeMemory` across the EA's full available history — VPS (188, from 2026-07-07) and Mac (1,872, from 2026-06-01). This is the same telemetry source validated in the earlier SMART-GUARD audit.

**Method:** for each blocked candidate, the EA's own `favATR`/`advATR` checkpoints (0/5/10/15/30/60 min) already track how price actually moved after the block. A countertrade entered at the same price, at the same moment, experiences the *exact mirror* of that same real price path — its MFE equals the original's MAE, and its MAE equals the original's MFE. This isn't an approximation of the price path; it's the same verified real data viewed from the other side.

**A methodology error I caught and fixed before this went further:** my first pass pre-filtered to "candidates where the original hit -1R" and then asked whether the mirrored countertrade reached +0.2/0.3/0.5R — and got 100% at every threshold. That's circular, not a finding: if the original hit -1R by definition, the countertrade's MFE is *guaranteed* ≥1.0R by construction, so of course it clears 0.2R. I discarded that pass entirely and rebuilt the simulation on the **full, unfiltered population**, with the countertrade's own independent target and stop — the results below are from that corrected version.

## Critical resolution limit — stated exactly

Checkpoints exist at 5/10/15/30/60 minutes only. The seconds-to-2-minute resolution the original brief asked for (15s/30s/60s/90s) **does not exist in this telemetry** and was not estimated or interpolated. Where a target and stop both first resolve within the same checkpoint gap, the outcome is marked `AMBIGUOUS` and excluded from win/loss stats rather than guessed — 9 to 30 cases per policy, small enough not to change the verdict. **What this means practically: fast, clean countertrade signatures (win in under 2 minutes, as the brief's own good-example hoped for) cannot be distinguished from slower, messier ones in this dataset.** If a real edge exists specifically in the first 60-90 seconds, this analysis cannot see it — see the final section for what's needed to actually check that.

## Target/stop policy comparison (full population, n=2,060)

| Policy | Target | Stop | Resolved | Win rate | Expectancy |
|---|---|---|---|---|---|
| A | +0.2R | -0.2R | 1,908 (92.6%) | 49.7% | -0.001R |
| **B** | **+0.3R** | **-0.2R** | 1,858 (90.2%) | 43.3% | **+0.017R** |
| C | +0.3R | -0.3R | 1,811 (87.9%) | 49.4% | -0.003R |
| D | +0.5R | -0.3R | 1,694 (82.2%) | 38.7% | +0.009R |
| E | +0.5R | -0.4R | 1,594 (77.4%) | 43.9% | -0.005R |

Full detail: `counter_excursion_target_stop_matrix.csv`. None of these clears a bar that would survive real spread + commission on gold (typically 0.02-0.05R+ per round-trip even in good conditions, more during the news/volatility windows where blocks are most common).

## Feature breakdown — where's the predictable subset?

Best policy (B) broken down by setup, block reason, direction, and machine (`counter_excursion_feature_comparison.csv`):

- **By setup:** ASIA_BREAKOUT (+0.05R, n=44) and HTF_TREND_FOLLOW (+0.026R, n=145) edge highest — still marginal, both well within noise for a 0.2-0.3R-scale strategy.
- **By block reason:** `NEWS FILTER (high-impact event nearby)` is the only real outlier — **+0.115R, 63% win rate, n=30**. Every other reason (including the SMART-GUARD/DAMAGE-B population this whole investigation started from, n=346) clusters between -0.04R and +0.03R.
- **By direction:** original BUY-blocked → counter SELL: +0.037R (n=838). Original SELL-blocked → counter BUY: +0.003R (n=1,222). Not symmetric, but both too small to trade.
- **By machine:** VPS +0.017R (n=188), Mac +0.017R (n=1,872) — identical, which is reassuring methodologically (same underlying signal, not an artifact of one account) but doesn't change the verdict.

**The one candidate signature that clears a real bar — news-driven blocks — is exactly the category your brief explicitly disqualifies** ("news blocks... must not automatically trigger this experiment," "no major news/spread/liquidity danger exists" as an eligibility requirement). Trading around high-impact news is also mechanically the wrong fit for a small-risk fast-scalp module: spread widens, slippage grows, and the very "edge" showing up here is plausibly just the news spike itself, not a discoverable market-structure signature repeatable outside news windows.

## Direct answers to the final questions

1. **% of -1R-hit candidates whose mirrored countertrade reached +0.2R:** not a valid question as originally framed — see the circularity note above. The valid version (full population, independent target): 44.4-49.7% reach +0.2R by 60 min, but that's gross hit rate, not net-of-stop expectancy.
2. **+0.3R:** 43.3% win rate at policy B, net expectancy +0.017R (essentially zero).
3. **+0.5R:** 38.7-43.9% depending on stop paired with it, expectancy +0.009R to -0.005R.
4. **Before meaningful adverse movement:** partially — target arrives before stop 79.7-83.6% of the time when both are eventually hit, but this is measuring "target OR stop, whichever resolves first," not "clean move with no drawdown," and doesn't by itself produce positive expectancy (see policy table).
5. **How quickly:** median 10 minutes to +0.3R among cases that reach it — not the "45 seconds" scale the brief's own good-example hoped for. This telemetry cannot resolve anything faster than 5 minutes.
6. **Real-time features identifying the best subset:** none found with both a real edge (>+0.10R) and enough sample size, except news-proximity — which is disqualified.
7. **Countertrade expectancy after costs:** ≈0 before costs, likely negative after spread/commission.
8. **Best target:** +0.3R (policy B), and it's still not tradeable.
9. **Best stop:** -0.2R paired with +0.3R target, same caveat.
10. **Best max hold:** cannot be determined below 5 minutes; among available checkpoints, most resolution happens by 10-15 min.
11. **Does micro-confirmation help or make entries late:** untestable with current telemetry (no sub-5-minute data).
12/13. **Extra opportunities / does it improve real expectancy:** no — it would add trade frequency with ~zero or negative added expectancy, exactly the failure mode the brief said not to build toward.
14. **BUY vs SELL blocks equally:** no — BUY-blocks' countertrade (+0.037R) outperforms SELL-blocks' (+0.003R), a real asymmetry worth noting even though neither is tradeable.
15. **Which sessions/regimes:** session data isn't carried in this telemetry (`BlockedTradeMemory` doesn't log session per row) — flagged as a real gap, not answered.

## What would be needed to actually settle the seconds-scale question

This report answers the question at 5-60 minute resolution honestly and rules out a countertrade edge at that resolution. It cannot rule an edge in or out at the 15s-2min scale the original hypothesis was really about, because that data doesn't exist yet. To get it: instrument the EA (or a separate read-only companion script) to log price at 15/30/60/90-second checkpoints after every block, going forward — there is no way to retroactively produce this from what's already recorded.

## Files in this bundle

- `counter_excursion_all_candidates.csv` — 2,060 rows, full population
- `counter_excursion_hit1R_population.csv` — 359 rows, the original-hit-stop subset (kept for reference; not used for the corrected verdict, see methodology note)
- `counter_excursion_clean_opposite_winners.csv` — top 100 by counter MFE
- `counter_excursion_failed_opposites.csv` — top 100 by counter MAE
- `counter_excursion_feature_comparison.csv`
- `counter_excursion_target_stop_matrix.csv`
- `counter_excursion_report.md` (this file)
- `opposite_target_hit_rates.png`, `opposite_mae_mfe.png`, `target_stop_expectancy_matrix.png`, `hold_time_distribution.png`, `results_by_setup.png`, `results_by_session.png`, `cumulative_counter_strategy_pnl.png`

No EA code, input, or configuration was modified. No live or demo order was placed to produce this analysis.
