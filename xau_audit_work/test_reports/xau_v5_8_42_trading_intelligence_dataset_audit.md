# XAUAI v5.8.42 Trading Intelligence Dataset Audit

Date: 2026-06-03

## Goal

Make the EA reports the source of truth instead of relying on screenshots or MT5 screen watching.

## Added

- `InpTradingIntelDataset`: writes unified CSV rows to `XAUAI_TradingIntelligence_<SYMBOL>.csv`.
- `InpTradingIntelJson`: writes matching JSONL rows to `XAUAI_TradingIntelligence_<SYMBOL>.jsonl`.
- Executed trade mirroring:
  - `OPEN`
  - `CLOSE`
  - `POST_CLOSE`
- Blocked trade mirroring:
  - `BLOCKED`
  - `BLOCK_CHECK`
- Cloud telemetry mirroring while cloud is still enabled:
  - `CLOUD_SIGNAL`
  - `CLOUD_CLOSE`
  - `CLOUD_PARTIAL`

## Dataset Fields

The unified dataset records:

- event type
- decision id
- position id
- symbol
- direction
- setup
- grade
- signature
- regime
- session/hour
- decision owner
- action
- reason key
- setup score
- combined score
- ATR
- price/entry/exit
- lots
- SL/TP
- profit
- worst floating drawdown
- seconds negative
- blocked checkpoint
- favorable/adverse ATR after block
- entry reason
- exit reason
- cloud signal id
- cloud HTTP code
- cloud success/failure
- extra diagnostic text

## Analyzer Upgrade

`backend/analytics/xau_attribution_report.py` now accepts:

```bash
python3 backend/analytics/xau_attribution_report.py \
  --executed XAUAI_ExecutedTradeBrain_XAUUSD.csv \
  --blocked XAUAI_BlockedTradeMemory_XAUUSD.csv \
  --intel XAUAI_TradingIntelligence_XAUUSD.csv \
  --days 7 \
  --out weekly_report.md
```

The report now includes Trading Intelligence diagnostics for:

- win rate sanity
- A/A+ losing trades
- profitable blocked trades
- late/missed-move entries
- drawdown-before-recovery trades
- early exits that left profit
- cloud copy/fanout failures

## Verification

- `python3 -m py_compile backend/analytics/xau_attribution_report.py backend/server.py`
- `python3 -m pytest tests/test_xau_v5842_trading_intelligence_static.py tests/test_xau_attribution_report.py -q`

Result: pass.
