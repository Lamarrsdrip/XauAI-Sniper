# Strategy Overview

This document describes what the EA does, in plain language. It does not
describe internal function/variable names or performance numbers — see
`KNOWN_LIMITATIONS.md` for what has and has not been verified for this
exact build.

## The decision flow

Every trade decision passes through the same fixed sequence, evaluated on
closed M10 (10-minute) bars only — the EA never acts on a still-forming
candle:

1. **Market regime** — classifies the current market as trending,
   ranging, breakout, low-volatility, choppy, or effectively dead, from
   local price-action structure.
2. **Direction** — determines whether a buy or sell is structurally
   supported at all, using multi-timeframe agreement (M5/M10/M15, with H1
   as softer context) computed locally from your chart's own price
   history.
3. **Entry quality / grade** — scores a candidate setup and assigns it a
   grade (A+, A, or B) or skips it entirely. Only a qualifying grade can
   result in a trade.
4. **Risk / lot sizing** — converts your account balance and a configured
   risk-percentage target into a lot size against the real distance to
   the stop loss, checked against your broker's actual margin and
   volume-step limits. Sizing is a fixed percentage-of-balance target for
   every qualifying trade — it does not reduce size based on "confidence"
   and does not increase size after a loss (no martingale, no grid).
5. **Execution approval** — a trade either goes through at its
   full calculated risk or is blocked outright with a stated reason;
   there is no silent partial-size fallback.
6. **Trade management** — every open position is tracked from fill to
   close: profit floors, break-even locks, trailing behavior, and partial
   take-profit are handled by a single local exit-management system.
7. **Exit** — the same local exit manager is the sole authority on when a
   position closes, alongside the broker-side stop loss it places at
   open.
8. **Post-trade learning** — the EA keeps a local, disk-persisted record
   of its own recent closed trades on this installation, and can use that
   history to add caution to a new candidate that closely resembles a
   recent cluster of losses (same setup type, session, and regime).
9. **News safety** — new entries are blocked in a configurable window
   around scheduled high-impact news events, using a local time-window
   calendar (no external news feed).
10. **Owner-location checks** — a set of local structural filters that
    block entries considered late/extended relative to recent price
    structure, independent of the grade score.

## What "grade" means

The A+/A/B labels you'll see in the log and any on-chart display are a
locally computed combined score (setup pattern, regime fit, session
quality, multi-timeframe alignment) — not an AI or machine-learning
opinion. This build makes no external model calls; the scoring is the same
deterministic rule-based logic already gating trades in the source product
this was forked from.

## What "trade memory" means

The EA keeps a local, disk-persisted history of its own recent closed
trades on this specific installation only. It is not shared with any
other installation or any server — there is no synchronization mechanism
in this build. It starts empty on a fresh install and only ever reflects
your own trading history on this machine.

## Risk and exit approach, in plain terms

- Every position sizes from a fixed percentage of your account balance
  (configurable via `InpNormalRiskPct`) against the real stop-loss
  distance for that trade.
- A stop loss is attached at open.
- The exit system aims to protect realized gains once a trade is in
  profit (profit floors, trailing, partial take-profit) but cannot
  guarantee a fill at any specific price — slippage and gaps are real
  execution risks, same as with any other order type. See
  `RISK_DISCLOSURE.md`.

## Honesty about this build's testing status

The regime/direction/entry-quality/risk/exit code paths in this file are
unchanged from the source product's logic — they are the same code
already used in a live, actively-traded product, not new or experimental
logic written for this fork. However, **this exact compiled build has not
yet had a dedicated Strategy Tester validation run performed against it**.
No backtest statistics, win rate, or performance figures are published in
this documentation because none have been generated for this specific
build — publishing numbers without a real run to back them would be
fabrication, and this documentation package does not do that. If you want
performance evidence before trading live, run your own Strategy Tester
session on your broker's XAUUSD feed and demo-test before committing real
capital (see `RISK_DISCLOSURE.md`).
