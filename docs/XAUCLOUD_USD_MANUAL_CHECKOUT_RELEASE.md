# XauCloud USD-first manual checkout — production release gate

Status: **manual-payment simplification candidate**. Source and automated checks are separate from production configuration and live delivery verification. The owner will test this change before deployment.

## What changes
- Marketing homepage: five meaningful sections (hero; genuine performance; preserved 30-day replay; how it works; 3-trading-market-day trial or single direct purchase).
- No new recurring weekly/monthly signal-plan orders. Historical signal subscriptions and existing account entitlements stay intact.
- USD base price stored as **integer cents** in `admin_settings.direct_usd_cents`. No price is seeded automatically.
- Nigeria: manual NGN bank transfer **and crypto**. Bank quotes use the admin-entered current USD/NGN rate and timestamp (24-hour rate freshness, 30-minute order validity). Money uses integer minor units. An explicitly disabled bank method remains disabled; an existing enabled beneficiary can be reused when the direct-checkout flag was never configured.
- Every other country: **crypto only**, using all valid USDT/USDC asset/network wallets already configured. The deprecated country allowlist does not restrict checkout. Bank requests from any non-Nigerian country are rejected on the server. Stablecoin quotes use the existing *nominal* 1 token = 1 USD policy and exclude network fees.
- Customer bank submission records the sender account name; crypto submission records the transaction hash. Receipt-image uploads are retired. These customer-submitted details are not proof of receipt. The owner verifies actual receipt in their bank account or wallet before clicking Approve.
- Pending Payments loads order and buyer details automatically. Approve and Reject require no additional fields. Approval uses an atomic state transition and reuses or generates the purchased license, links it to the customer, activates entitlements, and sends the official delivery email. Failed fulfillment provides a single retry action and records the error. Administrator authorization and audit logs remain mandatory.
- Old Paystack/Nomba and legacy NGN **new initiation routes return HTTP 410** in both Python and Node apps. Historical provider verification/webhooks, stored orders and licensed users are retained for outstanding settlement.

## Mandatory administrative configuration
1. Set a confirmed **one-time** official USD product price (not a guessed converted NGN price) at `/admin` → Direct Checkout. Independently confirm the associated licensing terms.
2. For Nigeria, use the existing Bank Transfers admin tab to configure and validate beneficiary name, actual bank name and account number. Enable the bank method there **and** Direct Checkout only after verifying ownership. Ensure the bank can receive deposits and that statements are accessible to authorized reviewers.
3. Independently verify a current USD/NGN rate. Supply the decimal rate through Direct Checkout, record the source/evidence in operational notes; it expires after 24 hours. The code does not fetch FX from an external provider automatically. The rate is **not** to be silently reused when stale. Refresh after independent verification.
4. Verify each existing receiving wallet and its supported asset/network pair in Direct Checkout. The configured pairs are selectable for Nigeria and all other countries; do not invent addresses or add unsupported integrations. Validate ownership before enabling production transfers.
5. Ensure admin MFA, permission reviews, rate limits, email sending, reconciliations, customer support and monitoring are operational. Audit screenshot handling/storage access and payment data retention.
6. Exercise one low-risk end-to-end bank sandbox/test ledger verification and one crypto transfer on each configured chain. Confirm proof submission **does not** mint a license, approval mints only one license and sends at most one automatic PIN message, rejection is communicated and duplicates are rejected.
7. Verify that quotes and purchase instructions fail safely for missing price, required bank/FX details, or the selected wallet. Validate stale rates and expired quotes. The public configuration reports a bank-unavailability reason code for diagnosis. Never silently refresh the timestamp of an unverified rate. Cross-check totals against the actual bank statement and wallet receipt.

## Historical payment and subscription migration
- Export/backup `payment_transactions`, `pin_licenses`, `signal_subscriptions`, `signal_trials`, `admin_settings` and relevant audit logs before release; do not mutate old amounts/currency or delete old webhook records.
- Reconcile in-flight Paystack/Nomba deposits **before** unregistering old dashboards/webhook endpoints. Contact providers to disable future charges/keys and review open refunds or settlements **after** all authorized financial reconciliation; deleting webhook endpoints ahead of settlement could strand customer payments.
- Inventory active recurring agreements. Prevent future opt-in to new weekly/monthly orders while preserving already-granted access; process any provider-side cancellation/renewal obligations through a separate authorized admin decision with customer notices.
- Do not delete legacy provider configuration or disable historical verification/webhooks until settlement and rollback sign-off; new provider initiation is already refused by code.

## Engineering release criteria
- Backend Python tests and production Node typecheck/tests/build.
- Frontend build, React contracts, mobile checks.
- Dependency security audit with no unresolved high-severity production advisories, or a formally accepted, evidence-backed mitigation and documented exception.
- Manual destructive-edge tests: concurrent approvals, DB write failure during license mint, email failure/retry, duplicate ref, spoofed blockchain hash, unauthenticated admin calls and inactive account trial attempts.
- Mobile iPhone/Android checkout visual and keyboard/focus test, desktop chart verification, accessibility contrast, real production route smoke.
- Production deployment via the existing established XauCloud release process with backup and rollback. Merge to `main` is **not proof of deployment**.

## Outstanding limitations
- The current trial backend uses **three trading-market days**, not 72 wall-clock hours; product copy follows the existing entitlement implementation. Changing that semantics requires an explicit migration decision.
- Admin FX input is manually verified, not automatically sourced; stale or absent FX disables bank quote.
- Nominal stablecoin pricing does not guarantee dollar peg; invalid or missing asset/network wallets remain unavailable. Crypto is offered in all countries, and bank transfer is restricted to Nigeria.
- Manual verification depends on authorized staff checking independent records. Submitted transaction hashes, upload images and claimed transfer references are **not** proof of receipt on their own.
- Browser screenshots and live small-value transfers cannot be claimed tested merely because Jest/Vitest/pytest build checks pass.

## Rollback
1. Keep old purchase records and license entitlements unchanged. Disable `direct_bank_enabled` and `direct_crypto_enabled` if an operational incident occurs.
2. Roll back to the previous verified backend and frontend build through the standard release tooling; no new destructive schema migration is required.
3. Reconcile manually verified orders issued before rollback and preserve all audit trails and pending customer obligations.
