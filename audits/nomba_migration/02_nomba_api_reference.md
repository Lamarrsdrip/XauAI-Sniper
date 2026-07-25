# Nomba Payment Migration — Phase 2 Official API Reference

Sourced directly from `developer.nomba.com` (fetched live, not from memory or
third-party tutorials). Two dead links were found and are noted; everything
else below was confirmed on the live site.

## Base URLs

| Environment | Base URL | Checkout path prefix |
|---|---|---|
| Production | `https://api.nomba.com` | `/v1/checkout/` |
| Sandbox | `https://sandbox.nomba.com` | `/sandbox/checkout/` |

Sandbox and production use **different path prefixes for checkout
endpoints**, not just a different host — `/sandbox/checkout/order` vs.
`/v1/checkout/order`. Mixing sandbox credentials with the production host
(or vice versa) causes authentication errors. The environment selector
in the admin config must switch both the host AND this prefix together.

## 1. Access token (OAuth2 client-credentials)

```
POST {base}/v1/auth/token/issue
Headers: accountId: <accountId>, Content-Type: application/json
Body: {"grant_type": "client_credentials", "client_id": "<clientId>", "client_secret": "<clientSecret>"}

Response 200:
{"code": "00", "description": "Success",
 "data": {"access_token": "<JWT>", "refresh_token": "<token>", "expiresAt": "<ISO-8601 UTC>"}}
```

- `expiresAt` is the expiry timestamp — cache the token and re-issue when
  within a safety margin of expiry (e.g. 60s early) rather than on every
  request.
- Sandbox tokens are explicitly documented as short-lived; a 401 mid-test
  means re-issue.
- A `refresh_token` is returned but a dedicated refresh endpoint also
  exists (`/nomba-api-reference/authenticate/refresh-an-expired-token`,
  not yet fetched in detail) — simplest safe approach is re-issuing via
  client-credentials on expiry rather than depending on refresh-token
  semantics we haven't fully verified.

## 2. Create checkout order

```
POST {base}{checkout_prefix}order
Headers: Authorization: Bearer <access_token>, accountId: <accountId>, Content-Type: application/json
Body:
{
  "order": {
    "orderReference": "<our internal UUID, recommended — Nomba generates one if omitted>",
    "amount": "10000.00",          // STRING, not number
    "currency": "NGN",              // NGN default; also CDF/USD/EUR/GBP
    "callbackUrl": "https://.../purchase/success",  // orderReference appended as query param on redirect
    "customerEmail": "buyer@example.com",
    "customerId": "<optional internal id>",
    "allowedPaymentMethods": ["card", "transfer", "ussd", "qr"]  // optional, restricts visible methods
  }
}

Response 200:
{"code": "00", "description": "Success",
 "data": {"checkoutLink": "https://checkout.nomba.com/pay/...", "orderReference": "..."}}
```

- **`amount` is a string**, e.g. `"10000.00"` — not a JSON number. This
  matters for exact serialization.
- Supports an `X-Idempotent-key` request header (any unique-per-attempt
  UUID) to prevent duplicate order creation on client retry — should be
  set on every checkout-order-creation call.
- Orders are stored 48h in sandbox before expiring (production retention
  not explicitly stated — assume longer, verify empirically before
  relying on it).

## 3. Verify transaction (the authoritative confirmation step)

Two documented endpoints; the checkout-specific one is what this
migration should use since it directly matches the checkout order model:

```
GET {base}{checkout_prefix}transaction?idType=orderReference&id=<orderReference>
Headers: Authorization: Bearer <access_token>, accountId: <accountId>

Response 200 (sandbox example, production shape should match):
{
  "code": "00", "description": "Success",
  "data": {
    "success": true, "message": "PAYMENT SUCCESSFUL",
    "order": {
      "orderId": "...", "orderReference": "test-order-001",
      "amount": "4000.00", "currency": "NGN", "customerEmail": "..."
    },
    "transactionDetails": {
      "transactionDate": "...", "paymentReference": "WEB-ONLINE_C-...",
      "statusCode": "PAYMENT SUCCESSFUL", "tokenizedCardPayment": "false"
    },
    "cardDetails": {"cardPan": "...", "cardType": "MASTERCARD", "cardCurrency": "NGN"}
  }
}
```

Sandbox path: `GET /sandbox/checkout/transaction?idType=orderReference&id=...`
(lowercase `idType` value). Production docs elsewhere show
`idType=ORDER_REFERENCE` (uppercase) on a related endpoint
(`/v1/checkout/transaction`) — **the exact accepted casing needs
confirming empirically against production/sandbox during Phase 16
testing**; the integration should try the documented sandbox casing first
since that's the one with a full worked example, and this is flagged as
an open verification item rather than assumed.

A second, more general endpoint also exists:
`GET /v1/transactions/accounts/single?orderReference=<ref>` (or
`transactionRef=<id>`), returning `data.status: "SUCCESS"|...`,
`data.amount`, `data.currency`, `data.onlineCheckoutOrderReference`. Keep
as a documented fallback if the checkout-specific endpoint behaves
unexpectedly in practice.

**Order-not-found simulation (sandbox):** `orderReference: "1234567890"`
returns 404 on all endpoints — useful for the "unknown transaction" test
case in Phase 16.

## 4. Webhooks

**Configured in the Nomba dashboard** (Developer → Webhook Setup), not
via API — the admin enters the webhook URL and signature key there
directly on Nomba's side, separately from whatever gets entered in
XauCloud's own admin config for calling Nomba. Two live/test webhook
URL+key pairs can be set.

### Events (6 total; spec requires payment_success/failed/reversal at minimum — all 6 exist)

| Event | Meaning |
|---|---|
| `payment_success` | Payment credited (card, virtual account, transfer) |
| `payout_success` | Funds debited (transfer, bill payment) — not relevant to XauCloud's inbound-only flow |
| `payment_failed` | Payment attempt failed |
| `payment_reversal` | Payment reversed back to customer |
| `payout_failed` | Payout failed — not relevant here |
| `payout_refund` | Payout refunded — not relevant here |

Subscribe to `payment_success`, `payment_failed`, `payment_reversal` only
— the payout_* events describe money leaving Nomba's account (irrelevant
to a checkout-only integration).

### Headers on every webhook request

```
nomba-signature: <base64 HMAC-SHA256>
nomba-sig-value: <same value, appears duplicated under a second header name>
nomba-signature-algorithm: HmacSHA256      (always this value)
nomba-signature-version: 1.0.0
nomba-timestamp: <RFC-3339 UTC, e.g. 2023-03-31T05:56:47Z>
```

Headers are case-insensitive per Nomba's own docs — read them
case-insensitively (standard for any HTTP framework, but stated
explicitly by Nomba too).

### Signature verification — exact formula (confirmed against official Go code sample)

```
hashing_payload = ":".join([
    event_type,
    requestId,
    data.merchant.userId,
    data.merchant.get("walletId", ""),        # ABSENT on checkout payloads — see below
    data.transaction.transactionId,
    data.transaction.type,
    data.transaction.time,
    data.transaction.get("responseCode", ""), # ABSENT on checkout payloads — see below
    nomba_timestamp_header_value,
])
signature = base64.b64encode(hmac.new(secret.encode(), hashing_payload.encode(), hashlib.sha256).digest())
# compare against the nomba-signature header value, constant-time
```

**Important field-presence nuance found by comparing two official
examples:** the generic (virtual-account-transfer) sample payload has
`merchant.walletId` and `transaction.responseCode`; the **checkout-
specific** `payment_success` sample payload (below) does **not** have
either field. The official Go sample code itself normalizes a `"null"`
string value to `""` for `responseCode`, confirming the intended
behavior is: missing/null fields become empty string in the hash input,
not omitted from the colon-separated template (i.e., the template always
has 9 colon-separated segments; a missing field is an empty segment, not
a shorter string). This must be implemented exactly this way or every
checkout webhook's signature will fail to verify.

### Checkout-specific `payment_success` webhook payload (real example, sandbox)

```json
{
  "event_type": "payment_success",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {
    "merchant": { "userId": "<accountId>" },
    "transaction": {
      "fee": 0.28,
      "type": "online_checkout",
      "transactionId": "WEB-ONLINE_C-abc123-550e4c3a-0af4-4887-a089-xxxx",
      "merchantTxRef": "txref-1743379200",
      "transactionAmount": 4000.00,
      "time": "2026-03-31T10:00:00Z"
    },
    "order": {
      "amount": 4000.00,
      "orderId": "a1b2c3d4-e5f6-47a8-xxxx-xxxxxxxxxxxx",
      "accountId": "<accountId>",
      "customerEmail": "test@example.com",
      "orderReference": "test-order-001",
      "paymentMethod": "card_payment",
      "currency": "NGN"
    }
  }
}
```

This is the payload shape the webhook handler should parse:
`data.order.orderReference` is our internal correlation key back to
`payment_transactions.reference`; `data.transaction.transactionId` is the
Nomba-side transaction reference to store and use for the independent
verify call.

### Webhook delivery behavior

- **Sandbox fires synchronously** immediately after payment confirmation
  (OTP approval for cards). **Production uses queued delivery** — expect
  more latency and out-of-order arrival relative to the browser's own
  callback redirect in production; the poll-based `/purchase/verify`
  path (same pattern as the existing Paystack flow) remains essential,
  not just a webhook-is-enough assumption.
- **Retries:** on any non-2XX response, up to 5 retries with exponential
  backoff (2min, ~5min, ~11min, 24min, ~53min). The webhook handler must
  return 2XX promptly once it has done its job (even if that job is "this
  is a duplicate, already fulfilled, no-op") — an accidental 4XX/5XX on
  a duplicate delivery would trigger unnecessary retries for an hour.
- **Idempotency key** (`X-Idempotent-key` header) is documented for
  *outbound* requests we make to Nomba (e.g. checkout-order creation),
  not for inbound webhooks — inbound webhook idempotency is our own
  responsibility (the existing `_transition_payment_state` /
  unique-index pattern from the Paystack flow, reused).

## 5. Sandbox test cards (for Phase 16 sandbox testing)

| Card number | Network | Outcome |
|---|---|---|
| `5434621074252808` | Mastercard | OTP required → submit OTP `9999` for approval, `1234` for timeout, `5464` for invalid-OTP |
| `4000000000002503` | Visa | 3DS authentication required |
| `5484497218317651` | Mastercard | Declined ("do not honor") — no further steps |

Card PIN in sandbox: `1234`. CVV/expiry are not validated in sandbox —
only the card number determines the outcome. `orderReference:
"1234567890"` simulates a 404 "order not found" on all endpoints.
Refund testing: `transactionId:
WEB-ONLINE_C-97922-db88d4c3-a0af-4887-a089-b5d2e51b8f19` always returns
`code: "400"` to simulate a failed refund.

## Two dead links found during this research (noted, not relied on)

- `https://developer.nomba.com/products/webhooks/signature-verification-new`
  — confirmed 404 both via WebFetch and live browser navigation.
- `https://developer.nomba.com/docs/products/webhooks/signature-verification`
  — also 404.

The actual signature-verification content (with full working code
samples in 6 languages) lives at
`https://developer.nomba.com/docs/api-basics/webhook` instead — used as
the source for section 4 above.

## Open items to verify empirically during Phase 16 (sandbox testing), not assumed

1. Exact accepted casing of the `idType` query parameter
   (`orderReference` vs `ORDER_REFERENCE`) on the checkout-transaction
   verify endpoint.
2. Whether `nomba-signature` and `nomba-sig-value` are always identical
   (docs show them identical in the one example available) — verify
   before deciding whether checking one is sufficient or both should be
   cross-checked.
3. Production webhook delivery latency relative to the browser callback
   redirect, to tune the poll-retry window on `PurchaseSuccessPage`.
