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
| `takeProfit1` | `tp1_price` | `tp2_price`/`tp3_price` also exist for TP2/TP3. |
| `confidence` | `confidence_pct` | 0-100. |
| `evaluationWindow` | `evaluation_deadline` | Published-time + `OUTLOOK_EVALUATION_MINUTES` (60min), see `market_outlook.py`. |
| `status` | `signal_state` | See state values below. `status` (a separate, coarser field: `PUBLISHED`\|`TRACKING`\|`INFORMATIONAL`) also exists but `signal_state` is the authoritative lifecycle value. |
| `completedAt` | `classification_at` | Set once, at the moment `analytics_outcome` transitions from `None` to `WIN`/`LOSS`. Never updated again (see immutability guarantee below). |
| `finalExitOrEvaluationPrice` | `last_tracked_price` | The live price at the moment of classification. |
| `maxFavorableExcursion` | `mfe_r` | In R, not price. |
| `maxAdverseExcursion` | `mae_r` | In R, not price. |
| `resultR` | `analytics_r` | The frozen final R once classified. `current_r` continues to update only while still tracking (pre-classification). |
| `resultPips` | *(derived)* | Not stored -- computed on read via `market_outlook.build_result_conversion(r=analytics_r, risk_distance=risk_distance)`. Never store this separately; it must always be derived from `analytics_r` so it can never drift from the R value it represents. |
| `resultGoldMoves` | *(derived)* | Same function, same rule. |
| `resultReason` | `latest_path_event` | e.g. `TP1_HIT`, `SL_HIT_BEFORE_WIN`, `FAILED_HALF_R_60M`. |
| `authoritativeSource` | *(implicit)* | The advisory tracking's own resolution is authoritative for `analytics_outcome`/`analytics_r` -- sourced from real live bid/ask crossing this document's own `original_sl`/`tp1_price`/etc, computed in `advance_persisted_signal()`. This is a **different, separately-labeled dataset** from `automated_trade_result` (the real account's broker-confirmed trade outcome, reconciled from `trade_journal`) -- the two are owner-directive-distinct and must never be merged. |
| `reconciliationStatus` | `automated_trade_result.status` (when present) | Only exists on documents where a real automated trade was matched to this advisory signal: `not_applicable` \| `no_trade_found` \| `uncertain` \| `matched`. Absent entirely on signals with no real-trade linkage attempt. |

## Signal state values (`signal_state`)

| Value | Meaning |
|---|---|
| `TRACKING_AMBER` | Still open, awaiting +0.50R or resolution. |
| `WIN_GREEN_0_5R` | Resolved WIN via the +0.50R timed-advisory rule (not a genuine TP1 touch). |
| `WIN_GREEN_TP1` | Resolved WIN via a genuine TP1 (or TP2/TP3) price cross. |
| `LOSS_RED_SL` | Resolved LOSS via a genuine SL price cross. |
| `LOSS_RED_TIMEOUT` | Resolved LOSS: still below +0.50R when the 60-minute evaluation window closed. |
| `HISTORICAL_DATA_UNAVAILABLE` | Backfill/repair could not reliably reconstruct the tracking path; excluded from stats. |

There is currently no distinct `BREAK_EVEN` advisory outcome -- `analytics_outcome` is binary (`WIN` \| `LOSS`), plus `HISTORICAL_DATA_UNAVAILABLE`. Any UI/API surface that lists `BREAK_EVEN` as a possible result category will simply never see one from this dataset today; that's not a bug, just this system's current classification rule.

## Duplicate-final-result prevention

Two independent guarantees, added together:

1. **Database-level**: `cloud_market_outlooks.id` has a unique index (added in `server.py`'s startup index-creation block). A duplicate-id bug fails loudly at startup (logged, non-fatal to boot) rather than silently allowing two documents -- and therefore two "final results" -- for what should be one signal.
2. **Write-level**: the classifying write in `market_outlook.py` (`track_outlook_lifecycle_tick`'s per-quote loop) only commits a first-time classification (`analytics_outcome: None -> WIN/LOSS`) if the document is *still* unclassified at the exact moment of write, via an explicit `analytics_outcome: None` clause in the update filter -- on top of the pre-existing `last_monitored_at` optimistic-lock pattern that already prevents lost updates from concurrent writers. Once classified, the pure state-machine function (`advance_persisted_signal`) never recomputes `analytics_outcome`/`analytics_r` again; later price data can only update path metadata (`latest_path_event`), never the frozen result.

Verified in `backend/tests/test_outlook_classification_immutability.py`: an already-classified WIN survives a later price crossing SL, and vice versa; a genuine first classification still works normally; a duplicate `id` insert is rejected by the database.
