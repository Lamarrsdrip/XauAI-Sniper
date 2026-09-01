# XAU AI Sniper v6.4.25 — Phase 1: Four Audit-Proven Exit Defects

Date: 2026-07-01
Source of the four defects: the full ecosystem audit (`FULL FABLE ARCHITECTURE AUDIT` pass, same date), which cross-referenced the EA source against 8 days of live MT5 journals (2026-06-24 through 2026-07-01) and all prior forensic reports.

This release fixes ONLY the four CRITICAL/HIGH defects the audit proved with live-log evidence. Per the staged release plan, Phase 2 (Growth Guard/June-mode reconciliation, AI fallback confidence, remaining mechanical basket exits), Phase 3 (data cleanup + calibration), Phase 4 (unified Exit Arbiter), and Phase 5 (platform cleanup) are explicitly out of scope for this version.

## Why this release does not add a fear layer or weaken profit growth

Every change below either (a) removes a signal that was fabricated/miscalibrated and was never real market evidence, or (b) unblocks a partial-bank path that was already designed and intended to run, but was silently disabled by an unrelated default. None of the four changes:
- adds a new protective/veto layer,
- makes any entry stricter,
- reduces any lot size,
- reintroduces B-grade blocking,
- reduces trade frequency.

In every case the net effect is the EA holding trades it was previously closing on bad information — i.e., strictly in the direction of "let it breathe," not "protect more."

## Bug #1 (CRITICAL) — Phantom basket peak reconstruction

**Defect:** `XAU_ReconstructOpenBasketPeakUSD()` used the current, still-forming M5 bar's high/low as a "proven peak," even for a position opened seconds earlier. That bar's range can include price action from BEFORE the position existed.

**Live evidence:** two same-day trades reconstructed `peak=$78.96` and `peak=$126.42` on positions ~1-2 seconds old with `bestFloating=$0.00` per TradeBrain, then got force-closed on "giveback" from a peak that never existed (`CLOSED: LOSS $-1.26` and `$-2.10`).

**Fix (`XAUUSD_AI_Sniper_EA_v6.4.25.mq5`, `XAU_ReconstructOpenBasketPeakUSD`, ~line 12105-12140):** reject reconstruction when `iBarShift(...) <= 0` (the position opened during the still-forming bar); only copy CLOSED bars (shift 1 onward) once a full bar has passed since entry. A position younger than one M5 bar now gets no fabricated peak — live per-tick tracking (`if(totalPnL > g_basketPeakUSD) g_basketPeakUSD = totalPnL;`) picks up the real peak organically from there.

## Bug #2 (CRITICAL) — Structure gate tested absolute opposition, not a flip

**Defect:** `XAU_BasketStructureBroken()` treated a BOS/HTF state that was already against the position AT ENTRY as "confirmed invalidation" — but the entry layer explicitly allows entries against a standing BOS (`InpSMC_OppPenalty`: "reserved, not applied — BOS opposition is log-only"). Replayed against the flagship v6.4.22 incident (a sell entered with `BOS=+1` against it), the gate would have returned ALLOWED and the same panic close would repeat.

**Fix (~line 2437-2444, 12190-12210, 12386-12394):** added `g_basketEntryBOS`/`g_basketEntryHTF`, captured once when a basket cycle first has positions (mirroring how TTM already snapshots `entryBOS`/`entryHTF` per ticket). `XAU_BasketStructureBroken()` now requires an actual FLIP since that snapshot (`g_smc_bos_dir == -g_basketEntryBOS`), not a standing opposite reading. Reset alongside the rest of basket state in `XAU_ResetBasketProtectionState()`.

## Bug #3 (CRITICAL) — Basket soft-lock silently disabled by an unrelated default

**Defect:** `InpCloudSafeDisablePartials` defaults `true`, which made `CloseBasketPartial()` bail immediately — so the basket soft-lock (bank a partial, keep a runner) added in v6.4.24 could never fire. Zero `BASKET SOFT-LOCK` lines exist in 8 days of logs. That left the full `BASKET LOCK` close firing on the FIRST floor/giveback breach with nothing banked (live: `peak $76.11 -> $34.50 banked` = 45.3%, `peak $77.88 -> $31.98 banked` = 41.1%), directly contradicting v6.4.24's own stated rationale that the full close "only fires as the second breach, after soft-lock already banked once."

**Fix (~line 1350-1352, 12010-12016, 12569-12751):**
- New input `InpBasketSoftLockIgnoresCloudSafe` (default `true`) bypasses the unrelated cloud-safe switch, the same way `InpSmartExitPartialIgnoresCloudSafe` already does for per-ticket partials.
- `g_basketSoftLockTaken` is now only set `true` inside the success branch of a partial close — a skipped/failed attempt (e.g. a leg below broker min lot) no longer silently satisfies the "already warned once" precondition for a full close that banked $0.
- The remaining floor-trigger `BASKET LOCK` full close now requires either a genuine prior soft-lock or a confirmed structure break (via the now-fixed `XAU_BasketStructureBroken`), closing the last gap where it could still fire ungated if a partial attempt failed.

## Bug #4 (HIGH) — TTM counted ticks as bars

**Defect:** `TTM_Evaluate()` incremented `barsHeld` on every `OnTick()` call, with no new-bar guard. Live evidence: 39 "bars" logged in 30 seconds on one position. This collapsed `InpTTM_MinHoldBars` (intended ~15 minutes of protection) down to ~2 seconds, and let a handful of ticks of a transient dip satisfy `InpTTM_PersistentBars`.

**Fix (~line 2100-2105, 13612, 13698-13711):** added `TradeTTMRecord.lastEvalBarTime`. `TTM_Evaluate()` now compares the current M5 bar time against the last-evaluated bar time and returns immediately (holding the prior verdict) if they match — the thesis is only re-scored once per completed bar, restoring the intended hold-duration and persistent-weakness semantics, and removing the majority of TTM's per-tick journal noise.

## Verification

- `test_reports/metaeditor_v6425.log`: `Result: 0 errors, 0 warnings`.
- New regression suite `tests/test_xau_v6425_phase1_exit_defects_static.py` — 6/6 passed, asserting: release identity/backend sync, bug #1's bar-shift/copy-index fix, bug #2's flip-based comparison (and absence of the old absolute check), bug #3's cloud-safe bypass + success-gated `g_basketSoftLockTaken` + gated `BASKET LOCK`, bug #4's per-bar guard ordered before `barsHeld++`, and that no Phase-1 change touched the early-loss/giveback-panic input defaults or added a new restrictive default.
- Pre-existing test files for older versions (`test_xau_v6413_*`, `v6414_*`, `v6420_*`, `v6421_*`, `v646_*` through `v649_*`) fail on this and the prior commit alike — confirmed via `git stash` against `HEAD` before any Phase-1 edits — because they reference EA filenames that no longer exist after later version bumps. This is pre-existing staleness (audit bug #11), explicitly Phase 5 (platform cleanup) scope, not touched here.

## Changed files/functions

- `XAUUSD_AI_Sniper_EA_v6.4.25.mq5` (renamed from v6.4.24): `XAU_ReconstructOpenBasketPeakUSD`, `XAU_BasketStructureBroken`, `ManageBasket` (entry snapshot capture + 3 soft-lock sites + floor-trigger gate), `XAU_ResetBasketProtectionState`, `CloseBasketPartial`, `TradeTTMRecord` struct, `TTM_RecordEntry`, `TTM_Evaluate`; new inputs `InpBasketSoftLockIgnoresCloudSafe`; new globals `g_basketEntryBOS`, `g_basketEntryHTF`.
- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` — synced byte-identical.
- `backend/server.py` — `ea_version` default bumped.
- `frontend/src/components/{AdminPortal,Footer,FeaturesSection,DownloadSection}.jsx` — version strings bumped.
- `tests/test_xau_v6425_phase1_exit_defects_static.py` — new regression suite (6 tests).
- `RELEASE_CHECKLIST.md` — new v6.4.25 entry.
