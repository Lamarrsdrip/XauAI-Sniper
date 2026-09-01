# Offline Lease — Phase 2: Current Reservation/Execution Flow Audit

Traced by a dedicated Explore pass over `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
(43,304 lines) and `backend/server.py` (~6,400 lines). All line numbers below refer
to those two files as of `feature/xaucloud-bounded-offline-lease` branch point
(source commit `dca5f1e8...`, v6.25.28).

## 1. `XAU_ClaimDirectionReservation` — wire contract

EA: `mq5:5356-5419`. `POST {InpCloudURL}/api/cloud/reservation/claim` (5395) with
`pin, broker_server, account, symbol, direction, requesting_family, execution_key,
terminal_identity, ttl_seconds:30` (5385-5390), header `X-Agent-Token` (5393).
Expects HTTP 200 + `"claimed":true` + `"reservationId"` (raw substring parse,
5403-5415). Inside `MQL_TESTER`, network is bypassed with a synthetic
`TESTER_LOCAL_...` id (5377-5384) — meaningless in live/demo.

Backend: `POST /api/cloud/reservation/claim`, `server.py:5566-5639`. Atomic
`find_one_and_update(upsert=True)` keyed on `broker_server:account:symbol` only
(5561-5562, 5605-5624) — **direction is not part of the lock key**, so a BUY and a
SELL claim for the same account/symbol contend for the same slot. Contention →
HTTP 200 `{"claimed": false, "reason": "ACTIVE_EXECUTION_RESERVED", ...}`
(5632-5639). Release: `POST /api/cloud/reservation/release`, `server.py:5641-5671`,
best-effort from the EA (`mq5:5425-5447`, no retry — relies on the 30s TTL).

## 2. Candidate creation and immutability point

Mutable readiness state: `g_readiness[slot]` (`mq5:6656`), managed by
`XAU_UpdateEntryReadiness()` (`mq5:6815-6894`) — freely replaced/invalidated, not
itself the trigger.

**Immutable at the call to `OpenTrade()`** (CORE path `mq5:20895`). Comment at
`mq5:20899-20902`: *"One terminal attempt per immutable candidate. Success or
failure ends this timing lifecycle; no readiness recheck can resurrect it."*
Identity: `XAU_CoreExecutionKey(signal)` (`mq5:14998-15013`, used at `22969`);
`g_pendingTimingProof.candidateId` invalidated unconditionally after every
`OpenTrade()` attempt (e.g. `23230`, `23303`).

## 3. Every real order-submission path

All four funnel through `XAU_CanOpenDirection()` (`mq5:5511-5547`): local
position/order scan → `XAU_ClaimDirectionReservation` (5526) → post-claim local
rescan, releasing on failure (5539-5541).

| Path | Reservation call | Broker send | Post-send |
|---|---|---|---|
| CORE (`OpenTrade`, `21723`) | `22970` | `trade.Buy/Sell` `22984-22985` | `XAU_ReconcileBrokerOpenTruth` `22993`; release on non-accepted retcode `23043-23044`; accepted-but-unreconciled → reservation left to expire (`23032-23037`) |
| RE_ENTRY (`CheckReEntryOpportunity`, `12929`→`OpenTrade` `13044`) | same as CORE (not a separate send path, comment `2008-2012`, `21713`) | same | same |
| MANUAL_FORCE/recovery (`XAU_TryForceOpenTrade`, `36030`/`36283`) | same `XAU_CanOpenDirection` inside `OpenTrade` (reservation is **not** bypassed by force override, only the local GV lock is — `21794`, `22904`) | same | same |
| PYRAMID (`~18440-18660`) | `18493`, execution key includes campaignId+add-count (`18489-18492`) | `18513-18514` | `XAU_ReconcileBrokerOpenTruth` `18521`; release on non-accepted `18560-18561` |
| COUNTER_EXCURSION | `37140`, key includes truncated candidateId (`37136-37139`) | `37149-37150` (temporarily-swapped magic) | reconcile `37159`; release on non-accepted `37165-37166` |

Raw `OrderSend()` at `41544` is **not** an entry path — `TRADE_ACTION_SLTP` only
(line 41539), i.e. trailing/breakeven SL modification on an already-open position.

**On claim failure, all four paths return before the broker-send line is ever
reached** — no order is sent, full stop.

## 4. WebRequest failure/timeout classification (current — none exists)

`WebRequest(..., InpCloudTimeoutMs, ...)` at `5395` (claim) / `5445` (release).
`InpCloudTimeoutMs` default `5000` ms (`2717`). **No retry loop anywhere.** Any
`code != 200` → `failReason = "RESERVATION_BACKEND_UNREACHABLE httpCode=%d
err=%d"` using `GetLastError()` (5396-5400). A genuine timeout, DNS failure, and
a real backend 4xx/5xx **all collapse into the same string** — the EA never
branches on the specific error/HTTP code today. This is the single biggest gap
this task's Phase 6 classification work must fix.

## 5. "Backend said no" vs "didn't answer" — currently only one bit of distinction

- Not-200 (anything) → `RESERVATION_BACKEND_UNREACHABLE` (5396-5400)
- 200 but `claimed:false` → `ACTIVE_EXECUTION_RESERVED_BY_ANOTHER_TERMINAL_OR_FAMILY` (5403-5408)

Both block identically via `XAU_CanOpenDirection`'s `blockReason` (5528-5530) — the
caller never treats them differently. Critically: a 403 (wrong account/tenant, per
`server.py:4448-4488`) and a 400 (validation, `server.py:5589-5599`) both fall into
the same "unreachable" bucket as a real timeout today, because the EA only reads
the numeric HTTP code / `GetLastError()`, never the JSON error body. **This exact
conflation is what Phase 6's strict classification (`AUTHENTICATION_FAILURE` /
`VALIDATION_FAILURE` must never be treated as `TEMPORARY_CONNECTIVITY_FAILURE`)
must replace.**

## 6. Duplicate-send prevention today (local only, not cross-machine)

- Cross-chart-instance lock: `XAU_TryClaimEntryLock`/`XAU_CrossInstanceEntryLockActive`
  (`4015-4073`), `GlobalVariableSetOnCondition` compare-and-swap on
  `XAUAI_ENTRYLOCK_<scope>_<BUY|SELL>` (4015-4017). Checked at `21794`, claimed
  again immediately before send at `22904`.
- Execution-key strings: `XAU_CoreExecutionKey()` (`14998-15013`) for CORE/RE_ENTRY;
  inline `StringFormat` for PYRAMID (`18489-18492`) and COUNTER_EXCURSION
  (`37136-37139`). Sent to the backend as `execution_key` and stored
  (`server.py:5610`) but **the backend does not currently use it for duplicate
  rejection** — the atomic lock key is `broker_server:account:symbol` only
  (5561-5562); `execution_key` is echoed back for diagnostics only (`sameExecution`,
  5638).
- Neither mechanism is a durable, restart-surviving idempotency key tied to one
  specific candidate — the entry-lock GV only stores a short-TTL timestamp, not an
  execution/candidate identity. **This is exactly the gap Phase 11's deterministic
  execution key must close.**

## 7. Restart/chart-reload recovery (positions only, not in-flight candidates)

`OnInit()` (`10775`) calls `XAU_ReconcileCampaignOnInit()` (`6194-6230`), which
rebuilds `g_campaign[slot]` **purely from live broker positions**
(`PositionsTotal()`, 6197-6202) — no persisted candidate/reservation/timing-proof
file is read. Reconstructed campaigns are marked `originSetup = "RESTART_RECONCILE"`
with lifecycle history reset to conservative defaults (6214-6227). **Any candidate
mid-evaluation or mid-reservation at the moment of restart is simply gone** — none
of `g_readiness`/`g_pendingTimingProof`/`g_alignedCandidates` are file-backed. A
separate file-backed basket-exit state (`XAU_CampaignBasketStateFilePath()`, 6249,
schema v7 at 6246) persists *exit* floor/peak data only — irrelevant to entries.
**This confirms Phase 8/9's persisted lease + execution-state file is genuinely new
infrastructure, not an extension of something that already exists.**

## 8. Ambiguous broker execution reconciliation

`XAU_ReconcileBrokerOpenTruth()` (`5457-5494`). After an accepted retcode
(`XAU_BrokerOpenRetcodeAccepted()`, `5449-5452`), retries up to 3× with 100ms
sleeps (5467-5490) matching `HistoryDealSelect` → `XAU_FindLivePositionByIdentifier`.
Never resolved within 3 attempts → logs `BROKER_OPEN_AMBIGUOUS_TERMINAL |
reconciled=false resend=false` (5491-5493) and returns `false` — **explicitly never
resends**. `OnTradeTransaction()` (`31461+`) only does post-fact bookkeeping
(`DEAL_ENTRY_IN` capture at 31482, R-exit cleanup on `DEAL_ENTRY_OUT*` at 31520) —
it does not drive reservation logic. This existing "never resend on ambiguity"
discipline is exactly the property Phase 12's `AMBIGUOUS` state must preserve and
extend to the offline path.

## 9. Backend reservation endpoint — full logic

`cloud_reservation_claim()` (`server.py:5566-5639`). Validates direction ∈{1,-1}
(5588-5589), non-empty broker_server/account/symbol (5591-5592), symbol allow-list
`{"XAUUSD","XAUUSDm","XAUUSD.","GOLD"}` (5593-5595), license/tenant/account binding
via `_resolve_monitor_license()` (5596; full logic `4422-4491` — first-bind on an
unbound license, 403 `LICENSE_BOUND_TO_DIFFERENT_MT5_ACCOUNT` on mismatch),
`execution_key` non-empty/≤240 chars (5597-5599). **No direction-level
exclusivity** — the lock key is account+symbol only, not account+symbol+direction.
Duplicate detection: real atomic `find_one_and_update`+`upsert` racing
`DuplicateKeyError` (5605-5628), not read-then-write.

Responses: success → 200 `{"claimed":true,"reservationId","expiresAt"}` (5627);
contended → **200** `{"claimed":false,"reason":"ACTIVE_EXECUTION_RESERVED",...}`
(5632-5639); validation → 400 (5589/5592/5595/5599); auth → 403 (inside
`_resolve_monitor_license`, e.g. 4448/4481). Release
(`cloud_reservation_release`, 5641-5671) only honors a match on both
`reservation_id` and the caller's resolved `licenseId` (5658-5659); a foreign
release attempt is logged, not honored (5665-5669). Expiry is purely lazy — a
reservation only becomes reclaimable once `expiresAt <= now` on someone's *next*
claim attempt (5606); no background sweep observed in this code path.

## 10. Why the backend is currently mandatory — the exact fail-closed code

**No existing offline/cached fallback path exists anywhere** in the current flow —
confirmed absent across `XAU_ClaimDirectionReservation`, `XAU_CanOpenDirection`, and
all four order-submission sites; nothing references a local file, cached
reservation, or "previously approved" bypass outside the `MQL_TESTER`-only branch
(5377-5384, meaningless in live/demo since a live terminal is never `MQL_TESTER`).

Exact chain: `XAU_ClaimDirectionReservation` returns `false` on `code != 200`
(5396-5400) → `XAU_CanOpenDirection` propagates `false` with
`blockReason="CROSS_INSTANCE_RESERVATION_DENIED reason=RESERVATION_BACKEND_UNREACHABLE..."`
(5528-5531) → every call site (CORE/RE_ENTRY/MANUAL `22970-22975`, PYRAMID
`18493-18499`, COUNTER_EXCURSION `37140-37145`) logs and `return`s **before**
`trade.Buy`/`trade.Sell` is ever reached. Design intent stated explicitly at
`mq5:5353-5355`: *"Fails CLOSED: if the backend is unreachable or rejects the
claim, the order does not send — this is a deliberate, owner-requested safety
property... not an accident."* Corroborated by a real-world data point at
`mq5:5361-5366`: a 30-day Strategy Tester run (no network path) produced **zero
trades**, every qualifying candidate blocked by this exact code path — direct
proof that today, a backend outage of any length cancels 100% of would-be entries
with no offline continuation. This is precisely the single point of failure this
task removes, without touching anything upstream of this one gate (signal
generation, grading, timing, risk, all unchanged).

## What this means for the design (carried into `03_lease_architecture.md`)

- The lease-check must slot into `XAU_CanOpenDirection()` as an **alternative path
  when `XAU_ClaimDirectionReservation` returns the new `TEMPORARY_CONNECTIVITY_FAILURE`
  classification specifically** (not any other failure) — everything else about
  `XAU_CanOpenDirection`'s local scan, GV mutex, and post-claim rescan stays intact
  and unmodified for both the online and offline path.
- The existing local GV mutex (`XAU_TryClaimEntryLock`) and execution-key strings
  are real but insufficient for the new requirement (restart-survival, deterministic
  across retries) — Phase 10/11 build a proper deterministic key + persisted mutex
  state on top of, not replacing, this existing local scan.
- `XAU_ReconcileBrokerOpenTruth`'s "never resend on ambiguity" behavior is exactly
  right and must be reused verbatim for offline-authorized sends, not reinvented.
- The backend's HTTP-200-for-a-deny pattern (`claimed:false` still 200) means the
  EA's new classification logic must parse the **response body**, not just the
  HTTP status, to distinguish `ONLINE_DENIED`/`DUPLICATE_OR_CONFLICT` from a true
  `SERVER_TEMPORARY_FAILURE` — the current code's status-code-only check is the
  root cause of today's conflation described in §5 and is the main thing Phase 6
  must change.
