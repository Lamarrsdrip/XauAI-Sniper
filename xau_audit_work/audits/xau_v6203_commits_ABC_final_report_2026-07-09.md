# XAU AI Sniper v6.20.3 — Commits A/B/C Final Deliverable Report

**Generated:** 2026-07-09. Covers the full arc: Phase 0 evidence-gap closure → Pre-Implementation Remediation Map → Commit A (telemetry) → Commit B (recovery guard) → Commit C (cross-instance lock + universal entry delay, done in two passes following a live incident) → adversarial review → fixes → final compile/test.

**File:** renamed `XAUUSD_AI_Sniper_EA_v6.20.2.mq5` → `XAUUSD_AI_Sniper_EA_v6.20.3.mq5` (filename-must-match-version rule). Copied to the project repo, the local MT5 Experts folder, and `/Applications`. **NOT synced to `backend/ea_code/` or `DownloadSection.jsx`, and not committed to git** — release/download-facing steps are deliberately withheld per the explicit "do not release until reviewed" instruction.

---

## 1. Exact evidence gaps closed

- **Root cause of `entryReason` truncation, isolated to one line**: `XAU_CsvSafe()` hard-caps every CSV string field at 700 characters (a shared helper used by many fields) — upgraded from HYPOTHESIS to CODE CONFIRMED. Not changed directly (risk of affecting other fields); worked around via new dedicated structured columns instead.
- **Whether Root Cause 4 (lot-floor gap) actually fired live**: confirmed via the VPS's 07-08 terminal journal — `[LOT_TRACE] A+/A FULL SIZE ENFORCED` fired 3 times that day, one of them at the exact second the sample's worst loss trade opened.
- **Whether the anti-repeat-loss guard works**: confirmed live — it tracked a 3-loss streak correctly and blocked a subsequent candidate.
- **The exact cause of the 2026-07-09 15:45 live incident** (two BUY 0.22 XAUUSD entries ~2s apart): a designed-but-too-permissive delay bypass (`XAU_ClassifySetup.immediateConfirm`, previously available to any grade) combined with a structural discovery — **this terminal runs the EA attached to two separate charts (M5 and H1) on the same account**, each an independent, unsynchronized process.
- **Whether that dual-chart-attachment theory is correct**: confirmed with high confidence — two independent FIRST-SIGNAL detections 106ms apart at different prices, which is only possible from two separate instances (a chart's period is fixed for that instance's life).
- **The exact origin of the ~6.5:1 planned R:R**: fully traced to `InpStructureTPMultiplier=6.5` × `AccountSizeTPMultiplier()=1.00` (this account's equity tier), applied as `tp = price ± slDist * tpM` — a deliberate design constant, not emergent or coincidental. Not changed.
- **Missing-outcome trade (posId 2940184690)**: still UNKNOWN, preserved as such; bounded estimate (-$824 to -$857) stands from the prior pass. No new safe resolution path found.

## 2. Root causes confirmed / downgraded / newly found

| Root cause | Status |
|---|---|
| Regime/direction-engine timescale mismatch (Phase 1 report) | Unchanged status: code-confirmed, not independently re-proven against the VPS trade sample |
| BASKET LOCK basket-wide exit + peak-tracker discrepancy | Unchanged status: confirmed mechanism, unresolved 3.7x discrepancy — **not touched this round**, per explicit scope |
| Recovery path missing recent-loss check | **Fixed** (Commit B) — now consults the existing `XAU_AntiRepeatLossActive()` guard |
| Lot-floor selectively un-protects brain/conscious/sti/committee reductions | Unchanged status — **not touched this round**, per explicit scope |
| Telemetry incompleteness (truncation, missing OPEN/CLOSE, no version stamp, no in-hold checkpoints) | **Fixed** (Commit A) |
| Delay bypass reachable by any grade, not just A+ | **Found live, fixed** (Commit C) — then **fully removed for every grade** per explicit follow-up instruction |
| Two chart instances of the same EA operating unsynchronized | **Newly found, partially mitigated** (Commit C's cross-instance lock covers the entry-execution moment only — it does not make every other mechanism in the file cross-instance-aware; see §10) |

## 3. Files and functions changed

**One file changed:** `XAUUSD_AI_Sniper_EA_v6.20.3.mq5` (604 insertions, 43 deletions vs. the committed v6.20.2 baseline).

**New functions:** `XAU_ReconcileTradeBrainOnInit`, `XAU_TradeBrainHasCloseRow`, `XAU_CheckInHoldCheckpoint`, `XAU_EntryLockGVKey`, `XAU_CrossInstanceEntryLockActive`, `XAU_TryClaimEntryLock`.

**Modified functions:** `XAU_AppendTradeBrain` (new columns), `XAU_BrainRecordOpen` (new field population + freshness gating), `XAUEntryTimingGuard` (side-effect telemetry capture only, no logic change), `XAU_CheckPendingOpportunityRecovery` (anti-repeat-loss check added), `OpenTrade` (cross-instance lock check + atomic claim), `XAU_TimingEngineConfirmsEntry` (bypass removed entirely), `OnInit` (reconciliation call added), `OnTradeTransaction`'s fallback branch (new fields initialized).

**New struct fields:** `TradeBrainOpen` gained 12 fields (11 quality fields + `checkpointNextIdx`).

**New globals:** 11 `g_lastEntryQ_*` capture variables (8 data + 3 freshness markers), `g_checkpointMinutes[]`.

**New inputs:** `InpCrossInstanceEntryLockEnable`, `InpCrossInstanceEntryLockSec`, `InpImmediateConfirmRequiresAPlus` (now inert, kept as documented placeholder), `InpAllowImmediateAPlusMomentum` (pre-existing, now also inert).

## 4. Behavior before vs. after

| Behavior | Before | After |
|---|---|---|
| `entryReason` truncation | Silent, ~700 chars, blinded audits on 2 of 3 sample losses | Structured columns bypass this entirely |
| In-hold visibility | None — only OPEN/CLOSE/POST_CLOSE snapshots | CHECKPOINT rows at 1/2/3/5/10/20/30/60 min |
| EA reload during an open position | CLOSE recorded with blank "fallback" reasoning, or missed entirely | Reconciled from broker history at next `OnInit()`, explicitly labeled as reconstructed |
| Recovery of a blocked signal | No check against this account's own recent same-direction loss | Rejected with `ANTI_REPEAT_LOSS_ACTIVE` if streak active and price hasn't recovered (unless Active Direction independently reached STRONG) |
| Two chart instances, same signal | Both could execute independently, ~2s apart, doubling exposure | Second instance's claim fails (atomic compare-and-swap on a shared GlobalVariable); it is blocked and logged |
| Grade A+ with "clean evidence" | Executed with **zero** wait | **Always** waits the full 60-120s (target 90s) delay — no exemption for any grade |
| Grade A/B with "clean evidence" | Executed with zero wait (same bypass, contrary to the comment claiming otherwise) | Same as above |

## 5. Tests added

`tests/test_xau_v6203_telemetry_entry_lock_and_delay_static.py` — **18 tests**, all passing, covering: telemetry columns/struct fields/reconciliation/checkpoints (Commit A), recovery guard wiring with ordering proof (Commit B), cross-instance lock wiring + atomic claim + ordering (Commit C), complete removal of the grade-based delay bypass (Commit C follow-up), and the 5 adversarial-review fixes (fallback field init, freshness-gated quality capture, checkpoint catch-up prevention).

## 6. Compile result

**0 errors, 0 warnings** (MetaEditor64 via Wine, final source, confirmed after fixing two `description too long` warnings introduced by the version-bump comment).

## 7. Test result

**116 failed / 568 passed.** Verified by diff against the original clean (pre-session) baseline: **115 of those failures are pre-existing** (unrelated historical version-identity/backend-sync tests), and the **1 new failure is fully expected** — the old `test_v6202_identity_and_download_source_sync` test now fails with `FileNotFoundError` because that filename no longer exists after the version bump to v6.20.3, which is the correct, intended consequence of following the filename-must-match-version rule while deliberately not yet releasing. Zero unexplained regressions.

## 8. Remaining risks

- **The cross-instance lock covers only the entry-execution moment.** It does not make `g_pendingEntryConfirm`, `g_basketPeakUSD`, or any other per-instance state cross-instance-aware. Two instances can still independently manage, trail, and exit what the broker sees as one account's positions without coordinating — this incident's specific failure mode (duplicate entry) is closed; the broader "two uncoordinated instances" architecture question is not.
- **Whether running two chart instances (M5 + H1) is intentional** was not resolved — this report only proves it's happening and closes the one consequence (duplicate entries) that caused the live incident. If unintentional, removing the redundant chart attachment is likely a better fix than any amount of cross-instance coordination logic.
- **10-second lock window is a mitigation sized to the observed ~2s skew, not a mathematical guarantee** — a much larger cross-instance timing divergence (unlikely but not impossible) would not be caught.
- **Two known, accepted minor telemetry issues** (documented, not fixed): CHECKPOINT rows reuse the `secondsNegative` column for a different meaning than its name implies; both chart instances will each independently write their own CHECKPOINT/reconciliation rows for shared broker-level positions, doubling those specific telemetry rows (not a trading-decision risk, an analytics-dedup one).
- **This has not run live even once.** Compile-clean and test-passing is not the same as proven correct under real tick-by-tick conditions.

## 9. Classification of every change

- **Telemetry-only (zero trading-behavior effect):** all of Commit A (new CSV columns, checkpoint logging, OnInit reconciliation, version stamping).
- **Alters recovery behavior:** Commit B (anti-repeat-loss check added to `XAU_CheckPendingOpportunityRecovery`).
- **Alters entry behavior:** Commit C (cross-instance lock in `OpenTrade`; full removal of the grade-based delay bypass in `XAU_TimingEngineConfirmsEntry`).
- **Alters exit behavior:** none. Basket Lock, Clean Exit, AMPL, Chandelier, Profit Guardian — untouched.
- **Alters lot sizing:** none.
- **Alters regime/direction logic:** none.

## 10. Exact version recommendation

**v6.20.3.** File renamed, `#property version`, `XAUAI_EA_VERSION`, `XAUAI_EA_VERSION_NUM`, `XAUAI_BUILD_HASH` all updated to match. `backend/ea_code/` and `DownloadSection.jsx` deliberately **not** touched — those are the release-facing steps withheld per instruction.

## 11. Rollback

Nothing is committed yet — the entire diff is in the working tree against `d9c614f` (the last real commit). Rollback is `git checkout d9c614f -- ` (or simply discard the working-tree changes) at any point before a commit is made. If a commit is made first, each behavioral phase should be its own commit (Commit A, then B, then C) so any one can be reverted independently — recommended before this goes further.

## 12. Deployment recommendation

**Forward demo only, not small live, not yet.** Specifically:
1. Compile-clean and unit-test-clean, but zero live ticks under this exact code.
2. The dual-chart-attachment question (§8) is unresolved at the architecture level — worth deciding deliberately (one chart vs. two, coordinated) before trusting the lock as a long-term fix rather than a patch over one incident.
3. Recommend: attach to a demo account (or the existing Mac demo instance) for at least a few real trade cycles, watch for `ENTRY_LOCK_CLAIM_FAILED`/`ENTRY_LOCK_CLAIM_RACE`/`M5_ENTRY_DELAY_CONFIRMED` log lines to confirm the new mechanisms fire as designed under real conditions, then commit the three phases separately, then decide on backend sync/release.
