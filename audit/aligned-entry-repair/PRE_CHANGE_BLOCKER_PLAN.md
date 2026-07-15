# v6.24.0 Aligned Entry Engine — Pre-change blocker plan

## Frozen baseline

- Starting commit: `e13d669857c7589e06af17460d7004794d11279e`
- Production version: `v6.23.3`
- Canonical normal EA: `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- Canonical source SHA-256: `a351a2f361c1ac2a3f977fbb7577ddc5f9e1c066ae83d28e114bcf853fcf150d`
- Frozen EX5 SHA-256: `5cdfdb18abaa7995a0bb914e40829c855cbd2b3283e5f75355364089c0e45188`
- ACTIVE preset SHA-256: `2d7fe9d95d04b6d3635365db89747b4ad4ca9863503f9143d7608bdea3405c47`
- Original checkout was the dirty `experiment/v6.22.0` worktree. Repair work is isolated in `repair/remove-blocker-stack-v6.24.0`; inverse/counter-excursion experiment files are out of scope.

## Decision rule used for this plan

The normal bot will have one owner for direction, structure, timing, freshness, news, re-entry/pyramid state, risk/execution, and the final entry decision. A module below is removed when it duplicates another owner, delays an already-valid fresh setup, makes missing/advisory evidence negative, converts warnings into vetoes, applies loss fear in No-Limit, or re-evaluates strategy after the final arbiter. Operational safety and confirmed opposite structure remain hard.

## Exact removal/merge targets

All line numbers are from the frozen v6.23.3 canonical source. `Deleted` means the executable path and its reason string leave normal production. `Merged` means the independent veto is deleted and its genuinely useful evidence is consumed by the named surviving authority. `Telemetry` means the signal can be logged but cannot alter entry or size.

| ID | Function/module/tag and call site | Category; introduced | Exact old blocking/delay behavior | Why unnecessary / surviving owner | Disposition and post-repair behavior | Regression risk / required test |
|---|---|---|---|---|---|---|
| R01 | `XAU_TimingEngineConfirmsEntry`, adaptive reversal call ~14821 | Duplicate timing; v6.17.22 | Arms a 120–180s reconfirmation window after reversal direction/location already passed | Duplicates freshness/location and creates late confirmation | Deleted; fresh reversal proceeds immediately through one Freshness Authority | Chasing; fresh reversal and late-reversal tests |
| R02 | `XAU_TimingEngineConfirmsEntry`, primary call ~16826 | Duplicate timing; v6.17.22 | Delays every approved primary setup for a second pass | Same evidence is already evaluated by timing/freshness | Deleted; no mandatory second-pass delay | False early entry; fresh continuation and stale-candidate tests |
| R03 | `XAU_TimingEngineConfirmsEntry`, re-entry call ~9046 | Duplicate timing; v6.17.22 | Delays a legitimate reset re-entry | Re-entry Authority plus Freshness Authority own this | Deleted; reset re-entry is assessed once | Duplicate/re-entry collision test |
| R04 | Recovery-awaiting-timing state/call ~28646–28720 | Duplicate timing/recovery; v6.20.5 | Adds a second recovery wait after the first blocker clears | Reuses stale confidence and can approve after extension | Deleted; blocked candidates never mature into late entries | Stale recovery cannot approve test |
| R05 | `XAU_ClassifySetup` call inside `ContextGateAllows` ~7451 | Duplicate timing/structure; v6.17.23 | Countertrend classifier can hard-fail inside an older HTF gate | Unified Structure Authority owns confirmed invalidation; Freshness owns age | Merged; classification becomes context only | Confirmed opposite break still blocks |
| R06 | `XAUEntryTimingGuard` as an independent legacy veto ~15713 | Duplicate timing; v5.8.18, hardened v6.17.16 | Five OR-ed conditions hard-block regardless of combined evidence | Replaced by one Freshness/Extension Authority requiring exhaustion + poor remaining reward | Merged/renamed; only true late exhaustion is hard | July 15 reconstruction; moderate-warning pass |
| R07 | Adaptive reversal’s separate `XAUEntryTimingGuard` call ~14798 | Duplicate timing lane; v6.23.1 lane | Re-evaluates the same reversal outside the normal arbiter | One normal pipeline must own all entries | Deleted with separate lane; reversal uses shared freshness once | Reversal parity test |
| R08 | `REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK` ~11056/11188 | Pullback wait; v6.23.1-repair | Correct fresh reversal is delayed until ideal pullback | Freshness distinguishes good fresh location from consumed extension | Deleted as a blanket wait; only true extension waits for a new identity | Fresh good reversal passes; extended reversal blocks |
| R09 | `TRANSITION_WAIT` same-direction veto ~14900 | Direction delay; v6.15.0 | Weakening old side is paused while evidence accumulates | Confirmed opposite structural invalidation is sufficient; ambiguity is context | Deleted hard authority; telemetry only | Ambiguous transition does not veto strong structure |
| R10 | Active Direction `NO_TRADE` global veto ~14900 | Duplicate direction; v6.15.0 | Global state can zero a valid scored signal | Signal/Direction Authority owns candidate direction | Deleted as independent veto; logs context | Direction-authority unit test |
| R11 | Active Direction `BUY_ONLY/SELL_ONLY` legacy veto ~14900 | Duplicate direction; v6.15.0 | Slow state can reject a fresh opposite structural candidate | Structure Authority blocks only confirmed opposite invalidation | Merged to context; no global side lock | Fresh reversal before HTF flip test |
| R12 | Personality pre-grade score penalty ~14987 | Personality; v6.4.0 | Wrong personality subtracts score and can push setup below execution | Personality chooses preference, not safety | Telemetry only; score unchanged | Personality mismatch cannot block/demote |
| R13 | Personality symmetric recheck and `PERSONALITY GATE BLOCK` ~15020–15101 | Personality; v6.17.10 | Second call can return after the first assessment | Duplicate probabilistic regime read | Deleted call and reason string | Removed-string and strong-local-setup test |
| R14 | `SMC_GetConflictPenalty` score subtraction ~15130 | Duplicate structure; v6.7.0 | Mild SMC disagreement lowers grade/score | Structure Authority consumes BOS/CHoCH once | Telemetry/context; no independent penalty | Mild SMC conflict preserves grade |
| R15 | `SMC HARD CONFLICT BLOCK` grade-to-SKIP ~15222 | Duplicate structure; v6.7.0 | SMC flag forces `SKIP` without verified opposite break | Confirmed opposite break remains in Structure Authority | Deleted; SMC cannot independently veto | Mild conflict passes; opposite break blocks |
| R16 | `TRI RE-ENTRY BLOCK` ~15252 | Re-entry; v6.8.0 | Trade Recovery Intelligence returns before normal re-entry rules | One Re-entry/Pyramid Authority owns reset, separation and basket risk | Deleted | Legitimate reset re-entry test |
| R17 | FIX-C B-grade regime/LOW_VOL demotion-to-SKIP ~15347 | Hidden grade veto; post-v5.8.50 | Converts descriptive grade to hard `SKIP` | Signal grade already measures quality | Deleted; weak setups fail the single score threshold only | Grade is descriptive test |
| R18 | Adaptive news-momentum hard return ~15808 | Duplicate news; v6.10 | Post-news candidate passes a second independent news gate | One News State Machine owns protected window and post-release freshness | Merged; post-release evidence is context/freshness | Fresh post-news continuation passes |
| R19 | Post-news observation/continuation approval duplicate path ~15800 | Duplicate news; v6.10 | Requires extra continuation approval after release | News Authority checks state once | Deleted independent approval | Protected window remains hard |
| R20 | `STI_LATE_BLOCK` ~15906 | Duplicate freshness; post-v5.8.50 | One late-risk threshold returns even with remaining reward | One Freshness Authority combines age, extension, reset, reward | Deleted reason/call; evidence merged | Moderate lateness passes, genuine extension blocks |
| R21 | `STI_EXHAUST_BLOCK` ~15922 | Duplicate freshness; post-v5.8.50 | RSI divergence + ATR contraction can independently return | One signal is insufficient for true exhaustion | Deleted reason/call; telemetry only | Moderate exhaustion cannot veto |
| R22 | STI third structural-bypass exhaustion branch ~15945 | Duplicate freshness/structure; post-v5.8.50 | A second exhaustion return depends on bypass mode | Structure and freshness are mode-independent authorities | Deleted | No mode-dependent soft-to-hard conversion |
| R23 | `BasketDirectionLossBlock` fresh-entry veto ~16007 | Loss/fear vs basket risk; v6.3.6 | Floating directional loss independently blocks regardless of projected risk | Risk Authority uses total projected basket risk once | Merged; percent-loss fear removed, risk breach retained | Basket-risk breach test |
| R24 | Direction loss lock `IsDirectionLocked` in normal No-Limit path ~16032 | Loss fear; pre-v5.8, duplicated later | Past losses suppress the side after state is no longer relevant | No-Limit forbids loss-based side fear; current structure decides | Deleted from No-Limit normal path; opt-in constrained modes may retain | No-Limit loss side remains eligible |
| R25 | `RECOVERY-GATE` ~16051 | Recovery; post-v5.8.50 | Separate recovery state returns after other re-entry checks | Re-entry Authority owns reset/separation/freshness | Deleted reason/call | Recovery reset test |
| R26 | Legacy `HIVE VETO` ~16184 | Duplicate cross-instance; pre-v5.8, duplicated v6.20.3 | Signature system independently suppresses an entry | Keep one collision lock with stale/re-entry/pyramid identity awareness | Deleted; surviving CrossInstance lock owns real collisions | Duplicate collision and legitimate re-entry tests |
| R27 | AI low-confidence `SKIP` hard block / `AI DIRECTOR BLOCK` ~16360 | AI; v6.3.6 | AI `SKIP` at low confidence sets block and stops trade | AI is advisory; local authorities own validity | Deleted reason and hard path | AI SKIP cannot veto |
| R28 | Missing/timeout/budget/no-consensus AI negative treatment ~16197–16413 | AI; v6.3.6+ | No call or zero confidence can reduce/deny eligibility | Missing evidence is neutral | Deleted effects; telemetry status only | Missing AI neutral test |
| R29 | AI weak-agree/weak-disagree lot multipliers ~16197–16413 | AI sizing; v6.3.6+ | Advisory confidence can shrink valid risk and trigger size guard | Valid setup uses configured account-mode risk | Deleted sizing authority | Full configured-risk test |
| R30 | AI/committee lot multiplier in `finalSzMult` ~16670 | AI sizing; v6.0.2+ | Committee output multiplies risk after local approval | Risk Authority alone sizes valid setups | Deleted multiplier; committee logs only | No hidden lot reduction test |
| R31 | `ADAPTIVE_DRAWDOWN` grade block ~16547 | Drawdown fear; post-v5.8.50 | Equity watermark blocks non-A grades | No-Limit drawdown is telemetry only | Deleted in No-Limit normal path | No-Limit drawdown test |
| R32 | `ADAPTIVE_DRAWDOWN` 50% lot mode ~16554 | Drawdown sizing; post-v5.8.50 | Watermark halves risk for otherwise valid setup | Configured account risk is authoritative | Deleted in No-Limit | Configured risk unchanged after drawdown |
| R33 | TradeBrain `BRAIN-BLOCK` hard return ~16645 | Memory; v5.8.39, hardened v6.3.8 | Small/biased memory sample independently vetoes | Memory is context/telemetry; score threshold owns quality | Hard veto removed; telemetry only | Memory caution cannot veto |
| R34 | Memory/conscious-quality lot multiplier ~16650 | Memory sizing; post-v5.8.50 stack | Past outcomes shrink a valid setup | Valid means configured risk; weak means skip | Deleted multiplier | No memory-based micro-lot test |
| R35 | `FULL_RISK_BINARY_BLOCK` driven by stacked quality multipliers ~16695 | Size guard; v6.21.2 | Hidden soft reductions drive `finalSzMult<0.04`, then hard-block | Final sanity may block only actual broker/math minimum | Deleted upstream-quality trigger; broker minimum remains transparent | Valid setup never becomes 0.01/quality-blocked |
| R36 | `OLD_DIRECTION_EXHAUSTION_HARD_BLOCK` broad five-source invariant | Duplicate exhaustion; v6.23.1 | One possibly stale score blocks PRIMARY/RE_ENTRY/RECOVERY/RETRY/PYRAMID | Freshness Authority uses current candidate identity, origin, age, travel, reset and reward | Deleted broad identity; one per-candidate freshness decision | July 15 and stale-identity tests |
| R37 | `SOFT_BLOCK_CONVERTED` ~31312 | Soft-to-hard conversion; v6.11 | Momentum/warning state is relabeled into blocking class | Warnings cannot become hard except documented safety | Deleted tag and conversion | Removed-string test |
| R38 | `failedImpulseBlock`/missing-wick hard classification ~30938–31320 | Candle-shape veto; hardened v6.17.16 | Missing rejection wick contributes to `HARD_BLOCK` | Candle geometry is evidence only | Hard authority deleted; freshness requires combined exhaustion | Missing-wick strong continuation passes |
| R39 | Post-sweep A+ standalone return inside timing guard | Candle/liquidity veto; post-v5.8.50 hardening | One sweep pattern returns before full freshness assessment | Unified freshness uses remaining reward and reset | Deleted standalone return | Single sweep cannot veto strong fresh structure |
| R40 | Bad-RR standalone return inside timing guard | Duplicate freshness; post-v5.8.50 | Separate RR return precedes final combined decision | Freshness Authority owns one combined late/poor-reward rule | Merged; one reason/owner | True poor remaining reward blocks once |
| R41 | `XAU_GrowthGuardEntryBlockReason` inside `OpenTrade` ~18025 | Hidden strategic choke; v6.4.12 | Rechecks daily/account strategy after final approval | `OpenTrade` must contain operational safety only | Deleted from `OpenTrade`; configured basket risk stays in Risk Authority | Source audit of OpenTrade |
| R42 | `XAU_FinalAdaptiveDirectionDecision` / production final assertion inside `OpenTrade` ~17703 | Hidden strategic re-evaluation; v6.23.1 | Direction/location can reverse the arbiter at send time | Final Entry Arbiter resolves this before execution | Moved out/merged, no strategic veto in `OpenTrade` | OpenTrade operational-only test |
| R43 | `XAU_GrowthDailyLockTriggered` in No-Limit entry management ~14089/17205 | Daily fear; v6.4.12 | Daily profit/loss state blocks entries | No-Limit has no daily caps/pauses | Deleted from No-Limit path; opt-in modes explicit | No-Limit daily gain/loss tests |
| R44 | `XAU_GrowthGuardCanPyramid` independent gate ~12490/17414 | Pyramid duplication; v6.4.12 | Growth state vetoes adds separately from exposure/risk | Re-entry/Pyramid Authority owns adds | Deleted independent veto | Pyramid within projected risk passes |
| R45 | `EffectiveMaxPyramidAdds` equity tiers ~12093 | Pyramid duplication; post-v5.8.50 | Fixed balance tiers arbitrarily cap campaigns | Projected basket risk, margin, spacing and freshness own adds | Deleted tier logic | Small account valid add test |
| R46 | `XAU_RecoveryExpansionBasketVeto` ~19230/19322 | Recovery/pyramid duplication; v6.20.5 | Recovered-PnL state independently vetoes expansion | Re-entry/Pyramid Authority plus basket risk owns expansion | Deleted independent veto | Recovered basket within risk passes |
| R47 | Recovery/retry stale opportunity mailbox | Stale retry; v6.17.14+ | Earlier block’s grade/confidence can reopen after price extends | A new identity is mandatory after reset | Deleted stale mailbox authority | Block-early/approve-late impossible test |
| R48 | Separate adaptive-reversal `OpenTrade` call ~14845 | Duplicate final arbiter; v6.23.1 | Reversal bypasses normal ordered authorities through a special lane | One Final Entry Arbiter handles all normal candidates | Deleted special lane; no inverse logic added | Single normal pipeline source test |

## Authorities after removal

1. Signal/Direction Authority — produces one candidate direction and grade.
2. Structure Authority — only a confirmed opposite structural break is hard.
3. Timing Authority — one bounded 120–180 second wall-clock delay (150 seconds by default), followed by a live freshness recheck; no second timer, bar wait, or recovery gauntlet.
4. Freshness/Extension Authority — owns candidate identity, origin, age, travel, reset and remaining reward; blocks only genuinely exhausted/poor-reward entries.
5. News Authority — the protected high-impact release window is hard; post-release conditions are assessed once.
6. Re-entry/Pyramid Authority — owns reset/separation/spacing/add count and projected basket risk.
7. Risk and Execution Authority — configured risk, basket exposure, margin, broker volume/stops and spread/slippage.
8. Final Entry Arbiter — emits one final decision and reason before `OpenTrade`; `OpenTrade` performs operational checks only.

## Mandatory stop conditions

Do not push if fewer than 30 genuine concepts/paths are removed, any removed reason remains executable in the normal path, July 15 can still block early then approve late, tests fail, MetaEditor reports any error/warning, or the compiled EX5/version/hash is stale.

## Owner correction received during implementation

After the initial frozen plan was written, the owner explicitly instructed: “do not remove that 2–3 min delay before executions.” This supersedes the “immediate” disposition stated in R01–R03, but not the removal of the old multi-stage timing/recovery stack. The final design therefore keeps exactly one shared 120–180 second delay for PRIMARY, RE_ENTRY, and PYRAMID, with independent lane clocks and a live freshness/extension recheck before release. There is no immediate-grade bypass, next-bar wait, pending-opportunity recovery, or second confirmation timer.
