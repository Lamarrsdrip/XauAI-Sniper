# XauAI Sniper v6.23.0 — Production Forensic Audit

Date: 2026-07-14

Scope: production `main` only; VPS `173.212.249.202` is the sole live MT5 host.

Baseline: `02b08936275eb79892a3211dafe2cd18493a391f` (`origin/main`).

Audit branch: `audit/main-production-forensic-v6.23.0`.

## Executive outcome

The production source was isolated from the Mac experiment, audited, repaired, versioned as v6.23.0, compiled from the exact canonical source, and regression-tested. The VPS was inspected read-only to establish the real running baseline. Nothing was copied to, attached on, or restarted on the VPS; the owner will deploy manually.

The highest-risk live defect was confirmed from VPS evidence: v6.21.3 could round a raw full-risk lot upward (for example, 0.7977 to 0.80), producing actual risk above the configured 15%. The same sizing path could also silently reduce a normal entry through multiple independent caps. v6.23.0 replaces that behavior with a binary contract: calculate the configured normal risk using final broker-valid SL geometry, floor to the volume step, and either send that exact risk-approved volume or block with a named reason.

## Verification levels

| Area | Verification | Result |
|---|---|---|
| Source identity | Canonical/download-mirror byte comparison | Identical, SHA-256 `20eb7570e7d3e413c9872cb97dfff505861641334e9b519a8cb3c93ea0424908` |
| MQL5 syntax/build | Exact canonical v6.23.0 MetaEditor compile | 0 errors, 0 warnings |
| Binary identity | EX5 hash and byte size | `06a313171bd2766c18a02ee92e3a295e398686599ced6666fe7b51c6c2d33e03`, 1,343,460 bytes |
| Behavioral model | Deterministic pytest scenarios | $2k/$3k/$10k/$100k, varied tick values/SL widths, lot step/min/max/margin/aggregate constraints |
| Current release static wiring | v6.23.0 plus updated v6.21.3 regression tests | 102 passed |
| Release labels/metadata | Backend/frontend static tests | 7 passed |
| Backend syntax | `py_compile` | Passed |
| Frontend bundle | `npm run build` | Repository checkout has no installed dependencies; reusing the main worktree's incomplete/incompatible tree reached compilation but could not resolve `react-dom/client`. Label tests passed. |
| Full historical suite | Before/after comparison | Baseline 208 failed/756 passed; final 208 failed/789 passed. Failure count is unchanged and 33 tests were added/passed. Remaining failures are historical version-pinned assertions, not newly introduced runtime regressions. |
| Live production | VPS logs/files/processes | Read-only evidence only; v6.23.0 was not deployed or attached |

## Runtime ownership and call order

The critical tick order in `OnTick()` is:

1. True account-safety/weekend checks may close exposure.
2. `XAU_RExitCoreLoop()` manages normal positions unconditionally before later early returns.
3. Counter shadow outcomes are observational only.
4. Ordinary legacy basket/giveback managers are observation-only where the R manager owns normal positions.
5. `ManagePositions()` handles non-R legacy per-position concerns for the normal magic.
6. `XAU_ManageCounterExcursionPosition()` handles only the dedicated counter magic.
7. Re-entry and pyramid watchers run independently.
8. Pending opportunity recovery and `ScoreSetups()` feed the normal timing/entry path.

| Function | Location | Owner / audited responsibility |
|---|---:|---|
| `OnInit` | 7589 | Startup reconciliation, state loading, timers, version/config reporting |
| `OnTimer` | 8029 | Wall-clock duties independent of M5 ticks |
| `CheckReEntryOpportunity` | 8778 | One re-entry candidate routed through shared entry timing and normal sizing |
| `ScoreSetups` | 10359 | Deterministic normal signal scoring |
| `CheckPyramidOpportunity` | 11228 | Add eligibility and actual-fill R-state capture |
| `OnTick` | 12860 | Critical orchestration and exit-before-entry ordering |
| `XAU_NormalizeVolumeForRisk` | 15772 | Floor-only broker-step normalization |
| `XAU_ReconcileFinalRisk` | 15877 | Full-risk-or-block invariant for `ENTRY:`; legacy reduction retained only for non-normal paths |
| `OpenTrade` | 16510 | Final SL geometry, risk calculation, constraints, margin proof, send, actual-fill capture |
| `ManageBasket` | 18252 | Legacy basket protection without stealing R-owned normal exits |
| `SafePositionClose` | 20465 | Broker close wrapper and result logging |
| `XAU_RExitCoreLoop` | 21183 | Primary normal-position R lifecycle and close retries |
| `ManagePositions` | 21408 | Per-position legacy management, magic-filtered |
| `OnTradeTransaction` | 23707 | Actual-deal lifecycle cleanup/reconciliation |
| `CloseAll` | 24190 | Explicit normal-magic emergency/command closure |
| `XAU_CheckPendingOpportunityRecovery` | 27249 | Wall-clock candidate recovery/revalidation |
| `XAU_RequestCounterExcursionClose` | 27733 | Persistent counter close request/retry/confirmation |
| `XAU_TryCounterExcursionEntry` | 28125 | Hedging-only counter execution with dedicated magic/risk |
| `XAU_ManageCounterExcursionPosition` | 28425 | Counter-only R/hold/protection/exit owner |
| `XAU_CounterExcursionEmergencyClose` | 28563 | Counter coverage for true account-wide emergencies |
| `XAUEntryTimingGuard` | 29405 | Shared bounded 120–180 second wall-clock timing contract |

## Findings and repairs

### Normal-entry risk

- Removed every silent normal-risk reducer: prop-firm per-trade cap, broker maximum, configured maximum lots, reference-equity cap, aggregate open-risk room, and margin decrement loop now block with explicit reason codes when they cannot fund the configured risk.
- Retired the 12% upward lot-step overshoot tolerance. Volume normalization floors only.
- Added `FULL_RISK_BINARY_INVARIANT` immediately before order submission. The final lot must equal the floor-normalized risk-math lot and actual money risk cannot exceed requested money risk.
- Added audit logging with reference balance, live equity, requested/actual risk money, actual percentage, margin requirement, free margin, raw lots, normalized lots, and lot step.
- Final broker-valid SL distance is calculated before lot sizing. Stop/freeze geometry cannot silently change risk after the calculation.
- AI output is restored to the deterministic pre-AI sizing multiplier at the advisory boundary. AI disagreement and low confidence can explain or warn, but cannot reduce an approved normal entry.
- A zero/near-zero combined-quality multiplier blocks rather than creating a token-size order.

### Timing and candidate identity

- The shared timing engine remains wall-clock based with a hard production range of 120–180 seconds (150-second default), not “next M5 bar.”
- Pending candidates retain identity and are revalidated; late/chased candidates are blocked.
- Pending-opportunity logging now states the wall-clock due time rather than falsely promising the next M5 bar.
- Restart can discard a not-yet-open in-memory candidate. This can miss an opportunity but cannot leave exposure unmanaged or produce an unintended order, so it is a documented low-risk availability limitation rather than a release blocker.

### Counter excursion

- Removed the coupling that blocked normal entry merely because a counter position was active.
- Counter execution is allowed only on hedging accounts. Netting accounts log `NETTING_UNSUPPORTED_INDEPENDENT_MAGIC` and leave the normal path unchanged, avoiding false separate-magic assumptions.
- Close requests retain the original reason, rescan broker state by symbol+counter magic, retry no faster than every three seconds, and clear active state only after broker absence confirms closure.
- Restart reconciliation adopts a live counter position from broker state.
- Counter SL modification uses the shared safe modification wrapper.
- Normal `CloseAll()` deliberately filters the normal magic; true account-level emergencies call the separate counter emergency closer as well.

### R-based normal exits

- The R core remains ahead of indicator warm-up, basket, and other early-return paths.
- Position identifier is the persistent identity; live ticket is used only for broker operations.
- Original risk uses actual fill/open/SL/volume and accumulates netting adds in its denominator.
- Peak R and giveback are evaluated by the R owner; broker SL/TP remain broker-side protection/target, not a competing software close owner.
- Pending closes are retried and `OnTradeTransaction` reconciles actual exit deals.

### State isolation

Shared files and relevant terminal GlobalVariables now use an account-login + sanitized server + symbol + normal-magic scope. This covers strategy weights, TRI/TradeBrain memories, blocked/executed/timing/quality telemetry, reports, heartbeat/cloud map, loss streak, and entry locks. The v6.23.0 scope intentionally starts fresh rather than importing ambiguous unscoped history.

This scope isolates accounts/servers/symbols/magics within a terminal common-data area. A terminal GlobalVariable cannot coordinate two physically separate MT5 terminals. That is acceptable for the declared production topology—only the VPS terminal is production—but it must not be represented as a cross-machine lock.

## Production evidence and boundary

The VPS is Windows Server 2022 and runs MetaTrader 5 from `C:\Program Files\MetaTrader 5\terminal64.exe`. Its production data directory is `C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075`. Read-only inspection found the existing v6.21.3 source/binary and journal evidence that v6.21.3 is attached to the broker-suffixed gold M5 chart. No credentials are included in this report.

The VPS files, terminal process, charts, and EA attachment were not changed. The Mac MT5 and its adaptive-trend experiment were not changed. v6.23.0 must be installed and attached manually by the owner.

## Manual deployment guardrails

Before attachment, verify the EX5 SHA-256 is `06a313171bd2766c18a02ee92e3a295e398686599ced6666fe7b51c6c2d33e03`. Preserve the existing v6.21.3 EX5 as rollback. Attach only one normal production instance for the intended account/symbol/magic, confirm Algo Trading permissions, then inspect the Experts journal for the exact v6.23.0 build marker and `FULL_RISK_BINARY_VALIDATED`/named block logs before allowing a live entry.

Do not attach the counter strategy on a netting account expecting independent exposure; v6.23.0 will intentionally refuse that counter entry while keeping normal trading available.
