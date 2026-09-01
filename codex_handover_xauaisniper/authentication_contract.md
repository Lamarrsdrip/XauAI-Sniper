# Authentication Contract

- Browser customer and admin: HttpOnly cookie only; no response JWT or localStorage bearer fallback.
- EA/license traffic: `_resolve_monitor_license` validates active license, supplied account and binding. Missing/invalid credentials fail; cross-account binding fails.
- Required EA fields by repaired route:
  - AI analysis/position: `pin`, `account_id`.
  - memory/feedback: `pin`, account identity.
  - journal: `pin`, account login.
  - weekly report: `pin`, `account_id`.
  - ML patterns: `pin`, `account_id`.
  - reservation: `pin`, broker server, account, symbol, execution key.
- New stored documents remove PIN and store resolved `license_id` where repaired. Historical PIN fallback remains only for legacy lookup compatibility.
- Both Gold EA copies and both XauIndex EA copies were updated and compile 0/0.
- Remaining: full internal-worker/scheduler sweep; full route integration; verify no legitimate final EA request receives 401/403.
