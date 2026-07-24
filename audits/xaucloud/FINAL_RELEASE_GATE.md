# XauCloud Final Release Gate

Branch: `release/xaucloud-final-production-audit`, base tag `pre-xaucloud-audit-20260724`
(= `210f0e8`, `experiment/v62524-m10-fixed-sl`). Commits: `4313b1c`..`170ca32` (9 commits).

## Decision

**RELEASE HOLD.**

Every check performable from source code, static analysis, and a local (non-production,
non-live-terminal) browser/backend session has passed, with all findings disclosed —
none hidden, none downgraded to make this verdict look better. But the items that decide
whether real money should move through this build — a real compile, a real MT5 tick
replay, real Mac/VPS runtime verification, and a real production deployment — have not
happened, because they require a live MT5 terminal, MetaEditor/Wine toolchain, and
production credentials this session does not have. Declaring PASS without them would be
exactly the "unverified claim" this project's own rules forbid.

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

## What is NOT proven (blocks PASS — see `05_live_step_packages.md` for exact steps)

1. **The EA has not been recompiled since this session's source edits.** The checked-in
   `.ex5` binaries are stale relative to `.mq5` source. No MetaEditor/Wine toolchain was
   available in this session.
2. **No real-tick MT5 Strategy Tester replay has been run on the current source.** The
   existing 30-day fixed-SL vs. structural-SL comparison in
   `analysis/m10_fixed_sl_experiment/` predates this session's re-entry-cap fix.
3. **No Mac/VPS runtime verification.** No confirmation the recompiled build (once it
   exists) is what's actually attached and running on either terminal.
4. **No live email deliverability test** of the renamed PIN/password-reset templates.
5. **No production deployment topology confirmed** — needed to know whether XC-007's
   rate-limiter gap is a release blocker at your actual scale, and needed before any
   staged deploy.
6. **No load test** at 10,000+-user concurrency.
7. **`backend/ea_releases/manifest.json` has no entry for this branch's work** —
   `current_version` is still `v6.25.8`. Adding one with a fabricated hash would itself be
   a release-gate violation; the real entry (template provided) can only be added once §1
   produces a real compile.

## Explicit non-actions this session, and why

- **Not merged to `main`.** This branch exists specifically so `main` stays at its last
  known-good state (`210f0e8`) until a PASS verdict is reached. Merging now would put the
  stale-binary state described in §1 above onto the branch your CI treats as
  production-track.
- **Not pushed to `origin/main`,** for the same reason.
- **Not deployed to any MT5 terminal or VPS.** This session has no remote access to your
  VPS (`173.212.249.202` per prior handover notes) or to your local Mac's actual running
  MT5 Experts folder — those are outside this git repository and this session's reach
  entirely. Even with access, there is currently no freshly-compiled artifact to deploy
  (§1) — attempting to "deploy" right now would either push a stale/mismatched binary or
  do nothing.
- **Not fabricated any hash, tick-replay number, or manifest entry** to make this section
  look more finished than it is.

## Path to PASS

Work through `audits/xaucloud/05_live_step_packages.md` in order (§1 compile → §2 replay
→ §3 runtime verification → §4 email → §5 deploy → §6 load test), returning the evidence
each step asks for. Each will be inspected against its stated pass/fail criteria before
this document is updated. Once all seven items above are closed with real evidence, this
verdict updates to **PRODUCTION PASS** and only then is a merge/push/deploy appropriate.

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
