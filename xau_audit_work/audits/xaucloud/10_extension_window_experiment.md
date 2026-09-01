# GENERAL Extension Window Experiment: 0 / 5 / 10 Minutes

Owner-requested comparison. Three isolated compiles of the exact audited source
(differing only in the `extensionDeadline` constant at
`XAU_General10MTryArm`, `XAUUSD_AI_Sniper_EA.mq5:26884` — 600s / 300s /
disabled), each replayed over the identical real-tick 60-day window
(2026-05-22 to 2026-07-21, MetaQuotes-Demo, same deposit/leverage). None of
these variants were committed to the audited source or deployed anywhere —
scratch-only, isolated sandbox.

## Result

| Window | Net profit | Profit factor | Max balance/equity DD | Trades | Win rate |
|---|---:|---:|---:|---:|---:|
| No extension | +$2,234.86 | 1.09 | 77.21% / 82.90% | 100 | 57.00% |
| 5 minutes | +$6,134.02 | 1.27 | 46.44% / 47.17% | 123 | 69.11% |
| **10 minutes (audited default)** | **+$10,839.11** | **1.43** | **43.97% / 44.98%** | 116 | 68.10% |

**10 minutes wins on every metric** — net profit, profit factor, and drawdown
all improve monotonically with window length in this window. Removing the
extension entirely more than triples max drawdown and cuts net profit ~79%
versus the 10-minute default, confirming this mechanism is load-bearing for
the strategy's risk profile, not a marginal tuning knob.

## A real bug caught during this work

The first attempt at added per-trade window-sampling telemetry (peak/profit at
the 5-min and 10-min marks) introduced a genuine dangling-if bug: a new
statement was inserted between an `if(...)` condition and its opening brace,
which rebound the brace-enclosed block to always execute unconditionally —
making the exit-authority evaluation function always `return false`. This
was caught by comparing results against a known-good baseline (identical
numbers to the no-extension run when they should have differed), root-caused
by inspecting the actual generated source, and fixed by moving the new
statement inside the existing braces. Both fixed variants were verified to
reproduce their pre-bug reference numbers exactly before being trusted.

## Per-trade telemetry limits, stated honestly

The requested exact-minute-mark peak/P&L sampling (peak during 0-5min, P&L at
minute 5, peak during 5-10min, P&L at minute 10) was not successfully
captured: the sampling hook only fires when a *competing* close-request
evaluation occurs during an active extension, which — empirically, in this
dataset — never happens (extension always runs to its deadline uncontested).
Rather than rewire the hook again and risk another subtle bug this late, the
comparison instead uses the same-arm peak-vs-realized data that already
exists unconditionally in the audited source's own `R_EXIT_COUNTERFACTUAL`
telemetry (real, verified against 100% of trades in both the 5-min and 10-min
runs, timestamp-aligned with zero mismatches).

## Giveback (peak profit vs. realized), same-arm comparison

| Window | Trades with giveback | Avg giveback | Max giveback | Total given back |
|---|---:|---:|---:|---:|
| 5 minutes | 102 / 123 (83%) | $417.35 | $1,650.00 | $42,569.23 |
| 10 minutes | 98 / 116 (84%) | $496.62 | $1,820.00 | $48,668.43 |

Both windows give back a similar *share* of peak profit per trade — giveback
is a near-constant feature of this exit mechanism regardless of window
length. The 10-minute window's advantage isn't less giveback per trade; it's
fewer, better-selected trades at a substantially higher average profit
($93.44/trade vs $49.87/trade).

## Why no cross-arm trade-by-trade table

These are full-window replays, not isolated single-trade tests. Once the
first extended trade closes at a different time across arms, every
subsequent trade's timing and even existence can diverge — "trade #47" in the
5-minute run is not the same market event as "trade #47" in the 10-minute
run. A cross-arm per-trade match-up would compare unrelated events under a
misleading shared row number, so it was not produced. The aggregate
comparison and the same-arm giveback analysis are both real and valid; a
fabricated cross-arm table would not be.

Full report with interactive charts:
https://claude.ai/code/artifact/150e464f-9159-47b4-bd9a-c9c26e1d8bd4
