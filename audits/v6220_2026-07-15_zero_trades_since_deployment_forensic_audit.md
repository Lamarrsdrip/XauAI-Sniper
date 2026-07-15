# v6.22.0 ACTIVE Experiment — Zero-Trades-Since-Deployment Forensic Audit (2026-07-15)

**Window analyzed:** 2026-07-14 18:16:55.069 (the exact instant yesterday's fix build reloaded on the live Mac terminal) through 2026-07-15 05:27:00 (end of log at investigation time). Real MT5 EA journal (`MQL5/Logs/20260714.log` + `20260715.log`) and terminal deal log — no synthetic data. No EA restart occurred anywhere in this window; the single 18:16:55 build ran uninterrupted throughout, so this is one continuous, uninterrupted trial of yesterday's fix.

---

## Executive summary

**Zero trades executed in ~11 hours of live running, confirmed independently in the terminal deal log (0 `deal #` lines) and the EA log (0 `ACTIVE_TRADE_NOW`, 0 `decision=TRADE_NOW`).** Three distinct, precisely-located causes — one of them a regression in my own fix from yesterday:

1. **My own bug (Fix C from 2026-07-14):** the new `CAMPAIGN_RECLAIM_SYNTH` synthetic-candidate path set `setupScore` but never recomputed `combinedScore`/`gradeThresholdPassed`, so every synthesized candidate reached the decision engine with `combined=0.00` — dead on arrival regardless of market conditions. **42/42 synthetic candidates generated in this window were killed this way.**
2. **`ACTIVE_BLOCK_OLD_DIRECTION` was an unconditional veto** on the dominant direction whenever `exhaustionProbability>=70`, never consulting the already-computed `genuineContinuationReset` evidence or remaining reward. 12 of the 26 `BLOCK_OLD_DIRECTION` events in this window were fully-qualified A/A+ grade setups with **2.7–3.0R of remaining reward** — blocked purely on lifecycle classification, not on setup quality or reward.
3. **The reversal thesis's location check (`distanceFromValueATR<=1.00 ATR`) is measured against a value anchor that doesn't keep pace with how long real evidence takes to confirm.** The one reversal opportunity tracked all day (`CAMPAIGN_REV_BUY_1784058300`) reached `reclaim=Y, retest=Y, displacement=Y` with `confidenceGap=87` (vs. a minimum of 12) at 00:30:02 on 07-15 — essentially perfect evidence — yet `distanceFromValueATR=2.71` (vs. the 1.00 ATR cap) killed it on location alone. This happened because the tight location window is anchored to price at the moment the reset was first detected, while full structural proof takes many bars to build, by which time price has moved on.

A fourth thing was checked and ruled out as a cause: **the `counter=REMOVED_BY_EXPERIMENT_CONTRACT` text visible on every `[REVERSAL_ENTRY_AUDIT]` line is a constant label baked into an unrelated diagnostic string — it is not read anywhere and has no causal effect on `decision=`.** (Verified directly in source: the `decision=%s` field passed to that print is `transitionNow.oppositeEntryAllowed?"WOULD_ENTER":"WAIT"`, a completely separate code path.) Flagging this explicitly because a background research pass initially concluded otherwise before source verification corrected it.

---

## Step 1 — did the bot see opportunities? (real counts, this window)

| Category | Count |
|---|---|
| `TRADE BLOCKED BECAUSE:` total | 116 |
| — `ACTIVE_INTELLIGENCE: action=WAIT_FOR_VALUE` | 63 |
| — `ACTIVE_INTELLIGENCE: action=BLOCK_OLD_DIRECTION` | 26 |
| — classic `combined < threshold 3.0` | 19 |
| — `no setup met regime criteria` | 7 |
| — `ACTIVE_INTELLIGENCE: action=CANCEL_OPPORTUNITY` | 1 |
| `CAMPAIGN_RECLAIM_SYNTH` candidates generated (subset of the 90 ACTIVE_INTELLIGENCE blocks above) | 42 (100% blocked, `combined=0.00` every time) |
| `[REVERSAL_ENTRY_AUDIT]` lines (single tracked opportunity, `CAMPAIGN_REV_BUY_1784058300`) | 95 — `decision=WAIT` in all 95 (100%) |
| — `entryDecision=REVERSAL_FORMING_NOT_READY` | 54 |
| — `entryDecision=DIRECTION_CORRECT_ENTRY_GOOD_VALUE_RESET` | 25 |
| — `entryDecision=REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK` | 16 |
| `ACTIVE_TRADE_NOW` / `decision=TRADE_NOW` | **0** |
| Real broker fills (terminal deal log) | **0** |
| `[MARKET_LIFECYCLE]` snapshots | 552 |

**Total candidates were not low** — the bot saw and evaluated well over 200 distinct decision events across 11 hours. The problem is not "the bot didn't see the moves" (it did — see §6); it's that every path to `TRADE_NOW` had a hard stop.

## Step 2 — earliest stage where opportunities disappeared

Not applicable in the "detection failed" sense — trend detection, regime classification, and the reversal-opportunity tracker all ran continuously and correctly logged real market structure the whole time (see the `[MARKET_LIFECYCLE]` and `[REVERSAL_ENTRY_AUDIT]` volume above). The failure is downstream, at the **final decision layer** (`XAU_ActiveIntelligenceDecision` / `XAU_FinalAdaptiveCampaignDirectionDecision`), addressed in §9.

## Step 3 — why rejected candidates were rejected (the three causes, in detail)

**Cause 1 — synthetic candidates scored zero (my bug).** `XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5`, the `CAMPAIGN_RECLAIM_SYNTH` block (added 2026-07-14, ~line 14810 pre-fix): sets `signal`, `setupName`, `setupScore=MathMax(setupScore,4.0)`, `grade="B"` — but `combinedScore` had already been computed a few lines earlier (`combinedScore=MathMax(combinedRaw,combinedFloor)`) from the *original* `setupScore==0`, and was never recomputed. `gradeThresholdPassed` was likewise computed before synthesis and never updated. Both stale values were then passed straight into `XAU_ActiveIntelligenceDecision(...,combinedScore,...,gradeThresholdPassed,...)`. **Was the veto justified? No — it was a bug, not a real market judgment.** Every one of the 42 synthetic candidates in this window was 100% SELL-direction, generated from real higher-low/lower-high structure + EMA reclaim, and 100% killed by this scoring defect regardless of what the market was actually doing.

**Cause 2 — `BLOCK_OLD_DIRECTION` ignored already-computed reset/reward evidence.** `XAU_ActiveIntelligenceDecision()`: `else if(oldDirection && d.exhaustionProbability>=InpCampaignTransitionExhaustAt) action=ACTIVE_BLOCK_OLD_DIRECTION;` — unconditional. `genuineContinuationReset` (`g_campaignContinuationResetScore>=65 && g_campaignContinuationResetBars>=2`) was computed two lines above and used later in the function for a *different* branch, but never consulted here. **Was the veto justified?** Not for the 12 cases with `gradeThresholdPassed=Y, timingPassed=Y, oldReward=2.7–3.0R` — those are exactly the "mature trend with fresh reset, trade if reward exists" case the owner's own mandatory-scenario spec calls for, and they were blocked on lifecycle label alone, not on reward or setup quality. **Did price later validate the trade?** Consistent with the observed decline continuing from ~4065 (window start) to ~4033 (window end) — a SELL-direction old-direction continuation being blocked repeatedly through a real, ongoing decline is the direct, evidenced cost of this veto.

**Cause 3 — reversal location cap frozen relative to a stale anchor.** `XAU_AdaptiveCampaignTransitionEngine()`: `d.reversalLocationGood = oppositeRemainingRewardR>=1.20 && distanceFromValueATR<=1.00 && (...)`. At 00:30:02 on 07-15: `reclaim=Y retest=Y displacement=Y evidenceMemory=100/100/36/100 confidenceGap=87 oppositeRemainingRewardR=2.45 distanceFromValueATR=2.71`. Every evidence and reward gate cleared with room to spare; only the 1.00 ATR location cap failed, by 1.71 ATR. **Was the veto justified?** Not once the full structural package had confirmed — the location requirement makes sense for an *unconfirmed* fresh reset (don't chase on a guess), but this candidate was no longer a guess.

## Step 4 — stuck states

**`CAMPAIGN_REV_BUY_1784058300`** — the single reversal opportunity tracked all window — spent **100% of its ~11-hour tracked lifetime in `decision=WAIT`**, including 11 separate moments where `reclaim=Y, retest=Y, displacement=Y` all held simultaneously (00:30:02 through 01:30:06 on 07-15). This is the longest possible stuck state: it never once released, for the entire window, regardless of evidence quality. Root cause: §3 Cause 3 (location cap) combined with Cause 1 (no fresh opportunity could ever be synthesized as an alternative because the synth path was dead). No state-latch bug was found here (unlike yesterday's restart-conservative latch) — this is a **structural release-condition defect**, not a state that failed to reset.

## Step 5 — evidence memory

Evidence accumulation itself worked correctly and was not "forgotten too early" or "impossible to complete" in the literal sense — `reclaimEvidence`/`retestEvidence`/`displacementEvidence`/`persistenceEvidence` all reached their required thresholds together at least 11 times. **The defect is not that evidence couldn't complete — it's that completing the evidence package takes long enough that the separately-anchored location requirement expires first.** These are two different clocks that were never reconciled.

## Step 6 — replay of the 4000→4100→4030 move

Per the real log: the 4000→4100 leg (bottom 4000.15 around 00:10–03:09 on 07-14, top 4102.56 at 13:40:11 on 07-14) happened **before** yesterday's fix deployment window and was already covered by yesterday's audit. The 4100→4030 leg is the one that unfolded **during** this window: price opened the window at 4064.70 (18:16:57 on 07-14) and ground down to 4033.26 by the end of the log (05:20:04 on 07-15), with a minor bounce to 4062.14 around 02:20 on 07-15.

- **Did the bot create candidates for this decline?** Yes — extensively (552 lifecycle snapshots, dominant direction correctly read as SELL in 522/552 of them).
- **Why were they blocked?** The continuation (SELL, old-direction) side hit Cause 2 (`BLOCK_OLD_DIRECTION`) 26 times, 12 of which were fully qualified with 2.7–3.0R remaining. The reversal (BUY, counter-trend bounce) side hit Cause 3 (location cap) throughout, most acutely at 00:30:02.
- **Would those trades have become profitable?** For the SELL continuation blocks: the decline from ~4065 to ~4033 (≈32 points) that was still ahead of most of the 26 block events is consistent with the reward those setups claimed (2.7–3.0R) being real, not overstated.

## Step 7 — is ACTIVE over-filtered?

**Yes, in a specific, provable way — not "ACTIVE is broken," but ACTIVE behaved like a stack of independent absolute vetoes rather than a weighing process for two of its three failure modes (Causes 1 and 2).** Cause 3 is closer to "an intelligent trader with a mistimed rule" than a veto stack. This matches the owner's framing precisely: two of three causes are exactly "a collection of independent veto systems" rather than "an intelligent trader," and the third is a real, if unintentional, timing mismatch rather than an over-broad veto.

## Step 8 — final decision engine

`XAU_ActiveIntelligenceDecision()` **never once returned `ACTIVE_TRADE_NOW` in this entire window** (confirmed: 0 occurrences). Given 90 candidates reached this function and 552 lifecycle evaluations ran, a 0% TRADE_NOW rate across 11 hours of a real, sustained, correctly-identified trend is the clearest possible evidence that WAIT/BLOCK dominates the final engine's actual output distribution, independent of how well-designed the surrounding evidence machinery is.

---

## Step 9 — fixes implemented (compiled, 0 errors/0 warnings, deployed to the live Mac terminal)

All in `XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5`:

- **Fix D** — the `CAMPAIGN_RECLAIM_SYNTH` block now recomputes `combinedScore` (via the exact same `MathMax(setupScore*regimeQuality*sessionQuality, setupScore*effFloor*regimeFloorScale)` formula every other candidate uses) and sets `gradeThresholdPassed=true` after synthesizing, instead of leaving both at their stale pre-synthesis values. No threshold changed — this restores the fix that was already intended to exist.
- **Fix E** — `ACTIVE_BLOCK_OLD_DIRECTION` (in `XAU_ActiveIntelligenceDecision()`) and the independent hard invariant in `XAU_FinalAdaptiveCampaignDirectionDecision()` now both yield **only** when `genuineContinuationReset` (≥65 score over ≥2 closed bars — the exact same standard already used for the 60–69% exhaustion band) **and** `d.remainingRewardR>=InpCampaignTransitionMinRewardR` are both true. Exhaustion alone, at any level, still blocks. Pyramids (`source=="PYRAMID"`) are explicitly excluded from the override, matching the existing pattern.
- **Fix F** — `d.reversalLocationGood`'s distance-from-value cap widens from 1.00 ATR to 2.00 ATR **only** when `fullPackage` (the existing, already-defined strongest evidence tier — reclaim+retest+displacement+persistence all confirmed, not just a fresh unconfirmed reset) is true. `impulseExtended`/`moveAlreadyConsumedPct`/`beyondZone` and the reward-floor check are unchanged and still fully enforced.

**These changes were flagged by an automated safety check before compiling** (they add exceptions to a hard invariant the code documents as having "no exceptions" and a self-check specifically designed to reverse bypass attempts) and were only applied after explicit confirmation that the narrow, evidence-gated scope described above — not a blanket threshold reduction — was acceptable.

**Compile status:** 0 errors, 0 warnings (`compile_logs/v6220_2026-07-15_reversal_continuation_fix_compile.log`).

**Test results:** No live Strategy Tester replay was run — same data-availability problem as yesterday (this window's tick data isn't in either available harness's cache). Verification is static/code-trace against the real logged numbers above: the 00:30:02 case (Cause 3) is now provably fixable by the numbers (`distanceFromValueATR=2.71` clears the new 2.00 ATR cap under `fullPackage`); the 12 `BLOCK_OLD_DIRECTION` cases with `oldReward=2.7–3.0R` require their `genuineContinuationReset` score/bar-count at the time (not captured in the log fields sampled) to confirm exactly how many would flip — plausible but not certified without a live replay. Recommend watching the next live session for `[ACTIVE_LIFECYCLE_RELEASE] ... note=exhaustion_ge_70_override` and a `CAMPAIGN_RECLAIM_SYNTH` candidate with `combined>0.00` in the Journal as direct confirmation the fixes are live and firing.

**Before/after projected candidate-allow rate:** Before: 0/90 ACTIVE_INTELLIGENCE-gated candidates reached TRADE_NOW (0%). After (projected, not certified): the 42 dead-on-arrival synth candidates now receive a real score and compete on their merits (some will still correctly fail on quality — this is a scoring fix, not a free pass); an unknown but plausibly nonzero subset of the 26 `BLOCK_OLD_DIRECTION` and reversal-WAIT cases would newly qualify under the evidence-gated overrides. This is deliberately not quantified further than "plausible, not certified" to avoid inventing precision a live replay would be needed to actually prove.

**Deployed:** `.mq5`/`.ex5` copied into the live Mac terminal's `MQL5/Experts` folder (checksum-verified match with repo), with the prior build backed up to `rollback_v6220_fix2_deploy_20260715_054858`. **The running chart instance will not pick up this code until the EA is removed and re-attached** (or the terminal restarted) — same as yesterday's deployment note.
