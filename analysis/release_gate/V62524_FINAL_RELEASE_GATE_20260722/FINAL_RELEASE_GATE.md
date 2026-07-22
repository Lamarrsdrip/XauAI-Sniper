# v6.25.24 final production release gate

Audit date: 2026-07-22  
Candidate build: `v62524-final-production-audit-20260722`  
Production verdict: **HOLD — DO NOT PROMOTE TO STABLE OR ENABLE UNCONTROLLED REAL-MONEY TRADING**

## Executive result

The repaired candidate compiles cleanly and the first exact 90-day real-tick replay completed. The repaired GENERAL ten-minute deadline authority fired and closed normally in the replay. However, the replay's risk performance is not production-safe: maximal balance drawdown was 72.58% and maximal equity drawdown was 73.76%. This alone keeps the release on HOLD even though the run ended with a small positive net profit.

The advisor-neutrality replay is still running at the time this checkpoint was written. VPS validation is intentionally deferred until neutrality completes, as required. The published website download remains stable v6.25.8; v6.25.24 has not been promoted.

## Candidate identity

- Repaired MQ5 SHA-256: `56c91c3db8de4d1d119b7df646a8ef81d210c8286b3d2728ff7a0f9d1ff700a9`
- Exact compiled EX5 SHA-256: `346bd2ccff573cde2e273eb356ea454887c7e33a3fe092501753d547545b1e26`
- MQ5 size: 2,311,146 bytes
- EX5 size: 1,430,626 bytes
- Compile: 0 errors, 0 warnings, 41,257 ms
- Compile log: `test_reports/metaeditor_v62524_final.log`
- Original attached source SHA-256: `e3309d9faafba868c3b94e405fd6f31f819e970156c374c6c2a57d360232314d`

The root source and backend source are byte-identical. The root EX5, release EX5, and isolated tester EX5 are byte-identical.

## Safety backup

The live MT5 data directory was backed up while MT5 and its tester were stopped. The backup used an APFS clone and preserves stable EAs, settings, profiles, tester configuration, and account state.

- Backup: `/Users/libertyelectronics/MT5_BACKUPS/MT5_DATA_PRE_V62524_REPLAY_20260722T090542Z`
- Inventory rows: 1,542
- Per-file checksum rows: 1,542
- Inventory SHA-256: `d5f1423001c87c4034799a627b1c3a42642e14d9e00bdf988ddc18c038336316`
- Checksum-list SHA-256: `07079f310e8d0055f342b6ae9ec750f8f894887a6c9741b553db235d6ef3df89`
- Backup README SHA-256: `771fa13f8767f02bdb2b251d4bb7cc6b471a0471298b4722041cf8fc352255f1`

No stable EA, setting, profile, or account configuration was overwritten.

## Exact replay contract

- Symbol/timeframe: XAUUSD M10
- Tick model: real ticks (`Model=4`), 100% history quality
- Dates: 2026-04-22 through 2026-07-21
- Deposit: USD 10,000
- Leverage: 1:100
- Visual mode: off
- Live trading: off
- Original input set SHA-256: `737c1daf85e0bb488b6e979a3ab8c3d4929f10a2602cc0b12eedee9dcd15e2a2`
- Collect input set SHA-256: `8d0424da8a4ef8fcc17ab0ae6b05c604285b9ae949be90cc2552b44b2359567d`
- Advisor input set SHA-256: `675a2fb8e3a9146223d9ccbef7c49ebfacacfea9dcf48f5e6b02623e0fa35f74`

All three sets contain the same 865 keys. Collect differs from the original only by its unique collection run ID. Advisor differs only by `InpGlobalTradeBrainMode` and its unique collection run ID. There are no missing or extra keys.

## Collect-only replay result

- Mode: `GLOBAL_TRADEBRAIN_COLLECT_ONLY`
- Raw tester report SHA-256: `f0321b7d592d4beeae20ffc9315085a0977c7bc898f6d2ce3409b54acb2096da`
- Sanitized committed report SHA-256: `d471c7539eb346b39c6c70c9b954befa29335c5c937791d580b6aca3ca39679d`
- Total trades/deals: 161 / 322
- Winning trades: 112 (69.57%)
- Losing trades: 49 (30.43%)
- Gross profit: USD 32,416.35
- Gross loss: USD -32,080.43
- Net profit: USD +335.92
- Profit factor: 1.01
- Expected payoff: USD 2.09
- Recovery factor: 0.03
- Sharpe ratio: 0.18
- Maximal balance drawdown: USD 9,607.49 (72.58%)
- Maximal equity drawdown: USD 9,909.82 (73.76%)
- Largest profit trade: USD 2,170.08
- Largest loss trade: USD -5,747.96

Final scan health: started 8,206; completed 8,206; aborted 0; ready 8,206; failed final 0; superseded 1; wrong-handle recoveries 12,411; transient 4807 waits 37,235; data waits 0.

The repaired position-322 path proves the targeted fix: `GENERAL_10M_EXTENSION_DEADLINE` fired at the persisted deadline, the exact `OWNER_R_EXIT_GENERAL_10M_DEADLINE` authority received the narrow firewall bypass, close return code was 10009, execution delay was zero seconds, and realized profit was USD 394.20 (0.408R). The generic loss firewall was not broadly disabled.

## Advisor neutrality

Status: **PENDING — replay in progress**.

Required comparison covers entry time, direction, lots, SL, TP, core/pyramid role, all deal/exit times and prices, commission, swap, P&L, and final balance. Any mismatch is a failure requiring investigation.

## Validation already completed

- Focused EA/source and UTF-16 extractor tests: 14 passed
- Full backend suite: 351 passed across 21 test files
- Frontend: 29/29 tests passed across 5 suites
- Frontend optimized production build: passed
- Browser QA: desktop and mobile layouts had no horizontal overflow and no console errors
- GitHub main Frontend workflow at `9f6505a`: passed
- GitHub main Backend workflow at `9f6505a`: passed

Non-failing technical debt observed: FastAPI `on_event` deprecation warnings, Pydantic `dict` deprecation warnings, weak HMAC keys in test fixtures, Node/webpack deprecation warnings, and the expected console warning in the negative OneSignal network-failure test.

## Outlook forensic result

The 72-hour evidence contained 406 M10 analyses, 54 candidates, 19 final-arbiter ALLOW decisions, 6 execution calls, 11 exact outcomes (all canceled/non-confirmed), and 27 monitor POST failures. The M10-first authority contract, explicit state display, grouped history, notification eligibility, service-worker fail-safe, and lifecycle analytics were repaired. Production database/provider evidence and authenticated notification delivery remain unverified, so this area also remains a release HOLD.

## VPS and website

VPS staging/runtime/hash validation: **PENDING until advisor neutrality passes**. The test must use a new release-candidate-only directory and must not modify a live chart, stable file, profile, or Algo Trading state.

The production website currently advertises stable v6.25.8 with SHA-256 `3880eded56ee5c084002fa034bcd082dcdc664c09a039e5daf0e44f29b7a79e4`. That intentionally does not match the v6.25.24 candidate. No promotion was performed to manufacture a matching website result.

## Owner MT5 staging

The exact candidate is already present in the owner's local MT5 `MQL5/Experts` folder under the separate name `XAUUSD_AI_Sniper_EA_v6.25.24_FINAL_PRODUCTION_AUDIT`:

- MQ5 SHA-256: `56c91c3db8de4d1d119b7df646a8ef81d210c8286b3d2728ff7a0f9d1ff700a9`
- EX5 SHA-256: `346bd2ccff573cde2e273eb356ea454887c7e33a3fe092501753d547545b1e26`

It was not attached to any chart and no Algo Trading state was changed by this audit. The user's live terminal was observed running later in the audit, so no interaction with it was performed.

## Release decision

**HOLD.** Do not make v6.25.24 `current_version`, do not set `stable_status` true, do not distribute it as the customer download, and do not enable uncontrolled real-money trading. The extreme replay drawdown is a hard production blocker regardless of the remaining neutrality and VPS results.
