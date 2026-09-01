# XAU AI Sniper v6.7.0 — Market Mode Architecture (Gold + Index)

Date: 2026-07-02

## Scope and why it's scoped this way

Three overlapping requests were reconciled into one staged plan: (1) a full
Index Mode strategy engine, (2) auto-detection, (3) simultaneous Gold+Index
scanning from one EA. Before any code, two research findings changed the
plan:

1. **No index/synthetic symbol is available on any configured broker
   connection** (checked MetaQuotes-Demo, TRADE.com-Live, GoatFunded-Server,
   Default — gold + forex only). Boom/Crash/Volatility/Step indices are a
   Deriv-exclusive product not present here. Writing index-specific entry
   strategy logic with no real symbol to validate against would be
   speculation, not engineering — explicitly against the owner's "no
   speculative live-money logic" instruction.
2. **Simultaneous multi-symbol scanning is a structural rewrite, not a
   feature** — 469 call sites hardcoded to the built-in `Symbol()`, zero
   symbol-keyed state anywhere, a single global trade-execution object.
   Estimated 60-80% of the file would need to change.

Per explicit instruction, this release builds ONLY the generic,
correct-by-construction skeleton: market detection, symbol-agnostic lot
math, diagnostics, and platform/dashboard plumbing. It does **not** write
any index trading strategy, and does **not** start the multi-symbol
rewrite (that's `docs/index_mode_state_and_scanner_design.md` — a design
document, not code).

## What actually trades

**Nothing changes for Gold Mode.** Every existing entry/exit code path
still runs exactly as before whenever the resolved mode is `GOLD_MODE`,
which is what a live XAUUSD attachment always resolves to.

**Index Mode places zero trades this release.** `InpIndexModeLogOnly`
(default `true`) is a hard safety switch: whenever the resolved mode is
`INDEX_MODE`, the entire gold entry-scoring pipeline is skipped every tick.
Detection, lot-math diagnostics, and (for any existing position) the
already-symbol-agnostic shared exit/basket/TTM systems still run — but
`OpenTrade()` is never reached. This is enforced at the exact
boundary between position management (which already ran) and the
entry-scoring pipeline in `OnTick()`.

## 1. Market auto-detection framework

- `InpMarketMode` (`AUTO_DETECT`/`GOLD_MODE`/`INDEX_MODE`, default
  `AUTO_DETECT`), `InpIndexProfile`, `InpIndexAggression` (both
  diagnostic-only this release).
- `XAU_DetectMarketMode()` resolves once at `OnInit()`: explicit
  `InpMarketMode` wins if set; otherwise name-pattern match against the
  chart symbol (XAU/GOLD → gold; INDEX/VOL/VOLATILITY/BOOM/CRASH/STEP/
  JUMP/RANGE/SPREDIX/VIX/SYNTHETIC/DERIV → index). An unrecognized symbol
  defaults to `GOLD_MODE` — the only tested behavior — rather than
  guessing into an unproven index path. Logs
  `MARKET_AUTO_DETECT: symbol=... detectedMode=... profile=... reason=...`.
- The existing "WRONG SYMBOL" heartbeat warning now correctly recognizes
  `INDEX_MODE` as intentional instead of flagging it as an error.

## 2. Symbol-agnostic lot/risk engine

`XAU_CalcIndexLot(symbol, riskAmountUSD, slDistance, ...)` — takes symbol as
a parameter (not the built-in `Symbol()`), computing lot size from
`SYMBOL_TRADE_TICK_VALUE`/`TICK_SIZE`/`VOLUME_MIN`/`MAX`/`STEP`/
`CONTRACT_SIZE` and `OrderCalcMargin`. Zero gold-specific assumptions —
correct by construction using only the standard broker API, and already
safe to call for any symbol (a prerequisite the future multi-symbol
scanner will need). Not wired to any live entry path yet.
`XAU_LogIndexTrace()` prints the full `INDEX_TRACE` diagnostic
(contract specs, tick math, lot calculation, cap applied) every 5 minutes
while in Index Mode monitoring — illustrative only, proves the math works,
never a trade signal.

## 3. Backend: Gold/Index/Combined reporting + trading-universe settings

- Every heartbeat now carries `market_mode`/`index_profile`.
- `classify_market_mode()` mirrors the EA's own name-pattern logic purely
  from each trade record's existing `symbol` field — no EA trade-schema
  change, TradeBrain's sync payload is untouched. `/cloud/dashboard` now
  returns `totals.by_market_mode: {gold, index, combined}`.
- New `TradingUniverseSettings` (per-user, Command Center) and
  `AdminMarketModeSettings` (global, admin) storage + endpoints. **Not yet
  wired to live EA behavior** — there is no remote market-selection sync
  channel (only the existing pause/stop commands are consumed live by the
  EA). This is storage/UI readiness, documented as such.

## 4. Frontend

- Command Center: new "Trading Universe" panel (Control tab) with
  Gold/Index enable toggles (Index visually deemphasized, honest copy) and
  max-open-trades settings. Home page now shows a Market Mode / Index
  Profile badge from the live heartbeat.
- Admin: new "Market modes" section (Settings tab) — platform-wide
  Gold/Index enable, allowed index symbols, default trading universe.
- Public site: Download page and a new Features card explain Gold is live,
  Index is detection-only, and `AUTO_DETECT` needs no configuration.

## 5. Design docs (not implemented)

`docs/index_mode_state_and_scanner_design.md` — full design for Project C
(per-symbol state struct, magic-number-per-symbol scheme, `OnTick()`
scanning loop, risk-aggregation open question). Explicitly not built this
release; sequencing requires a tested single-symbol Index Mode first.

## 6. Additional fixes bundled in (static review pass over v6.4.25/v6.5.0)

A review pass over the exit-arbiter work already shipped in v6.4.25/v6.5.0
found and fixed:

- **Phantom-peak off-by-one**: v6.4.25 only rejected the still-forming bar;
  a position whose entry candle was the most recently closed bar could
  still have pre-entry range counted as peak evidence. Now requires the
  entry candle plus one full bar to have closed.
- **`XAU_NewHostileStructureFlip()`**: the v6.4.25/v6.5.0 flip checks tested
  "did BOS/HTF change since entry" but not whether the change was hostile
  to the trade direction — a trade entered against a standing BOS that
  later flipped to align WITH the trade could have been misread as
  "structure broken." Fixed in the basket gate, the Exit Arbiter, and TTM's
  own (pre-existing, same-gap) internal flip logic.
- **TTM bar-boundary tightened** to the last closed bar plus an explicit
  entry-time check, so the entry candle itself never counts toward
  `InpTTM_MinHoldBars`.
- **Stale version string**: the startup intelligence sync log hardcoded
  `"version=5.9.1"` regardless of the actual build, since at least that
  version. Now uses `XAUAI_EA_VERSION`.

Also caught during this release's own compile check: two indicator handles
in the new `XAU_LogIndexTrace()`/diagnostic code were declared `double`
instead of `int` (harmless in practice — MQL5's implicit truncation still
produced correct behavior — but wrong typing, flagged by the compiler and
fixed before shipping).

## 7. Test suite repair carried forward

Before this release, the pre-existing regression suite was fixed from
71-failing/48-passing to 118/118 (v6.5.0's own work). This release adds 6
new tests (`test_xau_v660_static_review_regressions.py`, covering all four
static-review fixes above) plus fixes for the version-identity/section-
boundary tests that would otherwise go stale again at this version bump.
Full suite: **132/132 passed**.

## Verification

- `test_reports/metaeditor_v670.log`: `Result: 0 errors, 0 warnings`.
- Full suite: 132/132 passed.
- Manual read-through confirmed `XAU_NewHostileStructureFlip`'s logic is
  correct (`hostileDir = -tradeDir; return currentDir == hostileDir &&
  entryDir != hostileDir;` — a genuine new deterioration only, not a
  favorable flip).
