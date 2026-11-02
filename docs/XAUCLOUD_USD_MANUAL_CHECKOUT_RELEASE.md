# XauCloud USD-first manual checkout — production release gate

Status: **feature branch / PR #8 only**. Do not activate payment methods until the checks below are signed off.

## What changes
- Marketing homepage: five meaningful sections (hero; genuine performance; preserved 30-day replay; how it works; 3-trading-market-day trial or single direct purchase).
- No new recurring weekly/monthly signal-plan orders. Historical signal subscriptions and existing account entitlements stay intact.
- USD base price stored as **integer cents** in `admin_settings.direct_usd_cents`. No price is seeded automatically.
- Nigeria: manual NGN bank transfer, fixed USD/NGN quote from admin-entered current rate and timestamp (24-hour rate freshness, 30-minute order validity). Money uses integer minor units.
- Approved non-Nigeria countries: manually reviewed USDT/USDC on explicitly configured ERC20 or TRC20 wallets. Stablecoin quote uses *nominal* 1 token = 1 USD and excludes network fees; communicate peg/depeg/fee limitations.
- Proof is optional; screenshots are not independent verification. Bank ledger / blockchain explorer checks remain mandatory before admin approval.
- Manual orders require an atomic state transition and create an existing-format PIN license with a unique payment reference; delivery and audit results are recorded.
- Old Paystack/Nomba and legacy NGN **new initiation routes return HTTP 410** in both Python and Node apps. Historical provider verification/webhooks, stored orders and licensed users are retained for outstanding settlement.

## Mandatory administrative configuration
1. Set a confirmed **one-time** official USD product price (not a guessed converted NGN price) at `/admin` → Direct Checkout. Independently confirm the associated licensing terms.
2. For Nigeria, use the existing Bank Transfers admin tab to configure and validate beneficiary name, actual bank name and account number. Enable the bank method there **and** Direct Checkout only after verifying ownership. Ensure the bank can receive deposits and that statements are accessible to authorized reviewers.
3. Independently verify a current USD/NGN rate. Supply the decimal rate through Direct Checkout, record the source/evidence in operational notes; it expires after 24 hours. The code does not fetch FX from an external provider automatically. The rate is **not** to be silently reused when stale. Refresh after independent verification.
4. For each authorized country, record legal/compliance approval for accepting the selected crypto asset/network. Set the country ISO code allowlist, supported networks and **verified receiving wallet** in Direct Checkout. Validate ownership and test a very small amount before enabling production transfers.
5. Ensure admin MFA, permission reviews, rate limits, email sending, reconciliations, customer support and monitoring are operational. Audit screenshot handling/storage access and payment data retention.
6. Exercise one low-risk end-to-end bank sandbox/test ledger verification and one crypto transfer on each configured chain. Confirm proof submission **does not** mint a license, approval mints only one license and sends at most one automatic PIN message, rejection is communicated and duplicates are rejected.
7. Verify that quotes and purchase instructions are disabled for missing price/FX/bank/wallet/country setup; validate stale rates and expired quotes. Cross-check live currency/amount totals against the customer's actual bank statement and chain.

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
- Nominal stablecoin pricing does not guarantee dollar peg; wallet/network and country coverage are intentionally fail-closed.
- Manual verification depends on authorized staff checking independent records. Submitted transaction hashes, upload images and claimed transfer references are **not** proof of receipt on their own.
- Browser screenshots and live small-value transfers cannot be claimed tested merely because Jest/Vitest/pytest build checks pass.

## Rollback
1. Keep old purchase records and license entitlements unchanged. Disable `direct_bank_enabled` and `direct_crypto_enabled` if an operational incident occurs.
2. Roll back to the previous verified backend and frontend build through the standard release tooling; no new destructive schema migration is required.
3. Reconcile manually verified orders issued before rollback and preserve all audit trails and pending customer obligations.
