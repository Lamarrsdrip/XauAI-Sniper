# XAUUSD AI Sniper v5.8.45 Command Center Audit

## Scope
- Repurposed the old cloud/copy-trading UI into the XAU AI Sniper Command Center.
- Added EA heartbeat/activity posting plus PIN-safe remote command queue and EA acknowledgement.
- Kept legacy `/api/cloud/...` endpoint paths for compatibility, while routing users to `/command`.
- Kept cloud fanout optional; monitor/command posting uses `InpBotMonitorEnable` and the existing agent token.

## Implemented
- EA heartbeat every `InpBotMonitorHeartbeatSec` seconds, default `20`.
- Heartbeat payload includes EA version, account, broker/server, symbol, timeframe, spread, equity, balance, daily PnL, drawdown, open positions, Algo Trading state, trading allowed state, MT5 connection state, last action, last tick/decision time, startup sync state, and last error.
- Activity events are posted for startup sync, cloud reasoning, trade execution, trade failures, and pyramid adds.
- Backend monitor endpoints:
  - `POST /api/cloud/monitor/heartbeat`
  - `POST /api/cloud/monitor/activity`
  - `GET /api/cloud/monitor/status`
  - `GET /api/cloud/monitor/activity`
- Backend command endpoints:
  - `POST /api/cloud/command/request`
  - `GET /api/cloud/command/pending`
  - `POST /api/cloud/command/ack`
  - `GET /api/cloud/command/recent`
- EA command polling every 10 seconds for:
  - pause new trades
  - resume trading
  - stop fresh entries while continuing management
  - close all EA-managed positions
  - force startup intelligence sync
  - mark report upload request
- Dashboard shows offline state when the last heartbeat is stale.
- Dashboard cards show bot status, account status, trading state, open trades, last signal, last trade, last blocked trade, daily PnL, drawdown, and sync state.
- Activity feed supports filters for trades, blocks, errors, sync, exit-brain, shadow trades, and risk events.
- Main public routes now use `/command`, with legacy `/cloud` redirects.
- Public website copy now describes a licensed MT5/VPS bot with phone monitoring, not copy trading.

## Safety Notes
- Every visible command is backed by a server queue and EA acknowledgement path.
- Command Center PIN is required; first valid 4-6 digit PIN sets the user's command PIN.
- Stop/pause affects fresh entries only. Existing positions keep being managed unless `Close all trades` is explicitly queued.
- Dashboard does not directly execute trades; the EA polls, validates, executes, and ACKs.
- Monitor/command failures log errors but do not stop local MT5 trade management.

## Not Fixed In This Patch
- The reported drawdown-before-profit case with the large floating SELL loss is a trading-logic/timing problem, not a dashboard problem.
- It now has better telemetry for diagnosis, but it still needs a focused drawdown-before-profit quality patch using the generated reports and screenshots.
