# XauCloud Backend/API/DB/Security Audit (Phase 3)

Scope: `backend/server.py` and siblings on `release/xaucloud-final-production-audit`. Two
independent static audits were run (auth/session/tenant-isolation; injection/webhook/
licensing/DB-integrity), each verifying prior claims in `CODEX_HANDOVER_XAUAI_SNIPER.md`
section F against current code rather than trusting the document.

## Result summary

No critical or high-severity defect found. The backend's auth, tenant isolation, webhook
verification, licensing, and DB-integrity design are confirmed solid on static review, with
two real but lower-severity gaps logged below. All CODEX_HANDOVER section F claims were
independently re-verified against current code (not just repeated) and confirmed accurate,
with one nuance the doc didn't mention (XC-008).

## Findings register

| ID | Severity | Area | Root cause | Recommendation | Status |
|---|---:|---|---|---|---|
| XC-007 | Medium | Rate limiting (`backend/server.py:85-113`, `_rate_limit`) | The rate limiter protecting `/auth/login`, MFA, password reset, purchase init/verify, license-link, and command-request routes is a hand-rolled **in-memory, per-process** sliding window (self-disclosed at lines 90-92). It is correctly wired at every sensitive route (confirmed by both audits independently), but if the backend is ever deployed with multiple worker processes or horizontally scaled instances behind a load balancer, each instance keeps its own independent bucket — effective limits become `configured_limit × instance_count`, and all buckets reset on process restart. This directly matters for the owner's 10,000+-user scale requirement. | Not fixed in this pass — moving to a shared store (e.g. Redis) is an infrastructure/dependency decision that needs explicit owner approval, not a unilateral change. Flagged for Phase 8/9: confirm current and planned deployment topology (single instance vs. multi-worker) before deciding whether this is a release blocker. | Logged, not fixed — owner decision needed |
| XC-008 | Low | Auth (`get_current_admin` line 393-397, `get_cloud_user` line ~3829-3833) | Both auth dependency functions fall back to an `Authorization: Bearer` header if no cookie is present. Confirmed dead in practice — every login path (`_issue_admin_session`, `cloud_login`) only ever sets an HttpOnly cookie, never returns a raw token in the response body, and a frontend contract test (`frontend/src/forensic.contract.test.js:17-19`) already asserts no localStorage/Bearer usage exists client-side. This is unused attack-surface widening (relevant only if a future integration is built that sends bearer tokens), not an active vulnerability. | Recommend removing the header fallback in a future pass once confirmed no external integration (e.g. a mobile app, third-party API consumer) relies on it. Not removed in this pass to avoid an unreviewed behavior change to a security-adjacent code path without dedicated test coverage for that specific removal. | Logged, not applied |

## Confirmed clean (independently re-verified, not just re-stated from prior docs)

- **Cookie flags**: `httponly=True`, `samesite="strict"`, `secure` defaults `True` (must be
  explicitly disabled for local dev) at all 4 `set_cookie` call sites.
- **JWT_SECRET**: refuses to start in production without an explicit env var; only local/dev/test
  environments fall back to a persisted file secret.
- **Tenant isolation**: 10 spot-checked `/cloud/*` and `/admin/*` routes all scope by the
  authenticated user's own id/license; license-linking rejects claiming a license already owned by
  a different email; EA-facing routes use a separate but equally tenant-scoped PIN-to-account
  binding model.
- **IDOR**: only two path-param routes exist repo-wide; the public one uses unguessable 48-bit
  reference tokens; no customer-data route takes an unscoped id from a path param.
- **Password reset / MFA**: 30-minute single-use JWT (unique index on `jti`), anti-enumeration
  responses, TOTP-based MFA with a distinct pending-session JWT type and audit logging.
- **Paystack webhook**: HMAC-SHA512 signature verified before parsing; even after verification the
  payload is re-checked against Paystack's live verify API before minting a PIN; atomic
  filter-on-current-state updates prevent double-fulfillment races.
- **Licensing**: no hardcoded master PIN; PIN-to-MT5-account binding is atomic and fails closed on
  mismatch/inactive/missing.
- **DB integrity**: all money fields are integer kobo, never float; unique indexes present on
  email, payment reference, PIN, and license-payment-ref fields.
- **Download authorization**: legacy unauthenticated download routes are retired (410); current
  customer download requires an authenticated session with an active license and a short-lived
  scoped signed token; admin-master download requires `role == "admin"` via a distinct dependency
  from the customer path.
- **NoSQL injection / hardcoded secrets**: no `$where`/`eval`, no string-built Mongo filters, no
  literal secrets found in source.

## Explicitly unproven from static source alone

- Live Paystack webhook event delivery/verification (would require a real test transaction).
- Actual production deployment topology (single instance vs. multi-worker) — needed to assess
  whether XC-007 is a release blocker; carried to Phase 8 as a direct question for the user.
- Live environment-variable correctness (`COOKIE_SECURE`, `JWT_SECRET`, `ENVIRONMENT`) in the
  actual deployed environment — not visible from source.
