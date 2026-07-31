# v5.8.50 Engine + Current-Bot Policy Hybrid -- Final Research Report

Branch: `research/v5850-engine-current-policy-hybrid`. Not merged to main.
Not deployed to VPS. Not attached to any live account.

## 1. Base bot provenance

- Historical base: XAUUSD AI Sniper v5.8.50 ("Evidence Refactor")
- Commit: `de2984cce7039598af559458bfc49334187834e0` (2026-06-11, "Refine XAU
  prop risk and entry grading")
- Source SHA-256: `65da1e9f8c11dbc78aada4ed7a18e7a32e3b0816c2e230cde2500ce81552e600`
- `#property description`: "XAUUSD AI Sniper v5.8.50 -- EVIDENCE REFACTOR"
- This is the exact build live through the tail of the documented
  May19-Jun17 2026 growth run ($100k -> +$351,118 net, 74% WR, PF 3.07,
  cited in commit `dacf77b`) -- confirmed by finding it was the last EA
  commit before the window closed (next change: 2026-06-18).

## 2. Untouched baseline verification

User-recalled figures (~127 trades, 59W/68L, ~-$1,836.80 net, ~PF 0.80,
~29% DD) were explicitly NOT assumed. Clean rerun on the same 30-day
window used for every other build in this report (2026.07.01-2026.07.31,
XAUUSD, M5, real ticks, Model=1, MetaQuotes-Demo, $10,000 deposit, 1:100
leverage):

- History Quality 100%, Bars 5773, Ticks 115,434 (genuine tick data)
- **141 trades** (90 short/65.56% won, 51 long/72.55% won)
- **Net: -$2,256.95**, Gross profit $2,553.23 / Gross loss -$4,810.18
- **Profit Factor: 0.53**
- Balance DD 26.70% ($2,820.80), Equity DD 30.57% ($3,354.00)

Directionally consistent with what was recalled (unprofitable, weak PF)
but not an exact match -- notably the recalled figures imply a losing win
rate (46.5%) while the actual rerun shows a winning win rate (68%) that
still nets negative because losses run far bigger than wins. Reported as
a discrepancy, not silently reconciled.

## 3. What was ported, and how

All four stages ported by BEHAVIOR/FORMULA where the current bot's real
implementation was entangled with out-of-scope machinery (Adaptive
Transition Engine, momentum/structure classification), and verbatim where
it was self-contained (risk-per-lot formula, fixed-SL formula, block
threshold policy). Every stage compiled 0 errors before proceeding to the
next. Compile logs: `compile_logs/stage{1,2_3,4}_*.log`.

**Stage 1 -- permanent blocks + owner location block.** Single shared
`XAU_HybridPermanentGateCheck()` called identically at all three
order-send sites (primary `OpenTrade`, `RE_ENTRY` via `OpenTrade`, and the
separate pyramid order-send call) so candidate-acceptance and
final-execution enforcement can never drift apart. Location quality
(EXCELLENT/LATE/RESET_PENDING) is a new v5.8.50-native proxy (EMA/ATR
extension distance + existing `lastClose` tracker), not the current bot's
Adaptive Transition Engine (explicitly out of scope).

**Stage 2/3 -- risk/lot sizing + initial SL.** `XAU_HybridRiskPerLotForDistance()`
is a verbatim copy of the current bot's `XAU_MoneyPerLotForDistance()`/
`RiskPerLotForDistance()` (OrderCalcProfit-based). `InpHybridNormalRiskPct
= 10.0` matches the current bot's `InpNormalRiskPct` exactly -- flat,
uniform, binary (REPLACES v5.8.50's entire account-mode/scout/Profit-
Guardian/drawdown-recovery/careful-mode/session/pattern-streak/volatility
multiplier stack, per the current bot's own verified "no opinion-based
subsystem may reduce it" policy). `XAU_HybridFixedGoldMoveSLPrice()` is a
verbatim port of the current bot's actual-broker-SL policy: a fixed
$10.00 Gold-move, decoupled from the structural/ATR distance that
continues to drive lot sizing only (matching the current bot's own
design). v5.8.50's `InpMaxRiskPctEquity`/`InpMaxAggregateRiskPct` hard
backstops were retargeted from 3.0%/8.0% to 10.0%/35.0% (the current
bot's values) so they don't silently override the ported target.

**Stage 4 -- exit management.** The current bot's real
`XAU_ProtectPeakProfitFloor` is entangled with its own momentum/structure-
classification engine (out of scope). Ported the current bot's ACTUAL
numeric policy instead (real input defaults, not approximated): arm at
max($75, 2.5% balance) capped by 0.45R, lock 45% of peak (min $35
retained), hard-close on 65%+ unsecured giveback. Reuses v5.8.50's own
existing peak tracker (`UpdatePeakProfit`) -- one source of truth, not a
second parallel system. SL-ratchet-only (never loosens), disjoint by
profit sign from v5.8.50's existing loss-cutoff logic. v5.8.50's own
native `InpPeakRetraceExit` (same purpose, different thresholds) was
disabled to prevent two exit engines contesting the same close decision.

**M10 variant (Candidate B).** All 118 occurrences of `PERIOD_M5`
retargeted to `PERIOD_M10` (new-bar gate, all indicator handles, every
setup's `iClose`/`iOpen`/`iHigh`/`iLow` calls) -- verified zero `PERIOD_M5`
remaining. H1/M15/H4 context timeframes were already separate explicit
constants, untouched. `SIGNAL_TF=M10` logged every candidate cycle. No
TRANSITION_WATCH or second-authority veto added, per instructions.

**Deterministic lot-size proof:** see `DETERMINISTIC_LOT_SIZE_COMPARISON.md`
-- formula and normalization independently verified identical by code
inspection (not merely asserted), with a worked numeric example.

## 4. 30-day results -- same window, same settings, all four builds

XAUUSD, M5 (M10 for Candidate B), real ticks (Model=1), 2026.07.01-2026.07.31,
MetaQuotes-Demo, $10,000 deposit, 1:100 leverage, 100% history quality on
every run (5773 M5 bars / 2887 M10 bars, 115,434 ticks -- identical
underlying tick data across all four).

| | Baseline (untouched v5.8.50) | Candidate A (M5 hybrid) | Candidate B (M10 hybrid) | Candidate D (current prod bot) |
|---|---|---|---|---|
| Trades | 141 | 40 (0L/40S) | 37 (10L/27S) | 40 (18L/22S) |
| Net profit | -$2,256.95 | -$3,107.10 | -$3,086.36 | **+$3,639.94** |
| Profit Factor | 0.53 | 0.44 | 0.20 | **1.50** |
| Win rate | 68.09% | 62.5% | 48.65% | 62.5% |
| Balance DD max | 26.70% | 37.64% | 31.91% | **19.61%** |
| Equity DD max | 30.57% | 39.23% | 33.85% | **25.39%** |

Reports: `tester_reports/v5850_untouched_baseline_30d.htm`,
`v5850_hybrid_m5_full_30d.htm`, `v5850_hybrid_m10_full_30d.htm` (Candidate
D's report is from the same-session earlier flat-entry-fix investigation,
identical window/settings -- `flatfix_baseline_30d.htm` in that branch).

## 5. Candidate A's 0-long-trades anomaly -- investigated, not a bug

Verified against the actual `HYBRID_PERMANENT_BLOCK` log output
(`tester_reports/candidateA_permanent_block_log_by_direction.txt`): SELL
candidates were blocked 162 times, BUY candidates only 24 times, by the
SAME code applied identically to both directions. v5.8.50's own setup
engine generated far more SELL setups in this window (consistent with the
baseline's own 90-short/51-long skew) -- the ported blocks, layered on an
already SELL-skewed candidate stream, eliminated every surviving BUY
opportunity while still letting 40 SELL trades through. A real emergent
interaction between v5.8.50's setup mix and the current bot's policy, not
a coding defect.

## 6. Acceptance criteria -- both candidates fail

| Criterion | Candidate A | Candidate B |
|---|---|---|
| Significantly more trades than current prod bot | No (40, tied) | No (37, fewer) |
| Positive net profit | **No** | **No** |
| PF >= 1.40 | **No** (0.44) | **No** (0.20) |
| Higher win rate than untouched v5.8.50 | No (62.5% < 68.09%) | No (48.65% < 68.09%) |
| Lower drawdown than untouched v5.8.50 | **No** (worse) | **No** (worse) |

Neither candidate is accepted. M10 is not "forced to lose" to M5, nor
vice versa -- M10 is honestly worse on this data (PF 0.20 vs 0.44), and
both are honestly worse than doing nothing (the untouched baseline) and
far worse than the current production bot.

## 7. Honest recommendation

**Do not deploy either candidate.** The current production bot (Candidate
D, unmodified, already live) remains the best-performing build evaluated
in this entire investigation, on this real 30-day window. The hybrid
concept -- as executed here -- does not restore v5.8.50's growth-run
profitability by adding modern risk/exit protection; it produces a worse
outcome than either system alone.

This does not necessarily mean the underlying idea is unsalvageable, but
what would be required to responsibly claim otherwise: testing across
multiple distinct windows (this report used one in-sample July window,
same discipline gap flagged earlier tonight's flat-entry-fix work
exploited), and likely re-tuning the location-quality proxy and block
policy against v5.8.50's own setup-mix characteristics rather than
assuming the current bot's thresholds transfer directly. Neither of those
was done here -- stated plainly rather than glossed over.

## 8. Deliverables

- Untouched baseline MQ5: `research_v5850_hybrid/v5850_UNTOUCHED_BASELINE.mq5`
- Modified M5 MQ5/EX5: `research_v5850_hybrid/XauCloud_v5850_HYBRID_M5.mq5`
  (deployable, real PIN default) + compiled EX5 in the same commit
- Modified M10 MQ5: `research_v5850_hybrid/XauCloud_v5850_HYBRID_M10.mq5`
- Compile logs: `research_v5850_hybrid/compile_logs/`
- Commit hashes: base `de2984cce7039598af559458bfc49334187834e0`; stage
  commits on `research/v5850-engine-current-policy-hybrid` (see `git log`)
- SHA-256: baseline source `65da1e9f8c11dbc78aada4ed7a18e7a32e3b0816c2e230cde2500ce81552e600`
- 30-day tester reports: `research_v5850_hybrid/tester_reports/`
- Trade-level investigation: `tester_reports/candidateA_permanent_block_log_by_direction.txt`
- Deterministic lot-size comparison: `DETERMINISTIC_LOT_SIZE_COMPARISON.md`
- This report

## 9. Not done (stated honestly)

Full per-trade diff table (preserved/removed/lot-changed/SL-changed
categorized for every historical v5.8.50 trade), the wider metrics set
(Sharpe/recovery/>1R-2R-3R winners/pyramid-vs-reentry breakdown) beyond
what MT5's own report already provides, and holdout-period validation
(this is one in-sample window). Given both candidates already fail the
acceptance criteria decisively on this window, further analysis was
deprioritized in favor of reporting the clear negative result honestly
rather than continuing to build out infrastructure around a rejected
result.
