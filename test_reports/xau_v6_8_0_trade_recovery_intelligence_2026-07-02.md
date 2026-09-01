# XAU AI Sniper v6.8.0 — Trade Recovery Intelligence (TRI)

Date: 2026-07-02
Scope: gold-only bot (`XAUUSD_AI_Sniper_EA_v6.7.0.mq5` → `v6.8.0.mq5`), building directly on v6.7.0's Adaptive Entry/Exit Arbiter.

## What TRI does

A trade that comes close to SL isn't automatically a bad trade — sometimes the market gives it one real chance to prove the entry wasn't wrong. TRI watches that chance instead of reacting to distance-from-SL alone.

**Step 1 — Detect near failure.** Once adverse movement reaches `InpTRI_NearSLPct` (default 85%) of the original SL distance, the trade enters Recovery Mode. This step never closes or reduces anything — it only starts watching, snapshotting momentum, HTF bias, AI confidence, and structure at that exact moment.

**Step 2 — Watch the recovery.** Every tick tracks the true worst point reached (MAE) and whether/when price reclaims breakeven.

**Step 3 — Classify, at the decision moment.** The only decision point is the instant price actually reclaims breakeven (profit ≥ 0) — never before. A weighted score (how much of the adverse move was reclaimed, momentum change, whether HTF bias is still valid, whether structure stayed intact, AI confidence change) decides:
- **STRONG** (score ≥ threshold): hold normally, no action taken.
- **WEAK** (score below the floor): bank the second chance — close right there, at breakeven or small profit, instead of risking another full SL cycle.
- **FAILED** (never reclaims breakeven within `InpTRI_FailedAfterBars`): tagged for logging and re-entry memory only — **does not force an exit**. The trade keeps riding its normal SL and other exit systems exactly as it would have without TRI.
- Anything in between (ambiguous): no action either way — matches the explicit safety rule that a bare return-to-breakeven is never sufficient justification on its own.

**Step 4 — Smart re-entry.** A WEAK-recovery bailout arms a watch on that direction. The next same-direction signal isn't blocked outright, but needs a genuinely fresh trigger (new BOS, liquidity sweep, pullback, OB/FVG reaction, strong momentum candle — reusing v6.7.0's HTF trigger-requirement logic) rather than the same read that just failed. Goal: improve the average entry price rather than stubbornly re-fighting a damaged position.

## Adaptive by design, not hardcoded

- The near-SL threshold, strong/weak score thresholds, and stall-duration are all inputs, not baked-in constants.
- The classification score itself weighs five independent signals (reclaim depth, momentum, HTF, structure, AI confidence) rather than a single fixed rule.
- The strong threshold is raised automatically in choppy/rangey regimes (`CleanChoppyRegime()`), since a reclaim is more likely to be noise there.
- A rolling-outcome self-tuning mechanism is implemented (`XAU_TRI_RecordStrongOutcome`) — if trusted (STRONG, held) recoveries keep losing, the bar rises; if they keep winning, it can trust a little sooner. **Scoping note**: this isn't wired to a live close callback yet — there's no single universal per-ticket "trade closed" hook in this file today, and retrofitting one across every exit path (many, per the v6.7.0 audit) was judged too risky to rush. The threshold safely sits at its input default until that hook exists; nothing depends on it firing, and it's an honest, flagged gap rather than a silently unfinished feature.

## Safety rules verified

- TRI's only close action requires `profit >= 0` — it never needs the loss-close firewall and never conflicts with No-Limit Trading Mode's "ride every trade to SL" default (confirmed: `TRI_WEAK_RECOVERY_EXIT` does not appear in `XAU_EmergencyLossCloseAllowed`).
- FAILED recovery never calls a close function — verified directly against the source, not just described.
- Per your closing clarification, this matches exactly: *"never end a trade unless it's SL, or it nearly gets to SL then bounces back to entry — end at entry or small profit."*

## Testing

`tests/test_xau_v680_trade_recovery_intelligence_static.py` — 12 tests verifying every safety rule against the actual compiled source (recovery-mode entry never closes, FAILED never force-exits, WEAK-exit is only reachable at breakeven-or-better, ambiguous reclaims take no action, the firewall carve-out was never touched, re-entry gating uses a fresh-trigger requirement not a hard block).

Compiled clean: 0 errors, 0 warnings (`test_reports/metaeditor_v680_tri.log`). Full suite: **182/182 passed** (170 previous + 12 new).

## Still queued

Porting v6.7.0 + v6.8.0 to XauIndex (per the standing instruction) — not done this pass, gold-only per priority. Now moving to the Command Center live-decision-feed audit and fix.
