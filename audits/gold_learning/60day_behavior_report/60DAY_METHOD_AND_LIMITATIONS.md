# Method and Limitations

## Data sources (both real, both verified against each other)

1. **MT5 Strategy Tester HTML report** (`v6255_backtest_m30_extended_postfix.html`)
   — the Deals table: broker-confirmed execution time, price, volume,
   commission, swap, realized profit, and the EA's own open/close comment
   tag (`XAU-SNIPER|M30_CONSENSUS_CORE_...` / `XAU-SNIPER|PYRAMID_SHARED_AUTHO`
   / `sl <price>` on stop-loss fills). This file was UTF-16LE encoded;
   decoded once to UTF-8 before parsing. 382 deal rows (191 opens + 191
   closes + 1 initial balance row), all successfully paired into 191
   positions with no unmatched or ambiguous pairing.

2. **The EA's own real-time structured journal logging**, from the
   preserved 15.1GB decision journal (`20260717_M30_POSTFIX_extended_
   20260518-20260717_PRESERVED.log`, also UTF-16LE, decoded once to a
   7.5GB UTF-8 file for repeated grepping). The EA already computes and
   prints, per position:
   - `R_EXIT_ENTRY_CAPTURE_CONFIRMED` — ticket, direction, entry price,
     structural SL price, SL distance, risk in USD, lot size, at the
     moment the position's risk geometry is locked in.
   - `R_EXIT_COUNTERFACTUAL` — ticket, exit reason, realized R, realized
     profit USD, **MFE_peakR/MFE_peakUSD, MAE_troughR/MAE_troughUSD**
     (the real maximum favorable/adverse excursion the EA's own R-Exit
     manager tracked while the position was open), and which R
     checkpoints (0.20/0.30/0.40/0.50/0.75/1.00) were ever reached.
   - `CAMPAIGN_OPENED` / `CAMPAIGN_ADD_REGISTERED` / `CAMPAIGN_CLOSED` —
     the EA's own campaign identity (`CAMP-N`), core ticket, direction,
     setup tag, and campaign-level peak floating/MFE/MAE/given-back.

   Coverage: **191/191 positions matched a real journal entry AND exit
   record (100%)**. 153/153 campaigns matched a `CAMPAIGN_OPENED` event;
   152/153 also had a matching `CAMPAIGN_CLOSED` event (see "Known minor
   gaps" below for the one exception, `CAMP-92`, whose position-level data
   is still complete).

## Why no tick-path or candle-OHLC MAE/MFE reconstruction was needed

The EA's own `R_EXIT` manager already tracks real floating R/USD
continuously while a position is open and logs the true peak (MFE) and
trough (MAE) at close. This is a *stronger* source than reconstructing an
approximation from M1/M5/M10 candle highs/lows would have been (the
project's own prior audit work explicitly flags candle-OHLC MAE/MFE
reconstruction as unreliable when both a candle's high and low could
plausibly have occurred in either order). No such reconstruction was
attempted or needed here.

One real, disclosed caveat: the exact internal sampling cadence of the
R-Exit manager's peak/trough tracking (i.e. whether it re-evaluates every
tick, every N seconds, or on each OnTick call while the position is open)
was not independently re-verified against the EA source as part of this
extraction pass. The values are the EA's own real management data, not an
estimate — but if the owner wants an explicit tick-vs-periodic
classification for MFE/MAE specifically, that would require a short,
separate source read of the R-Exit manager's update call sites.

## Position pairing methodology

Each MT5 tester "in" deal (opens a position) is paired with the first
still-open "out" deal (closes a position) of the opposite side and
**identical lot volume**, in time order. This is a simple, deterministic,
verifiable FIFO-by-volume match — not a heuristic gap-based grouping.
It worked cleanly for all 191 positions in this dataset because every
concurrent leg (core + pyramid) in this run has a distinct lot size (core
and pyramid position sizing are computed independently by the EA and were
never observed to collide).

## Campaign-ID mapping methodology

Every position's real EA-assigned campaign ID comes directly from the
journal, not from a retroactive time-gap heuristic:
- **Core legs**: `CAMPAIGN_OPENED`'s own `coreTicket` field names the
  exact ticket directly.
- **Pyramid legs**: matched to the `CAMPAIGN_ADD_REGISTERED` event that
  shares the exact same broker-time-of-day log timestamp (both the
  position's own entry-confirmation line and the campaign lifecycle line
  are printed during the same order-fill handling, so they share a
  timestamp to the second).

## Reconciliation against the tester's own summary

- Tester report "Total Net Profit": **$3,478.69**.
- Sum of `realized_profit_usd` across all 191 rows in
  `60DAY_ALL_POSITIONS.csv`: **$3,524.07**.
- Difference: **exactly $45.38**, which is the sum of the `swap` column
  across all 191 positions (**-$45.38**). `realized_profit_usd` is the
  deal's own "Profit" field, which the tester report keeps separate from
  swap; net including swap reconciles to the tester's reported total
  exactly. (Both `commission` and `swap` per-position values are included
  as their own columns in the CSV for anyone who wants to net them in
  differently.)
- Position counts, win/loss counts, and win rate all match the tester's
  own summary exactly (191 positions, 39 losses, 152 tester-counted wins
  including the one $0.00 breakeven).

## Known minor gaps

- **`CAMP-92`**: the EA logged `CAMPAIGN_OPENED` and the position's own
  `R_EXIT_ENTRY_CAPTURE_CONFIRMED` / `R_EXIT_COUNTERFACTUAL` records (so
  its row in `60DAY_ALL_POSITIONS.csv` is fully populated, including real
  MFE/MAE), but no `CAMPAIGN_CLOSED` line was found for it in the journal.
  Its row in `60DAY_ALL_CAMPAIGNS.csv` therefore has blank
  `campaign_peak_floating_usd` / `campaign_mfe_usd` / `campaign_mae_usd` /
  `campaign_given_back_usd` fields rather than a fabricated value. This
  affects 1 of 153 campaigns and 0 of 191 positions.
- **Session/hour buckets use broker-server time** (the MetaQuotes-Demo
  tester server's clock, same as every timestamp in this report). The
  exact UTC offset of that server was not independently confirmed in this
  pass, so session labels (Asia/London/New York/etc.) are a reasonable
  broker-server-time convention, not a verified UTC-anchored mapping.
  Relative comparisons between sessions/hours within this report are
  still valid (they use the same clock throughout); only the literal
  session *names* carry this caveat.

## Follow-up pass: market regime and entry-timing evidence

The first version of this report (owner-narrowed scope: "extract the taken
trades and info about them") deferred an earlier, much larger protocol's
market-regime and entry-timing requests. The owner then explicitly asked
for those specific items to be completed. This follow-up pass joined all
152 CORE positions to the EA's own real-time classification (see the
"Market Regime and Entry-Timing Evidence" section of
`60DAY_EXECUTIVE_REPORT.md` and `60DAY_ENTRY_TIMING_AND_REGIME.csv`) and
delivered, with real numbers:

- Market regime at signal time (`ENUM_REGIME`: TREND_UP/TREND_DN/RANGING/
  BRKT_UP/BRKT_DN/LOW_VOL/CHOPPY/DEAD) and its win-rate/realized-R
  breakdown per regime.
- Market lifecycle state at entry (`ENUM_XAU_MARKET_LIFECYCLE`:
  TREND_EARLY/DEVELOPING/HEALTHY/MATURE/LATE/EXHAUSTING/
  TRANSITION_NEUTRAL/OPPOSITE_DIRECTION_FORMING/CONFIRMED) and its
  win-rate/realized-R breakdown — this surfaced the single strongest
  finding in the whole dataset (`OPPOSITE_DIRECTION_FORMING` at entry:
  40.8% of all core entries, worst win rate, only net-negative lifecycle
  state).
- Signal-time-vs-entry-time regime comparison (real finding: regime never
  changed within the 150-180s timer window in this dataset — 0 of 152).
- Entry-timer checkpoint comparison: the timer only ever resolved at 150s
  or 180s in this run (120s never independently resolved a candidate), so
  a genuine two-way — not three-way — checkpoint comparison was reported.
- A deterministic entry-timing classification (chased / near-signal-price
  / moderate-drift / price-improved) built from the EA's own
  `moveFromIntendedEntryR` field, with performance broken out per bucket.

**Two real parsing bugs were found and fixed while building this pass,
disclosed here since they affected earlier intermediate output (never
committed):** (1) `candidateId`/`executionKey`/`origin`/`slot` fields
contain an embedded MQL5 `TimeToString` value ("2026.05.18 07:00:30",
with a literal space between date and time) that a naive
"key=value-until-next-whitespace" tokenizer truncates mid-value, silently
corrupting the join key. Fixed by joining the date/time halves before
tokenizing. (2) `ENTRY_TIMER_STARTED`/`ENTRY_DELAY_COMPLETED` both
re-fire on every re-validation tick while a candidate's timer is running,
not once — keying a dict by `candidateId` alone silently keeps whichever
occurrence is read last, not necessarily the one that actually triggered
execution. Fixed by anchoring the join on `M30_EXECUTION_CONFIRMED`'s own
`positionId` field, which **is** genuinely 1:1 with a real ticket (152 of
152 CORE positions matched cleanly after the fix, 100% coverage).

## What remains explicitly NOT attempted (real, disclosed gaps — not fabricated)

- **Liquidity-sweep classification**: verified directly against the
  journal — the EA's own `liquiditySweep` field reads `UNKNOWN` in every
  one of 152 occurrences in this run. This is not a missing extraction;
  the bot's own classifier for this is not populated in the build that
  produced this replay. No sweep label is reported anywhere in this
  report as a result.
- **False-breakout reclassification**: BRKT_UP/BRKT_DN regime reads are
  captured and reported, but confirming whether a specific breakout later
  reverted (making it a "false" breakout after the fact) would require
  tracking price independently of the trade's own outcome — not
  attempted.
- **Post-exit price movement** (5/15/30/60 minutes after each exit): no
  per-bar M10 close-price series is logged anywhere in this journal (only
  event-triggered snapshots at signal/entry/exit moments). Reconstructing
  one would require either a separate bar-history export or new
  telemetry and a re-run, per this project's own instrumentation-then-
  rerun policy — not attempted this pass.
- **Strategy-pattern breakdown beyond the raw setup tag**: verified —
  every one of the 152 core campaigns in this run uses the single setup
  tag `M30_CONSENSUS_CORE_<slot>`. M30 consensus mode has only one active
  strategy/setup path; the pullback/reversal/breakout/HTF-trend-follow
  labels from the original request are M10-legacy-mode setup names this
  run never uses. A breakdown beyond the setup tag would report the same
  152 rows under a different heading, not real additional variety.
- **Market-type transition matrix** (signal regime → entry regime →
  result): not built as a separate table because regime never changed
  between signal and entry in this dataset — the matrix would have
  exactly one non-empty diagonal cell per regime, already shown in the
  regime table.
- **The master trade-journey funnel diagram** (candidate → timer → entry
  → drawdown → first profit → MFE → protection → exit → post-exit) as a
  standalone PNG/SVG — not built this pass.

These are legitimate, real follow-on work if the owner wants to go deeper
— none of them were faked or approximated here in their absence.
