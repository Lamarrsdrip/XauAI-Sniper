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
- Advisor pass: completed; report and key events preserved.
- `scripts/compare_mt5_replay_neutrality.py`: PASS — all entry orders, deals/exits, and final balance identical.

## Website

- `curl -fsS --max-time 20 https://xauaisniper.com/api/download/info`: production reports stable v6.25.8 and checksum `3880eded56ee5c084002fa034bcd082dcdc664c09a039e5daf0e44f29b7a79e4`.

## VPS

- Read-only process inspection found a running VPS `terminal64.exe`; no chart interaction was performed.
- A new candidate-only directory was created and received the exact MQ5 and EX5 through SCP.
- PowerShell `Get-FileHash` confirmed both hashes match the Mac candidate exactly.
- A copied filename-only MQ5 compile probe ran through the VPS MetaEditor: 0 errors, 0 warnings, 50,040 ms.
- No terminal attach/broker runtime test was attempted because the live terminal was already running.

## Closeout verification (this pass)

- `git fetch origin` then `git rev-parse HEAD origin/main`: both `afa6a6f...`, no drift before edits.
- `shasum -a 256` re-run on `XAUUSD_AI_Sniper_EA.mq5`, `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, `XAUUSD_AI_Sniper_EA.ex5`, `backend/ea_releases/v6.25.24/XAUUSD_AI_Sniper_EA_v6.25.24.ex5`: all match the recorded candidate hashes.
- `shasum -a 256` on the owner's Experts-folder `.mq5`/`.ex5`: `.mq5` matched; `.ex5` did **not** match (see FINAL_RELEASE_GATE.md closeout correction) — recorded, not modified.
- `python3 scripts/compare_mt5_replay_neutrality.py` re-run directly against the two raw tester HTML reports in `tester_sandbox/MT5_Isolated/`: reproduced the exact PASS result and both raw SHA-256 values already on file.
- Full byte-level Python diff of the two sanitized HTML reports (tags stripped) confirmed only the three expected input-set fields differ; all trade data, summary statistics, and drawdown figures are identical between collect and advisor.
- `iconv -f UTF-16LE -t UTF-8` streamed over both ~6.1 GB raw journals and grepped for a distinctive line from each corresponding committed `*_KEY_EVENTS_UTF8.log`: found exactly once in each, confirming the committed extracts are genuine subsets of the raw journals.
- `shasum -a 256` on both raw journals (after confirming via `lsof` that neither was held open by a running process): recorded in FINAL_RELEASE_GATE.md under "Replay journal preservation."
- `cat test_reports/metaeditor_v62524_final.log`: confirmed the literal MetaEditor result line `0 errors, 0 warnings, 41257 ms elapsed`.
- `ps aux | grep -i "terminal64\|metaeditor\|MetaTrader"`: no MT5 process running during this closeout pass.

## Cleanup

Completed at closeout. Removed after their hashes/content were recorded above and in FINAL_RELEASE_GATE.md:

- Two raw UTF-16LE replay journals (`tester_sandbox/MT5_Isolated/Tester/logs/20260722_{collect,advisor}_preserved.log`, ~6.1 GB each) — outside this Git repository, hashed and spot-verified first, then deleted.
- Two temporary Strategy Tester credential configs (`tester_sandbox/v62524_final_audit/{collect,advisor}.ini`, mode 0600, contained a MetaQuotes-Demo login/password) — outside this Git repository, deleted.
- One obsolete duplicate screenshot (`test_reports/outlook_mobile_390x844_20260722.png`) superseded by the already-committed `test_reports/outlook_mobile_viewport_390x844_20260722.png` — not staged for commit, deleted.

Not touched: stable EAs, settings, profiles, account configuration, the live MT5 data directory, source code, final reports, hash manifests, or any MQ5/EX5 candidate file (including the mismatched owner-Experts `.ex5`, left as found per the live-terminal safety boundary).
