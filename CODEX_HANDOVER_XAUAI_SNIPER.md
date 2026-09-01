# XAUAI Sniper Codex Handover

Generated: 2026-07-17 21:35 Africa/Lagos. This is a live checkpoint and must be updated after each major remaining repair.

## A. Executive Status

- **EA work:** substantially completed. The repaired v6.25.5 source includes the owner-constrained M30 candidate/timer lifecycle, restart evidence reconstruction, mandatory structural SL, broker-truth reconciliation, cross-terminal execution key, and authenticated EA payloads.
- **Final EA compile:** MetaEditor completed with `0 errors, 0 warnings` against source SHA-256 `43628e1a040a6811be8bf4e3980f4368425df8e83f09c006f0ba3be49ddf5c44`.
- **Final source-aligned EX5:** generated at `/tmp/xauai-v6255-final-compile/XAUUSD_AI_Sniper_EA_v6.25.5.ex5`, SHA-256 `88335e79b24756c613528fb3f9e04da0eaceed96eca8042bb601c229bbddb728`. It is canonical for the current dirty source but is not yet in the release directory, committed, pushed, copied to MT5, attached, or runtime-proven.
- **Interim artifact:** GitHub/release/Mac/VPS currently hold the earlier test candidate SHA-256 `95dfa7fda4bab287d9fb46dcef1a557374933b154c8c3f489ec1429e9ea694ea`. It is not the final source-aligned build.
- **Website/backend/frontend completed so far:** cookie-only browser authentication repair; EA route authentication and tenant binding; honest news and quote degradation; reproducible optional LLM adapter; first-party-only performance display; documentation aligned to M10/M30/EX5; Command Center/admin browser smoke; removal of invented public and preview metrics; broker/bonus disclaimer; optional push worker fail-soft; accessible auth labels; mobile overflow repair staged.
- **Still in progress:** full customer page coverage, M30 candidate/timer visibility, remote-command idempotency and terminal-state enforcement, notification receipt proof, MFA browser path, session expiry/refresh, complete responsive sweep, final release manifest/artifact alignment, final production deployment.
- **Current active task:** browser- and contract-driven website/Command Center/admin/remote-command audit, preserving this handover continuously.
- **Branch safety:** safe to continue on `audit/codex-complete-xauaisniper-forensic-repair`; do not switch/reset the primary dirty worktree.
- **Deployment safety:** not yet safe to call final production-ready. Final EX5 is compiler-proven, but live M30 execution, replay, terminal mode, and final deployment remain unproven.
- **What was deployed:** only the interim test-candidate EX5 was copied to Mac and VPS Experts folders. It was not intentionally attached/restarted by Codex. No dirty backend/frontend code has been deployed.

## B. Repository and Branch Identity

- Repository: `https://github.com/Lamarrsdrip/XauAI-Sniper`
- Audit repository/worktree: `/Users/libertyelectronics/XauAI-v6251-full-repair`
- Verified primary local project worktree: `/Users/libertyelectronics/XauAI-Sniper` (different dirty branch; do not reset or overwrite its source)
- Claude requested implementation: `f6c59b47945620b6e2b86da2fe95909330282221`
- Verified newer audit base: `9e4181f8115f93eb6874ac899c30e272b2637faa`
- Codex audit branch: `audit/codex-complete-xauaisniper-forensic-repair`
- Current HEAD at handover creation: `bf82b8cafc3626d9c9200a377bb7cac722eee5ab`
- Upstream: `origin/audit/codex-complete-xauaisniper-forensic-repair`; `origin/main` also currently points at `bf82b8c` because the owner requested the interim artifact on main.
- Codex commits: `c710c8a` (`fix(ea): enforce single M30 entry timer lifecycle`) and `bf82b8c` (`chore(release): publish audited v6.25.5 test candidate`).
- Working tree: dirty. Exact state is in `codex_handover_xauaisniper/git_status.txt`, `git_diff_stat.txt`, and `CODEX_HANDOVER_UNCOMMITTED.patch`.

## C. Completed EA Repair Summary

| Finding | Severity | Root cause and repair | File/function | Proof | Commit | Status / unproven |
|---|---:|---|---|---|---|---|
| XAU-001 | Critical | M10 contradiction could veto M30. Scoped the M10 veto to legacy mode. | `XAUUSD_AI_Sniper_EA.mq5`, final-entry arbiter | focused v6.25.5 contracts | `c710c8a` | FIXED statically; live M30 unproven |
| XAU-002 | Critical | retrace/location could create a second wait. Qualifying M30 now creates a candidate and timer immediately; retrace remains evidence-only. | M30 consensus/candidate path | `test_xau_v6255_single_entry_timer_owner_correction.py` | `c710c8a` | FIXED statically/behavioral contract |
| XAU-003 | Critical | reservation allowed same-direction overwrite. Added immutable `execution_key`; any unexpired owner blocks another claimant. | EA reservation payload; `/cloud/reservation/claim` | Mongo suite 13 passed | `c710c8a` plus dirty backend tests | FIXED; final backend commit pending |
| XAU-004 | Critical | core duplicate guard ran after broker send. Moved it before reservation/send. | `OpenTrade`, core campaign guard | focused source/behavior contracts | `c710c8a` | FIXED statically |
| XAU-005 | High | constant setup identity allowed timer inheritance across M30 slots. Candidate identity now includes account, symbol, magic, mode, slot, direction and three evidence IDs. | M30 candidate identity | focused owner suite | `c710c8a` | FIXED statically |
| XAU-006 | High | candidate slot persisted as processed before execution. Full active lifecycle is persisted and resumed with original start/duration. | M30 persistent lifecycle | restart contracts | `c710c8a` | FIXED statically; crash testing in terminal unproven |
| XAU-007 | Critical | `CTrade` boolean was treated as execution. Accepted retcode plus matching broker truth is now required; ambiguity reconciles without immediate resend. | core/pyramid/counter broker reconciliation | focused broker contracts | `c710c8a` | FIXED statically; broker fault injection unproven |
| XAU-008 | Critical | structural SL was optional/ATR fallback. Core structure is mandatory; valid invalidation widens once by exactly `1.20`; configured risk remains `10%`; missing structure at expiry cancels. | structural SL / lot sizing | focused owner contracts; compile | `c710c8a` | FIXED statically; real broker stops unproven |
| XAU-016 | High | M10 history was not rebuilt immediately after restart. Last three completed M10 snapshots are rebuilt/validated from closed broker history with stable IDs; no forming candle/current-tick fabrication. | evidence persistence/backfill | restart/history contracts | `c710c8a` | FIXED statically; historical replay unproven |
| XAU-025 | Critical | EA data/AI writes could not be secured without breaking clients. Both active EA codebases now send PIN plus account identity to AI, memory, feedback, journal, weekly and pattern routes. | root/backend Gold EA and XauIndex EA HTTP payloads | authenticated-client contract 8 passed; both compile 0/0 | dirty after `bf82b8c` | FIXED in source; commit/release pending |

The owner timing rule remains exactly: three completed M10 snapshots → M30 BUY/SELL/no-trade → one fresh 120–180 second timer → execute or cancel. No new strategy threshold, candle, slot, cooldown, AI vote, daily loss pause, or retracement timing layer was introduced.

## D. Final EA Artifact Proof

- Final MQ5: `/Users/libertyelectronics/XauAI-v6251-full-repair/XAUUSD_AI_Sniper_EA.mq5`
- Backend MQ5: `/Users/libertyelectronics/XauAI-v6251-full-repair/backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- Equality: byte-identical (`cmp` exit 0).
- Final MQ5 SHA-256: `43628e1a040a6811be8bf4e3980f4368425df8e83f09c006f0ba3be49ddf5c44` for both paths.
- MetaEditor command used: `/usr/local/bin/wine '<MT5>/MetaEditor64.exe' /compile:Z:\\tmp\\xauai-v6255-final-compile\\XAUUSD_AI_Sniper_EA_v6.25.5.mq5 /log:Z:\\tmp\\xauai-v6255-final-compile\\compile.log` (Wine printed a nonzero wrapper exit on one run, but the compiler log and generated artifact are authoritative).
- Compiler result: `Result: 0 errors, 0 warnings, 61255 ms elapsed, cpu='X64 Regular'`.
- Compile log: `/tmp/xauai-v6255-final-compile/compile.log`; committed evidence copy: `codex_handover_xauaisniper/final_ea_compile.log`.
- Final canonical EX5 for current source: `/tmp/xauai-v6255-final-compile/XAUUSD_AI_Sniper_EA_v6.25.5.ex5`.
- Final EX5 SHA-256: `88335e79b24756c613528fb3f9e04da0eaceed96eca8042bb601c229bbddb728`.
- Interim EX5 SHA-256: `95dfa7fda4bab287d9fb46dcef1a557374933b154c8c3f489ec1429e9ea694ea`.
- Hash difference: final source adds authenticated account/PIN payloads for journal/weekly/pattern/AI/memory/feedback contracts after the interim artifact was published.
- XauIndex repaired source also compiles `0 errors, 0 warnings`; EX5 SHA-256 `305f2597a5b7d08f0c4ea314c9327a6c026fcc3010bc3b6c824431dc537831af`; it remains a separate unaudited/unpublished product.
- Release manifest currently still identifies the **interim** source/artifact (`c710c8a`, source `e249f0…`, EX5 `95dfa7…`) and must be updated only after the final source checkpoint commit exists.
- Mac Experts folder currently contains interim `95dfa7…`; the observed running journal before this final rebuild was v6.25.4 on XAUUSD M15. Final `88335…` is not deployed or attached.
- VPS Experts folder currently contains interim `95dfa7…`; terminal process was observed running since 2026-07-15 with older historical files. Final `88335…` is not deployed or runtime-proven.

## E. Full Findings Register

| ID | Severity | Component / evidence | Status | Changed files / proof / remaining work |
|---|---:|---|---|---|
| XAU-001 | Critical | M10 vetoed M30 | FIXED | EA; focused contracts; live unproven |
| XAU-002 | Critical | retrace double gate | FIXED | EA; one-timer suite |
| XAU-003 | Critical | same-direction reservation race | FIXED | EA/backend/test; 13 Mongo tests; backend commit pending |
| XAU-004 | Critical | duplicate core guard after send | FIXED | EA contracts |
| XAU-005 | High | slot/timer identity bleed | FIXED | EA contracts |
| XAU-006 | High | premature processed-slot persistence | FIXED | EA restart contracts; terminal crash proof unproven |
| XAU-007 | Critical | boolean CTrade success treated as fill | FIXED | EA broker reconciliation contracts; real broker unproven |
| XAU-008 | Critical | structural SL optional/ATR fallback | FIXED | EA contracts; broker stops unproven |
| XAU-009 | Critical | unauthenticated journal/ML/memory/feedback/AI routes | PARTIAL | backend + both EA codebases repaired and contract-tested; complete route integration/worker sweep and commit remain |
| XAU-010 | High | news provider failure reported safe | FIXED | backend returns explicit degraded/unknown and no global cage; integration commit pending |
| XAU-011 | High | unavailable `emergentintegrations` broke clean install | FIXED | removed bad pin; `backend/llm_adapter.py` preserves OpenAI/Anthropic behavior and fails honestly; clean full install still to rerun |
| XAU-012 | High | manifest/source/artifact/deployment mismatch | PARTIAL | interim is honestly labeled; final manifest/artifact/deploy not done |
| XAU-013 | Medium | obsolete M5/MQ5 public docs | FIXED | backend docs and frontend text staged; browser/build proof |
| XAU-014 | Medium | many stale EA copies/no authority map | PARTIAL | authority recorded here; do not delete user files; final release map pending |
| XAU-015 | Medium | readiness telemetry conflates sync/indicator states | UNPROVEN | not re-audited after EA completion; preserve for replay/terminal validation |
| XAU-016 | High | no immediate M10 restart history rebuild | FIXED | EA history contracts |
| XAU-017 | High | invented homepage drawdown/rating/performance claims | FIXED | homepage now first-party journal only, 20-trade minimum; 4 frontend contracts |
| XAU-018 | Critical | fabricated fallback gold quote/random spread | FIXED | backend unavailable/null response; frontend requires `available===true` |
| XAU-019 | High | JWT duplicated into localStorage | FIXED | cookie-only admin/customer flows; browser proved empty localStorage and JS-invisible cookie |
| XAU-020 | High | Command Center marketing preview looked like live `$12,847`, `87%`, online account | FIXED (staged) | `CloudLanding.jsx`, `CloudPromoSection.jsx`; now explicitly illustrative and contains no fake values; rebuild/browser rerun pending |
| XAU-021 | High | unverified 75% bonus, official-partner, universal broker/funded-account claims | FIXED (staged) | `BrokerSection.jsx`, FAQ, purchase copy; current terms were not supported by official broker search; rebuild/browser pending |
| XAU-022 | Medium | unconditional OneSignal `importScripts` could prevent base service-worker registration | FIXED (staged) | provider import is fail-soft; production SW registration and real push receipt unproven |
| XAU-023 | Medium | signup/login fields lacked associated labels; mobile carousel overflowed | FIXED (staged) | auth ids/labels/autocomplete; outer overflow clipping; mobile/browser rerun pending |
| XAU-024 | High | admin EA Config offered invented weekly targets/risk presets despite no EA wiring | FIXED (staged) | replaced with read-only owner release contract; build/browser pending |
| XAU-026 | High | M30 Command Center card does not show candidate ID, timer start/duration/remaining, lifecycle result, move-R, structural SL or reservation key | NOT STARTED | `CloudDashboard.jsx`, `BotActivityReq`, EA activity payload. Must map real EA fields only; never synthesize |
| XAU-027 | High | remote command request has no idempotency key; acknowledgement can overwrite a terminal status | NOT STARTED | `/cloud/command/request`, `/pending`, `/ack`, EA polling. Add tenant-scoped idempotency and conditional state transitions; executable Mongo tests |
| XAU-028 | Medium | M10 card said “waiting for a better entry price” when retracement evidence was true | FIXED (staged) | now says location evidence is noted inside the single timer; frontend contract passes |

The canonical detailed evidence ledger is `audits/CODEX_FULL_PROJECT_FINDINGS.md`; XAU-020 through XAU-028 and current remediation statuses have been added.

## F. Backend Authentication Contract

- EA/license validator: `_resolve_monitor_license(pin_or_key, account, request)`; accepts a valid active license PIN bound to the supplied account or the intentionally configured agent-token path. Missing/invalid credentials fail 401/403; wrong account fails 403. Empty required account fields fail 400 on repaired routes.
- Browser customer validator: `get_cloud_user`/`get_current_cloud_user` from HttpOnly `access_token`; customer JWT is no longer returned to or stored by JavaScript.
- Admin validator: `get_current_admin`; admin cookie is HttpOnly, `SameSite=Strict`, Secure by default, with `COOKIE_SECURE=false` only for explicit local testing. Admin response body no longer returns JWT.
- Active EA codebases: Gold root/backend copies and XauIndex root/backend copies send PIN plus account identity.
- `/ai/analyze`: requires `pin`, non-empty `account_id`; stored request excludes PIN and stores account identity.
- `/ai/manage-position`: same contract.
- `/ai/memory/record`: requires `pin`, non-empty `account`; stored document removes PIN and stores resolved `license_id`.
- `/ai/memory/report`: requires PIN/account; filters by `license_id`, with legacy PIN fallback only for historical records.
- `/ai/feedback`: requires authenticated PIN/account; stored secret removed in the staged implementation.
- `/journal/log`: requires PIN/account login; stores `license_id`, not a new PIN field.
- `/journal/weekly-report` and reads: require account/license identity and tenant filtering.
- `/ml/patterns/save` and `/load`: require PIN/account and tenant-scoped records.
- `/cloud/reservation/claim` and `/release`: require active bound license/account; immutable `execution_key`; release must match reservation ID and license ID.
- Frontend/admin requests use `withCredentials: true`; no bearer token/localStorage fallback remains in inspected clients.
- Workers/schedulers: still require a final route-by-route sweep. Do not assume all internal workers were exercised merely because the two EA clients were updated.
- Remaining accidental 401/403 risk: full backend suite and real EA-to-staged-backend integration have not run after every auth edit; legacy clients older than final v6.25.5 will fail newly protected routes by design and must not be advertised as compatible.

## G. Website and Command Center Work Completed

- Homepage performance: removed invented drawdown and AI rating; renders first-party EA journal values only and marks ratios insufficient below 20 trades.
- Public quote: no hard-coded price or random spread; unavailable provider produces null/unavailable and the header does not render numeric price.
- Authentication: customer signup/login and admin login succeed in an isolated browser; dashboard/admin APIs use HttpOnly cookies only. Browser showed `localStorageKeys=[]` and `document.cookie=''` after login.
- Customer empty state: new account truthfully showed Offline/No heartbeat, no equity/P&L/trade fabrication.
- Admin: dashboard, licenses, Bot Ops, notifications, settings, EA Config and payments pages were opened. Empty states were truthful; OneSignal showed `NOT_CONFIGURED` and “No notification can be delivered yet.”
- Optional LLM provider: supported local adapter retains operational OpenAI/Anthropic calls and propagates provider errors instead of inventing approval.
- Documentation/downloads: M10/M30/selectable mode/compiled EX5 language aligned; XauIndex unavailable and explicitly separate.
- Marketing/UX staged after browser findings: illustrative-preview labels, broker affiliate disclosure, no fake bonus/universal funded claims, read-only admin release contract, associated auth labels, mobile overflow clipping, fail-soft optional OneSignal worker.
- Final staged frontend proof: 9/9 forensic contract tests pass and the production build compiles successfully (`main.340e4090.js`, 188.66 kB gzip; `main.2dd3047c.css`, 15.4 kB gzip).

## H. Website and Command Center Work Remaining

### NEXT TASK FOR CLAUDE

**Implement and test truthful M30 candidate lifecycle visibility plus remote-command idempotency/state transitions.** Start in `frontend/src/components/cloud/CloudDashboard.jsx` (`M30ConsensusCard`), `backend/server.py` (`BotActivityReq`, `/cloud/command/request`, `/cloud/command/pending`, `/cloud/command/ack`), and the EA activity serializer. Display only real candidate ID, slot, evidence IDs, timer start/duration/remaining, execute/cancel result, move-R and structural-SL values. Never synthesize defaults. Add a tenant-scoped command idempotency key, reject duplicate active requests, expire pending commands once, and make terminal statuses immutable. Add Mongo-backed cross-tenant, duplicate, expiry and acknowledgement-race tests.

Priority queue after that:

1. **M30/entry UI:** `M30ConsensusCard`, `M10SignalCard`. Remove “waiting for better price” wording; show evidence-only location; show source mode even when M30 off; add stale timestamp/account/symbol/build checks.
2. **Remote commands:** `CloudDashboard.jsx` command dialog and backend command routes. Exercise PENDING→ACKED→EXECUTED/FAILED/SKIPPED end to end with EA; forbid terminal overwrite, replay and cross-tenant ack.
3. **Customer pages:** browser-inspect Trading, Analytics, Activity, More/Settings, Outlook and Downloads on mobile and desktop with empty/error/stale/live-shaped fixtures. Verify every field maps to API data.
4. **Session lifecycle:** executable tests/browser proof for logout, expired cookie, stale account, password reset, account deletion/export and admin MFA. Correct result is 401/403 plus clean redirect, never a fake logged-in view.
5. **Notifications:** prove base SW registers with OneSignal unavailable; prove frontend reports configured-only vs subscribed; test subscription ownership/duplicate send; real device receipt remains external proof.
6. **Responsive/accessibility:** rerun 390×844 homepage/Command/admin pages; no horizontal overflow; labels and focus names present; admin tables usable.
7. **Backend full test classification:** run all current backend tests individually/with local Mongo; distinguish obsolete historical-version expectations from active failures. Never report the prior full run (`1506 passed, 384 failed, 202 skipped`) as green.
8. **Clean install:** create a clean venv and install `backend/requirements.txt`; startup with optional providers absent; verify no feature silently disappears.
9. **Findings/docs:** keep `audits/CODEX_FULL_PROJECT_FINDINGS.md` and this handover synchronized after each repair.
10. **Release:** commit source first; recompile only if EA changes; copy final EX5 into release dir, update manifest with exact source commit/hash/artifact hash, rerun release tests, then push audit branch. Merge/deploy only per owner instruction and with explicit environment truth.

## I. Remote Command System

- Backend routes: `POST /api/cloud/command/request` (customer cookie + linked PIN + confirmation), `GET /api/cloud/command/pending` (EA license/account), `POST /api/cloud/command/ack` (EA license/account), `GET /api/cloud/command/recent` (customer cookie).
- Frontend: `CloudDashboard.jsx`, `COMMANDS` definitions and confirmation UI.
- EA: polls pending commands and posts acknowledgement through the active license/account contract.
- Existing lifecycle: `PENDING`; acknowledgement accepts `ACKED`, `EXECUTED`, `FAILED`, `SKIPPED`; `_expire_stale_pending_commands()` expires old pending records.
- Ownership: request is bound to customer `user_id`, linked license and MT5 account; pending/ack validate license and account; recent queries by `user_id`.
- Proven: authentication/ownership logic exists; browser showed empty command state. No command was sent during the browser audit because that would be a real control-side effect.
- Remaining defects: no client/server idempotency key; repeated submit can queue duplicates; ACK update is not conditional on current state and can overwrite terminal truth; no end-to-end EA acknowledgement test in this checkpoint; expiry and duplicate behavior require Mongo concurrency tests.

## J. Command Center Data Map

| Display | Real source | Current truth classification |
|---|---|---|
| Connection/heartbeat | latest tenant/account `cloud_bot_heartbeats`, `/cloud/monitor/status` | live when within freshness window; otherwise offline/stale |
| EA version/account/broker/symbol/timeframe | heartbeat posted by EA | live/self-reported; build hash visibility incomplete |
| Activity/decision feed | `/cloud/monitor/activity` tenant/account events | live events with backend dedupe; field completeness varies by EA build |
| M10 evidence | `details.m10_signal` posted by EA | live/self-reported; card checks newest timestamp/account/symbol |
| M30 consensus | `details.m30_consensus` | live only when `mode_active`; currently hides mode-off state and lacks full candidate lifecycle |
| Candidate ID/timer | intended EA activity fields | missing from current UI/possibly payload; NOT STARTED |
| No-trade/cancel reason | consensus/activity `decision`, `reason`, `final_blocker` | partially live; exact single-lifecycle result not fully mapped |
| Active campaign/direction/risk/lot/SL/R/floor/basket | heartbeat, activity and `cloud_trade_thesis_status` | mixed live/derived; requires field-by-field browser/API verification |
| Open Trade Thinking | `/cloud/monitor/thesis-status` upsert per license/ticket | live/self-reported; stale-ticket handling requires audit |
| Market bias | latest AI event then heartbeat fallback | derived/fallback; must be visibly stale/unknown when no evidence |
| AI confidence | latest event | advisory/self-reported; must not imply execution authority |
| Notifications | `/admin/notifications/health`, OneSignal frontend state | configured/subscribed status only; receipt unproven |
| Market Outlook | market-outlook routes using broker evidence when available | advisory-only; missing broker evidence must be unavailable, never execution authority |
| Remote command | command collection + EA ack | backend truth exists; idempotency/terminal immutability incomplete |

Detailed map: `codex_handover_xauaisniper/command_center_field_map.md`.

## K. Test and Build Results

- EA focused final batch: `90 passed, 13 skipped` in sandbox for v6.25.5 consensus/single-timer/auth/reservation files. The 13 skips were Mongo integration tests, then rerun separately.
- Mongo reservation authentication/concurrency: `13 passed` against local Mongo outside sandbox.
- Authenticated EA-client contract: included in the focused 90-pass batch; standalone earlier result `8 passed`.
- Frontend contract tests: `9 passed` (`frontend/src/forensic.contract.test.js`) after all current marketing/accessibility/PWA edits.
- Frontend production build: compiled successfully after current edits; output `main.340e4090.js` and `main.2dd3047c.css`.
- Python syntax/source equality: `py_compile` passed for `backend/server.py` and `backend/llm_adapter.py`; root/backend copies matched.
- MetaEditor Gold EA: 0 errors, 0 warnings. XauIndex: 0 errors, 0 warnings.
- Browser desktop: homepage, customer landing/signup/dashboard empty state, admin login/dashboard/licenses/Bot Ops/notifications/settings/EA Config/payments inspected. Cookie-only state proved.
- Browser mobile: homepage 390×844 initially found 12px overflow; responsive metric/clipping repair was rechecked at `scrollWidth=clientWidth=384`. Command Center landing also rechecked with no overflow, explicit illustrative label, no fake balance and no fake online state.
- Browser console: base SW registration failed while optional OneSignal worker import was unavailable; fail-soft repair staged, rerun pending.
- Full prior suite: `1506 passed, 384 failed, 202 skipped`; failures were largely obsolete historical-version tests/retired workers but remain unclassified and are not a pass.
- Admin MFA, full remote command lifecycle and actual push receipt: not run.

Exact summaries are in `codex_handover_xauaisniper/`.

## L. Current Deployment Truth

### GitHub

- `origin/main` and the audit branch currently point at interim checkpoint `bf82b8c`.
- Published release EX5 hash: interim `95dfa7…`.
- Dirty final source hash: `43628e1…`; canonical final EX5 hash: `88335e7…`; neither is committed/published yet.

### Mac MT5

- Inspected: yes.
- Experts-folder v6.25.5 hash: interim `95dfa7…`.
- Observed running journal before final rebuild: v6.25.4, XAUUSD M15; M30 mode not proven.
- Final repaired `88335e7…` deployed: no.

### VPS MT5

- Inspected: yes, Windows host `173.212.249.202`.
- Experts-folder v6.25.5 hash: interim `95dfa7…`.
- Running terminal existed; actual attached v6.25.5/M30 mode not proven.
- Final repaired `88335e7…` deployed: no.

### Backend

- Dirty staged source only. Local isolated uvicorn health passed during browser audit.
- Production deployed source SHA/restart/health: not changed or proven in this checkpoint.

### Frontend

- Local production build succeeded before latest staged edits.
- Production deployed: no.

## M. Owner Rules Claude Must Preserve

- Three completed M10 snapshots create the M30 decision.
- A valid M30 signal immediately starts one and only one fresh 120–180 second timer.
- No additional M10/M30 wait, confirmation candle, cooldown, AI wait, or long-lived retrace state.
- At timer finish: execute if valid and movement `<0.30R`; cancel if invalid; movement `>=0.30R` is missed/cancelled.
- Normal core risk is exactly the configured `10%`; no silent `0.01` lot, loss-based reduction, daily loss limiter or pause-after-loss.
- Structural invalidation is mandatory and widened exactly once by `1.20` before lot sizing; missing at expiry cancels.
- No simultaneous managed BUY and SELL.
- Exhaustion/location/retrace are evidence-only, not an added timing layer.
- Outlook and external AI are advisory-only.
- Position/exit management remains tick-based.
- No personal blockers, risk reductions, alternate arbiter or strategy redesign.

## N. Exact Resume Commands for Claude

```bash
cd /Users/libertyelectronics/XauAI-v6251-full-repair
git fetch --all --prune
git status --short
git branch -vv
git switch audit/codex-complete-xauaisniper-forensic-repair
git pull --ff-only
git log --oneline --decorate -30

.audit-venv/bin/python -m py_compile backend/server.py backend/llm_adapter.py
.audit-venv/bin/pytest -q tests/test_xau_v6255_m30_three_m10_consensus.py tests/test_xau_v6255_single_entry_timer_owner_correction.py tests/test_xau_v6255_authenticated_client_contract.py
.audit-venv/bin/pytest -q backend/tests/test_reservation_endpoint_authentication.py

cd frontend
CI=true npm test -- --watchAll=false
npm run build
cd ..

shasum -a 256 XAUUSD_AI_Sniper_EA.mq5 backend/ea_code/XAUUSD_AI_Sniper_EA.mq5 /tmp/xauai-v6255-final-compile/XAUUSD_AI_Sniper_EA_v6.25.5.ex5
cmp -s XAUUSD_AI_Sniper_EA.mq5 backend/ea_code/XAUUSD_AI_Sniper_EA.mq5
```

Local browser startup (use non-secret local values; do not commit credentials):

```bash
cd /Users/libertyelectronics/XauAI-v6251-full-repair/backend
ENVIRONMENT=development COOKIE_SECURE=false MONGO_URL=mongodb://127.0.0.1:27017 DB_NAME=xauai_codex_browser_audit CORS_ORIGINS=http://127.0.0.1:3001 ../.audit-venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8001

cd /Users/libertyelectronics/XauAI-v6251-full-repair/frontend
REACT_APP_BACKEND_URL=http://127.0.0.1:8001 BROWSER=none PORT=3001 npm start
```

Use the browser skill/in-app browser for UI verification. Do not use destructive git commands. MetaEditor verification is unnecessary unless MQ5 changes; if it does, compile an isolated copy and require an explicit `Result: 0 errors, 0 warnings` plus a new hash.

## O. Unproven Items

- Real broker order/retcode/position reconciliation under faults.
- Historical replay and a live v6.25.5 M30 trade lifecycle.
- Mac and VPS actually running the final `88335e7…` artifact in M30 mode.
- Final artifact release manifest, GitHub publication and production deployment.
- Backend/frontend production deploy and restart health.
- Browser push subscription and real notification/device receipt.
- Admin MFA browser flow.
- Customer Trading, Analytics, Activity, More/Settings, Outlook and Download pages across live/error/stale states.
- End-to-end remote command pending/ack/executed/expired/duplicate behavior with a real EA.
- Full mobile/admin responsive rerun after staged CSS changes.

Nothing above may be promoted from UNPROVEN to PASS merely because source code exists or an artifact compiled.
