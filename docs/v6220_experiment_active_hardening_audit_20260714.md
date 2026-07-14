# v6.22.0 experiment ACTIVE hardening audit — 2026-07-14

## Outcome

The isolated `XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1` experiment is compiled, tested, pushed and installed on the local MetaQuotes demo terminal in `CAMPAIGN_TRANSITION_ACTIVE` mode. Production v6.23.1 was not changed or deployed.

## A. Starting experiment commit

- Owner-reviewed implementation: `85c28be9bd463c0ef4c1faba074513fcd9bfcbef`
- Branch head at the start of this hardening pass: `d4e2b066ff26fe7799cb9aa39726d10ab4cb6cab`

## B. Final branch and commits

- Branch: `experiment/v6.22.0`
- Core ACTIVE hardening: `9412992`
- Runtime preset-path correction: `4b902a8`
- Deterministic demo startup configuration: `90a91bb68f93299813e307569e7b43ff20a31f73`
- All three commits were pushed to `origin/experiment/v6.22.0`.

## C. Exact ACTIVE configuration

- Build marker: `v6220-campaign-manual-micro-transition-active-20260714`
- Mode: ACTIVE (`2`)
- Hard old-direction block: 70% exhaustion
- Preferred opposite search: 80% exhaustion
- Closed-M1 persistence: 3 consecutive bars
- M1 displacement: 0.18 M5 ATR
- M1 sweep: 0.05 M5 ATR
- Maximum qualifying M1 bar: 0.90 M5 ATR
- Minimum reversal/continuation confidence gap: 12 points
- Fast reversal confirmation: 30 seconds
- Maximum origin distance: 2.00 ATR
- Maximum value distance: 1.00 ATR
- Maximum consumed move: 70%
- ATR pullback reset: 0.75 ATR, with market-structure alternatives
- Compact value-reset base: 3 closed M5 bars
- Minimum remaining reward: 1.20R
- Risk: full binary 15% or block; no reduced-lot fallback
- Experiment magic: isolated `62200001`
- Counter-Excursion: removed by experiment contract

The source default is at line 21547. The shipped preset is `config/XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1_ACTIVE.set`.

## D. Remaining bugs found during the independent pass

1. The shipped default was still SHADOW.
2. The final broker-send authority was distributed rather than repeated immediately before every automated market order.
3. M1 persistence counted bars in a window; alternating candles could satisfy it.
4. Abnormal/news/spread/thin-liquidity M1 evidence was not bounded tightly enough.
5. A consumed opportunity could reset only through a rigid 0.75 ATR pullback.
6. Existing-position exit urgency depended on the opposite entry also having good location, which incorrectly coupled “close damaged old thesis” to “open new trade now.”
7. Early reversal campaigns could reach the first pyramid without an explicit armed-floor requirement.
8. Transition persistence did not restore all lifecycle/action/candidate fields and did not fail conservatively on partial legacy state.
9. ACTIVE configuration validation could be bypassed when the compatibility maturity switch was off.
10. The first deployment script installed the preset to `MQL5/Profiles/Presets`; MT5 startup requires `MQL5/Presets`. This was caught before claiming ACTIVE deployment and fixed in `4b902a8`.

All confirmed critical/high/internal-contradiction findings above were repaired. No unresolved source-level release blocker remains from this audit.

## E. Improvements implemented

- ACTIVE source default, preset and startup assertion.
- Centralized final execution helper with a second live direction/location evaluation and atomic cross-instance claim.
- Consecutive closed-M1 persistence, same-bar protection, environment safety, bounded bar size and confidence separation.
- Adaptive value reset through ATR pullback, structural retest, compact base, or impulse-reset-continuation evidence; time alone cannot reset.
- Separate reversal-thesis confirmation from entry-location approval.
- Existing-campaign transition actions routed through the sole Adaptive Trend Campaign Manager.
- Early-reversal first pyramid requires meaningful profit and an armed protected floor.
- Versioned transition persistence with conservative restart fallback.
- Strict OnInit relationship validation.

## F. Entry-source choke proof

`XAU_CampaignAuthorizedMarketSend` at line 22601 is the only automated fresh market-order sender. It re-runs `XAU_FinalAdaptiveCampaignDirectionDecision`, logs `[CAMPAIGN_ACTIVE_ENTRY_AUTHORITY]`, claims the terminal-wide entry lock and only then calls the broker. PRIMARY, RE_ENTRY, RECOVERY, RETRY, legacy PYRAMID, campaign PYRAMID, adaptive reversal, pending timing and post-campaign paths converge on it. The other direct Buy/Sell call in the file is a netting position reduction, not an entry; the raw `OrderSend` is SL/TP modification.

## G. Exhaustion authority proof

At exhaustion >=70%, old-direction fresh, re-entry, recovery, retry and pyramid decisions resolve BLOCK in the central final decision and are checked again at the execution backstop. At >=80%, an opposite trade is possible only after the compact reversal thesis, confidence separation, remaining reward and location pass.

## H. Micro-transition proof

The engine at line 22103 uses closed M1 bars only. A valid package requires failed continuation, sweep/reclaim, retest or displacement, consecutive persistence, directional progress and a safe spread/news/liquidity environment. One wick or alternating candles cannot qualify. M1 is entry timing only; it is not an exit owner.

## I. Location and anti-chase proof

Correct direction plus bad location resolves `WAIT_FOR_PULLBACK`. Origin distance, value distance, consumed percentage, obstacle room, reward and live price extension remain mandatory. Grade, HTF, momentum or AI cannot override the final location backstop.

## J. Value-reset proof

A used opportunity is keyed and consumed once. A new entry requires a later closed M5 bar plus real market reset evidence: sufficient ATR pullback, a reclaimed-structure retest with a new higher low/lower high, a compact base, or an impulse-reset-continuation cycle. Elapsed time alone cannot reset it.

## K. Existing-position authority proof

`XAU_Campaign_ApplyTransitionPositionAuthority` at line 24116 acts only on the old-direction campaign. MATURE stops adds; EXHAUSTING tightens protection; persistent transition can exit profitably or controlled; OPPOSITE_CONFIRMED closes through `XAU_Campaign_Finalize`. Broker-confirmed retries remain owned by `XAU_RExit_RequestClose` at line 21481. There is no second close owner.

## L. Campaign-holding proof

Once the opposite campaign opens, ownership transfers to the existing Adaptive Trend Campaign Manager. Normal M1 noise does not close it. Its original structural thesis, risk denominator, M5/M15/H1 health and ratcheting campaign floor remain authoritative.

## M. Pyramid proof

`XAU_Campaign_EvaluatePyramid` at line 23850 requires a profitable campaign, fresh closed-M5 impulse/reset/continuation event, valid location and reward, margin and aggregate-risk safety. An early-reversal setup additionally requires the campaign guarantee floor before its first add.

## N. Restart/persistence proof

The load/save functions at lines 21968 and 22023 persist exhaustion, direction, lifecycle, candidate bars, existing-position actions, reversal direction/origin/detection/reclaim/value/peak/latest price, entry time, consumed state and opportunity state. Partial or legacy state preserves at least 70% exhaustion and blocks the old direction until genuine closed-M5 continuation proof clears it. Campaign floor and pending-close persistence remain in their existing dedicated stores.

## O. Risk proof

Normal and reduced risk inputs both remain 15%. The binary contract is unchanged: calculate the full configured risk or block. Broker geometry, margin, aggregate campaign risk, free-margin reserve, spread/news safety and cross-instance lock remain mandatory.

## P. Compile result

- MetaEditor: 0 errors, 0 warnings
- Compile log: `compile_logs/v6220_active_hardening_20260714.log`
- Source SHA-256: `020942f3b8cc30dfd76502c36de92074f53bf33b671680a737ab5e38543a8d13`

## Q. Test results

- Focused ACTIVE hardening/authority/manual tests: 72 passed before final deployment-artifact additions; final dedicated ACTIVE file: 32 passed.
- Entire v6.22 experiment suite: 202 passed before the final startup-config-only test; rerun after final documentation is recorded in delivery.
- Repository `tests/` comparison: 958 passed, 208 failed versus prior 926 passed, 208 failed. The failure set is unchanged legacy/version-sync debt; all added experiment tests passed.
- Repository-root collection still has the pre-existing missing `/app/frontend/.env` backend collection error.

## R. Production-untouched proof

- Production worktree branch: `main`
- Production HEAD: `95bbb2e23bef85908c71aa75ee10963dfe4741a2`
- `origin/main`: `95bbb2e23bef85908c71aa75ee10963dfe4741a2`
- No production source, EX5, VPS file or production terminal was changed.

## S. Deployment evidence

- Target: local isolated MetaQuotes demo terminal, hedging mode, XAUUSD M5.
- Latest synchronization before attachment showed 0 positions and 0 orders.
- Installed EX5 checksum matches the repository binary.
- Journal at 12:53 local terminal time reported:
  - exact active build marker;
  - `transitionMode=ACTIVE` and valid configuration;
  - `CAMPAIGN_TRANSITION_AUTHORITY_CONFIG mode=ACTIVE`;
  - `CAMPAIGN_TRANSITION_ACTIVE_ASSERTION_PASSED`;
  - `counterExcursion=REMOVED`;
  - one `CAMPAIGN_INSTANCE_LEASE_ACQUIRED` for XAUUSD M5.
- The user performed the final chart attachment manually; no production instance was replaced.

## T. EX5 hash

`cd6ebfc46fc2af67c89af622e8254f34d3cb05bec57c625595fec4b570acd94e`

## U. Rollback instructions

1. Disable Algo Trading before replacement.
2. Remove the experiment EA from the XAUUSD M5 chart.
3. Restore the prior EX5 from `MQL5/Experts/rollback_v6220_20260714_124719/`.
4. Reattach only one experiment instance with its prior preset.
5. Verify the prior build marker and one lease in Journal before re-enabling Algo Trading.

An earlier rollback snapshot also exists at `rollback_v6220_20260714_124514`.

## V. Not yet observed live

- The market has not yet provided and executed a fully allowed opposite candidate under this exact ACTIVE binary. Deterministic tests prove the path; real-market execution remains forward-test evidence to collect.
- The post-attachment window has not yet naturally produced every requested lifecycle log (healthy allow, mature selectivity, exhaustion block, reversal preparation, wait-for-pullback and allowed opposite) under ACTIVE. These require market conditions, not synthetic Journal claims.
- The new demo account’s cloud monitoring endpoint reports a license bound to a different account. The EA logs this as monitor-only and continues local trading, but cloud heartbeat/command telemetry will remain unavailable until the owner rebinds the license. No credential or account identifier is stored in this report.
- Profitability and unseen-market robustness cannot be guaranteed by compile/static/deterministic testing; this build must remain an experiment until forward testing confirms behavior.
