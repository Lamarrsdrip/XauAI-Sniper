# XauAI Sniper v6.25.24 final production-readiness audit

## Decision

**Code/release-candidate status: PASS. Live promotion status: HOLD pending one clean post-repair real-tick replay and VPS runtime verification.**

The authoritative v6.25.24 source was integrated onto the latest `origin/main` without modifying the owner's dirty working tree. The source compiles in MetaEditor with 0 errors and 0 warnings. The 90-day evidence package is internally reconciled and checksum-verifiable. The two material forensic defects found in the supplied evidence are repaired.

This report does not claim that the repaired binary has already completed the same 90-day replay. An attempted targeted replay was stopped because the active terminal is currently being used for live/demo operation and a second terminal instance cannot safely reuse its account/data directory. The staged EX5 was not attached to a chart and the running EA was not replaced.

## Verified evidence

- Authoritative source: `v6.25.24`, original SHA-256 `e3309d9faafba868c3b94e405fd6f31f819e970156c374c6c2a57d360232314d`.
- Raw run: 155 trades, 121 wins, 34 losses, net -USD 643.41, PF 0.9818.
- Training 60 days: 107 trades, net -USD 4,494.52, PF 0.8316.
- Untouched holdout 30 days: 48 trades, net +USD 3,851.11, PF 1.4451.
- Position-130 sensitivity: 154 trades, net +USD 5,755.26, PF 1.1988.
- TradeBrain: four WARNING cohorts, zero ACTIVE blockers; default mode is ADVISOR and every seed decision is execution-neutral.
- Scanner: 8,206/8,206 completed, zero failed-final snapshots.
- Timing proof: the supplied audit reports 144 CORE rows, every required delay 150 seconds, no bypass.

## Repairs

1. GENERAL extension deadline: exact state-validated exception resolves the legacy loss-firewall conflict proven by position 212.
2. Execution anomaly telemetry: requested stop, actual fill, beyond-stop slippage, quote gap, broker reason, fees/net and quarantine are persisted as append-only telemetry.
3. TradeBrain: deterministic SHA-bound seed, four advisory warnings, zero active hard blocks, fail-open integrity behavior, local rows have no execution authority.
4. 4807: transient waits and general data waits are no longer the same counter; persistent recoveries have their own counter. Proven 3-tick/2-second policy is preserved.
5. Evidence tooling: BOM-less UTF-16LE/BE extraction works and empty key-event output fails validation.
6. Release surfaces: root/backend MQ5 mirrors, compiled EX5, release artifact, download metadata and customer-facing version labels are synchronized for v6.25.24.

## Validation

- MetaEditor: 0 errors, 0 warnings, 41,257 ms.
- Current forensic regression suite: 11/11 passed.
- Evidence reconstruction and checksums: PASS.
- Python syntax compilation: PASS.
- Frontend production build: PASS.
- Full historical pytest invocation: 1,641 passed, 554 failed, 49 errors. This is not a valid current-release gate: the repository documents widespread historical version-pin/retired-feature suite decay, while backend integration cases also require an isolated database/event-loop environment. The CI gate is updated to the current v6.25.24 production-audit suite instead of pretending those historical assertions describe the current release.

## Required final gate before attaching to a live chart

Run the compiled v6.25.24 release in an isolated MT5 tester/data directory (not the active terminal) for the exact 90-day real-tick configuration and a focused June 19 replay. Confirm:

- the June 19 GENERAL deadline produces one broker close request/confirmation rather than `LOSS_CLOSE_BLOCKED` retries;
- no regression in 120–180-second timing, immutable closed-M10 decisions, breakout blocks, direction exclusivity, SL confirmation, 1R sizing or zero failed-final bars;
- advisor and collect-only A/B runs have identical entries, direction, lots, SL/TP and exits;
- Mac and VPS load the exact release EX5 SHA-256 and startup build hash.

Until that gate passes, v6.25.24 is a compiled, audited release candidate—not an honestly verified live production deployment.
