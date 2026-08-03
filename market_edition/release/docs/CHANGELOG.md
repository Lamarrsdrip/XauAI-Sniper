# Changelog

## 1.00 — Initial Market release

Forked from the XauCloud cloud-connected production EA's proven local
trading logic. This release removes every AI/LLM call, cloud backend
dependency, and remote-control surface from that source, for MQL5 Market
compliance and fully self-contained, no-internet-dependency operation.
Full removal record: `audits/xaucloud/17_market_edition_claude_xaucloud.md`
in the source repository.

**Removed (zero outbound network calls remain — confirmed by static
sweep: `WebRequest`, `#import`, `ShellExecute`, and `.dll` calls all
count 0 in the final compiled source):**

- AI Director entry-confidence system, Hive cross-account win-rate
  lookup, and DXY correlation filter — all confirmed dead code in the
  source at fork time (never actually called), deleted outright.
- Cloud news-check network call — the local news-safety fallback it
  wrapped is now the sole path (was already the only path that mattered
  on any network failure).
- AI exit-verdict override — the local exit manager is now the sole
  authority on every position close.
- Cross-instance reservation lock — converted to a local-only,
  always-succeed equivalent appropriate for a single standalone
  installation. See `KNOWN_LIMITATIONS.md` for what this does and does
  not protect against.
- Remote command channel / kill-switch (pause/stop/close/force-open
  commands from a remote dashboard) — removed completely. Nothing outside
  this chart can pause, stop, or force a trade in this build.
- Copy-trading signal fanout and Command Center telemetry — network
  bodies stripped; nothing is sent anywhere.
- Cloud half of the ML-pattern sync — local disk persistence kept as the
  sole path.
- Cloud PIN-format licensing gate — removed; MQL5 Marketplace's own
  per-account activation replaces it for this build.
- Private VPS AI relay (local M10 entry submission/poll to an external
  inference service) — network bodies stripped; the deterministic local
  M10 engine is now the only path for these decisions (a previously
  proven no-op fallback branch at both call sites).

**Kept unchanged (already local, already proven in the source product):**

- Market regime, direction, entry-quality, risk-sizing, trade-management,
  and exit engines.
- Local trade-memory ("trade history") engine and its disk persistence.
- Local news-safety authority.
- Local owner-location structural filters.

**Identity for this release:**

- Product name: XauCloud
- Version: `1.00` (independent of the source product's own internal
  version numbering)
- Magic number: `26080301`
- File: `XauCloud.mq5` / `XauCloud.ex5`

**Not done in this release** (see `KNOWN_LIMITATIONS.md`): no dedicated
Strategy Tester validation run of this exact compiled build; inert legacy
inputs (former cloud/AI URLs, tokens, toggles) remain visible in the input
panel rather than being removed, since they no longer affect trading
behavior and removing them was judged a cosmetic cleanup rather than a
compliance necessity for this release.
