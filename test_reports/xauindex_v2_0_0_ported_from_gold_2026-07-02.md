# XauIndex v2.0.0 — Ported from gold v6.7.0–v6.9.0

Date: 2026-07-02
Scope: XauIndex (`XauIndex_EA_v1.0.mq5` → `v2.0.mq5`).

## Why a rebuild instead of a hand-patch

XauIndex forked from gold at what was then v6.7.0 (my Market Mode work), built on top of v6.5.0 — **before** Codex's No-Limit Trading Mode (v6.6.0/v6.6.1) existed on gold, and before all three of today's gold releases (v6.7.0 Adaptive Entry/Exit Arbiter, v6.8.0 Trade Recovery Intelligence, v6.9.0 Command Center fix). That's four versions of accumulated drift on a ~24,000-line file. Hand-patching that much drift line-by-line onto the old base risked subtle mistakes and merge conflicts with XauIndex's own Market Mode code.

Instead: copied the **current** gold v6.9.0 file as the new base (guaranteeing byte-for-byte identical trading logic to what gold just shipped and tested), then re-applied the Market Mode / Index-detection layer on top — the same input group, detection function, safety gate, symbol-agnostic lot engine, and diagnostics that existed in v1.0.0, unchanged in behavior.

## What XauIndex gains in this release

Everything gold shipped since the fork, all inherited exactly as built and tested on gold:
- **No-Limit Trading Mode** (default on, matches gold) and the loss-close firewall it depends on.
- **Adaptive Entry/Exit Arbiter**: SMC conflict penalty/hard-block, HTF trigger requirement, AI Committee B-grade block authority, adaptive Protected Peak Floor arming.
- **Trade Recovery Intelligence**: near-SL recovery classification (STRONG/WEAK/FAILED), smart re-entry after weak bailouts — same safety invariant (only ever closes at profit ≥ 0).
- **Command Center live-feed fix**: unconditional status heartbeat, per-position thesis data reaching the cloud, specific blocked-reason text, three-way would-enter-again verdict.

## What stayed the same

Gold Mode behavior on a live XAUUSD attachment is functionally identical to gold v6.9.0. Index Mode remains **monitoring-only** — `InpIndexModeLogOnly` still hard-blocks every index entry, unchanged from v1.0.0; no live index trading logic was added or enabled. The heartbeat's wrong-symbol warning now correctly stays silent in Index Mode (the fix that made this necessary already existed in v1.0.0; carried forward unchanged onto the new base).

## Versioning

Independently numbered from gold, as established: v1.0.0 → **v2.0.0** (major bump reflects the scale of what's inherited, not a step in gold's own numbering). Copyright/branding stays "XauIndex" — never confusable with XauAI Sniper on a customer's MT5 terminal.

## Testing

`tests/test_xauindex_v2_0_0_identity_static.py` — verifies independent versioning/branding, confirms every ported gold system (No-Limit Mode, Arbiter, TRI, Command Center fix) is present in the XauIndex source, and confirms the Market Mode layer (detection function, Index safety gate, symbol-agnostic lot engine, wrong-symbol heartbeat exemption) is intact. Compiled clean: 0 errors, 0 warnings. Full suite: **205/205 passed**.

## Note

While this port was in progress, gold moved to v6.10.0 via a concurrent update (not authored by me). This port covers v6.7.0–v6.9.0 as scoped — porting v6.10.0 would be a separate follow-up once its contents are known.
