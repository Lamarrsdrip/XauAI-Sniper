# v6.24.3 Mac/VPS trade-learning audit — 2026-07-15

## Scope and no-hindsight rule

This is an evidence audit, not a new blocker project.  Results after an entry
are used only to evaluate the quality of features that were available at the
decision time.  The live repair uses closed-bar structure, pullback state,
continuation/reclaim, and current candidate freshness; it does not classify a
trade as bad merely because it later lost.

## Data actually available

| Environment | Evidence | Coverage / limitation |
|---|---|---|
| Mac MT5 (`XAUUSD`) | `XAU_HIST_XAUUSD_DEALS.csv`, M5 bars, execution brain, timing proof, and the 2026-07-15 terminal journal | 142 reconstructed completed magic-20250401 positions with chart-bar replay measurements.  The history export predates the evening 20:25 server-time incident, which is instead proven by the terminal journal. |
| VPS MT5 (`XAUUSDm`, account 436698921) | Live `ExecutedTradeBrain`, `TradingIntelligence`, and `TimingProof` read directly from the VPS | 31 CLOSE telemetry rows; 17 unique, non-reconciled rows have entry price and ATR.  No VPS M5/tick export was present, so its chart MAE/MFE cannot be honestly reconstructed from broker bars. |

The environments are different symbols/accounts and the relevant stored
versions are v6.22.x/v6.23.x/v6.24.1.  Their available records do not contain
the same candidate at the same timestamp plus both feeds.  Therefore this
audit does **not** claim a feed/spread difference caused a particular result.
The v6.24.3 decision snapshot and trace fields make that comparison possible
for new trades.

## Mac chart replay results

Each completed position was paired by position id and replayed through the
locally exported M5 bars from entry through final exit.  MAE/MFE below are
post-trade evaluation values in ATR units, not values used to label the trade
live.

| Mac completed positions | Count | Net P/L | Median MAE | 75th MAE | 90th MAE |
|---|---:|---:|---:|---:|---:|
| Winners | 85 | +$4,988.63 | 0.53 ATR | 0.91 ATR | 1.68 ATR |
| Losers | 48 | -$5,148.05 | 2.71 ATR | 3.58 ATR | 4.64 ATR |
| Neutral / partial / zero | 9 | excluded from outcome comparison | — | — | — |

The important finding is not “block after 0.91 ATR.”  Good trades can have a
normal retracement.  It is that the losing population entered with little or
no early favorable excursion and then travelled materially farther against the
entry.  Improving entry timing before the trade is the safer response; blindly
widening SL or shrinking lots would not solve it.

### Representative Mac replays

| Entry time | Direction / setup | Outcome | Chart replay evidence | Learning interpretation |
|---|---|---:|---|---|
| 2026-07-08 19:16 | SELL `TREND_PULLBACK` | -$430.11 | MAE 3.09 ATR; MFE 0.08 ATR | A trend-looking SELL had virtually no follow-through before adverse continuation.  Require current closed-bar continuation; do not inherit a prior SELL. |
| 2026-07-08 20:06 | SELL `TREND_PULLBACK` | -$334.80 | MAE 2.45 ATR; MFE 0.33 ATR | Same pattern: direction persistence was mistaken for fresh continuation. |
| 2026-07-03 11:35 | BUY `TREND_PULLBACK` | -$300.70 | MAE 2.95 ATR; MFE 0.09 ATR | A BUY thesis alone was insufficient; no useful continuation appeared after entry. |
| 2026-06-23 22:10 | SELL `TREND_PULLBACK` | +$272.64 | MAE 0.60 ATR; MFE 7.16 ATR | Clean continuation has limited early adverse movement and substantial follow-through. |
| 2026-07-06 02:20 | BUY `TREND_PULLBACK` | +$255.49 | MAE 0.07 ATR; MFE 3.00 ATR | Good entry fingerprint: pullback had completed and price moved in direction quickly. |

## VPS learning evidence

The VPS timing proof contains 16 intentional timing-gated entries: minimum
150 seconds, median 158 seconds, maximum 276 seconds.  The requested 2–3
minute delay is a real, preserved part of the live execution design.

Among 17 unique VPS telemetry-rich closes, the recorded outcome fields show 6
explicit wins (+$629.48) and 6 explicit losses (-$3,275.77); the remaining
rows have a non-binary/reconciled outcome and are not used for a win-rate
claim.  Timing-quality labels from the old build did not reliably predict
results: several large losses were labeled 100.  This is why v6.24.3 does not
turn a historical numeric score into a hard veto.

| VPS close time | Direction / setup | P/L | Telemetry available at entry | Learning interpretation |
|---|---|---:|---|---|
| 2026-07-14 02:14:47 | SELL `TREND_PULLBACK` A+ | -$1,036.26 | timing quality 100; extension risk 5.2 | Old confidence label was over-trusted.  Fresh M5/M15 evidence and active pullback state must decide timing. |
| 2026-07-14 04:36:27 | SELL `HTF_TREND_FOLLOW` A+ | -$890.64 | timing quality 100; extension risk 0.7 | A strong label is not permission to reuse a stale direction after the structure changes. |
| 2026-07-14 08:02:53 | BUY `TREND_PULLBACK` A | -$755.83 | timing quality 58.5; extension risk 50.7; expected-MAE risk 27.5 | Clear late/extended-entry signature; this maps to WAIT/consumed only when the opportunity is genuinely exhausted. |
| 2026-07-15 15:13 | BUY `TREND_PULLBACK` B | -$634.37 | no timing/extension telemetry | Missing telemetry must remain neutral; it cannot become an invented AI/memory block. |

## Actual incident replay

The Mac terminal journal supplied the precise 2026-07-15 stale re-entry chain:

1. At local-journal 18:25:12 (broker/server M5 context 20:25), the SELL hit
   broker SL at 4039.56.
2. At 18:25:17, closed-bar analysis reported `DIRECTION_BUY_ONLY [STRONG]`,
   a BUY `TREND_PULLBACK`, score 4.75, and began the existing 150-second timer.
3. At 18:27:44, the old stale re-entry path sent SELL 0.24 at 4038.73 instead
   of using that contemporaneous BUY snapshot.
4. At 18:30:09, the primary engine again reported the BUY candidate; the stale
   SELL stopped at 18:30:20.  A normal BUY later executed after the timer.

This is the exact behavioral failure corrected by the snapshot repair.  The
correct response at the SL was not a permanent SELL ban: it was to invalidate
the old SELL permission, preserve the new BUY candidate, and require its own
reclaim/continuation evidence.

## What v6.24.3 learns without a blocker cage

* `PULLBACK_NOT_COMPLETE`, fast opposition, and missing reclaim are **WAIT**:
  candidate preserved, existing timer not restarted, full risk unchanged when
  later approved.
* Fresh continuation requires weighted current evidence: directional closed
  M5 body, reclaim/displacement, higher-low/lower-high or failed counter-move,
  supportive M5/M15 state, and no confirmed opposite BOS+HTF.
* Memory is only supporting evidence when the same direction/setup/session/
  extension/pullback timing failure repeats with enough tagged samples.  One
  loss is information, not a ban.
* `HARD_BLOCK` remains limited to confirmed structural invalidation, consumed
  reward/extension, or exact repeated unreset failure—not low confidence, one
  candle, ATR alone, or ordinary pullback uncertainty.
* The required output is explanatory: `SMART_ENTRY_CAUTION_TRACE` and
  `LEARNED_ENTRY_QUALITY_TRACE` show pullback completion, continuation,
  fast-timeframe opposition, memory influence, and the next evidence needed.

## Remaining evidence gap

For a future true side-by-side VPS comparison, retain on **both** machines the
same M5/M1/tick export plus `DECISION_SNAPSHOT`, candidate id, decision bar,
spread, symbol properties, input hash, EA build hash, and broker deal history.
Only then can an entry-price/feed difference be attributed to a machine rather
than inferred from a later win or loss.
