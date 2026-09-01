# XAU v5.8.40 Exit Learning Brain Audit

## Goal

Teach the EA whether closing a trade was actually smart.

The v5.8.39 trade brain recorded open/close outcomes. v5.8.40 adds post-close monitoring so the bot can learn:

- closed too early and left profit
- closed correctly before reversal
- closed into volatile/mixed follow-through
- closed profitably but needed too much drawdown first

## Post-Close Monitoring

After every full close, the EA keeps watching the market at:

- 5 minutes
- 10 minutes
- 15 minutes
- 30 minutes
- 60 minutes

It records:

- max move further in the original trade direction
- max reversal after close
- estimated money left on table
- estimated money avoided by closing
- exit verdict

## New Verdicts

- `EXIT_EARLY_LEFT_PROFIT`
- `EXIT_GOOD_AVOIDED_REVERSAL`
- `EXIT_MIXED_VOLATILE_AFTER_CLOSE`
- `EXIT_OK`

## Persistent File

The same MT5 common-file memory is used:

```text
XAUAI_ExecutedTradeBrain_<symbol>.csv
```

New rows use event:

```text
POST_CLOSE
```

## Inputs Added

- `InpTradeBrainMonitorAfterExit`
- `InpExitBrainEarlyProfitATR`
- `InpExitBrainGoodAvoidATR`

## Why This Matters

A green close is not automatically a good trade. If the trade went deeply negative first, then closed small green, the brain marks that as weak recovery. If the trade closed and price ran much further, the brain marks that exit as early. If the trade closed and price reversed, the brain marks the exit as good protection.

This is the evidence needed before changing exit rules later.

## Verification

- `git diff --check`
- Backend compile check
- Static pytest
- Frontend production build

MQL5 still needs final MetaEditor compile with `F7`.
