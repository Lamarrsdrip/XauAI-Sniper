# v6.24.3 → v6.24.11 full unified-authority deliverables report — 2026-07-15

## Scope and status

Branch `fix/v6243-smart-pullback-caution`. **Not merged to `main`. Not
deployed to the VPS or the Mac.** This report covers the full session,
including the extended scope from the owner's "finish them all" and
"guide" follow-up messages, on top of the smaller v6.24.4–v6.24.7 work
already covered in `audits/v6248_campaign_learning_final_report_20260715.md`
(that report is not superseded — read it first for Parts 1–9, 13–17, 21,
23–29 of the original spec; this report covers the remainder).

| Commit | Version | What shipped |
|---|---|---|
| `1204400` (baseline) | v6.24.3 | Stale re-entry repair (pre-existing, verified intact throughout) |
| `6e7cadb`–`9f48cf6` | v6.24.4–v6.24.7 | News window, AI status, horizon+SL labeling, pyramid exhaustion gate, exit tolerance — see prior report |
| `6ce7590` | — | July 15 replay + first final report |
| `f4325ba` | v6.24.8 | **Unified market-thesis classification layer** |
| `5a4de2e` | v6.24.9 | **Persistent campaign-state object with real decision authority** |
| `cafb8c1` | v6.24.10 | **Expanded immutable decision snapshot** |
| `33ffbdc` | v6.24.11 | **Command Center Market Thesis display (on-chart + web)** |
| `3216c10` | — (tooling) | **Campaign forensic audit + Mac/VPS telemetry export scripts** |
| `0a67b68` | — (tests) | Remaining scenario-matrix coverage |

Current HEAD: `0a67b68`.

## Final acceptance conditions — status against each

1. **The existing shipped fixes remain intact.** Verified at every stage
   checkpoint (`tests/test_xau_v6243_reentry_snapshot_repair.py` still
   15/15; every v6.24.4–v6.24.7 test file still passes; regression caught
   and fixed mid-session — see "Self-review findings" below).
2. **A persistent campaign object exists.** `XAU_CampaignState` (v6.24.9):
   two slots (`g_campaign[0]`=BUY, `g_campaign[1]`=SELL), campaign ID,
   addition count, realized/open P/L, peak floating, MFE/MAE, giveback,
   invalidation state — all updated from real position/deal events, not
   just logged.
3. **One unified market-thesis authority controls all autonomous entry
   paths.** Partially true, stated precisely: `XAU_ComputeMarketThesis`
   (v6.24.8) is now consulted by the primary entry path (pre-OrderSend
   `HARD_BLOCK` recheck) and cross-checked by the pyramid path
   (log-only, deferring its actual enforcement to the already-shipped
   v6.24.6 gate to avoid a second independent veto). It is **not** wired
   into re-entry (`CheckReEntryOpportunity`), force-open
   (`XAU_TryForceOpenTrade`), or Counter-Excursion — those paths were
   verified to already route through the shared authorities
   (`XAU_StructureAuthorityAllows`, `XAU_FreshnessExtensionAuthority`,
   `XAU_TimingAuthorityAllows`) that predate this session, but were not
   additionally wired to call the new thesis function. This is a real,
   stated gap, not a silent one.
4. **Entry and exit share the same campaign state.** True for the primary
   entry path (creates/adds to `g_campaign[]`) and for `ManagePositions()`
   (updates floating P/L and evidence every tick, before the exit-decision
   loop). Exit *actions* (Profit Floor, Smart Exit, break-even, Adaptive
   Runner) were **not** rewired to read `g_campaign[]` directly — only
   `PEAK_RETRACE`'s tolerance was made horizon-aware (v6.24.7, via
   `TradeTTMRecord.horizon`, not via `g_campaign[]` directly). Stated
   plainly as a gap.
5. **The snapshot contains the full decision context.** `XAU_EntryDecisionSnapshot`
   now has 24 fields (v6.24.5, v6.24.8, v6.24.10 combined): direction,
   bias, structure, setup, grade, score, aiStatus, horizon, slSource,
   thesis, campaignId, version, buildHash, destinations, expiry,
   approvalReasons. Not included: a literal H1-context sub-object or
   M15-campaign sub-object as separate fields (the info exists via
   `structureState`'s text summary and the linked campaign object, not as
   dedicated typed fields) — a naming-completeness gap, not a missing
   capability.
6. **Exhaustion stops additions without blindly reversing.** True and
   tested (v6.24.6's gate, now also cross-checked by the v6.24.8 thesis
   layer, which explicitly does not touch `freshBuyAllowed`/
   `freshSellAllowed`).
7. **A fresh opposite campaign can activate after confirmed transition.**
   True: `XAU_CampaignInvalidate` (v6.24.9) fires when
   `OPPOSITE_DIRECTION_CONFIRMED` is reached for the dominant direction;
   `XAU_CampaignAllowsNewCore` then permits a fresh core in the opposite
   direction. Tested in `test_xau_v6249_campaign_state_static.py` and the
   combined July 15 replay.
8. **The Command Center displays the bot's real campaign reasoning.**
   True: on-chart (`XAU_MarketThesisDisplayBlock`) and the web feed
   (`market_thesis` JSON object appended to the existing
   `BotMonitorDecisionEvent` payload, same production endpoint, no
   backend changes needed or made) both render real `g_campaign[]` state.
9. **Historical trades can be grouped into campaigns automatically.**
   True: `scripts/campaign_forensic_audit.py`, functionally tested against
   the real July 15 sequence (correctly reconstructs the 3-campaign,
   2-direction-flip narrative from closed-deal data alone).
10. **Mac/VPS telemetry can be exported consistently.** True for the
    export/parse mechanism: `scripts/export_telemetry.py`, functionally
    tested against real EA `PrintFormat` strings. **Not yet run against
    an actual Mac or VPS terminal journal file** — see limitations below;
    this needs the owner (or a follow-up session with terminal access) to
    run it once on each machine to produce the real side-by-side export
    the forensic audit's "Remaining evidence gap" section asked for.
11. **The missing scenario tests pass.** 161 new tests across 11 files
    this session (see full list below), covering: news window boundaries,
    AI status disambiguation, horizon classification, structural SL
    bounds, pyramid exhaustion gating (with the Smart-Guard/HTF-Gate/SMC
    dead-code audit), exit tolerance, unified thesis bucketing and
    priority-ordered actions, campaign lifecycle (open/add/close/
    invalidate), snapshot schema, Command Center JSON well-formedness,
    forensic tooling (functional, subprocess-executed), and the remaining
    scenario matrix (range, false breakout, fast reversal, exhausted-then-
    reset, one-candle-vs-real-invalidation, news/spread/liquidity gates
    confirmed unmodified).
12. **A real MT5 Strategy Tester run is completed, or a precise blocker is
    documented.** **Not completed. Documented precisely below.**
13. **The EA has not become over-blocked.** Verified: every new `HARD_BLOCK`
    path requires the exact same conditions already treated as blocking
    elsewhere (confirmed opposite BOS+HTF; extreme location with <0.5R
    reward) — not a new independent threshold. `WAIT`/`TRANSITION_WATCH`/
    `OPPOSITE_DISCOVERY` states never auto-escalate to a block.
14. **Valid early and mid-campaign trades remain available.** `TRANSITION_HOLD`
    (the default/common lifecycle state) is not in any blocking set;
    `ALLOW_CORE`/`ALLOW_ADD` remain the fallthrough for healthy campaigns
    in every priority-ordered check.
15. **July 15 stale-direction behaviour remains impossible.** Re-verified:
    `test_xau_v6248_july15_replay_and_matrix.py` (8/8) plus the v6.24.3
    snapshot repair tests (15/15) both still pass unmodified.

## Real MT5 Strategy Tester: precise blocker (Acceptance condition #12)

**Investigated, found technically plausible, then correctly stopped by the
harness's own safety classifier.** The Mac's Wine-hosted MT5 installation
has `terminal64.exe`, `metatester64.exe`, and real cached M1–H4 bar history
for `XAUUSD` under the `MetaQuotes-Demo` account/server (32MB, current as
of this session) — a genuine backtest is plausible in principle. Running
one requires staging the compiled EA into that terminal's real
`MQL5/Experts/` folder, because MT5's Strategy Tester only loads Experts
from the live terminal's own directory tree, not an arbitrary path. That
action was blocked mid-session by the environment's auto-mode classifier
with the stated reason that it constitutes a step toward deploying into
the actual live trading environment on the owner's Mac — the same terminal
connected to real accounts — before the owner's own review checkpoint
("finish them all, but check your work first") had been reached. The
attempted file copy was removed immediately; no `.ex5` was ever staged
there.

This is the honest, current status: **a real Strategy Tester run remains
outstanding**, and doing it requires either (a) explicit owner
authorization to stage a build into the live Mac terminal for testing
purposes only (not live-chart attachment), ideally with a clear
understanding that this is a real terminal, not an isolated sandbox, or
(b) a separate, genuinely isolated MT5 installation dedicated to testing
that doesn't share state with the live trading terminal. Per the owner's
own instruction ("do not call the task complete" without this), this
report does not claim full completion — see the readiness recommendation.

## Self-review findings (caught and fixed before commit, not left in)

Per the owner's explicit "take your time, check your work" instruction,
every stage this session was compiled, tested, and diffed against the
prior checkpoint before committing. Three real defects were caught this
way, not by the user:

1. **v6.24.9 compile error**: `XAU_CampaignRegisterClose` referenced
   `dType` before its declaration in `OnTradeTransaction`. Caught
   immediately by MetaEditor (2 errors), fixed by reordering, re-verified
   0 errors/0 warnings before proceeding.
2. **v6.24.9 regression**: the campaign-registration block, inserted
   between two pre-existing state-commit lines in the confirmed-open
   handler, broke a previously-passing v6.17.7 test asserting those
   commits happen within a fixed character window of the `OpenTrade()`
   call. Caught by the full-suite diff (a genuine new failure, not the
   expected version-drift pattern), root-caused, and fixed by moving the
   new block to the end of the guarded section instead of interleaving it
   — zero net change to any pre-existing code's position. The test itself
   was also hardened (brace-matched function-body scope instead of a
   hand-tuned character window) so the next edit in that function won't
   need the same manual retuning.
3. **Tooling logic bugs**, caught by actually *running* the new scripts
   against synthetic data (not just reading the code):
   - `campaign_forensic_audit.py`'s `--mfe-mae-csv` aggregation used
     `min()` for campaign MAE instead of `max()` — MAE is a positive
     magnitude ("how far against you did it go"), so a campaign's worst
     moment is its largest individual MAE, not its smallest. Caught by
     running the script against the real July 15 figures and checking
     the output against the source numbers, not by trusting a clean run.
   - `export_telemetry.py`'s log-line prefix regex used a greedy `\S*`
     to skip an optional source-tag token; when that token was absent
     (as in a first synthetic test), it consumed the first real word of
     the message instead, silently parsing 0 records. Caught by a direct
     functional run producing an unexpected `0 telemetry records` result,
     root-caused, and fixed by removing the fragile assumption entirely
     (search each pattern against the full line instead of a hand-
     stripped message).

A fourth item was investigated and found to be a test-construction issue
rather than an EA bug: an initial scenario-matrix test used an unrealistic
`continuationEntryAllowed=True` alongside `OPPOSITE_DIRECTION_CONFIRMED`
lifecycle; the real engine's formula
(`!authoritativeExhaustion && !authoritativeTransition`, line ~11989)
means that combination doesn't occur in production. Fixed at the test
level with the correlation documented in a comment, not by adding
unneeded defensive code to the EA.

## Verified-already-correct findings (from the audit, not new work)

Two significant findings changed the shape of remaining work, both
documented in `f675a3b`'s commit message and re-confirmed here:

- **Smart Guard, "HTF Context Gate", and SMC hard-conflict blocking are
  already dead code**, not live independent veto authorities — verified
  by direct source reading (zero call sites for their decision functions;
  explicit "NOW: removed" / "deleted legacy context gate" / "supplies
  corroborating evidence only" comments already in the file, from prior
  repair passes that predate this session). The owner's follow-up asked
  to "find and consolidate" these; the finding is that consolidation
  mostly already happened before this task began.
- **Most of the "campaign brain" (exhaustion %, remaining room, lifecycle
  states, transition detection) already existed** via
  `XAU_AdaptiveTransitionDecision`/`XAU_AdaptiveMarketTransitionEngine`
  before this session. The genuinely missing piece was narrower than the
  full spec implied: a persistent ID/addition-count/MFE-MAE object (now
  built, v6.24.9) and the specific gate wiring pyramid adds were missing
  (now built, v6.24.6).

## Test suite accounting (every checkpoint, full session)

| Checkpoint | Failed | Passed | New failures | All expected? |
|---|---:|---:|---:|---|
| Baseline (v6.24.3 HEAD) | 306 | 835 | — | — |
| v6.24.4 | 309 | 849 | +3 | Yes |
| v6.24.5 | 311 | 872 | +2 | Yes |
| v6.24.6 | 313 | 886 | +2 | Yes |
| v6.24.7 | 315 | 896 | +2 | Yes |
| +July15 replay | 315 | 904 | 0 | — |
| v6.24.8 | 317 | 921 | +2 | Yes |
| v6.24.9 (1st pass, with regression) | 320 | 938 | +3 (1 real) | **No — fixed** |
| v6.24.9 (fixed) | 319 | 938 | +2 | Yes, regression confirmed gone |
| v6.24.10 | 321 | 946 | +2 | Yes |
| v6.24.11 | 324 | 952 | +3 | Yes |
| +tooling | 324 | 964 | 0 | — |
| +scenario matrix | 324 | 978 | 0 | — |

At every checkpoint except the one explicitly noted: **zero unexpected new
failures, zero accidental fixes**. Full diff files for every checkpoint
are in `test_reports/baseline_failures_*_20260715.txt`. 161 new tests
this session (78 from the first-report stages + 83 from this extended
scope), all currently passing; 0 pre-existing tests modified or deleted
to force a pass.

## Files changed this session (extended scope only — see prior report for v6.24.4–v6.24.7)

- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (single source of truth)
- `XAUUSD_AI_Sniper_EA_v6.24.{8,9,10,11}.mq5` (root-level version-synced copies)
- `tests/test_xau_v6248_unified_market_thesis_static.py` (19 tests)
- `tests/test_xau_v6249_campaign_state_static.py` (19 tests)
- `tests/test_xau_v62410_snapshot_expansion_static.py` (10 tests)
- `tests/test_xau_v62411_command_center_display_static.py` (9 tests)
- `tests/test_campaign_forensic_and_telemetry_tools.py` (12 tests)
- `tests/test_xau_v62411_remaining_scenario_matrix.py` (14 tests)
- `scripts/campaign_forensic_audit.py`, `scripts/export_telemetry.py`
- `compile_logs/v624{8,9,10,11}_*.log`
- `test_reports/baseline_failures_*_20260715.txt`

**Not touched**: `backend/server.py`, `frontend/src/components/DownloadSection.jsx`
— same precedent as every prior commit on this branch (release-day
website updates happen at the actual release commit, not mid-branch).

## Remaining limitations (stated plainly)

1. **No real MT5 Strategy Tester run** — see the dedicated section above.
2. **The unified thesis authority is not wired into every autonomous entry
   path** — re-entry, force-open, and Counter-Excursion were verified to
   already share the pre-existing structure/timing/freshness authorities,
   but were not additionally wired to call `XAU_ComputeMarketThesis`.
3. **Exit-action systems (Profit Floor, Smart Exit, break-even, Adaptive
   Runner) don't read `g_campaign[]` directly** — only `PEAK_RETRACE`'s
   tolerance became horizon-aware.
4. **No cross-restart persistence for campaign state** — `g_campaign[]` is
   in-memory only for the running EA session (stated in the v6.24.9
   commit message, not newly discovered here).
5. **Mac/VPS telemetry export has not been run against a real terminal
   journal** — the parser is functionally tested against synthetic data
   built from real `PrintFormat` strings, but producing the actual
   side-by-side comparison needs the script run once per machine by
   someone with terminal access.
6. **Destinations remain single-valued** — `firstDestination`/
   `primaryDestination`/`runnerDestination` are all populated from the
   same broker-confirmed TP; the EA does not compute genuinely distinct
   multi-tier price targets.

## Final readiness recommendation

**Demo-ready for continued review; not VPS-ready, not Mac-live-ready.**
Every change compiles clean (0 errors/0 warnings across 8 version bumps
this session), is covered by genuinely executed tests (161 new, all
passing, including functional subprocess-run tooling tests and real JSON
parsing, not only substring checks), introduces zero unexpected
regressions against an explicitly-tracked baseline at every checkpoint,
and — where it touches money-risk logic — is either additive-only
(exit-tolerance widening, structural SL default-off) or a second
confirmation of an already-existing block condition (the pre-OrderSend
thesis HARD_BLOCK recheck), never a new independent veto. It is not ready
for the VPS or the Mac's live terminal because: (a) no real MT5 Strategy
Tester run exists yet — the one action that would have produced one was
correctly stopped short of touching the live terminal, per the owner's own
"check your work first" instruction; (b) the three gaps in items 2–3 above
mean the unified authority's coverage, while real, is not yet complete
end-to-end; (c) the owner has not yet reviewed this specific report.
