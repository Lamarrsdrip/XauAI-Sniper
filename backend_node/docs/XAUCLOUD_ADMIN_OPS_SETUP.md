# XauCloud Admin Ops Action — setup

This package extends the existing private XauCloud Admin GPT. It does not replace the existing email/marketing Action schema.

## After backend deployment

1. Verify `https://xaucloud.io/api/readiness` reports `READY`, including `admin_ops_actions: READY`.
2. In the existing private **XauCloud Admin** GPT, add another Action definition.
3. Import/paste `docs/xaucloud-admin-ops.openapi.yaml`.
4. Configure Authentication as API Key / Bearer using the same dedicated `XAUCLOUD_GPT_ACTION_SECRET` already used by the current XauCloud Action integration.
5. Do not use SMTP, database, Hostinger, GitHub or payment-provider credentials in ChatGPT.
6. Test `getAdminCapabilities`, then `getSystemHealth`, then `listReplays`, then `searchUsers`.
7. Test a consequential operation only with a test account/license: prepare first, inspect the target, explicitly approve, then execute with the returned short-lived token and a unique idempotency key.

## Optional permission override

The backend defaults to read access plus controlled user/license/email/support/notification writes. You can restrict the GPT further with:

`XAUCLOUD_GPT_ACTION_PERMISSIONS=admin.read,admin.orders.read,admin.email.read,admin.system.read,admin.analytics.read`

Supported permissions are documented in `src/services/adminOpsControl.ts`.
