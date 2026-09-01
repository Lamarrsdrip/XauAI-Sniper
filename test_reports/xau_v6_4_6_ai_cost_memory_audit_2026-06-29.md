# XAU AI Sniper v6.4.6 AI Cost + Conscious Memory Audit

Date: 2026-06-29

## Scope

This follow-up audit extends the v6.4.6 live-exit investigation without undoing the v6.4.3 anti-overprotective redesign. The changes do not add rigid daily trade freezes, hard pauses, recovery disables, strategy disables, or consecutive-loss lockouts. The new limits are only LLM spending controls; when an AI call is skipped, the EA continues evaluating locally.

## Files Inspected / Changed

- `XAUUSD_AI_Sniper_EA_v6.4.6.mq5`
- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- `backend/server.py`
- `tests/test_ai_cost_memory_static.py`
- Existing audit context: `test_reports/xau_v6_4_6_live_audit_2026-06-29.md`
- Runtime evidence checked: MetaEditor log and MT5 MQL5 journal for 2026-06-29.

## Exact Version

- EA version remains `v6.4.6`.
- Root EA and backend copy are synchronized.
- MetaEditor compile result: `XAUUSD_AI_Sniper_EA_v6.4.6.mq5 - 0 errors, 1 warnings`.

## Key Findings

### 1. LLM Calls Were Too Easy To Spend

Risk: Medium

Impact on live trading: Yes, cost impact. Behavior impact was indirect because repeated AI calls could add latency and inconsistent external responses.

Evidence:

- Backend entry analysis previously prepared Claude and GPT calls together for a normal market analysis path.
- Exit analysis could call the LLM repeatedly for similar position states.
- No shared market-state hash, daily call accounting, cache stats, or skip diagnostics existed at the backend layer.

Fix:

- Added market-state hash caching.
- Added minimum call spacing and daily LLM call budget.
- Added local-only responses for low-quality/no-trade states.
- Kept high-impact calls available for major entry confirmation, exit conflict, news reaction, and strong hold/close decisions.
- GPT is now conditional instead of automatic; Claude is primary and GPT is only used when the confidence gap or impact justifies a second paid opinion.

### 2. Memory Needed Aggregate Evidence, Not Single-Trade Imitation

Risk: High if implemented naively

Impact on live trading: Yes, if memory overfits. The implementation prevents that by making memory a recommendation layer.

Evidence:

- Existing blocked-trade and trade-brain data existed, but there was no broad conscious memory record tying entry, exit, MFE, MAE, spread, news state, confirmations, and post-close opportunity cost together.
- User requirement explicitly rejected "last trade worked, do it again" behavior.

Fix:

- Added conscious memory records for trades, post-close outcomes, and blocked-trade follow-up.
- Added similarity lookup and confidence tiers:
  - 1 similar memory = information only
  - 5 similar memories = weak influence
  - 20+ similar memories = strong influence
  - 50+ similar memories = trusted pattern
- Memory can reduce early-exit pressure or make modest lot adjustments only from aggregate evidence.
- Emergency safety remains outside memory influence.

### 3. Winners Could Still Be Choked By Rule-Based Exits

Risk: High

Impact on live trading: Yes. This directly relates to large-lot trades closing for tiny profit.

Evidence:

- The v6.4.6 live audit already identified AMPL/profit protection as capable of locking too early after a small favorable move.
- Runtime journal showed active `EXIT-BRAIN CHECK` entries that measure whether exits left more movement behind.

Fix:

- Conscious memory now records early-exit outcomes.
- If aggregate memory shows similar setups often left profit after early exits, the EA applies a temporary hold bias that reduces early-exit pressure on profitable trades.
- This does not force holding losers and does not disable emergency exits.

### 4. VPS/Mac Differences Needed Better Diagnostics

Risk: Medium

Impact on live trading: Yes. Different inputs, compiled EX5, spreads, broker feed, latency, and symbol details can produce different behavior.

Evidence:

- v6.4.6 diagnostics already added build hash, input hash, broker/account/symbol/timeframe/magic/spread state.
- Cost and memory settings were not yet part of the input hash.

Fix:

- Added AI cost settings into `XAUAI_InputHash()`.
- Dashboard now shows AI cost state and memory influence so VPS/Mac screenshots can be compared directly.

## New Diagnostics

EA dashboard/report now includes:

- EA version
- Build hash
- Input hash
- Account number
- Broker
- Symbol
- Digits
- Point
- Spread now
- Average spread
- Magic number
- News state
- Trade state
- Exit engine state
- Last trade reason
- Last exit reason
- AI calls today
- Estimated tokens/cost today
- AI cache hits
- AI skipped calls
- Last AI call reason
- Last AI skip reason
- Memory influence tier
- Latest memory recommendation

Backend diagnostics:

- `GET /api/ai/cost/stats`
- `POST /api/ai/memory/record`
- `POST /api/ai/memory/query`
- `GET /api/ai/memory/report`

## Memory Storage

EA local files:

- `XAUAI_ConsciousMemory_<account>_<symbol>.csv`
- `XAUAI_LearningReport_<account>_<symbol>.md`

Backend files:

- `backend/ai_trade_memory.jsonl`
- `backend/ai_trade_memory_report.md`

## Recommended Tests Next

- Run both VPS and Mac terminals with the same `.set` file and verify identical `Input hash`.
- Confirm the terminal chart shows the same `Build hash` as the copied v6.4.6 EX5.
- Compare the dashboard fields after the next three trades:
  - spread now / average spread
  - AI calls today
  - AI cache hits
  - AI skipped calls
  - last AI call/skip reason
  - memory influence
  - last exit reason
- Inspect `XAUAI_ConsciousMemory_<account>_<symbol>.csv` after each closed trade.
- Inspect `XAUAI_LearningReport_<account>_<symbol>.md` for aggregate recommendations.
- Use backend `GET /api/ai/cost/stats` after a live session to confirm reduced LLM usage.

## Verification

- `pytest -q tests/test_ai_cost_memory_static.py tests/test_xau_v646_live_audit_static.py`
  - Result: `11 passed`
- `python3 -m py_compile backend/server.py`
  - Result: passed
- `git diff --check`
  - Result: passed
- MetaEditor compile:
  - Result: `0 errors, 1 warnings`

