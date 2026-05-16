# XauAI Sniper Platform Audit

Last updated: 2026-05-16

## Executive Answer

The EA is not configured as a simple "wait until -10% per trade" system.

Current default protection is layered:

- Planned single-trade SL risk cap: `InpMaxRiskPctEquity = 3.0`
- Planned aggregate open-risk cap: `InpMaxAggregateRiskPct = 8.0`
- Expectancy hard-loss armor cap: `InpExpectancyMaxLossPctEq = 5.0`
- Daily loss limit and weekly loss limit are disabled by default for demo testing.

That means the bot can cut a trade before -10% if the trade is structurally invalidated or if the equity/risk cap is reached. That is intentional account protection. The important fix is that it should not panic-close normal XAUUSD pullbacks. In v5.8.14, the basket floor first takes a partial soft lock and keeps a runner alive where possible instead of closing the entire basket immediately.

## Critical Hidden Interaction Found

The basket manager runs before per-ticket trade management:

1. Daily/weekly/equity protection
2. Day-giveback guard
3. Basket manager
4. Per-position clean exits
5. EPF partials
6. Re-entry watcher
7. Pyramid watcher
8. Dashboard and cloud heartbeat
9. New-signal scan

This means basket peak/floor protection can override breakeven, trailing, and partial TP before those per-trade systems get a chance to act. That was a real weakness.

Fix applied: first basket floor hit now uses a soft-lock partial close when possible. Full close is reserved for fast reversal, hard giveback, or a second basket floor failure after partial profit has already been banked.

## EA Execution Loop

The EA is designed to keep reading the market even while positions are open.

Every tick:

- Updates dashboard status.
- Runs hard account/session protection.
- Manages open trades.
- Runs pyramid checks.
- Sends cloud heartbeat.
- Watches for re-entry opportunities.

On new M5 bar or watchdog recovery:

- Refreshes indicator buffers.
- Detects regime: trend up, trend down, range, chop, low volatility, breakout.
- Scores the setup.
- Applies context gates, Smart Guard, spread/session/news gates.
- Opens a trade only if the setup survives filters.

The bot should not stop analyzing just because a trade is open. If logs say "entries paused while positions active", management is still running, but fresh same-direction pyramid or re-entry logic can still evaluate separately.

## Signal Engine

The EA combines:

- M5 execution timing.
- M15/H1/H4 alignment.
- EMA fast/slow structure.
- RSI momentum.
- ATR volatility.
- Swing support/resistance.
- Regime classification.
- Smart Guard setup memory.
- Spread/session filters.
- News/careful mode gates.

Weak setups are rejected. Strong trend pullbacks can still pass when trend, momentum, volatility, and HTF alignment support the trade.

## Smart Guard / AI Behavior

The AI/Smart Guard does not literally know the future. Its job is to reduce bad setup classes and avoid low-quality market states.

Important behavior:

- It should not permanently poison a setup class from tiny samples.
- It should use soft vetoes before hard blocking.
- It should allow strong trend pullbacks when alignment is excellent.
- It should log why it allowed, reduced, or blocked a setup.

This part is adaptive risk intelligence, not guaranteed profit. The strongest safety rule is still: no martingale, no blind recovery, no uncapped exposure.

## Lot Sizing

Master EA:

- Uses account balance/equity.
- Applies mode risk, signal confidence, account-size multiplier, drawdown guard, margin cap, broker min/max/step, single-trade cap, and aggregate cap.
- Logs balance/equity, risk %, calculated lot, final lot, and reduction reason.

Important v5.8.14 fix:

- Normal entries and pyramids now both respect single-trade risk and aggregate open-risk caps.
- Pyramids can no longer bypass the global risk room.

Cloud worker:

- v1.5.3 uses strict proportional mirror by default:
  `cloud lot = master lot * (cloud equity or balance / master balance)`
- If master and cloud are similar size, lots should be similar.
- If cloud is bigger, lot should be bigger unless broker/margin/optional operator cap reduces it.
- `WORKER_MAX_RISK_PCT` defaults to `0`, meaning disabled.

If the VPS log says "fit 10% cap", the VPS is still running an older worker or has `WORKER_MAX_RISK_PCT` set. That will make cloud lots smaller than expected.

## Trade Management

Clean exits are the main per-ticket exit authority when enabled.

Loss side:

- Normal drawdown is allowed.
- Soft de-risk can close part of a losing position once, then keep a runner.
- Full close requires deeper R loss, equity cap, or confirmed invalidation.

Win side:

- Breakeven is delayed until the trade has enough R confirmation.
- Partial TP is delayed until a stronger move.
- Chandelier trailing starts later, after momentum is confirmed.
- Basket soft-lock can bank partial profit before per-ticket logic if the whole basket gives back from peak.

This is designed to avoid the old problem where small wins were taken fast but one bad trade wiped the day.

## Pyramids

Pyramids are allowed only when:

- Market regime supports continuation.
- Signal direction remains aligned.
- Spread is acceptable.
- The add-on respects single and aggregate risk caps.
- Broker margin and volume rules allow it.

The pyramid add uses fresh ATR-based stop logic when the original position SL has already moved to breakeven, so the new layer is not suffocated by inheriting a too-tight stop.

## Cloud Sync

Master EA sends:

- Open signal.
- Close signal.
- Partial close signal.
- Heartbeat.
- Reasoning/log context.

Backend stores signals and exposes them to the worker.

Worker:

- Polls pending signals.
- Opens, partially closes, or closes MT5 tickets.
- Maintains signal-to-ticket mapping.
- Reconciles orphan tickets.
- Posts execution results back to backend.

Backend dashboard:

- Reads `cloud_trades`.
- Calculates realized PnL from stored profit.
- Falls back to entry/exit/lot math if the worker sends zero profit.
- Tracks completed trades, win rate, net PnL, balance, and equity snapshots.

## Current Verification

Verified locally:

- Python backend and worker compile with `py_compile`.
- Worker package `xauai_worker_agent_v1.5.3.zip` contains the new v1.5.3 worker and requirements.
- EA source has risk caps wired into normal entries and pyramid entries.
- Download endpoint now names the EA package as v5.8.14.

Could not verify locally:

- Frontend production build, because this Codex environment has Node but no `npm`, `yarn`, or `pnpm`.
- Live broker execution timing, because that requires the MT5 terminal/VPS and live backend network conditions.

## Operator Checklist

Before judging live results, make sure these are true:

- MT5 has WebRequest enabled for `https://xauaisniper.com`.
- The chart is running the latest EA file: `XAUUSD_AI_Sniper_EA_MASTER_v5.8.14_RISK_SYNC_AUDIT.mq5`.
- VPS worker starts as `XauAi Worker Agent 1.5.3`.
- VPS worker log says `riskCap=disabled`.
- The cloud dashboard shows recent balance/equity updates.
- Close/partial logs appear in worker output after master closes.

## Remaining Reality Check

No EA can be made "always profitable." What can be made professional is the control system:

- Do not let one trade wipe many wins.
- Do not cut healthy pullbacks too early.
- Let strong winners breathe.
- Cap total risk.
- Keep scanning while trades are open.
- Mirror cloud users proportionally and quickly.
- Keep dashboard stats honest.

That is the direction of this version.
