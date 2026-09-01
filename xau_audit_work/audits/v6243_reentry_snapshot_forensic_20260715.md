# v6.24.3 re-entry snapshot forensic repair — 2026-07-15

## Release scope

This repair is on `fix/v6243-smart-pullback-caution`.  It is **not merged to
main and is not deployed**.  The v6.24.1 15% binary stop-risk and broker-margin
calculation are deliberately unchanged.  The owner-requested 150-second
timing authority remains; WAIT never restarts it.

## Evidence and exact incident chain

Evidence was read from the Mac MT5 terminal journal:

`/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Logs/20260715.log`.

The journal prefix is local terminal time (18:xx); its decision-bar and
timing-proof fields identify the corresponding broker/server M5 context as
2026-07-15 20:xx.  Both are retained below so the records can be matched
without guessing a timezone conversion.

| Time | Recorded event | Finding |
|---|---|---|
| 18:25:12.251 | `BROWSER_SL`, SELL 0.35 closed at 4039.56, -$394.10 | The prior SELL thesis lost at its broker SL. |
| 18:25:17.151 | `ADAPTIVE-DIRECTION ... DIRECTION_BUY_ONLY [STRONG]` | M5 HH/HL and failed bearish continuation had already produced a bullish structural flip. |
| 18:25:17.449 | `DECISION_FINGERPRINT ... TREND_PULLBACK BUY grade=A combined=4.75 regime=TREND_UP activeDir=BUY_ONLY` | The independent fresh engine preferred BUY.  It began the intentional 150-second timer. |
| 18:27:43.916 | `FINAL_ENTRY_ARBITER source=RE_ENTRY ... ALLOW` | The old early re-entry path evaluated stale SELL context rather than the contemporaneous BUY decision. |
| 18:27:44.198 | `EXECUTING: SELL Price=4038.73 ... RE_ENTRY`, lot 0.24 | Incorrect stale SELL was sent despite the BUY-only context.  It used the correct 15% risk/margin calculation; sizing was not the defect. |
| 18:30:09.900 | `DECISION_FINGERPRINT ... TREND_PULLBACK BUY grade=A combined=4.75 regime=TREND_UP activeDir=BUY_ONLY` | The live engine again independently preferred BUY. |
| 18:30:20.010 | `BROKER_SL`, SELL RE_ENTRY, -$302.88 | The stale SELL re-entry stopped out. |
| 18:32:43.175 | `EXECUTING: BUY ... TREND_PULLBACK [A]` | The normal BUY engine later executed after its existing timer. |

The journal also records the earlier SELL sequence: 0.32 at 4035.09, 0.18 at
4027.58, then 0.35 at 4028.30, before the latter stopped at 4039.56.  This is
direction/timing failure evidence, not a reason to introduce a loss cooldown.

The available local journal is a Mac-side MT5 record for account 5053017016;
it itself reports MetaTrader VPS hosting.  No separate second-VPS journal
archive was mounted in this workspace, so no unsupported side-by-side claim is
made.  The new decision trace records all fields needed for that comparison on
both machines going forward.

## Root cause

The old `CheckReEntryOpportunity()` ran before the current M5 scan had created
the fresh decision state.  It inherited `lastClose.dir`, treated `RE_ENTRY` as
grade A, updated `lastSignal*`, and passed that stale direction to `OpenTrade`.
An SL did not clear this permission/candidate cache.  Therefore an old SELL
could reach order submission while the primary closed-bar engine had already
found BUY.

## Repair

`backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` now has one immutable
`XAU_EntryDecisionSnapshot`, captured after the current closed-M5 scan.  A
re-entry now:

1. starts only as loss context; an exact broker SL calls
   `XAU_CreateReentryState(true)`, invalidates the direction, and clears its
   cached candidate/timing state;
2. is evaluated only after the current snapshot exists;
3. requires the snapshot direction to match, compatible bias, M5 continuation,
   M15 non-conflict, valid structure, freshness, and the existing timer;
4. rechecks the same snapshot immediately before `OpenTrade`;
5. uses `OpenTrade(dir, ...)`, where `dir` came from the current snapshot—not
   `lastClose.dir`.

This is a fresh-decision repair, not a new blanket blocker.  Invalidated SELL
returns control to the preserved BUY candidate; a later genuine SELL may still
be rebuilt as a fresh closed-bar setup.

`XAU_SmartEntryCautionGate()` is the single timing authority added by v6.24.3.
It returns ALLOW, WAIT, or HARD_BLOCK.  Pullback, fast-timeframe opposition,
and missing continuation return WAIT and preserve the candidate.  Hard block is
reserved for confirmed BOS+HTF opposition, consumed opportunity, or an exact
repeated unreset failed structure.  AI is advisory and logs its actual status;
memory requires repeated, timing-tagged evidence.  Neither can resize lots or
restart the 150-second timer.

New forensic events include `DECISION_SNAPSHOT`, `REENTRY_BLOCKED_AFTER_SL`,
`REENTRY_BLOCKED_OPPOSITE_SIGNAL`, `REENTRY_BLOCKED_BIAS_CONFLICT`,
`REENTRY_BLOCKED_STRUCTURE_FLIP`, `REENTRY_BLOCKED_STALE_SNAPSHOT`,
`REENTRY_REBUILT_AS_FRESH_SETUP`, `REENTRY_APPROVED_FRESH_CONFIRMATION`,
`SMART_ENTRY_CAUTION_TRACE`, and `LEARNED_ENTRY_QUALITY_TRACE`.

## Verification

* Deterministic re-entry/snapshot replay tests A–J plus existing aligned-entry
  and 15%-margin static tests: **53 passed**.
* MetaEditor compile of the branch source: **0 errors, 0 warnings**
  (48,139 ms).  The generated compiler log is
  `test_reports/metaeditor_v6243.log`.
* `git diff --check`: clean.

The repository's historical broad test suite still contains an old-copy
identity assertion that requires the unrelated generic root EA to equal the
newer backend artifact.  That mismatch predates this repair; it is not changed
to avoid accidentally replacing the user-selected v6.24.1 release artifact.

## Before / after recorded replay

| Snapshot at 20:25 | Old behavior | v6.24.3 behavior |
|---|---|---|
| SELL has just hit broker SL; current closed-bar decision is BUY and bias is TREND_UP | stale SELL RE_ENTRY waited 150 seconds then executed | `REENTRY_BLOCKED_AFTER_SL`; SELL cache cleared; BUY candidate remains preserved |
| BUY has active pullback / no fresh reclaim | may be skipped or conflict with stale re-entry | `WAIT / PULLBACK_NOT_COMPLETE`, timer is not restarted |
| BUY later has continuation confirmation | unrelated stale re-entry can compete | `ALLOW BUY` through the normal fresh path |
| SELL is later independently rebuilt with bearish structure | stale permission is all that existed | allowed only from a fresh matching snapshot |
