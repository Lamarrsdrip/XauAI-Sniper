# XauCloud Performance Reset — Final Report

Branch: `fix/performance-forward-reset` (off `origin/main` @ `31fed15`)
Status: **Code complete, tested, merged to `main`. Real activation of the
new forward period is the owner's own action — see Section 6.**

## 1. What changed and why

The homepage previously showed one all-time, unscoped aggregate over
every trade ever logged (`db.trade_journal.find({})`), producing the
stale, mixed 61.6% win rate / 1.29 profit factor / 1,217 trades / -$135,216.60
drawdown figures the owner no longer wanted promoted as "current." That
aggregation is gone. The system now reports exactly one thing: the
active forward-reporting period, computed from a clean, honest, scoped
query — never mixed with anything before its start timestamp.

## 2. New architecture

- **`performance_periods` collection** — one document per reporting
  period (`ACTIVE` or `ARCHIVED`), storing the exact server timestamp it
  started/ended, its scope (accounts/EA versions/symbol/BE tolerance/
  minimum sample), who started it, and why.
- **`backend/performance_engine.py`** — the single source of truth for
  every number shown anywhere: eligibility filtering, dedup, win/loss/BE
  classification, profit factor (with honest edge cases), balance
  drawdown, streaks, and the recent-trades list. One calculation, reused
  everywhere — homepage, full page, admin, and historical archive.
- **Endpoints**: `GET /performance/summary` (homepage), `GET /performance/full`
  (detail page, optional `period_id`), `GET /performance/historical` (all
  archived periods), `GET /admin/performance/periods` (admin list),
  `POST /admin/performance/periods/start` (password-gated period start).
- **Frontend**: rebuilt `PerformanceSection.jsx` (homepage — 4 stat cards +
  a 10-row compact recent-trades strip + a "Forward tracking active"
  collecting-data state + a real "Performance temporarily unavailable"
  state), new `PerformancePage.jsx` (full detail) and
  `PerformanceHistoryPage.jsx` (read-only archive), and a new admin
  "Performance" tab with a "Start New Forward Period" flow (confirmation
  step + password re-entry, matching the server-side fresh-auth gate).

See `01_current_system_audit.md` for the pre-change forensic audit and
`02_implementation_notes.md` for the specific design decisions (balance
vs. equity drawdown, profit-factor states, historical-period
auto-creation, scope discipline, fail-closed error handling).

## 3. Honesty guarantees (owner's explicit requirements, verified)

| Requirement | How it's satisfied |
|---|---|
| Win rate/profit factor never fabricated | Computed only from `compute_period_stats()` over real `trade_journal` rows; no hardcoded numbers anywhere in the endpoint or frontend (confirmed by grep in the Phase 1 audit and by this task's tests). |
| Historical data preserved, never deleted | `performance_periods` documents are only ever inserted or `$set` to `ARCHIVED` — no delete path exists. The pre-reset 1,217 trades become their own "Historical EA Journal" archived period on first activation. |
| Trade counted by its real open time, not close time or insert time | `_period_query()` filters on `opened_at`, not `closed_at` or DB insertion order — verified by `test_trade_opened_before_epoch_excluded_even_if_closed_after`. |
| No infinite/fabricated profit factor | Three explicit states (`ok` / `not_established` / `no_data`) — never a divide-by-zero, never `Infinity`. |
| Drawdown is a percentage, correctly labeled | "Max Balance Drawdown %" only (no real equity-snapshot series exists to honestly support an equity-based figure — see implementation notes §1). |
| <20 trades never shows a misleading ratio | `sufficient_data` gate; frontend shows "Forward tracking active / N closed trades since [date] / Collecting enough data…" until then. |
| API failure never shows stale/fabricated data | Every endpoint fails closed to `{"status": "unavailable"}`; frontend renders "Performance temporarily unavailable." |
| No mixing of Mac replay / VPS / demo / Market Edition / bot versions | Every period has an explicit `account_logins`/`ea_versions`/`symbol` scope, enforced in `_period_query()`, chosen by the admin at period-start time — not inferred. |

## 4. Tests run (all real, all passing)

- **`backend/tests/test_performance_reset.py`** — 25 new tests against a
  live local MongoDB: epoch boundary correctness (both directions),
  eligibility filtering, dedup, win/loss/BE classification and win-rate
  exclusion, commission/swap inclusion, profit-factor states (ok /
  not-established / no-data), drawdown math and zero-drawdown-on-fresh-
  period, minimum-sample gating (both sides), archival immutability,
  historical-period auto-creation, wrong-password and missing-confirm
  rejection on period start, idempotent recalculation, homepage
  unavailable/collecting states, cross-period isolation, and
  account/EA-version scope filtering. **25/25 passed.**
- **Full backend regression**, run per-file (this project's established
  correct method — the shared event loop across files in one pytest
  invocation is a pre-existing, documented limitation unrelated to this
  change; confirmed by reproducing the same failure count with and
  without the new test file): `test_performance_analytics.py` (10),
  `test_notification_scheduler_and_winrate.py` (24),
  `test_public_release_and_timeframe.py` (13),
  `test_signal_outlook_persisted_lifecycle.py` (24),
  `test_signal_outlook_persistence_and_backfill.py` (4),
  `test_outlook_slot_dedup_and_active_count.py` (8), `test_admin_mfa.py`
  (15), `test_paystack_payment_security.py` (11),
  `test_download_security.py` (14), `test_license_binding_security.py`
  (9) — **all passed, zero regressions.**
- **Frontend**: real production build (`npx craco build`) compiles
  cleanly with the new pages/components. `forensic.contract.test.js`
  (9/9 passed) — confirms the required `"sufficient_data"` and
  `"First-party trading records, not independently verified"` strings
  survived the rebuild. One pre-existing, unrelated failure in
  `cloudDashboardLayout.contract.test.js` was independently reproduced
  against unmodified `main` (byte-identical failure, same assertion) —
  confirmed not caused by this work.

## 5. Not done / explicitly out of scope for this session

- **Live/real-money verification.** All tests above run against a local,
  seeded MongoDB instance. Nothing here has touched production data.
- **Mobile visual QA in a real device/browser.** The build compiles and
  the layout uses the same responsive grid classes as the rest of the
  homepage, but no live device screenshot was taken this session.

## 6. Owner action required — activating the real forward period

Per the standing instruction not to enter your credentials or touch
production directly: **I did not activate anything in production.** The
new "XauCloud Forward Record — July 2026" period must be started by you,
from the real Admin Dashboard, using your own password:

1. Deploy this branch (now merged to `main`) to production.
2. Log into `/admin` → **Performance** tab.
3. Click **Start New Forward Period**.
4. Name: `XauCloud Forward Record — July 2026`. Reason: your own words
   (e.g., "clean forward record per 2026-07-24 reset directive").
   Leave account/EA-version scope blank to include everything from this
   moment forward, or scope it explicitly if you want to exclude a
   specific test account.
5. Confirm, then re-enter your admin password when prompted.
6. The homepage will immediately show "Forward tracking active / 0
   closed trades since [today's date]" and will start reporting real
   numbers automatically as trades close — no further action needed.

The pre-reset 1,217-trade dataset is preserved automatically as
"Historical EA Journal" the moment you do this, viewable read-only at
`/performance/history`.

## 7. SEO (adjacent request, same session)

Added `public/robots.txt` (allows crawling, disallows `/admin` and the
Command Center auth/dashboard routes, points to the sitemap),
`public/sitemap.xml` (the six public marketing/detail routes), and an
`Organization` + `Brand` JSON-LD block naming "XauCloud" explicitly
(alongside the pre-existing `SoftwareApplication` and `FAQPage` schema).
This improves how search engines and AI answer engines can resolve
"XauCloud" as the entity behind `xauaisniper.com` — it is not a
guarantee of ranking or of being cited by any specific chatbot, both of
which depend on external crawling/indexing timelines outside this
codebase's control.
