# Performance Reset — Phase 1 Audit of the Current Statistics System

Branch: `fix/performance-forward-reset`, based on `origin/main` @ `31fed15`.

## Exact source of the 4 displayed numbers

```
Customer browser
  → GET /api/performance/summary   (backend/server.py:1299-1448, no auth, public)
  → aggregates db.trade_journal.find({}) -- ALL documents, no filter at all
  → App.js:33 stores the response as `performance` state
  → PerformanceSection.jsx (frontend/src/components/PerformanceSection.jsx)
     renders the 4 homepage cards directly from that response
```

**No hardcoded fallback values were found anywhere** — grepped for the
literal strings `61.6`, `1217`/`1,217`, `135216`/`135,216`, `1.29` across
`frontend/src` and every `backend/*.py`: zero matches. This is a real,
live-calculated aggregate over genuine journal data, not fabricated or
hardcoded. The problem is what it aggregates and how it's labeled, not
that it's fake.

## Formula for each number, as currently implemented

| Displayed as | Field | Current formula (server.py:1299-1448) |
|---|---|---|
| Win rate 61.6% | `win_rate` | `wins / total * 100`, where `total` = count of trades with `result` in `{WIN, LOSS, BE}`. **Break-even trades are excluded from the numerator but still counted in the denominator** — differs from the owner's spec, which wants win rate = wins / (wins + losses), with BE excluded from both. |
| Profit factor 1.29 | `profit_factor` | `gross_profit / gross_loss` over every closed trade's `profit` field, `gross_profit`/`gross_loss` summed from all closed trades regardless of age. **Formula itself already matches the owner's spec exactly** — the problem is dataset scope (all-time), not the math. |
| Closed trades 1,217 | `total_trades` | `len(closed)` — every `trade_journal` row with `result` in `{WIN, LOSS, BE}`, all-time, all accounts, all EA versions, no scope filter of any kind. |
| Max drawdown -$135,216.60 | `max_drawdown` | A running-balance peak-to-trough **dollar** amount (`peak_equity - running_equity`, accumulated by iterating closed trades in `created_ts` order) — not a percentage, and computed from cumulative trade P&L, not from real broker equity snapshots. This is closest to a "max balance drawdown in dollars"; the owner's spec wants this as a **percentage** (`max balance drawdown %` unless real equity snapshots exist, which they do not appear to — see below). |

## Why there's no time-scoping, account-scoping, or version-scoping today

`/performance/summary`'s query is literally `db.trade_journal.find({}, ...)`
— an unconditional fetch of every document in the collection, sorted only
by `created_ts`. There is no `performanceEpochStartedAt`-equivalent
concept anywhere in this codebase today. There is no `account_login`
allowlist, no `ea_version` filter, no environment (demo/live/test) tag
consulted. Every trade any licensed installation has ever reported —
whatever mix of the owner's own test accounts, the M10-fixed-SL
experiment, the M5 experiment, the hybrid experiment, real customer
accounts, and anything else — is aggregated into one number.

## The trade document schema (what data is actually available to build on)

`TradeJournalEntry` (server.py:3554-3594), submitted by the EA via
`POST /journal/log`, requires a valid, active license (`pin` +
`account_login`) to write — not open to unauthenticated callers.
Relevant fields already present and reliable:

```
symbol, direction, result (WIN/LOSS/BE, EA-classified), price, profit,
lots, hour, day_of_week, balance, signature, setup, regime,
ticket           -- real broker deal ticket; 0 for pre-v6.25.3 reports
entry_price
opened_at        -- unix seconds, REAL BROKER DEAL TIME (exactly what
                    "original position-open timestamp" needs)
closed_at        -- unix seconds, real broker deal time
commission, swap -- real trading costs, separate from `profit`
original_risk_usd, final_r, mae_r, mfe_r
campaign_id, ea_version, account_login, exit_reason, exit_owner, family
```

Plus server-added fields at insert time: `license_id`, `created_at`
(ISO, server receipt time — **not** the same as `opened_at`/`closed_at`),
`created_ts`, `has_rich_ledger_data` (`true` only when `ticket > 0`,
i.e. only for v6.25.3+ EA reports).

**This is good news for the reset**: a genuine `opened_at` (broker deal
time, not server receipt time) already exists on every rich-ledger row,
which is exactly the field the spec requires filtering on ("original
position-open timestamp is on or after the reset timestamp"). Pre-
v6.25.3 rows (`has_rich_ledger_data: false`, `ticket == 0`) never sent a
reliable `opened_at` — the spec explicitly excludes "reconstructed
trades without reliable timestamps," so the new forward-period
calculation must require `has_rich_ledger_data == true` (or equivalently
`ticket > 0` and `opened_at > 0`) to even be eligible, not just filter on
`opened_at >= epoch`.

## Whether `profit` is gross or net (commission/swap handling)

`profit` is the raw price-driven P&L the EA reports per trade;
`commission` and `swap` are separate fields, not already folded in.
Every existing win_rate/profit_factor computation in this codebase
(including `/performance/summary`) uses raw `profit` and the EA's own
`result` classification directly — **none of the existing aggregate
endpoints add `commission`/`swap` to get a true net result before
classifying WIN/LOSS/BE or before summing gross profit/loss.** This is a
real, current gap relative to the owner's spec ("Net realized result
after commission, swap and fees"). The new forward-period calculation
engine must compute `net_result = profit + commission + swap` itself
(commission/swap are conventionally negative-signed cost values from a
broker deal, so adding them nets out the cost) and independently
reclassify WIN/LOSS/BE against a configurable break-even tolerance,
rather than trusting the EA's own `result` field, which was set before
commission/swap were even being sent in earlier versions and is not
guaranteed to reflect net result even in current versions.

## Equity vs balance drawdown

No real broker equity snapshot series exists anywhere in this schema —
`balance` is reported per-trade-close only (a point-in-time balance
after that trade), not a continuous equity curve. There is no
`cloud_equity_snapshots`-equivalent live collection feeding
`/performance/summary` (a `cloud_equity_snapshots` collection existed
for the retired copy-trading system per `0001_delete_copy_trading.py`
but was deleted with it, and was never wired to this endpoint anyway).
**Conclusion: only MAX BALANCE DRAWDOWN is honestly computable from what
this system actually has — the card must say "Max Balance Drawdown," not
"Max Equity Drawdown."** Labeling it as equity drawdown would be
inventing a metric this system cannot actually measure.

## Caching / stale-data behavior

`/performance/summary` has no caching layer of its own (computed fresh
on every request from `db.trade_journal`). `App.js`'s `useEffect` fetches
once on mount into React state with no polling/refresh and no
localStorage/sessionStorage persistence — a hard page reload always gets
a fresh value.

**Confirmed the exact failure-mode gap the spec warns about**:
`App.js:31-38`'s `fetchPerformance()` catch block only
`console.error`s in development and otherwise does nothing — `performance`
state simply stays `null` forever on a failed fetch. `PerformanceSection`
doesn't crash on `null` (safe optional chaining throughout), but it also
doesn't distinguish "API call failed" from "zero trades collected so
far" — both currently render the same "Insufficient data"/`--` look.
The spec wants a distinct "Performance temporarily unavailable" state
specifically for the failure case, which does not exist today and needs
to be added.

## No existing full-performance or historical-archive page

Confirmed by search: no dedicated performance detail page, no
historical/archive page exists anywhere in `frontend/src` today — both
need to be built from scratch, along with their backing routes.

## What already exists that matches the spec well (keep, don't rebuild)

- `sufficient_data`/`minimum_sample: 20` gating already exists in both
  the API response and the frontend component — the spec's minimum-
  20-trade requirement is already a first-class concept here, just not
  yet wired to a forward-period scope.
- Profit factor formula already matches the spec exactly.
- Division-by-zero handling already present (`gross_loss > 0` guard).
- `independently_verified: False` / `source: "live_journal"` honesty
  labels already present.
- The `/journal/log` ingestion endpoint already requires a real active
  license — not an open, spoofable endpoint.

## What needs to change

1. Win-rate denominator: exclude BE from the denominator, not just the
   numerator.
2. Drawdown: convert to a percentage (balance-based, honestly labeled),
   remove the money display from the homepage card.
3. Add real forward-period scoping: a new `performance_periods`
   collection with an immutable `performanceEpochStartedAt`, and require
   `opened_at >= epoch` (not `closed_at`, not `created_at`) plus
   `has_rich_ledger_data == true` for a trade to count.
4. Compute WIN/LOSS/BE server-side from `profit + commission + swap`
   against a configurable break-even tolerance, not the EA's raw
   `result` field.
5. Add account/version scope configuration (the spec's "explicit
   reporting scope") — flagged as needing the owner's own input on which
   `account_login`(s) are genuinely production, since nothing in the
   code distinguishes test/demo/experiment accounts from real customer
   accounts today.
6. Build the historical archive page/endpoint (pre-epoch data, read-only,
   clearly dated).
7. Build the full performance detail page/endpoint.
8. Build the Admin → Performance → Reporting Periods UI and the "Start
   New Forward Period" action.
