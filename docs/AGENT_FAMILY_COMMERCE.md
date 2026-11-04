# Agent.family commerce

This is the paid-order layer on top of the existing read-only MT5 snapshot. It does not start a second VPS fleet, does not place trades, and does not hold a wallet private key.

Marketplace calls stay disabled until both are set in server-only configuration:

```dotenv
XAUCLOUD_AGENT_FAMILY_ENABLED=true
TERMIX_ACCESS_TOKEN=<session JWT from POST /api/v1/auth/wallet>
TERMIX_REFRESH_TOKEN=<refresh token>
TERMIX_API_BASE=https://platform-backend.prod.termix.live
XAUCLOUD_AGENT_FAMILY_READ_TOKEN=<existing 32+ char snapshot token>
```

`XAUCLOUD_AGENT_FAMILY_PUBLISH=true` is a second switch. Listings are created as drafts and are published only when that switch and `XAUCLOUD_AGENT_FAMILY_COVER_URL` (https) are both set. Unpublished services in the catalog are never sent.

## What the owner still has to sign

TermiX acceptance, delivery and claim-after-timeout are on-chain intents. The worker stores the unsigned intent on the order. Report the broadcast hash in the admin Agent.family tab. A hash is not settlement. Net revenue counts only when the marketplace order status is `SETTLED`.

Registration, the agent NFT and stake deposit are also wallet actions. Do not put a seed phrase in the server environment.

## Readiness

Local tests cover fulfillment math, source refusal, idempotent execution and settlement accounting. They are not a live Agent.family payment.

## Configure from XauCloud Admin

After deploying the Node backend and rebuilding the frontend, open
**Admin → Money → Agent.family → Connect Agent.family**.

- First register the XauCloud agent and authorize the owner wallet on Agent.family.
- Enter the provider Agent ID and an HTTPS listing cover image.
- Paste the TermiX session access token and optional refresh token. These are encrypted
  before database storage using XauCloud's existing server-side encryption and
  are never returned in Admin API responses. Retain `JWT_SECRET` across deploys.
- Save configuration, then enable paid-order processing.
- Run **Test connection** to verify the authenticated order API is reachable.
  That check does *not* verify wallet ownership, escrow or an actual paid order.
- Enable publishing separately, save, and use **Sync draft listings**.
  Unimplemented services remain unpublished.
- Use **Disconnect** to turn processing and publishing off and clear Admin-managed
  session credentials. If old environment tokens exist, the DB clear marker overrides
  them; revoke the sessions at Agent.family as well.

Existing MT5 approved primary/backup source settings remain in XauCloud's
existing admin configuration. The bridge never installs a separate VPS worker.
No signing keys or broker passwords belong in the Agent.family admin fields.

The Admin record overrides the legacy server environment variables after the
first save, and changes take effect during polling without requiring a restart.
Do not disclose a login-session token to support staff or paste it in GitHub
or a public issue. A session may expire; use Admin to rotate credentials when needed.

**Caution:** Publishing and processing are deliberately separate switches, but
the live service remains unverified until a funded order has been fulfilled and
settled on Agent.family. Wallet actions remain owner-authorized.

