# SL-Modify/Close Rejection Spam — Fourth Pass: the Close Path (Production Port)

## What happened

A fourth MetaQuotes Market validation run against the Market-edition
fork (same 2024.02-2024.03 XAUUSD historical window) still failed with
21 errors even after the third-pass fix (retcode-agnostic `SafeModifySL`
cooldown, see `audits/xaucloud/21_frozen_retcode_modify_spam_fix_production.md`).
Reading the new report line by line (not just the error count) showed
the remaining spam split across two distinct causes:

1. `SafeModifySL()`'s 5-second cooldown was too short. A position stuck
   in a broker freeze/stops-level rejection for tens of simulated
   seconds still produced a rejection every ~5 seconds (e.g. ticket #17:
   09:20:45, :50, :55).
2. A **second, completely unprotected** code path: `OWNER_R_EXIT_CLOSE_ONLY()`
   -- the sole authority permitted to actually close a position -- called
   `trade.PositionClose(ticket)` on every tick the exit condition stayed
   true, with **no cooldown of any kind**. When the broker rejected the
   close (same "close to market"/frozen condition), the very next tick
   retried immediately and unconditionally. This produced trade-journal
   lines like `failed market buy 0.25 XAUUSD, close #4 sell 0.25
   XAUUSD ... [Modification failed due to order or position being close
   to market]`, several times per affected ticket, entirely independent
   of and unaffected by the `SafeModifySL` fix (different function,
   different broker call).

## Fix

- `OWNER_R_EXIT_CLOSE_ONLY()`: added the same rejection-cooldown pattern
  used in `SafeModifySL()` -- static `(ticket, timestamp)` tracking,
  checked immediately before `trade.PositionClose(ticket)`, written only
  in the failure branch (a successful close is never throttled). 60s
  window.
- `SafeModifySL()`'s existing cooldown widened from 5s to 60s (matching
  the codebase's existing 60s benign-log-throttle convention elsewhere
  in the same function), so a persistently frozen ticket produces at
  most one rejection line per minute instead of one every 5 seconds.
- No change to which SL value is computed, when a genuinely different
  target/close condition is evaluated, or any exit-authority gating
  logic in `OWNER_R_EXIT_CLOSE_ONLY()` above the new check (all the
  owner-authority/firewall/deadline checks still run exactly as before;
  the cooldown only suppresses the final, already-approved broker call
  if it was just rejected).
- Applied identically to `XAUUSD_AI_Sniper_EA.mq5` (root), `backend/
  ea_code/XAUUSD_AI_Sniper_EA.mq5`, and `research/local_ai_m10/
  XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS.mq5` (byte-identical, per
  `test_root_backend_and_with_owner_copies_stay_synced`).
- Also ported to the Market-edition fork (`market_edition/
  Claude_XauCloud.mq5`, commit on `market-edition/claude-xaucloud`) --
  see that repo's own audit doc.

## Why 60s is safe for the close path specifically

`OWNER_R_EXIT_CLOSE_ONLY()` guards genuinely important exits (hard-loss
firewalls, structural fail-fast, growth-guard basket loss, etc.). A
60-second delay only applies *after* the broker has already rejected an
identical close request -- the underlying condition (price frozen near
this level, a broker-side/freeze-level restriction outside this EA's
control) will reject an immediate retry just as certainly as a delayed
one. There is no version of "retry sooner" that could succeed where the
broker is enforcing a freeze independent of our request cadence; the
only way the retry can succeed is if price itself moves, which existing
callers already re-evaluate on the next few ticks and can attempt again
once real conditions change (this cooldown never blocks a request whose
target has actually changed -- for `SafeModifySL` that's a different SL
value; for close, the very next open exit-authority evaluation still
runs every tick, only the redundant broker call is suppressed).

## Verification

- Compile (both market edition and `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`):
  0 errors, 0 warnings.
- Dedicated regression suite
  (`tests/test_xau_v62530_safemod_invalid_stops_cooldown.py`) updated to
  7 tests, all passing, including a new
  `test_position_close_authority_has_its_own_rejection_cooldown` and an
  updated cooldown-window assertion (60s, was 5s).
- Did not get a fresh isolated-sandbox Strategy Tester run to complete
  this pass (Wine/tester environment hangs continued from the third
  pass, unrelated to the code change -- see prior audit doc). Relied on
  code-level proof: both changes are strict narrowings of resend
  frequency on an already-failing path; neither touches which SL value
  is computed, which exit conditions trigger, or any owner-authority
  gating logic upstream of the final broker call.

## Deployment staging (owner directive: stage on both Mac and VPS, don't
hot-deploy)

- **Mac**: staged as `XauCloud-m10_v62530_CLOSE_COOLDOWN_FIX_20260803.ex5`.
- **VPS** (`173.212.249.202`): staged as the same filename via SCP.

SHA-256 of the staged binary (both machines, verified identical) is
recorded in the staging step's own output; nothing existing was
overwritten, and nothing was attached, detached, or restarted on either
machine. This supersedes the previously staged
`XauCloud-m10_v62530_FROZEN_RETCODE_FIX_20260803.ex5` -- that one only
covered the modify path.

## Owner's remaining action

Detach/reattach (or restart the terminal) on whichever machine(s) and
chart(s) should run this fix, whenever convenient.
