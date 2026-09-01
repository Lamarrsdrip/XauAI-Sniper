# XAU AI Sniper v6.4.13 Probability EV Exit Audit

Date: 2026-06-30
Version: v6.4.13
Build hash: v6413-probability-ev-exit-20260630

## Root Cause Addressed

v6.4.12 improved adaptive trade management, but the exit path was still category-first. A trade classified as strong trend, explosive move, weak trade, or exhaustion could still be managed mostly by fixed category consequences. That left two bad behaviors possible:

- high-quality trend winners could be cut too early, forcing worse re-entries lower in the move;
- mature winners could keep too much profit at risk when continuation edge had already faded.

## Architectural Change

v6.4.13 keeps the existing Smart Exit 3-layer architecture and adds a probability/expected-value decision layer inside `XAU_SmartExit3Layer`.

For every protected-profit trade, the EA now estimates:

- continuation probability;
- exhaustion probability;
- reversal probability;
- remaining realistic move value;
- existing profit at risk;
- hold EV versus exit/protect EV.

The EV decision can return:

- `XAU_EV_HOLD`
- `XAU_EV_PROTECT`
- `XAU_EV_PARTIAL`
- `XAU_EV_EXIT`

The result modifies the existing floor, giveback, partial, and runner logic instead of replacing it.

## Self Review

The existing post-close monitor now calls `XAU_EVPostCloseReview()`. If the market continues strongly after an exit, the bounded learning bias nudges future decisions toward more patience. If the market reverses after exit, it nudges future decisions toward earlier protection. The bias is capped and never changes hard risk limits or emergency exits.

## Reporting Fix

Local heartbeat/forward reports now refresh even when no trades close. Reports include EA version, build hash, input hash, status, reason, last scan, open positions, spread, news state, trade state, and exit engine state.

## Verification

- Focused EA static tests: passed.
- MetaEditor compile: passed with 0 errors, 1 version-format warning.
- Compiled file: `XAUUSD_AI_Sniper_EA_v6.4.13.ex5`.

