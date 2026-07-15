# XauAI Sniper — Release Checklist

Use this checklist before calling any version "released."
A release is NOT complete until every line is checked.

**PERMANENT ITEM — added 2026-07-07 after a real incident:** update the top-of-file header banner
(`v6.14.0 - 24H Runner Quality...` line) in `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` on EVERY
release, not just `#property version`/`XAUAI_EA_VERSION`. `backend/server.py`'s `_get_ea_meta()`
regex-parses the first 3000 chars of this file for `vX.Y.Z --- <edition>` to drive the live
website's displayed version/edition/filename/ZIP name — five straight releases (v6.15.0-v6.17.2)
updated the defines correctly but left this banner stale, so the live site kept showing v6.14.0
regardless of any EA change underneath. Same rule applies to `backend/ea_code_xauindex/XauIndex_EA.mq5`.
Keep the edition description on a single physical line — the regex does not match across line breaks.

---

## v6.24.1 — 2026-07-15 — 15% Risk Margin Fix

### Proven production gap repaired
- [x] Owner report: every valid trade reached `OpenTrade()` and was then blocked at the margin gate (`FULL_RISK_BINARY_BLOCK`/`MARGIN_BELOW_FULL_RISK`) — example: BUY candidate, full-risk lot 0.56, required margin ~$2,262, free margin ~$3,016 (well within broker capacity), blocked anyway because required margin exceeded an arbitrary "50% of free margin" ceiling
- [x] Root cause traced to exact code: `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, the margin-check block inside `OpenTrade()` (previously ~line 18406) — `if(marginNeeded > freeMargin * 0.5)` had no relationship to actual broker margin capacity, real risk (`InpNormalRiskPct`=15%), or SL distance
- [x] `InpNormalRiskPct`=15% stop-risk sizing itself (`riskAmount = balance * riskPct / 100`, `rawLots = riskAmount / slDollarPerLotRaw`) was already correct and untouched — only the downstream margin veto was wrong
- [x] 50%-of-free-margin ceiling removed. Margin gate now verifies real broker margin via `OrderCalcMargin()` against free margin minus a small `InpMarginReservePct` buffer (default 10%, not 50%)
- [x] If the 15%-risk lot doesn't fit, the EA computes and logs the true maximum broker-margin-supported lot (requested lot, max lot, actual risk% at that max lot) and blocks transparently with `INSUFFICIENT_BROKER_MARGIN` — never a silent reduction to 0.01 — unless the new `InpMarginFallbackReduceToMax` input (default `false`) is explicitly enabled
- [x] Genuine protections preserved untouched: `OrderCalcMargin` failure, broker max/min lot, lot step, InpMaxLots, equity-% cap, aggregate-risk cap, invalid SL/TP, prop-firm cap
- [x] New `RISK_MARGIN_TRACE` log line on every approved trade: balance, equity, risk%, risk USD, SL distance, money-loss-per-lot-at-SL, raw lot, normalized lot, required margin, free margin, margin reserve, final lot, decision

### Identity and validation
- [x] Canonical source: `XAUUSD_AI_Sniper_EA_v6.24.1.mq5`
- [x] Build marker: `v6241-15-percent-risk-margin-fix-20260715`
- [x] MetaEditor compile: **0 errors, 0 warnings**
- [x] New regression tests: `tests/test_xau_v6241_15pct_risk_margin_fix_static.py`
- [x] Full-suite regression check: 217 pre-existing failures before and after (baseline captured pre-change), zero new regressions from this change

---

## v6.23.3 — 2026-07-15 — Trend Continuation Health Reasoning

### Proven production gap repaired
- [x] Forensic audit of the live VPS session (v6.23.2, 18:48 7/14 → 06:07 7/15, spanning the 4000→4100→4030 move) found 42 grade-A/A+/B trend candidates, 0 primary trend trades, 100% of executed trades were Counter-Excursion consolation trades
- [x] Root cause traced to exact code: `failedImpulseBlock` treated "no rejection wick" as equivalent to "impulse failed" — a HARD_BLOCK with no override path, responsible for 14 of 42 blocked candidates (33%)
- [x] `failedImpulseBlock` replaced with a 5-tier continuation-health score (`FAILED_IMPULSE`/`WEAK_CONTINUATION`/`NEUTRAL`/`HEALTHY_CONTINUATION`/`VERY_STRONG_CONTINUATION`), reusing the already-proven `XAU_TrendContinuationScore`/`XAU_EstimatedContinuationRoomATR` weighting instead of new unvalidated logic
- [x] Only `FAILED_IMPULSE` tier can still hard-block, and only when room/location/divergence anti-chase gates also hold — every other pre-existing anti-chase/exhaustion/late-chase gate is untouched
- [x] Diagnostic line added (`CONTINUATION_HEALTH: tier=... score=... override=...`) for every future audit

### Identity and validation
- [x] Canonical source: `XAUUSD_AI_Sniper_EA_v6.23.3.mq5`
- [x] Build marker: `v6233-continuation-health-reasoning-20260715`
- [x] Production ACTIVE preset: `config/XAUUSD_AI_Sniper_EA_v6.23.3_ACTIVE.set`
- [x] MetaEditor compile: **0 errors, 0 warnings**
- [x] Focused suite: 91/91 (5 new tests for this fix)
- [x] Full-suite regression check: identical 208 pre-existing failures, zero new regressions
- [x] Replay validation against the real 14 blocked log lines (4 distinct candidates) before deploying: 1 genuine missed winner (price +1.00 ATR in its favor) correctly rescued; 3 re-checks of a regime-misaligned signal (price moved −0.15 to −2.52 against it) correctly still blocked
- [x] Exact EX5 installed on VPS, ACTIVE startup assertion verified (`build=v6233-continuation-health-reasoning-20260715`)
- [x] Commit pushed to the production audit branch

---

## v6.23.2 — 2026-07-14 — Production ACTIVE Intelligence Hardening

### Proven production gaps repaired
- [x] v6.22.0 experiment excluded from source, preset, tests, deployment, and commit scope
- [x] Reclaim, retest, and displacement accumulate across a bounded sequence of closed M5 bars
- [x] One wick or one evidence category still cannot authorize reversal
- [x] Recent M5 base is the primary reversal-value anchor; slow EMA is blended only while locally relevant
- [x] WAIT/consumed opportunities release only through ATR pullback or proven structure/base reset
- [x] Stale or contradicted reversal opportunities expire without clearing directional exhaustion
- [x] Same opportunity owns one timer even if its setup label changes
- [x] Manual closure clears same-direction pending, timing, and recovery state and consumes the opportunity
- [x] Generic per-tick final-assertion spam replaced with candidate-grain decision audit
- [x] Exact final pre-send assertion covers normal, pyramid, and isolated Counter sends

### Identity and validation
- [x] Canonical source: `XAUUSD_AI_Sniper_EA_v6.23.2.mq5`
- [x] Build marker: `v6232-production-active-intelligence-20260714`
- [x] Production ACTIVE preset: `config/XAUUSD_AI_Sniper_EA_v6.23.2_ACTIVE.set`
- [x] Exact-source MetaEditor compile: **0 errors, 0 warnings**
- [x] Thirty mandatory v6.23.2 production ACTIVE gates plus focused compatibility tests pass
- [x] Redacted candidate-grain audit produced from VPS data with repeated tick assertions deduplicated
- [x] Full-suite comparison completed — identical 208 pre-existing failures before/after, zero new regressions
- [x] Exact EX5 installed on VPS and one ACTIVE startup assertion verified
- [x] Commit pushed to the production audit branch (`678b288`, fast-forwarded to `origin/main`)

### Post-deploy fix — recovery-timestamp elapsed value
- [x] Live VPS observation caught `INDICATOR_RECOVERY_STATUS`/`INDICATOR_RECOVERY_SUCCEEDED` printing a ~56-year `elapsed` value for `RSI_M5`
- [x] Traced: `g_recoveryStartedAt` stays 0 when `g_recoveryState` jumps straight to `RECOVERY_BACKOFF` without passing through `RebuildEntryIndicatorHandles()`
- [x] Confirmed log-only before fixing: field is read only inside `Print(...)`; the real backoff gate keys off `g_recoveryRetryAt`/`g_lastIndicatorRebuildAt`, unaffected
- [x] Fix: initialize `g_recoveryStartedAt` on direct entry to `RECOVERY_BACKOFF` if still `<= 0`
- [x] New source SHA-256: `2c76a0113e5ce7c7230aea8f2b9ec3e32b789d9f2a100d619f143e90e33c48e6`
- [x] New EX5 SHA-256: `ab92950a28ffff49d392d4e0641995d90efab9a7ce70f6f23f8a1b5297f92c34`
- [x] MetaEditor: 0 errors, 0 warnings
- [x] Regression tests added (`test_31`, `test_32`); focused suite 86/86; full-suite comparison re-run, still zero new regressions

---

## v6.23.1 — 2026-07-14 — Adaptive Transition + Entry-Location Authority

### Production identity and forensic baseline
- [x] Branch created from exact deployed-production commit `b894d171a76d5f0a12cbced95732cee9ebde8647`
- [x] VPS v6.23.0 EX5 hash matched that commit's binary exactly
- [x] One terminal, one attached production chart, hedging mode, `XAUUSDm,M5`; no duplicate trader found
- [x] v6.22.0 experiment remained isolated and unchanged
- [x] Exact incident reconstructed from broker history, Journal/Experts logs, Counter logs, timing proof, and R-exit telemetry

### Adaptive transition authority
- [x] OFF / SHADOW / ACTIVE input; production default ACTIVE after explicit owner authorization
- [x] Separate historical direction, trend health, maturity, continuation, exhaustion, transition, reversal, and remaining reward
- [x] 60–69% mature/selective behavior with pyramids stopped
- [x] 70% hard invariant blocks PRIMARY, RE_ENTRY, RECOVERY, RETRY, and PYRAMID in the exhausted direction
- [x] 80%+ compact reversal package can create a fresh opposite candidate before HTF crossover
- [x] One wick or exhaustion alone cannot reverse
- [x] High exhaustion persists across restart and cannot decay by elapsed bars
- [x] Only real continuation reset evidence decays exhaustion
- [x] Successful Counter outcomes feed bounded, time-decaying transition evidence
- [x] Existing-position actions are consumed inside the sole R-based broker-close owner
- [x] Dedicated 30-second default fast reversal confirmation retains closed-bar proof and anti-chase revalidation
- [x] Direction confidence and entry-location quality are separate final requirements
- [x] Reversal origin, first detection, reclaim, acceptable chase price, impulse peak, expected pullback, consumption, and opportunity ID persist across restart
- [x] Normal and Counter execution cannot reuse a consumed reversal impulse at a worse price without an evidence-based value reset
- [x] Old-direction remaining reward and opposite-direction obstacle reward are computed independently

### Artifacts and validation
- [x] Canonical source: `XAUUSD_AI_Sniper_EA_v6.23.1.mq5`
- [x] Source/download mirror byte-identical; SHA-256 `d136f57e822807ba16475f7d18c095b383128faf3e67aba8f69c0270b9e3408f`
- [x] MetaEditor exact-source compile: **0 errors, 0 warnings**
- [x] EX5: 1,390,538 bytes; SHA-256 `40ccc62dab9ea1449db8fa156df0a4105f47cfcef0d73500331337eef9b33979`
- [x] Transition/incident/location + identity/compatibility suite: 52 passed
- [x] Focused production/release suite: 133 passed
- [x] Full historical `tests/`: 208 failed, 838 passed versus pre-repair 208 failed, 813 passed; identical legacy failure-name set
- [x] Backend syntax compilation passed
- [~] Frontend build skipped because isolated worktree has no `frontend/node_modules`
- [~] Broader `backend/tests` collection blocked by pre-existing hardcoded `/app/frontend/.env` fixture dependency

### Production boundary
- [x] Pre-change VPS v6.23.1 SHADOW EX5/source/chart/Journal preserved under a timestamped rollback directory
- [x] ACTIVE retains healthy-trend permission below hard exhaustion; 60–69% is selective and 70%+ is the explicit old-direction hard block
- [x] Final pre-send assertion is immediately upstream of normal, re-entry/recovery/retry, pyramid, and isolated Counter broker sends
- [x] Compiled and deployed the ACTIVE build, patched the persisted chart input, and confirmed the startup assertion in Journal
- [~] Natural-market BLOCK was observed and enforced immediately; healthy ALLOW and reversal WAIT remain pending market-provided candidates. No manual test order was placed.

Full evidence: `audits/xau_v6231_transition_reversal_forensic_report_2026-07-14.md`.

---

## v6.23.0 — 2026-07-14 — Production Forensic Hardening

### Release identity and artifacts
- [x] Branch created from exact production baseline `02b08936275eb79892a3211dafe2cd18493a391f`: `audit/main-production-forensic-v6.23.0`
- [x] EA internal/header/property/build versions agree on `v6.23.0`
- [x] Canonical source: `XAUUSD_AI_Sniper_EA_v6.23.0.mq5`
- [x] Canonical source and backend download mirror are byte-identical: SHA-256 `20eb7570e7d3e413c9872cb97dfff505861641334e9b519a8cb3c93ea0424908`
- [x] Exact canonical source compiled in MetaEditor: **0 errors, 0 warnings** (`compile_logs/v6230_production_forensic_hardening.log`)
- [x] Compiled EX5: 1,343,460 bytes; SHA-256 `06a313171bd2766c18a02ee92e3a295e398686599ced6666fe7b51c6c2d33e03`
- [x] Backend metadata and customer-facing version/edition/download labels updated

### Release-blocking fixes
- [x] Normal entries are full configured risk or blocked: no broker-max, configured-max, equity-cap, aggregate-cap, prop-firm-cap, or margin-driven silent downsizing
- [x] Lot-step normalization is floor-only; the former upward-rounding tolerance is retired
- [x] Final pre-send invariant proves the requested normal risk was preserved and not exceeded
- [x] AI remains advisory and cannot shrink or block an already approved normal entry
- [x] Counter-excursion no longer blocks normal entry; its broker state and close lifecycle are independently reconciled
- [x] Counter close requests retain state/reason and retry until broker absence confirms closure
- [x] Independent counter execution fails closed on non-hedging accounts
- [x] FILE_COMMON learning/telemetry and terminal GlobalVariables are scoped by account, server, symbol, and normal magic
- [x] Startup, timing, sizing, and customer-facing logs corrected to match actual behavior

### Verification
- [x] Deterministic v6.23.0 sizing/timing/counter/R/state-isolation tests added
- [x] Current-release targeted suite: 102 passed
- [x] Release metadata suite: 7 passed
- [x] Corrected stale prop-firm/AI assertions: 2 passed
- [x] Backend Python syntax compilation passed
- [ ] Frontend production bundle could not be built from the repository as checked out: the isolated worktree has no installed dependencies, and the main worktree's dependency tree is incomplete/incompatible (`react-dom/client` unresolved); static release-label tests passed
- [x] Full historical suite: **208 failed, 789 passed** versus baseline **208 failed, 756 passed** — same failure count, 33 added passes, zero new implementation regressions; remaining failures are historical version-pin tests

### Production boundary
- [x] VPS `173.212.249.202` inspected read-only; no file, chart, terminal, or process changed
- [x] VPS currently remains on its existing v6.21.3 EA
- [x] Mac MT5 and its adaptive-trend experiment were not touched
- [x] **No deployment/attachment performed. Owner will install and attach manually.**

Full evidence and remaining limitations: `audits/xau_v6230_production_forensic_audit_2026-07-14.md`.

---

## v6.21.2 — 2026-07-12 — Wall-Clock Entry Timing + R-Exit Identity Hardening

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.21.2"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.21.2.mq5`
- [x] Top-of-file header banner updated (single physical line)
- [~] **COMPILE IN METAEDITOR — NOT independently re-verified for this exact filename.** MetaEditor/Wine hung reproducibly (3 attempts, both Z:\ and C:\ paths, ~0% CPU, never progressed) compiling the renamed file. The identical logic content (this release's code changes, prior to the final rename + 3 version-string edits) DID compile clean at 0 errors/0 warnings twice earlier in the same session (`compile_logs/` — mid-refactor checks). Only file name and version-literal strings changed since. Recommend a manual GUI compile before live deployment to close this gap.
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` byte-synced to canonical source
- [x] Frontend version/edition/filename strings updated (5 files)
- [x] `backend/server.py` `TradeMemoryRecord.ea_version` default updated
- [x] Static tests added/updated: `tests/test_xau_v6212_timing_and_identity_hardening_static.py` (29 tests) + 4 older release test files updated in place where they asserted now-intentionally-removed bar-wait behavior
- [x] Full existing suite re-run: 718 passed; remaining failures are pre-existing version-pin staleness (same set as baseline, confirmed via throwaway comparison worktree) — zero unexplained new regressions

### Owner request
Two-scope release-blocking repair: (1) complete the remaining R-Based Exit Manager identity/actual-fill/netting-risk/persistence/lifecycle items from the v6.21.1 audit; (2) remove every intentional 5-minute or next-M5-bar entry wait (fresh signal, re-entry, recovery, startup) and replace with one bounded 120-180s (default 150s) wall-clock delay. M5 remains the signal/analysis timeframe throughout.

### Timing changes
- `XAU_TimingEngineConfirmsEntry()`: removed the `InpUseM5EntryDelay=false` next-bar branch entirely (was: `nowCandle == firstSeenCandle + PeriodSeconds(PERIOD_M5)`, up to ~5 min). `false` now logs `ENTRY_TIMING_LEGACY_BAR_WAIT_REMOVED` and uses the same bounded wall-clock path as `true`.
- `XAU_EffectiveEntryDelaySeconds()` (renamed from `XAU_EffectiveM5EntryDelaySec`, old name kept as an alias): defaults changed 60/90/120s → 120/150/180s; now also clamps to an absolute [120,180] production floor/ceiling independent of `.set` misconfiguration.
- Startup: `InpStartupCooldownMin=5` (minutes) + `InpStartupRequireNewBar=true` → `InpStartupCooldownSeconds=150` wall-clock, no bar requirement (`InpStartupRequireNewBar` now inert).
- Recovery (`XAU_CheckPendingOpportunityRecovery`): call site un-gated from `if(newM5Bar)` to every tick; the actual wait-then-revalidate delay is provided once, downstream, by the shared timing engine (avoided a double-wait bug caught during implementation).
- Re-entry (`CheckReEntryOpportunity`): already routed through the shared timing engine — inherits the fix with no separate change needed.
- Manual force-open (`XAU_TryForceOpenTrade`): confirmed intentionally immediate (no timing-engine call), only a same-bar dedup guard — documented as such, not touched.
- No broker-retry loop exists for entry opens in this codebase (only for R-exit closes, already retry-safe) — "broker retry restarts the timer" is not a reachable bug here; noted rather than inventing new retry infrastructure.

### R-exit identity/persistence changes
- `XAU_RExitState` now separates `positionId` (canonical, `POSITION_IDENTIFIER`) from `currentTicket` (`POSITION_TICKET`, broker calls only); all lookups/restore/orphan-cleanup resolve live positions via `XAU_FindLivePositionByIdentifier()` (iteration), never `PositionSelectByTicket()` on a persisted/foreign value.
- Original-risk capture in `OpenTrade()`/`CheckPyramidOpportunity()` now reads ACTUAL broker-confirmed fields via `XAU_FindLivePositionByIdentifier()` post-fill, not the requested price/SL/lot locals; falls back to `R_EXIT_ENTRY_CAPTURE_PENDING` + next-tick core-loop capture if not yet selectable.
- Netting pyramids: new `cumulativeOriginalRiskUSD`/`totalOriginalVolume`/`addCount`, accumulated by `XAU_RExit_SyncNettingState()` on merge detection; this is now the R-math denominator everywhere (behaves identically to the old single-fill `originalRiskUSD` when `addCount==1`).
- `XAU_GrowthDailyLockTriggered`'s one `CloseAll()`-triggering call site gated observation-only while R owns positions (entry/pyramid-blocking call sites of the same function left untouched — different concern).
- Persistence: dirty-flag-gated saves (`g_rExitStateDirty`) instead of unconditional per-tick writes, forced flush on close request/confirm/OnDeinit, temp-file + atomic rename, malformed/schema-mismatched rows rejected on load.
- `OnTradeTransaction` cleanup now also fires on `DEAL_ENTRY_OUT_BY`, not just `DEAL_ENTRY_OUT`.
- Broker SL geometry buffer now includes `SYMBOL_TRADE_FREEZE_LEVEL`, not just stops level.

### Entry-regression proof
`ScoreSetups()`, `XAU_ComputeCombinedGradeForCandidate()` unchanged. `OpenTrade()`/`CheckPyramidOpportunity()` diffs are purely additive (post-fill R-capture hooks). No signal-generation, grading, lot-sizing, or entry-gating logic touched.

### Explicitly NOT built/touched in this release
Strategy Tester run (not available in this environment — static/compile verification only, see compile caveat above). `R_EXIT_ENTRY_CAPTURE_FAILED` log tag is defined structurally reachable-only-in-theory (capture always eventually succeeds via the core loop given the design) — noted rather than fabricated. No entry-strategy change beyond the required timing replacement.

---

## v6.21.1 — 2026-07-12 — R-Exit Forensic Hardening (release-blocking audit)

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.21.1"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.21.1.mq5`
- [x] Top-of-file header banner updated (single physical line)
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`compile_logs/v6211_r_exit_forensic_hardening_compile.log`)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` byte-synced to canonical source
- [x] `frontend/src/components/DownloadSection.jsx`, `Footer.jsx`, `cloud/CloudLanding.jsx`, `AdminPortal.jsx`, `FeaturesSection.jsx` version/edition/filename strings updated
- [x] `backend/server.py` `TradeMemoryRecord.ea_version` default updated
- [x] Static test added: `tests/test_xau_v6211_r_exit_forensic_hardening_static.py` (33 tests), plus `tests/test_xau_v6210_r_exit_manager_static.py` updated in place for the new architecture (31 tests) — 64 total, all passing
- [x] Full existing suite re-run: 746 passed, 120 pre-existing (unrelated version-pin-staleness) failures — byte-for-byte the same failing set as the pre-change baseline, confirmed via a throwaway comparison worktree at commit 895fc5b

### Owner request
Release-blocking forensic audit, repair, compilation, and validation of the v6.21.0 R-Based Exit
Manager: prove the whole bot is internally consistent, no systems fight each other, no hidden
bypasses, and the exit system works correctly in every runtime state (indicator warm-up/failure,
broker rejection, restart, every close cause). Explicitly must not touch the entry strategy.

### Bugs found and fixed (release-blocking)
1. **[Critical] R-manager stopped running during indicator warm-up.** `ManagePositions()` has
   early returns when `bufATR`/`bufRSI`/`bufEMAFast`/`bufEMASlow` aren't ready; the R-manager call
   lived inside that same function, so core protection/giveback/1R-close silently never ran until
   indicators warmed up. Fix: extracted `XAU_RExitCoreLoop()`, called unconditionally from
   `OnTick()` before `ManagePositions()`/`ManageBasket()`; only the 0.5R continuation *decision*
   still depends on indicators, and even then falls back to closing at 0.5R
   (`R_EXIT_INDICATORS_UNAVAILABLE` / `R_EXIT_05R_FALLBACK`) rather than stalling.
2. **[Critical] A rejected/incomplete close silently vanished.** The old code called
   `SafePositionClose()` once per decision with no retry state; a broker rejection meant the close
   reason was lost and the ticket fell through to ordinary management next tick. Fix: added a
   persistent per-ticket close-state machine (`R_CLOSE_NONE/HOLD_TO_1R/REQUESTED/PENDING_RETRY/
   CONFIRMED`) via `XAU_RExit_RequestClose()` — preserves the reason across retries, throttles
   repeat attempts (3s), only clears state once `PositionSelectByTicket()` confirms the position is
   actually gone, and gives any pending close top priority over all other decisions.
3. **[High] Daily Profit Lock could modify SL on R-owned tickets** with unrelated ATR-based logic
   (own `OnTick()` call site, filtered only by magic number, no R-ownership check). Fix: gated
   behind `!XAU_RExitOwnsNormalPositions()`; observes and logs instead while R owns positions.
4. **[Medium] ExpectancyDayGivebackGuard could basket-close R-owned positions.** Confirmed via
   code read to be ordinary daily-profit preservation (a `CloseAll()`), not a true account-survival
   emergency. Fix: gated behind R-ownership, observation-only log added.
5. **[Medium] Inconsistent ownership conditions across call sites** (`InpRExitEnable` alone in some
   places, `InpRExitEnable && g_rExitConfigValid` in others) was itself a latent hybrid-ownership
   bug. Fix: single `XAU_RExitOwnsNormalPositions()` helper used at every deferral site.
6. **[Medium] R state did not survive a restart**, and any position still open across a restart
   permanently lost its stage/peak/pending-close. Fix: file-based persistence
   (`XAU_RExit_SaveState()`/`XAU_RExit_LoadPersistedState()`), keyed by account login + broker
   server + symbol + magic in the filename, validated against the live position's ticket and
   direction before being applied; a stale/foreign/mismatched record is discarded and logged
   (`R_EXIT_STATE_MISMATCH`), never silently trusted.
7. **[Medium] No unified cleanup lifecycle.** A position closed by anything other than the
   R-manager itself (broker SL, manual, remote, weekend, equity, prop-firm) left orphaned state.
   Fix: `OnTradeTransaction()` now clears R state on every full close regardless of cause, with a
   periodic `XAU_RExit_ReconcileOrphans()` safety net and a `finalTelemetryLogged` dedup guard.
8. **[Medium] Original risk was captured lazily** on the first `ManagePositions()` tick after
   entry rather than immediately on fill. Fix: capture hooked directly into `OpenTrade()`'s and
   `CheckPyramidOpportunity()`'s post-fill success blocks (same established pattern as the
   pre-existing `TTM_RecordEntry`/Cloud-signal hooks) — purely additive, proven via body-diff
   against the pre-change source.
9. **[Low] RUN_TO_1R held blind until 1R or a full reversal.** Fix: added a closed-bar-only
   (never single-tick) continuation-failure recheck; closes on confirmed structure break or a
   configurable hostile-factor majority, reason `R_EXIT_RUNNER_CONTINUATION_FAILED`.

### Exit conflict matrix (see full report for all systems)
Every profit-taking/SL-modifying authority found in the v6.21.0 audit remains **DISABLED WHILE R
MANAGER OWNS POSITION** as before, now via the single `XAU_RExitOwnsNormalPositions()` helper
instead of ad-hoc per-site conditions. Daily Profit Lock and ExpectancyDayGivebackGuard are newly
added to that classification (previously unaudited). Broker SL/TP, margin stop-out, weekend/
prop-firm/equity/weekly-target closes, and remote force-close remain **ACCOUNT EMERGENCY
OVERRIDE**/**BROKER-LEVEL SAFETY**, untouched.

### Entry-regression proof
`ScoreSetups()`, `XAU_ComputeCombinedGradeForCandidate()`, `CheckReEntryOpportunity()` bodies are
byte-identical to the pre-R-exit baseline (50ba04e). `OpenTrade()` and `CheckPyramidOpportunity()`
diffs (vs. that same baseline) are purely additive post-fill capture hooks — verified via
line-by-line unified diff, not just a function-existence check. `InpNormalRiskPct`/
`InpMaxOpenTrades` declaration lines unchanged.

### Independent audit
Self-verified during implementation against every requirement in the owner's audit spec: indicator
independence, retry-safe closes, Daily Profit Lock / Expectancy Guard conflicts, ownership-helper
consistency, restart persistence with validation, full cleanup lifecycle, immediate risk capture,
stage priority ordering, RUN_TO_1R reevaluation, geometry/math/symbol-suffix/spread-unit checks,
Counter-Excursion isolation (confirmed pre-existing and adequate), and the entry-regression diff.

### Explicitly NOT built/touched in this release
No partial closes. No extension beyond 1R. No changes to signal generation, grading, lot sizing,
gating, re-entry qualification, pyramid qualification, spread/margin entry checks, or broker-safety
checks. RELEASE_CHECKLIST.md's own historical gap (entries between v6.20.1 and v6.20.6 were never
backfilled) was not addressed — out of scope for this release.

---

## v6.21.0 — 2026-07-12 — R-Based Exit Manager (forensic exit-system redesign)

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.21.0"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.21.0.mq5`
- [x] Top-of-file header banner updated (single physical line)
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`compile_logs/v6210_r_exit_manager_compile.log`)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` byte-synced to canonical source
- [x] `frontend/src/components/DownloadSection.jsx`, `Footer.jsx`, `cloud/CloudLanding.jsx`, `AdminPortal.jsx`, `FeaturesSection.jsx` version/edition/filename strings updated
- [x] `backend/server.py` `TradeMemoryRecord.ea_version` default updated
- [x] Static test added: `tests/test_xau_v6210_r_exit_manager_static.py` (30 tests, all passing)
- [x] Full existing suite re-run: 712 passed, 120 pre-existing (unrelated, version-pin-staleness) failures identical to the pre-change baseline — zero new regressions

### Owner request
Full forensic redesign of the normal bot's EXIT system only, per explicit spec: replace the stack
of competing discretionary profit-exit systems with one centralized, R-normalized exit manager.
1R fixed at entry (original SL distance × symbol/volume value via the existing `RiskPerLotForDistance`
helper), never recomputed from a later, moved stop. Stages: hold below 0.3R; arm ~0.15R protection
at 0.3R; close ~0.5R on weak continuation or hold toward 1R (locking ~0.35-0.40R) on strong
continuation; hard close at 1R; close on 45% peak giveback once armed. Explicitly must NOT touch
signal generation, grading, lot sizing, gating, re-entry, or pyramid qualification.

### Architecture found / conflicts found
Sixteen independently active discretionary profit-exit authorities were found competing over the
same tickets: `XAU_SmartExit3Layer`, `XAU_ProtectPeakProfitFloor`, the A+ Profit Shield block, AMPL,
three Clean-Exit trail/partial systems, `PG_PerPositionRatchet` (independent `OnTick()` call site,
bypasses `SafeModifySL` via raw `OrderSend`), the AI proactive-exit auditor, `EPF_ManagePartials`,
Recovery-Expansion, TTM, TRI, and basket-level soft-lock/lifecycle closes (`ManageBasket()` runs
*before* `ManagePositions()` and short-circuits it entirely on a basket-level decision). None shared
state — three independent "already partialed" trackers existed. "1R" was not a stable concept
anywhere: it was recomputed live from whatever the *current* SL happened to be, which several of
these systems were simultaneously ratcheting.

### New authority
`XAU_ManageRBasedExit()` (new, in the .mq5 immediately before `ManagePositions()`) is inserted as the
very first action per ticket inside `ManagePositions()`'s loop — before the AI block, before TTM,
before Clean Exits — and `continue`s unconditionally when `InpRExitEnable` is true (default), so
nothing downstream in that loop runs for the ticket that tick. `PG_PerPositionRatchet` and
`EPF_ManagePartials` (their independent `OnTick()` call sites) are wrapped with
`if(!InpRExitEnable)`. `ManageBasket()` gets a one-line internal early-return
(`if(InpRExitEnable) return false;`) placed *after* its flat-state-reset housekeeping but *before*
any peak-arm/giveback decision, so basket bookkeeping still runs but discretionary basket profit
exits do not. True emergency/account-safety paths (broker SL/margin stop-out, `WEEKEND_CLOSE`,
`PROP_FIRM_LOSS_LOCK`, `EQUITY_PROTECT`, `WEEKLY_TARGET_HIT`, remote force-close/close-all) are
separate, unconditional `OnTick()`-level `CloseAll()`/`SafePositionClose()` calls entirely outside
`ManagePositions()`/`ManageBasket()` and were not touched.

Per-ticket state (`struct XAU_RExitState`, dynamic array `g_rExit[]`, keyed strictly by ticket —
same established pattern as the existing `peakTickets[]/peakProfits[]`) captures `originalEntryPrice`
from `POSITION_PRICE_OPEN` (broker-immutable) and `originalStopLoss`/`originalStopDistance`/
`originalRiskUSD` from the SL in place the first tick the manager observes the ticket — no hook into
`OpenTrade()` or `CheckPyramidOpportunity()` was needed, since this manager is now the sole
SL-modifying authority. Positions already open at deploy time (or after a terminal restart, via the
new `XAU_ReconcileRExitOnInit()`, modeled on the existing `XAU_ReconcileTradeBrainOnInit()` pattern)
get a conservative first-observation estimate, explicitly tagged `reconciledFromRestart` and logged
— peak/trough are seeded from current profit only, never fabricated.

Continuation scoring at the 0.5R decision reuses signals already computed once per position, per
tick, in `ManagePositions()` (`momentumScoreEA`, `trendAlignedEA`, `emaAgainstEA`, `rsiAgainstEA`,
`structureConfirmedEA`, plus live spread) — no new indicator handles. Net current profit reuses the
established `posInfo.Profit() + posInfo.Swap() + posInfo.Commission()` idiom already used elsewhere
in `ManagePositions()`. Counterfactual instrumentation (MFE, MAE, R-at-exit, and profit snapshots at
first-crossing of 0.2/0.3/0.4/0.5/0.75/1.0R) is logged at every close (`R_EXIT_COUNTERFACTUAL`) but
is read by no live decision — the default 1R target is unchanged.

### Entry-regression proof
`OpenTrade()`, `CheckPyramidOpportunity()`, `CheckReEntryOpportunity()`, `ScoreSetups()`, and
`XAU_ComputeCombinedGradeForCandidate()` function bodies are byte-for-byte identical to v6.20.6
(verified via brace-matched extraction + direct string comparison, not just a visual diff).
`InpNormalRiskPct` and `InpMaxOpenTrades` declaration lines are unchanged.

### Independent audit
Self-verified during implementation: a `git diff --stat`-based grep audit confirmed every disabled
tag is either unreachable downstream of the new manager's `continue` or behind an
`if(!InpRExitEnable)`/`if(InpRExitEnable) return false;` guard, while every emergency `CloseAll()`
call site was grepped and confirmed to have no `InpRExitEnable` reference within 200 characters
(i.e., not accidentally wrapped).

### Explicitly NOT built/touched in this release
No partial closes (per spec, v1 is full-close only). No extension beyond 1R (counterfactual data is
collected but not acted on). No changes to entry timing, signal generation, grading, lot sizing, or
pyramid/re-entry qualification.

---

## v6.20.1 — 2026-07-09 — Delayed-Entry Outcome Telemetry

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.20.1"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.20.1.mq5`
- [x] Top-of-file header banner updated (single physical line)
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6201_final2.log`)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` byte-synced to canonical source
- [x] `frontend/src/components/DownloadSection.jsx` fallback version/edition/filename strings updated
- [x] `backend/server.py` `TradeMemoryRecord.ea_version` default updated
- [x] Static test added: `tests/test_xau_v6201_delayed_entry_outcome_telemetry_static.py` (13 tests, all passing)
- [x] **Independent audit performed** before shipping — found and fixed one real correctness bug plus one accuracy gap

### Owner request
"Do not change strategy again yet" — pure instrumentation to prove whether v6.20.0's M5 entry delay
is actually improving timing. For every delayed candidate that becomes a real trade: original signal
time/price, delayed entry time/price, delay seconds, price improvement/worsening, entry reason,
ticket. After close: actual MAE/MFE/P&L, whether the delayed entry improved on the original signal
price, an estimated instant-entry MAE/MFE using the original price, and a helped/hurt verdict. Add to
watchdog/report.

### Mechanism
One-shot "mailbox" (`XAU_LastEntryTimingDecision g_lastEntryTimingDecision`) written by
`XAU_TimingEngineConfirmsEntry()` immediately before each of its three `return true` paths (immediate/
A+-momentum, M5-delay-confirmed, legacy bar-based) — no entry/exit decision logic touched, confirmed
by independent audit. `OpenTrade()` consumes it into a new bounded, posId-keyed array
(`g_delayOutcome[]`, cap 60) right after its existing trade-open bookkeeping call. At close, the
existing close-handling block (already has posId, actual MAE, actual MFE, final P/L, and the real
lot size) calls a new `XAU_ReportDelayOutcome()`, which computes an estimated instant-entry
MAE/MFE/P&L by shifting the actual numbers by the dollar value of the price improvement, verdict
DELAY_HELPED/HURT/NEUTRAL/NO_DELAY. Logged per-trade via the same Print/PrintFormat pattern used
throughout this file (Command Center scrapes it same as every other decision line) and aggregated
into `XAU_WriteLearningReport()`'s new "Delayed-Entry Outcome" section.

### Independent audit — one real bug found and fixed, one accuracy gap closed
**Bug (High, telemetry correctness):** `XAU_TimingEngineConfirmsEntry()` has a second caller
(`CheckReEntryOpportunity`, the RE_ENTRY path) that can also set the mailbox — the first pass only
cleared it at the main-scan caller, leaving it dangling on every RE_ENTRY attempt. A later, unrelated
`OpenTrade()` call (from missed-signal recovery or manual force-open, neither of which sets this
mailbox itself) could have wrongly consumed the stale RE_ENTRY data, misattributing one trade's
original-signal/delay data to a completely different trade and corrupting the aggregate proof stats
this release exists to produce. Fixed: RE_ENTRY's caller now also unconditionally clears the mailbox
after its own `OpenTrade()` call, mirroring the main-scan caller exactly. Confirmed via `grep` that
these are the only two callers of `XAU_TimingEngineConfirmsEntry()` in the file.

**Accuracy gap (Low-Medium):** the dollar-shift estimate used a hardcoded `$100/lot` (100oz contract)
constant instead of `XAU_MoneyPerLotForDistance()`, the broker-aware `OrderCalcProfit`-based helper
already used elsewhere in this file for the same price-distance-to-dollars conversion. Fixed to reuse
it, so the estimate stays correct under any broker's actual contract size or account currency instead
of silently diverging from the file's own established precision.

### Explicitly NOT built in this release
No strategy changes, per explicit owner instruction. All v6.20.0/v6.19.x/v6.18.x work is unchanged.

---

## v6.20.0 — 2026-07-09 — M5 Entry Delay, Phase B

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.20.0"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.20.0.mq5`
- [x] Top-of-file header banner updated (single physical line)
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6200_final2.log`)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` byte-synced to canonical source
- [x] `frontend/src/components/DownloadSection.jsx` fallback version/edition/filename strings updated
- [x] `backend/server.py` `TradeMemoryRecord.ea_version` default updated
- [x] Static test added: `tests/test_xau_v6200_m5_entry_delay_static.py` (14 tests, all passing)
- [x] **Independent audit performed** before shipping — found and fixed one low-severity input-validation gap

### Owner request
Second half of "adaptive entry-and-exit learning system" (Phase A, exit memory, shipped as v6.19.0).
Explicit, detailed spec: keep M5 as the signal timeframe; do NOT wait for the next M5 bar; delay
EXECUTION only, 60-120 seconds inside the same candle; re-validate thesis/structure/spread/chase-risk
against current price before entering; integrate into the existing Timing Engine, do not build a
second one. Owner's live observation motivating this: trades rarely go to profit immediately —
typically 1-2 minutes of adverse movement first, which reverses before the next M5 candle, creating
avoidable 5-8% drawdown before profit.

### Mechanism
Extends `XAU_TimingEngineConfirmsEntry()` (unchanged authority, same `PendingEntryConfirmation`
struct, same `XAU_ClassifySetup` evidence) rather than forking a new timing system:
- `InpUseM5EntryDelay` (default true) switches the existing wait-state machine's gating condition
  from "has the next M5 bar started" (up to 5 minutes) to wall-clock elapsed time since first
  detection, clamped into `[InpM5EntryDelayMinSeconds=60, InpM5EntryDelayMaxSeconds=120]` via
  `InpM5EntryDelaySeconds=90`. When false, the original bar-based path runs unchanged — confirmed by
  independent audit to be decision-logic-identical to pre-v6.20.0 via a line-by-line diff.
- At delay-elapsed time, re-validates using evidence already freshly recomputed the same call: price
  overextension (reused pre-existing math, threshold now `InpCancelIfPriceMovedTooFarATR`, tagged
  `MISSED_TRADE` at ≥2.0 ATR per the owner's explicit "don't chase, mark as missed trade"
  instruction), structure flip (reuses `tcls.freshStructureBias`, already computed inside
  `XAU_ClassifySetup`), stale-evidence (`tcls.type==LATE_CHASE`), and spread (`XAU_SpreadState()`).
  None of these duplicate existing checks — same functions, same evidence, called once.
- `InpAllowImmediateAPlusMomentum` (default true) preserves today's clean-evidence immediate-entry
  bypass exactly for A+ grade; false routes even clean A+ evidence through the delay.
- No stale price: `OpenTrade()` already computes entry/SL/TP/lot from current market data at call
  time (confirmed by reading its body, not new behavior), and because the whole scan pipeline
  re-scores fresh every tick, the tick where the delay resolves calls `OpenTrade` with that tick's
  fresh signal/atr/grade — nothing cached from first detection reaches the order.
- Hard risk/margin/broker safety is not duplicated here — `OpenTrade()` enforces those unconditionally
  for every caller, unchanged.

### Independent audit — one bug found and fixed
`InpM5EntryDelayMinSeconds`/`MaxSeconds` clamp had no protection against being misconfigured swapped
(Min > Max) — would have silently pinned the delay to a fixed value regardless of
`InpM5EntryDelaySeconds`, with no warning. Fixed: new shared helper `XAU_EffectiveM5EntryDelaySec()`
normalizes bounds before clamping, also removing a duplicated inline expression. Two informational,
non-blocking notes from the audit: (1) the "same signal" identity check (setup name + direction) is
inherited unchanged from the pre-existing bar-based path, not a regression; (2) `g_pendingEntryConfirm.grade`/`.sizeMulti`
are written but never read (the real `OpenTrade()` call always uses the caller's fresh per-tick
values) — vestigial, no functional impact.

### Explicitly NOT built in this release
posId-correlated "did the delay improve the eventual trade outcome" and MAE-vs-baseline comparison —
needs new fields threaded through `TradeBrainOpen` and its several existing call sites, deliberately
left as a distinct follow-on rather than rushed into the same diff as the core execution-timing
mechanism. All v6.19.x/v6.18.x work is unchanged.

---

## v6.19.0 — 2026-07-09 — Adaptive Exit Memory, Phase A

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.19.0"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.19.0.mq5`
- [x] Top-of-file header banner updated (single physical line)
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6190_final4.log`)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` byte-synced to canonical source
- [x] `frontend/src/components/DownloadSection.jsx` fallback version/edition/filename strings updated
- [x] `backend/server.py` `TradeMemoryRecord.ea_version` default updated
- [x] Static test added: `tests/test_xau_v6190_adaptive_exit_memory_phase_a_static.py` (12 tests, all passing)
- [x] **Independent audit performed** (separate agent, no involvement in writing the change) before shipping — found and fixed one real bug (see below)

### Owner request
"Build an adaptive entry-and-exit learning system." Explicit process requirement: Phase A (exit)
implemented, audited, and tested BEFORE any Phase B (entry timing) work; Phase B must start
observation-only (collect evidence, do not let it alter entries yet). This release is Phase A only.

### Investigation before writing any code (per explicit instruction not to fork a new system)
Found the codebase already has two relevant pieces of live learning infrastructure:
- `XAUAI_ConsciousMemory_*.csv` (`XAU_QueryConsciousMemory`/`XAU_AppendConsciousMemory`) — aggregate
  setup+direction+grade stats, currently only feeds lot-size (`XAU_MemoryRecommendation`).
- `g_evExitLearningBias` — a post-close 5/10/15/30/60-minute price-tracking self-review
  (`XAU_EVPostCloseReview`/`XAU_UpdateClosedTradeOutcomes`, verdicts `EXIT_EARLY_LEFT_PROFIT`/
  `EXIT_GOOD_AVOIDED_REVERSAL`), already live inside `XAU_EvaluateExitEV`'s continuation/exhaustion
  probabilities — this is the real, already-working answer to "does the bot learn from its own exits."

Also found `g_memoryHoldBiasUntil` (a third, separate hold-bias signal) is **dead code** — gated
behind `AIBlocksClose()`, which returns `false` unconditionally at `XAU_AIIsAdvisoryOnly()` (correct,
deliberate v6.17.11 behavior: AI can never veto a trade) before ever reaching the memory check.
Computed every trade, never consulted. Left as-is, documented rather than revived — reviving it would
mean routing a real decision back through the AI-veto path this file deliberately closed.

### The actual gap and the fix
`g_evExitLearningBias` is **one global scalar** shared by every setup and direction — a SELL
TREND_PULLBACK that reliably reverses hard after peak and a BUY BREAKOUT that reliably keeps running
get averaged into the same number. Segmented the SAME mechanism (same verdicts, same step/cap
constants) by `(setup, direction)` via a new bounded array `g_exitBiasKeys[]` (cap 40, evicts oldest).
`XAU_GetExitLearningBias(setup, dir)` returns a key's own bias only once it has
`InpExitBiasMinSamples`(3) of its own same-key evidence (Part 4: never adapt on a thin sample) and
decays it linearly to 0 over `InpExitBiasDecayDays`(14) without a fresh same-key review (Part 4:
memory must decay); otherwise returns the existing global bias unchanged — cold start is today's live
behavior exactly, never worse or undefined. `XAU_EvaluateExitEV()` now takes this resolved value as a
parameter instead of reading the global directly. `XAU_EVPostCloseReview()` now also skips both the
global and keyed update during an active news window or HIGH/EXTREME spread (Part 4: don't learn from
abnormal conditions) — logs `SKIPPED_ABNORMAL_CONDITION` instead. `XAU_WriteLearningReport()` extended
with a per-key table.

### Independent audit — one bug found and fixed
Decay math (`ageDays = (TimeCurrent() - lastUpdate) / 86400`) had no floor at 0. A backward clock jump
(VPS NTP resync, broker server clock adjustment, snapshot restore) between a write and a later read
would make `ageDays` negative, pushing `decay` above 1.0 and letting the resolved bias momentarily
exceed `InpEVLearningBiasMax` — the one hard cap this mechanism is supposed to never break. Fixed:
`ageDays = MathMax(0.0, ...)`.

### Owner follow-up: "a real winner should never round-trip back to a loss"
Investigated rather than built blind: `XAU_SmartExit3Layer` (line ~4952, `InpSmartExitEnable=true` by
default) already provides this, unconditionally, not R-gated. Arms once peak reaches
`MathMax(InpSmartExitStrongProfitUSD=75, equity*InpSmartExitStrongProfitEquityPct%)` and moves the SL
via a ratcheted `SafeModifySL` call to lock `MathMax(InpSmartExitMinRetainUSD=35, peak*lockPct%)` of
profit. Given this release's own v6.18.0 change raised typical risk-per-trade to 9-15% of equity, a
$75 arm point now sits at roughly 0.17R for a typical trade — earlier in R-terms than before, not
later. No new mechanism built; this requirement is already satisfied by existing, live, default-on
code. (Independent audit separately found `XAU_ProtectPeakProfitFloor`, a *different* peak-floor
mechanism, is R-gated and becomes a structural no-op for wide-stop/high-risk trades specifically — not
a gap in the "never round-trip" guarantee, since `XAU_SmartExit3Layer` covers it unconditionally, but
worth knowing the two mechanisms aren't redundant with each other for that trade profile.)

### Explicitly NOT touched in this release
Entry timing (Phase B), SMART-GUARD/Personality recalibration, and all v6.18.x work are unchanged.

---

## v6.18.1 — 2026-07-09 — Growth Engine: Exit-Arm + Pyramid Margin Safety

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.18.1"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.18.1.mq5`
- [x] Top-of-file header banner updated (single physical line)
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6181_final2.log`)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` byte-synced to canonical source
- [x] `frontend/src/components/DownloadSection.jsx` fallback version/edition/filename strings updated
- [x] `backend/server.py` `TradeMemoryRecord.ea_version` default updated
- [x] Static test added: `tests/test_xau_v6181_exit_arm_pyramid_margin_static.py` (7 tests, all passing)

### Items 4 and 5 of the v6.18.0 forensic audit's phased plan

**Item 4 (exit-arm):** `XAU_ProtectPeakProfitFloor()`'s arm threshold used `InpProtectedPeakMinUSD *
AccountSizeRiskMultiplier()` — that multiplier was retired from lot sizing in v6.18.0 but was still
silently shaping this threshold via its old 0.75x–1.35x equity-tier steps. Replaced with
`MathMax(InpProtectedPeakMinUSD, balance * InpProtectedPeakEquityPct / 100)` — new input
`InpProtectedPeakEquityPct=2.5`, chosen to exactly reproduce the validated $75-at-$3k real-account
behavior (`audits/xau_growth_engine_forensic_audit_2026-05-15_to_2026-07-08.md` §2.4) while scaling
consistently at every other size. On investigation, the A+ Shield tiers (`InpAPlusShieldEquityPct`/
`InpAPlusShieldProtectEquityPct`) and the `InpAutoScale` legacy exit path turned out to already be
correctly account-relative — no change needed there; the original Phase 1 report's characterization
of them as broken/orphaned did not survive full reading of the code.

**Item 5 (pyramid):** Found and fixed a live, current gap while implementing this: `CheckPyramidOpportunity()`'s
add-sizing block skipped `EffectiveSingleRiskCapPct()`/`EffectiveAggregateRiskCapPct()` entirely
whenever `InpLotSizingMode == JUNE_16_19_BALANCE_MODE` — since that input still defaults to that
value, every pyramid add was bypassing both risk caps, unconditionally, live. This is the direct
mechanism behind the real 2026-06-17 loss cluster (posIds 57115047149/57115451390: ~112 lots across
3 legs on one BUY thesis, one 12.17-lot leg added at 4331.38 — below the base entries at
4343.10/4344.84, into an already-adverse move). Fix: risk caps now apply to every pyramid add, every
mode. Added a real-time **PYRAMID MARGIN PROJECTION** check (same 50%/80%-of-free-margin standard
`OpenTrade()` already uses) as the actual backstop against over-stacking, per Fable 5 risk-advisor
review (2026-07-09): a %-scaled add-count curve "cannot fix a size granularity problem." Also
replaced `EffectiveMaxPyramidAdds()`'s hard equity≥$25k/$50k cutoffs with a trend-evidence-only curve
(same math at every account size) — corrected on closer reading: the original cutoffs only granted
*extra* adds above the `InpMaxPyramidAdds=3` base, not a hard cap-at-1 as the Phase 1 report implied.

**Also fixed:** `GROWTH_HARD_LOSS_CAP_JUNE_ADJUST` (an exit-side compensator) was gated on
`InpLotSizingMode==JUNE_16_19_BALANCE_MODE`; since lot sizing is always real-SL-risk-derived now, made
it unconditional instead of silently not applying to half of live traffic.

**Documentation only, no behavior change:** added ROLE NOTE comments to `XAU_ClassifySetup`,
`XAU_TimingEngineConfirmsEntry`, and `XAUEntryTimingGuard` — investigation (item 2 of the phased plan)
found these are three distinct, non-overlapping authorities (setup/evidence classification,
confirmation timing, anti-chase/location quality), not duplicates as the original Phase 1 report's
quick read suggested. No merge performed.

**Explicitly skipped (item 3):** SMART-GUARD/Personality-mismatch recalibration. Owner direction
2026-07-09: no change without a fresh current-version live audit. The 43-47% would-have-won-if-
flipped evidence backing "loosen these" predates several relevant fixes (symmetric opposite-direction
recheck, soft-bypass-on-strong-context, inactivity relax), all already live in the current file.

---

## v6.18.0 — 2026-07-09 — Growth Engine: Unified Account-Relative Sizing

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.18.0"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.18.0.mq5`
- [x] Top-of-file header banner updated (single physical line, regex-verified against `backend/server.py::_get_ea_meta()`)
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6180_final.log`)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` byte-synced to canonical source
- [x] `frontend/src/components/DownloadSection.jsx` fallback version/edition/filename strings updated
- [x] `backend/server.py` `TradeMemoryRecord.ea_version` default updated
- [x] Static test added: `tests/test_xau_v6180_growth_engine_sizing_static.py` (7 tests, all passing)

### Forensic basis
Owner-directed audit (`audits/xau_growth_engine_forensic_audit_2026-05-15_to_2026-07-08.md`) of the
real May19–June17 growth run: verified trade log shows $100k starting balance, +$351,118 net by
2026-06-15 (74% win rate, PF 3.07, 92.8% of profit from TREND_PULLBACK), ending in a real loss
cluster on 2026-06-17 before the owner switched to a separate account. A follow-up lot-sizing audit
found the live default (`InpLotSizingMode = JUNE_16_19_BALANCE_MODE`) silently overrode every risk-%
cap the codebase computes and displays, forcing 12.5–30% risk per trade depending on account size —
while `InpMaxRiskPctEquity` (5%) and `InpMaxAggregateRiskPct` (8%) claimed to be the limit and were
never actually consulted for the live path. Two systems disagreeing about the true ceiling.

### Root cause and fix
One entry-sizing authority replaces the two that disagreed:
- `InpNormalRiskPct = 15.0` — uniform target risk-per-trade across every account size (owner
  direction 2026-07-09: "cap all acc to start from 15%", matching the ~15.5% average risk/trade
  already observed in the real growth-run data).
- `InpReducedRiskFloorPct = 9.0` — hard floor (60% of normal) for legitimate evidence-based risk
  reduction (weaker grade, thin AI/memory/volatility evidence). A qualified trade can no longer
  collapse below this floor no matter how many soft multipliers stack — enforced by a final clamp
  applied *after* every legacy multiplier (Asia session, volatility-adaptive, prop-firm, large-
  account floor), not just at the top of the sizing function.
- `InpMaxRiskPctEquity` raised 5.0 → 15.0, `InpMaxAggregateRiskPct` raised 8.0 → 35.0, so the hard
  backstops agree with the new target instead of silently contradicting it.
- `JUNE_16_19_BALANCE_MODE` / `REAL_RISK_MODE` branch retired — both converge on one real-SL-risk
  formula. The enum/input stay declared for display/back-compat only.
- The old v6.17.17 unconditional account-size lot-floor override (`acctFloorLot`, applied as "the
  LAST step... regardless of which upstream reducer shrank the lot") is retired — it was the
  two-systems-fighting bug this release closes. The unified risk-% system reproduces the same
  nominal lot sizes (~0.10 at $1k, ~0.25 at $3k, ~0.50 at $6-8k) organically at realistic SL
  distances, without a post-hoc override fighting the risk cap.
- `XAU_GrowthGuardCapLots()` no longer runs at entry time — it shared its 1.5%/2.0% inputs with the
  in-trade defensive "thesis broken, cut the loss" exit logic (untouched, correct at that smaller
  value for *that* purpose). Conflating the two meant it would have silently re-clamped every trade
  back to ~1.5% the moment the June-mode bypass was removed.
- `AccountSizeRiskMultiplier()`'s equity-tiered boost (0.75x–1.35x) no longer scales entry risk —
  explicit owner direction: "same mathematics, without blindly multiplying nominal lots beyond safe
  exposure" at large balances.

### Explicitly NOT touched in this release
Entry signal generation, direction selection, exit management, and pyramid/rescue logic are
unchanged — tracked separately as items 2–5 of the forensic audit's phased plan (entry-timing
consolidation, SMART-GUARD/Personality recalibration, exit-arm unification, pyramid gate redesign).

---

## v6.17.25 — 2026-07-08 — Entry-Path Consistency: Timing Engine Coverage

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.25"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.25.mq5`
- [x] Top-of-file header banner updated
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61725_final.log`)

### Entry execution graph (traced before any fix, per explicit instruction)
Exactly 4 real `OpenTrade()` callers exist in the file (verified — no 5th caller found):

| Caller | Entry type | Timing engine? | Fresh reassessment? | Bug or correct? |
|---|---|---|---|---|
| Normal scan path (`OnTick`→`ContextGateAllows`→`XAU_TimingEngineConfirmsEntry`) | Autonomous fresh signal | Yes | Yes (full pipeline re-runs each bar) | Correct (reference path) |
| `CheckReEntryOpportunity` (RE_ENTRY) | Autonomous re-entry after a stopped-out loss | **No (bypassed)** | No (Active Direction is coarse, multi-bar) | **BUG — fixed** |
| `XAU_CheckPendingOpportunityRecovery` | Autonomous recovery of a blocked signal | No (has its own M15/M30 + re-grade re-validation, and gets the v6.17.21 backstop via `OpenTrade()`) | Partial (M15/M30 only, no M5 structure check of its own) | **BUG — fixed** |
| `XAU_TryForceOpenTrade` (MANUAL_FORCE_OPEN) | Explicit human override | N/A by design | N/A by design | **BUG — v6.17.21's backstop silently vetoed it; fixed** |

Also found: `ContextGateAllows`'s Gate 1 called `XAU_ClassifySetup(signal, atr, "", cgClass)` — empty
setup name meant the `BREAKOUT_RETEST` branch could never match there. **Bug — fixed.**

Pyramid adds (`trade.Buy`/`trade.Sell` direct calls, not `OpenTrade`) are position-management on an
*existing* trade, not a new independent directional decision — noted as out of scope, not silently
ignored.

### Root causes and fixes
1. **RE_ENTRY bypass** — `CheckReEntryOpportunity` went from "Active Direction still agrees" straight
   to `OpenTrade()`. Now calls `XAU_ClassifySetup` (rejects/cancels on `LATE_CHASE`, one-shot) and
   routes through `XAU_TimingEngineConfirmsEntry` for the same adaptive immediate/wait decision the
   normal path gets (a genuine wait, not a permanent cancel).
2. **Recovery path gap** — `XAU_CheckPendingOpportunityRecovery` already re-validates M15/M30 trend
   direction, re-grades, and gets the v6.17.21 Exhaustion/Reversal backstop automatically via
   `OpenTrade()`, but had no explicit fresh-M5-structure check of its own. Now also calls
   `XAU_ClassifySetup` and rejects on `LATE_CHASE` with reason `M5_STRUCTURE_NO_LONGER_SUPPORTS`.
3. **ContextGate setup-identity loss** — `ContextGateAllows(int signal, double atr, string
   setupName="")` now threads the real setup name through from its one call site to the classifier.
4. **Manual override silently vetoed** — `OpenTrade(..., bool isManualOverride=false)`; the
   Exhaustion/Reversal backstop (soft judgment) is skipped only when `isManualOverride` is true
   (only `XAU_TryForceOpenTrade` passes it) — every hard safety check below it (hedge/exposure/
   margin/broker/risk) is untouched and still applies unconditionally to every caller.
5. **Related bug found while tracing #1**: `XAU_TimingEngineConfirmsEntry`'s one-bar reconfirmation
   branch used to return `ENTRY_ALLOWED` whenever a signal simply persisted for one bar without
   overextending, without re-checking whether the classification on that *second* bar was still
   `LATE_CHASE`. Now requires the current bar's re-derived classification to not be `LATE_CHASE`
   too — this closes a real "wave it through just for surviving a bar" gap in the normal path too,
   not just RE_ENTRY.
6. **Force-open diagnostics** — generic `STALE_OR_INVALID` split into `INVALID_CANDLE_TIME` vs
   `STALE_CANDIDATE_N_BARS_OLD_MAX_3`; an informational (non-blocking) `XAU_ClassifySetup` read is
   now surfaced in the execution log — the override still proceeds regardless, preserving
   intentional-bypass semantics. "Did price move in your favor since the original candidate" needs
   the original candidate's price plumbed end-to-end from the Command Center UI through the backend
   to this command, which the current payload does not carry — flagged as a follow-up, not guessed.

### Intentionally preserved behavior
- `XAU_TryForceOpenTrade` still does not call `ScoreSetups`/`StrategyFitsPersonality`/
  `AdaptiveXAUConfirm`/`GetAIAnalysis` — soft quality gates remain bypassed by design for a manual
  override; only the *new* Exhaustion/Reversal exemption was a bug (it wasn't exempted before, when
  it should have been).
- Every hard safety check (hedge/exposure gate, `CountMyPositions`, spread cap, margin/broker via
  `OpenTrade`) is unconditional for all 4 callers, manual override included.

### Testing
- [x] MetaEditor compile: 0 errors, 0 warnings
- [x] `tests/test_xau_v61725_entry_path_consistency_static.py` — 27 tests covering all 4 fixes plus
      the related timing-engine reconfirm bug, including behavioral simulations of: immediate entry,
      marginal wait, pending-direction-switch (no stale reuse), overextension reassessment,
      still-LATE_CHASE-on-confirm rejection, recovery cancel/execute, and stopped-out-retest-alone
      rejection vs. valid-fresh-reentry execution
- [x] Full suite re-run (511 passing) — 8 pre-existing tests across 6 files needed mechanical updates
      for the legitimate `OpenTrade`/`ContextGateAllows` signature changes and the `STALE_OR_INVALID`
      rename (verified each was a stale-string issue, not a masked regression, before updating)
- [x] `git diff` against the last pushed commit reviewed line-by-line — no unintended scope beyond
      the 4 traced fixes plus the reconfirm-branch bug found while tracing fix #1
- [ ] Live/Strategy-Tester forward validation of the RE_ENTRY and recovery behavior changes — cannot
      be done from this environment.

---

## v6.17.24 — 2026-07-08 — A-Z Audit: Countertrend Evidence-Side Bug Fix

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.24"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.24.mq5`
- [x] Top-of-file header banner updated
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61724_final.log`)

### What the audit found
User asked for a full bug audit of the file before trusting v6.17.23 live ("know what you're doing,
do it 100% complete"). Re-derived `XAU_ClassifySetup`'s countertrend branch by hand against a
concrete oversold-in-a-downtrend scenario and found a real bug shipped in v6.17.23: the 6-signal
evidence checklist (largeLegDone/nearExtreme/reclaimSeen/structBroken/roomAsymmetric/
momentumFading) was built with `dirIsSell=(dir==-1)` — i.e. from the newly-proposed direction's own
side — for both the trend-continuation self-check (correct there) AND the countertrend
justification check (wrong). A countertrend BUY against a bearish old trend was being checked for
"has this BUY already run up and gone overbought," which is nonsensical for a trade that hasn't
been taken yet and nearly impossible to satisfy in an actual downtrend (price sits near lows, not
highs) — meaning PULLBACK_SCALP/REVERSAL_RECLAIM would almost never have fired for a genuine
oversold bounce, exactly the "allow a short-term BUY in a downtrend" case this feature exists for.

A broader grep-based sweep (assignment-in-condition, unguarded division, indicator-handle leaks)
across the rest of the ~28k-line file found the existing code already consistently guards these
patterns (checked ~15 `/rDollars` divisions and several indicator-handle creations by hand — all
guarded at the top of their enclosing function) — consistent with the file's own extensive prior
audit history (v6.17.7 "9 independently-verified static-audit items," etc.). No other bugs
confirmed within the scope reviewed.

### Fix
The countertrend branch now builds its checklist from `oldTrendIsSell=(oldBiasDir==-1)` — the OLD
TREND's side — instead of `dir`'s own side. Two separate checklists now exist for two separate
questions: "is dir itself exhausted" (continuation self-check, unchanged) vs. "is the trend dir is
fighting against exhausted" (countertrend justification, fixed). `XAU_ExhaustionReversalGuard`
(v6.17.21) was not touched.

### Testing
- [x] MetaEditor compile: 0 errors, 0 warnings
- [x] `tests/test_xau_v61724_countertrend_evidence_fix_static.py` — 20 tests, including two new
      end-to-end simulations that compute the real evidence from raw price/ATR/swing levels (not
      hand-fed hits) for an oversold-bounce BUY and an overbought-pullback SELL, asserting neither
      misclassifies as LATE_CHASE (the pre-fix bug's actual failure mode)
- [x] Full suite re-run: 487→490+ passing (exact count shifts with each obsoleted identity test);
      only the expected next-release-obsoletes-previous pattern remains

---

## v6.17.23 — 2026-07-08 — Adaptive Timing + Countertrend Classifier

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.23"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.23.mq5`
- [x] Top-of-file header banner updated
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61723_final.log`)

### User feedback that drove this release
v6.17.22's fixed one-bar wait was flagged as too blunt: a strong, already-confirmed signal could
lose its exact entry waiting for a bar it didn't need and end up chasing; separately, Gate 1's
HTF-bias block hard-blocks EVERY countertrend attempt even when fresh M5 chart evidence (not old
H1/regime trend) clearly supports it. Explicit ask: "adapt to the current chart, don't blindly
follow old trend direction," with named trade types (TREND_CONTINUATION / PULLBACK_SCALP /
REVERSAL_RECLAIM / BREAKOUT_RETEST) and a requirement to never force a fixed delay or blindly
chase.

### Fix
New `XAU_ClassifySetup()` — deliberately independent of `XAU_ExhaustionReversalGuard` (v6.17.21,
already live-proven; not touched, verified by a static test that greps for its absence in that
function). Classifies every entry attempt:
- **TREND_CONTINUATION** — dir agrees with OldTrendBias (H1 BOS + regime). Immediate entry only if
  fresh M5 structure agrees too AND zero of the 6 reversal/exhaustion signals oppose it.
- **PULLBACK_SCALP** — countertrend, ≥4/6 reversal signals + a confirmed reclaim, but the broader
  M5 structure hasn't flipped yet (a bounce within the still-intact old trend).
- **REVERSAL_RECLAIM** — same evidence bar, but fresh M5 structure has already flipped in dir's
  favor (a real structural reversal, not just a bounce).
- **BREAKOUT_RETEST** — the existing BREAKOUT setup, labeled for telemetry.
- **LATE_CHASE** — countertrend with <4/6 reversal signals or no reclaim — still blocked exactly
  as before.

Two call sites: `ContextGateAllows`'s Gate 1 now lets PULLBACK_SCALP/REVERSAL_RECLAIM through the
HTF-bias block (LATE_CHASE still hard-blocked); `XAU_TimingEngineConfirmsEntry` skips its one-bar
wait (`immediateConfirm`) for a clean continuation or a strong (≥5/6) countertrend reclaim — a
marginal 4/6 still waits one bar like any uncertain signal. The v6.17.22 anti-chase/never-blindly-
resume behavior is unchanged.

### Testing
- [x] MetaEditor compile: 0 errors, 0 warnings
- [x] `tests/test_xau_v61723_adaptive_timing_static.py` — 17 tests: struct/enum presence, the
      exhaustion guard's independence, Gate 1's exception, the timing engine's immediate-skip
      ordering, and a Python behavioral simulation of all 5 classification outcomes (clean
      continuation, marginal/strong countertrend reclaim, pullback-within-trend, late chase)
- [x] Full suite re-run: only the expected "next release obsoletes the previous one's identity
      checks" pattern remains (same as every prior release); one pre-existing fixed-window test
      (`test_xau_v6173`) widened again for the same documented, non-regression reason as v6.17.6
- [ ] Live forward-test measurement of missed-entries-from-waiting / chase-entries / immediate-
      entry accuracy / pullback-scalp and reversal-reclaim win rates / MAE improvement — cannot be
      done from this environment; requires a live or Strategy-Tester run.

---

## v6.17.22 — 2026-07-08 — Timing Engine (one-bar entry confirmation)

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.22"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.22.mq5`
- [x] Top-of-file header banner updated
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61722_final.log`)

### Evidence — multi-day forensic audit (not tuned from one session)
Parsed 6 trading days (2026-07-02 through 07-08; 07-01 excluded, its EA build predates the
`TRADE_THESIS_STATUS` telemetry this audit depends on), 12 EA version eras (v6.8.0-v6.17.20),
35 primary entries with real per-tick MAE/MFE. Result: **0/35 (0%) favorable at the 10-minute
mark — universal**, not specific to July 8, to SELL, to TREND_PULLBACK, or to any one EA version.
100% of entries showed adverse movement within 1 minute; 49% exceeded -$20 in that first minute.
NY session was worst (73% >$20 adverse@1min, net -$984 across the sample); ASIA/LONDON sessions
were both net positive with smaller adverse excursions. Recovery-of-missed-signal overrides
averaged ~2x the 10-minute drawdown of fresh entries regardless of final outcome.

### Root cause
A signal that clears every existing gate (setup score, personality, SmartGuard, AI Director,
lot sizing, ContextGateAllows) executes `OpenTrade()` INSTANTLY on the bar it was first detected —
there was no requirement that the move still be intact even one bar later. Direction and setup
quality were both fine; execution timing was not being checked at all as a separate concern.

### Fix
New `XAU_TimingEngineConfirmsEntry()` — the last check before `OpenTrade()`, after direction/
setup/size are already decided (nothing upstream changed). Requires the SAME setup+direction to
reappear on the very next closed M5 bar before firing: `SIGNAL_DETECTED -> WAITING_FOR_ENTRY_WINDOW
-> ENTRY_CONFIRMING -> ENTRY_ALLOWED`, or `-> ENTRY_WINDOW_EXPIRED -> REASSESS_FROM_CURRENT_MARKET`.
Not a blanket blocker or a new score threshold — a bounded, self-expiring one-bar window. A signal
that changes direction/setup, or moves >1xATR in its own favor before reconfirming (anti-chase),
opens a brand-new window from current market conditions; it never blindly inherits the expired
signal's direction (SL/TP are computed fresh inside `OpenTrade()` regardless).

### Testing
- [x] MetaEditor compile: 0 errors, 0 warnings
- [x] `tests/test_xau_v61722_timing_engine_static.py` — 9 tests, including a Python behavioral
      simulation of the state machine (confirm/reject/re-arm/anti-chase paths)
- [ ] Live forward-test measurement of MAE1/5/10/fav%@5/10/time-to-positive/MFE-MAE-ratio before
      vs. after — cannot be done from this environment; requires a live or Strategy-Tester run.

---

## v6.17.21 — 2026-07-08 — Scan-Recovery State Fix + Exhaustion/Reversal Guard

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.21"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.21.mq5`
- [x] Top-of-file header banner updated (permanent checklist item above)
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61721_final.log`)

### Bug 1 — SCAN_STARTED/SCAN_ABORTED infinite loop
Live evidence: `SCAN_STARTED` / `SCAN_ABORTED reason=INDICATOR_RECOVERY_BACKOFF...retry in Xs`
repeating every tick, never stopping, despite the message's own countdown. Root cause: (a)
`XAU_LogScanState`'s dedup only collapses repeats of the SAME state string — SCAN_STARTED and
SCAN_ABORTED alternate, so neither ever matched its predecessor and both printed unthrottled;
(b) the scan watchdog re-forces a full scan attempt every tick once overdue, and nothing checked
in advance whether an active backoff window already made that attempt's outcome certain. Fix: one
explicit `g_recoveryState` machine (NONE/WARMUP/BACKOFF), gated at the top of `OnTick` before
`SCAN_STARTED` — a known-backoff tick returns immediately, no indicator handle touched, no
`SCAN_STARTED`/`SCAN_ABORTED` pair, just a 60s-throttled status line. WARMUP is intentionally not
gated. Verified via a Python state-machine simulation (before/after): `reason=
INDICATOR_RECOVERY_BACKOFF` aborts went from 744 to 3 over a 400s synthetic episode, with zero
change to actual rebuild cadence (still 3 rebuilds either way).

### Bug 2 — wrong-direction/late entries (forensic-audit-driven)
Live forensic audit of 2026-07-08's full trade log (8 primary entries, all cross-checked against
real per-tick `TRADE_THESIS_STATUS` running P/L, not estimated): posId 9483784022 (SELL
TREND_PULLBACK, -$430.11, the single trade that flipped the day from +$198.68 to -$231.43 net) and
posId 9477557258 (SELL "RECOVERY of missed signal" override of an original HARD_BLOCK that was
right, -$153.18, adverse from minute 1) both fired with their direction supported ONLY by stale
H1 BOS / regime evidence while fresher M5 structure already disagreed. New
`XAU_ExhaustionReversalGuard` re-derives fresh M5 structure (swing-sequence, CHoCH, sweep-rejection
— reusing existing validated helpers, no new detectors) and blocks a direction backed mainly by old
trend evidence once >=4/6 concrete reversal signals plus a confirmed reclaim/sequence-flip already
oppose it. Placed as a backstop inside `OpenTrade()` itself (not only `ContextGateAllows`) because
the audit found `XAU_CheckPendingOpportunityRecovery`/`XAU_TryForceOpenTrade` call `OpenTrade()`
directly, bypassing `ContextGateAllows` — exactly the path posId 9477557258 used. Adds
`DIRECTION_QUALITY` telemetry (OldTrendBias/FreshStructureBias/SELL_EDGE/BUY_EDGE/ExhaustionRisk/
ReversalEvidence/ChaseRisk/WhyChosenDirection/WhyOppositeRejected) on every trade attempt.

### Testing
- [x] MetaEditor compile: 0 errors, 0 warnings
- [x] Python state-machine simulation of the scan-recovery fix (before/after comparison)
- [x] Forensic audit script (`forensic_audit.py`) cross-referencing all 8 primary entries against
      real per-tick `TRADE_THESIS_STATUS` MAE/MFE at 1/5/10/15/30min — not estimated
- [ ] Live forward-test confirmation once deployed (cannot be done from this environment)

---

## v6.17.20 — 2026-07-08 — Exit Arm R-Floor (lot-blind threshold fix, Mac vs VPS)

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.20"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.20.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61720_final.log`)

### Evidence — direct Mac vs VPS comparison from the user
Same EA, two live accounts: Mac ($3k, small lots ~0.07-0.26, holds well — SELL 0.07 → $187, SELL
0.26 → $193) vs VPS ($7k, bigger lots ~0.15-0.59 from the v6.17.17 account-lot-floor, exits far too
early — SELL 0.17 → $43, SELL 0.15 → $53, SELL 0.59 → $28, SELL 0.59 → $49). Both accounts sit in
the SAME `AccountSizeRiskMultiplier` tier (equity < $10k → 1.00x), so every flat-$/equity-%
exit-arm threshold in the file was identical in dollars for both.

### Root cause
`rDollars` (a position's own $-per-R) scales with lot size; the v6.17.17 account-lot-floor can
inflate lot size independent of the trade's SL distance/actual risk. Three separate flat-dollar
arm/trigger thresholds don't know about a position's own lot size, so on VPS's much bigger,
floored lot they fire at a tiny fraction of that trade's real R — while on Mac's smaller, unfloored
lot the identical dollar figure represents a much more meaningful R:
1. `XAU_ProtectPeakProfitFloor`'s `armUSD = MathMin(armUSD_accountScaled, armUSD_rBased)` — the
   flat, account-tier-only `armUSD_accountScaled` ($75 for both accounts here) always wins the MIN
   against the correctly lot-scaled `armUSD_rBased` once a lot is big enough, arming far too early
   in R-terms on big lots.
2. A+ Shield's `tier1ArmUSD`/`tier2ArmUSD` — pure equity-% figures (`refBal * Pct/100`), same
   lot-blind pattern.
3. `XAU_EvaluateExitEV`'s `InpEVExitEdgeUSD`(15)/`InpEVMinHoldEdgeUSD`(25) — flat dollar "edges"
   compared against `profitAtRiskUSD`, which IS lot-scaled; a big lot crosses these flat edges (and
   the direct `profitAtRiskUSD >= InpEVExitEdgeUSD` trigger straight into PARTIAL/PROTECT) almost
   immediately.

### Fix
New shared `XAU_MinArmUSDForOwnR(dollarArm, rDollars)` floors any such threshold at
`InpExitArmMinOwnR` (0.20R default) of the position's OWN risk, so a bigger lot can never make a
dollar/equity-based threshold fire sooner, in R-terms, than a smaller lot would. Applied to all
three sites above. Lot sizing completely untouched; no new entry-side rules.

### Telemetry
`XAU_ProfitQuality` (v6.17.18) gained `AccountNormalizedProfit` (profit as % of reference equity,
lot-independent) and `LotSizeInfluence` (the actual lot on this position) — both threaded through
`XAU_ProfitQualityTelemetry()` — so a Mac-vs-VPS-style audit can be done directly from the
JSONL/CSV telemetry going forward instead of needing a live side-by-side repro.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61720_exit_arm_r_floor_static.py` — 14/14 passing (helper formula proven
      numerically against the exact Mac/VPS scenario, all three sites wired through the helper, the
      EV_PROTECT direct-trigger no longer references the raw unfloored input, new telemetry fields
      present and computed, lot sizing/entry-side untouched, prior fixes intact)
- [x] Full suite: 456/536 passing, remaining failures are the same pre-existing release-time
      sync-staleness pattern as every prior release

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.20.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings (Footer, CloudLanding, AdminPortal, DownloadSection, FeaturesSection)
- [x] `backend/server.py` `ea_version` default
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION on both accounts. This directly targets the reported VPS
  early-exit pattern — watch VPS specifically for whether SL_MOD:PROFIT_FLOOR/A+ Shield/EV_PROTECT
  events now arm later (check `LotSizeInfluence`/`AccountNormalizedProfit` in new telemetry against
  `ProfitR` at each event) and whether $28-53-class early exits stop recurring on big-lot trades. No
  live SSH/file access to the VPS instance was available in this session — could not directly confirm
  which EA version/inputs the VPS was actually running, so this fix addresses the CODE-level root
  cause (present regardless of machine) but the user should confirm the VPS is updated to v6.17.20
  and re-observe before treating the disparity as fully resolved.

---

## v6.17.19 — 2026-07-08 — Account-Size Adaptive TP Targets

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.19"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.19.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61719_final.log`)

### What changed
User: "the bigger the account size the bigger the lots, the bigger the exit profit target/TP...
basically everything should trade based on account size." Lot size already scaled with account size
(v6.17.17) and risk tolerance already scaled with account size (`AccountSizeRiskMultiplier`,
v5.8.8) — but the TP target distance itself was still a flat R-multiple (4.0R base / 6.5R
structure-runner / 2.5R breakout) regardless of account size. New `AccountSizeTPMultiplier()`
mirrors `AccountSizeRiskMultiplier`'s exact equity tiers for one consistent account-size ladder
(0.85x-1.30x, capped slightly lower than the 1.35x risk boost since widening TP too aggressively can
hurt fill probability). Applied to the trending/breakout TP multiplier in `OpenTrade()`; deliberately
NOT applied to the `LOW_VOL`/`CHOPPY` safety-capped 1.5R override, which stays tight regardless of
account size (volatility-regime safety, not a sizing preference). The v6.17.18 profit-quality exit
gate's R-multiple thresholds needed no equivalent change — R is already account-size-normalized by
construction (`profit / rDollars`, and `rDollars` scales with lot size).

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61719_account_size_adaptive_tp_static.py` — 8/8 passing
- [x] Full suite: 439/514 passing at ship time, remaining failures are the standard sync-staleness
      pattern
- [x] Also fixed a stale `ea_version = "v6.17.6"` default in `backend/server.py`, found while
      touching this area (pre-existing staleness, unrelated to this release's actual change)

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.19.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [x] GitHub main branch pushed (commit `ed01ee4`)

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION — wider TP on bigger accounts means trades held longer before the
  fixed target; watch that large-account trades aren't giving back more on the way to a now-further
  TP than they would have at the old flat multiplier.

---

## v6.17.18 — 2026-07-08 — Profit Quality Exit Gate + Scan Warm-up Fix

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.18"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.18.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61718_final.log`)

### Evidence — the exact follow-up v6.17.12 flagged and deferred
v6.17.12 explicitly scoped this out: *"a review of why the SELL leg of the flagged trade was closed
for +$35 via PROFIT_FLOOR while price ran another $314/8.98 ATR in its favor... matches the 'cuts
winners too early' pattern... a tuning/design question, not a discrete bug, that needs its own
evidence-based pass."* User re-raised it directly after the lot-size increase, with an explicit
instruction: do not shrink the lot, do not add fear rules, fix exit intelligence.

Pulled real trade data straight from `XAUAI_TradingIntelligence_XAUUSD.jsonl` (UTF-16, Common\Files)
for the 48 closes 2026-07-02 → 2026-07-08 (the bigger-lot window, avg lots ~0.17-0.20 vs ~0.05 in
mid-June): **15 of 35 winners (43%) were self-tagged `EXIT_EARLY_LEFT_PROFIT`** by the EA's own
post-close 5/10/15/30/60-minute tracker. Breakdown of those 15 by exit tag: **7 `SL_MOD:PROFIT_FLOOR`**
(dominant), 4 `SL_MOD:EV_PROTECT`, 1 `SL_MOD:AMPL`, 2 `BASKET HARD-CAP`/`BASKET LOCK` (giveback 71-96%
of peak in those two). Concrete example: posId `9471531961` SELL 0.07 lots closed at $187.46 profit
via `SL_MOD:PROFIT_FLOOR`, flagged `EXIT_EARLY_LEFT_PROFIT` at every checkpoint out to 15m.

### Root cause
`XAU_ProtectPeakProfitFloor()`: once peak crossed the arm threshold, the floor SL jumped straight to
a flat `lockPct%` of peak (45% default, context-adjusted 45-70%) **unconditionally**. The
thesis/structure-still-valid check (`thesisHoldAllowed`) only gated the *full close* path further
down the function — it was never consulted before the SL-tightening step itself. So a clean runner
with fully intact structure got its stop yanked to a flat percentage the instant it armed, and any
ordinary pullback (not a real reversal) then stopped it out right before the move it was in
continued — exactly the pattern the telemetry shows.

### Fix — profit-quality gate on the LOCK itself, not just the close
New `XAU_AssessProfitQuality()` / `XAU_ProfitQuality` struct, called before any SL-tightening or
close decision in `XAU_ProtectPeakProfitFloor()`:
- **HOLD** — profit is tiny (< `InpProfitQualityMinR`=0.80R) or spread-dominated (spread cost ≥
  `InpProfitQualitySpreadImpactPct`=30% of current floating profit) while thesis/structure/momentum
  are still fully clean, and it isn't yet a big win → skip tightening entirely this tick. New
  `PROFIT_QUALITY_HOLD` telemetry line.
- **PROTECT_WIDE** — profit is meaningful (≥ 0.80R) but not yet huge (< `InpProfitQualityBigWinRMultiple`=2.50R),
  thesis still clean, context is `STRONG_TREND`/`NORMAL_PULLBACK` (never overrides the deliberately
  tighter `EXPLOSIVE_MOVE`/`TREND_EXHAUSTION`/`WEAK_TRADE` contexts) → loosen the lock to
  `InpProfitQualityRunnerLockPct`=22% of peak instead of the base 45%, so a normal pullback doesn't
  trip the stop. New `PROFIT_QUALITY_WIDEN` telemetry line.
- **PROTECT_TIGHT** — thesis has actually weakened (structure broken / momentum ≤2 / trend
  misaligned) or the win is already large (≥ 2.50R) → unchanged, keeps the existing tighter
  context-based lock and full-close safety logic exactly as before.

Lot sizing is untouched everywhere — this only changes when/how tightly the protective SL ratchets.
No new entry-side blocking/"fear" rules were added; this is exit-side only.

### Telemetry
`XAU_ProfitQualityTelemetry()` reports `NetProfitAfterCosts`, `ProfitR`, `ProfitATR`, `PeakProfit`,
`GivebackPct`, `SpreadCostImpact`, `ThesisStillValid` (YES/NO), `ExitStrength` (0-5), `Decision`
(HOLD/PROTECT_WIDE/PROTECT_TIGHT), `CloseKind` (HOLD/PROTECT/FULL_CLOSE), `WouldRunnerRemain`
(YES/NO) — wired into the `PROFIT_QUALITY_HOLD`/`PROFIT_QUALITY_WIDEN`/`PROFIT_FLOOR_SET` journal
lines and into `lastExitReason` on the full-close path, so it flows into the existing
`exitReason`/`CloseReasonExact`/`extra` fields already wired into
`XAU_IntelAppendJson`/`XAU_IntelAppend` (JSONL/CSV) without touching that 30+-parameter writer's
signature or its many call sites.

### Scan warm-up noise + speed fix (separate, smaller issue raised in the same session)
User-reported live log: `SCAN_ABORTED reason=INDICATOR_WARMUP: waiting 7s after handle rebuild
before copying EMA_FAST_M5` — noisy, and signal confirmation that used to land right at the exact
5-minute bar close was arriving late. Two confirmed bugs:
1. `XAU_LogScanState`'s dedup compared the raw state string, but the warmup reason embeds a live
   countdown ("waiting 7s", "waiting 6s", ...) that changes every tick — every tick looked like a
   NEW state and bypassed the intended 60s-resurface throttle, printing a fresh `SCAN_ABORTED` line
   every tick for the whole warm-up window. Fixed with a digit-collapsed dedup key
   (`XAU_ScanStateKey`) while keeping the original exact-match check as an explicit (redundant but
   harmless) fast-path.
2. `CopyEntryBuffer()` blind-waited the full `InpIndicatorWarmupSec` ceiling (12s default) before
   even attempting a copy after a handle rebuild, even though MT5 usually finishes recalculating a
   freshly-rebuilt M5 EMA/RSI/ATR handle within a tick or two. Fixed to try the copy opportunistically
   first, only falling back to the timed wait if the data genuinely isn't ready yet.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61718_profit_quality_exit_gate_static.py` — 18/18 passing (input defaults,
      decision-matrix ordering, HOLD returns before any SL tightening, WIDEN only applies to clean
      continuation contexts, gate runs before context classification, full-close thesis-hold path
      unchanged, telemetry fields present and wired in, scan-dedup key, opportunistic-copy ordering,
      prior fixes still intact, no new entry-side restrictive defaults)
- [x] Updated `tests/test_xau_v6171_indicator_handle_lifecycle_fix_static.py` (1 test) for the new
      earlier opportunistic-copy success path — same invariant (success returns before fail-counter
      logic) now verified on both the early and main copy attempts
- [x] Full suite: 439/514 passing, remaining 75 failures are the same pre-existing release-time
      sync-staleness pattern as every prior release (verified via before/after diff against the
      pre-change baseline — 87 failed on HEAD before this change, 75 after; zero new failure classes)

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.18.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings (Footer, CloudLanding, AdminPortal, DownloadSection, FeaturesSection)
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION — this changes real exit timing on profitable trades. Watch for
  `PROFIT_QUALITY_HOLD`/`PROFIT_QUALITY_WIDEN` journal lines and confirm: (a) HOLD trades that later
  reverse to a loss are rare and small (thesis-still-valid trades that round-trip are still covered
  by the existing `THESIS_HOLD_BE_REARM` breakeven re-arm, untouched by this change), and (b) WIDEN
  trades that do eventually stop out are closing at a genuinely later/larger point than the old 45%
  lock would have, not just later for its own sake. Re-run the same `EXIT_EARLY_LEFT_PROFIT` audit
  against 07-09+ telemetry once enough new-code trades have closed to compare against this release's
  43% baseline.

---

## v6.17.17 — 2026-07-08 — Account-Size Lot Floor

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.17"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.17.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61717_final.log`)

### What changed
User requested explicit minimum lot sizes by account balance: 0.10 at $1k, 0.25 at $3k, 0.50 at $6k.
Before implementing, confirmed one real tradeoff directly: on a wide-SL trade, hitting these targets
can mean risking more than the 5% cap raised in v6.17.14 (the earlier 14.58pt-SL example would need
~12-13% risk to reach 0.25 lots). **Asked the user explicitly which should win — they chose: minimum
lot always wins.**

`InpMinAccountLotFloor = 0.10`, `InpAccountLotFloorPer1000 = 0.08333` →
`floorLot = max(0.10, balance/1000 * 0.08333)` — verified numerically to hit all three targets
exactly ($1k→0.10, $3k→0.25, $6k→0.50).

Applied as the **last** step in `OpenTrade()`, after `XAU_ReconcileFinalRisk()` and every other
multiplier/mode/penalty in the function. This is deliberate: rather than hunting down and adjusting
every individual lot-reducing mechanism (risk cap, session scaling, AI/personality penalties, scout
markers, the existing v6.4.15 small-account proportional floor), placing the new floor at the very
end means it reliably lifts the final lot back up regardless of which upstream mechanism shrank it.
Still respects true broker constraints (step/min/max) — those are real hard limits that can't be
bypassed by any user preference.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61717_account_lot_floor_static.py` — 11/11 passing (exact-target math,
      floor position after reconciliation, floor never lowers, broker step/min/max still respected,
      logs clearly when it overrides the risk cap)
- [x] Full suite: 424/496 passing, remaining failures are pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.17.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: this is a DELIBERATE, user-confirmed increase in per-trade risk on wide-SL setups —
  not silent. Watch for `ACCOUNT-LOT-FLOOR:` journal lines; each one shows the exact balance, the
  lot it raised, and confirms this was the intended override, not a bug

---

## v6.17.16 — 2026-07-08 — HARD_BLOCK Self-Consistency Fix

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.16"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.16.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61716_final.log`)

### Evidence
A background executed-vs-blocked expectancy audit
(`audits/xau_expectancy_inversion_audit_2026-07-06_to_2026-07-08.md`) directly compared 19 executed
trades against 106 blocked A/A+ signals in the same window. Headline: the filter stack is **not**
broadly inverted (blocked A/A+ signals lean correctly protective, 55% would-be losses vs 17%
would-be 2R wins; executed trades net +$232.85, PF≈1.26) — but **100% of this window's trading
losses traced to one narrow, exact mechanism**: 3 of 19 executed trades carried the EA's own
internal `blockClass=HARD_BLOCK` self-label at entry (from `XAUEntryTimingGuard()`'s calibrated
timing/quality engine) and were executed anyway via an override path
(`STRONG_MOMENTUM_OVERRIDE`/`TREND-CONTINUATION MODE` chase/`RECOVERY of missed signal` re-entry).
None were clean wins (1 loss, 1 large loss, 1 narrow survival off a -$348 drawdown). Checked against
~5 weeks of full local history, the same pattern occurred 5 times, net -$161.52 despite a 60%
nominal win rate — small sample, but consistent direction at every scope checked.

### Root cause
`blockClass = "HARD_BLOCK"` is computed from `lateChaseEntry||spikeCooldown||failedImpulseBlock||
postSweepTrap||timingBadRRForReport` and written into the entry's own diagnostic log text — but
only the `lateChaseEntry` sub-case had an actual `return false;` wired to it (via a separate,
narrower `if(lateChaseEntry && InpXAU_BlockLateA && !trendContinuationQualified)` check). The other
four conditions got the "this is hard-block quality" label in their own text and were then allowed
to fall through to whatever came next.

### Fix
Added `if(blockClass == "HARD_BLOCK") { ...; return false; }` immediately after the classification —
unconditional, no `XAU_StructuralBypassAllowed()`/trade-mode softening, matching the audit's explicit
"no override path should be able to admit it." This is a self-consistency fix, not a new fear rule:
it makes the system respect a conclusion it was already, privately, reaching on its own.

Also closed the matching gap in the v6.17.14 `PendingOpportunity` recovery classifier
(`XAU_BlockerIsHardReason()`) — it did not previously recognize this same internal label, meaning a
`blockClass=HARD_BLOCK`-flagged signal could theoretically be re-admitted via the missed-signal
recovery path too (exactly what happened in the audit's trade #19: a `RECOVERY` re-entry of a
`FAILED-IMPULSE BLOCK`ed, `blockClass=HARD_BLOCK` signal, which lost).

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61716_hard_block_self_consistency_static.py` — 9/9 passing (confirms the
      check is unconditional, runs before the old narrower check, and the classifier update is
      present without touching the underlying classification logic)
- [x] Full suite: 416/485 passing, remaining failures are pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.16.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: this REDUCES trade frequency slightly (it closes an unintended admission path, it
  does not open one) — the expected effect is fewer, not more, executed trades in the narrow set of
  cases this touches. Watch for `HARD_BLOCK_SELF_CONSISTENCY` journal lines to confirm it's firing
  on the same class of candidate the audit identified.

---

## v6.17.15 — 2026-07-08 — Command Center Force Open Trade

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.15"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.15.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61715_final.log`)

### Feature 1 — Force Open Trade
User-facing manual override for a blocked candidate, requested from Command Center.

**Architecture**: reused the EXISTING remote-command queue (`/api/cloud/command/request` →
`cloud_bot_commands` → EA's `BotMonitorPollCommands()` poll, already used by
PAUSE/RESUME/STOP/CLOSE_ALL/UPDATE_PROP_FIRM_CONFIG) rather than building a new channel. Added
`FORCE_OPEN_TRADE` to `SAFE_REMOTE_COMMANDS`.

**Backend** (`server.py`): `_normalize_force_open_payload()` validates direction (BUY/SELL only),
requires a real setup name, and rejects payloads where the original candle is already >15 minutes
old — before the command is even queued for the EA to see.

**EA** (`XAU_TryForceOpenTrade()`): deliberately a thin wrapper, not a parallel execution path.
`OpenTrade()` itself already computes entry/SL/TP fresh from CURRENT bid/ask + ATR at call time
(never a stale stored price) and already enforces every hard-safety item on the explicit
"must never bypass" list: invalid stops, broker min/max/step lot, max risk hard cap (final risk
reconciliation), and margin/broker rejection via retcode. This wrapper only adds staleness (3 bars
/ 15min), the spread hard cap (OpenTrade has none of its own), duplicate-same-candle protection,
and symbol-trading-disabled — the few things `OpenTrade()` doesn't already check. Soft gates
(Personality/AI/SmartGuard/B-grade quality) are bypassed simply by never calling
`ScoreSetups`/`StrategyFitsPersonality`/`AdaptiveXAUConfirm`/`GetAIAnalysis` at all — confirmed
absent from the function by direct source check.

**Frontend** (`CloudDashboard.jsx`): "Force Open Trade" button added to `EventRow` (the Command
Center's Bot Decision Feed), shown only for BLOCK-severity events with a real direction+setup and
age ≤15 minutes. Click opens the existing `CommandModal` confirmation flow (now payload-aware),
showing the original blocker reason before the user confirms.

Every rejection returns an exact reason (`FORCE_OPEN_REJECTED_STALE_OR_INVALID`,
`_DUPLICATE_SAME_CANDLE`, `_MAX_OPEN_TRADES`, `_SPREAD_TOO_WIDE`, `_NO_FRESH_DATA`,
`_SYMBOL_TRADING_DISABLED`, `_EXECUTION_FAILED`) surfaced back through the existing command-ack
flow.

### Feature 2 — lot-size re-check
Verified the reported "still opens 0.04-0.09 lots" is the SAME 5% risk cap raised in v6.17.14,
correctly scaling with SL width: `0.06 lots at 3% cap × (5/3) = 0.10 lots at 5% cap` — the user's
newer trades landing around 0.09 on similarly wide stops is the cap working as intended, not a new
reducer. Reaching the originally-expected 0.25-0.30 on this SL width would require raising the cap
to ~12-13% risk per trade, which was not done (that's a materially different risk decision than the
5% already made explicitly). No code change needed here; documented the math for the user's own
decision if they want to go further.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] Frontend production build (`craco build`) — compiled successfully
- [x] New `tests/test_xau_v61715_force_open_static.py` — 17/17 passing (EA hard/soft gate
      boundaries, backend payload validation, frontend button gating + confirmation content)
- [x] Full suite: 410/476 passing, remaining failures are pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.15.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION — this is new, real-money-relevant manual-override control flow.
  Watch for `MANUAL_FORCE_OPEN_EXECUTING`/`FORCE_OPEN_REJECTED_*` journal lines and confirm a forced
  trade is managed identically to a normal one afterward (same magic number, same exit management —
  it flows through the same `OpenTrade()` path every other trade uses, so this should already be
  true, but confirm before treating it as fully proven)

---

## v6.17.14 — 2026-07-08 — Risk Cap Raise + Spread Loosening + Fleet Consistency

### Repo housekeeping
- [x] `vps-test-v615-fixed` branch (and its worktree at
      `/Users/libertyelectronics/XauAI-Sniper-vps-test`) fully removed — local branch deleted,
      remote branch deleted, worktree removed. Confirmed no uncommitted work existed there before
      removal. All future work is on `main` only.

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.14"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.14.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61714_final.log`)

### Part 1 — user-directed threshold changes
Traced the exact lot-sizing math for a real example (SELL 0.06 @ 4056.11, A+, TREND_PULLBACK,
SL=4070.69, $3k account): the raw balance-based formula produces ~0.26 lots (matching the user's
0.25-0.30 expectation exactly), but at this trade's 14.58pt SL distance that implies ~12.6% risk on
one trade — the 0.06 lot was the 3%-risk-cap safety reconciliation correctly catching that, not
over-protection. Presented the math and asked the user directly: raise the cap, or fix the formula
to stay realistic. **User chose: raise the cap.**
- `InpMaxRiskPctEquity`: 3.0 → 5.0
- `InpMaxSpread`: 150 → 400 (user chose "loosen," not "remove" — confirmed via explicit question)
- `InpPostNewsSpreadReturnX`: 1.5 → 2.5 (loosened alongside, same rationale)

### Part 2 — cross-account signal-consistency audit (fleet-readiness)
Audited the 18 requested divergence sources against the actual code:

| # | Source | Finding |
|---|---|---|
| 1 | Tick-timing races | `ScoreSetups()`/grade computation only run once per **closed** M5 bar (`newM5Bar` gate) — tick arrival timing does not affect which candle's data is scored |
| 2 | Forming vs. closed candle | Confirmed: all 4 remaining `iClose(..., 0)` uses are mid-price display/logging fallbacks only, never in signal scoring (`ScoreSetups` uses shift=1 throughout) |
| 3-4 | Indicator readiness/backoff | **Root-caused and fixed in v6.17.13** — `err=4807` (a documented-transient MT5 quirk) was triggering full rebuild cycles that could stall a scan for 20+ minutes on one instance while others weren't affected |
| 5-7 | Stale state / cooldown / re-entry counters | **Found and fixed here**: `XAU_AntiRepeatLossActive()` was keyed entirely off THIS account's own loss history — proven cause of "2 of 3 identical accounts fire, 1 doesn't." Exempted when Active Direction independently reaches STRONG tier in the same direction (a genuinely fresh, independent confirmation) |
| 8 | Persisted memory differences | Blocked-signal/trade-memory state is intentionally per-account (reflects that account's own history) — not a bug, but now explicitly logged via `AccountSpecificBlocker`-style reasoning where relevant |
| 9 | AI response differences | **Fixed in v6.17.11** — AI is advisory-only everywhere; it can no longer change BUY/SELL/BLOCK, only log/lot-shave |
| 10 | Balance/equity influencing signal generation | Audited directly: `ScoreSetups()` has zero `AccountInfo`/`accInfo` references — confirmed account-state-independent. Balance only affects lot sizing, never the setup/direction/grade decision |
| 11-13 | Spread / broker specs / candle-boundary | Legitimate real differences across brokers/accounts — correctly affect lot size and fills, not the underlying signal decision |
| 14 | Position-state differences | Legitimate (an account already in a trade correctly won't open a second) — now clearly attributable via existing `MAX_OPEN_TRADES`/exposure-gate logging |
| 15 | Scan watchdog timing | **Fixed in v6.17.12/13** — watchdog now measures actual scan completion, not attempt start, and no longer spams |
| 16 | Random/non-deterministic paths | Audited directly: zero `MathRand`/`GetTickCount` usage anywhere in the file |
| 17 | Stale cached regime/direction/personality | `DetectRegime()`/`XAU_ComputeActiveDirection()`/`ClassifyMarketPersonality()` all recompute fresh every closed bar from live indicator buffers — no cross-bar staleness found |
| 18 | Execution failure vs. signal rejection | Already distinguished via `OpenTradeCalled`/`BrokerRetcode` fields from the v6.17.5 execution-funnel telemetry |

**Honest scope note**: items 11-14 are legitimate, expected differences (spread, broker specs, fills,
existing exposure) — the fix target was never "make everything identical," it was "make unexplained
divergence in the SIGNAL decision impossible." That target is what items 3-4, 5-7, 9, 15-16 addressed.

### DecisionFingerprint telemetry
Added `DECISION_FINGERPRINT` log line to every completed M5 scan cycle: build hash, symbol, closed-bar
timestamp, setup, direction, grade, raw/combined score, regime, HTF bias, Active Direction (+tier),
spread, and final decision (CANDIDATE/NO_TRADE). Lets any two instances' decisions for the same
closed candle be directly diffed.

### PendingOpportunity missed-signal recovery
The core fix for "one account silently misses a valid signal forever." When an A/A+ candidate is
blocked by a genuine SOFT reason (`XAU_BlockerIsHardReason()` classifies ~20 real hard-blocker
strings — spread, news, SMC hard conflict, exposure, margin, structural, etc. — as never eligible),
it's preserved as a single `PendingOpportunity` and re-checked **exactly once** on the next closed M5
bar (`XAU_CheckPendingOpportunityRecovery()`), reusing the same already-tested building blocks as the
v6.17.8-10 Symmetric Opportunity Recheck work rather than new, unproven logic:
1. Not expired (2-bar grace window)
2. No new hard account block (position count, spread)
3. Not overextended (price hasn't run >1×ATR further in the signal's favor since the original — anti-chase)
4. Fresh M15+M30 (`TFDirectionByEMA`) still support the same direction — thesis re-check
5. Re-graded with CURRENT regime/session quality (`XAU_ComputeCombinedGradeForCandidate`), not the stale original
6. Personality fit or A/A+ threshold
7. `AdaptiveXAUConfirm` (SmartGuard) passes fresh

Only if all seven pass does it call `OpenTrade()`. Any rejection logs the exact reason
(`RECOVERY_REJECTED: <id> reason=<EXPIRED|MAX_OPEN_TRADES|SPREAD_TOO_WIDE|OVEREXTENDED|
THESIS_INVALIDATED|GRADE_NO_LONGER_QUALIFIES|PERSONALITY_MISMATCH|SMART_GUARD>`). Cleared
unconditionally before any check runs — cannot fire twice for the same missed signal, never
indefinitely chases.

### On "deterministic replay tests" / 1000-instance simulation
Full multi-instance simulation (spinning up many live MT5 terminals against identical historical
data) is outside what this repo's static-analysis test harness can do — that would need an actual
MT5 Strategy Tester / multi-terminal rig, not a Python source-inspection suite. What **was** done and
is verifiable now: direct source-level proof that the signal-decision path (`ScoreSetups` → grade →
Personality Gate → SmartGuard) has no account-state or randomness inputs (tests below), which is the
structural precondition for two equivalent instances reaching the same decision on the same closed
bar. Recommend an actual multi-terminal replay test as a dedicated follow-up once the fleet is larger
than the current 3 accounts, using the new `DECISION_FINGERPRINT` lines to diff real instances
directly rather than a simulated harness.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61714_fleet_consistency_static.py` — 23/23 passing, covering: risk/spread
      threshold changes, anti-repeat-loss exemption logic, zero account-state in `ScoreSetups`, zero
      randomness anywhere, the full `PendingOpportunity` struct/classifier/recovery-function chain
      (single-attempt clearing, expiry, anti-chase, thesis re-check, re-grade, personality,
      SmartGuard, hard-account-state checks — in the correct order before any `OpenTrade` call), and
      the `DECISION_FINGERPRINT` log
- [x] Full suite: 396/459 passing, remaining failures are pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.14.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION — the risk cap raise (5%) and spread loosening (400pts) are
  explicit user choices with real, understood tradeoffs (bigger swings both directions; a genuine
  news-spike spread event up to 400pts could now fill), not silent changes. The PendingOpportunity
  recovery is new, real-money-relevant control flow — watch for `RECOVERY_EXECUTED`/
  `RECOVERY_REJECTED` lines in the journal and confirm behavior matches expectations before treating
  it as fully proven

---

## v6.17.13 — 2026-07-08 — Indicator err=4807 Root Cause + Watchdog Dedup

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.13"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.13.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61713_final.log`)

### Root cause — proven from the LIVE, currently-running MT5 journal
User reported the journal spamming `SCAN WATCHDOG: forcing entry scan after ~585s`, first with a
position open, then again while completely flat — ruling out position state as the cause and
pointing at something else entirely. Read the actual live journal directly
(`MQL5/Logs/20260708.log` under the MetaTrader 5 install dir, not the Common Files location used by
the earlier audits) and found the exact mechanism in real time:

- `EMA_FAST_M5` failed on **every** scan attempt with `err=4807` (`ERR_INDICATOR_DATA_NOT_FOUND`) —
  the exact error this file's own v6.17.1 comment already documents as *"a transient MT5 quirk at
  new-bar boundaries,"* not a real handle problem.
- Despite that, hitting `InpIndicatorReloadFails` (3) consecutive 4807s still triggered a full
  handle rebuild every time. The live evidence proves this does not help: the freshly-rebuilt
  handle copied successfully **exactly once**, then failed with the same `err=4807` again almost
  immediately — repeating in a ~90s rebuild → 12s warmup → fail loop that ran for **20+ minutes
  straight (1178+ seconds observed), zero completed scans**, independent of whether a position was
  open. This single mechanism explains both the earlier position-open finding and the new flat
  finding — they are the same bug, not two separate ones.
- Separately, the watchdog's own `"SCAN WATCHDOG: forcing entry scan"` `Print` was completely
  unthrottled — the live journal showed 14+ identical lines within a single second for the entire
  duration of the stall.

### Fix
- `CopyEntryBuffer()`: a `!staleHandle && err == 4807` failure no longer triggers the disruptive
  rebuild/backoff/warmup cycle — it logs `INDICATOR_TRANSIENT_4807` and simply retries next tick
  (which is what actually recovers it; every observed 4807 cleared within 1-2 ticks once rebuilds
  stopped interrupting that recovery). A safety ceiling (`max(20, InpIndicatorReloadFails*10)`
  consecutive fails) still escalates to the normal rebuild path if this ever turns out not to be
  transient in some other scenario — genuinely stale handles, and every other error code, are
  completely unaffected by this change.
- Watchdog `Print` now throttled to `InpScanSkipLogSec` (same cadence as the existing `SCAN IDLE`
  message) instead of firing every tick.
- Added the requested explicit scan-cycle state logging: `SCAN_STARTED` before indicator loads,
  `SCAN_ABORTED reason=<exact g_lastSkipReason>` at all 14 indicator-buffer abort points, and
  `SCAN_COMPLETED_CANDIDATE`/`SCAN_COMPLETED_NO_TRADE` after `XAU_RecordMarketSnapshot()`. All
  three are deduplicated (`XAU_LogScanState`/`XAU_LogScanAborted`): identical consecutive states
  print once, then resurface at most once per 60s if the condition persists — not once per tick.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61713_scan_watchdog_spam_and_4807_static.py` — 15/15 passing
- [x] Full suite: 376/436 passing, remaining failures are pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.13.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION — this is a real, live-journal-proven root cause with a targeted
  fix, but confirm on the next session that `MARKET_SNAPSHOT`/`SCAN_COMPLETED_*` events actually
  appear at normal cadence and the `INDICATOR_TRANSIENT_4807` path is genuinely resolving on retry
  rather than accumulating toward the safety ceiling

---

## v6.17.12 — 2026-07-08 — Scan Watchdog Timing Fix

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.12"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.12.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61712_final.log`)

### Evidence
A background direction-recognition-latency audit
(`audits/xau_direction_recognition_latency_audit_2026-07-07_to_2026-07-08.md`) reconstructed 8
executed trades and found the EA logs **zero `MARKET_SNAPSHOT`/`BLOCK_CHECK` events for the entire
duration any position is open** — confirmed 8/8, zero exceptions, up to a 40-minute gap on one
trade. This is what made a specific user-flagged trade (BUY at a local high → SL → SELL 92 seconds
later) look like a "reverse after failure": the SELL was actually a fresh, independently-scored
A-grade decision — the EA simply couldn't see the market reverse during the 40-minute BUY hold, and
by the time it looked again the move was already largely finished.

### Trace performed, and what it did and did not find
Exhaustively traced the entire `OnTick()` pipeline from function start through
`XAU_RecordMarketSnapshot()`: every `CountMyPositions()`-gated branch, `ManageBasket()`'s and
`XAU_BasketLifecycleManager()`'s full return-statement semantics, the `newM5Bar` gate,
`entryExecutionBlocked`'s only usage site, `IsXAUFastSymbol()`, `XAU_UpdateBlockedSignalOutcomes()`.
**No single explicit "if a position is open, suppress all market evaluation" line was found** — the
code's own comments explicitly document the opposite intent ("market analysis continues... fresh
entries are blocked"). This is disclosed honestly rather than presented as a full root-cause fix.

What **was** found and fixed, independently valuable regardless of the exact stall trigger: the
scan-recovery watchdog (`InpScanWatchdogMin`, meant to force a fresh scan if none has completed in N
minutes) was stamping its own timing anchor (`g_lastEntryScanAt`) **before** the scan pipeline even
reaches `ScoreSetups()`/grade computation/Personality Gate/SmartGuard/`XAU_RecordMarketSnapshot()` —
meaning any early return anywhere in that ~450-line span was invisible to the watchdog, since the
anchor had already advanced. This explains why `InpScanWatchdogMin=7` (minutes) did not recover from
the observed 40-minute gap: the watchdog believed scans were succeeding the whole time. Moved the
stamp to immediately after `XAU_RecordMarketSnapshot()` completes, so the watchdog now measures
actual scan completion — this is a safety net that forces recovery within 7 minutes of ANY silent
early return in that span, independent of which specific line causes it.

### Not done in this release (explicitly scoped out, not silently dropped)
The user separately asked for a much larger feature: lightweight closed-bar market/thesis
evaluation *while a position remains open* (thesis-still-valid check, opposite-structure detection,
exit-warning/reverse-preparation logic, runner-continuation logic), plus a review of why the SELL
leg of the flagged trade was closed for +$35 via `PROFIT_FLOOR` while price ran another $314/8.98
ATR in its favor within the hour. The profit-floor exit is the same `XAU_ProtectPeakProfitFloor`
mechanism already touched in v6.17.6/6.17.7 this release cycle, and matches the "cuts winners too
early" pattern already documented in the original counterfactual audit — a tuning/design question,
not a discrete bug, that needs its own evidence-based pass rather than a rushed change appended
here. Both are real, well-scoped follow-ups, not abandoned.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61712_scan_watchdog_timing_static.py` — 8/8 passing, confirms the
      watchdog stamp moved to after `XAU_RecordMarketSnapshot()`, the old premature stamp location
      is gone, `g_lastEntryBarSeen` tracking is untouched, and the watchdog input/bypass logic is
      unchanged
- [x] Full suite: 364/421 passing, remaining failures are pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.12.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION — watch the journal for whether `MARKET_SNAPSHOT`/`BLOCK_CHECK`
  events now appear during position holds (if the watchdog fires, a `⚠ SCAN WATCHDOG: forcing entry
  scan` line will show why); this is a safety-net fix for a confirmed symptom, not a proven root
  cause, so continued observation matters more than usual for this release

---

## v6.17.11 — 2026-07-08 — AI Advisory-Only Architecture

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.11"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.11.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61711_final.log`)

### Root cause #1 — mislabeling bug (not an AI decision at all)
Live Command Center showed "Blocked by AIDirector" for a candidate whose detailed reason was
"B-GRADE QUALITY BLOCK ... fastScore=30/85 required=70" — a 100% deterministic `AdaptiveXAUConfirm()`
output with zero AI-model involvement. Traced to `CloudPostReasoning()`'s module classifier:
`StringFind(upperReason, "AI") >= 0` matched the substring "AI" inside the word "AGAINST" (e.g.
"M15:AGAINST"), which is SmartGuard's own deterministic per-timeframe confirmation text. Fixed by
checking for real, specific AI-authored message prefixes ("AI DIRECTOR", "[AI-", "AI=", etc.)
first, before falling back to the old substring guesses.

### Root cause #2 — genuine AI veto authority (a real problem, not hypothetical)
Auditing the actual "GATE 5: AI DIRECTOR" section found **six separate hard-block (`return;`) paths**
driven by real AI-model output (disagreement, low confidence, confident skip), all reachable under
the **default** `AI_FILTER_ONLY` mode — `XAU_AIIsAdvisoryOnly()` used to return `false` for that
mode specifically (its own old comment: "AI keeps real block/reduce authority"). All six converted
to advisory-only: log the AI's opinion/confidence/disagreement strength, apply at most a mild lot
reduction, never `return`/block. `XAU_AIIsAdvisoryOnly()` is now hardcoded to always return `true`
— the single, permanent, mode-independent source of truth every AI-gated path in the file reads
(including the exit-side `AIBlocksClose()` veto), so AI can never regain authority through
`InpAIMode`/`InpAIAdvisoryOnly` being changed back. `InpAIMode` still controls whether AI is called
at all (`AI_OFF`) and whether its opinion is logged — only its *authority* is now fixed.

Caught a subtlety during self-review: making `XAU_AIIsAdvisoryOnly()` always `true` would have made
the generic `if(XAU_AIIsAdvisoryOnly()) {...ADVISORY...}` short-circuit (which used to sit first in
the if/else-if chain) swallow every one of the 6 specific branches as dead code, losing their
richer, more useful advisory detail (HTF-override context, disagreement strength, confidence-based
sizing). Removed that short-circuit so the specific branches — all now safe — actually run.

### Direction Engine speed
User asked for faster reaction to genuine market-direction changes. `InpMaxTransitionWaitBars`
tightened from 6 to 3 (30min → 15min) — TRANSITION_WAIT now releases to BOTH_ALLOWED sooner when
structure hasn't confirmed either way, letting the v6.17.8-10 fresh-M15/M30-override fixes engage
sooner instead of sitting on a stale directional lock.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61711_ai_advisory_only_static.py` — 21/21 passing, explicitly proving:
      AI disagreement/low-confidence/confident-skip/timeout/budget-skip/no-response cannot block;
      the mislabeling classifier no longer mistakes deterministic text for AI; AI agreement path
      untouched; `XAU_AIIsAdvisoryOnly()` hardcoded unconditionally
- [x] Updated `tests/test_xau_v6160_direction_engine_v2_and_risk_reconcile_static.py` (2 tests) and
      `tests/test_xau_v6174_transition_wait_overstay_guard_static.py` (1 test) for the intentional
      architecture change
- [x] Full suite: 359/413 passing, remaining failures are pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.11.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION — confirm AI opinion still logs correctly (Print output +
  Command Center `Auth=ADVISORY`) and that no trade gets silently held up by a residual AI code
  path; watch a live session before fully trusting unattended

### Note: unrelated git housekeeping mid-session
Partway through this release, the local checkout was found on a stale branch
(`vps-test-v615-fixed`, pointing at old commit `cb3b186`/v6.15.0) instead of `main` — origin unclear,
did not happen via any command run in this session. `main` was confirmed untouched and fully intact
at `463fef2` (v6.17.10) throughout; the AI-advisory work was redone cleanly on `main` after
switching back. Flagging this so the user is aware a branch switch happened outside this session's
own actions, in case it reflects other work in progress on the VPS.

---

## v6.17.10 — 2026-07-08 — Personality Gate Symmetric Recheck (evidence-driven)

### EA Compile
- [x] EA internal version: `#define XAUAI_EA_VERSION "v6.17.10"` (`#property version` capped at
      "6.180" — MQL5 requires strict xxx.yyy numeric format, 4-digit patch "1710" fails as
      warning 68; this field is MQL5-Market-only bookkeeping, unrelated to the real version string)
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.10.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v61710_final2.log`)

### Evidence this release is based on
User asked for a real opposite-direction counterfactual audit before any more code changes — not
another general plan. A background analysis job reconstructed all 107 blocked signals from
2026-07-06 to 2026-07-08 that lost or had no clear edge in their own proposed direction, and tested
what the OPPOSITE direction would have done from the same decision timestamp using the EA's own
logged forward-excursion data (`favATR`/`advATR` inversion, enriched with real `MARKET_SNAPSHOT`
M5 price prints where available — see
`audits/xau_opposite_direction_counterfactual_audit_2026-07-06_to_2026-07-08.md` for full
methodology, data sources, and honest limitations).

**Headline finding: 27 of 87 `CLEAN_1R_LOSS` blocked signals (31%; 44% of the 61 that were even
tradeable) would have won if the opposite direction had been evaluated from the same timestamp.**
Broken down by blocker type, **`Personality mismatch` was both the LARGEST sample (17 of 87) and
the BEST-performing category (47% opposite-win rate)** — larger and better than `SMART-GUARD` (7
signals, 43%), which v6.17.9 already covered. The Personality Gate itself had **zero** symmetric
recheck before this release.

The audit also confirmed `A+ EVIDENCE DEMOTION` is the WORST-performing category (1 of 5 wins, 4
both-directions-bad) — checked the code and confirmed that reason is generated in
`XAUEntryTimingGuard()`, which runs strictly *after* SmartGuard in the pipeline, so neither this
fix nor v6.17.9's SmartGuard recheck can reach it at all. No speculative change was made there.

### What changed
Added a Symmetric Opportunity Recheck at the Personality Gate's hard-block site (previously a bare
`return;`), structurally similar to v6.17.9's SmartGuard recheck but simpler: because this gate
runs *before* grade computation/SMC-conflict/SmartGuard in the pipeline, swapping in the opposite
candidate here means it naturally flows through all of that existing code once swapped — no
duplicated grade/SMC logic needed (unlike the SmartGuard site, which required extracting a grade
helper and re-running the SMC check, since those run earlier for the original direction there).

The opposite candidate must independently fit personality (or qualify via the same A/A+
"penalty-but-proceed" threshold, receiving the same -1.5 penalty for consistency) before being
swapped in — no free pass just for arriving via the retry path. Active Direction eligibility
(BUY_ONLY/SELL_ONLY/TRANSITION_WAIT's weakening-side rule) is checked identically to the v6.17.9
SmartGuard recheck.

**Every other candidate rule the audit's evidence supported was already satisfied by v6.17.9's
existing design, verified rather than assumed**: direction-agnostic hard gates (spread, most news
blocks) never reach either recheck since they're separate code paths; same-cycle-only evaluation
already respects the audit's "15-minute confirmation window" finding; the mid-timeframe-vs-H1
disagreement pattern the audit flagged as weak evidence (n=11) is already implicitly used via
`AdaptiveXAUConfirm`'s own M5/M15/M30/H1 reads.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v61710_personality_gate_symmetric_recheck_static.py` — 10/10 passing,
      including an explicit test confirming `XAUEntryTimingGuard` (A+ EVIDENCE DEMOTION) is
      untouched by any recheck mechanism
- [x] Full suite: 341/387 passing, remaining failures are pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.10.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION — watch the journal for `PERSONALITY-GATE SYMMETRIC RECHECK`
  lines and confirm a swapped-in trade executes cleanly before fully trusting it unattended, same
  as v6.17.9's SmartGuard recheck

---

## v6.17.9 — 2026-07-08 — Symmetric Opportunity Recheck

### EA Compile
- [x] EA internal version: `#property version "6.179"`, header banner updated
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.9.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6179_final2.log`)

### What changed
User's explicit complaint: a candidate proposed in one direction gets blocked at SmartGuard
because fast timeframes disagree, and the EA just ends the cycle instead of checking whether the
OPPOSITE direction has real evidence right now. v6.17.8 only fixed this for one setup
(TREND_PULLBACK) at the direction-selection step. This release adds a general, cross-setup
mechanism:

1. **`ScoreSetups()` gained an `excludeDir` parameter.** All 10 bestScore commit points (9 setups,
   RANGE_REVERSAL has 2 branches) now skip any candidate whose direction equals `excludeDir`. This
   lets the recheck ask "what is the best candidate in the OTHER direction only" honestly — it
   returns 0 if no real evidence exists on that side, nothing is fabricated.
2. **Symmetric Opportunity Recheck at the SmartGuard block site.** When a candidate dies at
   SmartGuard (and Active Direction doesn't explicitly forbid the opposite side — respects
   BUY_ONLY/SELL_ONLY/TRANSITION_WAIT's weakening-side rule exactly as the existing Direction
   Engine gate does), it now calls `ScoreSetups(excludeDir=original)`, computes a real grade for
   whatever it finds via a newly extracted `XAU_ComputeCombinedGradeForCandidate()` (same formula:
   floor, regime-direction bonus, HTF-consensus bonus, accelerated-learning adjust, grade
   thresholds — not an approximation), re-checks personality fit, re-runs the SMC hard-structural-
   conflict check (`SMC_GetScoreBonus`/`SMC_GetConflictPenalty` — see self-review note below), and
   re-runs `AdaptiveXAUConfirm` for the opposite direction. Only if ALL of that passes does it swap
   in the new candidate and fall through to the rest of the pipeline (AI, memory, news, risk
   reconciliation, OpenTrade) — never opens both directions, this REPLACES the dead candidate.
3. **TREND_PULLBACK's fresh-M15/M30 override (v6.17.8) extended to TRANSITION_WAIT**, not just
   BOTH_ALLOWED — TRANSITION_WAIT is supposed to actively search both directions, not freeze.
4. **RANGE_REVERSAL's BUY and SELL branches got the same fresh-M15/M30-vs-stale-htfTrendDir fix**
   TREND_PULLBACK got in v6.17.8.
5. **Full telemetry**: every recheck logs `SYMMETRIC_OPPORTUNITY_RECHECK | OriginalCandidateDirection
   | OriginalBlocker | OppositeRecheckTriggered | OppositeCandidateFound | OppositeCandidateStrategy
   | OppositeCandidateScore | OppositeFinalDecision | OppositeFinalBlocker`.

### Self-review finding (caught before shipping, not after)
First implementation swapped in the opposite candidate and fell through, but a careful trace of
what runs between `ScoreSetups()` and the SmartGuard block in the existing pipeline found the SMC
hard-structural-conflict check (`SMC_GetScoreBonus`/`SMC_GetConflictPenalty`, which downgrades
grade straight to SKIP on a real structural conflict) only ran ONCE, earlier in the cycle, for the
ORIGINAL direction — the retry candidate would have silently bypassed it entirely. Fixed by
re-running the same SMC check for the opposite direction before allowing the swap.

**Known, disclosed scope limit**: three narrower, B-grade-specific quality checks further down the
original pipeline (`ApplyAntiBiasCorrection`, the FIX-C regime-based B-grade demotion, and the
DAMAGE-B-QUALITY setup-name check) are NOT re-run for the retry candidate. These only apply when
the retry candidate's grade is B (never A/A+), and are quality refinements, not hard structural
safety gates — SmartGuard, Active Direction, and the SMC hard-conflict check (the actual hard
gates) are all preserved. Flagged as a well-scoped follow-up if full fidelity is wanted.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v6179_symmetric_opportunity_recheck_static.py` — 15/15 passing
- [x] Updated `tests/test_xau_v6178_trend_pullback_stale_htf_deadlock_static.py` and
      `tests/test_xau_v6170_stale_htf_direction_fix_static.py` for the TRANSITION_WAIT extension
      and RANGE_REVERSAL fresh-read override
- [x] Full suite: 334/382 passing, remaining failures are pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.9.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NEEDS OBSERVATION — new control-flow path (candidate swap mid-function); watch
  the journal for `SYMMETRIC_OPPORTUNITY_RECHECK` lines and confirm a swapped-in trade executes
  cleanly end to end before fully trusting it unattended

---

## v6.17.8 — 2026-07-08 — Fix: TREND_PULLBACK stale-HTF ~24h deadlock

### EA Compile
- [x] EA internal version: `#property version "6.178"`, header banner updated
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.8.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6178_final.log`)

### Root cause (proven from the live MT5 journal, v6.17.7, 2026-07-08 00:50-03:45)
Gold moved 4145 -> 4097 -> 4120 and the bot did not trade for ~24 hours. Command Center showed a
repeating pattern: TREND_PULLBACK proposes BUY, SmartGuard blocks it because "multiple fast TFs
against BUY" (fastScore 0-20/85, required 50), same result every 5-10 minutes for hours (00:50,
01:20, 01:30, 01:35, 01:45, 03:00, 03:10, 03:20, 03:25, 03:35, 03:40, 03:45 all logged this exact
block). Active Direction was `DIRECTION_BOTH_ALLOWED` at every one of these timestamps — neither
direction was structurally forced.

Traced to two DIFFERENT measures of "trend direction" disagreeing for hours: `htfBullConsensus`
(`h1TrendDir`/`htfTrendDir`, an EMA-vs-EMA CROSS measure — slow, lagging) stayed bullish, while
SmartGuard's own `AdaptiveXAUConfirm`/`TFDirectionByEMA` (a PRICE-vs-single-EMA measure — fast,
current) showed M15/M30/H1 all reading bearish. TREND_PULLBACK's direction fallback trusted the
slow measure whenever Active Direction was neutral, so it proposed the same doomed BUY candidate
every single cycle — a real, observed, hours-long propose-then-block deadlock, not correct
selectivity.

### Fix
When Active Direction is `DIRECTION_BOTH_ALLOWED` (genuinely undecided) and `htfBullConsensus`/
`htfBearConsensus` picked TREND_PULLBACK's candidate direction, check the same fast M15+M30
price-position reads SmartGuard is about to check anyway. If BOTH independently disagree with the
picked direction, defer to them instead — consistent with this codebase's own stated design
("M5/M15/M30 carry the hard decision; H1 is soft context", per `TFDirectionByEMA`'s own comment).
Requires BOTH M15 and M30 to agree (not just one) to avoid flipping on single-timeframe noise.
Does not touch SmartGuard, does not touch Adaptive Direction's STRONG/MEDIUM/WEAK tiers, does not
let A/A+ bypass any hard structural contradiction, does not force trades — it only stops candidate
*generation* from repeatedly proposing a direction that's about to fail its own downstream check for
reasons the setup already had the information to see.

Also added `MissedSymmetricOpportunity=YES/NO` telemetry at the SmartGuard block site (checks
whether the opposite direction would have passed the same fast-TF confirmation right now) — covers
every other setup too and gives direct runtime evidence of whether this fix is sufficient.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v6178_trend_pullback_stale_htf_deadlock_static.py` — 9/9 passing
- [x] Full suite: 322/367 passing, same class of pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.8.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — needs a clean observation window confirming the deadlock is actually broken
  (a SELL candidate reaching execution during a BOTH_ALLOWED + fast-TF-bearish stretch) before
  trusting it live

---

## v6.17.7 — 2026-07-07 — Surgical correctness repair (9 independently-verified static-audit items)

### EA Compile
- [x] EA internal version: `#property version "6.177"`, header banner updated
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.7.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6177_final.log`)

### Scope
User supplied 9 independently-verified static-audit findings with an explicit instruction not to
lower thresholds, remove SmartGuard/Adaptive Direction, or change lot-sizing/NoLimit philosophy --
fix the actual logic defects only. All 9 verified against the real code before editing (none taken
on faith); one claim (item 3, Personality Gate control flow) initially looked correct on a first
read and was only confirmed as a real bug via programmatic brace/keyword verification.

1. **Array-index series-semantics bug, 8 functions** (`STI_ComputeExhaustion`, `VolatilityKillReason`,
   `HasExhaustionDivergence`, `IsMomentumWeak`, `IsXAUConfirmedBreakoutContinuation`, `IsFakeBreakout`,
   `ManageBasket`'s dynamic basket momentum block, `PG_HTFTrend`) -- MQL5 fills a plain (non-series)
   fixed array from `CopyBuffer`/`CopyOpen`/`CopyHigh`/`CopyLow`/`CopyClose` with index 0 = OLDEST
   requested bar, not newest; all 8 functions' arithmetic assumed the opposite. First attempt
   (`ArraySetAsSeries` on the existing fixed arrays) produced compiler warning 63 "cannot be used for
   static allocated array" -- caught before it shipped as a silent no-op. Fix: converted every
   affected declaration from fixed-size to dynamic (`double x[N]` -> `double x[]`) so
   `ArraySetAsSeries(x, true)` actually takes effect.
2. **`ComputeADXProxy` 10x scale bug** (regression A) -- `spread / 0.0040 * 10.0` produced 2.5/3.5 for
   0.10%/0.14% spread where the function's own comment documents 25/35. `ClassifyMarketPersonality()`
   almost never crossed its ADX>20/ADX>35 thresholds and fell through to `MKT_RANGE` far more often
   than real trend strength justified -- the direct root cause of the PERSONALITY-vs-BREAKOUT
   contradiction fixed in v6.17.6. Fixed the multiplier to `100.0`.
3. **Personality Gate A/A+ unreachable-proceed bug** (regression E) -- the breakout-continuation/
   momentum-override soft-pass chain (`if(continuationPersonalitySoftPass...) ... else if(...) ...
   else { hard block; return; }`) was a STANDALONE `if`, not chained to the A/A+ branch above it via
   `else`. An A/A+ candidate took its documented -1.5 penalty AND THEN separately fell into this
   chain too -- unless it also happened to qualify for one of the soft-passes, it hit the chain's own
   final `else` and was hard-blocked + returned anyway, completely undoing "A+ setups: never
   hard-block" (the function's own doc comment). Fixed by chaining as `else if`.
4. **`OpenTrade` void->bool, deferred state commitment** (regression F) -- changed signature to
   `bool`; all 24 early-exit paths now `return false`, only a confirmed `trade.Buy`/`trade.Sell`
   result returns true/false. Both call sites (RE_ENTRY, main entry) updated so `todayReEntryCount`/
   `lastClose.reEntered`/`g_lastEntryGrade`/`g_lastEntryScore`/dashboard state/the "TRADE OPENED"
   scorecard entry are only committed on a confirmed fill -- a risk block, broker rejection, or any
   other early-exit no longer permanently burns a re-entry slot or claims a trade that never
   happened. Pyramid state (`CheckPyramidOpportunity`) was audited and found already correctly gated
   on its own `if(ok)` -- no change needed there, locked in with a regression test.
5. **Neutral-HTF early-return bug** (regression G) -- `sequenceStillAgrees`/`noBosLevelBreakAgainst`/
   `noWeakSignalEither` were all vacuously true whenever `htfBias==0`, so the "normal pullback" early
   return fired unconditionally on neutral HTF, before the STRONG/MEDIUM M5/M15 tier checks ever ran.
   Gated the early return on `htfBias != 0`; STRONG/MEDIUM's primary conditions are already
   HTF-independent and now correctly evaluate on raw M5/M15 evidence when HTF is neutral.
6. **Global -> per-label indicator fail streaks** (regression H) -- `g_indicatorBufferFailCount` was
   one counter shared across all 14 entry-buffer labels; an unrelated transient blip on two different
   indicators combined toward the same rebuild threshold. New `XAU_IndicatorFailStreakIndex`/
   per-label `g_indFailCounts[]`/`g_indFailAtTimes[]` track each label independently; a label's own
   successful copy resets only its own streak.
7. **`XAU_AssessFailedBreakout` impossible condition rebuilt** (regression D) -- received the
   caller's `swingHigh`/`swingLow` (computed over shifts 2-19) and tested shifts 2-7 (a strict
   subset) against that same range, so `close[i] > swingHigh` was mathematically impossible
   (`close[i] <= high[i] <= swingHigh` always, since `high[i]` is itself part of `swingHigh`'s max).
   This function was dead code. Rebuilt to compute its own prior range from shifts 8-19 (excluding
   the shift 2-7 test window entirely) before checking for a break-then-reclaim.
8. **`XAU_ProtectPeakProfitFloor` unreachable `THESIS_HOLD_BE_REARM` branch** (regression I) -- an
   earlier revocation (`if(thesisHoldAllowed && !floorAlreadyProtected && profit <= floorUSD)
   thesisHoldAllowed = false;`) had no lower bound, and `profit <= 0.0` (the BE-rearm branch's own
   trigger condition) always implies `profit <= floorUSD` (floorUSD is always > 0) -- so
   `thesisHoldAllowed` was always already false by the time the BE-rearm branch's condition was
   checked. Narrowed the revocation to `profit > 0.0` only, so the "round-tripped to/below breakeven
   while thesis still valid" case it was built for can actually reach it.
9. **M15 structure breaks now use M15 ATR, not M5 ATR** -- `m15BearBreak`/`m15BullBreak` reused
   `structBuf` (scaled from M5 ATR), too tight for M15-level break detection given M15's inherently
   larger bar ranges. Added a dedicated `structBufM15` from a fresh M15 ATR read; M5 checks unchanged.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v6177_surgical_correctness_repair_static.py` — 27/27 passing, covering all
      9 items and all 9 named regression cases (A-I) with real arithmetic checks where applicable
      (e.g. `0.0010/0.0040*100.0 == 25.0`)
- [x] Fixed 8 pre-existing tests that broke on landmark/architecture changes from this release (not
      dismissed as stale): `test_xau_prop_firm_mode_static.py` and `test_xau_v5850_evidence_refactor_static.py`
      searched for `"void OpenTrade("` as a landmark (now `bool`); 3 tests in
      `test_xau_v6171_indicator_handle_lifecycle_fix_static.py` asserted the old global
      `g_indicatorBufferFailCount` mechanism directly superseded by item 6's per-label streaks; 3
      window-size tests needed widening after longer explanatory comments pushed target code further
      from their markers; `test_release_labels_static.py` needed the `server.py` `ea_version` default
      bumped
- [x] Full suite: 316/358 passing; the 42 remaining failures are individually confirmed (not assumed)
      pure version-snapshot identity/string checks — none reference Direction Engine, SmartGuard, AI
      mode, indicator recovery, OpenTrade, or broker execution behavior

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.7.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — this is the largest single correctness pass of the session (9 independent
  defects across array indexing, scale math, control flow, and state-commitment timing); needs a
  full clean observation window confirming each fix's behavior matches intent before any live capital

---

## v6.17.6 — 2026-07-07 — Profit-impact audit: PERSONALITY soft-pass needlessly AI-gated

### EA Compile
- [x] EA internal version: `#property version "6.176"`, header banner updated
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.6.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6176_final.log`)

### Context
Between v6.17.4 and this release, a second tool ("Codex") shipped **v6.17.5** directly to this repo
(commit `19e2c49`) adding execution-funnel telemetry (`CandidateAllowed`/`FinalExecutionAllowed`/
`FinalBlocker`/`OpenTradeCalled`/broker retcode, distinguishing candidate-stage approval from final
execution in the Command Center) and a first attempt at exempting confirmed breakout continuation
from the PERSONALITY gate (`continuationPersonalitySoftPass`). This release investigates and closes
a gap in that same fix, using real journal evidence, per a user-requested full profit-impact audit
of the late-stage execution funnel.

### Root cause (proven from the live MT5 journal, not assumed)
2026-07-07 19:55:11 (running v6.17.4, i.e. before Codex's v6.17.5 fix existed): Active Direction held
`DIRECTION_SELL_ONLY [STRONG tier]` (confirmed LH/LL reversal), `currentRegime` had already confirmed
`REGIME_BREAKOUT_DOWN`, and a BREAKOUT SELL candidate at price 4126.63 was hard-blocked:
`PERSONALITY GATE BLOCK: BREAKOUT grade not A/A+ in RANGE — skipping` — because `g_marketPersonality`
(a separate, slower ADX/ATR-based classifier) still read `MKT_RANGE`. Price fell to a confirmed swing
low of 4092.19 within the next hour (~34pts, ~3.4R at this EA's typical SL distance), with the
Direction Engine holding STRONG SELL essentially the whole way and no meaningful adverse excursion
first — a real, quantified missed trade.

Checked Codex's v6.17.5 fix against this exact scenario: `continuationPersonalitySoftPass` (confirmed
breakout continuation + regime alignment + Active Direction not hostile) is structurally correct, but
was gated behind `XAU_StructuralBypassAllowed()` — which only opens under `InpAIMode=AI_DIRECTOR`, not
the default `AI_FILTER_ONLY`. So the fix could never fire under default settings. Same Category A
(structural) vs Category B (AI-opinion) miscategorization already fixed at other sites this session —
this exemption is objective market-fact evidence, not an AI opinion, so it shouldn't need an AI
authority mode at all.

Also investigated (per the audit request) two SQUEEZE_RELEASE SELL candidates blocked the same day by
"momentum slowdown" (PROFIT GUARDIAN) and "FAILED-IMPULSE BLOCK". Traced both to real price action:
both were genuine late chase-entries into an already-exhausted move (the swing low of 4092.19 was
already established *before* either signal fired; price never made a new low after). **Those blocks
were correct selectivity, not overblocking — deliberately left untouched.**

### Fix
Split the PERSONALITY-gate softening path: `continuationPersonalitySoftPass` now only requires
`!XAU_AntiRepeatLossActive(signal)` (the baseline safety check every bypass in this codebase keeps),
no longer `XAU_StructuralBypassAllowed()`. `strongMomentumPrecheck` (the AI-opinion-flavored
STRONG_MOMENTUM_OVERRIDE path) keeps both gates, consistent with every other STRONG_MOMENTUM_OVERRIDE
site fixed this session. This is a narrow, evidence-backed carve-out — not a general loosening of
PERSONALITY-gate bypass conditions.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v6176_personality_breakout_gate_fix_static.py` — 8/8 passing
- [x] Updated Codex's `tests/test_xau_v6175_execution_funnel_static.py` assertion that had locked in
      the old (buggy) gating requirement
- [x] Full suite: 290/331 passing, same class of pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.6.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — needs a clean observation window showing a confirmed breakout continuation
  actually reaching execution under default AI_FILTER_ONLY mode, not just compiling

---

## v6.17.4 — 2026-07-07 — Fix: TRANSITION_WAIT overstay guard

### EA Compile
- [x] EA internal version: `#property version "6.174"`, header banner updated too
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.4.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6174_final.log`)

### Root cause
User reported v6.17.2 reaching the Direction Engine correctly but repeatedly blocking with "no
setup met regime criteria" while `Active Direction: DIRECTION_TRANSITION_WAIT` held for multiple
consecutive M5 bars. Traced to `XAU_ComputeActiveDirection()`'s WEAK-tier opposition check:
`XAU_AssessFailureAndSweep()` is a *rolling* 8-bar lookback comparison, not a one-time event flag,
so a genuinely choppy/grinding market can keep re-triggering "failed continuation against HTF bias"
bar after bar without any single break ever confirming a real reversal. The pullback-recognition
branch (which would release to `DIRECTION_BOTH_ALLOWED`) is explicitly gated off by
`noWeakSignalEither` whenever that flag is true, so there was no time-bounded escape — only a
fresh MEDIUM/STRONG-tier break in either direction could end it. Result: both directions held
closed indefinitely during real chop, a de facto permanent no-trade state.

### Fix
Added `g_transitionWaitStreak` (consecutive TRANSITION_WAIT bars, any cause) and
`InpMaxTransitionWaitBars` (default 6, matching the ~6-7 bar streaks observed in the actual live
journal). `XAU_ResolveOrReleaseTransitionWait()` releases to `DIRECTION_BOTH_ALLOWED` with a clear
logged reason once the cap is exceeded. Does NOT touch the STRONG/MEDIUM confirmation thresholds
themselves — a genuine bullish continuation or bearish flip still unlocks BUY/SELL the same bar it
confirms; this only bounds how long *pure indecision* can hold both directions closed.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v6174_transition_wait_overstay_guard_static.py` — 10/10 passing
- [x] Full suite: 281/315 passing, same class of pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.4.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, header banner updated
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — needs a clean observation window showing TRANSITION_WAIT actually releasing
  after the bar cap during real chop, not just compiling

---

## v6.17.3 — 2026-07-07 — Full-file audit: 6 more stale-HTF/bypass gaps + site version-banner bug

### EA Compile
- [x] EA internal version: `#property version "6.173"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.3.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6173_final.log`)

### Trigger
User asked for a full debug pass across the EA, backend, and site rather than one bug at a time.
Launched three parallel audits (EA architecture, backend server.py, frontend/site).

### EA findings and fixes
1. **STRONG_MOMENTUM_OVERRIDE's B-grade-quality bypass and Personality-Gate bypass had NO
   anti-repeat-loss guard and NO `XAU_StructuralBypassAllowed()` gate** — unlike the functionally
   identical SMART-GUARD bypass a few dozen lines away, which had both. Both are live by default
   (`InpXAU_StrongMomentumOverride=true`, `InpXAU_SMO_AllowBGradeBalanced=true`,
   `InpTradeMode=BALANCED_MODE`), so a repeated same-direction B-grade signal could be softened
   into a trade through this side door during an active loss streak — reproducing the 2026-07-03
   incident pattern via an unaudited path. Fixed: both now require
   `!XAU_AntiRepeatLossActive(signal) && XAU_StructuralBypassAllowed()`.
2. **`XAU_BasicStrongMomentumPrecheck`/`XAU_StrongMomentumOverrideAllowed` hard-vetoed on stale
   `g_htfConsensusDir` with no Active Direction exemption** — same bug shape as the already-fixed
   `ScoreSetups()` sites, just in the override-rescue functions themselves. Fixed with the same
   `g_activeDirection`-confirmed exemption pattern.
3. **`XAU_EvaluateAdaptiveNewsMomentumEntry` and `XAU_NewsAftermathCanFastTrack` hard-required
   `htfAligned` with no Active Direction exemption** — could silently kill a legitimate post-news
   reversal for the entire discovery/confirmed/allowed window. Fixed the same way.
4. **Header-banner site-version bug** (see PERMANENT ITEM above) — both `XAUUSD_AI_Sniper_EA.mq5`
   and `XauIndex_EA.mq5` banners updated and verified against the actual `_get_ea_meta()` regex.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v6173_full_audit_stale_htf_bypass_gaps_static.py` — 11/11 passing,
      including a test that runs the actual `_get_ea_meta()` regex against the file to lock in
      correct version/edition parsing
- [x] Full suite: 274/305 passing, same class of pre-existing release-time sync staleness

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.3.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, `backend/ea_code_xauindex/XauIndex_EA.mq5`
- [x] Frontend version strings + hardcoded-fallback fix (`CloudDashboard.jsx` no longer fabricates
      a version number when no real heartbeat/license data exists)
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — same standing as v6.17.0/1/2, needs a clean observation window
- **Backend security findings from this audit round are NOT yet fixed** (unauthenticated AI
  endpoints, cache-poisoning risk, unbounded memory growth) — reported separately, pending decision
  on how to close them without breaking the live AI integration

---

## v6.17.2 — 2026-07-07 — Fix: legacy global anti-trend veto was undoing v6.17.0

### EA Compile
- [x] EA internal version: `#property version "6.172"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.2.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6172_final.log`)

### Root cause (proven from the live journal, same day v6.17.0 shipped)
User asked directly why a specific "no setup met regime criteria" log line was still appearing on
v6.17.1. Pulled the exact log context around it and found the real story one line earlier:
`ADAPTIVE-DIRECTION` correctly confirmed `DIRECTION_SELL_ONLY [STRONG tier]`, and — proof the v6.17.0
fix itself worked — TREND_PULLBACK correctly proposed a SELL candidate this time. But immediately
after, the journal showed: `ANTI-TREND VETO BACKSTOP: TREND_PULLBACK SELL during htfBullConsensus
(should not happen in v6.1.4)`. That backstop, added in v6.1.3/v6.1.4 *before the Direction Engine
existed*, assumed TREND_PULLBACK could never produce a countertrend signal while HTF read bullish —
and zeroed the candidate right back out the moment it did, exactly reversing the v6.17.0 fix. A
second, broader instance of the same veto (the non-backstop "GLOBAL ANTI-TREND VETO" a few lines
above it) applies to every OTHER setup type as well (SQUEEZE_RELEASE, RANGE_REVERSAL, RSI_EXTREME,
LONDON_FIX_PIN, MULTI_EXTREME) — meaning all five other v6.17.0 fixes were silently exposed to the
same reversal, not just TREND_PULLBACK's backstop.

The v6.17.0 fix was necessary but not sufficient: it fixed candidate *generation* inside each setup,
but missed this separate veto *layer* that runs after every setup is scored, at the very end of
`ScoreSetups()`.

### Fix
Both veto blocks now exempt candidates that `g_activeDirection` has already confirmed
(`DIRECTION_SELL_ONLY`/`DIRECTION_BUY_ONLY`, MEDIUM/STRONG tier — real M5+M15 evidence). The veto
still fires exactly as before for any candidate Active Direction has NOT confirmed — this is not a
removal of the safety net, only an exemption for the case the Direction Engine has already validated.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v6172_global_antitrend_veto_fix_static.py` — 7/7 passing: verifies both
      veto sites carry the exemption, confirms the veto still fires unconditionally otherwise, and
      confirms the v6.17.0 direction fix and v6.17.1 indicator-lifecycle fix both survived intact
- [x] Full suite: 265/294 passing, same class of pre-existing release-time sync staleness as every
      prior release

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.2.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — same standing as v6.17.0/v6.17.1: needs a clean multi-hour observation window
  showing a confirmed Direction Engine reversal actually reaching execution before trusting it live

---

## v6.17.1 — 2026-07-07 — Fix: indicator-handle fail-counter rebuild loop

### EA Compile
- [x] EA internal version: `#property version "6.171"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.1.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6171_final.log`)

### Root cause (proven from the live MT5 journal, both local Mac and matching the VPS-reported symptom)
Command Center showed `INDICATOR_WARMUP: waiting Ns after handle rebuild before copying EMA_FAST_M5`
repeating dozens of times. Traced `EMA_FAST_M5`'s full lifecycle end-to-end
(`RebuildEntryIndicatorHandles()` / `CopyEntryBuffer()`): `g_indicatorBufferFailCount` only reset to
0 after a FULLY CLEAN pass of all 14 entry buffers in the same scan. A single buffer's transient
`ERR_INDICATOR_DATA_NOT_FOUND` (4807) blip -- explicitly documented in the codebase's own v5.8.51
comment as a normal, expected, transient MT5 quirk at new-bar boundaries -- therefore accumulated
forever across the session with no decay. Isolated blips hours apart eventually crossed
`InpIndicatorReloadFails` (default 3) and triggered a real handle rebuild + `InpIndicatorWarmupSec`
(12s) warm-up, over and over, even though the handles were never actually broken. Confirmed
reproducing on the local Mac instance too (3 rebuild cycles in the first 17 minutes after v6.17.0
was attached) -- not VPS-specific, a genuine code-level lifecycle bug.

Audited every other fail/streak counter in the codebase (`g_aiTransportFails`, `g_cloudConsecutiveFails`,
`g_sameDirLossStreak`, `g_growthLossStreak`, `g_failedContinuationStreak`, etc.) for the same "only
resets on a full batch success, never decays" pattern -- confirmed none of the others have it; each
resets per individual success or per relevant trading event, not a batched pass. This was an isolated
architectural anomaly specific to the indicator-lifecycle counter, not a systemic pattern.

### Fix
Added `g_lastIndicatorFailAt` timestamp. If a new buffer failure arrives more than 45s after the
previous one, the streak resets to 1 (a fresh incident) instead of continuing to add to a stale count.
Only a genuine CLUSTER of failures close together in time now reaches the reload threshold and
triggers a rebuild. Warm-up duration, recovery backoff, and the reload-fail threshold are all
unchanged -- no safety bypassed, nothing loosened.

Added the requested lifecycle telemetry tags for future diagnosis: `INDICATOR_HANDLE_CREATED`,
`INDICATOR_NOT_READY`, `INDICATOR_COPY_RETRY`, `INDICATOR_HANDLE_INVALID`, `INDICATOR_REBUILD`,
`INDICATOR_RECOVERED`.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v6171_indicator_handle_lifecycle_fix_static.py` — 10/10 passing: verifies
      the decay logic, confirms warm-up/backoff/reload-threshold are untouched, confirms a valid
      handle returns immediately without touching fail state, confirms all 6 telemetry tags exist,
      and confirms the v6.17.0 Active Direction candidate-direction fix survived this change intact
- [x] Full suite: 260/287 passing; failures are the same class of pre-existing release-time sync
      staleness as every prior release in this log

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.1.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — needs at least one clean multi-hour observation window confirming the
  `INDICATOR_WARMUP` cycling has stopped and decision cycles reach `ADAPTIVE-DIRECTION`/strategy
  scoring normally before trusting this on live capital

---

## v6.17.0 — 2026-07-07 — Fix: setups hardcoded direction to stale HTF, never proposed the confirmed reversal

### EA Compile
- [x] EA internal version: `#property version "6.170"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.17.0.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6170_final.log`)

### Root cause (proven from the live MT5 journal, not assumed)
Real complaint: v6.16.x had not opened a trade for ~5h15m (10:55 -> 16:10 on 2026-07-07) despite
meaningful XAUUSD movement. Reconstructed every M5 decision cycle in that window from
`MQL5/Logs/20260707.log`:
- Adaptive Direction Engine was working correctly: it held `DIRECTION_SELL_ONLY [STRONG tier]`
  continuously from 15:00 to 16:10 (M5+M15 structure aligned bearish, confirmed LH/LL reversal) even
  though HTF Bias stayed "Bullish" the whole time -- exactly the adaptive behavior it was built for.
- But zero SELL trades executed. Root cause: `TREND_PULLBACK`, `SQUEEZE_RELEASE`, `RANGE_REVERSAL`,
  `RSI_EXTREME`, `LONDON_FIX_PIN`, and `MULTI_EXTREME` all hardcode their candidate direction to
  `htfBullConsensus`/`h1TrendDir` (stale H1/HTF EMA-spread), so none of them ever proposed a SELL
  candidate while HTF read bullish -- regardless of what the Direction Engine had already confirmed.
  28 `ADAPTIVE-DIRECTION BLOCK: TREND_PULLBACK BUY` events and 33 "no setup met regime criteria"
  (zero candidates in either direction) events logged in the same window. The Direction Engine was
  never the bottleneck; candidate generation was structurally incapable of trying the direction it
  had already permitted.

### Fix
Added an Active-Direction-confirmed override to each of the 6 affected setups: when
`g_activeDirection` is `DIRECTION_SELL_ONLY`/`DIRECTION_BUY_ONLY` (i.e. the Direction Engine has
already confirmed a specific reversal via real M5+M15 evidence, MEDIUM/STRONG tier only), the setup
evaluates that direction instead of blindly following stale HTF bias. The original HTF-alignment
logic is preserved as the fallback for every other case -- this is additive, not a removal of the
existing behavior. `HTF_TREND_FOLLOW` (setup 9) is deliberately NOT given this override, since its
entire purpose is to follow HTF; it stays gated purely by its existing `directionAllowsHtfTf` check.
`ASIA_RANGE_BREAKOUT` (setup 8) needed no fix -- confirmed it already derives direction from actual
price breakout, not HTF bias.

No thresholds were lowered, no gates were disabled, SmartGuard/AI/risk authority is unchanged --
this is a candidate-generation fix, not a permissiveness change.

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] New `tests/test_xau_v6170_stale_htf_direction_fix_static.py` — 8/8 passing (verifies the
      override in each of the 6 fixed setups by name, confirms HTF_TREND_FOLLOW and Asia Range
      Breakout were correctly left alone)
- [x] Full suite: 252/277 passing; 25 failures are the same class of pre-existing release-time sync
      tests (each pinned to an old version snapshot that goes stale the moment any newer version
      ships) -- one more than the v6.16.1 baseline of 24, because the v6.16.0/v6.16.1 regression
      test's own "synced to backend" check is now itself one commit behind, same expected pattern

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.17.0.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — this fix has zero runtime hours itself yet; re-observe the Command Center /
  journal for at least one more multi-hour stretch to confirm SELL/BUY candidates now actually reach
  execution during a confirmed Direction Engine flip before considering live capital

---

## v6.16.1 — 2026-07-07 — Self-audit fix: structural vs AI-opinion bypass split

### EA Compile
- [x] EA internal version: `#property version "6.161"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.16.1.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6161_final.log`)

### Self-audit finding
v6.16.0's `XAU_ModeAllowsSoftBlockWarning()` fix applied one unified rule to all 11 grade-based
soft-bypass call sites. Re-auditing on request surfaced that these are two different categories:
structural/market-fact gates (SmartGuard fast-TF, STI/TRI re-entry watch, news-aftermath, SMC
conflict, AI_LOW_CONF_SKIP) vs. AI's-own-opinion-escalation gates (HTF-override, weak disagreement,
no-confidence skip, confident-B-skip) plus one unrelated permissive feature-gate (Strong Momentum
Precheck). Treating them identically meant AI weak-disagreement on a good structural A+/A setup was
being fully blocked by default rather than allowed through at reduced size — more conservative than
necessary and not what "AI can filter/reduce, cannot override structure" was supposed to mean.

### Fix
Split into `XAU_StructuralBypassAllowed()` (closed by default under AI_ADVISOR_ONLY/AI_FILTER_ONLY/
AI_OFF/RestoreMode, only AI_DIRECTOR opens it — used at the 6 structural sites) and
`XAU_ModeAllowsSoftBlockWarning()` (reverted to its original trade-mode-only logic — used at the 5
AI-opinion/feature sites, which are already inert under ADVISOR_ONLY/RestoreMode since the whole AI
Director cascade short-circuits earlier via `XAU_AIIsAdvisoryOnly()`).

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] `tests/test_xau_v6160_direction_engine_v2_and_risk_reconcile_static.py` updated + expanded —
      20/20 passing (verifies both gates individually, all 6 + 5 call sites by name)
- [x] Full suite: 245/269 passing; the 24 failures are the same pre-existing release-time sync tests
      from v6.16.0 (confirmed unrelated to this change)

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.16.1.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — same standing as v6.16.0, demo-validate both fixes together

---

## v6.16.0 — 2026-07-07 — Direction Engine v2 + Universal Risk Reconciliation

### EA Compile
- [x] EA internal version: `#property version "6.160"`
- [x] EA header comment: v6.16.0
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.16.0.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6160_final.log`)

### Root cause — risk mismatch (live log: Executed=4.27% vs Displayed=0.40%/ConfigBase=1.20%)
Traced the full lot path: `InpLotSizingMode` defaults to `JUNE_16_19_BALANCE_MODE`, which sizes
lots from `(balance/1000) * InpJuneBalanceLotPer1000 * gradeMult` — **not** from actual SL distance.
Worse, the equity-cap (`InpMaxRiskPctEquity`), Growth Guard cap, and aggregate-risk cap are all
explicitly skipped when `juneBalanceLotMode` is true (`grep "risk caps bypassed"`), at both the main
entry path and the pyramid-add path — so under the *default* lot mode, none of the risk-based safety
caps ever ran. `InpRiskPercent` (labeled "Displayed" in the log) was never read by the sizing math at
all — a second, independent cosmetic bug. Fix does NOT change lot-sizing philosophy or shrink normal
trades: `XAU_ReconcileFinalRisk()` is a narrow backstop that only intervenes when the final lot would
truly breach `InpMaxRiskPctEquity` (the EA's existing real hard-cap input), reducing to the maximum
safe lot (rounded down to lot step) or blocking outright if even the broker minimum lot exceeds the
cap. Logs `REQUESTED_RISK_PCT`/`APPROVED_MAX_RISK_PCT`/lot before+after/`ACTUAL_EQUITY_RISK_PCT`/
`RECONCILIATION_ACTION` on every trade.

### Adaptive Direction Engine v2
Upgraded from v6.15.0's 2-tier (medium/strong, M5-only) to a 3-tier WEAK/MEDIUM/STRONG engine:
- New: genuine HH/HL vs LH/LL swing-sequence read (`XAU_SwingSequenceDir`, fractal pivots, reused for
  both M5 and M15) — this is what lets a normal pullback (sequence intact) be told apart from an
  actual breakdown (sequence broken), the explicit goal of the upgrade.
- New: CHoCH is now the real break of the most recent confirmed fractal swing point (from the
  sequence scan), not a relabeled rolling-window proxy.
- New: M15 structure check, feeding a "M5+M15 aligned" path into the STRONG tier.
- New: failed-breakout (`XAU_AssessFailedBreakout`) distinct from failed-continuation — a breakout
  attempt reversing back inside the range, vs. an established trend stalling.
- WEAK tier (new): CHoCH-level warning / failed continuation → `DIRECTION_TRANSITION_WAIT`, pauses
  only the weakening side, never forces the opposite.
- Applied via one central gate (`CheckForEntry`, right after `ScoreSetups()`) covering
  TREND_PULLBACK/BREAKOUT/RANGE_REVERSAL/SQUEEZE_RELEASE/HTF_TREND_FOLLOW/etc. uniformly, plus
  dedicated gates at `RE_ENTRY` and the pyramid rescue family (PYR+RETEST_RESCUE/PYR+RESCUE/PYR+ADV).
  PYR+TRN is a documented exception (only adds to an already-favorable move).
- Exit side: `XAU_ReversalConfirmed()` (the existing v6.5.0 canonical Exit Arbiter) now also treats a
  STRONG-tier opposite flip as confirmed structure invalidation — reuses the entry-side read instead
  of adding a sixth competing exit system.
- Anti-repeat-loss (`XAU_AntiRepeatLossActive`) is now graduated (0.25xATR recovery from the 1st
  same-direction loss, 0.5xATR from `InpAntiRepeatLossStreak`) instead of a single on/off switch —
  never a session-length ban or fixed-time cooldown, always evidence-gated.

### Explicitly NOT changed (per owner instruction — no fear-based defaults)
- `InpAIMode` stays `AI_FILTER_ONLY` default; `InpJune18RestoreMode` stays `false` default.
- `InpNoLimitTradingMode`/`InpDisableAllDailyLocks`/`InpNoDailyLimitMode` still default `true`.
- No new session-length direction bans, no fixed-time cooldowns.
- Risk reconciliation only touches trades that would truly exceed `InpMaxRiskPctEquity` — normal
  trades within cap are untouched; lot-sizing philosophy (grade/AI/enforcement-floor multipliers) is
  unchanged.

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.16.0.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (canonical source; download endpoint reads version dynamically)
- [x] Frontend version strings (Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx, CloudLanding.jsx, CloudDashboard.jsx)
- [ ] GitHub main branch pushed

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] Existing test suite: 243/267 passing; 24 pre-existing failures confirmed via `git stash` to
      predate this session's changes (each is a release-time "source == old versioned snapshot" sync
      test that goes stale the moment any newer version ships — a pre-existing test-suite design
      artifact, not a regression)
- [x] New regression suite `tests/test_xau_v6160_direction_engine_v2_and_risk_reconcile_static.py` —
      19/19 passing
- [ ] MT5 journal: `ADAPTIVE-DIRECTION | ... [STRONG/MEDIUM/WEAK/NONE tier]` line every closed M5 bar
- [ ] MT5 journal: `RISK-RECONCILE | ... RECONCILIATION_ACTION=NONE_WITHIN_CAP` on normal trades (should
      be the overwhelming majority — REDUCED/BLOCKED should be rare)
- [ ] 24h+ demo validation before live capital

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — validate on demo that normal trades are NOT being reduced (only genuine
  cap-breaching ones), and that direction flips react promptly without overblocking, before live capital

---

## v6.15.0 — 2026-07-07 — June 17-18 Reconstruction: Strategy-Led Architecture

### EA Compile
- [x] EA internal version: `#property version "6.150"`
- [x] EA header comment: v6.15.0
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.15.0.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6150_reconstruction.log`)

### Root cause (see full forensic audit; MT5 trade reports 108492408 + 108458093, 79-commit git archaeology, live journal 20260703.log)
Real trade data: TREND_PULLBACK averaged +$81 to +$137/trade on 2026-06-17/18, then
-$1 to -$21/trade afterward — the identical strategy tag, inverted. Root cause:
`XAU_StrongContextForSoftBypass()` (added v6.4.21, 528c080) unconditionally downgraded
any hard structural block to a warning for A/A+ grade with no freshness/session-memory
check, at 9 call sites (v6.13.0's same-day anti-repeat-loss guard only fenced 3). AI
Director (v6.3.0, 401f225) gave AI real veto/lot authority firing on every grade. Three
commits over 48h (06-29→07-01) disabled 9 loss-based lot-reduction mechanisms and every
daily circuit breaker. Five commits (06-19→07-01) added "let it breathe" loss-cutting
requirements with no symmetric requirement on win-banking (avg hold 25.8min→40.4min,
losses growing to -$245/-$328/-$721 while wins stayed ~$41). HTF_TREND_FOLLOW (added
06-26, 93b9492) fired on H1/H4 consensus alone with no M5 trigger — single largest loss
contributor in the dataset (net -$1,622 on one account). Confirmed live in
`MQL5/Logs/20260703.log`: `TRADE-MODE WARNING | gate=SMART_GUARD_FAST_CONFIRM downgraded
hard block to warning | grade=A+` firing repeatedly during the July 3 incident window.

### What shipped
1. `InpAIMode` (AI_OFF/AI_ADVISOR_ONLY/AI_FILTER_ONLY/AI_DIRECTOR), default `AI_FILTER_ONLY`
   — AI_DIRECTOR (legacy full authority) is now explicit opt-in, not the default.
2. `XAU_ModeAllowsSoftBlockWarning()` now returns false for every mode except explicit
   `AI_DIRECTOR` — this is the single choke point all 9 grade-based soft-bypass call
   sites route through, so one function fix closes the loophole everywhere at once.
3. **Adaptive Direction Engine** (`XAU_ComputeActiveDirection`, new): separates HTF Bias
   (context only) from Active Direction (DIRECTION_BUY_ONLY/SELL_ONLY/BOTH_ALLOWED/
   NO_TRADE/TRANSITION_WAIT, computed fresh every closed M5 bar from a real swing
   break + H1 BOS). HTF_TREND_FOLLOW and PYR+RETEST_RESCUE now require Active
   Direction to permit their direction before firing — HTF consensus alone can no
   longer earn an entry against live M5 structure.
4. Exit-side: `XAU_ProtectPeakProfitFloor` no longer takes zero action when a position
   round-trips from peak profit to profit≤0 under thesis-hold — it now re-arms at
   breakeven first (never a downgrade from an already-better SL).
5. `GetPerformanceMultiplier()` rewritten: one bounded, auditable loss-streak lot tier
   (0.85x/0.70x/0.50x at 2/3/4+ same-direction losses) active under
   `InpJune18RestoreMode`, replacing the old 9-mechanism uncontrolled stack — not a
   revival of the old dead code.
6. `InpJune18RestoreMode` (default false): forces AI_ADVISOR_ONLY, keeps no-limit daily
   locks off (`XAU_NoLimitTradingModeActive` now checks this first), and activates the
   loss-streak lot tier — an explicit single-flag opt-in rather than flipping the three
   no-limit defaults directly (those gate ~30 independent code paths; flipping them as
   a side effect of an unrelated change is exactly the kind of thing that causes
   hard-to-trace regressions later).
7. Multi-instance fixes: `_ai_cost_state_hash()` (backend) now buckets account-risk
   state (daily P/L, basket float, loss streak, open positions) so a cached AI verdict
   reasoned about one account's risk posture can't be silently replayed onto another;
   AI daily-call budget/throttle is now per-account (`_ai_cost_stats_by_account`,
   backend) instead of one global pool that starved instances of each other's AI
   opinions; EA sends `account_id` (`ACCOUNT_LOGIN`) on both AI endpoints; loss-streak/
   cooldown state (`g_sameDirLossStreak` etc.) now persists via
   `GlobalVariableSet/Get` and reconstructs at `OnInit()` instead of resetting to zero
   on every EA restart.

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.15.0.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (canonical source; download endpoint reads version from this file's header dynamically — no separate backend version bump needed)
- [x] `backend/server.py` — cache-key + per-account budget fix (no schema/version field to bump)
- [ ] GitHub main branch pushed

### Testing Before Live
- [x] Full recompile — 0 errors, 0 warnings (`test_reports/metaeditor_v6150_reconstruction.log`)
- [ ] MT5 journal: `ADAPTIVE-DIRECTION | HTF Bias: ... | Active Direction: ...` line appears every closed M5 bar
- [ ] MT5 journal: `HTF_TREND_FOLLOW: withheld — Active Direction=...` appears when HTF consensus disagrees with fresh M5 structure
- [ ] MT5 journal: no `TRADE-MODE WARNING | ... downgraded hard block to warning` lines under default `AI_FILTER_ONLY` (only ever under explicit `AI_DIRECTOR`)
- [ ] MT5 journal: `THESIS_HOLD_BE_REARM` appears instead of silent zero-action when a runner round-trips to profit≤0
- [ ] `/api/download/info` returns version v6.15.0
- [ ] 24h+ demo validation before considering this safe for live capital, per this checklist's own standing rule

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — this is an architectural change to the entry/exit/AI-authority hierarchy; validate on demo (both Mac and VPS instances) through at least one full session covering the kind of trending-then-reversing move that produced the July 3 incident before considering live capital

---

## v6.7.0 — 2026-07-02 — Market Mode Architecture (Gold + Index)

*(Renamed from v6.6.0 before wide distribution — same content, no functional changes, version identifiers only.)*

### EA Compile
- [x] EA internal version: `#property version "6.700"`
- [x] EA header comment: v6.7.0
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.7.0.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v670.log`)

### Scope discipline
- [x] No index/synthetic symbol available on any configured broker (MetaQuotes-Demo, TRADE.com-Live, GoatFunded-Server, Default all gold+forex only) — no index strategy logic written, per explicit "no speculative live-money logic" instruction.
- [x] Multi-symbol simultaneous scanning NOT started (469 hardcoded `Symbol()` sites, zero symbol-keyed state = structural rewrite, not a feature) — design-only in `docs/index_mode_state_and_scanner_design.md`.
- [x] Index Mode places zero trades this release (`InpIndexModeLogOnly=true` hard safety switch, entry pipeline skipped entirely when resolved mode is INDEX_MODE).
- [x] Gold Mode behavior completely unchanged.

### What shipped
1. Market auto-detection (`InpMarketMode`, `XAU_DetectMarketMode`, `MARKET_AUTO_DETECT` log line)
2. Symbol-agnostic lot/risk engine (`XAU_CalcIndexLot`) + `INDEX_TRACE` diagnostics
3. Backend Gold/Index/Combined reporting split (`classify_market_mode`) + trading-universe settings storage (not yet EA-consumed)
4. Command Center "Trading Universe" panel + Admin "Market modes" panel + honest site copy
5. Design docs for Project C (state separation + multi-symbol scanner) — not implemented
6. Static-review fixes: phantom-peak off-by-one, `XAU_NewHostileStructureFlip` (direction-aware flip, fixes a real false-positive risk in v6.4.25/v6.5.0's own flip checks + a pre-existing TTM gap), TTM bar-boundary tightening, stale "version=5.9.1" log string fixed

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.7.0.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` + `backend/server.py` ea_version
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx, CloudLanding.jsx, CloudDashboard.jsx: v6.7.0

### Testing Before Live
- [x] Full suite `tests/` — 132/132 passed (includes 6 new static-review regression tests)
- [ ] MT5 journal: `MARKET_AUTO_DETECT` line appears on attach, correctly resolves GOLD_MODE on XAUUSD
- [ ] MT5 journal: if attached to a non-gold symbol, `INDEX_MODE_MONITORING_ONLY` appears and no trade ever opens
- [ ] `/api/download/info` returns version v6.7.0
- [ ] Command Center "Trading Universe" panel loads and saves settings

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES (Gold Mode unchanged; Index Mode cannot trade)
- Safe for live: Gold Mode — same standing as v6.5.0 (still awaiting a full live validation window). Index Mode — N/A, does not trade.

---

## v6.5.0 — 2026-07-01 — Phases 2+4+5 of the full ecosystem audit (bundled)

### EA Compile
- [x] EA internal version: `#property version "6.500"`
- [x] EA header comment: v6.5.0
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.5.0.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v650.log`)

### Scope discipline
- [x] Only Phases 2, 4, 5 from the ecosystem audit are included, bundled into one release per explicit owner request (originally planned as v6.4.26/v6.5.0/v6.5.1). Phase 3 (threshold calibration) is explicitly excluded — it requires 2+ weeks of real live-trading data that cannot be substituted.
- [x] No new fear/protective layer added; no entry made stricter; no lot size reduced; no B-grade blocking reintroduced; no trade-frequency reduction. See `test_reports/xau_v6_5_0_phases_2_4_5_2026-07-01.md` for the explicit justification per change.

### Bugs Fixed / Consolidated This Release
5. Growth Guard hard-loss tautology + June-mode SL scaling — CRITICAL
8. AI fallback confidence=50 masquerading as real judgment — HIGH
6. Remaining mechanical basket exits (SECOND_CHANCE/CYCLE_DECAY) — MEDIUM-HIGH
   Phase 4: unified `XAU_ReversalConfirmed()` — consolidates 4 duplicate structure definitions into 1, adds per-ticket BOS/HTF flip detection
9. Platform security hardening (admin password, JWT secret, cookie, CORS) + dead-code removal + README/test-suite staleness repair — see report

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.5.0.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` + `backend/server.py` ea_version
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx, CloudLanding.jsx, CloudDashboard.jsx: v6.5.0 (the latter two had been missed since v6.4.22 — now in the standard distribution list)

### Testing Before Live
- [x] New regression suite `tests/test_xau_v650_phases_2_4_5_static.py` — 8/8 passed
- [x] Full suite `tests/` — 126/126 passed (repaired from 71 failing before this release)
- [ ] MT5 journal: `GROWTH_HARD_LOSS_CAP_JUNE_ADJUST` appears for June-mode trades, cap now matches real SL risk
- [ ] MT5 journal: `NO-AI-ANSWER` appears instead of `REDUCE` when AI genuinely didn't respond
- [ ] MT5 journal: `SECOND_CHANCE_HOLD_CONTINUING BASKET` appears on a recovering-but-not-exhausted basket instead of an automatic close
- [ ] `/api/download/info` returns version v6.5.0

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — none of v6.4.22 through v6.5.0 has run live long enough to validate; per the audit's Phase 0 recommendation, run one build on demo long enough to actually observe the new diagnostic lines before going live

---

## v6.4.25 — 2026-07-01 — Phase 1 of the full ecosystem audit

### EA Compile
- [x] EA internal version: `#property version "6.425"`
- [x] EA header comment: v6.4.25
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.25.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6425.log`)

### Scope discipline
- [x] Only the four Phase-1 defects from the ecosystem audit were touched (phantom peak, absolute-vs-flip structure gate, basket soft-lock cloud-safe gap, TTM tick-vs-bar). No Phase 2-5 items included.
- [x] No new fear/protective layer added; no entry made stricter; no lot size reduced; no B-grade blocking reintroduced; no trade-frequency reduction. See `test_reports/xau_v6_4_25_phase1_exit_defects_2026-07-01.md` for the explicit justification.

### Bugs Fixed This Release (see full report for evidence)
1. Phantom basket peak reconstruction (`XAU_ReconstructOpenBasketPeakUSD`) — CRITICAL
2. Absolute vs. flip-based structure test (`XAU_BasketStructureBroken`) — CRITICAL
3. Basket soft-lock disabled by `InpCloudSafeDisablePartials` default — CRITICAL
4. TTM counting ticks as bars (`TTM_Evaluate`) — HIGH

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.4.25.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` + `backend/server.py` ea_version
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx: v6.4.25

### Testing Before Live
- [x] New regression suite `tests/test_xau_v6425_phase1_exit_defects_static.py` — 6/6 passed
- [ ] MT5 journal: no `reconstructed=Y` peak logged for a position younger than one M5 bar
- [ ] MT5 journal: a basket entered against a standing BOS is no longer force-closed on giveback alone (only on an actual BOS/HTF flip or confirmed M5 break)
- [ ] MT5 journal: `BASKET SOFT-LOCK` lines appear on a first floor/giveback breach instead of an immediate full `BASKET LOCK`/`FAST-REVERSAL`/`HARD-CAP`
- [ ] MT5 journal: `[TTM]` lines advance roughly once per 5 minutes per position, not multiple times per second
- [ ] `/api/download/info` returns version v6.4.25

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — validate on demo first per the audit's Phase 0 recommendation (run one build long enough to observe real behavior; the last three releases never ran live long enough to prove anything)

---

## v6.4.24 — 2026-07-01

### EA Compile
- [x] EA internal version: `#property version "6.424"`
- [x] EA header comment: v6.4.24
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.24.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6424.log`)

### What changed (see `test_reports/xau_v6_4_24_profit_giveback_gate_audit_2026-07-01.md`)
Same bug class as v6.4.22, mirrored on the profit side: giveback%/context
breaches were fully closing STILL-PROFITABLE positions/baskets with no
reversal proof — banking only 37-59% of peak on basket closes, or cutting a
trade at $51 on a momentary WEAK_TRADE reclassification that then ran
another ~$229 (4.4x the banked amount). New `InpAllowGivebackPanicClose`
(default false) + `XAU_GateEarlyLossClose(..., isGivebackTrigger=true)`
require confirmed reversal or a repeat breach (after an already-taken
soft-lock/partial) before a full close. Basket Guard 1/Guard 2 now attempt
the existing soft-lock partial on the first breach instead of full-closing
immediately. Floor SL ratchet/AMPL trail mechanics unchanged.

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.4.24.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` + `backend/server.py` ea_version
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx: v6.4.24

### Testing Before Live
- [ ] MT5 journal: `PROFIT_GIVEBACK_CLOSE_BLOCKED` appears on a giveback breach with no confirmed reversal, instead of an immediate full close
- [ ] MT5 journal: `BASKET SOFT-LOCK (FAST-REVERSAL)` / `(HARD-CAP)` appears on first basket giveback breach instead of `BASKET FAST-REVERSAL`/`HARD-CAP` full close
- [ ] MT5 journal: a confirmed structure break or repeat breach still fully closes as before
- [ ] `/api/download/info` returns version v6.4.24

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — validate on demo first that winners now ride further before banking, and that a real reversal still closes promptly

---

## v6.4.22 — 2026-07-01

### EA Compile
- [x] EA internal version: `#property version "6.422"`
- [x] EA header comment: v6.4.22
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.22.mq5`
- [x] `XAUAI_EA_VERSION` / `XAUAI_EA_VERSION_NUM` / `XAUAI_BUILD_HASH` updated
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (see `test_reports/metaeditor_v6422.log`)

### Root Cause (see `test_reports/xau_v6_4_22_early_loss_close_audit_2026-07-01.md`)
Live evidence: basket peak +$126.42 → `PROFIT_FLOOR_SET` → `GIVEBACK_WARNING` →
`GIVEBACK_LIMIT_TRIGGERED` → `CONTINUATION_HOLD_REJECTED` → `FORCE CLOSE
reason=THESIS_BROKEN_EXIT.BASKET` → `CLOSED: LOSS -$2.10`, followed by price
resuming the original trade direction. `XAU_BasketLifecycleManager()` and
several per-ticket "smart exit" / Growth Guard / TTM paths were closing
losing trades on giveback %, cycle count, time-after-peak, or score decay
alone — with no real structural proof — then mislabeling it `THESIS_BROKEN_EXIT`.

### Bugs Fixed This Release
1. **Basket giveback panic-close** (CRITICAL): `XAU_BasketLifecycleManager()`
   closed the whole basket red on giveback % alone, with no structure check,
   even when `InpProtectedPeakBasketCloseRed` was meant to gate red closes.
   Same gap existed in `ManageBasket()`'s fast-reversal, hard-cap, and floor
   red-close branches.
2. **Per-ticket giveback/floor panic-close** (HIGH): `XAU_SmartExit3Layer()`
   and `XAU_ProtectPeakProfitFloor()` closed red positions on floor/giveback
   breach without requiring `structureConfirmedBroken`.
3. **TTM pure score-decay close** (HIGH): `TTM_EXIT` closed on `liveScore <
   InpTTM_ExitThreshold` alone — no BOS/HTF flip required.
4. **Growth Guard early cuts** (MEDIUM): `GROWTH_HARD_LOSS` and
   `GROWTH_BAD_ENTRY_THESIS` cut losers on EMA/RSI/momentum weakness without
   requiring confirmed structure.
5. **Clean Exits giveback/stagnant/stale cuts** (MEDIUM): `CLEAN_STAGNANT`,
   `CLEAN_STALE`, part of `CLEAN_INVALID`, and `APLUS_GIVEBACK_EXIT` could
   close red positions without a structure requirement.

### Fix
Added `InpAllowEarlyLossExit` (default `false`) and a single choke-point
`XAU_GateEarlyLossClose()`. When a position/basket P/L is at or below $0, the
close is blocked unless: it's already profitable, `InpAllowEarlyLossExit` is
true, there's a true emergency (deep equity/R backstop), or structure is
confirmed broken (H1 BOS flip via `g_smc_bos_dir`, HTF consensus flip via
`g_htfConsensusDir`, or a confirmed M5 close through the swing level).
Blocked attempts print `EARLY LOSS CLOSE BLOCKED — letting trade breathe.`
Every attempt (allowed or blocked) prints a `MANUAL_CLOSE_DIAGNOSTIC` line.
Paths that already required confirmed structure or a genuine emergency
backstop (`EARLY_CONVICTION_CUT`, `STRUCTURE_FAILFAST`,
`NO_PARTIAL_SMART_LOSS`, `EXPECTANCY_MAX_LOSS`, `HARD_STOP`/`HARD_STOP_R`,
`GROWTH_HARD_LOSS_EXIT`/`GROWTH_BASKET_LOSS`, `AI_DIRECTOR_EXIT_CLOSE`) were
left unchanged as legitimate backstops.

### File Distribution
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_v6.4.22.mq5` + `.ex5`
- [x] `/Applications/XAUUSD_AI_Sniper_EA_v6.4.22.mq5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` updated (website download)
- [x] `backend/server.py` `ea_version` default bumped
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx: v6.4.22
- [x] DownloadSection.jsx: fallback version/edition/filename bumped (reads live from API otherwise)

### Testing Before Live
- [ ] MT5 journal: `EARLY LOSS CLOSE BLOCKED — letting trade breathe.` appears on a giveback/score-decay attempt with no structure break
- [ ] MT5 journal: a confirmed BOS/HTF/M5 structure break still closes a loser normally
- [ ] MT5 journal: winners (P/L > 0) still protect/close exactly as before — ungated
- [ ] `/api/download/info` returns version v6.4.22

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings (`test_reports/metaeditor_v6422.log`)
- Safe for demo: YES
- Safe for live: NO — validate on demo first that trades now ride to SL/real structure instead of panic-closing

---

## v6.4.2 — 2026-06-28

### EA Compile
- [x] EA internal version: `#property version "6.4.2"`
- [x] EA header comment: v6.4.2
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5` (filename kept for MT5 import compatibility)
- [x] Startup Print() banner updated to v6.4.2 (was stale v5.9.1)
- [x] Heartbeat JSON `ea_version` field updated to v6.4.2 (was stale v5.9.1)
- [x] Dashboard string updated to v6.4.2 (was stale v5.9.1)
- [ ] **COMPILE IN METAEDITOR — must confirm 0 errors before going live**

### Bugs Fixed This Release
1. **Startup/heartbeat version strings** (HIGH): Print(), heartbeat JSON `ea_version`, and dashboard
   string all reported v5.9.1 instead of current version. Fixed to v6.4.2.
2. **Calibration JSON key collision** (HIGH): `ExtractJsonDouble()` searched the full response JSON
   for band keys like `"0-49"`. Server returns `"sample_counts"` before `"multipliers"`. Searching
   the full JSON returns sample_count integers (e.g. 12) instead of multiplier floats (e.g. 0.88),
   silently disabling calibration. Fixed by scoping search to the `"multipliers"` sub-object first.
3. **SQUEEZE_RELEASE counter-trend zero bug** (MEDIUM): When HTF consensus vetoes a squeeze, `s`
   is set to 0 but weight multiply and bestScore compare still fired. A score of 0 could win when
   all other setups also scored 0, placing a counter-trend trade. Fixed with `if(s > 0)` guard.

### File Distribution
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5` updated (v6.4.2 content)
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_MASTER_v6.3.0_AI_DIRECTOR.mq5` version bumped to 6.4.2
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` updated (website download)
- [x] GitHub main branch pushed

### Website / Frontend
- [x] HeroSection.jsx: v6.4.2
- [x] Footer.jsx: v6.4.2
- [x] DownloadSection.jsx: reads version dynamically (no hardcoded version)

### Testing Before Live
- [ ] MetaEditor compile: 0 errors, 0 critical warnings
- [ ] MT5 journal on attach: `TRADEBRAIN LOAD:` line visible
- [ ] MT5 journal: AI Director initialized
- [ ] MT5 journal: `CONFIDENCE CALIBRATION` line (even if "insufficient data")
- [ ] MT5 journal: startup banner says v6.4.2 (not v5.9.1)
- [ ] Heartbeat to backend: `ea_version` field shows v6.4.2
- [ ] 24h demo: `XAUAI_Scorecard_*.txt` written to MT5 Files
- [ ] 24h demo: `XAUAI_GateReport_*.txt` written
- [ ] `/api/download/info` returns version v6.4.2
- [ ] Website download button shows v6.4.2

### Sign-off
- Compile verified: PENDING
- Safe for demo: YES (audit fixes only — no strategy logic changes except SQUEEZE_RELEASE zero-score guard)
- Safe for live: NO — 2 weeks demo minimum

---

## v6.4.1 — 2026-06-28

### EA Compile
- [x] EA internal version: `#property version "6.4.1"`
- [x] EA header comment: v6.4.1
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5`
- [x] File size: ~798 KB
- [x] Root cause of v6.4.0 errors: calibration JSON parser used repeated `int pos` declarations in sibling blocks and unused `n50`/`n65` variables — replaced with `ExtractJsonDouble()` calls
- [ ] **COMPILE IN METAEDITOR — must confirm 0 errors before going live**

### File Distribution
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5` updated
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_MASTER_v6.3.0_AI_DIRECTOR.mq5` updated (same content)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` updated (website download)
- [x] GitHub main branch pushed

### Website / Frontend
- [x] HeroSection.jsx: v6.4.1
- [x] Footer.jsx: v6.4.1
- [x] DownloadSection.jsx: reads version dynamically (no hardcoded version)

### Testing Before Live
- [ ] MetaEditor compile: 0 errors, 0 critical warnings
- [ ] MT5 journal on attach: `TRADEBRAIN LOAD:` line visible
- [ ] MT5 journal: AI Director initialized
- [ ] MT5 journal: `CONFIDENCE CALIBRATION` line (even if "insufficient data")
- [ ] 24h demo: `XAUAI_Scorecard_*.txt` written to MT5 Files
- [ ] 24h demo: `XAUAI_GateReport_*.txt` written
- [ ] `/api/download/info` returns version v6.4.1
- [ ] Website download button shows v6.4.1

### Sign-off
- Compile verified: PENDING
- Safe for demo: YES (no logic changes, parser fix only)
- Safe for live: NO — 2 weeks demo minimum

---

## Release Process (all future versions)

1. Edit EA, increment version string and header comment
2. Write to canonical filename: `XAUUSD_AI_Sniper_EA_vX.X.X.mq5`
3. **Compile in MetaEditor — 0 errors required before anything else**
4. Copy to: `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` and MT5 Experts folder
5. Update HeroSection.jsx and Footer.jsx version strings
6. Update RELEASE_CHECKLIST.md
7. git commit + push
8. Verify `/api/download/info` returns new version after backend redeploy

**Rule: never push a version where step 3 has not been confirmed.**
