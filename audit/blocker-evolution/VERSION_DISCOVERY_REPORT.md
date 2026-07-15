# Version Discovery Report — May 15 – June 15, 2026 Window (and margins)

**Audit branch:** `audit/blocker-evolution-forensic-20260715`
**Worktree HEAD examined:** `e13d669857c7589e06af17460d7004794d11279e` (origin/main, 2026-07-15)
**Method:** `git log --all --since --until -- backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, `git log -S<symbol>`, `git log --follow`, `git show <rev>:<path>`, cross-checked against `RELEASE_CHECKLIST.md` and `audits/xau_growth_engine_forensic_audit_2026-05-15_to_2026-07-08.md` (a prior in-repo forensic audit — used as a **lead**, independently re-verified below, not trusted blindly).

## 1. The single canonical source file

The repo contains dozens of frozen, version-named `.mq5` snapshot files in the repo root (e.g. `XAUUSD_AI_Sniper_EA_v6.20.6.mq5`) plus per-version files under `frontend/public/`. These are **release artifacts**, each touched only at its own release and never again. The actual continuously-edited source is a single file that git's rename detection tracks end-to-end across every rename in its history:

```
backend/ea_code/XAUUSD_AI_Sniper_EA.mq5
```

`git log --follow -- backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` returns **294 commits**, spanning `2026-04-13` (earliest content-bearing commit reachable via rename-follow; commits before that are `auto-commit for <uuid>` scaffolding commits from repo bootstrap, oldest repo commit is `982530f` on `2026-04-09`) through `2026-07-15` (HEAD, `e13d669`). This is confirmed by the fact that the version-named snapshot files (`XAUUSD_AI_Sniper_EA_MASTER_v6.0.2_HUMAN_INTELLIGENCE_UPGRADE.mq5`, `..._v6.0.3_FORENSIC_GROWTH_AUDIT.mq5`, `..._v6.1.0_SMC_ENTRY_LAYER.mq5`, etc.) each show up as a **rename target** in this one `--follow` history at the exact moment they were the live filename, then git detects the next rename to the next version's filename. **All conclusions in this audit trace this single file's history, not any one frozen snapshot in isolation.**

## 2. True version numbering is NOT the root `v6.x` filenames

The root-directory `MASTER_v6.0.2`/`v6.0.3`/`v6.1.x`... filenames are misleading if read at face value: their **git commit dates are all 2026-06-23 or later**. The actual version label embedded in `#property version` / `#property description` inside the file itself, at real commit dates throughout the investigation window, uses a **different, lower-numbered `v5.8.x` track**:

| Date (local, +0100) | Commit | Internal version string (from file content at that commit) |
|---|---|---|
| 2026-05-15 02:27 | `0296075` | `v5.8.8 — WATCHDOG SCALE BUILD` |
| 2026-05-19 07:50 | `3e797dc` | `v5.8.18 — ANTI-BIAS STRATEGY FIX` (**owner-remembered start-of-growth date**) |
| 2026-05-19 21:35 | `fc66312` | `v5.8.25 — FAST VOLKILL FIX` |
| 2026-05-25 17:19 | `9088a01` | `v5.8.34 — PYRAMID RETEST FIX` |
| 2026-05-26 15:00 | `20d8430` | `v5.8.37 — POST-SWEEP A PLUS GUARD` |
| 2026-05-31 08:40 | `bfc1178` | `v5.8.38 — ENTRY TIMING MEMORY` |
| 2026-06-01 07:26 | `0b0882b` | `v5.8.39 — TRADE BRAIN MEMORY` |
| **2026-06-11 08:37** | **`de2984c`** | **`v5.8.50 — EVIDENCE REFACTOR`** — selected as the **strongest old comparison version**, see §4 |
| 2026-06-18 16:44 | `5291d2e` | `v5.8.51 — A+ PROFIT SHIELD` |
| 2026-06-18 17:02 | `ae8213c` | `v5.8.52 — A+ PROFIT SHIELD ON LIVE READINESS BASE` |
| 2026-06-18 19:53 | `746cfd2` | `v5.8.53 — SMART TWO-TIER SHIELD` |
| 2026-06-19 15:01 | `29f15e8` | `v5.8.54 — PATIENT PROFIT SHIELD` |
| 2026-06-19 20:26 | `b70fe72` | `v5.8.55 — RUNNER RESTORE SHIELD` |
| 2026-06-21 15:36 | `63937bd` | (precision refinement, no version bump shown) |
| 2026-06-22 08:59 | `1c3067b` | `v5.9.1 — BALANCED PRECISION` |
| **2026-06-23 23:23** | **`530054f`** | **`v6.0.2 — HUMAN INTELLIGENCE UPGRADE`** — first version to add "12-rule Human Reasoning Engine," "loss-streak caution," "Asian-session gate," "spread-spike detection with 10-min entry pause" simultaneously — verified turning point, see main report |
| 2026-06-24 07:31 | `f079bc3` | `v6.0.3 — FORENSIC GROWTH AUDIT` — the owner's/team's **own prior self-diagnosis** of this exact problem, dated one day after v6.0.2 |
| 2026-06-28 → 07-15 | 150+ commits | `v6.3.6` → `v6.23.3`, renumbered onto the now-familiar `v6.x` scheme used by the root-directory snapshot filenames |

**All internal version strings above were read directly from `git show <rev>:backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, not inferred from filenames.**

## 3. Commits touching the canonical file, May 15 – June 15, 2026 (window, all branches)

39 commits (all on the trunk that every branch descends from — no branch divergence exists in this window; `git branch --all --contains de2984c` returns every branch in the repo). Full list, oldest to newest:

```
2026-05-14 20:34  da00863  Modernize XauAI site and update EA download
2026-05-15 02:27  0296075  Fix XauAI scan watchdog and cloud stats
2026-05-15 07:26  e86a1b9  Fix lot scaling and indicator recovery
2026-05-15 09:13  1d70d74  Fix cloud signal fanout and scan recovery
2026-05-15 13:35  959a7b6  Fix EA expectancy loss armor
2026-05-15 13:54  757d19a  Fix EA expectancy guard compile error
2026-05-16 18:07  1dae660  Rebalance EA breathing expectancy
2026-05-16 18:40  3af8ac6  Add basket runner soft lock                    <- first named "lock"
2026-05-16 20:27  89a1c3d  Audit risk sync and worker scaling
2026-05-16 21:27  91e090e  Make gold exits structure-aware
2026-05-18 13:53  c6c2040  Add adaptive XAU confirmation build            <- AdaptiveXAUConfirm() gate framework
2026-05-19 07:50  3e797dc  Improve cloud broker linking and health checks
2026-05-19 11:03  1ff7f09  Add XAU entry timing guard                    <- XAUEntryTimingGuard() born
2026-05-19 18:30  e40f958  Add smart pyramid engine and indicator recovery backoff
2026-05-19 20:38  e90c8bd  Add trade cycle guard and broker aliases
2026-05-19 21:35  fc66312  Make XAU volatility guard adaptive
2026-05-20 19:58  659c7f1  Fix XAU pullback entry timing and cloud-safe EA lifecycle
2026-05-25 07:12  d0a761a  Improve XAU entry quality and smart loss guards
2026-05-25 10:20  f6aa406  Refactor XAU EA decision authority and audit reporting  <- first explicit "decision authority" pass
2026-05-25 11:07  964bd61  Rename XAU EA architecture audit build
2026-05-25 12:02  a861199  Show XAU idle reason on dashboard
2026-05-25 17:19  9088a01  Fix XAU pyramid and post-loss reentry
2026-05-26 09:26  9f2ee2d  Add XAU retest rescue pyramid logic            <- birth of PYR+RETEST_RESCUE
2026-05-26 12:20  353708d  Add timing quality grading for XAU A signals
2026-05-26 15:00  20d8430  Block post-sweep XAU A plus continuation traps <- first "post-sweep trap" hard block
2026-05-31 08:15  471ef98  Add XAU entry timing memory guard
2026-05-31 08:40  bfc1178  Harden XAU blocked memory persistence
2026-06-01 07:26  0b0882b  Add XAU trade brain memory                    <- real trade CSV logging begins
2026-06-01 07:43  e4979ae  Add XAU exit learning brain
2026-06-01 19:37  2e0bd7c  Add XAU attribution reporting engine
2026-06-01 20:11  401ffa3  Generate XAU weekly attribution report
2026-06-02 11:05  b7cf1a7  Isolate cloud worker to one MT5 account
2026-06-03 09:04  384d3b7  Fit XAU EA to attribution report
2026-06-03 12:00  215bd35  Add local trading intelligence dataset
2026-06-03 15:06  ca145fd  Add XAU startup sync accelerated learning
2026-06-03→06-04  (5 commits) Command Center / cloud infra — not core strategy
2026-06-04 15:51  481483a  Add rapid blocked-memory scout for missed XAU breakouts
2026-06-05 20:17  43faa41  Add Command Center prop firm mode              <- "v5.8.49 Prop Firm Mode" per owner recollection
2026-06-11 08:37  de2984c  Refine XAU prop risk and entry grading         <- v5.8.50 EVIDENCE REFACTOR, selected OLD version
```

**Gap: 2026-06-12 → 2026-06-16.** No commits touch the canonical EA file in this 5-day window (confirmed: `git log --all --since=2026-06-12 --until=2026-06-17 -- backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` returns nothing). The EA kept trading unmodified (v5.8.50) through this period per the live trade-log evidence cited in `audits/xau_growth_engine_forensic_audit_2026-05-15_to_2026-07-08.md` §2.1 (77 closed trades, 2026-06-01→06-15, +$351,118.29 net). **This audit did not independently re-derive that P&L number — the raw trade CSV (`XAUAI_ExecutedTradeBrain_XAUUSD.csv`) is not present in this repo/worktree** (confirmed via `find . -iname "*TradeBrain*"` — no results). The $351k figure is carried forward from the prior audit as INFERENCE-supported-by-cited-log, not independently re-verified here. Treat it as **corroborating context, not primary evidence** of this audit's own findings, which are all git/source-based.

## 4. Small margin before/after the window

- **Before:** `da00863` (2026-05-14, "Modernize XauAI site and update EA download") is the last touch before the window; internal version at that point was already v5.8.x-era (the file's `AdaptiveXAUConfirm`/`ContextGateAllows`/`PG_BlockReason`/`EPF_*` gate framework predates the window — earliest introducing commits found via `git log -S`: `ContextGateAllows` → `d10d65e` (2026-04-30), `PG_BlockReason` → `4650259` (2026-05-04), `EPF_BlockPyramidAdd` → `1301b07` (2026-05-12), `AIBlocksClose`/`AIVetoCooldownOK` → `6a8becd` (2026-04-27), `IsDirectionLocked` → `2291e67` (2026-04-23)). **The gating skeleton (AI veto, personality/context gate, direction lock, pyramid-block, entry-price-floor) already existed before the growth window even started** — the growth-era bot was never gate-free, it had a materially smaller/simpler set of gates than today.
- **After (immediately post-window, through the June 17 blowup and beyond):** covered in the main report and `BLOCKER_TIMELINE.csv`. Key dates: `2026-06-18/19` (5 rapid "shield" patches, v5.8.51-55), `2026-06-21/22` (v5.9.1), `2026-06-23/24` (v6.0.2/v6.0.3 — first coordinated multi-gate hardening + self-audit), `2026-06-28→07-15` (150+ commits, v6.3.6→v6.23.3, the bulk of current-production gate proliferation).

## 5. Version selected as "strongest old comparison"

**`v5.8.50 — EVIDENCE REFACTOR`, commit `de2984c`, 2026-06-11.** Rationale:
1. Falls inside the required May15–June15 window.
2. Is the **last version before any post-blowup defensive patch** (next touch to the file is `5291d2e`, 2026-06-18, the first "A+ Profit Shield" — i.e., v5.8.50 is the final pre-crisis architecture).
3. Independently corroborated by `docs/superpowers/specs/2026-06-11-xau-v5850-evidence-refactor-design.md` (present in this worktree — cites "61 closed trades: 72.1% win rate, +$192,502.77 net, profit factor 2.16" as of that date — a real, dated, in-repo artifact, not the prior audit's claim alone).
4. Full source is directly checkoutable: `git show de2984c:backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (12,065 lines — verified in this audit).

**Version selected as "current production":** `v6.23.3`, commit `e13d669` (2026-07-15, HEAD of `origin/main`), confirmed via `#define XAUAI_EA_VERSION "v6.23.3"` and `#define XAUAI_EA_VERSION_NUM "6.23.3"` at `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5:1788-1789`, `#property version "6.233"` at line 1773, matching `RELEASE_CHECKLIST.md`'s top entry and the `e13d669` commit message. `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` at HEAD is byte-identical to the frozen snapshot `XAUUSD_AI_Sniper_EA_v6.23.3.mq5` in the repo root (`diff -q` returns no difference).

## 6. Gaps and uncertainties (explicit)

- No raw trade CSV in this repo/worktree; all P&L figures cited from the prior audit are carried as corroborating context and labeled as such wherever used.
- The exact commit that maps to "v5.8.49 Prop Firm Mode" per owner recollection is inferred (`43faa41`, 2026-06-05, "Add Command Center prop firm mode") — no commit message literally contains the string "v5.8.49" (**INFERENCE**, consistent with the file's own internal comments referencing that number).
- `docs/superpowers/specs/2026-06-11-xau-v5850-evidence-refactor-design.md` was spot-checked for its existence and headline numbers only, not fully audited line-by-line in this pass.
- Screenshots the user attached to the original request were not available to this delegated task — noted per instructions as a gap; version selection in §5 is based on commit-message/spec/date evidence instead.
