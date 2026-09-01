# XAU AI Sniper — Pre-Implementation Remediation Map

**Generated:** 2026-07-09. Covers Phase 0 (evidence-gap closure) results and the Phase 1 (telemetry) + Phase 2 (recovery-guard wiring) implementation targets only, per explicit scope instruction. Basket Lock, thesis ledger, lot/risk invariants, and regime/direction disagreement (Fix Groups 3/5/6) are deliberately NOT mapped here — those come after Phase 1/2 are reviewed.

**No code has been changed yet.** This is the map to review before I do.

---

## Phase 0 results (evidence-gap closure)

1. **VPS terminal journal logs pulled and searched** (`audits/raw/vps_data/journal/20260708_utf8.log`, 94,042 lines). **Major discovery: the VPS auto-updated through 8 different EA versions within 07-08 alone** (v6.17.6 → 6.17.7 → 6.17.12 → 6.17.13 → 6.17.14 → 6.17.17 → 6.17.20 → 6.17.25). The actual code that produced the loss-cluster trades was **v6.17.20**, not v6.20.2 — meaning every line number I cite below from v6.20.2 describes the code as it exists *now* (which is what matters for fixing it going forward), not necessarily the exact code that ran during the incident. Where this matters for a specific finding, it's called out.
2. **20260709.log on the VPS is 0 bytes.** The terminal's native `Print()`-based journal appears to have stopped writing that day while the EA's own independent CSV telemetry kept working — an operational finding distinct from any EA logic bug, but relevant context for Phase 1's reconciliation work.
3. **`[LOT_TRACE] A+/A FULL SIZE ENFORCED` fired 3 times on 07-08 — confirmed LIVE-DATA, not just code-level.** One firing (19:05:45.588 broker time) is an exact-to-the-second match (accounting for the documented +2:00 broker/wall-clock offset) with Trade 1 opening (2938423303, the -$836.91 loss): a `conscious=0.65` reduction was overridden back to full size (0.562→0.850). **Root Cause 4 is now LIVE-DATA CONFIRMED for at least this one trade.**
4. **`ANTI_REPEAT_LOSS_TRACK`/`ANTI_REPEAT_LOSS_GUARD` confirmed working correctly on the fresh-entry path** — it tracked the loss streak (1→2→3) accurately and blocked a later fresh candidate once streak reached 3 ("hard block stands despite A grade"). **Important nuance found: Trade 3's recovery execution happened while the streak was still only 1** (Trade 2 hadn't even closed yet) — so even with Phase 2's fix applied, this specific historical loss likely wouldn't have been prevented, since the guard's own effective threshold only tightens meaningfully at streak ≥ `InpAntiRepeatLossStreak`. This doesn't diminish the value of the fix (it's still a real gap), but it should not be oversold as "this would have stopped that $632.73 loss."
5. **The ~6.5:1 planned R:R is fully traced, exact formula, CODE CONFIRMED:** `slDist = atr * InpSLMultiplier` (2.5); `tp = price ± slDist * tpM` where `tpM = EffTPMultiplier() * AccountSizeTPMultiplier()`, `EffTPMultiplier()` returns `InpStructureTPMultiplier` (6.5, since `InpStructureRunnerMode=true` by default) vs `InpTPMultiplier` (4.0), whichever is larger; `AccountSizeTPMultiplier()` returns exactly 1.00 for this account's $6,177 equity tier. **This is a deliberate, coded 6.5R runner target — not emergent, not a coincidence.**
6. **Major incidental discovery while tracing #5:** found `XAU_MinArmUSDForOwnR()` (line 10580) — an existing, already-built R-normalization mechanism from v6.17.20, whose own comment describes **this exact VPS account's exact symptom** (lots 0.15-0.59, exits $28-53) as its origin case. It floors any dollar-based exit-arm threshold at `InpExitArmMinOwnR` (0.20R default) of the position's own risk, specifically so a bigger lot can't arm/exit earlier in R-terms than a smaller one. **It is wired into `EV_PROTECT` (lines 4934-4935) and "A+ Shield" (lines 18312, 18315) — but NOT into `XAU_BasketLifecycleManager()`'s basket-floor calculation (lines 17564-17943).** This is now the single most precise, actionable finding in the whole audit for Fix Group 3/4 (deferred to a later phase, but recorded here since it was found during Phase 0).
7. **Missing-telemetry cause identified, HIGH-CONFIDENCE (not fully proven):** the sole CLOSE-side writer, `XAU_AppendTradeBrain()` (line 24075), depends on an in-memory `TradeBrainOpen` struct array (`g_brainOpenTrades[]`) populated at OPEN time. `OnTradeTransaction()` (line 21654) is the sole trigger for CLOSE-side writes and is well-documented in MQL5 to not replay missed deal events across an EA/terminal reload. Given this account reloaded 8 times in one day, this plausibly explains both incomplete records (2938698098's "fallback: open record not found," and 2940184690's missing CLOSE).
8. **Missing-outcome trade (2940184690): no new safe resolution found.** UNKNOWN status preserved per instruction. Bounded estimate stands: -$824 to -$857 if confirmed as an SL hit.
9. **entryReason truncation cause: NOT fully isolated to one line** (searched `XAU_AppendTradeBrain`, `OpenTrade()`'s body, and the `TradeBrainOpen` struct population — no length cap found in any of them; the cap must be upstream, in whatever function concatenates the full narrative string before it's ever passed in). **Given the risk of missing another such cap somewhere else in a 29,833-line file, the recommended fix is not "find and widen the one buffer" — it's to stop relying on one growable narrative string for anything the audit needs to parse, per your own Phase 1 spec (structured fields instead of narrative text).** See Item 1 below.

---

## Phase 1 items (telemetry only — no trading behavior change)

### Item 1 — Stop relying on truncatable narrative text for quality metrics

| Field | Detail |
|---|---|
| Exact function | `XAU_RecordBrainOpen` (the function containing line 24300-24327, exact name not yet confirmed — will confirm on read before editing) and `XAU_AppendTradeBrain()` (line 24075); struct `TradeBrainOpen` (line 3429) |
| Exact current behavior | `entryReason` is stored and written as one free-text string. Whatever builds that string upstream truncates it before some trades' quality metrics (timingQ/exhaustion/lateProb) are appended — cause not isolated to one line (see Phase 0 #9) |
| Exact call path | signal-generation code → (unidentified concatenation site, possibly capped) → `entryReason` string → `OpenTrade(..., reason, ...)` → `XAU_RecordBrainOpen(...)` → `g_brainOpenTrades[idx].entryReason` → `XAU_AppendTradeBrain("OPEN", ...)` → CSV |
| Exact conflicting subsystem | None — this is a data-completeness gap, not a logic conflict |
| Confidence | **LIVE-DATA CONFIRMED** that truncation happens (2 of 3 known losses in the real sample are unclassifiable because of it); **HYPOTHESIS** on the exact single cause |
| Smallest safe correction | Add new dedicated numeric/string CSV columns (`timingQ`, `exhaustion`, `lateProb`, `candlesSinceSignal`, `setupQuality`, `entryTimingQuality`, `extensionRisk`, `effectiveRRQuality`, `blockClass`, `timingLabel`, `isRecovery`, `originalBlocker`) populated directly from the numeric variables that already exist in memory when `entryReason` is built — not from re-parsing the narrative string. Keep `entryReason` as-is for human readability; it stops being the only source of truth for anything a future audit needs. **Zero risk to trading behavior** — additive columns only. |
| Regression risk | None to trading logic. Only risk is breaking any downstream tool that assumes a fixed column count when reading this CSV (the local Python `xau_attribution_report.py` uses `csv.DictReader`, which is column-order-independent, so it's safe) |
| Test | New static test: open a real or synthetic OPEN event and assert the new columns are present and non-empty whenever a CALIBRATED_ENTRY_QUALITY-style block exists, independent of `entryReason`'s length |

### Item 2 — In-hold checkpoint logging (1/2/3/5/10/20/30/60 min)

| Field | Detail |
|---|---|
| Exact function | New function, e.g. `XAU_LogInHoldCheckpoint()`, called from the existing per-tick/per-position management loop (need to confirm exact loop location before editing — likely near `ManageCleanExitsForPosition()`, line 18093, since that already runs per-position per-tick) |
| Exact current behavior | No in-hold logging exists at all. Only OPEN, CLOSE, and POST_CLOSE (after close) snapshots exist |
| Exact call path | Would hook into the existing per-position management tick loop, checking elapsed time since `entryTime` against a checkpoint schedule, writing one new event type ("CHECKPOINT") to `XAU_AppendTradeBrain` per elapsed threshold crossed |
| Exact conflicting subsystem | None identified — this is additive telemetry |
| Confidence | N/A (new capability, not a fix to existing behavior) |
| Smallest safe correction | Track "next unfired checkpoint index" per open position (reuse the existing `g_brainOpenTrades[]` array — add fields `nextCheckpointIdx`), check once per tick inside the existing management loop, write a "CHECKPOINT" event row with floating P&L/current R/spread/structure state/regime/fast direction/active exit owner when a threshold is crossed. **No changes to any entry/exit/sizing decision.** |
| Regression risk | Low — adds file I/O on every tick for open positions; needs a cheap guard (e.g., only check once per second, not per tick, to avoid excess disk writes) to avoid performance impact during high-tick-rate news events |
| Test | Open a synthetic position, advance simulated time past 1/5/30 min thresholds, assert exactly one CHECKPOINT row is written per threshold, no duplicates |

### Item 3 — OPEN/CLOSE durability + reconciliation

| Field | Detail |
|---|---|
| Exact function | `OnTradeTransaction()` (line 21654), `XAU_RecordBrainOpen`/`XAU_AppendTradeBrain` (lines 24075/24300ish), plus a new reconciliation function to add, e.g. `XAU_ReconcileTradeBrainOnInit()` called from `OnInit()` |
| Exact current behavior | In-memory `g_brainOpenTrades[]` is the only record of an open position's reasoning; if lost (EA reload) before the matching CLOSE deal fires, the CLOSE row gets written via a "fallback: open record not found" path with no reasoning, and if `OnTradeTransaction` itself never fires for a deal that happened during a reload gap, no row is written at all |
| Exact call path | `OnInit()` (EA start/reload) → (currently nothing) → next `OnTradeTransaction` CLOSE event either falls back or never arrives |
| Exact conflicting subsystem | None — pure gap, not a conflict |
| Confidence | **HIGH-CONFIDENCE INFERENCE** (well-supported by MQL5's documented reload behavior + the 8-reloads-in-one-day fact + the two real incomplete records), not fully proven without exact reload timestamps |
| Smallest safe correction | (a) Persist `g_brainOpenTrades[]` to a small durable side-file on every OPEN and update, not just keep it in memory, so a reload can reload it too. (b) Add an `OnInit()` reconciliation pass: call `HistorySelectByPosition()`/`HistoryDealsTotal()` for the recent history window, cross-check against the persisted open-trades file and the `ExecutedTradeBrain` CSV, and log (not silently fix) any OPEN with no CLOSE or CLOSE with no OPEN found, with an explicit `RECONCILIATION_GAP_DETECTED` line so future audits don't have to guess. **Does not change trading behavior — read-only reconciliation and logging.** |
| Regression risk | Low. Main risk is `OnInit()` reconciliation adding startup latency if history is large — bound the lookback window (e.g., last 48h) to keep it fast |
| Test | Simulate an EA restart mid-position (clear in-memory state, keep the persisted side-file), confirm the reconciliation pass detects and logs the gap rather than silently producing another "fallback: open record not found" |

### Item 4 — Version/build-hash/config-fingerprint on every event

| Field | Detail |
|---|---|
| Exact function | `XAU_AppendTradeBrain()` (line 24075), header write block (~line 24080-24085 based on the FileWrite header seen earlier) |
| Exact current behavior | No version/build/config field exists on any OPEN/CLOSE/POST_CLOSE row — confirmed by reading the CSV header directly (`event,time,posId,symbol,dir,setup,grade,signature,regime,session,hour,entryPrice,exitPrice,lots,sl,tp,profit,worstFloating,secondsNegative,outcome,exitReason,entryReason,setupScore,combined,atr,aiConfidence`) |
| Exact call path | `XAU_AppendTradeBrain()`'s header-write and per-row-write blocks |
| Exact conflicting subsystem | None |
| Confidence | **LIVE-DATA CONFIRMED** (the version-churn discovery in Phase 0 #1 is proof this field is needed — I could only reconstruct EA versions per-trade by cross-referencing the separately-pulled journal log, which won't be available for future incidents given #2's finding that the journal can silently stop logging) |
| Smallest safe correction | Add `eaVersion`, `buildHash`, `configFingerprint` (already exists elsewhere as `XAUAI_BUILD_HASH` per the earlier full-project-audit doc — reuse it, don't invent a new one), `magicNumber` as new trailing columns on every row |
| Regression risk | None — additive columns |
| Test | Assert every OPEN/CLOSE/CHECKPOINT row includes a non-empty version string matching the currently-running EA's own version constant |

---

## Phase 2 item (small behavior change, high confidence)

### Item 5 — Wire `XAU_AntiRepeatLossActive()` into `XAU_CheckPendingOpportunityRecovery()`

| Field | Detail |
|---|---|
| Exact function | `XAU_CheckPendingOpportunityRecovery()` (line 24833) |
| Exact current behavior | Checks expiry, max-open-trades, spread, fresh-data, 1×ATR anti-chase, M15/M30 EMA thesis-flip, M5 `XAU_ClassifySetup` LATE_CHASE, re-grade with fresh `DetectRegime()`/session quality, personality fit, and `AdaptiveXAUConfirm` (SMART-GUARD) — in that order. **Never calls `XAU_AntiRepeatLossActive(dir)`.** |
| Exact call path | `XAU_CheckPendingOpportunityRecovery()` (called from the main loop on every new M5 bar, line 12992) → currently ends at `AdaptiveXAUConfirm` → `OpenTrade()` |
| Exact conflicting subsystem | None — `XAU_AntiRepeatLossActive()` (line 26887) already exists, is independently tested elsewhere (6 other call sites: lines 13224, 13236, 13607, 13700, 14150, 14572, 23237), and has its own legitimate exemption logic (STRONG Active Direction overrides it) that this wiring would inherit for free, not fight against |
| Confidence | **CODE CONFIRMED** the gap exists; **LIVE-DATA CONFIRMED** the guard itself works correctly elsewhere (Phase 0 #4); **HIGH-CONFIDENCE INFERENCE, not proof**, that wiring it into recovery would have changed any specific historical trade's outcome (Phase 0 #4's nuance: Trade 3 fired at streak=1, likely below the guard's effective threshold anyway) |
| Smallest safe correction | Add one call, early in the function (right after the spread check, before the more expensive ATR/structure checks, for fail-fast ordering): `if(XAU_AntiRepeatLossActive(dir)) { Print("RECOVERY_REJECTED: ", sid, " reason=ANTI_REPEAT_LOSS_ACTIVE (streak=", g_sameDirLossStreak, ")"); return; }` — a 4-line addition, no new state, no new logic, reuses an existing, already-tested function exactly as its 6 other call sites do |
| Regression risk | Low. The guard already has a built-in exemption (Active Direction reaching STRONG tier independently), so it won't block a genuinely fresh, independently-confirmed reversal — only blocks recovering a same-direction idea while this account's own recent loss in that exact direction hasn't been price-recovered yet. Main risk is reduced trade frequency in exactly the scenario it's designed to reduce it in (by design) |
| Test | (1) Simulate a pending recovery opportunity with `g_sameDirLossStreak >= 1` and `g_lastLossDir` matching the candidate direction, with price not yet recovered — assert `RECOVERY_REJECTED reason=ANTI_REPEAT_LOSS_ACTIVE`. (2) Same setup but with Active Direction at STRONG tier in that direction — assert the recovery proceeds (exemption honored). (3) Same setup but with price already recovered past the ATR threshold — assert the recovery proceeds. |

---

## What I am explicitly NOT doing in this phase

- Not touching `XAU_BasketLifecycleManager()` or the basket peak/floor logic (Fix Group 3) — despite the very strong `XAU_MinArmUSDForOwnR()` finding above, that's a behavioral exit-side change and belongs in a later, separately-reviewed commit per your own sequencing.
- Not touching the 6.5R target formula, `InpSLMultiplier`, or `InpStructureTPMultiplier` — fully traced, not modified.
- Not touching lot-sizing multipliers or `XAU_NormalizeVolumeForRisk()` (Fix Group 5).
- Not touching regime/direction disagreement behavior (Fix Group 6).
- Not stacking Items 1-5 into one commit — Items 1-4 (telemetry) are Commit A; Item 5 (recovery guard) is Commit B, reviewed separately.

---

## Requesting confirmation before editing

Everything above is analysis only — no `.mq5` file has been touched. Before I start Commit A (telemetry), I want to flag one sequencing question: **Item 1's "structured fields instead of narrative text" is a CSV schema change** (new columns). It's additive and safe, but it's a real, visible change to a file format three things depend on (the attribution-report script, any future audit, and potentially a dashboard if one reads this CSV). Confirm you want me to proceed with all of Items 1-4 (Commit A) and Item 5 (Commit B) as scoped above, then I'll implement, compile, test, and report back with the diff before touching anything else.
