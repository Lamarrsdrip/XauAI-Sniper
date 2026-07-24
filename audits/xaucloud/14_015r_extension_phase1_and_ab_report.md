# +0.15R Extension Protection: Phase 1 Report + A/B Real-Tick Replay

Owner-requested experiment. Two isolated compiles of the exact audited
source (differing only in the extension-arm SL-protection call, see
`015r_extension_experiment/`), replayed over the identical **genuine
real-tick** 60-day window (2026-05-22 to 2026-07-21, `Model=4`, confirmed
"100% real ticks", 23,648,730 ticks — see
`13_CORRECTION_synthetic_vs_real_tick_data.md` for why this had to be
rerun from the earlier synthetic-tick attempt).

## Phase 1 decision (per the owner's requested format)

**EVIDENCE INSUFFICIENT FROM EXISTING FILES — REAL-TICK RERUN REQUIRED, AND HAS NOW BEEN COMPLETED.**

The existing 60-day evidence (the published artifact, `08_60day_replay_results.md`)
did not contain genuine chronological tick-path data — it was `Model=1`
(synthetic 1-minute OHLC), confirmed via tick-count sanity check
(219,957 vs the 23.6M+ ticks genuine real-tick mode produces for the same
window) and retracted in `13_CORRECTION_synthetic_vs_real_tick_data.md`.
Per the owner's own explicit fallback instruction, a fresh `Model=4` A/B
rerun was performed rather than estimating from the retracted summary data.

## A/B real-tick result

| | ARM A (current: restore original SL) | ARM B (+0.15R protection) | Difference (B − A) |
|---|---:|---:|---:|
| Net profit | **-$3,406.54** | **-$3,339.30** | +$67.24 (smaller loss) |
| Gross profit | $18,468.38 | $16,487.77 | -$1,980.61 |
| Gross loss | -$21,874.92 | -$19,827.07 | +$2,047.85 (less lost) |
| Profit factor | 0.84 | 0.83 | -0.01 (essentially flat) |
| Max balance DD | 66.10% | 65.61% | -0.49pp |
| Max equity DD | 66.92% | 66.29% | -0.63pp |
| Trades | 122 | 127 | +5 |
| Win rate | 63.11% | 71.65% | +8.54pp |
| Avg win | $239.85 | $181.18 | -$58.67 (winners cut shorter, as expected) |
| Avg loss | -$486.11 | -$550.75 | -$64.64 (worse, on average) |
| Largest win | $1,745.10 | $808.38 | -$936.72 |
| Largest loss | -$6,235.99 | -$5,856.41 | +$379.58 (smaller) |
| Max consecutive losses | 6 (-$2,154.15) | 3 (-$1,588.25) | fewer, smaller |

## Headline finding, unrelated to +0.15R specifically

**Both arms are net-losing over this real-tick window, with catastrophic
~66% maximum drawdown.** This did not show up at all in the earlier
(retracted) synthetic-tick 60-day run, which reported a comfortable
+$10,839.11 profit and a 44-45% drawdown for the same underlying
configuration. The gap between synthetic and real-tick results here is not
a rounding difference — it reverses the sign of the result entirely.

**Both arms' single largest loss (-$6,235.99 / -$5,856.41) is the exact
same real market event**: both positions closed at `2026.06.02 01:00:00`
against a registered SL of `4491.11`, but the actual broker fill was
`4535.29` — a ~44-point (~$5,000+ on the position sizes involved) gap
through the stop. This is genuine broker-confirmed slippage during a real
price gap, not an EA defect and not something either extension variant
caused — both arms inherit it identically from the underlying fixed-SL/
structural-SL mechanism, and it is exactly the class of event a synthetic
1-minute-bar backtest cannot reveal.

## What +0.15R actually changed, honestly

- **Marginal improvement, not a fix**: $67 less net loss, ~0.5-0.6
  percentage points less drawdown, meaningfully more trades finishing as
  technical "wins" (win rate 63.11% → 71.65%) — but at smaller average
  size, exactly as the mechanism is designed to do (lock in a smaller
  guaranteed profit instead of risking a full round-trip to loss).
- **Profit factor is essentially unchanged** (0.83 vs 0.84) — both remain
  well below the 1.0 breakeven line.
- **Does not address the catastrophic drawdown or the gap-through-stop
  risk** — those are properties of the underlying structural/fixed-SL and
  GENERAL-exit mechanism this experiment never touched (confirmed by the
  21 regression tests proving ordinary GENERAL exit behavior, lot sizing,
  entries, and pyramids are byte-identical to the audited source).

## Phase 1 / Phase 3 decision

**TEST DOES NOT SUPPORT IMPLEMENTATION** — not because +0.15R protection
fails to do what it was designed to do (it does, marginally, on nearly
every axis), but because neither the current production configuration nor
the +0.15R variant is viable in this real-tick window: both lose money
with ~66% drawdown. Implementing +0.15R here would not fix the underlying
problem this real-tick rerun surfaced; at best it would make an unviable
result marginally less unviable.

## What this means for the broader release-gate picture

This real-tick vs. synthetic-tick discrepancy is larger than this one
experiment. The same synthetic-tick methodology (`Model=1`) was used for
every other backtest referenced in this audit trail this session,
including the ones that informed the earlier RELEASE HOLD → "closer to
PASS" narrative. Every one of those conclusions now needs the same
real-tick scrutiny before being trusted. This is flagged here rather than
left implicit.

## Regression tests

21 tests, all passing, in `015r_extension_experiment/test_xaucloud_015r_extension_protection.py`
— covering the calculation, never-move-backward guarantee, failure
handling, telemetry, and (per the owner's mid-experiment clarification)
explicit proof that the ordinary GENERAL exit system, lot sizing, entries,
and pyramids are untouched and that +0.15R activates only at the single
existing extension-arm call site.

## Explicitly not done in this pass

- Restart-recovery test for the extension timer/protected-SL persistence
  (requirement 12) — not exercised; would need a live/Tester restart
  scenario this static test suite cannot simulate.
- Duplicate-tick dedup test (requirement 11) — covered indirectly via
  SafeModifySL's existing no-op guard (proven present) rather than a
  dedicated new test.
- Re-running the 0/5/10-minute extension-window comparison
  (`10_extension_window_experiment.md`) under real ticks — that entire
  comparison used the same retracted `Model=1` methodology and should be
  considered unverified until redone, but redoing it was not requested in
  this task and was not performed.

## Promotion gate

Per the owner's own "MAIN-BOT PROMOTION GATE" section: **not promoted.**
No merge to main, no `XauCloud.ex5` replacement, no download-page update,
no VPS/Mac deployment, no "stable" label. The evidence here recommends
against promoting either arm, so this is not a case of withholding a
result that supports promotion pending approval — the result itself does
not support promotion.
