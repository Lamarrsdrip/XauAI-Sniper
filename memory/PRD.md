# AI Sniper EA - XAUUSD Trading Bot - PRD

## Original Problem Statement
Build an advanced AI-assisted trading bot (Expert Advisor) for MetaTrader 5 focused on XAUUSD (Gold) with multi-strategy engine, AI adaptive decision engine, strict risk management, PIN-based licensing, and a professional web dashboard.

## Architecture
- **Frontend**: React + Tailwind CSS (Swiss/High-Contrast, gold accent theme)
- **Backend**: FastAPI + MongoDB (Motor async driver)
- **EA Code**: MQL5 Expert Advisor (~1000+ lines, production-ready with ML)
- **Database**: MongoDB (ea_configs, pin_licenses collections)

## User Personas
1. **EA Seller/Owner**: Manages PIN licenses, generates PINs for buyers, tracks activation
2. **Quantitative Trader/Buyer**: Receives PIN, configures EA, trades XAUUSD
3. **MT5 Developer**: Studies clean, modular MQL5 code with ML patterns

## Core Requirements
1. MQL5 EA with multi-strategy trading (Trend/Range/Breakout)
2. AI market classification with confidence scoring
3. Machine learning pattern memory (learns from past trades)
4. PIN-based licensing system (unique per buyer, validated on EA startup)
5. Live XAUUSD price ticker
6. Profit target presets (Conservative 20%, Moderate 35%, Aggressive 50% weekly)
7. Complete "How It Works" tutorial with FAQ
8. Web dashboard with analytics, configurator, downloads

## What's Been Implemented

### Iteration 1 (Jan 2026)
- Complete MQL5 EA with multi-strategy engine
- Web dashboard with performance analytics, architecture explorer
- Parameter configurator with save/reset
- EA file download (.mq5 + ZIP)
- Installation guide with backtesting instructions

### Iteration 2 (Jan 2026)
- **PIN License System**: Generate, validate, revoke, delete unique PINs per buyer
  - EA validates PIN on startup (online + offline fallback)
  - Admin panel to manage all PINs with stats
  - Copy PIN button for easy sharing with buyers
- **Live XAUUSD Price Ticker**: Real-time bid/ask with change indicator in header (simulated)
- **How It Works Tutorial**: 8-step expandable guide explaining every aspect of the bot
  - FAQ section with 6 common questions
  - Visual trading flow diagram
- **Enhanced ML/AI**: Pattern Memory System in EA
  - Stores market conditions, indicators, and outcomes for each trade
  - Learns which setups have highest win rates
  - Applies ML confidence boost/penalty based on pattern similarity
  - Saves/loads patterns between sessions (persistent learning)
- **Profit Target Presets**: 3 modes (Conservative/Moderate/Aggressive)
  - One-click preset applies to all related parameters
  - Default 20-50% weekly targets
- **AI Metrics Dashboard**: Classification accuracy, pattern memory size, learning rate
- Updated navigation with 8 sections

### Backend API Endpoints (22 total)
- GET /api/ - Health
- GET /api/gold/price - Live gold price (simulated)
- POST /api/pins/generate - Generate PINs
- POST /api/pins/validate - Validate PIN (used by EA)
- GET /api/pins - List all PINs
- GET /api/pins/stats - PIN statistics
- PUT /api/pins/{pin}/revoke - Revoke PIN
- PUT /api/pins/{pin}/activate - Reactivate PIN
- DELETE /api/pins/{pin} - Delete PIN
- POST /api/configs - Save config
- GET /api/configs - List configs
- GET /api/configs/{id} - Get config
- DELETE /api/configs/{id} - Delete config
- GET /api/download/ea - Download .mq5
- GET /api/download/package - Download ZIP
- GET /api/performance/summary - Performance data
- GET /api/architecture - System architecture
- GET /api/docs/installation - Install guide
- GET /api/docs/parameters - Parameter docs
- GET /api/docs/how-it-works - Tutorial + FAQ

## Testing Status
- Iteration 1: 100% (12/12 backend, all frontend)
- Iteration 2: 100% (22/22 backend, all frontend)

## Prioritized Backlog

### P0 (Done)
- [x] Complete MQL5 EA with ML pattern learning
- [x] PIN license system
- [x] Live gold price ticker
- [x] How It Works tutorial
- [x] Profit target presets
- [x] AI metrics dashboard
- [x] Web dashboard with all sections

### P1 (Next)
- [ ] Connect real gold price API (replace simulated data)
- [ ] Telegram notifications for trade alerts
- [ ] Smart Money Concepts (order blocks, fair value gaps)
- [ ] PIN expiration dates and subscription tiers

### P2 (Future)
- [ ] Payment integration (Stripe) for selling PINs
- [ ] Live MT5 trade analytics via Python bridge
- [ ] User authentication for admin panel
- [ ] Community configuration sharing
- [ ] VPS setup guide
