# XauAI Sniper — Release Checklist

Use this checklist before calling any version "released."
A release is NOT complete until every line is checked.

---

## v6.16.1 — 2026-07-07 — Self-audit fix: structural vs AI-opinion bypass split

### EA Compile
- [x] EA internal version: `#property version "6.161"`
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.16.1.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6161_final.log`)

### Self-audit finding
v6.16.0's `XAU_ModeAllowsSoftBlockWarning()` fix applied one unified rule to all 11 grade-based
soft-bypass call sites. Re-auditing on request surfaced that these are two different categories:
structural/market-fact gates (SmartGuard fast-TF, STI/TRI re-entry watch, news-aftermath, SMC
conflict, AI_LOW_CONF_SKIP) vs. AI's-own-opinion-escalation gates (HTF-override, weak disagreement,
no-confidence skip, confident-B-skip) plus one unrelated permissive feature-gate (Strong Momentum
Precheck). Treating them identically meant AI weak-disagreement on a good structural A+/A setup was
being fully blocked by default rather than allowed through at reduced size — more conservative than
necessary and not what "AI can filter/reduce, cannot override structure" was supposed to mean.

### Fix
Split into `XAU_StructuralBypassAllowed()` (closed by default under AI_ADVISOR_ONLY/AI_FILTER_ONLY/
AI_OFF/RestoreMode, only AI_DIRECTOR opens it — used at the 6 structural sites) and
`XAU_ModeAllowsSoftBlockWarning()` (reverted to its original trade-mode-only logic — used at the 5
AI-opinion/feature sites, which are already inert under ADVISOR_ONLY/RestoreMode since the whole AI
Director cascade short-circuits earlier via `XAU_AIIsAdvisoryOnly()`).

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] `tests/test_xau_v6160_direction_engine_v2_and_risk_reconcile_static.py` updated + expanded —
      20/20 passing (verifies both gates individually, all 6 + 5 call sites by name)
- [x] Full suite: 245/269 passing; the 24 failures are the same pre-existing release-time sync tests
      from v6.16.0 (confirmed unrelated to this change)

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.16.1.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- [x] Frontend version strings
- [ ] GitHub main branch pushed

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — same standing as v6.16.0, demo-validate both fixes together

---

## v6.16.0 — 2026-07-07 — Direction Engine v2 + Universal Risk Reconciliation

### EA Compile
- [x] EA internal version: `#property version "6.160"`
- [x] EA header comment: v6.16.0
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.16.0.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6160_final.log`)

### Root cause — risk mismatch (live log: Executed=4.27% vs Displayed=0.40%/ConfigBase=1.20%)
Traced the full lot path: `InpLotSizingMode` defaults to `JUNE_16_19_BALANCE_MODE`, which sizes
lots from `(balance/1000) * InpJuneBalanceLotPer1000 * gradeMult` — **not** from actual SL distance.
Worse, the equity-cap (`InpMaxRiskPctEquity`), Growth Guard cap, and aggregate-risk cap are all
explicitly skipped when `juneBalanceLotMode` is true (`grep "risk caps bypassed"`), at both the main
entry path and the pyramid-add path — so under the *default* lot mode, none of the risk-based safety
caps ever ran. `InpRiskPercent` (labeled "Displayed" in the log) was never read by the sizing math at
all — a second, independent cosmetic bug. Fix does NOT change lot-sizing philosophy or shrink normal
trades: `XAU_ReconcileFinalRisk()` is a narrow backstop that only intervenes when the final lot would
truly breach `InpMaxRiskPctEquity` (the EA's existing real hard-cap input), reducing to the maximum
safe lot (rounded down to lot step) or blocking outright if even the broker minimum lot exceeds the
cap. Logs `REQUESTED_RISK_PCT`/`APPROVED_MAX_RISK_PCT`/lot before+after/`ACTUAL_EQUITY_RISK_PCT`/
`RECONCILIATION_ACTION` on every trade.

### Adaptive Direction Engine v2
Upgraded from v6.15.0's 2-tier (medium/strong, M5-only) to a 3-tier WEAK/MEDIUM/STRONG engine:
- New: genuine HH/HL vs LH/LL swing-sequence read (`XAU_SwingSequenceDir`, fractal pivots, reused for
  both M5 and M15) — this is what lets a normal pullback (sequence intact) be told apart from an
  actual breakdown (sequence broken), the explicit goal of the upgrade.
- New: CHoCH is now the real break of the most recent confirmed fractal swing point (from the
  sequence scan), not a relabeled rolling-window proxy.
- New: M15 structure check, feeding a "M5+M15 aligned" path into the STRONG tier.
- New: failed-breakout (`XAU_AssessFailedBreakout`) distinct from failed-continuation — a breakout
  attempt reversing back inside the range, vs. an established trend stalling.
- WEAK tier (new): CHoCH-level warning / failed continuation → `DIRECTION_TRANSITION_WAIT`, pauses
  only the weakening side, never forces the opposite.
- Applied via one central gate (`CheckForEntry`, right after `ScoreSetups()`) covering
  TREND_PULLBACK/BREAKOUT/RANGE_REVERSAL/SQUEEZE_RELEASE/HTF_TREND_FOLLOW/etc. uniformly, plus
  dedicated gates at `RE_ENTRY` and the pyramid rescue family (PYR+RETEST_RESCUE/PYR+RESCUE/PYR+ADV).
  PYR+TRN is a documented exception (only adds to an already-favorable move).
- Exit side: `XAU_ReversalConfirmed()` (the existing v6.5.0 canonical Exit Arbiter) now also treats a
  STRONG-tier opposite flip as confirmed structure invalidation — reuses the entry-side read instead
  of adding a sixth competing exit system.
- Anti-repeat-loss (`XAU_AntiRepeatLossActive`) is now graduated (0.25xATR recovery from the 1st
  same-direction loss, 0.5xATR from `InpAntiRepeatLossStreak`) instead of a single on/off switch —
  never a session-length ban or fixed-time cooldown, always evidence-gated.

### Explicitly NOT changed (per owner instruction — no fear-based defaults)
- `InpAIMode` stays `AI_FILTER_ONLY` default; `InpJune18RestoreMode` stays `false` default.
- `InpNoLimitTradingMode`/`InpDisableAllDailyLocks`/`InpNoDailyLimitMode` still default `true`.
- No new session-length direction bans, no fixed-time cooldowns.
- Risk reconciliation only touches trades that would truly exceed `InpMaxRiskPctEquity` — normal
  trades within cap are untouched; lot-sizing philosophy (grade/AI/enforcement-floor multipliers) is
  unchanged.

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.16.0.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (canonical source; download endpoint reads version dynamically)
- [x] Frontend version strings (Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx, CloudLanding.jsx, CloudDashboard.jsx)
- [ ] GitHub main branch pushed

### Testing
- [x] Full recompile — 0 errors, 0 warnings
- [x] Existing test suite: 243/267 passing; 24 pre-existing failures confirmed via `git stash` to
      predate this session's changes (each is a release-time "source == old versioned snapshot" sync
      test that goes stale the moment any newer version ships — a pre-existing test-suite design
      artifact, not a regression)
- [x] New regression suite `tests/test_xau_v6160_direction_engine_v2_and_risk_reconcile_static.py` —
      19/19 passing
- [ ] MT5 journal: `ADAPTIVE-DIRECTION | ... [STRONG/MEDIUM/WEAK/NONE tier]` line every closed M5 bar
- [ ] MT5 journal: `RISK-RECONCILE | ... RECONCILIATION_ACTION=NONE_WITHIN_CAP` on normal trades (should
      be the overwhelming majority — REDUCED/BLOCKED should be rare)
- [ ] 24h+ demo validation before live capital

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — validate on demo that normal trades are NOT being reduced (only genuine
  cap-breaching ones), and that direction flips react promptly without overblocking, before live capital

---

## v6.15.0 — 2026-07-07 — June 17-18 Reconstruction: Strategy-Led Architecture

### EA Compile
- [x] EA internal version: `#property version "6.150"`
- [x] EA header comment: v6.15.0
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.15.0.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6150_reconstruction.log`)

### Root cause (see full forensic audit; MT5 trade reports 108492408 + 108458093, 79-commit git archaeology, live journal 20260703.log)
Real trade data: TREND_PULLBACK averaged +$81 to +$137/trade on 2026-06-17/18, then
-$1 to -$21/trade afterward — the identical strategy tag, inverted. Root cause:
`XAU_StrongContextForSoftBypass()` (added v6.4.21, 528c080) unconditionally downgraded
any hard structural block to a warning for A/A+ grade with no freshness/session-memory
check, at 9 call sites (v6.13.0's same-day anti-repeat-loss guard only fenced 3). AI
Director (v6.3.0, 401f225) gave AI real veto/lot authority firing on every grade. Three
commits over 48h (06-29→07-01) disabled 9 loss-based lot-reduction mechanisms and every
daily circuit breaker. Five commits (06-19→07-01) added "let it breathe" loss-cutting
requirements with no symmetric requirement on win-banking (avg hold 25.8min→40.4min,
losses growing to -$245/-$328/-$721 while wins stayed ~$41). HTF_TREND_FOLLOW (added
06-26, 93b9492) fired on H1/H4 consensus alone with no M5 trigger — single largest loss
contributor in the dataset (net -$1,622 on one account). Confirmed live in
`MQL5/Logs/20260703.log`: `TRADE-MODE WARNING | gate=SMART_GUARD_FAST_CONFIRM downgraded
hard block to warning | grade=A+` firing repeatedly during the July 3 incident window.

### What shipped
1. `InpAIMode` (AI_OFF/AI_ADVISOR_ONLY/AI_FILTER_ONLY/AI_DIRECTOR), default `AI_FILTER_ONLY`
   — AI_DIRECTOR (legacy full authority) is now explicit opt-in, not the default.
2. `XAU_ModeAllowsSoftBlockWarning()` now returns false for every mode except explicit
   `AI_DIRECTOR` — this is the single choke point all 9 grade-based soft-bypass call
   sites route through, so one function fix closes the loophole everywhere at once.
3. **Adaptive Direction Engine** (`XAU_ComputeActiveDirection`, new): separates HTF Bias
   (context only) from Active Direction (DIRECTION_BUY_ONLY/SELL_ONLY/BOTH_ALLOWED/
   NO_TRADE/TRANSITION_WAIT, computed fresh every closed M5 bar from a real swing
   break + H1 BOS). HTF_TREND_FOLLOW and PYR+RETEST_RESCUE now require Active
   Direction to permit their direction before firing — HTF consensus alone can no
   longer earn an entry against live M5 structure.
4. Exit-side: `XAU_ProtectPeakProfitFloor` no longer takes zero action when a position
   round-trips from peak profit to profit≤0 under thesis-hold — it now re-arms at
   breakeven first (never a downgrade from an already-better SL).
5. `GetPerformanceMultiplier()` rewritten: one bounded, auditable loss-streak lot tier
   (0.85x/0.70x/0.50x at 2/3/4+ same-direction losses) active under
   `InpJune18RestoreMode`, replacing the old 9-mechanism uncontrolled stack — not a
   revival of the old dead code.
6. `InpJune18RestoreMode` (default false): forces AI_ADVISOR_ONLY, keeps no-limit daily
   locks off (`XAU_NoLimitTradingModeActive` now checks this first), and activates the
   loss-streak lot tier — an explicit single-flag opt-in rather than flipping the three
   no-limit defaults directly (those gate ~30 independent code paths; flipping them as
   a side effect of an unrelated change is exactly the kind of thing that causes
   hard-to-trace regressions later).
7. Multi-instance fixes: `_ai_cost_state_hash()` (backend) now buckets account-risk
   state (daily P/L, basket float, loss streak, open positions) so a cached AI verdict
   reasoned about one account's risk posture can't be silently replayed onto another;
   AI daily-call budget/throttle is now per-account (`_ai_cost_stats_by_account`,
   backend) instead of one global pool that starved instances of each other's AI
   opinions; EA sends `account_id` (`ACCOUNT_LOGIN`) on both AI endpoints; loss-streak/
   cooldown state (`g_sameDirLossStreak` etc.) now persists via
   `GlobalVariableSet/Get` and reconstructs at `OnInit()` instead of resetting to zero
   on every EA restart.

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.15.0.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (canonical source; download endpoint reads version from this file's header dynamically — no separate backend version bump needed)
- [x] `backend/server.py` — cache-key + per-account budget fix (no schema/version field to bump)
- [ ] GitHub main branch pushed

### Testing Before Live
- [x] Full recompile — 0 errors, 0 warnings (`test_reports/metaeditor_v6150_reconstruction.log`)
- [ ] MT5 journal: `ADAPTIVE-DIRECTION | HTF Bias: ... | Active Direction: ...` line appears every closed M5 bar
- [ ] MT5 journal: `HTF_TREND_FOLLOW: withheld — Active Direction=...` appears when HTF consensus disagrees with fresh M5 structure
- [ ] MT5 journal: no `TRADE-MODE WARNING | ... downgraded hard block to warning` lines under default `AI_FILTER_ONLY` (only ever under explicit `AI_DIRECTOR`)
- [ ] MT5 journal: `THESIS_HOLD_BE_REARM` appears instead of silent zero-action when a runner round-trips to profit≤0
- [ ] `/api/download/info` returns version v6.15.0
- [ ] 24h+ demo validation before considering this safe for live capital, per this checklist's own standing rule

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — this is an architectural change to the entry/exit/AI-authority hierarchy; validate on demo (both Mac and VPS instances) through at least one full session covering the kind of trending-then-reversing move that produced the July 3 incident before considering live capital

---

## v6.7.0 — 2026-07-02 — Market Mode Architecture (Gold + Index)

*(Renamed from v6.6.0 before wide distribution — same content, no functional changes, version identifiers only.)*

### EA Compile
- [x] EA internal version: `#property version "6.700"`
- [x] EA header comment: v6.7.0
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.7.0.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v670.log`)

### Scope discipline
- [x] No index/synthetic symbol available on any configured broker (MetaQuotes-Demo, TRADE.com-Live, GoatFunded-Server, Default all gold+forex only) — no index strategy logic written, per explicit "no speculative live-money logic" instruction.
- [x] Multi-symbol simultaneous scanning NOT started (469 hardcoded `Symbol()` sites, zero symbol-keyed state = structural rewrite, not a feature) — design-only in `docs/index_mode_state_and_scanner_design.md`.
- [x] Index Mode places zero trades this release (`InpIndexModeLogOnly=true` hard safety switch, entry pipeline skipped entirely when resolved mode is INDEX_MODE).
- [x] Gold Mode behavior completely unchanged.

### What shipped
1. Market auto-detection (`InpMarketMode`, `XAU_DetectMarketMode`, `MARKET_AUTO_DETECT` log line)
2. Symbol-agnostic lot/risk engine (`XAU_CalcIndexLot`) + `INDEX_TRACE` diagnostics
3. Backend Gold/Index/Combined reporting split (`classify_market_mode`) + trading-universe settings storage (not yet EA-consumed)
4. Command Center "Trading Universe" panel + Admin "Market modes" panel + honest site copy
5. Design docs for Project C (state separation + multi-symbol scanner) — not implemented
6. Static-review fixes: phantom-peak off-by-one, `XAU_NewHostileStructureFlip` (direction-aware flip, fixes a real false-positive risk in v6.4.25/v6.5.0's own flip checks + a pre-existing TTM gap), TTM bar-boundary tightening, stale "version=5.9.1" log string fixed

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.7.0.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` + `backend/server.py` ea_version
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx, CloudLanding.jsx, CloudDashboard.jsx: v6.7.0

### Testing Before Live
- [x] Full suite `tests/` — 132/132 passed (includes 6 new static-review regression tests)
- [ ] MT5 journal: `MARKET_AUTO_DETECT` line appears on attach, correctly resolves GOLD_MODE on XAUUSD
- [ ] MT5 journal: if attached to a non-gold symbol, `INDEX_MODE_MONITORING_ONLY` appears and no trade ever opens
- [ ] `/api/download/info` returns version v6.7.0
- [ ] Command Center "Trading Universe" panel loads and saves settings

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES (Gold Mode unchanged; Index Mode cannot trade)
- Safe for live: Gold Mode — same standing as v6.5.0 (still awaiting a full live validation window). Index Mode — N/A, does not trade.

---

## v6.5.0 — 2026-07-01 — Phases 2+4+5 of the full ecosystem audit (bundled)

### EA Compile
- [x] EA internal version: `#property version "6.500"`
- [x] EA header comment: v6.5.0
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.5.0.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v650.log`)

### Scope discipline
- [x] Only Phases 2, 4, 5 from the ecosystem audit are included, bundled into one release per explicit owner request (originally planned as v6.4.26/v6.5.0/v6.5.1). Phase 3 (threshold calibration) is explicitly excluded — it requires 2+ weeks of real live-trading data that cannot be substituted.
- [x] No new fear/protective layer added; no entry made stricter; no lot size reduced; no B-grade blocking reintroduced; no trade-frequency reduction. See `test_reports/xau_v6_5_0_phases_2_4_5_2026-07-01.md` for the explicit justification per change.

### Bugs Fixed / Consolidated This Release
5. Growth Guard hard-loss tautology + June-mode SL scaling — CRITICAL
8. AI fallback confidence=50 masquerading as real judgment — HIGH
6. Remaining mechanical basket exits (SECOND_CHANCE/CYCLE_DECAY) — MEDIUM-HIGH
   Phase 4: unified `XAU_ReversalConfirmed()` — consolidates 4 duplicate structure definitions into 1, adds per-ticket BOS/HTF flip detection
9. Platform security hardening (admin password, JWT secret, cookie, CORS) + dead-code removal + README/test-suite staleness repair — see report

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.5.0.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` + `backend/server.py` ea_version
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx, CloudLanding.jsx, CloudDashboard.jsx: v6.5.0 (the latter two had been missed since v6.4.22 — now in the standard distribution list)

### Testing Before Live
- [x] New regression suite `tests/test_xau_v650_phases_2_4_5_static.py` — 8/8 passed
- [x] Full suite `tests/` — 126/126 passed (repaired from 71 failing before this release)
- [ ] MT5 journal: `GROWTH_HARD_LOSS_CAP_JUNE_ADJUST` appears for June-mode trades, cap now matches real SL risk
- [ ] MT5 journal: `NO-AI-ANSWER` appears instead of `REDUCE` when AI genuinely didn't respond
- [ ] MT5 journal: `SECOND_CHANCE_HOLD_CONTINUING BASKET` appears on a recovering-but-not-exhausted basket instead of an automatic close
- [ ] `/api/download/info` returns version v6.5.0

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — none of v6.4.22 through v6.5.0 has run live long enough to validate; per the audit's Phase 0 recommendation, run one build on demo long enough to actually observe the new diagnostic lines before going live

---

## v6.4.25 — 2026-07-01 — Phase 1 of the full ecosystem audit

### EA Compile
- [x] EA internal version: `#property version "6.425"`
- [x] EA header comment: v6.4.25
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.25.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6425.log`)

### Scope discipline
- [x] Only the four Phase-1 defects from the ecosystem audit were touched (phantom peak, absolute-vs-flip structure gate, basket soft-lock cloud-safe gap, TTM tick-vs-bar). No Phase 2-5 items included.
- [x] No new fear/protective layer added; no entry made stricter; no lot size reduced; no B-grade blocking reintroduced; no trade-frequency reduction. See `test_reports/xau_v6_4_25_phase1_exit_defects_2026-07-01.md` for the explicit justification.

### Bugs Fixed This Release (see full report for evidence)
1. Phantom basket peak reconstruction (`XAU_ReconstructOpenBasketPeakUSD`) — CRITICAL
2. Absolute vs. flip-based structure test (`XAU_BasketStructureBroken`) — CRITICAL
3. Basket soft-lock disabled by `InpCloudSafeDisablePartials` default — CRITICAL
4. TTM counting ticks as bars (`TTM_Evaluate`) — HIGH

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.4.25.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` + `backend/server.py` ea_version
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx: v6.4.25

### Testing Before Live
- [x] New regression suite `tests/test_xau_v6425_phase1_exit_defects_static.py` — 6/6 passed
- [ ] MT5 journal: no `reconstructed=Y` peak logged for a position younger than one M5 bar
- [ ] MT5 journal: a basket entered against a standing BOS is no longer force-closed on giveback alone (only on an actual BOS/HTF flip or confirmed M5 break)
- [ ] MT5 journal: `BASKET SOFT-LOCK` lines appear on a first floor/giveback breach instead of an immediate full `BASKET LOCK`/`FAST-REVERSAL`/`HARD-CAP`
- [ ] MT5 journal: `[TTM]` lines advance roughly once per 5 minutes per position, not multiple times per second
- [ ] `/api/download/info` returns version v6.4.25

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — validate on demo first per the audit's Phase 0 recommendation (run one build long enough to observe real behavior; the last three releases never ran live long enough to prove anything)

---

## v6.4.24 — 2026-07-01

### EA Compile
- [x] EA internal version: `#property version "6.424"`
- [x] EA header comment: v6.4.24
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.24.mq5`
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (`test_reports/metaeditor_v6424.log`)

### What changed (see `test_reports/xau_v6_4_24_profit_giveback_gate_audit_2026-07-01.md`)
Same bug class as v6.4.22, mirrored on the profit side: giveback%/context
breaches were fully closing STILL-PROFITABLE positions/baskets with no
reversal proof — banking only 37-59% of peak on basket closes, or cutting a
trade at $51 on a momentary WEAK_TRADE reclassification that then ran
another ~$229 (4.4x the banked amount). New `InpAllowGivebackPanicClose`
(default false) + `XAU_GateEarlyLossClose(..., isGivebackTrigger=true)`
require confirmed reversal or a repeat breach (after an already-taken
soft-lock/partial) before a full close. Basket Guard 1/Guard 2 now attempt
the existing soft-lock partial on the first breach instead of full-closing
immediately. Floor SL ratchet/AMPL trail mechanics unchanged.

### File Distribution
- [x] MT5 Experts + `/Applications`: `XAUUSD_AI_Sniper_EA_v6.4.24.mq5` + `.ex5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` + `backend/server.py` ea_version
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx, DownloadSection.jsx: v6.4.24

### Testing Before Live
- [ ] MT5 journal: `PROFIT_GIVEBACK_CLOSE_BLOCKED` appears on a giveback breach with no confirmed reversal, instead of an immediate full close
- [ ] MT5 journal: `BASKET SOFT-LOCK (FAST-REVERSAL)` / `(HARD-CAP)` appears on first basket giveback breach instead of `BASKET FAST-REVERSAL`/`HARD-CAP` full close
- [ ] MT5 journal: a confirmed structure break or repeat breach still fully closes as before
- [ ] `/api/download/info` returns version v6.4.24

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings
- Safe for demo: YES
- Safe for live: NO — validate on demo first that winners now ride further before banking, and that a real reversal still closes promptly

---

## v6.4.22 — 2026-07-01

### EA Compile
- [x] EA internal version: `#property version "6.422"`
- [x] EA header comment: v6.4.22
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.22.mq5`
- [x] `XAUAI_EA_VERSION` / `XAUAI_EA_VERSION_NUM` / `XAUAI_BUILD_HASH` updated
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (see `test_reports/metaeditor_v6422.log`)

### Root Cause (see `test_reports/xau_v6_4_22_early_loss_close_audit_2026-07-01.md`)
Live evidence: basket peak +$126.42 → `PROFIT_FLOOR_SET` → `GIVEBACK_WARNING` →
`GIVEBACK_LIMIT_TRIGGERED` → `CONTINUATION_HOLD_REJECTED` → `FORCE CLOSE
reason=THESIS_BROKEN_EXIT.BASKET` → `CLOSED: LOSS -$2.10`, followed by price
resuming the original trade direction. `XAU_BasketLifecycleManager()` and
several per-ticket "smart exit" / Growth Guard / TTM paths were closing
losing trades on giveback %, cycle count, time-after-peak, or score decay
alone — with no real structural proof — then mislabeling it `THESIS_BROKEN_EXIT`.

### Bugs Fixed This Release
1. **Basket giveback panic-close** (CRITICAL): `XAU_BasketLifecycleManager()`
   closed the whole basket red on giveback % alone, with no structure check,
   even when `InpProtectedPeakBasketCloseRed` was meant to gate red closes.
   Same gap existed in `ManageBasket()`'s fast-reversal, hard-cap, and floor
   red-close branches.
2. **Per-ticket giveback/floor panic-close** (HIGH): `XAU_SmartExit3Layer()`
   and `XAU_ProtectPeakProfitFloor()` closed red positions on floor/giveback
   breach without requiring `structureConfirmedBroken`.
3. **TTM pure score-decay close** (HIGH): `TTM_EXIT` closed on `liveScore <
   InpTTM_ExitThreshold` alone — no BOS/HTF flip required.
4. **Growth Guard early cuts** (MEDIUM): `GROWTH_HARD_LOSS` and
   `GROWTH_BAD_ENTRY_THESIS` cut losers on EMA/RSI/momentum weakness without
   requiring confirmed structure.
5. **Clean Exits giveback/stagnant/stale cuts** (MEDIUM): `CLEAN_STAGNANT`,
   `CLEAN_STALE`, part of `CLEAN_INVALID`, and `APLUS_GIVEBACK_EXIT` could
   close red positions without a structure requirement.

### Fix
Added `InpAllowEarlyLossExit` (default `false`) and a single choke-point
`XAU_GateEarlyLossClose()`. When a position/basket P/L is at or below $0, the
close is blocked unless: it's already profitable, `InpAllowEarlyLossExit` is
true, there's a true emergency (deep equity/R backstop), or structure is
confirmed broken (H1 BOS flip via `g_smc_bos_dir`, HTF consensus flip via
`g_htfConsensusDir`, or a confirmed M5 close through the swing level).
Blocked attempts print `EARLY LOSS CLOSE BLOCKED — letting trade breathe.`
Every attempt (allowed or blocked) prints a `MANUAL_CLOSE_DIAGNOSTIC` line.
Paths that already required confirmed structure or a genuine emergency
backstop (`EARLY_CONVICTION_CUT`, `STRUCTURE_FAILFAST`,
`NO_PARTIAL_SMART_LOSS`, `EXPECTANCY_MAX_LOSS`, `HARD_STOP`/`HARD_STOP_R`,
`GROWTH_HARD_LOSS_EXIT`/`GROWTH_BASKET_LOSS`, `AI_DIRECTOR_EXIT_CLOSE`) were
left unchanged as legitimate backstops.

### File Distribution
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_v6.4.22.mq5` + `.ex5`
- [x] `/Applications/XAUUSD_AI_Sniper_EA_v6.4.22.mq5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` updated (website download)
- [x] `backend/server.py` `ea_version` default bumped
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx: v6.4.22
- [x] DownloadSection.jsx: fallback version/edition/filename bumped (reads live from API otherwise)

### Testing Before Live
- [ ] MT5 journal: `EARLY LOSS CLOSE BLOCKED — letting trade breathe.` appears on a giveback/score-decay attempt with no structure break
- [ ] MT5 journal: a confirmed BOS/HTF/M5 structure break still closes a loser normally
- [ ] MT5 journal: winners (P/L > 0) still protect/close exactly as before — ungated
- [ ] `/api/download/info` returns version v6.4.22

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings (`test_reports/metaeditor_v6422.log`)
- Safe for demo: YES
- Safe for live: NO — validate on demo first that trades now ride to SL/real structure instead of panic-closing

---

## v6.4.2 — 2026-06-28

### EA Compile
- [x] EA internal version: `#property version "6.4.2"`
- [x] EA header comment: v6.4.2
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5` (filename kept for MT5 import compatibility)
- [x] Startup Print() banner updated to v6.4.2 (was stale v5.9.1)
- [x] Heartbeat JSON `ea_version` field updated to v6.4.2 (was stale v5.9.1)
- [x] Dashboard string updated to v6.4.2 (was stale v5.9.1)
- [ ] **COMPILE IN METAEDITOR — must confirm 0 errors before going live**

### Bugs Fixed This Release
1. **Startup/heartbeat version strings** (HIGH): Print(), heartbeat JSON `ea_version`, and dashboard
   string all reported v5.9.1 instead of current version. Fixed to v6.4.2.
2. **Calibration JSON key collision** (HIGH): `ExtractJsonDouble()` searched the full response JSON
   for band keys like `"0-49"`. Server returns `"sample_counts"` before `"multipliers"`. Searching
   the full JSON returns sample_count integers (e.g. 12) instead of multiplier floats (e.g. 0.88),
   silently disabling calibration. Fixed by scoping search to the `"multipliers"` sub-object first.
3. **SQUEEZE_RELEASE counter-trend zero bug** (MEDIUM): When HTF consensus vetoes a squeeze, `s`
   is set to 0 but weight multiply and bestScore compare still fired. A score of 0 could win when
   all other setups also scored 0, placing a counter-trend trade. Fixed with `if(s > 0)` guard.

### File Distribution
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5` updated (v6.4.2 content)
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_MASTER_v6.3.0_AI_DIRECTOR.mq5` version bumped to 6.4.2
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` updated (website download)
- [x] GitHub main branch pushed

### Website / Frontend
- [x] HeroSection.jsx: v6.4.2
- [x] Footer.jsx: v6.4.2
- [x] DownloadSection.jsx: reads version dynamically (no hardcoded version)

### Testing Before Live
- [ ] MetaEditor compile: 0 errors, 0 critical warnings
- [ ] MT5 journal on attach: `TRADEBRAIN LOAD:` line visible
- [ ] MT5 journal: AI Director initialized
- [ ] MT5 journal: `CONFIDENCE CALIBRATION` line (even if "insufficient data")
- [ ] MT5 journal: startup banner says v6.4.2 (not v5.9.1)
- [ ] Heartbeat to backend: `ea_version` field shows v6.4.2
- [ ] 24h demo: `XAUAI_Scorecard_*.txt` written to MT5 Files
- [ ] 24h demo: `XAUAI_GateReport_*.txt` written
- [ ] `/api/download/info` returns version v6.4.2
- [ ] Website download button shows v6.4.2

### Sign-off
- Compile verified: PENDING
- Safe for demo: YES (audit fixes only — no strategy logic changes except SQUEEZE_RELEASE zero-score guard)
- Safe for live: NO — 2 weeks demo minimum

---

## v6.4.1 — 2026-06-28

### EA Compile
- [x] EA internal version: `#property version "6.4.1"`
- [x] EA header comment: v6.4.1
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5`
- [x] File size: ~798 KB
- [x] Root cause of v6.4.0 errors: calibration JSON parser used repeated `int pos` declarations in sibling blocks and unused `n50`/`n65` variables — replaced with `ExtractJsonDouble()` calls
- [ ] **COMPILE IN METAEDITOR — must confirm 0 errors before going live**

### File Distribution
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5` updated
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_MASTER_v6.3.0_AI_DIRECTOR.mq5` updated (same content)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` updated (website download)
- [x] GitHub main branch pushed

### Website / Frontend
- [x] HeroSection.jsx: v6.4.1
- [x] Footer.jsx: v6.4.1
- [x] DownloadSection.jsx: reads version dynamically (no hardcoded version)

### Testing Before Live
- [ ] MetaEditor compile: 0 errors, 0 critical warnings
- [ ] MT5 journal on attach: `TRADEBRAIN LOAD:` line visible
- [ ] MT5 journal: AI Director initialized
- [ ] MT5 journal: `CONFIDENCE CALIBRATION` line (even if "insufficient data")
- [ ] 24h demo: `XAUAI_Scorecard_*.txt` written to MT5 Files
- [ ] 24h demo: `XAUAI_GateReport_*.txt` written
- [ ] `/api/download/info` returns version v6.4.1
- [ ] Website download button shows v6.4.1

### Sign-off
- Compile verified: PENDING
- Safe for demo: YES (no logic changes, parser fix only)
- Safe for live: NO — 2 weeks demo minimum

---

## Release Process (all future versions)

1. Edit EA, increment version string and header comment
2. Write to canonical filename: `XAUUSD_AI_Sniper_EA_vX.X.X.mq5`
3. **Compile in MetaEditor — 0 errors required before anything else**
4. Copy to: `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` and MT5 Experts folder
5. Update HeroSection.jsx and Footer.jsx version strings
6. Update RELEASE_CHECKLIST.md
7. git commit + push
8. Verify `/api/download/info` returns new version after backend redeploy

**Rule: never push a version where step 3 has not been confirmed.**
