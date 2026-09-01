# Pure M10 production-cycle audit and repair

Audit date: 2026-08-02
Audited broker week: 2026-07-27 through 2026-07-31
Symbol and authority: XAUUSD, closed `PERIOD_M10` bars only

## Verdict

The live v6.25.29 instance did **not** process exactly one complete decision
cycle for every expected M10 close last week. There were 637 expected broker
closes, 266 closes with one completed scan, 371 missing completed scans, and
two duplicated closes. Most missing closes occurred because the named EA was
not attached; 28 occurred after its first observed attachment and include an
EA swap, network loss, a prolonged series/reconnect stall, and restart/reload
boundaries.

The `preferredDirection + meaningful score + TRANSITION_WATCH + candidate=NO`
failure has a specific code cause. `ScoreSetups()` had already selected a real
M10 setup, but the later independent `XAU_EvaluateM10SignalDecision()` result
was treated as a second candidate-creation authority. A
`TRANSITION_WATCH` result unconditionally erased the existing setup unless the
newer engine had also reached its separate `oppositeEntryAllowed` state.

The repair keeps the bot pure M10. A fresh, direction-matching
`TRANSITION_WATCH` with confidence at least 55 now preserves the setup as a
real candidate so session, regime, grade, location, permanent blocks, and
owner blocks are evaluated. The approved transition protection remains an
ordinary downstream gate: an unconfirmed transition ends with the exact
`NORMAL_GATE_TRANSITION_CONFIRMATION_PENDING` result and cannot start the
timer or reach `OrderSend`.

## Exact production identity audited

| Item | Value |
|---|---|
| Live EA source | `MQL5/Experts/XauCloud-m10_ASIA+.mq5` |
| Live EA binary | `MQL5/Experts/XauCloud-m10_ASIA+.ex5` |
| Runtime version | `XauCloud-m10_v6.25.29_ASIA_A_PLUS_ONLY_NO_A_PLUS_RESET_PENDING` |
| Runtime build | `xaucloud-m10-permanent-gradeb-category-blocks-20260728` |
| Primary decision timeframe | `PERIOD_M10` |
| Magic | `20250401` |
| Source SHA-256 | `1838c6ade3243dd175e9f6c6ef80d01d1c44f88b0b2dfa2b02b6623445fe3f31` |
| Live EX5 SHA-256 | `a203f57b512970c491888a4f4ac6bbaa4db6d3e11cc10a67411b06f2b4946845` |
| Account/server | MetaQuotes-Demo hedging account observed in the live logs |
| Instrument | `XAUUSD` |

The live source is byte-identical to repository commit `a3b71339`. The stored
repository EX5 is not byte-identical to the live EX5, so the live binary hash
above is retained as the authoritative deployed-binary identity. Runtime
version and build logs agree with the matching source.

## Complete prior-week candle ledger

The machine-readable ledger is `cycle_ledger.csv`. It has one row for every
expected broker M10 close and contains all requested fields: close time, scan
status/count, indicator readiness, setup scores, BUY/SELL scores, preferred
direction, selected setup, candidate status/exact reason, grade, session,
regime, location, transition state, permanent and owner-location results,
normal gate, timer, order-send result, retcode, evidence ID, freshness, and
data state.

Headline totals:

| Measure | Result |
|---|---:|
| Expected M10 closes | 637 |
| Unique closes with a completed scan | 266 |
| Missing completed scans | 371 |
| Duplicate closes | 2 |
| Candidates created | 33 |
| Completed rows with immutable shift-1 evidence | 266/266 |

Missing-close attribution:

| Cause | Count |
|---|---:|
| Named EA not attached | 343 |
| No completed scan in live log after attachment | 28 |

The first named-EA attachment was observed on 2026-07-29 at 14:42 broker time.
From the corresponding 14:40 M10 boundary onward, 294 closes were expected,
266 completed, and 28 were missing. The 28 are concentrated in:

- five closes on 2026-07-30 from 14:50 through 15:30 during EA removal/swap;
- two closes on 2026-07-31 at 05:30 and 05:40 during network loss;
- 21 closes on 2026-07-31 from 09:30 through 12:50 during the series/reconnect
  stall and terminal restart.

Duplicates occurred at 2026-07-30 04:10 and 2026-07-31 15:30, both on
restart/reload boundaries.

M10 decision-state distribution for the 266 unique completed closes:

| Decision | Count |
|---|---:|
| `TRANSITION_WATCH` | 175 |
| `NO_VALID_SIGNAL` | 48 |
| `SELL_CANDIDATE` | 19 |
| `BUY_CANDIDATE` | 11 |
| `WAIT_FOR_SELL_RETRACE` | 7 |
| `WAIT_FOR_BUY_RETRACE` | 4 |
| `TREND_CONTINUATION_NO_ENTRY_YET` | 2 |

The live build did not log the internal `ScoreSetups` component score before
every veto. Those cells are marked `NOT_LOGGED_BY_LIVE_BUILD`; the audit does
not invent values.

## Root-cause trace

Concrete incident: M10 close 2026-07-31 03:20 broker time.

| Field | Live result |
|---|---|
| Indicator snapshot | `COMPLETE;closedShift=1;immutable=true` |
| BUY case | 29.57 |
| SELL case | 74.07 |
| Preferred direction | SELL |
| Existing setup | `TREND_PULLBACK` |
| M10 decision | `TRANSITION_WATCH` |
| Candidate | NO |
| Exact reason | opposite score cleared 55, but Adaptive Transition had not yet allowed entry |
| Permanent/owner/normal gates | not reached |
| Timer/OrderSend | not started/not reached |

This proves the setup engine itself was not the rejecting authority. The
newer canonical M10 case decision was evaluated after setup selection and
deleted the candidate before classification. At the next 03:30 close, the
same direction became `SELL_CANDIDATE`, candidate creation occurred, and the
permanent Asia non-A+ block correctly stopped it. That adjacent pair isolates
the authority boundary.

## Candidate and execution funnel observed

Of 33 created candidates, permanent policy blocked 12:

| Permanent result | Count |
|---|---:|
| `PERM_BLOCK_ASIA_NON_A_PLUS` | 8 |
| `PERM_BLOCK_GRADE_B_REVERSAL` | 3 |
| `PERM_BLOCK_A_PLUS_RESET_PENDING` | 1 |

Further observed outcomes included four owner late-session blocks, five
owner `LOCATION_EXCELLENT` blocks, one owner `LOCATION_LATE` block, one
breakout-market block, five timer expiries, and two structural-SL failures.
The two structural failures never reached `OrderSend`; v6.25.29 exposed only
a generic cancellation in the terminal funnel even though the exact internal
cause was `NO_VALID_CLOSED_M10_SWING_INVALIDATION`.

No automated live bot order was confirmed in the audited period. A separate
manual 0.40-lot sell/buy test produced the observed -$8.80 account change and
is excluded from bot performance.

## M10 data and scanner findings

- `PERIOD_M10` history was available and synchronized when completed scans
  ran.
- All 266 completed unique cycles recorded fresh, complete data from the
  latest fully closed M10 candle (`closedShift=1`, immutable).
- M10 indicator handles recovered from transient 4807/wrong-handle states;
  a logical scan was emitted only after the all-required snapshot completed.
- The chart timeframe changed between M5, H1, and M10 while the runtime signal
  authority stayed `PERIOD_M10`; chart timeframe did not override it.
- Live restart/reload boundaries produced two duplicate completed closes.
- The reconnect/series stall produced silent missing cycles because v6.25.29
  had no durable completed-bar ledger or explicit broker-bar gap record.

## Implemented repair

Release identity: `XauCloud-m10_v6.25.30_PURE_M10_CYCLE_AUTHORITY_FIX`
Build: `xaucloud-pure-m10-cycle-authority-restart-ledger-20260802`

1. A fresh, matching, confidence-55+ `TRANSITION_WATCH` preserves the existing
   M10 setup as a candidate instead of erasing it.
2. The candidate is fully classified and passes through permanent and owner
   policy first. If transition confirmation is still pending, the explicit
   downstream normal gate blocks it before timer and `OrderSend`.
3. Completed M10 decisions are persisted in a terminal-scoped ledger keyed by
   account, server, symbol, and magic. A restart suppresses only a bar already
   marked terminal; an interrupted latest bar is retried.
4. Offline/reconnect gaps enumerate only actual broker `PERIOD_M10` bars from
   `CopyTime`. Daily and weekend wall-clock closures are not fabricated as
   missed candles, and missed historical bars are never traded retroactively.
5. Candidate/timer state is not resurrected after restart. Transition state
   older than its M10 opportunity window, including weekend-stale state, is
   cleared. Tester persistent state is isolated per replay.
6. Startup telemetry records build/version/input/account/server/symbol/magic,
   chart and signal timeframes, latest closed M10 bar, synchronization,
   scanner/indicator readiness, license/trade permissions, and active blocks.
7. Execution telemetry now distinguishes structural/pre-broker failure,
   whether `OrderSend` was reached, exact result, and broker retcode.
8. The permanent-category runtime self-test has 16 distinct cases; the old
   duplicate index defect is removed. No permanent block was relaxed.

## Verification

MetaEditor compilation of the final source completed with 0 errors and 0
warnings. Targeted regression tests pass 17/17. The release identities are:

| Artifact | SHA-256 |
|---|---|
| Final source (`XAUUSD_AI_Sniper_EA.mq5`) | `721cb5096d73f7d17c77f970ffdb38ed7f7943ae3a0d618382265a7cb25d53c8` |
| Final compiled EX5 | `1244b533451553d493c0349d7211eee1ae46d71fc64424a2102726f1e5e2281e` |

Only MT5 Model 4 results are deployment evidence. Earlier Model 1 runs are
explicitly excluded.

| Window | Build | History quality | Net profit | PF | Trades | Max balance DD | Max equity DD | Recovery | Sharpe |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| July 1-31 | v6.25.29 baseline | 100% real ticks | $1,866.42 | 1.25 | 36 | $2,580.35 (19.60%) | $2,954.04 (21.98%) | 0.63 | 6.64 |
| July 1-31 | fixed | 100% real ticks | $1,828.18 | 1.24 | 36 | $2,566.22 (19.56%) | $2,938.29 (21.95%) | 0.62 | 6.51 |
| June 1-30 holdout | v6.25.29 baseline | 100% real ticks | $9,789.05 | 2.09 | 40 | $2,930.54 (13.06%) | $3,113.19 (13.78%) | 3.14 | 29.94 |
| June 1-30 holdout | fixed | 100% real ticks | $9,937.22 | 2.10 | 40 | $2,961.10 (13.09%) | $3,145.84 (13.81%) | 3.16 | 30.11 |

July changes by -$38.24 with the same 36 trades and slightly lower drawdown.
The untouched June holdout changes by +$148.17 with the same 40 trades and
nearly unchanged drawdown. The fixed replay log exercises real transition
candidates and records them as `candidateCreated=true` followed by the exact
normal transition gate when confirmation remains pending.

A final-hash weekend-boundary smoke replay (2026-07-24 through 2026-07-28)
also used Model 4 / 100% real ticks. It recorded 244 unique Friday/Monday M10
cycles with no duplicates and no intra-session `M10_CYCLE_GAP`, plus two
explicit `PURE_M10_SESSION_REOPEN` events. Its three-trade result was -$407.77
with PF 0.58; this short run is restart/session-boundary verification, not
profit evidence.

## Deployment status

The final source and compiled EX5 were deployed on 2026-08-02. Existing files
were backed up before replacement.

| Target | Installed filename | Backup | State |
|---|---|---|---|
| Mac MT5 | `MQL5/Experts/XauCloud-m10_ASIA+.mq5/.ex5` | `MQL5/Backups/pure_m10_v62530_20260802_165205` | exact release hashes installed; MT5 running and synchronized; saved profile has no EA chart attachment |
| VPS production MT5 | `MQL5/Experts/XauCloud-M10.mq5/.ex5` | `MQL5/Backups/pure_m10_v62530_20260802_175300` | exact release hashes installed; production terminal restarted and running |

The different filenames preserve each installation's existing chart/profile
references. Both carry the same internal v6.25.30 identity and byte-identical
release artifacts. The separate VPS research terminal was not changed.

Only Model 4 / real-tick results are deployment evidence. Model 1 is excluded.
The observed positive month results are historical tests, not a guarantee of
future net profit; July's roughly 22% maximum equity drawdown remains material.
