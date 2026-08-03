# Relevant API Route Inventory

Customer auth/account: `/cloud/auth/signup`, `/login`, `/logout`, `/me`, `/forgot-password`, `/reset-password`, `/cloud/account/export`, `/delete`, `/cloud/license/link`, `/status`.

EA monitoring: `/cloud/monitor/heartbeat`, `/activity`, `/thesis-status`; reads `/cloud/monitor/status`, `/activity`, `/decision-feed`, `/bot-status`, `/current-opinion`.

Remote commands: `/cloud/command/request`, `/pending`, `/ack`, `/recent`; prop configuration `/cloud/prop-firm/config`.

Execution reservation: `/cloud/reservation/claim`, `/release`.

EA intelligence/data: `/ai/analyze`, `/ai/manage-position`, `/ai/memory/record`, `/report`, `/ai/feedback`, `/journal/log`, `/journal/trades`, `/journal/weekly-report`, `/weekly-reports`, `/ml/patterns/save`, `/load`, `/news/check`.

Downloads/performance: `/download/info`, `/download/ea-release`, `/download/request-token`, `/performance/summary`.

Admin: `/admin/dashboard`, `/pins`, `/command-center/overview`, `/notifications/health`, `/settings`, `/market-mode-settings`, `/transactions`, `/account`, `/ml/stats`.

Next audit focus: command idempotency/terminal states, tenant filtering on every read, session expiry/MFA, and exact frontend response-shape use.
