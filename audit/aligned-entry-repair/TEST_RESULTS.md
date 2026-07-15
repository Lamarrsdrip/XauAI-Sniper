# v6.24.0 test results

## Current-release gates

- `pytest -q tests/test_xau_v6240_aligned_entry_engine.py`: **22 passed**.
- July 15 fresh-near-4033 / consumed-near-4026 policy reconstruction: **passed**.
- Required timing policy: **passed** — absolute 120-second floor, 150-second default, 180-second ceiling; no immediate grade bypass; live freshness is evaluated before timing release.
- PRIMARY / RE_ENTRY / PYRAMID authority alignment and separate lane clocks: **passed**.
- `python3 -m py_compile backend/server.py`: **passed**.
- `git diff --check`: **passed**.
- Frontend optimized production build: **passed**. The repository's unpinned dependency tree first required npm legacy peer resolution (`date-fns` 4.x conflicts with `react-day-picker`'s declared peer range) and a temporary untracked `ajv@8` install. No dependency manifest or lockfile was changed.
- Canonical backend source, unversioned active source and v6.24.0 source: **byte-identical**.

## Complete historical suite

Command: `pytest -q tests --junitxml=/tmp/xau_v6240_exact_final.xml`

- Final v6.24.0 run: **809 passed, 301 failed** (1110 tests; includes 22 new v6.24.0 tests).
- Untouched `origin/main` v6.23.3 baseline: **880 passed, 208 failed** (1088 tests).
- Baseline-comparable v6.24.0 existing tests: **787 passed, 301 failed**.
- Newly failing versus baseline: **93**.
- Baseline failures resolved: **0**.

The 93 delta failures are static historical contracts that require modules deliberately deleted or neutralized by this repair: the old ContextGate, XAUEntryTimingGuard, pending-opportunity recovery, next-bar timing engine, personality hard gate, Active Direction locks, SMC hard conflict, SmartGuard bypass chains, AI sizing/gating, prop-firm pyramid strategic block, report-fit scout and exact old distribution mirrors. They are specification conflicts, not runtime test failures, but they still make the repository-wide suite red.

## Release-gate verdict

**HOLD — do not commit or push.** `PRE_CHANGE_BLOCKER_PLAN.md` says not to push while tests fail. The focused production contract, compile, backend and frontend checks pass, but the repository-wide gate is not green and has 93 expected-but-unresolved historical-contract failures beyond baseline. No commit, push, force-push or deployment was performed.
