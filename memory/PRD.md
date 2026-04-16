# XauAI Sniper EA - PRD

## Brand: XauAI Sniper | by emriz.eth
## Broker: Trade.com (75% bonus) | Payment: Paystack (NGN)

## Smart Features (6 layers of protection)
1. **News Auto-Avoidance**: Real economic calendar API - skips NFP, CPI, FOMC events
2. **DXY Correlation**: Checks dollar index direction, only trades with gold bias alignment
3. **Session Tuning**: Different confidence thresholds per session (London 75, NY 80, Overlap 70, Asian 85)
4. **Drawdown Recovery**: At 50% daily loss limit, halves lot size + raises confidence +5
5. **Weekend Protection**: Closes ALL trades Friday 20:00 to avoid gap risk
6. **Monthly Report**: Admin sees best/worst hours, revenue, ML stats, recommendations

## All-in-One Smart Check: /api/smart/check-trade combines ML+News+DXY+Session+Weekend in single call

## Admin: admin@aisniper.com / MrizAdmin2026 at /admin

## Completed (Feb 2026)
- Base FastAPI + React + MongoDB setup
- MQL5 EA core architecture with multi-mode strategies
- PIN License generation and validation (Offline ASE-XXXX-XXXX + Online)
- Paystack NGN payment flow
- JWT-protected Admin Portal with Dashboard, Licenses, Settings
- Centralized global ML learning endpoints
- 6 Smart Features implemented
- Rebranded to XauAI Sniper with Trade.com affiliate
- Fixed PIN 13-character validation bug
- **Fixed EA not trading — complete overhaul of entry logic (v3)**
  - ROOT CAUSE: 3 silent blockers + overly strict strategy logic
  - MaxSpread 40 → 100 (gold needs wider spread tolerance)
  - MaxTradesPerDay 3 → 6 (more active trading)
  - Confidence threshold 75 → 55
  - ClassifyMarket: removed H4 requirement, lowered emaDiff 5→2, eliminated UNDEFINED dead zone
  - TrendStrategy: simplified to bullishCandle+RSI (very achievable), EMA pullback is now bonus not requirement
  - RangeStrategy: single condition signals (OR not AND), RSI oversold<40 overbought>60
  - BreakoutStrategy: signal on candle direction (was strongBody+RSI)
  - Added comprehensive diagnostic logging to EVERY gate (spread, session, limits, signals)
  - Reduced penalty stacking: max -20 total (was -45)

## Upcoming Tasks
- Add Live Paystack Secret Key & Gmail SMTP credentials (User action in Admin Settings) - P1
- Create Customer Dashboard for buyers to manage PINs - P2

## Future/Backlog
- Telegram notification integration for trade alerts - P2
- Referral/affiliate system - P2
