# XAU AI Sniper Full Site / Command / Admin Audit

Date: 2026-06-30
Scope: EA release wiring, website download section, Command Center, Admin portal, backend route contracts.

## Findings Fixed

1. Stale release labels remained in the public footer, Command Center landing page, Command dashboard, and Admin portal.
   - Before: several visible labels still displayed `v6.3.6` or `v6.4.2`.
   - After: all active public/admin/command labels display `v6.4.14`.

2. Backend `TradeMemoryRecord` default `ea_version` was stale.
   - Before: default was `v6.4.6`.
   - After: default is `v6.4.14`.

3. Command Center prop-firm UI wording did not match its contract.
   - Before: `Max basket risk`.
   - After: `Maximum basket risk`.

4. Added static regression coverage so stale release labels are caught across website, Command Center, Admin, and backend defaults.

## Checks Run

- Python syntax:
  - `backend/server.py`
  - `backend/analytics/xau_attribution_report.py`
  - `backend/worker_agent/worker_agent.py`

- Static contract tests:
  - 64 checks across 12 files.

- Frontend production build:
  - `npm run build` in `frontend`
  - Result: compiled successfully.

- Frontend/backend endpoint contract scan:
  - Active frontend API calls: 32
  - Missing backend contracts: 0

## Notes

`frontend/src/components/PinManagerSection.jsx` still calls old `/pins` admin endpoints, but it is not mounted by the current React router. The active Admin portal uses `/admin/pins` correctly.

Security/config items observed but not changed blindly:

- Admin auth cookie uses `secure=False`.
- Cloud auth cookie uses `secure=True`.
- CORS defaults to `*` with credentials enabled if `CORS_ORIGINS` is not set.

These should be reviewed before production deployment, but changing them without deployment environment details could lock out local/admin access.
