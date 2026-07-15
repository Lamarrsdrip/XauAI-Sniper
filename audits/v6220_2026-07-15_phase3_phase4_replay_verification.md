# v6.22.0 Unified Campaign Thesis — Phase 3/4 Verification

**Date:** 2026-07-15

**Branch:** `experiment/v6.22.0`

**Baseline:** `50da5e1`
**Candidate build:** `v6220-unified-campaign-phase3-20260715` (`#property version 6.266`)

## Audit fixes made before Phase 3

- The non-spike timing `HARD_BLOCK` constituents are now captured and weighed in ACTIVE mode instead of returning before telemetry. Raw spike cooldown remains a hard stop.
- Challenger timing evidence is continuous (`confidence - penalty*0.50`) instead of a binary any-penalty threshold.
- Phase 2d reversal evidence is signed correctly: it reduces the requested thesis and supports the actual opposite thesis.
- The rolling 24-hour range continues scanning all 288 M5 bars after the current leg origin is found.
- Confidence changes and direction changes are closed-M5-cadenced. M1 refreshes still update timing telemetry but cannot manufacture five confidence updates or flip the campaign story mid-bar.
- The owner-specified 80% execution authorization is enforced on net thesis confidence in both primary and challenger branches, and revalidated after the late Phase 2d evidence applied inside `OpenTrade()`.

## Phase 3

- `projectedTarget1`: existing H1 structural extreme in the thesis direction.
- `projectedTarget2`: existing rolling 24-hour range extreme in the thesis direction.
- `idealEntryLow/High`: existing value anchor plus/minus the configured value-distance ATR allowance.
- The formerly inert growth R:R calculation uses the matching thesis's forward `projectedTarget1`; broker TP remains `0.0` and campaign-managed exits are unchanged.
- ACTIVE now relays an existing campaign's already-computed HOLD/EXIT conclusion through `ACTIVE_HOLD_EXISTING` / `ACTIVE_EXIT_DAMAGED_THESIS`; it does not reclassify the campaign.

## Compile

Authoritative log: `compile_logs/v6220_2026-07-15_phase3_final_authorization3.log`

```text
Result: 0 errors, 0 warnings, 30553 ms elapsed, cpu='X64 Regular'
```

Final SHA-256 before commit/deployment:

- MQ5: `4169c769e743befc188cc66e7c2c6102228debab517bc8065ce73c371e708c2f`
- EX5: `5a9e4127d064ea94adffc3446adff6ede78c6db274a78c52f003dd8447a3dc23`

## Isolated replay

Source data was copied from the installed MetaQuotes-Demo XAUUSD history store used by account ending `9209`. Tester settings: XAUUSD M5, 1-minute OHLC model, 2026-07-14 00:00 through 2026-07-15 00:00, ACTIVE preset. The tester uses a portable isolated terminal and cannot place live orders.

| Metric | `50da5e1` baseline | Final candidate |
|---|---:|---:|
| Signals | 175 | 175 |
| Allowed/fills | 0 / 0 | 0 / 0 |
| Final balance | $10,000.00 | $10,000.00 |
| Max drawdown | $0.00 | $0.00 |

An intermediate candidate audit correctly caught a regression (two SELL fills, both stopped, final balance $7,241.32). Both trades had been admitted below the owner's 80% confidence authorization tier (38% and 59%). The final authorization repair removes both; the final result is baseline-neutral.

Final trace checks:

- 175 signals and 0 `TRADE_NOW` actions.
- 530 `[CAMPAIGN_THESIS]` lines (primary + challenger across the day).
- No off-grid thesis update after startup; the only non-M5 timestamp is the initial 00:00:15 initialization pair.
- 223 ACTIVE decisions, including 159 non-spike decisions carrying nonzero timing penalties through the unified model.
- Targets and ideal-entry zones are populated in thesis telemetry whenever a structural target exists ahead of price.

## Documented failure windows

The original journal used machine GMT+1 while tester timestamps follow broker time, producing a +2-hour mapping for the matching price events.

- **06:45 local → 08:45 tester (4030 breakout zone):** the primary BUY thesis reached 71% (`ZONE`) but had not reached 80% authorization. The 1-minute-OHLC replay also classified the candidate as raw spike cooldown, which intentionally remains a hard stop. No under-confidence order was admitted.
- **13:40 local → 15:40 tester (4102.56 high/failure):** the SELL reversal opportunity was created at 15:35. At 15:43 the non-spike timing conflict became a 33-point graduated penalty; net BUY confidence fell to 28%, so the late BUY was rejected without treating the ordinary conflict itself as an independent veto.
- **16:10 local → 18:10 tester (late BUY cancellation):** timing passed, but the old BUY thesis was only 45%, exhaustion was 84%, old-direction reward was 0.36R, and the challenger SELL thesis was strengthening. The BUY remained blocked; this is the intended no-late-chase outcome rather than the prior erroneous 97%/15-ATR anchor result.

## Limits and protected systems

The installed XAUUSD history cache ends at 2026-07-14 23:00. MT5 therefore clamps a requested replay through 2026-07-16 back to 2026-07-15 00:00. The 2026-07-15 overnight audit segment cannot yet be replayed from local ticks and is not claimed as verified.

Diff/function audit confirms no edits to:

- `XAU_Campaign_UpdateProtection()`
- `XAU_Campaign_ClassifyMarket()`
- `XAU_Campaign_PostResetGate()` / `XAU_Campaign_PostResetEvaluate()`
- the structural invalidation algorithm in `XAU_Campaign_CalculateInvalidationSL()`
- broker/account/news/spread/max-trade/daily-loss risk protections

The only `OpenTrade()` changes are signed-thesis evidence, 80% authorization revalidation, and the projected-target growth-R:R check. The real order TP remains zero and the existing structural SL function is still called unchanged.
