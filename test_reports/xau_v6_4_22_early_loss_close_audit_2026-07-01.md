# XAU AI Sniper v6.4.22 — Early Loss Close Forensic Audit

Date: 2026-07-01

## Complaint

Live account: EA force-closed trades at small losses before SL, right before
price resumed in the original trade direction. Example from user-reported
journal lines:

```
PROFIT_FLOOR_SET BASKET
GIVEBACK_WARNING BASKET
GIVEBACK_LIMIT_TRIGGERED BASKET
CONTINUATION_HOLD_REJECTED BASKET
FORCE CLOSE reason=THESIS_BROKEN_EXIT.BASKET
CLOSED: LOSS ~-$2.10
```

Basket peak was ~+$126.42 before the close. Separately reported:
- SELL 0.21 @4088.90 closed @4088.96 for -$1.26
- SELL 0.21 @4091.16 closed @4091.26 for -$2.10
- XAUUSD then dropped to ~4075 after both closes — the sells would have been
  strongly profitable had they been left to breathe to SL.

## Source Audited

`XAUUSD_AI_Sniper_EA_v6.4.21.mq5` (pre-fix), cross-checked against
`test_reports/xau_v6_4_21_forensic_performance_comparison_2026-07-01.md`
(June 17-19 vs June 28 - July 1 comparison, which separately found: "Period B
post-close review rows: 134; early-exit markers: 82" — confirming the newer
protection stack was cutting exits early more often than the June 17-19
baseline).

## Root-Cause Trace

`GIVEBACK_LIMIT_TRIGGERED BASKET` / `CONTINUATION_HOLD_REJECTED BASKET` /
`FORCE CLOSE reason=THESIS_BROKEN_EXIT.BASKET` traces to
`XAU_BasketLifecycleManager()` (called from `ManageBasket()`, which runs every
tick regardless of other settings):

```
if(totalPnL <= 0.0 && givebackPct >= InpLifecycleAdverseAfterProfitPct)
{
   ...
   lastExitReason = StringFormat("%s BASKET | peak $%.2f -> $%.2f",
                                 XAU_SmartExitStateName(THESIS_BROKEN_EXIT),
                                 g_basketPeakUSD, totalPnL);
   CloseAll(lastExitReason);
   ...
}
```

With `InpLifecyclePeakMinUSD=75` and `InpLifecycleAdverseAfterProfitPct=70`,
a basket that peaked at $126.42 only needed to give back 70% (~$88, i.e. drop
to ~$38) to arm — but the trigger condition only required `totalPnL <= 0`,
so it kept running and closed at -$2.10 (giveback ~102%). **No structure
check of any kind gated this close** — it fired on giveback % alone and was
mislabeled `THESIS_BROKEN_EXIT` even though nothing about market structure
had been examined. This is a direct match for the reported bug: normal XAU
pullback (basket dipping from +$126 to -$2, well within one adverse M5/M15
swing) was treated as "thesis broken."

The same missing-structure-check pattern existed in three sibling paths:
- `ManageBasket()` Guard 1 (fast reversal) red-close branch
- `ManageBasket()` Guard 2 (hard $ giveback cap) red-close branch
- `ManageBasket()` floor-trigger red-close branch

All three already checked `InpProtectedPeakBasketCloseRed &&
g_basketPeakUSD >= InpProtectedPeakMinUSD` before closing red, but neither
condition has anything to do with market structure — both are just "was the
basket ever meaningfully profitable," which is true of nearly every trade
that later hits a red giveback close.

Per-ticket paths with the same gap:
- `XAU_SmartExit3Layer()` — `SMART_EXIT_FLOOR` / `SMART_EXIT_GIVEBACK`
  (`THESIS_BROKEN_EXIT` label) closed on `profitUSD <= 0` / floor-or-giveback
  breach without requiring `structureConfirmedBroken`.
- `XAU_ProtectPeakProfitFloor()` — `SMART_EXIT_TREND`
  (`CONTINUATION_EXIT_PROFIT_PROTECTED` label) same gap.
- `TTM_Evaluate()` — the `liveScore < InpTTM_ExitThreshold` branch
  (`TTM_THESIS_DEAD`) closed on score alone; only the BOS-flip and HTF-flip
  branches were genuinely structural.
- `XAU_GrowthGuardManagePosition()` — `GROWTH_HARD_LOSS` and
  `GROWTH_BAD_ENTRY_THESIS` used `thesisFailing = structureConfirmed ||
  (emaAgainst && rsiAgainst) || (!trendAligned && momentumScore <= 2)` — i.e.
  could fire on EMA/RSI/momentum alone, no structure required.
- `ManageCleanExitsForPosition()` — `CLEAN_STAGNANT`, `CLEAN_STALE`, one OR
  branch of `CLEAN_INVALID`, and `APLUS_GIVEBACK_EXIT` (A+ Profit Shield
  Tier 2) closed on time/regime/giveback % without a structure requirement.

Paths already correctly gated (left unchanged): `EARLY_CONVICTION_CUT` and
`STRUCTURE_FAILFAST` (invalidScore/failedStructure mathematically require
`structureConfirmedBroken`), `NO_PARTIAL_SMART_LOSS` (requires confirmed
structure+EMA+RSI failure), `EXPECTANCY_MAX_LOSS`
(`InpExpectancyRequireStructureBreak=true` by default), `HARD_STOP` /
`HARD_STOP_R` (catastrophic R-multiple backstop, not a giveback panic close),
`GROWTH_HARD_LOSS_EXIT` / `GROWTH_BASKET_LOSS` (equity% backstop caps), and
`AI_DIRECTOR_EXIT_CLOSE` (already hard-coded to only close AI-flagged losers
above +0.3R, i.e. never closes a loser).

## Fix

Added `input bool InpAllowEarlyLossExit = false;` and a single choke-point:

```
bool XAU_GateEarlyLossClose(ulong ticket, bool isBuy, double openPx, double curPrice,
                            double currentPnL, double peakProfit, string reason,
                            bool structureBroken, bool emergency, double ttmScore = -1.0)
```

Rule: if `currentPnL > 0` the close is always allowed (never blocks banking
profit or protecting a proven winner). Otherwise the close is allowed only if
`InpAllowEarlyLossExit` is true, `emergency` is true (deep equity/R backstop
already fired independently), or `structureBroken` is true — computed per
call site from the best locally-available signal: H1 BOS flip
(`g_smc_bos_dir`), HTF consensus flip (`g_htfConsensusDir`), or a confirmed
M5 close through the swing/invalidation level (`CleanStructureBreakBars` /
`structureConfirmedBroken` / `structureConfirmedEA`). For basket-level
closes, a new `XAU_BasketStructureBroken(basketDir)` applies the same BOS/
HTF/M5 test against the basket's dominant open-position direction.

Every call prints `MANUAL_CLOSE_DIAGNOSTIC` (ticket, direction, entry,
current price, P/L, peak, giveback %, reason, BOS, HTF, TTM score where
known, structureBroken, emergency, `InpAllowEarlyLossExit`,
ALLOWED/BLOCKED). Blocked attempts additionally print `EARLY LOSS CLOSE
BLOCKED — letting trade breathe.`

Thirteen close paths were wired through the gate: `GIVEBACK_LIMIT_TRIGGERED
BASKET` (lifecycle + fast-reversal + hard-cap + floor), `CYCLE_DECAY_EXIT
BASKET` (both branches), `SMART_EXIT_FLOOR`, `SMART_EXIT_GIVEBACK`,
`SMART_EXIT_TREND`, `GROWTH_HARD_LOSS`, `GROWTH_BAD_ENTRY_THESIS`, `TTM_EXIT`,
`CLEAN_STAGNANT`, `CLEAN_STALE`, `CLEAN_INVALID`, `APLUS_GIVEBACK_EXIT`, plus
the legacy (non-default, `InpCleanExits=false`) `EARLY_ADVERSE`,
`PEAK_RETRACE`, `MOMENTUM_FADE`, `SMART_CUT`, `STALE_LOSS`, `STALE_DRIFT`,
and `CLAUDE_AI` paths for defense-in-depth. `EARLY_CONVICTION_CUT` and
`STRUCTURE_FAILFAST` were also wired through for diagnostic-log consistency,
but since they already require confirmed structure, the gate is a no-op for
them.

## Verification

`test_reports/metaeditor_v6422.log`: `Result: 0 errors, 0 warnings`.

Behavioral check still pending on live/demo: confirm
`MANUAL_CLOSE_DIAGNOSTIC` / `EARLY LOSS CLOSE BLOCKED` lines appear in the MT5
journal the next time a basket or position gives back profit into a small
loss without a real BOS/HTF/M5 structure break, and that the position is
instead left open to SL or real structural invalidation.
