# Post-Exit Missed-R Method and Limitations

## Data recovery order actually used (per the requested priority)

1. **Existing post-close learning records and journal events** — used, and
   sufficient for 5/10/15/30/60 minutes. `XAU_UpdateClosedTradeOutcomes()`
   (existing production code, `InpTradeBrainMemory=true` and
   `InpTradeBrainMonitorAfterExit=true` both confirmed active for this
   exact run via the tester report's own input dump) already tracks a
   real, continuous, per-tick running maximum favorable/adverse move since
   each position's close, and prints it at checkpoints of 5/10/15/30/60
   minutes (`EXIT-BRAIN WATCH` / `EXIT-BRAIN CHECK` journal lines).
   Coverage: **191/191 positions** had a watch record; **191/191** had at
   least the 10-minute checkpoint. This is real `EXACT_JOURNAL` data, not
   a reconstruction.
2. **Existing tester real-tick data and position entry/exit records** —
   used for entry/exit price, structural SL, risk, realized R (from
   `60DAY_ALL_POSITIONS.csv`, itself built from the tester's own Deals
   table and the EA's `R_EXIT_ENTRY_CAPTURE_CONFIRMED`/
   `R_EXIT_COUNTERFACTUAL` journal lines).
3. **Exact tick-history reconstruction for 10/20 minutes** — not
   attempted; not needed for 10 minutes (step 1 already gives real
   per-tick-tracked data), and the 20-minute checkpoint literally does not
   exist in the original run's own telemetry, so step 4 was used instead
   of an ad-hoc reconstruction from adjacent checkpoints (which was
   explicitly disallowed for this analysis).
4. **Telemetry-only post-exit checkpoint addition + rerun** — used for the
   20-minute checkpoint only. See below.

## Why the 20-minute checkpoint needed a rerun, not just a bigger regex

The EA's real post-close pipeline (`XAU_BrainWatchClosedTrade` /
`XAU_UpdateClosedTradeOutcomes` / `XAU_EVPostCloseReview`) only has
checkpoints at 5, 10, 15, 30, and 60 minutes — there is no 20-minute
checkpoint anywhere in the already-executed run's journal to extract.
Interpolating one from the 15- and 30-minute values was explicitly
disallowed for this analysis (and would be methodologically wrong: the
tracked values are *running maxima*, not samples of a smooth curve, so
linear interpolation between two maxima has no defined relationship to
the true value at an intermediate time).

## Why the new 20-minute telemetry could NOT be added to the existing pipeline

`g_evExitLearningBias` (mutated by `XAU_EVPostCloseReview`, called from
inside the existing 5/10/15/30/60m pipeline) is real, live, and feeds
`XAU_EvaluateExitEV()`'s continuation/exhaustion probability on **later**
trades in the same run (confirmed by direct source reading — see the
v6.19.0 changelog comment block in `XAUUSD_AI_Sniper_EA.mq5`, and the
function bodies of `XAU_EVPostCloseReview`/`XAU_UpdateExitLearningBias`).
Inserting a 6th checkpoint into that same pipeline would add one more
bias-mutation event mid-sequence, changing the bias trajectory compared
to the original run, which would change which later trades receive how
much continuation-probability nudge — a real trading-logic change, not
telemetry, and a direct violation of "do not let telemetry influence any
decision."

**Fix**: a fully separate, parallel array (`g_brainClosedWatch20m[]`) and
function pair (`XAU_BrainWatchClosedTrade20MinOnly`,
`XAU_UpdateClosedTradeOutcomes20MinOnly`), called from the exact same two
real call sites as the existing pipeline, that reads the same
`closePrice`/`closeProfit`/`dir`/`atr` source data but:
- never calls `XAU_EVPostCloseReview`
- never touches `g_evExitLearningBias` or `g_exitBiasKeys`
- never calls `XAU_AppendTradeBrain` or `XAU_AppendConsciousMemory` (both
  read back by live decisions elsewhere — lot-sizing and
  `XAU_EvaluateExitEV` respectively)
- only reads `SymbolInfoDouble(BID/ASK)` and `TimeCurrent()`, tracks its
  own running max, and prints exactly one diagnostic line at +20 minutes.

It also uses the exact executable-price convention this analysis
requested (Bid for a BUY's favorable/adverse measurement, Ask for a
SELL's) rather than the existing pipeline's bid/ask-midpoint convention —
both are now available side by side for comparison (see the
`_watch`-suffixed midpoint-based columns vs the `_20m`-suffixed bid/ask
based columns).

## Final status: 20-minute rerun NOT obtained — disclosed, not faked

**The isolated 20-minute telemetry patch was implemented, compiled (0
errors/0 warnings, EX5 SHA-256
`2fba1da0f6bebf599cd5c763822ca26feac71ab1ca1b5562eeafe76ea94368d5`), and
an identical 60-day rerun was attempted multiple times, but the rerun
itself could not be completed in this environment.** This is disclosed
honestly rather than substituting an estimate. Every 20-minute field in
`60DAY_POST_EXIT_10_20_CORE_TRADES.csv` / `..._ALL_WINNERS.csv` is
genuinely empty, not interpolated or fabricated.

**What was tried, and the specific blocker each attempt hit:**

1. `wine terminal64.exe /config:<ini>` (no flags) — the terminal launched
   and initialized, but sat idle at a login prompt (confirmed by the
   owner directly viewing the screen); MT5's own account cache in this
   isolated WINEPREFIX had no saved credentials for this attempt.
2. Same command with `/portable` added — reset the terminal's data
   folder to a fresh local one, which also required login, and
   separately triggered a pending application self-update (build 6030)
   that intercepted the launch sequence before the Strategy Tester's
   `[Tester]` config section could auto-run.
3. Same command after the owner manually completed the login in-session
   (credentials cached) — the terminal now reached the main trading
   interface reliably, but the `[Tester]` section of the `/config:` file
   did not automatically open or start the Strategy Tester (confirmed:
   no `Tester/Agent-*/logs/` activity, sustained near-zero CPU). The
   owner then started the Strategy Tester manually through the GUI, but
   on the first two manual attempts either the wrong Expert file
   (`XAUUSD_AI_Sniper_EA_v6.25.5.ex5`, the un-patched build) or the
   default (non-M30) inputs were loaded instead of `v6255_m30.set` —
   confirmed directly from the tester's own journal
   (`InpDecisionMode=0`, and in one case `OnInit` refused to start at
   all under the mismatched default inputs: "tester stopped because
   OnInit returns non-zero code 1", 0 trades).
4. A further fully-automated retry (after login was cached) again
   triggered the same pending self-update, which this time completed and
   auto-relaunched the terminal with `/skipupdate` and `/portable` — the
   `/portable` flag once again reset the cached login/data state, and
   the retry was stopped rather than repeating the same login/config
   cycle indefinitely.

**Root cause, most likely**: this specific MT5 build's `/config:` handling
of the `[Tester]` section does not reliably auto-start a Strategy Tester
run inside this Wine/macOS sandboxed environment when invoked headlessly
via a background process — the `[Common]` (login) section works, but
`[Tester]` auto-launch does not, at least not without a GUI session
already in a specific ready state. This is an environment/tooling
limitation of the isolated test sandbox, not a property of the EA or its
new telemetry code (which compiled cleanly and never got the chance to
run against real tick data).

**To obtain the 20-minute data manually** (real, correct steps, verified
against the actual file layout in this sandbox):
1. In the isolated sandbox's MT5 terminal, open `View → Strategy Tester`.
2. Expert: `XAUUSD_AI_Sniper_EA_v6256_20min_research`.
3. Click the Expert's own settings/properties button to open its Inputs
   dialog, and inside **that** dialog use its own "Load" button to load
   `MQL5/Profiles/Tester/v6255_m30.set` (this is a separate control from
   the top-level Expert dropdown).
4. Symbol `XAUUSD`, Period `M10`, Model `Every tick based on real ticks`,
   custom date range `2026.05.18` to `2026.07.17`, Deposit `10000`,
   Leverage `1:100`.
5. Click Start and let it run to completion (the original run of this
   exact scope produced a 15GB decision journal, so this will take real
   time).
6. Run `scripts/gold_learning/extract_20min_research_checkpoint.py`
   against the resulting journal and tester report, then re-run
   `scripts/gold_learning/build_post_exit_report.py` and
   `build_post_exit_html.py` to regenerate this report with the
   20-minute column populated.

The reproduction-verification logic below is already implemented in
`extract_20min_research_checkpoint.py` and will run automatically the
next time real 20-minute data is extracted — it was never exercised
against real rerun output because the rerun itself did not complete.

## Reproduction verification (would run automatically once real data exists)

The research build was run against the **identical** tester config (same
account, symbol, period, model, date range, deposit, leverage, and
`.set` input file) as the original run, with only the `Expert=` and
`Report=` fields changed. Before accepting any 20-minute figure, this
analysis compares the rerun's own tester report and journal against the
original on:

- total positions (191), profitable (151/152 incl. breakeven), losses
  (39), CORE positions (152)
- every entry price, exit price, and exit time
- every structural SL value and lot size
- net realized profit

Any mismatch is treated as evidence the rerun is NOT a valid baseline
reproduction, and the 20-minute data is withheld (marked
`PENDING_RERUN_VERIFICATION`, not silently substituted) rather than
reported as if verified.

**Status at the time this document was generated: see
`60DAY_POST_EXIT_RUN_METADATA.json`'s `reproduction_verification_status`
field for the current state.** If it still reads `PENDING`, the
20-minute columns in the CSVs/HTML are genuinely empty, not estimated.

## R conversion — exact, no chained approximation

Each position's own `risk_usd` (from `60DAY_ALL_POSITIONS.csv`) is the
real dollar value of 1R for that specific trade, computed once by the
EA's own risk-geometry engine at entry. The post-close tracker already
reports its running maxima in dollars for the same position
(`missedMoney`/`avoidedMoney`), so:

```
MISSED_R_Xm            = checkpoint_Xm_missed_money / risk_usd
MAX_ADVERSE_R_AFTER_Xm = checkpoint_Xm_avoided_money / risk_usd
POST_EXIT_TOTAL_R_Xm   = EXIT_R + MISSED_R_Xm
```

No ATR-to-price-to-R chained conversion was needed — both numerator and
denominator are already real dollar amounts from the EA's own
computation, so any per-point-value or lot-size conversion error cancels
out exactly.

## Sequencing — a real, disclosed limitation of checkpoint-based tracking

The EA's post-close tracker stores two *independent* running maxima
(furthest favorable move, furthest adverse move) since close — it does
not record which one happened first, or the exact path between them.
This means:

- **"Was the original SL crossed" / "did price return to entry"** are
  answered exactly (using the real dollar-derived R values: entry is
  always R=0, the structural SL is always R=-1.0 relative to entry, so
  reaching those levels from the exit's own R position is a precise
  threshold check on the real adverse-R value) — these ARE exact,
  real answers about whether a level was reached at some point inside
  the window.
- **Whether that happened BEFORE or AFTER the favorable peak** within
  the same window is genuinely not recoverable from this checkpoint data
  — that would require the true tick-by-tick path, which was explicitly
  out of scope for this pass (per the data-recovery-order instructions,
  full tick reconstruction is the last resort, used only when telemetry
  addition is insufficient — here it was sufficient). The
  `exit_classification` column uses only the magnitude-based rules
  documented in `scripts/gold_learning/build_post_exit_report.py`, and
  does **not** claim to know exact sequencing — categories that would
  require sequencing knowledge (distinguishing B from D/E/F when a
  return-to-entry and a later continuation both occurred in the same
  window) are resolved conservatively toward the "mixed/uncertain"
  categories (G) rather than guessed.

## Known minor gaps

- 8 of 191 positions have watch data but the checkpoint didn't reach the
  full 60-minute mark before the tester's end-of-run cutoff (positions
  closed very near 2026-07-17 00:00) — their later checkpoints are
  genuinely absent, not fabricated as zero.
- The market-condition breakdown (`60DAY_POST_EXIT_BY_MARKET_REGIME.csv`)
  only covers the 152 CORE positions that have a matched
  `60DAY_ENTRY_TIMING_AND_REGIME.csv` row (pyramids don't have their own
  signal/entry-timer cycle, so they're excluded from that specific join,
  same as in the prior regime/timing report).
