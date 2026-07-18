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

## What was explicitly NOT attempted in this pass (owner narrowed scope mid-session to "extract the taken trades and info about them")

An earlier, much larger 12-part protocol (deterministic market-regime/
market-type classification with swing/BOS/ATR/EMA-slope rules, entry-
timing early/late/wrong-signal classification, market-condition and
strategy-pattern performance tables, a signal→entry market-type
transition matrix, and ~15 additional chart/CSV files) was requested and
partially investigated, but the owner explicitly redirected mid-session to
a focused extraction of the real taken trades and their real data instead.
The following from that larger protocol were NOT built in this pass and
are disclosed here rather than silently dropped:

- Independent deterministic market-regime/market-type classification
  (trend/range/compression/breakout/false-breakout/liquidity-sweep/etc.)
  built from swing structure, BOS, ATR expansion, EMA slope, etc. The
  EA's own `regime=` field (visible in its per-M10-bar `DECISION_SNAPSHOT`
  journal lines, e.g. `regime=TREND_DN`) IS available in the same journal
  and was not yet joined into the per-position/per-campaign tables here.
- Entry-timing classification (early/late/wrong-signal/good-timing per
  campaign) comparing candidate-creation price, price at each timer
  checkpoint (120/150/180s), and actual execution price.
- Market-type transition analysis (signal-time regime → entry-time regime
  → trade result).
- Strategy-pattern (setup-type) performance breakdown beyond the raw
  `setup` tag already present in `60DAY_ALL_CAMPAIGNS.csv`.
- The master trade-journey funnel diagram (candidate → timer → entry →
  drawdown → first profit → MFE → protection → exit → post-exit) as a
  standalone PNG/SVG.
- Post-exit price movement (what price did in the 5/15/30/60 minutes after
  each exit) — this DOES require price-path data beyond what the EA
  itself logged about the closed position, since the EA naturally stops
  tracking a position's price once it is closed.

These are legitimate, real follow-on work if the owner wants to go deeper
after reviewing this Phase 1 extraction — none of them were faked or
approximated here in their absence.
