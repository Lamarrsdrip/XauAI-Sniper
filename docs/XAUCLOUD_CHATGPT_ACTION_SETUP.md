# Connect the private XauCloud Admin GPT

## Before ChatGPT setup

1. Deploy the backend changes to the existing XauCloud application.
2. Generate a dedicated Action credential:

   ```bash
   openssl rand -base64 48
   ```

3. Save that value in the backend's production secret/environment management as `XAUCLOUD_GPT_ACTION_SECRET`. Do not put it in Git, frontend code, screenshots, email settings, or the OpenAPI file.
4. Keep the existing SMTP/mailbox/provider configuration unchanged. The Action route resolves and uses the same sender as the Admin email composer.

## Create the private GPT

1. Go to ChatGPT on the web.
2. Open **Explore GPTs** and choose **Create**.
3. Name it **XauCloud Admin**.
4. Open [XAUCLOUD_ADMIN_GPT_INSTRUCTIONS.md](./XAUCLOUD_ADMIN_GPT_INSTRUCTIONS.md) and paste its instruction block into the GPT's **Instructions** field.
5. Under **Actions**, choose **Create new action**.
6. Import or paste [xaucloud-gpt-actions.openapi.yaml](./xaucloud-gpt-actions.openapi.yaml).
7. Configure authentication as an API key/bearer credential. Enter the dedicated `XAUCLOUD_GPT_ACTION_SECRET` value. Do not enter the SMTP password, mailbox password, hosting password, database URL, or JWT secret.
8. Save the GPT as **Only me** / private.

## Safe verification sequence

Run these in order:

1. “What email audiences are available?” Confirm the sender and counts come from XauCloud.
2. “Create a draft telling customers XauCloud has a new update.” Confirm the draft appears in the normal Admin email draft library with a **ChatGPT** tag.
3. Ask it to preview the draft. Compare the content with the Admin composer preview.
4. Ask it to send a test to one safe address you control. Do not use a customer segment.
5. Ask it to prepare the broadcast. Confirm subject, audience, recipient count, sender, warnings, and expiration.
6. Do not approve the first production broadcast until the test email, sender identity, footer, links, audience count, and Admin email history have all been verified.
7. After a deliberately small safe production send, confirm the entry appears in the normal Admin **Email history** with a **ChatGPT** tag.
8. Open **Admin → Marketing** and confirm the campaign overview shows its email, website, announcement, push, social/video/graphics/FAQ, and landing-page assets.
9. Prepare—but do not approve—a homepage asset, announcement, push, and landing page. Confirm none becomes public from preparation alone.
10. Use a safe controlled campaign to test publish, unpublish, and website rollback. Confirm the prior homepage version is restored.
11. For push, use only a test account/device with notifications explicitly enabled. Confirm opted-out or unsubscribed accounts are not included in the aggregate audience count.

## Rotate or revoke access

To rotate, generate a new random value, replace `XAUCLOUD_GPT_ACTION_SECRET` in production, restart/redeploy the backend, and update the Custom GPT Action authentication. The old value stops working immediately after the backend restarts.

To revoke without replacement, remove `XAUCLOUD_GPT_ACTION_SECRET` from production and restart/redeploy. The Action endpoints return `503` and no email action can run. This does not affect the Admin dashboard or the existing email provider.

## Endpoint and security notes

- API server: `https://xaucloud.io/api` (the imported schema exposes only the focused `/admin/actions/email/...` and `/admin/actions/marketing/...` operations).
- The schema deliberately contains 29 operations, below the Custom GPT Action import boundary. Backend and normal Admin capabilities remain broader; redundant preview/status/unpublish routes are consolidated or omitted from the GPT-visible schema.
- Schema version 2.3 keeps every operation description within the GPT importer limit, declares path parameters inline, uses explicit object request bodies, and keeps raw HTML out of GPT requests while preserving XauCloud's premium server-side renderer.
- Authentication: dedicated bearer secret only.
- Confirmation tokens are short-lived, single-use, hashed at rest, and bound to the exact draft, audience, and resolved recipient set.
- The final send requires an idempotency key. Retries return the existing send record instead of starting a second broadcast.
- Action campaigns use the existing `admin_email_drafts` and `admin_email_log` collections and the existing structured renderer and SMTP sender.
- The same credential also controls the focused Marketing Action endpoints. It does not grant arbitrary file editing, database queries, shell access, or customer-record access.
- Approved features and approved performance results are managed in **Admin → Marketing**. The GPT read actions return approved records only.
- Website slots, landing pages, Command Center announcements, and push delivery are predefined backend-controlled surfaces. Every live change has confirmation, content hashing, audit logging, and idempotency.
- SMTP/mailbox/provider credentials remain entirely on the backend and are never returned by these endpoints.
