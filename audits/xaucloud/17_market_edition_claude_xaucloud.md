# Market Edition — "Claude XauCloud" standalone MetaTrader Market build

## Scope and branch

Branch: `market-edition/claude-xaucloud`, re-based from `XauCloud_m10_private_vps_ai`
@ `a518d7b` ("promote correct private-VPS-AI-relay build to
XauCloud_m10_private_vps_ai") per the owner's mid-task correction — the
branch's original base (`7f2c1f6`) was the wrong lineage. `main`,
`XauCloud_m10_private_vps_ai`, and `market/mql5-standalone-edition` are all
untouched by this work. Nothing was pushed to `origin`.

All work was done in a dedicated git worktree
(`/Users/libertyelectronics/XauAI-Sniper-market-edition-claude-xaucloud`)
because the shared checkout this task started in was found, mid-session, to
be actively used by another concurrent process that was switching branches
and committing to `XauCloud_m10_private_vps_ai` in real time. Isolating into
a fresh worktree avoided racing with that process.

## What was reused vs. re-derived

A prior session's branch, `market/mql5-standalone-edition` (tip `2eab761`,
2026-07-25, never merged), already built one full standalone Market edition
(`market_edition/release/XauCloud_Market_Edition.mq5`, 40,816 lines) with a
complete audit trail (`audits/market_edition/01-05_*.md`) and doc package.
That source was forked from an **older** base (`c8d195e`) — before
v6.25.25's owner-location hard-block, v6.25.28's extension floor/ratchet,
v6.25.30's Asia A+-only block, and before the entire private-VPS-AI-relay
feature existed — so it could not be reused directly.

**Reused:** the prior branch's *methodology* — its Phase 1 dependency map
(trace every `WebRequest` call site to its actual callers before deciding
removal vs. dead-code deletion), its Phase 2 architecture decision (fork the
production source rather than rewrite; delete confirmed-dead code outright;
strip network I/O from live functions while leaving their proven local
fallback as sole authority), and its Phase 4 compile method (the isolated
Wine sandbox at `/Users/libertyelectronics/XauAI-Sniper/tester_sandbox/MT5_Isolated/`,
entirely separate from the live Mac terminal and the production VPS).

**Re-derived from scratch:** every call-site classification, against the
current ~44,535-line source, because the file has changed substantially
since the prior branch's fork point (most importantly, it now contains a
"private VPS AI relay" subsystem — `XAU_LocalAISubmitM10`/`XAU_LocalAIPollM10`,
`InpLocalAIURL`, 3 new `WebRequest` sites — that did not exist before and
that the prior branch never analyzed).

## Full call-site inventory (30 `WebRequest` sites, up from the prior branch's 27)

`grep -c "WebRequest("` against the current source before any edits: **30**
(confirmed: `#import`, `ShellExecute`, and `dllcall`/`.dll` are all 0 —
no other network/external-process surface exists). The 3 new sites beyond
the prior branch's 27 are all inside the private-VPS-AI-relay subsystem
(`XAU_LocalAISubmitM10`/`XAU_LocalAIPollM10`, added by the "Add private VPS
AI relay for customer pure-M10 EAs" work).

| # | Subsystem | Live or dead code? | Action taken |
|---|---|---|---|
| 1 | AI Director entry confidence (`GetAIAnalysis`, `/api/ai/analyze`) + 7 `XAU_AIRecord*` helpers | **Dead code** — zero call sites anywhere in the file (verified by grep) | Deleted outright |
| 2 | Hive cross-account win-rate (`GetHiveVerdict`, `/api/ml/hive/score`) | **Dead code** — zero call sites | Deleted outright |
| 3 | DXY correlation (`GetDXYBias`, `/api/smart/dxy`) | **Dead code** — zero call sites | Deleted outright (`InpUseDXYFilter` input kept — still read by 2 harmless log lines) |
| 4 | Cloud news-check (`IsNewsSafe`, `/api/news/check`) | **Dead code** — zero call sites; `XAU_NewsAuthorityAllows()`, the local fallback it used to wrap, is already called directly at both real news gates elsewhere in the file | Deleted outright, local path untouched |
| 5 | AI exit-verdict override (`CheckPositionWithAI`, `/api/ai/manage-position`) | **Live** — 3 real call sites (`AIBlocksClose`, and 2 direct calls in the trade-management loop) | Network body stripped; function now returns the unmodified "no override" verdict unconditionally — identical to today's on-failure behavior. Local R-exit manager stays sole authority. Call sites untouched. |
| 6 | Cross-instance reservation lock (`XAU_ClaimDirectionReservation`/`Release`, `/api/cloud/reservation/*`) | **Live**, and **fails closed** — if the backend is unreachable, the trade does not send (an owner-requested safety property in the cloud product) | Made unconditionally local-only/always-succeed — same reasoning the file already uses for its own `MQLInfoInteger(MQL_TESTER)` bypass ("Strategy Tester is always a single, isolated instance … cross-instance reservation is structurally meaningless"), applied unconditionally since a standalone Market copy has no sibling terminal to race against. MT5's own local per-symbol/per-magic duplicate-position guard (`XAU_CanOpenDirectionLocalScanOnly`, unchanged) remains the real protection. **This is the one subsystem where "just gate it" would have been wrong** — see Flagged Decisions below. |
| 7 | Remote command channel / kill-switch (`BotMonitorPollCommands`, `BotMonitorAckCommand`, `/api/cloud/command/*`) | **Live** — polled every 10s from `OnTick`; commands include `PAUSE_NEW_TRADES`/`STOP_TRADING`/`CLOSE_ALL_TRADES`/`FORCE_CLOSE_TRADE`/`FORCE_OPEN_TRADE`/`MANUAL_OPEN_NOW`/`UPDATE_PROP_FIRM_CONFIG` | **Deleted completely** (both functions, and the `OnTick` timer block that polled them). This is the highest-risk surface for Market review — a remote party could open/close positions and change risk on a live account. `g_remotePauseNewTrades`/`g_remoteStopTrading` still exist as declared globals (default `false`) because ~9 scattered read sites reference them for status strings/log text and a genuine trading gate (`operationalHalted` in the entry arbiter); with the only writer deleted, they are now permanently `false` and dead code, but the identifiers themselves were not purged everywhere — see Flagged Decisions. |
| 8 | Copy-trading signal fanout (`CloudPostSignal`/`Close`/`Partial`, `CloudHeartbeat`, `FetchBotMode`, `/api/cloud/master/*`) | **Live** — 8 call sites; `FetchBotMode` in particular let a remote admin dashboard retune `grade`/`score-floor`/`context-TF`/`HTF-bias`/`adaptive-tighten` live | Network bodies stripped from all 5 functions (each now a safe no-op / returns `""`); call sites untouched. `InpCloudFanout` already defaulted `false`. |
| 9 | Command Center telemetry (`BotMonitorActivity`, `BotMonitorHeartbeat`, `BotMonitorDecisionEvent`, thesis-status push, `CloudPostReasoning`, `/api/ai/feedback`, `/api/ai/memory/record`, `/api/journal/log`, `/api/journal/weekly-report`, `/api/health`, `/api/ai/calibration`) | **Live** — dashboard-only pushes, confirmed no decision dependency | Network bodies stripped, function shells/call sites kept, all fall through to no-op |
| 10 | ML-pattern cloud sync (`SavePatterns`/`LoadPatterns` cloud halves, `/api/ml/patterns/*`) | **Live**, additive to local `.bin` persistence | Cloud half deleted; local `.bin` read/write (already-proven, existing code) is now the sole path — behavior matches today's "cloud unreachable" fallback exactly |
| 11 | Private VPS AI relay (`XAU_LocalAISubmitM10`/`XAU_LocalAIPollM10`, `/api/local-ai/*`) — **new since the prior branch** | **Live** — called from the real M10 entry-candidate path (`OnTick`, 2 call sites) and can veto or originate a candidate when "trusted" | Network bodies stripped; both functions now always report `LOCAL_AI_FALLBACK`/untrusted for live trading (the backtest/replay path, which is genuinely local — reads a `FILE_COMMON` cache, never the network — is untouched). Because a false/untrusted result is a pre-existing, proven no-op branch at both call sites, the deterministic M10 signal engine is completely unaffected. |
| 12 | Cloud PIN-licensing gate (`OnInit`, `ValidatePIN`) — not a `WebRequest` call, found during this pass, matches the prior branch's Phase 5 finding | **Live** — hard `INIT_FAILED` unless `InpLicensePIN` matches a fixed `ASE-XXXX-XXXX` format | Removed; `licenseValid` is now set `true` unconditionally at `OnInit`, so `licenseValid`'s later, genuine trading-gate read (`OnTick`, "LICENSE_INVALID" skip) can never fire. MQL5 Marketplace's own per-account activation replaces this for a Market product. |

Static compliance, re-checked against the final compiled source:
`grep -c "WebRequest("` → **0**. `#import` → 0. `ShellExecute` → 0.
`dllcall`/`.dll` → 0.

## Rebrand

- Filename: `market_edition/Claude_XauCloud.mq5` (also copied to
  `market_edition/release/Claude_XauCloud.mq5` alongside the compiled
  `.ex5`). MQL5 `.ex5` filenames cannot contain spaces, so the file uses an
  underscore; the MQL5 Market **listing/product name** — set in
  `#property description` and intended for the Market submission form — is
  the owner's exact instruction, "Claude XauCloud".
- `#property copyright`, `description` rewritten to name the product,
  disclose plainly that it has **no AI/LLM and no cloud dependency by
  design** (per the owner's "do not fake AI" instruction), and note it is a
  fork of the cloud XauCloud EA's proven local logic.
- `#property version` reset to `1.00` (independent of the cloud product's
  `v6.25.x` numbering — a different product, not a build of the same one).
- `InpMagicNumber` default changed from the cloud product's `20250401` to
  `26080301`, flagged in its own input comment for the owner to re-verify
  uniqueness before submission (see Flagged Decisions).
- `InpLicensePIN`'s input comment updated to say it is no longer a required
  gate.
- Production source (`XAUUSD_AI_Sniper_EA.mq5`) and `backend/` were **not**
  touched at any point.

## Compile result

Toolchain: `MetaEditor64.exe` under the pre-existing isolated Wine sandbox
at `/Users/libertyelectronics/XauAI-Sniper/tester_sandbox/MT5_Isolated/`
(same sandbox the prior `market/mql5-standalone-edition` branch used) —
entirely separate from the live Mac terminal
(`~/Library/Application Support/net.metaquotes.wine.metatrader5`) and the
production VPS. No live/production installation was touched.

```
WINEPREFIX="$HOME/.wine" wine MetaEditor64.exe \
  /compile:"MQL5\Experts\market_edition_claude_xaucloud\Claude_XauCloud.mq5" \
  /log:"compile_claude_xaucloud_v2.log" /portable
```

- v1: **0 errors, 1 warning** ("description is too long" — one `#property
  description` line exceeded MQL5's length limit).
- v2 (description lines split): **0 errors, 0 warnings**, 97,256 ms, `cpu='X64 Regular'`.

Final source: `market_edition/Claude_XauCloud.mq5`, 42,740 lines.
- Source SHA-256: `186fd45a0e2d0e739e78405de90de85b355b3e6e6a8abbbf45254a6189d8846f`
- Compiled `.ex5` SHA-256: `2caa126e5023eddad481e373504ee57e7df6b56a88520f108296b37b2d60ce2c`

Not done in this pass, for time reasons: the prior branch's Strategy
Tester real-tick run and byte-identical two-run determinism check (Phases
5/6 of `market/mql5-standalone-edition`). This build's trading/risk/SL/exit
code paths are byte-for-byte the same deterministic logic already proven
live in the cloud product — no new trading logic was written — but a fresh
Tester run against *this* exact build was not executed. Flagged below.

## Process note: a caught-and-fixed editing bug

The removal was done with a scripted, line-range text transform (44,535
lines is too large to hand-edit reliably) rather than one-by-one manual
edits. The first attempt had a real ordering bug — one deletion was applied
using a line number that had already shifted from an earlier edit — which
silently corrupted an unrelated 5-line region and left one dangling function
call. This was caught before compiling (via a written self-check that
verifies every edit's anchor text against the untouched source and enforces
strict descending-line-order application) and the source was regenerated
from a clean copy with the bug fixed. A second-pass manual review of every
individual edit site (all 30 network-removal sites plus the reservation,
kill-switch, and PIN-gate changes) then found and fixed 3 further one-line
brace/boundary mistakes (a missing `}` in the local-AI relay submit
function, a stray leftover comment line, and one extra `}` in the
cloud-reasoning function) before the file was ever sent to the compiler.
Stated here in full rather than only reporting the clean final compile,
since the point of this audit is to show the actual work, not just the
result.

## Flagged / uncertain decisions for the owner

1. **Cross-instance reservation lock → local-only-always-succeed.** This
   was the one subsystem where a simple "skip the network call" gate would
   have been actively wrong: the cloud claim call **fails closed** (no
   reachable backend ⇒ no trade), so gating it off naively would make this
   build never trade at all. Instead it was converted to always succeed
   locally, using the exact reasoning the file already applies to MQL5's
   own Strategy Tester. I'm confident this is correct for a **single**
   standalone installation. I did **not** invent any new protection for a
   customer who somehow runs two copies of this exact Market build against
   the same account on two machines — MT5's local per-symbol/per-magic
   duplicate-position guard still prevents literally opening two positions
   in the same direction, but the specific cross-instance *race* protection
   the cloud product has is gone by design in this build. Flagging this
   explicitly rather than asserting it's a non-issue.
2. **`g_remotePauseNewTrades`/`g_remoteStopTrading` identifiers still
   exist**, just permanently `false` and unwritable (the only writer,
   `BotMonitorPollCommands`, is deleted). I judged the ~9 remaining read
   sites (status strings, one real gate in the entry arbiter) not worth the
   additional edit risk this late in the pass, since they cannot be set
   true by anything in this build. If a byte-level "no trace of the
   identifier" audit is required for Market submission, these should be
   swept out in a follow-up pass.
3. **`InpMagicNumber` default (`26080301`)** was chosen to be obviously
   distinct from the cloud product's `20250401`, but I have not cross-
   checked it against every experiment-branch magic number this codebase
   has ever allocated (dozens of research branches exist). Owner should
   verify before Market submission.
4. **No Strategy Tester run against this exact build** (see Compile
   Result) — the prior branch's real-tick run is evidence for the same
   *class* of build, not this one. Recommend running one controlled-outage/
   real-tick pass before submission, same as the prior branch did.
5. **Doc package** (README/INSTALLATION/RISK_DISCLOSURE/etc. under
   `market_edition/docs/`) was **not** rebuilt in this pass — only the
   source file, its identity properties, and this audit. The prior
   branch's doc package (`market/mql5-standalone-edition`,
   `market_edition/docs/`) is a reusable template but references the old
   filename/product name and predates this build's feature set (no
   mention of the AI-relay's absence). Recommend adapting it before
   submission — it should explicitly disclose "no AI, deterministic engine
   only" per the owner's "do not fake AI" instruction, matching what this
   build's `#property description` already states.
6. **Input-panel cleanup** (grouping/removing now-fully-inert inputs like
   `InpServerURL`, `InpCloudURL`, `InpCloudAgentToken`, `InpCloudTimeoutMs`,
   `InpLocalAIURL`) was not done — these inputs remain visible but control
   nothing (every consumer's network body was stripped). Cosmetic, not a
   compliance issue, but worth a pass before a public listing.
