# Data integrity audit — V62524_M10_90D_20260422_20260721_RUN1

- Status: PASS
- Source identity: `v6.25.24` / `v62524-replay-consolidated-root-repair-20260722` / `e3309d9faafba868c3b94e405fd6f31f819e970156c374c6c2a57d360232314d`
- Raw events: OPEN=155, CLOSE=155, POST_CLOSE=775
- Join: 155 one-to-one positions; duplicate OPEN=0; duplicate CLOSE=0; conflicting outcomes=0
- Timing-proof rows: 144; blocked-opportunity rows: 900
- Entry features come only from OPEN rows; future labels come only from CLOSE rows. Split uses entry time with holdout starting `2026-06-22 00:00:00`.
- Seed SHA-256: `5b7791dccdac89d007723dc38c91b3ba773e76acbdf9922e3d9020992f991b6c`; ACTIVE hard blocks=0; WARNING cohorts=4.
- Position 130 is retained in raw performance and excluded from learning (`learning_eligible=N`).
