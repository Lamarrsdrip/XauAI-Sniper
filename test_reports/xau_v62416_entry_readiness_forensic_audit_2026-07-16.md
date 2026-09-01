# XAU AI Sniper v6.24.16 — Entry Readiness forensic audit

## Finding and correction

The repeated scans were primarily `OnTick()`'s entry scan: a completed scan is normally M5-bar-cadenced, with a watchdog/timer release pass. The defect was real: the primary caller cleared `g_alignedCandidates[0].firstCandidateTime` unconditionally after `OpenTrade()` returned false. The first readiness observation must return false by design, so a stable confirmed candidate was recreated and forced through another 120–180 second delay indefinitely.

The correction preserves the matured aligned candidate only while `OpenTrade()` was blocked by a live, non-ready Entry Readiness candidate. It schedules a five-second live recheck without changing the timer origin. A fill, terminal invalidation, or any post-readiness execution failure keeps the prior clear-on-attempt behavior, so the change cannot create broker order spam.

Classification: `CANDIDATE_RESET` (with visible repeated output amplified by the timer-forced scan loop), not normal reevaluation.

## Live call path

`OnTick` (M5/new-bar, watchdog, or due recheck) → `ScoreSetups` → `XAU_CaptureDecisionSnapshot` → `XAU_FreshnessExtensionAuthority` (creates aligned candidate) → `XAU_TimingAuthorityAllows` → `XAU_SmartEntryCautionGate` → `XAU_FinalEntryArbiter` → pre-order `XAU_ComputeMarketThesis` → `OpenTrade` → `XAU_UpdateEntryReadiness` → execution safety gates → `trade.Buy` / `trade.Sell` → `ResultRetcode`.

The source locations are [entry scan](../XAUUSD_AI_Sniper_EA_v6.24.16.mq5:15182), [timing authority](../XAUUSD_AI_Sniper_EA_v6.24.16.mq5:29432), [readiness update](../XAUUSD_AI_Sniper_EA_v6.24.16.mq5:5297), [readiness gate in OpenTrade](../XAUUSD_AI_Sniper_EA_v6.24.16.mq5:16601), and [broker boundary](../XAUUSD_AI_Sniper_EA_v6.24.16.mq5:17536).

## State transitions

`HARD_BLOCK` → `INVALIDATED`; live healthy/mature opposite campaign → `OLD_SIDE_ACTIVE`; exhausted opposite with non-core thesis → `WAIT_FOR_EXHAUSTION`; late/extreme location (or late/failed timing) → `WAIT_FOR_LOCATION`; balanced/opposing pressure → `WAIT_FOR_PRESSURE`; opposing structure → `WAIT_FOR_STRUCTURE`; reclaim/pullback timing waits → `WAIT_FOR_RECLAIM` / `WAIT_FOR_RETEST`; confirmation/stale timing → `FORMING`; `ALLOW_CORE && TIMING_READY` → `CONFIRMED`; a second stable observation of the same candidate → `ENTRY_READY`; `remainingRewardR < 0.3` → `EXPIRED`.

`BIAS_ONLY` is the candidate's initial display state. `WAIT_FOR_*` progress is persistent. `ENTRY_READY` is a readiness state, then `OpenTrade()` still performs only operational safety: cross-instance lock, cooldown, same-direction exhaustion ban, hedge/position/exposure, valid price/ATR/stops/lot, aggregate risk, margin, broker volume and broker response.

## Identity, timing, and opposite side

The coarse thesis fingerprint remains `regime|setup|direction`; the actual candidate ID adds the aligned origin time and generation. This preserves progress across RSI/Stochastic bucket changes while separating a genuinely new aligned origin/generation. Invalidation, expiry, changed setup/direction, and the one-hour safety expiry create terminal/new lifecycle events.

`XAU_OppositeSideStatus()` is correctly separate from pressure/structure: it reports a real open, non-invalidated opposing campaign only. No opposing campaign is not treated as proof of favourable live pressure; the thesis still evaluates pressure, structure, reclaim and retest.

The normal scan is closed-M5 based. Once the 120–180 second delay has matured, the corrected five-second recheck is bounded live confirmation; it does not restart or wait for another full M5 candle. No price/R-room measurement was possible without a Strategy Tester data run.

## Observability

Added lifecycle events: `CANDIDATE_CREATED`, `CANDIDATE_REOBSERVED` (shadow), `CANDIDATE_STATE_CHANGED`, `CANDIDATE_INVALIDATED`, `CANDIDATE_EXPIRED`, `CANDIDATE_REPLACED`, `CANDIDATE_ENTRY_READY`, and `CANDIDATE_TRADED`.

Added timer events: `ENTRY_TIMER_STARTED`, `ENTRY_TIMER_COMPLETED`, `ENTRY_TIMER_REUSED`, and `ENTRY_TIMER_RESTARTED` (only for changed direction/setup identity). `ENTRY_READY_BLOCKED` is emitted by the common execution funnel for every later block. The command-center block renders `POSITION_ACTIVE` after a fill. `InpEntryReadinessShadowTrace` enables compact per-candidate chronology. `READINESS_STUCK_DIAGNOSTIC` is diagnostic only and never bypasses a gate.

## Validation

- Focused audit + liveness tests: 36 passed.
- Controlled deterministic tests cover BUY and SELL first-confirmed/second-confirmed broker boundary, wait→confirm, weaken→confirm, invalidation/new origin, and one broker rejection attempt.
- Full Python suite: blocked during collection by pre-existing environment requirements: `/app/frontend/.env` absent and `pydantic` unavailable for `backend/market_outlook.py`.
- MetaEditor: not available in this workspace. No new compile claim is made; a Strategy Tester replay and MetaEditor compile are required before production promotion.

## Restart reconciliation

`XAU_ReconcileCampaignOnInit()` already reconstructs active counts/additions from live magic+symbol positions and avoids clobbering an already tracked campaign. It cannot reconstruct unknown historical movement/exhaustion without persisted state; its conservative fallback is appropriate. This audit did not alter campaign, cooldown, exhaustion, exit, Counter-Excursion, or pyramid rules.
