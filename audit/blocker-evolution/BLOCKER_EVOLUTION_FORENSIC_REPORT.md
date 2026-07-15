# XauAI Sniper — Blocker Evolution Forensic Report

**Audit branch:** `audit/blocker-evolution-forensic-20260715`
**Repo state examined:** worktree HEAD `e13d669857c7589e06af17460d7004794d11279e` (`origin/main`, 2026-07-15, "release: ship v6.23.3 trend continuation health reasoning")
**OLD comparison version:** `v5.8.50 "Evidence Refactor"`, commit `de2984c`, 2026-06-11
**CURRENT production version:** `v6.23.3`, commit `e13d669`, 2026-07-15

This report is one of ten deliverables. See `VERSION_DISCOVERY_REPORT.md` for how the two comparison versions were chosen, `ENTRY_DECISION_PATH_OLD.md`/`ENTRY_DECISION_PATH_CURRENT.md` for the full line-by-line call traces, `BLOCKER_MASTER_INVENTORY.csv` for the 48-row blocker table, `BLOCKER_TIMELINE.csv` for the 62-event chronology, `OLD_VS_CURRENT_MATRIX.md` for the quantitative comparison, and `DUPLICATED_AND_CONTRADICTORY_BLOCKERS.md` for the eight verified duplication/contradiction groups.

---

## Executive conclusion

The bot did not become a "hardcore blocker" through one bad decision. It became one through **148 days of pure addition**: every gate that existed in the growth era (May–June 2026) is still present, verbatim, in current production — **zero of the 19 original blocker tags found in v5.8.50 were ever removed** — and **42 entirely new named blocker/gate/lock/veto mechanisms were added on top of them**, overwhelmingly between 2026-06-28 and 2026-07-15 (18 days, ~150 commits). The primary entry-decision pipeline grew from **24 verified sequential veto points** to **38+ stages (45+ line-level exit points)**, and three more hard gates were added *inside* `OpenTrade()` itself, so even a signal that clears the entire outer gauntlet can still die at the moment of order-send.

This was not one architectural rewrite. It was a **reflexive pattern, repeated at least six times**, each following the same shape: (1) a real, specific, evidenced incident occurs, (2) a new named gate is built to prevent that exact incident, (3) the new gate is added *alongside* the existing gates that were supposed to already cover that risk category, rather than replacing or merging with them. The team's own commit messages document this pattern happening in real time — including, remarkably, a same-day self-audit (`v6.0.3 "Forensic Growth Audit"`, 2026-06-24) that set out to diagnose exactly this problem one day after the first defensive gates were added, and a mid-July commit (`v6.16.1`, "self-audit fix: split structural vs AI-opinion bypass gates") that explicitly names duplicate-authority as a known issue.

The result, independently verified in this audit via a real dated statistic already in the repo: in a 3-day window one week before HEAD, **106 A/A+ signals were blocked against only 19 executed trades** — a ~5.6:1 ratio on the highest-grade setups (`5cb2bb8`, 2026-07-08, citing `audits/xau_expectancy_inversion_audit_2026-07-06_to_2026-07-08.md`). That commit then made the blocking **stricter still**, converting a previously-inconsistent internal `HARD_BLOCK` self-label into an unconditional veto, based on 3 losing trades out of 19. It was a defensible fix for a real bug — but it is also a textbook example of the exact pattern the user is describing.

---

## Historical timeline (condensed — full 62-event chronology in `BLOCKER_TIMELINE.csv`)

| Period | What happened |
|---|---|
| Pre-window (2026-04-23 → 05-14) | The gating skeleton is born: `IsDirectionLocked`, `AIBlocksClose`/`AIVetoCooldownOK`, `ContextGateAllows`, `PG_BlockReason`, `EPF_BlockPyramidAdd`, SmartGuard family — **the growth-era bot was never gate-free.** |
| 2026-05-15 → 06-11 (the investigation window) | Growth era proper. `AdaptiveXAUConfirm` framework (05-18), `XAUEntryTimingGuard` born (05-19, the date the owner remembers as the start), pyramid-rescue logic (05-26), trade-brain memory (06-01, first real trade log), Prop Firm Mode (06-05), **v5.8.50 "Evidence Refactor" (06-11)** — the strongest, most mature old-era version, independently corroborated by `docs/superpowers/specs/2026-06-11-xau-v5850-evidence-refactor-design.md`: "61 closed trades: 72.1% win rate, +$192,502.77 net, profit factor 2.16." |
| 2026-06-12 → 06-16 | **No commits.** The EA traded unmodified. |
| 2026-06-17 | Owner-reported account-ending trading day (context only in this audit — no raw trade CSV survives in this repo to independently re-verify; carried from a prior in-repo audit and explicitly labeled as such throughout). |
| 2026-06-18 → 06-19 | **First defensive reaction**, one day after the reported blowup: five rapid "Profit Shield" patches (v5.8.51 → v5.8.55) in 30 hours. |
| 2026-06-23 | **`v6.0.2 "Human Intelligence Upgrade"`** — the first coordinated multi-gate hardening: 12-rule reasoning engine, per-position committee memory, news-aftermath filter, triple-TF alignment, loss-streak caution, Asian-session gate, spread-spike 10-min entry pause, all in one release, six days after the reported blowup. |
| 2026-06-24 | **`v6.0.3 "Forensic Growth Audit"`** — the team's own prior self-diagnosis of this exact problem, one day later. Its description explicitly promises "no random strategy rewrite: original aggressive growth behavior preserved while evidence improves." |
| 2026-06-28 → 07-15 | **The bulk of the transformation.** ~150 commits, `v6.3.6` → `v6.23.3`. Market Personality Engine, AI Director, growth-guard family, SMC hard-conflict block, Smart Timing Intelligence (STI) late/exhaustion blocks, Trade Recovery Intelligence, cross-instance locks, adaptive-transition authority, and a full second "entry timing" system added on top of the first (all within a single 24-hour period, 2026-07-08). |

---

## The turning points (five biggest, evidence-backed)

1. **`de2984c`, 2026-06-11, v5.8.50 "Evidence Refactor"** — not itself a hardening event, but the **last stable growth-era architecture**, the baseline every subsequent change is measured against in this audit.
2. **`530054f`, 2026-06-23, v6.0.2 "Human Intelligence Upgrade"** — the first release to add *multiple, independent, simultaneous* new hard gates (reasoning engine, committee memory, news-aftermath filter, loss-streak caution, session gate) in a single commit, six days after the reported blowup. This is the moment the architecture visibly shifts from "occasionally patch a specific mistake" to "add a coordinated defensive layer."
3. **`8101794`, 2026-06-28, v6.3.8** — introduces `g_gateBlocks_Spread/News/Trend/AI/TradeBrain/Basket/DailyLoss/Volatility/Committee/STI/EPF`, 11 named counters, plus `PrintGateReport()`/`WriteGateReportToFile()`. **The team started measuring how often the bot blocks trades because it had become frequent enough to need measuring.** This is the clearest internal, self-authored evidence that the transformation described by the user was real and was noticed at the time.
4. **`5cb2bb8`, 2026-07-08, v6.17.16 "HARD_BLOCK self-consistency fix"** — a background audit found **106 blocked A/A+ signals vs. 19 executed trades in one 3-day window**, and traced all of that window's losses to 3 trades that carried the EA's own internal `HARD_BLOCK` self-label and executed anyway. The fix made that label an unconditional veto with no override path. Representative of the entire `v6.17.x` series: **25 releases shipped in roughly 36 hours (2026-07-07 through 07-08)**, most of them adding or hardening a gate.
5. **`c34d020`, 2026-07-14, v6.23.1 "activate transition authority"** — `OLD_DIRECTION_EXHAUSTION_HARD_BLOCK`, a single hard invariant that simultaneously blocks **PRIMARY, RE_ENTRY, RECOVERY, RETRY, and PYRAMID** entry sources in the "exhausted" direction once an internal exhaustion score crosses 70%. This is the broadest-reach single blocker found in this entire audit — one condition vetoing five categories of entry at once — and it is one day old at HEAD, meaning it has had essentially no live field validation before this report was written.

---

## Architecture comparison (full detail in `OLD_VS_CURRENT_MATRIX.md`)

| | OLD (v5.8.50) | CURRENT (v6.23.3) |
|---|---|---|
| File length | 12,065 lines | 34,750 lines (+188%) |
| Unique named blocker tags | 19 | 61 (+42 new, 0 removed) |
| Sequential veto stages, primary path | 24 | 38+ stages, 45+ line-level exits |
| Distinct `OpenTrade()` call sites | 2 | 5 |
| Functions answering "is entry timing OK" | 1 | 3 (`XAUEntryTimingGuard`, `XAU_ClassifySetup`, `XAU_TimingEngineConfirmsEntry` — the latter called **twice**) |
| Gates living inside `OpenTrade()` itself | not confirmed (margin/lot-step/broker only, per code comments) | 3 confirmed (`XAU_CrossInstanceEntryLockActive`, `XAU_FinalAdaptiveDirectionDecision`, `XAU_GrowthGuardEntryBlockReason`) |

---

## Decision path — where a trade actually dies (full traces in `ENTRY_DECISION_PATH_OLD.md`/`_CURRENT.md`)

Both eras follow the same shape: **signal → score/grade → sequential gate chain → `OpenTrade()`**. The OLD era already had a substantial chain (correcting a prior in-repo audit's "roughly 3 steps" characterization, which this audit's own line-by-line read of `de2984c` disproves — the real number is 24). What changed is not the existence of gates, it's:
- **More gates layered in front of the same chain** (Personality Gate, SMC Hard Conflict, TRI Re-Entry, STI late/exhaustion x3, Adaptive Reversal x4, Adaptive-Direction Block).
- **The AI's role expanding, not shrinking, despite explicit commit-message claims otherwise** — see `DUPLICATED_AND_CONTRADICTORY_BLOCKERS.md` §4: the v6.17.11 commit message states "AI can never veto a trade again," and the shipped code at lines 16360-16362 still emits `"AI DIRECTOR BLOCK: ... Trade blocked."`
- **New gates added inside `OpenTrade()` itself**, meaning the "final call" is no longer final.

---

## Duplicated and contradictory blockers (full detail in `DUPLICATED_AND_CONTRADICTORY_BLOCKERS.md`)

Eight verified groups, headline items:
- **Entry timing, three independent authorities** (`XAUEntryTimingGuard`, `XAU_ClassifySetup`, `XAU_TimingEngineConfirmsEntry`) — introduced in three different eras, never merged, the last one is called twice in the current primary path.
- **AI Director's "advisory-only" framing contradicts its own hard-block branch** — direct source-verified contradiction between a commit message and shipped code.
- **`SOFT_BLOCK_CONVERTED`** — a named mechanism (line 31312) whose existence is itself proof that the codebase has formalized converting soft/informational signals into hard rejections, exactly the pattern the user described.
- **Three overlapping news systems** on the same tick: a hard filter, a documented advisory carve-out for that same filter, and a wholly separate adaptive-momentum news gate.
- **Four independently-evolved account-state lot-reduction systems** (Growth Guard, EPF, Profit Guardian, Basket locks) applied sequentially and multiplicatively to the same trade.

---

## Highest false-block-risk modules (ranked)

1. **STI_LATE_BLOCK / STI_EXHAUST_BLOCK** (B027/B028) — same class of gate as `failedImpulseBlock`, which v6.23.3 itself proved was hard-blocking 33% of the cleanest trend continuations in one audited session. These siblings were **not** covered by that fix.
2. **`REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK`** (B043) — one day old at HEAD, explicitly holds a trade even when direction is confirmed correct.
3. **`OLD_DIRECTION_EXHAUSTION_HARD_BLOCK`** (B042) — broadest blast radius in the inventory (5 entry categories at once), least field-tested.
4. **PERSONALITY GATE** (B029) — prior in-repo counterfactual audit found a 47% "would have won if flipped" rate (n=17) for this exact blocker class.
5. **AI DIRECTOR BLOCK** (B018) — a probabilistic, cacheable, budget-limited subsystem holds hard-veto power over signals that already passed a dozen deterministic gates, contrary to its own stated architecture.

---

## Direct answers to the 22 forensic questions (brief; full evidence in linked files)

1. **Which old version matches the "$100k→$500k in ~20 days" period?** `v5.8.50` (2026-06-11) is the strongest surviving snapshot from inside that run; the run itself spans roughly 05-19 (owner-recalled start) through 06-17, with no source changes 06-12→06-16. **Not independently re-verified against a raw trade log in this repo** — carried as context from a prior in-repo audit citing a CSV that no longer exists here (gap, see `VERSION_DISCOVERY_REPORT.md` §6).
2. **Which strategy?** TREND_PULLBACK, per the corroborating prior audit and confirmed structurally: it is the only setup type with dedicated anti-chase/exhaustion/personality gates added later, consistent with it being the strategy that mattered enough to keep restricting.
3. **What caused old growth?** A combination — this audit did not re-derive P&L attribution (no raw log present) but independently confirms the **structural** side: fewer sequential gates (24 vs 38+), no equity-tiered pyramid cutoffs (`EffectiveMaxPyramidAdds` didn't exist yet), unchanged core pyramid math.
4. **First major update that reduced trade frequency?** `530054f` (v6.0.2, 2026-06-23) is the first coordinated multi-gate release; `8101794` (v6.3.8, 2026-06-28) is the first to formally measure blocking, implying it was already a known problem by then.
5. **First version where multiple independent vetoes began checking the same setup?** Structurally present from `d10d65e`/`4650259`/`1301b07` (pre-window) onward, but the *duplication of the same responsibility* (not just multiple gates, but multiple gates answering the *same question*) is dated to `1436aab`/`0f823ab` (both 2026-07-08, v6.17.22/23) for entry timing specifically.
6. **When did the philosophy flip from "trade unless unsafe" to "unless every subsystem approves"?** No single commit flips a global switch. The closest concrete, dated answer is `5cb2bb8` (v6.17.16, 2026-07-08): it took a previously-partial label and made it an unconditional, no-override veto.
7. **Blockers added for isolated incidents that became global?** `5cb2bb8` itself (3 bad trades → unconditional block for all 5 sub-conditions); `027c9f0` (v6.21.2, one soft-degrade replaced with a hard block program-wide).
8. **Duplicate/near-duplicate blockers?** See `DUPLICATED_AND_CONTRADICTORY_BLOCKERS.md` — 8 groups, headline: entry timing (3 functions).
9. **Contradictory blockers?** AI Director "advisory-only" vs. hard-block code (§4); news filter hard-block vs. advisory carve-out (§6).
10. **Stale/slow HTF rejecting fast M5 opportunities?** `ContextGateAllows` (H4 bias) and DXY veto (~15-min cached) both independently verified to gate M5-speed opportunities on slower data; `v6.17.8`'s own commit message ("fix TREND_PULLBACK stale-HTF ~24h deadlock") proves this was a real, dated incident, not speculation.
11. **Can downgrade a correct signal because AI was skipped/unavailable/at 0%?** Yes — AI DIRECTOR BLOCK (B018), low-confidence-SKIP branch.
12. **Treat missing evidence as negative evidence?** `XAU_TradeBrainPreEntry` (B023) and the STI exhaustion gates are the most plausible candidates; not exhaustively proven in this pass — **INVESTIGATE_MORE**.
13. **Reject clean momentum for no wick/perfect structure?** Yes, directly documented: `failedImpulseBlock` (B045) before the v6.23.3 fix — "treated 'no rejection wick' as equivalent to 'impulse has failed'... hard-blocking 14 of 42 candidates (33%)."
14. **Prevent continuation after a strong move even when direction is correct?** Yes — `REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK` (B043) by name; `failedImpulseBlock` (B045, partially fixed) is the same failure mode for trend continuation specifically.
15. **Suppress re-entry/pyramiding after first position?** Yes — `EffectiveMaxPyramidAdds` hard equity-tier cutoffs (B036) structurally prevent a small account from pyramiding the way the growth-era account did, "by design, regardless of setup quality."
16. **Reduce lot to 0.01/near-zero despite a valid trade?** This exact failure mode is named and was deliberately converted to an outright block instead: `FULL_RISK_BINARY_BLOCK` (B026, v6.21.2) — "block instead of clamping to a token-size order."
17. **Modules meant to replace older logic but added on top instead?** AI Director (didn't remove the old `CONVICTION-VETO`/dual-AI mechanism — status of the old code path is **INVESTIGATE_MORE**, B017); `XAU_TimingEngineConfirmsEntry`/`XAU_ClassifySetup` (didn't replace `XAUEntryTimingGuard`).
18. **Blockers that should remain?** Hedge-mode consistency, EPF cluster veto, basket direction-loss block, SmartGuard hard-catastrophic (statistically backed) — see `KEEP_HARD` rows in `BLOCKER_MASTER_INVENTORY.csv`.
19. **Should become warnings, not vetoes?** PERSONALITY GATE (47% would-have-won), DXY veto (stale cross-asset data blocking fast M5 setups).
20. **Should be merged into one authority?** Entry timing (3→1), account-state lot-reduction stack (4→1), re-entry/recovery family (B031/B032/B014/B024).
21. **Should be removed from normal production?** None found with zero purpose — every blocker in the inventory traces to a real, cited incident or design rationale. The recommendation is consolidation and softening, not blanket removal — consistent with the user's own historical practice of "fix specific mistakes as they occur."
22. **How exactly did we get here?** Six-plus repeated cycles of incident → new named gate → gate added alongside (not replacing) existing coverage, concentrated overwhelmingly in an 18-day window (2026-06-28 → 07-15) following a single defensive over-correction that began six days after a reported account-ending loss.

---

## Final recommendations (see `BLOCKER_MASTER_INVENTORY.csv` for the full per-blocker table)

**Top priority — MERGE:**
- Entry timing: `XAUEntryTimingGuard` + `XAU_ClassifySetup` + `XAU_TimingEngineConfirmsEntry` → one authority, one decision.
- Account-state lot-reduction stack: `PG_BlockReason` + `EPF_*` + Growth Guard + Basket locks → one equity-%-aware system.
- Re-entry/recovery family: `TRI RE-ENTRY BLOCK` + `RECOVERY-GATE` + `IsDirectionLocked` + `BasketDirectionLossBlock`.

**Top priority — SOFTEN:**
- PERSONALITY GATE (documented 47% false-block rate).
- `EffectiveMaxPyramidAdds` hard equity tiers → margin-projection-aware %-of-equity curve.
- STI_LATE_BLOCK / STI_EXHAUST_BLOCK / `REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK` — apply the same continuation-health-score treatment v6.23.3 already proved out for `failedImpulseBlock`.

**Top priority — FIX_BUG:**
- AI Director: make the code match the "advisory-only, can never veto" claim, or stop making the claim.

**Top priority — INVESTIGATE_MORE:**
- `SOFT_BLOCK_CONVERTED` — trace every call site; it is the single most direct evidence of the exact failure mode the user described.
- `OLD_DIRECTION_EXHAUSTION_HARD_BLOCK` — newest, broadest-reach hard invariant, needs a dedicated false-block audit before being trusted the way older gates have been.

**Keep as-is:**
- Hedge-mode consistency, EPF cluster veto, basket direction-loss block, SmartGuard hard-catastrophic, A+→A demotion (20% would-have-won — a good blocker) — all have real evidence behind them and should not be touched.
