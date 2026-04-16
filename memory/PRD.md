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
- **Fixed EA entry conditions (was not executing trades - too strict)**
  - Lowered confidence threshold 75 -> 55
  - Removed MARKET_UNDEFINED dead zone (now falls back to RANGING)
  - ClassifyMarket: emaDiff 5 -> 2, removed H4 requirement
  - TrendStrategy: ANY 2 of 3 conditions (was ALL 3), widened RSI/EMA zones
  - RangeStrategy: single condition signal (was AND), widened RSI bands
  - Reduced penalty stacking (loss slot -10, streak -5, recovery -5)
  - Dynamic threshold only raises +5 at <40% win rate

## Upcoming Tasks
- Add Live Paystack Secret Key & Gmail SMTP credentials (User action in Admin Settings) - P1
- Create Customer Dashboard for buyers to manage PINs - P2

## Future/Backlog
- Telegram notification integration for trade alerts - P2
- Referral/affiliate system - P2
