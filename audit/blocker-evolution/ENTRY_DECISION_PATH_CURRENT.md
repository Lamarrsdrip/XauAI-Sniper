# Entry Decision Path — CURRENT (v6.23.3, commit `e13d669`, 2026-07-15, HEAD of origin/main)

Source: `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` at HEAD (34,750 lines; identical to `XAUUSD_AI_Sniper_EA_v6.23.3.mq5`). Line numbers below are from that file, primary signal path (the same path old §uses; `RE_ENTRY` at line 9091 and pyramid-add path share several of the same gate functions and are not double-counted).

## Stage-by-stage (signal already scored; `combinedScore`/`grade`/`setupName` set)

Grouped into stages; a stage may contain 1-4 individually-triggerable veto points. **NEW = introduced after the OLD comparison version (v5.8.50, 2026-06-11)**; **CARRIED = existed in v5.8.50 too** (verified via `grep`/`git log -S` against the old checkout, see `ENTRY_DECISION_PATH_OLD.md`).

| Stage | Line(s) | Gate | New/Carried | Type | Exact log/tag |
|---|---|---|---|---|---|
| 0a | 14703 | Trade cooldown (`InpTradeCooldown`) | NEW | HARD (time-boxed) | — |
| 0b | 14712 | Streak-pause (`IsInStreakPause`) | NEW | HARD | — |
| 0c | 14723 | GATE1: DEAD market (regime quality) | NEW | HARD | `"GATE1: DEAD market (...) — skip"` |
| 1 | 14778-14801 | ADAPTIVE REVERSAL BLOCKED (account/cadence, spread/news, news, anti-chase/location) — 4 sub-checks feeding one path | NEW | HARD ×4 | `"ADAPTIVE REVERSAL BLOCKED (...)"` |
| 2 | 14821 | `XAU_TimingEngineConfirmsEntry()` (adaptive-reversal branch — a SECOND call to the same function used again at 16826) | NEW | HARD | — |
| 3 | 14915-14922 | ADAPTIVE-DIRECTION BLOCK / LEGACY VETO SUPERSEDED — `XAU_ComputeActiveDirection` + override | NEW | HARD/informational split | `"ADAPTIVE-DIRECTION BLOCK: ..."` |
| 4 | 14987-15101 | PERSONALITY GATE — soft mismatch, "SOFTENED" (converts hard→warning under 2 conditions), symmetric recheck, then hard `PERSONALITY GATE BLOCK` if still A/A+ mismatch | NEW (v6.4.0, `StrategyFitsPersonality`) | HARD with 2 soften paths + 1 hard path | `"PERSONALITY GATE BLOCK: ..."`, `"PERSONALITY-GATE SOFTENED: ..."` |
| 5 | 15222 | SMC HARD CONFLICT BLOCK — grade force-downgraded to SKIP | NEW (`g_smcHardBlockActive`, v6.7.0) | HARD | `"SMC HARD CONFLICT BLOCK: ... grade ... downgraded to SKIP"` |
| 6 | 15252 | TRI RE-ENTRY BLOCK (Trade Recovery Intelligence) | NEW (v6.8.0) | HARD | `"TRI RE-ENTRY BLOCK: ..."` |
| 7 | 15347-15353 | FIX-C: B-grade demoted to SKIP in regime / LOW_VOL | NEW | HARD (grade-force) | `"⚙ FIX-C: B-grade trade demoted to SKIP..."` |
| 8 | 15366 | ANTI-BIAS | CARRIED | HARD | `"TRADE BLOCKED BECAUSE: "` + antiBiasReason |
| 9 | 15382-15429 | B-GRADE QUALITY BLOCK | CARRIED | HARD (report-fit-scout soften path) | `"B-GRADE QUALITY BLOCK: ..."` |
| 10 | 15471-15646 | SMART-GUARD HARD / SOFT / FAST-CONFIRM / structural-bypass / stacking | CARRIED, +NEW structural-bypass sub-branch (`XAU_StructuralBypassAllowed`) | HARD ×3 + SOFT ×1 | `"SMART-GUARD ..."` |
| 11 | 15678 | A+ → A DEMOTION | CARRIED | SOFT (grade demote) | `"A+ DEMOTED → A: ..."` |
| 12 | 15695 | SCORE THRESHOLD | CARRIED | HARD | `"TRADE BLOCKED BECAUSE: "` + blockReason |
| 13 | 15713 | `XAUEntryTimingGuard()` — BAD-TIMING | CARRIED | HARD | `"TRADE BLOCKED BECAUSE: "` + timingReason |
| 14 | 15735/15747 | Hedge/no-hedge consistency | CARRIED | HARD | `"TRADE BLOCKED BECAUSE: "` + hedgeMsg |
| 15 | 15764 | ANALYSIS-ONLY | CARRIED | HARD | `"TRADE BLOCKED BECAUSE: "` + msg |
| 16 | 15808-15817 | Adaptive news-momentum entry evaluation | NEW | HARD | `"TRADE BLOCKED BECAUSE: "` + adaptiveNewsWhy |
| 17 | 15835 | SPREAD | CARRIED | HARD | `"TRADE BLOCKED BECAUSE: "` + spreadBlockReason |
| 18 | 15858 | NEWS FILTER (with a note at 15853 that during "adaptive post-news interpretation" the news filter becomes advisory-only — see `DUPLICATED_AND_CONTRADICTORY_BLOCKERS.md`) | CARRIED | HARD (situationally advisory) | `"TRADE BLOCKED BECAUSE: NEWS FILTER (high-impact event nearby)"` |
| 19 | 15874 | DXY VETO | CARRIED | HARD | `"DXY VETO — gold_bias=... vs signal=..."` |
| 20 | 15906-15964 | STI (Smart Timing Intelligence) — LATE ENTRY HARD BLOCK, EXHAUSTION HARD BLOCK, third check w/ structural bypass | NEW | HARD ×3 (one has a structural-bypass soften) | `"STI_LATE_BLOCK ..."`, `"STI_EXHAUST_BLOCK ..."` |
| 21 | 15998 | ANTI-REVERSAL cooldown | CARRIED | HARD (time-boxed) | revMsg |
| 22 | 16007-16017 | BASKET DIRECTION LOSS BLOCK (v6.1.3) | NEW | HARD | bdlReason |
| 23 | 16032 | DIRECTION LOCKOUT | CARRIED | HARD (time-boxed) | locMsg |
| 24 | 16051 | RECOVERY-GATE | NEW | HARD | recMsg |
| 25 | 16166 | LOCAL ML VETO | CARRIED | HARD | `"LOCAL ML VETO — WR=..."` |
| 26 | 16184 | HIVE VETO | CARRIED | HARD | `"HIVE VETO — signature ..."` |
| 27 | 16197-16413 | **AI DIRECTOR** — full committee review; can ALLOW/BLOCK/REDUCE/INCREASE; internal branches for confidence threshold, HTF-consensus override, weak-disagreement-logged-not-blocking | NEW (v6.3.0-era, hardened through v6.17.11 "AI can never veto a trade **again**" — i.e. it *was* re-enabled as a hard veto before being demoted back to advisory) | HARD in ≥1 branch (16360-16362) despite "advisory-only" framing elsewhere | `"AI DIRECTOR BLOCK: AI SKIP with confidence X% < min Y%. Trade blocked."` |
| 28 | 16536 | `ContextGateAllows()` | CARRIED | HARD | — |
| 29 | 16547 | ADAPTIVE_DRAWDOWN (equity below watermark blocks non-A/A+ grades) | NEW | HARD (grade-conditional) | `"ADAPTIVE_DRAWDOWN: grade=... blocked..."` |
| 30 | 16572 | `PG_BlockReason()` — PROFIT GUARDIAN VETO | CARRIED | HARD | pgBlock |
| 31 | 16587 | `EPF_EntryBlockReason()` — EPF VETO | CARRIED | HARD | epfBlock |
| 32 | 16607 | EPF CLUSTER VETO | CARRIED | HARD | — |
| 33 | 16645 | `XAU_TradeBrainPreEntry()` — BRAIN-BLOCK | CARRIED | HARD | — |
| 34 | 16695 | SIZE GUARD BLOCK / `FULL_RISK_BINARY_BLOCK` (v6.21.2 — converts what used to be a 0.01-lot fallback into an outright block) | NEW | HARD (explicitly hardened from a soft lot-floor) | `"FULL_RISK_BINARY_BLOCK: combined quality evidence ... is below executable threshold; block instead of clamping to a token-size order"` |
| 35 | 16826 | `XAU_TimingEngineConfirmsEntry()` (second/main call) | NEW | HARD | — |
| — | 16855 | **`OpenTrade(signal, bufATR[1], setupName+" ["+grade+"]", finalSzMult)`** | — | — | Final call site |
| 36 (inside `OpenTrade()`) | 17679 | `XAU_CrossInstanceEntryLockActive()` | NEW (v6.20.3) | HARD | `"EXECUTION_FUNNEL BLOCK CrossInstanceEntryLock"` |
| 37 (inside `OpenTrade()`) | ~17703 | `XAU_FinalAdaptiveDirectionDecision()` | NEW (v6.23.1) | HARD | — |
| 38 (inside `OpenTrade()`) | 18025 | `XAU_GrowthGuardEntryBlockReason()` | NEW (v6.4.12) | HARD | growthEntryBlock |

## Summary counts (CURRENT, v6.23.3)

- **Unique blocker *concepts*** (independently counted via unique dashboard/log tag strings across the whole file, `grep -noE` method identical to the OLD count): **61** unique tags, of which **42 do not exist at all in v5.8.50** (verified: `comm -13` on the two tag lists — see `OLD_VS_CURRENT_MATRIX.md`).
- **Executable veto locations in the primary path shown above**: **38 distinct stages**, several containing 2-4 individually-triggerable sub-checks (Personality Gate, STI, Adaptive Reversal, AI Director) — the true line-level `return false;`/`return;` count in this region alone is **>45**.
- This table **does not** include: the separate M5 Entry Delay (v6.20.0) confirmation-window logic, `XAU_CounterExcursionEligible()` gating for the isolated Counter-Excursion sub-strategy, or the Adaptive Transition Authority's `WOULD_BLOCK`/`OLD_DIRECTION_EXHAUSTION_HARD_BLOCK` invariants (v6.23.1) — all three sit in code paths that intersect this one but were not line-traced in this pass; flagged **INVESTIGATE_MORE** for full inclusion.
- **A signal that clears every stage above still has three more hard gates inside `OpenTrade()` itself** (cross-instance lock, final adaptive-direction re-decision, growth-guard entry block) before an order is actually sent — i.e., **reaching line 16855 is not the end of the gauntlet.**

## What this proves, directly

The old version already had a substantial gate stack (24 veto points, §`ENTRY_DECISION_PATH_OLD.md`). The current version did not replace that stack — it **kept nearly all of it (CARRIED rows above) and added a second, parallel stack on top** (PERSONALITY GATE, SMC HARD CONFLICT, TRI RE-ENTRY, STI ×3, AI DIRECTOR, ADAPTIVE-DIRECTION, ADAPTIVE_DRAWDOWN, BASKET DIRECTION LOSS, RECOVERY-GATE, FULL_RISK_BINARY_BLOCK, plus the three gates now inside `OpenTrade()` itself). This is the single most concrete, line-verifiable answer to the user's question "how did we get from free-trading to hardcore-blocking": **net addition, not net replacement.**
