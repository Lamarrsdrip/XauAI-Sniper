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
