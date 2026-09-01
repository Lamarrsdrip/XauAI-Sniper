# XAU AI Sniper v6.4.6 Live Audit - 2026-06-29

## Executive Summary

Latest `main` was already up to date. The exact v6.4.6 source is:

- `XAUUSD_AI_Sniper_EA_v6.4.6.mq5`
- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`

After this audit, both files are byte-identical.

Version issue found and fixed:

- Before: file name/header/runtime said v6.4.6, but `#property version` was still `6.4.5`.
- After: `#property version "6.4.6"` and runtime constants report `v6.4.6`.

Source SHA256 after fix:

- MQ5 source: `24f1b5bbc24f6c4f389ec1be91f5f1941b8a60f58ea031821018597a6f095af6`
- EX5 build: `1ee06a20a8b66720d9b0b1edd3f0d9510906b8176ebac8286005d8c24b490088`

## Last 3 Screenshot Trades First

### Trade 1 - XAUUSD sell 0.16, 4057.69 -> 4045.93, +188.16, 2026-06-29 08:32:20

Status: not found in this Mac terminal's local 2026-06-29 MT5 logs by price, lot, or profit.

Evidence searched:

- `MQL5/Logs/20260629.log`
- terminal `logs/20260629.log`
- exact strings: `4057.69`, `4045.93`, `188.16`, `sell 0.16`

Interpretation:

- This trade is likely from the VPS account or another terminal/history export, not the Mac terminal logs available here.
- It cannot be proven locally whether it was v6.4.6, inherited, basket-managed, or manually/externally closed.

Required next evidence:

- VPS `MQL5/Logs/20260629.log`
- VPS terminal `logs/20260629.log`
- VPS `MQL5/Experts/XAUUSD_AI_Sniper_EA_v6.4.6.ex5` timestamp/hash
- the `.set` or exported input parameters from the chart

### Trade 2 - XAUUSD sell 0.43, 4037.43 -> 4037.39, +1.72, 2026-06-29 13:58:54

Status: not found in this Mac terminal's local 2026-06-29 MT5 logs by price, lot, or profit.

Evidence searched:

- `4037.43`, `4037.39`, `$1.72`, `Lots=0.43`, `sell 0.43`

Interpretation:

- This is likely from the VPS account, a different account in screenshots, or a terminal log not present here.
- The same failure mode as the 0.36 trade is plausible, but not proven without the VPS/source account log.

### Trade 3 - XAUUSD sell 0.36, 4037.52 -> 4037.41, +3.96, 2026-06-29 13:58:54 screenshot time

Status: proven in Mac logs. It was opened by v6.4.6 and closed by a broker SL that AMPL moved to tiny profit.

Evidence:

- EA log: `MQL5/Logs/20260629.log:5394` lot calculation.
- EA log: `MQL5/Logs/20260629.log:5395` executing sell 0.36 at requested price 4037.56.
- Trade log: terminal `logs/20260629.log:116` filled sell 0.36 at 4037.52.
- EA log: `MQL5/Logs/20260629.log:5412` AMPL moved SL from 4051.80 to 4037.41:
  - trigger `GIVEBACK_90%`
  - current profit `$7.16`
  - peak `$71.64`
  - retrace `90%`
  - lock approximately `$7.16`
- Trade log: terminal `logs/20260629.log:119-121` broker accepted the SL modification to 4037.41.
- Trade log: terminal `logs/20260629.log:122` close deal at 4037.41.
- EA log: `MQL5/Logs/20260629.log:5431` final close:
  - profit `$3.96`
  - bestFloating `$72.36`
  - worstFloating `$-20.16`
  - `exitReason=` blank before this audit fix.
- EA log: `MQL5/Logs/20260629.log:5421` AI Director wanted to hold:
  - "Position only 3 min old with small profit... Let trade develop..."

Root cause:

- AMPL was not a market panic close.
- AI did not order the exit.
- Remote command did not order the exit.
- The exit came from AMPL tightening the SL after the trade gave back 90% of a meaningful peak.
- The code allowed AMPL to place a stop that retained only the tiny remaining current profit, not a meaningful share of the best floating profit.

Conclusion:

- The bot did not close instantly at random. It opened, saw about `$72` peak floating profit, retraced hard, AMPL moved SL to 4037.41, then broker SL closed at that level.
- This exactly explains "large lot, tiny profit."

## Why Mac and VPS / Accounts Can Differ

Risk level: high for live interpretation, medium for code correctness.

Reasons same source can behave differently:

1. Different compiled EX5 attached.
   - Mac had v6.4.5 and v6.4.6 EX5 files side-by-side.
   - Before this audit, v6.4.6 source still declared `#property version "6.4.5"`, making identity ambiguous.

2. Different inputs.
   - No `.set` files were found in the repo or Mac `MQL5/Profiles/Tester`.
   - Inputs like magic, risk mode, news, spread, AMPL, basket, partials, and cloud fanout can materially alter behavior.

3. Different broker feed/spread.
   - News aftermath and spread classifiers use local spread EMA and live tick stream.
   - If VPS and Mac see different spread spikes, one may block, delay, or allow a later trade.

4. Different execution timing.
   - Entry scan is M5-bar/timer/tick dependent.
   - Local logs show indicator buffer warmups/rebuilds on earlier days; timing can shift a signal by a bar.

5. Same magic on same account.
   - `InpMagicNumber = 20250401`.
   - Management filters by symbol + magic.
   - If two terminals run same account, symbol, and magic, they can manage each other's positions.
   - If they are truly different accounts, magic cannot cross accounts.

6. Local learning/brain files differ.
   - TradeBrain, blocked memory, strategy weights, and cloud state can be local-terminal dependent.
   - The Mac `MQL5/Files` folder only showed `AIS_Patterns_XAUUSD.bin`; no full trade-brain CSV was available locally.

## v6.4.5 to v6.4.6 Change Summary

Observed from source diff:

- News aftermath timer fix: no longer resets on every tick while spread remains elevated.
- Spread classifier: labels spread widening as news spike, broker noise, rollover, Sunday open, or low liquidity.
- Post-news state machine: aftermath/discovery/confirmed/allowed/avoid.
- Early conviction cut: cuts losing trades faster only when failure is confirmed.
- AMPL defaults widened: later arm and more breathing room, but still had the tiny-lock defect fixed in this audit.
- Volatility lot cap: reduces size in abnormal ATR expansion.

## Over-Protective Logic Sweep

This audit preserved Claude's v6.4.3/v6.4.5 philosophy: no hard daily freeze, no hard consecutive-loss lockout, no strategy disable after normal losses, and no fear-based paralysis.

### Already Adaptive / Good

| Mechanism | File/function | Why it exists | Downside | Profit impact | Recommendation |
|---|---|---|---|---|---|
| Daily loss trigger | `OnTick`, `InpDailyLossLimit` line 795, logic around 6763 | Stop normal risk escalation after bad day | Old versions hard-stopped; current v6.4.6 adapts | Helps if it stays adaptive | Keep. It switches to A/A+ and reduced size, not full pause. |
| Consecutive loss cooldown | inputs line 540, `RegisterClosedTradeCooldown` around 15268 | Avoid B-grade trading after repeated losses | Hard freeze misses recovery moves | Current default helps profitability | Keep defaults `0`; regression test added. |
| EPF hard daily DD | inputs line 514 | Catastrophic guard | Hard DD blocks can paralyze | Disabled by default | Keep disabled; use adaptive tiering only. |
| Streak pause | input line 878 | Avoid emotional overtrading | Hard pause misses reversals | Disabled by default | Keep disabled; regression test added. |
| Direction lockout | input line 882 | Avoid repeated same-side bias | Can block the correct trend after stop-hunt | Disabled by default | Keep disabled unless data proves benefit. |
| SmartGuard expectancy | `XAU_TradeBrainPreEntry` | Avoid repeating statistically bad patterns | Can overfit local sparse data | Mostly helps if soft | Keep hard veto only with large samples/strong negative expectancy. |
| Volatility lot cap | lines 7916+ | Avoid oversized losses when ATR inflates | If too aggressive, under-sizes best news trends | Helps risk-adjusted growth | Keep. It scales lot, does not freeze. |

### Still Strict but Operationally Justified

| Mechanism | File/function | Why it exists | Hidden downside | Live impact | Recommendation |
|---|---|---|---|---|---|
| License invalid | `OnTick` around 6612 | Prevent unauthorized/misconfigured operation | No trading if PIN wrong | Affects live | Keep hard block. Not a market decision. |
| Broker/terminal algo disabled | heartbeat/status | Trading impossible or unsafe | None | Affects diagnostics only | Keep. |
| Invalid indicator buffers | `CopyEntryBuffer` and startup warmup | Avoid trading corrupted/unready indicators | May miss a bar after terminal reload | Affects live | Keep; this is true data integrity protection. |
| Spread too wide | `OnTick` around 7045, `SpreadKillReason` | Avoid bad fills/news microstructure | May miss early recovery after spread normalizes | Affects live | Keep but monitor. v6.4.6 fixed endless aftermath timer. |
| Scheduled calendar blackout | `IsScheduledNewsWindow` | Avoid known high-impact windows | Can block valid post-news trend | Affects live | Keep only for true events; disable stale custom windows. |
| Margin check | `OpenTrade` | Avoid margin danger/rejection | Can downsize or skip | Affects live | Keep hard; this is broker survival. |
| Prop firm hard loss lock | `PropFirmLossLockReason` and `OnTick` | Avoid violating firm rules | Blocks recovery close to hard limit | Affects prop accounts | Keep hard only because external rule breach can end account. |
| Equity protect 70% | `InpEquityProtect` line 1165, `OnTick` 6710 | Catastrophic account survival | Hard close/stop after severe drawdown | Affects live if equity collapses | Keep as extreme off-switch; set 0 if not desired. |

### Profit-Hurting / Fixed in This Audit

| Problem | File/function | Evidence | Risk | Live impact | Fix |
|---|---|---|---|---|---|
| AMPL allowed tiny stop lock after meaningful peak | `ManageCleanExitsForPosition`, AMPL block | Live 0.36 sell: peak ~$72, locked ~$7, final +$3.96 | High | Yes | Added minimum current-profit and retained-peak lock requirements. AMPL now logs `AMPL_GIVEBACK_HOLD_TINY_LOCK` and holds runner if the proposed lock is too small. |
| Exit reason blank on SL/TP closes | `OnTradeTransaction` | Live trade showed `exitReason=` blank after AMPL SL | High for auditability | Yes | Added pending exit reason attribution for SL/TP and forced closes. |
| Version mismatch | metadata | `#property version "6.4.5"` in v6.4.6 source | High operational risk | Yes | Set property to 6.4.6 and added startup/build/input diagnostics. |

## Implemented Safe Corrections

1. Version identity
   - `#property version "6.4.6"`
   - `XAUAI_EA_VERSION`
   - `XAUAI_EA_VERSION_NUM`
   - `XAUAI_BUILD_HASH`
   - startup `VERSION-DIAG` line.

2. Entry diagnostics
   - Added `TRADE-DIAG ENTRY` with version, build hash, input hash, account, broker, symbol, digits, point, spread, average spread, magic, timeframe.

3. Exit diagnostics
   - Added `TRADE-DIAG EXIT`.
   - Added SL/TP attribution:
     - `XAU_SetPendingExitReason`
     - `XAU_ResolveExitReason`
     - `XAU_DealReasonName`
     - `XAU_SetPendingSLReason`

4. Forced close attribution
   - `CloseAll(string reason = "FORCE_CLOSE")`
   - Basket, equity, weekly, prop-firm, weekend, expectancy, and remote close-all paths now stamp a reason.

5. Diagnostic screen/report
   - Chart dashboard now includes:
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

6. AMPL tiny-lock fix
   - New inputs:
     - `InpAMPL_MinRetainUSD = 25.0`
     - `InpAMPL_MinRetainPeakPct = 30.0`
     - `InpAMPL_GivebackMinCurrentPct = 25.0`
   - AMPL giveback now refuses to ratchet if the proposed SL would lock less than the required retained profit.
   - This does not reintroduce a hard pause or freeze.
   - Other exits still manage losing/failing trades.

## Compile and Test Results

Compile:

- MetaEditor compile result: `0 errors, 1 warning`.
- Warning: `#property version "6.4.6"` is not MQL5 Market format `xxx.yyy`.
- Decision: keep `6.4.6` to avoid another operational version mismatch.

Tests:

- `pytest tests/test_xau_v646_live_audit_static.py`: 5 passed.
- `pytest`: blocked by unrelated existing collection error requiring `/app/frontend/.env`.
- `pytest tests`: 30 passed, 9 failed due stale frontend/version tests unrelated to this EA audit.

## What To Test Next

1. VPS/account comparison:
   - Confirm both terminals show same:
     - `EA version`
     - `Build hash`
     - `Input hash`
     - `Magic number`
     - broker/server
     - symbol/digits/point

2. Replay the 0.36 pattern:
   - Confirm AMPL logs `AMPL_GIVEBACK_HOLD_TINY_LOCK` instead of moving SL to a tiny lock when peak is meaningful but current lock is too small.

3. VPS evidence import:
   - Pull VPS logs for the 0.16 and 0.43 trades.
   - Compare `TRADE-DIAG ENTRY` and `TRADE-DIAG EXIT` fields.

4. Forward test:
   - Run both accounts with identical input hash for at least one London/NY session.
   - Compare spread baseline, entry reason, exit reason, slippage, and ticket lifecycle.

5. Parameter review:
   - If too many good winners reverse to full loss after AMPL tiny-lock refusal, tune `InpAMPL_MinRetainPeakPct` down from 30 to 25 rather than adding hard stops.

