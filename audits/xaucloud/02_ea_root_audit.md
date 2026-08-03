# XauCloud EA Root Audit (Phase 2)

Scope: `XAUUSD_AI_Sniper_EA.mq5` on `release/xaucloud-final-production-audit`
(base `210f0e8`, `experiment/v62524-m10-fixed-sl`). Independent focused audits were run for
signal/timing+restart, lot sizing, pyramid/re-entry, and exit hierarchy; findings below are
consolidated from all four plus the Phase 1 architecture pass. Every claim is file:line-backed;
anything requiring a live terminal/broker to fully confirm is explicitly marked unproven.

## Findings register

| ID | Severity | Area | Root cause | Fix | Proof | Status |
|---|---:|---|---|---|---|---|
| XC-001 | High | Backend docs/API (`server.py:1383-1404`) | `/architecture`, `/docs/how-it-works`, `/docs/installation`, `/docs/setup-guide`, `/docs/video-guide` describe a "Selectable Decision Authority" where customers must "review Decision Mode" and "select M30 three-snapshot mode explicitly" — but on this branch `InpDecisionMode` is a compile-time `const` locked to `XAU_DECISION_M10_LEGACY` (`XAUUSD_AI_Sniper_EA.mq5:2126`); the M30 path is dead code (line 20299 comment: "no selectable or executable M30 consensus branch in this build"). Customers are told a mode-selection feature exists that does not. | To be applied in Phase 5 (backend docs strings rewritten to state M10 legacy is the sole authoritative decision mode in this release; no EA logic change). | Confirmed via grep of both the EA source and the exact backend response strings. | Logged; fix scheduled Phase 5 |
| XC-002 | High | EA re-entry (`XAU_CreateReentryState`, was lines 12855-12862) | `InpMaxReEntriesPerDay` (line 2741, default 1, documented "Hard cap on re-entries per trading day" and referenced in the startup log banner at line 11188) was declared and incremented (`todayReEntryCount++`, line 13006) and reset daily (lines 10925, 12662) but **never compared against the cap anywhere in the file** — confirmed by full-file grep before the fix. A losing trade could re-arm and re-fire re-entry an unbounded number of times per day despite the documented hard cap. | Added an explicit `if(todayReEntryCount >= InpMaxReEntriesPerDay)` guard in `XAU_CreateReentryState`, before the state is armed (`g_reentryState.active = true`), logging `REENTRY_BLOCKED_DAILY_CAP` and refusing to arm. **First-pass fix had a real bug, caught by adversarial review before commit**: `todayReEntryCount`'s authoritative daily reset lives in `UpdateDrawdownState()`, which the close-handler calls *after* `XAU_CreateReentryState()` on the same event (`XAU_CreateReentryState` → `RecordCloseForStreak` → `UpdateDrawdownState`, ~line 31823-31829) — so the first close of a new day would have read yesterday's stale count and wrongly blocked a legitimate re-entry. Corrected by re-deriving the day boundary inline inside `XAU_CreateReentryState` (reads `todayLossResetDay` read-only, resets only the local `todayReEntryCount` comparison value, does not take over ownership of writing `todayLossResetDay` — `UpdateDrawdownState` remains its sole writer and still runs its own idempotent full reset moments later). This enforces an *existing* documented input/cap — it adds no new owner restriction and changes no other input, threshold, or timing. Applied identically to both `XAUUSD_AI_Sniper_EA.mq5` and `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (byte-identity preserved, verified via `cmp`). | `tests/test_xau_v62524_reentry_daily_cap_enforcement.py` — 8/8 passed, including the corrected day-boundary ordering and confirming `todayLossResetDay` is never written by this function. Independent adversarial-review agent confirmed: no other call site arms `g_reentryState.active` (single arming site, post-cap-check), SL-hit path (`wasSLHitExact`) unaffected (early-returns before the new check), increment site only fires on real opens. | **FIXED**, regression-tested, adversarially reviewed |
| XC-003 | Low | EA exit-hierarchy comments (`ManagePositions()`, ~28679-28696) | A documented 6-step exit-precedence comment block in `ManagePositions()` describes a hierarchy (ProtectPeakProfitFloor → … → time-expired) that is dead code in the shipped default config: `XAU_RExitOwnsNormalPositions()` (line 26748) returns true whenever `InpRExitEnable && g_rExitConfigValid`, both true by default, so every R-owned ticket `continue`s past `ManagePositions()`'s own checks at line 28836-28837. The actual live precedence is inside `XAU_RExitCoreLoop()` (line 28243). This is a stale/misleading maintainer-facing comment, not a functional defect (the correct engine does run) — but it is exactly the kind of "hidden dead authority" the owner's brief asks to be surfaced. | Not code-behavior-affecting; recommend a one-line comment update in a future pass clarifying that the `ManagePositions()` block is legacy/inactive under default config. Not changed in this pass to avoid touching exit code without a dedicated review cycle. | Confirmed via grep/read of both functions. | Logged, not yet annotated |
| XC-004 | Medium (confirm-with-owner) | EA profit-floor reset (`guaranteedFloorR`, lines 26895-26899) | The ratcheted profit floor (`guaranteedFloorR`, normally monotonic non-decreasing, line 28477) is explicitly reset to `0.0` when the owner-gated "GENERAL 10-minute extension" arms (line 26899), intentionally reverting broker-side protection toward the original, looser structural stop while the extension window runs. This is a named, gated, pre-existing policy (comment 26895-26897), not a bug — but it is a real backward move in protection level that the owner brief's "profit floors cannot move backwards" requirement calls out explicitly. | No code change made — this needs an explicit owner confirmation that the GENERAL-extension floor reset is intended production behavior, not a repair target. Flagged for the release-gate report rather than unilaterally "fixed." | Confirmed via read of the gating condition (line 26843-26847) and reset site. | **Flagged for owner decision**, not modified |
| XC-005 | Low (recommendation) | EA order identity (CORE `OpenTrade` line 22942-22943 vs. PYRAMID line 18472-18473) | CORE and PYRAMID orders share one `InpMagicNumber` (20250401); differentiation for reconciliation relies entirely on the order-comment string prefix (`"XAU-SNIPER|..."` vs `"XAU-SNIPER|PYRAMID_TWO_GATE..."`), which is broker-dependent (MT5 comment truncation, commonly 31 bytes) rather than a structurally guaranteed field. | Recommend (not applied) a distinct magic number for pyramid legs in a future, carefully-coordinated release — changing magic-number scheme risks breaking reconciliation for already-open live positions if not sequenced correctly, so it is out of scope for this pass. | Confirmed via grep of both send sites. | Logged, not applied |
| XC-006 | Low (repo hygiene) | Test suite decay (`tests/test_xau_v6243_reentry_snapshot_repair.py::test_source_defers_reentry_until_after_current_scan_snapshot`, `tests/test_xau_v6250_smart_reentry_post_profit.py::test_blocks_only_on_wait_or_missed_not_other_decisions`) | Both tests fail looking for exact substrings (`"if(CheckReEntryOpportunity()) return;"`, `"if(postProfitDecision == POST_PROFIT_WAIT_FOR_RETRACE || ..."`) that are absent even in the pre-audit baseline tag (`pre-xaucloud-audit-20260724`) — confirmed via `git show` diff before any of this session's edits. Pre-existing source drift from an earlier version bump, unrelated to this audit's changes, and not yet in `tests/known_obsolete_failures.txt`. | Not fixed in this pass (out of scope of the M10/fixed-SL/rebrand mandate; would require re-deriving what the current equivalent code path actually is). Logged so it isn't silently swept into "regression tests passed." | `pytest` run this session: 2 failed / 30 passed across the two files, confirmed pre-existing via baseline-tag diff. | Logged as pre-existing decay |

## Areas audited with no defect found (evidence, not just assertion)

- **Lot sizing** (`OpenTrade` line 21681, pyramid block 18320-18420): balance/equity source correct
  (`StrategyReferenceBalance`, line 9964); risk distance used is the internal structural/ATR
  distance (`finalGeometry.finalOriginalRiskDistance`), never `InpStopLossGoldMove` — confirmed
  independent per owner requirement; no silent 0.01-lot fallback (explicit `RISK_BLOCKED_LOT_BELOW_MIN`/`ZERO_RAW_LOT` rejection, line 22302-22321); every historical loss/fear/AI-confidence
  multiplier confirmed disabled/informational-only for CORE entries (line 22566+); pyramid uses the
  same risk-cap authority as CORE (one documented divergence: pyramid margin gate uses a flat
  50%-free-margin cap vs. CORE's margin-minus-reserve check, line 18404-18409 — a pre-existing,
  documented difference, not a hidden uncapped path).
- **Pyramid direction/duplicate guards**: cannot fire opposite-direction (derived from the open
  position's own type, line 18164/18185-18194); max-add cap enforced and re-clamped to
  `InpMaxOpenTrades-1` (18043/18121); same-bar duplicate adds blocked via
  `lastApprovedPyramidEvidenceBar` (18269-18277) plus a 30s broker-settlement dedup (38362-38364);
  restart reconstructs `additionCount` from live broker positions and forces a fresh evidence-bar
  requirement so a stale pre-restart evidence bar cannot fire a pyramid (6190-6226).
- **Re-entry gates (beyond the daily-cap defect)**: signal freshness/expiry enforced
  (12894-12895, 12870-12886); direction-flip/bias-conflict/structure-flip blocks present
  (12898-12920); re-entry passes through the *same* `OpenTrade()` call as fresh CORE entries
  (13003-13004) — no reduced/bypassed gate set.
- **Restart/broker-truth reconciliation**: `OnInit` rebinds to real broker positions
  (`XAU_ReconcileCampaignOnInit`, 6190-6226) and reloads persisted R-exit/basket-floor state from
  disk (27163-27219, 11265); campaign lifecycle/pyramid history is deliberately reset to a
  conservative default on restart rather than fabricated (documented, not a bug). Broker-side SL is
  read back and reconciled post-send (`XAU_ReconcileBrokerOpenTruth`, 5453-5490), with an emergency
  close (`OWNER_R_EXIT_INITIAL_SL_UNCONFIRMED`, 22980-22985) if confirmation ultimately fails — no
  silently-naked position by design. `OnTradeTransaction` uses actual broker deal records
  (`HistoryDealGetInteger`), not a trusted boolean.
- **External-service failure handling**: all new-entry paths (CORE/pyramid/counter-excursion)
  fail-closed if the backend reservation call is unreachable (`RESERVATION_BACKEND_UNREACHABLE`,
  5391-5396) — deliberate, owner-documented. Existing-position exit/protection management
  (`OWNER_R_EXIT_CLOSE_ONLY`, `SafeModifySL`) makes local-only broker calls with no WebRequest
  dependency, so open positions continue to be protected even if the backend/license service is
  down — matching the brief's "core trading authority must remain local" requirement.

## Explicitly unproven from static source alone (carried to Phase 8 live-step package)

- Actual runtime behavior of `OrderCalcMargin`/`OrderCalcProfit` under real broker responses.
- Live mid-restart recovery correctness (file I/O timing, broker reconnect race).
- Broker-fault-injection behavior (partial fills, requotes, ambiguous sends) beyond what the
  retry/reconciliation code paths describe.
- Real network-outage behavior of the reservation-claim fail-closed path end-to-end.
- Whether SL-hit trades underperform EA-managed closes *on this specific fixed-SL branch* — no
  existing analysis in `analysis/`/`audits/` breaks this down for this branch (the existing
  `M10_FIXEDSL_ISOLATION_REPLAY.md` compares two whole-run totals, not a SL-hit vs. managed-exit
  split within one run). Stated as genuinely unresolved rather than assumed either way.
