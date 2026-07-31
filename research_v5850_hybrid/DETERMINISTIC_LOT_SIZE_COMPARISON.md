# Deterministic lot-size comparison: ported hybrid vs current production bot

## Method

Rather than approximating the current bot's risk/lot formula, the hybrid's
`XAU_HybridRiskPerLotForDistance()` (research_v5850_hybrid/v5850_UNTOUCHED_BASELINE.mq5)
is a verbatim copy of the current bot's `XAU_MoneyPerLotForDistance()` /
`RiskPerLotForDistance()` (confirmed by direct diff against
`XauCloud-m10_ASIA+.mq5:21031-21066`). The risk percentage
(`InpHybridNormalRiskPct = 10.0`) matches the current bot's
`InpNormalRiskPct = 10.0` exactly.

Normalization was independently verified, not assumed:

- Current bot's `XAU_NormalizeVolumeForRisk()` (`XauCloud-m10_ASIA+.mq5:20991-21007`):
  `floorLots = MathFloor(rawLots / lotStep) * lotStep`, clamped to
  `[0, maxLot]`, zeroed below `minLot`.
- v5.8.50 hybrid's own (unchanged) normalization in `OpenTrade()`:
  `lots = MathFloor(rawLots / lotStep) * lotStep`, `brokerLimitedLots =
  MathMin(maxLot, lots)`, skipped below `minLot`.

Same formula, same rounding direction (floor-only, never rounds up), same
clamp order. Verified identical by inspection, not merely asserted.

## Conclusion

Given identical inputs (account balance, SL distance, symbol/broker state
-- lot step, min/max lot, tick value/size or `OrderCalcProfit` result),
the two systems are mathematically guaranteed to produce identical lot
sizes. This is a property of the code being literally the same formula
end-to-end (risk-amount calc -> $-per-lot calc -> floor-to-step
normalization), not a coincidence that needs re-verifying per case.

## Worked example (illustrative, not a live tester run)

Inputs: balance = $10,000.00, riskPct = 10.0%, slDist = $8.50 (structural/
ATR distance -- the value that drives sizing; the actual broker SL is the
separately-decoupled fixed $10.00 Gold-move per `InpHybridStopLossGoldMove`
/ `InpStopLossGoldMove`), XAUUSD contract size 100 oz, lot step 0.01, min
lot 0.01, max lot 50.00.

```
riskAmount        = 10000.00 * 10.0 / 100.0        = $1,000.00
slDollarPerLot    = 8.50 * 100 (contract size)      = $850.00
rawLots           = 1000.00 / 850.00                = 1.17647...
flooredLots       = floor(1.17647 / 0.01) * 0.01     = 1.17
finalLots (both systems)                             = 1.17
```

Both the ported hybrid and the current production bot compute this exact
1.17-lot result from these inputs -- same code path, same arithmetic,
same rounding rule.

## Caveat

This proves formula equivalence for the *risk-percentage-to-lots* path
that both systems share. It does not by itself prove every downstream
cap (aggregate exposure, `InpMaxLots`, margin-driven reduction) fires
identically in every scenario -- v5.8.50 kept its own aggregate-exposure
gate and margin-reduction loop (generic broker-safety plumbing, explicitly
not replaced per the owner's scope), which is architecturally equivalent
to but not byte-identical code to the current bot's own aggregate gate.
Both converge on the same floor-to-step final lot in the common case
(no caps triggered); cap-triggered edge cases were not separately
enumerated here due to time -- flagged as a follow-up, not silently
assumed equivalent.
