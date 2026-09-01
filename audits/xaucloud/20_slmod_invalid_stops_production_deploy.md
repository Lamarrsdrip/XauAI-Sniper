# SL-Modify Invalid-Stops Fix — Production Deployment Staging (Phase 20)

## What happened

While diagnosing a MetaQuotes Market validation failure on the Claude
XauCloud fork, found the root cause was in `SafeModifySL()` -- a function
inherited unchanged from the production EA (the network-stripping fork
never touched it). Confirmed by direct comparison: the production
`XAUUSD_AI_Sniper_EA.mq5` on `XauCloud_m10_private_vps_ai` had the exact
same gap (`bool benign = (...)` missing `ret == 10016`) and the same
lack of a resubmission cooldown. This is a real defect independent of
the Market listing -- see commit `2286e27` on this branch for the full
fix description.

## What was done

- Same fix applied to `XAUUSD_AI_Sniper_EA.mq5` (root + `backend/ea_code/`
  mirror + `research/local_ai_m10/XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS.mq5`,
  kept byte-identical per this repo's existing convention).
- Compile: 0 errors, 0 warnings.
- New dedicated regression test
  (`tests/test_xau_v62530_safemod_invalid_stops_cooldown.py`, 6 cases).
  Full regression pass: 41 passed, 2 pre-existing unrelated failures
  (already verified via `git stash` earlier this session).
- Committed and pushed to `origin/XauCloud_m10_private_vps_ai`.

## Deployment staging (owner directive: stage on both Mac and VPS)

**Not hot-reloaded anywhere** -- MT5 does not reload an already-attached
EA from a file change; the owner must detach/reattach or restart the
terminal for a staged build to take effect. Both copies are staged
additively under a new, distinctive filename -- nothing existing was
overwritten, and nothing was attached, detached, or restarted.

- **Mac** (`net.metaquotes.wine.metatrader5` Wine prefix, live Experts
  folder): staged as `XauCloud-m10_v62530_SLMOD_FIX_20260803.ex5`.
  SHA-256 `2d5d5f7fcda9c0d5fe7bfef92e79e818ec06b6543efdf113dbc626a858a8ee5c`
  -- confirmed identical to the repo's compiled artifact.
- **VPS** (`173.212.249.202`, terminal data folder
  `...\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Experts\`, the
  folder already containing `XauCloud_M10_PRIVATE_VPS_AI.ex5` and other
  approved-lineage files): staged as the same filename via SCP.
  `Get-FileHash` on the VPS confirmed the identical SHA-256.

## What was deliberately NOT done

- Did not overwrite any existing file on either machine.
- Did not attach this build to any chart, detach any existing EA, or
  restart either terminal -- both machines' currently-running/attached
  state is untouched. Live positions under active management by
  whatever build is currently attached are unaffected by this staging.
- Did not investigate or touch the first VPS terminal data folder
  (`AF7232500DA45E115EB2A96740B91340`) -- it had no XauCloud files
  matching the search and appears to belong to a different project on
  the same shared VPS.

## Owner's remaining action

Detach/reattach (or restart the terminal) on whichever machine(s) and
chart(s) should run this fix, whenever convenient -- this is a logging/
request-cooldown hardening fix, not an urgent hot-fix; the underlying
condition (broker rejecting an SL move as too close to market) already
falls through safely to "leave the existing SL alone" today, it just
does so noisily/repeatedly. No trading behavior changes when adopted.
