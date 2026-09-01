# XauCloud Admin Gateway v2

The GPT-facing API is intentionally capped at 29 operations. Detailed backend operations remain implemented as internal XauCloud services/routes and are selected through strict allowlisted `operation` enums.

## Safety model

- Dedicated existing GPT Action Bearer secret remains unchanged.
- No raw database, shell, filesystem, arbitrary HTTP proxy or arbitrary code tools.
- Read actions execute immediately.
- Draft actions create non-consequential drafts only.
- Consequential actions require prepare -> short-lived confirmation token -> explicit owner approval -> execute with stable idempotency key.
- Audit records are written through the existing admin action audit system.
- Unsupported capabilities return `available: false`/an unavailable reason instead of simulated success.

## Intentionally unavailable

- Automated refunds: the checked backend does not expose a verified payment-provider refund primitive.
- User verification/password-reset/session revocation: no token-safe canonical admin workflow is exposed by the current backend; session JWTs are not persisted for server-side revocation.
- Automated release promotion/rollback: release artifacts and diagnostics exist, but there is no verified production promotion/rollback primitive safe for GPT execution.
- Generic transactional delivery replay: email logs do not always retain a canonical replayable transactional payload, so arbitrary retry is intentionally blocked.

## Final schema

`backend_node/docs/xaucloud-admin-actions.openapi.yaml`
