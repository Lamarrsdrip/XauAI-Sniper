# AI Sniper EA - XAUUSD Trading Bot - PRD

## Original Problem Statement
Build an advanced AI-assisted trading bot (Expert Advisor) for MetaTrader 5 focused on XAUUSD (Gold) with multi-strategy engine, AI adaptive decision engine, strict risk management, and a professional web dashboard.

## Architecture
- **Frontend**: React + Tailwind CSS (Swiss/High-Contrast design, gold accent theme)
- **Backend**: FastAPI + MongoDB (Motor async driver)
- **EA Code**: MQL5 Expert Advisor (~800 lines, production-ready)
- **Database**: MongoDB (ea_configs collection)

## Core Requirements (Static)
1. Complete MQL5 Expert Advisor with multi-strategy trading (Trend/Range/Breakout)
2. AI market classification with confidence scoring (0-100)
3. Institutional risk management (daily/weekly limits, equity protection, cooldown)
4. Web dashboard with performance analytics, parameter configurator, downloads
5. Installation guide and backtesting documentation

## What's Been Implemented (Jan 2026)

### MQL5 Expert Advisor (XAUUSD_AI_Sniper_EA.mq5)
- Market Analysis Engine: EMA 50/200, RSI, ATR, Bollinger Bands
- Multi-timeframe: M5 entry, H1 confirmation, H4 trend
- AI Market Classifier: Trending/Ranging/Breakout detection
- Strategy Engine: Trend (EMA pullback), Range (BB S/R), Breakout (volatility)
- Risk Management: Per-trade risk, daily/weekly limits, equity protection, cooldown
- Trade Execution: ATR-based SL/TP, partial close, trailing stop
- Position Sizing: Dynamic lot calculation
- Session Filter: London & New York sessions
- Performance Dashboard: On-chart metrics display

### Web Dashboard
- Hero section with key performance stats
- System Architecture explorer (6 modules, interactive)
- Performance Analytics (equity curve, weekly returns, strategy breakdown, monthly table)
- Parameter Configurator (sliders, toggles, number inputs with save/reset)
- Download Center (EA .mq5 file + ZIP package)
- Installation Guide (8 steps + requirements + warnings + backtesting guide)
- Footer with risk disclosure

### Backend API
- GET /api/ - Health check
- GET /api/performance/summary - Sample performance metrics
- GET /api/architecture - System module documentation
- GET /api/docs/installation - Installation steps
- GET /api/docs/parameters - Parameter documentation
- POST /api/configs - Save EA configuration
- GET /api/configs - List configurations
- GET /api/download/ea - Download .mq5 file
- GET /api/download/package - Download ZIP package

## User Personas
1. **Quantitative Trader**: Wants a robust, configurable EA for XAUUSD
2. **MT5 Developer**: Wants clean, modular MQL5 code to study/extend
3. **Risk-Conscious Trader**: Wants strict risk controls and capital preservation

## Testing Status
- Backend: 100% (12/12 endpoints passing)
- Frontend: 100% (all UI components and interactions working)

## Prioritized Backlog

### P0 (Done)
- [x] Complete MQL5 Expert Advisor
- [x] Web dashboard with all sections
- [x] EA download functionality
- [x] Parameter configurator with save/reset
- [x] Performance analytics dashboard

### P1 (Next)
- [ ] Python ML scoring model integration (scikit-learn classifier)
- [ ] Real-time gold price feed integration
- [ ] Smart Money Concepts (order blocks, fair value gaps)
- [ ] Liquidity sweep detection module

### P2 (Future)
- [ ] User authentication for saved configurations
- [ ] Live trade analytics (connect to MT5 via Python bridge)
- [ ] Parameter optimization engine
- [ ] Community sharing of configurations
- [ ] Email alerts for trade signals
