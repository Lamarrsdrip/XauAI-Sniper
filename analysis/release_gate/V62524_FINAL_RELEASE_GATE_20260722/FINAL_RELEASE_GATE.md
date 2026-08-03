# v6.25.24 final production release gate

Audit date: 2026-07-22  
Candidate build: `v62524-final-production-audit-20260722`  
Production verdict: **HOLD — DO NOT PROMOTE TO STABLE OR ENABLE UNCONTROLLED REAL-MONEY TRADING**

## Executive result

The repaired candidate compiles cleanly and the first exact 90-day real-tick replay completed. The repaired GENERAL ten-minute deadline authority fired and closed normally in the replay. However, the replay's risk performance is not production-safe: maximal balance drawdown was 72.58% and maximal equity drawdown was 73.76%. This alone keeps the release on HOLD even though the run ended with a small positive net profit.

The advisor-neutrality replay completed and passed exactly. VPS staging and an isolated compile probe also passed. The published website download remains stable v6.25.8; v6.25.24 has not been promoted.

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

Status: **PASS**.

The comparator checked entry time, direction, lots, SL, TP, core/pyramid role, every deal and exit time/price, commission, swap, P&L, and final balance. Every comparison was identical: 161 entries, 12 pyramids, and final balance USD 10,335.92. The collect raw report SHA-256 is `f0321b7d592d4beeae20ffc9315085a0977c7bc898f6d2ce3409b54acb2096da`; advisor raw report SHA-256 is `229eddcdde3f5a867f9515443a11c40bfb10739950903984925e3516f6cbeb2d`.

This proves the advisory seed did not change trades. It has no active hard blocks: the historical training set had no exact fingerprint with the required 20 decisive training samples. Four warning cohorts remain observational only, and no broad direction/setup/session blocker was activated.

Independently re-verified at closeout: `scripts/compare_mt5_replay_neutrality.py` was re-run against the two raw tester reports and reproduced the identical PASS result and both raw SHA-256 values above. A byte-level diff of the two full sanitized HTML reports showed the only differences were the three expected input-set fields (`InpGlobalTradeBrainMode`, the collection run ID, and the Wine/tester build number embedded by MetaQuotes); every order, deal, exit, and summary statistic (161 trades, 112 wins, 49 losses, gross profit USD 32,416.35, gross loss USD -32,080.43, net USD +335.92) was confirmed identical between collect and advisor reports directly from the raw report contents.

## Replay journal preservation

The two full UTF-16LE MT5 journals behind the collect and advisor passes were hashed and spot-verified before deletion (isolated Wine tester sandbox output, not part of this Git repository):

- Collect journal `20260722_collect_preserved.log`: 6,128,800,344 bytes, SHA-256 `b9a208e38ddc0077ccc1e75a53868b7f50f03a8afaf5ac9bafeb3fe03d1bcc42`
- Advisor journal `20260722_advisor_preserved.log`: 6,128,799,122 bytes, SHA-256 `93cbaf608f3469cd4db07b41ddb2e848f23c2e3be78218c64ea348dd5ef0c540`

Both files were confirmed closed (not held open by any process) before hashing. A distinctive marker line from each committed `*_KEY_EVENTS_UTF8.log` extract was located inside its corresponding raw journal via a full UTF-16LE-to-UTF-8 stream conversion, confirming the committed extracts are a genuine subset of these exact journals and not fabricated. The two ~6.1 GB raw journals were deleted after hashing; the committed `COLLECT_KEY_EVENTS_UTF8.log` / `ADVISOR_KEY_EVENTS_UTF8.log` extracts and the sanitized HTML reports remain as reproducible evidence.

## Historical training and holdout

The original source replay had 155 trades, 121 wins, 34 losses, USD -643.41 net, and PF 0.9818. The chronological 60/30 split was based on entry time: first 60 days had 107 trades, 84/23 W/L, USD -4,494.52 net, PF 0.8316; the untouched final 30-day holdout had 48 trades, 37/11 W/L, USD +3,851.11 net, PF 1.4451. Position 130 was quarantined from learning as a -5.576R execution-gap/slippage anomaly.

The new repaired replay's 49 losses are not caused by TradeBrain: collect-only and advisor modes are identical. Its much worse risk profile is evidenced directly by the 72.58%/73.76% drawdown and the average-loss/average-win asymmetry.

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

VPS staging/hash validation: **PASS**. A new directory `C:\XAUAI_RELEASE_CANDIDATE_TEST\v6.25.24_20260722` was created; no live chart, stable file, profile, or Algo Trading state was changed. The staged MQ5 and EX5 matched the Mac candidate hashes exactly. A separate filename-only MetaEditor compile probe completed with 0 errors and 0 warnings in 50,040 ms. Its differently named probe EX5 hash was `7008d4c16d8d88f54a7f8ea4bce897851b64cd432776334b96fae4f1e88042a8`; it was not substituted for the exact candidate.

A controlled attached-terminal/broker runtime smoke test is **not proven**: the VPS terminal was already running, and attaching an EA or changing its chart configuration would violate the no-uncontrolled-live-trading constraint.

Closeout scope note: this VPS staging/hash claim is carried forward as originally reported and was not re-executed during closeout — this closeout pass had no VPS network access or credentials available to it. The Mac-side candidate hashes it depends on (root, backend, and the original owner-Experts staging) were independently re-verified locally; see the Owner MT5 staging correction below for one hash that has since drifted on the Mac side after staging.

The production website currently advertises stable v6.25.8 with SHA-256 `3880eded56ee5c084002fa034bcd082dcdc664c09a039e5daf0e44f29b7a79e4`. That intentionally does not match the v6.25.24 candidate. No promotion was performed to manufacture a matching website result.

## Owner MT5 staging

The candidate source is present in the owner's local MT5 `MQL5/Experts` folder (`net.metaquotes.wine.metatrader5` prefix) under the separate name `XAUUSD_AI_Sniper_EA_v6.25.24_FINAL_PRODUCTION_AUDIT`:

- MQ5 SHA-256: `56c91c3db8de4d1d119b7df646a8ef81d210c8286b3d2728ff7a0f9d1ff700a9` — **independently re-verified at closeout: matches exactly.**
- EX5 SHA-256 (as originally staged): `346bd2ccff573cde2e273eb356ea454887c7e33a3fe092501753d547545b1e26`

**Closeout correction:** re-hashing the `.ex5` currently sitting in that Experts folder at closeout returned `e102f57584eefd7600c93b7ef783980f8075b811fd448ad5651a0247655563d1` (1,417,406 bytes), not the audited candidate hash (1,430,626 bytes). The file's mtime (15:34 local) is later than every other candidate-hash evidence in this report, indicating it was recompiled locally after staging — most likely MetaEditor auto-compiling on open, the same phenomenon documented in the VPS section where a differently-named probe compile also produced a non-matching hash from identical source. The `.mq5` source is unaffected and still matches exactly. **This means the exact audited EX5 binary is not currently staged in the owner's Experts folder; only the exact source is.** This was not corrected by this closeout pass — no file in the live terminal's data directory was modified, consistent with the safety boundary against touching the live MT5 installation.

It was not attached to any chart and no Algo Trading state was changed by this audit or by this closeout pass. The user's live terminal process was not running during closeout verification (`terminal64.exe` / `MetaEditor64.exe` both absent from `ps aux`), so no interaction with a running instance was possible or attempted.

## Release decision

**HOLD.** Do not make v6.25.24 `current_version`, do not set `stable_status` true, do not distribute it as the customer download, and do not enable uncontrolled real-money trading. The extreme replay drawdown (72.58% balance / 73.76% equity) is a hard production blocker on its own, independent of every other check in this report. The attached-terminal VPS smoke test, website candidate-download hash, production database/provider proof, authenticated notification delivery, continuous live heartbeat, and a byte-identical EX5 staged in the owner's Experts folder (see closeout correction above) all remain unproven or have since drifted.
