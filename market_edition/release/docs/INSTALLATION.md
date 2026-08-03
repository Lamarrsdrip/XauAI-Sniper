# Installation

## 1. Copy the file

Copy `XauCloud.ex5` (the compiled binary — this is what most buyers
will receive) into your terminal's `MQL5/Experts/` folder. If you have the
`.mq5` source instead, open it in MetaEditor and compile (Compile button
or F7); a clean compile reports "0 errors, 0 warnings."

To find your terminal's data folder: in MetaTrader 5, File → Open Data
Folder, then navigate to `MQL5/Experts/`.

## 2. Attach to a chart

Open an **XAUUSD** chart (or whatever your broker calls its gold
instrument — see `SYMBOL_COMPATIBILITY.md`). The EA's own signal engine
runs on the M10 (10-minute) timeframe internally regardless of which chart
timeframe you have open, but attaching to an M10 chart is recommended so
what you see on screen matches what the EA is deciding from. Drag the EA
onto the chart from the Navigator panel.

## 3. Enable Algo Trading

Two switches must both be on:
- The terminal-wide "Algo Trading" toolbar button (top toolbar) — must be
  green.
- In the EA's own properties dialog, **Common** tab: "Allow Algo Trading."

If either is off, the EA runs but will not place trades.

## 4. No WebRequest whitelist needed

This build makes **zero outbound network calls**. You do not need to add
anything under Tools → Options → Expert Advisors → "Allow WebRequest for
listed URL" for this EA to function. This is a genuine property of this
build, not a claim — see `audits/xaucloud/17_market_edition_claude_xaucloud.md`
in the source repository for the full removal record if you want to
verify it yourself.

Note: several inputs left over from the source product still show a URL
field (e.g. `InpCloudURL`, `InpLocalAIURL`, `InpServerURL`). These are
inert — nothing in this build reads them to make a network call. See
`KNOWN_LIMITATIONS.md` and `INPUTS_REFERENCE.md`.

## 5. Inputs to check before your first run

Before enabling live trading, review at minimum:
- `InpMagicNumber` (default `26080301`) — if you run other EAs on the same
  account, confirm this doesn't collide with another EA's magic number.
- `InpNormalRiskPct` (default `10.0`) — the risk percentage target for
  every fully-qualified trade. Set this to a level appropriate for your
  own risk tolerance before running on a live account; see
  `RISK_DISCLOSURE.md`.
- `InpAccountMode` / `InpTradeMode` — the account risk preset and blocker
  strictness profile.
- `InpMaxSpread` — the spread ceiling (in points) above which entries are
  blocked; confirm it's sensible for your broker's typical XAUUSD spread.
- `InpBacktestMode` — leave `false` for live/demo chart use; only set
  `true` inside Strategy Tester.

Full detail on every input group is in `INPUTS_REFERENCE.md`.

## 6. Confirm it's running

Check the **Experts** log tab. Within the first cycle you should see a
startup block reporting your account, detected symbol, and spread/settings
checks, followed by periodic status lines (e.g. scanning/managing/idle
with a reason). An "idle" status with a stated reason is normal — it means
no qualifying setup exists right now, not that something is broken.

## Uninstalling

Remove the EA from the chart, then delete the `.ex5`/`.mq5` from
`MQL5/Experts/`. This EA persists its local trade-memory/state files
(prefixed `XAUAI_`, `AIS_Patterns_*`, etc.) to the terminal's shared
**Common\Files** folder (`FILE_COMMON` — the folder shared across every
terminal installation on your machine, not the per-terminal `MQL5/Files/`
folder). To find it: File → Open Data Folder in MetaTrader, then go up one
level to `Common\Files`. These files are yours to keep or delete; deleting
them resets the EA's local trade-memory to a fresh start.
