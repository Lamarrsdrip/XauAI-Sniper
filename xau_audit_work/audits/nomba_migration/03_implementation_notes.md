# Nomba Payment Migration — Phase 3-9 Implementation Notes

## Files created

- `backend/payment_crypto.py` — AES-256-GCM encryption for payment secrets
- `backend/nomba_service.py` — OAuth, checkout creation, verification, webhook signature
- `backend/migrations/0002_add_payment_provider_field.py` — additive `provider` backfill
- `backend/.env.example` — full environment variable reference (none existed before)
- `backend/tests/test_nomba_payment_security.py` — 18 tests
- `audits/nomba_migration/*.md` — this audit trail

## Files modified

- `backend/server.py` — `NombaConfigUpdate` model, `payment_nomba_config` collection +
  helpers, `/purchase/price`, `/purchase/initialize`, `/purchase/verify/{reference}`,
  new `_fulfill_nomba_payment()`, new `POST /webhook/nomba`, new
  `GET/PUT /admin/settings/nomba`, `POST /admin/settings/nomba/test-connection`,
  `GET /admin/settings/nomba/audit-log`
- `frontend/src/components/PurchaseSection.jsx` — Nomba branding, payment-unavailable state
- `frontend/src/components/PurchaseSuccessPage.jsx` — reads `orderReference` callback param
- `frontend/src/components/AdminPortal.jsx` — new `NombaSettingsSection`, Paystack card
  relabeled legacy
- `backend/tests/test_paystack_payment_security.py` — removed one test whose subject
  (`initialize_purchase` calling Paystack) no longer exists; replacement coverage lives
  in the new Nomba suite

## Database schema

**New collection `payment_nomba_config`** (single document, `key: "main"`):
```
{
  key: "main", enabled: bool, environment: "sandbox"|"production",
  sandbox: { client_id_enc, client_secret_enc, account_id_enc,
             webhook_signature_key_enc,  # each {v, n, ct} -- AES-256-GCM
             last_validated_at, last_validation_ok, last_validation_error },
  production: { ...same shape... },
  allowed_payment_methods: [...], currency: "NGN", payment_description: "...",
}
```

**New collection `payment_config_audit_log`**: one row per admin config change or
test-connection attempt — `admin_email`, `changed_fields` (names only, never values),
`environment`, `test_connection_passed`, `at`. Never contains a secret value.

**`payment_transactions`** — 3 new fields on NOMBA-provider rows: `provider`,
`nomba_order_reference` (same value as `reference` — kept as a named field for
readability/future-proofing against the two ever diverging), `nomba_transaction_id`
(populated on fulfilment). Existing Paystack rows unaffected; migration 0002 backfills
`provider: "PAYSTACK"` onto them non-destructively.

**`pin_licenses`** — 1 new field: `provider`. Also gains `review_required`/
`review_reason` when a `payment_reversal` webhook arrives for a license that was
already issued (see Phase 13 below) — additive, never removes or alters existing
fields.

**Status values in use**: keeps the existing state-machine vocabulary already proven
by the Paystack path (`PENDING`, `VERIFYING`, `PAID`, `FULFILLING`, `FULFILLED`,
`REJECTED_AMOUNT_MISMATCH`) rather than introducing the owner's spec's suggested enum
(`PENDING/PROCESSING/SUCCESS/...`) as a second, parallel vocabulary — extended with
`FAILED` (payment_failed webhook) and `REVERSED` (payment_reversal webhook). Decision:
consistency with the already-working Paystack state machine outweighed matching the
spec's suggested names literally, since introducing two different status vocabularies
across providers in the same collection would be a real footgun for anything that
reads `payment_status` later (reporting, admin UI, support tooling).

## Encryption

`backend/payment_crypto.py`, not the existing MFA Fernet system (`server.py`'s
`_cloud_encrypt`/`_cloud_decrypt`) — see that module's own docstring and
`01_paystack_audit.md`'s security-observations section for the full reasoning: the
existing system derives its key from `JWT_SECRET` (shared with session tokens) and has
no key-versioning; payment credentials get a dedicated `PAYMENT_CONFIG_ENCRYPTION_KEY`
and key-version support instead. Uses `cryptography.hazmat.primitives.ciphers.aead.AESGCM`
(already a project dependency) — verified round-trip and tamper-detection with a
throwaway key, not just read for correctness.

## Idempotency / concurrency

`_fulfill_nomba_payment()` deliberately mirrors `_fulfill_payment()`'s exact structure
(same `_transition_payment_state()` helper, same unique-index-on-`payment_ref`
defense-in-depth) rather than inventing a second pattern. Verified with a real
`asyncio.gather()` concurrency test (webhook and poll calling fulfilment
simultaneously) producing exactly one PIN, not simulated/assumed.

## Webhook security

Signature verified before the body is trusted for anything beyond routing (which
transaction to look up). A real, non-obvious finding from writing the test suite:
`data.order.amount` is **not** one of the fields Nomba's signature formula covers, so
a forged amount in a webhook body would not by itself fail signature verification —
this is not a vulnerability here specifically because the webhook handler never reads
or trusts `order.amount` at all, only `orderReference` (for lookup), and fulfilment
always uses the amount from an independent `verify_transaction()` call. Covered by
`test_webhook_tampered_amount_not_caught_by_signature_but_still_safe`.

## What still requires the owner's own action

- Entering real Nomba sandbox/production credentials through the Admin Dashboard
  (never through this session, per the spec's own explicit instruction).
- Setting `PAYMENT_CONFIG_ENCRYPTION_KEY` in the actual deployment environment (Vercel
  project settings or wherever the backend actually runs).
- Configuring the webhook URL + signature key on Nomba's own dashboard (Developer →
  Webhook Setup) to point at `{PUBLIC_SITE_URL}/api/webhook/nomba`.
- Running an actual sandbox end-to-end payment (this session verified every component
  with mocks/unit tests against real API contracts, but did not — and could not,
  without live credentials — complete a real sandbox checkout against Nomba's servers).
- Running migration 0002 against the real production database (dry-run first, as
  documented in the script's own header) once ready to cut over.
