# Symbol Compatibility

## Designed and tested for XAUUSD

This EA is designed and tuned for gold (XAUUSD). Its symbol check does not
require an exact match — it accepts any chart symbol whose name contains
`XAU`, `GOLD`, or `Gold` as a substring, so it will attach without a
"wrong symbol" warning on common broker naming variants such as:

- `XAUUSD`
- `XAUUSDm`
- `XAUUSD.a`
- `XAUUSD.r`
- `GOLD`
- `GOLDm`

If your broker's gold instrument name doesn't contain one of those
substrings, the startup log reports a `WRONG SYMBOL` warning naming your
actual chart symbol — attach the EA to whichever chart your broker lists
gold under instead.

Digit/point handling is read dynamically from your broker's symbol
properties at runtime (via `SymbolInfoInteger(..., SYMBOL_DIGITS)`), not
hardcoded to a fixed number of decimal places — so brokers quoting gold at
2 or 3 decimal places are both handled without a code change.

**Other symbols are not verified.** The regime/direction/entry-quality
engines were built and tuned against gold's specific volatility and
session behavior. Attaching this EA to a non-gold symbol is not a
supported use case, even though the substring check alone would not
technically stop a symbol like a "XAU"-named cross pair from passing.

## Timeframe

The EA's internal decision cycle runs on M10 (10-minute) bars regardless
of which timeframe the chart itself displays — it reads its own M10
historical data directly. Attaching to an M10 chart is still recommended
so the chart you're watching matches what the EA is deciding from.

## Broker feed differences — not verified across brokers

This exact build has not yet been run through a dedicated multi-broker
Strategy Tester validation pass (see `KNOWN_LIMITATIONS.md`). Spread,
execution speed, and available price history all vary by broker —
confirm behavior on your own broker's demo account before running live,
particularly around the spread-based entry gate (`InpMaxSpread`, default
400 points) and minimum bar-history requirements at startup.
