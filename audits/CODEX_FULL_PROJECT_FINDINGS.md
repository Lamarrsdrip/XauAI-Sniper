# Codex Full-Project Forensic Findings

**Audit branch:** `audit/codex-complete-xauaisniper-forensic-repair`  
**Verified audit base:** `9e4181f8115f93eb6874ac899c30e272b2637faa`  
**Claude implementation:** `f6c59b47945620b6e2b86da2fe95909330282221`  
**EA version under audit:** `v6.25.5`  
**Status:** evidence ledger plus owner-constrained repair contract; update after remediation and independent verification

## Owner-correction control contract (binding before further repair)

The owner supplied a second, more specific correction after the initial evidence freeze. It supersedes any finding language that could be read as adding strategy conservatism. Some repairs had already been staged locally when that correction arrived; further source changes were paused so this ledger could be revised first. Every remaining implementation and test must obey all of the following:

1. **One timing lifecycle only:** three completed M10 snapshots produce a qualifying M30 BUY/SELL candidate, which immediately creates its immutable identity and starts one fresh 120–180 second timer in the same decision cycle. Final outcomes are only `EXECUTE`, `CANCEL_INVALIDATED`, `CANCEL_MISSED_MOVE` (movement `>=0.30R`), or an explicit objective execution cancellation. Retrace/location labels are evidence only. They cannot create another timer, candle wait, slot wait, cooldown, pending continuation, or resurrection.
2. **Decision mode evidence:** preserve the selectable comparison during audit, but separately prove the source default, compiled default, Mac input, VPS input, and actual journaled live mode. The intended normal architecture after proof and explicit owner deployment approval is completed-M10 evidence plus the M30 three-snapshot authority; the audit must not claim M30 is live while a terminal is running legacy M10 or an older binary.
3. **Structural SL inside the same timer:** a core order requires a real structural invalidation. Missing structural data may retry only within the existing candidate timer. At expiry, a valid structural invalidation is widened exactly once by `1.20`, sized at the configured `10%`, and continues; otherwise that candidate is cancelled. No ATR-only fallback, next-candle wait, or global pause is permitted.
4. **Honest, bounded news degradation:** provider failure is `UNKNOWN/DEGRADED`, never `safe_to_trade=true`. Candidate-local retries may occur during the existing timer while local Adaptive News Momentum/current market evidence remains available. Provider unavailability alone must not create a permanent global cage; only genuine current execution risk may cancel the candidate.
5. **Crash-safe original timer:** persist candidate ID, M30 slot, three evidence IDs, original timer start, selected duration, and lifecycle state. Restart resumes only the remaining duration. An already-expired timer revalidates immediately. Restart never resets or extends the timer, carries it into another slot, resurrects a terminal candidate, or causes a second send.
6. **Immediate deterministic M10 backfill:** after restart, rebuild the last three completed M10 snapshots from closed broker history with the same historical calculations, timestamps, validation, and evidence IDs. Never use the forming candle, fabricate missing data, or inject current-tick state into historical evidence.
7. **Ambiguous broker reconciliation:** accepted retcode plus matching broker truth is required before campaign mutation. An ambiguous send cannot be resent immediately; reconcile positions, orders, and deals, then confirm/register once or fail once.
8. **Authentication is an end-to-end contract:** secure journal, ML, memory, feedback, analysis, and position routes only together with all real clients: EA, public/customer frontend, admin, and schedulers/internal workers. Valid production requests must not be broken into 401/403 by a server-only change.
9. **Optional dependencies retain features:** first prove whether `emergentintegrations` is used. Reproducible installation must not delete working AI behavior; optional providers remain optional and report unavailable states honestly.
10. **No personal strategy changes:** no new threshold, risk reduction, confirmation candle, cooldown, AI vote, anti-chase wait, loss pause, entry arbiter, or execution pipeline is authorized by these findings.

## Evidence freeze and scope

The primary checkout at `/Users/libertyelectronics/XauAI-Sniper` contained unrelated dirty work and was preserved without switching or resetting. This audit uses the clean linked worktree `/Users/libertyelectronics/XauAI-v6251-full-repair`.

`origin/main` had advanced by one commit beyond the requested Claude SHA. The newer commit, `9e4181f`, only changes wording in the v6.25.5 release manifest (`InpDecisionMode input` to `setting`) and does not change EA execution logic. The required audit branch was created from this verified newer `origin/main` head.

Canonical source hashes at the evidence freeze:

- Root MQ5 and `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`: `7d958ea2212a1c1852883b485e047f43e933fb17aa1eae1d7ed86866d2eb291a` (identical).
- Root EX5: `1d511071d6bf599593001c3926bafe4443306cb3bbf476c781f55cf86ddf58d7`.
- v6.25.5 release EX5: `168760aa7d4e279a9fb726ffa0fb74ceb9d04d4915d0546507b8c9b7d4a3c4f3`.
- The root EX5 is not the v6.25.5 release artifact.

Initial static tests for the new consensus and reservation code reported `72 passed`. That result is not sufficient evidence of safe behavior: several tests assert source fragments and preserve the defects below.

## Blocking findings

### XAU-001 — M10 can veto an approved M30 consensus

- **Severity:** Critical
- **Area:** EA final entry authority, `XAU_FinalEntryArbiter`
- **Evidence:** The final arbiter computes `m10Contradicts` from `g_m10Decision` without limiting that veto to legacy M10 mode. Consequently, an individual M10 observation can reject a three-snapshot M30 candidate.
- **Owner rule violated:** In M30 mode, the weighted three-M10 consensus is the direction authority; an individual M10 must not veto it.
- **Required repair:** Scope the M10 contradiction veto to `XAU_DECISION_M10_LEGACY` only.
- **Regression proof:** Static and behavioral tests for M30 candidate + contradictory most-recent M10.

### XAU-002 — M30 retrace states create/permit a second timing gate

- **Severity:** Critical
- **Area:** EA M30 consensus gate
- **Evidence:** The Claude implementation can classify an otherwise directional consensus as `WAIT_FOR_*_RETRACE`, postpone candidate creation until later price/bar state, and then run the separate 120–180 second timer. That is the forbidden double wait.
- **Owner rule violated:** Once the weighted M30 evidence qualifies BUY/SELL, location/retrace is evidence inside the single timer, not a state that can postpone candidate creation.
- **Required repair:** A qualifying M30 direction must immediately become `BUY_CANDIDATE`/`SELL_CANDIDATE` and start the one timer in the same cycle. `WAIT_FOR_BUY_RETRACE` and `WAIT_FOR_SELL_RETRACE` may remain display/evidence labels only and must never own execution control.
- **Regression proof:** Qualifying poor-location BUY and SELL cases create candidates immediately; retrace labels cannot postpone into another M10/M30 period or start a second timer.

### XAU-003 — Same-direction reservation race allows two terminals to send

- **Severity:** Critical
- **Area:** Backend `/api/direction-reservation/claim`; EA reservation payload
- **Evidence:** Reservation identity is only broker/account/symbol. The atomic claim query explicitly permits any unexpired reservation with the same direction, then overwrites its reservation ID. A Mac and VPS claimant in the same direction can both receive permission.
- **Owner rule violated:** Exactly one claimant may own a live candidate/execution opportunity.
- **Required repair:** Add an immutable execution key to the EA request and backend record; reject every unexpired competing claim, including same direction and same key. Permit takeover only after expiry. Retain server-side atomicity.
- **Regression proof:** Concurrent/sequential tests for same key, different same-direction key, opposite direction, and post-expiry takeover.

### XAU-004 — Duplicate core-campaign guard executes after the broker order

- **Severity:** Critical
- **Area:** EA `OpenTrade`, `XAU_CampaignAllowsNewCore`
- **Evidence:** The guard is called only after `trade.Buy/Sell` reports success. A duplicate core is therefore opened first and later reclassified as an add.
- **Owner rule violated:** Existing live core exposure must block a new core before any broker send; only the dedicated pyramid authority may add.
- **Required repair:** Call the core-campaign guard before reservation/order send and remove post-fill core-to-add reclassification.
- **Regression proof:** Source and scenario test showing no core send is reachable with an active campaign.

### XAU-005 — M30 timer/candidate identity bleeds across slots

- **Severity:** High
- **Area:** EA aligned-candidate timing
- **Evidence:** Every M30 candidate uses the constant setup name `M30_CONSENSUS_CANDIDATE`; timing identity compares only direction and setup. A later same-direction M30 slot can inherit the prior slot timer and bypass a fresh 120–180 second observation period.
- **Owner rule violated:** Each completed M30 slot and its three immutable evidence bars form a new candidate.
- **Required repair:** Include slot and evidence identity in the candidate/execution key and aligned setup identity.
- **Regression proof:** Two consecutive same-direction M30 slots must produce distinct candidate IDs and timers.

### XAU-006 — Candidate slot is persisted as processed before confirmed execution

- **Severity:** High
- **Area:** EA M30 state persistence/restart behavior
- **Evidence:** The consensus builder persists `lastProcessedSlot` as soon as a candidate is produced. A restart before order confirmation turns the candidate into `SLOT_ALREADY_PROCESSED_BEFORE_RESTART`, permanently losing it.
- **Owner rule violated:** A candidate is not an execution receipt. No-trade decisions and confirmed executions must have distinct durable states.
- **Required repair:** Persist terminal no-trade slots immediately. For an active candidate persist its full immutable ID, slot, evidence IDs, timer start, selected duration, and lifecycle. On restart restore only its remaining timer (or immediately revalidate if expired). Persist execution terminality only after accepted retcode plus reconciled broker truth.
- **Regression proof:** Restart-before-timer, mid-timer, after-expiry-before-revalidation, ambiguous-send, and after-confirmation cases prove no reset, extension, loss, resurrection, or duplicate send.

### XAU-007 — Broker acknowledgement is not confirmed before campaign mutation

- **Severity:** Critical
- **Area:** EA core, pyramid, and counter order paths
- **Evidence:** Code relies on the boolean return from `CTrade.Buy/Sell` and mutates campaign state without validating the trade-server retcode and rereading a matching live position. MQL5 documents that a successful method call alone does not prove execution.
- **Owner rule violated:** Broker truth must precede local campaign truth.
- **Required repair:** Require an accepted execution retcode plus matching position/order/deal truth before campaign registration or add accounting. An ambiguous outcome enters one reconciliation-only state: do not mutate the campaign and do not resend; inspect positions, orders, and deals and register once or fail once.
- **Regression proof:** Rejected, ambiguous then visible, ambiguous then definitively absent, accepted-and-visible, and accepted-but-not-yet-visible outcomes, including proof of no second send.

### XAU-008 — Structural stop-loss authority is optional and defaults off

- **Severity:** Critical
- **Area:** EA risk and invalidation
- **Evidence:** `InpUseStructuralSL` defaults to `false`; the normal path can use an ATR-only stop. The structural helper also has a structure-blind emergency fallback.
- **Owner rule violated:** A real-money core order requires a valid structural invalidation, with at most one controlled 1.20x widening.
- **Required repair:** Make structural SL mandatory. Structural history may retry only during the already-running 120–180 second candidate lifecycle. At expiry, use a valid structural invalidation widened exactly once by `1.20` and size at `10%`; if none exists, cancel this candidate. Remove ATR-only/emergency fallback without creating a next-bar wait or bot-wide pause.
- **Regression proof:** Temporarily missing structure retries within the same timer; valid-by-expiry proceeds once; missing-at-expiry cancels; valid structural stop respects direction, broker minimum distance, the one widening, and risk limits.

### XAU-009 — Multiple data and AI routes lack license/account isolation

- **Severity:** Critical
- **Area:** Backend journal, ML, memory, feedback, analysis and position-management APIs
- **Evidence:** Routes accept omitted PINs or no authentication, enabling cross-account journal/report reads, arbitrary ML/memory/feedback poisoning, and unauthenticated use of potentially billable AI analysis.
- **Owner rule violated:** Customer trading data and paid operational capabilities must be tenant-isolated and authenticated.
- **Required repair:** Require and validate license identity for reads and writes; bind stored/query data to the resolved customer/account; update EA payloads, frontend API calls, admin calls, and every scheduler/internal worker in the same repair so real authenticated traffic remains functional.
- **Regression proof:** Unauthenticated and cross-tenant tests return 401/403; valid EA/customer/admin/worker clients succeed with the correct tenant and cannot see another tenant.

### XAU-010 — News-provider failure is dishonestly safe and lacks bounded candidate semantics

- **Severity:** High
- **Area:** Backend `/api/news/check`
- **Evidence:** External calendar errors and exceptions return `safe_to_trade: true`.
- **Owner rule violated:** Unknown provider state must not be reported safe, but provider downtime alone must not become an indefinite trading cage.
- **Required repair:** Return a machine-readable `UNKNOWN/DEGRADED` status and honest reason. During an active candidate, retry only within its existing timer and combine that status with the existing local Adaptive News Momentum/current market evidence. Cancel only for a genuine current news/execution risk; never start or extend a separate news timer.
- **Regression proof:** Timeout, non-200, malformed response, and exception cases are never `safe=true`; bounded retries stay inside the original timer; prolonged provider downtime alone creates no global indefinite lock.

### XAU-011 — Production requirements cannot be installed cleanly

- **Severity:** High
- **Area:** `backend/requirements.txt`
- **Evidence:** `emergentintegrations==0.1.0` is unavailable from the configured Python index, so a clean pinned install stops before tests or startup. The server wraps the import as optional, but all call sites and the feature behavior when present/absent still require inventory before the dependency remedy is accepted.
- **Owner rule violated:** A production build must be reproducible from repository metadata.
- **Required repair:** Inventory every import/call site and prove whether operational AI behavior depends on it. Move it to a verifiable optional extra or replace it with a supported source while preserving any working provider feature. Absence must produce an honest unavailable/degraded state rather than deleting the feature silently.
- **Regression proof:** Clean isolated base installation and startup; optional-provider-present and optional-provider-absent tests; no working AI route disappears.

### XAU-012 — Release and deployment authority are inconsistent

- **Severity:** High
- **Area:** Release manifest, root artifact, Mac/VPS deployment
- **Evidence:** The v6.25.5 manifest names parent commit `894a8a0...`, not the Claude implementation SHA. Root EX5 differs from the v6.25.5 release EX5. The inspected Mac terminal contains v6.25.4, not v6.25.5. VPS state remains independently verifiable and must not be inferred.
- **Owner rule violated:** Source, compiled artifact, manifest, and deployed runtime must have an auditable chain of custody.
- **Required repair:** Correct release metadata, define canonical artifact locations, compile in isolation, record hashes, and report Mac/VPS state without deploying.
- **Regression proof:** Manifest/source/build hash checks plus read-only terminal inventory and journal evidence.

## Major operational findings

### XAU-013 — Public documentation describes an obsolete operating model

- **Severity:** Medium
- **Area:** Homepage and backend documentation pages
- **Evidence:** Public content describes M5 scanning and customer-side MQ5 compilation, while the canonical EA scans completed M10 candles, offers optional M30 consensus, and the controlled release is EX5.
- **Required repair:** Align homepage, architecture, installation, how-it-works, and video-guide content with the actual M10/M30 decision modes and controlled binary deployment. Avoid performance or safety claims not proven by runtime evidence.
- **Regression proof:** Content tests and desktop/mobile browser inspection.

### XAU-014 — Repository contains many stale EA copies without a singular authority map

- **Severity:** Medium
- **Area:** Repository and workstation artifacts
- **Evidence:** Historical MQ5/EX5 files exist in the repository, Applications, Downloads, and terminal directories. Several are newer-looking by name but older by content/deployment state.
- **Required repair:** Document canonical source, release artifact, runtime copy, and historical-only locations. Do not silently delete customer/user artifacts during this audit.
- **Regression proof:** Deterministic inventory with path, version, hash, and role.

### XAU-015 — Readiness telemetry conflates synchronization and indicator failures

- **Severity:** Medium
- **Area:** EA evidence freshness and recovery telemetry
- **Evidence:** Current logic predominantly reduces readiness to complete/unavailable and does not consistently distinguish series synchronization pending from indicator calculation pending.
- **Required repair:** Keep separate fail-closed states and telemetry for series sync, bars unavailable, and indicator handles/buffers pending.
- **Regression proof:** Unit/static paths for each pending condition and no-trade result.

### XAU-016 — M10 evidence history is not robustly reconstructed after restart

- **Severity:** High
- **Area:** EA three-snapshot evidence buffer
- **Evidence:** The buffer records completed M10 evidence while the EA is running but does not prove durable persistence or safe reconstruction of the prior two completed snapshots after restart. M30 can therefore remain unavailable for up to three fresh M10 closes or lose an in-flight decision.
- **Required repair:** Persist immutable completed evidence safely or deterministically backfill it from closed bars with the same validation and evidence IDs. Never synthesize from the forming candle.
- **Owner correction:** Do not wait for three new closes. Rebuild immediately from the last three completed broker M10 bars using only historical-at-that-bar inputs; current-tick regime/location/news state cannot contaminate the backfill.
- **Regression proof:** Restart at each position within an M30 slot immediately produces the same three completed evidence IDs, component values, timestamps, and M30 decision as uninterrupted operation; unavailable historical inputs produce an explicit unavailable state, never fabricated evidence.

### XAU-017 — Homepage presents invented performance claims as measured facts

- **Severity:** High
- **Area:** Public homepage hero and performance section
- **Evidence:** The hero hard-codes `Max Drawdown = 5%` and `AI Rating = 90 / 100` while labeling journal-derived values beside them. Neither number is computed or verified anywhere in the repository. The performance heading says “Verified metrics” even when the live journal has no sufficient sample or independently verified statement.
- **Required repair:** Remove invented values. Display only journal-derived values with an explicit source and sample size, and label insufficient data honestly. Do not claim independent verification when only first-party EA reports exist.
- **Regression proof:** Frontend content tests and browser inspection with empty, thin, and sufficient datasets.

### XAU-018 — Public gold ticker can display a fabricated market quote

- **Severity:** Critical
- **Area:** Backend `/api/gold/price`, public header
- **Evidence:** When the scraped third-party quote fails and no cache exists, the backend substitutes a stale hard-coded price and generates a random spread, while the homepage renders the result as a normal XAU quote.
- **Required repair:** Return an explicit unavailable/degraded response with null prices when no genuine quote or cache exists. Render no numeric ticker unless the response is marked available and identifies a real source. This public display must never feed execution decisions.
- **Regression proof:** Provider success, cached fallback, provider failure/no-cache, and frontend unavailable-state tests.

### XAU-019 — Browser bearer tokens are duplicated into script-readable storage

- **Severity:** High
- **Area:** Admin and Command Center authentication clients
- **Evidence:** Both portals receive HttpOnly cookies but also copy bearer JWTs into `localStorage`, making the same credentials readable to injected JavaScript and creating two competing session sources.
- **Required repair:** Use the server-issued HttpOnly, Secure, SameSite cookie as the single browser session mechanism. Make cookie security configurable only for explicit local development; do not return or persist browser bearer tokens. Retain explicit license authentication for the non-browser EA clients.
- **Regression proof:** Login/me/logout browser tests, no token in response body or local storage, production cookie flags, and local-development cookie override.

## Confirmed intended behavior

The reviewed v6.25.5 source does implement these portions of the requested feature:

- M10 scanning remains tied to completed M10 candles.
- M30 consensus selects three consecutive completed M10 snapshots.
- The weights are 20%, 30%, and 50%, applied oldest to newest.
- The M30 mode is optional.
- `InpDecisionMode` defaults to legacy M10 mode.

These confirmations do not override the blockers above.

## Website/Command Center findings added during browser audit

### XAU-020 — Command Center preview masqueraded sample metrics as live account data

- **Severity:** High
- **Evidence:** `/command` rendered `ONLINE`, `$12,847`, `87%` AI confidence and `18 matching samples WR 67%` without labeling the panel as a mockup.
- **Repair:** Both public preview panels are explicitly illustrative, use no account balance/performance values, and describe example lifecycle fields only.
- **Status:** FIXED in the staged frontend; contract and mobile browser proof pass.

### XAU-021 — Broker and funded-account marketing made unverified universal claims

- **Severity:** High
- **Evidence:** Public copy claimed an official partnership, a 75% bonus on every deposit, compatibility with any 5-digit MT5 broker, and unconditional funded-account support. Current official broker material did not establish the specific universal bonus claim.
- **Repair:** The link is identified as an affiliate link; changing terms/local restrictions are disclosed; compatibility is broker-specific; funded usage requires the firm's written rules and demo proof.
- **Status:** FIXED in the staged frontend; contract proof passes.

### XAU-022 — Optional push provider could break the base PWA worker

- **Severity:** Medium
- **Evidence:** Browser console showed service-worker evaluation failure while OneSignal was unavailable/not configured; `importScripts` was unconditional.
- **Repair:** OneSignal worker import is fail-soft so push failure cannot prevent base caching/update behavior.
- **Status:** PARTIAL. Static contract passes; clean production registration and real device delivery remain unproven.

### XAU-023 — Mobile overflow and inaccessible authentication labels

- **Severity:** Medium
- **Evidence:** At 390×844 the homepage measured 396px scroll width against a 384px client width; auth labels were not associated with controls.
- **Repair:** Responsive metric typography/clipping removes overflow; customer auth inputs now have stable IDs, associated labels, names and autocomplete values.
- **Status:** FIXED. Browser recheck measured 384px/384px on homepage and Command Center; 9 frontend contracts pass.

### XAU-024 — Admin EA Config offered fictional targets and unwired strategy controls

- **Severity:** High
- **Evidence:** Admin exposed 20/35/50% weekly targets, risk reductions, daily loss values and a save action even though no active EA consumes the collection. These also conflict with the owner's explicit prohibition on strategy/risk redesign.
- **Repair:** Replaced the control surface with a read-only v6.25.5 owner release contract. It cannot write a live or reference strategy configuration.
- **Status:** FIXED in staged frontend; contract/build pass.

### XAU-026 — M30 Command Center omits the actual candidate/timer lifecycle

- **Severity:** High
- **Evidence:** `M30ConsensusCard` shows the consensus and evidence IDs but not immutable candidate ID, timer start/duration/remaining, final revalidation, move-R, execution/cancel result, structural SL or reservation/execution identity.
- **Required repair:** Transport and render only actual EA-owned lifecycle fields; show missing/stale honestly; never infer from source mode or client time.
- **Status:** NOT STARTED. This is the first handover task.

### XAU-027 — Remote commands lack idempotency and immutable terminal transitions

- **Severity:** High
- **Evidence:** `/cloud/command/request` always creates a new UUID and accepts repeated submissions; `/cloud/command/ack` updates by command ID without a conditional current-state transition, permitting terminal truth to be overwritten.
- **Required repair:** Tenant-scoped idempotency key, atomic duplicate rejection, bounded expiry, and conditional lifecycle transitions with Mongo concurrency/cross-tenant tests.
- **Status:** NOT STARTED.

### XAU-028 — M10 UI implied a retracement wait

- **Severity:** Medium
- **Evidence:** The card said “waiting for a better entry price” when `retracement_required` was true.
- **Repair:** It now says location evidence is noted inside the single entry timer; no wait language remains.
- **Status:** FIXED; frontend contract passes.

## Evidence still required before a production recommendation

- Full clean backend and frontend test/build runs after repair.
- Isolated MetaEditor compilation with zero errors and an artifact hash tied to repaired source.
- Deterministic replay covering M30 direction, wait, no-trade, restart, duplicate prevention, and structural stop behavior.
- Browser verification of homepage, customer Command Center, and admin authorization/responsiveness.
- Read-only Mac and VPS inventory plus runtime journal evidence.
- Historical live M30 behavior remains unproven unless terminal journals actually contain v6.25.5 M30 evidence. Absence of evidence must be reported as unproven, not passed.
