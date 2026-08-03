# MetaQuotes Market Compliance Audit (Phase 20)

A background agent started this audit and hit a session/usage limit
partway through (after checks 1-3, 6); the remaining checks (4, 5, 7-10)
were completed directly in this session. All fixes below were verified
by an independent fresh compile after the handoff, not just trusted from
the agent's own report.

## Fixes applied (all pure hardening — zero change to signal, risk, lot
sizing, SL, exit, or owner-location-block logic; confirmed by diff review)

1. **Indicator handle leak, `ManageBasket()` (line ~24226).** An ATR
   handle (`hATR_dbtp`) was created every tick while the basket is unarmed
   and never released. Added `IndicatorRelease()` matching the pattern
   already used elsewhere in the file. This is exactly the class of bug
   MetaQuotes reviewers flag (handle exhaustion on long-running attach).
2. **Partial indicator-handle leak on failure, `TFDirectionByEMA()`
   (line ~40148).** If one of two handles (`hEMA`/`loc_hATR`) succeeded
   and the other failed, only the failure path returned — the succeeding
   handle was silently leaked. Now releases whichever handle DID succeed
   before bailing out.
3. **Unbounded array growth, `g_entryQuality[]` (line ~26760).** Grew by
   one permanent record per position ever opened, for the life of the
   terminal — a VPS running for months would accumulate one record per
   historical trade forever. Bounded to 500 records with evict-oldest
   (only FINALIZED/closed records are eligible for eviction; open
   positions' records are never touched), matching the cap-and-evict
   pattern this file already uses for `g_delayOutcome[]`/`g_exitBiasKeys[]`.
4. **Unbounded local telemetry file growth (6 files).** `XAUAI_TradeBrain`,
   `BlockedMemory`, `ConsciousMemory`, `TimingProof`, `TradingIntel`
   (CSV+JSON), and the local-AI-replay snapshot cache are all
   append-only with a single stable filename and no rotation — confirmed
   as a real gap in this session's earlier general production audit.
   Added `XAU_RotateTelemetryFileIfOversized()`: checked before each
   append, deletes and lets the existing "recreate from empty" logic at
   each call site rebuild the file once it exceeds 10 MB. Never touches
   trade decisions.

**Compile after these 4 fixes:** 0 errors, 0 warnings (independently
re-verified this session, not just taken from the agent's report).

## Remaining checks, completed directly this session

**Sleep() — 2 call sites, both bounded and low-risk.** Line ~5447:
`Sleep(100)` inside a broker-reconciliation retry loop, gated by
`attempt<2` (fires at most twice, never in a tight/unbounded loop).
Line ~9918: `Sleep(150)` as a one-shot "broker context busy" retry yield
on a specific error code (4756/10016) before a single `PositionModify`
retry. Neither is reachable in a way that could compound into a
multi-second UI-thread block — not a Market compliance risk.

**GlobalVariable naming — properly scoped, no collision risk.** Spot-
checked the loss-streak persistence mechanism:
`XAU_LossStreakGVPrefix()` returns `"XAUAI_LS_" + <production state
scope> + "_"` — prefixed with a product-specific tag and scoped per
symbol+magic (per the source's own comment, "so multiple EA instances on
one terminal never collide with each other's state"). Not a generic/
collidable name.

**Division-by-zero in the hot path — no naive unguarded pattern found.**
Spot-checked for raw `/atr`, `/spread`, or similar direct-division
patterns in `OnTick`-reachable code; none found as literal divisions (all
matches were comments/input declarations). Not an exhaustive
line-by-line audit of every arithmetic expression in a 42,700-line file —
stated as a scoped spot-check, not a formal proof.

**Print()/logging volume — not exhaustively verified, but consistent
with the file's established pattern.** 918 `Print`/`PrintFormat` call
sites exist, but (consistent with this session's and prior sessions'
repeated observation of this codebase's style) logging throughout the
file is gated by state transitions and specific decision events, not
called unconditionally on every tick. A full log-volume stress test
(actually running it and measuring Experts-log growth per unit time)
was not performed — flagged as unverified rather than asserted safe.

**Symbol robustness — graceful, not a hard crash risk.**
`IsXAUFastSymbol()` does a case-insensitive substring check for "XAU" or
"GOLD" in `Symbol()` and gates specific memory/telemetry features on it
(`InpTradeBrainMemory && IsXAUFastSymbol()`) rather than blocking the
whole EA or crashing on a non-matching symbol. A buyer attaching this to
an unexpected symbol would lose some memory-file features gracefully,
not crash. (`SYMBOL_COMPATIBILITY.md` already tells buyers this is
designed and tested for XAUUSD only — this doesn't change that guidance,
just confirms the failure mode on a mismatch is graceful.)

**Network/DLL surface — reconfirmed zero after all fixes.**
`WebRequest(` → 0, `#import` → 0, `ShellExecute` → 0, `.dll` → 0. Same
result as before these compliance fixes were applied — none of them
touched networking.

## Real Strategy Tester validation run (this session)

Config: `XAUUSD`, `M10`, `Model=4` (100% real ticks), 7-day window
(2026.07.14–2026.07.21), isolated Wine sandbox (`MT5_Isolated`, entirely
separate from the live Mac terminal and production VPS).

**Run twice, against two different binaries, deliberately** — the first
attempt used the pre-compliance-fix build (an internal mistake: the fixed
source hadn't actually been copied into the sandbox's Experts folder yet
before launching). Caught by comparing source SHA-256 in the sandbox
against the just-recompiled source, corrected by staging the true
post-fix, post-rename binary and rerunning before trusting the number.
Both runs produced **byte-identical results** — confirms the compliance
fixes (handle release, array cap, log rotation) genuinely have zero
effect on trading decisions, exactly as designed (they touch only
resource cleanup and file housekeeping, never a decision path).

Real result, read directly from the Tester's own HTML report
(`claude_xaucloud_qc_7d.htm`, from the confirmed-correct final run
against source SHA-256 `74dae9a1f6a9f4a3ab6d821ea0e5e59e2598638e25668e395c52eea4191d920e`):

```
History Quality: 100% real ticks
Bars: 660   Ticks: 2,950,461   Symbols: 1
Total Net Profit: 1,036.85
Balance Drawdown Absolute: 0.00   Equity Drawdown Absolute: 279.20
Total Trades: 4   Short (won%): 2 (100%)   Long (won%): 2 (100%)
Expected Payoff: 259.21   Recovery Factor: 1.98   Sharpe Ratio: 1.18
```

**Read honestly:** this proves the compiled build runs end-to-end —
opens and closes real trades, no crash, no hang, no error across 2.95
million real ticks — on the exact binary that will ship. It does **not**
prove profitability or robustness: 7 days and 4 trades is far too small
a sample to draw any performance conclusion from (100% win rate here is
not a claim about expected win rate generally), and it's a single window,
not an out-of-sample test. This is scoped as a functional/stability QC
pass, not a performance validation — the source product's own much
larger real-tick evidence (`audits/xaucloud/15_owner_location_permanent_hardblock_m10.md`
etc.) is where the trading-logic performance evidence actually lives,
since this build's trading logic is byte-identical to that product's.

## Overall verdict

No blocking MetaQuotes Market compliance issues found. Two real bugs
fixed (handle leaks) that would likely have caused terminal instability
on a long-running attach regardless of Market review; two hardening
fixes (bounded array, log rotation) that address exactly the "excessive
logging"/"poor optimization" categories Market reviewers are known to
flag. Zero network/DLL surface reconfirmed after all changes. One real
Strategy Tester run against the exact final build, with honest scope
limits stated rather than oversold.
