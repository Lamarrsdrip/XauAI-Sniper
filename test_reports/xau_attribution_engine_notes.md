# XAU Attribution Engine Notes

## Purpose

This is an optimization layer, not a new trading filter.

It reads the EA memory files and produces evidence about:

- which grades actually perform best
- which setups create the most expectancy
- which exits close too early or protect correctly
- which block reasons save money
- which block reasons miss good trades
- which protections overlap too often
- which trades win only after unacceptable floating drawdown

## Inputs

The report reads:

```text
XAUAI_ExecutedTradeBrain_<symbol>.csv
XAUAI_BlockedTradeMemory_<symbol>.csv
```

These files are created by the EA in MT5 Common Files.

## Command

Example:

```bash
python3 backend/analytics/xau_attribution_report.py \
  --executed /path/to/XAUAI_ExecutedTradeBrain_XAUUSD.csv \
  --blocked /path/to/XAUAI_BlockedTradeMemory_XAUUSD.csv \
  --days 7 \
  --out test_reports/xau_weekly_attribution_report.md
```

## Report Sections

- Executive summary
- Most useful protection
- Most expensive protection
- Signal grade validation
- Setup performance
- Exit reason performance
- Signature performance
- Blocked trade intelligence
- Simplification audit
- Evidence-based recommendations

## Important

The report does not automatically tune the EA.

The correct workflow is:

1. Let the EA collect enough memory.
2. Generate the weekly report.
3. Review evidence.
4. Tune only the parameters/logic with proof.

This avoids overfitting one screenshot or one trade.
