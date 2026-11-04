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
