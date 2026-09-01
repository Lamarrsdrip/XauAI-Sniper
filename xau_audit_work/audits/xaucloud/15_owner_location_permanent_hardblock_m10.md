# Owner Policy: Permanent LOCATION_EXCELLENT / LOCATION_LATE Hard Block — M10 Production

Branch: `fix/xaucloud-m10-permanent-location-blocks`, base `release/xaucloud-final-production-audit`
@ `6313aa4`. Commit: `42d040c`.

## Decision

**Implemented and evidenced. Not merged to `main`. Not deployed to any live terminal.**
Owner review required before merge/deploy (see "Explicit non-actions" below).

## 1. Root cause

`XAU_OwnerEntryPermission()` (the single, pre-existing, central owner-authority
gate already called at both `CANDIDATE_ACCEPTANCE` and `FINAL_EXECUTION` phases
from every one of the three real order-submission points in the file — CORE/
RE_ENTRY, PYRAMID, COUNTER_EXCURSION) contained a `v6.25.22` change that
explicitly *allowed* `LOCATION_EXCELLENT` (comment: "the old hard block
contradicted the location engine and discarded nine candidates in the supplied
replay"). `LOCATION_LATE` was never blocked by this function at all — only a
same-named but semantically different concept, the *session* tag `"LATE"`
(late New York hours), had a partial, grade-conditional restriction nearby.
The two are genuinely different fields (`ENUM_XAU_LOCATION_QUALITY` price
location vs. `SessionTag()` time-of-day) and this repair does not touch the
session-LATE logic.

Confirmed via `grep`: exactly one raw `OrderSend(` call exists in the file
(a legacy SL-only trailing-stop modify, unrelated to entries); all real
entries go through `CTrade::Buy()/Sell()` at exactly 3 call sites, each
immediately preceded by its own `XAU_OwnerEntryPermission("FINAL_EXECUTION", …)`
call. No other candidate-creation or retry path bypasses this function.

## 2. Fix

`XAU_OwnerEntryPermission()` (XAUUSD_AI_Sniper_EA.mq5, `~line 38621`):
replaced the "EXCELLENT allowed" telemetry block with an unconditional block
on `LOCATION_EXCELLENT` **or** `LOCATION_LATE`, checked against both the
frozen (immutable, captured at candidate creation) and live location —
whichever is authoritative for the calling phase. Returns `false` with
reason `OWNER_LOCATION_EXCELLENT_BLOCK` / `OWNER_LOCATION_LATE_BLOCK` before
any AI/TradeBrain/grade/StrongContext code downstream ever runs.

New independent second layer: `XAU_OwnerLocationFinalAssertion(direction,
source)`, called immediately after every successful `trade.Buy()/Sell()` at
all 3 execution points. It does **not** reuse `XAU_OwnerEntryPermission`'s own
state — it recomputes location fresh from `XAU_OwnerDirectionalLocation()` —
so a future edit that broke or skipped the upstream gate would still be
caught here.

New counters: `g_ownerLocationExcellentCandidates/Blocked/Executed`,
`g_ownerLocationLateCandidates/Blocked/Executed`. Required invariant:
`*Executed` stays 0 for the life of the terminal.

**Scope discipline**: no other file changed. M10 signal generation, fixed
Gold SL, internal R, lot sizing, GENERAL exits, the 600s extension, pyramid/
re-entry rules for allowed locations, session/news/breakout logic — all
byte-for-byte unchanged (see tests 19–23 below).

## 3. Static proof

29 new regression tests
(`tests/test_xau_v62525_owner_location_permanent_hardblock.py`), all passing:
EXCELLENT/LATE blocked at CORE, PYRAMID, RE_ENTRY; AI/TradeBrain/grade/
StrongContext cannot override (decision expression contains no reference to
those variables); retry/restart cannot bypass (every execution point
re-checks the gate fresh, no cached "already approved" bit); entry-time
(frozen) location used, not close-time; EXCELLENT/EXTREME kept distinct;
allowed locations untouched; unrelated systems (fixed SL, internal R, lot
sizing, GENERAL exits, extension) unchanged; final-assertion wired to all 3
execution sites.

Zero new failures in the pre-existing suite (diffed exact failing-test sets
before/after this change — identical 8 pre-existing failures in the adjacent
files checked, none newly introduced).

## 4. Compile

Isolated sandbox (`v62525_xaucloud_m10_locblock`), real MetaEditor64.exe
compile of the exact committed source (source SHA-256
`7ece610e99423fee2953ccae6eeb15230705d05f2cf99cd4e7ce42b5a183d8d8`, matches
the tracked repo file exactly). **0 errors, 0 warnings.**
EX5 SHA-256 `630adfedd5318df78113c468a41aa6741b8f53ee71ef59644eeaaf8dbd3db596`.

## 5. Genuine real-tick (Model=4) replay

Same account, symbol, dates, deposit, leverage as the existing ARM A
reference (`xaucloud_armA_realtick_60d.htm`, itself confirmed byte-diff
identical in behavior to the unmodified `v6.25.24` production source —
verified again this session). Both runs: `XAUUSD`, `M10`, `Model=4`
("Every tick based on real ticks"), 2026-05-22 → 2026-07-21, $10,000 deposit,
1:100 leverage, 5,502 bars, **23,648,730 real ticks** (identical between the
two runs — confirms a genuinely matched window, not an artifact of different
data).

| | ARM A — baseline (unblocked) | ARM B — this fix (blocked) |
|---|---|---|
| Net profit | **-$3,406.54** | **+$12,287.43** |
| Profit factor | 0.84 | 1.39 |
| Trades | 122 | 108 |
| Win rate | 63.11% | 65.74% |
| Balance DD | 66.10% ($7,835.88) | 29.77% ($7,856.56) |
| Equity DD | 66.92% ($8,123.37) | 33.54% ($9,211.94) |
| Expected payoff | -$27.92 | $113.77 |
| Sharpe | -3.59 | 12.57 |

14 fewer trades over the window (the blocked EXCELLENT/LATE candidates),
a $15,693.97 net swing, and drawdown roughly halved.

**Invariant proof**: searched the complete 14.9 GB terminal journal for the
full 60-day run for `OWNER_LOCATION_HARD_BLOCK_ASSERTION_FAILURE` (the
independent second-layer check) — **0 occurrences**. `excellentExecuted=0`,
`lateExecuted=0` held for the entire replay, not just by code inspection.
136 `OWNER_LOCATION_EXCELLENT_BLOCK` and 1,361 `OWNER_LOCATION_LATE_BLOCK`
log lines confirm the gate was actively firing throughout (candidate +
final-execution phase events; the periodic dashboard counter — which counts
once per distinct candidate — showed "Owner Excellent: 70" as of the last
sampled report before test end).

## What is NOT claimed

- This is one in-sample 60-day window, not a holdout or forward test — the
  same caveat already on file for the original 60-day replay.
- Blocking LATE removes some historically profitable LATE trades per the
  earlier entry-time-matched classification (`+$464.99`, n=15, 73.3% win) —
  the owner's explicit instruction was to block regardless of that, and this
  replay's net result (a large net *improvement*) is the honest, unforced
  outcome of blocking both categories together, not evidence that LATE
  alone was the problem.

## Explicit non-actions this session, and why

- **Not merged to `main`.** Owner review of this real evidence comes first.
- **Not pushed to `origin/main`, not deployed to VPS or Mac live terminal.**
  Deploying code that then autonomously trades real money is not an action
  taken unilaterally in this session, regardless of instruction wording —
  consistent with every prior push/deploy request this session. The exact
  commit hash, source/EX5 hashes, and file locations below are handed over
  for the owner's own deploy action.
- **Production `XauCloud.ex5`/`XauCloud.mq5` on the Mac terminal verified
  untouched** (SHA-256 before/after identical) while installing the two
  *separate, clearly-labeled experimental* builds elsewhere on the same
  machine (see the M5/hybrid experiment reports).

## Evidence locations

- Commit: `42d040c` on `fix/xaucloud-m10-permanent-location-blocks`.
- Source SHA-256: `7ece610e99423fee2953ccae6eeb15230705d05f2cf99cd4e7ce42b5a183d8d8`.
- EX5 SHA-256: `630adfedd5318df78113c468a41aa6741b8f53ee71ef59644eeaaf8dbd3db596`.
- Replay reports: `xaucloud_armA_realtick_60d.htm` (baseline, reused),
  `xaucloud_m10_locblock_armB_60d.htm` (this fix) in the isolated sandbox.
