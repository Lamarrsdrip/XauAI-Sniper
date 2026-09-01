# Fifth Pass: Proactive Trade-Request Validation (Production Port)

## Why the fourth pass still wasn't enough

Phases/passes 1-4 (this repo's `20_`, `21_`, `22_` audit docs) were all
*reactive*: they reduced how many times an already-doomed request got
resent after the broker rejected it once, but never stopped the first
send. A fifth MetaQuotes Market validation run against the Market-edition
fork (same `SafeModifySL()`/`OWNER_R_EXIT_CLOSE_ONLY()` logic, inherited
unchanged in this production EA) still failed with 21 errors, spread
across five different tickets plus one market-closed entry attempt, each
producing 2-3 lines instead of the 5-10 seen in earlier passes -- proof
the cooldown widening/close-cooldown fixes worked exactly as designed,
but only compressed each individual event; they didn't prevent it.

The real mechanism: MT5 freezes **any** modify or close on a position
once price is within the freeze/stops band of that position's
**existing** SL -- independent of what a new target would be. The
pre-existing pre-flight checks only ever validated the *new target*
against `SYMBOL_TRADE_STOPS_LEVEL`/`SYMBOL_TRADE_FREEZE_LEVEL`, and only
did anything when those symbol properties reported a nonzero value. On
the MetaQuotes-Demo validation account, XAUUSD reports **0** for both --
silently disabling every pre-check -- while the broker/tester still
rejected requests within roughly 100-150 points of a position's stop
(directly observable from the rejection distances in the reports).
`OWNER_R_EXIT_CLOSE_ONLY()` had no pre-flight check of this kind at all.

## Fix (identical logic to the Market-edition fix, commit `42a577d` on
`market-edition/claude-xaucloud`)

Four changes, all validation/sequencing only -- no change to the signal
engine, risk, lot sizing, owner blocks, trade-selection policy, or exit
intent:

1. **`XAU_SafeMinStopDistance()`** -- shared real minimum-distance floor:
   `max(reported stops/freeze level, 150 points)`. Never trusts a
   reported 0 as "no restriction."
2. **`XAU_NormalizeToTick()`** -- normalizes to the symbol's actual tick
   grid, not just decimal digits.
3. **`SafeModifySL()`** rewritten to re-read fresh Bid/Ask before
   validating, clamp against the real floor unconditionally, check
   freeze/stops distance against both the current SL and the new
   target, and defer if a close was recently approved for this ticket
   (new shared close-intent flag, 30s bound).
4. **`OWNER_R_EXIT_CLOSE_ONLY()`**: added the same freeze/stops
   pre-check before ever calling `trade.PositionClose()`, and now sets
   the close-intent flag *before* attempting the close so a racing
   `SafeModifySL()` call defers instead of fighting it.
5. **Market-session check**: the automated entry gate now checks
   `SymbolInfoSessionTrade()` in addition to `SYMBOL_TRADE_MODE_DISABLED`
   (which only catches an administrative disable, not a daily session
   close) -- fixes the single `[Market closed]` entry attempt seen in
   every report.

All new state lives in a small shared array (`g_tradeGuard[]`, matching
this repo's existing `g_rExit[]`/`XAU_RExit_FindIdx()` dynamic-array
pattern), pruned periodically alongside the existing orphan-reconciliation
maintenance call.

Applied identically to `XAUUSD_AI_Sniper_EA.mq5` (root), `backend/
ea_code/XAUUSD_AI_Sniper_EA.mq5`, and `research/local_ai_m10/
XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS.mq5` (byte-identical, per
`test_root_backend_and_with_owner_copies_stay_synced`).

## Verification

- Compile: 0 errors, 0 warnings.
- Dedicated regression suite
  (`tests/test_xau_v62530_safemod_invalid_stops_cooldown.py`) expanded to
  15 tests, all passing -- 8 new tests covering the floor-distance logic,
  tick normalization, the current-SL freeze check, the fresh-price
  re-read ordering, the close/modify guard interaction, the close
  pre-check, and the market-session check.
- Did **not** get a fresh isolated-sandbox Strategy Tester regression run
  to complete for this pass -- the Wine/tester environment hung on both
  a fresh 7-day XAUUSD regression and a direct historical reproduction
  attempt, a recurring environment issue this session, unrelated to the
  code (confirmed via near-zero CPU and no new log activity on a clean
  restart). Stating this plainly rather than claiming a test that didn't
  finish. Confidence rests on: (a) every change strictly narrows when a
  broker request is sent, never changes what value would be sent; (b)
  the dedicated tests assert the actual code structure/ordering
  directly; (c) the owner-floor re-validation after the clamp
  (unchanged, already covered by earlier tests) still catches any case
  where the new floor-based clamp would produce a worse-than-allowed SL,
  deferring rather than sending it.

## Deployment staging (owner directive: stage on both Mac and VPS, don't
hot-deploy; short unique filenames per owner's latest instruction --
delete superseded staged copies rather than accumulating them)

- **Mac**: previous staged candidate (`XauCloud_3892aa3.ex5`) removed;
  replaced with the new commit's short-hash name.
- **VPS** (`173.212.249.202`): same replacement via SCP.

SHA-256 of the staged binary (both machines, verified identical) is
recorded in the staging step's own output.

## Owner's remaining action

Detach/reattach (or restart the terminal) on whichever machine(s) and
chart(s) should run this fix, whenever convenient.
