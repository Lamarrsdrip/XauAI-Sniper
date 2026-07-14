# v6.22.0 ACTIVE Intelligence Forensic Repair — 2026-07-14

Scope: `XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1` only. Production v6.21.3, its backend mirror, production memory, website, `origin/main`, and production MT5 deployment were not changed.

## Baseline and evidence

- Audit branch: `audit/v6220-active-intelligence-repair`
- Experimental baseline: `58c94a60f634b8094947a29d0924160d57205aed`
- ACTIVE startup used for the incident audit: terminal 12:59:24, account 5053017016, MetaQuotes-Demo hedging, symbol XAUUSD M5, magic 62200001.
- Deployed build audited: `v6220-campaign-manual-micro-transition-active-20260714`.
- Lease acquired; state restore reported zero campaigns/legs and `postResetActive=false`; local trading and algo trading were enabled. Therefore lease, stale campaign restore, and disabled trading were not the no-trade cause.
- Production source and backend mirror SHA-256 before and after: `9e6d9712d56d55124880feb0235067f4b92b8528b1c3dded00797f121a57903e`.

## Live funnel from ACTIVE startup through 16:15

The exact Experts log contained 39 completed scan fingerprints: 19 real setup candidates and 20 `NO_SETUP` scans. No order was sent.

| Time | Direction/setup | Grade/combined | Final old-build result | Exact terminal blocker |
|---|---|---:|---|---|
| 12:59 | BUY TREND_PULLBACK | SKIP / 1.35 | BLOCK | SmartGuard fast confirmation |
| 13:01 | BUY TREND_PULLBACK | SKIP / 1.15 | BLOCK | SmartGuard fast confirmation |
| 13:05 | BUY TREND_PULLBACK | SKIP / 1.15 | BLOCK | SmartGuard fast confirmation |
| 13:10 | BUY TREND_PULLBACK | SKIP / 1.15 | BLOCK | SmartGuard fast confirmation |
| 13:40 | BUY BREAKOUT | A / 4.50 | BLOCK | timing `HARD_BLOCK`, failed impulse/spike |
| 13:45 | BUY BREAKOUT | B / 3.75 | BLOCK | B-quality fast confirmation |
| 14:30 | BUY TREND_PULLBACK | SKIP / 2.80 | BLOCK | legacy grade threshold |
| 14:35 | BUY TREND_PULLBACK | SKIP / 2.80 | BLOCK | legacy grade threshold |
| 14:40 | BUY TREND_PULLBACK | B / 3.45 | BLOCK | post-news momentum observing |
| 14:45 | BUY TREND_PULLBACK | SKIP / 2.80 | BLOCK | legacy grade threshold |
| 14:50 | BUY TREND_PULLBACK | B / 3.45 | BLOCK | timing soft block |
| 14:55 | BUY TREND_PULLBACK | B / 3.45 | BLOCK | timing `HARD_BLOCK`, failed impulse |
| 15:40 | BUY TREND_PULLBACK | B / 3.77 | BLOCK | timing `HARD_BLOCK`, failed impulse |
| 15:45 | BUY TREND_PULLBACK | B / 3.77 | BLOCK | timing `HARD_BLOCK`, post-sweep trap |
| 15:50 | BUY TREND_PULLBACK | B / 3.77 | BLOCK | timing `HARD_BLOCK`, failed impulse |
| 15:55 | BUY TREND_PULLBACK | A / 4.43 | BLOCK | post-news momentum observing |
| 16:00 | BUY TREND_PULLBACK | A / 4.43 | BLOCK | legacy M30 HTF context gate |
| 16:05 | BUY TREND_PULLBACK | B / 3.77 | BLOCK | timing `HARD_BLOCK`, late/missed move |
| 16:10 | BUY BREAKOUT | A / 4.75 | BLOCK | ACTIVE exhaustion 97%, old reward 0.36R |

Counts for setup candidates: `ALLOW=0`, `BLOCK=19`, `WAIT(final)=0`, broker/safety blocks `0`, no-setup scans `20`. Block frequencies: timing hard `6`, SmartGuard `4`, grade threshold `3`, news-observing `2`, B-quality `1`, timing soft `1`, HTF context `1`, ACTIVE exhaustion `1`.

The old build emitted only one `FINAL_CAMPAIGN_DIRECTION_DECISION` and zero `[CAMPAIGN_ACTIVE_ENTRY_AUTHORITY]` records for 19 candidates. This proves ACTIVE was not the candidate authority: 18 candidates died in legacy analysis before final ACTIVE synthesis; the nineteenth reached ACTIVE and was correctly rejected at 97% exhaustion with only 0.36R estimated old-direction reward.

## Stuck state and missed movement findings

- One SELL reversal opportunity, `CAMPAIGN_REV_SELL_1784043300`, was created at 13:41. It never became entry-eligible. It repeatedly stayed 3.6–7.0 ATR away from the old slow-EMA value measure, so refusing to chase it was correct.
- `WAIT_FOR_PULLBACK` nevertheless had a real circular release bug: `valueReset` required `afterConsumedEntryBar`, making a fresh local reset impossible for an opportunity that had never entered.
- Longest continuous lifecycle latch: `TRANSITION_NEUTRAL` from 14:45 through 16:02 (77 minutes). It later oscillated between transition and opposite-confirmed without producing a location-valid reversal.
- Cross-bar reversal evidence was not remembered. Reclaim, retest, displacement, and persistence had to coexist in rolling instantaneous booleans; evidence visible on one bar vanished on later scans.
- Exhaustion could only decay when five continuation conditions were true together on one closed bar. This made genuine multi-bar impulse/base/retest stories unable to release the old direction gradually.

Outcome memory is ATR-based, not true campaign-R, because rejected candidates never reached invalidation-SL construction. Exact historical 0.3R/0.5R/1R claims are therefore impossible. Observable missed favorable excursions include:

- 12:59 SmartGuard BUY: +14.47 ATR maximum favorable, -1.47 ATR adverse. This was the clearest excessive block, though survival under the uncomputed structural campaign SL cannot be asserted.
- 15:45 BUY: +0.94 ATR favorable, -0.10 ATR adverse by its 15-minute checkpoint; it remained a post-sweep hard timing block.
- 15:55 BUY: +1.53 ATR favorable, 0.00 ATR adverse by ten minutes; the old news-observing gate prevented ACTIVE synthesis.
- 16:00 BUY: approximately +1.3 ATR before 16:10 after all timing/news checks passed; the legacy M30 context veto stopped it before ACTIVE. The new ACTIVE engine would still inspect the centralized exhaustion/reward state before allowing it.

## Root causes repaired

1. **ACTIVE authority was too late.** SmartGuard, B-quality, grade, post-news interpretation, and HTF context could independently veto before the campaign authority.
2. **No coherent candidate decision.** Normal continuation candidates could be forced through reversal-style confirmation requirements.
3. **Circular wait release.** An unconsumed reversal opportunity could not establish `VALUE_RESET`.
4. **Single-bar evidence conjunction.** Reversal and continuation-reset evidence did not accumulate across distinct closed bars.
5. **Exhaustion ratchet could stick.** It rose immediately but released only on a brittle same-bar package.
6. **Observability hid the audit fields.** Lifecycle logs omitted exhaustion, location, consumed percentage, reward, and opportunity state.

## Exact repair behavior

- Added one `XAU_ActiveIntelligenceDecision` weighted synthesis with outcomes `TRADE_NOW`, `WAIT_FOR_VALUE`, `BLOCK_OLD_DIRECTION`, `CANCEL_OPPORTUNITY`, `HOLD_EXISTING`, and `EXIT_DAMAGED_THESIS`.
- Broker/account/risk/spread/calendar-news and hard structural location/late-chase failures remain hard-fail.
- Proven legacy analytical vetoes now become evidence in ACTIVE, not independent authorities. They retain their original behavior in OFF/SHADOW.
- Healthy continuation and mature-reset continuation use different thresholds; normal continuations do not need reversal evidence.
- Mature continuation requires fresh continuation/value-reset proof, usable timing, and reward. Old direction remains invariant-blocked at 70%+ exhaustion.
- Continuation-reset evidence accumulates over at least two closed M5 bars and exhaustion releases only 12 points per proven step.
- Reversal evidence stores reclaim, retest, displacement, persistence, event times, evidence-bar count, and contradiction count. It decays when absent and cancels only after bounded contradictory market proof.
- `WAIT_FOR_PULLBACK` can release from a compact local base/structural reset after opportunity creation even when there was no prior entry. Consumed opportunities can also reset after fresh structure.
- Persistent state schema moved from 2 to 3 and stores evidence/reset state under the existing account/server/symbol/magic/experiment GlobalVariable prefix.
- Lifecycle and ACTIVE-decision logs now include the exact audit dimensions missing from the incident build.

## Verification

- MetaEditor compile: `0 errors, 0 warnings`.
- v6.22 experiment suite: `218 passed`.
- New ACTIVE scenarios cover all 15 required market cases plus source authority invariants.
- Full repository current run: `974 passed, 208 failed`; baseline at 58c94a6: `958 passed, 208 failed`. All 208 failures are pre-existing release-history/production-mirror assertions that intentionally conflict with isolated-experiment scope. No new full-suite failure was introduced.
- Scenario allow-rate after repair: 4 of 6 intentionally mixed healthy-session cases allow; the two late/low-reward cases wait. This is scenario-tested, not a claim of live profitability or a replay of missing historical indicator state.
- No Strategy Tester historical backtest was available for this repair. Live behavior of the new build remains unproven until the owner reloads the newly installed experimental EA and new Journal records accumulate.

## Build identity

- Build: `v6220-active-intelligence-repair-20260714`
- Source SHA-256 and binary SHA-256 are recorded in the delivery commit/deployment evidence.
