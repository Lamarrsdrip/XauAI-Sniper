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

## Owner's B1 production trading source

Separate from the customer release manifest above: the owner's own current
B1 production trading source is `backend/ea_code/XauCloud-Fixed-B1.mq5`
(`XAUCloud-Fixed-B1_v6.28.1`, `#property version 6.281`), derived from the
tracked `XauCloud-Fixed.mq5` (`v6.28.0`). This identifies the intended
current source only -- the repository cannot itself prove which compiled
`.ex5` is actually attached to any given MT5 terminal/VPS at runtime.
