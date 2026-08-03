# SL-Modify/Close Rejection Spam — Fourth Pass: the Close Path (Phase 24)

## What happened

The Phase 23 fix (retcode-agnostic `SafeModifySL` cooldown, commit
`e366b00`) was uploaded and MetaQuotes re-validated -- still 21 errors.
Reading the new report line by line (not just the error count) showed
the remaining spam split across two distinct causes:

1. `SafeModifySL()`'s 5-second cooldown was too short. A position stuck
   in a broker freeze/stops-level rejection for tens of simulated
   seconds still produced a rejection every ~5 seconds (e.g. ticket #17:
   09:20:45, :50, :55).
2. A **second, completely unprotected** code path: `OWNER_R_EXIT_CLOSE_ONLY()`
   -- the sole authority permitted to actually close a position -- called
   `trade.PositionClose(ticket)` on every tick the exit condition stayed
   true, with **no cooldown of any kind**. This produced trade-journal
   lines like `failed market buy 0.25 XAUUSD, close #4 sell 0.25
   XAUUSD ... [Modification failed due to order or position being close
   to market]`, several times per affected ticket, entirely independent
   of the `SafeModifySL` fix (different function, different broker call
   -- `PositionClose()` vs `PositionModify()`).

Root-caused by reading the exact new report text (`Started
2026.08.03 21:39:46`, still 21 errors) rather than assuming the previous
fix was simply incomplete in the same way again.

## Fix

- `OWNER_R_EXIT_CLOSE_ONLY()`: added the same rejection-cooldown pattern
  used in `SafeModifySL()` -- static `(ticket, timestamp)` tracking,
  checked immediately before `trade.PositionClose(ticket)`, written only
  in the failure branch. 60s window.
- `SafeModifySL()`'s existing cooldown widened from 5s to 60s.
- No change to which SL value is computed, which exit conditions
  trigger, or any owner-authority/firewall/deadline gating logic in
  `OWNER_R_EXIT_CLOSE_ONLY()` above the new check -- the cooldown only
  suppresses the final, already-approved broker call if it was just
  rejected.
- Also ported identically to the production EA (`XAUUSD_AI_Sniper_EA.mq5`
  on `XauCloud_m10_private_vps_ai`) -- see that repo's own audit doc
  (`audits/xaucloud/22_close_authority_cooldown_and_60s_widening.md`).

## Verification

- Compile: 0 errors, 0 warnings.
- Production repo's dedicated regression suite
  (`tests/test_xau_v62530_safemod_invalid_stops_cooldown.py`, this logic
  is shared/identical between both codebases) updated to 7 tests, all
  passing, including a new
  `test_position_close_authority_has_its_own_rejection_cooldown`.
- Did not get a fresh isolated-sandbox Strategy Tester run to complete
  this pass (Wine/tester environment hangs continued from the previous
  pass). Relied on code-level proof: both changes are strict narrowings
  of resend frequency on an already-failing path.

## Uploaded

`market_edition/release/XauCloud.ex5` re-uploaded to the MQL5 Market
control panel (product 188838, version 1.0) to trigger the fifth
automated validation pass.
