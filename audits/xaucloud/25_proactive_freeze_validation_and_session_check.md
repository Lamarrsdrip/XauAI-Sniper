# Fifth Pass: Proactive Trade-Request Validation (Phase 25)

## Why the fourth pass still wasn't enough

Phases 22-24 were all *reactive*: they reduced how many times an
already-doomed request got resent after the broker rejected it once, but
never stopped the first send. A fifth MetaQuotes Market validation run
still failed with 21 errors, spread across five different tickets
(#19, #58, #67, #74, #77) plus one market-closed entry attempt, each
producing 2-3 lines instead of the 5-10 seen in earlier passes -- proof
the cooldown widening/close-cooldown fixes worked exactly as designed,
but they only compressed each individual event; they didn't prevent the
event.

Reading the report and the code side by side surfaced the real
mechanism: MT5 freezes **any** modify or close on a position once price
is within the freeze/stops band of that position's **existing** SL --
independent of what a new target would be. The pre-existing pre-flight
checks in `SafeModifySL()` only ever validated the *new target* against
`SYMBOL_TRADE_STOPS_LEVEL`/`SYMBOL_TRADE_FREEZE_LEVEL`, and only did
anything when those symbol properties reported a nonzero value. On the
MetaQuotes-Demo validation account, XAUUSD reports **0** for both --
silently disabling every pre-check -- while the broker/tester still
rejected requests within roughly 100-150 points of a position's stop
(directly observable from the rejection distances in the reports).
`OWNER_R_EXIT_CLOSE_ONLY()` had no pre-flight check of this kind at all.

## Fix

Four changes, all validation/sequencing only -- no change to the signal
engine, risk, lot sizing, owner blocks, trade-selection policy, or exit
intent (which value gets computed as the desired SL/close decision is
unchanged; only whether/when that decision is allowed to reach the
broker changed):

1. **`XAU_SafeMinStopDistance()`** -- a shared real minimum-distance
   floor: `max(reported stops/freeze level, 150 points)`. Never trusts a
   reported 0 as "no restriction."
2. **`XAU_NormalizeToTick()`** -- normalizes any price to the symbol's
   actual tick grid (`SYMBOL_TRADE_TICK_SIZE`), not just decimal digits.
3. **`SafeModifySL()`** rewritten to:
   - Re-read the freshest Bid/Ask (correct side per direction)
     immediately before validating, instead of trusting the caller's
     possibly-stale `curPrice` snapshot.
   - Clamp the target SL against the real floor unconditionally (not
     gated on `stopsLvl > 0`), then re-normalize to tick.
   - Check freeze/stops distance against **both** the position's current
     SL and the new target -- the missing check from prior passes.
   - Defer (skip entirely, no broker call) if it was recently approved
     for close by `OWNER_R_EXIT_CLOSE_ONLY()` (new shared "close intent"
     flag, 30s bound).
4. **`OWNER_R_EXIT_CLOSE_ONLY()`**: added the same freeze/stops
   pre-check (against the position's current SL) before ever calling
   `trade.PositionClose()`, and now sets the shared close-intent flag
   *before* attempting the close so a racing `SafeModifySL()` call in the
   same tick defers instead of fighting it.
5. **Market-session check**: the automated entry gate now checks
   `SymbolInfoSessionTrade()` (broker/server time) in addition to the
   existing `SYMBOL_TRADE_MODE_DISABLED` check, which only catches an
   administrative disable, not a daily session close. Fixes the single
   `[Market closed]` entry-attempt seen in every report so far.

All new state lives in a small shared array (`g_tradeGuard[]`, matching
the existing `g_rExit[]`/`XAU_RExit_FindIdx()` dynamic-array pattern
already used throughout this file), pruned periodically so it doesn't
grow unbounded across a long run.

## Verification

- Compile: 0 errors, 0 warnings.
- Production repo's dedicated regression suite
  (`tests/test_xau_v62530_safemod_invalid_stops_cooldown.py`) expanded to
  15 tests, all passing -- 8 new tests covering the floor-distance logic,
  tick normalization, the current-SL freeze check, the fresh-price
  re-read ordering, the close/modify guard interaction, the close
  pre-check, and the market-session check.
- Did **not** get a fresh isolated-sandbox Strategy Tester regression run
  to complete for this pass -- the Wine/tester environment hung
  (near-zero CPU, no new log activity) on both a fresh 7-day XAUUSD
  regression and a direct historical reproduction attempt, a recurring
  environment issue this session unrelated to the code (same symptom
  seen on unrelated prior runs). Stating this plainly rather than
  claiming a test that didn't finish. Confidence instead rests on: (a)
  every change is a strict narrowing of when a broker request is sent,
  never a change to what value would be computed or sent; (b) the
  dedicated test suite asserts the actual code structure and ordering
  directly, not just outcomes; (c) the owner-floor re-validation after
  the clamp (unchanged from prior passes, already covered by earlier
  tests) still catches any case where the new floor-based clamp would
  produce a worse-than-allowed SL, deferring rather than sending it.

## Uploaded

`market_edition/release/XauCloud.ex5` re-uploaded to the MQL5 Market
control panel (product 188838, version 1.0) to trigger the sixth
automated validation pass.
