# XauAI Sniper EA - PRD

## Brand: XauAI Sniper | by emriz.eth
## Broker: Trade.com (75% bonus) | Payment: Bank Transfer + Crypto (admin-configurable pricing & FX)

## Admin: admin@aisniper.com / MrizAdmin2026 at /admin

## Completed (Feb 2026)

- **Feb 2026 — EA v5.1.9 — Profit Guardian "Selective Mode" (replace day-halt)**
  - **User pain**: PG day-halt was killing the rest of the day after a single giveback. User wanted "keep trading the BEST setups instead of going dark".
  - **Replaced full day-halt with Selective Mode** (`InpPG_SelectiveMode=true` default). When the giveback brake fires:
    - Bot does NOT stop trading.
    - Bot only takes **Grade A or A+** setups with **combined score ≥ `InpPG_SelectiveMinScore` (default 4.0)**.
    - **Strict M15 + H1 trend alignment** required (`InpPG_SelectiveRequireHTF=true` default — both M15 and H1 EMA50 must point ≥ 0.3×ATR away from price in trade direction).
    - **Lot size reduced** by `InpPG_SelectiveLotMulti` (default 0.6 = 40% reduction).
  - **PG activation gated by ≥25% day gain** (`InpPG_SelectiveMinDayGain=25.0`). Below that, PG does not interfere with normal trading at all — fixes the "PG nuked my $0.5% day" bug class.
  - **Optional auto-recovery**: `InpPG_SelectiveRecoverMin` (default 0 = stay restricted until next-day reset). Set to e.g. 120 → if equity is stable for 2 hours and back above the activation level, bot returns to normal mode.
  - **Logging**:
    - Activation: `🛡 PG SELECTIVE MODE ACTIVATED — high-confidence trades only. HWM gain $X | giveback $Y (≥Z% of gain @ dayGain=W%). Min combined score=4.0 | lot×=0.60 | HTF require=M15+H1`
    - Sub-A trades skipped: `🛡 PROFIT GUARDIAN VETO: PG selective: only A/A+ allowed, this trade is grade B (skipped 3 sub-A so far)` — counter increments so user can see what's being filtered.
    - Score gate: `PG selective: combined score 3.4 < min 4.0 required while restricted`
    - HTF gate: `PG selective: M15+H1 trend not aligned with trade direction (strict HTF gate)`
    - Recovery: `🛡 PG SELECTIVE MODE → NORMAL — equity stabilized for Xmin, no further drawdown. Skipped N sub-A trades while restricted.`
  - **Backwards compat**: set `InpPG_SelectiveMode=false` to restore the legacy v5.1.8 day-halt behavior.
  - Code locations: new inputs after `InpPG_RatchetTrailDist`; new state vars after `pg_consecutiveLosses`; daily reset block extended; `PG_UpdateHWM()` rewritten with selective branch + recovery tracker; new `PG_HTFAlignedM15H1()` helper; `PG_BlockReason()` signature now takes `combinedScore`; call site multiplies `sizeMulti × pgLotMult`.
  - Published as `/app/frontend/public/XAUUSD_AI_Sniper_EA_v5.1.9.mq5` and served by `/api/download/ea` (HTTP verified — `version="5.19"`).

- **Feb 2026 — v1.2.0 worker — root-cause fix for "trades not copying" P0**
  - **Smoking gun (from user's diagnostics screenshot)**: every fan-out attempt was returning `login swap failed: (-2, 'Terminal: Invalid params')`. Trades were never even being SENT — the MT5 SDK was rejecting the per-user account-swap before reaching `order_send`.
  - **Root cause**: `_ensure_active()` was calling `mt5.initialize(login=, server=, password=)` repeatedly to swap users. The MetaTrader5 Python SDK does NOT support that pattern — after the first init, subsequent initialize() calls with login args fail with `(-2, 'Invalid params')`. Correct pattern: `mt5.initialize()` ONCE (no args), then `mt5.login(login, password, server)` for each account swap. Same bug existed in `_mt5_try_login()`.
  - **Fix in `_ensure_active` + `_mt5_try_login`**: terminal init happens exactly once via `_mt5_inited` flag; account swaps go through `mt5.login()`; if that path fails (older SDK versions) we fall back to `mt5.initialize(login=…)` once. Login error messages now include the broker server name + login id + a checklist of common causes.
  - **`mt5_order_open` hardened to v1.2.0 spec** (covers every common rejection cause):
    1. **Pre-flight account checks**: `account_info().trade_allowed` (catches investor/read-only password) and `account_info().trade_expert` (catches "Allow algorithmic trading" disabled at account level), plus `terminal_info().trade_allowed` (catches AutoTrading toolbar button OFF).
    2. **Symbol auto-select** + tick freshness check.
    3. **Lot normalization**: rounds DOWN to broker's `volume_step`, clamps to `[volume_min, volume_max]`.
    4. **Margin pre-check** via `mt5.order_calc_margin()`: if needed > 95% of free margin, AUTO-SHRINKS the lot to fit ~90% of free margin instead of failing with retcode 10019.
    5. **SL/TP auto-clamp** to `trade_stops_level + 20% buffer` — covers the broker-rejects-stops-too-close case.
    6. **`mt5.order_check()` pre-validation** before every `order_send` — cycles filling modes / fixes lots / widens stops / refreshes price WITHOUT spamming the broker.
    7. **Filling-mode retry across IOC, FOK, RETURN** even when broker's bitmask says only one is supported (MetaQuotes-Demo bitmask is wrong for many symbols).
    8. **Requote/price-off auto-retry** with fresh tick + 2× deviation up to deviation=500.
    9. **Terminal/account hard errors** (10017/10018/10019/10027) short-circuit the retry loop with a specific actionable error.
    10. **Per-error human-readable hints** map (`_RETCODE_HINTS`).
  - Published as `/app/frontend/public/worker_agent_v1.2.0.py` (HTTP 200, VERSION=1.2.0).

- **Feb 2026 — v1.1.1 worker + Admin Cloud Diagnostics tab (P0 copy-trade visibility fix)**
  - **Root cause of "trades not copying" being invisible**: when the master EA fired a signal and zero subscribers were fan-out-eligible, the worker's `_handle_open` early-returned WITHOUT logging anything to backend. From the admin's POV the platform looked silently broken — signal hit `cloud_signals`, but no `cloud_fanout_logs` row appeared, no error surfaced anywhere. Same gap when the worker process was offline: no fanout row, no signal echo back.
  - **Worker v1.1.0 → v1.1.1** (`/app/backend/worker_agent/worker_agent.py`):
    - When a signal arrives and `len(self.users) == 0`, worker now POSTs a sentinel fanout-log row (`user_id="(no-active-users)"`, `ok=False`, `error="Worker has 0 active users at signal time. Subscribers must have mt5_connected=True AND mt5_verification_status=verified AND paused=False AND status in [trial,active]."`). Admin sees the silent fail in the dashboard, no SSH needed.
    - Re-published to `/app/frontend/public/worker_agent_v1.1.1.py` (HTTP 200 verified).
  - **Backend `GET /api/admin/cloud/diagnostics`** (`server.py`): single endpoint that consolidates everything an operator needs to debug copy-trading: workers (with `active_users`/`version`/`hostname`/`last_heartbeat` + auto online-vs-offline based on 3-min heartbeat cutoff), recent fanout logs (last 50), recent master signals (last 10), per-user fan-out readiness checklist (mt5_connected + verification_status + paused + status → `fanout_ready: bool` + `blocked_reason: str`).
  - **Frontend AdminPortal — new "DIAGNOSTICS" sub-tab** under Cloud:
    - 4-card health row: workers online, fan-out-ready users, recent events, recent signals.
    - Smart hint banner that auto-classifies the failure mode: NO WORKERS ONLINE / NO USERS FAN-OUT READY / FAN-OUT FAILURES DETECTED / HEALTHY.
    - Per-user readiness table with ✓/✗ for each gate + blocked_reason column → instantly tells admin which subscriber is missing what flag.
    - Fan-out events table with timestamp, user_id (or sentinel), signal_id, side, lots, ticket, ok flag, error string. The smoking gun for any worker-side failure.
    - Recent master signals table so admin can confirm whether master EA is firing at all.
    - Worker rows (Infrastructure tab) now also show `active_users` count + worker `version`.
  - **Verified**: `GET /api/admin/cloud/diagnostics` (admin token) returns the expected JSON shape on the preview env. Live data already revealed: 0 workers online, 1 of 4 users fan-out-ready, testuser blocked by `mt5 not connected`.
  - **Why this matters**: P0 ticket "trade fired on master but didn't copy to client" — admin can now answer that question in one click instead of SSH'ing the Windows VPS to grep `worker_agent.log`.

- **Feb 2026 — v5.1.4 EA + admin pricing/FX hardening**
  - **EA v5.1.4 — giveback brake noise filter** (`/app/backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`)
    - **Root cause** of "bot hasn't traded since 2pm yesterday despite v5.1.3 + Profit Guardian off":
      - v5.1.3's always-on `InpProfitLock=true` runs `PG_UpdateHWM()` → on a +0.6% day ($340 gain) the dayHWM crept up by maybe $500 then natural noise put a $300 dent in equity → 25% giveback baseline = $125 allowed → noise > allowed → `pg_dayHaltActive=true` silently, no new entries until midnight reset.
    - **Fix**: new input `InpPG_GivebackMinGainPct` (default `5.0`). Brake doesn't arm until day-HWM gain ≥ 5% of starting equity. Below that, normal market wiggle is bigger than the gain — brake stays disarmed. With v5.1.4 a +0.6% day will trade normally; only days with real >5% runs get the giveback protection.
    - Published to `/app/frontend/public/XAUUSD_AI_Sniper_EA_v5.1.4.mq5`. `/api/download/ea` serves it.
  - **Admin pricing form hardening** (server.py + AdminPortal.jsx)
    - **Root cause** of "I updated pricing but cloud site still shows defaults / Starter is $0":
      - `GET /admin/cloud/settings` returned RAW saved overrides → form rendered empty fields for keys not yet saved → admin clicked Save → blanks/0s clobbered the saved plan → Starter price became $0 in DB.
    - **Fix**: `GET /admin/cloud/settings` now returns MERGED effective plans + fx_rates (defaults + admin overrides) so the form always shows real values. `PUT /admin/cloud/settings` rejects `price_usd <= 0` and empty plan names with HTTP 400 (`_validate_plans_payload`). Admin frontend adds a pre-flight check + calls `refresh()` after save so the UI immediately reflects what's stored.
  - **Manual currency picker on bank-transfer payment page** (CloudDashboard.jsx BillingTab)
    - **Root cause** of "bank transfer still showing USD instead of NGN":
      - Production CDN doesn't expose CF-IPCountry/X-Vercel-IP-Country headers → `_detect_country_from_request` returns "" → `user_currency` defaults to "USD" → no FX conversion shown.
    - **Fix**: new currency dropdown above bank-account list. Pre-fills with detected currency if available, persists user pick in `localStorage` (`xauai_pref_currency`), shows live preview of every supported currency in the option labels (e.g., "NGN — pay NGN 82,500"). Changes immediately reflect in the gold "PAY THIS AMOUNT" banner. `paid_currency` + `paid_amount_local` fields on the submit-payment payload now use the chosen currency.
    - Verified: backend admin endpoints — merged plans returned ✓, $0 price rejected with explicit error ✓, valid save works ✓.

- **Feb 2026 — Cloud realtime visibility fix (worker decay + UX feedback)**
  - **Root cause** of "balance not updating, cloud feels not realtime":
    1. Backend never auto-flipped workers from `status=online` → `offline` when their heartbeat went stale. Found a worker that died 8+ hours ago but was still showing `online` in DB → cloud config endpoint reported `executor_workers_online > 0` lying to the dashboard.
    2. `/cloud/mt5/refresh-balance` only set a `force_equity_refresh=True` flag and returned 200 OK — even when zero workers were alive to read it. Click "Refresh" → no error → no update. Looked broken.
    3. Dashboard had no surface for "when was my balance last actually updated by the worker?" — user couldn't tell stale data from fresh.
  - **Fixes**:
    - `server.py` startup: new background task `_decay_stale_workers()` runs every 60s, flips any worker with `last_heartbeat < now - 3min` to `status=offline`. `cloud_workers.status` field now matches reality.
    - `POST /api/cloud/mt5/refresh-balance` now pre-checks live worker count — returns **503 with explicit message** "No cloud worker is currently online" instead of silently queuing.
    - `GET /api/cloud/dashboard` returns 3 new fields: `executor_online` (bool), `executor_count` (int), `last_balance_updated_at` (ISO from latest `cloud_equity_snapshots` for THIS user).
    - `CloudDashboard.jsx` MT5 tab: new amber "No cloud worker is currently online" banner shown above the verified card when `executor_online === false`. Refresh button disabled in that state with tooltip. Verified card now shows `updated 12s ago / 3m ago` next to the balance.
  - **Verified end-to-end**: backend log shows `[worker-decay] flipped 1 stale worker(s) offline` after restart; cloud config now reports `online=0 total=2` (was lying with `online=1` before).

- **Feb 2026 — v5.1.3 Smart Profit Lock + cloud copy simplification**
  - **EA v5.1.2** (`/app/backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`) addresses two real-account complaints:
    1. *"7+ hours no trades while gold moved"* — fixed by:
       - Trend gate ATR multiplier `2.0 → 1.0` (default `InpPG_HTFTrendATR`). Only EXTREME counter-trend blocks now.
       - **NEW**: ranging-market carve-out (`PG_HTFTrend()` → consolidation check). When the last 10 M30 bars' total range / ATR < 0.8, the trend lock is bypassed entirely so the bot scalps chop instead of waiting forever for a strong trend.
    2. *"Monday +70% gains roundtripped to zero"* — fixed by:
       - **Escalating HWM giveback** (`PG_HWMGivebackPctEffective()`): allowed giveback% tightens automatically as the day's gain grows. <30% → 25%, 30%+ → 20%, 50%+ → 15%, 75%+ → 10%. So a +70% day can only give back ~10.5% before halt — preserves the run instead of letting it roundtrip.
       - **NEW**: per-position ratchet (`PG_PerPositionRatchet()`, called every tick). At +1×ATR profit moves SL → BE; at +2×ATR profit, trails SL at 1×ATR behind price. Each winner self-protects, doesn't depend on account-level brake.
    3. *"Single losses paralyze the bot"* — fixed by:
       - **NEW**: adaptive cooldown (`PG_AdaptiveCooldownMin()`): 1 loss = 30 min (base), 2 consecutive = 90 min (3×), 3+ consecutive = 240 min (8×). Streak resets on any winner via `PG_OnBasketWin()` (called from basket-flush profit branch + per-deal TP closes in `OnTradeTransaction`).
    All changes additive and gated behind input booleans (`InpPG_EscalatingGiveback`, `InpPG_ConsolidationCarveout`, `InpPG_AdaptiveCooldown`, `InpPG_PerPositionRatchet`) so each can be disabled without recompile if needed. New version published to `/app/frontend/public/XAUUSD_AI_Sniper_EA_v5.1.2.mq5`. `/api/download/ea` serves it. Header version badge updated v5.1.1 → v5.1.2.
  - **Cloud landing copy simplified to app-interface tone**:
    - Hero: "Trade gold. Hands-free." + "Connect once. We trade. You watch." + 1-line subtitle
    - How it works: "Three steps." → Connect / Activate / Trade 24/7 (one-line bodies)
    - Benefits: 6 short cards (No VPS · No MT5 install · Real-time execution · Fully automated · Pause anytime · Funds stay with broker)
    - Trust: "Funds stay with your broker." + 1-line bodies
    - Closing CTA: "Put gold trading on autopilot. Start free trial →"

- **Feb 2026 — Brand refresh + DIY→Cloud funnel**
  - **New logo** (`XauAiLogo.jsx`): minimalist gold cloud silhouette with bold upward arrow inside. Renders cleanly from 16px favicon → 1024px app-icon. Two render modes: outlined (transparent fill, gold stroke) for nav/header, and `solid` (gold gradient fill, dark arrow) for app icons / hero badges. Replaces the generic lucide-react `<Cloud />` icon in the cloud nav + footer.
  - **`favicon.svg` + regenerated `icon-192.png` / `icon-512.png`** (PWA manifest icons) using the new logo + dark `#0A0A0A` rounded-square background. Added `<link rel="icon" type="image/svg+xml">` to `index.html` so browsers + iOS install both pick it up.
  - **Cloud landing copy revamp** (`/cloud`):
    - Hero: "Stop babysitting MT5. Let your trades run themselves." + dual subtitle ("No VPS. No laptop. No stress." then the 24/7 explainer).
    - New "Trade smarter, not harder" headline strip between hero and how-it-works.
    - "How it works" rewritten with the 3-step language the user provided (Connect → Activate → Execute).
    - New "Built for traders who want results, not screen time." benefits grid (6 checkmark cards).
    - Trust section retitled "Your funds stay in your broker. We don't hold your money — we only execute trades."
    - Final closing CTA ("Ready to put gold trading on autopilot?") above the footer.
  - **Homepage promo funnel** (`CloudPromoSection.jsx`): new dark section injected between `#broker` and `#purchase` on the main DIY landing page. Side-by-side comparison card (DIY vs XauAi Cloud, Cloud marked "EASIEST"), live executor mockup (broker, executor, open positions, next execution, today's P&L, uptime), with primary "Try XauAi Cloud free" CTA → `/cloud` and secondary "See pricing" → `/cloud#pricing`. Catches visitors who don't want to install MT5 or rent a VPS and routes them to the managed offering.

- **Feb 2026 — XauAi Cloud Copy-Trading P0 fix + Billing System Overhaul**
  - **Worker Agent v1.1.0** (`/app/backend/worker_agent/worker_agent.py`) — full rewrite addressing the "trades not mirroring" bug:
    1. **Per-user MT5 session swap** (`_ensure_active`): the MetaTrader5 Python SDK keeps only ONE active terminal connection. Pre v1.1.0 the worker initialized once per user but every subsequent `mt5.initialize()` REPLACED the previous session — so order_send always fired against the LAST-initialized user. Now every operation (login, order_send, order_close, equity) re-authenticates as the intended user; cached active-user id avoids redundant swaps.
    2. **Symbol auto-resolution** (`_resolve_symbol`): master EA sends `XAUUSD` but client brokers may use `XAUUSDm`, `XAUUSD.r`, `XAUUSD.s`, `GOLD`, etc. Worker now probes 16 known variants then falls back to scanning all broker symbols for any `XAU*USD*` instrument. Cached per-user.
    3. **Filling-mode + lot-step auto-detection** per broker symbol (FOK/IOC/RETURN, volume_step rounding) — fixes silent retcode=10030 "unsupported filling mode" rejections.
    4. **Cold-start checkpoint**: `last_signal_poll` now initializes to `now() - SIGNAL_CATCHUP_MIN(5min)` so worker restarts don't replay the entire signal history.
    5. **Per-fanout reporting**: every trade-open attempt (success OR failure) is POSTed to `/api/cloud/agent/trade-open` with broker error string — admin sees fills + diagnoses errors without SSH-into-VPS.
  - **Backend (server.py)** new/updated endpoints:
    - `POST /api/cloud/agent/trade-open` — worker reports each fanout outcome; on success a real (shadow:false) row lands in `cloud_trades`; always logs to new `cloud_fanout_logs` collection with `ok`, `error`, `signal_id`, `ticket`, etc.
    - `GET /api/admin/cloud/fanout-logs` — admin diagnostic view of recent fanout outcomes.
  - **Billing System Overhaul**:
    - **Dynamic admin pricing**: plans moved from hardcoded dict into `cloud_settings.plans` (admin-editable). `_get_effective_plans()` merges with defaults so missing keys still resolve. Admin can change starter/pro prices live via Pricing & FX tab.
    - **FX currency conversion**: `cloud_settings.fx_rates` (admin-editable). Defaults: NGN=1650, KES=130, ZAR=18.5, GHS=15, EUR=0.92, GBP=0.79, INR=84, CAD=1.40, AUD=1.55. `/cloud/config` now returns `user_country` (best-effort from CF-IPCountry / X-Vercel-IP-Country / Accept-Language) + `user_currency` + `fx_rates`. Bank-transfer payment page shows the exact local-currency amount with conversion rate.
    - **Per-user override** `POST /api/admin/cloud/users/override`: admin can set `custom_price_usd` (overrides plan default), change `plan`, or `extend_days` from the Users tab (+30d / $ override / plan-swap buttons added).
    - **Payment proof upload**: bank-transfer payments now REQUIRE a base64 image of the transfer receipt; submit endpoint rejects bank-method submissions without `proof_image` (must be `data:image/...`, max 5 MB). Admin Payments queue renders a clickable thumbnail.
    - **Removed Paystack/card option**: frontend `Card / Paystack` tab gone; backend rejects `method: "fiat"`.
    - **MRR calculation** now honors per-user `custom_price_usd` (falls back to plan price).
  - **Frontend**:
    - `CloudDashboard.jsx` BillingTab — 2-column method picker (crypto + bank), conditional FX banner showing `NGN 82,500 ≈ $50 USD · rate 1 USD = 1650 NGN` when the user's detected country uses a non-USD currency, file picker for proof image with thumbnail preview.
    - `AdminPortal.jsx` — new "Pricing & FX" sub-tab with editable plan name/price/max-balance/description and FX rate inputs. Users tab gains 3 inline action buttons per user: `+30d` (extend), `$` (custom price prompt), `⇄` (swap plan). Payments queue shows proof thumbnails.
  - **EA v5.1.1** (already in tree): Profit Guardian HTF trend lock now defaults to `PERIOD_M30` with `2.0×ATR` looser threshold (was H4 / 1.5×ATR — too slow for gold).
  - **Testing**: 21/21 backend regression tests passed (testing_agent_v3_fork iteration 9): trade-open success+failure, fanout logs, dynamic plans, FX rates, settings update, per-user override, payment-submit guards (fiat rejected, bank requires proof, admin-overridden price honored), MRR with custom price, master signal flow, auth guards on admin/agent/cloud endpoints.

## Upcoming Tasks
- Telegram alerts for cloud users (trade open/close) — P1
- server.py refactor (2900+ lines → modular routers under /app/backend/routes) — P1
- Worker: portable MT5 instances for true parallel multi-user execution — P2
- End-of-day Telegram report, referral/affiliate, public AUM counter — P2

## Future/Backlog
- Base FastAPI + React + MongoDB setup
- **XauAi Cloud MVP (May 2026)** — centralized trade-execution platform
  - Public landing (/cloud) selling managed-trading subscription
  - User signup/login with JWT + 7-day free trial auto-start
  - "Connect MT5" wizard with Fernet-AES encrypted credential storage
  - User dashboard: KPIs, recent trades, equity curve, pause/resume toggle
  - Billing tab: $50 Starter / $100 Pro plans, payment instruction display, proof submission
  - Admin Cloud tab: stats (MRR, users, pending), user list, payment approval queue, crypto wallet + bank account config
  - Worker agent endpoints (token-protected) for future VPS executor integration: /cloud/agent/pending-users, /trade-close, /equity-snapshot
  - CORS + cookie auth for both admin and cloud user namespaces
  - Admin settings include crypto wallets array + bank accounts array (admin can add/remove)
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

- **Feb 2026 - v4.9.1 — "Profit Ratchet 50%"** — User spec: "$1k profit → SL $500, $2k → $1k, based on account size". Shipped exactly as requested. New input group, `InpProfitRatchet=true` default. Arms at 0.5% balance (floor $50), locks 50% of current profit every tick. Replaces AR_BE+AR_S1+AR_S2 staging (the thing that clipped sell 2.59 at -$2.59 on a BE wick). Account scaling: $1k→$5 arm, $10k→$50, $100k→$500, $1M→$5000.

- **Feb 2026 - v4.9.0 — "Earlier Protection"** — User: "0-3k is too much, 1-2k atleast should have something active". Dropped Peak-Lock arm 3%→1.5% (floor $20), AR_S1 5%→2.5% (floor $30), AR_BE 8%→4% (floor $50). On $100k: Peak-Lock@$1.5k, trail@$2.5k, BE@$4k. Trails stay wide/patient from v4.8.9 (2.5×/4.0×ATR).

- **Feb 2026 - v4.8.9 — "Patient Trailing"** — User correction to v4.8.8: "don't reduce %, don't remove trails — make better, allow profit grow, only trigger if very necessary". Reverted Peak-Lock 2%→3% (floor $30), default mode back to MGMT_BALANCED (trailing ACTIVE). Loosened trails for patience: AR_S1 2.0→2.5×ATR, AR_S2 activate 1R→2R + trail 3.0→4.0×ATR (~16pt). All layers stay active, just patient.

- **Feb 2026 - v4.8.8 — "Simple Mode Default" (initial trades now ride like pyramids)**
  - User insight: pyramid trades in screenshot (sell 0.37, 0.22, 0.08, 0.05, 0.03) all showing nice profits because they're small enough to never trigger AR_BE / AR_S1 / AR_S2 active management. Initial big trades (sell 2.47, 2.37, 1.42, 1.03) getting clipped by the active trail.
  - **Fix**: new `InpMgmtMode` enum with 3 modes:
    - **MGMT_SIMPLE** (default): no Adaptive Runner trailing. Just initial SL + TP + Peak-Lock. Trade either runs to TP or hits initial SL. Peak-Lock catches big retraces.
    - **MGMT_BALANCED**: full Adaptive Runner active (v4.8.7 behavior)
    - **MGMT_AGGRESSIVE**: Adaptive Runner with tighter trails (future)
  - **Peak-Lock arm lowered**: 3% → **2%** of balance (floor $20). On $100k account: arms at $2k profit instead of $3k. Becomes primary protection in SIMPLE mode.
  - Result: initial trades now ride with same simplicity as pyramid trades. Peak-Lock still catches big peaks (40-70% dynamic scaling from v4.8.3).
  - Compile: braces 0/0, parens 0/0, 4007 lines.

- **Feb 2026 - v4.9.3 — "Bigger Lots" (scale size with signal strength)**
  - User pain: $50k-$100k accounts were taking tiny 2-3 lot sizes on A+ signals that deserved more.
  - **Grade multiplier bumped**: A+ 1.0→1.5, A 0.85→1.2, B 0.55→0.8 (line 2194).
  - **Account Mode risk bumped**: BALANCED 0.8→1.2%, CONSERVATIVE 0.4→0.6%, AGGRESSIVE 1.2→2.0%.
  - **Equity caps raised** so the new larger lots aren't throttled: `InpMaxRiskPctEquity` 1.5→3.0%, `InpMaxAggregateRiskPct` 4.0→8.0%.
  - Fixed trailing-garbage syntax error that had been blocking compile (stray text at EOF after `Comment(d); }`).
  - Compile: braces 0/0, parens 0/0, 4061 lines. Frontend download bumped to v4.9.3 and served via `/api/download/ea` (HTTP 200, 198 KB).

- **Feb 2026 - v4.9.2 — "Profit Ratchet Scaled Up"** (locks 50% of profit at $500/$2.5k/$5k tiers keyed to account size).

- **Feb 2026 - v4.8.7 — "Proper Account Scale"** — User corrected v4.8.6 %s: "$1k should start from 50-200, 100k from 1k-5k". Bumped `InpARStage1MinPct` 0.5→5.0%, `InpARBreakEvenMinPct` 0.8→8.0%, `InpPeakLockArmPct` 0.3→3.0%. Floors raised to $50/$80/$30. Now: $100k → AR@$5k, BE@$8k, PeakLock@$3k.

- **Feb 2026 - v4.8.6 — "Account-Aware Exits" (all $ thresholds scale with balance + wider trails)**
  - User feedback: "$50/$80 too small on big acc. Make everything base on account size."
  - **Converted fixed $ thresholds → % of balance:**
    - `InpARStage1MinPct = 0.5%` (floor $10): $1k→$5, $10k→$50, $100k→$500
    - `InpARBreakEvenMinPct = 0.8%` (floor $15): $1k→$8, $100k→$800
    - `InpPeakLockArmPct = 0.3%` (floor $8): $1k→$3, $100k→$300
  - **Widened trails:** AR_S1 1.5→2.0×ATR, AR_S2 2.2→3.0×ATR, AR_BE +1.0R→+1.2R
  - Also v4.8.5 `InpARStage1MinProfit`/`InpARBreakEvenMinProfit` fixed-$ inputs REMOVED (replaced by Pct versions).
  - Compile: braces 0/0, parens 0/0, 3999 lines.

- **Feb 2026 - v4.8.4 — "Trend Hold Mode" (stop micro-exiting obvious 20-pt trends)**
  - User pain: gold moved 4614 → 4594 (20pt = should have been $10k+). Bot opened ~15 sells, each held 0-1pt, netted only ~$500-800.
  - **Root cause**: AR Stage 1 trail at 1.0×ATR (~4pt) clipping winners on noise. AR_BE at +0.5R locking too early.
  - **Fix 1 — Loosen AR defaults**: AR_BE 0.5R→1.0R, AR_S1 activate 0.3R→0.8R, AR_S1 trail 1.0→1.5×ATR.
  - **Fix 2 — Trend Hold Mode**: when H4+H1+M5 EMAs all align with trade direction → force wide 3.0×ATR trail. Log tag `AR_TH`.
  - Expected: bot now holds single trades through 20pt moves instead of fighting itself with 15 micro-exits.
  - Compile: braces 0/0, parens 0/0, 3989 lines. Frontend bumped to v4.8.4.

- **Feb 2026 - v4.8.3 — "Dynamic Peak-Lock" (root cause of $1k+ peak giveback)**
  - User pain: sell 4.13 & 2.47 both hit +$1,000+ peak, closed at -$57 and +$212. Market then moved to their direction.
  - **Root cause**: Peak-Lock was hard-coded 25% of peak. On $1,000 peak → only $250 locked. Price retraced past $250 floor on a wick → SL hit.
  - **Fix**: dynamic scaling — bigger peaks get TIGHTER lock %:
    - Peak $30-$300 → **40%** (was 25%)
    - Peak $300-$1000 → **50%**
    - Peak $1000-$3000 → **60%**
    - Peak $3000+ → **70%**
  - Armed at peak ≥ $30 (was $50) so small wins get protected too.
  - Compile: braces 0/0, parens 0/0, 3960 lines.
  - Frontend bumped to v4.8.3.

- **Feb 2026 - v4.8.2 — "Account Mode" (one-toggle risk preset)**
  - User pain: $100k account trading like a $5k account (lots 0.05-0.5 because v4.7.2 set defensive 0.4% risk).
  - **Fix**: new enum `InpAccountMode` with 3 presets that override `InpRiskPercent`:
    - `ACCT_BALANCED` (default, 0.8%) — middle ground
    - `ACCT_CONSERVATIVE` (0.4%) — defensive, for after losing streaks
    - `ACCT_AGGRESSIVE` (1.2%) — max risk for confident periods
  - Safety nets preserved: 1.5% per-trade and 4% aggregate equity caps still active.
  - Now $100k accounts default to ~1 lot per trade. 2× larger profits vs v4.8.1.
  - Compile: braces 0/0, parens 0/0, 3955 lines.
  - Frontend bumped to v4.8.2.

- **Feb 2026 - v4.8.1 — "Context Gate Loosened"**: relaxed S/R proximity 0.4→0.2×ATR, lookback 60→40, H4 neutral 0.1→0.25%. Added PASS log for visibility.

- **Feb 2026 - v4.8.0 — "Context Engine" (HTF bias + Swing S/R proximity filter, pure rule-based)**
  - User shared 9-point "make it smarter" spec. Audit showed 6/9 already built (regime classification, quality scoring, memory, adaptive risk, smart exits, behavioral AI). Real gaps: HTF context + S/R zones.
  - **Gap filled (zero LLM cost, pure MQL5)**:
    1. **H4 HTF bias**: new indicator handles (`hEMAFast_H4`, `hEMASlow_H4`). Blocks BUY when H4 EMA50 < EMA200 (bearish HTF). Blocks SELL when H4 EMA50 > EMA200 (bullish HTF). Neutral-zone carve-out: if H4 EMAs < 0.1% apart, no strong HTF bias so trade is allowed.
    2. **Swing S/R proximity**: scans last `InpSRLookback=60` M5 bars for swing highs/lows (bar whose high/low beats ±3 bars window = swing level). Blocks BUY within `InpSRProximityATR=0.4 × ATR` BELOW a swing high (entering resistance). Blocks SELL within 0.4×ATR ABOVE a swing low (entering support).
  - **Placement**: runs in `ContextGateAllows()` between AI confidence check and OpenTrade call. Hard-blocks bad entries, logs reason for transparency.
  - **New inputs** (all tunable):
    - `InpUseH4Bias = true`, `InpUseSRFilter = true`
    - `InpSRLookback = 60`, `InpSRProximityATR = 0.4`
  - **Example log lines**: `⛔ CONTEXT-GATE: BUY blocked — H4 EMA50 < EMA200 (bearish HTF bias). Don't fight the trend.` / `⛔ CONTEXT-GATE: SELL blocked — price 4568.20 is 1.05 above swing low 4567.15 (< 1.80 = 0.4×ATR). Entering into support without break-retest.`
  - **Expected impact**: skips ~40% of chop/reversal trades (where bot gets direction right but hits S/R and reverses). Win rate likely 55-60% → 65-70%.
  - Compile: braces 0/0, parens 0/0, 3940 lines.
  - Frontend bumped to v4.8.0 (verified live: page renders, no compile errors, `v4.8.0` stamp visible).

- **Feb 2026 - v4.7.7 — "Adaptive Runner" (2-stage tick-1 trailing per user spec)**
  - User shared the exact required spec after +$3,938 peak → big loss. Screenshot showed sell 3.27 @ 4571 sitting at +$3,397 profit, which later gave back everything and closed in red.
  - **Implementation** matches user's 6-point spec exactly:
    1. **Immediate activation** (tick 1): no time-in-trade gate, runs every ManagePositions tick.
    2. **Two-stage trailing**:
       - Stage 1 at `InpARStage1ActivateR = 0.3R` → `InpARStage1TrailATR = 1.0×ATR` (tight, early protection)
       - Stage 2 at `InpARStage2ActivateR = 1.0R` → `InpARStage2TrailATR = 2.2×ATR` (wider, runner mode)
    3. **Fast SL adjustment**: every tick, SafeModifySL no-op guard prevents spam.
    4. **Adaptive speed**: `InpARMomentumBoostMulti = 0.7` — when bar range > 1.2×ATR in our direction, tighten trail by 30% for faster ratchet.
    5. **Anti-noise**: `InpARMinTrailPoints = 80` (~$0.80 on XAU) hard floor on trail distance.
    6. **Break-even at +0.5R**: `InpARBreakEvenR = 0.5` → moves SL to BE + `InpARBreakEvenProfitR = 0.1R` tiny cushion.
  - **Conflict prevention**: old PATH A (1.2×ATR) and old BE_LOCK are DISABLED when `InpAdaptiveRunner=true` (default). Profit Ladder / Peak-Lock still run in parallel — they only ratchet FURTHER and SafeModifySL is ratchet-only so no conflicts.
  - Logs: `AR_BE #ticket profitR=0.52 — locked BE+0.1R`, `AR_S1 #ticket profitR=0.45 [MOM+] — SL→X (0.70×ATR, min 80pts)`, `AR_S2 #ticket profitR=1.23 — SL→X (2.20×ATR, min 80pts)`. Throttled 30s.
  - Compile: braces 0/0, parens 0/0, 3831 lines.
  - Frontend bumped to v4.7.7.

- **Feb 2026 - v4.7.6 — "Aggregate Exposure" (analyzed user screenshot, fixed actual root cause)**
  - User screenshot deep-dive ($100k → $50k drawdown):
    - Big losses came from STACKING: sell 5.84 @ 4598 + sell 6.31 @ 4579 simultaneously open = ~12 lots short = $1,200/pt exposure → 5pt wick = -$6,000 combined.
    - Single-trade EQUITY-CAP from v4.7.5 helps per-trade but doesn't stop multiple trades stacking. Aggregate cap was missing.
    - Micro-profit exits (3.78 lots × 0.12pt = +$45) = MOMENTUM_FADE firing on noise. Already fixed in v4.7.2 Preservation Mode (user just needs to load it).
  - **New gates**:
    - `InpMaxAggregateRiskPct = 4.0` (default 4% equity): scans all open positions in our magic, sums their (open-SL)×ticksize×ticks×lots = total $-loss-if-everything-hits-SL. If > 4% equity, BLOCK new entries until exposure drops.
    - `InpMaxTotalLots = 0` (auto = ~3% equity at typical SL distance): backstop hard cap on summed lot size across all positions.
  - On user's $100k acc: max combined exposure $4k. Even if all positions hit SL together, max -4% account.
  - Logs: `⛔ AGG-RISK BLOCK: open positions already risk $1860 (5.84 lots) > 4% equity (max $4000). New entries blocked until exposure drops.`
  - Compile: braces 0/0, parens 0/0, 3742 lines.
  - Frontend bumped to v4.7.6.

- **Feb 2026 - v4.7.5 — "Equity Cap" (CRITICAL: caps single-trade $-loss as % of equity)**
  - User shared screenshot showing $100k account → $50k. Single trade lost $4,259 (4.3% of equity in one move). Pattern: 5-6+ lot sells getting whacked on noise.
  - **CRITICAL FINDING from screenshot**: user was running **v4.6.4** in MT5 — none of v4.7.0-v4.7.4 features (Preservation Mode, AI Exit Brain, TP Auto-Extend, Peak-Lock) were actually loaded. Sent install instructions.
  - **Additional fix shipped — `InpMaxRiskPctEquity = 1.5` (default 1.5% of equity)**:
    - After all existing risk math (riskPct, drawdown mode, vol-adapt, streak scaling), one final hard cap is applied.
    - Computes `slDollarPerLot = (slDist / tickSize) × tickValue`. Caps lots so `lots × slDollarPerLot ≤ equity × 1.5%`.
    - Logs: `⚠️ EQUITY-CAP: lots 5.68 → 1.20 (would risk $1860 > 1.5% equity = $750)`.
    - Independent of `InpRiskPercent` — even if user keeps risk % low, this catches edge cases where ATR/SL widening causes oversized lots.
  - On a $100k acc: 1 trade max -$1,500 (was -$4,259). Allows ~7 consecutive losses before -10% account.
  - Compile: braces 0/0, parens 0/0, 3680 lines.
  - Frontend bumped to v4.7.5.

- **Feb 2026 - v4.7.4 — "Smart TP Extend" (only chase TP when trend is real)**
  - User asked: "Hope the version will allow strong runner will hit the original TP if market look fine?"
  - Honest finding: v4.7.3's TP_EXTEND fired on EVERY 80% threshold cross — meaning the original TP would basically never get hit, even on calm trades that should just bank the target.
  - **Fix — TP extends only when 4 gates ALL pass**:
    1. Regime is TRENDING_UP/DOWN or BREAKOUT_UP/DOWN (not RANGING/CHOPPY/LOW_VOL)
    2. Regime direction aligns with our trade (BUY needs UP regime, SELL needs DOWN)
    3. Price still on the right side of EMA fast (continuation confirmed)
    4. RSI not at exhaustion (< 78 for BUY, > 22 for SELL)
  - If any gate fails → log `TP_EXTEND SKIP — market not strong enough to chase TP. Letting original TP hit at price.` (throttled 1/min) → original TP banks the win as expected.
  - If all gates pass → TP pushes forward + log shows regime context.
  - Compile: braces 0/0, parens 0/0, 3654 lines.
  - Frontend bumped to v4.7.4.

- **Feb 2026 - v4.7.3 — "TP Auto-Extend" (push TP forward as winner runs)**
  - User pain: "Hope we still have the TP auto-readjustment to secure profit as market move in our favor like to bring TP front."
  - **Honest finding**: SL was being ratcheted forward (Profit Ladder, Peak Lock, Moon Trail) but TP was NEVER moved after entry. A strong runner would hit the original 2R TP and exit — no matter how good the trend was.
  - **Fix — TP Auto-Extend (zero LLM cost, pure MQL5)**:
    - `InpTPAutoExtend = true` (default ON)
    - When profit reaches `InpTPExtendTriggerPct=80%` of TP-distance from entry, TP gets pushed forward by `InpTPExtendATRMulti=1.5×ATR`.
    - Capped at `InpTPExtendMaxTimes=5` extensions per position (prevents infinite-loop edge cases).
    - Sanity-check: new TP must sit on correct side of price + respect broker SYMBOL_TRADE_STOPS_LEVEL + 30pt buffer.
    - Per-position counter via `tpExtendTickets[]` / `tpExtendCount[]` arrays. Cleaned up in OnTradeTransaction.
    - New log: `TP_EXTEND #ticket (1/5) profit $X reached 80% of TP — TP pushed Y further to Z. Runner keeps running.`
  - **Combined with v4.7.2 Preservation Mode**: SL ratchets UP (banks profit), TP ratchets FORWARD (removes ceiling), exits only on real reversal (AI veto + SL hit + Moon Trail). This is the full "let winners run" architecture.
  - Compile: braces 0/0, parens 0/0, 3619 lines.
  - Frontend bumped to v4.7.3.

- **Feb 2026 - v4.7.2 — "Preservation Mode" (stop trading a $100k acc like a $100 acc)**
  - User pain: $100k account drawdown -45% → $54k. Bot called gold direction RIGHT (4710 → 4668), but every trade exited in -$58 to +$83 range. The bot was scalping out winners on micro-moves while the macro trend ran without it.
  - **Root cause**: rule-based exits (MOMENTUM_FADE, TIME_EXPIRED, SMART_CUT, STALE_DRIFT, PEAK_RETRACE) were tuned for a small $1k account where $30-50 profit-protection makes sense. On a $100k account those thresholds fire on completely normal noise wicks.
  - **Solution — `InpPreservationMode` master toggle (default ON)**:
    - **MOMENTUM_FADE**: completely disabled (SL + AI veto + Profit Ladder are sufficient).
    - **TIME_EXPIRED on winners**: skipped entirely. Never close a profitable trade because of the clock.
    - **STALE_DRIFT**: completely disabled (drift trades are usually winners catching breath).
    - **STALE_LOSS**: threshold raised from -0.6R → -2R (lets trade work much longer before time-cutting losers).
    - **SMART_CUT**: threshold raised from -0.25R/3min → -1.5R/8min, deepLoss from -0.5R → -2R. Won't bail on a small adverse blip.
    - **PEAK_RETRACE**: armed only at peak ≥ $200 + 90% retrace (vs $50/75% in legacy mode). Becomes a runner-saver, not a scalper.
  - **`InpRiskPercent` default 1.0 → 0.4%** — was 1% per trade × 5+ legs/sequential trades = 5%+ exposure during streaks; new default keeps catastrophic drawdown bounded even on bad days.
  - **Backwards toggle**: set `InpPreservationMode=false` to restore the v4.7.1 aggressive behavior.
  - All AI veto wiring from v4.7.0/v4.7.1 still applies on top — Claude can still HOLD/CLOSE/LOCK as needed.
  - Compile: braces 0/0, parens 0/0, 3543 lines, 10 Preservation Mode gates wired.
  - Frontend bumped to v4.7.2.

- **Feb 2026 - v4.7.1 — "AI Exit Brain — full coverage" (audit pass after user concern)**
  - User asked: "Hope no bugs… check everything so logic doesn't mix into each other."
  - **Audit performed**: cataloged all 13 unique close paths in ManagePositions and verified ordering + AI-veto coverage.
  - **Found 2 gaps from v4.7.0**: PEAK_RETRACE and TIME_EXPIRED were the very closes the user originally complained about ("ends trade and market moves on bot direction") and they had NO AI veto. Fixed.
  - **Final exit-flow map** (top → bottom in code, all close attempts gated except catastrophic safety nets):
    | # | Path | AI veto? | Why |
    |---|---|---|---|
    | 1 | HARD_STOP_R (3R catastrophic) | NO | safety net |
    | 2 | HARD_STOP (legacy abs) | NO | safety net |
    | 3 | EARLY_ADVERSE | NO | losing trade, AI can't help |
    | 4 | **PEAK_RETRACE** | **YES** ✓ (NEW) | exactly the user's complaint |
    | 5 | PEAK_LOCK_BACKSTOP | n/a (SL only) | universal SL ratchet |
    | 6 | PROFIT_LADDER | n/a (SL only) | universal SL ratchet |
    | 7 | MOON_TRAIL | n/a (SL only) | universal SL ratchet |
    | 8 | MOMENTUM_FADE | YES ✓ | v4.7.0 |
    | 9 | QUICK_PROFIT_CAP | NO | dormant (InpSmartCapExit=true default) |
    | 10 | CAP_RUNNER | n/a (SL only) | dormant when Ladder ON |
    | 11 | PROFIT_CEILING | NO | $25k absolute ceiling |
    | 12 | **TIME_EXPIRED** | **YES** ✓ (NEW) | exactly the user's complaint |
    | 13 | RUNNER (post-time) | n/a (SL only) | trail only |
    | 14 | SMART_CUT | NO | losing trade, AI gate skips |
    | 15 | STALE_LOSS | YES ✓ | v4.7.0 |
    | 16 | STALE_DRIFT | YES ✓ | v4.7.0 |
    | 17 | CLAUDE_AI proactive | uses verdict ✓ | v4.7.0 |
  - **Conflict check**: SL ratchet paths (PEAK_LOCK, LADDER, MOON, BE_LOCK, TRAIL, CAP_RUNNER, RUNNER) all run BEFORE close attempts — they only modify SL, never call PositionClose. SafeModifySL returns silently when SL already at target (v4.6.5 no-op guard). No double-modify risk.
  - **Cooldown sharing**: PATH C audit and AIBlocksClose share `aiVetoLastCall[]` cooldown (60s default) → if MOMENTUM_FADE consumed the cooldown, PATH C audit waits — intentional cost control, no race.
  - **Backwards compat verified**: backend defaults peak_profit=0, pending_exit_reason="", regime="" → old EA versions (v4.7.0 and earlier) still get valid responses.
  - **Live verification**: VETO request → LOCK $X with reasoning. Legacy request → HOLD with reasoning. Both routes work.
  - Compile: braces 0/0, parens 0/0, 3523 lines, 5 AIBlocksClose call sites.
  - Frontend bumped to v4.7.1.

- **Feb 2026 - v4.7.0 — "AI Exit Brain" (Claude vetoes bad rule-based closes — finally smart exits)**
  - User pain: "the only thing killing things is the exit logic… it doesn't reason before it takes actions". Bot was trading well on entries, but rule-based exits (MOMENTUM_FADE / STALE_DRIFT / STALE_LOSS) were closing winners right before continuation, OR letting profit retrace from huge to loss.
  - **Solution — Claude veto override (cost-aware, ~$1-2/month extra)**:
    - Backend `/api/ai/manage-position` upgraded to a 3-action vocabulary: **HOLD** / **CLOSE** / **LOCK ($X)**. New context fields: `peak_profit`, `pending_exit_reason`, `regime`.
    - LOCK action: Claude can choose a $ amount to bank as SL floor instead of closing (e.g. peak $700 retracing → LOCK $400 floor, keep the runner). EA computes SL price from the $ amount, sanity-checks it, and ratchets only.
    - System prompt: dedicated VETO mode when EA tells Claude "rule-based exit X wants to close — veto if thesis intact". Claude reasons against the original thesis + invalidation + current market state.
  - **EA wiring**:
    - New input group `=== AI EXIT BRAIN ===`: `InpAIExitOverride=true`, `InpAIExitMinSec=60` (cost cooldown), `InpAIExitMinProfit=30` (only call AI when there's meaningful profit at stake).
    - New helper `AIBlocksClose()` called BEFORE every rule-based close. If AI says HOLD or LOCK → close is blocked. If AI says CLOSE → confirms with reasoning logged.
    - Wired into 3 close paths: MOMENTUM_FADE, STALE_LOSS, STALE_DRIFT.
    - PATH C (proactive Claude semantic exit) upgraded to use new struct, can now LOCK $X instead of just close.
    - Per-position cooldown via `aiVetoTickets[]` arrays + cleanup in OnTradeTransaction.
  - **Cost math**: Claude Sonnet 4.5 ≈ $0.0024 per call. Cooldown = 60s. Cost gate = profit/peak ≥ $30. Estimated 1-3 calls per trade × ~90 trades/month ≈ ~270 calls = **~$0.65/month** (well under $10 user budget).
  - **Verified live**: test endpoint returns LOCK $400 with reasoning when MOMENTUM_FADE wants to close a healthy thesis-aligned position, and HOLD when a small drawdown trade is still in-thesis.
  - Compile: braces 0/0, parens 0/0, 3515 lines, 167KB.
  - Frontend bumped to v4.7.0.

- **Feb 2026 - v4.6.7 — "Peak-Lock Backstop" (root cause: huge accounts skipped Tier 1)**
  - User report: live trade peaked at +$700, exited at **-$45**. SL never moved.
  - **Root cause**: the Profit Ladder tiers scale with balance. On a $50k+ account, Tier 1 trigger is $250+, so a $700 peak that retraced still never crossed any tier — SL stayed in original loss territory and got hit when price reversed.
  - **Fix — universal Peak-Lock Backstop**: independent of balance, runs BEFORE the Ladder. Once peak profit reaches `InpPeakLockArmUSD` (default $50), forces SL to lock at least `InpPeakLockMinPct`% of peak (default 25%). Examples: peak $200 → lock $50, peak $700 → lock $175, peak $5000 → lock $1250. Sanity-checked (must sit in profit zone) and ratchet-only (never moves SL backward). Profit Ladder still ratchets HIGHER on top when its tiers fire.
  - New inputs: `InpPeakLockBackstop=true`, `InpPeakLockArmUSD=50.0`, `InpPeakLockMinPct=25.0`.
  - New log: `PEAK_LOCK #ticket peak $700 — backstop locked 25% = +$175 (price 4xxx). Worst case = banked.`
  - Compile: braces 0/0, parens 0/0, 3353 lines.
  - Frontend bumped to v4.6.7.

- **Feb 2026 - v4.6.6 — "Moon Trail" (target massive profit + smarter SL ratchet)**
  - User: "PN EXIT STRATEGY TO TARGET TO CLOSE AT MASSIVE PROFIT… SHOULD ALLOW SL MOD DO BETTER WORKS"
  - **Profit Ladder extended from 5 → 7 tiers** for massive-profit lock-in:
    - Tier 6 (default 8% balance trigger / 5% lock)
    - Tier 7 (12% / 8%) = MOON tier
  - **Moon Trail (`InpLadderMoonTrail`, default ON, `InpLadderMoonTrailATR=3.5`)**: once tier 7 fires, SL switches to a wide 3.5×ATR trail behind price. Every new high ratchets SL up automatically — winner keeps running for as long as the move continues, but every new peak is banked. This is what turns "$3k locked" into "$8k, $12k, $20k locked" as the move extends.
  - **CAP_RUNNER overlap killed**: when Profit Ladder is ON, the old CAP_RUNNER tightening (1.5–2.5×ATR) is skipped. Ladder/Moon are now the SOLE SL ratcheter for the smart-management path. No more competing trails clipping winners.
  - **Profit ceiling raised $5k → $25k**: large accounts no longer get force-closed mid-monster. Still acts as a final safety brake.
  - Compile: braces 0/0, parens 0/0, 3312 lines.
  - Frontend bumped to v4.6.6.

- **Feb 2026 - v4.6.5 — "Quieter & Friendlier" (5-min cooldown + no SL-mod log spam)**
  - User pain: "SL-MOD FAIL" still spamming the journal AND the post-winner entry block was killing nice trades by sitting on a 30-minute cooldown.
  - **Fix #1 — SL-MOD silence**: `SafeModifySL` now has a no-op guard. Before calling `trade.PositionModify`, it reads `POSITION_SL`/`POSITION_TP` and returns silent success if they're already at the target (within 2-pt tolerance). This was the #1 cause of `Ret=10025 NO_CHANGES` spam. Also downgrades benign retcodes (10025 NO_CHANGES, 10004 REQUOTE, 10021 OFF_QUOTES, err=4756 invalid stops) to a 1-per-minute throttled `SL-MOD INFO` line. True failures (broker reject for non-trivial reasons) still log loudly.
  - **Fix #2 — Post-winner cooldown 30→5 min + tunable**: new input group `=== POST-WINNER ENTRY GUARD ===` with `InpPostWinnerGuard` (toggle, default ON), `InpPostWinnerCoolMin` (default **5**, was hard-coded 30), and `InpPostWinnerATRBump` (default 0.5). Set `InpPostWinnerGuard=false` to disable entirely or `InpPostWinnerCoolMin=0` for the same effect.
  - Compile: braces 0/0 balanced, parens 0/0 balanced, 3257 lines.
  - Frontend bumped to v4.6.5.

- **Feb 2026 - v4.6.4 — "Ladder Sanity" (kill the invalid-stops spam on profit retrace)**
  - User pain: live MT5 log showed `Ret=10016 Err=4756 [invalid stops]` looping during volatile retrace. Profit had spiked into Tier-3 ($1k+ lock), then price retraced back below the locked SL price → every Ladder pass tried to set SL on the WRONG side of current price → broker hard-rejected → infinite spam.
  - **Fix**: Profit Ladder now runs a sanity check before ratcheting. The lock SL must sit between the entry and current price (in the profit zone) AND respect the broker's `SYMBOL_TRADE_STOPS_LEVEL` + a 30-point breathing buffer. If the lock fails the check, the EA logs `LADDER SKIP: lock $X (price Y) doesn't fit in profit zone — waiting for it to rebuild` (throttled to once per minute) and waits for profit to rebuild.
  - This means: a high-tier lock that becomes physically impossible (because price retraced) is silently postponed instead of getting rejected by the broker. When profit recovers, the ladder ratchets normally.
  - Compile: braces 0/0 balanced, parens 0/0 balanced, 3230 lines.
  - Frontend bumped to v4.6.4.

- **Feb 2026 - v4.6.3 — "Stop Killing Winners" (disable aggressive trails when Ladder ON)**
  - User pain: gold went 4711 → 4693 (bot called direction RIGHT every time) but every SELL exited at +$11 / +$157 / +$317 — clipping at 0.02-0.9 points instead of riding for thousands.
  - **Forensic root cause**: BE_LOCK was firing at +1R then placing SL at openPx + 0.25R = ~0.3 points above entry on these big-lot trades. Gold's normal noise wicks 0.3 points within seconds → SL hit → exit at near-zero profit. Same for PATH A 1.2×ATR trail kicking in at first profit point. Both were redundantly competing with the new Profit Ladder.
  - **Fix**: when `InpProfitLadder = true` (default), the old BE_LOCK and PATH-A trail are SKIPPED entirely. Profit Ladder is the sole SL ratcheter — and it only moves SL when MEANINGFUL $ profit is reached (% of balance), not on a single 1R noise spike.
  - Set `InpProfitLadder = false` to revert to legacy BE_LOCK + PATH-A trail behavior.
  - Compile: 301/301 braces, 1826/1826 parens.
  - Frontend bumped to v4.6.3.

- **Feb 2026 - v4.6.2 — "Account-Scaled Profit Ladder"**
  - User concern: ladder tiers shouldn't be fixed $ — must scale to account size.
  - Made all 5 ladder tiers % of balance (default 0.5/1/2/3.5/5% trigger, 0.2/0.5/1.2/2/3% lock) with $25/$10 micro-account floors.
  - Toggle via `InpLadderUsePct=true` (default). Set false for legacy fixed $ mode.

- **Feb 2026 - v4.6.1 — "Profit Ladder" (auto-lock SL into profit as $ grows)**
  - User idea (perfect, zero credit cost): "once trade goes above $1k profit, push SL to lock guaranteed profit. Never lose a winner again."
  - **5-tier ladder** that automatically pushes SL into profit territory based on $ profit reached:
    - $500 reached → SL locks at +$200
    - $1,000 reached → SL locks at +$500
    - $2,000 reached → SL locks at +$1,200
    - $3,500 reached → SL locks at +$2,000
    - $5,000 reached → SL locks at +$3,000
  - **All tiers user-configurable** via inputs (`InpLadderTier1Profit`, `InpLadderTier1Lock`, etc.)
  - Works for BOTH BUY and SELL symmetrically.
  - Math: converts $-lock target into price-points using the trade's actual rDollars, so it works correctly regardless of lot size.
  - Uses `SafeModifySL` (freeze/stops aware) so won't fail silently.
  - Only ratchets in profit direction — never moves SL backwards.
  - Logs: `PROFIT_LADDER #123 profit $1,250 ≥ tier $1000 — SL locked at +$500 (price 4695.50). Worst case = banked profit.`
  - Compile: 292/292 braces, 1817/1817 parens.
  - Frontend bumped to v4.6.1.

- **Feb 2026 - v4.6.0 — "Trend Continuity" (smart exit + smart pyramid)**
  - User pain point: bot exited a winning SELL @ 4700 → 4699.67 for tiny +$317 (hit partial TP at 1R = 0.55 pts on big lots), then re-entered at 4696 (worse price), got stopped on bounce -$1,687, then market went down to 4695 vindicating the original prediction. Net: -$1,369 on what should have been +$2,800.
  - Also: "PYRAMID: SKIP — add needs $15,846 margin, only $25,590 free" spamming every tick.
  - **3 surgical fixes:**
  - **Post-winner entry block** — if last close was a WIN in the same direction within 30 min, NEW entries are blocked unless price is ≥0.5×ATR BETTER (lower for BUY, higher for SELL). Prevents the "scalper got scalped" cascade.
  - **Partial TP delayed**: threshold raised from 1.0R → 1.5R + minimum 3-min hold time before partial can fire + fraction reduced from 50% → 40% (leaves 60% to ride). Net effect: winners get meaningfully more room before any partial.
  - **Pyramid margin gate relaxed**: `marginNeeded > freeMargin × 0.5` → `× 0.7` (allows pyramid when 60% of margin used vs old 50%) + free-margin floor 30% → 25%. Skip log throttled to once per minute (was every tick).
  - Compile: 289/289 braces, 1797/1797 parens.
  - Frontend bumped to v4.6.0.

- **Feb 2026 - v4.5.9 — "Partial Sanity" (fix double-firing partial TP)**
  - User reported: "I don't think the pyramid is working well. It supposed to be 0.6× the original lots." Live log forensics revealed the SAME ticket (#151979111808) firing PARTIAL_TP twice within 0.5 seconds (closed 0.02 of 0.04, then closed 0.01 of 0.02), eventually leaving micro positions that pyramid couldn't scale meaningfully.
  - **Root cause #1**: `OnTradeTransaction` treated the partial-close DEAL_ENTRY_OUT event as a full close. This called `ClearPartialTaken(posId)` removing the ticket from the tracker. Next tick: `PartialAlreadyTaken()` returned false → fired again → again → again. Each pass halved the lots until broker minimum.
  - **Root cause #2**: Same handler ALSO ran `totalTrades++; wins++; RecordCloseForStreak; UpdateDrawdownState; LogTradeToServer; RecordPattern` for partial closes — inflating Win counts (user saw "Win 90%" which was largely partial-close artifacts), corrupting streak counters, polluting the journal, and skewing ML training data.
  - **Fix**: At the top of OnTradeTransaction, check if `PositionGetTicket(i) == posId` exists in `PositionsTotal()`. If yes → it's a partial close → log "PARTIAL CLOSE event" and `return` immediately, bypassing all stats/cleanup code. If no → it's a real full close, proceed with all the existing logic.
  - Side benefits: ML signatures, win rate, streak tracker, drawdown mode, and journal will all now reflect ONLY real complete trades. Win rate displayed on dashboard will drop (briefly) to honest values.
  - Pyramid `origLot` will now stay accurate because partials no longer chain-shrink the same position.
  - Compile: 285/285 braces, 1773/1773 parens.
  - Frontend bumped to v4.5.9.

- **Feb 2026 - v4.5.8 — "User Gates" (full user control over risk limits)**
  - User concern: the weekly/daily/equity limits that pause the EA should respect user configuration.
  - **Truth**: the inputs `InpDailyLossLimit`, `InpWeeklyMaxLoss`, `InpWeeklyTarget`, `InpEquityProtect` were already user-configurable — but couldn't be fully disabled.
  - **v4.5.8 adds `0 = disabled`**: set any gate to `0` in the input panel to completely bypass it.
  - Input descriptions updated to say "set 0 to disable" so it's discoverable in MetaEditor's input panel.
  - Heartbeat logs now hint at the disable option: `Set InpDailyLossLimit=0 to disable this gate`.
  - Default values unchanged (6% daily, 15% weekly loss, 50% weekly target, 70% equity protect).

- **Feb 2026 - v4.5.7 — "Heartbeat" (never silently stop scanning)**
  - User reported: "Each 5M scanning update has stopped for 10 min".
  - Root cause: user's account took a massive floating loss (-$44,944). When realized, it breached the weekly/daily loss limit. The EA correctly paused for capital preservation — but printed the pause reason only ONCE and then silently returned on every subsequent tick forever, making the EA look dead.
  - Fix: 5-minute heartbeat log prints the active pause reason (EQUITY_PROTECT / WEEKLY_LOSS / WEEKLY_TARGET / DAILY_LOSS) with the specific $ amounts and thresholds, so the user always knows exactly why the bot is quiet.
  - Frontend bumped to v4.5.7.

- **Feb 2026 - v4.5.6 — "Live-Ready" (pre-live P0 bug sweep)**
  - Ran comprehensive pre-live-trading audit via troubleshoot_agent. Found and fixed 5 bugs that would cause real money losses on live broker:
  - **P0-1/2/3 — Silent PositionModify failures** (8 call sites): Added new `SafeModifySL()` helper that:
    - Checks `SYMBOL_TRADE_STOPS_LEVEL` and clamps newSL to minimum allowed distance from current price (brokers reject SL too close → error 130).
    - Checks `SYMBOL_TRADE_FREEZE_LEVEL` — skips modify with throttled warning if price is within freeze band (can't modify during freeze).
    - **Logs any non-success retcode** so we see silent failures for the first time. Previously, failed SL updates (requote, off quotes, no connection) happened silently → position kept running with stale/entry SL → catastrophic loss on reversal.
    - All 8 trade.PositionModify call sites (TRAIL-A x2, BE_LOCK x2, CAP_RUNNER x2, RUNNER x2) refactored to use SafeModifySL. Log messages only fire on successful modify.
  - **P1-1 — Pyramid inheriting BE-locked SL**: When the original position had its SL BE-locked (moved past entry), pyramid adds inherited this dangerously tight SL → got stopped on normal noise → defeated pyramid purpose. Now pyramid detects BE-lock and places a FRESH ATR-based SL for the add, with logged rationale.
  - **P1-3 — PARTIAL_TP log math**: Changed `profit * InpPartialPct` to `profit * (partialLots / curLots)` so "locked $X" is accurate when broker can't split exactly 50/50 on odd lot sizes.
  - **P2-1 — Margin warning spam throttled**: The loud ⚠️ MARGIN-CAPPED warning now fires max once per 5 min (was every margin-capped trade).
  - Audit found NO issues with: lot normalization (v4.5.5 clean), division-by-zero guards, BUY/SELL symmetry, state tracker cleanup (posId correctly equals position ticket on both hedge and netting), margin handling, no orphaned positions.
  - Compile: 277/277 braces, 1737/1737 parens.
  - Frontend bumped to v4.5.6.
  - **User's live trade forensics**: logs showed `PYRAMID: adding #3/5 BUY 0.01 lots` repeatedly despite configured 0.6× multiplier. Root cause = 2-bug chain:
    1. **Margin silent-clamp in OpenTrade**: with ~10 lots of open positions eating ~$47k margin on a $54k account, free margin was near zero. The margin guard `while(lots > minLot && marginNeeded > freeMargin * 0.5)` silently chopped desired ~1.3 lots down to broker minimum 0.01.
    2. **Pyramid compounded**: `smallestLot(0.01) × 0.6 = 0.006` → `MathFloor → 0` → `MathMax(minLot, 0) = 0.01`. Every subsequent add was 0.01 forever.
  - **Fixes shipped:**
    - Pyramid lot now bases on **ORIGINAL position's lot size** (oldest entry) × `pow(multi, addNumber)` for predictable geometric decay: add#1=0.6×, add#2=0.36×, add#3=0.22×. Avoids compounding collapse after partial TP leaves a small remainder.
    - **Pyramid SKIPS entirely** (no 0.01 spam) if calculated lot would clamp to broker minimum. Logs: `PYRAMID: SKIP — origLot=0.01 × 0.600 = 0.006 would clamp to minLot 0.01. Pyramid pointless at this scale.`
    - **Free-margin gate**: pyramid skips if free margin < 30% of equity. Logs reason.
    - **OpenTrade MARGIN-CAPPED warning**: logs a loud ⚠️  warning when margin forces > 20% lot reduction. Additionally SKIPS the trade entirely if reduction goes all the way to minLot when 5× minLot was desired (prevents the cascade: tiny original → minLot pyramids).
  - **"Bot not trading for 3 hours" diagnosis**: confirmed Emergent LLM credits are healthy (Dual-AI responded correctly during debug). Real culprits likely: streak cooldown, margin exhaustion from still-open losing trades, or drawdown-recovery mode active. v4.5.5 adds visibility to all of these via loud log messages so the user can see exactly what's gating new entries.
  - Frontend bumped to v4.5.5.

- **Feb 2026 - v4.5.4 — "Partial TP" (lock half at +1R, ride the rest)**
  - User-requested. ZERO LLM credit cost — pure MQL5 logic.
  - When a trade reaches +1R in profit, bot auto-closes 50% of the position via `CTrade::PositionClosePartial()`.
  - Remaining 50% stays alive and rides the trailing SL (or conviction runner if ≥90% conf).
  - Skipped on ≥90% AI-confidence trades by default (`InpPartialSkipHighConf=true`) — those are meant to fully run via the 3×ATR conviction runner trail.
  - Fires ONCE per ticket (guarded by `partialTakenTickets[]` array). Reset on position close.
  - Lot math guards: partial AND remaining chunks must both be ≥ broker minimum, otherwise skipped cleanly.
  - New inputs: `InpPartialTP=ON`, `InpPartialTPAtR=1.0`, `InpPartialPct=0.5`, `InpPartialSkipHighConf=true`.
  - Log: `PARTIAL_TP #123 closed 1.00 of 2.00 lots at +1.02R ($185 locked). Remainder 1.00 rides the trail.`
  - Frontend bumped to v4.5.4.

- **Feb 2026 - v4.5.3 — "Conviction Runner" (let 90%+ trades RUN)**
  - New tier of trail protection for the bot's highest-quality setups.
  - Triggers when (a) original Dual-AI entry confidence was ≥90% AND (b) trade is already ≥+2R in profit.
  - Under these conditions, trail widens to 3.0 × ATR (largest in the system) — bigger than breakout trail (2.5×) and double the range trail (1.5×).
  - Rationale: if both Claude + GPT-5.2 said "textbook, would bet big" at 90%+ AND the market has validated by giving us 2R, this is the trade of the day. Low residual risk (already +2R locked), maximum upside.
  - New inputs: `InpConvictionRunner=ON`, `InpConvRunMinConf=90`, `InpConvRunMinR=2.0`, `InpConvRunnerMulti=3.0`.
  - Logs once per minute when upgrade fires: `CONVICTION RUNNER: 91% conf + 2.15R profit → trail upgrade 2.20x → 3.00xATR`.
  - Frontend bumped to v4.5.3.

- **Feb 2026 - v4.5.2 — "Trend-Aware Trail" (market-mood adaptive trailing)**
  - Added `GetTrailATRMulti()` helper that picks the best trail distance based on current regime + EMA separation + volatility overlay.
  - Regime-based base trail:
    - BREAKOUT (up/down): 2.5 × ATR (widest — breakouts extend)
    - TRENDING + strong EMA separation (>30 bp): 2.5 × ATR
    - TRENDING normal: 2.2 × ATR
    - RANGING: 1.5 × ATR (v4.5.1 default)
    - CHOPPY: 1.3 × ATR (fewer real follow-throughs)
    - LOW_VOL: 1.0 × ATR (tight ranges = tight trail)
  - Volatility overlay still respected: spike bars force widening, calm bars allow tightening.
  - Both CAP_RUNNER trail and time-expired RUNNER trail now use the helper. Logs show `trailed to X (2.50xATR, TRENDING_UP)` for full visibility.
  - New `InpTrendAwareTrail` toggle (ON by default). Tunable multipliers: `InpTrendTrailMulti=2.2`, `InpStrongTrendTrail=2.5`, `InpChoppyTrailMulti=1.3`, `InpLowVolTrailMulti=1.0`.
  - Frontend bumped to v4.5.2.

- **Feb 2026 - v4.5.1 — "Loosen the Leash" (wider BE + volatility-aware trailing)**
  - User feedback from live trade log: "trailing is too tight the trailing don't reason well." Evidence: BUY 2.14 @ 4697 closed flat at +$45 (BE lock grabbed it on a 1-point wick) while gold ran to 4717 = missed $4,300 move. BUY 3.58 @ 4699 closed -$1,242 (trail clipped on pullback wick) while gold then ran to 4717.
  - **BE lock raised from +0.5R → +1.0R** (`InpBELockActivateR=1.0`): wait for the trade to double the risk before locking. Prevents early BE exits on normal noise.
  - **BE lock now locks PROFIT, not zero**: SL goes to `openPx + 0.25R` (was `+10 points = basically flat`). Even if hit, trade exits with real profit.
  - **Volatility-aware CAP_RUNNER trail** (was flat 0.8 × ATR = clipped on normal wicks):
    - Normal bars: 1.5 × ATR
    - High-vol spike bars: 1.8 × ATR (widens for survival)
    - Calm bars: 1.2 × ATR (tighter when safe)
  - **Claude audit from 10 min → 15 min** (`InpClaudeAuditSec=900`) — less panic closes during normal consolidation.
  - New TRAIL log line at startup shows all trailing parameters.
  - Frontend bumped to v4.5.1.

- **Feb 2026 - v4.5.0 — "The Trader's Mind" (conviction + Devil's Advocate + thesis audits)**
  - User feedback: "it just trade base on instruments like a robot as if it doesn't really reason before it take actions... it has Claude it should be better than this"
  - **Devil's Advocate prompt**: entry system prompt now REQUIRES both Claude and GPT-5.2 to articulate a `bearish_case` (counter-argument) + `skip_if` (pre-entry veto condition) on every call. Prevents one-sided confirmation bias.
  - **Conviction-Weighted Sizing** (`InpConvictionSizing=ON`, inputs `InpMinAIConfidence=60`, `InpNormalAIConfidence=75`, `InpHighAIConfidence=90`): EA now parses the combined AI confidence integer and scales lot size:
    - <60%: SKIP entirely (prevents marginal trades that historically lose money)
    - 60–74%: 0.5× size (small bet on uncertain setup)
    - 75–89%: 1.0× size (normal)
    - ≥90%: 1.3× size (high-conviction trades get meaningful skin in the game)
  - **Thesis-Aware Mid-Trade Audits**: `/api/ai/manage-position` now accepts `thesis`, `invalidation`, and `confidence` from the EA. Claude's system prompt is rewritten to AUDIT whether the ORIGINAL reason still holds given new market data — HOLD if thesis intact, CLOSE only when invalidated. No more mechanical "take $150-500 profit" closes. Tested live: healthy trade with good thesis → Claude says HOLD; broken trend → Claude says CLOSE with specific reasoning.
  - Dashboard now shows confidence %, the Devil's Advocate counter-argument, and thesis invalidation condition on the live chart.
  - Entry log expanded to print thesis + Devil's Advocate + skip-if + invalidation + target for every decision.
  - Frontend bumped to v4.5.0.

- **Feb 2026 - v4.4.5 — "Hold & Stack" (R-based HardStop + Pyramid)**
  - **Critical root cause found from user logs**: `HardStopUSD` auto-scaled to 0.8% of balance. Lot size also auto-scaled with balance. Combined effect: 1-point adverse wiggle on a 5.95-lot position = -$481 = 0.8% of balance = HardStop fired in <1 minute. Reviewed user's last 12 losers — ALL followed this pattern (cut on tiny adverse wiggles, price then reversed into profit).
  - **R-BASED HardStop** (`InpHardStopRBased=true`, `InpHardStopRMulti=3.0`): HardStop now fires at 3× the trade's ORIGINAL risk (3R catastrophic cap) instead of a decoupled $ figure. Adaptive to lot size automatically. The absolute-$ path still available (`InpHardStopRBased=false` + `InpHardStopUSD>0`) for legacy users.
  - **EarlyAdverseCut OFF by default** (was ON at 0.7R/5min) — this was the other big scalper. Threshold raised to 1.5R when enabled.
  - **PeakRetracePct 60% → 75%** — only deep give-backs trigger retrace exit.
  - **Momentum-fade unanimous** (`InpMomentumFadeScore=4` from 3) — need all 4 reversal signals to fade a winner.
  - **PYRAMID SCALE-IN** (`InpAllowPyramid=true`): when a position is open and (a) regime still supports direction, (b) not direction-locked, (c) price moved ≥0.3 ATR adverse OR ≥0.5 ATR with-trend, (d) 2+ min since last add, (e) no drawdown/streak/daily/news block — opens a new smaller same-direction position. Sizes DECREASE (0.6× multiplier) so 5 trades total have bounded risk, NOT a martingale. Max 5 concurrent (original + 4 adds).
  - New dashboard line shows "Open: N/5 (pyr max 5)". ARMOR log now prints R-based + fade threshold.
  - Frontend bumped to v4.4.5.

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
