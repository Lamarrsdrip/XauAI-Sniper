# Commands and results ledger

Secrets and raw credential-bearing startup lines are intentionally excluded. Temporary replay configuration files are mode `0600` and are not committed.

## Source, build, and Git

- `shasum -a 256` was used for original, repaired, staged, release, and compiled artifacts.
- MetaEditor64 compiled the repaired MQ5 through Wine: 0 errors, 0 warnings, 41,257 ms.
- `git diff --check`: passed.
- `git push origin HEAD:main`: pushed `af260a4..9f6505a`.
- `git ls-remote origin refs/heads/main`: `9f6505a68ccbb3b993dc8c00be63dcf180e4904a`.
- GitHub Actions: Frontend and Backend both passed for `9f6505a`.

## Tests

- `/usr/bin/python3 -m pytest -q tests/test_xau_v62524_final_production_audit.py tests/test_utf16_tester_event_extractor.py`: 14 passed.
- Each `backend/tests/test_*.py` file run separately with pytest: 351 passed across 21 files.
- `CI=true npm test -- --watchAll=false --runInBand`: 29/29 passed across 5 suites.
- `npm run build`: optimized production build passed.

## Backup verification

- `shasum -a 256 FILE_INVENTORY.tsv FILE_SHA256SUMS.txt README.txt`: all three match the recorded hashes.
- `wc -l FILE_INVENTORY.tsv FILE_SHA256SUMS.txt`: 1,542 rows each.

## Replay

- Isolated Wine/MT5 Strategy Tester invocation used the collect config and then the advisor config. Config files contain no uncontrolled live-trading enablement.
- Collect pass: completed; report and key events preserved.
- Advisor pass: running.
- `scripts/compare_mt5_replay_neutrality.py`: pending advisor report.

## Website

- `curl -fsS --max-time 20 https://xauaisniper.com/api/download/info`: production reports stable v6.25.8 and checksum `3880eded56ee5c084002fa034bcd082dcdc664c09a039e5daf0e44f29b7a79e4`.

## Cleanup

Pending until replay evidence and VPS checks are complete. Cleanup scope is limited to explicitly inventoried tester journals, isolated replay journals, temporary credential configs, and the obsolete screenshot. Stable EAs, settings, profiles, and account configuration are excluded.
