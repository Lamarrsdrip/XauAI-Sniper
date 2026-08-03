# Inputs Reference

This EA has 883 individual inputs across 77 named groups (visible in
MetaTrader's Inputs tab, each group collapsible). Every input already
carries an inline comment in the source directly explaining what it does
and its default — that comment is the authoritative reference. This
document is a map to find your way around and a plain-language summary of
the inputs most people actually need to touch, not a duplicate of all 883.

Some group headers carry a version tag (e.g. "v6.4.21") — that names the
internal version of the source product when that feature was added, not
this edition's own version (`1.00`). It's kept because it's how the
source's own extensive internal history refers to each feature.

## Inputs most people actually need to touch

| Input | Group | What it does | Default |
|---|---|---|---|
| `InpMagicNumber` | SAFETY | Identifies this EA's own trades — change if it collides with another EA on the same account. | `26080301` |
| `InpNormalRiskPct` | ACCOUNT-RELATIVE GROWTH SIZING | The risk-percentage target for every fully-qualified trade, applied against the real stop-loss distance. The single risk authority — no other subsystem may size a valid trade below it. | `10.0` |
| `InpAccountMode` | ACCOUNT MODE | One-input preset: Balanced / Conservative / Aggressive risk profile. | `ACCT_BALANCED` |
| `InpTradeMode` | TRADE MODE | Blocker strictness profile — how conservative the entry gates are (Safe / Balanced / Aggressive-growth). | `BALANCED_MODE` |
| `InpGradeAPlus` / `InpGradeA` / `InpGradeB` | TUNABLE THRESHOLDS | Combined-score cutoffs that assign each grade label. | `5.5` / `4.0` / `3.0` |
| `InpUseNewsFilter` | SMART FEATURES | Hard-blocks entries around scheduled high-impact news (±10 min default). | `true` |
| `InpMaxSpread` | SAFETY | Entries are blocked when current spread exceeds this value, in points. | `400.0` |
| `InpBacktestMode` | SMART FEATURES | Set `true` only inside Strategy Tester. | `false` |
| `InpResetML` | SMART FEATURES | Wipes local trade-memory/pattern history on next attach — fresh start. | `false` |
| `InpDailyLossLimit` | ACCOUNT-RELATIVE GROWTH SIZING | Daily loss % that triggers a reduced-risk recovery mode (grade-only, half-size). Set `0` to disable. The EA never force-pauses on this alone. | `3.0` |
| `InpStartupIntelSync` | ADAPTIVE MARKET TRANSITION CONTEXT | Recovers local memory, open positions, and chart context on attach/restart before allowing fresh entries. | `true` |

Everything else is a tuning knob for a specific subsystem (trailing,
pyramiding, partial take-profit, giveback protection, news-aftermath
timing, owner-location structural checks, etc.) — the group header in the
Inputs tab names the subsystem each block belongs to, and
`STRATEGY_OVERVIEW.md` maps the top-level decision flow those subsystems
support.

## Inputs that no longer do anything (network removed)

These remain visible in the input panel but control nothing in this
build, because the network-calling code they used to configure has been
stripped. See `KNOWN_LIMITATIONS.md` for the full explanation and list —
they are harmless to leave at their defaults.

- **XAU COMMAND CENTER** group: `InpCloudFanout`, `InpCloudURL`,
  `InpCloudAgentToken`, `InpCloudTimeoutMs`, `InpCloudOfflineFailThreshold`,
  `InpBotMonitorEnable`, `InpBotMonitorHeartbeatSec`.
- **PRIVATE VPS AI — PURE M10** group: `InpLocalAIEnabled`,
  `InpLocalAIURL`, `InpLocalAIModel`, `InpLocalAIConfidenceThreshold`,
  `InpLocalAISubmitTimeoutMs`. (Note: `InpLocalAIReplayCacheEnabled`,
  `InpLocalAIReplayCollectMissing`, and their file-name inputs are a
  genuine *offline* Strategy Tester replay-cache feature — local file
  reads only, never a network call — and are unaffected.)
- **AI DIRECTOR** group: `InpUseAI`, `InpAIMode`, `InpAIAdvisoryOnly`,
  `InpAIDirectorAllGrades`, `InpAIDirectorMinConf`, `InpAIOfflineSafeMode`,
  `InpAIOfflineMaxFails`, `InpAICostDailyCallLimit`,
  `InpAIMinEntryCallSec`, `InpAIMarketStateCacheSec`,
  `InpAIOnlyHighImpact`, `InpAIMinGradeForLLM`, `InpAICostPer1KTokensUSD`,
  `InpAISLTPMode`.
- **RISK/SMART FILTERS**: `InpUseDXYFilter` (the DXY correlation lookup it
  once queried remotely is dead code even in the source product; this
  input is only read by log-text lines now).
- **LICENSE** group: `InpLicensePIN` — no longer a required gate; MQL5
  Marketplace's own per-account activation handles licensing for this
  build.
- `InpServerURL` (SMART FEATURES group) — a legacy base-URL field, unused.

## Inputs removed entirely from this edition

Inputs that existed *only* to configure network behavior that has since
been deleted outright (rather than merely defaulted off) — for example
the cloud PIN-format validation parameters and the remote kill-switch
command polling cadence — are gone from this build's input panel
entirely. See `CHANGELOG.md` for the full removal list at the subsystem
level.

## Full group list

```
LICENSE
RISK (Gate 4)
PRESERVATION MODE
ACCOUNT MODE
TRADE MODE
ADAPTIVE MARKET TRANSITION CONTEXT
AI AUTHORITY MODE
LOT SIZING MODE
NO-LIMIT TRADING MODE
PROFIT GUARDIAN
EQUITY PRESERVATION FRAMEWORK
EXIT INTELLIGENCE GATE
AI TRADING COMMITTEE
NEWS AFTERMATH FILTER
SCHEDULED NEWS CALENDAR
SMC ENTRY LAYER
XAU FAST CONFIRMATION
M5 ENTRY DELAY, PHASE B
XAU ENTRY TIMING GUARD
XAU CYCLE GIVEBACK ARMOR
TP AUTO-EXTEND
ENTRY QUALITY GUARD
ACCOUNT-RELATIVE GROWTH SIZING
MARGIN VERIFICATION
EQUITY GROWTH GUARD
THESIS HOLD RUNNER
STRATEGY
CONTEXT ENGINE
AI DIRECTOR
PRIVATE VPS AI — PURE M10
XAU COMMAND CENTER
TUNABLE THRESHOLDS
RE-ENTRY ENGINE
SMART FILTERS
SMART FEATURES (secondary)
CONVICTION-WEIGHTED SIZING
TRAILING / BE LOCK
TREND-AWARE TRAIL
CONVICTION RUNNER
PARTIAL TAKE-PROFIT
PROFIT LADDER
PEAK-LOCK BACKSTOP
MANAGEMENT MODE
PROFIT RATCHET
BASKET PROTECT
ADAPTIVE RUNNER (legacy)
TREND HOLD MODE
CLEAN EXITS
VOLATILITY LOT CAP
GOLD PULLBACK SURVIVAL
EXPECTANCY LOSS ARMOR
A+ PROFIT SHIELD
ADAPTIVE MOMENTUM PROFIT LOCK — AMPL
PROTECTED PEAK PROFIT FLOOR
EXIT ARM R-FLOOR
PROFIT QUALITY GATE
R-BASED EXIT MANAGER
GENERAL 10M EXTENSION PROTECTION
SMART EXIT 3-LAYER SYSTEM
PROBABILITY EV EXIT ENGINE
ADAPTIVE EXIT MEMORY, PHASE A
TRADE LIFECYCLE MANAGER
LET TRADES BREATHE — EARLY LOSS EXIT PROTECTION
AI EXIT BRAIN
AUTO-SCALE
VOLATILITY-ADAPTIVE LOT SIZING
SAFETY
COUNTER-EXCURSION CAPTURE (experimental, demo-only)
LOSS PROTECTION
PYRAMID / SCALE-IN
SMART GUARD
ANTI-REPEAT-LOSS GUARD
SCAN WATCHDOG
POST-WINNER ENTRY GUARD
STRATEGIC TREND INTELLIGENCE
TRADE THESIS MONITOR
TRADE RECOVERY INTELLIGENCE — TRI
```

Group names are copied from the actual source's `input group` headers.
Some carry internal codenames (e.g. "AI Trading Committee," "AI Exit
Brain," "AI Authority Mode") inherited from the source product — despite
the naming, none of these call an external AI model in this build; they
are local rule-based logic whose network paths (where they ever existed)
have been removed. See `FAQ.md`.
