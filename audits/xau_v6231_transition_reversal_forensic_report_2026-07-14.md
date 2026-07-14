# XAU AI Sniper v6.23.1 — Production Transition/Reversal Forensic Report

Date: 2026-07-14  
Repair branch: `audit/production-transition-reversal-forensic-repair`  
Baseline: `b894d171a76d5f0a12cbced95732cee9ebde8647` (`origin/main`)  
Scope: production XAUUSD bot only. The isolated v6.22.0 experiment was inspected for comparison but not modified or merged.

## A. Exact VPS running version and build

Evidence was collected read-only from the MT5 VPS before any repair work.

| Item | Proven state |
|---|---|
| Terminal | One `terminal64.exe`, `C:\Program Files\MetaTrader 5\terminal64.exe` |
| Second terminal/tester | None found |
| Attached chart | `XAUUSDm`, M5 |
| Account mode | Hedging |
| Loaded production EA | `XAUUSD_AI_Sniper_EA_v6.23.0.ex5` |
| Runtime version/build | `v6.23.0` / `v6230-production-forensic-hardening-20260714` |
| Deployed EX5 SHA-256 | `06a313171bd2766c18a02ee92e3a295e398686599ced6666fe7b51c6c2d33e03` |
| Deployed EX5 size | 1,343,460 bytes |
| Matching source commit | `b894d171a76d5f0a12cbced95732cee9ebde8647` |
| Normal magic | `20250401` |
| Counter magic | `90205001` |
| Counter mode | `COUNTER_EXECUTE` |
| Duplicate instance | No evidence of a second attached EA, second terminal, or tester trading this account |
| Old binary present | v6.21.3 files remain on disk, but Journal proves removal before v6.23.0 loaded; no evidence they remained attached |

Journal sequence proves v6.21.3 was removed and v6.23.0 loaded on `XAUUSDm,M5` at terminal-log time 2026-07-14 02:37:43. The counter BUY occurred before that reload; both catastrophic SELLs were opened by v6.23.0.

## B. Exact incident window

Broker-history incident window: 2026-07-13 07:29:58 through 2026-07-14 04:36:27. The critical transition window begins around the exhausted low near 3990–4000 on 2026-07-14 00:20 and ends after the second v6.23.0 SELL stopped at 04:36:27.

- Balance immediately after the final Counter BUY TP: approximately $6,984.43.
- First v6.23.0 losing SELL: -$1,036.26.
- Second v6.23.0 losing SELL: -$890.64.
- Displayed history result after the sequence: approximately -$1,942.47; balance $5,057.53.

Broker-history time and terminal-log time are different clock domains. The table below uses broker-history time. Log decisions were correlated by ticket, price, direction, and sequence rather than assuming the clocks were identical.

## C–E. Chronological trade reconstruction, normal decisions, and Counter decisions

Fields not present in broker history or the retained logs are marked `not recorded`; they are not inferred from screenshots.

| Broker time open→close | Price open→close | Source / direction / lot | SL / TP | Peak evidence | Final result | Decision and context |
|---|---:|---:|---:|---:|---:|---|
| 07-13 07:29:58→07:31:45 | 4058.975→4056.762 | Normal BUY 0.60 | 4042.000 / 4101.796 | not recorded | -132.78 | Earlier campaign trade; outside critical bottom transition |
| 07-13 09:05:26→09:40:17 | 4073.779→4072.078 | Normal SELL 0.67 | 4072.078 / 4000.050 | not recorded | +113.96 | Major bearish campaign developing |
| 07-13 13:40:18→13:50:12 | 4054.138→4049.530 | Normal SELL 0.67 | 4050.724 / 3978.891 | not recorded | +308.74 | Healthy continuation |
| 07-13 13:41:03→13:44:07 | 4057.085→4053.091 | Normal SELL 0.13 | 4053.091 / 3978.891 | not recorded | +51.93 | Healthy continuation |
| 07-13 13:49:37→13:50:24 | 4050.813→4049.975 | Normal SELL 0.52 | 4065.833 / 3978.891 | not recorded | +43.58 | Healthy continuation |
| 07-13 14:35:07→14:35:08 | 4009.306→4007.090 | Counter BUY 0.09 | 3995.671 / 4016.205 | not recorded | -19.94 | Closed by Counter momentum-failure logic; tactical attempt failed |
| 07-13 15:10:12→15:21:28 | 4014.277→4016.819 | Counter BUY 0.10 | 4016.819 / 4020.633 | ≥ protected zone | +25.42 | Counter profit-floor exit |
| 07-13 15:48:15→16:29:54 | 4013.514→4003.506 | Normal SELL 0.61 | 4003.506 / 3924.422 | not recorded | +610.48 | Strong SELL campaign |
| 07-13 16:24:36→16:29:55 | 4009.964→4003.827 | Normal SELL 0.47 | 4003.827 / 3924.422 | not recorded | +288.44 | Strong SELL campaign |
| 07-13 16:29:14→16:29:45 | 4005.421→4003.227 | Normal SELL 0.32 | 4004.135 / 3924.422 | not recorded | +70.21 | Strong SELL campaign |
| 07-13 17:48:10→17:53:07 | 3997.251→3995.630 | Normal SELL 0.82 | 3996.056 / 3919.569 | not recorded | +132.92 | Late campaign continuation |
| 07-13 17:51:19→18:20:46 | 3993.855→3989.355 | Normal SELL 0.57 | 3989.355 / 3919.569 | not recorded | +256.50 | Low-area SELL still paid |
| 07-13 18:20:01→18:35:58 | 3988.341→4000.201 | Normal SELL 0.40 | 4000.201 / 3919.569 | not recorded | -474.40 | First clear costly failure at the exhausted low |
| 07-13 19:18:25→19:39:57 | 3998.323→3995.620 | Normal SELL 0.80 | 3995.620 / 3919.131 | not recorded | +216.24 | Old direction temporarily resumed |
| 07-13 22:43:55→22:56:25 | 4003.810→4002.592 | Normal SELL 1.78 | 4002.592 / 3967.058 | not recorded | +216.80 | Same-direction re-entry late in campaign |
| 07-14 00:25:07→00:28:30 | 3990.325→3993.482 | Counter BUY 0.23 | 3991.650 after ratchet / 3993.482 | reached 0.5R | +72.61 | Normal SELL was blocked at 86% exhaustion; Counter BUY score 4 executed; broker TP at its own fixed 0.5R cap closed it |
| 07-14 01:13:13→02:14:46 | 3997.631→4017.559 | Normal SELL 0.52 | 4017.559 / 3868.096 | peak 0.186R / +192.81 | -1,036.26 | v6.23.0 A+ TREND_PULLBACK; full risk 14.837%; timing delayed 159s and worsened SELL by 2.41; broker SL |
| 07-14 04:23:37→04:36:27 | 4015.021→4023.192 | Normal SELL 1.09 | 4023.192 / 3961.908 | peak 0.059R / +52.21 | -890.64 | v6.23.0 A+ HTF_TREND_FOLLOW; full risk 14.974%; 175s delay neutral; broker SL |

### Critical decision sequence

1. At terminal-log time around 02:20, the old direction engine correctly reported bearish continuation failure and `DIRECTION_TRANSITION_WAIT`.
2. At approximately 02:25, `XAU_ResolveOrReleaseTransitionWait` hit its three-bar cap and forced `DIRECTION_BOTH_ALLOWED` on the fourth bar.
3. That scan measured approximately 93% late location and 86% exhaustion, blocked the normal SELL, and allowed a score-4 Counter BUY.
4. The Counter BUY reached its exact 0.5R TP and closed profitably.
5. No trusted bridge preserved that result as normal-strategy transition evidence.
6. At the first bad SELL scan, HTF and regime bonuses produced an A+ TREND_PULLBACK. The final direction-quality guard reported SELL edge 77, BUY edge 0, exhaustion 24, reversal 17.
7. At the second bad SELL scan, the engine called rising/mixed structure a normal pullback. Entry timing reported setup/timing 100/100 and exhaustion 0 despite the prior 86% reading, the successful Counter BUY, and the first full SELL SL.

## F–M. Proven causes and severity

### Critical

1. **Transition state expired by time, not by market proof.** `XAU_ResolveOrReleaseTransitionWait` forced `BOTH_ALLOWED` after four bars. The exact old-direction SELL permission reopened without a continuation reset.
2. **No durable campaign/session maturity memory.** The same market was measured at roughly 86% exhaustion, then 24–25%, then 0%. Existing calculations used short local snapshots and forgot the already-consumed move; the v6.23.0 restart also began fresh scoped state.
3. **Counter evidence was operationally isolated.** Counter correctly identified and profited from BUY, but normal SELL confidence received no bounded negative update.
4. **The final guard conflated “not enough proof to BUY” with “SELL remains safe.”** It required a confirmed opposite majority to block the old side; it lacked separate continuation and reversal permissions.
5. **Existing-position transition logic had no authority.** Thesis telemetry could print healthy/100 while price contradicted the SELL. R protection armed only at 0.3R; both losing SELLs peaked below it and therefore rode to broker SL.

### High

6. **HTF/regime bonuses overpowered local transition.** A +2.5 HTF bonus helped turn mature/late SELL candidates into A+ entries.
7. **Timing revalidated stale direction, not lifecycle.** The first delay worsened price, but even an instant entry still modeled a large loss; direction was the primary error. The second delay was neutral.
8. **Independent quality subsystems contradicted each other.** One measured 86% exhaustion; a later entry path measured 0 and had authority to trade.

### Medium

9. **Counter 0.5R hard target capped reversal capture.** This close was intentional and correct under the configured Counter rules; the defect was discarding its evidence afterward.
10. **AI had no corrective authority and did not independently solve the transition.** This is by design and is not the primary cause.
11. **TradeBrain did not directly cause the entries, but it also had no transition campaign context capable of vetoing them.**

### Low / not causal

12. Indicator-recovery noise exists in logs but did not create the two proven v6.23.0 SELL entries.
13. No duplicate terminal/EA instance was found.

## N–P. Architecture, final ownership, functions and line references

The repair is one centralized authority, not a stack of unrelated indicators.

| Function / location | Responsibility |
|---|---|
| `ENUM_ADAPTIVE_TRANSITION_MODE` — line 1820 | OFF / SHADOW / ACTIVE; default SHADOW |
| `XAU_ResolveOrReleaseTransitionWait` — line 10122 | Time/bar-count release removed; remains waiting until market proof changes state |
| `XAU_RecordCounterTransitionEvidence` — line 10445 | Bounded signed Counter evidence with time decay and outcome/MFE/MAE inputs |
| `XAU_AdaptiveMarketTransitionEngine` — line 10481 | Central closed-bar lifecycle, travel, maturity, continuation, absorption, structure, momentum, reward, Counter bridge, persistence, and evidence-only exhaustion decay |
| `XAU_FinalAdaptiveDirectionDecision` — line 10685 | Final direction choke and 60/70/80 invariants |
| `CheckPyramidOpportunity` call — line 11731 | Direct-send pyramid path obeys the same authority |
| Reversal candidate creation — line 14189 | ACTIVE-only fresh `ADAPTIVE_REVERSAL_RECLAIM`; SHADOW logs only |
| `OpenTrade` call — line 17053 | PRIMARY / RE_ENTRY / RECOVERY / future RETRY final fail-safe |
| `XAU_ApplyTransitionPositionAuthority` — line 21678 | Existing-position recommendation/authority consumed inside sole R close owner |
| `XAU_EffectiveAdaptiveEntryDelaySeconds` — line 27627 | 30-second default bounded fast confirm only after 80%+ compact reversal package; ordinary continuation remains 120–180 seconds |
| `XAU_FinalizeCounterTransitionEvidence` — line 28305 | Feeds executed Counter outcome back once, including broker TP/SL/external disappearance |

Final authority record:

`FINAL_DIRECTION_DECISION normalBias= trendHealth= maturity= continuationConfidence= transitionProbability= reversalProbability= counterEvidence= freshSellAllowed= freshBuyAllowed= existingSellAction= existingBuyAction= mode= source= reason=`

Hard invariants:

- 0–59%: normal qualified continuation remains possible.
- 60–69%: mature/selective; pyramids stop; continuation needs adequate confidence and reward.
- 70%+: every old-direction PRIMARY, RE_ENTRY, RECOVERY, RETRY, and PYRAMID is blocked immediately.
- 80%+: opposite becomes preferred only when failed extremes, reclaim, retest/displacement, persistence, reward, and anti-chase conditions pass.
- 90%+: compact package may approve sooner, still never from exhaustion alone or one wick.
- High exhaustion cannot decay because bars elapsed. It decays by at most ten points per closed bar only after fresh extreme progress, strong continuation quality, weak opposite momentum, few failures, and acceptable remaining reward.
- A successful opposite Counter during high exhaustion caps old-direction confidence and adds bounded, decaying transition evidence.

## Q–R. Tests, scenario replay, and backtest limits

- Targeted transition and incident suite: 24 passed.
- Focused production/release suite: 133 passed.
- Baseline historical `tests/`: 208 failed, 789 passed.
- Repaired historical `tests/`: 208 failed, 813 passed after updating two obsolete assertions that explicitly required the removed bypasses. Failure set otherwise equals baseline.
- Full repository collection including `backend/tests` cannot collect in this worktree because a pre-existing test unconditionally opens `/app/frontend/.env`; this is an environment fixture failure, not an EA test failure.
- Backend Python syntax: passed.
- Frontend production build: not run because `frontend/node_modules` is absent in the isolated worktree.

Actual-incident fixture: `tests/fixtures/xau_vps_transition_incident_20260713_14.json`.

| Incident step | Old decision | v6.23.1 expected decision |
|---|---|---|
| Healthy/mid SELL campaign | SELL | SELL remains allowed |
| 86% exhaustion near bottom | SELL timing blocked; transition later forgotten | Old SELL prohibited; opposite search active; no blind BUY |
| Counter BUY reaches 0.5R | Close Counter and discard signal | Close Counter per its own owner, preserve bounded BUY transition evidence |
| SELL 3997.631 | A+ SELL, allowed | BLOCK SELL at final choke and cancel stale timing identity |
| Reclaim/retest/displacement package | Wait for slow trend or keep SELL bias | Fresh BUY candidate, short bounded confirmation, anti-chase revalidation |
| SELL 4015.021 | A+ SELL, allowed | BLOCK SELL; cannot reopen through HTF, recovery, re-entry, retry, or pyramid |

This is a deterministic decision replay over proven logged incident states, not a tick-accurate Strategy Tester backtest. Complete broker tick data and an exported MT5 Strategy Tester dataset were not present, so no claim of simulated P/L is made.

## S–W. Compile, branch, deployment evidence, shadow mode, rollback

### Compile

- Exact final source: 0 errors, 0 warnings.
- Source SHA-256: `0a7bd8371dfa6508b7045ce4f64dbab4a9133a9ca66a55ee415e844ebc1aa18f`.
- EX5 SHA-256: `9b84beb9d72cc777987bafc24099c52d3e474fb10a3489c7a16a5219c7a30870`.
- EX5 size: 1,372,438 bytes.
- Compile log: `compile_logs/v6231_adaptive_transition_authority.log`.

### Branch/commit

Branch: `audit/production-transition-reversal-forensic-repair`. The immutable commit SHA is reported in the final handoff because a commit cannot embed its own hash without changing that hash.

### VPS deployment status

Not deployed or attached during this repair. The live VPS remains on the proven v6.23.0 build. The candidate was compiled from an isolated VPS temp path, copied back, and all temp source/EX5/log artifacts were removed. No live EA file, chart, process, input, or terminal state was changed.

### Shadow mode

Default input is `ADAPTIVE_TRANSITION_SHADOW`. The exact ACTIVE decision is computed and logged, but SHADOW does not alter entries/exits. Required logs are implemented:

- `[MARKET_LIFECYCLE]`
- `[EXHAUSTION_ENTRY_AUDIT]`
- `[TRANSITION_POSITION_AUDIT]`
- `[REVERSAL_ENTRY_AUDIT]`
- `[COUNTER_TRANSITION_EVIDENCE]`
- `FINAL_DIRECTION_DECISION`

No live shadow evidence exists yet because the owner has not deployed/attached v6.23.1.

### Rollback

1. Stop Algo Trading before changing the attached EA.
2. Preserve the current v6.23.0 EX5 (its SHA is recorded above).
3. Attach v6.23.1 in SHADOW only and confirm one chart/one terminal.
4. To roll back, remove v6.23.1 from the chart, restore/attach the verified v6.23.0 EX5, and confirm the Journal build marker.
5. Do not attach v6.23.0 and v6.23.1 simultaneously with the same normal magic.

## X–Y. Remaining limitations and facts not yet proven live

- Thresholds are deterministic and incident-tested but not yet calibrated on several days of live SHADOW evidence.
- No tick-accurate Strategy Tester replay was possible without broker ticks/tester export.
- Fast reversal timing, transition exits, and the Counter evidence bridge compile and pass deterministic tests but have not executed on a live market.
- No claim is made that v6.23.1 would realize the manual account's exact BUY entries or P/L.
- SHADOW should be reviewed for false exhaustion blocks, missed continuations, reversal timing, and frequency before switching to ACTIVE.
- ACTIVE must be enabled explicitly; the shipped default is SHADOW.
- v6.22.0 Adaptive Trend Campaign remains isolated and unchanged.
