# XauCloud

XauCloud is the customer-facing brand of the original XauAI Sniper system.
This repository and its existing licenses, APIs, database records, magic
numbers, telemetry schemas, and deployment infrastructure remain the same
system; compatibility identifiers are retained where changing them would
break existing installations.

The authoritative production source is `backend/ea_code/XauCloud-Final.mq5`.
The authoritative customer artifact and its SHA-256 are selected by the EA
release manifests; the current production filename is `XauCloud-Final.ex5`.
`backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` is a compatibility symlink for
historical tools and tests, not a second production source.

Customer downloads are entitlement-gated and resolve the current manifest
entry on every request. The server verifies the artifact SHA-256 before it
returns the file.

- Release metadata: `/api/download/info`
- Signed-token request: `/api/download/request-token`
- Customer download: `/api/download/ea-release`
- Admin master download: `/api/admin/download/ea-master`
