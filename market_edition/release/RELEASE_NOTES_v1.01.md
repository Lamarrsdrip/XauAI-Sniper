# Claude XauCloud — MQL5 Market Edition v1.01

**First public release candidate.** v1.00 was built and compiled but never submitted to the Market. This is a fresh build re-derived directly from current XauCloud production (v6.27.2) rather than an update to v1.00, so it is described here as the initial release.

## What this build is

A standalone, self-contained Gold (XAUUSD) Expert Advisor for MetaTrader 5. Deterministic local signal, risk, and trade-management engine — no AI/LLM calls, no cloud backend, no remote control channel, no network use of any kind. Forked from the XauCloud production EA's proven local logic; trading, risk, stop-loss, and exit behavior match the same deterministic path already used in the cloud product's offline/no-connectivity fallback.

## Highlights

- Synchronized core trading behavior with current XauCloud production: entry filtering, cooldown handling, stop-loss construction, and trade management match the live engine's local decision path.
- Broker Gold-symbol suffix support (XAUUSD, XAUUSDm, XAUUSD.a, XAUUSDpro and similar) via dynamic symbol-info lookups — Gold-only, unrelated symbols are rejected.
- No external connectivity of any kind: no WebRequest calls, no DLL imports, no shell/process execution. Verified statically (0 network call sites) and by a clean compile.
- Per-account MQL5 Marketplace activation (no license key entry, no server-side gate).
- Local per-symbol/per-magic duplicate-position protection remains active, as in the production engine.

## What's different from the cloud product (by design)

- No AI/LLM-based entry or exit override — this build never had one to begin with; the cloud product's AI-advisory layer, when present, never overrides the local engine's decisions either, so behavior is unchanged either way.
- No remote monitoring, remote pause/stop, or copy-trading signal relay — this is a fully standalone installation with no server dependency.
- No cross-installation trade-reservation coordination — MT5's own local duplicate-position guard remains the protection on a single installation; running the same account from two separate copies of this EA is not separately protected against.
- The Outlook "missed-entry recovery" feature present in the cloud product depends on a remote command feed and is not present in this standalone build.

## Compliance

Compiled clean: 0 errors, 0 warnings. No WebRequest, no `#import`, no ShellExecute, no DLL/dllcall calls anywhere in the source, independently re-verified after compilation.

## Known limitations (disclosed, not hidden)

- No fresh Strategy Tester backtest has been run against this exact compiled build yet — recommended before submission.
- Running two installations of this EA against the same account on two separate machines is not protected against a duplicate order race the way the cloud product is.

## Risk disclosure

Trading Gold (XAUUSD) with any automated system carries risk of loss. No trading system can guarantee profit. Past behavior of the underlying logic in the cloud product is not a guarantee of future results. Use a demo account first and verify broker execution before trading live.
