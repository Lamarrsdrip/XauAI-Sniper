# XauIndex v3.1.0 — Spike-Safe Index Engine (before/after)

Date: 2026-07-03
Scope: XauIndex (`XauIndex_EA_v3.0.mq5` → `v3.1.mq5`), rebuilt on gold v6.12.0 (was v6.10.0).

## Why this release exists

After shipping v3.0.0's real index entry engine, a direct audit against 6 specific questions found 3 confirmed gaps: no spike handling, no spread/gap protection, and `InpIndexProfile=BOOM_CRASH` was a label with no effect. This release fixes all three, plus brings XauIndex current with gold's two most recent releases (v6.11.0 momentum override, v6.12.0 calibrated entry/runners).

## Before → After

| Question | v3.0.0 (before) | v3.1.0 (after) |
|---|---|---|
| Spike behavior | Not handled — a Boom/Crash spike candle (tight range + one huge-bodied bar) looked identical to a genuine breakout to the detector, and could have triggered an entry into the spike itself. | `XAU_IndexFindRecentSpike()` scans recent bars for range/body far exceeding normal ATR behavior. Never enters on the spike candle itself. During a cooldown window after a spike, blind breakout entries are disabled; only an explicit post-spike continuation (price sustained ≥1 ATR beyond the spike's own close, same direction) or a controlled pullback-with-rejection can qualify. |
| Spread/tick gaps | Not blocked at all — the Index Mode gate never checked spread, and gold's own spread gate (`InpMaxSpread`) runs earlier in the pipeline but was never referenced, and is a fixed XAUUSD point count anyway. | `XAU_IndexSpreadGapOK()` — three independent, symbol-relative checks: current spread vs. a fraction of this symbol's own ATR, current spread vs. a multiple of the EA's existing rolling spread EMA (`g_spreadEMA`, already symbol-agnostic), and price gap vs. the last closed bar vs. ATR. Zero fixed XAUUSD thresholds. Runs first in the composite scorer, before any setup is even evaluated. |
| BOOM_CRASH profile | `InpIndexProfile` existed and was logged, but zero code branched on it — a label only, exactly as its own code comment admitted. | `XAU_IndexIsBoomCrashProfile()` is checked in 4+ places: breakout entries can be disabled outright (default: disabled), the spread/gap gate tightens by a multiplier, the spike cooldown window lengthens, and position sizing/lot cap changes at the trade-placement site. |
| Separate Boom/Crash risk settings | None. | New input group: `InpIndexBoomCrashRiskMult` (0.5 — half normal risk), `InpIndexBoomCrashMaxLot` (0.10 — hard cap enforced via partial-close immediately after entry, independent of account-size scaling), `InpIndexBoomCrashSpreadMult` (0.6 — tighter gate), `InpIndexBoomCrashAllowBreakout` (false — pullback/continuation-only by default), `InpIndexBoomCrashSpikeCooldownMult` (2x — longer caution window). |
| Boom/Crash detection | Correct already (keyword-based auto-detect + forceable profile). | Unchanged, still correct. |
| Symbol properties / SL-TP for synthetics | Correct already (broker-native `SymbolInfo*` calls, ATR-based SL/TP). | Unchanged, still correct. |

## What did NOT change

- `InpIndexModeLogOnly` still defaults to `true`. Nothing in this release makes Index Mode trade live by default — it only makes the log-only evaluation more trustworthy before that switch is ever flipped.
- Gold Mode behavior is untouched (v3.1.0 rebuilds on gold v6.12.0's exact, already-tested logic, same approach as v2.0.0 and v3.0.0).
- The hard lot cap is enforced via `trade.PositionClosePartial()` immediately after entry, not by modifying `OpenTrade()`'s shared, gold-tested internals — avoids any risk to gold's own sizing path.

## Testing

`tests/test_xauindex_v3_1_0_identity_static.py` — 23 tests, including: spike detector exists and uses ATR/body-ratio thresholds; breakout never fires on the spike bar itself; post-spike confirmation requires direction-match and sustained-distance; pullback also spike-aware; spread/gap gate is symbol-relative (`InpMaxSpread` explicitly absent from it) and runs before any setup scoring; BOOM_CRASH profile referenced 4+ times across spike/spread/breakout/sizing; Boom/Crash defaults match spec (0.5x risk, 0.10 max lot, 0.6x spread, breakout disabled, 2x cooldown); lot cap uses partial-close, not shared internals; every index decision logs a specific reason. Compiled clean: 0 errors, 0 warnings. Full suite: **231/231 passed**.

## Still open

This engine — spike detection thresholds, spread/gap multipliers, and the BOOM_CRASH defaults — has not been run against a single real index candle. It should be watched log-only against a real Deriv/index feed, with the printed `INDEX_ENGINE`/`INDEX_TRACE`/`INDEX_BOOM_CRASH_LOT_CAP` log lines reviewed, before `InpIndexModeLogOnly` is ever set to `false`.
