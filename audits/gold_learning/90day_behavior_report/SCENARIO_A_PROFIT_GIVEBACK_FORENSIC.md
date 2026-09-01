# Scenario A Profit Giveback Forensic

## Stop conclusion

**Scenario A is not a certifiable clean baseline.** The retained repeat startup proves `COUNTER_EXCURSION` was `enabled=true` in `COUNTER_EXECUTE` mode. This violates the required tester configuration, even though the completed Run 1 HTML contains zero filled counter-excursion positions.

The repeat was stopped early and contains 120 closed positions through 2026-05-22, not all 283. Its R evidence is therefore partial and is not substituted for missing 90-day evidence.

## Completed Run 1 warning summary

- Trades: 283; wins: 231; losses: 52; win rate: 81.63%.
- Gross profit: $64,717.56; gross loss: -$59,826.86; net: $4,890.70; profit factor: 1.08.
- Average win: $280.16; median win: $242.55.
- Average loss: $-1,150.52; median loss: $-1,068.58.
- One average loss consumed 4.11 average wins.

## Retained repeat R evidence (partial)

- Closed positions audited: 120; wins: 95; losses: 25.
- Owner floor armed: 36; did not arm: 84 (70.0%).
- Losing positions that previously reached their floor trigger: 0.
- Strict numeric per-leg exits below theoretical floor: 13. These are listed for review; multi-leg campaigns require campaign-denominated evaluation, and broker-stop rows include confirmed broker SL plus execution spread/slippage.
- Partial average win R: 0.269R; partial average loss R: -0.982R.

## Interpretation

The dominant measured cause is not a loss after the floor armed: no retained-repeat loss reached the trigger. Most trades never armed the floor, winners averaged only about +0.27R, and losses averaged about -0.98R. Therefore a high hit rate barely offsets full-1R losses. This points primarily to the distribution of entry outcomes/early small exits, not proven owner-floor failure.

## Required log marker counts

- `OWNER_EXIT_PROFILE`: 1019
- `OWNER_RISK_POLICY`: 121
- `VERSION-DIAG`: 1
- `OWNER_FLOOR_UPDATE`: 897
- `OWNER_FLOOR_OVERRIDE`: 0
- `REJECT_LOWER_EXIT`: 0
- `XAU_OwnerProtectedFloorAllowsClose`: 0
- `XAU_OwnerProtectedFloorAllowsModify`: 0
- `R_PROFIT_GUARANTEE_FLOOR_BREACH`: 18
- `SafeModifySL`: 0
- `FLOOR_APPLIED`: 71
- `FLOOR_CONFIRMATION_FAILED`: 0
- `R_EXIT_ORPHAN_UNCONFIRMED`: 0
- `BASKET_STATE_RESTORED`: 1
- `OWNER_EXIT_PROFILE_FROZEN`: 93
- `OWNER_EXIT_PROFILE_INHERITED`: 27
- `CAMPAIGN_ADD_REGISTERED`: 27
- `CAMPAIGN_CLOSED`: 93
- `PYRAMID`: 55
- `PARTIAL`: 0
- `COUNTER_EXCURSION`: 128

## Build/config evidence

- Git/source baseline: `cbe0b177fbaac1d09aa4fa55d640dd2689f1cd08`.
- Startup: property/runtime `6.25.8`; build `v6258-final-owner-breakout-risk-exit-policy-20260718`.
- MT5 Strategy Tester build 6030; XAUUSD M10; 100% real ticks (35,797,509 ticks / 8,538 bars); 2026-04-19 through 2026-07-18; USD; $10,000 start.
- Completed Run 1 HTML SHA-256: `144ece6969274004dfcd6189d2a382d3e094d2961547c0e8202243fa717a2e4b`.
- Actual Run 1/repeat input-set SHA-256 (before correction): `bc19ba801a4fdc0a26330a798d1f0c8c2d0cffc1fc6e55d7555629f97f8a7161`.
- Corrected future input-set SHA-256 (`InpCounterExcursionMode=0`): `07421ca56b2635661237e6818b3da0d5255c1a7208438257973963a8912a9c76`.
- Current on-disk research EX5 SHA-256: `00e5234f0f62711fc06e04f9a3c66d8c181c69b75c86a18af0912008ff69849b`; the hash was not journaled at launch, so it cannot by itself prove the exact loaded file after the fact.
- Startup confirms GENERAL and TREND_UP profiles, structural SL 1.00R, full configured 10% risk, owner time block NONE, BRKT_UP/BRKT_DN blocks.
- Fatal configuration mismatch: Counter Excursion enabled in execute mode. The completed HTML contains zero filled `XAU-COUNTER-EXC` positions, but the module was active and evaluated candidates.

## Decision

Do not continue Scenario B/C. Correct the tester input (`InpCounterExcursionMode=0`), preserve the EX5 and input hashes before launch, then rerun Scenario A from a clean state before diagnosing or changing trading rules.
