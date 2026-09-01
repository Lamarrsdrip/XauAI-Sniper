# XAU AI Sniper v6.4.12 Adaptive Trade Management Audit

Generated: 2026-06-30

## Executive finding

The evidence supports the user's hypothesis for the key June 30 sequence: the EA did not only have a "large SL" problem. A high-quality sell was closed too early by giveback/floor logic, then the EA later re-entered the same broad sell idea lower and closer to exhaustion. That later trade had less room and lost far more than the earlier winner banked.

The fix in v6.4.12 is not "always hold longer" and not "always cut early." It adds adaptive trade-context classification so exits, partials, profit floors, giveback room, and same-direction re-entry patience respond to the live trade state.

## Exact 17-19 June build evidence

Local MT5 terminal logs show:

- `20260617.log`: `XAUUSD_AI_Sniper_EA_MASTER_v5.8.50_EVIDENCE_REFACTOR` loaded repeatedly on XAUUSD M5. Example: lines 86, 95, 104, 120, 129, 136.
- `20260617.log`: the screenshot-matching buy campaign opened under v5.8.50, including order `#9136298840` buy 0.10 at 4357.81, then SL ratchets to 4357.81, 4371.30, and 4375.70 before closing. Lines 137-140, 150-152, 166-177, 188-193.
- `20260618.log`: local terminal started on v5.8.50, switched to `v5.8.51_LIVE_READINESS` at line 29, then `v5.8.52_APLUS_PROFIT_SHIELD` at line 437, then `v5.8.53_SMART_SHIELD` at line 502.
- `20260619.log`: local terminal shows v5.8.53 removed and `v5.8.54_PATIENT_PROFIT_SHIELD` loaded at line 73.

Conclusion: on the local Mac, June 17 was clearly v5.8.50. June 18-19 were not one single build locally; they rotated through v5.8.50 to v5.8.54. I cannot prove the VPS exact file without VPS logs, but the local screenshot period strongly points to the v5.8.50-v5.8.54 profit-shield family.

## June 30 evidence

Terminal log:

- `20260630.log` lines 67-72: sell `#9345868492` opened 0.15 at 3988.22 and closed at 3983.04.
- `XAUAI_ExecutedTradeBrain_XAUUSD.csv` line 1051: that same trade was A+ `HTF_TREND_FOLLOW`, clean-pullback timing, `remainingRoom=8.60ATR`, closed as `THESIS_BROKEN_EXIT | peak $76.80 floor $42.24 current $7.68 giveback 90%`.
- Post-close intelligence lines 1056, 1058, 1059: the EA later marked this as `EXIT_EARLY_LEFT_PROFIT`, with price reaching 3977.32/3980.97 after the close.
- `20260630.log` lines 77-80: later sell `#9347132318` opened 0.26 at 3986.97.
- `XAUAI_ExecutedTradeBrain_XAUUSD.csv` lines 1060-1061: later A+ `HTF_TREND_FOLLOW` opened at 3987.01 and closed by broker SL at 4000.91 for `-362.44`; best floating was only `$25.48`.

Interpretation: the earlier trade had better price, A+ quality, large remaining room, and already proved itself. The latest exit logic still let giveback/floor override context and closed it. The later re-entry was worse-positioned and became the big loss seen in the screenshots.

## Root cause

The latest smart-exit/floor logic treated profit protection too mechanically:

- `XAU_SmartExit3Layer()` closed on floor/giveback failure without first classifying whether the trade was still a strong trend, normal pullback, explosive move, weak trade, or true exhaustion.
- `XAU_ProtectPeakProfitFloor()` also used a fixed protected peak lock/giveback model, so an otherwise valid runner could be closed because the profit floor was touched.
- Same-direction re-entry memory used a static extended wait. That reduced some overtrading, but it still did not ask whether the macro trend was clean enough for a faster reset or weak enough to require patience.

## Implementation

Changed source:

- `XAUUSD_AI_Sniper_EA_v6.4.6.mq5`
- `XAUUSD_AI_Sniper_EA_v6.4.12.mq5`
- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`

Main functions added/changed:

- `XAU_TRADE_CONTEXT_STATE`
- `XAU_ClassifyTradeContext()`
- `XAU_ContextAllowedGivebackPct()`
- `XAU_ContextLockPct()`
- `XAU_ContextShouldTakePartial()`
- `XAU_AdaptiveReentryWaitMin()`
- `XAU_ThesisHoldRunnerAllowed()`
- `XAU_SmartExit3Layer()`
- `XAU_ProtectPeakProfitFloor()`
- `XAU_GrowthGuardEntryBlockReason()`
- `XAU_GrowthGuardManagePosition()`

New adaptive behavior:

- Strong trend: wider giveback and lower lock pressure, runner can continue only with protected stop.
- Normal pullback: hold if thesis is still valid and recovery evidence exists.
- Explosive move: larger profit lock and context-gated partial, because fast gold expansions often snap back.
- Weak trade: smaller giveback and tighter protection after meaningful profit.
- Trend exhaustion: larger lock and exit/tighten behavior when structure/momentum actually weakens.
- Same-direction re-entry after a profitable close is now macro-aware instead of one fixed cooldown.

Risk/equity behavior preserved from v6.4.12:

- Real XAU risk math via `OrderCalcProfit`.
- Minimum RR filter.
- Per-trade and basket risk caps.
- Daily profit lock.
- Oversize/consecutive-loss pause.
- Opt-in bad-entry fast cut remains disabled by default so normal XAU fake-push drawdown is not overcut.

## Validation

Passed:

- `pytest -q tests/test_xau_v6412_thesis_hold_static.py` -> 7 passed.
- Focused EA regression suite -> 44 passed.
- MetaEditor compile -> `Result: 0 errors, 1 warnings`; warning is the existing MQL Market version format warning for `6.4.12`.

Broader checks:

- `pytest -q` is blocked during collection by unrelated missing `/app/frontend/.env` in `backend/tests/test_cloud_billing_and_copy_trading.py`.
- `pytest -q tests` ran 88 tests: 79 passed, 9 failed in stale frontend/old-version static tests unrelated to this EA exit change.

## Version and deployment file

New version:

- `v6.4.12`
- build hash: `v6412-equity-growth-guard-20260630`

Compiled file:

- `/Users/libertyelectronics/XauAI-Sniper/XAUUSD_AI_Sniper_EA_v6.4.12.ex5`

Already copied into MT5 Experts:

- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Experts/XAUUSD_AI_Sniper_EA_v6.4.12.ex5`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Experts/XAUUSD_AI_Sniper_EA_v6.4.12.mq5`

