# Manual Trading Intelligence opportunity/re-entry rebuild — 18 August 2026

## Finding

The original rebuilt replay did not prove that XAUUSD lacked opportunities. It
conflated a valid D1/H4/H1 direction with one single, high-runway entry. When
that entry gate failed, the code erased the entire thesis as NEUTRAL. The
prior 30-day report therefore showed 135 H4 evaluations but only four
qualified theses.

The historical rejection audit confirms the important constraint: the
dominant rejection is still no lower-timeframe entry confirmation, not a
blanket confidence or target threshold. The revised replay records:

| Rejection reason | Count |
|---|---:|
| No lower-timeframe entry confirmation | 340 |
| Regime unclear | 80 |
| Insufficient 70-pip structural runway | 27 |
| Re-entry cooldown | 26 |
| Duplicate active opportunity | 4 |
| HTF alignment / runway / regime combined | 1 |

This preserves selectivity. A thesis does not create an entry merely because
it exists.

## Architecture delivered

- D1/H4/H1 establish a durable, anti-flip HTF thesis.
- A valid thesis can explicitly display WAITING FOR ENTRY; it is not
  relabelled NO SETUP just because price is extended or no lower-timeframe
  setup has appeared.
- H1 detects separate pullback-continuation, liquidity-sweep/reclaim,
  breakout/retest, and compression-expansion entry families.
- Each opportunity has a stable closed-H1 setup key, its own entry zone,
  invalidation, targets, confidence, MFE/MAE and status.
- Resolved opportunities are written to four_hour_trade_opportunities; new
  entries can reuse the same thesis ID.
- A six-hour re-entry cooldown prevents one continuation leg from becoming a
  stream of near-duplicate entries. It is a guardrail, not a monthly quota.
- The UI now separates current HTF thesis, current trade opportunity, waiting
  for entry, and recent opportunities belonging to that thesis.

The automated MT5 EA is not read, changed, compiled, or deployed by this
work.

## Same broker-data replay

Input remains the closed-only Exness XAUUSDm export used for the first
rebuild, covering 19 July 16:00 UTC through 18 August 16:00 UTC. Direction
uses only closed D1/H4/H1 bars. H1 is evaluated independently for entry
timing, so the revised replay has 505 H1 entry evaluations rather than the
old 135 H4-only checks. Future H1 bars are used only to classify outcomes.

| Metric | Previous rebuild | Opportunity/re-entry architecture |
|---|---:|---:|
| HTF theses | 4 qualified theses | 4 |
| Actionable opportunities | 4 | 29 |
| BUY / SELL opportunities | 4 / 0 | 18 / 11 |
| Direction flips | 0 displayed entry flips | 3 structural thesis changes |
| False flips | not measured | 0 |
| T1 / T2 / T3 | 2 / not measured / not measured | 28 / 19 / 14 |
| Invalidated / expired | 0 / 2 | 1 / 0 |
| Major-move capture | not measured | 13 of 21 (62%) |
| Average favorable / adverse excursion | not measured | 97 / 117 pips |
| Average opportunity duration | not measured | 2 hours |

The three direction changes are not lower-timeframe reversals: each requires
opposing D1, H4 and H1 structure. The replay found no BUY → SELL → BUY
false-flip churn. Full records, source provenance, outcomes, rejection funnel
and the non-overlapping 24-hour closed-price major-move denominator are in
20260818_manual_intelligence_broker_replay.json.

## Validation

- Backend typecheck: passed.
- Backend tests: 16 files / 71 tests passed.
- Frontend tests: 13 suites / 76 tests passed.
- Frontend production build: passed.
