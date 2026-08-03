# Offline Lease — Phase 3/5/6: Schema, Primary-Terminal Model, Failure Classification

## Lease schema (backend-issued, EA-verified only)

```json
{
  "schema_version": 1,
  "lease_id": "uuid4",
  "key_id": "xaucloud-lease-2026-07",
  "tenant_id": "<license.tenant or license_id itself -- see note>",
  "license_id": "<pin_licenses.id>",
  "account_login": "<mt5 login>",
  "account_server": "<broker server>",
  "installation_id": "<permanent per-install id, see below>",
  "terminal_instance_id": "<permanent per-terminal id, see below>",
  "normalized_symbol": "XAUUSD",
  "allowed_directions": [1, -1],
  "allowed_entry_families": ["CORE"],
  "issued_at": "2026-07-25T15:00:00Z",
  "not_before": "2026-07-25T15:00:00Z",
  "expires_at": "2026-07-25T15:15:00Z",
  "renewal_after": "2026-07-25T15:10:00Z",
  "maximum_offline_new_campaigns": 1,
  "remaining_offline_new_campaigns": 1,
  "lease_sequence": 42,
  "revocation_epoch": 3,
  "nonce": "<16 random bytes, hex>",
  "signature_algorithm": "XAUCLOUD-LEASE-RS256-v1",
  "detached_signature": "<512 hex chars>"
}
```

**Canonicalization rule** (must match byte-for-byte between signer and
verifier): the signed payload is every field above *except*
`signature_algorithm` and `detached_signature`, serialized as
`key=value` pairs joined by `|`, in the exact fixed field order listed
above (never alphabetical/dict-order-dependent — MQL5 has no canonical
JSON serializer, so a fixed field list avoids needing one), arrays
joined with `,` (e.g. `allowed_directions=1,-1`), UTF-8 encoded. This
exact string is what both the Python signer and the MQL5
`XAU_LeaseVerifySignature()` hash and check — see
`backend/lease_service.py`'s `canonical_payload()` for the authoritative
implementation the EA's construction must match exactly.

`tenant_id`: this codebase's licensing model (per Phase 2 audit,
`server.py:4422-4491`) binds a `pin_license` directly to one MT5
account/server — there is no separate multi-tenant-per-license concept
observed elsewhere in `server.py`. `tenant_id` is set equal to
`license_id` rather than inventing a new concept not otherwise present.

## Primary-terminal exclusivity (Phase 4)

One row per `(license_id, account_login, account_server, normalized_symbol)`
in a new `lease_terminal_authority` collection, holding the currently
authorized primary `terminal_instance_id` and the current
`lease_sequence`/`revocation_epoch`. A new lease request for this key:

- **First-ever request** for the key → authorized immediately, sequence 1.
- **Same `terminal_instance_id` as the current holder** → renewal, sequence
  increments, atomic (see below).
- **Different `terminal_instance_id`** while the current lease has not
  expired and was not explicitly surrendered → **rejected**
  (`AUTHORIZATION_FAILURE`, reason `PRIMARY_TERMINAL_ALREADY_ASSIGNED`).
  This is enforced with a single atomic MongoDB
  `find_one_and_update(filter={key, "$or": [{"holder_terminal_id": requester},
  {"lease_expires_at": {"$lte": now}}, {"surrendered": true}]}, update=...)`
  — the filter itself is the compare-and-swap; a stale/offline old holder
  reconnecting after its lease naturally expired can only ever succeed
  through the same atomic path, never a second, racing code path.
- Admin-initiated primary transfer: sets `surrendered: true` only after
  confirming (from the DB, not from any frontend-supplied claim) that the
  current lease's `expires_at` has already passed, or requires the old
  terminal to explicitly call `/lease/surrender` first.

## Installation / terminal identity (Phase 4)

`installation_id`: generated once and persisted to a file in the MT5
common data folder (`TerminalInfoString(TERMINAL_COMMONDATA_PATH)`) the
first time the EA ever runs the lease code — this path is shared across
terminals on the same machine but is NOT wiped by "delete profile"/
"reinstall EA" actions the way `MQL5/Files/<this EA's sandbox>` can be,
and survives EA/chart/terminal restart. Generated via a random 128-bit
value the first time, never regenerated once written.

`terminal_instance_id`: a second identifier, persisted the same way but
in the *terminal-specific* (not common) files folder, distinguishing two
different MT5 installations on the same machine (Mac vs. VPS) even if
they somehow shared a common-data path (they don't, in practice, but the
two-identifier design makes the distinction explicit rather than
implicit).

## Backend failure classification (Phase 6)

```
ONLINE_ALLOWED                 -- HTTP 200, claimed:true
ONLINE_DENIED                  -- HTTP 200, claimed:false, reason=ACTIVE_EXECUTION_RESERVED (existing behavior, unchanged)
AUTHENTICATION_FAILURE         -- HTTP 401, or 403 with reason indicating license/account mismatch
AUTHORIZATION_FAILURE          -- HTTP 403 with reason indicating a valid-but-not-permitted action (e.g. PRIMARY_TERMINAL_ALREADY_ASSIGNED, revoked lease/terminal)
VALIDATION_FAILURE             -- HTTP 400
DUPLICATE_OR_CONFLICT          -- HTTP 200 claimed:false (alias of ONLINE_DENIED, kept as a separate name for lease-specific conflict responses)
SERVER_TEMPORARY_FAILURE       -- HTTP 500/502/503/504
TEMPORARY_CONNECTIVITY_FAILURE -- WebRequest returns -1 (network/DNS/TLS/timeout, no HTTP response at all)
UNKNOWN_UNSAFE_FAILURE         -- anything not matching one of the above (fail closed, same as today)
```

Only `TEMPORARY_CONNECTIVITY_FAILURE` and `SERVER_TEMPORARY_FAILURE` may
ever result in consulting the cached lease. Every other classification
blocks the trade exactly as it does today — no behavior change for any
explicit backend response, only for the "backend didn't answer at all or
returned a 5xx" case. This directly replaces the current single
`RESERVATION_BACKEND_UNREACHABLE` bucket described in
`02_reservation_flow_audit.md` §4-5, which today conflates all of these.

Classification is implemented once, in a new `XAU_ClassifyReservationFailure()`
helper that both the existing `XAU_ClaimDirectionReservation()` and the new
lease-check path call — not duplicated logic.

## Key management (Phase 17)

Environment variables (this branch has no pre-existing `backend/.env.example`
to extend — it forked before the Nomba branch added one — so they're
documented here instead):

- `XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY` — PEM-encoded RSA-2048 private key,
  base64-wrapped (so it survives a single-line `.env` value; `lease_service.
  load_signing_key()` accepts either a raw `-----BEGIN...` PEM or a
  base64-encoded PEM). **Never committed. Never logged. Never returned by
  any API response** — confirmed: no endpoint or log line in `server.py`'s
  new lease code ever serializes `signing_key.private_key` or the raw env
  var; only `signing_key.modulus_hex` (a public value) and the per-lease
  `detached_signature` are ever used downstream.
- `XAUCLOUD_LEASE_SIGNING_KEY_ID` — the `key_id` stamped into every lease
  this instance signs. Rotation model: because the EA verifies against a
  compile-time-embedded public key (there is no live "fetch the current
  public key" call the offline path could make without defeating its own
  purpose), rotating the signing key means (1) generating a new key pair,
  (2) shipping a new EA build whose `XAU_LEASE_TRUSTED_PUBLIC_KEYS` table
  (keyed by `key_id`) includes BOTH the old and new modulus for a
  transition window, (3) switching the backend's env vars to the new
  key/key_id once the new EA build is deployed, (4) after the transition
  window, a further EA build drops the old key. This is the same
  "current + previously trusted" rotation shape the task asked for, just
  necessarily EA-release-gated rather than live-fetched, which is inherent
  to any embedded-verifier design and is stated plainly rather than
  glossed over.
- If `load_signing_key()` raises `LeaseCryptoNotConfigured` (either var
  missing, wrong key size, or wrong public exponent), every lease-issuing
  endpoint (`/lease/request`, `/lease/renew`) returns **HTTP 503** — the
  same fail-closed pattern used for Nomba credentials. `/lease/status`,
  `/lease/surrender`, and `/lease/reconcile` do not need the signing key
  and remain available even before it's configured.
- No `XAUCLOUD_LEASE_PUBLIC_KEYS` env var was implemented — the public key
  a given lease was signed with never needs to be handed to anything other
  than the EA itself, and the EA's copy is compiled in, not fetched at
  runtime, so there is nothing server-side that needs to read it back out.
