# XAU AI Sniper v5.8.50 Evidence Refactor

## Objective

Preserve the profitable v5.8.49 strategy while correcting defects proven by the
local Trading Intelligence datasets. This is a simplification-first maintenance
release, not a strategy rewrite.

## Evidence

- 61 closed trades: 72.1% win rate, +$192,502.77 net, profit factor 2.16.
- Grade A: 83.3% win rate, +$144,410, average worst floating PnL -$6,967.
- Grade A+: 63.2% win rate, +$27,852, average worst floating PnL -$10,700.
- Grade B: 66.7% win rate, +$20,241, average worst floating PnL -$6,204.
- Most blocked-trade categories hit the virtual 1R stop more often than the
  virtual 2R target. Existing guards must not be broadly removed.
- Several profitable trades first suffered $15k-$28k drawdown. A green close is
  not sufficient evidence of a good entry.

## Decisions

1. Keep hard safety and proven timing blocks.
2. Do not replace the strategy with an unvalidated universal score.
3. Make A+ an evidence-qualified positioning grade. Poor timing demotes to A
   and reduces size; it does not automatically suppress the opportunity.
4. Use the Command Center prop balance for strategy budgets and targets.
   Continue using real broker equity for emergency survival checks.
5. Apply a five-hour cooldown after two distinct consecutive losing trade
   cycles. Continue monitoring and managing positions during cooldown.
6. Replace the legacy profit-lock rest-of-day halt with a five-hour cooldown.
7. Release dynamic Context Gate indicator handles.
8. Preserve the single confirmed prop-firm retest add and its basket risk cap.
9. Do not add naive hardcoded CPI/FOMC dates; recurring event dates are not
   reliable enough to embed as fixed calendar rules.

## Non-goals

- No aggressive early-profit exits.
- No new indicator stack.
- No changes to normal-mode daily loss defaults.
- No rescue-pyramid removal that contradicts the owner's confirmed retest-add
  requirement.
- No compiled EX5 retained in Applications.
