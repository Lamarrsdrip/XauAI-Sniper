# Claude XauCloud

## What this is

A self-contained MetaTrader 5 Expert Advisor for XAUUSD (gold), decision
cycle centered on the M10 (10-minute) timeframe. It is a fork of a live,
cloud-connected gold-trading product ("XauCloud") with every AI/LLM call,
cloud backend, remote-command channel, and copy-trading fanout removed.
What remains is the deterministic local engine — market regime, direction,
entry-quality scoring, risk sizing, trade management, and exits — computed
entirely inside this one file, on your own machine, from your own chart
data. There is no server, no external API, no DLL, and nothing this EA
does depends on a network connection.

This build was produced by forking the production source and stripping
its network-dependent subsystems rather than rewriting the trading logic
from scratch. The regime/direction/entry-quality/risk/exit engines are
byte-for-byte the same code already used in the live product — see
`STRATEGY_OVERVIEW.md` for what that means and does not mean for this
specific build's own testing record.

## Product identity

- Product name: **Claude XauCloud**
- File: `Claude_XauCloud.mq5` / `Claude_XauCloud.ex5`
- Version: **1.00**
- Magic number: **26080301**

## What it does not do (by design)

- No AI or machine-learning model is called at runtime. Not "AI disabled by
  default" — there is no code path left that reaches out to one for a live
  trading decision. See `FAQ.md` for why some input names and internal
  comments still say "AI" even though nothing calls out anywhere.
- No cloud backend, no telemetry, no remote command/kill-switch channel.
- No `WebRequest` URL whitelist entry is needed to run this EA — it makes
  zero outbound network calls.

## What it does

- Classifies market regime and direction from local closed-bar price
  action before ever considering a trade.
- Scores each candidate setup locally and grades it (A+/A/B) or skips it.
- Sizes every position from your account balance and a configured risk
  percentage against the real stop-loss distance — no martingale, no grid.
- Manages every open position with a local exit system (profit floors,
  trailing, partial take-profit).
- Keeps a local, disk-persisted record of its own recent closed trades on
  this installation and can use it to bias hold/exit decisions.
- Blocks entries around scheduled high-impact news using a local
  time-window calendar.

## Where to go next

- `INSTALLATION.md` — attach-and-run steps.
- `INPUTS_REFERENCE.md` — what each real input group controls.
- `STRATEGY_OVERVIEW.md` — the decision flow in plain language.
- `SYMBOL_COMPATIBILITY.md` — which gold symbols this is verified against.
- `RISK_DISCLOSURE.md` — read this before running on a live account.
- `KNOWN_LIMITATIONS.md` — honest, specific gaps in this exact build.
- `CHANGELOG.md` — the v1.00 release note.
- `FAQ.md` — common buyer questions.
- `SUPPORT.md` — how to get help.

## Honesty about testing scope

This build compiles clean (0 errors, 0 warnings). Its trading/risk/SL/exit
logic is unchanged from the source product's proven live code paths, but
this exact compiled build has not yet been run through a dedicated
Strategy Tester validation pass of its own. `KNOWN_LIMITATIONS.md` states
this plainly — it is not being papered over with a fabricated backtest
result.
