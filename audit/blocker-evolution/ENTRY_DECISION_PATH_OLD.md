# Entry Decision Path — OLD (v5.8.50 "Evidence Refactor", commit `de2984c`, 2026-06-11)

Source verified via `git show de2984c:backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (12,065 lines). Line numbers below refer to that checked-out copy, primary signal path only (the file also has a separate, shorter `RE_ENTRY` path at line 2732 and a pyramid-add path starting ~line 3197 which shares several of the same gate functions — noted where relevant).

**Important correction to a claim in a prior in-repo audit** (`audits/xau_growth_engine_forensic_audit_2026-05-15_to_2026-07-08.md` §4, which describes the old-era pipeline as "score → grade threshold → `OpenTrade()`... roughly 3 steps"): that is **not what the actual v5.8.50 source shows**. Reading the real primary-path code line-by-line, the growth-era EA already had on the order of **20 sequential veto/demotion points** between signal scoring and `OpenTrade()`. The growth era was not gate-free — it had a materially *smaller and less duplicated* set of gates than today, most of them soft/statistically-tuned to rarely fire, not a 3-step funnel. This is the accurate, source-verified picture used for the rest of this audit.

## Full sequential path (signal already scored, `combinedScore`/`grade`/`setupName` set)

Each numbered step is a real, independently-triggerable exit point (`return;`) in the source, with its exact log prefix.

| # | Line (approx) | Gate | Type | Exact log text | Can independently kill the trade? |
|---|---|---|---|---|---|
| 1 | 4760 | ANTI-BIAS (opposite/same-direction repeat) | HARD | `"TRADE BLOCKED BECAUSE: "` + antiBiasReason | Yes |
| 2 | 4773 | B-GRADE QUALITY BLOCK (`IsDamageProneSetupName` + `AdaptiveXAUConfirm`) | HARD (with a report-fit-scout softening path) | `"B-GRADE QUALITY BLOCK: %s %s failed stricter fast XAU confirmation."` | Yes |
| 3 | 4808 | SMART-GUARD HARD (`IsSmartGuardDamageSetup` + statistical catastrophic check) | HARD | `"SMART-GUARD HARD: ... reason=statistically catastrophic"` | Yes |
| 3b | 4849 | SMART-GUARD SOFT (same block, non-catastrophic branch) | SOFT (lot cut only, `InpSmartGuardSoftLotMulti`) | `"SMART-GUARD SOFT: ... allowed with reduced risk x..."` | No (size reduction only) |
| 4 | 4861 | SMART-GUARD (`SG-FAST`, `AdaptiveXAUConfirm` HTF requirement) | HARD | `"SMART-GUARD: %s blocked by adaptive fast confirmation..."` | Yes |
| 5 | ~4890 | SMART-GUARD stacking (`SG-STACK`) | HARD | `"TRADE BLOCKED BECAUSE: "` + sgMsg, dashboard tag `SG-STACK` | Yes |
| 6 | 4899 | A+ → A DEMOTION (no H1 alignment, not trend-following setup) | SOFT (grade downgrade, not a block) | `"A+ DEMOTED → A: setup=..."` | No (demotes size/AI-veto exposure only) |
| 7 | 4927 | SCORE THRESHOLD (`signal==0 \|\| combinedScore < dynGradeB`) | HARD | `"TRADE BLOCKED BECAUSE: "` + blockReason (`"no setup met regime criteria"` or `"combined X < threshold Y"`) | Yes |
| 8 | 4953 | `XAUEntryTimingGuard()` — `"BAD-TIMING"` | HARD | `"TRADE BLOCKED BECAUSE: "` + timingReason | Yes |
| 9 | ~4970 | Hedge-mode consistency (`HEDGE`/`NO-HEDGE`) | HARD | `"TRADE BLOCKED BECAUSE: "` + hedgeMsg | Yes |
| 10 | 5004 | ANALYSIS-ONLY / `entryExecutionBlocked` | HARD | `"TRADE BLOCKED BECAUSE: ANALYSIS-ONLY: "` + reason | Yes |
| 11 | 5019 | SPREAD block | HARD | `"TRADE BLOCKED BECAUSE: "` + spreadBlockReason, tag `SPREAD` | Yes |
| 12 | 5038 | NEWS FILTER (`InpUseNewsFilter`) | HARD | `"TRADE BLOCKED BECAUSE: NEWS FILTER (high-impact event nearby)"` | Yes |
| 13 | 5047 | DXY CORRELATION GATE (`InpUseDXYFilter`) | HARD | `"TRADE BLOCKED BECAUSE: "` + `"DXY VETO — gold_bias=... vs signal=..."` | Yes |
| 14 | 5064 | ANTI-REVERSAL cooldown (`InpReversalCooldown`) | HARD (time-boxed) | `"ANTI-REVERSAL cooldown (%ds left...)"` | Yes |
| 15 | 5079 | DIRECTION LOCKOUT (`IsDirectionLocked`) | HARD (time-boxed) | `"DIR-LOCK — %s side locked until %s due to recent losses"` | Yes |
| 16 | ~5145 | LOCAL ML VETO | HARD | `"TRADE BLOCKED BECAUSE: LOCAL ML VETO — WR=..."` | Yes |
| 17 | ~5160 | HIVE VETO (cross-account signature match) | HARD | `"TRADE BLOCKED BECAUSE: HIVE VETO — signature ..."` | Yes |
| 18 | ~5203 | CONVICTION-VETO (`InpConvictionSizing`, AI confidence < `InpMinAIConfidence`) | HARD | `"CONVICTION-VETO: AI confidence X% < min Y% — SKIP"` | Yes |
| 18b | ~5212 | CONVICTION-WEIGHTED SIZING | SOFT (0.5x/1.0x/1.3x sizing) | `"CONVICTION-SIZE: ..."` | No |
| 19 | 5257 | `ContextGateAllows()` — HTF (H4) bias + swing S/R proximity | HARD | (inside function; caller just returns) | Yes |
| 20 | 5262 | `PG_BlockReason()` — Profit Guardian (counter-trend stack / tier-3 halt / post-loss cooldown / Selective Mode) | HARD | `"🛡 PROFIT GUARDIAN VETO: "` + pgBlock | Yes |
| 21 | 5275 | `EPF_EntryBlockReason()` — Entry Price Floor tiers | HARD (with adaptive T4 soft-pass) | `"🛑 EPF VETO: "` + epfBlock | Yes |
| 22 | 5291 | `EPF_IsClusteredEntry()` — cluster protection | HARD | `"🛑 EPF CLUSTER VETO: entry too close to existing same-direction position"` | Yes |
| 23 | ~5305 | EPF lot-mult == 0 lockdown | HARD | `"🛑 EPF LOT MULT = 0 (lockdown active) — skipping entry"` | Yes |
| 24 | 5338 | `XAU_TradeBrainPreEntry()` — trade-brain memory pre-check | HARD | dashboard tag `BRAIN-BLOCK` | Yes |
| — | 5352 | **`OpenTrade(signal, bufATR[1], setupName+" ["+grade+"]", sizeMulti * pgLotMult)`** | — | — | Final call |

## Summary counts (OLD, v5.8.50)

- **Unique blocker *concepts*** (distinct named gates/systems, deduped where two log lines belong to one function): **~19** — matches the 19 unique dashboard/log tag strings independently counted via `grep -noE` across the whole old-version file (see `OLD_VS_CURRENT_MATRIX.md`).
- **Executable veto locations in the primary path alone**: **24** distinct `return;`/hard-exit points shown above (some concepts appear more than once — e.g. SMART-GUARD fires at 3 separate points).
- **Soft/non-veto adjustments in the same path**: 3 (SMART-GUARD SOFT lot cut, A+→A demotion, CONVICTION-WEIGHTED SIZING).
- **Sequential depth**: an entry that survives every gate above still passes through pyramid-specific gates (`EPF_BlockPyramidAdd`, `PyramidAdaptiveConfirmPass`) only if it's an add, not a fresh entry — those are not double-counted here.

This is a real, already-substantial gate stack — the growth era's edge came from these gates being tuned to **rarely trigger on the setups that mattered** (TREND_PULLBACK), not from having no gates.
