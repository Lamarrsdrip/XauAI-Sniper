# Nomba Payment Migration — Phase 1 Forensic Audit of the Current Paystack System

Branch: `feature/nomba-payment-gateway`, based on `origin/main` @ `31fed15`.

## Complete current flow, traced end to end

```
Customer (PurchaseSection.jsx)
  → fills name + email, clicks "Pay ₦X Now"
  → POST /api/purchase/initialize {buyer_name, buyer_email, origin_url}
      server.py:851 initialize_purchase()
      - rate-limited 10 req/10min per IP
      - reads paystack_secret_key + pin_price_kobo from admin_settings (DB)
      - generates internal reference: "ASE-" + uuid4hex[:12].upper()
        (already provider-agnostic — NOT a Paystack-issued reference)
      - callback_url built ONLY from server-controlled PUBLIC_SITE_URL,
        never from client-supplied origin_url (fixed for a prior open-
        redirect bug, per the code's own comment — this pattern must be
        preserved for Nomba too)
      - inserts payment_transactions doc: {id, reference, amount_kobo,
        currency, buyer_name, buyer_email, payment_status: "PENDING",
        pin_generated: null, created_at, state_transitions: {}}
      - POSTs to Paystack /transaction/initialize, gets back
        authorization_url
  → browser redirects to authorization_url (Paystack-hosted checkout)
  → customer pays on Paystack's site
  → Paystack redirects browser to {PUBLIC_SITE_URL}/purchase/success?reference=ASE-...
      (PurchaseSuccessPage.jsx — no Paystack SDK/script is loaded
      client-side anywhere in this app; it's redirect-only, not inline/
      popup checkout)
  → page polls GET /api/purchase/verify/{reference} every 2.5s (up to 12x)
      server.py:1003 verify_purchase() → _fulfill_payment(ref, source="poll")
  → Paystack ALSO independently POSTs webhook to /api/webhook/paystack
      server.py:1016 paystack_webhook()
      - verifies HMAC-SHA512 signature over the RAW body first (401 if
        invalid), only then parses JSON
      - calls _fulfill_payment(ref, source="webhook")
```

## The authoritative confirmation step — `_fulfill_payment()` (server.py:908-1000)

This is the single canonical fulfilment path, called identically by both
the webhook and the browser's poll — **this is the pattern to replicate
for Nomba, not reinvent**:

1. Atomic state transition `PENDING → VERIFYING` via a MongoDB filter
   (`{reference, payment_status: {"$in": from_states}}`) — the update's
   `modified_count` IS the concurrency control. Whichever caller (webhook
   vs. poll) actually flips the state wins; the loser re-reads and returns
   `pending` rather than double-processing. This is real, working
   idempotency infrastructure already in production.
2. Calls Paystack's own `GET /transaction/verify/{reference}` directly —
   **never trusts the webhook body's claims alone**, even after a valid
   signature.
3. Cross-checks the real paid `amount`/`currency` against what the
   transaction record expects — rejects on mismatch
   (`REJECTED_AMOUNT_MISMATCH`), does not just trust Paystack's
   `status: success` label alone.
4. Atomic `VERIFYING → PAID → FULFILLING` transitions, same
   filter-based concurrency control.
5. Generates a PIN (`ASE-XXXX-XXXX` format, `generate_unique_pin()`),
   retries on collision, and additionally relies on a **unique index on
   `pin_licenses.payment_ref`** as defense-in-depth — if the state
   machine somehow let two callers both reach PIN creation, the DB
   constraint catches it and the loser re-reads the winner's PIN instead
   of erroring.
6. Sets `payment_status: "FULFILLED"`, sends the PIN email
   (`send_pin_email`), logs `PAYSTACK_FULFILLED`.

**This means the Nomba integration should generalize `_fulfill_payment`
to be provider-aware (or add a parallel `_fulfill_nomba_payment` that
shares the same state-machine/idempotency helpers), not build a separate
ad hoc fulfilment path.** The state machine, the unique-index
defense-in-depth, and the webhook-vs-poll race handling are all already
correct and should be reused, not rewritten.

## Complete file inventory

| File | Role |
|---|---|
| `backend/server.py:126` | `PAYSTACK_BASE_URL = "https://api.paystack.co"` |
| `backend/server.py:133` | `PUBLIC_SITE_URL` — used for callback_url construction (reuse for Nomba) |
| `backend/server.py:468-480` | `PinLicense` model — has `payment_ref`, **no `provider` field yet** |
| `backend/server.py:497-501` | `AdminSettingsUpdate` — `paystack_secret_key` etc, **stored plaintext in DB** |
| `backend/server.py:570-572` | `generate_unique_pin()` — provider-agnostic already |
| `backend/server.py:574-580` | `get_settings()` — single `admin_settings` doc, `key: "main"` |
| `backend/server.py:844-849` | `GET /purchase/price` — returns `payment_method: "paystack"` literal string |
| `backend/server.py:851-875` | `POST /purchase/initialize` — creates pending tx, calls Paystack init |
| `backend/server.py:878-887` | `_verify_paystack_signature()` — HMAC-SHA512 over raw body, constant-time compare |
| `backend/server.py:890-905` | `_transition_payment_state()` — the reusable state-machine helper |
| `backend/server.py:908-1000` | `_fulfill_payment()` — the canonical fulfilment path (see above) |
| `backend/server.py:1003-1013` | `GET /purchase/verify/{reference}` — browser polling endpoint |
| `backend/server.py:1016-1046` | `POST /webhook/paystack` — signature-verified webhook |
| `backend/server.py:1477-1494` | `GET /admin/settings` — already masks secrets in the response (`key_preview` pattern) |
| `backend/server.py:1532-1543` | `PUT /admin/settings` — writes plaintext to DB, no encryption, no audit log |
| `backend/server.py:393-409` | `get_current_admin()` — JWT cookie/bearer auth, `role == "admin"` check — reusable as-is |
| `backend/server.py:1866-1871` | `update_admin_account()` — existing "require `current_password`" fresh-auth pattern for sensitive changes, reusable for the Nomba production-credential gate |
| `frontend/src/components/PurchaseSection.jsx` | Buy button — redirect-only, **no Paystack SDK/script loaded client-side** |
| `frontend/src/components/PurchaseSuccessPage.jsx` | Callback/result page — already polls server-side verify, already has checking/success/error/timeout states, already doesn't trust URL params alone. Reads `?reference=` or `?trxref=` — Nomba's own callback param name needs confirming against official docs (Phase 2) and normalizing here if different. |
| `frontend/src/components/AdminPortal.jsx:565-583` | "Paystack configuration" card — masked-password-style input, model for the new Nomba card |
| `backend/tests/test_paystack_payment_security.py` | 346 lines — existing security test suite (signature verification, amount mismatch, idempotency); model for the Nomba test suite |
| `backend/migrations/0001_delete_copy_trading.py` | Existing migration pattern: dry-run by default, `--confirm` flag, automatic backup-before-change, idempotent, never guesses `MONGO_URL`/`DB_NAME` — the pattern to follow for the additive `provider` field migration |

Not relevant (excluded from scope): `audit/aligned-entry-repair/rollback/pre-change/*` (old rollback snapshots), `frontend/build/static/js/*` (compiled artifact, regenerated on build), `test_reports/iteration_*.json` (historical test-run artifacts), `design_guidelines.json` (styling only, spot-checked — no payment logic).

## Schema, current state

`payment_transactions` (no explicit Pydantic model — built as a raw dict):
`id, reference, amount_kobo, currency, buyer_name, buyer_email,
payment_status, pin_generated, created_at, state_transitions{}`. **No
`provider` field.** `payment_status` values in use today: `PENDING`,
`VERIFYING`, `PAID`, `FULFILLING`, `FULFILLED`, `REJECTED_AMOUNT_MISMATCH`
— not exactly the enum the owner's spec names (`PENDING/PROCESSING/
SUCCESS/FAILED/CANCELLED/REVERSED/REFUNDED/REVIEW_REQUIRED`), so Phase 4
needs to decide: map the existing values into the new enum, or add the
new enum as a second field. Recommendation in Phase 4 doc.

`pin_licenses` (Pydantic `PinLicense`, server.py:468): `id, pin,
buyer_name, buyer_email, is_active, is_used, activated_at, mt5_account,
created_at, notes, payment_ref`. **No `provider` field.** Unique index on
`payment_ref` already exists (relied on as defense-in-depth, confirmed
above).

`admin_settings` (single document, `key: "main"`): `paystack_secret_key,
pin_price_kobo, smtp_email, smtp_password, onesignal_app_id,
onesignal_api_key` — **all stored as plaintext strings in MongoDB, no
encryption.** This is a pre-existing gap, out of scope to retrofit for
Paystack/SMTP/OneSignal in this migration, but it means the Nomba fields
must NOT be added to this same plaintext pattern — the owner's spec
explicitly requires AES-256-GCM for Nomba credentials specifically, so
Nomba config needs its own encrypted storage, not a bolt-on to
`admin_settings`.

## Security observations found during this audit (not yet acted on)

1. **`admin_settings` secrets are plaintext in the DB.** Real gap,
   pre-existing, not introduced by Paystack — flagged here for the
   owner's awareness, not fixed as part of this migration (out of the
   stated scope, and touching the SMTP/OneSignal storage mechanism risks
   breaking working, unrelated features). The new Nomba config will use
   proper encryption from the start, per the spec.
2. The existing Paystack implementation is otherwise **genuinely well
   built** — signature verification, independent server-side
   verification, amount/currency cross-check, atomic idempotent state
   transitions, unique-index defense-in-depth. This is a strong
   reference architecture, not a system needing a rewrite.

## What "do not damage" concretely means here

- `pin_licenses` documents created by Paystack payments keep their
  `payment_ref` pointing at the Paystack reference and are never touched.
- `payment_transactions` documents stay as-is; only NEW documents (for
  Nomba attempts) get a `provider` field distinguishing them. Existing
  rows implicitly mean `provider: PAYSTACK` even without the field being
  backfilled (a migration can backfill it non-destructively — additive
  only, per the `0001_delete_copy_trading.py` safety pattern).
- `GET /purchase/price`'s `payment_method: "paystack"` literal needs to
  become provider-aware once Nomba is active, without breaking any
  caller that currently reads that field.

## Next step

Phase 2: read the official Nomba developer documentation (OAuth token
issuance, checkout order creation, webhook signature verification,
transaction verification endpoint, sandbox vs. production base URLs)
before writing any integration code, per the owner's explicit
instruction not to rely on assumptions.
