# 60-Day Post-Exit Missed-R Report — 10 and 20 Minutes

Continues audit commit `f0f7246999b8a137a5d076e5b260dd7a79a89152`, branch
`audit/codex-complete-xauaisniper-forensic-repair`. Source run: the same
verified 60-day M30-postfix replay (2026-05-18 → 2026-07-17), EX5
SHA-256 `430f8d11478d2d0a80df89f0baf0daa7a8a94534fad3c3d4b96e7a1bffc80bc9`.
Evidence collection only — no signal, timer, SL, risk, pyramid, exit,
profit-floor, trailing, session, or regime logic was changed. Not merged
to main, not deployed.

## Status of the 20-minute checkpoint: NOT OBTAINED (disclosed, not faked)

The EA's own existing post-close learning system (`XAU_UpdateClosedTradeOutcomes`)
was already active for the original run (`InpTradeBrainMemory=true`,
`InpTradeBrainMonitorAfterExit=true`, both confirmed in the tester report's
own input dump) and has real checkpoints at **5, 10, 15, 30, and 60
minutes** — but not 20. A fully isolated, non-decision-influencing 20-minute
telemetry addition was implemented and compiled cleanly (0 errors/0
warnings, EX5 SHA-256 `2fba1da0f6bebf599cd5c763822ca26feac71ab1ca1b5562eeafe76ea94368d5`),
but **the identical 60-day rerun needed to capture it could not be
completed in this environment after multiple attempts** — the isolated
sandbox's headless MT5 launch reliably handles login but does not
reliably auto-start the Strategy Tester itself, and manual GUI attempts
hit their own selection errors (wrong Expert file, wrong/default inputs).
The full sequence of what was tried and exactly why each attempt was
blocked is in `60DAY_POST_EXIT_METHOD_AND_LIMITATIONS.md`, along with the
verified-correct manual steps to complete it later if desired. **Every
20-minute figure below is genuinely blank, not estimated or
interpolated from the 10/15/30-minute checkpoints** (which this
analysis's own protocol explicitly disallows). The EA source patch used
to build the research EX5 has been reverted out of the committed
production source (which still matches the released v6.25.6 exactly)
and preserved separately at
`research_patches/20min_post_close_telemetry_only.patch` for anyone who
wants to reproduce or complete this later.

## 10-Minute Result — CORE profitable trades only (123 of 152 CORE positions)

*(152 total CORE positions; 123 profitable, 29 losses — the 39 total losses
and 1 breakeven reported elsewhere in this audit include 10 pyramid-leg
losses and the 1 breakeven pyramid leg, which are not CORE.)*

| Metric | Value |
|---|---|
| Analyzed | 123 |
| With additional favorable movement | 120 |
| Missing ≥ 0.10R | 82 (66.7%) |
| Missing ≥ 0.25R | 39 (31.7%) |
| Missing ≥ 0.50R | 15 (12.2%) |
| Missing ≥ 1.00R | 2 (1.6%) |
| Average missed R | 0.249 |
| Median missed R | 0.164 |
| 75th percentile | 0.305 |
| 90th percentile | 0.576 |
| Maximum missed R | 2.896 (ticket 320, CAMP-127) |
| Total missed R (all 123) | 30.57R |
| Returned to entry within 10 min | 45 (36.6%) |
| Original SL would have been crossed within 10 min | 2 (1.6%) |

## 10-Minute Result — All 151 profitable positions (incl. pyramids)

| Metric | Value |
|---|---|
| Analyzed | 151 |
| With additional favorable movement | 148 |
| Missing ≥ 0.10R | 101 (66.9%) |
| Missing ≥ 0.25R | 49 (32.5%) |
| Missing ≥ 0.50R | 20 (13.2%) |
| Missing ≥ 1.00R | 2 (1.3%) |
| Average missed R | 0.249 |
| Median missed R | 0.161 |
| 75th percentile | 0.344 |
| 90th percentile | 0.564 |
| Maximum missed R | 2.896 |
| Total missed R (all 151) | 37.52R |
| Returned to entry within 10 min | 58 (38.4%) |
| Original SL would have been crossed within 10 min | 2 (1.3%) |

**These two groups are never combined** — see the separate CSVs
(`60DAY_POST_EXIT_10_20_CORE_TRADES.csv` / `60DAY_POST_EXIT_10_20_ALL_WINNERS.csv`).

## 20-Minute Result

*(PENDING — see status note above. Will be populated with the identical
structure once the isolated telemetry rerun completes and reproduces the
original baseline.)*

## Exit classification (CORE profitable trades, 10-minute basis)

| Classification | Count |
|---|---|
| A — Correct exit, immediate reversal | 40 |
| D — Slightly early exit (+0.10R to +0.25R) | 26 |
| E — Meaningfully early exit (+0.25R to +0.50R) | 22 |
| B — Correct exit, returned to entry first | 17 |
| F — Severely early exit (+0.50R or more) | 13 |
| G — Mixed/volatile after exit | 3 |
| C — Original SL would have been hit | 2 |

**35 of 123 (28.5%)** profitable CORE exits fall into the "meaningfully
or severely early" categories (E + F) — real, quantified evidence of
premature exits, though this is a minority, not the dominant pattern;
**40 of 123 (32.5%)** were genuinely correct exits with an immediate
reversal, and only **2 of 123 (1.6%)** would have hit the original
structural SL had the position been held.

## By exit authority (10-minute basis)

| Exit reason | Trades | Avg exit R | Avg missed R | **Total missed R** |
|---|---|---|---|---|
| R_EXIT_GIVEBACK_45 | 40 | 0.186 | 0.204 | **8.15R** |
| R_PROFIT_GUARANTEE_FLOOR_BREACH | 27 | 0.289 | 0.298 | 8.04R |
| EXTERNAL_CLOSE_BROKER_SL (SL moved into profit) | 14 | 0.283 | **0.337** | 4.72R |
| BASKET_FLOOR_TRIGGERED | 25 | 0.386 | 0.180 | 4.49R |
| R_EXIT_RUNNER_CONTINUATION_FAILED | 13 | 0.288 | 0.306 | 3.98R |
| R_EXIT_TP_1R | 2 | 1.022 | **0.532** | 1.06R |
| DIRECTION_EXCLUSIVITY_PROFITABLE_CLOSE_FIRST | 2 | 0.056 | 0.070 | 0.14R |

**By total impact (sum of missed R across all its trades), `R_EXIT_GIVEBACK_45`
is responsible for the most aggregate missed R (8.15R)** — but this is
driven by volume (40 trades), not by being the worst-per-trade authority.
**By average missed R per trade, `EXTERNAL_CLOSE_BROKER_SL` (0.337R) is the
least efficient** among authorities with a meaningful sample size (`R_EXIT_TP_1R`'s
0.532R average is from only 2 trades and should not be treated as a
reliable pattern). `BASKET_FLOOR_TRIGGERED` has the best per-trade average
missed R (0.180) among the higher-volume authorities, alongside the
highest average exit R (0.386) — i.e. it already captures more before
exiting than the others.

## By market condition (10-minute basis, CORE trades only)

| Regime at signal | Trades | Total missed R |
|---|---|---|
| TREND_DN | 70 | **20.12R** |
| TREND_UP | 42 | 8.47R |
| BRKT_DN | 6 | 1.16R |
| BRKT_UP | 4 | 0.55R |
| CHOPPY | 1 | 0.28R |

**TREND_DN accounts for the most total missed R (20.12R of 30.57R total,
~66%)** — but it also has by far the largest trade count (70 of 123), so
this is a volume effect, not necessarily a per-trade inefficiency; see
`60DAY_POST_EXIT_BY_MARKET_REGIME.csv` for the lifecycle-state and
entry-timing-classification breakdowns as well (available in the CSV,
summarized only partially here for brevity).

## Plain-English conclusion (10-minute evidence; 20-minute pending)

The exit system is not "closing too early" as a dominant, systemic
pattern — a solid third of profitable CORE exits (32.5%) were genuinely
correct calls where price reversed immediately, and the median missed R
across all profitable trades is a modest 0.16R. But there is a real,
quantified tail: **12.2% of profitable CORE trades left at least half a
stop-loss's worth of additional profit (0.50R+) on the table**, and the
single worst case (ticket 320, CAMP-127) left **2.9R** — roughly three
times its own risk — unclaimed within 10 minutes of exit. `R_EXIT_GIVEBACK_45`
and `R_PROFIT_GUARANTEE_FLOOR_BREACH` together account for the majority
of the aggregate missed R by volume; `EXTERNAL_CLOSE_BROKER_SL` (cases
where the EA had already moved the stop into profit and it triggered) is
the least efficient *per trade* among the higher-volume exit authorities.
This is evidence for a *targeted* review of those two/three specific exit
authorities' giveback thresholds, not a case for loosening the exit
system broadly — full 20-minute figures, once verified, will show whether
this pattern extends or changes over a longer post-exit window.
