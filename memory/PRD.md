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

- **Feb 2026 - v4.2 Smart Features (zero-cost intelligence layer)**
  - **Re-entry engine** (pure MQL5, $0 AI cost): after a loser, watches for up to 15 min — if price reverses >=1.2× SL past original entry in the original direction → auto re-enter at 0.5× size. Solves the "stopped out then market reversed" pain point.
  - **DXY correlation gate**: every 15 min the EA fetches `/api/smart/dxy`. If DXY says gold is bullish but we're trying to SELL, veto the trade. Huge on gold where ~75% of big moves follow inverse DXY.
  - **Drawdown recovery mode**: 3+ losses in a day → risk auto-capped at 0.5% until balance recovers. Auto-disables after a win. Prevents revenge-blowup spiral.
  - **Streak cool-down**: 3 losses in 45 min → pause trading entirely for 20 min. Breaks the tilt cycle.
  - **Better close tracking**: now walks position history to recover the true entry price (not just the close price) for accurate re-entry threshold math.
  - Dashboard shows DXY bias, drawdown state, streak pause timer, re-entry watcher status.
  - All 8 new features fully tunable via MT5 inputs, still respect `InpBacktestMode` (strategy-tester-safe).

- **Feb 2026 - v4.2.2 — Bugfix + Asia Breakout + Adaptive Grades**
  - **Bug #1 fixed (re-entry infinite loop)**: added `InpMaxReEntriesPerDay=3` cap + daily reset counter. Previously a new loss after a re-entry could spawn another re-entry indefinitely.
  - **Bug #2 fixed (stale drift closing winners)**: changed `|profit|<30` to `profit > -30 && profit < 20`. Winning trades with small profit no longer force-closed at 30min when momentum might take them higher.
  - **Bug #3 cleaned**: removed dead `squeeze` variable in DetectRegime.
  - **NEW setup #8 ASIA_BREAKOUT**: Tracks Asian session high/low during 00:00-07:00 broker time, locks at 07:00. During London/NY hours (07:00-17:00), if price breaks above/below the Asia range with volume confirmation + strong body + MTF alignment → A-grade signal. Historically strong edge on gold.
  - **Adaptive grade threshold (`InpAdaptiveGrades`)**: Auto-tunes `InpGradeB` based on rolling WR of last 20 closed trades. WR<40% → tighten to 3.25 (fewer trades). WR>60% → loosen to 2.0 (more trades). Self-regulates to current market regime without manual input.

## Upcoming Tasks
- Add Live Paystack Secret Key & Gmail SMTP credentials (User action) - P1
- Create Customer Dashboard for buyers to manage PINs - P2

## Future/Backlog
- Telegram notification integration for trade alerts - P2
- Referral/affiliate system - P2
