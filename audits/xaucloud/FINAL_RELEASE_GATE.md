# XauCloud Final Release Gate

Branch: `release/xaucloud-final-production-audit`, base tag `pre-xaucloud-audit-20260724`
(= `210f0e8`, `experiment/v62524-m10-fixed-sl`). Commits: `4313b1c`..`faae85e` (11 commits).

## Decision

**RELEASE HOLD — updated after real compile + real 60-day replay (see `08_60day_replay_results.md`).**

Every check performable from source code, static analysis, and a local (non-production,
non-live-terminal) browser/backend session has passed, with all findings disclosed —
none hidden, none downgraded to make this verdict look better. This session additionally
found a genuinely available isolated MetaEditor/MT5 toolchain (separate from your live/
attached terminal) and used it: **the current source now has a real 0-errors/0-warnings
compile (SHA-256 `948aeee5...`) and a real 60-day M10 tick replay (+$10,839.11 net, 116
trades, PF 1.43, but drawdown notably higher than a prior comparable run — flagged, not
explained away).** That closes two of the seven original gaps. Still open: Mac/VPS
runtime verification, live email test, production deploy, and load test — none of which
this session has access to. Declaring full PASS without them would still be exactly the
"unverified claim" this project's own rules forbid.

## What is proven (evidence in `audits/xaucloud/00`-`07`)

| Area | Result | Evidence |
|---|---|---|
| M10 decision authority | Confirmed sole live entry authority; M30 path confirmed dead/unreachable in this build | `02_ea_root_audit.md`, EA lines 2057, 2126, 20299 |
| Fixed Gold-move broker SL vs. internal R | Confirmed independent — broker SL only, internal R still drives lot sizing/floors | `02_ea_root_audit.md`, lines 21027-21032, 22770-22794 |
| Lot sizing | No silent 0.01 fallback, no hidden loss/fear multiplier on CORE, pyramid shares CORE's risk authority | `02_ea_root_audit.md` |
| Pyramid | Direction/duplicate/restart guards all confirmed correct | `02_ea_root_audit.md` |
| Re-entry | **One real defect found and fixed**: `InpMaxReEntriesPerDay` was undercounted; fixed, adversarially reviewed (caught and corrected a day-boundary bug in the first attempt), independently re-reviewed | `02_ea_root_audit.md`, XC-002, `07_independent_review.md` |
| Exit hierarchy | Precedence mapped; one stale/misleading maintainer comment found (XC-003, not a functional bug); one owner-gated floor-reset behavior flagged for owner confirmation, not unilaterally changed (XC-004) | `02_ea_root_audit.md` |
| Restart/broker-truth reconciliation | Confirmed: real broker-position rebind, persisted R-exit/basket-floor state, emergency close on unconfirmed SL, no silently-naked position by design | `02_ea_root_audit.md` |
| Backend auth/tenant-isolation/webhook/licensing | Independently re-verified against current code (not re-stated from prior docs) — no critical/high defect | `03_backend_security_audit.md` |
| Rate limiting at scale | Real gap identified (in-memory, per-process) — logged for your deployment-topology decision, not silently changed | `03_backend_security_audit.md`, XC-007 |
| Customer-facing docs truthfulness | **One real defect found and fixed**: docs told customers to select a "M30 mode" that is dead code in this build | `01_architecture_map.md`, `03_backend_security_audit.md` fix, XC-001 |
| Command Center mobile redesign | Reordered to spec, verified live against a real (throwaway) local backend — all states genuinely truthful, zero fabricated data, zero console errors | `04_command_center_mobile_redesign.md` |
| XauCloud rebrand | Applied to every confirmed-safe surface; every retained legacy identifier documented with reason; domain unchanged | `03_rebrand_ledger.md` |
| Regression suite | Zero new failures introduced anywhere (diffed against baseline, not assumed); one rebrand-caused test failure found and fixed | `06_regression_test_results.md` |
| Independent review | Fresh reviewer, no implementer context, independently re-derived every major claim — verdict PASS as a code-review matter, two minor disclosed nuances (day-of-month boundary granularity, static-only EA tests) | `07_independent_review.md` |
| **EA compile** | **Real MetaEditor64.exe compile of the exact, unmodified audited source. 0 errors, 0 warnings. SHA-256 `948aeee5d792df440c13bf455e2f876725a832eda154fc1de9e9eb86c711a06b`, now checked into `XAUUSD_AI_Sniper_EA.ex5` and the `backend/ea_code/` mirror (byte-identical).** | `08_60day_replay_results.md` |
| **Real-tick MT5 replay** | **Real 60-day M10 replay, isolated sandbox, never the live terminal (confirmed via `ps aux` before/after). History Quality 100%, 219,957 real ticks. +$10,839.11 net, 116 trades, 68.10% win rate, PF 1.43. Drawdown (43.97%/44.98%) is materially higher than a prior comparable 30-day run — flagged as an open question, not resolved or spun.** | `08_60day_replay_results.md`, raw MT5 report + charts in `60d_replay_evidence/` |

## What is NOT proven (blocks PASS — see `05_live_step_packages.md` for exact steps)

1. **No Mac/VPS runtime verification.** No confirmation the newly compiled build (SHA-256
   `948aeee5...`) is what's actually attached and running on either terminal — this
   session has no remote access to either.
2. **No live email deliverability test** of the renamed PIN/password-reset templates.
3. **No production deployment topology confirmed** — needed to know whether XC-007's
   rate-limiter gap is a release blocker at your actual scale, and needed before any
   staged deploy.
4. **No load test** at 10,000+-user concurrency.
5. **The 60-day replay is a single in-sample window, no holdout split.** Doesn't prove
   forward performance; the drawdown increase versus the prior 30-day run hasn't been
   root-caused.
6. **`backend/ea_releases/manifest.json` has a real `v6.25.24` entry now, but
   `current_version` is deliberately still `v6.25.8`** — promotion needs item 1 first.

## Explicit non-actions this session, and why

- **Not merged to `main`.** This branch exists specifically so `main` stays at its last
  known-good state (`210f0e8`) until a PASS verdict is reached.
- **Not pushed to `origin/main`,** for the same reason. (The audit branch itself was
  pushed to `origin` — that's low-risk and reversible, unlike touching `main`.)
- **Not deployed to any MT5 terminal or VPS.** This session has no remote access to your
  VPS (`173.212.249.202` per prior handover notes) or to your local Mac's actual running
  (live/attached) MT5 Experts folder — confirmed via `ps aux` that a separate, long-running
  live terminal process exists and was never touched. A real compiled artifact now exists
  (unlike when this was first written), but "deploying" it still requires either your own
  hands or explicit access this session doesn't have.
- **Not fabricated any hash, tick-replay number, or manifest entry.** Where a first
  attempt at real evidence failed (three failed Tester runs before the cache-eviction
  root cause was found), that failure is documented in `08_60day_replay_results.md`
  rather than silently retried until a report happened to look right.

## Path to PASS

Two of six live-step items are now closed with real evidence (compile, replay). Work
through `audits/xaucloud/05_live_step_packages.md` §3-§6 (Mac/VPS runtime verification →
email → deploy → load test), returning the evidence each step asks for. Each will be
inspected against its stated pass/fail criteria before this document is updated. Once
those are closed, this verdict updates to **PRODUCTION PASS** and only then is a
merge/push/deploy appropriate.

## Remaining known limitations (carried forward, not hidden)

- XC-003 (stale exit-hierarchy comment), XC-004 (profit-floor reset needs your
  confirmation it's intended), XC-005 (recommend distinct pyramid magic number, not
  applied — coordination risk with already-open live positions), XC-006/pre-existing test
  decay (468 EA-suite / 81 backend-suite failures, all pre-existing, none introduced this
  session), XC-008 (unused Bearer-header auth fallback, low-risk hardening recommendation).
- The independent review's two nuances: the re-entry day-boundary check is
  day-of-month-only (inherited pattern, not introduced here); all EA regression tests in
  this repo are static source-text assertions, not compiled/executed verification (no
  MQL5 toolchain exists in this environment).
