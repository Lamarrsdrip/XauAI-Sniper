# XAUUSD AI Sniper v6.4.20 Build Integrity Audit

Date: 2026-07-01

## Result

- MetaEditor compile: 0 errors, 0 warnings.
- Active release: v6.4.20.
- Runtime build hash: v6420-build-integrity-audit-20260701.
- Download filename: XAUUSD_AI_Sniper_EA_MASTER_v6.4.20_FULL_BUILD_INTEGRITY_AUDIT_TTM_COMPILE_FIX.mq5.

## Issues Found And Fixed

1. Version mismatch.
   - Root cause: the v6.4.20 source file still carried v6.4.18 header/changelog text and v6.4.19 runtime constants from the previous release chain.
   - Fix: synchronized the active header, v6.4.20 changelog, `XAUAI_EA_VERSION`, `XAUAI_EA_VERSION_NUM`, `XAUAI_BUILD_HASH`, dashboard/report/journal version emission, backend download source, README, website fallback metadata, Command Center labels, Admin labels, and MT5-visible TTM input group.
   - Why correct: active user-facing and machine-facing release identifiers now all resolve to v6.4.20. Older version references remain only inside historical changelog comments.

2. Invalid MQL version property.
   - Root cause: `#property version "6.4.20"` is not accepted by MetaEditor/MQL5 Market version validation.
   - Fix: changed the compile property to `#property version "6.420"` while keeping the human/runtime EA version as `v6.4.20`.
   - Why correct: MetaEditor accepts the numeric property format, and all logs/dashboards/download metadata still show the intended release label.

3. Trade Thesis Monitor compile failure.
   - Root cause: `TradeTTMRecord` is a struct, but `TTM_Evaluate()` attempted to use a pointer to it. MQL5 allows object pointers only for class types, so MetaEditor rejected `TradeTTMRecord *r = &g_ttm[idx];`.
   - Fix: replaced the illegal pointer with direct indexed access through `g_ttm[idx]` and added a slot bounds/active guard at the start of `TTM_Evaluate()`.
   - Why correct: behavior is preserved because the same record is still updated in place, but the implementation now uses legal MQL5 struct access.

4. Description warning.
   - Root cause: one `#property description` line exceeded MetaEditor length limits.
   - Fix: shortened property descriptions and kept detailed release notes in comments.
   - Why correct: the compile warning is removed without losing the detailed source audit trail.

5. Site/download stale fallback.
   - Root cause: the frontend fallback filename still referenced an older v6.4.20 full-bug-audit label, and tests/README/backend trade-memory default still expected v6.4.14.
   - Fix: updated the website fallback, README, backend default EA version, and static release tests to v6.4.20 build-integrity metadata.
   - Why correct: if the API metadata endpoint is unavailable, the public site still displays and downloads the correct current release name.

## Verification

- MetaEditor: `test_reports/metaeditor_v6420.log` reports `Result: 0 errors, 0 warnings`.
- Static build integrity tests: 64 tests passed using direct test-function execution.
- Backend syntax check: `python3 -m py_compile backend/server.py backend/analytics/xau_attribution_report.py backend/worker_agent/worker_agent.py`.
- Website production build: `npm run build` in `frontend` compiled successfully.
