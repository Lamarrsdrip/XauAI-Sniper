# v6.22.0 Adaptive Trend Campaign EXP1 — Forensic Audit and Repair

Audit date: 2026-07-14  
Scope: `XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5` only  
Audit branch: `audit/v6220-campaign-forensic-repair`  
Repaired source commit: `2eace38081ff53e1ea9869ce434f8ca7b406e302`

This report separates static proof, generated-scenario proof, compiler proof, and demo observation. It does not claim gap/slippage-proof fills or live validation of the new pyramid state machine.

## A. Baseline and branch details

- Origin was fetched before editing.
- Requested experiment start: `de89a995332b51f1ebd2ef03834c35541c08d7d4`.
- Production baseline: `origin/main` at `02b0893`, v6.21.3.
- Work was performed on `audit/v6220-campaign-forensic-repair`, never on `origin/main`.
- Two later experiment-only prerequisite fixes were retained: `1f7b58d` (hedging campaign handling) and `34c774b` (maturity/reversal engine).
- Repair commits: `c6dc243`, `3867957`, `2eace38`.
- Branch is pushed to `origin/audit/v6220-campaign-forensic-repair`; history was not rewritten and no branch was deleted.
- Production hashes before and after: both root v6.21.3 and backend mirror are SHA-256 `9e6d9712d56d55124880feb0235067f4b92b8528b1c3dded00797f121a57903e`, matching `origin/main` byte-for-byte.

## B. Architecture call graph

```text
OnInit
  -> validate experiment identity/config/magic
  -> acquire account+server+symbol+magic campaign lease
  -> load campaign state and post-campaign reset state
  -> reconcile persisted state with broker positions oldest-first

OnTimer -> OnTick
OnTick
  -> trend-maturity update (closed-bar only)
  -> XAU_RExitCoreLoop
       -> XAU_CampaignCoreLoop and return (legacy R manager cannot continue)
            -> attribute only symbol+magic experiment positions
            -> aggregate live net P&L / stable initial-risk R
            -> update peak and protected floor
            -> retry pending broker close/SL work
            -> classify closed-bar market state
            -> reduce latest/weakest leg on THESIS_DAMAGED
            -> close all legs on floor breach, invalidation, confirmed change
            -> evaluate event-driven pyramid FSM
  -> entry scanner / pending-confirm timer / watchdog
       -> every initial-entry route converges on OpenTrade
            -> reject duplicate own-magic campaign
            -> post-profit reset and maturity gates
            -> structural invalidation SL
            -> full-risk binary lot and margin validation
            -> broker order
            -> capture actual fill/SL/volume and create campaign

OnTradeTransaction
  -> confirm fills/closes, resolve identifiers/tickets, retain state until broker flat

Persistence
  -> XAU_Campaign_SaveState (temporary file then atomic replacement)
  -> XAU_Campaign_LoadState (schema/account/server/symbol/magic validation)
```

True account/broker emergencies remain outside discretionary ownership: weekend liquidation, prop/equity survival, explicit remote close-all, and equivalent account emergency paths.

## C. Ownership/conflict matrix

| System/function | Position scope | Open | Add | Modify SL | Partial | Full close | Block | Reset | Campaign guard / reachability | Conflict risk |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| `OpenTrade` | experiment symbol+magic initial entry | yes | no | initial only | no | no | yes | create | duplicate-campaign, reset, maturity, risk guards | repaired |
| `XAU_Campaign_EvaluatePyramid` | one active campaign | no | yes | order SL only | no | remediation | yes | event FSM | sole add authority; lease/event claims | repaired |
| `XAU_Campaign_UpdateProtection` | every active campaign leg | no | no | yes | no | floor-breach retry | yes | no | sole discretionary SL authority | repaired |
| `XAU_Campaign_ReduceLatestLeg` | latest/weakest active leg | no | no | no | netting only | hedging leg | no | leg state | campaign submodule | intentional |
| `XAU_Campaign_Finalize` | all active legs | no | no | no | no | yes | no | only after broker flat | campaign submodule | intentional |
| `XAU_RExitCoreLoop` | experiment positions | no | no | no | no | no | no | no | delegates to campaign and returns | removed conflict |
| `ManagePositions`, `ManageBasket` | legacy normal positions | no | no | no for campaign | no for campaign | no for campaign | no | no | campaign ownership short-circuit | unreachable |
| SmartExit, peak floor, Profit Guardian | legacy | no | no | no for campaign | no | no | no | no | owner guard | unreachable |
| Daily/Growth lock, expectancy giveback, EPF | legacy discretionary | no | no | no for campaign | no for campaign | no for campaign | entry observation only | no | owner guard / disabled campaign authority | unreachable |
| Clean Exit, AMPL, TTM, TRI, Recovery Expansion, loss armor | legacy | no | no | no for campaign | no for campaign | no for campaign | no | no | owner guard | unreachable |
| Remote AI proactive exit | ordinary advisory path | no | no | no | no | no for campaign | advisory | no | campaign guarded | unreachable |
| Raw `OrderSend` / direct close helpers | broker plumbing | no | no | only through guarded safe modifier | mode-aware | manager/emergency only | no | broker-confirmed | audited call sites | controlled |
| Weekend/equity/prop/remote emergency close-all | account survival | no | no | possible liquidation | possible | yes | yes | broker-confirmed | explicit emergency override | intentional |

No ordinary legacy system remains able to tighten, loosen, partially close, or fully close a campaign ticket under competing logic.

## D. Critical bugs found

1. **Pyramids were scan/condition driven, not event driven.** Static IDs such as `campaign_L1` represented a leg number, not a unique impulse-reset-continuation event. A continuously true continuation condition could be reused on later scans.
2. **No mandatory reset/retest cycle.** The old path could add from current R, momentum, or price extension without a closed-bar impulse, pullback/consolidation, structure hold, and fresh continuation BOS.
3. **First add occurred 15 seconds after initial entry while unprotected.** The live campaign added at approximately `0.008R`, with no armed floor.
4. **A second initial campaign bypassed campaign coherence.** The observed `0.04` position was not pyramid leg 2; it was another initial campaign while positions already existed.
5. **Full-risk entry silently degraded.** Aggregate and margin code reduced the second initial order from desired `0.26` to `0.17` and then `0.04`, while retaining a nominal full-risk denominator in state/logs.
6. **Dangerous margin state was not a hard add veto.** The live account reached about 101.42% margin level and $27.37 free margin.
7. **Restart reconstruction used broker enumeration order as chronology.** The newest tiny leg could become the synthetic original entry, producing a tiny R denominator and fabricated high peak R/floor.
8. **Legacy discretionary authorities remained reachable before ownership repair.** Fixed-1R/ratchet/partial/exit paths could compete with campaign management.

## E. High, medium, and low findings

High findings were the eight items above, plus cached/nominal aggregate risk, unconfirmed floating profit treated as collateral, and broker-SL confirmation gaps. Medium findings included misleading legacy startup logs, incomplete event persistence, netting/hedging ticket semantics, stale restart identifiers, and anti-chase state bypass possibilities. Low findings were noisy duplicate diagnostics and missing incident-reconstruction fields in pyramid logs.

## F. Exact fixes with file/function/line references

All references are in the experimental MQ5 file at repaired commit `2eace38`.

- Instance ownership lease: `XAU_Campaign_EnsureInstanceOwnership`, lines 3430–3459.
- Mid-bar pending confirmation: `OnTick`, lines 13623–13645.
- Strict downward volume normalization: `NormalizeVolumeDown`, line 15815.
- Structural invalidation SL: `XAU_Campaign_CalculateInvalidationSL`, lines 15869–15942.
- Full-risk binary entry and duplicate-campaign block: `OpenTrade`, lines 16653–17535.
- Campaign/maturity inputs and validation: lines 21909–22175.
- Actual campaign creation and stable initial risk: `XAU_CampaignCreate`, lines 22239–22309.
- Profit guarantee/adaptive ratchet: `XAU_Campaign_UpdateProtection`, lines 22400–22554.
- Latest-leg reduction: lines 22620–22669.
- Retry-safe campaign finalize: lines 22670–22755.
- Live broker-SL worst-case risk: lines 22757–22778.
- Pyramid event FSM and post-add verification: lines 22780–23042.
- Oldest-first restart reconstruction: lines 23121–23223.
- Post-campaign reset: lines 23382–23492.
- Isolated state path/save/load: lines 23493–23739.
- Legacy R loop delegation: line 23741 onward.
- Broker transaction confirmation: `OnTradeTransaction`, line 26284 onward.

Diff from experiment start (`de89a995...`) for the audited artifacts: 2,672 insertions and 370 deletions across the EA, compile evidence, and three v6.22 test files. The EA source alone is 1,762 insertions and 352 deletions. No production file appears in the production-path diff.

## G. Risk and lot-sizing proof

The repaired entry rule is binary: configured 15% risk or no trade. Equity produces `riskUSD`; the finalized structural SL produces distance; `OrderCalcProfit` supplies broker-aware per-lot loss; raw volume is normalized downward to broker step. Broker/configured max, aggregate risk, margin, unavailable margin pricing, and below-min volume all block rather than reduce or substitute `0.01`.

Generated scenarios cover $1,000, $10,000, and $100,000 accounts with different symbol properties. Wider SL produces smaller volume while holding dollar risk within downward-normalization tolerance. The actual broker fill, actual SL, and actual volume are captured after order confirmation. The second live campaign's silent `0.26 -> 0.17 -> 0.04` behavior is no longer reachable.

## H. Initial SL/invalidation proof

The invalidation builder uses closed M15/H1/H4 structure, directional swing geometry, BOS/HTF opposition, ATR/noise floor, chop rejection, liquidity buffer, and broker stop/freeze constraints. Weak/choppy or unavailable-structure setups block. Stops inside normal noise or beyond the configurable 8 ATR maximum block with explicit logs; they are not silently clamped to a huge distance. No fixed TP is placed.

## I. Profit-floor and ratchet proof

R uses immutable `initialRiskUSD`, not a moved SL. Before peak 0.50R, no mechanical profit floor is armed. At 0.50R, the permanent minimum is +0.25R. From 0.60R, the floor takes the ratchet-only maximum of +0.25R, the configured peak share (60%), and a structure/volatility candidate constrained against ordinary noise. Net campaign P&L projection includes all active legs and broker costs available in position profit/swap data.

State persistence round-trips peak, floor, arming, pending close, and legs. SL rejection retains the internal floor; an internal floor breach requests a retry-safe full close. Logs explicitly avoid claiming guaranteed fills across gaps or slippage.

## J. Pyramid and aggregate-risk proof

The ladder remains configurable at 0.70/0.50/0.30/0.20/0.10 of base lot and normalizes downward. The new FSM is:

`IDLE -> IMPULSE_DETECTED -> WAITING_FOR_RESET -> RESET_CONFIRMED -> CONTINUATION_CONFIRMATION -> ADD_APPROVED -> EVENT_CONSUMED`.

Defaults used for testing are two closed M5 bars, 0.40 ATR separation, 0.30 ATR impulse, 0.20 ATR reset, campaign at least +0.50R, protected floor required after add 1, and at least 1.5R obstacle room. A unique ID combines campaign, event sequence, impulse bar, continuation bar, and BOS. One event and one M5 bar can open at most one add.

Each proposed add recalculates live worst-case broker-SL risk for every leg and adds the proposed leg loss without crediting floating profit. It requires confirmed stops, aggregate risk <=30%, successful `OrderCalcMargin`, projected margin level >=200%, and projected free margin >= max($100, 20% equity). Broker pricing failure closes the gate. Post-fill broker visibility and risk are rechecked; failure triggers retry-safe remediation.

## K. Trend-maturity/reversal proof

The model runs once per closed bar and reuses existing ATR, momentum, structure, and directional evidence rather than spawning duplicate indicator stacks. Direction is sticky. A wick cannot flip it; confirmed reversal requires independent structural evidence. Mature trends tighten protection and make adds stricter; exhaustion blocks adds; maturity alone does not close an existing profitable campaign. Early reversal waits/reassesses, while confirmed direction change can close and later permit the opposite direction.

## L. Re-entry and anti-chase proof

Pending entries preserve first-seen time/price and recheck at the due wall-clock time even mid-bar. The generated regression fires at 150 seconds rather than the previously observed 297 seconds. Rediscovery cannot restart the same candidate timer.

Post-profit same-direction reset is direction-aware and persists. Normal, large (>=2R), and very large (>=4R) campaigns require progressively deeper retracement. The reset cannot place a trade itself, expires safely after six hours, and never blocks a legitimate opposite-direction entry.

## M. Restart/memory-isolation proof

Campaign schema/state includes campaign ID, direction, stable risk, base lot, all legs, weighted entry inputs, peak, floor, arming, FSM/event identifiers, pending close, and post-reset state. Keys include account, server, symbol, and magic. Writes use a temporary file and atomic replacement; malformed/foreign/stale rows are rejected or reconciled against broker truth.

Reconciliation now sorts captured broker positions oldest-open-time-first before choosing the original leg. When history is incomplete, the EA preserves an already protective broker SL but does not invent a historical 0.50R peak or guarantee arming; new pyramids remain blocked for that adopted incomplete-history campaign.

All experiment files/payloads use `CAMPAIGNEXP1`, including campaign state, TradeBrain/intelligence, blocked memory, timing proof, pattern data, reports, telemetry namespace, and magic `62200001`. Cloud fanout is off in the observed demo startup. No production memory fallback is reachable.

## N. Hedging/netting findings

Hedging records each leg by position identifier, resolves the current broker ticket, protects each leg, and closes the latest intended leg. Netting treats additions as merged exposure; reduction is reported as a volume reduction rather than a fictional ticket-specific close. Stable campaign risk and aggregate volume/risk survive the merge. Manual and production-magic positions are excluded.

## O. Compile results

MetaEditor result: **0 errors, 0 warnings**, 51.556 seconds, X64 Regular. Evidence: `compile_logs/v6220_urgent_pyramid.log`.

Repository/deployed hashes match:

- MQ5: `8e51252ee8d12f9e08b30b3406e4b0339cf165055d995c1ee569197d6dc34aa3`
- EX5: `2bd083e75942475252b7cc85218d8254ce1de395e7058dc29601df76e0fe4112`

## P. Test and backtest results

- Focused v6.22 suite: **130 passed**.
- Scenario module: 39 collected cases covering full risk, floor thresholds/ratchet/restart, close rejection, descending ladder, same-bar/event rejection, reset cycles, margin incident values, aggregate cap, mode semantics, anti-chase, maturity/reversal, 3R–5R holding, 150/297-second timer regression, memory isolation, and absence of executable counter/inverse hooks.
- Full repository suite: **886 passed, 208 failed**.
- The 208 failures are stale historical-version and production/download synchronization assertions. Their count matches the repaired baseline; changing those files/tests would require modifying production/release artifacts forbidden by scope.
- No automated MT5 Strategy Tester/backtest facility was available. Generated scenario/state-machine paths were used. Therefore profitability and multi-hour fill behavior are not backtest-proven here.

## Q. Production-untouched proof

`git diff origin/main..HEAD -- XAUUSD_AI_Sniper_EA_v6.21.3.mq5 backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` is empty. Both files retain SHA-256 `9e6d9712...a57903e`, equal to `origin/main`. Production website/downloads, production TradeBrain/memory, `origin/main`, and production MT5 deployment were not modified.

## R. Deployment evidence

Only the experimental MQ5/EX5 was installed in the Mac MT5 demo Experts folder, with rollback copies preserved. After the user's manual restart, the 2026-07-14 Journal at 00:43:13 proves:

- account `108492408`, `MetaQuotes-Demo`;
- version `6.22.0-ADAPTIVE-TREND-CAMPAIGN-EXP1`;
- build `v6220-campaign-forensic-repair-20260713`;
- magic `62200001`;
- `RISK_CONFIG_ASSERTION_PASSED`, 15% full-risk binary, 30% campaign cap;
- `counterExcursionRemoved=true`;
- `CAMPAIGN_AUTHORITY_ACTIVE`, legacy exit/pyramid/re-entry managers in standby;
- campaign manager enabled with 0.50R/0.25R/60% parameters;
- zero restored campaigns and zero open positions.

The initial H1 indicator copy returned transient MT5 error 4807 after startup, rebuilt handles, recovered within the same second, then completed a no-trade scan. No additional restart was performed by the audit after the user's manual restart.

## S. Remaining limitations and unproven live behavior

- The repaired event-driven pyramid has not yet opened a live demo add. Its behavior is statically and scenario tested, not live observed.
- Exact fills cannot be guaranteed across gaps, slippage, disconnection, or broker rejection; retry/state preservation is proven, not fill price.
- No Strategy Tester/backtest was run, so live multi-hour 3R–5R survival remains unobserved.
- During an earlier deployment check, before the oldest-first reconstruction repair loaded, the old remaining demo positions were reconstructed in broker enumeration order. That produced an invalid tiny R denominator, armed an excessive floor, and the demo positions subsequently closed. This affected demo only, not production or real money. The root cause is fixed and regression tested, but those old positions cannot be recreated for live proof.
- No new trade was manufactured to force validation. The EA is currently flat and scanning.

## T. Final branch and commit SHA

Branch: `audit/v6220-campaign-forensic-repair`  
Repaired code SHA: `2eace38081ff53e1ea9869ce434f8ca7b406e302`  
Remote: `origin/audit/v6220-campaign-forensic-repair`

## Live pyramid incident reconstruction

Terminal timestamps below are from the demo logs; server/candidate bar times are preserved separately where available.

| Terminal time | Role | Volume / fill | Campaign / candidate | Source bar / signal | Why old code treated it fresh |
|---|---|---|---|---|---|
| 23:53:28 | initial SELL | 0.24 @ 4002.65 | `CAMPAIGN_HTF_TREND_FOLLOW_SELL_1783994008`; candidate `HTF_TREND_FOLLOW_SELL_1783993834` | candidate M5 01:50 | valid initial entry |
| 23:53:43 | old pyramid 1 | 0.16 @ 4002.29 | same campaign; static `..._L1` | closed source bar inferred 01:45; not logged explicitly | continuation score 3 and price/R scan; no reset, only 15 seconds elapsed, peak about 0.008R |
| 23:58:22 | second initial SELL | 0.04 @ 4001.93 | `CAMPAIGN_TREND_PULLBACK_SELL_1783994302`; candidate `TREND_PULLBACK_SELL_1783994129` | candidate M5 01:55 | duplicate initial-entry path lacked coherent-campaign guard; full-risk lot silently reduced by margin |
| 23:59:03 | old pyramid 1 of second campaign | 0.02 @ 4001.63 | static `..._L1` | closed source bar inferred 01:50 | continuation score 4; current/peak R approximately zero; no floor/reset |
| 00:04:07 | old pyramid 2 of second campaign | 0.02 @ 4001.43 | static `..._L2` | closed source bar inferred 01:55 | continuously true condition reused as next leg; no distinct event cycle |
| 00:16:04 | later old pyramid | 0.01 @ 3999.57 | static `..._L3` | same L3 was rejected at 00:11 then accepted at 00:16 | definitive static-ID/continuous-condition reuse |

The source bars for old adds are explicitly labeled **inferred** because the old logging did not record them. The repaired logs now record event ID, impulse bar, reset type, closed continuation bar, BOS, separation, reward room, projected margin, block reason, and fill.
