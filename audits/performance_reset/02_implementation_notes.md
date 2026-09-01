# Performance Reset — Implementation Notes

Design decisions made while building the forward-record reset system, and
why, referenced from `backend/server.py` and `backend/performance_engine.py`.

## 1. Equity drawdown vs. balance drawdown

The spec asked for "Max Equity Drawdown %" only if real equity snapshots
exist, else "Max Balance Drawdown %", and explicitly forbade mislabeling.

Audit (`01_current_system_audit.md`) confirmed `TradeJournalEntry` has no
equity-snapshot series anywhere in the schema — only a `balance` field the
EA reports after each closed trade. There is no honest way to compute an
equity curve (which would need floating P/L on open positions at arbitrary
points in time) from this data. Decision: implement balance drawdown only,
label it "Max Balance Drawdown %" everywhere (homepage, full page, admin,
historical archive), and never introduce a synthetic equity curve derived
from summed profits (which is what the old dollar-based drawdown figure
effectively was).

## 2. Profit factor edge cases

Three distinct states, never a single fallback:
- `"ok"` — at least one loss exists; `profit_factor_value = gross_profit / abs(gross_loss)`.
- `"not_established"` — closed trades exist, gross profit > 0, but zero
  losses recorded yet. Never reported as infinity; the frontend renders
  "Not established".
- `"no_data"` — zero closed trades. Frontend renders "Collecting data".

This mirrors the win-rate exclusion of break-even trades: BE trades are
excluded from both the win-rate numerator and denominator, and the same
net-result classification (`profit + commission + swap` vs. a $1 default
tolerance) drives every number on the page — win rate, profit factor,
average win/loss, and the recent-trades list — so nothing on screen can
disagree with anything else about which trades won or lost.

## 3. Historical EA Journal auto-creation

The owner's 1,217 pre-reset trades needed a permanent home rather than
being an orphaned, unscoped blob once the period system existed. On the
very first-ever period activation (`admin_start_performance_period`,
`current_active is None` and `existing_periods_count == 0`), the server
auto-creates and immediately archives a "Historical EA Journal" period
spanning from the earliest eligible trade's real `opened_at` timestamp to
the moment the new forward period starts. It is queried and rendered
through the exact same `_period_summary_dict()` path as every other
period — no separate code path, so it can never silently diverge in how
it calculates its own numbers.

On every subsequent "Start New Forward Period" action, the previously
ACTIVE period is archived (`status: "ARCHIVED"`, `epoch_ended_at` set to
the exact activation moment) — never deleted, never rewritten.

## 4. Scope discipline (accounts / EA versions / symbol)

Every period stores an explicit `scope` (`account_logins`, `ea_versions`,
`symbol`, break-even tolerance, minimum sample). `_period_query()` applies
all of them as MongoDB `$in`/exact filters before `is_eligible_trade()` and
`dedupe_by_ticket()` run. This is the mechanism that satisfies the owner's
explicit "must not mix Mac replay tests, VPS accounts, demo accounts,
Strategy Tester results, MQL5 Market Edition tests, multiple bot versions,
or manual trades" requirement — an admin starting a new period chooses the
scope explicitly rather than the system silently aggregating everything in
`trade_journal`.

## 5. Eligibility and dedup

`is_eligible_trade()` requires `has_rich_ledger_data` (server-computed:
only true for v6.25.3+ EA reports with a real ticket and reliable
timestamps), a nonzero `ticket`, and a nonzero `opened_at`. This is what
excludes pre-v6.25.3 reports with unreliable timestamps, and open
positions (which have no reliable close-side data yet). `dedupe_by_ticket()`
keeps first-seen-by-ticket, so a duplicate close event (retry, reconnect,
etc.) is counted exactly once. Deposits/withdrawals/balance adjustments
were confirmed in the Phase 1 audit to never be written to `trade_journal`
at all (only actual EA trade closes are), so no separate filter was needed
for those.

## 6. Fail-closed on error, never stale data

`get_performance_summary()`, `get_performance_full()`, and
`get_performance_historical()` each catch calculation/lookup exceptions
and return `{"status": "unavailable"}` rather than falling back to a
cached or partial result. The frontend (`PerformanceSection.jsx`,
`PerformancePage.jsx`) treats `!data` and `status === "unavailable"`
identically — a real "Performance temporarily unavailable" state, never a
silent zero or a stale previous render.

## 7. Admin fresh-auth on period start

`POST /admin/performance/periods/start` requires `current_password` and
re-verifies it against the caller's actual password hash on every call
(same pattern as `update_admin_account()` and the Nomba production-
credential gate) — an already-valid session cookie is not sufficient to
archive the current record and start a new one. `confirm: true` is also
required, and the action is logged
(`PERFORMANCE_PERIOD_STARTED id=... name=... by=... epoch=...`) with the
admin's email and the exact server timestamp.
