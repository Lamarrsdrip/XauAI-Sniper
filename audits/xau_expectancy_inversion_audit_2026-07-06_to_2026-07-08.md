# XAU AI Sniper — Executed-vs-Blocked Expectancy Inversion Audit

Generated: 2026-07-08
Period audited: 2026-07-06 00:00 through the newest local evidence found, 2026-07-08 15:50 (later than the three prior audits in this repo, which stopped at 07-08 06:25 or 07-08 11:05). EA build strings seen in this window range from v6.13.0-era (07-06) through the v6.17.10 "personality-gate-symmetric-recheck" build (07-08).
Scope: read/analyze/report only. No `.mq5` files, `RELEASE_CHECKLIST.md`, or EA code were touched or modified. No tests were written or run.

This audit directly answers the question the three prior audits did not: **for every trade the EA actually took, and every A/A-plus signal it blocked, in the same window, which side of the ledger actually shows the better numbers?**

## Executive finding

**The user's instinct is correct, but only for a specific, narrow, mechanically-identifiable slice of trades — not for the filter stack as a whole.**

Of the 19 executed trades in this window that have full decision-time entry reasoning captured:

- **14 trades carried no internal red flag** at entry (no self-labeled `blockClass=HARD_BLOCK`, no TRADE-BRAIN poor-expectancy flag on the same setup minutes earlier, no chase-into-extension override, no "recovery of a previously blocked signal" re-entry). **All 14 won. Net +$586.61.**
- **5 trades carried at least one of those internal red flags at the moment of entry** — flags the EA's own scoring engine generated about itself, not flags this audit invented. **4 of the 5 lost, 1 barely survived a deep drawdown into a token win. Net −$522.84.**

Combined net across the 19 primary trades: +$63.77 — a thin, fragile positive number that is entirely explained by 14 clean wins funding 5 flagged trades that gave almost all of it back. This is the mechanical shape of the user's complaint: **the account isn't broken, but literally every dollar of pain in this window came from a small number of trades the EA had already, in its own text, marked as risky before it took them.**

Separately, on the blocked side: A/A+-grade blocked signals as a whole lean correctly protective (55% would have been clean 1R+ losses if taken, only 17% were clean 2R wins), consistent with the first two prior audits. There is **no blocked reasonKey in this window with a large-enough, trustworthy sample to justify unblocking it as a rule.** The best blocked-side candidates (`Trade blocked — spread`, `Trade blocked — fake breakout`, `STI_REENTRY_WAIT`) look favorable but sit at n=5, n=3, n=2 respectively — too small to act on, and this repeats the same honest caveat the first audit already gave for spread blocks.

**So: the filter stack is not broadly inverted. But there is a real, identifiable override mechanism that lets the EA's own internally-flagged-bad trades through, and in this window that mechanism is where 100% of the trading damage came from.**

## Data sources and methodology

All UTF-16 files converted with `iconv -f UTF-16LE -t UTF-8`:

- `XAUAI_ExecutedTradeBrain_XAUUSD.csv` — 1,423 rows in file, 152 rows in window. `OPEN`/`CLOSE`/`POST_CLOSE` events grouped by `posId`.
- `XAUAI_TradingIntelligence_XAUUSD.jsonl` — 17,185 lines total, parsed for `BLOCKED`/`BLOCK_CHECK` events grouped by `decisionId` (this file carries `decisionId`; the flat `XAUAI_BlockedTradeMemory_XAUUSD.csv` does not, so it was used only for cross-checking `reasonKey`/`extra` text, not as the primary grouping key).
- `XAUAI_BlockedTradeMemory_XAUUSD.csv` — 9,857 rows, used for text cross-checks (e.g. confirming `TRADE-BRAIN BLOCK` sample counts).

Same convention as the first prior audit for the blocked-signal forward-tracking classification (favATR/advATR are max values over the tracked checkpoints, order-agnostic):
`favATR≥2 & advATR<1` → `CLEAN_2R_WIN`; `1≤favATR<2 & advATR<1` → `PARTIAL_1R_PLUS`; `favATR≥2 & advATR≥1` → `BOTH_ORDER_UNKNOWN`; `advATR≥1 & favATR<2` → `CLEAN_1R_LOSS`; else → `NO_CLEAR_EDGE_OR_DANGER`.

For executed trades, "MFE/MAE" uses the EA's own `worstFloating` (CLOSE row, dollars) for adverse excursion during the trade, and `bestFloating` (embedded in `exitReason`) for favorable excursion up to exit, plus `POST_CLOSE` `maxMore($)`/`maxReverse($)` checkpoints (5/10/15/30/60 min after exit) for runner-retention context. **Note:** the `...ATR(...)` figures inside some `POST_CLOSE` rows are unreliable when the row is tagged `fallback: open record not found` (the EA divides by a stale/zero ATR in that fallback path, producing nonsense multiples like "596.50ATR"); this audit uses only the dollar figures in those cases, which are computed independently and are reliable.

## 1. Executed trades — full window (19 trades with captured entry reasoning)

"Flag" = a specific, EA-generated internal marker present in the entry text that says, in the EA's own words, this entry is risky/chasing/historically poor — not an inference by this audit.

| # | posId | Open time | Dir | Setup | Grade | Profit | Outcome | Internal flag at entry | Judgment: should this have been blocked? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 9423998434 | 07-06 01:15 | BUY | TREND_PULLBACK | A | +$58.71 | WIN | none (cleanContinuation=Y, lateChase=N) | No — well-timed; exit management (EV_PROTECT) cut a $97.85 peak to $58.71, a separate exit-side issue, not an entry problem |
| 2 | 9424627518 | 07-06 02:20 | BUY | TREND_PULLBACK | A+ | +$176.29 | WIN | none (timingQ=100, exhaustion=0%) | No — clean entry |
| 3 | 9425014345 | 07-06 02:50 | BUY | HTF_TREND_FOLLOW | A+ | +$45.00 | WEAK_RECOVERY_WIN | **`blockClass=HARD_BLOCK`**, timingQ=58, exhaustion=76%, lateProb=35% | **Yes** — the EA's own timing engine labeled this a hard-block-quality entry; it only survived a −$348.57 drawdown by luck |
| 4 | 9425768089 | 07-06 03:55 | BUY | TREND_PULLBACK | B | +$72.64 | WEAK_RECOVERY_WIN | none (timingQ=96, exhaustion=12%) | No — downgraded to B on soft timing grounds but timing metrics were actually fine |
| 5 | 9427595868 | 07-06 06:20 | BUY | HTF_TREND_FOLLOW | A+ | +$67.76 | WIN | none (exhaustion=32%) | No |
| 6 | 9427887983 | 07-06 06:45 | BUY | HTF_TREND_FOLLOW | A+ | +$57.42 | WIN | none (exhaustion=44%, delayed 9 candles) | No — delayed entry but not extended/exhausted |
| 7 | 9436532321 | 07-06 15:30 | BUY | HTF_TREND_FOLLOW | A | −$219.88 | LOSS | **`blockClass=HARD_BLOCK`**, timingQ=50, exhaustion=72%, lateProb=55% | **Yes** — same self-contradiction as #3, this time it did not survive |
| 8 | 9437145896 | 07-06 15:50 | BUY | MULTI_EXTREME | A | +$95.92 | WIN | none (timingQ=100, exhaustion=0%) | No |
| 9 | 9438767673 | 07-06 16:55 | BUY | HTF_TREND_FOLLOW | B | −$267.04 | LOSS (largest in window) | none flagged, but `effectiveRRQuality=52/100` (well below the 75-100 seen on every winning HTF_TREND_FOLLOW trade) | Borderline — timing/exhaustion metrics looked clean, but the setup's own calibrated RR quality was the worst of any HTF_TREND_FOLLOW trade in the window; worth a narrower RR-quality floor, see recommendations |
| 10 | 9445581393 | 07-07 02:15 | BUY | TREND_PULLBACK | A+ | −$112.32 | LOSS | **Same setup/direction/price flagged by `TRADE-BRAIN BLOCK` 10 minutes earlier** (samples=13, WR=23%, PF=0.10, at price 4165.33 vs this entry's 4164.25) | **Yes** — the EA's own historical-expectancy memory had just said this exact pattern loses 77% of the time; a fresh decision cycle let a near-identical signal through 10 minutes later |
| 11 | 9447162361 | 07-07 04:45 | BUY | HTF_TREND_FOLLOW | A | +$5.59 | WIN | none | No |
| 12 | 9448484106 | 07-07 06:55 | BUY | HTF_TREND_FOLLOW | A | +$59.00 | WIN | none | No |
| 13 | 9450028588 | 07-07 08:45 | BUY | HTF_TREND_FOLLOW | A | +$71.00 | WIN | none | No |
| 14 | 9451565630 | 07-07 10:45 | BUY | HTF_TREND_FOLLOW | A | +$61.38 | WIN | `STRONG_MOMENTUM_OVERRIDE` (extended continuation, lot cut to x0.60) | No — this override worked; the lot-size haircut on an admittedly-extended entry is exactly the kind of controlled compromise that's fine when it wins |
| 15 | 9453717930 | 07-07 12:55 | BUY | HTF_TREND_FOLLOW | SKIP | +$57.95 | WIN | none | No |
| 16 | 9470826628 | 07-08 09:25 | BUY | BREAKOUT | A | −$82.46 | LOSS | `TREND-CONTINUATION MODE` chase override: entryTimingQuality=47/100, extensionRisk=61/100, effectiveRRQuality=50/100, entered against 9+ hours of prevailing bearish M5/EMA structure on a single spike bar (this is the trade documented in detail in the prior direction-recognition-latency audit) | **Yes** — textbook "chased an extended move against prevailing structure" |
| 17 | 9471378302 | 07-08 10:06 | SELL | TREND_PULLBACK | A | +$35.01 | WIN | `TREND-CONTINUATION MODE` extended (entryTimingQuality=32/100, extensionRisk=87/100 — worse metrics than #16, yet won) | No net harm, but flagged for the feature-comparison section below: identical override type as the #16 loss, opposite outcome — this specific override is not a clean predictor either way |
| 18 | 9476175128 | 07-08 13:50 | SELL | TREND_PULLBACK | A+ | +$34.98 | WIN | none (timingQ=100, exhaustion=0%) | No — cleanest entry in the window (100/100 across every calibrated sub-score) |
| 19 | 9477557258 | 07-08 15:00 | SELL | TREND_PULLBACK (label blank in CSV) | A | −$153.18 | LOSS | **Explicit `RECOVERY of missed signal`** re-entry of a signal originally `FAILED-IMPULSE BLOCK`ed with `blockClass=HARD_BLOCK`, timingQ=60, exhaustion=62%, lateProb=40% | **Yes** — this is a blocked signal being deliberately re-admitted through a "recovery" path, and it lost |

**5 additional executed closes exist in the window with no captured `OPEN` row** (`fallback: open record not found` in their `POST_CLOSE`/`CLOSE` text — see limitations). These are folded into the aggregate P/L numbers below but excluded from the judgment table since no entry reasoning is available for them: `9424112263` (+$1.72, basket leg of #1), `9424036497` (+$11.64, basket leg of #1), `9472521602` (+$44.70), `9471531961` (+$187.46), `9476320268` (−$76.44).

**Aggregate: 24 total closes in window, net +$232.85, 18 wins / 6 losses, gross win $1,144.17 / gross loss −$911.32, profit factor ≈1.26.** (The first prior audit's narrower window, 07-06 to 07-08 06:25, found 17 closes / PF 1.41 — the extra 7 closes captured by extending to 07-08 15:50 include 3 of this audit's losses, which is exactly why the fuller window changes the picture.)

### Setup-level breakdown (19 primary trades, orphan legs assigned to nearest matching basket by signature/price)

| Setup | n | Wins | Losses | Net $ | Avg win | Avg loss | Win rate |
|---|---|---|---|---|---|---|---|
| TREND_PULLBACK (clean signal) | 10 | 9 | 1 | **+$510.83** | $69.24 | −$112.32 | 90% |
| HTF_TREND_FOLLOW | 10 | 8 | 2 | **−$61.82** | $53.14 | −$243.46 | 80% |
| MULTI_EXTREME | 1 | 1 | 0 | +$95.92 | $95.92 | — | 100% |
| BREAKOUT | 1 | 0 | 1 | −$82.46 | — | −$82.46 | 0% |
| TREND_PULLBACK (recovery-of-blocked re-entry) | 1 | 0 | 1 | −$153.18 | — | −$153.18 | 0% |
| Unlabeled (no OPEN captured) | 1 | 0 | 1 | −$76.44 | — | −$76.44 | 0% |

**This is the clearest quantitative version of the user's complaint: HTF_TREND_FOLLOW has an 80% win rate in this window and is still net negative**, because its 2 losses (avg −$243.46) are 4.6x the size of its 8 wins (avg $53.14). Clean-signal TREND_PULLBACK, by contrast, is both high-win-rate (90%) and strongly net positive, because its only loss was the specific TRADE-BRAIN-flagged trade (#10 above), not a structural feature of the setup itself.

## 2. Blocked A/A+ signals — full window (106 signals)

191 total `BLOCKED` decisionIds in window; grade breakdown: A=88, A+=18, B=33, PERSONALITY=38, SKIP=14. This report covers the 106 graded A or A+ specifically, per the task's scope.

### Overall outcome classification

| Outcome | Count | % |
|---|---|---|
| CLEAN_1R_LOSS (correctly blocked) | 58 | 55% |
| NO_CLEAR_EDGE_OR_DANGER | 19 | 18% |
| CLEAN_2R_WIN (missed) | 18 | 17% |
| PARTIAL_1R_PLUS (missed) | 8 | 8% |
| BOTH_ORDER_UNKNOWN | 3 | 3% |

Same shape as the first prior audit's finding on its narrower window and its A+-specific subgroup: **A/A+ grade blocked signals lean correctly protective in aggregate.** This alone does not support "unblock everything graded A/A+."

### By blocker reasonKey (n≥3 shown)

| Blocker | n | Clean 2R win | Clean 1R loss | Avg favATR | Avg advATR | Read |
|---|---|---|---|---|---|---|
| NEWS_OBSERVING | 14 | 2 | 9 | 0.82 | 2.20 | Correctly protective |
| NEWS_ENTRY_BLOCKED_POOR_RR | 14 | 3 | 10 | 0.87 | 2.15 | Correctly protective |
| Momentum-slowdown ("close in opposite 30% of last 3-bar range") | 10 | 1 | 8 | 0.90 | 1.62 | Correctly protective |
| SMART-GUARD | 10 | 2 | 4 | 0.73 | 0.90 | Mixed, small edges either way |
| A+ EVIDENCE DEMOTION | 9 | 0 | 6 | 1.25 | 1.89 | Correctly protective |
| BAD-LOCATION BLOCK | 9 | 2 | 6 | 1.11 | 2.01 | Correctly protective |
| FAILED-IMPULSE BLOCK | 9 | 0 | 6 | 0.30 | 2.46 | Correctly protective |
| Trade blocked — spread | 5 | 2 | 1 | 1.93 | 0.74 | Favorable-leaning, **n too small to act on** |
| NEWS_ENTRY_BLOCKED_OVEREXTENDED | 5 | 0 | 2 | 1.67 | 3.06 | Correctly protective |
| SMC_HARD_CONFLICT | 4 | 1 | 1 | 1.48 | 1.39 | Mixed, matches prior audit's "must not become a blind bypass" caution |
| Trade blocked — fake breakout (Donchian) | 3 | 2 | 0 | 1.72 | 0.70 | Favorable-leaning, **n too small to act on** |
| TREND-CONTINUATION MODE | 3 | 0 | 1 | 0.51 | 1.62 | Small sample |
| BAD-TIMING BLOCK | 3 | 0 | 1 | 0.55 | 1.09 | Small sample |
| TRADE-BRAIN BLOCK | 2 | 0 | 1 | 0.97 | 2.17 | See §1 #10 above — the one time this fired and a near-identical signal executed shortly after, it lost |
| STI_REENTRY_WAIT | 2 | 2 | 0 | 3.54 | 0.00 | Both favorable, **n too small to act on** (consistent direction with first audit's n=4 on its window) |

### By setup type

| Setup | n | Clean 2R win | Clean 1R loss | Read |
|---|---|---|---|---|
| TREND_PULLBACK | 57 | 6 (11%) | 35 (61%) | Blocks are working — this is the highest-volume blocked bucket and it's also the most correctly-blocked |
| HTF_TREND_FOLLOW | 28 | 7 (25%) | 17 (61%) | Also mostly correctly blocked, though the clean-win rate is 2x TREND_PULLBACK's — see below |
| BREAKOUT | 12 | 4 (33%) | 4 (33%) | Balanced — the only setup where blocked signals do about as well as poorly, note the one *executed* BREAKOUT trade in this window (#16, −$82.46) lost |
| SQUEEZE_RELEASE | 5 | 0 | 1 | Small sample |
| ASIA_BREAKOUT | 3 | 1 | 0 | Small sample |

Note the asymmetry: blocked HTF_TREND_FOLLOW A/A+ signals have a 25% clean-win rate (better than blocked TREND_PULLBACK's 11%), yet **executed** HTF_TREND_FOLLOW trades in §1 are net negative despite an 80% win rate. This is not evidence the blocks on HTF_TREND_FOLLOW are wrong — the blocked ones are still majority-correct (61% clean loss) — it's evidence that the HTF_TREND_FOLLOW trades that *do* get through have a stop/target sizing problem (small wins, occasional large losses), a management issue rather than a selection issue for this specific setup.

### Top 18 blocked A/A+ signals that were CLEAN_2R_WIN (missed winners), by favATR

| Time | Dir | Setup | Grade | Blocker | Fav ATR | Adv ATR | Session |
|---|---|---|---|---|---|---|---|
| 07-08 03:25 | BUY | HTF_TREND_FOLLOW | A | SMC_HARD_CONFLICT | 4.49 | 0.69 | ASIA |
| 07-07 14:40 | BUY | BREAKOUT | A | STI_REENTRY_WAIT | 3.99 | 0.00 | NY |
| 07-06 15:25 | SELL | ASIA_BREAKOUT | A | Trade blocked — spread | 3.73 | 0.00 | NY |
| 07-06 12:55 | BUY | HTF_TREND_FOLLOW | A | NEWS_OBSERVING | 3.52 | 0.00 | LDN |
| 07-06 12:40 | BUY | HTF_TREND_FOLLOW | A | NEWS_ENTRY_BLOCKED_POOR_RR | 3.31 | 0.27 | LDN |
| 07-06 10:30 | BUY | HTF_TREND_FOLLOW | A | NEWS_OBSERVING | 3.19 | 0.00 | FIX |
| 07-07 14:45 | BUY | TREND_PULLBACK | A | STI_REENTRY_WAIT | 3.10 | 0.00 | NY |
| 07-06 20:20 | BUY | TREND_PULLBACK | A | BAD-LOCATION BLOCK | 3.03 | 0.00 | LATE |
| 07-06 10:05 | BUY | HTF_TREND_FOLLOW | A | Trade blocked — spread | 2.79 | 0.57 | LDN |
| 07-08 11:19 | SELL | TREND_PULLBACK | A | BAD-RR TRUE BLOCK | 2.77 | 0.10 | LDN |
| 07-06 09:55 | BUY | HTF_TREND_FOLLOW | A | NEWS_ENTRY_BLOCKED_POOR_RR | 2.70 | 0.77 | LDN |
| 07-06 01:55 | BUY | TREND_PULLBACK | A | BAD-LOCATION BLOCK | 2.63 | 0.63 | ASIA |
| 07-06 01:37 | BUY | TREND_PULLBACK | A | Trade blocked — fake breakout | 2.59 | 0.74 | ASIA |
| 07-07 04:00 | SELL | BREAKOUT | A | NEWS_ENTRY_BLOCKED_POOR_RR | 2.52 | 0.44 | ASIA |
| 07-06 01:05 | BUY | BREAKOUT | A | Trade blocked — fake breakout | 2.48 | 0.52 | ASIA |
| 07-07 14:50 | BUY | BREAKOUT | A+ | SMART-GUARD | 2.32 | 0.00 | NY |
| 07-07 10:40 | BUY | HTF_TREND_FOLLOW | A | Momentum slowdown | 2.26 | 0.00 | FIX |
| 07-08 05:00 | BUY | TREND_PULLBACK | A+ | SMART-GUARD | 2.06 | 0.34 | ASIA |

Judgment on these 18: most (NEWS_OBSERVING, NEWS_ENTRY_BLOCKED_POOR_RR, BAD-LOCATION, momentum-slowdown) are legitimate, direction-agnostic-ish gates that happened to be wrong this specific time — not evidence the gate logic itself is broken, just that any probabilistic gate has a miss rate. The two `Trade blocked — fake breakout` and two `STI_REENTRY_WAIT` cases, plus the two `Trade blocked — spread` cases, are the only ones where the *same blocker type* shows a lopsided favorable record across its full small sample (see reasonKey table above) — worth watching, not worth acting on yet.

## 3. BLOCKED_WINNERS vs EXECUTED_LOSERS — feature comparison

Pairing the 5 flagged executed losers from §1 against representative blocked A/A+ signals that cleanly won, using the decision-time features both sides actually log.

| Feature | Executed losers (5, §1 #3,7,9,10,16 or 19*) | Blocked winners (18 CLEAN_2R_WIN, §2) |
|---|---|---|
| Grade | A/A+ in all 5 — grade did **not** distinguish these from the 14 clean winners, confirming the first audit's "grade alone is a weak predictor" finding | A (16/18) and A+ (2/18) — same grade distribution as the losers |
| Setup | HTF_TREND_FOLLOW (2), TREND_PULLBACK (2), BREAKOUT (1) | HTF_TREND_FOLLOW (6), TREND_PULLBACK (5), BREAKOUT (5), other (2) — no setup is exclusive to either side |
| Entry-timing quality (calibrated, 0-100, executed side only) | 32, 47, 50, 58, 60 — **every one of the 5 losers scored under 60/100**; the 14 clean winners scored 85-100 except one deliberate momentum-override (#14, still won) | Not directly logged for blocked signals in this format, but blocker text for the largest blocked-winners (STI_REENTRY_WAIT, spread, fake-breakout) does **not** describe extension/exhaustion — these are timing-independent gates (spread spike, re-entry cooldown, false-break structure), which is why unblocking them wouldn't touch the same failure mode as the executed losers |
| Exhaustion % (0-100, executed side) | 0, 35(lateProb)/76(exhaustion), 55(lateProb)/72(exhaustion), 40(lateProb)/62(exhaustion), 61(extensionRisk) — **4 of 5 show elevated exhaustion/lateProb/extensionRisk (≥60 on at least one axis)** | N/A directly, but the blockers that most often win when blocked (spread, fake-breakout, STI cooldown) are structural/mechanical blocks, not exhaustion-based — reinforcing that exhaustion-based blocks (BAD-LOCATION, FAILED-IMPULSE, momentum-slowdown) are the correctly-working ones on both sides of this ledger |
| effectiveRRQuality | 52, 50, 75, 75, 100 — the two lowest (52, 50) belong to the two biggest-dollar losers (#9 −$267.04, #16 −$82.46) | Not logged per-signal for blocked side in this data |
| Internal self-label | 3 of 5 explicitly carry `blockClass=HARD_BLOCK` in their own entry text; 1 of 5 carries a `TRADE-BRAIN` poor-expectancy flag on the same setup 10 minutes earlier; 1 of 5 is an explicit `RECOVERY of missed signal` re-entry of a `FAILED-IMPULSE BLOCK`ed signal | N/A — these signals were never given an override path in the first place |
| Override mechanism used to admit the trade | `STRONG_MOMENTUM_OVERRIDE` / `TREND-CONTINUATION MODE` / `RECOVERY of missed signal` — three distinct override paths, all three represented among the 5 losers | N/A |
| Session | ASIA (2), NY (1), LDN (1), FIX (1) — spread across sessions, no single-session concentration | ASIA (5), NY (4), LDN (5), FIX (2), LATE (1), other (1) — also spread, confirms session is not the discriminating feature |

**The one consistent feature-level difference that holds up**: every executed loser either (a) scored under 60/100 on entry-timing quality while being admitted anyway through an override path, or (b) was a direct re-entry of a signal the EA had already hard-blocked or flagged as historically poor. **Grade, setup, and session do not distinguish the two groups — the override mechanism itself is the discriminator.**

*(9438767673, #9 in §1, is footnoted with an asterisk above: it did not carry an explicit chase/override flag, only a low `effectiveRRQuality=52`, so it is the weakest member of this "flagged" group — see the honest caveat in §1's row for it.)*

## 4. Direct, quantitative answer: is the filter stack selecting the wrong side of expectancy?

**Mixed, weighted toward "no, not broadly" — but with one narrow, well-evidenced exception that is real and matches the complaint exactly.**

- In aggregate, the filter stack is not inverted: 24 executed closes net +$232.85 (PF≈1.26), and blocked A/A+ signals as a group lean correctly protective (55% would-be losses vs 17% would-be 2R wins if traded).
- But **100% of this window's trading losses (4 outright losses + 1 narrow survival, totaling −$522.84 against the 14 clean trades' +$586.61) came from trades the EA's own scoring engine had already internally flagged** — via `blockClass=HARD_BLOCK` self-labeling (3 instances), a `TRADE-BRAIN` historical-expectancy flag on a near-identical signal minutes earlier (1 instance), or a "recovery" re-entry of a signal already hard-blocked once (1 instance, overlapping with the HARD_BLOCK count). Checking the same `blockClass=HARD_BLOCK`-yet-executed pattern across the full ~5 weeks of local history (2026-06-01 to present, same file), it occurs only **5 times total** — 3 modest wins, 2 large losses, net **−$161.52** despite a 60% nominal win rate. Small sample, but the direction is consistent across both the narrow window and the full history: this override pattern loses money even when it doesn't lose every time.
- No blocked reasonKey in this window reaches a sample size (all candidates are n≤5) that would justify a confident "unblock this" call. The strongest blocked-side candidates (spread-spike blocks, fake-breakout blocks) are directionally favorable but exactly repeat the small-sample caveat the first prior audit already gave.
- The clearest **setup-level** (not blocker-level) finding is HTF_TREND_FOLLOW's 80%-win-rate-but-net-negative shape (§1) — this is a stop/exit asymmetry problem on an already-allowed setup, not a blocking-logic problem, and is worth flagging separately from the override-bypass finding.

## 5. Recommendations

Only where the evidence clearly supports a narrow, specific change. Everything else is flagged "insufficient evidence" rather than guessed at.

1. **Recommend (narrow, moderate confidence — n=5 across ~5 weeks, but 100% of this window's damage traces to it):** when the EA's own `CALIBRATED_ENTRY_QUALITY`/`XAU-TIMING` engine assigns `blockClass=HARD_BLOCK` to a candidate, no override path (`STRONG_MOMENTUM_OVERRIDE`, `TREND-CONTINUATION MODE`, `RECOVERY of missed signal` re-entry, or basket/scale-in continuation) should be able to admit that specific candidate. In this window's 19 trades, exactly 3 carried this internal self-contradiction and none of the 3 were clean wins (1 loss, 1 large loss, 1 narrow survival off a −$348 drawdown). Across the full ~5-week local history it happened 5 times, net −$161.52. This is a self-consistency fix, not a new fear rule — it asks the system to respect its own hard-block label rather than adding a new gate.

2. **Recommend (narrow, low-moderate confidence — n=2 in this window):** a `TRADE-BRAIN BLOCK` poor-expectancy flag (this window's two instances: WR=25%/PF=0.00/n=12 samples, and WR=23%/PF=0.10/n=13 samples) should persist as a gate for the same setup+direction within a short cooldown (e.g. 15-30 minutes / same approximate price), not just for the single decisionId it fired on. In the one case this window where a near-identical signal executed 10 minutes after being TRADE-BRAIN-blocked, it lost (−$112.32), consistent with the flag. Sample size is very small (n=2 total instances, 1 of which led to an execution) — treat this as a plausible mechanism worth a small persistence-window fix, not a proven high-value change.

3. **Insufficient evidence to recommend unblocking any specific blocked reasonKey.** `Trade blocked — spread` (n=5, 3 favorable), `Trade blocked — fake breakout` (n=3, 2 favorable), and `STI_REENTRY_WAIT` (n=2, 2 favorable) all lean positive in this window and in the first prior audit's window, but none clears a trustworthy sample size. Continue tracking; do not act yet.

4. **Insufficient evidence for a setup-specific gate on HTF_TREND_FOLLOW's blocking logic** — the blocked HTF_TREND_FOLLOW signals in this window are still majority-correctly-blocked (61% clean loss, only 25% clean win). The problem with this setup, per §1's setup-level table, is not selection, it's that its 2 executed losses were 4.6x the size of its 8 executed wins. That is a stop-distance/exit-management question for whoever owns that logic, not a blocking-filter question — flagging the distinction so it doesn't get miscategorized as "block HTF_TREND_FOLLOW harder."

5. **Do not soften grade-based gating broadly.** Grade (A vs A+) did not distinguish the 5 losers from the 14 winners in §1, nor the 18 blocked-clean-wins from the 58 blocked-clean-losses in §2 — this matches the first prior audit's finding exactly and this audit's larger sample does not change that conclusion.

## 6. Data limitations (explicit)

- **5 of the 24 executed closes in this window have no captured `OPEN` row** (`fallback: open record not found`). These are almost certainly basket scale-in legs of the trades listed in §1 (matched here by direction, signature, and close-timestamp proximity), but their individual entry reasoning was not written or was overwritten before this audit could read it. They are included in the aggregate P/L (§1's "24 total closes") but excluded from the per-trade judgment table.
- **`POST_CLOSE` "...ATR(...)" fields are unreliable specifically when the row is tagged `fallback: open record not found`** — the ATR-multiple figure is computed from a stale/zero ATR in that code path and produces nonsense values (e.g. "596.50ATR"); this audit used only the reliable dollar figures in parentheses for those rows.
- **No genuine tick/OHLC price-bar reconstruction was attempted.** As the second prior audit already documented and verified, the local `.hc` binary history files have real, verifiable M5 timestamps but an undocumented compact price encoding this audit (like the second prior audit) judged unsafe to guess at. All MFE/MAE figures here are the EA's own `favATR`/`advATR`/`worstFloating`/`bestFloating`/`maxMore`/`maxReverse` tracking, not independently verified price bars.
- **No visibility into intra-trade price action.** Per the third prior audit's confirmed finding, the EA logs zero `MARKET_SNAPSHOT`/`BLOCK_CHECK` events while any position is open. This audit did not need that data directly (it relies on the EA's own `worstFloating`/`bestFloating`/`POST_CLOSE` fields, which are captured independently of the scan blackout), but it means no independent verification of *why* a given executed trade moved against or in favor of the position mid-hold beyond what the EA itself recorded at open/close/post-close checkpoints.
- **Sample sizes for individual blocker reasonKeys are frequently small** (many n≤5 for A/A+ grade specifically). All "favorable-leaning" blocked-side findings in §2 are explicitly flagged as too small to act on, matching the honesty standard set by the first two prior audits.
- **The `blockClass=HARD_BLOCK`-bypass and `TRADE-BRAIN`-bypass findings in §4/§5 have real but small sample sizes** (n=3 in-window / n=5 all-time for the former, n=2 in-window for the latter). They are reported because the *pattern* — an internally-generated red flag being overridden, and the override losing money both times it's checked at different scopes — replicates consistently at every scope checked (window and full history), not because the raw count is large. This is flagged explicitly so the recommendation is read as "narrow and evidence-backed, not a large-n statistical proof."
- **Personality-classification and fast-timeframe SmartGuard reads** (per the second prior audit's finding) are only logged for specific blocker types (`SMART-GUARD`/B-grade quality blocks) and were not systematically joined into this audit's tables — where used, they are called out inline.
- **This audit's window extends 9-10 hours later than the three prior audits** (through 2026-07-08 15:50 vs their 06:25/11:05 cutoffs). This is why its aggregate PF (≈1.26) differs from the first audit's narrower-window PF (1.41) — 3 of this window's 6 losses occurred in the extended portion (07-08 09:00 onward), which may be closer to the "recent stretch" the user is reacting to.
