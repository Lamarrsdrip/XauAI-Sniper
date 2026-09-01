# v6.24.0 — Aligned Entry Engine

## Normal-entry repair

- Removed or neutralized 48 duplicate veto/delay locations covering 36 completely removed blocker concepts.
- Replaced the independent personality, Active Direction, SMC conflict, TRI, STI, recovery, AI, memory, TradeBrain, drawdown, GrowthGuard, Profit Guardian and quality-size choke points with eight named authorities.
- Deleted the pending-opportunity mailbox and recovery executor that could reopen an early rejected idea at a later price.
- Deleted the separate adaptive-reversal normal-trade lane; reversal candidates use the shared normal sequence.
- Kept Counter-Excursion isolated. No inverse route was added to the normal strategy.

## Owner-required timing behavior

- Preserved one 120–180 second pre-execution delay; default remains 150 seconds.
- Removed immediate A/A+ bypasses, next-bar waiting, recovery timers and duplicate timing state machines.
- Added independent PRIMARY, RE_ENTRY and PYRAMID candidate clocks so modules cannot reset or starve one another.
- Added a prompt wall-clock release scan when PRIMARY timing matures instead of waiting up to the next M5 bar.
- Recomputes live price, ATR travel, market reset and remaining reward before timing release.

## Risk and execution

- Approved normal entries use configured binary risk; AI, memory, personality and loss-fear modules cannot silently shrink size.
- `OpenTrade` retains operational controls: mixed exposure, cross-instance collision, aggregate risk, total lots, margin, broker volume/stops and broker result handling.
- Pyramid adds are favorable-direction only, configured-count limited, decreasing-size, basket-risk reconciled and margin checked.
- Re-entry requires a genuine better-price reset and the same shared authorities.

## Distribution identity

- Version: `v6.24.0` / MetaEditor property `6.240`.
- Build: `v6240-aligned-entry-engine-20260715`.
- Preset: `config/XAUUSD_AI_Sniper_EA_v6.24.0_ACTIVE.set`.
- Website/admin/cloud labels and backend version default updated to v6.24.0.
- MetaEditor: 0 errors, 0 warnings.
- No deployment performed.
