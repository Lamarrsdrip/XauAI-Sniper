# XAU AI Sniper v6.4.24 — Profit Giveback Gate Audit

Date: 2026-07-01

## Complaint

"Focus on good entry and perfect exit timing. If a bad trade hits SL, other
profit will be fully enough to cover it — IF we have a good exit that
doesn't give back too much and doesn't close early for small profit and
miss out."

Two symptoms, same root cause: exits triggered on giveback %/context alone,
with no reversal proof, either giving back too much before any protective
action beyond a full close, or firing a full close on a normal pullback that
then continued.

## Evidence (MQL5/Logs 20260624-20260701, retail $3k account)

**Giving back too much before locking in (basket-level, clean data):**
- `20260629.log` 19:29:48 — `BASKET LOCK │ $76.11 peak → $34.50 banked` (54.7% giveback).
- `20260629.log` 23:46:57 — `BASKET LOCK │ $77.88 peak → $31.98 banked` (58.9% giveback).
- `20260629.log` 13:20:53 — `BASKET HARD-CAP │ giveback $85.65 ≥ cap $72.45` on `peak $234.80 → $149.15` (36.5% giveback), a still-profitable basket fully closed on the FIRST breach with no partial-lock attempt.

**Position-level (~90% giveback, AMPL/THESIS_BROKEN_EXIT-adjacent):**
- `20260629.log` #9329048746: peak $71.64 → closed $7.16 (90% giveback).
- `20260629.log` #9311576060: peak $42.98 → closed $4.30 (90% giveback).
- `20260630.log` #9340980323/#9343159987/#9345868492: all closed via `THESIS_BROKEN_EXIT | giveback 90%`.

**Closed early, missed the bigger move (clean $3k-account case):**
- `20260701.log` posId #9383190740 (HTF_TREND_FOLLOW, grade A): peak $77.91, closed at $51.45 via `THESIS_BROKEN_EXIT | ADAPTIVE_CONTEXT_WEAK_TRADE ... giveback=36% allowed=35%`. Post-close `EXIT-BRAIN` tracking: 30m checkpoint `EXIT_EARLY_LEFT_PROFIT maxMore=1.30ATR($105)`; 60m checkpoint `maxMore=2.82ATR($229)` — roughly 4.4x the banked amount left on the table because a momentary momentum dip reclassified the trade as `WEAK_TRADE` context (35% max allowed giveback) and the already-accumulated 36% giveback retroactively breached that new, tighter cap.
- `xau_v6_4_21_forensic_performance_comparison`: early-exit self-flagged markers rose from 50 (pre-AI-Director period) to 82 (post-AI-Director period) despite fewer post-close review rows overall — a higher rate of self-diagnosed early exits under the newer build.

## Root Cause

Same pattern as the v6.4.22 loss-side bug, mirrored on the profit side:

1. `XAU_ClassifyTradeContext()` assigns a trade context (STRONG_TREND,
   NORMAL_PULLBACK, WEAK_TRADE, EXPLOSIVE_MOVE, TREND_EXHAUSTION) from
   momentary momentum/EMA/RSI/giveback-so-far readings. `XAU_ContextAllowedGivebackPct()`
   then caps allowed giveback per context: 92% for STRONG_TREND, but only
   35% for WEAK_TRADE, 28% for TREND_EXHAUSTION. A trade can accumulate 36%
   giveback while classified STRONG_TREND/NORMAL_PULLBACK (both fine so
   far), then get reclassified WEAK_TRADE on a single weak-momentum bar —
   at which point the ALREADY-accumulated 36% giveback instantly breaches
   the new 35% cap and `XAU_SmartExit3Layer()`'s `SMART_EXIT_GIVEBACK`
   fires, with no check for whether the market actually reversed.
2. `ManageBasket()` Guard 1 (fast-reversal, 50% drop in a window) and Guard
   2 (hard $ giveback cap) both fully close a still-profitable basket on
   the FIRST breach — bypassing the existing `InpBasketSoftLockFirst`
   partial-bank-and-keep-runner logic that the floor-trigger block already
   uses for its own breaches.

## Fix

New input `InpAllowGivebackPanicClose` (default `false`) and an extension
to the existing `XAU_GateEarlyLossClose()` gate: callers now pass
`isGivebackTrigger=true` for giveback-driven closes, which skips the
"profit always auto-allows" shortcut. A giveback/context breach can only
fully close a still-profitable position/basket if:
- a confirmed reversal exists (structure break, or EMA+RSI+momentum
  genuinely against), or
- this is a repeat breach after the position/basket already took its first
  soft-lock/partial (i.e., it was already warned once and failed again), or
- `InpAllowGivebackPanicClose` is explicitly set true.

Applied to:
- `XAU_SmartExit3Layer()` `SMART_EXIT_GIVEBACK` (per-ticket).
- `XAU_ProtectPeakProfitFloor()` `SMART_EXIT_TREND` (per-ticket).
- `ManageBasket()` Guard 1 (fast-reversal) and Guard 2 (hard-cap) — both now
  attempt a soft-lock partial (bank `InpBasketSoftLockPct`%, keep a runner)
  on the first breach, exactly like the floor-trigger already did, and only
  fully close on a repeat breach or confirmed reversal.

The floor-trigger's own `BASKET LOCK` full close (which already only fires
as the SECOND breach, after soft-lock already banked once) was left
unchanged — a repeat breach after an already-taken partial is legitimate
justification on its own.

Nothing about the floor SL ratchet mechanism (`XAU_ProtectPeakProfitFloor`'s
`SafeModifySL` calls, AMPL's momentum-scaled trail) changed — that keeps
tightening exactly as before. This fix only changes whether the EA
proactively market-closes ON TOP of that SL without proof.

## Verification

`test_reports/metaeditor_v6424.log`: `Result: 0 errors, 0 warnings`.

Behavioral check pending on live/demo: confirm `PROFIT_GIVEBACK_CLOSE_BLOCKED`
and `BASKET SOFT-LOCK (FAST-REVERSAL/HARD-CAP)` lines appear instead of an
immediate full bank on the next giveback breach with no confirmed reversal,
and that the WEAK_TRADE-context case (36% giveback, no real reversal) now
holds instead of closing.
