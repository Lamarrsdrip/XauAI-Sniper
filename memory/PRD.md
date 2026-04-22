# XauAI Sniper EA - PRD

## Brand: XauAI Sniper | by emriz.eth
## Broker: Trade.com (75% bonus) | Payment: Paystack (NGN)

## Admin: admin@aisniper.com / MrizAdmin2026 at /admin

## Completed (Feb 2026)
- Base FastAPI + React + MongoDB setup
- MQL5 EA core architecture with multi-mode strategies
- PIN License generation and validation (Offline ASE-XXXX-XXXX + Online)
- Paystack NGN payment flow
- JWT-protected Admin Portal with Dashboard, Licenses, Settings
- Centralized global ML learning endpoints
- 6 Smart Features (News avoidance, DXY correlation, Session tuning, Drawdown recovery, Weekend protection, Monthly report)
- Rebranded to XauAI Sniper with Trade.com affiliate
- Fixed PIN 13-character validation bug
- Fixed EA not trading — complete overhaul of entry logic
  - MaxSpread 40→100, MaxTradesPerDay 3→6, Confidence 75→55
  - Eliminated MARKET_UNDEFINED dead zone
  - All signal triggers confidence-driven (no AND gates)
  - Fixed invalid stops (SymbolInfoDouble, NormalizeDouble, min stop distance)
  - Auto-detect broker fill mode (FOK/IOC/RETURN)
  - Session filter disabled by default (24/5 trading)
  - Comprehensive diagnostic logging at every gate
  - Fixed extra closing brace compile error
- **Frontend redesigned: Premium dark "Bloomberg meets Rolex" aesthetic**
  - Dark theme (#050505 base) with gold (#D4AF37) accents
  - Clash Display headings + Manrope body + JetBrains Mono data
  - Glassmorphic header with live ticker
  - Bento grid stats, premium charts, glowing purchase card
  - Noise textures, gold gradients, entrance animations
- **Feb 2026 - QuantPerp-inspired M5 XAUUSD architecture (v4.0)**
  - 5-Gate entry system: Regime → Session → Setup scoring → Risk → AI
  - 7 setup types: Trend Pullback, Range Reversal, Breakout, Squeeze Release, RSI Extreme, London Fix Pin, Multi-Extreme
  - 8 regime classifier: Trending Up/Dn, Ranging, Breakout Up/Dn, Low Vol, Choppy, Dead
  - 3-Path Smart Exits: (A) Deterministic SL/TP/Trail, (B) Smart mgmt (BE lock, quick profit, loss cut, stale), (C) Claude semantic exit
  - Cloud ML pattern store (save/load per PIN)
  - GPT-5.2 entry analysis + Claude 4.5 Sonnet active position manager via Emergent Universal Key
- **Feb 2026 - EA v4.0 compile fixes & backend parser hardening**
  - Removed dependency on `CDealInfo` class; switched to native `HistoryDealSelect` + `HistoryDealGet*` API (was causing compile error + stale deal data)
  - Tightened Claude close parser (requires `"CLOSE"` with quotes) to prevent false closes from reason text
  - Backend AI endpoints now strip markdown code fences before `json.loads` (Claude often wraps in ```json…```)
  - Verified `/api/download/ea` serves full 1126-line EA; all EA→backend endpoints (ai/analyze, ai/manage-position, news/check, ml/patterns/save, ml/patterns/load, journal/log, journal/weekly-report) respond correctly

- **Feb 2026 - Dual-AI Entry + Signature Hive-Mind (v4.1)**
  - `/api/ai/analyze` now runs Claude 4.5 AND GPT-5.2 in parallel. Consensus rules: both agree → avg+5 confidence; disagree → SKIP (safety); one agrees + one SKIPs → reduced confidence. Response includes per-AI breakdown.
  - EA computes exact signature `regime|setup|dir|session|rsi_bucket|stoch_bucket|mom_bucket` (5×5×5 buckets) on every signal.
  - Added M5 Stochastic (14,3,3) indicator and 5-bar momentum feed into signature.
  - New `POST /api/ml/hive/score` aggregates WR across ALL users (7-day rolling) per signature. WR≥60% (n≥5) → BOOST (+15% size, +8pp conf); WR≤30% → HARD VETO.
  - Trade journal now stores signature on every closed trade → feeds the hive automatically.

## Upcoming Tasks
- Add Live Paystack Secret Key & Gmail SMTP credentials (User action) - P1
- Create Customer Dashboard for buyers to manage PINs - P2

## Future/Backlog
- Telegram notification integration for trade alerts - P2
- Referral/affiliate system - P2
