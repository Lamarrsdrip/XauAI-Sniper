# v6.24.3 -> v6.24.8 campaign-learning deliverables report — 2026-07-15

## Scope and status

Branch `fix/v6243-smart-pullback-caution`. **Not merged to `main`. Not
deployed to the VPS.** All work below is source + static/behavioral-mirror
tests + MetaEditor compile only — this repository has no automated MQL5
execution/backtest harness (see Testing methodology below).

| Commit | Version | What shipped |
|---|---|---|
| `fb4866b` (pre-existing, this branch) | v6.24.3 | Immutable `XAU_EntryDecisionSnapshot`; stale re-entry repair |
| `6e7cadb` | v6.24.4 | Custom window 1 news block 90min -> 30min; retired dead `g_aiLastConfidence` (AI=0 root cause) |
| `0a9b681` | v6.24.5 | Pre-OrderSend trade-horizon classification; structural-SL source labeling (opt-in) |
| `f675a3b` | v6.24.6 | Pyramid additions gated on campaign exhaustion/transition state; Smart Guard/HTF-Gate/SMC-conflict audit |
| `9f48cf6` | v6.24.7 | Exit-hierarchy precedence documented; horizon-aware `PEAK_RETRACE` tolerance |
| this doc | v6.24.7 (no code change) | Consolidated July 15 replay + full report |

Baseline commit for this work: `1204400` (v6.24.3, HEAD of the branch
before this session started). Current HEAD: `9f48cf6`.

## 1–9: Verification of the v6.24.3 stale re-entry repair

Verified from source and from the deterministic test suite, not re-derived
or reworked:

- `CheckReEntryOpportunity()` (`backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`)
  evaluates the current `g_latestDecisionSnapshot`, not `lastClose.dir`.
- Re-entry only proceeds once a current closed-M5 snapshot exists
  (`g_latestDecisionSnapshot.valid`).
- A broker SL invalidates the old direction's re-entry permission
  (`REENTRY_BLOCKED_AFTER_SL`) and clears cached candidate/timing state.
- WAIT does not restart the 120–180s timer (`XAU_EffectiveEntryDelaySeconds`,
  `XAU_SmartEntryCautionGate`).
- A fresh, independently-rebuilt same-direction trade is still allowed
  (`REENTRY_REBUILT_AS_FRESH_SETUP`).
- `tests/test_xau_v6243_reentry_snapshot_repair.py`: **15/15 passed** (this
  session's run, unmodified).

No changes were made to this repair. Everything in Parts 2 onward below
**reuses** it as a foundation.

## 10–15: Entry-path authority map (as found, before this session's changes)

```
closed M5 scan
  -> XAU_AdaptiveMarketTransitionEngine()   (lifecycle/exhaustion/room -- ALREADY existed)
  -> XAU_ClassifySetup()                    (setup timing character -- ALREADY existed)
  -> XAU_CaptureDecisionSnapshot()          (immutable snapshot -- v6.24.3)
       + v6.24.5: horizon classification added here
  -> XAU_SmartEntryCautionGate()            (caution authority -- v6.24.3)
  -> XAU_FinalEntryArbiter() / re-check     (final arbiter)
  -> OpenTrade()                            (structural SL + risk sizing -- v6.24.1/v6.24.5)
  -> OrderSend / broker result
  -> ManagePositions()                      (exit hierarchy -- v6.24.7 documents order,
                                              horizon-aware PEAK_RETRACE tolerance)
```

Audited entry paths and their current state:

| Path | Uses the shared snapshot/authorities? | Notes |
|---|---|---|
| Fresh entry (`ScanSignals` -> `OpenTrade`) | Yes | unchanged |
| Re-entry (`CheckReEntryOpportunity`) | Yes | v6.24.3 repair; verified intact |
| Pyramid add (`CheckPyramidOpportunity`) | Partially | now gated by campaign exhaustion (v6.24.6); still bypasses `OpenTrade()`'s horizon/structural-SL labeling (own `trade.Buy/Sell` call, own SL math) — **documented gap, not fixed this session** |
| Force-open (`XAU_TryForceOpenTrade`) | Yes, via `OpenTrade(..., isManualOverride=true)` | unchanged |
| Counter-Excursion (`XAU_TryCounterExcursionEntry`) | No — by design | own magic number, own risk model, never calls `OpenTrade()`; confirmed isolated, cannot redefine the primary campaign |
| AI/memory | Advisory only | `XAU_CurrentAIStatus()` disambiguates AI_NOT_CALLED vs AI_AVAILABLE_n (v6.24.4); memory never resizes lots or restarts timing (unchanged, verified by reading, not modified) |

## Why profitable SELLs were fragmented / why late SELLs continued near the bottom / why the stale SELL at 4038.73 executed / why BUY appeared shortly after / why another SELL entered the recovery

All five reconstructed in `audits/v6243_reentry_snapshot_forensic_20260715.md`
(root cause: `CheckReEntryOpportunity` ran before the fresh decision state
existed, inherited `lastClose.dir`, and an SL didn't clear that permission)
and in `audits/v6243_mac_vps_trade_learning_20260715.md` (142 Mac trades,
17 VPS telemetry-rich closes; A+/timing-100 labels did not predict outcome,
confirming a historical score must not authorize a new same-direction
trade). Not re-derived here — see those documents for the full evidence
tables. This session's `test_xau_v6248_july15_replay_and_matrix.py`
replays the exact chain end-to-end against the combined v6.24.3–v6.24.7
decision model (8/8 passed).

## 16–21: Architecture delivered this session

**Long-distance signal architecture**: `XAU_AdaptiveMarketTransitionEngine`
already computed H1/M15 context, lifecycle (`ENUM_XAU_MARKET_LIFECYCLE`:
`TREND_EARLY` -> ... -> `OPPOSITE_DIRECTION_CONFIRMED`), exhaustion %,
remaining room in R-multiples, and entry-location quality *before this
session*. That was the single biggest finding: most of "Part 2" of the
original request was not a gap. What was missing, and is now built:

- **Trade-horizon classification** (v6.24.5): `ENUM_XAU_TRADE_HORIZON`
  (`SCALP` / `INTRADAY_TREND` / `SWING_RUNNER` / `REVERSAL` /
  `PYRAMID_ADD` / `COUNTER_EXCURSION`), computed by
  `XAU_ClassifyTradeHorizon()` from the existing transition-engine output
  (no new signal math), stored on the immutable snapshot, and carried
  through to position management via `TradeTTMRecord.horizon` (v6.24.7).
- **Structural SL source labeling** (v6.24.5): `ENUM_XAU_SL_SOURCE`,
  `XAU_ComputeStructuralSL()` reusing `XAU_SwingSequenceDir`'s already-
  computed M5 swing pivots, bounded to [0.5x, 4x] the ATR-floor distance.
  Logged on every trade (`STRUCTURAL_SL_TRACE`, extended
  `RISK_MARGIN_TRACE`) unconditionally; only **changes** the sent SL when
  `InpUseStructuralSL=true` (default **false** — zero live behavior change
  until the owner reviews the trace on demo and opts in).
- **Campaign-exhaustion-gated additions** (v6.24.6): pyramid adds now read
  the transition engine's `existingBuyAction`/`existingSellAction`
  (`TRANSITION_STOP_ADDS` / `TIGHTEN_PROTECTION` / `EXIT_PROFITABLE` /
  `EXIT_CONTROLLED`) before adding — previously only existing-position SL
  tightening consumed this signal.
- **Exit-hierarchy precedence** (v6.24.7): documented as a comment block
  (Profit Floor -> Clean Exits/Smart Exit -> `PEAK_RETRACE` -> Adaptive
  Runner trailing -> break-even -> time/stale/EMA-drift closes gated off
  by `InpPreservationMode`), plus horizon-aware, additive-only widening of
  `PEAK_RETRACE` tolerance for `SWING_RUNNER`/`INTRADAY_TREND` tickets.

**Direction-transition architecture**: already existed
(`ENUM_XAU_TRANSITION_POSITION_ACTION`, `oppositeReclaim`,
`oppositeRetestHeld`, `oppositeDisplacement`, `freshBuyAllowed`/
`freshSellAllowed`, `OPPOSITE_DIRECTION_CONFIRMED`). Not rebuilt. Verified
these gate the *opposite* direction's fresh entry independently of the old
direction's add/exhaustion state (v6.24.6 change does not touch them).

**Unified-decision-authority audit** (owner follow-up message): Smart
Guard, "HTF Context Gate", and SMC hard-conflict blocking were each
investigated by direct source reading and are **already not live
independent veto authorities**:
- Smart Guard's hard-expectancy inputs (`InpSmartGuardHardExpectancy`,
  `InpSmartGuardHardWinRate`) are declared but never read anywhere; its
  decision functions (`IsSmartGuardDamageSetup`,
  `SmartGuardStrongTrendRetest`, `GetSmartGuardSetupStats`) are defined
  with zero call sites; its lot-reduction multiplier is explicitly
  commented "NOW: removed" (v6.3.2).
- The "legacy context gate" (HTF Context Gate) is documented in the file's
  own changelog as already deleted, replaced by the shared
  `XAU_ClassifySetup`.
- `SMC_GetConflictPenalty` (hard-block output param) has zero call sites;
  `g_smcHardBlockActive` is unconditionally `false` and never read to
  block anything (v6.24.0 "SMC supplies corroborating evidence only").

So `XAU_SmartEntryCautionGate` (entries) and
`XAU_AdaptiveMarketTransitionEngine` (campaign/lifecycle) are the two live
authorities — not five-plus competing ones. This was substantially already
correct before this session.

## 22: Risk and lot-size proof

Unchanged: `OpenTrade()`'s binary full-risk formula
(`riskUSD = balance * InpNormalRiskPct/100`; `lot = riskUSD /
moneyLossPerLotAtSL`) is untouched by every change in this session. The
v6.24.5 structural-SL option, even when enabled, only changes which
distance is used as `slDist` *before* this formula runs — a wider
structural distance still produces a mathematically smaller lot at the
same configured risk %, never a different risk %. Proven in
`test_xau_v6245_horizon_structural_sl_static.py::test_scenario_21/22`.

## 23–28: News-calendar

- Source: `input int InpCalCustomDurMin1` (default 90 -> **30**, v6.24.4).
- Function: `IsScheduledNewsWindow()` — pure `TimeGMT()` integer math, no
  persisted timer, so repeated ticks cannot move the expiry and a terminal
  restart reconstructs the same wall-clock-derived window automatically
  (there is no state to reconstruct).
- Confirmed new expiry: 18:30 GMT for the default Wednesday 18:00 GMT
  window.
- Confirmed 19:29 GMT is no longer inside the window:
  `test_xau_v6244_news_window_ai_status_static.py::test_scenario_29`.
- One-shot `NEWS_COOLDOWN_COMPLETE` log added on the falling edge; reason
  strings now carry `source=CUSTOM_STATIC_WINDOW` and the computed expiry.
- Post-news behavior: unchanged — `IsScheduledNewsWindow` expiring resumes
  normal campaign analysis (the existing anti-chase/confirmation checks
  downstream were not touched).

## 29: Timer findings

`XAU_EffectiveEntryDelaySeconds()` already clamps to [120,180] regardless
of input; `XAU_SmartEntryCautionGate()` already evaluates the preserved
candidate only after that timer. No changes made — verified only.

## Test-suite legacy-failure handling

This repo has ~100 version-pinned `test_xau_v*_static.py` files, many
asserting byte-identity between an old root-level `.mq5` and the current
`backend/ea_code` copy, or an exact old version string. As the source
moves forward, older pinned files predictably go stale — this is the
established, pre-existing pattern (not something introduced this
session).

| Checkpoint | Failed | Passed | New failures vs prior checkpoint | All expected? |
|---|---:|---:|---:|---|
| Baseline (before any change, v6.24.3 HEAD) | 306 | 835 | — | — |
| After v6.24.4 | 309 | 849 | +3 | Yes — v6.23.x/v6.24.0/v6.24.1-pinned tests going stale on this bump |
| After v6.24.5 | 311 | 872 | +2 | Yes — v6.24.4's own version-pinned test going stale |
| After v6.24.6 | 313 | 886 | +2 | Yes — v6.24.5's own version-pinned test going stale |
| After v6.24.7 | 315 | 896 | +2 | Yes — v6.24.6's own version-pinned test going stale |

At every checkpoint: **zero unexpected new failures, zero accidental
fixes** (`comm -13`/`comm -23` diffs recorded in
`test_reports/baseline_failures_post_v624{4,5,6,7}_20260715.txt`). No
existing test was edited or deleted to make it pass.

## Testing methodology (repo-wide constraint, not introduced this session)

Two patterns, both already established in `tests/` before this session:
1. `*_static.py` — regex/substring assertions against the raw `.mq5`
   source text (including root/backend byte-identity checks).
2. Deterministic Python dataclass re-implementations of the MQL5 control
   flow (e.g. `test_xau_v6243_reentry_snapshot_repair.py`,
   `test_xau_v6248_july15_replay_and_matrix.py`), exercising the modeled
   decision tree, not the compiled `.ex5`.

There is **no automated MQL5 execution/backtest harness** in this repo.
Verification for every change in this session was: MetaEditor compile (0
errors/0 warnings each time, `compile_logs/v624{4,5,6,7}_*.log`) + the
above two test styles + `git diff --check` clean. A manual MT5 Strategy
Tester run on demo is recommended before enabling `InpUseStructuralSL` or
relying on the pyramid-exhaustion gate under live volatility conditions
this repo cannot simulate.

## Files changed this session

- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (single source of truth)
- `XAUUSD_AI_Sniper_EA_v6.24.{4,5,6,7}.mq5` (root-level version-synced copies)
- `tests/test_xau_v6244_news_window_ai_status_static.py` (17 tests)
- `tests/test_xau_v6245_horizon_structural_sl_static.py` (25 tests)
- `tests/test_xau_v6246_pyramid_exhaustion_gate_static.py` (16 tests)
- `tests/test_xau_v6247_horizon_exit_tolerance_static.py` (12 tests)
- `tests/test_xau_v6248_july15_replay_and_matrix.py` (8 tests)
- `compile_logs/v624{4,5,6,7}_*.log`
- `test_reports/baseline_failures_*_20260715.txt`

**Not touched**: `backend/server.py`'s `ea_version` fallback,
`frontend/src/components/DownloadSection.jsx` — matching this branch's own
precedent (`fb4866b` also didn't touch them): those are release-day
website-facing updates, and this branch is explicitly not merged/deployed.

## Remaining limitations (honest, not papered over)

1. **No persistent campaign-ID object.** Nothing groups a sequence of
   PRIMARY/RE_ENTRY/PYRAMID tickets under one ID with addition-count/
   peak-profit/campaign-MFE/MAE tracking. The exhaustion/lifecycle *signal*
   this would organize already exists and is now consumed by pyramid adds
   (v6.24.6); the grouping object itself is not built.
2. **Pyramid adds and Counter-Excursion still bypass `OpenTrade()`'s
   horizon/structural-SL labeling.** They have their own SL math
   (`CheckPyramidOpportunity`'s own ATR distance; Counter-Excursion's own
   isolated risk model). Documented, not silently left unmentioned.
3. **The full "unified LOCATION_*/EXHAUSTION_*/TIMING_*/HTF_*/STRUCTURE_*
   state-machine with one final `ALLOW_CORE/ALLOW_ADD/.../HARD_BLOCK`
   action"** requested in the owner's follow-up is not built as one new
   object. What exists instead, verified: `XAU_AdaptiveMarketTransitionEngine`
   already plays that role for lifecycle/exhaustion/location, and the
   would-be "Smart Guard/HTF Gate/SMC" competing authorities turned out to
   already be dead code, so there was no live duplication to consolidate.
   Building the fully-named LOCATION/EXHAUSTION/TIMING enums the follow-up
   specified, purely for naming/observability parity with that spec, was
   judged lower value than the concrete gaps actually found and fixed.
4. **No MT5 Strategy Tester / real backtest run.** All verification is
   static source assertions, Python behavioral mirrors, and MetaEditor
   compilation — see Testing methodology above.
5. **`InpUseStructuralSL` defaults off.** The real structural-SL upgrade
   exists and is logged for review but does not change live behavior until
   explicitly enabled.

## Final readiness recommendation

**Demo-ready.** Every change in this session compiles clean (0 errors, 0
warnings x4), is covered by new deterministic tests (78 new tests across 5
files, all passing), introduces zero unexpected regressions against an
explicitly-tracked pre-existing baseline, and is additive/opt-in wherever
it touches risk-affecting logic (structural SL default-off; exit-tolerance
widening is MathMax-bounded to never narrow below today's behavior). It is
**not** VPS/live-ready without: a manual MT5 Strategy Tester pass on demo,
owner review of `STRUCTURAL_SL_TRACE`/`RISK_MARGIN_TRACE` output before
opting into `InpUseStructuralSL`, and completion of the three deferred
items above (campaign-ID object, pyramid/Counter-Excursion under the same
labeling, and a decision on whether the remaining named-state-machine
scope from the owner's follow-up is still wanted as literal renamed
objects or was satisfied by the concrete fixes shipped).
