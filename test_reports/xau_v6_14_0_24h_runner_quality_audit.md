# XAU AI Sniper v6.14.0 - 24h Runner Quality Audit

Date: 2026-07-06
Source reports:
- XAUAI_ForwardTest_2026.07.06.txt
- XAUAI_ExecutedTradeBrain_XAUUSD.csv
- XAUAI_BlockedTradeMemory_XAUUSD.csv

## 24h Evidence

- EA under review: v6.13.0, build v6130-anti-repeat-loss-guard-cloud-fix-20260703.
- Forward report equity: start $2727.46, end $2939.97, +$212.51 (+7.79%).
- Trades opened: 11. Wins: 9. Losses: 2. Win rate: 81.8%.
- Executed trade-memory closes for 2026.07.06: 11 closes, 9 wins, 2 losses, closed P/L +$100.18.
- TREND_PULLBACK was strong: 5 trades, 5 wins, net +$321.00.
- HTF_TREND_FOLLOW was the weak area: 5 trades, 3 wins, 2 losses, net -$316.74.
- MULTI_EXTREME: 1 trade, 1 win, +$95.92.
- Exit reasons: EV_PROTECT 4, BASKET hard-cap 3, broker SL 2, PROFIT_FLOOR 1, SMART_EXIT_FLOOR 1.
- Forward report max floating gain/loss was stuck at $0.00, while trade memory showed real MFE/MAE. That made runner analysis weaker than it should be.

## Root Cause

The day was profitable, but not yet shaped like the user's goal of "one good runner pays for several losses."

Main issues found:
- Good trend trades were often protected too quickly by EV/profit floor/basket hard-cap while post-close tracking showed meaningful continuation still available.
- HTF_TREND_FOLLOW was getting permission from broad higher-timeframe direction, but the recent report showed it still needs better entry location: value retest, BOS plus momentum near mean, or confirmed post-news continuation.
- News/personality/spread/location blocks still produced some clean missed candidates. The fix does not blindly allow them; it lets confirmed continuation pass earlier only when momentum, HTF, room, RR, and spread agree.

## v6.14.0 Fixes

1. Runner Conviction Hold
- Adds a protected-runner hold layer for trades that have meaningful profit, clean M5/M15/HTF evidence, structure intact, enough room, and no exhaustion context.
- Widens the profit floor and giveback only under that proof, so strong runners can breathe without removing protection.

2. Basket Runner Defer
- Basket fast-reversal, hard-cap, and basket-lock full-close paths now check whether the basket is still a valid trend runner.
- If the basket thesis remains valid, the EA defers the full close and keeps a looser protected floor.

3. HTF Trend-Follow Entry Quality
- HTF_TREND_FOLLOW now requires value/retest or BOS plus momentum near EMA, unless a high-quality post-news continuation is confirmed.
- This targets the losing HTF trades from the 24h report without blocking TREND_PULLBACK, which performed best.

4. Adaptive News Continuation
- Post-news continuation can fast-track M15 confirmation only when impulse, HTF/regime, midpoint hold, spread, room, and RR quality agree.
- Poor RR, overextension, spread, and fake breakout blocks remain intact.

5. Honest Floating Report
- Forward floating gain/loss/drawdown stats now update on every tick, not only while scanning entries.

## Validation

- Static regression suite: 248 passed.
- MetaEditor compile: 0 errors, 0 warnings.
- Download source synced: XAUUSD_AI_Sniper_EA_v6.14.0.mq5 matches backend/ea_code/XAUUSD_AI_Sniper_EA.mq5.

## Expected Behavior

- Let clean TREND_PULLBACK and confirmed momentum runners stay open longer while protected.
- Prevent HTF_TREND_FOLLOW from buying/selling late just because high-timeframe confirmation is obvious.
- Catch cleaner post-news continuation earlier when the move proves itself, while still rejecting spikes, poor RR, overextension, and abnormal spread.
- Produce useful 24h floating gain/loss data for the next audit.
