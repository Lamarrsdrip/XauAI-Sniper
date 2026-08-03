# Risk Disclosure

Trading leveraged instruments such as gold (XAUUSD) CFDs or spot gold on
margin carries a high level of risk and may result in the loss of some or
all of your invested capital. It may not be suitable for every investor.
**Past performance, including any backtest, Strategy Tester result, or
statement about the source product's live trading history, is not
indicative of future results.** No profit, win rate, or drawdown outcome
is guaranteed by this product or its documentation.

## This EA uses real capital risk

- Every position it opens is sized against a configured risk-percentage
  target (`InpNormalRiskPct`) applied to your account balance and the
  real distance to that trade's stop loss.
- A stop loss is attached to every position at open, but a stop loss
  limits loss — it does not eliminate it. Slippage, gaps (including
  weekend gaps), and broker execution conditions can result in a fill
  worse than the stop-loss price, particularly around high-volatility or
  news events.
- Trading on margin means losses can, in adverse conditions, exceed the
  amount allocated to a single trade's stated risk if multiple positions
  are open concurrently or if execution conditions are unfavorable.

## What this EA does not do

- It does not guarantee profit, a specific win rate, or protection
  against loss of capital.
- It does not use martingale, grid, or any position-sizing approach that
  increases exposure after a loss to attempt to "recover" it.
- It does not adjust position size based on an AI confidence score — this
  build makes no AI/LLM calls of any kind (see `README.md` and `FAQ.md`).
- It does not monitor your account or intervene on your behalf outside of
  its own programmed logic — there is no human or remote oversight of any
  individual trade it places.

## No performance claims are made in this documentation

This documentation package does not publish a win rate, backtest curve,
or return figure for this specific build, because no fresh Strategy
Tester validation run has been performed against this exact compiled
version at the time of this release (see `KNOWN_LIMITATIONS.md` and
`STRATEGY_OVERVIEW.md`). Any performance figures you may see elsewhere
(marketing materials, a Market listing screenshot, third-party review)
should be treated with the same skepticism you would apply to any trading
product's performance claims — verify them yourself before relying on
them.

## Your responsibility as the operator

- **Test on a demo account first.** Confirm the EA's behavior matches
  your expectations for your specific broker, symbol/suffix, spread, and
  execution conditions before running it on a live account.
- Set `InpNormalRiskPct` and related risk inputs to a level appropriate
  for your own risk tolerance, account size, and broker's margin
  requirements — the defaults are a starting point, not a recommendation
  tailored to you.
- Only trade with capital you can afford to lose.
- Monitor the EA's operation. It is a decision-automation tool, not a
  substitute for your own judgment about whether to run it, on what
  account, at what size, and when to stop.
- Understand your broker's specific terms for XAUUSD/gold trading
  (leverage, margin requirements, swap, execution model) before running
  any automated strategy against a live account.

## Not financial advice

This document is a risk disclosure, not financial or investment advice.
Nothing in this product or its accompanying documentation should be
interpreted as a recommendation to trade any specific instrument, take
any specific position, or use any specific amount of leverage or risk.
You are solely responsible for your own trading decisions and their
outcomes.
