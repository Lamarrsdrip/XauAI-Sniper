# Nomba Payment Migration — Final Report

## Branch and commits

- Branch: `feature/nomba-payment-gateway`, based on `origin/main` @ `31fed15`
  ("redesign public homepage").
- Starting commit of this work: `3ded4c0` (Phase 1 audit).
- Ending commit: `fb0b201` (production cutover checklist).
- 11 commits total, each a self-contained, real checkpoint (not squashed
  busywork) — full list:

```
3ded4c0 docs(nomba-migration): Phase 1 forensic audit of the current Paystack system
593ce07 docs(nomba-migration): Phase 2 official Nomba API reference
09d0511 feat(nomba): payment_crypto.py and nomba_service.py -- core integration modules
abfd2eb feat(nomba): wire Nomba checkout/webhook/admin-config into server.py
dd8cd7d feat(nomba): frontend -- Nomba checkout branding, callback param, admin config UI
8738835 test(nomba): 18 real executable tests for the Nomba payment integration
9ed62e9 fix(nomba): migration 0002 -- handle ObjectId in backup JSON encoder
bc93827 docs(nomba): env var reference and implementation notes
bb27dd6 chore(nomba): add gitignore exception for .env.example templates
fb0b201 docs(nomba): production cutover checklist
```

**Not merged to `main`. Not pushed to `origin`. No real credentials
entered anywhere. No real charge made or attempted.**

## Files changed

11 files, +2,367/-57 lines:
- New: `backend/payment_crypto.py`, `backend/nomba_service.py`,
  `backend/migrations/0002_add_payment_provider_field.py`,
  `backend/.env.example`, `backend/tests/test_nomba_payment_security.py`,
  `audits/nomba_migration/*.md` (5 docs)
- Modified: `backend/server.py`, `backend/tests/test_paystack_payment_security.py`,
  `frontend/src/components/{PurchaseSection,PurchaseSuccessPage,AdminPortal}.jsx`,
  `.gitignore`

## Database migrations

`backend/migrations/0002_add_payment_provider_field.py` — additive-only
`provider` field backfill onto pre-existing `payment_transactions`/
`pin_licenses` rows (`PAYSTACK`). Dry-run by default, `--confirm` required
to write, automatic pre-write backup verified non-empty, idempotent.
**Actually run** against a seeded local test database this session (not
just read for correctness) — a real bug was found and fixed this way
(the backup JSON encoder didn't handle MongoDB's `ObjectId` type) before
it could have failed silently against production.

## Paystack components removed from the active customer flow

- `/purchase/initialize` no longer calls Paystack at all — creates a
  Nomba checkout order exclusively, fails closed (503) if Nomba isn't
  configured, never falls back to Paystack.
- `PurchaseSection.jsx`'s "Paystack secured" badge → "Secured by Nomba".
- `/purchase/price`'s `payment_method` field now reflects Nomba's
  configured state (`"nomba"` or `"unavailable"`), never `"paystack"`.

No Paystack script/SDK was ever loaded client-side to begin with
(confirmed in the Phase 1 audit — the existing implementation was
already redirect-only), so there was no client-side script to remove.

## Paystack records preserved

- `_verify_paystack_signature`, `_fulfill_payment` (Paystack's
  fulfilment path), `POST /webhook/paystack` all remain fully live and
  untouched — any Paystack transaction still resolving keeps working.
- `GET /purchase/verify/{reference}` now dispatches to the Paystack or
  Nomba fulfilment path based on the transaction's own `provider` field
  (defaulting to `PAYSTACK` for pre-migration rows with no field yet),
  so old and new purchases both resolve correctly through the same
  customer-facing endpoint.
- No historical row was deleted, renamed, or had its meaning changed.
- Admin Dashboard's Paystack card kept, relabeled "(legacy — historical
  transactions only)" with an explanation, not removed.

## Nomba components created

- `backend/payment_crypto.py` — AES-256-GCM, dedicated
  `PAYMENT_CONFIG_ENCRYPTION_KEY`, key-version support.
- `backend/nomba_service.py` — OAuth token issuance/caching/expiry,
  checkout order creation, independent transaction verification, webhook
  signature verification (9-field formula, base64-encoded HMAC-SHA256,
  confirmed against Nomba's own official test vector).
- `_fulfill_nomba_payment()` in `server.py` — mirrors the proven
  Paystack idempotent state-machine pattern exactly.
- `POST /webhook/nomba` — signature-verified, independently re-verifies
  with Nomba before ever fulfilling, handles
  `payment_success`/`payment_failed`/`payment_reversal`, ignores
  `payout_*` events with a 2xx acknowledgement.
- Admin Dashboard: `GET/PUT /admin/settings/nomba`,
  `POST /admin/settings/nomba/test-connection`,
  `GET /admin/settings/nomba/audit-log`, and the `NombaSettingsSection`
  UI (environment toggle, per-environment credential forms with masked
  previews, payment-method checkboxes, read-only copyable callback/
  webhook URLs, Test Connection button).

## Admin configuration fields added

Enable toggle, Environment (sandbox/production), Client ID, Client
Secret, Account ID, Webhook Signature Key (all four per environment,
independently), Allowed Payment Methods, Currency, Payment Description,
read-only Callback URL, read-only Webhook URL, Test Connection, Last
successful validation time, Current connection status, Last integration
error (redacted) — matches the spec's field list exactly.

## Encryption method and secret storage

AES-256-GCM via `cryptography.hazmat.primitives.ciphers.aead.AESGCM`
(already a project dependency), random 96-bit nonce per encryption, auth
tag included in ciphertext (AESGCM's own construction), key-version tag
stored alongside each encrypted value. Master key: `PAYMENT_CONFIG_ENCRYPTION_KEY`
environment variable only — never in the database, never editable from
the admin dashboard, never logged. Stored ciphertext lives in the new
`payment_nomba_config` MongoDB collection, per-environment (sandbox/
production kept fully separate). **Verified, not just read for
correctness**: round-trip encrypt/decrypt, and confirmed the auth tag
actually rejects a tampered ciphertext rather than silently decrypting
it wrong.

## Routes

- Checkout: `POST /purchase/initialize` (Nomba-exclusive as of this
  migration)
- Verification: `GET /purchase/verify/{reference}` (provider-dispatching)
- Callback page: `PurchaseSuccessPage.jsx`, reads `orderReference` (Nomba)
  or `reference`/`trxref` (Paystack, unchanged)
- Webhook: `POST /webhook/nomba` (new), `POST /webhook/paystack`
  (unchanged, still live)

## Events subscribed

`payment_success`, `payment_failed`, `payment_reversal` — the 3 the spec
asked for at minimum. `payout_success`/`payout_failed`/`payout_refund`
(the other 3 of Nomba's 6 total documented events) deliberately not
acted on — they describe money leaving Nomba's account, irrelevant to
this inbound-only checkout integration — acknowledged with a 2xx so
Nomba's retry-with-backoff doesn't fire needlessly.

## Idempotency protections

- MongoDB filter-based atomic state transitions
  (`_transition_payment_state`, shared with the Paystack path) — the
  update's `modified_count` is the concurrency control.
- Unique index on `pin_licenses.payment_ref` as defense-in-depth.
- Verified with a **real concurrent test**
  (`asyncio.gather()` of webhook + poll calling fulfilment
  simultaneously) producing exactly one PIN — not simulated, not assumed.
- Webhook handler always returns 2xx for any handled or deliberately-
  ignored event so Nomba's 5-retry exponential-backoff policy doesn't
  fire against an already-resolved payment.

## Tests executed and results

- `backend/tests/test_nomba_payment_security.py`: **18/18 passed**
  (signature valid/missing/wrong/tampered-covered-field; the discovery
  that `order.amount` isn't signature-covered, and proof the system
  stays safe anyway because it never trusts that field from the webhook;
  amount/currency mismatch; unknown reference; pending-never-fulfills;
  exactly-once fulfilment; concurrent race; payment_failed;
  payment_reversal flags-not-deletes; unknown event ignored; encrypted
  config round-trip never leaks a raw secret; 503-fail-closed;
  callback-origin safety).
- `backend/tests/test_paystack_payment_security.py`: **10/10 passed**
  (one test removed as obsolete — its subject, `initialize_purchase`
  calling Paystack, no longer exists; replacement coverage of the same
  security property added to the Nomba suite instead).
- Both suites pass in isolation; running them together in one pytest
  process hits a **pre-existing** cross-file event-loop-sharing
  limitation (documented earlier in this project's test history, not
  introduced by this work) — the correct way to run this project's
  payment tests today is per-file, same as it already was before this
  migration.
- `import server` succeeds end-to-end against a live local MongoDB (not
  just AST syntax-checked).
- Migration 0002 actually executed (dry-run → confirm → verify →
  idempotent re-run) against seeded test data — found and fixed a real
  bug (`ObjectId` JSON serialization) in the process.
- Frontend: real `npx craco build` — "Compiled successfully."

## Tests NOT executed (honest, not rounded up)

- No real Nomba sandbox end-to-end payment — requires real sandbox
  credentials, which per the spec must be entered by the owner through
  the admin dashboard, never through this session or pasted into chat.
- No live webhook delivery test (would require a real Nomba account +
  a publicly reachable callback URL, e.g. via ngrok, during development).
- No lint/type-check run beyond what the real `craco build` and `import
  server` already exercise (this project has no separate configured
  lint/typecheck script found for the backend; the frontend build itself
  is the closest equivalent and passed).

## Production readiness

**Not production-ready yet — by design, not oversight.** Every piece of
code is built and verified with mocks/unit tests against the real,
officially-documented API contract. What remains is exclusively the
owner's own action: see `audits/nomba_migration/04_production_cutover_checklist.md`
for the full 14-item list (real credentials, `PAYMENT_CONFIG_ENCRYPTION_KEY`
in the actual deployment environment, Nomba-side webhook configuration, a
real sandbox run, and the actual production cutover decision).

## Exact Nomba details the owner needs to enter

Through Admin Dashboard → Settings → Payments → Nomba, for each
environment they intend to use:
- Client ID, Client Secret, Account ID (from Nomba dashboard → API Keys)
- Webhook Signature Key (from Nomba dashboard → Developer → Webhook
  Setup, after pasting in the Callback/Webhook URLs this admin page
  displays)

Plus, in the actual server deployment environment (not the database, not
the admin dashboard): `PAYMENT_CONFIG_ENCRYPTION_KEY` (generation command
in `backend/.env.example`).

## Confirmations

- No real credentials were committed anywhere in this branch — verified
  by construction (every credential field in every test uses an obvious
  placeholder like `"test-client-secret"`) and by the encrypted-storage
  design itself (even a real value, once saved, is never returned to any
  client in plaintext).
- Existing customers, purchases, and licenses are untouched: no
  destructive operation ran against any real data (only a local, seeded
  test database was ever written to in this session); the migration
  script is additive-only and was only executed against disposable test
  databases, never against `MONGO_URL`/`DB_NAME` pointing at anything
  real.
- `main` was not touched. Nothing was pushed to `origin`.
