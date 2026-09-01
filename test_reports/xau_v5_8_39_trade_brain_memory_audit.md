# XAU v5.8.39 Trade Brain Memory Audit

## Goal

Give the EA persistent memory for every executed trade, not only blocked ideas.

The upgrade is intentionally conservative: first record and measure every trade, then let memory reduce or block only repeated weak patterns after enough samples. It does not blindly increase risk from memory.

## Added

- `InpTradeBrainMemory`
- `InpTradeBrainMinSamples`
- `InpTradeBrainReduceWR`
- `InpTradeBrainBlockWR`
- `InpTradeBrainMinPF`
- `InpTradeBrainBadDDProfitRatio`
- `InpTradeBrainWeakLotMulti`

## Persistent File

The EA writes to the MT5 common files area:

```text
XAUAI_ExecutedTradeBrain_<symbol>.csv
```

It records both `OPEN` and `CLOSE` events.

## Recorded Fields

- position id
- symbol
- direction
- setup
- grade bucket
- ML/hive signature
- regime
- session
- entry price
- exit price
- lot size
- SL/TP
- profit
- worst floating drawdown
- seconds spent negative
- outcome label
- exit reason
- full entry reason/timing audit
- setup score
- combined score
- ATR
- AI confidence

## Behavior

Before a new trade, the EA checks similar closed trades:

- same symbol
- same direction
- same setup
- compatible grade bucket or exact signature

If sample count is below `InpTradeBrainMinSamples`, memory is audit-only.

If enough samples exist:

- weak but not disastrous patterns reduce lot size
- very poor expectancy patterns are blocked
- profitable trades that needed deep drawdown before small profit are treated as poor entry quality

## Why This Is Not Blind Strictness

The brain does not block simply because a filter says so. It requires actual executed-trade outcomes. If there is not enough data, it logs and stands aside from changing behavior.

## Verification

- `python3 -m py_compile backend/server.py backend_test.py`
- `python3 -m pytest tests/test_broker_linking_static.py -q`
- `npm run build`

MQL5 syntax still needs final MetaEditor compile with `F7`.
