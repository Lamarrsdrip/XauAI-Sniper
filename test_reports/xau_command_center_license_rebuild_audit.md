# XAU AI Sniper Command Center License Rebuild Audit

## Scope

Rebuilt the user-facing Command Center and cleaned the admin product surface so the platform matches the new product model:

- XAU AI Sniper is a licensed MT5 EA.
- Users install the EA on their own MT5/VPS.
- The ASE license key links the EA/account to Command Center.
- Command Center monitors and queues safe remote commands.
- Old cloud-copy/master/follower data is not shown in the new user or admin experience.

## Backend Changes

- Added license link/status endpoints:
  - `POST /api/cloud/license/link`
  - `GET /api/cloud/license/status`
- Remote command requests now verify the linked ASE license key instead of a detached 4-6 digit PIN.
- Monitor status/activity is scoped to the linked license MT5 account.
- Unlinked users see no stale trade/activity records.
- Added admin Bot Ops endpoint:
  - `GET /api/admin/command-center/overview`

## Frontend Changes

- Rebuilt `/command/dashboard` into a mobile-first app shell:
  - Home
  - Trading
  - Analytics
  - Intelligence
  - Activity
  - Control
  - License
  - Settings
- Moved all remote commands into the Control page.
- Added License page for ASE license linking.
- Replaced browser prompts with proper modal confirmation.
- Removed fake/stale cloud activity from the user dashboard.

## Admin Cleanup

- Replaced the old admin `COMMAND CENTER` tab with `BOT OPS`.
- Removed the legacy `CloudAdminTab` source from the compiled admin portal.
- Admin dashboard now focuses on license business operations instead of old copy-trading/global cloud data.

## Verification

- `python3 -m py_compile backend/server.py` passed.
- `python3 -m pytest tests -q` passed: 18 tests.
- `npm run build` passed with existing React hook dependency warnings in `AdminPortal.jsx`.

## Notes

No EA trading logic was changed in this pass, so no MQ5 compile or EX5 artifact was generated.
