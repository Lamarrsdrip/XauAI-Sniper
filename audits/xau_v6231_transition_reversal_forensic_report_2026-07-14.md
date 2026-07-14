# XAU AI Sniper v6.23.1 — Production Transition, Reversal, and Entry-Location Forensic Report

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

### Urgent live addendum: right direction, wrong location

The 2026-07-14 VPS logs were re-copied after the owner reported two newer BUYs. The terminal and Experts logs prove the following; broker-history and terminal log clocks differ, so both are retained where available.

| Trade | Proven source and first detection | Execution | Location evidence present at approval | Result and corrected decision |
|---|---|---|---|---|
| BUY 0.27 at 4027.886 | Counter-Excursion, not a normal BUY. At terminal 09:10:47, normal A-grade HTF SELL was blocked with 74% exhaustion; Counter BUY score 4/2 executed immediately. | 0-second Counter delay; SL 4023.705, TP 4029.977 | The old engine had no persistent reversal origin/value zone and classified Counter overextension false. | +$56.46 at broker TP. Under v6.23.1 this same first reversal opportunity is checked for origin extension, value distance, consumed leg, and remaining reward; if already extended it waits for pullback. |
| BUY 0.84 at 4028.551 | Normal PRIMARY `TREND_PULLBACK` BUY. First normal BUY candidate at terminal 09:26:29, price 4028.54. | 162-second normal delay; requested 4028.595, broker fill 4028.551; SL 4019.553, TP 4087.368. Price worsened only 0.05, so the delay itself was not the main loss cause. | Its own log said `value=no`, `badLoc=yes`, expansion origin 2.19 ATR, local position 74%, extension risk 51/100, effective RR quality 50/100, only 1.56 ATR local room. Momentum/SmartGuard overrides nevertheless admitted it at full risk. | -$755.83 at broker SL. Corrected decision: `REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK`; the earlier Counter entry also marks the same impulse consumed, preventing a second worse-price BUY without value reset. |

The owner-provided “BUY opened 08:02:53” timestamp is the broker-history close time; terminal evidence proves the 0.84 normal BUY opened at terminal 09:29:12 and closed at terminal 10:02:53. This correction does not change the complaint: direction was bullish, but entry value was poor.

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
9. **Direction and entry location were conflated.** The losing BUY was approved even while the same audit record explicitly said `value=no`, `badLoc=yes`, 2.19 ATR extension, and weak local room.
10. **Reversal opportunity identity did not persist.** Counter bought the first bullish impulse, closed profitably, then the normal system treated a slightly worse-price BUY five minutes later as a fresh opportunity.

### Medium

11. **Counter 0.5R hard target capped reversal capture.** This close was intentional and correct under the configured Counter rules; the defects were discarding its evidence and not marking the first impulse consumed.
12. **AI had no corrective authority and did not independently solve the transition.** This is by design and is not the primary cause.
13. **TradeBrain did not directly cause the entries, but it also had no transition campaign context capable of vetoing them.**

### Low / not causal

14. Indicator-recovery noise exists in logs but did not create the proven entries.
15. No duplicate terminal/EA instance was found.

## N–P. Architecture, final ownership, functions and line references

The repair is one centralized authority, not a stack of unrelated indicators.

| Function / location | Responsibility |
|---|---|
| `ENUM_ADAPTIVE_TRANSITION_MODE` — line 1820 | OFF / SHADOW / ACTIVE; default SHADOW |
| `XAU_ResolveOrReleaseTransitionWait` — line 10122 | Time/bar-count release removed; remains waiting until market proof changes state |
| `XAU_RecordCounterTransitionEvidence` — line 10564 | Bounded signed Counter evidence with time decay and outcome/MFE/MAE inputs; invalidates same-bar lifecycle cache |
| `XAU_AdaptiveMarketTransitionEngine` — line 10605 | Central lifecycle plus distinct old-direction reward, opposite reward, location quality, value distance, impulse extension, and consumed-move percentage |
| `XAU_FinalAdaptiveDirectionDecision` — line 10918 | Final direction-and-location choke; all normal/re-entry/recovery/retry sources converge here |
| `CheckPyramidOpportunity` call — line 11986 | Direct-send pyramid path obeys the same authority |
| Reversal candidate execution lane — line 14469 | ACTIVE-only dedicated reversal path; retains account/news/spread/risk/geometry/anti-chase safety while legacy trend opinions become observation-only |
| `OpenTrade` call — line 17405 | Final execution fail-safe and opportunity-consumption record for normal orders |
| `XAU_ApplyTransitionPositionAuthority` — line 22036 | Existing-position recommendation/authority consumed inside sole R close owner |
| `XAU_EffectiveAdaptiveEntryDelaySeconds` — line 27985 | 30-second default bounded fast confirm only after direction, reversal package, reward, and location pass |
| Counter location audit — line 29220 | Counter stays separate-magic/isolated but may not chase a consumed adaptive reversal opportunity in ACTIVE mode |

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
- Direction confidence and entry-location quality are independent. A correct direction can resolve to `WAIT_FOR_PULLBACK`.
- Reversal origin, first detection, reclaim, latest acceptable price, impulse peak, expected pullback, entry consumption, state, and opportunity ID persist across restart.
- The same reversal impulse cannot be recreated at progressively worse prices by PRIMARY or Counter. A new entry requires at least a 0.75 ATR pullback to value with sufficient remaining reward.

## Q–R. Tests, scenario replay, and backtest limits

- Targeted transition, incident, direction/location, identity, and compatibility suite: 52 passed.
- The direction/location subset includes 17 deterministic tests for bad-location blocking, persistent opportunity identity, value reset, same-impulse reuse, Counter location, four-trade replay, and symmetry.
- Baseline historical `tests/`: 208 failed, 789 passed.
- Pre-addendum v6.23.1 comparison point: 208 failed, 813 passed.
- ACTIVE addendum historical `tests/`: 208 failed, 840 passed. The 208 failure-name set is unchanged from the pre-repair comparison; the remaining failures are historical version-pinned fixtures, not new implementation regressions.
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
| Counter BUY 4027.886 | Immediate separate-magic BUY, then 0.5R TP | If first reversal leg is already extended/low-reward, WAIT_FOR_BUY_PULLBACK; otherwise one allowed entry consumes this opportunity |
| Normal BUY 4028.551 | A-grade BUY admitted despite `value=no`, `badLoc=yes` | BLOCK immediate execution: same impulse already used, 2.19 ATR extension, poor value, insufficient local reward; monitor for value reset |

This is a deterministic decision replay over proven logged incident states, not a tick-accurate Strategy Tester backtest. Complete broker tick data and an exported MT5 Strategy Tester dataset were not present, so no claim of simulated P/L is made.

## S–W. Compile, branch, deployment evidence, shadow mode, rollback

### Compile

- Exact final source: 0 errors, 0 warnings.
- Source SHA-256: `d136f57e822807ba16475f7d18c095b383128faf3e67aba8f69c0270b9e3408f`.
- Backend mirror SHA-256: `d136f57e822807ba16475f7d18c095b383128faf3e67aba8f69c0270b9e3408f`.
- EX5 SHA-256: `40ccc62dab9ea1449db8fa156df0a4105f47cfcef0d73500331337eef9b33979`.
- EX5 size: 1,390,538 bytes.
- Compile log: `compile_logs/v6231_final_authority_audit.log`.

### Branch/commit

The completed repair was promoted to `main` at the owner's direction. The ACTIVE deployment commit is reported in the final handoff because a commit cannot embed its own hash without changing that hash.

### VPS deployment status

The original forensic repair was not deployed. The owner then attached v6.23.1 manually at 2026-07-14 10:41 VPS local time. A later read-only audit proved one terminal, one `XAUUSDm,M5` v6.23.1 instance, demo mode, and build `v6231-adaptive-transition-location-authority-20260714` running in SHADOW. Its EX5/source/chart/Journal were preserved before the authorized ACTIVE deployment.

### ACTIVE-mode authorization addendum

The owner explicitly authorized production demo ACTIVE mode after the SHADOW Journal proved decisions such as `WOULD_BLOCK` and `WAIT_FOR_PULLBACK` were being calculated but not enforced. The shipped default is now `ADAPTIVE_TRANSITION_ACTIVE`; the actual attached chart input and preset are deployed as ACTIVE and independently verified from Journal startup evidence. Required logs include:

- `[MARKET_LIFECYCLE]`
- `[EXHAUSTION_ENTRY_AUDIT]`
- `[TRANSITION_POSITION_AUDIT]`
- `[REVERSAL_ENTRY_AUDIT]`
- `[COUNTER_TRANSITION_EVIDENCE]`
- `FINAL_DIRECTION_DECISION`
- `[ACTIVE_FINAL_ENTRY_ASSERTION]`
- `ADAPTIVE_TRANSITION_ACTIVE_ASSERTION_PASSED`

ACTIVE does not mean a blanket gate: healthy continuation below 60% remains eligible, 60–69% is selective, and only 70%+ creates the hard old-direction entry invariant. Direction-correct/bad-location reversals wait for value without prohibiting the other valid market states.

### Rollback

1. Stop the one terminal cleanly so the current chart and position state persist.
2. Restore the preserved v6.23.1 SHADOW EX5, MQ5, and chart from the timestamped VPS rollback directory reported in the final handoff.
3. Restart the terminal and confirm build `v6231-adaptive-transition-location-authority-20260714`, `mode=SHADOW`, and one `XAUUSDm,M5` instance.
4. Do not attach two v6.23.1 instances with the same normal magic.

## X–Y. Remaining limitations and facts not yet proven live

- Thresholds are deterministic and incident-tested but have not yet accumulated several days of ACTIVE natural-market evidence.
- No tick-accurate Strategy Tester replay was possible without broker ticks/tester export.
- Fast reversal timing, transition exits, and the Counter evidence bridge compile and pass deterministic tests but have not executed on a live market.
- Reversal opportunity origin/value persistence and same-impulse location authority are deterministic and incident-tested; ALLOW/BLOCK/WAIT behavior still needs continued natural-market observation.
- No claim is made that v6.23.1 would realize the manual account's exact BUY entries or P/L.
- ACTIVE was explicitly authorized by the owner for the VPS demo only. No claim is made about readiness for real money.
- Trade-frequency monitoring remains required so ACTIVE can be evaluated for false exhaustion blocks and missed healthy continuations.
- v6.22.0 Adaptive Trend Campaign remains isolated and unchanged.
