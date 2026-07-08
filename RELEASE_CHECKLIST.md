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
