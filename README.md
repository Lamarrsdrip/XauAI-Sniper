# XauCloud

XauCloud is the customer-facing brand of the original XauAI Sniper system.
This repository and its existing licenses, APIs, database records, magic
numbers, telemetry schemas, and deployment infrastructure remain the same
system; compatibility identifiers are retained where changing them would
break existing installations.

The authoritative production source, customer artifact, and SHA-256 are
selected exclusively by `backend/ea_releases/manifest.json`. The current
production release is v6.27.2: `XauCloud-60pips.mq5` and
`XauCloud-60pips.ex5`.
`backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` is a compatibility symlink for
historical tools and tests, not a second production source.

Customer downloads are entitlement-gated and resolve the current manifest
entry on every request. The server verifies the artifact SHA-256 before it
returns the file.

- Release metadata: `/api/download/info`
- Signed-token request: `/api/download/request-token`
- Customer download: `/api/download/ea-release`
- Admin master download: `/api/admin/download/ea-master`
