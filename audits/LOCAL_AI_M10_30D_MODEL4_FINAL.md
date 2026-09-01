# Local AI M10 — Final 30-Day Model 4 Replay

## Scope

- Symbol/timeframe: XAUUSD M10
- Period: 2026-06-28 through 2026-07-28
- Tester mode: Model 4, 100% real ticks
- Initial deposit: $10,000.00
- AI source: private VPS local model
- Paid/Emergent inference calls: 0
- Exact local-AI snapshot misses after cache resolution: 0

## Results

| Metric | Deterministic baseline | Local AI with owner blocks (production) | Local AI without owner blocks (control) |
|---|---:|---:|---:|
| Total trades | 33 | 34 | 58 |
| Winning trades | 22 | 23 | 39 |
| Losing trades | 11 | 11 | 19 |
| Win rate | 66.67% | 67.65% | 67.24% |
| Gross profit | $12,135.26 | $14,382.69 | $23,163.65 |
| Gross loss | -$8,134.71 | -$9,307.79 | -$17,021.08 |
| Net profit | $4,000.55 | $5,074.90 | $6,142.57 |
| Final balance | $14,000.55 | $15,074.90 | $16,142.57 |
| Profit factor | 1.49 | 1.55 | 1.36 |
| Expected payoff | $121.23 | $149.26 | $105.91 |
| Max equity drawdown | $3,690.11 (21.96%) | $4,214.14 (22.00%) | $5,585.58 (33.54%) |
| Maximum consecutive wins | 7 | 10 | 11 |
| Maximum consecutive losses | 3 | 3 | 6 |

## Production conclusion

The owner-blocked local-AI configuration is the production choice. Against the deterministic baseline it produced one additional trade and one additional winner, kept losses at 11, raised net profit by $1,074.35 (26.86%), and raised profit factor from 1.49 to 1.55. Its percentage equity drawdown was effectively unchanged (22.00% versus 21.96%).

The no-owner control made $1,067.67 more than the production configuration, but did so with 33.54% equity drawdown, a lower 1.36 profit factor, and six consecutive losses. It is therefore not the recommended customer configuration.

## Completion evidence

The Windows replay orchestrator completed both AI passes and wrote `C:\XauCloudLocalAI\logs\replay_30d_complete.json`. Both final AI reports were verified against the current exact-snapshot cache, and the final unresolved-miss counts were `withOwner=0` and `noOwner=0`.

Backtest results are evidence for this historical period, not a guarantee of future live performance.
