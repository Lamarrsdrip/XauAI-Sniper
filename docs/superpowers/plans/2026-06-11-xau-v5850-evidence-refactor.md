# XAU AI Sniper v5.8.50 Implementation Plan

1. Add static regression tests for reference-balance ownership, A+ positioning,
   cooldown behavior, context-handle cleanup, and versioning.
2. Add `StrategyReferenceBalance()` and route lot, aggregate-risk, auto-scale,
   basket, and enabled account-scaled exit thresholds through it.
3. Add explicit Prop Mode calculation logs.
4. Add an A+ positioning qualification helper and demote weak A+ timing to A.
5. Add independent closed-trade cooldown tracking with basket-cycle deduping.
6. Replace legacy day halt with time-limited profit-lock cooldown.
7. Release Context Gate indicator handles on every path.
8. Run focused tests, full tests, Python checks, diff checks, and MetaEditor
   compile under Wine.
9. Copy only the MQ5 source to Applications and remove compiled EX5 output.
