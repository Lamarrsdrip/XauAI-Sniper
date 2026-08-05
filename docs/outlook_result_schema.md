# Market Outlook result schema

Maps the field names requested for the Outlook result schema to what's
actually stored on a `cloud_market_outlooks` document today. The data
already exists under these names; this doc exists so nobody has to
reverse-engineer the mapping from code again.

| Requested field | Actual field on `cloud_market_outlooks` | Notes |
|---|---|---|
| `signalId` | `id` | UUID4, generated once at creation. Unique-indexed (see below). |
| `direction` | `primary_direction` | `BUY` \| `SELL` \| `NEUTRAL` \| `RANGE` \| `TRANSITION` \| `NO_VALID_OUTLOOK` |
| `createdAt` | `published_at` (fallback `generated_at`) | ISO8601 UTC. |
| `entryPrice` | `tracking_entry_price` | The advisory tracking's own anchor price, immutable once set. |
| `stopLoss` | `original_sl` (fallback `suggested_sl`) | |
| `takeProfit1` | `tp1_price` | `tp2_price`/`tp3_price` also exist for TP2/TP3. Owner-approved fixed grid (2026-08-05): `tp1_price` = entry &plusmn; `XAUCLOUD_TP1_GOLD_MOVES` (5.00), `tp2_price` = entry &plusmn; `XAUCLOUD_TP2_GOLD_MOVES` (10.00) -- always calculated from `tracking_entry_price`, never ATR/thesis-derived. `tp3_price` stays an informational upside marker beyond TP2 with no dedicated WIN tier. |
| `confidence` | `confidence_pct` | 0-100. |
| `evaluationWindow` | `evaluation_deadline` | Published-time + `OUTLOOK_EVALUATION_MINUTES` (60min), see `market_outlook.py`. |
| `status` | `signal_state` | See state values below. `status` (a separate, coarser field: `PUBLISHED`\|`TRACKING`\|`INFORMATIONAL`) also exists but `signal_state` is the authoritative lifecycle value. |
| `completedAt` | `classification_at` | Set once, at the moment `analytics_outcome` transitions from `None` to a terminal outcome (`WIN`/`LOSS`/`PARTIAL_PROFIT`/`BREAK_EVEN`). Never updated again (see immutability guarantee below). |
| `finalExitOrEvaluationPrice` | `last_tracked_price` | The live price at the moment of classification. |
| `maxFavorableExcursion` | `mfe_r` | In R, not price. |
| `maxAdverseExcursion` | `mae_r` | In R, not price. |
| `resultR` | `analytics_r` | The frozen final R once classified. `current_r` continues to update only while still tracking (pre-classification). |
| `resultPips` | *(derived)* | Not stored -- computed on read via `market_outlook.build_result_conversion(r=analytics_r, risk_distance=risk_distance)`. Never store this separately; it must always be derived from `analytics_r` so it can never drift from the R value it represents. `risk_distance` is now always the fixed `XAUCLOUD_R_UNIT_GOLD_MOVES` (10.0) for every signal_tracking_version=2 record (see below), not the real SL distance. |
| `resultGoldMoves` | *(derived)* | Same function, same rule. |
| `resultReason` | `latest_path_event` | e.g. `TP1_HIT`, `SL_HIT_BEFORE_WIN`, `FAILED_HALF_R_60M`. |
| `authoritativeSource` | *(implicit)* | The advisory tracking's own resolution is authoritative for `analytics_outcome`/`analytics_r` -- sourced from real live bid/ask crossing this document's own `original_sl`/`tp1_price`/etc, computed in `advance_persisted_signal()`. This is a **different, separately-labeled dataset** from `automated_trade_result` (the real account's broker-confirmed trade outcome, reconciled from `trade_journal`) -- the two are owner-directive-distinct and must never be merged. |
| `reconciliationStatus` | `automated_trade_result.status` (when present) | Only exists on documents where a real automated trade was matched to this advisory signal: `not_applicable` \| `no_trade_found` \| `uncertain` \| `matched`. Absent entirely on signals with no real-trade linkage attempt. |

## Signal state values (`signal_state`)

| Value | Meaning |
|---|---|
| `TRACKING_AMBER` | Still open, awaiting TP1 or resolution. |
| `WIN_GREEN_0_5R` | Legacy state name, kept for historical records only -- no longer independently reachable (the generic +0.50R threshold was removed as a win condition, see `advance_persisted_signal`). |
| `WIN_GREEN_TP1` | Resolved WIN via a genuine TP1/TP2/TP3 price cross. `highest_tp_reached` (1/2/3) distinguishes which -- the frontend renders this as "TP1 WIN" / "TP2 WIN" / "TP3 WIN". |
| `LOSS_RED_SL` | Resolved LOSS via a genuine SL price cross (defensive fallback only, unreachable in production -- see below). |
| `LOSS_RED_TIMEOUT` | Resolved LOSS: no TP touched AND the achieved R at the 60-minute deadline was genuinely negative (beyond `BREAK_EVEN_R_TOLERANCE`, currently 0.05R). |
| `PARTIAL_PROFIT` | **Root-cause fix, 2026-08-05.** No TP touched, but the achieved R at the deadline was positive (above `BREAK_EVEN_R_TOLERANCE`) -- e.g. a signal that reached +0.15R/+2.56 Gold moves. This used to be misclassified as `LOSS_RED_TIMEOUT` purely because it hadn't reached TP1, regardless of sign -- the exact defect this fix corrects. |
| `BREAK_EVEN` | No TP touched, achieved R at the deadline was within `BREAK_EVEN_R_TOLERANCE` of entry. |
| `HISTORICAL_DATA_UNAVAILABLE` | Backfill/repair could not reliably reconstruct the tracking path; excluded from stats. This is also this system's answer to "AMBIGUOUS" (tick order/coverage cannot be trusted to say what touched first) -- never guessed in either direction. |

`analytics_outcome` is one of `WIN` \| `LOSS` \| `PARTIAL_PROFIT` \| `BREAK_EVEN` \| `HISTORICAL_DATA_UNAVAILABLE` (see `market_outlook.ANALYTICS_TERMINAL_OUTCOMES` for the four genuine-result values, excluding the unavailable case). `win_rate` everywhere it's computed still only counts `WIN`/`LOSS` in the ratio -- `PARTIAL_PROFIT`/`BREAK_EVEN` are deliberately neither, per the owner's classification policy, though they do count toward `total_r`/`average_r`/tp-hit-rate as genuine completed results.

### The fixed TP grid and the R unit

Owner-approved (2026-08-05): TP1 = entry &plusmn; 5.00 Gold price moves (+50 XauCloud pips, +0.50R). TP2 = entry &plusmn; 10.00 Gold price moves (+100 pips, +1.00R). `risk_distance` is pinned to this same fixed 10.00 Gold-move unit (`market_outlook.XAUCLOUD_R_UNIT_GOLD_MOVES`) for every tracked signal -- it is purely the R&lt;-&gt;price conversion unit, never the real SL distance, and never used for stop-loss touch detection (which always compares `original_sl`'s raw price directly). The stored `analytics_r` on a TP1/TP2 WIN is the signal's genuine executable R at the moment of the touching tick (never a fabricated round number -- may sit fractionally above +0.50R/+1.00R if the tick that crossed TP1/TP2 overshot it); the TP1/TP2-reached push notifications separately quote the owner's canonical fixed figures (+50 pips/+5.00 Gold/+0.50R, +100/+10.00/+1.00R) as the announced milestone, per the owner's exact notification-copy spec.

## Duplicate-final-result prevention

Two independent guarantees, added together:

1. **Database-level**: `cloud_market_outlooks.id` has a unique index (added in `server.py`'s startup index-creation block). A duplicate-id bug fails loudly at startup (logged, non-fatal to boot) rather than silently allowing two documents -- and therefore two "final results" -- for what should be one signal.
2. **Write-level**: the classifying write in `market_outlook.py` (`track_outlook_lifecycle_tick`'s per-quote loop) only commits a first-time classification (`analytics_outcome: None -> WIN/LOSS/PARTIAL_PROFIT/BREAK_EVEN`) if the document is *still* unclassified at the exact moment of write, via an explicit `analytics_outcome: None` clause in the update filter -- on top of the pre-existing `last_monitored_at` optimistic-lock pattern that already prevents lost updates from concurrent writers. Once classified, the pure state-machine function (`advance_persisted_signal`) never recomputes `analytics_outcome`/`analytics_r` again; later price data can only update path metadata (`latest_path_event`), never the frozen result.

Verified in `backend/tests/test_outlook_classification_immutability.py`: an already-classified WIN survives a later price crossing SL, and vice versa; a genuine first classification still works normally; a duplicate `id` insert is rejected by the database.
