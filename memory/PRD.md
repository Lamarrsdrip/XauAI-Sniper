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

- **Feb 2026 - v4.2.4 — CRITICAL regime order bugfix**
  - Root cause found from user log: `Regime: LOW_VOL | Session: 1.0 | Setup: SQUEEZE_RELEASE Score:4.0 Combined:2.1 [PASS]` — bot idle for 30+ minutes during NY peak overlap.
  - Math: `atrPct = 4.55 / 4701 × 100 = 0.097%` → fell into `< 0.12%` LOW_VOL branch (quality 0.55) BEFORE the trending check ran. But chart showed a clear 55-point downtrend.
  - **Order bug**: `if(atrPct < 0.12) return LOW_VOL` short-circuited before `if(emaF < emaS) return TRENDING_DOWN`. Slow-ATR trends were silenced.
  - **Fix**: Reordered DetectRegime() to DEAD → BREAKOUT → TRENDING → LOW_VOL → CHOPPY → RANGING. Trending wins over low-vol when both conditions apply.
  - Also tightened thresholds: DEAD 0.04%→0.03%, LOW_VOL 0.12%→0.08% (reflects higher-priced gold era where ATR% naturally compresses).
  - LOW_VOL quality raised 0.55 → 0.65 (squeeze releases are MOST useful in low vol, shouldn't be penalized heavily).

- **Feb 2026 - v4.2.3 — Loss Armor + Runner Protection (profit-factor surgery)**
  - **Root cause targeted**: user's trade history showed avg-$300 wins vs single -$3,096 nuke (1 bad trade eats 10 good trades). This is a profit-factor problem, not a WR problem.
  - **Hard dollar stop** (`InpHardStopUSD=800`): absolute cap per trade. A $3,000 drawdown on a single position now impossible.
  - **Early adverse cut** (`InpEarlyAdverseCut`): if in first 5 minutes the trade is down > 0.7R, exit immediately. Prevents small-losses-becoming-huge.
  - **Peak retrace exit** (`InpPeakRetraceExit`): every position tracks its own peak profit. If retrace >= 60% AND peak was >= $100, close. Solves "was winning, gave it back" losers.
  - **Momentum-aware quick exits** (`InpMomentumGuard=true`): B2 no longer force-closes winners at 18min if RSI/EMA/consecutive-green show real momentum. Instead, SL tightens by 0.8×ATR and lets the runner run. Directly fixes user complaint "trade closes then price keeps going in profit direction."
  - Per-position peak tracking via parallel arrays `peakTickets[]/peakProfits[]`, cleared on close.
  - All 4 new protections tunable via MT5 inputs + respect `InpBacktestMode`.

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

- **Feb 2026 - v4.4.4 — "Let Runners Run" (smart profit cap)**
  - Root cause from user log: QUICK_PROFIT_CAP force-closed a $356 winner on a $57k account at fixed 0.5% cap ($285), then EA went idle. User complained: "only good high confidence reason should end it, cap should range $50-$5k."
  - **Raised ProfitMax default** from 0.5% → 3.0% of balance (6× breathing room).
  - **Added absolute bounds** `InpProfMaxFloorUSD=50` / `InpProfMaxCeilUSD=5000` — micro accounts get $50 floor, mega accounts capped at $5k.
  - **Added ProfitMin floor** `InpProfMinFloorUSD=25` so scan still arms on micro balances.
  - **Smart cap exit** (`InpSmartCapExit=true` default): hitting cap no longer force-closes. Instead:
    - MOMENTUM_FADE check runs FIRST (structure break OR 3-of-4 reversal signals) → exits cleanly on real reversal.
    - If cap hit with NO reversal, SL trails 0.8 ATR behind price (CAP_RUNNER log). Winner keeps running.
    - Hard ceiling $5k triggers `PROFIT_CEILING` exit to bank monster trades sanely.
  - Startup log now shows bounds + SmartCap status.
  - Frontend badges bumped to v4.4.4.
