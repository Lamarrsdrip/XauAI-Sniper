# Index Mode — State Separation & Multi-Symbol Scanner Design (Project C)

Status: **DESIGN ONLY — NOT IMPLEMENTED.** This document describes the
architecture required for "one EA instance trades Gold + Index
simultaneously" (`Trading Universe: GOLD_AND_INDEX`). Per explicit
instruction, this is not built until (a) a real, accessible index symbol
exists to test against, and (b) single-symbol Index Mode has a tested
strategy behind it. Building this now, against no real symbol, would be
exactly the "speculative live-money logic" the project has committed to
avoiding.

## Why this is a design doc and not a v6.6.0 feature

A research pass (2026-07-02) against the live EA source
(`XAUUSD_AI_Sniper_EA_v6.5.0.mq5`, ~22,600 lines) found:
- **469 separate call sites** hardcoded to the built-in `Symbol()` function,
  which always returns the current chart's symbol.
- **Zero symbol-keyed state anywhere.** Basket peak/floor/armed flags, TTM
  records, Growth Guard daily state, SMC/BOS direction, adaptive recovery
  flags — all plain scalars or fixed-size arrays, account-wide, not per
  symbol.
- **One global `CTrade trade;` instance**, used for every order across the
  whole file.
- **No existing multi-symbol iteration** — no `SymbolsTotal()`,
  `SymbolName()`, or symbol loop anywhere in `OnTick()`.

Estimated 60-80% of the file would need to change to make this safe.
Anything less than a full, careful pass leaves the EA "half-aware" of
multiple symbols — precisely the condition that produces subtle
risk/position-tracking bugs (a basket floor computed across two unrelated
instruments, a TTM slot leaking between a gold trade and an index trade,
etc.). This design exists so that when the time comes, the rewrite is
planned rather than improvised.

## 1. Magic number plan

Each symbol the EA scans gets its own magic number, derived deterministically
from the base `InpMagicNumber` and the symbol string, so trades from
different markets can never be confused by position filters that already key
on magic number:

```
magic(symbol) = InpMagicNumber + (CRC32(symbol) % 1000)
```

- Gold (the symbol the EA is literally attached to) keeps `InpMagicNumber`
  unchanged — zero behavior change for existing Gold Mode deployments and
  zero disruption to any position already open under today's magic number.
- Each additional scanned symbol gets `InpMagicNumber + offset`, logged once
  at `OnInit()`/first-scan time: `MAGIC_ASSIGNED symbol=... magic=...`.
- All position filters (`if(posInfo.Magic() != InpMagicNumber) continue;` —
  469 of the current `Symbol()` sites overlap with these) become
  `if(posInfo.Magic() != MagicForSymbol(posInfo.Symbol())) continue;` or
  equivalently iterate per-symbol with that symbol's own magic number.

## 2. State separation plan

Every currently-scalar piece of shared state becomes a lookup keyed by
symbol. Two viable MQL5 mechanisms exist:

**Option A — parallel arrays indexed by symbol slot.** A fixed-size
`string g_scanSymbols[MAX_SCAN_SYMBOLS];` array assigns each active symbol a
slot index at `OnInit()`, and every existing scalar/array global becomes
`double g_basketPeakUSD[MAX_SCAN_SYMBOLS];` etc., indexed by that slot. This
is the more mechanical, lower-risk transformation (each individual variable's
type changes from scalar to array, logic stays structurally similar) but
touches every read/write site of every such variable.

**Option B — a `struct XAU_SymbolState { ... }` and `XAU_SymbolState
g_state[MAX_SCAN_SYMBOLS];`** bundling ALL per-symbol state (basket, TTM
array, growth guard daily figures, SMC/BOS direction, adaptive recovery
flags) into one struct instance per symbol. This is architecturally cleaner
(one lookup gets you everything for that symbol) but is a bigger one-time
refactor since every function that currently reads a bare global needs to
receive or look up the right struct instance.

**Recommendation when this is built:** Option B. The mechanical/Option-A
path superficially looks smaller but produces N parallel arrays that must
always be indexed consistently — a classic source of index-mismatch bugs
under time pressure. A single struct per symbol is harder to get subtly
wrong.

State that must move into the per-symbol struct (non-exhaustive, from the
research pass): `g_basketPeakUSD`, `g_basketFloorUSD`, `g_basketArmed`,
`g_basketBEHit`, `g_basketSoftLockTaken`, `g_basketProfitToLossSeen`,
`g_basketProfitLossCycles`, `g_basketPeakTime`, `g_basketEntryBOS`,
`g_basketEntryHTF`, `g_ttm[TTM_MAX_POSITIONS]`, `g_smc_bos_dir`,
`g_htfConsensusDir`, `g_marketPersonality`, growth guard daily-loss tracking,
`lastClose`, `g_spreadEMA`, adaptive recovery mode flags, pyramid spacing
tracker (`lastPyramidPx`).

State that stays account-wide (correctly, not a bug to fix): account
equity/balance, prop-firm daily/weekly limits (these cap the WHOLE account,
by design, across every symbol), daily/weekly reset timers, license
validation state, AI cost-budget counters (a single shared API budget across
all symbols is the right behavior, not a bug).

## 3. Multi-symbol scanner design

`OnTick()` currently does one implicit pass over "whatever this chart is."
The scanner design adds an explicit outer loop:

```
for each symbol in g_scanSymbols[]:
    ManageBasket(symbol, MagicForSymbol(symbol))
    ManagePositions(symbol, MagicForSymbol(symbol))
    if symbol's market mode == GOLD_MODE:
        RunGoldEntryPipeline(symbol)
    else if symbol's market mode == INDEX_MODE and index strategy is enabled:
        RunIndexEntryPipeline(symbol)
```

Key design constraints carried over from the single-symbol safety work
already shipped:
- **A gold trade must never be closed by index logic and vice versa.** This
  falls out naturally once `ManageBasket`/`ManagePositions`/TTM/the Exit
  Arbiter all operate on the per-symbol struct — there is no shared
  mutable state between symbols for a cross-contamination bug to hide in,
  as long as every function takes a symbol parameter instead of calling the
  bare `Symbol()`.
- **Indicator handles must be created per symbol-timeframe pair**, not
  reused — `iMA(Symbol(), ...)` becomes `iMA(symbol, ...)` and each active
  symbol gets its own handle set, stored in the per-symbol struct.
- **`CTrade`**: either one shared instance with `SetSymbol()` called before
  each order framework-side (MQL5 supports this), or one `CTrade` instance
  per symbol in the struct. The per-symbol instance is safer against a
  race between "set symbol for gold" and "an index tick arrives mid-tick"
  — MQL5's single-threaded tick model makes this unlikely but not worth
  risking on live money.
- **Risk aggregation**: `InpGrowthMaxBasketLossEquityPct`-style caps need an
  explicit decision at build time — do they cap exposure per-symbol, or
  across the whole account regardless of market? The current doc leaves
  this open deliberately; it's a risk-policy decision for the account
  owner, not a technical one, and should be answered with real Index Mode
  P&L data in hand, not guessed now.

## 4. Report/log separation plan (mostly already in place)

`v6.6.0` already tags every heartbeat with `market_mode`/`index_profile`
and classifies every trade record by `symbol` for Gold/Index/Combined
dashboard reporting (see `classify_market_mode()` in `backend/server.py`).
When multi-symbol scanning ships, this classification continues to work
unchanged — it already operates per-trade, not per-EA-instance, so a single
EA scanning five symbols reports exactly as cleanly as five EAs each
scanning one. No backend change is anticipated here.

## 5. Implementation sequencing (when this phase actually starts)

1. Confirm a real, accessible index symbol (blocks all of Project B and C).
2. Ship and live-validate single-symbol Index Mode (Project B) standalone —
   same one-symbol-per-chart model as Gold Mode runs today, just with a real
   strategy behind `InpIndexProfile` instead of `InpIndexModeLogOnly=true`.
3. Only then: implement the per-symbol struct (§2), magic-number-per-symbol
   (§1), and the `OnTick()` scanning loop (§3) as their own dedicated,
   heavily-tested release — not bundled with any other change, given the
   60-80% file surface area involved.
4. Demo-test the multi-symbol build for at least as long as any single
   Gold Mode release, watching specifically for state leaking between
   symbols before considering it for a live account.
