# Raw evidence provenance

Run: `V62524_M10_90D_20260422_20260721_RUN1`

The `raw/` directory contains only the three exact-run CSVs, the replay manifest/source-path record, the original final 5,000-line tester tail, a repaired UTF-8 key-event extraction, and targeted full-log extracts for positions 130 and 212. Unrelated historical files from the broad download bundle were deliberately excluded.

Source identity:

- version: `v6.25.24`
- build: `v62524-replay-consolidated-root-repair-20260722`
- MQ5 SHA-256: `e3309d9faafba868c3b94e405fd6f31f819e970156c374c6c2a57d360232314d`
- tester: XAUUSD M10, real ticks, 2026-04-22 through 2026-07-21, USD 10,000, leverage 1:100
- TradeBrain mode: collect-only; counter-excursion mode off

The original `V62524_90DAY_KEY_EVENTS.log` was empty because its source tail is BOM-less UTF-16BE. `scripts/extract_utf16_tester_events.py` detects BOM-less LE/BE data and fails if extraction is empty. The repaired output is `raw/V62524_90DAY_KEY_EVENTS_FIXED_UTF8.log`.

The complete agent log is not committed because it is 7.26 GB. Its path and original capture metadata remain in `raw/REPLAY_MANIFEST.txt`; the two incident extracts were produced directly from that file. `SHA256SUMS.txt` intentionally excludes itself, avoiding the invalid self-hash found in the supplied package.

Reproduce the structured audit from repository root:

```bash
python3 scripts/audit_v62524_replay.py
(cd analysis/tradebrain/V62524_M10_90D_20260422_20260721_RUN1 && sha256sum -c SHA256SUMS.txt)
```
