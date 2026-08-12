# XauCloud Admin Ops implementation notes

## Added

- Safe user/customer search and account status inspection.
- Controlled user disable/enable with prepare/confirmation/idempotency and audit.
- License search/status/history plus controlled activate/deactivate/transfer and license-email resend.
- Order/payment read tools and failed-payment inspection.
- Structured transactional template drafts, previews, versioned publish and rollback.
- Live transactional overrides are wired only to real flows that exist today: license delivery, bank-transfer instructions and bank-transfer rejection. Unsupported template names are reported as not currently wired instead of pretending they are live.
- Sanitized system readiness/database/integration/deployment diagnostics, in-process recent errors/warnings, request/correlation tracing and action audit.
- Historical replay metadata plus trade-by-trade replay access from the actual `data/gold_replay_current.json` dataset.
- EA release/bot instance read tools.
- Command Center health, aggregate dashboard/email analytics, website controlled-content reads, support-ticket reads/drafts where records exist, and notification-history reads.
- Account disable is enforced by both new logins and authenticated Command Center requests.

## Security model

No arbitrary MongoDB query language is accepted from GPT calls. No shell/filesystem/unrestricted HTTP tool exists. Secrets/password hashes/tokens/provider credentials are not returned. Consequential writes use short-lived single-use confirmation tokens and idempotency records. Every new Action request produces a sanitized audit record and response correlation ID.

## Intentionally not implemented

- Automatic refunds: the repository does not contain a safe canonical refund execution service. Adding a fake or ad-hoc provider call would be unsafe.
- Production EA rollout/rollback through GPT: the repository has release-manifest admin operations, but no complete deployment-orchestrator abstraction proving that an Action-triggered manifest change equals a safe production rollout. Read access is provided; existing manual/admin release workflow remains authoritative.
- Server-side session reset: Command Center uses signed JWT cookies and does not persist revocable sessions. The user tool reports this limitation instead of pretending sessions can be reset.
- None for account recovery: signup verification, verification resend, password reset, expiry and single-use tokens use the same canonical transactional delivery flow.
- Support reply send/assign/close: there is no canonical support ticket delivery workflow in this backend. Draft/read tooling is provided only when support records actually exist.
- Bounce/complaint/suppression provider APIs: current SMTP delivery does not expose a canonical provider webhook/data service for these reports.

## Deployment

No database migration runner is required. MongoDB collections/indexes are created idempotently by startup readiness step `admin_ops_actions`.
