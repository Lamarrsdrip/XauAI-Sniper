# AI Sniper EA - XAUUSD Trading Bot - PRD

## Original Problem Statement
Build an advanced AI-assisted trading bot (Expert Advisor) for MetaTrader 5 focused on XAUUSD (Gold) with multi-strategy engine, AI adaptive decision engine, strict risk management, PIN-based licensing, crypto payments, and a professional web dashboard.

## Architecture
- **Frontend**: React + Tailwind CSS (Swiss/High-Contrast, gold accent theme)
- **Backend**: FastAPI + MongoDB (Motor async driver)
- **EA Code**: MQL5 Expert Advisor (~1000+ lines, production-ready with ML)
- **Payments**: Stripe (crypto-only via USDC/stablecoins, $199 per PIN)
- **Gold Price**: Live scraping from Google/Yahoo Finance
- **Database**: MongoDB (ea_configs, pin_licenses, payment_transactions collections)

## User Personas
1. **EA Seller/Owner**: Manages PIN licenses, generates PINs, tracks payments/activation
2. **Buyer**: Purchases PIN via crypto, downloads EA, installs on MT5
3. **Quantitative Trader**: Configures EA parameters, monitors performance

## What's Been Implemented

### Iteration 1 (Jan 2026)
- Complete MQL5 EA with multi-strategy engine (Trend/Range/Breakout)
- Web dashboard with performance analytics, architecture explorer
- Parameter configurator, EA file download, installation guide

### Iteration 2 (Jan 2026)
- PIN License System (generate, validate, revoke, delete unique PINs)
- Live XAUUSD Price Ticker (simulated)
- How It Works Tutorial (8 steps + 6 FAQs)
- Enhanced ML Pattern Learning in EA
- Profit Target Presets (Conservative 20%, Moderate 35%, Aggressive 50%)
- AI Metrics Dashboard

### Iteration 3 (Jan 2026)
- **Live Gold Price**: Real-time XAUUSD price scraped from Google/Yahoo Finance (~$4700-5000 range)
- **Crypto Payment**: Stripe crypto-only checkout at $199 per PIN license
  - Buyer enters name/email → redirected to Stripe → pays with USDC/stablecoins
  - PIN auto-generated after successful payment → shown on success page
  - Payment transactions tracked in MongoDB
- **Beginner Setup Guide**: 10-step guide written for absolute beginners
  - Each step has numbered sub-instructions and tips
  - Covers MT5 download → demo account → EA install → PIN entry → auto trading
  - Important safety notes at the bottom
- **Purchase Success Page**: Shows generated PIN with copy button + next steps
- Updated navigation with BUY and SETUP sections

### Backend API Endpoints (25+ total)
- Gold: GET /api/gold/price
- Purchase: POST /api/purchase/checkout, GET /api/purchase/status/{id}, GET /api/purchase/price
- Webhook: POST /api/webhook/stripe
- PINs: POST /api/pins/generate, POST /api/pins/validate, GET /api/pins, GET /api/pins/stats, PUT revoke/activate, DELETE
- Configs: CRUD on /api/configs
- Downloads: GET /api/download/ea, GET /api/download/package
- Docs: /api/docs/installation, /api/docs/how-it-works, /api/docs/setup-guide, /api/docs/parameters
- Performance: GET /api/performance/summary
- Architecture: GET /api/architecture

## Testing Status
- Iteration 1: 100% (12/12 backend, all frontend)
- Iteration 2: 100% (22/22 backend, all frontend)
- Iteration 3: 100% (10/10 backend, all frontend)

## Prioritized Backlog

### P0 (Done)
- [x] Complete MQL5 EA with ML pattern learning
- [x] PIN license system with admin panel
- [x] Live XAUUSD gold price ticker
- [x] Crypto payment (Stripe) at $199/PIN
- [x] Beginner-friendly 10-step setup guide
- [x] How It Works tutorial with FAQ
- [x] Profit target presets (20-50%)
- [x] Purchase flow with auto PIN generation

### P1 (Next)
- [ ] Telegram trade alert notifications
- [ ] Smart Money Concepts (order blocks, fair value gaps)
- [ ] PIN expiration dates and subscription tiers
- [ ] Email delivery of PIN after purchase (SendGrid/Resend)

### P2 (Future)
- [ ] User authentication for admin panel
- [ ] Live MT5 trade analytics via Python bridge
- [ ] Community configuration sharing
- [ ] VPS setup guide with recommendations
- [ ] Referral/affiliate system for PIN sales
