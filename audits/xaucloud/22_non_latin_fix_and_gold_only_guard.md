# NON_LATIN Validation Fix + Explicit Gold-Only Guard (Phase 22)

## Root cause of the MetaQuotes validation failure

The v1.0 submission failed MetaQuotes' automated validation with 22
errors, all `NON_LATIN: All program messages must be in English`. The
cause was **not** the EURUSD test symbol (the EA legitimately producing
zero trades on a symbol it wasn't designed for is not itself a violation)
-- it was 1,973 literal non-ASCII characters embedded throughout the
source: em-dashes (`—`, 1,183 of them) in `input group` labels and
comments, plus 30 other distinct symbols (arrows `→`, box-drawing
characters `═─│┌└`, comparison operators `≥≤≈`, bullets `•▸`, emoji
`🛡⏸⚙⛔🟡🟢🔑`, and others) used throughout `Print()`/status text for
visual formatting. 50 `input group` labels alone contained em-dashes --
those are rendered directly in MetaTrader's own Inputs tab, which is
exactly the kind of "program message" the validator checks.

## Fix

Every non-ASCII character in `market_edition/Claude_XauCloud.mq5` was
replaced with a plain-ASCII equivalent (`→`->`->`, `≥`->`>=`, `•`->`-`,
emoji -> bracketed words like `[WARNING]`/`[OK]`, etc. -- full mapping in
the fix commit). This is a pure text substitution: no control flow,
condition, or numeric literal was touched. Verified zero non-ASCII
characters remain (`ord(c) > 127` count = 0 across the entire file).

## Explicit Gold-only guard (owner directive, new safety feature)

The EA already had `IsXAUFastSymbol()` (case-insensitive substring match
on "XAU"/"GOLD" in `Symbol()`, naturally covering broker suffixes/prefixes
like XAUUSDm, XAUUSD.a, XAUUSD.pro) gating some memory/telemetry features,
but nothing stopped the trading engine itself from running on a non-Gold
chart -- it just happened to produce no signals on EURUSD incidentally,
not by design. Added an explicit guard:

- New global `g_xauCloudNonGoldChart`, set once in `OnInit()` via
  `!IsXAUFastSymbol()` -- checked before license validation, self-tests,
  or any other state setup.
- If true: prints the exact English message "XauCloud is a Gold-only
  Expert Advisor. Attach it to your broker's XAUUSD or GOLD chart." once,
  shows it persistently via `Comment()`, and returns `INIT_SUCCEEDED`
  (a safe idle result, not a crash or parameter-error code).
- `OnTick()` checks the flag as its first line and returns immediately --
  no indicator handle is created, no candidate is generated, no order is
  ever reachable. `OnTimer()` just calls `OnTick()`, so it's covered too.

## Compile and test verification

- Compile: 0 errors, 0 warnings (MetaEditor64/Wine).
- **EURUSD H1, 2026.07.19-07.21 (real ticks, isolated sandbox):** message
  printed exactly once at the first bar, test completed in 0.435 seconds,
  **0 trades**, no crash, no hang. Confirms the guard actually engages
  against exactly the scenario MetaQuotes' own validator exercises.
- **XAUUSD regression check:** same window, confirms trading behavior is
  unaffected by either the ASCII fix or the new guard -- see companion
  test run.

## Resubmission

New version uploaded to the MQL5 Market draft (product 188838) replacing
the failed v1.0 build. All documentation (`README.md`, `INSTALLATION.md`,
`FAQ.md`, `MARKET_LISTING.md`) updated with prominent Gold-only messaging
per the owner's explicit instruction, including the exact FAQ Q&A
("Can I use XauCloud on EURUSD or other instruments? No...").
