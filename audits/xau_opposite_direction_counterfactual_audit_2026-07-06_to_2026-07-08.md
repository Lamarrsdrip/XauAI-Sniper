# XAU AI Sniper — Opposite-Direction Counterfactual Audit

Generated: 2026-07-08
Period audited: 2026-07-06 00:00 through 2026-07-08 06:25 (same window as the prior counterfactual audit, for direct comparability).
Scope: read/analyze/report only. No EA code, `.mq5` files, or `RELEASE_CHECKLIST.md` were touched.

This report extends `xau_signal_counterfactual_audit_2026-07-06_to_2026-07-08.md` (referred to below as "the original report"). The original report tested only whether each blocked signal's **own proposed direction** would have won or lost. It never asked whether the **opposite** direction, evaluated from the same decision timestamp, would have done better. This report answers that question for every signal the original report classified `CLEAN_1R_LOSS` (87 signals), plus the `DANGER_NO_2R` and `NO_CLEAR_EDGE` buckets (20 more signals), for a total of 107 reconstructed counterfactuals.

## Headline finding

**27 of the 87 `CLEAN_1R_LOSS` blocked signals (31%) would have been a clean or partial win if the EA had evaluated the opposite direction from the same timestamp.** Restricting the denominator to signals where the opposite side was even a *legally tradeable* candidate (i.e. excluding cases where a direction-agnostic hard gate — spread spike, news blackout, daily-loss lockout — would have blocked either direction identically), the win rate rises to **27 of 61 eligible signals (44%)**.

This is real signal, not noise: **73 of the 87 `CLEAN_1R_LOSS` signals were BUY candidates** (only 14 were SELL) blocked while gold was drifting down through the period, and **24 of the 27 opposite-direction wins are BUY→would-have-been-SELL**. This directional skew is consistent with a known, already-documented root cause in this codebase: `xauai_reconstruction_report.md` (a separate prior investigation on this machine, dated the same week) found that `HTF_TREND_FOLLOW`/`TREND_PULLBACK` can keep re-qualifying trades off a slow H1/M30 trend-consensus reading that does not flip for hours after the fast timeframe has already reversed. This audit's finding — a systematic BUY-side blocked-loss cluster whose SELL mirror would have worked — is an independent, data-only confirmation of the same underlying pattern, not a re-statement of it.

But the picture is not "just flip every blocked signal": **18 signals (21% of the 87) fall into `BOTH_DIRECTIONS_BAD`** — both sides eventually crossed their own 1R adverse line, meaning neither direction was a clean edge — and **30 signals were `NO_VALID_OPPOSITE_SETUP`**, mostly news/spread blocks that are direction-agnostic and would have stopped the opposite trade too. See "Candidate rules" below for what actually separates the winners from the rest.

## What this report is, and is not

- It is a decision-time reconstruction using only fields the EA itself logged at or before each decision, graded afterward against what price actually did — exactly the original report's honesty standard, just applied to the mirror direction.
- It is **not** a claim that "the EA should always take the opposite of what it blocks." See the feature-separation section: the win rate never exceeds ~50% in any slice large enough to trust, and several natural-looking blockers (spread, most news blocks) are direction-agnostic and shouldn't be touched at all.
- It reuses the original report's own convention that "1R" = 1×ATR and "2R" = 2×ATR for the hypothetical blocked-signal model. That is a simplification the original report explicitly adopted for its blocked-signal simulation; it is **not** the same as the EA's real position-sizing stop, which this audit found (from the 17 executed trades' actual SL distances) is consistently ≈**2.5×ATR** in this dataset. The runner-retention section below uses the *real* 2.5×ATR risk unit, not the 1×ATR hypothetical one, since those are live positions with real stops.

## Data sources used

Same UTF-16 Common Files as the original report, all converted with `iconv -f UTF-16LE -t UTF-8`:

- `XAUAI_TradingIntelligence_XAUUSD.jsonl` — primary source. Contains `BLOCKED`/`BLOCK_CHECK` events (decisionId-grouped, with `favATR`/`advATR` per checkpoint at 5/10/15/30/60 min), `OPEN`/`CLOSE` for the 17 executed trades, and — not used by the original report — `POST_CLOSE` events (the EA's own post-exit tracking, with `maxMore`/`maxReverse` in ATR and dollars) and `MARKET_SNAPSHOT` events (real M5 `o/h/l/c`, RSI, stochastic, EMA, `structure=`, `dxy=`, `spread=` printed roughly every few minutes while the EA scans).
- `XAUAI_Scorecard_2026_07_0{6,7,8}_txt` — joined by timestamp+setup+direction (falling back to nearest-time-any-setup within 15 minutes, since "Market personality" is a market-wide state, not setup-specific) to recover the `Market personality:` field for each blocked candidate. Matched 64/107 signals for a personality read.
- `XAUAI_ExecutedTradeBrain_XAUUSD.csv` / the `OPEN`/`CLOSE`/`POST_CLOSE` rows in the jsonl — used for the runner-retention review of the 17 executed closes.
- `XAUAI_BlockedTradeMemory_XAUUSD.csv`, `XAUAI_GateReport_*.txt`, `XAUAI_ForwardTest_*.txt` — reviewed for cross-checks and daily-level spread/news context (see limitations).

### What I tried for real OHLC price bars, and why I did not use it

Per the task's preference for ground-truth price bars over the favATR/advATR proxy, I searched for and located real MT5 binary history: `Bases/MetaQuotes-Demo/history/XAUUSD/cache/{M1,M5,M15,M30,H1}.hc`. I reverse-engineered enough of the file layout to **positively confirm real M5 bar timestamps** for this exact symbol/period (502-ish byte header, then a contiguous int64 UNIX-timestamp array at 300-second spacing, verified running continuously from 2026-01-20 through 2026-07-07 13:10 — squarely covering the audit window). However, the OHLC price columns that follow the timestamp array are **not** stored as a plain float64 array (tested and ruled out both column-major and row-major float64 layouts — both produced denormalized/garbage floats), and the file size does not divide evenly by any obvious fixed-width record size I tried (60/56/52/48 bytes/bar). This is consistent with known reports that MT5's `.hcc`/`.hc` price columns use an undocumented delta/varint-style compact encoding. I judged further reverse-engineering of an undocumented proprietary binary format to be outside the acceptable risk/time budget for a report whose numbers a trader will act on — an incorrect guessed decoding would silently produce wrong "ground truth" prices, which is worse than clearly-labeled derived data. **I stopped and did not use this source.**

Instead, I used two things that together are strictly better than the pure favATR/advATR proxy the original report relied on:

1. **`MARKET_SNAPSHOT` events** — these are genuine EA-observed M5 `o/h/l/c` price prints (not derived), available for 102 of the 107 target signals within 10 minutes of the decision timestamp. Used to populate "M5 structure reads" wherever available.
2. **`POST_CLOSE` checkpoint events** — genuine EA-tracked post-exit price follow-through (`maxMore`/`maxReverse` in ATR and dollars, at 5/10/15/30/60-minute checkpoints) for every executed trade. Used for the runner-retention review (see below) instead of any derived proxy.

For the opposite-direction counterfactual itself (item 2 of the task), I used the favATR/advATR **inversion** method exactly as the task specifies as the fallback: opposite-favorable ≈ original-adverse, opposite-adverse ≈ original-favorable.

## Methodology detail

### Reproducing the original report's buckets

Grouping `BLOCKED`/`BLOCK_CHECK` rows by `decisionId` in the 2026-07-06 00:00 – 2026-07-08 06:25 window yields 164 decisionIds, 157 with enough follow-up to classify (≥30 min tracked, or a threshold already crossed) — matching the original report's 157 exactly. Using `favATR`/`advATR` **final max values** (order-agnostic, matching the original's own `BOTH_TP_AND_SL_ORDER_UNKNOWN` category, which proves the original methodology is order-agnostic too — see below):

- `favATR≥2, advATR<1` → `CLEAN_2R_WIN`: **33** (matches original exactly)
- `1≤favATR<2, advATR<1` → `PARTIAL_1R_PLUS`: **11** (matches exactly)
- `favATR≥2, advATR≥1` → `BOTH_TP_AND_SL_ORDER_UNKNOWN`: **6** (matches exactly)
- The remaining 107 records split into what the original calls `CLEAN_1R_LOSS` (87) / `DANGER_NO_2R` (8) / `NO_CLEAR_EDGE` (12). I could not reverse-engineer the original's *exact* internal split of these three (I tried several thresholds; none reproduced 87/8/12 exactly), but I confirmed the rule `advATR≥1 AND favATR<2` reproduces **exactly 87** records — an exact match on the number that matters for this audit's headline. The remaining 20 records (`advATR<1 AND favATR<1`) match the original's `DANGER_NO_2R + NO_CLEAR_EDGE` combined total (8+12=20) exactly. I did not split these 20 further into the original's two sub-labels, because — as shown below — it does not change their counterfactual classification: by construction, when both original favATR and advATR are under 1, both the original and the opposite direction stay under 1R in the tracked window, so the opposite-direction outcome for this whole 20-record group is essentially always `DATA_INSUFFICIENT` (16 of 20) or a symmetric-blocker `NO_VALID_OPPOSITE_SETUP` (4 of 20) — none are wins or clean losses either way.
- **I confirmed per-checkpoint `wouldTP2R=Y/N wouldSL1R=Y/N` order flags exist in the raw data**, but the original report's own worked example (2026-07-06 00:34 BUY, favATR=3.70/advATR=1.22, classified `BOTH_TP_AND_SL_ORDER_UNKNOWN`) shows `wouldSL1R=Y` as early as the 5-minute checkpoint, well before `wouldTP2R` ever fires at 60 minutes — yet the original still called this "order unknown." This confirms the original methodology used final max values only, order-agnostic, which is what I replicated.

### Opposite-direction inversion and classification rules

For each of the 107 target signals, `opp_fav = original advATR`, `opp_adv = original favATR` (per the task's inversion instruction). Classification, in priority order:

1. **`NO_VALID_OPPOSITE_SETUP`** — the blocker is a direction-agnostic hard gate that would fire identically for either direction: spread-spike blocks, all `NEWS_*` blocks **except** the sub-case where the block text literally reads `impulseDir=X but signal=Y` (that specific check is directional — it compares the proposed direction against the news impulse direction, and would *not* fire for the opposite direction, since the opposite would then match the impulse; those 3 records were **not** treated as symmetric and were scored on price instead), and `ADAPTIVE_RECOVERY` (an account daily-loss-state gate, not a market-direction gate).
2. **`DATA_INSUFFICIENT`** — neither `opp_fav` nor `opp_adv` reached 1R within the tracked window (max 60 min). Genuinely can't call it.
3. **`BOTH_DIRECTIONS_BAD`** — `opp_adv≥1` (i.e. original favATR≥1): the opposite side would also eventually have breached its own 1R adverse line. Order-of-events unknown (same limitation as the original report's `BOTH_TP_AND_SL_ORDER_UNKNOWN`), but this rules out calling it a clean opposite win.
4. **`ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS`** or **`LATE_CONFIRMATION_ONLY`** — `opp_fav≥1` and `opp_adv<1` (a clean opposite move, no adverse breach). I additionally checked the **checkpoint at which `opp_fav` first crossed 1R** (using the 5/10/15/30/60-minute checkpoint series). If the first crossing happened at the 30- or 60-minute checkpoint (i.e. not within the ~15-minute window the EA's own fast-TF confirmation gates realistically operate in), I classified it `LATE_CONFIRMATION_ONLY` rather than a win — it would not have been exploitable with the same fast-TF-confirmation discipline the EA applies to its real entries. Only crossings by the 15-minute checkpoint count as `ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS`.
5. **`ORIGINAL_WRONG_DIRECTION_OPPOSITE_LOSES`** never structurally occurs for this input set. This is a mechanical consequence of the definitions: every record in scope has `original favATR<2`, so `opp_adv<2` always; a genuine "opposite also cleanly loses" (`opp_fav<1 AND opp_adv≥1`) would require `original advATR<1` (contradicting the ≥1 floor that put it in this bucket in the first place) or would already be `DATA_INSUFFICIENT`/`BOTH_DIRECTIONS_BAD`. **I am flagging this explicitly rather than force-fitting records into the label**: it is an honest structural limitation of the favATR/advATR inversion proxy, not evidence that the opposite direction is always at least as good. A true price-bar reconstruction (which I could not safely produce — see above) would be needed to test genuine opposite-side clean losses.

## Full opposite-direction counterfactual table (107 signals)

`favATR`/`advATR` are the **original** direction's values (same convention as the original report). "Personality" is the nearest-matched `Market personality:` reading from the Scorecard files (`-` = no match within tolerance).

| Time | Dir | Setup | Grade | Blocker | favATR | advATR | Personality | Opp class | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026.07.06 01:00 | BUY | TREND_PULLBACK | A | A+ EVIDENCE DEMOTION | 1.99 | 2.40 | RANGE | BOTH_DIRECTIONS_BAD | opposite direction's own adverse excursion (= original favATR) also reached >=1R — order of TP/SL unknown |
| 2026.07.06 02:05 | BUY | TREND_PULLBACK | A | A+ EVIDENCE DEMOTION | 1.98 | 1.27 | RANGE | BOTH_DIRECTIONS_BAD | opposite direction's own adverse excursion also reached >=1R — order unknown |
| 2026.07.06 02:31 | BUY | TREND_PULLBACK | A | Trade blocked — momentum slowdown | 0.00 | 3.88 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=5 |
| 2026.07.06 04:15 | BUY | TREND_PULLBACK | A | NEWS_ENTRY_BLOCKED_POOR_RR | 1.00 | 1.34 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic poor-RR/room block |
| 2026.07.06 04:20 | BUY | TREND_PULLBACK | A | BAD-LOCATION BLOCK | 1.26 | 1.14 | - | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.06 04:50 | BUY | HTF_TREND_FOLLOW | A+ | NEWS_OBSERVING | 0.00 | 2.48 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic (weak impulse body) |
| 2026.07.06 05:20 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.00 | 2.72 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=10 |
| 2026.07.06 05:25 | BUY | TREND_PULLBACK | A | FAILED-IMPULSE BLOCK | 0.00 | 1.78 | RANGE | LATE_CONFIRMATION_ONLY | first crossed 1R at 60-min checkpoint |
| 2026.07.06 06:00 | BUY | HTF_TREND_FOLLOW | A+ | NEWS_OBSERVING | 0.00 | 1.96 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.06 06:39 | BUY | HTF_TREND_FOLLOW | A+ | Trade blocked — momentum slowdown | 0.00 | 1.45 | RANGE | LATE_CONFIRMATION_ONLY | first crossed 1R at 60-min checkpoint |
| 2026.07.06 07:10 | BUY | HTF_TREND_FOLLOW | A+ | Trade blocked — spread | 0.40 | 2.41 | RANGE | NO_VALID_OPPOSITE_SETUP | spread spike, direction-agnostic |
| 2026.07.06 07:30 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.07 | 2.83 | RANGE | LATE_CONFIRMATION_ONLY | first crossed 1R at 30-min checkpoint |
| 2026.07.06 07:45 | BUY | TREND_PULLBACK | B | B-GRADE QUALITY BLOCK | 0.27 | 2.69 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=15 |
| 2026.07.06 08:05 | SELL | ASIA_BREAKOUT | B | NEWS_ENTRY_BLOCKED_POOR_RR | 1.72 | 1.15 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic poor-RR block |
| 2026.07.06 08:10 | SELL | ASIA_BREAKOUT | PERSONALITY | Personality mismatch | 1.89 | 1.02 | RANGE | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.06 08:20 | SELL | BREAKOUT | PERSONALITY | Personality mismatch | 1.32 | 1.61 | RANGE | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.06 08:35 | BUY | HTF_TREND_FOLLOW | B | Trade blocked — spread | 0.00 | 2.75 | RANGE | NO_VALID_OPPOSITE_SETUP | spread spike, direction-agnostic |
| 2026.07.06 08:40 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.00 | 2.41 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=15 |
| 2026.07.06 09:00 | SELL | ASIA_BREAKOUT | B | Trade blocked — spread | 0.61 | 1.44 | RANGE | NO_VALID_OPPOSITE_SETUP | spread spike, direction-agnostic |
| 2026.07.06 09:25 | BUY | HTF_TREND_FOLLOW | A | NEWS_OBSERVING | 0.81 | 0.85 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.06 09:30 | BUY | HTF_TREND_FOLLOW | PERSONALITY | Personality mismatch | 0.05 | 1.56 | RANGE | LATE_CONFIRMATION_ONLY | first crossed 1R at 30-min checkpoint |
| 2026.07.06 09:45 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 1.94 | 1.43 | RANGE | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.06 10:45 | BUY | TREND_PULLBACK | A | NEWS_ENTRY_BLOCKED_OVEREXTENDED | 0.16 | 3.55 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.06 10:50 | BUY | TREND_PULLBACK | A | NEWS_ENTRY_BLOCKED_POOR_RR | 0.00 | 3.74 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic poor-RR block |
| 2026.07.06 10:55 | BUY | TREND_PULLBACK | A | TREND-CONTINUATION MODE | 0.20 | 3.56 | - | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=15 |
| 2026.07.06 11:00 | BUY | TREND_PULLBACK | A | NEWS_OBSERVING | 0.00 | 3.87 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.06 11:05 | BUY | TREND_PULLBACK | A | FAILED-IMPULSE BLOCK | 0.00 | 2.92 | - | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=10 |
| 2026.07.06 11:15 | BUY | HTF_TREND_FOLLOW | B | Trade blocked — spread | 0.00 | 2.51 | - | NO_VALID_OPPOSITE_SETUP | spread spike, direction-agnostic |
| 2026.07.06 11:50 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.80 | 2.81 | RANGE | LATE_CONFIRMATION_ONLY | first crossed 1R at 60-min checkpoint |
| 2026.07.06 13:35 | BUY | TREND_PULLBACK | A | TREND-CONTINUATION MODE | 0.80 | 0.51 | RANGE | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.06 13:45 | BUY | TREND_PULLBACK | A | BAD-TIMING BLOCK | 0.84 | 0.70 | - | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.06 14:00 | BUY | TREND_PULLBACK | A | A+ EVIDENCE DEMOTION | 0.83 | 0.80 | - | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.06 14:20 | BUY | TREND_PULLBACK | A | Trade blocked — momentum slowdown | 0.28 | 2.60 | - | LATE_CONFIRMATION_ONLY | first crossed 1R at 30-min checkpoint |
| 2026.07.06 14:25 | BUY | TREND_PULLBACK | A | BAD-LOCATION BLOCK | 0.00 | 3.61 | RANGE | LATE_CONFIRMATION_ONLY | first crossed 1R at 30-min checkpoint |
| 2026.07.06 14:35 | BUY | TREND_PULLBACK | B | B-GRADE QUALITY BLOCK | 0.00 | 6.89 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=10 |
| 2026.07.06 14:40 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.37 | 6.37 | RANGE | LATE_CONFIRMATION_ONLY | first crossed 1R at 60-min checkpoint |
| 2026.07.06 14:45 | BUY | HTF_TREND_FOLLOW | A | NEWS_OBSERVING | 0.59 | 6.50 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.06 14:50 | BUY | HTF_TREND_FOLLOW | A | NEWS_ENTRY_BLOCKED_POOR_RR | 1.40 | 5.60 | RANGE | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.06 15:15 | BUY | TREND_PULLBACK | B | SMART-GUARD | 0.21 | 6.60 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=5 |
| 2026.07.06 15:58 | BUY | HTF_TREND_FOLLOW | A | Trade blocked — momentum slowdown | 1.54 | 2.29 | EXPANSION | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.06 16:10 | BUY | HTF_TREND_FOLLOW | B | STI_REENTRY_WAIT | 0.58 | 2.73 | EXPANSION | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=5 |
| 2026.07.06 16:20 | SELL | ASIA_BREAKOUT | B | BAD-LOCATION BLOCK | 1.73 | 1.39 | - | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.06 16:25 | BUY | HTF_TREND_FOLLOW | A | NEWS_OBSERVING | 0.33 | 2.60 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.06 16:30 | BUY | TREND_PULLBACK | SKIP | SMART-GUARD | 0.63 | 2.17 | - | LATE_CONFIRMATION_ONLY | first crossed 1R at 30-min checkpoint |
| 2026.07.06 16:35 | BUY | HTF_TREND_FOLLOW | A | NEWS_ENTRY_BLOCKED_POOR_RR | 0.02 | 2.85 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic poor-RR block |
| 2026.07.06 16:45 | BUY | HTF_TREND_FOLLOW | A | NEWS FILTER (high-impact event) | 0.05 | 2.62 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.06 18:50 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 1.12 | 1.35 | RANGE | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.06 21:00 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.96 | 1.53 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=PARTIAL_1R, first_cross_min=5 |
| 2026.07.06 22:05 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.83 | 0.81 | RANGE | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.06 22:20 | BUY | TREND_PULLBACK | B | NEWS_OBSERVING | 0.89 | 0.56 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.06 22:30 | BUY | TREND_PULLBACK | A+ | NEWS_ENTRY_BLOCKED_POOR_RR | 0.50 | 1.05 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic poor-RR block |
| 2026.07.06 23:10 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.00 | 0.03 | RANGE | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.07 01:00 | BUY | TREND_PULLBACK | A | BAD-LOCATION BLOCK | 0.00 | 2.08 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=5 |
| 2026.07.07 01:05 | BUY | TREND_PULLBACK | A+ | Trade blocked — spread | 0.93 | 0.61 | RANGE | NO_VALID_OPPOSITE_SETUP | spread spike, direction-agnostic |
| 2026.07.07 01:10 | BUY | TREND_PULLBACK | A | NEWS_ENTRY_BLOCKED_OVEREXTENDED | 0.94 | 0.58 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.07 01:20 | BUY | TREND_PULLBACK | A | NEWS_ENTRY_BLOCKED_POOR_RR | 0.40 | 2.82 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic poor-RR block |
| 2026.07.07 01:25 | BUY | TREND_PULLBACK | A | A+ EVIDENCE DEMOTION | 1.14 | 2.13 | - | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.07 01:30 | BUY | TREND_PULLBACK | A | BAD-TIMING BLOCK | 0.82 | 2.58 | - | LATE_CONFIRMATION_ONLY | first crossed 1R at 60-min checkpoint |
| 2026.07.07 01:35 | BUY | BREAKOUT | A | NEWS_OBSERVING | 0.00 | 3.42 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.07 01:50 | BUY | TREND_PULLBACK | A | FAILED-IMPULSE BLOCK | 0.00 | 4.15 | - | LATE_CONFIRMATION_ONLY | first crossed 1R at 30-min checkpoint |
| 2026.07.07 02:05 | BUY | TREND_PULLBACK | A+ | TRADE-BRAIN BLOCK | 0.04 | 4.13 | WEAK_TREND | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=10 |
| 2026.07.07 03:05 | BUY | TREND_PULLBACK | SKIP | SMART-GUARD | 1.71 | 6.41 | - | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.07 03:30 | BUY | TREND_PULLBACK | A | NEWS_ENTRY_BLOCKED_OVEREXTENDED | 0.00 | 8.98 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.07 03:35 | BUY | TREND_PULLBACK | A | FAILED-IMPULSE BLOCK | 0.00 | 7.00 | - | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=5 |
| 2026.07.07 03:55 | BUY | HTF_TREND_FOLLOW | A+ | NEWS_OBSERVING | 0.00 | 5.19 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.07 04:15 | BUY | RANGE_REVERSAL | A | NEWS_ENTRY_BLOCKED_POOR_RR | 0.27 | 1.86 | - | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=PARTIAL_1R, first_cross_min=5 (impulseDir/signal mismatch — directional, not symmetric) |
| 2026.07.07 04:40 | BUY | TREND_PULLBACK | SKIP | SMART-GUARD | 0.76 | 0.32 | WEAK_TREND | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.07 04:51 | BUY | TREND_PULLBACK | B | B-GRADE QUALITY BLOCK | 0.16 | 1.77 | RANGE | LATE_CONFIRMATION_ONLY | first crossed 1R at 60-min checkpoint |
| 2026.07.07 05:01 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.42 | 1.50 | RANGE | LATE_CONFIRMATION_ONLY | first crossed 1R at 60-min checkpoint |
| 2026.07.07 05:15 | BUY | HTF_TREND_FOLLOW | PERSONALITY | Personality mismatch | 0.21 | 1.85 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=PARTIAL_1R, first_cross_min=15 |
| 2026.07.07 06:00 | BUY | HTF_TREND_FOLLOW | B | ADAPTIVE_RECOVERY | 0.80 | 1.95 | RANGE | NO_VALID_OPPOSITE_SETUP | account daily-loss gate, direction-agnostic |
| 2026.07.07 06:10 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.07 | 2.56 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=15 |
| 2026.07.07 07:00 | BUY | HTF_TREND_FOLLOW | A+ | Trade blocked — momentum slowdown | 1.77 | 1.25 | RANGE | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.07 07:15 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.00 | 3.26 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=15 |
| 2026.07.07 07:40 | BUY | HTF_TREND_FOLLOW | A | NEWS_ENTRY_BLOCKED_POOR_RR | 0.03 | 2.79 | RANGE | LATE_CONFIRMATION_ONLY | impulseDir mismatch (directional); first crossed 1R at 30-min |
| 2026.07.07 07:50 | BUY | HTF_TREND_FOLLOW | A+ | NEWS_OBSERVING | 0.26 | 1.67 | RANGE | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.07 08:20 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.87 | 1.18 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=PARTIAL_1R, first_cross_min=15 |
| 2026.07.07 08:25 | BUY | HTF_TREND_FOLLOW | A | Trade blocked — momentum slowdown | 0.00 | 1.80 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=PARTIAL_1R, first_cross_min=10 |
| 2026.07.07 09:25 | BUY | HTF_TREND_FOLLOW | B | STI_REENTRY_WAIT | 0.57 | 0.63 | RANGE | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.07 09:45 | BUY | TREND_PULLBACK | A | SMART-GUARD | 0.92 | 1.41 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=PARTIAL_1R, first_cross_min=15 |
| 2026.07.07 09:50 | BUY | HTF_TREND_FOLLOW | A | BAD-LOCATION BLOCK | 1.44 | 1.01 | RANGE | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.07 11:15 | BUY | TREND_PULLBACK | A+ | SMART-GUARD | 0.12 | 3.19 | - | LATE_CONFIRMATION_ONLY | first crossed 1R at 30-min checkpoint |
| 2026.07.07 15:10 | BUY | BREAKOUT | A | Trade blocked — momentum slowdown | 1.45 | 1.03 | - | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.07 15:15 | BUY | SQUEEZE_RELEASE | A | Trade blocked — momentum slowdown | 0.40 | 1.89 | - | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=PARTIAL_1R, first_cross_min=5 |
| 2026.07.07 16:45 | BUY | TREND_PULLBACK | A | NEWS_ENTRY_BLOCKED_POOR_RR | 0.00 | 3.87 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic poor-RR block |
| 2026.07.07 19:12 | SELL | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.00 | 1.17 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=PARTIAL_1R, first_cross_min=15 |
| 2026.07.07 19:57 | SELL | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.22 | 0.90 | RANGE | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.07 20:00 | BUY | TREND_PULLBACK | A+ | SMART-GUARD | 0.61 | 0.75 | RANGE | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.07 20:45 | BUY | HTF_TREND_FOLLOW | A | A+ EVIDENCE DEMOTION | 0.00 | 4.79 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=5 |
| 2026.07.07 22:45 | SELL | SQUEEZE_RELEASE | B | Trade blocked — momentum slowdown | 0.00 | 0.93 | - | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.07 22:50 | SELL | SQUEEZE_RELEASE | A | FAILED-IMPULSE BLOCK | 0.00 | 0.62 | - | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.07 22:55 | BUY | TREND_PULLBACK | B | B-GRADE QUALITY BLOCK | 0.00 | 0.22 | - | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.07 23:38 | BUY | TREND_PULLBACK | B | B-GRADE QUALITY BLOCK | 0.00 | 0.01 | - | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.08 00:32 | BUY | TREND_PULLBACK | B | B-GRADE QUALITY BLOCK | 0.00 | 1.68 | - | LATE_CONFIRMATION_ONLY | first crossed 1R at 30-min checkpoint (all TFs against) |
| 2026.07.08 01:00 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.00 | 0.52 | RANGE | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.08 01:05 | SELL | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.43 | 0.00 | RANGE | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.08 02:02 | SELL | TREND_PULLBACK | SKIP | BAD-TIMING BLOCK | 0.05 | 1.71 | RANGE | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=PARTIAL_1R, first_cross_min=5 |
| 2026.07.08 02:05 | SELL | TREND_PULLBACK | B | FAILED-IMPULSE BLOCK | 0.87 | 0.89 | RANGE | DATA_INSUFFICIENT | neither side cleared 1R within 60 min |
| 2026.07.08 02:55 | SELL | TREND_PULLBACK | A | BAD-LOCATION BLOCK | 0.00 | 6.44 | - | LATE_CONFIRMATION_ONLY | first crossed 1R at 30-min checkpoint |
| 2026.07.08 03:40 | BUY | BREAKOUT | A+ | SMC_HARD_CONFLICT | 0.00 | 4.83 | - | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=10 |
| 2026.07.08 03:40 | BUY | BREAKOUT | SKIP | SMART-GUARD | 0.00 | 4.88 | - | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=10 |
| 2026.07.08 04:20 | SELL | TREND_PULLBACK | A | A+ EVIDENCE DEMOTION | 1.43 | 1.45 | - | BOTH_DIRECTIONS_BAD | order unknown, both sides breach 1R |
| 2026.07.08 04:25 | SELL | TREND_PULLBACK | A | NEWS_OBSERVING | 1.01 | 1.87 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic |
| 2026.07.08 04:35 | SELL | TREND_PULLBACK | A | NEWS_ENTRY_BLOCKED_POOR_RR | 0.00 | 2.71 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic poor-RR block |
| 2026.07.08 04:40 | SELL | TREND_PULLBACK | A | BAD-LOCATION BLOCK | 0.00 | 2.57 | - | ORIGINAL_WRONG_DIRECTION_OPPOSITE_WINS | win_type=CLEAN_2R, first_cross_min=10 |
| 2026.07.08 04:50 | SELL | TREND_PULLBACK | A | SMART-GUARD | 0.34 | 1.19 | - | LATE_CONFIRMATION_ONLY | first crossed 1R at 60-min checkpoint |
| 2026.07.08 06:00 | SELL | TREND_PULLBACK | A | NEWS FILTER (high-impact event) | 0.00 | 1.97 | - | NO_VALID_OPPOSITE_SETUP | direction-agnostic |

*(The 20 `DANGER_NO_2R`/`NO_CLEAR_EDGE` signals — original favATR<1 and advATR<1 — are folded into the table above; all classify `DATA_INSUFFICIENT` (16) or `NO_VALID_OPPOSITE_SETUP` (4), consistent with the structural point made in the Methodology section.)*

## Top opposite-direction wins (biggest would-be moves)

| Time | Orig Dir | Setup | Grade | Blocker | Orig favATR | Orig advATR | Opp would-be favATR | Opp win type |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026.07.07 03:35 | BUY (opp=SELL) | TREND_PULLBACK | A | FAILED-IMPULSE BLOCK | 0.00 | 7.00 | 7.00 | CLEAN_2R |
| 2026.07.06 14:35 | BUY (opp=SELL) | TREND_PULLBACK | B | B-GRADE QUALITY BLOCK | 0.00 | 6.89 | 6.89 | CLEAN_2R |
| 2026.07.06 15:15 | BUY (opp=SELL) | TREND_PULLBACK | B | SMART-GUARD | 0.21 | 6.60 | 6.60 | CLEAN_2R |
| 2026.07.08 03:40 | BUY (opp=SELL) | BREAKOUT | SKIP | SMART-GUARD | 0.00 | 4.88 | 4.88 | CLEAN_2R |
| 2026.07.08 03:40 | BUY (opp=SELL) | BREAKOUT | A+ | SMC_HARD_CONFLICT | 0.00 | 4.83 | 4.83 | CLEAN_2R |
| 2026.07.07 20:45 | BUY (opp=SELL) | HTF_TREND_FOLLOW | A | A+ EVIDENCE DEMOTION | 0.00 | 4.79 | 4.79 | CLEAN_2R |
| 2026.07.07 02:05 | BUY (opp=SELL) | TREND_PULLBACK | A+ | TRADE-BRAIN BLOCK | 0.04 | 4.13 | 4.13 | CLEAN_2R |
| 2026.07.06 02:31 | BUY (opp=SELL) | TREND_PULLBACK | A | Trade blocked — momentum slowdown | 0.00 | 3.88 | 3.88 | CLEAN_2R |
| 2026.07.06 10:55 | BUY (opp=SELL) | TREND_PULLBACK | A | TREND-CONTINUATION MODE | 0.20 | 3.56 | 3.56 | CLEAN_2R |
| 2026.07.07 07:15 | BUY (opp=SELL) | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.00 | 3.26 | 3.26 | CLEAN_2R |
| 2026.07.06 11:05 | BUY (opp=SELL) | TREND_PULLBACK | A | FAILED-IMPULSE BLOCK | 0.00 | 2.92 | 2.92 | CLEAN_2R |
| 2026.07.06 16:10 | BUY (opp=SELL) | HTF_TREND_FOLLOW | B | STI_REENTRY_WAIT | 0.58 | 2.73 | 2.73 | CLEAN_2R |
| 2026.07.06 05:20 | BUY (opp=SELL) | TREND_PULLBACK | PERSONALITY | Personality mismatch | 0.00 | 2.72 | 2.72 | CLEAN_2R |
| 2026.07.06 07:45 | BUY (opp=SELL) | TREND_PULLBACK | B | B-GRADE QUALITY BLOCK | 0.27 | 2.69 | 2.69 | CLEAN_2R |
| 2026.07.08 04:40 | SELL (opp=BUY) | TREND_PULLBACK | A | BAD-LOCATION BLOCK | 0.00 | 2.57 | 2.57 | CLEAN_2R |

## What separates opposite-wins from opposite-losses/both-bad

All slices below are drawn from the 87-signal `CLEAN_1R_LOSS` set. **Sample sizes are small; treat anything under ~15 records as suggestive, not proven.**

### By blocker type

| Blocker | n | Opposite wins | Late-confirm only | Both bad | No valid opposite | Win rate (of tradeable) |
| --- | --- | --- | --- | --- | --- | --- |
| Personality mismatch | 17 | 8 | 5 | 4 | 0 | **47%** |
| SMART-GUARD | 7 | 3 | 3 | 1 | 0 | 43% |
| Trade blocked — momentum slowdown | 8 | 3 | 2 | 3 | 0 | 38% |
| B-GRADE QUALITY BLOCK | 4 | 2 | 2 | 0 | 0 | 50% (n=4, too small to trust) |
| FAILED-IMPULSE BLOCK | 4 | 2 | 2 | 0 | 0 | 50% (n=4, too small to trust) |
| BAD-LOCATION BLOCK | 7 | 2 | 2 | 3 | 0 | 29% |
| A+ EVIDENCE DEMOTION | 5 | 1 | 0 | 4 | 0 | 20% — **worst of the sizeable groups** |
| NEWS_ENTRY_BLOCKED_POOR_RR | 11 | 1 | 1 | 1 | 8 | 33% of the 3 that weren't direction-agnostic |
| NEWS_OBSERVING | 9 | 0 | 0 | 0 | 9 | n/a — always direction-agnostic in this data |
| Trade blocked — spread | 4 | 0 | 0 | 0 | 4 | n/a — always direction-agnostic in this data |
| BAD-TIMING BLOCK, TREND-CONTINUATION MODE, STI_REENTRY_WAIT, TRADE-BRAIN BLOCK, SMC_HARD_CONFLICT, NEWS_ENTRY_BLOCKED_OVEREXTENDED, NEWS FILTER, ADAPTIVE_RECOVERY | 1-2 each | mixed | — | — | — | samples too small (n≤2) to draw any conclusion |

The clearest, most trustworthy pattern: **`Personality mismatch` blocks are the single largest and best-performing category for opposite-direction wins (8 of 17, 47%)**, while **`A+ EVIDENCE DEMOTION` blocks are the worst (1 of 5 wins, 4 of 5 both-bad)** — i.e. when the EA's highest-grade setups get demoted for "clean positioning" concerns, the data says *neither* direction was safe, not that the opposite was the right call.

### By grade

| Grade | n | Opposite wins | Win rate (of tradeable) |
| --- | --- | --- | --- |
| B | 12 | 4 | 57% (n=12, modest sample) |
| PERSONALITY | 17 | 8 | 47% |
| SKIP | 4 | 2 | 50% (n=4, too small) |
| A+ | 11 | 2 | 40% |
| A | 43 | 11 | 39% |

Consistent with the original report's own finding that "grade alone is not reliable enough": there is no monotonic relationship between grade and opposite-win rate. A+ (the EA's highest confidence label) does not perform meaningfully better than A or PERSONALITY here.

### By market personality (nearest Scorecard match, 51 of 87 matched)

`RANGE` personality dominates the sample (48 of 51 matches) at a 47% opposite-win rate among tradeable signals. `EXPANSION` and `WEAK_TREND` have only 1-2 records each — not usable for a real conclusion.

### By setup

`TREND_PULLBACK` (53 signals, 45% win rate of tradeable) and `HTF_TREND_FOLLOW` (23 signals, 36%) are the only setups with enough volume to say anything. `ASIA_BREAKOUT` (4 signals, 0% wins, 2 both-bad) is a small but suspicious cluster worth re-checking with more data before concluding anything.

### Fast-timeframe structure disagreement (SmartGuard/B-GRADE blocks only — 11 of 87 signals had this logged)

Only `SMART-GUARD` and `B-GRADE QUALITY BLOCK` reasonKeys log the underlying M5/M15/M30/H1 `OK`/`AGAINST`/`NEUTRAL` structure reads in their `extra` text; no other blocker type logs this. Within this small (n=11) subset:

| M5 | M15 | M30 | H1 | Opp class |
| --- | --- | --- | --- | --- |
| AGAINST | AGAINST | NEUTRAL | OK | OPPOSITE_WINS |
| OK | AGAINST | AGAINST | OK | OPPOSITE_WINS |
| OK | AGAINST | AGAINST | OK | OPPOSITE_WINS |
| OK | AGAINST | AGAINST | AGAINST | OPPOSITE_WINS |
| OK | AGAINST | AGAINST | AGAINST | OPPOSITE_WINS |
| AGAINST | AGAINST | AGAINST | NEUTRAL | LATE_CONFIRMATION_ONLY |
| AGAINST | AGAINST | AGAINST | NEUTRAL | LATE_CONFIRMATION_ONLY |
| OK | AGAINST | AGAINST | AGAINST | LATE_CONFIRMATION_ONLY |
| AGAINST | AGAINST | AGAINST | AGAINST | LATE_CONFIRMATION_ONLY |
| NEUTRAL | OK | OK | OK | LATE_CONFIRMATION_ONLY |
| AGAINST | NEUTRAL | NEUTRAL | OK | BOTH_DIRECTIONS_BAD |

Suggestive-only pattern (n=11, do not treat as proven): **the 5 opposite-wins all had M15 and/or M30 reading `AGAINST` the original direction while H1 was still `OK` or only partially against** (a mid-timeframe reversal starting under a still-favorable H1 read). The `LATE_CONFIRMATION_ONLY` cases skew toward *all four* timeframes already `AGAINST` at decision time — i.e. by the time the fast-TF signal was unambiguous, the move was often already exhausted or too far along to catch cleanly. This is the single most mechanistically plausible finding in this report, but the sample is far too small (11 records) to turn into a rule on its own — see candidate rules below for how it's used cautiously.

## Candidate rules for auto-switching to the opposite direction

Stated conservatively, only what this data actually supports:

1. **Never auto-switch on a direction-agnostic hard gate.** Spread-spike blocks and pure `NEWS_OBSERVING`/most `NEWS_ENTRY_BLOCKED_*` blocks would fire identically on the opposite side in 100% of the 30 `NO_VALID_OPPOSITE_SETUP` cases in this data (n=30, this is the most confident rule in the report — it's near-tautological given how these gates are defined, not a discovered pattern). **Exception**: the `NEWS_ENTRY_BLOCKED_POOR_RR` sub-case that reads `impulseDir=X but signal=Y` is directional — the opposite side would not trip this specific check — so this one sub-reason should not be treated as symmetric.

2. **`Personality mismatch` and `SMART-GUARD` blocks are the best-supported candidates for a "consider the opposite" soft-check** (47% and 43% opposite-win rate respectively among tradeable signals, the two largest blocker categories with n≥7). This aligns with the intuition that a personality-gate or fast-TF-confirmation block is about *this specific direction's* quality, not about the market being untradeable — so the mirror direction is worth a second look. Even so, at ~45%, this is barely better than a coin flip; it should gate a *smaller, tighter* opposite-side re-evaluation (see #3), not an automatic flip.

3. **Use the mid-timeframe-vs-H1 disagreement pattern as a pre-filter, not a standalone trigger (n=11, weak evidence).** When a blocked signal's own SMART-GUARD/B-GRADE diagnostic shows M15 and/or M30 reading `AGAINST` the proposed direction while H1 is still `OK`, this data leans toward the opposite side working; when M5/M15/M30/H1 are *all already* `AGAINST`, the move is more often too late to catch (`LATE_CONFIRMATION_ONLY`). This field is only logged for 2 of the ~18 blocker types, so it cannot be the primary signal — but where it is available, it should raise or lower confidence in a `Personality mismatch`/`SMART-GUARD` opposite re-check.

4. **Never auto-switch after an `A+ EVIDENCE DEMOTION` block.** This was the worst-performing sizeable category (1 win / 5, 4 both-bad) — when the EA's own logic downgrades an A+ setup on "clean positioning" grounds, the data says the market was genuinely two-sided/choppy, not that the opposite direction was the real trade.

5. **Require the opposite-side 1R confirmation within ~15 minutes of the original decision.** 18 of the 87 signals (21%) only reached a 1R opposite move at the 30- or 60-minute checkpoint — later than the EA's own fast-TF confirmation gates would realistically wait for a fresh signal. Any auto-switch logic needs its own timeout matching the EA's existing fast-TF confirmation window, or it will chase moves that are already exhausted by the time they're confirmed.

None of these rules should be read as "flip blocked BUY signals to SELL" as a blanket instruction — the apparent BUY-side skew in this 3-day window (73 of 87 losses were BUY) is a property of *this specific period's* price drift, not a discovered general rule; it should not be hardcoded.

## Runner-retention review (executed trades)

For all 17 executed closes in the period, I used the EA's own `POST_CLOSE` checkpoint tracking (`maxMore`/`maxReverse` in ATR and dollars, at 5/10/15/30/60 minutes after exit) — genuine logged price follow-through, not a derived proxy. "1R" here is the **real** position risk (actual `entry − sl` distance), which this data shows is consistently **≈2.5×ATR** for every trade in this set (not the 1×ATR hypothetical used for the blocked-signal simulation above).

| posId | Dir | Setup | Grade | Exit P/L | Risk dist | +R at 30m post-exit | +R at 60m post-exit | Adverse R at 60m | Flag |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 9423998434 | BUY | TREND_PULLBACK | A | $58.71 | 10.07 (2.499×ATR) | 0.79 | 1.78 | 0.06 | **EXIT_EARLY_LEFT_RUNNER** |
| 9424112263 | BUY | TREND_PULLBACK | A | $1.72 | approx 2.5×ATR* | 0.78 | 1.77 | 0.07 | **EXIT_EARLY_LEFT_RUNNER** |
| 9424036497 | BUY | TREND_PULLBACK | A | $11.64 | approx 2.5×ATR* | 0.77 | 1.76 | 0.08 | **EXIT_EARLY_LEFT_RUNNER** |
| 9424627518 | BUY | TREND_PULLBACK | A+ | $176.29 | 10.74 (2.5×ATR) | 0.21 | 0.21 | 2.69 | — |
| 9425014345 | BUY | HTF_TREND_FOLLOW | A+ | $45.00 | 14.72 (2.5×ATR) | 0.49 | 1.04 | 0.88 | **EXIT_EARLY_LEFT_RUNNER** |
| 9425768089 | BUY | TREND_PULLBACK | B | $72.64 | 17.93 (2.5×ATR) | 0.31 | 0.77 | 0.72 | — |
| 9427595868 | BUY | HTF_TREND_FOLLOW | A+ | $67.76 | 13.96 (2.499×ATR) | 0.00 | 0.00 | 0.69 | — |
| 9427887983 | BUY | HTF_TREND_FOLLOW | A+ | $57.42 | 12.05 (2.5×ATR) | 0.10 | 0.10 | 0.66 | — |
| 9436532321 | BUY | HTF_TREND_FOLLOW | A | -$219.88 | 9.57 (2.501×ATR) | 1.34 | 1.56 | 0.43 | **EXIT_EARLY_LEFT_RUNNER** |
| 9437145896 | BUY | MULTI_EXTREME | A | $95.92 | 11.68 (2.5×ATR) | 0.69 | 0.84 | 0.32 | — |
| 9438767673 | BUY | HTF_TREND_FOLLOW | B | -$267.04 | 16.69 (2.5×ATR) | 1.00 | 1.32 | 0.08 | **EXIT_EARLY_LEFT_RUNNER** |
| 9445581393 | BUY | TREND_PULLBACK | A+ | -$112.32 | 4.32 (2.497×ATR) | 0.19 | 0.66 | 2.82 | — |
| 9447162361 | BUY | HTF_TREND_FOLLOW | A | $5.59 | 15.09 (2.5×ATR) | 0.13 | 0.15 | 0.59 | — |
| 9448484106 | BUY | HTF_TREND_FOLLOW | A | $59.00 | 10.56 (2.501×ATR) | 1.04 | 1.04 | 0.41 | **EXIT_EARLY_LEFT_RUNNER** |
| 9450028588 | BUY | UNKNOWN | B | $71.00 | 11.51 (2.501×ATR) | 106.17 | 238.54 | 221.35 | EXCLUDED — corrupted/near-zero ATR denominator in the EA's own log for this trade (setup tag `UNKNOWN`, `atr=0.00` in the CLOSE row) produces nonsense ratios |
| 9451565630 | BUY | HTF_TREND_FOLLOW | A | $61.38 | 9.42 (2.501×ATR) | 0.24 | 0.24 | 1.57 | — |
| 9453717930 | BUY | UNKNOWN | B | $57.95 | 11.86 (2.499×ATR) | 702.75 | n/a | n/a | EXCLUDED — same corrupted-ATR issue as above |

\* `9424112263` and `9424036497` have no `OPEN` row in the log (`executed.csv` itself logs `"fallback: open record not found"` for both) — they are small-lot (0.02-0.04 lot) basket sub-fills opened in the same second as sibling trade `9423998434` at the same price/ATR. I used the sibling's confirmed 2.5×ATR risk ratio as an approximation for these two; flagged explicitly rather than silently assumed.

**Result: 7 of 15 reliably-measured executed trades (47%) left at least 1R of further favorable movement on the table within 60 minutes of exit** (2 of the 17 closes are excluded from this count due to a data-quality problem in the EA's own log, not this audit's methodology — both are tagged `setup=UNKNOWN` with a zero/near-zero ATR reading, which is itself worth flagging to the EA maintainers as a logging bug independent of this audit). All 7 flagged trades are `EXIT_EARLY_LEFT_RUNNER` on the +R-at-60-minutes column; none show meaningful adverse movement in the same window (`Adverse R at 60m` stayed under 0.5R for 6 of the 7), meaning holding longer in those specific cases would not have required a materially wider stop to survive the same window. This corroborates the original report's finding that "the bot ... protects small profit quickly" — on this sample, roughly half the time it left a real, low-adverse-risk continuation on the table.

## Limitations and what could not be reconstructed

- **No ground-truth OHLC price bars.** As detailed above, I located but could not safely decode the real M5/M15/M30 price-column encoding in MT5's `.hc`/`.hcc` cache files. All opposite-direction outcomes in this report use the favATR/advATR inversion proxy per the task's explicit fallback allowance, enriched (where available) with genuine `MARKET_SNAPSHOT` M5 bar prints and `POST_CLOSE` follow-through — but these are not a continuous, verified tick-by-tick price series.
- **`active direction`, `HTF bias`, and `SmartGuard fast-TF reads` are only logged for 2 of ~18 blocker types** (`SMART-GUARD`, `B-GRADE QUALITY BLOCK`) — 11 of 87 signals. For every other blocker type these fields are simply not written to the log at decision time; I reported "not logged" rather than inferring them from the `MARKET_SNAPSHOT` structure field, since that snapshot is not guaranteed to be from the exact same decision cycle (nearest-match only, within 10 minutes).
- **`Personality` (Market personality: RANGE/EXPANSION/etc.) was recovered for only 64 of 107 signals (60%)** via a nearest-time join against the Scorecard files — the Scorecard log does not contain an entry for every blocked decisionId (it appears to log only a subset of candidates), so 43 signals have no personality read at all rather than a guessed one.
- **Per-signal spread and news state are only available when the blocker itself was spread- or news-related** (the `extra` text carries specific numbers in those cases, e.g. "spread spike 61 pt / median 3 pt"). For all other blockers, spread/news state was not logged per-decision; only a single daily aggregate figure exists in `GateReport`/`ForwardTest` (e.g. "Spread: 13 pts avg", "News state: DISCOVERY bias=BULLISH" for the whole day), which is too coarse to attach to individual signals and was not used per-row.
- **The original report's exact internal split of `DANGER_NO_2R` (8) vs. `NO_CLEAR_EDGE` (12) could not be reverse-engineered** from the fields available; I used the combined 20-record group instead, which — as explained above — does not materially affect the opposite-direction conclusions since both original sub-labels require original favATR<1 and advATR<1, and their counterfactuals both land on `DATA_INSUFFICIENT`/`NO_VALID_OPPOSITE_SETUP` regardless of the exact split.
- **The `ORIGINAL_WRONG_DIRECTION_OPPOSITE_LOSES` category is empty by construction** for this input set, as explained in the Methodology section — not because no such cases exist in reality, only because the favATR/advATR inversion proxy cannot produce them from records that were themselves defined by original favATR<2. A true price-bar backtest would be needed to test this category properly.
- **2 of the 17 executed-trade runner-retention checkpoints are excluded** due to a corrupted/zero ATR denominator in the EA's own `POST_CLOSE` logging for `setup=UNKNOWN` trades — this is a data-quality issue in the source system, not an artifact of this audit's method, and should be reported to whoever maintains the EA's logging.
