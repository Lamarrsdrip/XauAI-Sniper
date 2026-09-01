# XAU AI Sniper v6.4.14 Lot Sizing Audit

Date: 2026-06-30
Build: v6.4.14
Hash: v6414-lot-sizing-audit-20260630

## Root Cause

The v6.4.13 lot size did not collapse because Growth Guard, daily profit lock, basket cap, or volatility cap were shrinking the trade. Live logs showed those layers were neutral on the inspected trades.

The collapse came from two compounding effects:

1. Broad aggregate AI memory reduced clean A+/HTF continuation trades with `AI-MEMORY LOT ADJUST: lot x0.65` even when exact/local TradeBrain evidence was still in learning mode.
2. XAU risk math used the wide stop distance correctly, but then volume was always rounded down to the broker step. That turned valid risk-budget lots into much smaller executed lots.

## Evidence From Logs

Live v6.4.13 example around the $3,028 account:

`LOT-CALC: balance=$3028.03 equity=$3028.03 modeRisk=1.20% signalMult=0.77 riskSignal=0.93% acctMult=1.00 riskAcct=0.93% pgMult=1.00 riskPG=0.93% riskCareful=0.93% sessionMult=1.00 riskSession=0.93% patternMult=1.00 riskPattern=0.93% volMult=1.00 finalRisk=0.93% riskUSD=$28.06 slDist=15.66 sl$/lot=$1566.25 rawLots=0.018 brokerLots=0.01 finalLots=0.01`

Relevant memory context from the same trading window:

`AI-MEMORY: Found 124 similar HTF_TREND_FOLLOW SELL setups. Win rate: 12.9%. Recommendation: reduce lot and require cleaner confirmation`

`LOCAL ML: learning mode 6/10 matching samples, no authority yet`

`TRADE-BRAIN AUDIT: pattern has 10/12 samples; recording only, no behavior change`

This means broad memory had authority to cut lot size, while the more exact evidence layer was explicitly not allowed to act yet.

## Fix

1. Added `XAU_MemoryLotFloorForContext()` so broad aggregate memory cannot crush A/A+ HTF-consensus setups below `InpMemoryAPlusHTFMinLotMulti` until exact TradeBrain evidence reaches `InpMemoryExactEvidenceMinSamples`.
2. Added `XAU_NormalizeVolumeForRisk()` so broker-step rounding can use nearest step only when the extra SL risk is within `InpLotStepMaxRiskOvershootPct`.
3. Added `LOT-SIZING-AUDIT` logs with the requested breakdown: base risk, balance, SL distance, ATR, raw lot, broker min/max/step, risk-math lot, volatility multiplier, signal/grade/AI multiplier context, recovery/drawdown, Growth Guard cap, basket cap, final lot, and `microCollapseReason`.
4. Updated input hash so changes to the lot-sizing audit/floor settings show in startup diagnostics.

## Expected Behavior

A clean A/A+ HTF consensus trade on a $3,000 account can still size down when the SL is genuinely wide or risk conditions are dangerous, but it should no longer collapse to 0.01/0.02 solely because broad memory applied a generic weak-history penalty before exact evidence matured.

The EA still does not blindly increase lots:

- Growth Guard remains active.
- Basket exposure cap remains active.
- Hard equity risk caps remain active.
- Broker min/max/step are still respected.
- Nearest-step rounding is allowed only inside a configured risk overshoot tolerance.

## Verification

Static tests run directly with Python because the current local Python has no pytest module installed:

- `tests/test_xau_v646_live_audit_static.py`
- `tests/test_xau_v647_trend_continuation_static.py`
- `tests/test_xau_v648_profit_floor_static.py`
- `tests/test_xau_v649_lifecycle_static.py`
- `tests/test_xau_v6411_smart_exit_static.py`
- `tests/test_xau_v6412_equity_growth_guard_static.py`
- `tests/test_xau_v6413_probability_ev_exit_static.py`
- `tests/test_xau_v6414_lot_sizing_static.py`

Result: all direct static assertions passed.

MetaEditor compile:

- `test_reports/metaeditor_v6414.log`
- Result: 0 errors, 1 warning
- Warning: MQL Market version-format warning for `6.4.14`; no compile error.

## MT5 Files

Compiled file copied to:

`/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Experts/XAUUSD_AI_Sniper_EA_v6.4.14.ex5`

Source copied to:

`/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Experts/XAUUSD_AI_Sniper_EA_v6.4.14.mq5`
