# SL-Modify Rejection Spam — Third Pass, Real Root Cause (Production Port)

## What happened

The previous production port (`2286e27`, see
`audits/xaucloud/20_slmod_invalid_stops_production_deploy.md`) mirrored
the Market-edition fix that gated the SL-modify resubmission cooldown on
`ret == 10016` (`TRADE_RETCODE_INVALID_STOPS`). A third MetaQuotes Market
validation run against the Market-edition fork (same `SafeModifySL()`
function, inherited unchanged from this production EA) showed that gate
was too narrow: reading the actual validation report text (not just
pass/fail) revealed two visually similar but distinct trade-journal
messages against the historical test window --

- `[Invalid stops]` (retcode 10016) -- correctly suppressed by the
  existing cooldown.
- `[Modification failed due to order or position being close to market]`
  -- repeated 4-6+ times per ticket within a simulated 5-second window.
  This text is the trade journal's description for retcode 10029
  (`TRADE_RETCODE_FROZEN`), a different code the `ret == 10016` gate
  never caught, so the identical rejected request kept being resent
  every tick.

## Root cause

Gating cooldown-recording on a specific retcode was the wrong scope.
The actual requirement -- "don't resend an identical (ticket, target SL)
request that was just rejected" -- is retcode-agnostic.

## Fix (identical logic to the Market-edition fix, commit `e366b00` on
`market-edition/claude-xaucloud`)

- `SafeModifySL()`'s cooldown write is now unconditional (records after
  *any* rejected `PositionModify()`, not just `ret == 10016`).
- Renamed `g_lastInvalidStops*` statics to `g_lastRejectedModify*`.
- Added `ret == 10029` to the throttled-log "benign" set (cosmetic only
  -- the cooldown already stops the request from repeating).
- No change to which SL value is computed, when a genuinely different
  target is attempted, the context-busy retry, or the 3-per-second
  non-emergency throttle.
- Applied identically to `XAUUSD_AI_Sniper_EA.mq5` (root), `backend/
  ea_code/XAUUSD_AI_Sniper_EA.mq5`, and `research/local_ai_m10/
  XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS.mq5` -- all three kept
  byte-identical per this repo's convention (verified via
  `test_root_backend_and_with_owner_copies_stay_synced`).

## Verification

- Compile (`backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`): 0 errors,
  0 warnings.
- Dedicated regression suite
  (`tests/test_xau_v62530_safemod_invalid_stops_cooldown.py`) updated
  and passing 6/6, including a new
  `test_rejection_is_recorded_unconditionally_for_any_retcode` guard
  against re-narrowing the fix to a specific retcode, and a check that
  the old `g_lastInvalidStops*` names are fully gone.
- Full repo regression suite: 471 failures both with and without this
  change (confirmed via `git stash`) -- all pre-existing, from an
  earlier unrelated rebrand that changed the EA version-macro format
  (`test_release_labels_static.py` and everything depending on the same
  `#define XAUAI_EA_VERSION "v..."` regex). None newly introduced by
  this fix; out of scope for this fix per "keep current behavior unless
  it would cause Market rejection or a real trading defect."
- Attempted exact historical reproduction (2024.02.01-2024.02.10
  XAUUSD D1, `Model=4` real ticks) in the isolated sandbox to directly
  confirm the retcode value; as before, the sandbox lacks cached real
  tick data that far back and history sync never completed. Relied on
  code-level proof instead -- this fix is a strict superset of the
  previously-verified `ret==10016`-only version (it can only suppress
  *more* redundant resubmissions; the SL computed and every other
  decision path is byte-for-byte unchanged).
- Standard recent-data 7-day regression run in the isolated sandbox did
  not complete in this session (Wine/tester environment hang, appeared
  unrelated to the code change -- near-zero CPU for 12+ minutes with no
  fresh log activity even on a clean restart). Not blocking: the change
  itself has no code path that could introduce a hang (it is a strict
  narrowing of which requests get sent, not new logic on the hot path),
  and the dedicated unit tests directly assert the modified function's
  behavior byte-for-byte.

## Deployment staging (owner directive: stage on both Mac and VPS, don't
hot-deploy)

Same policy as the previous pass: staged additively under a new,
distinctive filename on both machines. Nothing existing overwritten;
nothing attached, detached, or restarted.

- **Mac** (`net.metaquotes.wine.metatrader5` Wine prefix, live Experts
  folder): staged as `XauCloud-m10_v62530_FROZEN_RETCODE_FIX_20260803.ex5`.
- **VPS** (`173.212.249.202`, terminal data folder
  `...\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Experts\`): staged
  as the same filename via SCP.

SHA-256 of the staged binary (both machines, verified identical):
`7eeefa2c7ba87df50b5a40547f81aefe88e67f81507df73ea7781fb52c08ba0e`

## Owner's remaining action

Detach/reattach (or restart the terminal) on whichever machine(s) and
chart(s) should run this fix, whenever convenient. This supersedes the
previous `XauCloud-m10_v62530_SLMOD_FIX_20260803.ex5` staged build --
that one only caught retcode 10016; this one is the complete fix.
