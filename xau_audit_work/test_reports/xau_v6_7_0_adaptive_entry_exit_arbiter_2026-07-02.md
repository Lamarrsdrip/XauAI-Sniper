# XAU AI Sniper v6.7.0 — Adaptive Entry/Exit Arbiter (Gold-Only Bot)

Date: 2026-07-02
Scope: `XAUUSD_AI_Sniper_EA_v6.6.1.mq5` → `v6.7.0.mq5` — **gold-only bot only**, per explicit instruction. XauIndex was not touched in this pass; a separate catch-up port is the next step (see bottom).

## What was wrong

A full audit (16-point trace through entry scoring, SMC, AI Director, lot sizing, and every exit system) found the individual modules were each well-built, but genuinely weren't acting as one brain:

- **HTF_TREND_FOLLOW** fired off H1+HTF consensus alone — no requirement for an actual entry trigger (pullback, retest, sweep, structure reaction). Two soft internal bonuses (EMA alignment, a body>20%-of-range candle that fires on almost every bar) were the only gate.
- **SMC was bonus-only.** An opposing BOS, or price sitting inside the *opposite* side's order block/FVG — exactly where that side is most likely to defend — was logged and then ignored. SMC could help a trade but never cost it anything or say no.
- **The A+/A full-size enforcement floor** (a real, deliberate anti-underprotection fix from v6.4.17/18/20) already correctly refused to restore size after a weak-agree AI verdict — but had no equivalent guard for a new SMC hard-conflict signal, since that signal didn't exist yet.
- **AI Committee could already hard-block A+/A trades** (this was better than assumed going in) but B-grade trades — the lowest-quality tier, needing the most oversight — only ever got sized down on an AI disagreement, never blocked, no matter how confidently the AI disagreed.
- **Protected Peak Floor's arm threshold** was a single fixed dollar figure (`$75`, comment: "tuned for a $3k-style XAU account") — didn't scale with account size or the trade's own risk.
- **A real, severe bug**: Codex's own v6.6.1 loss-close firewall (built to stop panic closes and enforce "let trades breathe") was silently blocking the EA's own well-reasoned, structure-confirmed objective-invalidation exits (`EARLY_CONVICTION_CUT`, `CLEAN_INVALID`, `STRUCTURE_FAILFAST`) whenever the trade happened to be in a loss — which is exactly when a "cut a proven-wrong thesis fast" exit needs to fire. These exits already require multiple independent confirming signals (structure break + EMA + RSI + reversal candle, or a genuine BOS/HTF flip); they aren't panic closes, but the firewall couldn't tell the difference by context-string alone.
- **AI's exit CLOSE call** executed unconditionally once minimally profitable — no check for whether structure actually agreed anything had deteriorated.
- Trades didn't store a complete thesis (invalidation level, target zone, expected type) — only entry BOS/HTF snapshots for TTM's own scoring.

One important audit finding that reframed the scope: `InpCleanExits` defaults to `true`, meaning the 15-system "legacy cascade" the initial trace found is mostly dead code in default operation — the real production exit path is `ManageCleanExitsForPosition()`, which turned out to already be a sophisticated, largely R-multiple/account%-based system (objective invalidation scoring, an A+ Profit Shield with R-multiple arm thresholds, giveback-requires-reversal-confirmation logic). Rebuilding that from scratch risked reintroducing bugs it already fixed across many prior releases. The real gaps were the specific items above — so this release fixes those precisely rather than replacing a system that, on inspection, was already doing most of what was asked of it.

## What changed

**Entry side:**
1. `HTF_TREND_FOLLOW` now requires at least one real trigger — pullback into fair value (near the M5 EMA), a confirmed BOS in the trade direction, price reacting inside the trade's own OB/FVG zone, or a genuinely strong momentum candle (0.5×ATR body, not the old 20%-of-range bar) — before it can fire at all.
2. New `SMC_GetConflictPenalty()`: opposing BOS, price inside the *opposing* OB, price inside the *opposing* FVG each now cost real score. Two or more simultaneous conflicts hard-block the trade (downgrade to SKIP), respecting the existing soft-block-warning mode for growth/dev trade modes.
3. The A+/A enforcement floor now also skips restoration when the new SMC hard-conflict flag is set — matching how it already skips restoration for AI weak-agree.
4. AI Committee gained real BLOCK authority over B-grade: a confidently-skipped B-grade (AI's own skip conviction clears the same bar used to hard-veto A+/A trades) now blocks instead of only reducing to 0.50× lot.

**Exit side:**
5. Protected Peak Floor's arm threshold is now `min(fixed-floor × account-size-multiplier, this trade's own 1R × a configurable multiple)` instead of one fixed number — protection arms proportionally to the account and to the trade's own risk.
6. The loss-close firewall now recognizes `EARLY_CONVICTION_CUT`, `CLEAN_INVALID`, `STRUCTURE_FAILFAST`, and a structurally-confirmed TTM exit as legitimate — **but only when No-Limit Trading Mode is explicitly turned off.** No-Limit mode's default (ON, "ride every trade to broker SL, no internal early exits, ever") is completely unchanged; this was a direct conflict I flagged and you confirmed the resolution for before implementing.
7/8. `TradeTTMRecord` now stores a complete entry thesis — invalidation price, target zone, expected trade type, full entry reason, 1R in dollars — captured at `OpenTrade()` time. AI's exit CLOSE verdict is now overridden into a protective SL move (not a panic close) whenever structure is still healthy (trend aligned, no confirmed break, momentum ≥2/5) — "if AI says exit but structure is healthy, protect instead of panic close."

**Logging:** `XAU_LogBotDecision()` — one clean, parseable `BOT_DECISION:` line per entry decision (action/direction/setup/grade/confidence/entryScore/timing/SMC/HTF/AI/memory/reason), wired at the actual entry point and at both new block paths. `XAU_LogTradeThesisStatus()` — one `TRADE_THESIS_STATUS:` line per open position per evaluation (healthy/pullback/warning/invalidated, hold/protect/exit reasons, peak/current/protected profit, next action), pure observability, dashboard-ready.

## How entry is now smarter

It no longer takes a trade just because two moving averages agree. HTF consensus alone used to be sufficient; now it needs a real, checkable reason to be *this* candle — a pullback, a structural break in its favor, or genuine momentum. SMC went from a source of bonus points to a real veto: two independent structural signals against a trade now stop it, even at A+/A grade. B-grade — the tier with the least margin for error — now has the same real AI authority A+/A already had.

## How exit is now smarter

Protection now scales with the account and the trade's own risk instead of one number tuned for one account size. The AI can still act fast when it should, but a healthy trend can no longer be closed on an AI opinion alone — structure gets a say. And the EA's own careful, evidence-based early-exit logic is no longer silently discarded by a firewall that couldn't tell it apart from a panic close (for users who've opted out of No-Limit mode).

## How it prevents bad late entries

The HTF trigger requirement is the direct fix: no more "H1 and H4 agree, buy now" with nothing else. The SMC hard-block adds a second, independent check that can veto a trade even when the setup score looks fine on paper.

## How it prevents winners giving back too much

The Protected Peak Floor now arms sooner (or later) based on the trade's actual risk and the account's actual size, rather than a single number that was only ever correct for one specific account size.

## How it avoids closing strong runners too early

The AI-exit-vs-structure precedence rule is the direct answer: an AI CLOSE call on a position where the trend is still aligned and structure hasn't broken now locks in profit instead of exiting outright — the runner stays open if the market is still cooperating.

## Testing

New `tests/test_xau_v670_adaptive_entry_exit_arbiter_static.py` (13 tests) verifying every item above against the actual compiled source — including the AI-exit-override precedence, the No-Limit-mode-gated firewall carve-out, and the thesis-storage fields. Also updated `test_xau_v661_no_limit_loss_close_static.py`'s firewall test to assert the new *conditional* invariant (blocked-list items stay blocked; the four new contexts are recognized only inside the No-Limit-mode guard) rather than reverting the confirmed design.

Compiled clean: 0 errors, 0 warnings (`test_reports/metaeditor_v670_arbiter.log`). Full suite: **170/170 passed**.

## Scoping notes (what this release deliberately did NOT do)

- Did not rebuild TTM, Growth Guard, or `ManageCleanExitsForPosition()` from scratch — audit found them already sophisticated and R-multiple-aware; risk of a full rewrite outweighed the benefit given no backtesting harness exists to validate a wholesale replacement.
- Did not extend the A+/A floor guard to cover pre-existing timing/confirm-lot reductions (those are a deliberate, dedicated-release decision from v6.4.17/18/20 with their own reasoning I didn't have equally careful audit coverage of this pass) — only added the guard for the genuinely new SMC signal.
- Did not touch **XauIndex** — per your explicit instruction this pass is gold-only. Per your separate standing instruction ("whenever you update the gold bot, always add it to XauIndex too, since it trades gold as well"), porting this redesign — plus catching XauIndex up on the v6.6.0/v6.6.1 gold-lineage work it's missing (including the No-Limit Trading Mode feature itself) — is the next step.
