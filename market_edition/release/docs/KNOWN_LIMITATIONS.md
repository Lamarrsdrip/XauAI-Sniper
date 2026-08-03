# Known Limitations

Stated plainly and specifically, rather than left implicit.

## No AI — by design, not a missing feature

This build makes zero AI/LLM/machine-learning calls. That is intentional
— it was forked from a cloud product that did call an external AI/LLM
service for some decisions, and every one of those call sites has had its
network body removed so it always falls through to the same deterministic
local logic the product already used as its fallback. This is a design
choice for MQL5 Market compliance and self-contained operation, not an
oversight. See `README.md` and `FAQ.md`.

## No cross-instance protection if run twice on the same account

If you run this exact EA on the same trading account from two different
machines or terminals at the same time, there is **no cross-instance
coordination between them** in this build. The source product this was
forked from had a cloud-based reservation lock specifically to prevent two
instances from racing each other; that lock has been converted to an
always-local, always-succeed equivalent appropriate for a single
standalone installation, and the cross-instance race protection itself is
gone by design. MT5's own local per-symbol/per-magic duplicate-position
guard still prevents literally opening two positions in the same direction
on the same terminal, but it does not protect against two separate
terminals racing each other for the same account. Run one instance per
account.

## No fresh Strategy Tester validation of this exact build

The regime/direction/entry-quality/risk/exit logic in this file is
unchanged from the source product's proven, live-traded code paths — no
new trading logic was written for this fork. However, this specific
compiled build (`XauCloud.ex5`, magic number `26080301`, version
`1.00`) has not yet had its own dedicated Strategy Tester real-tick
validation run performed against it. Recommend running your own
controlled Strategy Tester session on your broker's XAUUSD feed, and
demo-testing, before trading live. See `RISK_DISCLOSURE.md`.

## Inert legacy inputs still visible in the input panel

A number of inputs inherited from the source cloud product remain visible
in the MetaTrader Inputs tab but control nothing in this build, because
the network-calling code they used to configure has been removed. This is
a cosmetic issue, not a compliance or functional one — none of these
inputs cause a network call or affect trading behavior regardless of how
they're set. Notable examples:

- `InpServerURL`, `InpCloudURL`, `InpCloudAgentToken`, `InpCloudTimeoutMs`,
  `InpCloudFanout`, `InpBotMonitorEnable`, `InpBotMonitorHeartbeatSec` —
  former Command Center / cloud-fanout configuration.
- `InpLocalAIURL`, `InpLocalAIEnabled`, `InpLocalAIModel`,
  `InpLocalAIConfidenceThreshold`, `InpLocalAISubmitTimeoutMs` — former
  private-VPS AI relay configuration (the local *replay-cache* inputs,
  `InpLocalAIReplayCacheEnabled` and related, are a genuine offline
  Strategy Tester feature and are not affected by this).
- `InpUseAI`, `InpAIMode`, `InpAIAdvisoryOnly`, `InpAIDirectorAllGrades`,
  `InpAIDirectorMinConf`, `InpAICostDailyCallLimit`,
  `InpAIMinEntryCallSec`, and related "AI Director"/"AI Trading Committee"
  inputs — these configure a decision layer whose network path has been
  removed; they no longer affect trades regardless of their setting.
- `InpLicensePIN` — no longer a required gate; MQL5 Marketplace's own
  per-account activation replaces it for this build.

If a future revision cleans these out of the panel entirely, this file
will be updated accordingly.

## Inherited from a large, mature codebase

This is a large codebase (tens of thousands of lines) carrying its own
multi-year internal history — group headers and comments referencing
version tags like "v6.3.0" or "v6.25.28" describe the history of the
source cloud product this was forked from, not this edition's own
versioning (`1.00`).

## Not a general-purpose gold-adjacent-symbol EA

The decision engines were tuned specifically against XAUUSD. See
`SYMBOL_COMPATIBILITY.md` — other symbols are not a supported use case
even where the symbol-name check alone would not block attachment.

## Single-installation trade memory

The local trade-memory engine is scoped to one installation's local
files. If you run this EA on multiple accounts or terminals, each builds
its own independent memory — there is no synchronization between them (by
design, consistent with there being no cloud backend at all in this
build).
