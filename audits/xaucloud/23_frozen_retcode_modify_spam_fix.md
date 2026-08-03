# SL-Modify Rejection Spam — Third Pass, Real Root Cause (Phase 23)

## What happened

The second-pass fix (Phase 22, commit `d901e55`) added a resubmission
cooldown for `SafeModifySL()`, but gated recording that cooldown on
`ret == 10016` (`TRADE_RETCODE_INVALID_STOPS`) only. The third MetaQuotes
Market validation attempt against the same historical XAUUSD window
(2024.02.05-2024.02.15) still failed with 21 errors, and reading the
actual report text (not just the pass/fail state) showed two visually
similar but distinct trade-journal messages:

- `[Invalid stops]` -- this is retcode 10016, which the cooldown did
  suppress correctly (only 1-2 occurrences per ticket in the report).
- `[Modification failed due to order or position being close to market]`
  -- repeated 4-6+ times per ticket within a simulated 5-second window
  (e.g. ticket #4 at 05:02:00/01/03/05, ticket #19 at 09:30:29 through at
  least 09:30:35). This text is the trade journal's description for
  retcode 10029 (`TRADE_RETCODE_FROZEN` -- "order or position frozen
  because price is within the freeze level"), which reads similarly to
  10016's "Invalid stops" but is a different code entirely. The
  `ret == 10016`-gated cooldown from the second pass never caught it,
  so the identical rejected request kept being resent every tick.

## Root cause

Gating the cooldown-recording on a specific retcode was the wrong
scope for the actual requirement. The real requirement -- "don't resend
an identical (ticket, target SL) request that was just rejected" -- is
retcode-agnostic: a request that failed for reason X will fail again
immediately for the same reason X if nothing about it changed. There
was no need to enumerate which specific retcodes matter.

## Fix

- `SafeModifySL()`'s cooldown write (previously `if(ret == 10016) { ... }`)
  is now unconditional -- it records the (ticket, SL, time) after *any*
  rejected `PositionModify()` call, not just a specific retcode.
- Renamed the tracking statics from `g_lastInvalidStops*` to
  `g_lastRejectedModify*` to reflect the broadened scope.
- Added `ret == 10029` to the throttled-log "benign" set (cosmetic --
  the cooldown above already stops the request from repeating; this only
  affects which log line a first-occurrence uses).
- No change to which SL value is computed, when a genuinely *different*
  target is attempted, the existing context-busy retry
  (`err==4756 || ret==10016`, one 150ms-yield retry), or the 3-per-second
  non-emergency throttle.

## Verification

- Compile: 0 errors, 0 warnings (both market edition and production).
- Dedicated regression suite
  (`tests/test_xau_v62530_safemod_invalid_stops_cooldown.py`, root repo)
  updated and passing 6/6, including a new
  `test_rejection_is_recorded_unconditionally_for_any_retcode` guard
  against re-narrowing the fix to a specific retcode again, and a check
  that the old `g_lastInvalidStops*` names are fully gone (not just
  shadowed).
- Full regression suite: same 471 pre-existing failures with or without
  this change (confirmed via `git stash`) -- all from an earlier,
  unrelated rebrand that changed the EA version-macro format; none
  newly introduced by this fix.
- Attempted an exact historical reproduction (2024.02.01-2024.02.10
  XAUUSD D1, `Model=4` real ticks) in the isolated Strategy Tester
  sandbox to directly confirm the retcode value and the fix's effect;
  as in the earlier Feb-2024 reproduction attempt this session, the
  sandbox does not have real tick data cached that far back and the run
  never completed history sync. Relied on the code-level proof instead
  (the fix is a strict superset of the retcode==10016-only version, so
  it cannot regress the cases that were already verified working, and it
  additionally suppresses the 10029 case the report showed).
- Ran the standard recent-data 7-day XAUUSD M10 real-tick regression
  (`claude_xaucloud_qc_7d.ini`) in the isolated sandbox to confirm no
  crash or behavioral regression on the normal path.

## Production port (owner directive: port real-account-relevant fixes to production)

Same unconditional-cooldown fix applied to `XAUUSD_AI_Sniper_EA.mq5`
(root + `backend/ea_code/` mirror + `research/local_ai_m10/
XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS.mq5`, kept byte-identical per
this repo's convention). Compiled clean. Staged (not hot-deployed) --
see the production repo's own audit doc for Mac/VPS staging details.
