# Manual payment approval verification

The production application is `backend_node` with the React frontend. These changes do not alter live bank accounts, wallets, exchange rates, orders, or licenses. Deployment and the owner's production checks remain separate from code verification.

## Local checks

Use Node 22+, install dependencies in `backend_node` and `frontend`, and run a local MongoDB on port 27017. No bank transfers, blockchain transactions, or external customer emails are sent by these tests.

```sh
cd backend_node
ENVIRONMENT=test JWT_SECRET=local-test-only npm test -- src/routes/directCheckout.test.ts src/routes/directCheckout.countryRules.test.ts src/services/paymentFulfillment.test.ts src/routes/admin/bankTransfers.test.ts src/services/email.delivery.test.ts --maxWorkers=1 --testTimeout=30000
DIRECT_CHECKOUT_MONGO_TESTS=1 ENVIRONMENT=test JWT_SECRET=local-test-only npm test -- src/routes/directCheckout.mongo.test.ts --maxWorkers=1 --testTimeout=30000 --hookTimeout=120000
npm run typecheck
npm run build
cd ../frontend
CI=true npm test -- --watchAll=false --runInBand --testTimeout=30000 --runTestsByPath src/pendingPayments.test.js src/manualCheckout.behavior.test.jsx src/premiumCheckout.contract.test.js
CI=true npm run build
```

For the legacy Python backend, also run `python -m pytest backend/tests/test_manual_payment_approval_unit.py` and the existing `backend/tests/test_manual_direct_checkout.py` integration suite in its configured local test environment. Both implementations accept the same simple admin actions.

The Mongo integration suite creates and removes its own randomly named `checkout_test_*` database. It uses real Mongo indexes, real administrator authorization, actual entitlement resolution, and the official license email template. Only the outbound email transport is replaced. Committed customer fixtures are synthetic.

## Production configuration and owner checks

1. Open **Admin → Pending Payments**. The first view is the queue; payment settings are collapsed below it. Search by name, email, or the complete order ID. No transaction hash, bank reference, reason, amount, or license key is required to approve or reject.
2. Open payment settings to inspect **Bank checkout status**. Nigeria bank transfer requires genuine bank beneficiary settings, an enabled bank method, the official USD price, and the existing manually reviewed USD/NGN rate with a timestamp less than 24 hours old. The status identifies the missing prerequisite. Enter or reaffirm a rate only after independently reviewing it; saving unrelated settings does not refresh it. No exchange rate or beneficiary is invented or automatically seeded.
3. Select Nigeria at checkout. With the legitimate configuration ready, **Bank Transfer** and **Crypto** are selectable. Bank instructions include the configured recipient, account number, NGN amount, and existing instructions. Select each configured crypto option to check the coin, network, receiving address, and exact amount. Select another country and confirm bank transfer is absent.
4. Create a test order and confirm it appears in Pending Payments before any separate submission is required. A customer's transfer claim does not activate a license. Only an authorized owner's approval does.
5. For the existing confirmed customer payment, search the original order ID and click **Approve**. Confirm the order is fulfilled, the purchased license is active and attached to the correct account, the full purchased entitlements are enabled, and the official license email arrives. An existing license belonging to that order is reused. Existing quotes and historical payment details are not rewritten.
6. Reject another pending test order without entering a reason. It must remain in history and must not issue a license. Duplicate actions and requests from customers, inactive administrators, or revoked sessions must not bypass authorization or create additional licenses.
7. A definite license, account-link, or email failure displays its stage and **Retry Fulfillment**. After correcting the cause, retry must preserve the original approval and reuse the same license. If SMTP times out after potentially accepting a message, the delivery outcome is unknown; the system prevents a blind resend and displays the sender-log reconciliation error. SMTP cannot promise exactly-once delivery across an ambiguous network failure.

Hostinger must use root directory `backend_node`, build script `build:production`, and entry file `dist/index.js`. The production build installs the locked frontend dependencies, rebuilds and syncs the frontend into `backend_node/public`, and compiles the backend. The backend-only `build` script does not update the served checkout.

Deploy only through the established XauCloud release procedure, with the database backup and rollback steps in [the release gate](XAUCLOUD_USD_MANUAL_CHECKOUT_RELEASE.md). This document is not evidence of a production deployment, a real funds transfer, or delivery to a real customer's mailbox.
