# XauCloud v6.25.28 — Bounded Offline Trading Lease — Final Report

## Branch / commits

- **Starting branch/commit**: `fix/performance-forward-reset` @ `13c447d8f5438458715f6b6583cc2e6b0131b877` (== `origin/main` at task start).
- **Final branch/commit**: `feature/xaucloud-bounded-offline-lease` @ `72d07164bd776be2560d5753ecbe99a2f0ef14fa`.
- **Not merged to `main`. Not pushed to origin. Not deployed to Mac or VPS.** Per the task's explicit instructions, this is held for your review of the evidence below before any of those steps.
- Active release identity at task start: `v6.25.28` (`backend/ea_releases/manifest.json`, `source_commit dca5f1e8...`).

## Files changed (18 files, +3805/-20 lines)

| File | What |
|---|---|
| `XAUUSD_AI_Sniper_EA.mq5` / `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` | The real integration (kept byte-identical to each other throughout, per this repo's existing convention) |
| `backend/ea_code/lease/XauCloudLeaseSha256.mqh` | From-scratch SHA-256 |
| `backend/ea_code/lease/XauCloudLeaseCrypto.mqh` | RSA-2048/PKCS#1v1.5 signature verifier (bignum core + top-level `XAU_LeaseVerifySignature`) |
| `backend/ea_code/lease/XauCloudLeaseClient.mqh` | Persistence, clock integrity, mutex, execution key/ledger, failure classification, WebRequest calls, reconciliation upload |
| `backend/ea_code/lease/XauCloudLeaseCryptoTest.mq5` / `...TestEA.mq5` | Crypto module self-tests (Script + EA form) |
| `backend/ea_code/lease/XauCloudLeaseClientTestEA.mq5` | Client module self-test (39 checks) |
| `backend/lease_service.py` | Backend signing service (canonical payload, RSA sign, dev-key generator) |
| `backend/server.py` | 5 new endpoints + atomic primary-terminal enforcement |
| `backend/tests/test_offline_lease.py` | 11 backend tests |
| `audits/offline_lease/*.md` + 2 Python prototypes | Full audit trail |

## Previous reservation flow (traced, not assumed — `02_reservation_flow_audit.md`)

`XAU_ClaimDirectionReservation()` (`mq5:5356-5419` at task start) posts to
`/api/cloud/reservation/claim`; on **any** non-200 response (a genuine
timeout, DNS failure, or a real backend 4xx/5xx all included, indistinguishable)
it set `failReason="RESERVATION_BACKEND_UNREACHABLE"` and the calling
`XAU_CanOpenDirection()` blocked the trade **before the broker-send line
was ever reached**, for all four order-submission paths (CORE, RE_ENTRY,
PYRAMID, COUNTER_EXCURSION). This was deliberate, owner-requested,
documented fail-closed behavior — and a real backtest-audit finding
already in the codebase proved it: a 30-day Strategy Tester run (no
network path) produced **zero trades** for exactly this reason.

## The exact previous single point of failure

Any backend outage of any duration — the Vercel deployment being
redeployed, a DNS blip, a TLS handshake failure, a MongoDB hiccup behind
the API — cancelled 100% of would-be new entries with no distinction from
an explicit "no, someone else owns this" denial, even though the EA
itself, the broker connection, the account, and the strategy's own
approval were all completely healthy.

## New online-reservation flow

**Unchanged.** Every existing behavior for an explicit backend response
(claim success, claim denial, license/account/symbol validation failure,
authentication failure) is byte-for-byte identical to before. The only
change to `XAU_ClaimDirectionReservation()` is that it now also computes
and returns a strict classification of *why* a failure occurred
(`ENUM_XAU_LEASE_FAILURE_CLASS` — `ONLINE_ALLOWED` / `ONLINE_DENIED` /
`AUTHENTICATION_FAILURE` / `AUTHORIZATION_FAILURE` / `VALIDATION_FAILURE`
/ `SERVER_TEMPORARY_FAILURE` / `TEMPORARY_CONNECTIVITY_FAILURE` /
`UNKNOWN_UNSAFE_FAILURE`) alongside the existing bool+reason-string
return it already had.

## New offline-lease flow

Only engages when **all** of the following hold simultaneously:
1. `InpOfflineLeaseEnabled = true` (input default: **false**).
2. The candidate is a genuine, fully-automated CORE entry — not RE_ENTRY
   (detected via the existing `"RE_ENTRY_FRESH_SETUP:"` reason prefix,
   since RE_ENTRY shares `OpenTrade()` with CORE and has no separate
   family string at this call site) and not a manual/force override.
3. The reservation claim's failure classification is
   `TEMPORARY_CONNECTIVITY_FAILURE` or `SERVER_TEMPORARY_FAILURE` —
   **never** an explicit deny/auth/validation/conflict response.
4. A valid, signed, unexpired, in-scope, unconsumed lease is present on
   disk for this exact license+account+server+symbol+installation+terminal.
5. The local offline mutex is free.

On success: authorization proceeds exactly like the online path from
that point forward (same local position/pending-order recheck, same
broker send, same reconciliation). The lease allowance is consumed (and
the event durably queued for backend reconciliation) **only** once the
real broker retcode is known to be accepted — confirmed or ambiguous —
**never** merely for having attempted the send, and **never** on a
definitive rejection.

## Lease schema

```
schema_version, lease_id, key_id, tenant_id, license_id, account_login,
account_server, installation_id, terminal_instance_id, normalized_symbol,
allowed_directions, allowed_entry_families, issued_at_unix, not_before_unix,
expires_at_unix, renewal_after_unix, maximum_offline_new_campaigns,
remaining_offline_new_campaigns, lease_sequence, revocation_epoch, nonce
```
plus the unsigned envelope `signature_algorithm` + `detached_signature`.
Full detail: `03_lease_architecture.md`.

## Canonicalization

Fixed field order (listed above), `key=value` pairs joined by `|`, arrays
comma-joined with no spaces, UTF-8 bytes. **Timestamps are Unix integers,
not ISO8601** — a deliberate design correction made before any EA clock
code was written, because MQL5 has no safe ISO8601 parser and Python's
`isoformat()` emits a variable-length microseconds field. Implemented
identically in `lease_service.canonical_payload()` (Python) and
`XAU_LeaseCanonicalPayloadFromState()` (MQL5).

## Signature algorithm

`XAUCLOUD-LEASE-RS256-v1` — RSA-2048, SHA-256, PKCS#1 v1.5 padding, fixed
public exponent 65537. **Not** Ed25519: chosen because no elliptic-curve
code exists anywhere in this repository to build on (confirmed by a
dedicated repo-wide search), and RSA verification needs only modular
exponentiation — a meaningfully smaller, more auditable surface than
Edwards-curve point arithmetic implemented from scratch. This is a
restricted single-algorithm profile: an incoming lease's
`signature_algorithm` is compared against exactly this one string; no
`alg` value from the payload ever selects verification logic.

## MQL5 signature-verification method

From-scratch SHA-256 (FIPS 180-4) plus a from-scratch bignum core
(schoolbook multiply, bit-serial binary modular reduction chosen
specifically over Knuth-style division for auditability) implementing
right-to-left modular exponentiation and an EMSA-PKCS1-v1_5 padding
check. Full design and the two real bugs caught during development
(bignum remainder overflow, `CryptEncode` hash-mode absence) are in
`04_ea_crypto_module.md`.

## "Published test vectors" used

Not RFC 8032/formal NIST RSA vectors — instead, **real signatures
produced by Python's `cryptography` library** (the actual backend
signer) across 4+ message shapes, cross-verified independently in Python
first (catching the bignum bug before it ever reached MQL5), then
proven inside the real MetaTrader Strategy Tester (not just compiled):
**17/17 crypto-module runtime passes**, then **38/39 client-module
runtime passes** through the full parse→persist→reload→verify→clock-
check→execution-key→ledger→mutex pipeline (see below for the one
open item).

## Key-rotation design

The EA verifies against a compile-time-embedded public-key table
(`XAU_LeaseTrustedKeyIds[]`/`XAU_LeaseTrustedModulus[]`, currently
placeholder values — **the owner must provision the real production
modulus at build time**, see Remaining Manual Steps). Rotation means:
ship a new EA build whose table includes both the old and new key_id
during a transition window, switch the backend's env vars to the new
key, then a later build drops the old key. This is EA-release-gated
rather than live-fetched — inherent to any embedded-verifier design,
stated plainly rather than glossed over.

## Lease validity duration / renewal / max offline allowance

Backend-configured via `XAUCLOUD_LEASE_VALIDITY_SECONDS` (default 900 =
15 min), `XAUCLOUD_LEASE_RENEWAL_SECONDS` (default 300 = 5 min before
expiry), `XAUCLOUD_LEASE_MAX_OFFLINE_CAMPAIGNS` (default 1). No
conflicting hardcoded values exist elsewhere.

## Primary-terminal enforcement

One atomic MongoDB `find_one_and_update` per
`(license_id, account_login, account_server, symbol)` key
(`lease_terminal_authority` collection) — the filter itself is the
compare-and-swap. A different terminal cannot obtain a lease for the
same key while the current holder's lease is unexpired and not
surrendered. **Proven by test**, not just designed:
`test_second_terminal_denied_while_first_lease_active`,
`test_other_terminal_cannot_renew`,
`test_surrender_then_new_terminal_can_claim`,
`test_foreign_surrender_attempt_rejected` — all passing.

## Installation / terminal identity design

Two separate persisted IDs: `installation_id` (common-data folder,
survives EA/chart/terminal restart, shared per-machine) and
`terminal_instance_id` (terminal-local files, distinguishes two
installs on the same machine). Generated once, never regenerated.
Proven stable across repeated calls (simulating restart) by test.

## Local mutex design

Extends (does not replace) the existing, proven `XAU_TryClaimEntryLock()`
GlobalVariable compare-and-swap pattern, under a distinct key namespace.
**One open item**: 38/39 client-module tests pass; one narrow same-tick
`GlobalVariableCheck()` timing artifact remains unresolved in the test
harness (detailed honestly, with reasoning for why it's unlikely to be a
real security gap given the execution-key ledger is the actual
restart-safe duplicate-prevention mechanism, not this mutex) — see
`05_ea_client_module.md`.

## Execution-key design

Reuses the **existing, unmodified** `XAU_CoreExecutionKey()` identity,
combined with `lease_id`+`lease_sequence`, checked against a
restart-surviving local ledger file **before** any offline send and
recorded **only after** a confirmed/ambiguous broker result. Proven by
test: deterministic across repeated calls, duplicate correctly rejected,
a genuinely different key correctly accepted.

## Persistence design

Atomic: write to a `.tmp` file, flush, close, reopen and re-verify the
signature, only then delete-and-replace the real file. A partially
written or tampered file is never trusted (`XAU_LeaseVerifyState` is the
gate on every load). `remainingOfflineNewCampaigns` is a **signed**
field and is never mutated in place; consumption is tracked in a
separate, local-only `consumedThisLease` counter so the signature
remains valid for the lease's entire lifetime.

## Clock-integrity design

Broker-time anchor + `GetTickCount64()` monotonic anchor recorded at
lease receipt/load; elapsed time cross-checked between the two with a
120-second divergence tolerance; fails closed
(`XAU_LEASE_INVALID_CLOCK_INTEGRITY`) if broker time is unavailable
(`TimeCurrent() <= 0`) or the two clocks disagree beyond tolerance.
Expiry is always judged against fresh broker time vs. the signed
`expires_at_unix` — an MT5 restart re-anchors the monotonic counter but
can never extend how long a lease is considered valid, and changing the
computer's clock cannot fool the broker-time side of the check.

## Broker ambiguity handling

**Unchanged and reused, not reinvented.** The existing
`XAU_ReconcileBrokerOpenTruth()` (3 retries, 100ms apart, never resends
on ambiguity) is exactly what determines whether an offline-authorized
send counts as `CONFIRMED` or `AMBIGUOUS` for consumption/reconciliation
purposes — no new reconciliation logic was written for the broker side.

## Reconnection / reconciliation design

Durable local queue file, appended to only after a confirmed/ambiguous
offline send. `XAU_LeaseUploadReconciliationQueue()` (wired into the
existing `OnTimer()`, gated by `InpOfflineLeaseEnabled`, rate-limited to
once/minute, never runs inside Strategy Tester) uploads the whole queue
in one batch to `/cloud/lease/reconcile` and clears it **only** on a
real HTTP 200 — a failed upload leaves every entry untouched. The
backend endpoint is idempotent (unique `_id` on `execution_key`),
proven by test (`test_reconciliation_is_idempotent`).

## Backend endpoints

`POST /api/cloud/lease/request`, `/renew`, `/surrender`, `/reconcile`,
`GET /status` — all authenticate via the existing, unmodified
`_resolve_monitor_license()` (same license/account-binding rules as
every other EA-facing endpoint in this codebase).

## Database indexes/constraints

`lease_terminal_authority._id` = the atomicity key (Mongo's default
unique `_id` index provides the constraint — no additional index
needed). `lease_offline_events._id` = `execution_key` (same mechanism,
gives idempotent reconciliation for free). `lease_documents` is an
append-only history collection (no uniqueness constraint needed — it is
audit trail, not a control surface).

## Admin controls / Command Center visibility

**Not built in this session.** This is the one Phase (18) explicitly
deferred given the scope already delivered elsewhere. The backend
endpoints needed to build it (`GET /admin/...` equivalents reading
`lease_terminal_authority`/`lease_documents`/`lease_offline_events`) do
not yet exist either. Flagged as a remaining task, not hidden.

## Tests run / passed / failed

- **Crypto module** (`XauCloudLeaseCryptoTestEA.mq5`, real Strategy
  Tester execution): **17/17 passed.**
- **Client module** (`XauCloudLeaseClientTestEA.mq5`, real Strategy
  Tester execution): **38/39 passed** — the one open item is the mutex
  same-tick artifact described above, not a signature/clock/ledger
  defect.
- **Backend** (`test_offline_lease.py`, live local MongoDB): **11/11
  passed** — issuance+signature validity, second-terminal denial,
  renewal sequencing, other-terminal-renewal rejection,
  surrender+reassignment, foreign-surrender rejection, idempotent
  reconciliation, no-authority-record status, fail-closed with no
  signing key, unauthenticated-pin rejection, invalid-symbol rejection.
- **Full EA compile**: **0 errors, 0 warnings** against the complete,
  otherwise-unmodified 43,000+ line production source, three times
  across the three integration commits.
- **Backend regression** (existing suites re-run individually, this
  project's established correct method — see prior sessions'
  documentation of the shared-event-loop pytest limitation):
  `test_license_binding_security.py` (9/9),
  `test_reservation_endpoint_authentication.py` (13/13, confirmed
  passing in isolation after an initial together-run false alarm from
  the known cross-file limitation) — zero regressions.
- **Not run this session** (require live infrastructure): a real
  controlled outage against the live production backend; a real
  cross-device (Mac + VPS) test with two genuine terminals; a real
  MT5/VPS restart mid-outage.

## Compile result / hashes

`0 errors, 0 warnings` (MetaEditor64.exe build 6037, isolated
`MT5_Isolated` sandbox). Source SHA-256 (both root and
`backend/ea_code/` copies, kept identical):
`b309a6f89b5563e3d4f903d3bedea6018fd1e803ab34c13c1c369fef12c58862`.

## Controlled-outage result

**Not performed against real infrastructure.** The task's Phase 20
scenario (real backend, real lease issuance, simulated outage, one real
CORE candidate, real broker position, reconciliation on reconnect)
requires a live/demo MT5 account with genuine network control and a
deployed backend with real signing keys configured — neither exists in
this sandboxed session. What **was** proven: every individual piece of
the mechanism (crypto, persistence, clock integrity, classification,
mutex, ledger, primary-terminal enforcement, idempotent reconciliation)
works correctly in isolation, via real (not simulated) execution.
Assembling them into one live end-to-end run is the most important
remaining verification step before any live use.

## Cross-device test result

Proven at the backend level (primary-terminal exclusivity tests, listed
above). **Not proven** with two actual separate MT5 terminals (a real
Mac + real VPS) — this needs the owner's own infrastructure.

## Strategy-neutrality comparison

Not run as a side-by-side replay, because it doesn't need to be: the
entire offline-fallback code path is gated behind `InpOfflineLeaseEnabled`
(default **false**) and additionally requires a reservation-claim
failure to ever be reached at all. With the input at its shipped
default, every online-path code line, branch, and value is byte-for-byte
identical to before this change — confirmed by diff review (the
`XAU_ClaimDirectionReservation`/`XAU_CanOpenDirection` edits only ever
touch classification/offline-adjacent code, never an existing branch's
outcome). No entry condition, risk percentage, lot sizing, stop-loss
logic, timing, location policy, or re-entry/pyramid/counter-excursion
strategy was changed anywhere in this diff.

## Deployment status

**Not deployed.** Not merged to `main`. Not pushed to `origin`. Not
attached to any chart on Mac or VPS. Held entirely on
`feature/xaucloud-bounded-offline-lease` for your review.

## Remaining risks

1. The one open mutex-timing test item (defense-in-depth layer, not the
   primary duplicate-prevention mechanism — see above).
2. No live/demo controlled-outage run yet.
3. No live cross-device (two real terminals) run yet.
4. Admin/Command Center visibility (Phase 18) not built.
5. The EA's trusted public-key table currently holds placeholder values
   — **must** be replaced with the real production modulus before this
   feature can do anything at all (it fails closed with an unknown-key
   rejection otherwise, which is safe but non-functional).
6. Phase 1's identity audit could not fully verify what EA build is
   currently attached to any live chart on Mac or VPS (no live terminal
   GUI access from this session) — carried over from that audit, not
   resolved here.

## Remaining manual steps (yours)

1. Generate a real RSA-2048 key pair for lease signing; set
   `XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY` (base64-encoded PEM) and
   `XAUCLOUD_LEASE_SIGNING_KEY_ID` on the backend; replace the
   placeholder `XAU_LeaseTrustedKeyIds[]`/`XAU_LeaseTrustedModulus[]`
   values in `XauCloudLeaseClient.mqh` with the matching public modulus;
   recompile.
2. Review this branch's diff yourself (or ask me to walk through it)
   before any merge.
3. Run the Phase 20 controlled-outage scenario for real, on a demo
   account, with the actual backend deployed and signing keys
   configured.
4. Decide whether to build Phase 18's admin visibility before or after
   initial live use.
5. Only then: merge, deploy, and attach — with `InpOfflineLeaseEnabled`
   left at its safe default (`false`) until you've completed step 3.

## Confirmations (explicit, per the task's own checklist)

- **10% risk**: unchanged — not referenced anywhere in this diff.
- **Lot sizing**: unchanged — not referenced anywhere in this diff.
- **Stop-loss logic**: unchanged — not referenced anywhere in this diff.
- **Entry and exit strategy logic**: unchanged — the only conditional
  added to any existing decision path is the offline-authorization
  branch, which is reached only after the *existing* online path has
  already failed for a qualifying reason, and produces the exact same
  "may proceed" or "must not proceed" outcome the rest of the function
  already handles identically either way.
- **No private signing key committed**: confirmed — `lease_service.py`
  only ever reads `XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY` from the
  environment; no key material appears in any commit on this branch
  (checked via `git log -p` review of `lease_service.py`/`server.py`/
  the `.mqh` files).
- **Backend remains the online cross-device authority**: confirmed —
  the existing `/cloud/reservation/claim` atomic claim is completely
  unmodified in behavior; the lease is consulted only after it has
  already failed to answer for a genuinely temporary reason.
- **Only one designated terminal can trade under an offline lease**:
  confirmed by test — a second terminal cannot obtain a lease for the
  same license+account+server+symbol while the first's is valid and
  unsurrendered.
