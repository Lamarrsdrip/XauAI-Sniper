# Agent.family / TermiX — existing XauCloud MT5 sources

This endpoint reuses the EXISTING XauCloud cloud-bot heartbeat, market-evidence,
and native subscriber-signal data. It does **not** install another worker, run arbitrary
commands on MT5, read trading secrets, or place trades.

## Connection

Set server-only secrets and configure your owner-approved MT5 sources:

```dotenv
XAUCLOUD_AGENT_FAMILY_READ_TOKEN=<random secret at least 32 characters>
# Optional additional owner-approved MT5 account IDs. Existing configured
# primary / backup subscriber signal accounts are automatically included.
XAUCLOUD_AGENT_FAMILY_SOURCE_ACCOUNTS=<optional comma-separated account IDs>
```

Endpoint: `GET /api/integrations/agent-family/market-snapshot`

Request: `Authorization: Bearer <read-token>`

Response: `schemaVersion:1`, `sourceKind:"broker"`, `sourceFresh:true`,
`symbol:"XAUUSD"`, `asOf`, `quote:{bid,ask,time}`, `nativeSignal`,
`noTradeExecution:true`. No account IDs, licenses, broker details, or credentials
are included. Unauthorized requests receive 401. No approved fresh source
returns 503; do not fabricate market data or treat this as a trading signal.

Selection picks the freshest **owner-approved** account with a heartbeat age <=90s
and quote observation age <=75s. If a source goes stale, another approved source
may be selected. Native signals are bound to the actual originating account via
`subscriber_signals.source_account`; after failover there is no reuse of another
terminal's BUY/SELL. When an actionable source-native signal is unavailable,
the service explicitly returns NO_TRADE with a short expiry.

The XauCloud-Termix hub should be configured with
`XAU_USE_EXISTING_CONNECTIONS=true`, `VPS_FLEET_ENABLED=false`, the endpoint
URL as `XAU_SIGNAL_FEED_URL`, and the server token as `XAU_SIGNAL_FEED_TOKEN`.

A connected terminal does NOT imply ability or permission to run arbitrary
software, backtests or execution. Those require explicit isolated capabilities
in the existing VPS worker. Never grant marketplace buyers SSH, RDP, broker
passwords, or live-trading access.

## Before merging

- Run backend Node tests and TypeScript build.
- Verify with the configured owner primary and backup terminals online.
- Verify account-source attribution and automatic source selection when the
  primary goes stale.
- Confirm 401 without bearer token, 503 on no healthy approved sources, and
  no customer/account identifiers in the payload.
- Confirm real Agent.family orders can deliver and settle with owner wallet
  authorization. Offline tests are not proof of live settlement.

## Paid orders

The snapshot above is the market input for paid signal and intelligence orders. Order state, draft listings and the owner operations API live under `backend_node/src/services/agentFamily/` and `GET /api/admin/agent-family/overview`. See `docs/AGENT_FAMILY_COMMERCE.md`. Marketplace polling stays off until `XAUCLOUD_AGENT_FAMILY_ENABLED=true`. A connected terminal is still not a backtest runner; strategy backtest diagnostics stay unpublished.
