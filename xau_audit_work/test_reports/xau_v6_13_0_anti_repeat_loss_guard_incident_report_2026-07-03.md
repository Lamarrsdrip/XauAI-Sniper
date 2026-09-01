# v6.13.0 — Incident Report: Repeated BUY Losses (2026.07.03 15:23–17:08) + Cloud Reliability Hardening

## Part 1 — Trade failure investigation

### What happened

Between 15:23 and 17:08, XAUUSD fell from 4182.42 to 4159.10 (a real, sustained ~$23 downtrend) while the EA opened six consecutive losing BUY trades:

| Entry | Close | P/L |
|---|---|---|
| BUY 0.40 @ 4182.42 | 4174.91 | -$300.40 |
| BUY 0.18 @ 4178.84 | 4174.91 | -$70.74 |
| BUY 0.28 @ 4176.04 | 4167.29 | -$245.00 |
| BUY 0.05 @ 4173.60 | 4167.29 | -$31.55 |
| BUY 0.26 @ 4169.34 | 4159.10 | -$266.24 |
| BUY 0.05 @ 4166.53 | 4159.10 | -$37.15 |

Investigated using the actual EA journal log (`MQL5/Logs/20260703.log`), confirmed running v6.12.0 at the time.

### Root cause (confirmed against the live log + source, not guessed)

**1. `g_htfConsensusDir` stayed `HTF=+1` (bullish) the entire window — this is mathematically expected, not a bug in itself.** It's computed in `ScoreSetups()` from H1 EMA(50/200) and M30 EMA(50/200) spreads (±0.15%/±0.20% thresholds — roughly $6–8 at this price). A $23 fall over 105 minutes cannot invert that relationship that fast. The signal is a slow structural-trend measure; it was never designed to react to an M5-level reversal within two hours.

**2. `HTF_TREND_FOLLOW`'s "real trigger" requirement offered no real protection once HTF was stale.** Its `hasRealTrigger = pullbackIntoValue || bosConfirmed || obReaction || fvgReaction || strongMomentumCandle` check (line ~7629) was satisfied twice (16:25:44, 16:30:30) by `pullbackIntoValue` (price within 0.35×ATR of the M5 EMA) or `strongMomentumCandle` (one green M5 candle, body ≥0.5×ATR) — both trivially true on any dead-cat bounce inside an active downtrend, since BOS (`g_smc_bos_dir`) stayed `+0` (no H1 candle actually closed below the 20-bar swing low during the window — also legitimate, not stuck).

**3. The gate that DID correctly see the danger got silenced — this is the real root cause.** `AdaptiveXAUConfirm` inside the `SMART_GUARD_FAST_CONFIRM` gate correctly detected `M5:AGAINST` + `M15:AGAINST` (fastAgainst=2) twice during the window and issued a hard block. But `XAU_StrongContextForSoftBypass(grade, combinedScore)` unconditionally returns `true` for **any** A/A+ grade, so `XAU_ModeAllowsSoftBlockWarning()` (true in BALANCED_MODE) downgraded both hard blocks to mere warnings — with zero memory of how many times this had already happened this session. The same unconditional bypass exists at two more sites: `STI_REENTRY_WAIT` and `AI_LOW_CONF_SKIP`.

**4. AI confidence read 0% throughout — not a display bug, a real design gap.** `lastAIConfidence` is reset to 0 by `XAU_AIRecordBudgetGuard`/`XAU_AIRecordLocalDecision` whenever the cost-control "Budget Guard" skips the paid AI call. The entry pipeline doesn't distinguish "AI was never actually asked" from "AI said 0%" — both look identical downstream, and neither blocked the A+/A grade entries.

**5. AI-Memory correctly flagged this exact setup as terrible (11.1% win rate over 235-239 samples) but the response was too weak, and could be overridden the wrong way.** `XAU_MemoryRecommendation` only applied a flat 0.65× lot cut for any win rate ≤35% — no escalation for a win rate this catastrophic. Worse, `XAU_MemoryLotFloorForContext` — a separate mechanism that raises lot size back up when HTF consensus + grade look strong — could push the multiplier back above that reduction, specifically because HTF consensus was the exact stale signal from point 1. The 16:25:44/16:30:30 entries show `lotMult=1.38` (boosted), not reduced.

### Answers to your 9 questions

1. **Why keep buying after the first loss?** Each new M5 bar re-scored the setup fresh, with no memory of "the last BUY in this session just lost" anywhere in the entry pipeline.
2. **Did regime detection fail to flip bearish?** No — HTF consensus behaved exactly as designed; it's just the wrong tool for this timescale.
3. **Did HTF/BOS/momentum/AI still say BUY incorrectly?** HTF yes (structurally, not wrongly). BOS stayed neutral (legitimately). AI confidence was never really consulted (Budget Guard). Momentum (`strongMomentumCandle`) triggered on ordinary bounce candles.
4. **Did the bot ignore drawdown/consecutive-loss protection?** There was no consecutive-same-direction-loss protection to ignore — it didn't exist.
5. **Why pyramid into a falling market?** The one gate built to catch exactly this (`SMART_GUARD_FAST_CONFIRM`) fired correctly and got downgraded to a warning both times.
6. **Was recovery mode / re-entry / averaging / basket logic responsible?** No — confirmed these are independent systems for managing a single open position near SL; this incident was repeated fresh entries, not TRI/recovery/pyramiding-into-the-same-ticket.
7. **Why were some lots 0.40/0.28 (high)?** A+/A grade base sizing (1.10–1.38×) plus the memory floor overriding the win-rate-driven reduction.
8. **Did news/spread/vol/SL logic affect these exits?** No news/spread blocks were logged in this window; exits were normal SL hits, not news/spread/volatility-driven.
9. **Did the bot fail to stop after the 0.40 loss?** Yes — confirmed, no such stop mechanism existed before this fix.

### The fix — Anti-Repeat-Loss Guard (v6.13.0)

**New state** (`g_sameDirLossStreak`, `g_lastLossDir`, `g_lastLossClosePx`): updated at trade close — a win clears it, a loss in a new direction restarts it at 1, a loss in the same direction extends it.

**New guard function** `XAU_AntiRepeatLossActive(int signal)`: true only when (a) the streak has reached `InpAntiRepeatLossStreak` (default 2) in `signal`'s direction, **and** (b) price hasn't closed back in `signal`'s favor by at least half an ATR past where the last loss closed. The moment either condition clears — a win resets the streak, or price genuinely recovers — the guard returns false and every bypass behaves exactly as it did before. It never touches a direction with no active streak.

**Wired into all three unconditional bypass sites** (`SMART_GUARD_FAST_CONFIRM`, `STI_REENTRY_WAIT`, `AI_LOW_CONF_SKIP`): each now requires `!XAU_AntiRepeatLossActive(signal)` in addition to the existing grade check before downgrading a hard block to a warning. When the guard blocks it, the log line explicitly says so.

**Memory floor fixed**: `XAU_MemoryLotFloorForContext`'s raise is now suppressed while `XAU_AntiRepeatLossActive(signal)` is true — lot size can no longer increase during an active same-direction loss streak. Also added a 0.35× tier for win rate ≤15% (was only ever a flat 0.65× for anything ≤35%).

This is deliberately adaptive, not a blanket ban: a fresh direction, or a genuine recovery, is never blocked by this guard.

## Part 2 — Cloud connection failures

Audited the full day's log for `BOT-DECISION`/`BOT-MONITOR`/`BOT-COMMAND` failures (47/17/96 occurrences respectively, out of 2791 successful heartbeats).

1. **Is the cloud API sometimes offline/slow?** Failures are isolated singletons, always immediately surrounded by successes seconds later (verified by pulling the interleaved log) — not a sustained outage.
2. **Are endpoint URLs correct?** Yes — confirmed matching backend routes (`/api/cloud/monitor/heartbeat`, `/api/cloud/monitor/activity`, `/api/cloud/command/pending`).
3. **Vercel/server logs showing 4xx/5xx?** Not checked — no access to server-side logs from this environment; flagging honestly rather than guessing.
4. **Is the timeout too short?** 5000ms; not implicated given the failure pattern (isolated blips, not systematic slow-timeout behavior).
5. **Retry/backoff strong enough?** There was none — a failed call was simply dropped until the next scheduled cycle (~10-20s later for heartbeat/command polling).
6. **Does trading continue safely when cloud fails?** Yes, confirmed — every trade decision is computed and acted on entirely locally in MQL5; none of the three cloud call sites gate any entry/exit logic (verified: `OpenTrade()` makes zero `WebRequest` calls).
7-10. **Fixed**: added `XAU_CloudRecordSuccess`/`XAU_CloudRecordFailure`, shared across all three call sites. Failure logs now include a running consecutive-failure count. After `InpCloudOfflineFailThreshold` (default 3) consecutive failures, logs `CLOUD_OFFLINE_LOCAL_MODE` once; logs `CLOUD_RECONNECTED` once on recovery, with downtime duration and failure count.

## Testing

`tests/test_xau_v6130_anti_repeat_loss_guard_static.py` (10 tests) — verifies the loss-streak tracking, the guard's adaptive lift condition, all three bypass sites are gated, the memory floor suppression, the escalated win-rate tier, and all three cloud call sites report to the shared tracker with zero coupling to `OpenTrade()`. Compiled clean: 0 errors, 0 warnings. Full suite: **241/241 passed**.

## Note

This EA was running v6.12.0 during the incident; gold has since moved to v6.13.0 with this fix. Recommend restarting the live EA on v6.13.0 as soon as convenient.
