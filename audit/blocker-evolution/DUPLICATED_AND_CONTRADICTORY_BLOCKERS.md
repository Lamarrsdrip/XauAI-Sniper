# Duplicated and Contradictory Blockers

All items below verified against `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` at HEAD (`e13d669`, v6.23.3) unless a specific historical commit is cited. Where a claim originates in a prior in-repo audit, it is marked and was independently spot-checked (function/line existence, not the prior audit's narrative).

## 1. Entry-timing: three independent authorities answering the same question

| Function | Introduced | What it decides |
|---|---|---|
| `XAUEntryTimingGuard()` | `1ff7f09`, 2026-05-19 ("Add XAU entry timing guard") | "BAD-TIMING" quality gate — late-chase, spike-cooldown, failed-impulse, post-sweep-trap, bad-RR-for-report → composite `blockClass` |
| `XAU_ClassifySetup()` | `1436aab`, 2026-07-08 (v6.17.23, "adaptive timing + countertrend classifier, replacing the fixed one-bar wait") | Countertrend evidence classifier, used inside `ContextGateAllows()` |
| `XAU_TimingEngineConfirmsEntry()` | `0f823ab`, 2026-07-08 (v6.17.22) | One-bar / wall-clock (2-3 min) reconfirmation wait, called **twice** in the current primary path (line 14821 adaptive-reversal branch, line 16826 main branch) |

All three answer variations of "is this entry timing acceptable right now." They were added in three different eras (pre-v6, then two more within the same 24-hour period, 2026-07-08) without being merged into one authority. **This is the clearest verified duplication in the file** — independently confirmed by re-checking each function's own introducing commit; it is not just carried forward from the prior audit's claim.

## 2. Personality/structural mismatch: called twice in one pipeline, softened two different ways

`StrategyFitsPersonality()` (introduced `0683572`, 2026-06-28, v6.4.0 "Market Personality Engine") is called at line ~12561-equivalent and again for a documented "symmetric recheck" (line 15085 region, `"PERSONALITY-GATE SYMMETRIC RECHECK"`). Between the two calls, the code contains **two separate softening paths** that convert a hard PERSONALITY-GATE mismatch into a warning:
- `"PERSONALITY-GATE SOFTENED: confirmed continuation converted personality mismatch to warning"` (line 15031)
- `"PERSONALITY-GATE SOFTENED: STRONG_MOMENTUM_OVERRIDE converted B/personality mismatch to warning"` (line 15040)

Two different override reasons, two different code paths, one underlying gate. Not proven wrong, but a second gate answering "does this setup fit the current personality" that could disagree with the first call mid-pipeline (flagged **INVESTIGATE_MORE** by the prior audit; this pass confirms both call sites and both soften paths exist verbatim but did not exhaustively test for actual mid-pipeline disagreement).

## 3. Structural hard-block vs. HTF-bias gate: two systems, same responsibility, not proven non-overlapping

- SmartGuard block (lines ~15471-15646 in current)
- `ContextGateAllows()` Gate 1 (HTF-bias, `d10d65e`, 2026-04-30) — line 16536 in current

Both can independently reject a signal on "structure/trend conflict" grounds. Per the prior in-repo audit's ownership map (independently spot-checked: both functions exist, both are called sequentially in the primary path, confirmed via this audit's own line trace in `ENTRY_DECISION_PATH_CURRENT.md`), this is **not proven contradictory but not proven non-overlapping either** — genuinely unresolved, carried forward as **INVESTIGATE_MORE**.

## 4. AI's veto power: the commit message says "advisory-only," the code still hard-blocks

Commit `fc80e1f` (2026-07-08, v6.17.11) message states: *"AI advisory-only architecture: AI can never veto a trade again."*

Verified directly against the current source: `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5:16360-16362`:
```
aiVerdictStr = "BLOCK";
...
"AI DIRECTOR BLOCK: AI SKIP with confidence %d%% < min %.0f%%. Trade blocked."
```
This branch is reached when AI confidence is below a threshold — and the log text is unambiguous: **"Trade blocked."** Meanwhile three sibling branches in the same function (lines 16303, 16328, 16376, 16388) explicitly log `"ADVISORY... not blocking"` for other AI-disagreement scenarios. **This is a direct, source-verified contradiction between the v6.17.11 commit message's stated architecture and the shipped code that has existed in every release since**: the AI Director can and does still hard-block a trade in the low-confidence-SKIP branch, despite the "AI can never veto a trade again" framing. This is not carried from any prior audit — found independently in this pass.

## 5. `HARD_BLOCK` self-label vs. actual enforcement — the v6.17.16 fix, and what it reveals

Commit `5cb2bb8` (2026-07-08, v6.17.16) documents, in its own words, that `XAUEntryTimingGuard()` computed an internal `blockClass="HARD_BLOCK"` label from five OR'd conditions (`lateChaseEntry||spikeCooldown||failedImpulseBlock||postSweepTrap||timingBadRRForReport`) but **only one of the five (`lateChaseEntry`) actually had a `return false` wired to it** — the other four got the scary label in the diagnostic text and then executed anyway. A background audit cited in that commit found **3 of 19 executed trades in a 3-day window carried this self-contradicting `HARD_BLOCK` label and executed anyway, none were clean wins**, and the same pattern recurred 5 times over 5 weeks (net −$161.52). The fix made `blockClass=="HARD_BLOCK"` an **unconditional** `return false` with no override path.

**This is directly relevant to the user's question #6 ("at what version did the bot change from take-a-valid-signal-unless-clearly-unsafe to do-not-trade-unless-every-subsystem-approves")**: v6.17.16 is a concrete, dated answer for one specific mechanism — it converts a previously-permissive, partially-enforced label into a universal veto, based on 3 bad trades. The commit itself frames this correctly as fixing an inconsistency (a label that lied), not as adding new caution — but the **effect** is a strictly more restrictive system, and it is representative of a repeated pattern across the v6.17.x series (25 releases in ~36 hours, 2026-07-07 through 07-08).

Also from the same commit: **106 blocked A/A+ signals vs. 19 executed trades in the same 3-day window** (source: `audits/xau_expectancy_inversion_audit_2026-07-06_to_2026-07-08.md`, cited in the `5cb2bb8` commit message) — an approximately **5.6:1 blocked-to-executed ratio on the highest-grade setups**, dated one week before HEAD. This is the closest concrete, dated, in-repo quantification of "the bot blocks almost every trade now" available without live telemetry.

## 6. News filter: hard block in one place, explicitly advisory-only in another, on the same tick

- Line 15858: `"TRADE BLOCKED BECAUSE: NEWS FILTER (high-impact event nearby)"` — hard block, `InpUseNewsFilter`.
- Line 15853 (guarding the block above): `"NEWS_OBSERVING: external/news API filter is advisory only during adaptive post-news interpretation; continuation gate decides after confirmation."`
- Line 15808: a **third**, separate system, `XAU_EvaluateAdaptiveNewsMomentumEntry()`, can independently block with its own reason text.

Three overlapping systems (hard filter, a documented advisory carve-out for the same filter, and a wholly separate adaptive-momentum news gate) governing the same "is this a safe time to trade around news" question, only partially reconciled. **Not proven to double-count the same event in practice** (would require live log correlation not available in this repo) — flagged **INVESTIGATE_MORE**, but the code-level overlap is verified.

## 7. `SOFT_BLOCK_CONVERTED` — a named mechanism that converts warnings into blocks

`blockClass = "SOFT_BLOCK_CONVERTED"` (line 31312, introduced `d11acf8`, 2026-07-03, "Add XAU strong momentum override"). The mere existence of a tag whose name is "a soft block that got converted [to a hard one]" is direct evidence that the codebase has, at least once, formalized the exact pattern the user is worried about: informational/soft signals hardening into rejections over time. **INVESTIGATE_MORE** on the full scope of what triggers this conversion; the tag's existence and origin commit are verified, its full trigger logic was not exhaustively traced in this pass.

## 8. Growth-Guard vs. EPF vs. Profit-Guardian vs. Basket locks — four independently-evolved risk/lot-reduction systems

`XAU_GrowthGuardCapLots()` (2026-06-30), `EPF_LotMultiplier()`/`EPF_EntryBlockReason()` (pre-window, 2026-05-12/05-25), `PG_BlockReason()`/`pg_selectiveActive` Selective Mode (pre-window), and the basket-lock family (`EffBasketLockMinPct`, `InpBasketDirLossBlockPct`, `BasketDirectionLossBlock` introduced `79024ac`, 2026-06-28) each independently reduce lot size or veto entries based on overlapping "is the account currently in a bad state" logic (drawdown, daily loss, basket floating loss). Per the current source (line ~5262-5305 stack in `ENTRY_DECISION_PATH_CURRENT.md`), these are called **sequentially and multiplicatively** (`pgLotMult *= EPF_LotMultiplier(); pgLotMult *= epfAdaptiveLotMult;`), meaning a trade that survives one account-state gate can still be shrunk or killed by up to three more account-state gates in a row. **Not proven redundant in intent** (each was introduced for a different incident, per commit messages), **but not unified**, and the prior in-repo growth-engine audit independently reached the same conclusion for a subset of these (`InpMinAccountLotFloor` override interaction, §7 of that audit) — re-verified here as still true in current source (`InpMinAccountLotFloor=0.10` at line 2275, comment confirms "no longer used to override sizing... retained for back-compat/telemetry only," meaning **that specific override was already fixed** since the prior audit — a positive finding, noted for completeness).

## Summary table

| Group | # systems | Duplicate or contradiction? | Recommendation |
|---|---|---|---|
| Entry timing (§1) | 3 | Duplicate (same question, three answers) | MERGE |
| Personality gate double-call (§2) | 1 function, 2 call sites, 2 soften paths | Possible duplicate/self-conflict | INVESTIGATE_MORE |
| SmartGuard vs. ContextGate structure conflict (§3) | 2 | Overlapping responsibility, unresolved | INVESTIGATE_MORE |
| AI Director "advisory-only" vs. hard block (§4) | 1 function, self-contradictory | **Contradiction** (commit message vs. code) | FIX_BUG (make the code match the stated architecture, or update the claim) |
| `HARD_BLOCK` self-label enforcement (§5) | 1 (now fixed) | Was a contradiction (label lied), now consistent — but the fix made the system strictly more restrictive | KEEP_HARD (the fix itself is correct; flag the pattern for future gates) |
| News filter (§6) | 3 | Overlapping, partially reconciled | INVESTIGATE_MORE |
| Soft→hard conversion tag (§7) | 1 named mechanism | Confirms the user's exact concern exists in code | INVESTIGATE_MORE |
| Account-state lot-reduction stack (§8) | 4 | Sequential/multiplicative, not proven redundant but not unified | MERGE (lower priority — each has independent evidence of purpose) |
