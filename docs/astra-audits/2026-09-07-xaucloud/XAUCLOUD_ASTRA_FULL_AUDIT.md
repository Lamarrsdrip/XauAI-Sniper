# XauCloud Astra forensic audit — consolidated evidence report

Date: 2026-09-07. Status: INCOMPLETE; audit-only.

## 1. Executive verdict

**CRITICAL — DO NOT DEPLOY/TRADE** is the readiness recommendation for the audited source, driven by the P0 admin authorization defect and unresolved execution/accounting defects. No production action was taken.

**AUDIT COMPLETENESS: INCOMPLETE.** This is the consolidated evidence report under the requested filename, not a claim that the requested full-platform forensic audit is 100% complete. There are 22 confirmed source defects: 1 P0, 15 P1 and 6 P2. Several were reproduced through actual Node functions/routes with isolated MongoDB fixtures. None is claimed as a confirmed live incident.

The repository inventory covers 1,482 tracked files, but most remain inventory-only. The coverage JSON explicitly distinguishes inventory, targeted functions and whole-file source review. Finding many serious defects does not satisfy the remaining coverage requirement. The Claude implementation prompt is withheld because the owner explicitly requires full audit completion before its creation.

## 2. Audited commit and release identity

Repository: `Lamarrsdrip/XauAI-Sniper`. Actual main SHA checked for this audit: `4cb9d64559fe05272f085832204a586a86c5151e`. Current inspected release: `v6.28.6`. This is a fixed snapshot; no claim is made about commits published after the recorded check. The audit used an isolated clone and did not alter tracked production source.

## 3. Scope and evidence limitations

All requested subsystems remain in scope. Evidence is strongest for the targeted EA execution/Outlook boundaries, Node authentication/licensing/learning/payment boundaries, and existing tests/builds. Remaining gaps include exhaustive setup/gate/exit inventory, all production route authorization and data scopes, full mobile/web behavioral QA, Python runtime tests, all database index/TTL contracts, native MT5 behavior and attached-binary provenance.

No production database, private VPS/MT5 logs, broker history, attached terminal, native MetaEditor or production Global Brain settings were inspected. Public health/readiness/release metadata were queried read-only. A source defect does not establish why a particular real trade won, lost or failed to open. An unavailable environment is marked UNVERIFIED; it does not become PASS.

## 4. Architecture map

| Component | Source/runtime | Dependencies and truth | Consumers/status |
|---|---|---|---|
| Trading EA | `backend/ea_code/XauCloud.mq5`, MQL5/MT5 | Broker quotes, history/positions, local persisted state, license/reservation/lease APIs | Own broker actions; advertised current source; attached binary unverified |
| Lease client | `backend/ea_code/lease/`, MQL5 includes | Signed lease, local campaign counter/reconciliation queue | Offline entry authority; queue failure in 020 |
| Node API | `backend_node/src/index.ts`, Fastify | MongoDB, provider APIs, static frontend | `/api` web/mobile/EA routes; current deployment candidate; exact live commit unverified |
| Python API | `backend/server.py`, FastAPI | MongoDB, Python services/local-AI ecosystem | Legacy alternative with overlapping routes; deployment authority unverified |
| Outlook | Node `marketOutlook*`, `manualTradingMarketStore`, `outlookExecution` | Broker evidence, account-scoped records, lifecycle | Customer thesis, subscriber mirror, passive EA feed |
| TradeBrain | EA TradeBrain functions/local files/seed | Position history and local fingerprints | Current pre-entry advisor is non-vetoing in inspected function |
| Global Brain | Node `globalBrain*` | Observations → resolved labels → bucket estimator → registry/settings | Shadow and optional downgrade consumers; deployed switches unverified |
| Web | `frontend/src`, React; `backend_node/public` deployment build | Node API, browser auth/cache | Command Center/admin/customer pages; build proven, full UI QA outstanding |
| Mobile | `mobile/src`, Expo/React Native | Same `/api`, SecureStore, native push | Real API configured; native install/device QA outstanding |
| Payments | `purchase.ts`, `paymentFulfillment.ts` | Paystack/Nomba verification or bank admin approval → transaction → license/subscription | Entitlements, delivery email; interrupted fulfillment defect 021 |
| Notifications | `notifications.ts`, `webPush.ts`, `expoPush.ts` | Preferences, device subscriptions, notification log, receipts | First-party web push + Expo; transient failure defect 022 |
| Academy | Academy routes/services | Server lesson/quiz progress and certificates | Web/mobile learners/public certificate verification |
| Apex bridge | Cloud Apex bridge routes | Shared license infrastructure with bridge-specific configuration | Intentional adjacent product; exhaustive namespace isolation unverified |
| CI/release | `.github/workflows`, manifests, release scripts | Tests/builds/checksums and artifact promotion | Does not prove native compile or attached terminal identity |

Supporting inventories: `node-import-reachability.json` (148 statically reachable modules), `route-candidates.json`, `collection-references.json`. These inventories are navigation evidence, not proof that every runtime branch was audited.

## 5. Production and legacy map

Current source authority is the plain XauCloud EA and the registered Node routes. Old Aurum names, historical audits, compile logs and release notes are leads rather than execution proof. `analysis/`, `audits/`, `test_reports/` and `compile_logs/` have inventory-level historical classifications; their individual reachability is not universally proven. Python remains deployment-unknown. The old domain TLS failures do not prove that no Python service exists. The EA counter-excursion build is disabled by `#define XAU_COUNTER_EXCURSION_BUILD false` at line 2096 and returns before entry at 39653.

## 6. Release and binary truth

| Artifact | SHA-256 / result |
|---|---|
| Current MQ5 and release MQ5 | `c9317718b39b1af98c459248e9e7c037b15de289cb006e881645195a4f74f5ea` — identical |
| Python-side and Node-side v6.28.6 EX5 | `43e5e9428a87bbdd7f2e73a3aefa9b5be43aca7295e456c90f9d156760be3735` — identical |
| Public download metadata | v6.28.6 and matching EX5 checksum at the recorded probe |
| Licensed downloaded bytes | UNVERIFIED; metadata is not a byte download |
| Compiler-input-to-EX5 correspondence | UNVERIFIED independently; manifests/logs alone are insufficient |
| Mac/VPS/attached running EA | UNVERIFIED |

`release-hashes.json` also retains both manifest hashes. Download source verifies artifact hash before serving bytes, but the public info endpoint reports manifest metadata. Old branch/source-commit fields require reconciliation; they do not by themselves prove a mismatched EX5.

## 7. EA architecture

The inspected graph is startup/persisted state → license/cloud and indicators → closed-M10 snapshot → setup/candidate → aligned timer → timing authority → final arbiter → structural geometry/sizing/margin → direction reservation or lease → broker send → readback/position state → management → close transaction → journal/learning. The 47,246-line EA was reviewed by targeted reachable paths, not exhaustively line-by-line. Restart and all persisted-state invariants remain incompletely tested.

## 8. Candidate and execution pipeline

| Entry family | Observed source/call | Authority distinction |
|---|---|---|
| PRIMARY | `OpenTrade` caller 22879; arbiter 22780 | M10 candidate, shared timing/arbiter, central send |
| RE_ENTRY | caller 14119; arbiter 14095 | Campaign/re-entry prerequisites followed by shared entry authorities |
| OUTLOOK_ALIGNED | caller 45875–45876; arbiter 45792 | Passive thesis context; shared timing/arbiter, but freshness/identity defects 007/008/019 |
| PYRAMID | direct CTrade sends 20267–20268 | Dedicated addition gates; no call to shared final arbiter on this path |
| Owner manual/force | callers 39036 and 39146 | Deliberate manual override; central OpenTrade broker boundary |
| Counter excursion | sends 40021–40022 | Build-disabled before reachability in current build |

Other broker actions include direct `OrderSend` around 44880 and SL/close wrappers. The complete authority graph is not yet certified exhaustive. `ea-execution-call-candidates.json` preserves search evidence. Manual override is distinct from an accidental strategy bypass.

## 9. M10 engine

Closed-bar snapshot state uses bar identity, attempts, same-market-tick retry guards, indicator preflight and stable closed-buffer copies. READY requires all required indicator groups; WAIT can retry and advance to a newer bar. Terminal bar ledger prevents watchdog rescanning of a terminal bar. The degraded decision path downgrades entry rather than treating incomplete data as full conviction. However transition cache freshness can bypass the age check, and Outlook can prime it before stable snapshot refresh (019). Consequently a universal immutable-current-evidence guarantee is FAIL despite passing source/mirror tests.

## 10. Setup inventory

Confirmed entry families are PRIMARY, RE_ENTRY, PYRAMID, OUTLOOK_ALIGNED and explicit owner manual/force. Current counter excursion is dormant. Primary decisions combine pattern/directional evidence, grade, regime, location, exhaustion and transition context. OUTLOOK_ALIGNED is a constant candidate setup name with server thesis metadata, exposing the identity collision in 008. The detailed inventory of every pattern family and mandatory/optional condition, timeframe, expiry and regime is incomplete; family enumeration must not be represented as that complete setup inventory.

## 11. Entry funnel

Observed funnel: closed-M10 availability → indicator readiness → directional case/confluence → grade and finalized setup → aligned candidate → existing 120–180-second timing lifecycle → TimingAuthority → FinalEntryArbiter → structural SL → configured sizing/margin → direction authority → send → retcode/readback → registered fill.

The engine separates readiness retry from terminal market rejection. Structural geometry, margin, reservation failure and broker rejection can stop an otherwise valid candidate. Exact rejection/reset/expiry/dashboard mappings for every gate remain incomplete. Connected heartbeat is insufficient to prove progress through any of these stages.

## 12. Silent and no-trade funnel

Confirmed silence/truth risks: stale transition cache (019), old thesis/timer inheritance (007/008), mismatched broker accepted status (010), required index failure hidden by READY (013), and stale Connected UI (014). A heartbeat proves delivery of that heartbeat, not healthy indicators, scanner progress, a matured candidate, available margin or successful broker execution. Existing owner confirmations and configured restrictions must not be removed merely to increase activity.

## 13. Entry timing

The inspected aligned candidate lifecycle enforces an existing absolute 120–180-second timing window. The Outlook wait path preserves an armed candidate through ordinary wobble and calls TimingAuthority for ceiling expiry. This is not evidence of an optimal entry delay. Same-direction replacement Outlook IDs can inherit a prior candidate timer (008). Fix identity/reset behavior while preserving approved timing values; no strategy-tuning conclusion is supported.

## 14. TimingAuthority

`XAU_TimingAuthorityAllows` is used by inspected PRIMARY, RE_ENTRY and OUTLOOK_ALIGNED paths. Candidate setup/direction determine matching; source identity is not sufficient to distinguish replacement Outlook theses. Native clock/restart/new-bar scenarios remain outstanding. The PYRAMID path uses its own timing bucket rather than this complete shared authority.

## 15. FinalEntryArbiter

Observed real calls are RE_ENTRY 14095, PRIMARY 22780 and OUTLOOK_ALIGNED 45792. Definition 42389 evaluates caller-provided gate booleans, remaining reward room, M10/thesis contradictions and remote-stop behavior with policy exceptions. It is not an independent broker transaction verifier and is not universally called by all send paths. The normal callers pass several literal true flags, so the presence of this function cannot prove that each input prerequisite was independently recomputed. The intended pyramid/manual exceptions require explicit owner-policy mapping, not automatic addition of new blockers.

## 16. Exhaustion, transition and readiness

Distinct-bar dormancy logic can reduce persistent exhaustion, bounded by its current gap/step logic; continuation/reversal resets were inspected. Passing mirror tests are not native proof. The important remaining defect is cache validity (019): a bar-key-only return precedes the freshness test, and new-bar computation can use pre-refresh buffers. Weekend reset clears transition state in a specific session-reopen path; this does not resolve the same-bar stale-cache branch.

Six v6.28.6 claims are assessed below at source level, with native limits:

| Claimed fix | Verdict | Evidence/limit |
|---|---|---|
| Direction-aware BucketTiming | PARTIALLY FIXED | Direction-aware implementation exists; pyramid still calls without direction at 20030. Intended pyramid policy must be resolved before classifying its effect. |
| Sustained exhaustion/dormancy decay | NOT PROVABLE natively | Source/mirror tests pass; inspected distinct-bar decay exists. |
| Structural pivot search | NOT PROVABLE natively | Bounded pivot search and ATR sanity logic exist; native geometry/broker tests absent. |
| Outlook identity/grade/location | PARTIALLY FIXED | Current path populated, but replacement thesis identity remains defective (008). |
| Exit attribution | PARTIALLY FIXED | Current reason handling exists; shared Boolean-success boundary and journal attribution remain defective (009/016). |
| Retired legacy Outlook execution | PARTIALLY FIXED | Current passive path and retirement code inspected; complete native persisted-old-state migration behavior unverified. |

These verdicts deliberately do not re-report all historical defects as current bugs.

## 17. Structural SL

The inspected pivot search scans closed pivots (indices 2–28 within its pivot budget), checks direction and existing ATR sanity bounds, and selects a qualifying structural pivot rather than inventing an ATR fallback. Broker readback and emergency handling exist on the open path. Full symbol-digit/freeze/stops-level, widened-distance, restart-reconstruction and failed-modification scenarios have not been demonstrated in MT5. No new SL philosophy is recommended.

## 18. Broker execution

Open-result helper at 5855 accepts DONE/DONE_PARTIAL. PLACED is excluded and the rejection path releases authority (010). Reconciliation checks deal/history/live own-magic symbol/direction with bounded readback attempts; these checks do not justify resending ambiguous requests. Shared position close/modify wrappers use CTrade Boolean success inadequately (009). Some R-exit callers additionally read back the position, so the defect must not be generalized to every caller.

The [MQL5 PositionClose documentation](https://www.mql5.com/en/docs/standardlibrary/tradeclasses/ctrade/ctradepositionclose) requires evaluating the trade-server result, and the [return-code enumeration](https://www.mql5.com/en/docs/constants/errorswarnings/enum_trade_return_codes) distinguishes PLACED, DONE and DONE_PARTIAL. No native hedging/netting/partial-fill/requote validation was performed.

## 19. Re-entry

The inspected re-entry caller funnels through shared timing/final entry and OpenTrade after re-entry prerequisites. Complete campaign close → better-price/reset → new evidence → restart reconstruction behavior remains unverified. Do not invent a cooldown or remove a configured cooldown as a substitute for proving those state transitions.

## 20. Pyramid

Pyramid directly sends through CTrade after dedicated direction/spacing/addition conditions. It calls `XAU_BucketTiming(pyramidTransition)` without explicit direction and does not call the shared final arbiter. The source contains a dedicated two-gate addition policy. Whether the general shared-authority requirement supersedes this policy is **OWNER DECISION REQUIRED**. No arbitrary max-layer rule, new timing delay or exposure cap is authorized. Duplicate-send/restart/consumed-evidence behavior needs native validation.

## 21. Exit and profit management

The inspected shared close firewall checks position ownership/magic and caller authority, rejects certain legacy contexts, and preserves existing owner floor/deadline behavior. Partial-close helper is disabled in the inspected path. R-exit code confirms position disappearance in addition to its send result. OnTradeTransaction journals final OUT/OUT_BY exits; partial exits return earlier. Full exit-reason inventory and every manual/remote/basket/orphan path remain incomplete. Fix broker-result and per-position journal truth before interpreting exit analytics.

## 22. TradeBrain reality report

The inspected current pre-entry advisor function returns true with lot multiplier 1, including collect/off/warning branches. The validated seed reports four warnings and zero active blockers in the inspected integrity path. This supports non-veto authority for that function; it does not prove every TradeBrain artifact is correctly collected or version-isolated.

| Layer | Observed role | Limit |
|---|---|---|
| Local trade/fingerprint storage | Collection/persistence | Complete corruption, restart and version-mixing validation outstanding |
| Seed cohorts | Advisory warnings | Not evidence of online training or profitability |
| Pre-entry advisor | Non-veto in inspected current function | Full legacy/config interaction not exhaustively proven |
| Hard-block-looking inputs | Must be classified by callers | Names alone do not grant authority |

TradeBrain must remain separate from Global Brain. No repair should enable veto or risk resizing without an established specification.

## 23. Global Brain learning report

Observed pipeline: ingestion hooks → observation dedupe keys → labels/counterfactual features → question-specific bucket estimators → chronological training/holdout and account-diversity checks → challenger/promotion registry → shadow lookup/optional live downgrade. This is an actual data-driven estimator pipeline, not merely a label, but its live quality is unproven.

Resolved observations can be overwritten by unresolved replay (011), and failed promotion can remove the current champion (012), both reproduced. Trade labels inherit journal defects (015/016). Account-diversity checks exist; intentional global pooling is not itself tenant data leakage. Source/version/tester provenance and full chronology/counterfactual correctness remain incompletely audited. Repair labels and atomic registry transitions before evaluating learned performance.

## 24. Manual Trading Intelligence

EA-originated bid/ask evidence enters a durable account-scoped H1/H4/D1 store, but the current generation path consumes latest EA/M10/thesis fields rather than those durable candles (005). Persistence alone is not higher-timeframe intelligence. Timestamp parsing and arrival-order OHLC are defective (004), so wiring the store without repairing provenance would propagate corrupted evidence. Higher-timeframe strategy details absent from approved requirements require an owner decision.

## 25. Market Outlook data provenance

The inspected current Outlook path uses EA/broker evidence. Public macro/proxy feeds exist elsewhere but their mere presence is not evidence that they price the current Outlook. No blanket claim of complete fallback elimination is made. Controlled tests show valid ISO source time replaced by receipt time, malformed time accepted, and late-arriving older quote changing close/last timestamp incorrectly. Account, canonical symbol and original broker symbol must remain explicit in repaired data contracts.

## 26. Outlook lifecycle

Observed lifecycle spans generation/publication, tracking/milestones/timeouts and history. Passive EA theses have ACTIVE/superseded/expiry semantics, but their publication supersede-then-insert is not atomic (006). The isolated concurrency test produced two ACTIVE theses. Lifecycle invalidation is not reliably propagated to passive thesis revocation (007). The complete transition table for every milestone, expiry and publication state remains incomplete; do not equate target milestones with invalidation without the owner specification.

## 27. Outlook and EA coordination

Outlook is currently passive context rather than a new independent execution command. EA polling → freshness → context classification → OUTLOOK_ALIGNED candidate → shared timing/arbiter → OpenTrade is the intended inspected path. Defects are replacement identity (008), missing lifecycle revocation (007), concurrent thesis truth (006) and pre-refresh transition state (019). Fix those contracts together; never restore old OUTLOOK_SIGNAL_OPEN auto-fire or make Outlook bypass M10.

## 28. AI, ML and local AI

Local relay source verifies worker authentication through configured secret or signed timestamp/nonce/body hash, scopes job identity by license/account/signature, and validates allowed setup relationships and confidence. Missing worker configuration fails with service unavailable. These targeted checks do not certify the entire worker claim/retry/result state machine or every AI route. Global Brain BOT/M10/OUTLOOK influence defaults OFF in source and is intended to downgrade existing opportunities; production switch values and all consumers were not observed live.

## 29. Node backend

Fastify registers EA, customer, admin and provider routes under `/api`, serves the built frontend, and starts background Outlook/learning/notification/email/social tasks. It can listen before startup dependencies are ready. Required unique-index failures can be swallowed while readiness advances (013). Node tests/typecheck/build pass subject to the recorded initial timeout rerun. Route inventory and 148-module import graph do not substitute for full route-level authorization/tenant review.

## 30. Python backend and legacy parity

Python source remains present with overlapping API/services. The admin token-purpose defect also appears in the inspected Python admin boundary. The local startup initially lacked dotenv; isolated dependency installation then failed on Python 3.14 because pinned grpcio-status conflicts with google-api-core requirements for that interpreter. CI uses Python 3.11, so this is an environment limitation, not proof that CI or production Python is broken. Python tests/security audit were not completed. Deployment status remains UNVERIFIED.

## 31. Licensing

EA monitor authentication normalizes the PIN and atomically binds an unused license to its first MT5 account. Customer account ownership is a separate path: concurrent unowned-license claims can link two users (003). Preserve this distinction; a passing monitor-binding implementation does not validate customer ownership. Download authority rechecks active license in inspected source. Owner revocation/all-session and Apex namespace behavior require further end-to-end coverage.

## 32. Leases

Lease signing uses fixed-field canonical payload and RSA-2048/SHA256 with the required exponent and field ordering. Authority is keyed by license/account/server/symbol and stores holder, sequence and expiry. Concurrent renewal fencing, namespace normalization and offline terminal replay require further validation. Confirmed cross-system defect 020: storage exceptions receive a successful reconciliation envelope, after which the EA deletes its local queue solely on HTTP status. Do not increase offline allowance to repair acknowledgement loss.

## 33. Reservations

Direction reservation source and central broker direction authority were inspected. Accepted/ambiguous outcome reconciliation must retain authority until broker truth resolves; PLACED currently follows rejection/release (010). VPS/Mac simultaneous live broker exposure and delayed transaction scenarios were not run. Reservation TTL is not proof that a delayed broker action did not execute.

## 34. Commands

Current allowlist includes pause/resume/stop, exact-ticket close, close-all, sync/report, configuration, force candidate and manual-now. Payload normalization validates direction and exact numeric ticket. Terminal command statuses are intended immutable and ACK routes were inspected. Old PENDING OUTLOOK_SIGNAL_OPEN commands are retired at startup. Full requested → delivered → ACKED → executed versus broker-confirmed command truth, replay and multi-terminal scenarios remain incompletely validated.

## 35. Heartbeat and monitoring

Heartbeat records represent backend receipt and license/account context. They do not attest scanner progress or fills. Dashboard polling can keep cached Connected state after required endpoint failures (014). Monitoring needs separate timestamps for heartbeat, market snapshot, scanner decision and broker reconciliation under the existing product contract; missing information should be explicit rather than fabricated.

## 36. Web Command Center

CloudDashboard uses grouped API polling and cached status. A failed required Promise.all member prevents fresh siblings from updating, while non-auth failures preserve old status. Connected is not locally aged (014). Existing frontend tests and production build passed. Browser interaction, stale-response ordering, all buttons and full admin/customer screens were not exhaustively exercised.

## 37. Admin

The admin authorization boundary accepts wrong-purpose customer and pending-MFA JWTs (001), reproduced through actual guards and token issuers with synthetic accounts. This undermines protected settings, license/control and data boundaries. Payment recovery admin action calls the same stranded state-machine functions (021). Confirmation tokens/action permission modules exist, but exhaustive admin automation permissions/replay audit remains outstanding.

## 38. Mobile

Expo/React Native is configured to use the real `https://xaucloud.io/api` API, with mock mode false and SecureStore authentication. The API deadline ends when headers arrive, leaving response-body reads untimed (018). Nine existing tests, TypeScript and web export succeeded. Web export is not iOS/Android validation. Native permissions, push receipt/deep-link/logout isolation, background/foreground refresh and screen interaction remain unverified.

## 39. Web and mobile parity

Both clients consume the Node production API; that is connectivity evidence, not parity certification. Auth, licensing, monitoring, Outlook, signals, Academy and billing contracts need response/error/staleness comparisons. Existing frontend/mobile test coverage is uneven. Do not show broker state as current solely because either UI retained an old successful response.

## 40. Notifications

Active transport is first-party VAPID web push plus native Expo, with combined device discovery. Legacy OneSignal configuration names remain compatibility surfaces; getOnesignalAppId returns empty. Expo persists accepted ticket IDs and later checks receipts. Acceptance is not delivery. Transport exceptions converted to zero recipients lose retry classification (022). Complete multi-worker send dedupe and receipt-reconciliation failure tests remain outstanding.

## 41. Authentication and security

P0 001 is the primary authorization finding. Correct-password account deletion fails because the authenticated user projection omits the password hash (002). Customer ownership race is 003. Node production dependency audit reports zero; frontend has 15 high/36 moderate/9 low and mobile 19 moderate advisories in the recorded dependency graph. Most high frontend entries involve the build chain; no blanket runtime exploit claim is made. Complete dependency reachability, SSRF/XSS/injection/CSRF and secret-scan review is unfinished. No real secret was intentionally included in evidence.

## 42. Database and storage

| Collection group | Authoritative role / observed failure |
|---|---|
| users/cloud_users | Admin/customer identity separation; JWT boundary confusion 001 |
| pin_licenses and customer links | License/account/owner truth; ownership race 003 |
| lease_terminal_authority/lease_documents/lease_offline_events | Offline authority/history; false ACK 020 |
| cloud_bot_commands | Command lifecycle; not identical to broker truth |
| cloud_bot_activity and heartbeat records | Received telemetry; may diverge from scanner/broker |
| manual_trading_broker_candles | Durable account candles; source-time/OHLC defect 004 |
| cloud_outlook_thesis | Passive current thesis; concurrent ACTIVE and revocation defects 006/007 |
| Global Brain observations/models | Training truth/registry; overwrite and promotion defects 011/012 |
| payment_transactions/licenses/subscriptions | Payment-to-entitlement state; interrupted recovery 021 |
| notification logs/devices/receipts | Preferences and delivery evidence; classification 022 |
| Academy progress/certificates | Per-user completion and public verification |

`collection-references.json` inventories source occurrences. Full writer/reader/index/TTL/retention analysis is incomplete. Critical uniqueness establishment must be a real readiness dependency (013). No automatic production duplicate deletion is authorized.

## 43. Journal and analytics

Final EA deal profit already includes swap/commission in the transmitted profit field; backend netResult adds separate swap/commission again. Controlled example: broker gross 100, swap −2, commission −3 → EA profit 95 → backend net 90 instead of 95. Earlier partial exits, entry charges/fees and immutable setup identity are also not fully represented (016). Delivery ignores HTTP/application acknowledgements with no durable journal retry (015). Broker deal ledger must be authoritative before win rate, R, learning or dashboard analytics can be trusted.

## 44. Subscriber signals

Signal-plan entitlement is separate from lifetime bot licensing. Subscription activation is keyed by payment reference, and customer notification recipient logic is separate from broker trade execution. Subscriber generation/mirror/outcome/expiry and every entitlement query are not fully audited. Repair Outlook and payment source-of-truth defects before declaring subscriber delivery reliable.

## 45. Payments

Providers observed are Paystack, Nomba and admin-approved bank transfer. Paystack webhook signature uses raw bytes and constant-time comparison; fulfillment re-verifies provider status/amount/currency. Nomba signature/verification paths were inspected selectively. The principal confirmed defect is unrecoverable intermediate state (021), including the admin retry path. Unique payment reference and entitlement constraints depend on startup correctness (013). Refund automation is explicitly unavailable in the inspected admin gateway; do not claim provider refunds are implemented.

## 46. Academy

Server-side progress uses authenticated user identity, known lesson IDs and atomic addToSet updates. Certificate endpoints fetch the authenticated user's own certificate, and public verification returns a restricted view. Course quiz scoring compares sets against server catalog answers; this is more meaningful than trusting a client percentage. Catalog/progress/certificate tests exist and ran in Node suite. Full course access, concurrent issuance, PDF visual QA and mobile/web curriculum parity remain incomplete.

## 47. Email, marketing and social

Payment and lifecycle email modules, admin automation and X posting are separate provider side effects. X provider success followed by failed database persistence can enter retry and duplicate publication (017). Payment email work also sits inside parts of fulfillment and should not strand entitlement progress (021). Complete campaign targeting, unsubscribes, worker ownership, provider timeout and cross-user content tests remain outstanding. No emails or social posts were sent during the audit.

## 48. Apex bridge isolation

The Apex bridge is intentional and must be retained. Inspected routes use bridge-specific configuration with shared license infrastructure and collision guards. This does not prove every generic XauCloud route rejects or correctly interprets Apex credentials. Full namespace/account/license/command/outlook/learning isolation remains UNVERIFIED. Do not remove the bridge or change owner strategy to hide a boundary defect.

## 49. Deployment

Recorded public probes returned HTTP 200 for xaucloud.io health/readiness and v6.28.6 download info. That verifies endpoint responses at probe time only. Hostinger process configuration, deployed commit, Mongo indexes, VPS/Mac terminals and attached EX5 remain unverified. CI frontend sync/build and backend startup source were inspected. No deploy, EA replacement, reattachment or production mutation occurred.

## 50. CI and testing

| Evidence | Result | Qualification |
|---|---|---|
| Node full suite | 528 pass, 5 initial timeouts / 533 | Affected four files rerun with one worker: 21/21 pass |
| Node typecheck/build | PASS | Existing source snapshot |
| Node production npm audit | 0 vulnerabilities reported | Dependency database snapshot, not full security proof |
| Six-fix EA suites | 91 pass | Python/source/mirror tests, not native MQL execution |
| Current EA CI suites | 18 pass | Source/security/extractor contracts |
| Frontend tests/build | 123 tests/19 suites pass; build succeeds | No exhaustive browser QA |
| Mobile tests/typecheck/web export | 9 tests pass; checks succeed | No native device certification |
| Python startup/dependencies | BLOCKED locally | Python 3.14 dependency conflict; CI interpreter is 3.11 |
| Controlled boundary diagnostics | Auth, ownership/candles, thesis race, learning replay/promotion, journal math, payment recovery, lease false ACK reproduced | Synthetic data/local Mongo only |

Logs are retained in the evidence directory. Focused rechecks were used only to resolve the initial Node timeouts and new diagnostic conditions. No claim is made that every confirmed issue already has an executable regression test.

## 51. Source coverage

The coverage JSON includes every tracked path and SHA-256. `audited:true` means the recorded source/workflow review depth, not runtime certification. Large EA and targeted service files remain `audited:false` with targeted-path notes where whole-file coverage is incomplete. Historical folders are not credited as production behavioral coverage. This distinction prevents the 1,482-file inventory from being misreported as a 1,482-file forensic audit.

## 52. Complete recorded P0–P4 findings

### XAUCLOUD-AUDIT-001 — P0 — Admin boundary accepts customer and incomplete-MFA JWTs

Source: `backend_node/src/auth.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** requireAdmin

**Source lines:** 76, 94

**Current behavior:** JWT signature is checked, but type and subject are not validated; lookup uses only email. Public signup creates unverified customer JWTs for addresses not already in cloud_users, even when present in users. MFA pending tokens also contain the matching email.

**Intended behavior:** Require type=access and valid admin subject matching the stored user identity before authorization; reject cloud, pending-MFA, recovery and download tokens. Preserve MFA completion issuance. Add explicit admin session revocation checks if the established admin session contract requires them.

**Root cause:** JWT signature is checked, but type and subject are not validated; lookup uses only email. Public signup creates unverified customer JWTs for addresses not already in cloud_users, even when present in users. MFA pending tokens also contain the matching email.

**Evidence:** auth-boundaries.mts and auth-boundaries.log: synthetic public signup token and actual login-issued pending token both receive 200 from requireAdmin-protected proof route. Python get_current_admin, backend/server.py:397-413, repeats the missing-purpose check; runtime authority of Python remains unverified.

**Reproduction:** Run isolated fixture; require both wrong-purpose tokens to return 401/403 and a completed admin access token to succeed. Exercise real registered admin routes with harmless reads.

**Production impact:** Potential full admin authority without completing admin authentication; affects settings, licensing, commands and data confidentiality. No live exploitation attempted.

**Trading impact:** Indirect through affected authorization/control paths.

**User impact:** Potential full admin authority without completing admin authentication; affects settings, licensing, commands and data confidentiality. No live exploitation attempted.

**Exact fix specification:** Require type=access and valid admin subject matching the stored user identity before authorization; reject cloud, pending-MFA, recovery and download tokens. Preserve MFA completion issuance. Add explicit admin session revocation checks if the established admin session contract requires them.

**Required validation:** Run isolated fixture; require both wrong-purpose tokens to return 401/403 and a completed admin access token to succeed. Exercise real registered admin routes with harmless reads.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-002 — P2 — Authenticated account deletion cannot verify the correct password

Source: `backend_node/src/routes/cloud/auth.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** POST /cloud/account/delete

**Source lines:** 255, 264

**Current behavior:** requireCloudUser projects password_hash out; deletion compares supplied password to empty string.

**Intended behavior:** Fetch only the password hash server-side by authenticated user id at deletion verification; never return it or add it to generic public user responses. Preserve confirmation and ownership checks.

**Root cause:** requireCloudUser projects password_hash out; deletion compares supplied password to empty string.

**Evidence:** auth-boundaries.log: authenticated synthetic owner with correct password receives 401 Incorrect password.

**Reproduction:** Synthetic valid owner/correct password deletes own account; wrong password does not delete; unrelated account unchanged.

**Production impact:** Customers cannot delete accounts through this API, affecting web/mobile callers.

**Trading impact:** Indirect through affected authorization/control paths.

**User impact:** Customers cannot delete accounts through this API, affecting web/mobile callers.

**Exact fix specification:** Fetch only the password hash server-side by authenticated user id at deletion verification; never return it or add it to generic public user responses. Preserve confirmation and ownership checks.

**Required validation:** Synthetic valid owner/correct password deletes own account; wrong password does not delete; unrelated account unchanged.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-003 — P1 — Concurrent first customer claims grant one license to two users

Source: `backend_node/src/services/commandLicense.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** verifyCommandLicense

**Source lines:** 6, 26, 32, 36, 41

**Current behavior:** Both requests read blank buyer_email, write their user links, then overwrite the owner without a conditional claim. getUserLicense trusts both saved links.

**Intended behavior:** Atomically claim owner using a conditional filter before linking the user; verify winner on contention. Validate current owner when reading a linked license; make partial failure recoverable.

**Root cause:** Both requests read blank buyer_email, write their user links, then overwrite the owner without a conditional claim. getUserLicense trusts both saved links.

**Evidence:** data-boundaries.log: both promises fulfilled; users_with_access=2.

**Reproduction:** Race two users on one unowned license; exactly one obtains access. Repeat after failed user-link write and after transfer.

**Production impact:** Concurrent first customer claims grant one license to two users

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Concurrent first customer claims grant one license to two users

**Exact fix specification:** Atomically claim owner using a conditional filter before linking the user; verify winner on contention. Validate current owner when reading a linked license; make partial failure recoverable.

**Required validation:** Race two users on one unowned license; exactly one obtains access. Repeat after failed user-link write and after transfer.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-004 — P2 — Broker candle source time and OHLC depend on arrival order

Source: `backend_node/src/services/manualTradingMarketStore.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** isoFromEvidence / recordVerifiedManualTradingQuote

**Source lines:** 33, 38, 58, 92

**Current behavior:** Parser appends Z to already-ISO timestamps and replaces invalid input with receipt time. Candle open is first arrival and close is last arrival, even for older source timestamps.

**Intended behavior:** Parse supported formats once; reject or explicitly quarantine invalid/unknown source time. Set open from earliest valid source timestamp and close/bid/ask from latest; highs/lows may include valid late samples. Define duplicate identity and preserve source and receipt times separately.

**Root cause:** Parser appends Z to already-ISO timestamps and replaces invalid input with receipt time. Candle open is first arrival and close is last arrival, even for older source timestamps.

**Evidence:** data-boundaries.log reproduces valid ISO remapped to receipt time, invalid timestamp accepted, firstSourceAt later than lastSourceAt and reversed open/close.

**Reproduction:** Replay newer then older then duplicate samples; assert chronological open/close, monotonic lastSourceAt and unchanged valid ISO time. Invalid/future/outdated data must follow documented data-quality rules, not silently become fresh.

**Production impact:** Broker candle source time and OHLC depend on arrival order

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Broker candle source time and OHLC depend on arrival order

**Exact fix specification:** Parse supported formats once; reject or explicitly quarantine invalid/unknown source time. Set open from earliest valid source timestamp and close/bid/ask from latest; highs/lows may include valid late samples. Define duplicate identity and preserve source and receipt times separately.

**Required validation:** Replay newer then older then duplicate samples; assert chronological open/close, monotonic lastSourceAt and unchanged valid ISO time. Invalid/future/outdated data must follow documented data-quality rules, not silently become fresh.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-005 — P1 — Durable H1/H4/D1 store is not consumed by current Outlook generation

Source: `backend_node/src/services/marketOutlookSignal.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** generateOutlookForAccount

**Source lines:** 251, 314, 348, 377

**Current behavior:** Generation consumes latestEaEvidence and M10/readiness/thesis fields. The durable candle collection has writers, indexes and a health reader, but no decision-path reader.

**Intended behavior:** Wire the approved account-scoped closed H1/H4/D1 evidence into manual Outlook generation and expose completeness/provenance. Obtain an owner decision for any missing higher-timeframe decision specification; do not invent indicator thresholds or strategy.

**Root cause:** Generation consumes latestEaEvidence and M10/readiness/thesis fields. The durable candle collection has writers, indexes and a health reader, but no decision-path reader.

**Evidence:** Global collection-reference search and generation imports/call body; no manual_trading_broker_candles reads in reachable Outlook services.

**Reproduction:** Use differing closed H4/D1 fixtures with identical current M10 snapshots and verify the specified higher-timeframe behavior. Prove account isolation, missing-bar handling and absence of proxy-price fallback.

**Production impact:** Durable H1/H4/D1 store is not consumed by current Outlook generation

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Durable H1/H4/D1 store is not consumed by current Outlook generation

**Exact fix specification:** Wire the approved account-scoped closed H1/H4/D1 evidence into manual Outlook generation and expose completeness/provenance. Obtain an owner decision for any missing higher-timeframe decision specification; do not invent indicator thresholds or strategy.

**Required validation:** Use differing closed H4/D1 fixtures with identical current M10 snapshots and verify the specified higher-timeframe behavior. Prove account isolation, missing-bar handling and absence of proxy-price fallback.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-006 — P1 — Passive thesis publication is not atomic per account and symbol

Source: `backend_node/src/services/outlookExecution.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** publishOutlookThesis

**Source lines:** 137, 147

**Current behavior:** Superseding old rows and upserting the new ACTIVE row are separate operations. Two publishers can both supersede before either inserts and leave two ACTIVE rows; current unique index permits different outlook IDs.

**Intended behavior:** Use an atomic authoritative current-pointer compare-and-swap or a transaction with per-account/symbol uniqueness; preserve immutable history and idempotent same-outlook publication.

**Root cause:** Superseding old rows and upserting the new ACTIVE row are separate operations. Two publishers can both supersede before either inserts and leave two ACTIVE rows; current unique index permits different outlook IDs.

**Evidence:** Source interleaving; thesis-concurrency.mts provides deterministic two-publisher barrier using actual Mongo writes. thesis-concurrency.log: active_theses=2 with the current unique index.

**Reproduction:** Run simultaneous distinct publications after both reach supersede phase; assert exactly one current thesis and deterministic history. Inject failure between history and pointer updates.

**Production impact:** Passive thesis publication is not atomic per account and symbol

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Passive thesis publication is not atomic per account and symbol

**Exact fix specification:** Use an atomic authoritative current-pointer compare-and-swap or a transaction with per-account/symbol uniqueness; preserve immutable history and idempotent same-outlook publication.

**Required validation:** Run simultaneous distinct publications after both reach supersede phase; assert exactly one current thesis and deterministic history. Inject failure between history and pointer updates.

**Dependencies:** XAUCLOUD-AUDIT-004, XAUCLOUD-AUDIT-005, XAUCLOUD-AUDIT-013

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-007 — P1 — Outlook lifecycle does not revoke passive EA thesis

Source: `backend_node/src/services/outlookExecution.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** publishOutlookThesis / thesis feed

**Source lines:** 127, 147

**Current behavior:** Passive thesis is ACTIVE until replaced or time expiry. Current source has no lifecycle writer that invalidates cloud_outlook_thesis when the corresponding Outlook resolves or becomes invalid; EA only reads invalidation_price into storage without comparing price against it in aligned evaluation.

**Intended behavior:** Propagate canonical thesis invalidation/resolution according to its approved lifecycle into the passive feed atomically. Revalidate the specific thesis invalidation before entry; do not confuse a signal target milestone with thesis invalidation unless the specification defines that transition.

**Root cause:** Passive thesis is ACTIVE until replaced or time expiry. Current source has no lifecycle writer that invalidates cloud_outlook_thesis when the corresponding Outlook resolves or becomes invalid; EA only reads invalidation_price into storage without comparing price against it in aligned evaluation.

**Evidence:** Collection writers/readers inventory; cloud/outlookThesis.ts filters only ACTIVE and expires_at; EA invalidationPrice references are assignment-only.

**Reproduction:** Invalidate an Outlook while its EA candidate is waiting; feed must withdraw it and candidate must not execute. Verify unrelated normal candidates continue.

**Production impact:** Outlook lifecycle does not revoke passive EA thesis

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Outlook lifecycle does not revoke passive EA thesis

**Exact fix specification:** Propagate canonical thesis invalidation/resolution according to its approved lifecycle into the passive feed atomically. Revalidate the specific thesis invalidation before entry; do not confuse a signal target milestone with thesis invalidation unless the specification defines that transition.

**Required validation:** Invalidate an Outlook while its EA candidate is waiting; feed must withdraw it and candidate must not execute. Verify unrelated normal candidates continue.

**Dependencies:** XAUCLOUD-AUDIT-006

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-008 — P1 — Replacement Outlook can inherit another thesis entry timer

Source: `backend/ea_code/XauCloud.mq5`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend

**Function:** XAU_FetchOutlookThesis / XAU_EnsureEntryTimerStarted

**Source lines:** 45646, 45666, 42461, 42464, 45779

**Current behavior:** isNewThesis only controls logging. Candidate identity is direction plus constant OUTLOOK_ALIGNED, excluding outlook_id/evidence. A new same-direction thesis can reuse elapsed delay, frozen location and origin from the previous thesis.

**Intended behavior:** Include immutable thesis/opportunity identity in lane-3 candidate identity; replace/reset only on a new opportunity, preserve normal wait ticks, and prevent terminal opportunity resurrection.

**Root cause:** isNewThesis only controls logging. Candidate identity is direction plus constant OUTLOOK_ALIGNED, excluding outlook_id/evidence. A new same-direction thesis can reuse elapsed delay, frozen location and origin from the previous thesis.

**Evidence:** Exact identity predicate and fetch assignments; candidate arming call passes constant setup.

**Reproduction:** Arm thesis A, advance 119 seconds, replace with same-direction B, assert B starts its own configured delay and frozen evidence. Repeated fetch of A must preserve its original timer.

**Production impact:** Replacement Outlook can inherit another thesis entry timer

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Replacement Outlook can inherit another thesis entry timer

**Exact fix specification:** Include immutable thesis/opportunity identity in lane-3 candidate identity; replace/reset only on a new opportunity, preserve normal wait ticks, and prevent terminal opportunity resurrection.

**Required validation:** Arm thesis A, advance 119 seconds, replace with same-direction B, assert B starts its own configured delay and frozen evidence. Repeated fetch of A must preserve its original timer.

**Dependencies:** XAUCLOUD-AUDIT-007, XAUCLOUD-AUDIT-019

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-009 — P1 — Close and modification wrappers promote CTrade booleans to execution success

Source: `backend/ea_code/XauCloud.mq5`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend

**Function:** OWNER_R_EXIT_CLOSE_ONLY / SafeModifySL

**Source lines:** 28557, 28582, 10672, 10685

**Current behavior:** Close wrapper returns true and attributes an exit on CTrade true without validating retcode. SafeModifySL likewise records pending SL reason on Boolean success. Some R-exit callers separately read back position state, but the shared wrapper contract remains unsafe.

**Intended behavior:** Classify server results and reconcile intended close/modify against deal and live-position readback; expose requested/pending/confirmed/failed distinctly. Record exit attribution only for accepted/confirmed intent and avoid carrying rejected intent to unrelated later exit. Preserve caller-specific close policy.

**Root cause:** Close wrapper returns true and attributes an exit on CTrade true without validating retcode. SafeModifySL likewise records pending SL reason on Boolean success. Some R-exit callers separately read back position state, but the shared wrapper contract remains unsafe.

**Evidence:** Exact source branches; official MQL5 PositionClose documentation states Boolean success is only basic structure validation and requires ResultRetcode.

**Reproduction:** Stub CTrade true with REJECT/INVALID_STOPS, partial completion and delayed completion; wrappers must not claim confirmed success. Native demo tests must corroborate broker semantics.

**Production impact:** Close and modification wrappers promote CTrade booleans to execution success

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Close and modification wrappers promote CTrade booleans to execution success

**Exact fix specification:** Classify server results and reconcile intended close/modify against deal and live-position readback; expose requested/pending/confirmed/failed distinctly. Record exit attribution only for accepted/confirmed intent and avoid carrying rejected intent to unrelated later exit. Preserve caller-specific close policy.

**Required validation:** Stub CTrade true with REJECT/INVALID_STOPS, partial completion and delayed completion; wrappers must not claim confirmed success. Native demo tests must corroborate broker semantics.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-010 — P1 — Placed order is treated as rejection and releases execution authority

Source: `backend/ea_code/XauCloud.mq5`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend

**Function:** XAU_BrokerOpenRetcodeAccepted / OpenTrade / CheckPyramidOpportunity

**Source lines:** 5855, 5871, 25186, 25223, 20314

**Current behavior:** Only DONE and DONE_PARTIAL count as accepted. PLACED exits reconciliation immediately; caller releases reservation and offline lease path labels it definitive rejection without consuming or reconciling pending execution.

**Intended behavior:** Distinguish definitive rejection from accepted-pending and ambiguous outcomes; retain/fence execution identity and offline allowance until broker order/deal/position reconciliation resolves. Do not resend pending identity.

**Root cause:** Only DONE and DONE_PARTIAL count as accepted. PLACED exits reconciliation immediately; caller releases reservation and offline lease path labels it definitive rejection without consuming or reconciling pending execution.

**Evidence:** Source result classifier and release branches; official return-code table defines PLACED as order placed.

**Reproduction:** Inject PLACED followed by delayed deal and restart; exactly one order, durable reservation/reconciliation and correct campaign/allowance. Also test true rejection releases authority.

**Production impact:** Placed order is treated as rejection and releases execution authority

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Placed order is treated as rejection and releases execution authority

**Exact fix specification:** Distinguish definitive rejection from accepted-pending and ambiguous outcomes; retain/fence execution identity and offline allowance until broker order/deal/position reconciliation resolves. Do not resend pending identity.

**Required validation:** Inject PLACED followed by delayed deal and restart; exactly one order, durable reservation/reconciliation and correct campaign/allowance. Also test true rejection releases authority.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-011 — P1 — Unresolved learning event can overwrite resolved outcome

Source: `backend_node/src/services/globalBrainIngest.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** recordGlobalBrainObservation

**Source lines:** 101, 105

**Current behavior:** Immutability check runs only when incoming resolved_at is non-null. A late unresolved replay skips it and $sets resolved_at=null over a resolved row; concurrent resolved updates also race the read-before-write.

**Intended behavior:** Make resolution monotonic in a conditional atomic write. Unresolved updates cannot erase a resolved snapshot; choose one resolution atomically, with separately versioned explicit corrections.

**Root cause:** Immutability check runs only when incoming resolved_at is non-null. A late unresolved replay skips it and $sets resolved_at=null over a resolved row; concurrent resolved updates also race the read-before-write.

**Evidence:** Direct source state transition; reproducible with resolved insert followed by same-key unresolved observation. brain-boundaries.mts/log dynamically reproduces the defect using an isolated real MongoDB and controlled insert failure.

**Reproduction:** Persist resolved row, replay unresolved and concurrent alternate resolutions; assert original outcome/features remain immutable under specified correction rules.

**Production impact:** Unresolved learning event can overwrite resolved outcome

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Unresolved learning event can overwrite resolved outcome

**Exact fix specification:** Make resolution monotonic in a conditional atomic write. Unresolved updates cannot erase a resolved snapshot; choose one resolution atomically, with separately versioned explicit corrections.

**Required validation:** Persist resolved row, replay unresolved and concurrent alternate resolutions; assert original outcome/features remain immutable under specified correction rules.

**Dependencies:** XAUCLOUD-AUDIT-015, XAUCLOUD-AUDIT-016

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-012 — P1 — Failed promotion can remove the current Global Brain champion

Source: `backend_node/src/services/globalBrainRegistry.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** promoteChallenger / rollback

**Source lines:** 146, 169, 229, 233

**Current behavior:** Prior champion is superseded before new champion insertion. Failure after supersede leaves no champion; rollback similarly demotes before restoring. Per-question mutex does not make the writes transactional.

**Intended behavior:** Commit an authoritative champion pointer atomically only after durable validated model insertion, or transact all registry state transitions; retain last champion on failure and maintain audit consistency.

**Root cause:** Prior champion is superseded before new champion insertion. Failure after supersede leaves no champion; rollback similarly demotes before restoring. Per-question mutex does not make the writes transactional.

**Evidence:** Sequential source writes; inject insert failure after prior update. brain-boundaries.mts/log dynamically reproduces the defect using an isolated real MongoDB and controlled insert failure.

**Reproduction:** Inject DB failures at each transition step and concurrent lookup; existing champion remains usable until complete promotion/rollback succeeds.

**Production impact:** Failed promotion can remove the current Global Brain champion

**Trading impact:** See current behavior; occurrence in live production is not established.

**User impact:** Failed promotion can remove the current Global Brain champion

**Exact fix specification:** Commit an authoritative champion pointer atomically only after durable validated model insertion, or transact all registry state transitions; retain last champion on failure and maintain audit consistency.

**Required validation:** Inject DB failures at each transition step and concurrent lookup; existing champion remains usable until complete promotion/rollback succeeds.

**Dependencies:** XAUCLOUD-AUDIT-011, XAUCLOUD-AUDIT-013

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-013 — P1 — Required uniqueness failures do not fail readiness

Source: `backend_node/src/services/startup.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** runStartupTasks

**Source lines:** 51, 70, 143, 165

**Current behavior:** Index failures are caught and converted into warning strings, including payment reference and license payment_ref uniqueness. index.ts marks startup_tasks successful and ultimately READY.

**Intended behavior:** Require established correctness-critical unique indexes to exist with the correct options before corresponding application readiness. Return structured failed dependencies; do not delete duplicate production data automatically.

**Root cause:** Index failures are caught and converted into warning strings, including payment reference and license payment_ref uniqueness. index.ts marks startup_tasks successful and ultimately READY.

**Evidence:** Targeted source path and caller/consumer inspection at audited SHA; dynamic failure-injection/native confirmation outstanding unless separately logged.

**Reproduction:** Inject duplicate documents/index creation failure; readiness must not report the dependent payment/licensing services ready. Successful indexes remain ready.

**Production impact:** Required uniqueness failures do not fail readiness

**Trading impact:** Can affect accounting/control/observability; not observed live.

**User impact:** Required uniqueness failures do not fail readiness

**Exact fix specification:** Require established correctness-critical unique indexes to exist with the correct options before corresponding application readiness. Return structured failed dependencies; do not delete duplicate production data automatically.

**Required validation:** Inject duplicate documents/index creation failure; readiness must not report the dependent payment/licensing services ready. Successful indexes remain ready.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-014 — P2 — Command Center preserves Connected state after polling fails

Source: `frontend/src/components/cloud/CloudDashboard.jsx`.

**Category:** SOFTWARE DEFECT

**Affected component:** frontend

**Function:** fetchAll / online

**Source lines:** 703, 726, 772, 774

**Current behavior:** A failure in any required Promise.all request discards successful sibling results. Non-401 errors leave previous status untouched. online reads cached status.offline without locally aging the heartbeat, so a formerly connected dashboard can stay connected during an outage.

**Intended behavior:** Track request/heartbeat timestamps and stale/error state; update independent resources separately and prevent older overlapping poll responses from overwriting newer state. Preserve last data with an explicit stale label.

**Root cause:** A failure in any required Promise.all request discards successful sibling results. Non-401 errors leave previous status untouched. online reads cached status.offline without locally aging the heartbeat, so a formerly connected dashboard can stay connected during an outage.

**Evidence:** Targeted source path and caller/consumer inspection at audited SHA; dynamic failure-injection/native confirmation outstanding unless separately logged.

**Reproduction:** Load a connected response, fail one required endpoint or all polling, advance beyond the existing offline threshold and assert stale/disconnected presentation on web; restore updates on recovery.

**Production impact:** Command Center preserves Connected state after polling fails

**Trading impact:** Can affect accounting/control/observability; not observed live.

**User impact:** Command Center preserves Connected state after polling fails

**Exact fix specification:** Track request/heartbeat timestamps and stale/error state; update independent resources separately and prevent older overlapping poll responses from overwriting newer state. Preserve last data with an explicit stale label.

**Required validation:** Load a connected response, fail one required endpoint or all polling, advance beyond the existing offline threshold and assert stale/disconnected presentation on web; restore updates on recovery.

**Dependencies:** XAUCLOUD-AUDIT-015, XAUCLOUD-AUDIT-016

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-015 — P1 — Closed-trade journal delivery is fire-and-forget

Source: `backend/ea_code/XauCloud.mq5`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend

**Function:** LogTradeToServer

**Source lines:** 46735, 46760

**Current behavior:** WebRequest return code and JSON acknowledgement are ignored. No durable delivery queue or retry exists in this function; the one close callback can lose the record during backend/network failure. Backend may return HTTP 200 with status:error.

**Intended behavior:** Durably enqueue the complete immutable closed-position record before sending; acknowledge only after both successful HTTP and application status. Retry with canonical trade identity, survive restart and rely on server idempotency. Never retry a trade order to repair telemetry.

**Root cause:** WebRequest return code and JSON acknowledgement are ignored. No durable delivery queue or retry exists in this function; the one close callback can lose the record during backend/network failure. Backend may return HTTP 200 with status:error.

**Evidence:** Targeted source path and caller/consumer inspection at audited SHA; dynamic failure-injection/native confirmation outstanding unless separately logged.

**Reproduction:** Fail delivery before/after server persistence and before ACK, restart EA, restore backend; exactly one canonical journal record and complete learning reconciliation must result.

**Production impact:** Closed-trade journal delivery is fire-and-forget

**Trading impact:** Can affect accounting/control/observability; not observed live.

**User impact:** Closed-trade journal delivery is fire-and-forget

**Exact fix specification:** Durably enqueue the complete immutable closed-position record before sending; acknowledge only after both successful HTTP and application status. Retry with canonical trade identity, survive restart and rely on server idempotency. Never retry a trade order to repair telemetry.

**Required validation:** Fail delivery before/after server persistence and before ACK, restart EA, restore backend; exactly one canonical journal record and complete learning reconciliation must result.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-016 — P1 — Journal net P/L double-counts charges and loses position attribution

Source: `backend/ea_code/XauCloud.mq5`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend

**Function:** OnTradeTransaction / LogTradeToServer

**Source lines:** 34487, 34508, 35023, 46745, 46753

**Current behavior:** Partial-close branch returns before journal emission. Full close uses only final deal profit/swap/commission, omits entry commission and fees/prior partial closes, then payload reads mutable lastSignalSignature/lastSignalSetup and current RegimeName rather than immutable position-entry metadata. In addition, performanceEngine.netResult adds commission and swap again to the already-net EA profit, double-counting both charges.

**Intended behavior:** Build journal from all deals for the broker position identifier, including entry/exit commissions, swap and fees with a documented gross/net contract. Persist and use entry setup/signature/regime/family per position; preserve CORE/PYRAMID/RE_ENTRY/OUTLOOK identity.

**Root cause:** Partial-close branch returns before journal emission. Full close uses only final deal profit/swap/commission, omits entry commission and fees/prior partial closes, then payload reads mutable lastSignalSignature/lastSignalSetup and current RegimeName rather than immutable position-entry metadata.

**Evidence:** Targeted source path and caller/consumer inspection at audited SHA; dynamic failure-injection/native confirmation outstanding unless separately logged. journal-contract.mts/log passes the current EA payload contract into actual backend netResult: broker net 95 becomes backend net 90.

**Reproduction:** Position fixture with entry commission, two partial exits and final close must reconcile exactly to broker net result. Change current candidate before close and assert journal keeps original entry identity.

**Production impact:** Journal reports final-deal P/L and mutable setup instead of position truth

**Trading impact:** Can affect accounting/control/observability; not observed live.

**User impact:** Journal reports final-deal P/L and mutable setup instead of position truth

**Exact fix specification:** Build journal from all deals for the broker position identifier, including entry/exit commissions, swap and fees with a documented gross/net contract. Persist and use entry setup/signature/regime/family per position; preserve CORE/PYRAMID/RE_ENTRY/OUTLOOK identity. Version the payload contract or record explicit gross_profit/net_profit semantics; avoid rewriting legacy rows without identifiable provenance. Repair backend consumers and learning labels consistently.

**Required validation:** Position fixture with entry commission, two partial exits and final close must reconcile exactly to broker net result. Change current candidate before close and assert journal keeps original entry identity.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-017 — P2 — Successful X post can be retried after persistence failure

Source: `backend_node/src/services/xTradePosting.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** processClaimedXTradePost

**Source lines:** 248, 257

**Current behavior:** Provider publish and POSTED database update share one try/catch. If provider succeeds but database update throws, failXTradePost schedules a retry; stale PROCESSING recovery likewise retries without checking whether the provider already created the post.

**Intended behavior:** Represent post outcome uncertainty explicitly, persist provider response when possible, reconcile before retrying an uncertain send, and prevent concurrent stale workers from committing over a new claim using holder fencing. Do not claim exactly-once external publication without provider evidence.

**Root cause:** Provider publish and POSTED database update share one try/catch. If provider succeeds but database update throws, failXTradePost schedules a retry; stale PROCESSING recovery likewise retries without checking whether the provider already created the post.

**Evidence:** Targeted source path and caller/consumer inspection at audited SHA; dynamic failure-injection/native confirmation outstanding unless separately logged.

**Reproduction:** Mock provider success followed by DB failure; recovery must not issue an unconditional second publish. Also test timeout after provider acceptance and worker lease takeover.

**Production impact:** Successful X post can be retried after persistence failure

**Trading impact:** Can affect accounting/control/observability; not observed live.

**User impact:** Successful X post can be retried after persistence failure

**Exact fix specification:** Represent post outcome uncertainty explicitly, persist provider response when possible, reconcile before retrying an uncertain send, and prevent concurrent stale workers from committing over a new claim using holder fencing. Do not claim exactly-once external publication without provider evidence.

**Required validation:** Mock provider success followed by DB failure; recovery must not issue an unconditional second publish. Also test timeout after provider acceptance and worker lease takeover.

**Dependencies:** XAUCLOUD-AUDIT-013

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-018 — P2 — Mobile request timeout stops before response body is read

Source: `mobile/src/api/client.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** mobile

**Function:** apiFetch

**Source lines:** 81, 109

**Current behavior:** The abort timer is cleared immediately after fetch returns headers; res.json() is awaited outside the timed section. A stalled response body can leave the promised request pending indefinitely despite REQUEST_TIMEOUT_MS.

**Intended behavior:** Keep cancellation/deadline active until body consumption and response parsing settle, clear in the outer finally, and propagate caller cancellation rather than replacing it.

**Root cause:** The abort timer is cleared immediately after fetch returns headers; res.json() is awaited outside the timed section. A stalled response body can leave the promised request pending indefinitely despite REQUEST_TIMEOUT_MS.

**Evidence:** Targeted source path and caller/consumer inspection at audited SHA; dynamic failure-injection/native confirmation outstanding unless separately logged.

**Reproduction:** Serve headers then a stalled JSON body; request must settle as a network timeout within the configured deadline, including cold-start auth requests.

**Production impact:** Mobile request timeout stops before response body is read

**Trading impact:** Can affect accounting/control/observability; not observed live.

**User impact:** Mobile request timeout stops before response body is read

**Exact fix specification:** Keep cancellation/deadline active until body consumption and response parsing settle, clear in the outer finally, and propagate caller cancellation rather than replacing it.

**Required validation:** Serve headers then a stalled JSON body; request must settle as a network timeout within the configured deadline, including cold-start auth requests.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-019 — P1 — Transition cache bypasses freshness and can precede snapshot refresh

Source: `backend/ea_code/XauCloud.mq5`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend

**Function:** XAU_AdaptiveMarketTransitionEngine / OnTick / XAU_EvaluateOutlookAlignedEntry

**Source lines:** 18171, 18217, 18700, 21040, 21909, 45698

**Current behavior:** The same-bar cache returns before the existing 1800-second age check. Outlook evaluation calls the engine before the normal stable M10 indicator snapshot is loaded; the engine caches under the new bar identity using pre-refresh buffers. Snapshot reset/load do not invalidate that transition cache.

**Intended behavior:** Check evidence age and snapshot identity before reuse. Compute/cache transition decisions only from the matching complete closed-M10 snapshot; ensure Outlook and primary consumers share that snapshot. Preserve existing staleness threshold and confirmation policy. Do not use cache invalidation to increment distinct-bar exhaustion twice.

**Root cause:** The same-bar cache returns before the existing 1800-second age check. Outlook evaluation calls the engine before the normal stable M10 indicator snapshot is loaded; the engine caches under the new bar identity using pre-refresh buffers. Snapshot reset/load do not invalidate that transition cache.

**Evidence:** Source-order proof; native MT5 fault injection outstanding. Relevant reset function at 12746 and loader at 13015 do not reset g_transitionLastComputedBar.

**Reproduction:** Hold bar identity constant while source time passes the existing age threshold: cached decision must become unavailable. Advance a bar with materially different ATR/EMA, run Outlook before primary, and require the same decision as primary-first after snapshot load. Inject buffer failure and verify neither path tags old buffers as current.

**Production impact:** Transition cache bypasses freshness and can precede snapshot refresh

**Trading impact:** Execution evidence, entitlement or delivery truth may be impaired; specific live occurrence unproven.

**User impact:** Transition cache bypasses freshness and can precede snapshot refresh

**Exact fix specification:** Check evidence age and snapshot identity before reuse. Compute/cache transition decisions only from the matching complete closed-M10 snapshot; ensure Outlook and primary consumers share that snapshot. Preserve existing staleness threshold and confirmation policy. Do not use cache invalidation to increment distinct-bar exhaustion twice.

**Required validation:** Hold bar identity constant while source time passes the existing age threshold: cached decision must become unavailable. Advance a bar with materially different ATR/EMA, run Outlook before primary, and require the same decision as primary-first after snapshot load. Inject buffer failure and verify neither path tags old buffers as current.

**Dependencies:** None

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-020 — P1 — Lease reconciliation acknowledges storage failure and EA deletes the queue

Source: `backend_node/src/routes/cloud/lease.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** registerCloudLeaseRoutes / XAU_LeaseUploadReconciliationQueue

**Source lines:** 227, 247, 249, 253

**Current behavior:** Every insert exception is labeled already_reconciled, including storage outage. The route returns reconciled:true with HTTP 200. The EA lease client deletes the entire queue for HTTP 200 without checking per-event acknowledgements. Failed events can be permanently lost.

**Intended behavior:** Only accept a duplicate after reading the existing scoped event and verifying identity/content. Return retryable failure for storage errors. Have the EA parse acknowledgements and durably remove only explicitly persisted or verified identical events. Preserve malformed and unacknowledged records; build JSON commas from appended events rather than original line index.

**Root cause:** Every insert exception is labeled already_reconciled, including storage outage. The route returns reconciled:true with HTTP 200. The EA lease client deletes the entire queue for HTTP 200 without checking per-event acknowledgements. Failed events can be permanently lost.

**Evidence:** remaining-boundaries.mts/log uses actual Fastify route with injected storage failure; EA consumer source backend/ea_code/lease/XauCloudLeaseClient.mqh:893-950. Native queue-delete test outstanding.

**Reproduction:** Inject nonduplicate insert failure: no success acknowledgement and the EA retains the event. Test mixed success/failure, mismatched duplicate, interrupted upload, malformed first/middle line, and restart; no valid unsaved event may be removed.

**Production impact:** Lease reconciliation acknowledges storage failure and EA deletes the queue

**Trading impact:** Execution evidence, entitlement or delivery truth may be impaired; specific live occurrence unproven.

**User impact:** Lease reconciliation acknowledges storage failure and EA deletes the queue

**Exact fix specification:** Only accept a duplicate after reading the existing scoped event and verifying identity/content. Return retryable failure for storage errors. Have the EA parse acknowledgements and durably remove only explicitly persisted or verified identical events. Preserve malformed and unacknowledged records; build JSON commas from appended events rather than original line index.

**Required validation:** Inject nonduplicate insert failure: no success acknowledgement and the EA retains the event. Test mixed success/failure, mismatched duplicate, interrupted upload, malformed first/middle line, and restart; no valid unsaved event may be removed.

**Dependencies:** XAUCLOUD-AUDIT-013

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-021 — P1 — Interrupted payment fulfillment cannot resume from intermediate states

Source: `backend_node/src/services/paymentFulfillment.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** fulfillPayment / fulfillNombaPayment / approveBankTransfer

**Source lines:** 148, 197, 224, 242, 243, 282, 318, 319

**Current behavior:** Provider retries can acquire only PENDING to VERIFYING; VERIFYING, PAID and FULFILLING return pending without recovery. Bank approval cannot resume FULFILLING. Process death, JSON parse failure or persistence failure after a state change strands the paid order. Admin retry delegates to these same non-resuming functions.

**Intended behavior:** Implement durable resumable provider-verified state transitions with an expiring fenced worker claim and idempotent entitlement identity. Recover interrupted verification; resume PAID/FULFILLING by reconciling existing entitlement before creating it. Make email dispatch a separate durable task. Never reset an uncertain order blindly or mint duplicate licenses/subscriptions.

**Root cause:** Provider retries can acquire only PENDING to VERIFYING; VERIFYING, PAID and FULFILLING return pending without recovery. Bank approval cannot resume FULFILLING. Process death, JSON parse failure or persistence failure after a state change strands the paid order. Admin retry delegates to these same non-resuming functions.

**Evidence:** remaining-boundaries.mts/log invokes actual fulfillment functions for persisted intermediate states. admin/adminGatewayActions.ts:332 delegates retry to the same functions. No provider requests are made by the diagnostic.

**Reproduction:** Terminate/inject failures after every transition and entitlement write; provider callback, customer polling and admin retry must converge on one entitlement and FULFILLED. Include malformed provider JSON, concurrent retries, existing license/subscription, and bank approval recovery.

**Production impact:** Interrupted payment fulfillment cannot resume from intermediate states

**Trading impact:** Execution evidence, entitlement or delivery truth may be impaired; specific live occurrence unproven.

**User impact:** Interrupted payment fulfillment cannot resume from intermediate states

**Exact fix specification:** Implement durable resumable provider-verified state transitions with an expiring fenced worker claim and idempotent entitlement identity. Recover interrupted verification; resume PAID/FULFILLING by reconciling existing entitlement before creating it. Make email dispatch a separate durable task. Never reset an uncertain order blindly or mint duplicate licenses/subscriptions.

**Required validation:** Terminate/inject failures after every transition and entitlement write; provider callback, customer polling and admin retry must converge on one entitlement and FULFILLED. Include malformed provider JSON, concurrent retries, existing license/subscription, and bank approval recovery.

**Dependencies:** XAUCLOUD-AUDIT-001, XAUCLOUD-AUDIT-013

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

### XAUCLOUD-AUDIT-022 — P2 — Push transport failures are classified as no active recipient

Source: `backend_node/src/services/notifications.ts`.

**Category:** SOFTWARE DEFECT

**Affected component:** backend_node

**Function:** sendUserPush / sendTradeActivityNotification

**Source lines:** 477, 488, 1319, 1372, 1398

**Current behavior:** Web and Expo senders catch transport/provider errors and return zero. Promise.allSettled therefore sees fulfilled zero results and maps a temporary outage to NO_ACTIVE_WEB_PUSH_RECIPIENT. The failure is not in RETRYABLE_FAILURES, so trade notification retries skip it despite registered devices.

**Intended behavior:** Return structured per-channel outcomes distinguishing no recipients, accepted, permanent token failure and retryable transport/provider failure. Keep accepted and delivery-confirmed states distinct. Retry failed channels with event identity; do not resend a channel already known accepted merely because another failed.

**Root cause:** Web and Expo senders catch transport/provider errors and return zero. Promise.allSettled therefore sees fulfilled zero results and maps a temporary outage to NO_ACTIVE_WEB_PUSH_RECIPIENT. The failure is not in RETRYABLE_FAILURES, so trade notification retries skip it despite registered devices.

**Evidence:** Source path: webPush.ts:81-108 and expoPush.ts:73-134 catch failures into zero; notifications.ts:461-491 classifies combined results. Dynamic provider failure test outstanding.

**Reproduction:** With registered devices mock network timeout/503 on both transports; persist retryable failure and recover after provider restoration. Test native-only, web-only, mixed success, dead token, no devices and receipt failure.

**Production impact:** Push transport failures are classified as no active recipient

**Trading impact:** Execution evidence, entitlement or delivery truth may be impaired; specific live occurrence unproven.

**User impact:** Push transport failures are classified as no active recipient

**Exact fix specification:** Return structured per-channel outcomes distinguishing no recipients, accepted, permanent token failure and retryable transport/provider failure. Keep accepted and delivery-confirmed states distinct. Retry failed channels with event identity; do not resend a channel already known accepted merely because another failed.

**Required validation:** With registered devices mock network timeout/503 on both transports; persist retryable failure and recover after provider restoration. Test native-only, web-only, mixed success, dead token, no devices and receipt failure.

**Dependencies:** XAUCLOUD-AUDIT-013

**Status:** CONFIRMED_SOURCE_DEFECT

**Observed live:** False

**Source only:** True

## 53. Requirements matrix

| Requirement | Result | Evidence/findings |
|---|---|---|
| Correct admin token purpose/MFA boundary | FAIL | 001 actual-route diagnostic |
| Customer deletion with correct password | FAIL | 002 diagnostic |
| One customer owner per license | FAIL | 003 concurrency diagnostic |
| Current closed-M10 evidence on every consumer | FAIL | 019 source ordering |
| Passive Outlook uses current, unique, valid thesis | FAIL | 006–008 |
| Durable broker H1/H4/D1 informs Outlook | FAIL | 004/005 |
| Broker accepted/closed state is reconciled | FAIL | 009/010; native remaining |
| Immutable complete journal/accounting | FAIL | 015/016 |
| TradeBrain inspected advisor cannot veto/resize | PARTIAL | Source returns true/1; entire ecosystem not certified |
| Global Brain defaults OFF | PASS for defaults; UNVERIFIED live | Settings source; no production settings access |
| Resolved learning labels and champion continuity | FAIL | 011/012 diagnostics |
| Required DB uniqueness before READY | FAIL | 013 |
| Dashboard freshness truth | FAIL | 014 |
| Mobile bounded API deadline | FAIL | 018 |
| Offline reconciliation durably acknowledged | FAIL | 020 source + route diagnostic |
| Paid order resumes after interruption | FAIL | 021 diagnostic |
| Retryable push failure remains retryable | FAIL | 022 source path |
| Academy user-scoped progress/certificates | PARTIAL | Source/tests; full parity/QA missing |
| Release source/artifact copy identity | PASS for compared copies | release-hashes.json |
| Running attached EX5 matches source | UNVERIFIED | No native terminal provenance |
| Full platform behavioral source coverage | INCOMPLETE | Coverage manifest |

The evidence directory also contains this matrix in machine-readable form. PASS is limited to the exact stated property, never a whole-subsystem certification.

## 54. Legacy and dead code

The counter-excursion send path is build-disabled in this snapshot. Current passive Outlook supersedes old independent command emission, but complete persisted legacy recovery is not natively proven. OneSignal-facing compatibility names persist despite active VAPID/Expo transport. Python and local-AI assets are not declared dead merely because Node is advertised current. Historical analysis artifacts were not trusted as implementation evidence.

## 55. Silent failure map

| Failure | Hidden or misleading result | Finding |
|---|---|---|
| CTrade operation rejected | Boolean promoted to success in shared wrappers | 009 |
| Accepted PLACED request unresolved | Rejection path releases authority | 010 |
| Required index cannot be created | Startup warning with READY | 013 |
| Poll endpoint fails | Cached Connected remains | 014 |
| Journal upload fails | Close callback loses delivery without durable retry | 015 |
| Provider X post succeeds; DB fails | Retry can duplicate external post | 017 |
| Mobile body stalls | Header-only timeout has already cleared | 018 |
| Evidence ages without bar-key change | Cached transition bypasses freshness gate | 019 |
| Lease event insert fails | already_reconciled + HTTP 200, local queue deletion | 020 |
| Payment worker dies | Pending forever in intermediate state | 021 |
| Push transport fails | No-recipient classification prevents retry | 022 |

This is the confirmed map, not a claim that every catch/return in the repository has been classified.

## 56. Live attribution limitations

All findings are CONFIRMED_SOURCE_DEFECT with observed_live=false. Synthetic diagnostics demonstrate reachable behaviors under controlled inputs/failures, not exploitation or occurrence in the owner's account. Public release/health metadata is the only production observation retained. Native logs, broker order/deal history, command IDs, heartbeat times and deployed hashes must be correlated before attributing a specific live event.

## 57. Ordered repair plan

1. Repair admin token-purpose/MFA authorization (001) and verify all admin consumers with harmless reads.
2. Establish critical database uniqueness/readiness (013) and atomic customer ownership (003).
3. Repair broker outcome/pending reconciliation (009/010), lease ACK/queue truth (020) and complete journal identity/delivery/accounting (015/016).
4. Repair resumable payment entitlement fulfillment (021). Test every interruption boundary and preserve exactly one entitlement per payment reference.
5. Repair snapshot/cache identity (019), broker candle provenance (004), unique/revoked passive thesis state (006/007), replacement candidate identity (008), and approved higher-timeframe wiring (005).
6. Repair resolved observation monotonicity (011) and atomic champion continuity (012), then validate training provenance/chronology before judging model quality. Keep live influence switches as configured; do not enable them as part of repair.
7. Repair web/mobile freshness/deadlines (014/018), account deletion (002), social uncertain-send recovery (017) and push outcome classification (022).
8. Complete outstanding audit coverage and required owner decisions before creating the final implementation handoff. Native compile/demo/restart verification is a separate required checkpoint when available.

No new loss/drawdown/day limits, exposure caps, pauses, arbitrary lot/max-layer rules, SL/break-even/trailing/protection systems or session restrictions are authorized. Preserve current owner strategy, M10 authority, valid confirmation, passive Outlook, advisory TradeBrain and Global Brain switch semantics. Where the approved specification is missing, mark OWNER DECISION REQUIRED rather than choose a value.

## 58. Final production readiness verdict

Overall: **CRITICAL — DO NOT DEPLOY/TRADE**, as a recommendation based on this source snapshot. The audit itself remains incomplete.

| Area | Verdict |
|---|---|
| EA correctness / strategy execution / M10 / timing / broker execution | NOT READY; confirmed boundary defects and native validation outstanding |
| TradeBrain | PARTIALLY READY for inspected advisory-only boundary; full collection/provenance unverified |
| Global Brain / Outlook | NOT READY |
| Backend / licensing | NOT READY; admin security also CRITICAL |
| Command Center / mobile / notifications | NOT READY for the confirmed truth/reliability defects |
| Security | CRITICAL |
| Deployment/release integrity | PARTIALLY READY for copied artifact hashes; actual deployed/attached identity UNVERIFIED |

No production source was repaired and no production-readiness certificate is issued. The owner-required Claude implementation prompt has not been generated because the 100%-complete-audit prerequisite has not been met. The report, findings, coverage and reproducible evidence preserve the work for continuation without restarting or repeating valid checks.
