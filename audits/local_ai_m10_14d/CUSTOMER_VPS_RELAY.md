# XauCloud pure-M10 customer-to-private-VPS relay

## Outcome

The customer build is named `XauCloud_M10_PRIVATE_VPS_AI`.

Customer MT5 terminals send an authenticated, compact pure-M10 snapshot to
`https://xauaisniper.com`. The public backend validates the license/account,
deduplicates the exact snapshot, and places it in a tenant-isolated MongoDB
queue. The owner's VPS claims work with signed outbound HTTPS requests, calls
the existing loopback gateway, and returns the strictly validated decision.

The VPS does not accept public inbound model traffic. `llama.cpp` remains on
`127.0.0.1:11434` and the local gateway remains on `127.0.0.1:8765`.

## Trading contract

- Primary evidence and execution timeframe: closed `PERIOD_M10` only.
- No M5 scan, snapshot, comparison, or hybrid state was added.
- Local AI may select only an existing setup family supplied by the M10 engine.
- Local AI confidence below 70 is normalized to
  `LOCAL_AI_LOW_CONFIDENCE` and ignored.
- Pending, timeout, invalid schema, overload, unavailable service, bad worker
  signature, or missing result always leaves the deterministic engine active.
- The AI cannot bypass permanent owner blocks, normal gates, risk checks,
  broker checks, or the final order-send path.
- Emergent/paid AI remains disabled for routine scans.

## Security and isolation

- Customer submit/result calls use the existing authoritative license PIN and
  atomic MT5-account binding service.
- Raw PINs are not stored in queue jobs; jobs contain the internal license ID.
- Result lookups are keyed by license ID, account, and exact snapshot signature.
- Worker jobs use atomic leases and bounded retries.
- The VPS signs the exact HTTP method, route, body hash, timestamp, and nonce
  with Ed25519. The private key exists only on the VPS with inherited ACLs
  removed; the backend ships only the public key.
- Used nonces have a unique MongoDB index and TTL, preventing request replay.
- Tenant and global queue guards fail to the deterministic engine.

## Verification evidence (2026-08-02)

- Focused regression gate: 48 tests passed.
- Backend route/import smoke test: passed on Python 3.9 test runtime.
- Root EA, backend mirror, and WITH_OWNER research source: byte-identical.
- Isolated MetaEditor64 compile: `0 errors, 0 warnings`.
- Compiled filename: `XauCloud_M10_PRIVATE_VPS_AI.ex5`.
- Compiled size: 1,511,500 bytes.
- EX5 SHA-256:
  `86d21c1465ba1ab6067df2f91572443b50579f2ccb070bdc93feaa8739b6263b`.
- The build was staged additively in the Mac and VPS Experts folders with the
  same hash. It was not attached to a chart, and neither terminal was restarted.

## Capacity note

The current VPS runs one local inference at a time. With the measured model
latency, this is suitable for an initial customer fleet, not an unlimited fleet.
Exact snapshot cache hits are cheap, and overload never blocks trading because
the deterministic engine remains authoritative. Before a large sales launch,
measure real eligible-snapshot arrival rate and add worker capacity based on
that evidence.

## Replay status

The full 30-day Model=4 workflow has not yet produced final comparison metrics.
Its baseline report proved `100% real ticks`, but the orchestrator rejected the
report because its PowerShell regex was double-escaped. The verifier is fixed;
no performance claim should be made until the complete AI reports finish.
