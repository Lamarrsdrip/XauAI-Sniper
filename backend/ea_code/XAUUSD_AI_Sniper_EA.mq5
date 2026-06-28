//+------------------------------------------------------------------+
//|                                     XAUUSD_AI_Sniper_EA.mq5      |
//|                                     XauAI Sniper — M5 Gold Edition|
//|   v6.3.9 — Verification & Hardening: TradeBrain audit, ATR-adaptive|
//|            profit lock, smart growth safety overrides, gate file   |
//|            reports, forward-test report mode                       |
//+------------------------------------------------------------------+
// v6.3.9 CHANGES (2026-06-28):
//   1. TRADEBRAIN TYPO FIX: all Print() log strings corrected TRADEBBRAIN→TRADEBRAIN.
//   2. GetPerformanceMultiplier() SAFETY OVERRIDES (5 new guards):
//      Override 1: cap at 1.0 when floating drawdown > 0.5% of balance.
//      Override 2: cap at 1.0 when currentATR > 1.5× 50-bar median ATR (high vol).
//      Override 3: cap at 1.0 when daily P&L is negative.
//      Override 4: cap at 1.0 when TradeBrain has < 10 samples.
//      Override 5: hard cap 1.15× (was 1.30×).
//      Consecutive loss thresholds: ≥3 → 0.70 immediately; ≥5 → 0.50 immediately.
//   3. ATR-ADAPTIVE PROFIT LOCK: SL tightening now uses MathMax(1.5×ATR, minStopDist)
//      instead of a fixed 20% of open distance. g_dailyProfitLockArmed prevents
//      re-trigger on every tick; partial resets below 50% threshold.
//   4. AI FEEDBACK LOOP: added missing `ai_reason` and `direction` fields to WebRequest body.
//      Added explicit error log for non-200 responses (not just -1/4060).
//   5. AI CONSENSUS LOGGING: Print("AI DIRECTOR: Claude=..., GPT=..., consensus=..., final=...")
//      added at the point where AI JSON response is parsed (after Claude/GPT votes extracted).
//   6. GATE FILE REPORT: WriteGateReportToFile() writes daily .txt file in common folder.
//      Called alongside PrintGateReport() every 24h and on OnDeinit().
//   7. FORWARD TEST REPORT: WriteForwardTestReport() generates XAUAI_ForwardTest_YYYY.MM.DD.txt.
//      Globals track signals, trades, P&L, DD, AI stats, strategy breakdown.
//      Written at 23:59 server time and on OnDeinit(). g_ftReport_* globals initialized in OnInit().
//   8. VERSION: #property version updated to 6.3.9; header comment updated.
// v6.3.8 CHANGES (2026-06-28):
//   1. TRADEBBRAIN PERSISTENCE: g_tradeMemory[] saved to MQL5/Files/XAUAI_TradeBrain_v1.csv
//      every time a new entry is added. Loaded at OnInit. Survives restarts. FIFO 500 entries.
//   2. ATR-NORMALIZED MATCHING: pattern lookup now filters by ATR regime bucket (LOW/MED/HIGH),
//      session, and HTF trend direction. Recency weighting: last 20 = 2x, old >100 = 0.5x.
//      Minimum 5 samples for filtered result; fallback to session-only, then global average.
//   3. AI SL/TP ADVISORY: ENUM_AI_SLTP_MODE (OFF/ADVISORY/SAFE_ASSIST/FULL_CONTROL).
//      Default ADVISORY = logs AI suggestion, never auto-applies. ATR-based SL/TP unchanged.
//   4. GPT MODEL FIX: gpt-5.2 (invalid) replaced with gpt-4o. Per-provider latency logging.
//      consensus_source field in API response: dual_consensus/claude_only/gpt_only/none.
//   5. AI FEEDBACK LOOP: outcome (CORRECT/WRONG/CONSERVATIVE_CORRECT) POSTed to /api/ai/feedback
//      after every trade close. Backend stores to ai_feedback_log.jsonl + MongoDB.
//      /api/ai/feedback/stats endpoint for accuracy analysis by confidence/strategy/session.
//   6. GATE ANALYTICS: g_gateBlocks_* counters for every gate type. PrintGateReport() called
//      every 24h and on OnDeinit(). g_totalSignals / g_totalAllowed track pass rate.
//   7. SMART GROWTH: GetPerformanceMultiplier() adjusts lot sizing ±30% based on last 10 trades.
//      Daily profit lock tightens trailing stops when day gain >= InpDailyProfitLockPct (3%).
//      Equity watermark: g_equityHighWatermark + g_drawdownPause when > InpDrawdownFromHighPct (8%).
//   PHILOSOPHY: All existing safety rules preserved. New code is additive. Zero removed gates.
// v5.8.51 CHANGES (Live Account Readiness Audit 2026-06-18):
//   1. SL THROTTLE: trailing mods capped at 1/sec (prevents 15-30s cascade on 3-pos baskets)
//   2. CONTEXT-BUSY RETRY: 150ms yield + retry on ERR_TRADE_CONTEXT_BUSY before giving up
//   3. INDICATOR REBUILD FIX: err=4807 transient no longer forces immediate rebuild/warmup
//   4. SPREAD RECOVERY: 90s cooldown after a spread spike before entries re-open
//   5. MOMENTUM SOFT MODE: fastScore>=80 + no opposing TF → x0.80 lot instead of hard block
//   6. SLIPPAGE MONITOR: logs fills with >0.20 ATR slippage + daily slippage statistics
// v5.8.52 CHANGES (A+ Profit Shield — initial, too aggressive):
//   Shield armed at 0.9R, causing force-closes on normal pullbacks (e.g. SELL 4229→4228 $10,
//   then market ran to 4221). Fixed in v5.8.53.
// v5.8.53 CHANGES (Smart Two-Tier Shield 2026-06-18):
//   TIER 1 (low threshold): Arms at 1.5R / 2% equity → moves SL to entry ONLY. Trade runs free.
//   TIER 2 (high threshold): Only fires when peak >= 3R OR 3% equity AND momentum CONFIRMS
//   reversal (score <= 2, trend broken, RSI against). If it's a pullback → APLUS_PULLBACK_DETECTED,
//   trade holds. If genuine reversal → trail tightens or force-closes. Prevents missing good runs.
// v5.8.54 CHANGES (Patient Profit Shield 2026-06-19):
//   Reports showed v5.8.53 still closed several A/A+ positions too early ($0.49/$1.50/$4.27)
//   after arming on noise-level floating profit. The shield is now protective, not
//   profit-cutting: tier 1 ignores tiny peaks, tier 2 can lock account-meaningful profit,
//   market-close is OFF by default, and confirmed reversals tighten SL instead of dumping
//   good trades at tiny profit.
// v5.8.55 CHANGES (Runner Restore Shield 2026-06-19):
//   Live reports showed the newer builds were too quick to turn valid runners into
//   scratch/tiny wins. Tier 1 now observes proven profit by default; it does not move
//   SL to BE unless explicitly enabled. Tier 2 owns meaningful-profit protection.
//   Blocked-trade memory remains a reporting/learning system by default, not a tiny
//   live-scout engine.
// v5.9.0 CHANGES (Precision Audit 2026-06-21):
//   1. PERFORMANCE: GetVolAdaptiveMult() O(n²) bubble sort replaced with ArraySort() — 25× faster on every tick
//   2. PERFORMANCE: ContextGateAllows() caches HTF EMA handles via static locals instead of create/release per call
//   3. PERFORMANCE: PG_PerPositionRatchet() uses global bufATR[1] instead of creating a new iATR handle every tick
//   4. PRECISION: SafeModifySL throttle raised 1→3 mods/sec so all open positions can lock BE in the same second
//   5. INTELLIGENCE: GetTrailATRMulti() widens trail 15% during strong directional RSI to reduce premature stop-outs
//   6. INTELLIGENCE: Stale drift exit now requires EMA to oppose trade direction — flat but aligned trades are held
//   7. VERSION: Startup sync and bot heartbeat version strings updated to v5.9.0
// v6.0.0 CHANGES (Strategic Trend Intelligence 2026-06-23):
//   STRATEGIC TREND INTELLIGENCE (STI) — the biggest intelligence upgrade yet.
//   The EA now understands complete market structure instead of isolated candles.
//   1. STI_ComputeTCP(): Multi-TF Trend Continuation Probability (D1+H4+H1+M30+M15+M5 = 100pts)
//      — every entry sees a 0-100 probability score of the trend continuing.
//   2. STI_ComputeExhaustion(): Exhaustion detection (H4/H1 ATR contraction + RSI divergence)
//      — multiple signals must agree before marking a trend as exhausted.
//   3. STI_ComputeLateEntryRisk(): Late Entry Filter (H4 EMA dist + run bars + H1 RSI)
//      — blocks/reduces entries after the trend has already moved significantly without reset.
//   4. Trend Memory: g_sti struct survives trade closes — macro direction never resets to zero.
//   5. Re-entry Intelligence: after a profitable TP, STI watches for a clean pullback before
//      allowing same-direction re-entry (STI_AfterProfitableClose + STI_BlockLateReentry).
//   6. TCP-based exit guidance: stagnant/stale cuts suppressed when TCP >= TCPContinueMinimum
//      and trade is profitable — lets high-probability runners continue riding the trend.
//   7. All existing modules (Profit Guardian, Smart Guard, EPF, Clean Exits, Basket Protect)
//      unchanged. STI is an additive intelligence layer, not a replacement.
//   PHILOSOPHY: strict != smart. STI only hard-blocks extreme late entries / exhausted trends.
//   Borderline cases get lot reduction. The bot stays aggressive on high-quality setups.
// v5.9.1 CHANGES (Balanced Precision 2026-06-22):
//   Merges Claude's Precision Audit with Codex's Precision Refinement engineering improvements.
//   No new strategy or features — pure polish.
//   FROM CLAUDE (v5.9.0 Precision Audit — all preserved):
//     ArraySort() in GetVolAdaptiveMult() replaces O(n²) bubble sort — 25× faster.
//     ContextGateAllows() caches HTF EMA handles per-TF via static locals.
//     PG_PerPositionRatchet() reads global bufATR[1] — no per-tick iATR handle create.
//     SafeModifySL throttle: 3 mods/sec (was 1) — all basket positions can lock BE together.
//     GetTrailATRMulti() RSI momentum factor: 15% wider trail on strong directional RSI (68-80 / 20-32).
//     Stale drift exit: EMA must oppose trade direction — flat+aligned trades are held, not killed.
//   FROM CODEX (v5.9.0 Precision Refinement commit 63937bd — safe engineering only):
//     GetVolAdaptiveMult() now caches the computed multiplier per closed M5 bar — avoids
//       redundant 50-bar CopyBuffer+sort on every tick between bar closes.
//     PG_HTFTrendGet() releases hEMA and hATR handles on ALL failure paths, not just success.
//       Eliminates handle leaks when the indicator read fails mid-function.
//   NET RESULT: lowest per-tick overhead yet, no handle leaks, no trading logic changed.
// v6.1.3 CHANGES (Anti-Trend Protection + Basket Loss Block 2026-06-26):
//   ROOT CAUSE AUDIT: Bot was opening SELL trades during a clear XAUUSD bull move
//   (3991→4022→4036+), losing -$260 per trade on 0.18 lots ($3k account).
//   Five specific bugs identified and fixed:
//
//   1. SQUEEZE_RELEASE had NO H1 trend check — fired sell when BB expanded down
//      even during H1 uptrend. Fixed: block sell if h1TrendDir==1 or htfBullConsensus.
//
//   2. LONDON_FIX_PIN had NO trend check — faded EVERY London spike regardless of
//      direction. In a gold bull run, every spike is a valid buy continuation.
//      Fixed: only fade spike if H1 is NOT trending in spike direction.
//
//   3. RANGE_REVERSAL sell required h1TrendDir <= 0 (neutral OR bearish) — neutral
//      H1 (spread < 0.0015) let sells fire in a clearly bullish market.
//      Fixed: now requires h1TrendDir == -1 AND !htfBullConsensus.
//
//   4. MULTI_EXTREME sell same bug — h1TrendDir <= 0 allowed neutral-H1 sells.
//      Fixed: requires h1TrendDir == -1 AND !htfBullConsensus.
//
//   5. No protection against adding sells into a losing sell basket.
//      Fixed: BasketDirectionLossBlock() — if same-direction floating loss exceeds
//      InpBasketDirLossBlockPct (default 2%) of balance, no new same-dir entries.
//
//   6. GLOBAL ANTI-TREND VETO added at end of ScoreSetups():
//      When H1 + context-TF both agree on a direction, all counter-trend mean-
//      reversion setups are blocked. Even TREND_PULLBACK sells are blocked if
//      H1+HTF are both bullish (M5 pullback in bull trend = don't sell gold).
//
//   New inputs:
//      InpBasketDirLossBlock    = true   (master switch)
//      InpBasketDirLossBlockPct = 2.0    (% of balance trigger)
//
// v6.1.2 CHANGES (No DD Blocking 2026-06-25):
//   Removed all drawdown-based entry blocks. Bot now trades regardless of daily loss.
//   1. InpEPF_HardDailyDDPct = 0  → hard daily loss lockdown disabled
//   2. InpEPF_T4BlockHardDD  = false → T4 hard DD block disabled
//   3. InpEPF_CooldownMin    = 0  → no cooldown pause after consecutive losses
//   4. InpStreakPauseSec      = 0  → no streak pause
//   EPF lot-reduction tiers (T1-T4 on profit milestones) are kept — they only
//   adjust size, they do not block. Goal: bot always fires when setup qualifies.
//
// v6.1.1 CHANGES (Data-Backed Block Removal 2026-06-25):
//   30-day forensic attribution (133 trades, WR 63.2%, PF 1.78, net +$228,874) proved:
//   1. DIR-LOCK DEFAULT → false: 30-day data: 1 blocked trade, 2 would-win, 0 would-loss, -5.27 ATR
//      net cost. Zero protection benefit. Costs more in suppressed growth than it ever saves.
//   2. ANTI-BIAS DEFAULT → false: 30-day data: 15 blocked, 7 would-win, 7 would-loss (50/50).
//      Net cost -1.56 ATR. A 50/50 filter is indistinguishable from random — not worth running.
//   3. EPF T4 EliteLotMult 0.12 → 0.20: The lot collapse from avg 21.40 to 0.05 is the primary
//      growth blocker in the current phase. T4 guarded mode at 0.12× makes recovery impossible.
//      0.20× is still strongly defensive while allowing the account to compound back.
//   Rule: being strict does not mean being smart. These three blocks cost more than they save.
//   All other logic unchanged. InpDirectionLockout and InpAntiBiasCorrection remain as inputs —
//   power users can still enable them; default is now data-proven off.
//
// v6.1.0 CHANGES (SMC Entry Layer 2026-06-24):
//   SMC (SMART MONEY CONCEPTS) ADDITIVE CONFIRMATION — the xaubot's entry eye on your brain.
//   PHILOSOPHY: Nothing removed. Nothing gated. SMC bonus lifts quality entries to A/A+
//   and exposes SMC-opposed setups as lower-grade B trades, letting the committee/EPF
//   handle sizing naturally. The aggressive growth personality is fully preserved.
//
//   1. SMC_DetectBOS(): Break of Structure on H1.
//      Tracks highest high and lowest low in InpSMC_BOS_Lookback bars.
//      Bullish BOS: H1 close breaks above recent swing high → g_smc_bos_dir = +1.
//      Bearish BOS: H1 close breaks below recent swing low → g_smc_bos_dir = -1.
//      BOS direction aligned with trade: +InpSMC_BOS_BonusScore to setup score.
//      BOS opposing: logged as BOS_OPP (awareness only, no penalty — growth personality preserved).
//
//   2. SMC_DetectOrderBlocks(): Order Block zones on H1.
//      Bullish OB: last bearish H1 candle before a confirmed bullish impulse (>5×ATR move up).
//      Bearish OB: last bullish H1 candle before a confirmed bearish impulse (>5×ATR move down).
//      When price RETURNS to the OB zone: +InpSMC_OB_BonusScore (default +2.0).
//      This is the xaubot's core entry concept — buying into demand, selling into supply.
//
//   3. SMC_DetectFVGs(): Fair Value Gaps on M15.
//      3-bar imbalance: candle[i+1].high < candle[i-1].low (bullish FVG, price must fill it).
//      When current price is inside unfilled FVG in trade direction: +InpSMC_FVG_BonusScore (default +1.5).
//
//   4. ICT Kill Zone timing bonus: London open (07-10 GMT), NY open (12-15 GMT), London close (15-16 GMT).
//      +InpSMC_KZ_BonusScore (default +0.5) during these windows.
//
//   NET EFFECT: A clean TREND_PULLBACK + BOS + OB + kill zone = +4.0 score bonus.
//   A score of 3.5 (B-grade) becomes 7.5 → A+ in one confluence stack.
//   A trade that fights BOS is logged as BOS_OPP (awareness only); no penalty applied.
//   Zero new blocking logic. Zero risk engine changes. Zero exit logic changes.
//
// v6.0.4 CHANGES (Calendar + Memory + MidLock 2026-06-24):
//   1. SCHEDULED NEWS CALENDAR (IsScheduledNewsWindow, new inputs group):
//      Pure GMT time-math, no external API. Pre-defined recurring high-impact windows:
//        - Sunday 00:00-00:45 GMT — weekly market open gap risk
//        - Monday 00:00-00:30 GMT — Asian open liquidity spike
//        - Thursday 12:15-13:30 GMT — US Jobless Claims
//        - Friday 12:15-14:00 GMT — NFP / US data window (covers all Fridays)
//      Plus 3 user-configurable custom windows (InpCalCustomDay1-3 etc.)
//      Default custom 1: Wednesday 18:00 GMT +90min (FOMC — disable when not FOMC week)
//      Entries blocked silently; logged once per minute to terminal.
//   2. TRADE MEMORY GRADE PRIORS (warm start):
//      Previously: returned neutral 1.0 until 8+ real samples accumulated (took weeks).
//      Now: uses grade-based priors from day 1 and blends them out as real data arrives:
//        A+ pattern → 1.06× prior (historically proven, ~70%+ WR baseline)
//        A  pattern → 1.01× prior (slight positive)
//        B  pattern → 0.91× prior (lower expectancy, slight caution)
//      Linear blend: at 0 samples = 100% prior, at 4 samples = 50/50, at 8+ = 100% real data.
//      This makes the committee useful on the very first trade, not just after weeks of data.
//   3. CUSHIONED MID-ZONE PROFIT LOCK (ratchet Stage 1 upgrade):
//      Between BE trigger (1.5×ATR) and trail start (3.0×ATR), there was a "dead zone"
//      where SL was locked at entry+0.35×ATR even if profit grew to 2.9×ATR.
//      Fix: in CUSHIONED mode, at profit >= 2.0×ATR, SL steps up to entry+0.75×ATR.
//      This provides a progressive staircase: 0.35×ATR lock at 1.5×ATR profit →
//      0.75×ATR lock at 2.0×ATR profit → full trail at 3.0×ATR profit.
//      In DEFERRED mode (strong trend): unchanged — original SL still provides backstop.
// v6.0.3 CHANGES (Forensic Recovery Patch 2026-06-24):
//   FORENSIC INVESTIGATION FINDING (full audit of all 75 EA versions, git history, MT5 logs):
//   1. LOT COLLAPSE ROOT CAUSE CONFIRMED: Manual switch from account #5050699209 ($419K-$483K)
//      to account #108492408 ($3,000) on June 17 at 17:11:43. EA works correctly on both —
//      lots are proportional to balance. 161x balance reduction = 161x smaller lots. No bug.
//   2. CODEX MADE ZERO CHANGES: All 75 /Applications .mq5 files MD5-verified. Codex artifacts
//      are only internal SQLite session databases. Every EA commit in git was from Claude Code.
//   3. GRADE SCORING UNCHANGED: A+=5.5, A=4.0, B=3.0 thresholds identical across v5.8.50→v6.0.2.
//      Entry logic has not degraded. The EA did not drift from its profitable personality.
//   4. EXIT LOGIC IMPROVED: v6.0.1 context-aware ratchet fixed the 4 BE-at-zero trades.
//      shieldArmed=Y confirmed working in recent logs. Profit giveback is within normal parameters.
//
//   TWO TARGETED FIXES (evidence-backed):
//   A. patternMult floor: 0.50 → 0.70 (line ~6644)
//      After ≤1 win in last 5 trades, lot size was halved. This prevented recovery on small
//      accounts — each recovery trade was too small to offset the prior loss, producing the
//      observed win/lose alternation. Reduced to 70% (still disciplined, allows recovery).
//   B. Committee lot floor: 0.50 → 0.70 (line ~12701)
//      In worst-case negative committee sentiment, the floor was 0.50× of base lot.
//      Combined with STI late-entry reduction (0.65×), this stacked to 0.325× of base risk —
//      producing $6.95 risk on a $3K account (0.03 lots). Raised floor to 0.70× so
//      STI+committee worst case = 0.65×0.70 = 0.455× of base. Typical recovery scenario
//      (A-grade, normal session, loss streak) improves from 0.193× to 0.399× of base risk.
//
//   IMPACT: Growth potential preserved. Worst-case position roughly doubles in size.
//   Protective personality intact — no entry gates removed, no exit gates relaxed.
// v6.0.2 CHANGES (Human Intelligence Upgrade 2026-06-23):
//   1. HUMAN REASONING ENGINE: expanded from 5 rules to 12 rules.
//      New rules (fire after primary 5; ordered risk-before-opportunity):
//      Rule 6  AGAINST_H4_TREND:      H4+H1 both oppose direction → reduce size
//      Rule 7  LOSS_STREAK_CAUTION:   2+ consecutive losses + B-grade → reduce size
//      Rule 8  ASIAN_RANGING:         02:00-06:00 GMT + B-grade → reduce size (low-liquidity)
//      Rule 9  SPREAD_ELEVATED:       live spread > 1.8× EMA baseline → reduce size
//      Rule 10 TRIPLE_TF_ALIGNED:     H4+H1+M5 all aligned → boost (highest conviction)
//      Rule 11 LN_NY_OVERLAP:         13:00-17:00 GMT + H1+M5 aligned → boost (peak liquidity)
//      Rule 12 CLEAN_ENTRY_CONDITIONS: H1 aligned + RSI 40-65 + normal spread → slight boost
//   2. PER-POSITION COMMITTEE MEMORY: fixes basket race condition.
//      Previously g_lastTradePattern was a global string overwritten by every new trade open.
//      In a 3-position basket, a pyramid add would corrupt the original entry's pattern before
//      the original closed and recorded. Fix: DEAL_ENTRY_IN handler now captures committee data
//      (pattern+dirLabel+conf) into g_posCommData[] keyed by posId. At close, DEAL_ENTRY_OUT
//      looks up posId → retrieves the correct data for that specific position → records memory.
//   3. NEWS AFTERMATH FILTER: pauses new entries after spread spikes (news events).
//      Spread EMA (α=0.02, ~50-tick baseline) tracks normal spread. If live spread exceeds
//      InpNewsSpreadMulti (default 2.5×) of that baseline, entries are paused for
//      InpNewsAftermathMins (default 10 min) even after spread normalizes.
//      Also exposed as HumanReasoning Rule 9 (reduces size when spread is 1.8× elevated).
// v6.0.1 CHANGES (Exit Intelligence Upgrade 2026-06-23):
//   FORENSIC AUDIT FINDING: PG_PerPositionRatchet() moved SL to EXACT ENTRY with zero cushion
//   and zero trend context. Live evidence: 4 A-grade SELL positions (4119.20/4121.64/4117.55/4112.85)
//   closed at $0.00 profit (bestFloating: $17.60/$25.89/$19.52/$16.77) during normal M5 pullbacks
//   while the H1 bearish trend remained fully intact. Root causes:
//     1. Hard BE at exactly entry price — normal M5 noise (0.3-0.5×ATR) closed winning trades
//     2. No trend context in ratchet — BE fired even when M5+H1 EMA both aligned bearish
//     3. APLUS Shield grade race condition — g_lastEntryGrade read by wrong pyramid ticket
//   REDESIGN — PG_PerPositionRatchet() now:
//     a) DEFERRED:  trend confirmed (M5+H1 aligned, momentum>=3, regime OK) → don't move SL at all
//        The original protective SL remains. No unnecessary BE move during strong trends.
//     b) CUSHIONED: trend weakening (M5 against or H1 mixed) → SL = entry ± InpRatchetBECushionATR×ATR
//        Locks a small amount of proven profit instead of clamping to zero.
//     c) HARD BE:   reversal confirmed (EMAs crossed against, RSI extreme, momentum<=1) → old behavior
//        Only clamps to zero when the market has actually reversed.
//     d) ADAPTIVE TRAIL: when momentum >= 4, trail is InpRatchetStrongMomMulti wider (default 1.5×)
//        giving pullbacks room to recover without stopping out a still-running trend.
//   APLUS SHIELD FIX: reads grade from POSITION_COMMENT (contains "[A]"/"[A+]") instead of
//     g_lastEntryGrade, which is a global that changes on every new trade open (race condition).
//   IMPACT: A/A+ trades with proven profit and confirmed trend continuation now hold through normal
//   M5 pullbacks. BE ratchet fires hard only on genuine reversals. Trail width adapts to momentum.
#property copyright "XauAI Sniper by emriz.eth"
#property link      "https://xauaisniper.com"
#property version   "6.3.9"
#property description "XAUUSD AI Sniper v6.3.9 — TradeBrain audit, ATR-adaptive profit lock, smart growth safety overrides, gate file reports, forward-test report mode"
#property description "v6.1.0: SMC (Smart Money Concepts) additive confirmation layer. BOS direction bias, OB zone bonus, FVG zone bonus, ICT kill zone bonus."
#property description "ALL existing logic preserved: risk engine, exits, committee, EPF, basket protect, STI, calendar — untouched."
#property description "SMC is purely additive to setup score. Higher score = better grade = larger lot. Does NOT gate or block trades."
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>

//+------------------------------------------------------------------+
//| INPUTS                                                           |
//+------------------------------------------------------------------+
input group "=== LICENSE ==="
input string InpLicensePIN     = "";

input group "=== RISK (Gate 4) ==="
// Decision ownership map:
// ENTRY: setup scorer + XAU timing guard + context gate.
// RISK: OpenTrade lot sizing + existing aggregate exposure cap.
// PYRAMID: trend-continuation scale-in only by default; no rescue averaging.
// EXIT: Clean Exits owns per-trade management when enabled; Basket Protect owns aggregate profitable baskets.
// AI: advisory by default; logs opinions but does not override deterministic trade/risk authority.
// CLOUD: mirrors accepted master actions; cloud failures must not change local trade decisions.
input group "=== PRESERVATION MODE (v4.7.2 — let winners run, don't trade like scalper) ==="
input group "=== ACCOUNT MODE (v4.8.2 — one-input preset for risk profile) ==="
enum ENUM_ACCT_MODE { ACCT_BALANCED, ACCT_CONSERVATIVE, ACCT_AGGRESSIVE };
input ENUM_ACCT_MODE InpAccountMode = ACCT_BALANCED;  // v5.8.4: original default risk preset for demo/cloud testing

input group "=== PROFIT GUARDIAN (v5.1.3 — OFF by default; v4.9.7-style aggressive trading) ==="
input bool   InpProfitGuardian      = false; // v5.1.3: DEFAULT OFF — tier risk-cuts + HTF trend lock + cooldown OFF (restores v4.9.7 aggression)
input bool   InpProfitLock          = true;  // v5.1.3: ALWAYS-ON safety net — runs INDEPENDENTLY of InpProfitGuardian

// ====================================================================
// v5.5.0 — EQUITY PRESERVATION FRAMEWORK (EPF)
// Multi-tier defensive system that preserves winning phases instead
// of letting the bot self-destruct after good runs.
//
// Triggers (any one activates the corresponding tier):
//   - Daily profit milestones (+5/+10/+15/+20%)
//   - Peak-equity retrace (intraday HWM gave back N%)
//   - Consecutive loss escalation
//   - Volatility regime instability
//
// Effects scale with tier:
//   T1 (mild)     : 0.85x lot, require setupScore >= 3.0
//   T2 (defense)  : 0.65x lot, A/A+ only, no NEW pyramid adds
//   T3 (preserve) : 0.40x lot, A/A+ only, no pyramids, max 2 concurrent positions
//   T4 (lockdown) : NO new entries (existing trades managed normally)
//
// Existing pyramiding/scaling logic is preserved — EPF only restricts
// FRESH entries, never touches running trades' SL/TP unless trailing.
// ====================================================================
input group "=== EQUITY PRESERVATION FRAMEWORK (v5.5.0) ==="
input bool   InpEPF_Enable          = true;   // master switch — set false to disable all EPF behavior
input double InpEPF_DailyT1Pct      = 5.0;    // daily +5%: mild defense
input double InpEPF_DailyT2Pct      = 10.0;   // daily +10%: moderate defense
input double InpEPF_DailyT3Pct      = 15.0;   // daily +15%: capital preservation
input double InpEPF_DailyT4Pct      = 20.0;   // daily +20%: ultra-defensive lockdown
input double InpEPF_PeakRetracePct  = 6.0;    // % retrace from intraday peak (after >=5% peak) = jump 1 tier up
input double InpEPF_PeakMinPct      = 5.0;    // ignore retrace gate until daily peak >= this %
input int    InpEPF_ConsecLossWarn  = 3;      // after N consecutive losses → bump 1 tier
input int    InpEPF_ConsecLossCool  = 5;      // after N consecutive losses → full cooldown
input int    InpEPF_CooldownMin     = 0;      // minutes to pause after consecutive-loss cooldown (v6.1.2: no DD blocking)
input bool   InpEPF_BlockClusters   = true;   // block fresh entries within InpEPF_ClusterATR of an existing same-direction position
input double InpEPF_ClusterATR      = 0.6;    // ATR distance under which entries are considered "clustered"
input int    InpEPF_ClusterMaxSec   = 600;    // clustering protection window (seconds since last entry)
input double InpEPF_TrailTightT3    = 0.6;    // T3+ tightens trailing stop to N×ATR (vs default ~1.5)
input bool   InpEPF_PartialClose    = true;   // T1+ enables 50% partial close at +1.5R on trend-aligned trades
input double InpEPF_HardDailyDDPct  = 0;      // v5.7.0: HARD lockdown if daily loss exceeds this %. Set 0 to disable. (v6.1.2: disabled — no DD blocking)
input bool   InpEPF_T4AdaptiveAllowElite = true;  // T4 allows elite A/B signals at reduced size unless hard DD is hit
input double InpEPF_T4EliteSetupScore    = 4.70;  // minimum raw setup score for guarded T4 pass
input double InpEPF_T4EliteCombinedScore = 3.70;  // minimum combined score for guarded T4 pass
input double InpEPF_T4EliteLotMult       = 0.20;  // reduced lot multiplier for guarded T4 pass (v6.1.1: was 0.12 — too small to recover)
input bool   InpEPF_T4RequireAorB        = true;  // only A/B grade may pass guarded T4 mode
input int    InpEPF_T4MaxTradesPerDay    = 3;     // max guarded T4 trades per day
input int    InpEPF_T4MinMinutesBetween  = 45;    // spacing between guarded T4 trades
input bool   InpEPF_T4BlockHardDD        = false; // hard daily loss limit still blocks completely (v6.1.2: disabled — no DD blocking)
                                              //         enables: (1) escalating HWM giveback day-halt, (2) per-position BE/trail ratchet
input double InpPG_Tier1Pct         = 30.0;  // ignored when InpProfitGuardian=false
input double InpPG_Tier2Pct         = 50.0;  // ignored when InpProfitGuardian=false
input double InpPG_Tier3Pct         = 75.0;  // ignored when InpProfitGuardian=false
input double InpPG_HWMGivebackPct   = 25.0;  // BASE giveback % when day gain < 30%. Used by InpProfitLock too.
input bool   InpPG_EscalatingGiveback = true;  // tighten allowed giveback as the day's gain grows (locks big runs)
input double InpPG_GivebackMinGainPct = 5.0;   // v5.1.4: don't activate giveback brake until day-HWM gain ≥ this % (avoid firing on noise)
input double InpPG_GivebackAt30Pct  = 20.0;  // max giveback% when day gain ≥ 30%
input double InpPG_GivebackAt50Pct  = 15.0;  // max giveback% when day gain ≥ 50%
input double InpPG_GivebackAt75Pct  = 10.0;  // max giveback% when day gain ≥ 75% (lock big runs hard)
input bool   InpPG_HTFTrendLock     = false; // v5.1.3: DEFAULT OFF — was blocking 7+ hours of valid trades
input ENUM_TIMEFRAMES InpPG_HTFTrendTF = PERIOD_M30;
input double InpPG_HTFTrendATR      = 1.0;
input bool   InpPG_ConsolidationCarveout = true;
input double InpPG_ConsolidationATR = 0.8;
input int    InpPG_PostLossCooldown = 30;    // BASE cooldown minutes (only used when InpProfitGuardian=true)
input bool   InpPG_AdaptiveCooldown = true;
input int    InpTwoLossCooldownMin  = 300;   // Two distinct losing trade cycles pause fresh entries for 5h
input int    InpLossCycleDedupSec    = 30;    // Layered basket closes inside this window count as one loss cycle
input int    InpProfitLockCooldownMin = 300;  // Legacy HWM full-day halt becomes a 5h monitoring cooldown
input bool   InpPG_PerPositionRatchet = true; // v5.1.3: KEY profit-protection — works INDEPENDENTLY of InpProfitGuardian
input double InpPG_RatchetBETrigger  = 1.0;  // ATR multiples in profit before BE move
input double InpPG_RatchetTrailStart = 2.0;  // ATR multiples in profit before trail kicks in
input double InpPG_RatchetTrailDist  = 1.0;  // ATR distance behind price to trail SL

// v5.2.1 — STARTUP COOLDOWN (prevents blind trades right after MT5/EA reload)
input int    InpStartupCooldownMin   = 5;   // Minutes after EA init before any trade is allowed
input bool   InpStartupRequireNewBar = true; // Also require at least one fresh M5 bar to close before trading

// v5.3.0 — PHASE 1: VOLATILITY / SPREAD / DAILY-DD GUARDS (account-aware)
input bool   InpVolKillEnabled    = true;   // Block entries when M5 ATR > 2× 50-bar median (turbulent market)
input double InpVolKillMultiplier = 2.0;    // Multiplier vs 50-bar median ATR to trigger the kill switch
input double InpVolKillHardMultiplier = 2.80; // v5.8.25: only this level is a hard chaos block for XAU fast mode
input bool   InpVolKillXAUAdaptiveBypass = true; // v5.8.25: strong XAU fast confirmations soft-pass moderate ATR expansion
input bool   InpSpreadKillEnabled = true;   // Block entries when current spread > 2× 60-bar median (broker freakout)
input double InpSpreadKillMultiplier = 2.0; // Multiplier vs median spread to trigger kill switch
input double InpHardDailyDDPct    = 0.0;    // v5.8.4 demo: disabled
input double InpSoftDDPct         = 4.0;    // v6.3.5: enabled — reduce risk when daily DD exceeds 4% before hitting hard EPF tiers
input double InpSoftDDLotMulti    = 0.7;    // lot multiplier while in soft DD mode (unused while soft DD disabled)
// v6.3.8 UPGRADE 7 — Smart profit-growth / equity protection
input double InpDailyProfitLockPct   = 3.0;  // Daily profit lock %: tighten trailing stops when day gain >= this
input double InpDrawdownFromHighPct  = 8.0;  // Max % drop from equity watermark before new entries pause
input double InpPyramidMinSpaceATR = 1.0;   // Pyramid adds must be ≥ this × ATR away from PREVIOUS add (anti-clustering)
input double InpAdvPyrMinScore    = 4.0;    // v5.3.1: combined score required for ADVERSE pyramids (≥ here OR no add). Trend-side adds skip this gate.

// v5.3.1 — HIGH-GRADE BREATHING ROOM (let A/A+ winners run instead of trailing them out)
input double InpHighGradeBETriggerATR  = 1.5; // A/A+ trades only move to BE after this much profit (vs InpPG_RatchetBETrigger for B)
input double InpHighGradeTrailStartATR = 3.0; // A/A+ trail kicks in only after 3× ATR profit (vs 2× for B)
input double InpHighGradeTrailDistATR  = 1.5; // A/A+ trail distance (vs 1× ATR for B) — looser leash to capture continuation

// v6.0.1 — EXIT INTELLIGENCE GATE (context-aware ratchet — eliminates unnecessary BE exits)
// Forensic finding: ratchet fired hard BE (SL = exact entry) during strong trends, closing
// A-grade trades at $0.00 while bestFloating was $17-$25. Three-tier context now governs all ratchet decisions.
input group "=== EXIT INTELLIGENCE GATE (v6.0.1 — context-aware ratchet) ==="
input bool   InpRatchetTrendGate      = true;   // Gate BE ratchet behind trend context — DEFERRED/CUSHIONED/HARD per market
input int    InpRatchetTrendMinMoment = 3;       // Momentum score (1-5) needed to defer BE ratchet (trend still running)
input double InpRatchetBECushionATR   = 0.35;   // Weakening trend: lock entry + N×ATR instead of clamping to zero
input bool   InpRatchetAdaptiveTrail  = true;    // Widen trail in strong momentum, tighten on reversals
input double InpRatchetStrongMomMulti = 1.5;    // Trail width multiplier when momentum >= 4 (1.5 = 50% wider leash)
input double InpRatchetWeakMomMulti   = 1.0;    // Trail width multiplier when momentum <= 2 (1.0 = normal, locks profit)

input group "=== AI TRADING COMMITTEE (v6.0.1 — committee of reasoning modules) ==="
// Every trade now goes through a 3-module committee before sizing.
// Each module votes (-2 to +2). Votes aggregate into a lot multiplier and an entry thesis.
// No additional blocking gates — "strict != smart". The committee adjusts SIZE, not access.
input bool   InpCommitteeEnable  = true;    // Master switch: enable the trading committee
input bool   InpCommitteeLog     = true;    // Print committee thesis to terminal before every trade
input bool   InpCommitteeLotAdj  = true;    // Let committee adjust lot size (range 0.50-1.25×)
input bool   InpInTradeClassify  = true;    // Classify open positions every bar (HEALTHY/PULLBACK/REVERSING/etc.)

input group "=== NEWS AFTERMATH FILTER (v6.0.2) ==="
// Detects sudden spread spikes (news events) and pauses new entries for a safety window.
// Spread EMA tracks normal baseline; if live spread exceeds N× that baseline, entries pause.
input bool   InpNewsAftermathEnable  = true;  // Pause new entries after detected spread spike
input double InpNewsSpreadMulti      = 2.5;   // Spread must exceed N× EMA baseline to trigger
input int    InpNewsAftermathMins    = 10;    // Minutes to block new entries after spike

input group "=== SCHEDULED NEWS CALENDAR (v6.0.4) ==="
// Pre-defined high-impact windows (GMT). Entries blocked for duration. No external API needed.
// Covers the recurring economic releases that most affect XAUUSD.
input bool   InpCalendarEnable       = true;  // Enable scheduled news calendar blackout
input bool   InpCalThursJobless      = true;  // Thursday 12:15-13:30 GMT — US Jobless Claims
input bool   InpCalFridayData        = true;  // Friday 12:15-14:00 GMT — NFP / US data window
input bool   InpCalSundayOpen        = true;  // Sunday 00:00-00:45 GMT — weekly market open gap risk
input bool   InpCalMondayOpen        = true;  // Monday 00:00-00:30 GMT — Asian liquidity open spike
// User-configurable custom blackout windows (set Day=-1 to disable; Day 0=Sun...6=Sat, time in GMT)
input int    InpCalCustomDay1        = 3;     // Custom 1: day (0=Sun, 3=Wed for FOMC, -1=off)
input int    InpCalCustomHour1       = 18;    // Custom 1: start hour GMT (18 = 18:00)
input int    InpCalCustomMin1        = 0;     // Custom 1: start minute GMT
input int    InpCalCustomDurMin1     = 90;    // Custom 1: duration in minutes
input int    InpCalCustomDay2        = -1;    // Custom 2: day (-1 = disabled)
input int    InpCalCustomHour2       = 12;    // Custom 2: start hour GMT
input int    InpCalCustomMin2        = 30;    // Custom 2: start minute GMT
input int    InpCalCustomDurMin2     = 60;    // Custom 2: duration in minutes
input int    InpCalCustomDay3        = -1;    // Custom 3: day (-1 = disabled)
input int    InpCalCustomHour3       = 0;     // Custom 3: start hour GMT
input int    InpCalCustomMin3        = 0;     // Custom 3: start minute GMT
input int    InpCalCustomDurMin3     = 60;    // Custom 3: duration in minutes

input group "=== SMC ENTRY LAYER (v6.1.0 — Smart Money Concepts additive confirmation) ==="
// Additive only. Nothing blocked, nothing removed. SMC confluence lifts score → better grade → bigger lot.
// Turn InpSMC_Enable=false to run exactly as v6.0.4 for A/B comparison.
input bool   InpSMC_Enable          = true;  // Master switch: SMC layer ON (false = pure v6.0.4 behaviour)
input bool   InpSMC_Log             = true;  // Print SMC context line before every scored setup
input int    InpSMC_BOS_Lookback    = 20;    // H1 bars to track for swing high/low (Break of Structure)
input int    InpSMC_OB_Lookback     = 10;    // H1 bars to search backward for Order Block candles
input int    InpSMC_FVG_Lookback    = 15;    // M15 bars to search backward for Fair Value Gaps
input double InpSMC_BOS_BonusScore  = 1.0;  // Score bonus when H1 BOS direction matches trade
input double InpSMC_OB_BonusScore   = 2.0;  // Score bonus when price is returning to a valid OB zone
input double InpSMC_FVG_BonusScore  = 1.5;  // Score bonus when price is inside an unfilled FVG zone
input double InpSMC_KZ_BonusScore   = 0.5;  // Score bonus during ICT kill zones (LN open, NY open, LN close)
input double InpSMC_OppPenalty      = 0.5;  // Reserved (not applied) — BOS opposition is log-only; existing Smart Guard handles counter-trend
input double InpSMC_OB_ToleranceATR = 0.5;  // OB zone tolerance in ATR multiples (price proximity)
input double InpSMC_FVG_ToleranceATR= 0.3;  // FVG zone tolerance in ATR multiples
input double InpSMC_ImpulseATR      = 5.0;  // Min M5-ATR multiples for impulse move to confirm OB validity
input bool   InpSMC_KillZones       = true; // Enable ICT kill zone timing bonus

// v5.3.0 — PHASE 2: EXHAUSTION + ML SMOOTHING
input bool   InpRSIDivergenceFilter = true; // Block buy if RSI_HH < prev RSI_HH while price made new HH (and mirror for sells)
input bool   InpMomentumSlowdown    = true; // Block entry if last close is in lower 30% of last 3 candles' ranges
input int    InpMLSmoothingBars     = 5;    // WMA smoothing on ML score over last N decisions (0 = disabled)
input bool   InpResetMLSmoothingBySignature = true; // v5.8.6: keep smoothing inside same setup/direction signature

// v5.3.0 — PHASE 3: REGIME / BASKET POLISH
input bool   InpFakeBreakoutGuard   = true; // Require 2-bar confirmation past Donchian-N break before entering breakouts
input bool   InpDynamicBasketTP     = true; // Push basket arm by +0.5×ATR if momentum still accelerating

// v5.1.9 — SELECTIVE MODE (replaces full day-halt; keep trading the BEST setups)
input bool   InpPG_SelectiveMode        = true;  // v5.1.9: when giveback brake fires, switch to A/A+ only instead of full halt
input double InpPG_SelectiveMinDayGain  = 25.0; // PG only activates after day gain ≥ this % (avoid noise lockouts)
input double InpPG_SelectiveMinScore    = 4.0;  // In selective mode, combined score must be ≥ this (Grade A floor)
input bool   InpPG_SelectiveRequireHTF  = true; // Use adaptive XAU confirmation instead of slow H1 hard veto
input double InpPG_SelectiveLotMulti    = 0.6;  // Lot multiplier while selective (0.6 = 40% reduction). 1.0 disables.
input int    InpPG_SelectiveRecoverMin  = 0;    // 0 = stay selective until next-day reset; >0 = exit selective after N min of no further drawdown

input group "=== XAU FAST CONFIRMATION (v5.8.40 — breakout + pyramid adaptive confirmation) ==="
input bool   InpXAU_AdaptiveConfirm       = true;  // XAU/GOLD: score M5/M15/M30 first; H1 only soft context
input double InpXAU_FastTrendMinScore     = 50.0;  // Fast/trending gold can pass with this fast-TF score
input double InpXAU_ChopMinScore          = 65.0;  // Choppy/ranging gold needs stricter fast-TF score
input double InpXAU_H1PenaltyLotMulti     = 0.75;  // If H1 disagrees but fast TFs pass, reduce lot instead of veto
input double InpXAU_H1PenaltyScore        = 8.0;   // H1 disagreement confidence penalty shown in logs
input bool   InpXAU_LogAdaptiveConfirm    = true;  // Print allow/block reasons for adaptive confirmation
input bool   InpTrendPullbackBRequireAntiBias = true; // B TREND_PULLBACK/BREAKOUT must clear extra fast-confirm quality

input group "=== XAU ENTRY TIMING GUARD (v5.8.40 — stop selling bottoms / buying tops) ==="
input bool   InpXAU_TimingGuard            = true;  // All grades must pass timing quality before execution
input double InpXAU_MaxEMADistanceATR      = 1.35;  // Farther than this from M5 EMA50 = late unless pullback/rejection is clean
input double InpXAU_MaxVWAPDistanceATR     = 1.80;  // Farther than this from session VWAP = chase risk
input double InpXAU_ImpulseATRBlock        = 1.65;  // Last closed M5 candle range above this ATR can block chase entries
input double InpXAU_ImpulseATRDowngrade    = 1.20;  // Moderate impulse stretches reduce grade/lot
input double InpXAU_MinPullbackATR         = 0.25;  // Valid continuation should show at least this pullback/retest
input int    InpXAU_BadLocationLookbackBars = 14;   // Recent structure window used to detect selling bottoms / buying tops
input double InpXAU_ExtremeLocationPct      = 24.0; // SELL blocked in bottom X%; BUY blocked in top X% unless pullback rejection is clean
input double InpXAU_MinLowHighClearanceATR  = 0.45; // Minimum distance away from recent low/high before continuation entry
input double InpXAU_MinPullbackValueATR     = 0.65; // Trend continuation needs this much pullback away from the extreme
input double InpXAU_ValueAreaEMABufferATR   = 0.85; // Pullback is higher quality if back near EMA50 value area
input double InpXAU_ValueAreaVWAPBufferATR  = 1.15; // Pullback is higher quality if back near session VWAP value area
input bool   InpXAU_RequirePullbackValueForTrend = true; // Trend entries should wait for value, not chase lows/highs
input bool   InpXAU_RequireExcellentDamageTiming = false; // Optional perfect-or-nothing mode; false lets fair trend timing pass smaller
input double InpXAU_MaxThreeBarDriveATR    = 2.30;  // 3-bar one-way drive above this means wait for retrace
input int    InpXAU_ExtensionLookbackBars  = 9;     // Larger one-way drive window used to block late breakout re-entry
input double InpXAU_MaxExtensionDriveATR   = 3.40;  // If price already moved this far, require a reset/pullback first
input double InpXAU_MinExtensionResetATR   = 0.75;  // Minimum pullback from fresh high/low before another same-direction entry
input double InpXAU_FairTimingLotMulti     = 0.65;  // If timing is fair but not clean, reduce risk
input bool   InpXAU_BlockLateA             = true;  // A/A+ late chase becomes BLOCK, not just smaller
input bool   InpXAU_LogTimingGuard         = true;  // Print timing audit: grade, EMA/VWAP distance, impulse, pullback quality
input bool   InpXAU_TimingQualityGrades    = true;  // A/A+ needs timing quality, not just late confirmation strength
input double InpXAU_APlusMinTimingQuality  = 78.0;  // A+ requires strong positioning; weak timing is demoted to A, not blocked
input double InpXAU_APlusMaxLateProb       = 35.0;  // A+ cannot be a late confirmation/chase
input double InpXAU_APlusMaxExhaustionProb = 35.0;  // A+ cannot sit near likely liquidity exhaustion
input double InpXAU_APlusMinRRQuality      = 55.0;  // A+ also needs usable directional room, not confidence alone
input double InpXAU_MinDirectionalRoomATR  = 0.60;  // Minimum room from local liquidity before A/A+ continuation
input double InpXAU_MissedMoveDriveATR     = 2.60;  // If move already travelled this far without reset, demote/block
input bool   InpXAU_BlockPostSweepAPlus    = true;  // Block A+ continuation after gold sweeps liquidity then snaps back
input int    InpXAU_PostSweepLookbackBars  = 7;     // Sweep must be recent to count as trap risk
input double InpXAU_PostSweepRetraceATR    = 1.10;  // Bounce/drop from swept low/high that signals trap risk
input bool   InpXAU_FirstSignalMemory      = true;  // Track first blocked/seen signal so late A/A+ cannot chase after move already happened
input double InpXAU_MaxMissedMoveATR       = 3.20;  // Same signal idea is late if price travelled this far from first-seen zone
input double InpXAU_MaxMissedMoveUSD       = 30.0;  // Dollar-distance fallback for vertical XAU moves (e.g. 4380 -> 4500)
input int    InpXAU_MaxSignalAgeBars       = 6;     // After this many M5 bars, same idea must retest/pull back before entry
input double InpXAU_MinLateRetestATR       = 0.90;  // Late continuation needs at least this pullback/retest from the new extreme
input double InpXAU_ExtremeLateLotMulti    = 0.35;  // If late but still allowed after retest, force small lot
input bool   InpXAU_BlockLateChasePyramids = true;  // Pyramid adds must not cluster near the exhausted end of a missed move
input bool   InpBlockedTradeMemoryReport   = true;  // Persist blocked-signal outcome learning to CSV for audits
input int    InpBlockedMemoryMinSamples    = 8;     // Samples required before blocked-pattern stats can influence logs/size
input bool   InpBlockedMemoryScoutEnable   = false; // v5.8.55 default OFF: learn/report blocked trades without opening tiny live scouts
input double InpBlockedMemoryScoutMinWR     = 55.0;  // Scout only if similar blocked ideas show real win-rate proof, not just movement edge
input double InpBlockedMemoryScoutEdgeATR  = 0.50;  // Avg favorable ATR must exceed avg adverse ATR by this much
input double InpBlockedMemoryScoutMinFavATR= 1.45;  // Minimum average favorable move after similar blocks
input double InpBlockedMemoryScoutMaxAdvATR= 1.55;  // Do not scout if similar blocks usually draw down worse than this
input double InpBlockedMemoryScoutLotMulti = 0.22;  // Tiny risk only; this is learning scout, not full-size looseness
input double InpEntryQualityScoutRiskCap    = 0.25;  // Tiny scouts cannot be raised by large-account lot floors above this risk %
input bool   InpTradingIntelDataset        = true;  // Unified CSV/JSONL black-box recorder for trades, blocks, vetoes, exits, cloud
input bool   InpTradingIntelJson           = true;  // Also write JSONL rows for external analysis tools
input bool   InpMarketIntelSnapshots       = true;  // Record one market-state row per M5 scan for Codex analysis
input bool   InpStartupIntelSync           = true;  // Recover local memory + open positions + chart context before fresh entries
input int    InpStartupIntelMinCandles     = 200;   // Startup context target; does not wait for 4h shadow outcomes
input bool   InpAcceleratedLearningMode    = true;  // After evidence builds, adapt ranking/confidence only; never risk controls
input int    InpAccelLearningMinHours       = 24;    // Earliest low-risk adaptive scoring window
input int    InpAccelLearningMinObs         = 50;    // Minimum qualified observations before any adaptive score nudge
input double InpAccelLearningMinWR          = 55.0;  // Positive pattern floor before boosting score
input double InpAccelLearningMinPF          = 1.10;  // Profit factor floor before boosting score
input double InpAccelLearningMaxScoreAdj    = 0.25;  // Score-only cap; does not change lot, SL, TP, max risk, drawdown, or emergency locks
input bool   InpTradeBrainMemory           = true;  // Persist EVERY executed trade with entry reason, exit reason, drawdown, and outcome
input int    InpTradeBrainMinSamples       = 12;    // Minimum matching closed trades before brain can affect new entries
input double InpTradeBrainReduceWR         = 42.0;  // If similar pattern WR is below this, reduce lot instead of repeating full risk
input double InpTradeBrainBlockWR          = 28.0;  // If similar pattern WR is below this with poor PF, block until pattern improves
input double InpTradeBrainMinPF            = 0.75;  // Below this profit factor, similar pattern is treated as weak
input double InpTradeBrainBadDDProfitRatio = 2.50;  // Avg worst DD worse than this × avg profit = poor entry quality
input double InpTradeBrainWeakLotMulti     = 0.45;  // Lot multiplier for weak-but-not-blocked repeated patterns
input bool   InpTradeBrainMonitorAfterExit = true;  // After close, keep watching to learn whether exit was early, late, or correct
input bool   InpEntryQualityReview          = true;  // Write Entry Quality Review CSV for every closed trade
input int    InpEntryQualityFastMinSamples  = 6;     // Faster warning window for repeated deep-drawdown patterns
input double InpEntryQualityPoorMAEATR      = 0.80;  // More than this adverse ATR = poor entry timing
input double InpEntryQualityDangerMAEATR    = 1.20;  // More than this adverse ATR = dangerous entry timing
input double InpEntryQualityBadDDPct        = 3.0;   // Floating loss above this equity % marks poor entry quality
input double InpEntryQualityDangerDDPct     = 5.0;   // Floating loss above this equity % marks dangerous survival-by-balance
input int    InpEntryQualityLongUnderwaterMin = 30;  // Time negative before a green close becomes recovery-dependent
input double InpExitBrainEarlyProfitATR    = 1.20;  // If price moves this much further after close, mark exit as early
input double InpExitBrainGoodAvoidATR      = 0.90;  // If price reverses this much after close, mark exit as good protection
input bool   InpCloudSafeDisablePartials   = true;  // Disable partial-loss/profit reductions so master/cloud lifecycle stays synchronized

input group "=== XAU CYCLE GIVEBACK ARMOR (v5.8.40 — protect big winning cycles) ==="
input bool   InpXAU_CycleGivebackArmor        = true; // After a strong winning day, reduce late-cycle risk instead of giving back many wins
input double InpXAU_CycleArmGainPct           = 8.0;  // Daily gain % where cycle armor starts protecting session equity
input double InpXAU_CycleLotMulti             = 0.55; // Lot multiplier while cycle armor is armed
input double InpXAU_CycleBGradeDeepGainPct    = 18.0; // After a very strong day, B-grade entries become small only
input double InpXAU_CycleBGradeLotMulti       = 0.20; // Extra B-grade multiplier after deep daily gain
input int    InpXAU_FailedImpulseLookbackBars = 10;   // Lookback for failed spike/flush detection
input double InpXAU_FailedImpulseRetraceATR   = 0.85; // Reversal away from fresh high/low that warns move may be exhausted
input double InpXAU_CycleExtremePct           = 30.0; // Hot-day entries near extremes need clean continuation or they are blocked
input bool   InpXAU_BlockFailedImpulse        = true; // Block same-direction entries after failed spike/flush unless clean continuation

input bool   InpPreservationMode = true;  // Master toggle: disables premature profit-side exits
input double InpRiskPercent    = 0.4;      // Base risk per trade (%) — IGNORED if InpAccountMode != BALANCED uses preset

input group "=== TP AUTO-EXTEND (v4.7.3 — push TP forward as winner runs) ==="
input bool   InpTPAutoExtend     = true;   // When profit nears TP, push TP further so the runner keeps running
input double InpTPExtendTriggerPct = 80.0; // Extend TP when profit reaches this % of TP-distance (e.g. 80%)
input double InpTPExtendATRMulti = 1.5;    // Extend by this × ATR (added to current TP)
input int    InpTPExtendMaxTimes = 5;      // Max extensions per position (cost: 0 — pure MQL5)

input group "=== ENTRY QUALITY GUARD (v5.8.40 — 10-30 min entry quality guard) ==="
input bool   InpStructureRunnerMode           = true;  // Main runner: let correct XAU direction breathe into larger account-sized wins
input double InpStructureTPMultiplier         = 6.5;   // Wider initial TP target; still based on SL/ATR, never fixed dollars
input double InpStructureTPExtendTriggerPct   = 68.0;  // Extend earlier so strong trends do not hit a small TP and stop
input double InpStructureTPExtendATRMulti     = 2.2;   // Bigger TP push during live momentum
input double InpStructureBasketArmPct         = 4.0;   // Basket protection arms later; avoids killing good runners too early
input double InpStructureBasketLockMinPct     = 30.0;  // Softer first basket floor so gold can pull back and continue
input double InpStructureBasketRatchetT1Pct   = 2.5;   // Later ratchet tiers for 10-30 min trend cycles
input double InpStructureBasketRatchetT2Pct   = 5.0;
input double InpStructureBasketRatchetT3Pct   = 8.0;
input double InpStructureBasketBEPct          = 1.2;   // Later BE basket lock
input double InpStructureBasketHardGivebackPct= 2.2;   // Equity curve armor still caps serious giveback
input double InpStructureBEActivateR          = 2.70;  // Later per-trade BE; avoids suffocating winners
input double InpStructureBECushionR           = 0.08;  // Small cushion, not a tight scalp lock
input double InpStructureChandelierStartR     = 4.75;  // Trail only after a real runner move
input double InpStructureChandelierATR1       = 6.2;   // Wider runner trail before +4R
input double InpStructureChandelierATR2       = 4.9;   // Wider runner trail after +4R
input int    InpStructureMinHoldMinutes       = 10;    // Structure-runner bias: do not judge normal gold noise too early
input int    InpStructureTargetHoldMinutes    = 30;    // Log/behavior target window for entry quality guards
input double InpStructureFailFastLossR        = 1.55;  // Can still cut only confirmed failed structure
input int    InpStructureFailFastMinMinutes   = 12;
input double InpStructureFailFastMaxAdverseATR= 2.4;

input double InpMaxLots        = 50.0;     // Hard max lots; final equity/margin caps still protect risk
input double InpMaxRiskPctEquity = 3.0;    // v5.8.4: restored original account-based max risk cap
input double InpMaxTotalLots   = 0;        // v4.7.6 — Hard cap on TOTAL OPEN LOTS across all positions (0 = auto = 3% equity worst-case)
input double InpMaxAggregateRiskPct = 8.0; // v5.8.4: restored original aggregate risk room for demo/cloud testing
input double InpDailyLossLimit = 3.0;      // v6.3.5: enabled 3% daily loss limit — hard stop for catastrophic days, doesn't interfere with normal trading
input int    InpMaxOpenTrades  = 3;        // Max open positions
input int    InpMaxTradesPerDay= 15;       // v5.8.2 — reduce overtrading after choppy loss windows
input bool   InpAdaptiveDailyCap = true;   // v5.8.8: strong trend days can trade more; weak days trade less
input int    InpMaxTradesStrongDay = 24;   // v5.8.8: adaptive cap ceiling during clean trend/breakout sessions
input double InpWeeklyTarget   = 500.0;    // v6.3.2: raised 100→500 — CarefulMode lot-halving was crushing lots on any good week, preventing compounding
input double InpWeeklyMaxLoss  = 0.0;      // v5.8.4 demo: disabled
input bool   InpCarefulMode    = true;     // Scale down near target
input bool   InpAccountSizeBoost = true;   // v5.8.8: lets larger accounts use slightly stronger risk, still capped
input double InpLargeAccountBoostMax = 1.35;// v5.8.8: maximum lot-risk multiplier from account-size scaling
input double InpLargeAccountMinRiskPct = 2.00; // v5.9.0: floor for 50k+ accounts unless in drawdown/lockdown

input group "=== STRATEGY ==="
input int    InpEMAFast        = 50;       // Fast EMA
input int    InpEMASlow        = 200;      // Slow EMA

input group "=== CONTEXT ENGINE (v4.8.0/v4.8.1 — HTF + Swing-S/R, smarter entries) ==="
input bool   InpUseH4Bias        = true;   // Require HTF EMA align with trade direction (strong bias filter)
input ENUM_TIMEFRAMES InpContextTF = PERIOD_M30;  // v5.1.7: HTF for context-gate bias check (was H4 — too slow for gold; M30 default)
input double InpH4NeutralPct     = 0.25;   // v4.8.1 — If H4 EMAs within this % apart → treat as neutral (allow trade)
input bool   InpUseSRFilter      = true;   // Block entries too close to recent swing highs/lows
input int    InpSRLookback       = 40;     // v4.8.1 — Bars back (was 60 = 5hr; now 40 = 3.3hr, less cluttered)
input double InpSRProximityATR   = 0.2;    // v4.8.1 — Block if within X × ATR of swing (was 0.4 = way too strict)
input bool   InpContextGateLog   = true;   // Print PASS lines too so you can see the gate is working
input int    InpRSIPeriod      = 14;       // RSI Period
input int    InpATRPeriod      = 14;       // ATR Period
input double InpSLMultiplier   = 2.5;      // v4.9.5 — wider SL (was 2.0) to survive M5 noise
input double InpTPMultiplier   = 4.0;      // v4.9.5 — wider TP (was 2.0) so runners can reach +4R

input group "=== AI DIRECTOR (v6.3.0 — real authority, not just advisory) ==="
// v6.3.0: The AI Director is the final authority above all strategies.
// Strategies submit votes/signals. AI Director reviews ALL context and decides:
// ALLOW | BLOCK | REDUCE_LOT | INCREASE_LOT. Hard safety rules sit above AI.
input bool   InpUseAI          = true;     // Enable AI Director (Claude + GPT dual vote)
input bool   InpAIAdvisoryOnly = false;    // v6.3.0: FALSE = AI has real authority. TRUE = log-only (advisory). Default: AUTHORITY MODE.
input bool   InpAIDirectorAllGrades = true;  // v6.3.0: call AI Director for ALL grades (A,A+,B), not just A+
input int    InpAIDirectorMinConf = 55;      // v6.3.0: minimum AI confidence % to ALLOW trade. Below = block/reduce.
input bool   InpAIOfflineSafeMode = true;    // v6.3.0: if AI server fails, trade at 50% size (safe degraded mode)
input int    InpAIOfflineMaxFails = 3;       // v6.3.0: consecutive AI call failures before declaring AI offline

// v6.3.8 UPGRADE 3 — AI SL/TP Advisory System
// Default: ADVISORY (logs AI suggestion, never applies automatically)
enum ENUM_AI_SLTP_MODE { AI_SLTP_OFF=0, AI_SLTP_ADVISORY=1, AI_SLTP_SAFE_ASSIST=2, AI_SLTP_FULL_CONTROL=3 };
input ENUM_AI_SLTP_MODE InpAISLTPMode = AI_SLTP_ADVISORY; // AI SL/TP mode: ADVISORY=log only, SAFE_ASSIST=apply if safe, FULL_CONTROL=apply if confidence>80

input group "=== XAU COMMAND CENTER (heartbeat, activity, safe remote commands) ==="
input bool   InpCloudFanout       = false;   // Local-first default: reports/brain work without VPS/cloud. Turn ON only if using copy cloud.
input string InpCloudURL          = "https://xauaisniper.com";  // Cloud API base URL — ALREADY SET. Add this to MT5 WebRequest whitelist!
input string InpCloudAgentToken   = "";      // Optional legacy worker token. Command Center heartbeat uses InpLicensePIN.
input int    InpCloudTimeoutMs    = 5000;    // HTTP timeout for cloud calls (ms)
input bool   InpBotMonitorEnable  = true;    // Command Center heartbeat/activity/command acknowledgements
input int    InpBotMonitorHeartbeatSec = 20; // Send remote heartbeat every 10-30 seconds recommended

input group "=== TUNABLE THRESHOLDS (walk-forward optimize these) ==="
input double InpGradeAPlus     = 5.5;      // Combined score for A+ (default 5.5)
input double InpGradeA         = 4.0;      // Combined score for A  (default 4.0)
input double InpGradeB         = 3.0;      // v5.8.2: B floor raised; weak B trades caused most oversized loss clusters
input double InpScoreFloor     = 0.65;     // v5.1.5: floor for quality-drag — combined score never drops below setupScore × this. Was effectively 0 → killed the bot in fair-quality regimes.
input bool   InpAdaptiveGradeB = false;    // v5.1.6: DEFAULT OFF — was permanently tightening threshold after losses, killing the bot. Set true to re-enable.
input double InpAdaptiveGradeBMax = 3.0;   // when adaptive on: max tightening cap
input int    InpStaleStreakHours = 6;      // when adaptive on: forget tightening after N hours of no trades
input int    InpTradeCooldown  = 300;      // Seconds between trades after a close (default 300)
input int    InpReversalCooldown = 300;    // v6.3.2: reduced 600→300 — 10min blocked V-reversals on M5 gold (2 full bars); 5min is enough
input int    InpProfitTakeMin  = 150;      // Start scanning for quick exit (USD, default 150)
input int    InpProfitTakeMax  = 500;      // Auto-close at this profit (USD, default 500)
input int    InpQuickExitMin   = 18;       // Auto-close minutes threshold (default 18)

input group "=== RE-ENTRY ENGINE (reverse-move recovery) ==="
input bool   InpUseReEntry     = true;     // v6.3.2: ON — re-entry on bounced stops during trends recovers free missed moves
input int    InpReEntryWindow  = 900;      // Seconds after close to watch for reversal (15min)
input double InpReEntryFactor  = 1.2;      // Price must move this x SL past original entry
input double InpReEntrySize    = 0.5;      // Re-entry size multiplier (0.5 = half original)
input int    InpMaxReEntriesPerDay = 1;    // Hard cap on re-entries per trading day
input bool   InpReEntryBetterPriceOnly = true; // After a loss, do not auto re-enter at a worse price than the failed entry

input group "=== SMART FILTERS ==="
input bool   InpUseDXYFilter   = true;     // Skip trades fighting DXY direction
input int    InpDXYRefreshSec  = 900;      // Refresh DXY every N seconds (15min)
input bool   InpDrawdownMode   = true;     // Auto-reduce risk after losing streak
input int    InpDrawdownLosses = 5;        // v6.3.2: raised 3→5 — 3 micro-losses were triggering half-risk mode all day
input double InpDrawdownRisk   = 0.5;      // Risk % during recovery mode (default 0.5)
input int    InpStreakCooldownLosses = 2;  // # losses in short window = pause
input int    InpStreakWindowSec = 2700;    // Window for loss-streak detection (45min)
input int    InpStreakPauseSec = 0;        // Pause duration after streak (v6.1.2: disabled — no DD blocking)
input bool   InpAsiaRangeBreakout = true;  // Enable Asia-range breakout setup at London/NY open
input bool   InpAdaptiveGrades = true;     // Auto-tune grade thresholds from recent win rate
input bool   InpResetML        = false;    // TRUE = clear local ML on attach (fresh start for this version)
input bool   InpDirectionLockout = false;  // Lock a direction if too many same-direction losses (v6.1.1: data shows -5.27 ATR net cost, 0 protection benefit — default off)
input int    InpDirLockoutLookback = 5;    // Check last N trades
input int    InpDirLockoutLossesNeeded = 2;// If N of last M were losses in same direction
input int    InpDirLockoutMinutes = 120;   // Lock that direction for X minutes
input bool   InpAntiBiasCorrection = false; // After repeated wrong-side losses, block or flip only if fast TFs prove opposite (v6.1.1: data shows 50/50 outcome at -1.56 ATR net cost — default off)
input int    InpAntiBiasLookback = 5;      // Recent closed trades checked for same-side losses
input int    InpAntiBiasLossesNeeded = 2;  // Losses needed before correction activates
input int    InpAntiBiasWindowMin = 180;   // Only use losses inside this many minutes
input double InpAntiBiasMinScore = 3.6;    // Minimum combined score before considering correction

input group "=== SMART FEATURES (secondary) ==="
input bool   InpUseNewsFilter  = true;     // Hard-block ±10min around news
input bool   InpLearnPatterns  = true;     // ML learning loop
input int    InpMaxPatterns    = 500;      // Pattern memory size
input int    InpMLMinTrustedSamples = 10;  // v6.3.5: lowered 20→10 — 10 samples gives reliable directional signal, less cold-start blind period
input int    InpHiveMinTrustedSamples = 15;// v6.3.5: lowered 30→15 — hive authority from fewer global samples
input string InpServerURL      = "https://xauaisniper.com";
input bool   InpBacktestMode   = false;    // TRUE = Strategy Tester (disables ALL WebRequests)

input group "=== CONVICTION-WEIGHTED SIZING (v4.5.0 — use Claude/GPT confidence) ==="
input bool   InpConvictionSizing = true;   // v6.3.0: TRUE — AI confidence now drives lot sizing by default
// v6.3.1: InpMinAIConfidence removed — threshold is now InpAIDirectorMinConf (55%) for all paths
// (was 60%, causing blocks when AI agreed at 56-59% on valid setups)
input int    InpNormalAIConfidence = 75;   // At/above this, use normal 1.0x size
input int    InpHighAIConfidence   = 90;   // At/above this, use 1.3x boost size
input double InpConvictionLowMulti  = 0.70; // v6.3.1: raised from 0.5 → 0.70 (AI at 55-74% = mild reduce, not halve)
input double InpConvictionHighMulti = 1.3;  // >=90% confidence -> 1.3x boost size
input bool   InpRespectSkipIf    = true;   // Honor the AI's skip_if veto condition

input group "=== TRAILING / BE LOCK (v4.5.1 — loosen the leash) ==="
input double InpBELockActivateR   = 1.0;   // BE lock only fires at >= this R-multiple (was 0.5 = too tight)
input double InpBELockProfitR     = 0.25;  // BE SL locks at openPx + this R (was +10pts = basically 0)
input double InpCapTrailATRMulti  = 1.5;   // CAP_RUNNER trail distance = this × ATR (was 0.8 = clipped easily)
input double InpCapTrailSpikeMulti= 1.8;   // On high-vol spike bars, widen trail to this × ATR
input double InpCapTrailCalmMulti = 1.2;   // On calm bars, use this × ATR
input int    InpClaudeAuditSec    = 900;   // Claude mid-trade audit frequency (was 600 = 10min, now 15min)

input group "=== TREND-AWARE TRAIL (v4.5.2 — read market mood) ==="
input bool   InpTrendAwareTrail   = true;  // TRUE = widen trail on trend days, tighten on ranges
input double InpTrendTrailMulti   = 2.2;   // Trending regime + strong EMA sep → this × ATR
input double InpStrongTrendTrail  = 2.5;   // Breakout / very strong trend → this × ATR
input double InpLowVolTrailMulti  = 1.0;   // LOW_VOL regime → tighter (ranges are tight)
input double InpChoppyTrailMulti  = 1.3;   // CHOPPY regime → moderate

input group "=== CONVICTION RUNNER (v4.5.3 — let 90%+ winners RUN) ==="
input bool   InpConvictionRunner  = true;  // TRUE = high-conf trades past +2R get max trail
input int    InpConvRunMinConf    = 90;    // Original AI confidence must have been >= this
input double InpConvRunMinR       = 2.0;   // Trade must be at least this much in profit (R-multiples)
input double InpConvRunnerMulti   = 3.0;   // Trail distance on these monsters = this × ATR

input group "=== PARTIAL TAKE-PROFIT (v4.5.4 — lock half, ride the rest) ==="
input bool   InpPartialTP         = true;  // Close part of the position at +X R, let rest run
input double InpPartialTPAtR      = 1.5;   // Fire partial at this R-multiple of profit (1.5 = give winners more room)
input double InpPartialPct        = 0.4;   // Fraction of position to close (0.4 = 40%, leaves 60% to ride)
input bool   InpPartialSkipHighConf = true;// Skip partial on 90%+ trades (let them fully run)
input int    InpPartialMinMinutes  = 3;    // Don't fire partial within first N minutes (let trade develop)

input group "=== PROFIT LADDER (v4.6.2 — auto-scales to YOUR account size) ==="
input bool   InpProfitLadder       = false; // v4.9.5 — DISABLED (clean exits use tiered model)
input bool   InpLadderUsePct       = true;  // TRUE = tiers are % of balance (recommended). FALSE = absolute $
input double InpLadderTier1ProfPct = 0.5;   // Tier 1 trigger: profit ≥ this % of balance
input double InpLadderTier1LockPct = 0.2;   //   lock SL at this % of balance
input double InpLadderTier2ProfPct = 1.0;   // Tier 2 trigger: profit ≥ this % of balance
input double InpLadderTier2LockPct = 0.5;   //   lock SL at this % of balance
input double InpLadderTier3ProfPct = 2.0;   // Tier 3 trigger
input double InpLadderTier3LockPct = 1.2;
input double InpLadderTier4ProfPct = 3.5;   // Tier 4 trigger
input double InpLadderTier4LockPct = 2.0;
input double InpLadderTier5ProfPct = 5.0;   // Tier 5 trigger
input double InpLadderTier5LockPct = 3.0;
input double InpLadderTier6ProfPct = 8.0;   // Tier 6 trigger (v4.6.6 — massive profit)
input double InpLadderTier6LockPct = 5.0;
input double InpLadderTier7ProfPct = 12.0;  // Tier 7 trigger (v4.6.6 — moon mode)
input double InpLadderTier7LockPct = 8.0;
input bool   InpLadderMoonTrail    = true;  // After tier 7, switch SL to wide ATR trail (banks every new high)
input double InpLadderMoonTrailATR = 3.5;   // ATR multiplier for moon trail (3.5 = generous, lets it run)
input double InpLadderMinProfFloor = 25.0;  // Minimum tier-1 trigger in $ (micro accounts)
input double InpLadderMinLockFloor = 10.0;  // Minimum lock amount in $ (micro accounts)
// Legacy absolute $ inputs (used only when InpLadderUsePct=false)
input double InpLadderTier1Profit  = 500;   // Absolute $ tier 1 trigger
input double InpLadderTier1Lock    = 200;   // Absolute $ tier 1 lock
input double InpLadderTier2Profit  = 1000;
input double InpLadderTier2Lock    = 500;
input double InpLadderTier3Profit  = 2000;
input double InpLadderTier3Lock    = 1200;
input double InpLadderTier4Profit  = 3500;
input double InpLadderTier4Lock    = 2000;
input double InpLadderTier5Profit  = 5000;
input double InpLadderTier5Lock    = 3000;
input double InpLadderTier6Profit  = 8000;  // v4.6.6
input double InpLadderTier6Lock    = 5000;
input double InpLadderTier7Profit  = 12000; // v4.6.6
input double InpLadderTier7Lock    = 8000;

input group "=== PEAK-LOCK BACKSTOP (v4.6.7 — bank a slice of EVERY good move) ==="
input bool   InpPeakLockBackstop = false;  // v4.9.5 — DISABLED (clean exits use tiered model)
input double InpPeakLockArmPct   = 1.5;    // v4.9.0 — $1k→$20, $10k→$150, $100k→$1500 (floor $20). Primary early protection.
input double InpPeakLockMinPct   = 40.0;   // v4.8.3 — Was 25%, now 40% base. Dynamic scaling adds more for bigger peaks.

input group "=== MANAGEMENT MODE (v4.8.8 — pyramid-style simplicity) ==="
enum ENUM_MGMT_MODE { MGMT_SIMPLE, MGMT_BALANCED, MGMT_AGGRESSIVE };
input ENUM_MGMT_MODE InpMgmtMode = MGMT_BALANCED;  // BALANCED: trailing active but patient. SIMPLE: only Peak-Lock. AGGRESSIVE: tighter.

input group "=== PROFIT RATCHET (v4.9.1 — simple fast SL = 50% of current profit) ==="
input bool   InpProfitRatchet       = false;  // v4.9.5 — DISABLED (clean exits use tiered model)
input double InpRatchetArmPct       = 5.0;    // v4.9.2 — $1k→$100, $10k→$500, $100k→$5000, $1M→$50k
input double InpRatchetLockPct      = 50.0;   // Lock this % of current profit into SL (every tick, never pulls back)
input double InpRatchetArmFloor     = 100.0;  // v4.9.2 — Absolute minimum arm amount ($100)

input group "=== BASKET PROTECT (v4.9.7 — smarter thresholds + fast-reversal circuit breakers) ==="
input bool   InpBasketMode          = true;   // Master toggle: SL logic works on AGGREGATE PnL, not per-trade
input double InpBasketArmPct        = 3.0;    // v6.3.4: raised 2.2→3.0 — arm later, let winners breathe longer before locking
input double InpBasketArmFloor      = 200.0;  // v6.3.4: lowered 300→200 — catch mid-sized wins on small accounts
input double InpBasketLockMinPct    = 52.0;   // v6.3.4: raised 45→52 — never give back >48% of basket peak once armed
input double InpBasketRatchetT1Pct  = 1.5;    // v4.9.7 — was 0.5, now 1.5 (tier-1 fires later, let winners run)
input double InpBasketRatchetT2Pct  = 3.5;    // v4.9.7 — was 2.5, now 3.5 (tier-2 fires later)
input double InpBasketRatchetT3Pct  = 6.0;    // v4.9.7 — was 5.0, now 6.0 (tier-3 fires on REAL big peaks)
input double InpBasketBEPct         = 0.5;    // v4.9.7 — was 0.3, now 0.5 (BE lock at +0.5% bal — slightly later)
input bool   InpBasketDisablePerTrade = true; // When basket active, disable per-trade peak-lock & ratchet (no conflict)
// === v4.9.7 Smart Guards ===
input bool   InpBasketFastReversalGuard = true; // CIRCUIT BREAKER: close ALL on sudden reversal even if floor not breached
input double InpBasketFastDropPct       = 50.0; // If basket gives back >= X% of peak within FastWindowSec, close immediately
input int    InpBasketFastWindowSec     = 45;   // Window for fast-drop detection (gold news = ~30-60s reversals)
input double InpBasketHardGivebackPct   = 2.5;  // v6.3.4: raised 1.5→2.5 — $45 on $3k was closing basket too early; now $75
input bool   InpBasketBlockPyramidWhenArmed = true;  // v5.8.38: no fresh adds after basket protect is armed; let the current cycle resolve
input bool   InpBasketSoftLockFirst     = true; // v5.8.15: first basket-floor hit banks partial only; runner stays alive
input double InpBasketSoftLockPct       = 35.0; // % of each open layer to bank on first basket lock
input double InpBasketRunnerFloorPct    = 20.0; // After soft lock, keep only a small positive floor for the runner
// v6.1.3 — Basket direction-loss block: stop adding same-direction trades into a losing basket
input bool   InpBasketDirLossBlock      = true;  // Block new entries if same-direction trades are in net loss
input double InpBasketDirLossBlockPct   = 2.0;   // Block new same-dir entries if floating loss exceeds X% of balance

input group "=== ADAPTIVE RUNNER (legacy, DISABLED when ProfitRatchet is ON) ==="
input bool   InpAdaptiveRunner      = false;  // v4.9.5 — DISABLED (clean exits use tiered model)
input double InpARStage1ActivateR   = 0.8;    // v4.8.4 — Was 0.3, now 0.8 (let winners develop before tight trail)
input double InpARStage1MinPct      = 2.5;    // v4.9.0 — $1k→$30, $10k→$250, $100k→$2500 (floor $30)
input double InpARStage1TrailATR    = 2.5;    // v4.8.9 — Was 2.0, now 2.5 (more patient, ride profit growth)
input double InpARStage2ActivateR   = 2.0;    // v4.8.9 — Was 1.0, now 2.0 (need strong profit before wide trail)
input double InpARStage2TrailATR    = 4.0;    // v4.8.9 — Was 3.0, now 4.0 (trail FAR behind, let profit grow)
input double InpARBreakEvenR        = 1.2;    // v4.8.6 — Was 1.0, now 1.2 (more profit confirmed before BE lock)
input double InpARBreakEvenMinPct   = 4.0;    // v4.9.0 — $1k→$50, $10k→$400, $100k→$4000 (floor $50)
input double InpARBreakEvenProfitR  = 0.15;   // v4.8.4 — slightly more cushion past BE (was 0.1)
input double InpARMinTrailPoints    = 80;     // Anti-noise: SL never closer than X points (chop filter, 80pt = ~$0.80 on XAU)
input double InpARMomentumBoostMulti = 0.7;   // In strong momentum, tighten trail by this multi (0.7 = 30% tighter = faster ratchet)

input group "=== TREND HOLD MODE (v4.8.4 — don't micro-exit when trend is obvious) ==="
input bool   InpTrendHoldMode    = false;  // v4.9.5 — DISABLED (clean exits handle trends via chandelier)
input double InpTrendHoldTrailATR = 3.0;   // Trail distance in trend-hold mode (wider than Stage 2)

input group "=== CLEAN EXITS (v6.3.4 — adaptive exits, close dead zone, tighter Chandelier) ==="
input bool   InpCleanExits          = true;   // MASTER toggle — disables all other per-trade trails
// v6.3.4 EXIT FIXES (audit-confirmed profit giveback sources):
// Old: BE at 1.85R with 0.05R cushion → trade could give back 95% between 1.85R and Chandelier start
// Old: Chandelier starts at 3.5R with 4.8× ATR → 0.1 lot trade could give $190-380 from peak
// New: BE at 1.50R with 0.30R cushion → meaningful floor earlier. Chandelier starts at 2.0R, tighter ATR.
input double InpCleanBEActivateR    = 1.50;   // v6.3.4: earlier BE (was 1.85) — protect sooner without choking
input double InpCleanBECushionR     = 0.30;   // v6.3.4: lock 30% of risk at BE (was 0.05 = $3 floor = worthless)
input double InpCleanChandelierStartR = 2.00; // v6.3.4: trail from +2R not +3.5R — closes dead zone
input double InpCleanChandelierATR1 = 3.2;    // v6.3.4: tightened 4.8→3.2 — still breathes but banks more profit
input double InpCleanChandelierATR2 = 2.5;    // v6.3.4: tightened 3.8→2.5 — after +4R lock in the bulk
input double InpCleanPartialR       = 2.20;   // v6.3.5: take partial at 2.2R (was 3.2R) — bank profit as Chandelier starts, runner continues
input double InpCleanPartialPct     = 22.0;   // v6.3.5: raised 12→22% partial — meaningful cash in pocket, 78% runner still runs
input int    InpCleanChandelierLookback = 24; // Bars to scan for highest high / lowest low
input bool   InpCleanMomentumInvalidation = true; // Cut trade if momentum flips hard against us
input int    InpCleanStaleHours     = 3;      // Close if > X hours in AND profit < StaleMinR, unless trend still validates
input double InpCleanStaleMinR      = 0.10;   // Threshold below which we consider trade stale
input double InpCleanMaxLossR       = 2.60;   // v5.8.17: give XAU pullbacks room before invalidation close
input double InpCleanEmergencyLossR = 4.20;   // Emergency close only after a true failed setup/disaster move
input int    InpCleanStructureLookback = 18;  // Wider swing window for gold structure invalidation
input double InpCleanStructureATRBuffer = 0.35; // Close must break swing by this ATR fraction
input int    InpCleanMinInvalidationMin = 40; // Do not judge normal early XAU pullback too fast
input int    InpCleanStagnantMinutes = 120;   // Time-based exit for flat/choppy trades with no progress
input double InpCleanStagnantMaxR = 0.20;     // Stagnant if abs(R) remains below this after StagnantMinutes

input group "=== GOLD PULLBACK SURVIVAL (v5.8.15 — structure before panic) ==="
input bool   InpGoldPullbackSurvivalMode = true;  // If trend/structure still supports trade, give loss exits more room
input int    InpGoldPullbackConfirmBars  = 3;     // Need this many closed bars beyond structure before true failure
input double InpGoldPullbackCapBoost     = 1.80;  // Boost loss caps while recovery probability remains valid
input int    InpGoldPullbackMinMomentum  = 3;     // Momentum score needed to classify drawdown as recoverable

input group "=== EXPECTANCY LOSS ARMOR (v5.8.15 — breathe first, de-risk before disaster) ==="
input bool   InpExpectancyLossArmor       = true;  // Runs even when Clean Exits owns trade management
input bool   InpExpectancySoftDeRisk      = true;  // First response is partial size reduction, not full kill
input double InpExpectancySoftLossR       = 2.70;  // Soft de-risk trigger by R
input double InpExpectancySoftLossPctEq   = 4.5;   // Soft de-risk trigger by equity %
input double InpExpectancySoftClosePct    = 15.0;  // Close this % once; keep runner alive for recovery
input int    InpExpectancySoftMinAgeSec   = 1800;  // Let fresh XAU pullbacks breathe before de-risk
input double InpExpectancyMaxLossR        = 4.20;  // Full close only at deep R loss
input double InpExpectancyMaxLossPctEq    = 8.5;   // Or at dangerous equity loss, whichever comes first
input int    InpExpectancyMinAgeSec       = 2400;  // Avoid full close before the setup has had time to prove itself
input bool   InpExpectancyRequireStructureBreak = true; // Do not close red just for drawdown while structure is still intact
input bool   InpExpectancyUseDayGiveback  = false; // v5.8.17: disabled by default; basket/SL manage live pullbacks
input double InpExpectancyDayArmPct       = 1.0;   // Arm daily giveback after day HWM is up this % of start equity
input double InpExpectancyDayMaxGivePct   = 35.0;  // Max allowed giveback of today's HWM profit
input double InpExpectancyDayGiveFloorUSD = 600.0; // Floor so small normal fluctuation does not close a basket
input bool   InpNoPartialSmartLossArmor   = true;  // When cloud-safe no-partials is ON, full-close only confirmed failed losers earlier
input double InpNoPartialSmartLossR       = 2.75;  // No-partial confirmed-failure close threshold by R
input double InpNoPartialSmartLossPctEq   = 4.0;   // Or by account equity %, whichever is smaller
input int    InpNoPartialSmartLossMinSec  = 1500;  // Let normal XAU pullbacks breathe first
input int    InpNoPartialSmartMaxMomentum = 1;     // Momentum must be this weak or worse for early no-partial close

input group "=== A+ PROFIT SHIELD (v5.8.55 — runner restore: no tiny BE choke) ==="
input bool   InpAPlusShield             = true;   // Master toggle
// --- TIER 1: observation arm (records proven profit; does NOT move SL by default) ---
input double InpAPlusShieldEquityPct    = 1.5;    // Mark shield armed when peak >= X% of reference balance
input double InpAPlusShieldArmR         = 1.50;   // Also mark armed when peakR >= this
input double InpAPlusShieldBECushR      = 0.04;   // SL = entry + slDist * this cushion
input double InpAPlusShieldMinArmUSD    = 30.0;   // Ignore noise-level peaks; $7-$20 should not move SL on a $3k account
input bool   InpAPlusShieldMoveBEOnTier1= false;  // OFF restores v5.8.50-style runner breathing; tier2 still protects meaningful profit
// --- TIER 2: Active protection (only fires when peak was MEANINGFUL + momentum confirms reversal) ---
input double InpAPlusShieldProtectEquityPct = 2.5;  // Tier 2 can lock after account-meaningful profit, without choking runners
input double InpAPlusShieldProtectR         = 3.0;  // And peakR >= this when RequireUSDAndR is true
input double InpAPlusShieldMinProtectUSD    = 75.0; // Never treat tiny moves as meaningful protection events
input bool   InpAPlusShieldRequireUSDAndR   = false;// False = 3% account profit can lock even if SL was wide
input double InpAPlusGivebackPct            = 70.0; // Trail only after large giveback from a meaningful peak
input double InpAPlusGivebackTrailATR       = 1.80; // Wider ATR trail — gives pullbacks room
input double InpAPlusForceExitGivePct       = 88.0; // If market-close enabled, force-close after X% giveback
input bool   InpAPlusShieldAllowMarketClose = false;// Default OFF: tighten SL, do not close runners at tiny profit
input double InpAPlusShieldPeakLockPct      = 45.0; // On confirmed reversal, try to lock this % of best floating profit
input int    InpAPlusReversalMomentum       = 2;    // Trail/close only if momentum score <= this (confirms reversal, not pullback)

input group "=== AI EXIT BRAIN (v4.7.0 — let Claude veto bad rule-based closes) ==="
input bool   InpAIExitOverride   = true;   // v6.3.0: TRUE — AI Director can HOLD, CLOSE, or LOCK positions
input int    InpAIExitMinSec     = 60;     // Min seconds between AI veto calls per position (cost control)
input double InpAIExitMinProfit  = 30.0;   // Only call AI veto when profit/peak ≥ this $ (skip cheap closes)

input group "=== AUTO-SCALE (v4.4.4 — smart bounds for profit cap) ==="
input bool   InpAutoScale      = true;     // TRUE = auto-derive $ thresholds from balance
input double InpAutoRiskPct    = 0.8;      // Hard stop = this % of balance (e.g. 0.8% of $1000 = $8)
input double InpAutoProfMinPct = 0.15;     // Profit floor scan start = this % of balance
input double InpAutoProfMaxPct = 3.0;      // Profit soft-cap = this % of balance (was 0.5, let runners run)
input double InpAutoPeakMinPct = 0.25;     // Peak-retrace arm threshold = this % of balance
input double InpProfMinFloorUSD  = 25.0;   // ProfitMin NEVER below this $ (micro-account floor)
input double InpProfMaxFloorUSD  = 50.0;   // ProfitMax NEVER below this $ (micro-account floor)
input double InpProfMaxCeilUSD   = 25000.0; // ProfitMax NEVER above this $ (raised v4.6.6 — let monsters run)
input bool   InpSmartCapExit     = true;   // TRUE = cap only exits on real reversal, else trail SL tightly

input group "=== VOLATILITY-ADAPTIVE LOT SIZING ==="
input bool   InpVolAdaptiveLots = true;    // Reduce lot size when ATR spikes above normal
input double InpVolSpikeMulti  = 1.5;      // current ATR >= this × median ATR = "spike"
input double InpVolSpikeReduce = 0.70;     // Multiply lots by this during vol spikes
input double InpVolCalmMulti   = 0.7;      // current ATR <= this × median ATR = "calm"
input double InpVolCalmBoost   = 1.10;     // Lot boost during calm stable markets

input group "=== SAFETY ==="
input double InpMaxSpread      = 150.0;    // Max spread (points)
input double InpEquityProtect  = 70.0;     // Equity protection (%) — set 0 to disable
input bool   InpWeekendClose   = true;     // Close Friday 20:00
input int    InpMagicNumber    = 20250401;

input group "=== LOSS PROTECTION (v4.4.5 — trust the SL, stop scalping out) ==="
input double InpHardStopUSD    = 0;        // Hard $ loss cap per trade (0 = OFF, SL handles it)
input bool   InpHardStopRBased = true;     // TRUE = HardStop = adaptive R-based risk, not fixed dollars
input double InpHardStopRMulti = 3.5;      // v5.8.15: catastrophic only; structure-aware de-risk handles earlier damage
input bool   InpEarlyAdverseCut = false;   // OFF by default — let SL do its job (was killing good trades)
input int    InpEarlyAdverseMin = 5;       // Minutes window for early cut
input double InpEarlyAdverseR  = 1.5;      // Only cut if down > 1.5R early (was 0.7 — too tight)
input bool   InpPeakRetraceExit = true;    // Exit winner if retraces from peak
input double InpPeakRetracePct = 75.0;     // % retrace from peak to close (was 60, give room)
input double InpPeakMinUSD     = 250.0;    // Peak must exceed this USD to arm retrace exit
input bool   InpMomentumGuard  = true;     // Don't cut winners if momentum is strong
input int    InpMomentumFadeScore = 4;     // Fade trigger needs ALL 4 signals (was 3 = premature)

input group "=== PYRAMID / SCALE-IN (v4.4.5 — stack up to 5 in same direction) ==="
input bool   InpAllowPyramid    = true;    // Stack multiple trades in same direction when signal holds

// ====================================================================
// v5.8.0 — DATA-DRIVEN SETUP TOGGLES
// After analyzing 173 live trades:
//   TREND_PULLBACK: 74 trades, 50% WR, -$48,961 net (PF 0.38) — KILLED
//   BREAKOUT:       11 trades, 54% WR, -$8,048 net (PF 0.34) — KILLED
//   SQUEEZE_RELEASE: 21 trades, 66.7% WR, +$13,651 (PF 4.36) — KEPT
//   RANGE_REVERSAL:  2 trades, +$764 (PF 1.63) — KEPT
//   ASIA_BREAKOUT:   1 trade,  +$1,004 — KEPT
// User can re-enable any setup via these toggles if they redesign the entries.
// ====================================================================
input bool   InpAllowTrendPullback = true;  // v5.8.2: allowed only when Smart Guard quality gates pass
input bool   InpAllowBreakout       = true;  // v5.8.2: allowed only when Smart Guard quality gates pass
input bool   InpAllowSqueezeRelease = true;  // v5.8.0: KEEP — $13k profit, PF 4.36
input bool   InpAllowRangeReversal  = true;  // small +EV
input bool   InpAllowAsiaBreakout   = true;  // small +EV
input bool   InpAllowRSIExtreme     = true;
input bool   InpAllowLondonFixPin   = true;
input bool   InpAllowDXYReversal    = true;
input bool   InpAllowMultiExtreme   = true;
input group "=== SMART GUARD (v5.8.2 — data-driven loss reduction) ==="
input bool   InpSmartGuardEnable          = true;  // Master switch for v5.8.2 live-history protections
input bool   InpOneDirectionOnly          = true;  // v5.8.5: block opposite-direction entries while a position is open
input bool   InpBlockNewEntriesIfHedged   = true;  // v5.8.5: if account is already mixed BUY+SELL, pause fresh entries
input bool   InpSmartGuardSkipBTrendBreak = true;  // v5.8.7: adaptive B-grade guard for TREND_PULLBACK/BREAKOUT
input bool   InpSmartGuardRequireHTF      = true;  // Use adaptive XAU confirmation for TREND_PULLBACK/BREAKOUT
input bool   InpSmartGuardNoDamageStack   = false; // v6.3.2: OFF — was killing all re-entries during active positions; SmartGuard lot reduction already handles damage-setup risk
input double InpSmartGuardDamageLotMulti  = 0.75;  // v5.8.55 softer cut; protects damage setups without making A/A+ too timid
input int    InpSmartGuardMinHardSamples  = 30;    // Need this many same-setup live patterns before hard expectancy veto
input double InpSmartGuardHardExpectancy  = -150.0;// Hard-veto only when decayed avg P/L/trade is worse than this
input double InpSmartGuardHardWinRate     = 35.0;  // Hard-veto only when decayed WR is also below this %
input double InpSmartGuardSoftLotMulti    = 0.70;  // Soft-veto risk multiplier; trade still allowed if other gates pass
input int    InpSmartGuardRelaxAfterMin   = 180;   // If no trades for this long, relax hard veto to soft retest
input double InpSmartGuardOverrideScore   = 3.8;   // Strong trend pullbacks at/above this can override soft negative stats
input bool   InpPyramidRequireGradeA      = false; // v5.8.38: B can pyramid only when protected-quality gates pass
input bool   InpPyramidRequireHTF         = true;  // Only pyramid when adaptive fast confirmation still supports direction

input int    InpMaxPyramidAdds  = 3;       // v5.8.38: controlled compounding in clean trends/rescue cycles
input double InpPyramidMinATR   = 0.65;    // Price must move at least this × ATR before adding
input double InpPyramidSizeMulti= 0.58;    // Each add is this × previous size (prevents stack blow-up)
input int    InpPyramidMinGapSec= 180;     // Min seconds between pyramid adds
input bool   InpPyramidOnAdverse= false;   // v5.8.0: DISABLED by default — live data showed -$21k from 37 adverse-pyramid trades (PF 0.28). Adds risk to losing positions.
input bool   InpPyramidOnTrend  = true;    // Add when price moves WITH us (trend continuation)
input bool   InpPyramidAdaptiveEngine = true; // v5.8.25: score-based institutional pyramid engine
input bool   InpPyramidAllowProtectedB = true; // Allow B-grade adds only when base trade is healthy and trend evidence is strong
input bool   InpPyramidRescueMode = true;      // Allow ONE small pullback/retest add against entry if original direction still confirms
input double InpPyramidRescueMaxATR = 1.80;    // Do not rescue-add after drawdown is already too deep
input double InpPyramidRescueSizeMulti = 0.42; // Rescue add size vs original lot before risk caps
input double InpPyramidRescueMinScore = 3.60;  // Rescue add needs solid original signal score
input double InpPyramidRescueEliteScore = 4.70;// v5.8.25: elite score can allow one controlled rescue without wick-turn
input double InpPyramidMinHealthATR = 0.45;    // Base trade should be this ATR in profit before first add
input double InpPyramidModerateScore = 3.60;   // Minimum score for protected B-grade continuation add
input double InpPyramidEliteScore = 4.20;      // Elite score allows stronger/faster adds
input double InpPyramidMaxSpreadFrac = 0.85;   // Pyramid spread must be <= this fraction of max spread
input double InpPyramidSessionMin = 0.65;      // Minimum session quality for pyramid adds
input double InpPyramidVolMinExpansion = 0.70; // Avoid pyramids when ATR is too dead
input double InpPyramidVolMaxExpansion = 2.20; // Avoid pyramids during unstable volatility spikes
input int    InpPyramidAllowEPFUpToTier = 2;   // EPF T1/T2 may allow protected elite adds; T3+ blocks
input bool   InpPyramidEliteRescueNoTurn = false; // No pre-turn rescue by default; avoid adding before price proves the turn
input double InpPyramidRescueConfirmMultiMin = 0.70; // Min adaptive confirm multiplier for rescue adds
input bool   InpPyramidSoftNeutralConfirm = false;   // Neutral fast TFs are not enough reason to rescue a losing add
input double InpPyramidSoftConfirmMinScore = 3.60;   // B-quality rescue can retest when fast TFs are neutral
input double InpPyramidSoftConfirmLotMulti = 0.70;   // H1 supports but fast TFs neutral: reduced add size
input double InpPyramidNeutralConfirmLotMulti = 0.55;// Neutral-only rescue add size when no fast TF opposes
input int    InpPyramidFailCooldownSec = 120;  // Cooldown after failed pyramid attempts
input double InpPyramidProtectedBQuality = 58.0; // Quality needed for protected B pyramid continuation
input double InpPyramidEPFOverrideQuality = 72.0; // Quality needed to override EPF soft pause
input bool   InpPyramidRequireTurnForRescue = true; // Rescue adds must wait for turn/rejection, not just elite original score
input bool   InpPyramidNoAddIntoArmedBasket = true; // Prevent high-price add immediately before basket/runner protection closes
input bool   InpPyramidRetestRescueMode = true; // One small rescue add at pullback retest + rejection, not blind averaging
input double InpPyramidRetestRescueSizeMulti = 0.35; // Smaller than normal rescue; helps drawdown without overloading risk
input int    InpPyramidRetestLookbackBars = 12; // Recent M5 range used to find pullback top/bottom
input double InpPyramidRetestZoneATR = 0.35; // How close price must be to retest EMA/VWAP/range edge
input double InpPyramidRetestBreakATR = 0.18; // Strong close beyond retest edge blocks rescue add

input group "=== SCAN WATCHDOG (v5.8.8 — no restart needed) ==="
input int    InpTimerScanSec     = 15;      // Timer wake-up so slow ticks/VPS lag cannot freeze scan loop
input int    InpScanWatchdogMin  = 7;       // Force a scan if no successful entry scan for this many minutes
input int    InpScanSkipLogSec   = 120;     // Log repeated idle-skip detail at most every N seconds
input int    InpIndicatorReloadFails = 3;   // Rebuild indicator handles after this many buffer failures
input int    InpIndicatorWarmupSec = 12;    // v5.8.25: wait after rebuilding handles before copying buffers again
input int    InpIndicatorRecoveryBackoffSec = 90; // v5.8.25: minimum seconds between handle rebuild attempts

input group "=== POST-WINNER ENTRY GUARD (v4.6.5 — user-tunable cooldown) ==="
input bool   InpPostWinnerGuard    = true;   // Block re-entry in same direction after a winner (set false to disable)
input int    InpPostWinnerCoolMin  = 5;      // Cooldown minutes after a winning close (was 30, now 5)
input double InpPostWinnerATRBump  = 0.5;    // Need price ≥ this×ATR better to bypass cooldown
input bool   InpPostWinnerCycleGuard = true; // v5.8.25: after banking, don't chase same direction at worse exhaustion price
input int    InpPostWinnerCycleMin   = 45;   // Minutes to require a pullback/reset after profitable same-direction exit
input double InpPostWinnerResetATR   = 0.60; // Required reset from close price before same-direction re-entry
input double InpPostWinnerChaseATR   = 0.20; // Worse than close by this ATR = bottom/top chase risk
input bool   InpPostLossSameSideGuard = true; // After a same-side loss, wait for a better retest instead of chasing higher/lower
input int    InpPostLossGuardMin      = 90;   // Minutes after a loss to require better same-side price
input double InpPostLossBetterATR     = 0.25; // BUY must be this ATR cheaper; SELL must be this ATR higher than failed entry

input group "=== STRATEGIC TREND INTELLIGENCE (v6.0 STI — market narrative awareness) ==="
// STI makes the EA understand COMPLETE market structure rather than isolated candles.
// It does NOT replace existing guards — it is a mandatory additive intelligence layer.
// PHILOSOPHY: strict does NOT equal smart. STI is measured. Hard blocks = extreme cases only.
input bool   InpSTI_Enable              = true;   // Master on/off for all STI logic
input bool   InpSTI_Log                 = true;   // Print STI decisions and scores to terminal
// Late Entry Filter — prevents entering after most of the trend move is already done
input double InpSTI_LateEntryMaxEMADist = 3.0;    // H4 EMA50 distance (in H4 ATR) = late territory
input double InpSTI_LateEntryMaxMoveATR = 9.0;    // Consecutive M5 run in ATR multiples = late
input double InpSTI_LateEntryBlockScore = 82.0;   // Late risk >= this = hard block (extreme only)
input double InpSTI_LateEntryReduceScore= 68.0;   // v6.3.2: raised 58→68 — at 58 two mild signals triggered 0.65x reduce, stacking to sub-minLot on Asia B-grade
// Exhaustion Detection — RSI divergence + ATR contraction must agree
input double InpSTI_ExhaustionBlock     = 80.0;   // Exhaustion >= this AND tcp < 60 = hard block
input double InpSTI_ExhaustionReduce    = 62.0;   // Exhaustion >= this = lot reduction (x0.75)
// TCP-based exit guidance — high continuation probability = hold the runner
input double InpSTI_TCPContinueMinimum  = 62.0;   // TCP >= this: skip stagnant/stale close on profitable trade
// Re-entry intelligence — after TP, wait for clean pullback before same-direction re-entry
input bool   InpSTI_BlockLateReentry    = true;   // After TP, require pullback before same-dir re-entry
input double InpSTI_ReentryPullbackATR  = 0.60;   // v6.3.2: reduced 1.20→0.60 — 1.2 ATR was too deep, missed most real trend re-entries
input int    InpSTI_ReentryMinWaitMin   = 20;     // Minutes to wait after TP before watching for pullback
input int    InpSTI_ReentryMaxWindowMin = 30;     // v6.3.2: reduced 90→30 min — 90 min was blocking 5+ re-entries per trend day

//+------------------------------------------------------------------+
//| ENUMS                                                            |
//+------------------------------------------------------------------+
bool StructureRunnerActive()
{
   return InpStructureRunnerMode;
}

double EffTPMultiplier()
{
   return StructureRunnerActive() ? MathMax(InpTPMultiplier, InpStructureTPMultiplier) : InpTPMultiplier;
}

double EffTPExtendTriggerPct()
{
   return StructureRunnerActive() ? InpStructureTPExtendTriggerPct : InpTPExtendTriggerPct;
}

double EffTPExtendATRMulti()
{
   return StructureRunnerActive() ? InpStructureTPExtendATRMulti : InpTPExtendATRMulti;
}

double EffBasketArmPct()
{
   return StructureRunnerActive() ? InpStructureBasketArmPct : InpBasketArmPct;
}

double EffBasketLockMinPct()
{
   return StructureRunnerActive() ? InpStructureBasketLockMinPct : InpBasketLockMinPct;
}

double EffBasketRatchetT1Pct()
{
   return StructureRunnerActive() ? InpStructureBasketRatchetT1Pct : InpBasketRatchetT1Pct;
}

double EffBasketRatchetT2Pct()
{
   return StructureRunnerActive() ? InpStructureBasketRatchetT2Pct : InpBasketRatchetT2Pct;
}

double EffBasketRatchetT3Pct()
{
   return StructureRunnerActive() ? InpStructureBasketRatchetT3Pct : InpBasketRatchetT3Pct;
}

double EffBasketBEPct()
{
   return StructureRunnerActive() ? InpStructureBasketBEPct : InpBasketBEPct;
}

double EffBasketHardGivebackPct()
{
   return StructureRunnerActive() ? InpStructureBasketHardGivebackPct : InpBasketHardGivebackPct;
}

double EffCleanBEActivateR()
{
   return StructureRunnerActive() ? MathMax(InpCleanBEActivateR, InpStructureBEActivateR) : InpCleanBEActivateR;
}

double EffCleanBECushionR()
{
   return StructureRunnerActive() ? InpStructureBECushionR : InpCleanBECushionR;
}

double EffCleanChandelierStartR()
{
   return StructureRunnerActive() ? MathMax(InpCleanChandelierStartR, InpStructureChandelierStartR) : InpCleanChandelierStartR;
}

double EffCleanChandelierATR1()
{
   return StructureRunnerActive() ? MathMax(InpCleanChandelierATR1, InpStructureChandelierATR1) : InpCleanChandelierATR1;
}

double EffCleanChandelierATR2()
{
   return StructureRunnerActive() ? MathMax(InpCleanChandelierATR2, InpStructureChandelierATR2) : InpCleanChandelierATR2;
}

int EffCleanMinInvalidationMin()
{
   return StructureRunnerActive() ? (int)MathMax(InpCleanMinInvalidationMin, InpStructureMinHoldMinutes) : InpCleanMinInvalidationMin;
}

enum ENUM_REGIME
{
   REGIME_TRENDING_UP,
   REGIME_TRENDING_DOWN,
   REGIME_RANGING,
   REGIME_BREAKOUT_UP,
   REGIME_BREAKOUT_DOWN,
   REGIME_LOW_VOL,
   REGIME_CHOPPY,
   REGIME_DEAD
};

//+------------------------------------------------------------------+
//| ML PATTERN                                                       |
//+------------------------------------------------------------------+
struct TradePattern
{
   int    direction;
   double emaDiff;
   double rsi;
   double atr;
   int    hour;
   int    dayOfWeek;
   int    regime;
   int    setupType;
   bool   wasWinner;
   double profit;
   string signature;       // NEW: 7-field signature for exact + rollup matching
};

//+------------------------------------------------------------------+
//| GLOBALS                                                          |
//+------------------------------------------------------------------+
CTrade        trade;
CPositionInfo posInfo;
CAccountInfo  accInfo;

bool   licenseValid = false;
int    hEMAFast, hEMASlow, hRSI, hATR, hBBUpper, hBBLower, hBBMid;
int    hEMAFast_H1, hEMASlow_H1, hRSI_M15, hStoch;
int    hEMAFast_H4, hEMASlow_H4;   // v4.8.0 — H4 HTF context
double bufEMAFast[], bufEMASlow[], bufRSI[], bufATR[];
double bufBBUpper[], bufBBLower[], bufBBMid[];
double bufEMAFast_H1[], bufEMASlow_H1[], bufRSI_M15[];
double bufEMAFast_H4[], bufEMASlow_H4[];  // v4.8.0
double bufStochK[], bufStochD[];

double initialBalance, dailyStartEquity, weeklyStartEquity;
bool   g_propFirmMode = false;
double g_propFirmConfiguredBalance = 0.0;
double g_propFirmDailyLossPct = 4.0;
double g_propFirmMaxLossPct = 8.0;
double g_propFirmSafetyBufferPct = 0.50;
double g_propFirmRiskPerTradePct = 0.15;
double g_propFirmMaxBasketRiskPct = 0.75;
bool   g_propFirmAllowOneRetestAdd = true;
double g_propFirmRetestAddLotMulti = 0.25;
double g_propFirmStartingBalance = 0.0;
double g_propFirmAccountStartEquity = 0.0;
double g_propFirmDailyStartEquity = 0.0;
bool   g_propFirmLockActive = false;

// v5.8.16 — adaptive XAU confirmation state. Callers use this to turn
// H1 disagreement into reduced size instead of a hard gold veto.
double   g_adaptiveConfirmLotMulti = 1.0;
string   g_adaptiveConfirmReason   = "";
datetime g_lastAdaptiveConfirmLog  = 0;
datetime g_lastVolKillSoftPassLog  = 0; // v5.8.25: throttle adaptive volkill pass logs

// v5.1.2 Profit Guardian state ---------------------------------------------
double   pg_dayHWM            = 0.0;   // highest equity reached today
datetime pg_pauseUntil        = 0;     // halt new entries until this time (cooldown)
bool     pg_dayHaltActive     = false; // HWM-giveback hit → no new entries today
datetime pg_dayHaltDay        = 0;     // day this halt was triggered
int      pg_lastReportedTier  = -1;    // throttle tier transition logs
int      pg_consecutiveLosses = 0;     // v5.1.2: resets on any winner; drives adaptive cooldown
datetime pg_lastLossCycleAt   = 0;     // layered closes from one basket count as one losing cycle

// ====================================================================
// v5.5.0 — Equity Preservation Framework state
// ====================================================================
int      epf_tier             = 0;     // 0=normal 1=mild 2=defense 3=preserve 4=lockdown
int      epf_lastLoggedTier   = -1;    // throttle tier-change log spam
datetime epf_cooldownUntil    = 0;     // hard cooldown end time (consecutive-loss path)
double   epf_lastDailyGainPct = 0.0;   // for hysteresis (avoid flapping at tier boundaries)
int      epf_partialClosed[20];        // ticket IDs that already got partial-closed this session
int      epf_partialClosedCnt = 0;     // running count
int      epf_t4AdaptiveTradesToday = 0; // guarded T4 reduced-risk entries used today
datetime epf_t4LastAdaptiveTrade   = 0; // last guarded T4 entry time

// v5.2.1 — Startup cooldown state. Captured in OnInit so MT5/EA restart can't
// cause a blind trade on stale buffers / mid-bar context.
datetime g_startupAt          = 0;     // when EA first booted this session
datetime g_startupBarTime     = 0;     // open-time of the M5 bar at startup
bool     g_startupCooldownDone = false; // sticky flag once gate cleared (avoid re-logging every tick)
bool     g_startupIntelSyncDone = false;
bool     g_startupIntelSyncOk   = false;
string   g_startupIntelSyncReason = "not started";

// v5.1.9 — Selective Mode state (replaces day-halt full lockout)
bool     pg_selectiveActive      = false;  // PG fired → A/A+ only
datetime pg_selectiveActivatedAt = 0;      // when selective mode started
double   pg_selectiveTriggerEq   = 0.0;    // equity at activation
double   pg_selectiveLowEq       = 0.0;    // lowest equity since activation
datetime pg_selectiveLowAt       = 0;      // last time low was updated (for recovery timer)
int      pg_selectiveSkippedCnt  = 0;      // # of B/C trades blocked since activation

// v5.1.5 — Bot reasoning push throttle (avoid spamming cloud on every M5 bar)
string   br_lastReason         = "";    // last reason string pushed
datetime br_lastReasonAt       = 0;     // when last pushed
int      br_minIntervalSec     = 30;    // min seconds between identical-reason pushes

// v5.1.8 — admin-controlled trading mode (polled from /cloud/master/config every 60s).
// Defaults match the EA inputs; backend response overrides them when admin flips mode.
double          g_modeGradeB        = 0.0;     // 0 = use InpGradeB
double          g_modeScoreFloor    = 0.0;     // 0 = use InpScoreFloor
ENUM_TIMEFRAMES g_modeContextTF     = PERIOD_CURRENT;  // PERIOD_CURRENT = use InpContextTF
bool            g_modeUseHTFBias    = true;
bool            g_modeUseHTFBiasSet = false;   // false = use InpUseH4Bias
bool            g_modeAdaptiveSet   = false;   // false = use InpAdaptiveGradeB
bool            g_modeAdaptive      = false;
string          g_modeName          = "balanced";
datetime        g_modeLastFetch     = 0;
int             g_modeFetchIntervalSec = 60;
//---------------------------------------------------------------------------
int    todayTradeCount;
datetime lastDayReset, lastWeekReset, lastTradeClose;
bool   dailyLimitHit, weeklyTargetHit, weeklyLossHit;
int    totalTrades, wins, losses, lastTradeDir;

TradePattern patterns[];
int    patternCount;
int    lastSignalDir;
double lastSignalRSI, lastSignalEMADiff, lastSignalATR;
int    lastRegime, lastSetupType;
ENUM_REGIME currentRegime;
// v6.2.0: HTF consensus direction exposed globally so CheckForEntry can use it.
// +1 = H1+HTF both bullish, -1 = H1+HTF both bearish, 0 = no consensus.
int    g_htfConsensusDir = 0;

// v6.3.5: Hive verdict cache — one WebRequest per bar per signature
string   g_hiveLastSig     = "";
int      g_hiveLastVerdict  = 0;
int      g_hiveLastBar      = -1;

// v6.3.0: AI Director state
int    g_aiConsecutiveFails = 0;   // count of back-to-back AI server failures
bool   g_aiOffline = false;        // true when AI fails InpAIOfflineMaxFails times in a row
datetime g_aiOfflineSince = 0;     // v6.3.2: timestamp when AI went offline (for auto-recovery)
string g_aiLastVerdict = "NONE";   // last AI Director verdict for dashboard
int    g_aiLastConfidence = 0;     // last AI confidence % for dashboard
string g_aiClaudeVote = "";        // Claude's vote this bar
string g_aiGPTVote = "";           // GPT's vote this bar
string lastSignalSetup = "";
string lastSignalSignature = "";
string g_pendingBrainGrade = "";
double g_pendingBrainSetupScore = 0.0;
double g_pendingBrainCombinedScore = 0.0;
string g_pendingBrainEntryAudit = "";

// v5.8.49 — Command Center-owned Prop Firm Mode with persistent EA enforcement.
// This tracks where an idea first appeared, what blocked it, and whether a later
// A/A+ entry is now chasing the already-played move.
datetime g_signalFirstSeenTime = 0;
double   g_signalFirstSeenPrice = 0.0;
int      g_signalFirstSeenDir = 0;
string   g_signalFirstSeenSetup = "";
string   g_signalFirstSeenGrade = "";
string   g_signalFirstBlockReason = "";
double   g_signalFirstSetupScore = 0.0;
double   g_signalFirstCombined = 0.0;
double   g_signalFirstATR = 0.0;

struct BlockedIdea
{
   bool     active;
   datetime firstTime;
   datetime lastCheck;
   int      nextCheckpointMin;
   int      dir;
   double   signalPrice;
   double   atr;
   double   maxFav;
   double   maxAdv;
   double   setupScore;
   double   combinedScore;
   int      regime;
   string   setup;
   string   grade;
   string   reason;
};
BlockedIdea g_blockedIdeas[];
int         g_blockedIdeaCount = 0;
datetime    g_lastBlockedMemorySummary = 0;

ulong       g_qualityPosIds[];
double      g_qualityWorstPnl[];
datetime    g_qualityNegativeSince[];
int         g_qualityNegativeSec[];
double      g_qualityMaxFavMove[];
double      g_qualityMaxAdvMove[];

struct TradeBrainOpen
{
   ulong    posId;
   datetime entryTime;
   int      dir;
   double   entryPrice;
   double   sl;
   double   tp;
   double   lots;
   double   atr;
   double   setupScore;
   double   combinedScore;
   int      regime;
   int      aiConfidence;
   string   setup;
   string   grade;
   string   signature;
   string   session;
   string   entryReason;
};
TradeBrainOpen g_brainOpenTrades[];

struct TradeBrainClosedWatch
{
   bool     active;
   datetime closeTime;
   int      nextCheckpointMin;
   double   closePrice;
   double   closeProfit;
   double   maxMoreMove;
   double   maxReverseMove;
   TradeBrainOpen rec;
};
TradeBrainClosedWatch g_brainClosedWatch[];

// Tester/audit proof counters. These are intentionally small and local so
// the EA can prove which setup/exit families helped or hurt without adding
// another trading authority.
string g_exitReasonKeys[];
int    g_exitReasonTrades[];
int    g_exitReasonWins[];
double g_exitReasonGrossWin[];
double g_exitReasonGrossLoss[];
int    g_aiInfluencedTrades = 0;
int    g_aiInfluencedWins   = 0;
double g_aiInfluencedPnl    = 0.0;
int    g_nonAiTrades        = 0;
int    g_nonAiWins          = 0;
double g_nonAiPnl           = 0.0;
double g_peakEquityAudit    = 0.0;
double g_maxDrawdownAudit   = 0.0;

//+------------------------------------------------------------------+
//| SMART STATE — re-entry, drawdown, streak cool-down, DXY cache    |
//+------------------------------------------------------------------+
struct LastClose
{
   bool   valid;
   bool   wasLoss;
   bool   reEntered;
   int    dir;             // +1 BUY, -1 SELL
   double entryPrice;
   double closePrice;
   double slDist;          // price distance of SL at entry
   double lots;
   double profit;
   datetime closeTime;
   string signature;
   string setup;
   string exitReason;
};
LastClose  lastClose;

// ====================================================================
// v6.0 — STRATEGIC TREND INTELLIGENCE (STI) persistent state.
// This struct survives trade closes — unlike everything else in the EA,
// macro trend context is NEVER reset after a TP or SL.
// The EA thinks in terms of market narrative, not isolated candles.
// ====================================================================
struct STI_StateStruct
{
   int      macroDir;        // +1 bull, -1 bear, 0 neutral (D1×3 + H4×2 + H1×1 vote)
   double   macroStrength;   // 0.0-1.0 how many HTF agree with macro direction
   // After-TP re-entry memory
   datetime lastProfitClose; // timestamp of last profitable close
   int      lastProfitDir;   // direction of that trade (+1 or -1)
   double   lastProfitPrice; // close price at profitable exit
   bool     pullbackReady;   // true = clean pullback occurred after last TP
   // Internal caching
   int      lastCalcBar;     // M5 bar number (barOpen/300) at last macro update
};
STI_StateStruct g_sti;
double g_stiLotMulti = 1.0;  // lot multiplier set by STI gate; applied to sizeMulti at entry

// ====================================================================
// v6.0.1 — AI TRADING COMMITTEE structs + global state
// ====================================================================
struct CommitteeVote
{
   string module;
   int    score;      // -2 = strong against, -1 = mild against, 0 = neutral, +1 mild for, +2 strong for
   string label;
   string reasoning;
};

struct CommitteeDecision
{
   double lotMultiplier; // final lot adjustment applied to sizeMulti before OpenTrade
   int    totalScore;    // sum of all vote scores
   string directorLabel; // Market Director narrative label
   string thesis;        // full one-line committee log
   int    confidence;    // 0-100
};

struct TradeMemRecord
{
   string   pattern;       // setupName + "_" + grade (e.g. "TREND_PULLBACK_A+")
   string   directorLabel; // Market Director label at entry
   int      committeeConf; // committee confidence at entry (0-100)
   double   rMultiple;     // trade outcome in R units (positive = profit)
   datetime closedAt;
   bool     valid;
   // v6.3.8 extended fields for disk persistence + ATR-normalized matching
   int      dir;           // +1 BUY / -1 SELL
   string   session;       // ASIA / LONDON / NY
   double   atrAtEntry;    // raw ATR value at entry (pips-equivalent)
   int      htfTrend;      // +1 bull / -1 bear / 0 ranging
   int      atrRegime;     // 0=LOW / 1=MEDIUM / 2=HIGH (bucketed)
   double   maxDD;         // max adverse excursion in R
   double   maxFav;        // max favorable excursion in R
   // AI verdict fields (Upgrade 5)
   string   aiVerdict;     // ALLOW / BLOCK / REDUCE / SKIP
   int      aiConf;        // 0-100
};

CommitteeDecision g_committee;           // last assembled committee decision
TradeMemRecord    g_tradeMemory[500];    // circular buffer of last 500 closed trades (v6.3.8: was 100, now 500 with disk persistence)
int               g_tradeMemHead = 0;   // next write index in the circular buffer
int               g_tradeMemCount = 0;  // how many valid entries (0 until full, then stays at 500)

// Stored at entry, retrieved at close to record outcome in trade memory
string g_lastTradePattern  = "";
string g_lastTradeDirLabel = "";
int    g_lastTradeCommConf = 0;

// In-trade position classifier (max 10 simultaneous positions — parallel arrays)
ulong  g_posClassTicket[10];   // auto-init to 0
int    g_posClassState[10];    // auto-init to 0 (= PSTATE_UNKNOWN)

// v6.0.2: per-position committee data — fixes basket race condition where g_lastTradePattern
// would be overwritten by a pyramid add before the original position closed and recorded.
struct PosCommitteeRec { ulong posId; string pattern; string dirLabel; int conf; bool valid; };
PosCommitteeRec g_posCommData[10];

// v6.0.2: news aftermath filter globals
double   g_spreadEMA         = 0.0;  // exponential moving average of spread (α=0.02, ~50-tick baseline)
datetime g_newsAftermathUntil = 0;   // new entries blocked until this time after spread spike

datetime   closeTimes[];            // rolling list of close timestamps
bool       closeResults[];          // matching win/loss flags (true = loss)
int        closeDirs[];             // direction of each close (+1 buy, -1 sell)
datetime   streakPauseUntil = 0;    // paused until this time

// Direction lockout (when a side is repeatedly losing)
datetime   buyLockoutUntil  = 0;
datetime   sellLockoutUntil = 0;

// DXY cache (avoid hammering the endpoint)
datetime   dxyLastFetch = 0;
string     dxyGoldBias = "neutral"; // "bullish" | "bearish" | "neutral"

int        todayLossCount = 0;
datetime   todayLossResetDay = 0;
bool       drawdownActive = false;

// v6.3.8 UPGRADE 6 — Gate block analytics counters
int g_gateBlocks_Spread     = 0;
int g_gateBlocks_News       = 0;
int g_gateBlocks_Trend      = 0;
int g_gateBlocks_AI         = 0;
int g_gateBlocks_TradeBrain = 0;
int g_gateBlocks_Basket     = 0;
int g_gateBlocks_DailyLoss  = 0;
int g_gateBlocks_Volatility = 0;
int g_gateBlocks_Committee  = 0;
int g_gateBlocks_STI        = 0;
int g_gateBlocks_EPF        = 0;
int g_totalSignals          = 0;
int g_totalAllowed          = 0;
datetime g_gateReportLast   = 0;  // last time 24h report was printed

// v6.3.8 UPGRADE 7 — Equity high watermark + drawdown pause
double   g_equityHighWatermark = 0.0;  // updated whenever equity exceeds previous high
bool     g_drawdownPause       = false; // stop new entries when equity drops > InpDrawdownFromHighPct from watermark
double   g_perfMultLast        = 1.0;  // last logged performance multiplier (detect changes)
bool     g_dailyProfitLockArmed = false; // true when daily profit lock has been triggered

// v6.3.9 UPGRADE — 24h Forward-Test Report globals
int    g_ftReport_Signals     = 0;
int    g_ftReport_Trades      = 0;
int    g_ftReport_Wins        = 0;
int    g_ftReport_Losses      = 0;
double g_ftReport_TotalPnL    = 0.0;
double g_ftReport_MaxDD       = 0.0;
double g_ftReport_MaxFloat    = 0.0;
double g_ftReport_MaxFav      = 0.0;
int    g_ftReport_AIAllowed   = 0;
int    g_ftReport_AIBlocked   = 0;
int    g_ftReport_TBAllowed   = 0;
int    g_ftReport_TBBlocked   = 0;
double g_ftReport_StartEquity = 0.0;
datetime g_ftReport_StartTime = 0;
// Strategy breakdown parallel arrays (up to 20 strategies)
string g_ftReport_StratNames[20];
int    g_ftReport_StratWins[20];
int    g_ftReport_StratLosses[20];
int    g_ftReport_StratCount  = 0;
// 23:59 daily write guard
int    g_ftReport_LastWriteDay = -1;

// Re-entry safety counters
int        todayReEntryCount = 0;

// Asia range tracking (reset daily, tracked between 00:00-07:00 broker time)
double     asiaRangeHigh = 0;
double     asiaRangeLow  = 0;
bool       asiaRangeLocked = false;
datetime   asiaRangeDay = 0;

// v6.1.0 — SMC (Smart Money Concepts) state — updated once per M5 bar
struct SMC_OBZone
{
   bool     valid;
   int      dir;       // +1 = bullish OB (buy demand zone), -1 = bearish OB (sell supply zone)
   double   high;
   double   low;
   double   mid;
   datetime barTime;
};
struct SMC_FVGZone
{
   bool     valid;
   int      dir;       // +1 = bullish gap (price below, wants to fill up), -1 = bearish gap
   double   high;      // top of the gap
   double   low;       // bottom of the gap
   double   mid;
   datetime barTime;
};

SMC_OBZone  g_smc_ob_bull;     // most recent bullish order block (H1)
SMC_OBZone  g_smc_ob_bear;     // most recent bearish order block (H1)
SMC_FVGZone g_smc_fvg_bull;    // most recent unfilled bullish FVG (M15)
SMC_FVGZone g_smc_fvg_bear;    // most recent unfilled bearish FVG (M15)
int         g_smc_bos_dir   = 0;  // last H1 BOS direction: +1 bullish, -1 bearish, 0 = unknown
datetime    g_smc_last_bar  = 0;  // gate: only run SMC_Update() once per M5 bar

// Per-position peak-profit tracking (for retrace exit)
ulong      peakTickets[];
double     peakProfits[];

// v4.5.4 — Per-position partial-TP tracker (prevents double-firing the partial)
ulong      partialTakenTickets[];

// v4.7.0 — Per-position AI veto cooldown (last-call-time per ticket, cost control)
ulong      aiVetoTickets[];
datetime   aiVetoLastCall[];

// v4.7.3 — Per-position TP-extension counter (caps how many times TP can be pushed forward)
ulong      tpExtendTickets[];
int        tpExtendCount[];

// AUTO-SCALE derived values (computed in OnInit when InpAutoScale=true)
double     autoHardStopUSD    = 0;
double     autoProfitTakeMin  = 0;
double     autoProfitTakeMax  = 0;
double     autoPeakMinUSD     = 0;

// v4.9.4 — BASKET PROTECT state (aggregate across all open EA positions)
double     g_basketPeakUSD   = 0;     // Max total floating $ reached since last flat state
double     g_basketFloorUSD  = 0;     // Dynamic floor — if total falls below this, close ALL
bool       g_basketArmed     = false; // True once peak has crossed arm threshold
bool       g_basketBEHit     = false; // True once basket reached +BEPct% (then never let it go negative)
bool       g_basketSoftLockTaken = false; // v5.8.15: partial basket bank already used for this basket
datetime   g_basketLastLog   = 0;     // Throttle "basket state" prints
// v4.9.7 — Fast-reversal circuit breaker rolling buffer
//   Stores the last N (timestamp, basketPnL) pairs so we can detect a sudden drop
//   even if the floor hasn't been formally breached yet.
double     g_basketSnapPnL[];         // rolling buffer of basket PnL samples
datetime   g_basketSnapTime[];        // matching timestamps
int        g_basketSnapMax = 60;      // store up to 60 samples (~1 sample / sec when ticks come fast)

// v4.9.6 — DIAGNOSTIC HEARTBEAT state
string     g_lastSkipReason  = "";    // Updated every time OnTick returns silently
datetime   g_lastHeartbeat   = 0;     // Throttle heartbeat to 1/minute
datetime   g_lastBotMonitorHeartbeat = 0; // Remote dashboard heartbeat
datetime   g_lastBotCommandPoll = 0;      // PIN-safe command queue poll cadence
bool       g_remotePauseNewTrades = false;
bool       g_remoteStopTrading = false;
string     g_lastRemoteCommandState = "";
int        g_ticksSinceEntry = 0;     // How many ticks since last position opened
datetime   g_lastEntryScanAt = 0;     // v5.8.8: last time indicator buffers loaded and entry scan ran
datetime   g_lastEntryBarSeen = 0;    // v5.8.8: robust M5 bar marker, not trapped in local static state
datetime   g_lastScanSkipLog = 0;     // v5.8.8: throttled reason logs for idle/watchdog decisions
bool       g_timerForceScan = false;  // v5.8.8: timer asks OnTick to run a recovery scan
datetime   g_lastPyramidFailTime = 0; // v5.8.8: failed pyramid add cooldown
int        g_indicatorBufferFailCount = 0; // v5.9.0: rebuild stale indicator handles instead of requiring MT5 restart
datetime   g_lastIndicatorFailLog = 0;
datetime   g_lastIndicatorRebuildAt = 0; // v5.8.25: throttle recovery loops
datetime   g_indicatorWarmupUntil = 0;   // v5.8.25: let MT5 calculate new indicator buffers before retrying

// v5.8.51 — LIVE EXECUTION TELEMETRY
double     g_dailySlippageTotal = 0.0; // cumulative entry slippage today (in price units)
int        g_dailySlippageCount = 0;   // number of fills with measured slippage
datetime   g_slippageResetDay  = 0;    // day the counters were last reset
datetime   g_spreadSpikeUntil  = 0;    // spread recovery cooldown: block entries until this time

// TRADE THESIS (AI narrative per open position)
string     currentTradeThesis = "";
string     currentTradeInvalidation = "";
string     currentTradeTarget = "";
string     currentTradeBearishCase = "";   // v4.5.0 — Devil's Advocate counter-argument
int        currentTradeConfidence = 0;     // v4.5.0 — Original AI confidence (0-100)

// v4.5.0 — Last entry AI output cached after GetAIAnalysis()
int        lastAIConfidence = 0;
string     lastAIBearishCase = "";
string     lastAISkipIf = "";
// v6.3.8 — AI verdict stored at entry for feedback loop (Upgrade 5)
string     g_lastAIVerdict_ForMemory = "";  // ALLOW/BLOCK/REDUCE/SKIP — captured when order is placed

// Dashboard state cache — prevents throttled refresh from wiping scan data to zero
int        lastDashSignal = 0;
double     lastDashScore  = 0.0;
string     lastDashGrade  = "";

// Peak helpers
// ====================================================================
// v6.0 STRATEGIC TREND INTELLIGENCE — Core Functions
// ====================================================================

void STI_Init()
{
   g_sti.macroDir        = 0;
   g_sti.macroStrength   = 0.0;
   g_sti.lastProfitClose = 0;
   g_sti.lastProfitDir   = 0;
   g_sti.lastProfitPrice = 0.0;
   g_sti.pullbackReady   = false;
   g_sti.lastCalcBar     = 0;
   g_stiLotMulti         = 1.0;
}

// Returns 0-100: how strongly the multi-TF stack supports the given direction.
// Weights: D1=22, H4=22, H1=18, M30=15, M15=13, M5=10 → 100 total.
// Cached per signal (buy/sell) per 30 s to avoid redundant handle creation.
double STI_ComputeTCP(int signal)
{
   if(!InpSTI_Enable || signal == 0) return 50.0;
   static datetime cacheTime[2]; static double cacheVal[2];
   int idx = (signal == 1) ? 0 : 1;
   if(TimeCurrent() - cacheTime[idx] < 30) return cacheVal[idx];
   cacheTime[idx] = TimeCurrent();

   string w;
   int d1  = TFDirectionByEMA(signal, PERIOD_D1,  0.18, w);
   int h4  = TFDirectionByEMA(signal, PERIOD_H4,  0.20, w);
   int h1  = TFDirectionByEMA(signal, PERIOD_H1,  0.22, w);
   int m30 = TFDirectionByEMA(signal, PERIOD_M30, 0.25, w);
   int m15 = TFDirectionByEMA(signal, PERIOD_M15, 0.25, w);
   int m5  = TFDirectionByEMA(signal, PERIOD_M5,  0.25, w);

   double tcp = 0.0;
   if(d1  == signal) tcp += 22.0;
   if(h4  == signal) tcp += 22.0;
   if(h1  == signal) tcp += 18.0;
   if(m30 == signal) tcp += 15.0;
   if(m15 == signal) tcp += 13.0;
   if(m5  == signal) tcp += 10.0;
   cacheVal[idx] = tcp;
   return tcp;
}

// Returns 0-100: how exhausted the current trend is.
// Looks for ATR contraction + RSI divergence on H4 and H1.
// Multiple signals must agree — a single signal is NOT enough for a block.
double STI_ComputeExhaustion(int signal)
{
   if(!InpSTI_Enable || signal == 0) return 0.0;
   static datetime cacheTime[2]; static double cacheVal[2];
   int idx = (signal == 1) ? 0 : 1;
   if(TimeCurrent() - cacheTime[idx] < 45) return cacheVal[idx];
   cacheTime[idx] = TimeCurrent();

   double score = 0.0;

   // --- H4 ATR contraction ---
   {
      int h = iATR(_Symbol, PERIOD_H4, 14);
      if(h != INVALID_HANDLE)
      {
         double buf[21];
         if(CopyBuffer(h, 0, 0, 21, buf) == 21)
         {
            double s[20]; for(int i=0;i<20;i++) s[i]=buf[i+1];
            ArraySort(s);
            double med = s[10];
            if(med > 0)
            {
               double r = buf[1] / med;
               if(r < 0.70) score += 25.0;
               else if(r < 0.82) score += 12.0;
            }
         }
         IndicatorRelease(h);
      }
   }

   // --- H1 ATR contraction ---
   {
      int h = iATR(_Symbol, PERIOD_H1, 14);
      if(h != INVALID_HANDLE)
      {
         double buf[21];
         if(CopyBuffer(h, 0, 0, 21, buf) == 21)
         {
            double s[20]; for(int i=0;i<20;i++) s[i]=buf[i+1];
            ArraySort(s);
            double med = s[10];
            if(med > 0)
            {
               double r = buf[1] / med;
               if(r < 0.70) score += 15.0;
               else if(r < 0.82) score += 7.0;
            }
         }
         IndicatorRelease(h);
      }
   }

   // --- H4 RSI divergence (price at new extreme but RSI diverges) ---
   {
      int hR = iRSI(_Symbol, PERIOD_H4, 14, PRICE_CLOSE);
      int hA = iATR(_Symbol, PERIOD_H4, 14);
      if(hR != INVALID_HANDLE && hA != INVALID_HANDLE)
      {
         double rsi[4], cls[4], atr[2];
         bool ok = (CopyBuffer(hR,0,0,4,rsi)==4 &&
                    CopyClose(_Symbol,PERIOD_H4,0,4,cls)==4 &&
                    CopyBuffer(hA,0,0,2,atr)>0);
         if(ok && atr[1] > 0)
         {
            if(signal == 1) // bull trend: check bearish (price new high, RSI lower)
            {
               bool priceHigher = cls[1] > cls[3] + atr[1] * 0.30;
               bool rsiLower    = rsi[1] < rsi[3] - 2.5;
               if(priceHigher && rsiLower && rsi[1] > 58.0) score += 28.0;
            }
            else // bear trend: check bullish (price new low, RSI higher)
            {
               bool priceLower  = cls[1] < cls[3] - atr[1] * 0.30;
               bool rsiHigher   = rsi[1] > rsi[3] + 2.5;
               if(priceLower && rsiHigher && rsi[1] < 42.0) score += 28.0;
            }
         }
      }
      if(hR != INVALID_HANDLE) IndicatorRelease(hR);
      if(hA != INVALID_HANDLE) IndicatorRelease(hA);
   }

   // --- H1 RSI divergence (lighter weight) ---
   {
      int hR = iRSI(_Symbol, PERIOD_H1, 14, PRICE_CLOSE);
      int hA = iATR(_Symbol, PERIOD_H1, 14);
      if(hR != INVALID_HANDLE && hA != INVALID_HANDLE)
      {
         double rsi[4], cls[4], atr[2];
         bool ok = (CopyBuffer(hR,0,0,4,rsi)==4 &&
                    CopyClose(_Symbol,PERIOD_H1,0,4,cls)==4 &&
                    CopyBuffer(hA,0,0,2,atr)>0);
         if(ok && atr[1] > 0)
         {
            if(signal == 1)
            {
               bool priceHigher = cls[1] > cls[3] + atr[1] * 0.25;
               bool rsiLower    = rsi[1] < rsi[3] - 3.0;
               if(priceHigher && rsiLower && rsi[1] > 55.0) score += 17.0;
            }
            else
            {
               bool priceLower  = cls[1] < cls[3] - atr[1] * 0.25;
               bool rsiHigher   = rsi[1] > rsi[3] + 3.0;
               if(priceLower && rsiHigher && rsi[1] < 45.0) score += 17.0;
            }
         }
      }
      if(hR != INVALID_HANDLE) IndicatorRelease(hR);
      if(hA != INVALID_HANDLE) IndicatorRelease(hA);
   }

   cacheVal[idx] = MathMin(score, 100.0);
   return cacheVal[idx];
}

// Returns 0-100: how late/extended is this entry?
// Higher = most of the move already happened without a reset.
// Hard block only at extreme levels (> InpSTI_LateEntryBlockScore).
double STI_ComputeLateEntryRisk(int signal, double m5atr)
{
   if(!InpSTI_Enable || signal == 0 || m5atr <= 0) return 0.0;
   static datetime cacheTime[2]; static double cacheVal[2];
   int idx = (signal == 1) ? 0 : 1;
   if(TimeCurrent() - cacheTime[idx] < 30) return cacheVal[idx];
   cacheTime[idx] = TimeCurrent();

   double risk = 0.0;

   // --- Distance from H4 EMA50 in H4 ATR units ---
   {
      int hE = iMA(_Symbol, PERIOD_H4, 50, 0, MODE_EMA, PRICE_CLOSE);
      int hA = iATR(_Symbol, PERIOD_H4, 14);
      if(hE != INVALID_HANDLE && hA != INVALID_HANDLE)
      {
         double ema[2], atr[2], cls[2];
         bool ok = (CopyBuffer(hE,0,0,2,ema)>0 &&
                    CopyBuffer(hA,0,0,2,atr)>0 &&
                    CopyClose(_Symbol,PERIOD_H4,0,2,cls)>0);
         if(ok && atr[1] > 0)
         {
            // relevantDist > 0 means price extended IN the trade direction
            double relDist = (signal == 1)
                              ? (cls[1] - ema[1]) / atr[1]
                              : (ema[1] - cls[1]) / atr[1];
            if(relDist >= InpSTI_LateEntryMaxEMADist)
               risk += 35.0;
            else if(relDist >= InpSTI_LateEntryMaxEMADist * 0.65)
               risk += 16.0;
         }
      }
      if(hE != INVALID_HANDLE) IndicatorRelease(hE);
      if(hA != INVALID_HANDLE) IndicatorRelease(hA);
   }

   // --- Recent M5 consecutive bars without a counter-bar (no pullback seen) ---
   {
      int runBars = 0;
      for(int i = 1; i <= 16; i++)
      {
         double c = iClose(_Symbol, PERIOD_M5, i);
         double o = iOpen(_Symbol,  PERIOD_M5, i);
         bool withTrend = (signal == 1) ? (c > o) : (c < o);
         if(withTrend) runBars++;
         else break;
      }
      // Each bar ≈ 0.65 ATR on average; flag if run > threshold
      double runEstATR = (double)runBars * 0.65;
      if(runEstATR >= InpSTI_LateEntryMaxMoveATR)
         risk += 30.0;
      else if(runEstATR >= InpSTI_LateEntryMaxMoveATR * 0.60)
         risk += 14.0;
   }

   // --- H1 RSI overbought / oversold (mean-reversion risk) ---
   {
      int hR = iRSI(_Symbol, PERIOD_H1, 14, PRICE_CLOSE);
      if(hR != INVALID_HANDLE)
      {
         double rsi[2];
         if(CopyBuffer(hR, 0, 0, 2, rsi) > 0)
         {
            if(signal == 1)
            {
               if(rsi[1] > 74.0) risk += 22.0;
               else if(rsi[1] > 65.0) risk += 10.0;
            }
            else
            {
               if(rsi[1] < 26.0) risk += 22.0;
               else if(rsi[1] < 35.0) risk += 10.0;
            }
         }
         IndicatorRelease(hR);
      }
   }

   // --- Recent price run over 12 M5 bars ---
   if(m5atr > 0)
   {
      double oldC = iClose(_Symbol, PERIOD_M5, 13);
      double newC = iClose(_Symbol, PERIOD_M5, 1);
      if(oldC > 0)
      {
         double moveATR = MathAbs(newC - oldC) / m5atr;
         bool inDir = (signal == 1) ? (newC > oldC) : (newC < oldC);
         if(inDir && moveATR > InpSTI_LateEntryMaxMoveATR * 0.70)
            risk += 13.0;
      }
   }

   cacheVal[idx] = MathMin(risk, 100.0);
   return cacheVal[idx];
}

// Called every new M5 bar to refresh macro direction + pullback tracking.
// Cheap: macro direction is the only state requiring recalculation every bar.
void STI_Update()
{
   if(!InpSTI_Enable) return;
   datetime barOpens[1];
   if(CopyTime(_Symbol, PERIOD_M5, 0, 1, barOpens) <= 0) return;
   int curBarInt = (int)((long)barOpens[0] / 300);
   if(curBarInt == g_sti.lastCalcBar) return;
   g_sti.lastCalcBar = curBarInt;

   // D1×3 + H4×2 + H1×1 weighted vote for macro direction
   string w;
   int d1 = TFDirectionByEMA(1, PERIOD_D1, 0.18, w);
   int h4 = TFDirectionByEMA(1, PERIOD_H4, 0.20, w);
   int h1 = TFDirectionByEMA(1, PERIOD_H1, 0.22, w);
   int vote = d1*3 + h4*2 + h1*1;
   if(vote >= 3)
      { g_sti.macroDir = 1;  g_sti.macroStrength = MathMin(1.0, vote/6.0); }
   else if(vote <= -3)
      { g_sti.macroDir = -1; g_sti.macroStrength = MathMin(1.0,-vote/6.0); }
   else
      { g_sti.macroDir = 0;  g_sti.macroStrength = 0.0; }

   // Pullback-after-TP: once wait time passed, check if price pulled back enough
   if(InpSTI_BlockLateReentry && g_sti.lastProfitDir != 0 && !g_sti.pullbackReady)
   {
      int elapsed = (int)(TimeCurrent() - g_sti.lastProfitClose);
      bool windowExpired = (elapsed > InpSTI_ReentryMaxWindowMin * 60);
      if(windowExpired)
      {
         // Window expired — clear memory so the gate does not block indefinitely
         g_sti.lastProfitDir = 0;
         g_sti.pullbackReady = false;
      }
      else if(elapsed >= InpSTI_ReentryMinWaitMin * 60)
      {
         double m5atr = (ArraySize(bufATR) >= 2) ? bufATR[1] : 0.0;
         if(m5atr > 0)
         {
            double curPx = (g_sti.lastProfitDir == 1)
                           ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                           : SymbolInfoDouble(_Symbol, SYMBOL_BID);
            double thr = InpSTI_ReentryPullbackATR * m5atr;
            bool pulled = (g_sti.lastProfitDir == 1)
                          ? (curPx <= g_sti.lastProfitPrice - thr)
                          : (curPx >= g_sti.lastProfitPrice + thr);
            if(pulled)
            {
               g_sti.pullbackReady = true;
               if(InpSTI_Log)
                  PrintFormat("STI_PULLBACK_READY | dir=%s lastTP=%.2f cur=%.2f pull=%.2f ATR waited=%dmin | re-entry window unlocked",
                              g_sti.lastProfitDir==1?"BUY":"SELL",
                              g_sti.lastProfitPrice, curPx,
                              MathAbs(curPx-g_sti.lastProfitPrice)/m5atr,
                              elapsed/60);
            }
         }
      }
   }
}

// Called after every profitable full close to arm the re-entry intelligence.
void STI_AfterProfitableClose(int dir, double closePrice)
{
   if(!InpSTI_Enable || !InpSTI_BlockLateReentry) return;
   g_sti.lastProfitClose = TimeCurrent();
   g_sti.lastProfitDir   = dir;
   g_sti.lastProfitPrice = closePrice;
   g_sti.pullbackReady   = false;
   if(InpSTI_Log)
      PrintFormat("STI_TP_MEMORY | dir=%s closePrice=%.2f | armed: waiting %d min then %.2f ATR pullback required before same-dir re-entry",
                  dir==1?"BUY":"SELL", closePrice,
                  InpSTI_ReentryMinWaitMin, InpSTI_ReentryPullbackATR);
}

int FindPeakIdx(ulong ticket)
{
   for(int i = 0; i < ArraySize(peakTickets); i++)
      if(peakTickets[i] == ticket) return i;
   return -1;
}
double UpdatePeakProfit(ulong ticket, double profit)
{
   int idx = FindPeakIdx(ticket);
   if(idx < 0)
   {
      int n = ArraySize(peakTickets);
      ArrayResize(peakTickets, n+1);
      ArrayResize(peakProfits, n+1);
      peakTickets[n] = ticket;
      peakProfits[n] = profit;
      return profit;
   }
   if(profit > peakProfits[idx]) peakProfits[idx] = profit;
   return peakProfits[idx];
}
void ClearPeakProfit(ulong ticket)
{
   int idx = FindPeakIdx(ticket);
   if(idx < 0) return;
   int n = ArraySize(peakTickets) - 1;
   for(int i = idx; i < n; i++)
   {
      peakTickets[i] = peakTickets[i+1];
      peakProfits[i] = peakProfits[i+1];
   }
   ArrayResize(peakTickets, n);
   ArrayResize(peakProfits, n);
}

// v4.5.4 — Partial-TP tracker helpers
bool PartialAlreadyTaken(ulong ticket)
{
   for(int i = 0; i < ArraySize(partialTakenTickets); i++)
      if(partialTakenTickets[i] == ticket) return true;
   return false;
}
void MarkPartialTaken(ulong ticket)
{
   if(PartialAlreadyTaken(ticket)) return;
   int n = ArraySize(partialTakenTickets);
   ArrayResize(partialTakenTickets, n+1);
   partialTakenTickets[n] = ticket;
}
void ClearPartialTaken(ulong ticket)
{
   int idx = -1;
   for(int i = 0; i < ArraySize(partialTakenTickets); i++)
      if(partialTakenTickets[i] == ticket) { idx = i; break; }
   if(idx < 0) return;
   int n = ArraySize(partialTakenTickets) - 1;
   for(int i = idx; i < n; i++)
      partialTakenTickets[i] = partialTakenTickets[i+1];
   ArrayResize(partialTakenTickets, n);
}

// v5.8.52 — A+ Profit Shield per-ticket tracker
ulong g_aplusShieldArmedTickets[];
bool APlusShieldArmed(ulong ticket) { for(int i=0;i<ArraySize(g_aplusShieldArmedTickets);i++) if(g_aplusShieldArmedTickets[i]==ticket) return true; return false; }
void APlusMarkShieldArmed(ulong ticket) { if(APlusShieldArmed(ticket)) return; int n=ArraySize(g_aplusShieldArmedTickets); ArrayResize(g_aplusShieldArmedTickets,n+1); g_aplusShieldArmedTickets[n]=ticket; }
void APlusClearShield(ulong ticket) { int idx=-1; for(int i=0;i<ArraySize(g_aplusShieldArmedTickets);i++) if(g_aplusShieldArmedTickets[i]==ticket){idx=i;break;} if(idx<0) return; int n=ArraySize(g_aplusShieldArmedTickets)-1; for(int i=idx;i<n;i++) g_aplusShieldArmedTickets[i]=g_aplusShieldArmedTickets[i+1]; ArrayResize(g_aplusShieldArmedTickets,n); }

// v4.7.0 — Per-ticket AI-veto cooldown helpers
bool AIVetoCooldownOK(ulong ticket, int minSec)
{
   for(int i = 0; i < ArraySize(aiVetoTickets); i++)
      if(aiVetoTickets[i] == ticket)
         return (TimeCurrent() - aiVetoLastCall[i] >= minSec);
   return true; // no record = OK
}
void RecordAIVetoCall(ulong ticket)
{
   for(int i = 0; i < ArraySize(aiVetoTickets); i++)
      if(aiVetoTickets[i] == ticket)
      {
         aiVetoLastCall[i] = TimeCurrent();
         return;
      }
   int n = ArraySize(aiVetoTickets);
   ArrayResize(aiVetoTickets, n+1);
   ArrayResize(aiVetoLastCall, n+1);
   aiVetoTickets[n] = ticket;
   aiVetoLastCall[n] = TimeCurrent();
}
void ClearAIVeto(ulong ticket)
{
   int idx = -1;
   for(int i = 0; i < ArraySize(aiVetoTickets); i++)
      if(aiVetoTickets[i] == ticket) { idx = i; break; }
   if(idx < 0) return;
   int n = ArraySize(aiVetoTickets) - 1;
   for(int i = idx; i < n; i++)
   {
      aiVetoTickets[i]  = aiVetoTickets[i+1];
      aiVetoLastCall[i] = aiVetoLastCall[i+1];
   }
   ArrayResize(aiVetoTickets, n);
   ArrayResize(aiVetoLastCall, n);
}

// v4.7.3 — TP extension tracker helpers
int GetTPExtendCount(ulong ticket)
{
   for(int i = 0; i < ArraySize(tpExtendTickets); i++)
      if(tpExtendTickets[i] == ticket) return tpExtendCount[i];
   return 0;
}
void IncTPExtendCount(ulong ticket)
{
   for(int i = 0; i < ArraySize(tpExtendTickets); i++)
      if(tpExtendTickets[i] == ticket) { tpExtendCount[i]++; return; }
   int n = ArraySize(tpExtendTickets);
   ArrayResize(tpExtendTickets, n+1);
   ArrayResize(tpExtendCount, n+1);
   tpExtendTickets[n] = ticket;
   tpExtendCount[n] = 1;
}
void ClearTPExtend(ulong ticket)
{
   int idx = -1;
   for(int i = 0; i < ArraySize(tpExtendTickets); i++)
      if(tpExtendTickets[i] == ticket) { idx = i; break; }
   if(idx < 0) return;
   int n = ArraySize(tpExtendTickets) - 1;
   for(int i = idx; i < n; i++)
   {
      tpExtendTickets[i] = tpExtendTickets[i+1];
      tpExtendCount[i]   = tpExtendCount[i+1];
   }
   ArrayResize(tpExtendTickets, n);
   ArrayResize(tpExtendCount, n);
}

// v4.7.0 — AI exit verdict struct (used by CheckPositionWithAI later in file)
//   action: 0=HOLD, -1=CLOSE, 1=LOCK
//   lockUSD: $ amount AI wants SL to bank (only if action=1)
//   reason:  short text explanation (for log)
struct AIExitVerdict
{
   int    action;
   double lockUSD;
   string reason;
   int    confidence;
};

// v4.7.0 — AI veto wrapper. Called BEFORE every rule-based close.
// Returns TRUE if the close was blocked (AI said HOLD, or AI said LOCK $X and SL was banked).
// Returns FALSE if AI confirmed CLOSE (or AI was not consulted) — caller proceeds with close.
// Cost-aware: only calls AI if profit/peak >= InpAIExitMinProfit and cooldown is satisfied.
bool AIBlocksClose(string ruleName, ulong ticket, bool isBuy, double openPx, double curPrice,
                    double profit, double peak, double rDollars, double slDist, double curSL, double curTP,
                    int digits, double rsi, double emaF, double emaS, double atr, int minsOpen, double lots)
{
   if(!InpAIExitOverride) return false;
   if(InpAIAdvisoryOnly)  return false;
   if(InpBacktestMode)    return false;
   if(StringLen(InpServerURL) < 10) return false;
   // Cost gate: only spend an AI call if there's meaningful profit at stake
   if(MathMax(profit, peak) < InpAIExitMinProfit) return false;
   if(!AIVetoCooldownOK(ticket, InpAIExitMinSec)) return false;

   AIExitVerdict v = CheckPositionWithAI(
      isBuy ? "BUY" : "SELL", openPx, curPrice, profit, lots,
      rsi, emaF, emaS, atr, minsOpen, curSL, curTP, peak, ruleName, RegimeName());
   RecordAIVetoCall(ticket);

   if(v.action == 0)
   {
      Print("AI VETO #", ticket, " (", ruleName, "): HOLD — ", v.reason);
      return true;
   }
   if(v.action == 1 && v.lockUSD > 0 && rDollars > 0)
   {
      double lockDist = (v.lockUSD / rDollars) * slDist;
      double newSL = isBuy ? NormalizeDouble(openPx + lockDist, digits)
                            : NormalizeDouble(openPx - lockDist, digits);
      double pp = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
      long   slLvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
      double bufPts = MathMax(slLvl * pp, pp * 30);
      bool sane    = isBuy ? (newSL > openPx && newSL < curPrice - bufPts)
                           : (newSL < openPx && newSL > curPrice + bufPts);
      bool ratchet = isBuy ? (newSL > curSL) : (newSL < curSL || curSL == 0);
      if(sane && ratchet)
      {
         if(SafeModifySL(ticket, newSL, curTP, isBuy, curPrice, "AI_LOCK"))
            Print("AI LOCK #", ticket, " (", ruleName, ") — locked +$", DoubleToString(v.lockUSD,2),
                  " at ", DoubleToString(newSL, digits), ". ", v.reason);
      }
      return true; // AI processed (either banked or sanity-rejected); skip the close
   }
   // v.action == -1 → AI confirmed CLOSE → caller proceeds
   Print("AI CONFIRM #", ticket, " (", ruleName, "): CLOSE — ", v.reason);
   return false;
}

//+------------------------------------------------------------------+
//| v4.5.6 — SAFE POSITION MODIFY (freeze/stops aware)               |
//| Broker brokers reject PositionModify when:                       |
//|   • Price within SYMBOL_TRADE_FREEZE_LEVEL of SL/TP               |
//|   • SL/TP closer to price than SYMBOL_TRADE_STOPS_LEVEL           |
//| This helper:                                                     |
//|   1. Clamps the new SL to the minimum allowed distance            |
//|   2. Skips the modify (and warns ONCE) if price is frozen          |
//|   3. Logs any non-success retcode so we see silent failures        |
//| Returns TRUE if broker accepted the modify.                      |
//+------------------------------------------------------------------+
bool SafeModifySL(ulong ticket, double newSL, double tp, bool isBuy, double curPrice, string logTag)
{
   double point = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   long   stopsLvl  = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
   long   freezeLvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_FREEZE_LEVEL);
   double minStopsDist  = stopsLvl  * point;
   double minFreezeDist = freezeLvl * point;

   // Clamp SL to at least stops_level away from current price
   if(isBuy)
   {
      // BUY: SL must be <= curPrice - minStopsDist
      double maxAllowedSL = curPrice - minStopsDist;
      if(minStopsDist > 0 && newSL > maxAllowedSL) newSL = NormalizeDouble(maxAllowedSL, digits);
   }
   else
   {
      // SELL: SL must be >= curPrice + minStopsDist
      double minAllowedSL = curPrice + minStopsDist;
      if(minStopsDist > 0 && newSL < minAllowedSL) newSL = NormalizeDouble(minAllowedSL, digits);
   }

   // v4.6.5 — NO-OP GUARD: don't modify if SL is already at/very near target.
   //   Prevents "SL-MOD FAIL Ret=10025" (NO_CHANGES) spam when ladder/trail
   //   recomputes the same level tick after tick.
   if(PositionSelectByTicket(ticket))
   {
      double curSL = PositionGetDouble(POSITION_SL);
      double curTP = PositionGetDouble(POSITION_TP);
      double tol   = MathMax(point * 2, 0.00001);  // 2-pt tolerance
      if(MathAbs(curSL - newSL) < tol && MathAbs(curTP - tp) < tol)
         return true;  // already where we want it — silent success
   }

   // Freeze level check — skip modify (but don't error) if price is within freeze band
   if(minFreezeDist > 0)
   {
      double distToSL = isBuy ? MathAbs(curPrice - newSL) : MathAbs(newSL - curPrice);
      if(distToSL < minFreezeDist)
      {
         static datetime lastFreezeWarn = 0;
         if(TimeCurrent() - lastFreezeWarn > 60)
         {
            Print("SL-MOD SKIP #", ticket, " (", logTag, ") — price within freeze level (",
                  DoubleToString(distToSL/point, 0), " pts < ", freezeLvl, " pts). Retry next tick.");
            lastFreezeWarn = TimeCurrent();
         }
         return false;
      }
   }

   // v5.8.51: throttle non-emergency trailing SL modifications to 1 per second.
   // On live ECN/raw-spread brokers each PositionModify roundtrip takes 200-6000ms.
   // A cascade of 3 sequential trailing mods can hold the thread for 15-30s and
   // miss urgent SL updates during fast XAU moves. Emergency tags bypass the gate.
   {
      bool isEmergencyMod = (StringFind(logTag, "EPF")       >= 0 ||
                             StringFind(logTag, "CLOSE")      >= 0 ||
                             StringFind(logTag, "EMERGENCY")  >= 0 ||
                             StringFind(logTag, "AI_LOCK")    >= 0);
      if(!isEmergencyMod)
      {
         static datetime g_slThrottleSec = 0;
         static int      g_slModsThisSec = 0;
         datetime nowSec = TimeCurrent();
         if(nowSec != g_slThrottleSec) { g_slThrottleSec = nowSec; g_slModsThisSec = 0; }
         if(g_slModsThisSec >= 3)
         {
            static datetime g_slThrottleLog = 0;
            if(TimeCurrent() - g_slThrottleLog >= 60)
            {
               Print("SL-MOD DEFERRED #", ticket, " (", logTag,
                     ") — 3 trailing mods/sec live-execution limit. Will retry next tick.");
               g_slThrottleLog = TimeCurrent();
            }
            return false;
         }
         g_slModsThisSec++;
      }
   }

   // Execute modify — log any failure so they're no longer silent
   if(!trade.PositionModify(ticket, newSL, tp))
   {
      uint ret = trade.ResultRetcode();
      int  err = GetLastError();
      // v5.8.51: context-busy retry — broker context sometimes holds after a prior
      // request completes. A 150ms yield often clears it without wasting a full tick.
      if(err == 4756 || ret == 10016)
      {
         Sleep(150);
         ResetLastError();
         if(trade.PositionModify(ticket, newSL, tp)) return true;
         ret = trade.ResultRetcode();
         err = GetLastError();
      }
      // v4.6.5 — Downgrade common non-fatal retcodes to throttled INFO (1/min).
      //   10025 NO_CHANGES, 10004 REQUOTE, 10021 OFF_QUOTES, 4756 invalid stops
      //   are transient/benign — the next tick will retry. Don't spam the log.
      bool benign = (ret == 10025 || ret == 10004 || ret == 10021 || err == 4756 || err == 10025);
      if(benign)
      {
         static datetime lastBenignWarn = 0;
         if(TimeCurrent() - lastBenignWarn > 60)
         {
            Print("SL-MOD INFO #", ticket, " (", logTag, ") transient ret=", ret,
                  " err=", err, " — will retry next tick.");
            lastBenignWarn = TimeCurrent();
         }
      }
      else
      {
         Print("SL-MOD FAIL #", ticket, " (", logTag, ") Ret=", ret,
               " Err=", err, " newSL=", DoubleToString(newSL, digits));
      }
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| AUTO-SCALE: derive dollar thresholds from current account size   |
//+------------------------------------------------------------------+
double StrategyReferenceBalance()
{
   if(g_propFirmMode)
   {
      if(g_propFirmConfiguredBalance > 0.0) return g_propFirmConfiguredBalance;
      if(g_propFirmStartingBalance > 0.0) return g_propFirmStartingBalance;
   }
   double bal = accInfo.Balance();
   if(bal <= 0.0) bal = accInfo.Equity();
   return bal;
}

void RecomputeAutoScale()
{
   if(!InpAutoScale)
   {
      autoHardStopUSD   = InpHardStopUSD;
      autoProfitTakeMin = InpProfitTakeMin;
      autoProfitTakeMax = InpProfitTakeMax;
      autoPeakMinUSD    = InpPeakMinUSD;
      return;
   }
   double bal = StrategyReferenceBalance();
   if(bal <= 0) bal = 100;                  // fallback if account query fails

   // TRUE proportional scaling — works on $10 or $100k equally.
   // Then clamp with absolute floor/ceiling so micro accounts still get viable targets
   // and mega-accounts don't chase unreachable daily jackpots.
   autoHardStopUSD   = NormalizeDouble(bal * (InpAutoRiskPct    / 100.0), 2);
   autoProfitTakeMin = NormalizeDouble(bal * (InpAutoProfMinPct / 100.0), 2);
   autoProfitTakeMax = NormalizeDouble(bal * (InpAutoProfMaxPct / 100.0), 2);
   autoPeakMinUSD    = NormalizeDouble(bal * (InpAutoPeakMinPct / 100.0), 2);

   // Absolute bounds on profit targets (v4.4.4)
   //   ProfitMin floor: $25  → micro accounts still have a scan trigger
   //   ProfitMax floor: $50  → micro accounts still have a cap target
   //   ProfitMax ceiling: $5000 → large accounts don't chase unreachable numbers
   if(autoProfitTakeMin < InpProfMinFloorUSD) autoProfitTakeMin = InpProfMinFloorUSD;
   if(autoProfitTakeMax < InpProfMaxFloorUSD) autoProfitTakeMax = InpProfMaxFloorUSD;
   if(autoProfitTakeMax > InpProfMaxCeilUSD)  autoProfitTakeMax = InpProfMaxCeilUSD;
   // Sanity: ProfitMax must always exceed ProfitMin
   if(autoProfitTakeMax < autoProfitTakeMin * 1.5)
      autoProfitTakeMax = autoProfitTakeMin * 1.5;

   // Viability warning for micro accounts — XAU M5 scalping has structural minimums
   // due to broker minimum lot size (0.01) and typical XAU tick values
   if(bal < 100.0)
   {
      Print("=========================================================");
      Print("⚠ SMALL ACCOUNT WARNING: Balance $", DoubleToString(bal,2),
            " is below $100 viability threshold for XAU M5 scalping.");
      Print("  Broker minimum lot (0.01) on XAU = $1 per $1 price move.");
      Print("  Typical SL distance ($5-8) can produce -$5 to -$8 losses per trade,");
      Print("  which is ", DoubleToString(5.0/bal*100, 1), "-", DoubleToString(8.0/bal*100, 1),
            "% of your balance — too high for sustainable compounding.");
      Print("  Recommended minimum: $200-500 to survive normal drawdown swings.");
      Print("=========================================================");
   }
}

// Getters that return either auto-scaled or user-input value
double EffHardStopUSD()    { return InpAutoScale ? autoHardStopUSD   : InpHardStopUSD; }
double EffProfitTakeMin()  { return InpAutoScale ? autoProfitTakeMin : InpProfitTakeMin; }
double EffProfitTakeMax()  { return InpAutoScale ? autoProfitTakeMax : InpProfitTakeMax; }
double EffPeakMinUSD()     { return InpAutoScale ? autoPeakMinUSD    : InpPeakMinUSD; }

//+------------------------------------------------------------------+
//| VOLATILITY-ADAPTIVE LOT MULTIPLIER                               |
//| Compares current ATR vs rolling-median ATR (50 M5 bars).         |
//| Returns multiplier: <1 in vol spikes, >1 in calm regimes.        |
//+------------------------------------------------------------------+
double GetVolAdaptiveMult()
{
   if(!InpVolAdaptiveLots) return 1.0;
   if(ArraySize(bufATR) < 2) return 1.0;
   double cur = bufATR[1];
   if(cur <= 0) return 1.0;

   // v5.9.1: cache per closed M5 bar — all consumers get last-bar data anyway,
   // so there is no benefit to recomputing the 50-bar sort on every tick.
   static datetime cachedClosedBar = 0;
   static double   cachedMult      = 1.0;
   datetime closedBar = iTime(Symbol(), PERIOD_M5, 1);
   if(closedBar > 0 && cachedClosedBar == closedBar)
      return cachedMult;

   // Pull last 50 ATR values, compute median via O(n log n) ArraySort
   double samples[50];
   int got = CopyBuffer(hATR, 0, 1, 50, samples);
   if(got < 20) return 1.0;
   ArraySort(samples);
   double median = samples[got / 2];
   if(median <= 0) return 1.0;

   double ratio = cur / median;
   double mult = 1.0;
   if(ratio >= InpVolSpikeMulti)     mult = InpVolSpikeReduce;
   else if(ratio <= InpVolCalmMulti) mult = InpVolCalmBoost;

   if(closedBar > 0)
   {
      cachedClosedBar = closedBar;
      cachedMult      = mult;
   }
   return mult;
}

//+------------------------------------------------------------------+
//| v4.5.2 — TREND-AWARE TRAIL DISTANCE                              |
//| Returns the ATR multiplier to use for trailing SL given:         |
//|   • Current regime (trending vs ranging vs breakout vs low-vol)  |
//|   • EMA separation (strong trend = bigger stretch)               |
//|   • Volatility spike/calm (existing v4.5.1 logic)                |
//| v4.5.3 CONVICTION RUNNER — if the trade was entered at           |
//|   ≥ InpConvRunMinConf% AI confidence AND is already              |
//|   ≥ InpConvRunMinR in profit, widen to InpConvRunnerMulti × ATR. |
//|   These are the trades where both AIs said "textbook setup" AND  |
//|   the market has already validated it — ride them for max gain.  |
//+------------------------------------------------------------------+
double GetTrailATRMulti(double profitRRatio = 0.0)
{
   // Fallback: respect v4.5.1 defaults if trend-aware trail disabled
   if(!InpTrendAwareTrail)
   {
      double volMult = GetVolAdaptiveMult();
      double baseF = InpCapTrailATRMulti;
      if(volMult < 0.85)      baseF = InpCapTrailSpikeMulti;
      else if(volMult > 1.05) baseF = InpCapTrailCalmMulti;
      // Conviction runner overlay even when trend-aware is off
      if(InpConvictionRunner && currentTradeConfidence >= InpConvRunMinConf &&
         profitRRatio >= InpConvRunMinR)
         return MathMax(baseF, InpConvRunnerMulti);
      return baseF;
   }

   double base;
   // Regime-based base trail
   switch(currentRegime)
   {
      case REGIME_BREAKOUT_UP:
      case REGIME_BREAKOUT_DOWN:
         base = InpStrongTrendTrail;       // breakouts extend, need widest room
         break;
      case REGIME_TRENDING_UP:
      case REGIME_TRENDING_DOWN:
      {
         // Strong EMA separation = strong trend = give more room
         double emaSep = 0;
         if(ArraySize(bufEMAFast) >= 2 && ArraySize(bufEMASlow) >= 2 && bufEMASlow[1] > 0)
            emaSep = MathAbs(bufEMAFast[1] - bufEMASlow[1]) / bufEMASlow[1] * 10000; // basis points
         base = (emaSep > 30) ? InpStrongTrendTrail : InpTrendTrailMulti;
         break;
      }
      case REGIME_RANGING:
         base = InpCapTrailATRMulti;       // normal ranges = default 1.5x
         break;
      case REGIME_CHOPPY:
         base = InpChoppyTrailMulti;       // choppy = tighter (fewer real follow-throughs)
         break;
      case REGIME_LOW_VOL:
         base = InpLowVolTrailMulti;       // low-vol ranges = tightest
         break;
      default:
         base = InpCapTrailATRMulti;
   }

   // Volatility overlay — still respects spike/calm (survival over aesthetics)
   double volM = GetVolAdaptiveMult();
   if(volM < 0.85)  base = MathMax(base, InpCapTrailSpikeMulti);   // spike → widen if not already
   else if(volM > 1.05) base = MathMin(base, MathMax(InpCapTrailCalmMulti, 1.0));  // calm → tighten (but not absurdly)

   // v5.9.0 RSI MOMENTUM FACTOR: when RSI is strongly directional (not extreme/overbought),
   // widen the trail slightly so the position breathes through genuine momentum impulses
   // rather than getting stopped by normal pullbacks during a real trend continuation.
   if(ArraySize(bufRSI) >= 2 && bufRSI[1] > 0)
   {
      double rsiNow = bufRSI[1];
      bool strongBullRSI = (rsiNow >= 68.0 && rsiNow < 80.0);
      bool strongBearRSI = (rsiNow <= 32.0 && rsiNow > 20.0);
      if(strongBullRSI || strongBearRSI)
         base = MathMin(base * 1.15, base + 0.50);
   }

   // v4.5.3 — CONVICTION RUNNER OVERLAY: if the AI was ≥90% confident AND the trade
   // is already ≥+2R in profit, upgrade to the monster-runner trail. This is the
   // "textbook setup validated by market" case — let it run for max profit.
   if(InpConvictionRunner && currentTradeConfidence >= InpConvRunMinConf &&
      profitRRatio >= InpConvRunMinR)
   {
      double convTrail = InpConvRunnerMulti;
      if(convTrail > base)
      {
         // Log the upgrade once per bar so we see it firing
         static datetime lastConvLog = 0;
         if(TimeCurrent() - lastConvLog > 60)
         {
            Print("CONVICTION RUNNER: ", currentTradeConfidence, "% conf + ",
                  DoubleToString(profitRRatio,2), "R profit → trail upgrade ",
                  DoubleToString(base,2), "x → ", DoubleToString(convTrail,2), "xATR");
            lastConvLog = TimeCurrent();
         }
         base = convTrail;
      }
   }

   return base;
}

//+------------------------------------------------------------------+
//| PIN VALIDATION                                                   |
//+------------------------------------------------------------------+
bool ValidatePIN(string pin)
{
   if(StringLen(pin) != 13) return false;
   if(StringSubstr(pin, 0, 3) != "ASE") return false;
   if(StringGetCharacter(pin, 3) != '-' || StringGetCharacter(pin, 8) != '-') return false;
   for(int i = 4; i < 13; i++)
   {
      if(i == 8) continue;
      ushort ch = StringGetCharacter(pin, i);
      if(!((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z'))) return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| CONTEXT GATE (v4.8.0) — HTF bias + Swing S/R proximity filter    |
//| Blocks entries that fight H4 trend OR sit near a recent swing    |
//| level without a break+retest. Rule-based, zero LLM cost.         |
//+------------------------------------------------------------------+
bool ContextGateAllows(int signal, double atr)
{
   // === Gate 1: HTF bias alignment (default M30, was H4 — see InpContextTF) ===
   // v5.1.8: respect admin Bot Mode override (Aggressive disables this entirely)
   if(GetEffectiveUseHTFBias())
   {
      // v5.9.0: cache HTF EMA handles in static locals. Previously created and released
      // on every call, which adds significant overhead per tick during active scanning.
      // Handles are rebuilt only when the effective context TF changes (rare — admin mode flip).
      ENUM_TIMEFRAMES ctxTF = GetEffectiveContextTF();
      static int      hF_ctx    = INVALID_HANDLE;
      static int      hS_ctx    = INVALID_HANDLE;
      static ENUM_TIMEFRAMES lastCtxTF = PERIOD_CURRENT;
      if(hF_ctx == INVALID_HANDLE || hS_ctx == INVALID_HANDLE || ctxTF != lastCtxTF)
      {
         if(hF_ctx != INVALID_HANDLE) IndicatorRelease(hF_ctx);
         if(hS_ctx != INVALID_HANDLE) IndicatorRelease(hS_ctx);
         hF_ctx   = iMA(Symbol(), ctxTF, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
         hS_ctx   = iMA(Symbol(), ctxTF, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
         lastCtxTF = ctxTF;
      }
      double h4F = 0, h4S = 0;
      if(hF_ctx != INVALID_HANDLE && hS_ctx != INVALID_HANDLE)
      {
         double bufF[3], bufS[3];
         if(CopyBuffer(hF_ctx, 0, 0, 3, bufF) >= 2 && CopyBuffer(hS_ctx, 0, 0, 3, bufS) >= 2)
         {
            h4F = bufF[1]; h4S = bufS[1];
         }
      }
      if(h4F > 0 && h4S > 0)
      {
         bool h4Up   = (h4F > h4S);
         bool h4Down = (h4F < h4S);
         double spread = MathAbs(h4F - h4S) / h4S * 100;
         if(spread >= InpH4NeutralPct)
         {
            string tfName = EnumToString(ctxTF);
            if(signal == 1 && !h4Up)
            {
               PrintFormat("⛔ CONTEXT-GATE: BUY blocked — %s EMA50 < EMA200 (bearish HTF bias) [mode=%s]. Don't fight the trend.", tfName, g_modeName);
               return false;
            }
            if(signal == -1 && !h4Down)
            {
               PrintFormat("⛔ CONTEXT-GATE: SELL blocked — %s EMA50 > EMA200 (bullish HTF bias) [mode=%s]. Don't fight the trend.", tfName, g_modeName);
               return false;
            }
         }
      }
   }

   // === Gate 2: Swing S/R proximity ===
   if(InpUseSRFilter && InpSRLookback >= 20 && atr > 0)
   {
      double curPrice = (signal == 1) ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
                                       : SymbolInfoDouble(Symbol(), SYMBOL_BID);
      double proxDist = atr * InpSRProximityATR;

      // Find recent swing high and swing low on M5 (last InpSRLookback bars)
      // Swing = bar whose high/low is highest/lowest within ±3 bars window.
      double swingHigh = 0;
      double swingLow  = 999999;
      for(int i = 3; i < InpSRLookback - 3; i++)
      {
         double h = iHigh(Symbol(), PERIOD_M5, i);
         double l = iLow(Symbol(),  PERIOD_M5, i);
         bool isSwingHigh = true;
         bool isSwingLow  = true;
         for(int j = 1; j <= 3; j++)
         {
            if(iHigh(Symbol(), PERIOD_M5, i-j) >= h || iHigh(Symbol(), PERIOD_M5, i+j) >= h) isSwingHigh = false;
            if(iLow(Symbol(),  PERIOD_M5, i-j) <= l || iLow(Symbol(),  PERIOD_M5, i+j) <= l)  isSwingLow  = false;
            if(!isSwingHigh && !isSwingLow) break;
         }
         if(isSwingHigh && h > swingHigh) swingHigh = h;
         if(isSwingLow  && l < swingLow)  swingLow  = l;
      }

      // BUY trying to enter within proxDist BELOW a swing high = entering into resistance — block
      if(signal == 1 && swingHigh > 0 && (swingHigh - curPrice) > 0 && (swingHigh - curPrice) < proxDist)
      {
         Print("⛔ CONTEXT-GATE: BUY blocked — price ", DoubleToString(curPrice, 2),
               " is ", DoubleToString(swingHigh - curPrice, 2),
               " below swing high ", DoubleToString(swingHigh, 2),
               " (< ", DoubleToString(proxDist, 2), " = ", DoubleToString(InpSRProximityATR, 1),
               "×ATR). Entering into resistance without break-retest.");
         return false;
      }
      // v6.3.2 FIX: SELL near swing LOW is VALID for range-reversal/mean-reversion entries.
      // Old logic blocked SELL within proxDist ABOVE support — but that's exactly where a
      // RANGE_REVERSAL SELL triggers (fade the bounce from support back down).
      // Corrected: only block SELL if price is far BELOW a swing low (over-extended downside).
      // Block SELL if price is more than 2× ATR BELOW nearest swing low (over-extended, not near).
      if(signal == -1 && swingLow < 999999 && curPrice < swingLow && (swingLow - curPrice) > proxDist * 2.0)
      {
         Print("⛔ CONTEXT-GATE: SELL blocked — price ", DoubleToString(curPrice, 2),
               " is ", DoubleToString(swingLow - curPrice, 2),
               " below swing low ", DoubleToString(swingLow, 2),
               " — over-extended downside, not a good short entry.");
         return false;
      }
   }

   if(InpContextGateLog)
      Print("✅ CONTEXT-GATE PASS: ", signal==1?"BUY":"SELL",
            " cleared H4 bias + Swing-SR checks. Proceeding to OpenTrade.");
   return true;
}

string PropFirmBaselineKey()
{
   return StringFormat("XAUAI_PROP_BASE_%I64d_%d",
                       AccountInfoInteger(ACCOUNT_LOGIN), InpMagicNumber);
}

string PropFirmAccountEquityKey()
{
   return StringFormat("XAUAI_PROP_REAL_EQ_START_%I64d_%d",
                       AccountInfoInteger(ACCOUNT_LOGIN), InpMagicNumber);
}

string PropFirmConfigKey(string field)
{
   return StringFormat("XAUAI_PROP_CFG_%I64d_%s",
                       AccountInfoInteger(ACCOUNT_LOGIN), field);
}

void SavePropFirmConfig()
{
   GlobalVariableSet(PropFirmConfigKey("ON"), g_propFirmMode ? 1.0 : 0.0);
   GlobalVariableSet(PropFirmConfigKey("BAL"), g_propFirmConfiguredBalance);
   GlobalVariableSet(PropFirmConfigKey("DAY"), g_propFirmDailyLossPct);
   GlobalVariableSet(PropFirmConfigKey("MAX"), g_propFirmMaxLossPct);
   GlobalVariableSet(PropFirmConfigKey("BUF"), g_propFirmSafetyBufferPct);
   GlobalVariableSet(PropFirmConfigKey("RISK"), g_propFirmRiskPerTradePct);
   GlobalVariableSet(PropFirmConfigKey("BASK"), g_propFirmMaxBasketRiskPct);
   GlobalVariableSet(PropFirmConfigKey("ADD"), g_propFirmAllowOneRetestAdd ? 1.0 : 0.0);
   GlobalVariableSet(PropFirmConfigKey("ADDM"), g_propFirmRetestAddLotMulti);
}

void LoadPropFirmConfig()
{
   if(!GlobalVariableCheck(PropFirmConfigKey("ON")))
   {
      SavePropFirmConfig();
      return;
   }
   g_propFirmMode = GlobalVariableGet(PropFirmConfigKey("ON")) > 0.5;
   if(GlobalVariableCheck(PropFirmConfigKey("BAL")))
      g_propFirmConfiguredBalance = GlobalVariableGet(PropFirmConfigKey("BAL"));
   if(GlobalVariableCheck(PropFirmConfigKey("DAY")))
      g_propFirmDailyLossPct = GlobalVariableGet(PropFirmConfigKey("DAY"));
   if(GlobalVariableCheck(PropFirmConfigKey("MAX")))
      g_propFirmMaxLossPct = GlobalVariableGet(PropFirmConfigKey("MAX"));
   if(GlobalVariableCheck(PropFirmConfigKey("BUF")))
      g_propFirmSafetyBufferPct = GlobalVariableGet(PropFirmConfigKey("BUF"));
   if(GlobalVariableCheck(PropFirmConfigKey("RISK")))
      g_propFirmRiskPerTradePct = GlobalVariableGet(PropFirmConfigKey("RISK"));
   if(GlobalVariableCheck(PropFirmConfigKey("BASK")))
      g_propFirmMaxBasketRiskPct = GlobalVariableGet(PropFirmConfigKey("BASK"));
   if(GlobalVariableCheck(PropFirmConfigKey("ADD")))
      g_propFirmAllowOneRetestAdd = GlobalVariableGet(PropFirmConfigKey("ADD")) > 0.5;
   if(GlobalVariableCheck(PropFirmConfigKey("ADDM")))
      g_propFirmRetestAddLotMulti = GlobalVariableGet(PropFirmConfigKey("ADDM"));
}

string PropFirmDailyKey()
{
   MqlDateTime dt;
   TimeCurrent(dt);
   return StringFormat("XAUAI_PROP_DAY_%I64d_%04d%02d%02d",
                       AccountInfoInteger(ACCOUNT_LOGIN), dt.year, dt.mon, dt.day);
}

void ResetPropFirmDailyBaseline()
{
   if(!g_propFirmMode) return;
   g_propFirmDailyStartEquity = accInfo.Equity();
   GlobalVariableSet(PropFirmDailyKey(), g_propFirmDailyStartEquity);
   g_propFirmLockActive = false;
   Print("PROP FIRM MODE: new daily equity baseline $",
         DoubleToString(g_propFirmDailyStartEquity, 2));
}

void LoadPropFirmBaseline()
{
   if(!g_propFirmMode)
   {
      g_propFirmStartingBalance = 0.0;
      g_propFirmAccountStartEquity = 0.0;
      g_propFirmDailyStartEquity = 0.0;
      return;
   }

   string totalKey = PropFirmBaselineKey();
   if(g_propFirmConfiguredBalance > 0.0)
   {
      g_propFirmStartingBalance = g_propFirmConfiguredBalance;
      GlobalVariableSet(totalKey, g_propFirmStartingBalance);
   }
   else if(GlobalVariableCheck(totalKey))
      g_propFirmStartingBalance = GlobalVariableGet(totalKey);
   else
   {
      g_propFirmStartingBalance = accInfo.Balance();
      GlobalVariableSet(totalKey, g_propFirmStartingBalance);
   }

   string accountEquityKey = PropFirmAccountEquityKey();
   if(GlobalVariableCheck(accountEquityKey))
      g_propFirmAccountStartEquity = GlobalVariableGet(accountEquityKey);
   else
   {
      g_propFirmAccountStartEquity = accInfo.Equity();
      GlobalVariableSet(accountEquityKey, g_propFirmAccountStartEquity);
   }

   string dayKey = PropFirmDailyKey();
   if(GlobalVariableCheck(dayKey))
      g_propFirmDailyStartEquity = GlobalVariableGet(dayKey);
   else
   {
      g_propFirmDailyStartEquity = accInfo.Equity();
      GlobalVariableSet(dayKey, g_propFirmDailyStartEquity);
   }

   Print("=== PROP FIRM MODE ON === start=$",
         DoubleToString(g_propFirmStartingBalance, 2),
         " dailyStart=$", DoubleToString(g_propFirmDailyStartEquity, 2),
         " risk/trade=", DoubleToString(g_propFirmRiskPerTradePct, 2),
         "% basket=", DoubleToString(g_propFirmMaxBasketRiskPct, 2),
         "% daily=", DoubleToString(g_propFirmDailyLossPct, 2),
         "% total=", DoubleToString(g_propFirmMaxLossPct, 2),
         "% buffer=", DoubleToString(g_propFirmSafetyBufferPct, 2), "%");
   Print("PROP_MODE_ON",
         " | RealAccountBalance=", DoubleToString(accInfo.Balance(), 2),
         " | RealAccountStartEquity=", DoubleToString(g_propFirmAccountStartEquity, 2),
         " | PropReferenceBalance=", DoubleToString(StrategyReferenceBalance(), 2),
         " | LotCalculatedFrom=PROP_REFERENCE_BALANCE",
         " | ProfitTargetCalculatedFrom=PROP_REFERENCE_BALANCE",
         " | DrawdownLimitCalculatedFrom=PROP_REFERENCE_BALANCE",
         " | ExitTargetCalculatedFrom=PROP_REFERENCE_BALANCE",
         " | EmergencyBrokerProtection=REAL_EQUITY");
}

double EffectiveSingleRiskCapPct()
{
   double cap = InpMaxRiskPctEquity;
   if(g_propFirmMode && g_propFirmRiskPerTradePct > 0.0)
      cap = (cap > 0.0) ? MathMin(cap, g_propFirmRiskPerTradePct)
                        : g_propFirmRiskPerTradePct;
   return cap;
}

double EffectiveAggregateRiskCapPct()
{
   double cap = InpMaxAggregateRiskPct;
   if(g_propFirmMode && g_propFirmMaxBasketRiskPct > 0.0)
      cap = (cap > 0.0) ? MathMin(cap, g_propFirmMaxBasketRiskPct)
                        : g_propFirmMaxBasketRiskPct;
   return cap;
}

string PropFirmLossLockReason()
{
   if(!g_propFirmMode) return "";
   double equity = accInfo.Equity();
   double buffer = MathMax(0.0, g_propFirmSafetyBufferPct);
   double dailyLimit = MathMax(0.0, g_propFirmDailyLossPct);
   double totalLimit = MathMax(0.0, g_propFirmMaxLossPct);
   double dailyTrigger = MathMax(0.0, dailyLimit - buffer);
   double totalTrigger = MathMax(0.0, totalLimit - buffer);
   double propReference = StrategyReferenceBalance();

   if(g_propFirmDailyStartEquity > 0.0 && propReference > 0.0 && dailyTrigger > 0.0)
   {
      double dailyLossUSD = MathMax(0.0, g_propFirmDailyStartEquity - equity);
      double dailyLossPct = dailyLossUSD / propReference * 100.0;
      if(dailyLossPct >= dailyTrigger)
         return StringFormat("daily equity loss $%.2f = %.2f%% of prop reference reached %.2f%% safety trigger (firm %.2f%%)",
                             dailyLossUSD, dailyLossPct, dailyTrigger, dailyLimit);
   }

   if(g_propFirmAccountStartEquity > 0.0 && propReference > 0.0 && totalTrigger > 0.0)
   {
      double totalLossUSD = MathMax(0.0, g_propFirmAccountStartEquity - equity);
      double totalLossPct = totalLossUSD / propReference * 100.0;
      if(totalLossPct >= totalTrigger)
         return StringFormat("total equity loss $%.2f = %.2f%% of prop reference reached %.2f%% safety trigger (firm %.2f%%)",
                             totalLossUSD, totalLossPct, totalTrigger, totalLimit);
   }
   return "";
}

//+------------------------------------------------------------------+
//| INIT                                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpLicensePIN) == 0) { Alert("Enter PIN in Inputs tab."); return INIT_FAILED; }
   licenseValid = ValidatePIN(InpLicensePIN);
   if(!licenseValid) { Alert("Invalid PIN: " + InpLicensePIN); return INIT_FAILED; }
   Print("LICENSE OK: ", InpLicensePIN);

   // v5.2.0 — restore cloud position→signal map across EA restarts
   CloudMapLoad();

   // v5.2.1 — startup cooldown: capture boot time + current bar so we can block
   // any premature trade right after EA init/reload (prevents blind shots on
   // stale indicator buffers).
   g_startupAt           = TimeCurrent();
   datetime barOpens[1]; if(CopyTime(Symbol(), PERIOD_M5, 0, 1, barOpens) > 0)
      g_startupBarTime    = barOpens[0];
   else
      g_startupBarTime    = TimeCurrent();
   g_startupCooldownDone = false;
   if(InpStartupCooldownMin > 0 || InpStartupRequireNewBar)
      Print("🟡 Startup detected — entering ", InpStartupCooldownMin,
            "-minute cooldown",
            (InpStartupRequireNewBar ? " + 1 fresh M5 bar" : ""),
            " before any trade is allowed.");

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(50);
   long fm = SymbolInfoInteger(Symbol(), SYMBOL_FILLING_MODE);
   if((fm & SYMBOL_FILLING_FOK) != 0)      trade.SetTypeFilling(ORDER_FILLING_FOK);
   else if((fm & SYMBOL_FILLING_IOC) != 0)  trade.SetTypeFilling(ORDER_FILLING_IOC);
   else                                      trade.SetTypeFilling(ORDER_FILLING_RETURN);

   // M5 indicators
   hEMAFast  = iMA(Symbol(), PERIOD_M5, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow  = iMA(Symbol(), PERIOD_M5, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   hRSI      = iRSI(Symbol(), PERIOD_M5, InpRSIPeriod, PRICE_CLOSE);
   hATR      = iATR(Symbol(), PERIOD_M5, InpATRPeriod);
   hBBUpper  = iBands(Symbol(), PERIOD_M5, 20, 0, 2.0, PRICE_CLOSE);
   hBBLower  = hBBUpper;
   hBBMid    = hBBUpper;
   hEMAFast_H1 = iMA(Symbol(), PERIOD_H1, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow_H1 = iMA(Symbol(), PERIOD_H1, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   hEMAFast_H4 = iMA(Symbol(), InpContextTF, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow_H4 = iMA(Symbol(), InpContextTF, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   hRSI_M15  = iRSI(Symbol(), PERIOD_M15, InpRSIPeriod, PRICE_CLOSE);
   hStoch    = iStochastic(Symbol(), PERIOD_M5, 14, 3, 3, MODE_SMA, STO_LOWHIGH);

   if(hEMAFast==INVALID_HANDLE || hEMASlow==INVALID_HANDLE || hRSI==INVALID_HANDLE ||
      hATR==INVALID_HANDLE || hBBUpper==INVALID_HANDLE || hEMAFast_H1==INVALID_HANDLE ||
      hEMASlow_H1==INVALID_HANDLE || hRSI_M15==INVALID_HANDLE || hStoch==INVALID_HANDLE ||
      hEMAFast_H4==INVALID_HANDLE || hEMASlow_H4==INVALID_HANDLE)
   { Print("ERROR: Indicators failed"); return INIT_FAILED; }

   ArraySetAsSeries(bufEMAFast, true); ArraySetAsSeries(bufEMASlow, true);
   ArraySetAsSeries(bufRSI, true);     ArraySetAsSeries(bufATR, true);
   ArraySetAsSeries(bufBBUpper, true); ArraySetAsSeries(bufBBLower, true);
   ArraySetAsSeries(bufBBMid, true);
   ArraySetAsSeries(bufEMAFast_H1, true); ArraySetAsSeries(bufEMASlow_H1, true);
   ArraySetAsSeries(bufEMAFast_H4, true); ArraySetAsSeries(bufEMASlow_H4, true);
   ArraySetAsSeries(bufRSI_M15, true);
   ArraySetAsSeries(bufStochK, true); ArraySetAsSeries(bufStochD, true);

   initialBalance = accInfo.Balance();
   dailyStartEquity = weeklyStartEquity = accInfo.Equity();
   LoadPropFirmConfig();
   LoadPropFirmBaseline();
   pg_dayHWM = accInfo.Equity();        // v5.1.0 — initialize Profit Guardian HWM
   todayTradeCount = 0;
   lastDayReset = lastWeekReset = lastTradeClose = 0;
   dailyLimitHit = weeklyTargetHit = weeklyLossHit = false;
   totalTrades = wins = losses = lastTradeDir = 0;
   ArrayResize(patterns, 0); patternCount = 0;
   lastSignalDir = 0; lastRegime = 0; lastSetupType = 0;
   ArrayResize(closeTimes, 0); ArrayResize(closeResults, 0); ArrayResize(closeDirs, 0);
   streakPauseUntil = 0;
   buyLockoutUntil = 0; sellLockoutUntil = 0;
   todayLossCount = 0; todayLossResetDay = TimeCurrent(); drawdownActive = false;
   todayReEntryCount = 0;
   asiaRangeHigh = 0; asiaRangeLow = 0; asiaRangeLocked = false; asiaRangeDay = 0;
   ArrayResize(peakTickets, 0); ArrayResize(peakProfits, 0); ArrayResize(partialTakenTickets, 0);
   ArrayResize(aiVetoTickets, 0); ArrayResize(aiVetoLastCall, 0);
   ArrayResize(tpExtendTickets, 0); ArrayResize(tpExtendCount, 0);
   ArrayResize(g_exitReasonKeys, 0); ArrayResize(g_exitReasonTrades, 0);
   ArrayResize(g_exitReasonWins, 0); ArrayResize(g_exitReasonGrossWin, 0);
   ArrayResize(g_exitReasonGrossLoss, 0);
   g_aiInfluencedTrades = 0; g_aiInfluencedWins = 0; g_aiInfluencedPnl = 0.0;
   g_nonAiTrades = 0; g_nonAiWins = 0; g_nonAiPnl = 0.0;
   g_peakEquityAudit = accInfo.Equity(); g_maxDrawdownAudit = 0.0;
   currentTradeThesis = ""; currentTradeInvalidation = ""; currentTradeTarget = "";
   currentTradeBearishCase = ""; currentTradeConfidence = 0;
   lastDashSignal = 0; lastDashScore = 0.0; lastDashGrade = "";
   RecomputeAutoScale();
   lastClose.valid = false; lastClose.reEntered = false; lastClose.wasLoss = false;
   lastClose.dir = 0; lastClose.entryPrice = 0; lastClose.slDist = 0;
   lastClose.lots = 0; lastClose.closeTime = 0; lastClose.signature = ""; lastClose.setup = "";
   dxyLastFetch = 0; dxyGoldBias = "neutral";
   LoadPatterns();
   // v6.3.8 Upgrade 1: load TradeBrain memory from disk on startup
   LoadTradeBrainMemory();
   // v6.3.8 Upgrade 7: initialize equity watermark
   g_equityHighWatermark = AccountInfoDouble(ACCOUNT_EQUITY);
   g_drawdownPause       = false;
   g_perfMultLast        = 1.0;
   g_dailyProfitLockArmed = false;
   // v6.3.8 Upgrade 6: initialize gate analytics timer
   g_gateReportLast = TimeCurrent();
   // v6.3.9: initialize forward-test report globals
   g_ftReport_Signals     = 0;
   g_ftReport_Trades      = 0;
   g_ftReport_Wins        = 0;
   g_ftReport_Losses      = 0;
   g_ftReport_TotalPnL    = 0.0;
   g_ftReport_MaxDD       = 0.0;
   g_ftReport_MaxFloat    = 0.0;
   g_ftReport_MaxFav      = 0.0;
   g_ftReport_AIAllowed   = 0;
   g_ftReport_AIBlocked   = 0;
   g_ftReport_TBAllowed   = 0;
   g_ftReport_TBBlocked   = 0;
   g_ftReport_StartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_ftReport_StartTime   = TimeCurrent();
   g_ftReport_StratCount  = 0;
   g_ftReport_LastWriteDay = -1;
   for(int fsi = 0; fsi < 20; fsi++)
   { g_ftReport_StratNames[fsi] = ""; g_ftReport_StratWins[fsi] = 0; g_ftReport_StratLosses[fsi] = 0; }
   if(InpTimerScanSec > 0)
   {
      EventSetTimer(InpTimerScanSec);
      Print("SCAN WATCHDOG: timer armed every ", InpTimerScanSec,
            "s; forced scan after ", InpScanWatchdogMin, " min without a completed scan.");
   }

   Print("=== XAUAI SNIPER v5.9.1 (BALANCED PRECISION) READY ===");
   XAU_LogTradingIntelStartupHealth();
   XAU_RunStartupIntelligenceSync();
   BotMonitorActivity("SYNC", "SYNC", "Startup sync completed: " + g_startupIntelSyncReason);

   // ============================================================
   // v4.9.6 — STARTUP DIAGNOSTIC BANNER
   //   Tells the user IMMEDIATELY if their setup is wrong.
   //   Catches the top 5 "bot active but idle" causes at attach time.
   // ============================================================
   Print("─────────────── STARTUP DIAGNOSTICS ───────────────");
   string sym = Symbol();
   bool  symOK = (StringFind(sym, "XAU") >= 0 || StringFind(sym, "GOLD") >= 0 || StringFind(sym, "Gold") >= 0);
   PrintFormat("▸ Symbol detected: %s %s", sym, symOK ? "✓ OK (gold instrument)" : "⚠ NOT A GOLD SYMBOL — attach EA to XAUUSD chart!");
   long  acctNum  = AccountInfoInteger(ACCOUNT_LOGIN);
   string acctSrv = AccountInfoString(ACCOUNT_SERVER);
   string acctTyp = AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO ? "DEMO" :
                    AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_CONTEST ? "CONTEST" : "LIVE";
   string acctCur = AccountInfoString(ACCOUNT_CURRENCY);
   PrintFormat("▸ Account: #%I64d on %s (%s, %s)", acctNum, acctSrv, acctTyp, acctCur);
   bool termConn = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   bool termAlgo = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   bool mqlAlgo  = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   PrintFormat("▸ Broker connection: %s", termConn ? "✓ connected" : "✗ NOT CONNECTED — check internet");
   PrintFormat("▸ Algo Trading toolbar button: %s", termAlgo ? "✓ ENABLED (green)" : "✗ DISABLED — click toolbar button until GREEN");
   PrintFormat("▸ EA-level Algo Trading: %s", mqlAlgo ? "✓ allowed (Common tab checked)" : "✗ NOT allowed — re-attach EA, tick 'Allow Algo Trading' in Common tab");
   double curSpread = (double)SymbolInfoInteger(sym, SYMBOL_SPREAD);
   PrintFormat("▸ Current spread: %.0f points (max allowed: %d) %s",
               curSpread, InpMaxSpread,
               curSpread <= InpMaxSpread ? "✓ OK" : "⚠ TOO WIDE — entries will be blocked until spread narrows");
   // WebRequest live connectivity test (cheap GET, 3s timeout)
   if(!InpBacktestMode && StringLen(InpServerURL) >= 10)
   {
      char _pd[], _res[]; string _rh;
      ResetLastError();
      int wrTest = WebRequest("GET", InpServerURL + "/api/health", "", 3000, _pd, _res, _rh);
      if(wrTest == 200)
         PrintFormat("▸ WebRequest to %s: ✓ OK (HTTP 200)", InpServerURL);
      else if(wrTest == -1 && GetLastError() == 4060)
         PrintFormat("▸ WebRequest: ✗ URL NOT WHITELISTED! Go to Tools→Options→Expert Advisors, tick 'Allow WebRequest for listed URL', add: %s", InpServerURL);
      else
         PrintFormat("▸ WebRequest to %s: ⚠ HTTP %d (err %d) — server unreachable, AI/ML/license features disabled", InpServerURL, wrTest, GetLastError());
   }
   // Indicator buffer check
   int barsAvail = Bars(sym, PERIOD_M5);
   PrintFormat("▸ M5 bars loaded: %d %s", barsAvail, barsAvail >= 100 ? "✓ OK" : "⚠ need 100+ bars — wait or scroll chart back");
   Print("─────────────── END DIAGNOSTICS ───────────────");
   if(!symOK || !termConn || !termAlgo || !mqlAlgo)
      Print("⚠⚠⚠  ONE OR MORE CRITICAL CHECKS FAILED — THE BOT WILL NOT TRADE UNTIL FIXED  ⚠⚠⚠");
   Print("Balance: $", DoubleToString(initialBalance, 2), " | Risk: ", InpRiskPercent,
         "% | AI: ", InpUseAI ? "ON" : "OFF", " | ML: ", InpLearnPatterns ? "ON" : "OFF");
   Print("MODE: ", InpBacktestMode ? "BACKTEST (no network, no AI, no hive, no news)" : "LIVE (full features)");
   Print("THRESHOLDS: Grade A+ >= ", DoubleToString(InpGradeAPlus, 1),
         " | A >= ", DoubleToString(InpGradeA, 1),
         " | B >= ", DoubleToString(InpGradeB, 1),
         " | Cooldown=", InpTradeCooldown, "s | Reversal=", InpReversalCooldown, "s");
   Print("EXITS: QuickTake $", InpProfitTakeMin, "-$", InpProfitTakeMax, " | QuickExitMin=", InpQuickExitMin, "min");
   Print("SMART: ReEntry=", InpUseReEntry?"ON":"OFF",
         " (", InpReEntryWindow/60, "min win, ", DoubleToString(InpReEntrySize,2), "x, cap ", InpMaxReEntriesPerDay, "/day) | DXY=", InpUseDXYFilter?"ON":"OFF",
         " | Drawdown=", InpDrawdownMode?"ON":"OFF",
         " (", InpDrawdownLosses, "losses->", DoubleToString(InpDrawdownRisk,2), "%) | Streak=", InpStreakCooldownLosses, " in ", InpStreakWindowSec/60, "min");
   Print("ADAPTIVE: ", InpAdaptiveGrades?"ON":"OFF",
         " (auto-tunes GradeB on recent WR) | AsiaBreakout: ", InpAsiaRangeBreakout?"ON":"OFF");
   Print("ARMOR v4.4.5: HardStop=",
         InpHardStopRBased ? StringFormat("R-BASED %.1fR (adaptive)", InpHardStopRMulti)
                           : StringFormat("$-ABS $%.2f", EffHardStopUSD()),
         " | EarlyAdverse=", InpEarlyAdverseCut?"ON":"OFF", " (", InpEarlyAdverseMin, "min,", DoubleToString(InpEarlyAdverseR,1), "R)",
         " | PeakRetrace=", InpPeakRetraceExit?"ON":"OFF", " (", DoubleToString(InpPeakRetracePct,0), "%,min$", DoubleToString(EffPeakMinUSD(),2), ")",
         " | MomentumGuard=", InpMomentumGuard?"ON":"OFF", " (fade ≥", InpMomentumFadeScore, "/4)");
   Print("PYRAMID: ", InpAllowPyramid?"ON":"OFF",
         " | MaxAdds=", InpMaxPyramidAdds, " (total=", 1+InpMaxPyramidAdds, ")",
         " | MinATR=", DoubleToString(InpPyramidMinATR,2),
         " | SizeMulti=", DoubleToString(InpPyramidSizeMulti,2),
         " | Gap=", InpPyramidMinGapSec, "s",
         " | OnAdverse=", InpPyramidOnAdverse?"Y":"N",
         " | OnTrend=", InpPyramidOnTrend?"Y":"N",
         " | Adaptive=", InpPyramidAdaptiveEngine?"Y":"N",
         " | Rescue=", InpPyramidRescueMode?"Y":"N",
         " (max ", DoubleToString(InpPyramidRescueMaxATR,2), "ATR, size×",
         DoubleToString(InpPyramidRescueSizeMulti,2), ")");
   if(InpAutoScale)
      Print("AUTO-SCALE ON | Balance: $", DoubleToString(accInfo.Balance(),2),
            " -> HardStop:$", DoubleToString(autoHardStopUSD,2),
            " ProfitMin:$", DoubleToString(autoProfitTakeMin,2),
            " ProfitMax:$", DoubleToString(autoProfitTakeMax,2),
            " PeakMin:$", DoubleToString(autoPeakMinUSD,2),
            " | Bounds: $", DoubleToString(InpProfMaxFloorUSD,0), "-$", DoubleToString(InpProfMaxCeilUSD,0),
            " | SmartCap=", InpSmartCapExit?"ON (trail, let run)":"OFF (force close)");
   Print("VOL-ADAPT: ", InpVolAdaptiveLots?"ON":"OFF",
         " (spike>", DoubleToString(InpVolSpikeMulti,2), "x ATR → size×",DoubleToString(InpVolSpikeReduce,2),
         ", calm<", DoubleToString(InpVolCalmMulti,2), "x → size×", DoubleToString(InpVolCalmBoost,2), ")");
   Print("AI DIRECTOR: ", InpUseAI?"ON":"OFF",
         " | Auth=", InpAIAdvisoryOnly?"ADVISORY":"REAL-AUTHORITY",
         " | AllGrades=", InpAIDirectorAllGrades?"YES":"A+-only",
         " | MinConf=", InpAIDirectorMinConf, "% (block below this)",
         " | OfflineSafe=", InpAIOfflineSafeMode?"50%-lot":"disabled");
   Print("CONVICTION: ", InpConvictionSizing?"ON":"OFF",
         " | NormalConf=", InpNormalAIConfidence, "% (x1.0)",
         " | HighConf=", InpHighAIConfidence, "% (x", DoubleToString(InpConvictionHighMulti, 2), ")",
         " | LowMulti=x", DoubleToString(InpConvictionLowMulti, 2), " (55-74% = mild reduce)");
   Print("TRAIL v4.5.2: BE activate=+", DoubleToString(InpBELockActivateR,2), "R  lock=+",
         DoubleToString(InpBELockProfitR,2), "R",
         " | TrendAware=", InpTrendAwareTrail?"ON":"OFF",
         " | Trend=", DoubleToString(InpTrendTrailMulti,2), "xATR",
         " StrongTrend=", DoubleToString(InpStrongTrendTrail,2), "xATR",
         " Range=", DoubleToString(InpCapTrailATRMulti,2), "xATR",
         " Choppy=", DoubleToString(InpChoppyTrailMulti,2), "xATR",
         " LowVol=", DoubleToString(InpLowVolTrailMulti,2), "xATR",
         " | ClaudeAudit=", InpClaudeAuditSec, "s");
   Print("CONVICTION-RUNNER v4.5.3: ", InpConvictionRunner?"ON":"OFF",
         " | Min conf=", InpConvRunMinConf, "%",
         " | Min profit=", DoubleToString(InpConvRunMinR,2), "R",
         " | Trail=", DoubleToString(InpConvRunnerMulti,2), "xATR (monster)");
   Print("PARTIAL-TP v4.5.4: ", (InpPartialTP && !InpCloudSafeDisablePartials)?"ON":"OFF",
         " | Fires at +", DoubleToString(InpPartialTPAtR,2), "R",
         " | Close ", DoubleToString(InpPartialPct*100, 0), "% of position",
         " | Skip on ≥", InpConvRunMinConf, "% conf=", InpPartialSkipHighConf?"Y":"N",
         " | CloudSafeNoPartials=", InpCloudSafeDisablePartials?"Y":"N");
   STI_Init();
   Print(StringFormat("STI v6.0: %s | LateBlock=%.0f LateReduce=%.0f ExhaustBlock=%.0f ExhaustReduce=%.0f | TCP_min=%.0f | ReentryPullback=%.2fATR wait=%dmin",
         InpSTI_Enable ? "ENABLED" : "DISABLED",
         InpSTI_LateEntryBlockScore, InpSTI_LateEntryReduceScore,
         InpSTI_ExhaustionBlock, InpSTI_ExhaustionReduce,
         InpSTI_TCPContinueMinimum,
         InpSTI_ReentryPullbackATR, InpSTI_ReentryMinWaitMin));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   PrintBacktestAuditReport();
   IndicatorRelease(hEMAFast); IndicatorRelease(hEMASlow);
   IndicatorRelease(hRSI); IndicatorRelease(hATR); IndicatorRelease(hBBUpper);
   IndicatorRelease(hEMAFast_H1); IndicatorRelease(hEMASlow_H1); IndicatorRelease(hRSI_M15);
   IndicatorRelease(hEMAFast_H4); IndicatorRelease(hEMASlow_H4);
   IndicatorRelease(hStoch);
   SavePatterns();
   // v6.3.8 Upgrade 6 / v6.3.9: final gate analytics report on shutdown
   PrintGateReport();
   WriteGateReportToFile();
   // v6.3.9: final forward-test report on shutdown
   WriteForwardTestReport();
   Print("=== v6.3.9 STI STOPPED | Trades:", totalTrades, " W:", wins, " L:", losses, " ===");
}

void OnTimer()
{
   int secondsSinceScan = (g_lastEntryScanAt > 0) ? (int)(TimeCurrent() - g_lastEntryScanAt) : 999999;
   g_timerForceScan = (InpScanWatchdogMin > 0 && secondsSinceScan >= InpScanWatchdogMin * 60);
   OnTick();
}

bool RebuildEntryIndicatorHandles(string why)
{
   g_lastIndicatorRebuildAt = TimeCurrent();
   Print("INDICATOR RECOVERY: rebuilding entry indicator handles because ", why);

   if(hEMAFast     != INVALID_HANDLE) IndicatorRelease(hEMAFast);
   if(hEMASlow     != INVALID_HANDLE) IndicatorRelease(hEMASlow);
   if(hRSI         != INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hATR         != INVALID_HANDLE) IndicatorRelease(hATR);
   if(hBBUpper     != INVALID_HANDLE) IndicatorRelease(hBBUpper);
   if(hEMAFast_H1  != INVALID_HANDLE) IndicatorRelease(hEMAFast_H1);
   if(hEMASlow_H1  != INVALID_HANDLE) IndicatorRelease(hEMASlow_H1);
   if(hEMAFast_H4  != INVALID_HANDLE) IndicatorRelease(hEMAFast_H4);
   if(hEMASlow_H4  != INVALID_HANDLE) IndicatorRelease(hEMASlow_H4);
   if(hRSI_M15     != INVALID_HANDLE) IndicatorRelease(hRSI_M15);
   if(hStoch       != INVALID_HANDLE) IndicatorRelease(hStoch);

   hEMAFast  = iMA(Symbol(), PERIOD_M5, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow  = iMA(Symbol(), PERIOD_M5, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   hRSI      = iRSI(Symbol(), PERIOD_M5, InpRSIPeriod, PRICE_CLOSE);
   hATR      = iATR(Symbol(), PERIOD_M5, InpATRPeriod);
   hBBUpper  = iBands(Symbol(), PERIOD_M5, 20, 0, 2.0, PRICE_CLOSE);
   hBBLower  = hBBUpper;
   hBBMid    = hBBUpper;
   hEMAFast_H1 = iMA(Symbol(), PERIOD_H1, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow_H1 = iMA(Symbol(), PERIOD_H1, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   hEMAFast_H4 = iMA(Symbol(), InpContextTF, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow_H4 = iMA(Symbol(), InpContextTF, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   hRSI_M15  = iRSI(Symbol(), PERIOD_M15, InpRSIPeriod, PRICE_CLOSE);
   hStoch    = iStochastic(Symbol(), PERIOD_M5, 14, 3, 3, MODE_SMA, STO_LOWHIGH);

   bool ok = (hEMAFast     != INVALID_HANDLE && hEMASlow    != INVALID_HANDLE &&
              hRSI         != INVALID_HANDLE && hATR        != INVALID_HANDLE &&
              hBBUpper     != INVALID_HANDLE && hEMAFast_H1 != INVALID_HANDLE &&
              hEMASlow_H1  != INVALID_HANDLE && hEMAFast_H4 != INVALID_HANDLE &&
              hEMASlow_H4  != INVALID_HANDLE && hRSI_M15    != INVALID_HANDLE &&
              hStoch       != INVALID_HANDLE);
   if(ok)
   {
      g_indicatorBufferFailCount = 0;
      int warmupSec = InpIndicatorWarmupSec;
      if(warmupSec < 3) warmupSec = 3;
      g_indicatorWarmupUntil = TimeCurrent() + warmupSec;
      Print("INDICATOR RECOVERY: handles rebuilt OK; warming buffers for ",
            warmupSec, "s before retrying scan.");
   }
   else
      Print("INDICATOR RECOVERY FAILED: one or more indicator handles are still invalid. Check chart symbol/history.");

   return ok;
}

bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)
{
   if(g_indicatorWarmupUntil > 0 && TimeCurrent() < g_indicatorWarmupUntil)
   {
      g_lastSkipReason = StringFormat("INDICATOR_WARMUP: waiting %ds after handle rebuild before copying %s",
                                      (int)(g_indicatorWarmupUntil - TimeCurrent()), label);
      if(TimeCurrent() - g_lastIndicatorFailLog >= 30)
      {
         Print("SCAN BUFFER WARMUP: ", g_lastSkipReason);
         g_lastIndicatorFailLog = TimeCurrent();
      }
      return false;
   }
   if(g_indicatorWarmupUntil > 0 && TimeCurrent() >= g_indicatorWarmupUntil)
      g_indicatorWarmupUntil = 0;

   ResetLastError();
   int got = CopyBuffer(handle, buffer, start, count, target);
   if(got >= count)
      return true;

   int err = GetLastError();
   int calculated = (handle != INVALID_HANDLE) ? BarsCalculated(handle) : -1;
   // v5.8.51: only a truly invalid handle warrants an immediate rebuild.
   // got<0 with err=4807 (ERR_INDICATOR_DATA_NOT_FOUND) is a transient MT5 quirk
   // at new-bar boundaries — treat it as a fail-counter increment, not a stale handle.
   // Without this fix, err=4807 triggered 58+ rebuilds/day (12s warmup each).
   bool staleHandle = (handle == INVALID_HANDLE);
   g_indicatorBufferFailCount++;
   g_lastSkipReason = StringFormat("INDICATOR_BUFFER_NOT_READY: %s got %d/%d barsCalc=%d err=%d fail=%d/%d",
                                   label, got, count, calculated, err,
                                   g_indicatorBufferFailCount, InpIndicatorReloadFails);
   if(TimeCurrent() - g_lastIndicatorFailLog >= 60)
   {
      Print("SCAN BUFFER WAIT: ", g_lastSkipReason,
            " | bars M5=", Bars(Symbol(), PERIOD_M5),
            " M15=", Bars(Symbol(), PERIOD_M15),
            " H1=", Bars(Symbol(), PERIOD_H1),
            " HTF=", Bars(Symbol(), InpContextTF));
      g_lastIndicatorFailLog = TimeCurrent();
   }

   if(staleHandle || (InpIndicatorReloadFails > 0 && g_indicatorBufferFailCount >= InpIndicatorReloadFails))
   {
      string why = staleHandle
                   ? StringFormat("%s stale handle/copy failure (got=%d barsCalc=%d err=%d)", label, got, calculated, err)
                   : label;
      int backoffSec = InpIndicatorRecoveryBackoffSec;
      if(backoffSec < 15) backoffSec = 15;
      bool rebuildAllowed = (g_lastIndicatorRebuildAt <= 0 ||
                             TimeCurrent() - g_lastIndicatorRebuildAt >= backoffSec);
      if(!rebuildAllowed)
      {
         g_lastSkipReason = StringFormat("INDICATOR_RECOVERY_BACKOFF: %s; retry rebuild in %ds",
                                         label, backoffSec - (int)(TimeCurrent() - g_lastIndicatorRebuildAt));
         if(TimeCurrent() - g_lastIndicatorFailLog >= 30)
         {
            Print("INDICATOR RECOVERY BACKOFF: ", why,
                  " | next rebuild in ",
                  backoffSec - (int)(TimeCurrent() - g_lastIndicatorRebuildAt), "s");
            g_lastIndicatorFailLog = TimeCurrent();
         }
         return false;
      }
      if(RebuildEntryIndicatorHandles(why))
      {
         g_timerForceScan = true;
         g_lastSkipReason = "INDICATOR_RECOVERED: handles rebuilt; warming buffers before retrying scan";
      }
   }

   return false;
}

//+------------------------------------------------------------------+
//| GATE 1: REGIME DETECTION                                         |
//| Returns regime + quality multiplier (0.05 to 0.85)               |
//+------------------------------------------------------------------+
double DetectRegime()
{
   double emaF = bufEMAFast[1], emaS = bufEMASlow[1];
   double atr = bufATR[1];
   double bbU = bufBBUpper[1], bbL = bufBBLower[1], bbM = bufBBMid[1];
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   double h1F = bufEMAFast_H1[1], h1S = bufEMASlow_H1[1];
   double atrPct = atr / close1 * 100;

   // BB squeeze detection
   double bbWidth = (bbU - bbL) / close1 * 100;
   double prevBBWidth = 0;
   if(bufBBUpper[5] > 0 && bufBBLower[5] > 0)
      prevBBWidth = (bufBBUpper[5] - bufBBLower[5]) / iClose(Symbol(), PERIOD_M5, 5) * 100;
   bool expanding = (prevBBWidth > 0) && (bbWidth > prevBBWidth * 1.3);

   double emaDiff = MathAbs(emaF - emaS) / emaS * 100;
   bool mtfAligned = (emaF > emaS && h1F > h1S) || (emaF < emaS && h1F < h1S);

   // --- TIER 1: DEAD (truly no movement — everything else is tradeable) ---
   if(atrPct < 0.03) { currentRegime = REGIME_DEAD; return 0.05; }

   // --- TIER 2: BREAKOUT (explosive squeeze releases — highest priority) ---
   if(expanding && close1 > bbU) { currentRegime = REGIME_BREAKOUT_UP; return 0.75; }
   if(expanding && close1 < bbL) { currentRegime = REGIME_BREAKOUT_DOWN; return 0.75; }

   // --- TIER 3: TRENDING (must check BEFORE low-vol so slow trends aren't misclassified) ---
   if(emaF > emaS && emaDiff > 0.03)
   {
      currentRegime = REGIME_TRENDING_UP;
      return mtfAligned ? 0.85 : 0.65;
   }
   if(emaF < emaS && emaDiff > 0.03)
   {
      currentRegime = REGIME_TRENDING_DOWN;
      return mtfAligned ? 0.85 : 0.65;
   }

   // --- TIER 4: LOW_VOL (quiet AND flat — only now that trend is ruled out) ---
   if(atrPct < 0.08) { currentRegime = REGIME_LOW_VOL; return 0.65; }

   // --- TIER 5: CHOPPY (EMAs tangled, no trend, no clear direction) ---
   if(emaDiff < 0.03 && !mtfAligned) { currentRegime = REGIME_CHOPPY; return 0.30; }

   // --- TIER 6: RANGING (everything else — moderate vol, no strong direction) ---
   currentRegime = REGIME_RANGING;
   return 0.60;
}

string RegimeName()
{
   switch(currentRegime)
   {
      case REGIME_TRENDING_UP: return "TREND_UP";
      case REGIME_TRENDING_DOWN: return "TREND_DN";
      case REGIME_RANGING: return "RANGING";
      case REGIME_BREAKOUT_UP: return "BRKT_UP";
      case REGIME_BREAKOUT_DOWN: return "BRKT_DN";
      case REGIME_LOW_VOL: return "LOW_VOL";
      case REGIME_CHOPPY: return "CHOPPY";
      case REGIME_DEAD: return "DEAD";
   }
   return "UNKNOWN";
}

//+------------------------------------------------------------------+
//| SIGNATURE BUCKETS & BUILDER                                      |
//| sig = regime|setup|dir|session|rsi_bucket|stoch_bucket|mom_bucket|
//+------------------------------------------------------------------+
int RsiBucket(double r)   { if(r<35) return 0; if(r<65) return 1; return 2; }  // 3 buckets: OS / N / OB
int StochBucket(double s) { if(s<25) return 0; if(s<75) return 1; return 2; }  // 3 buckets
int MomBucket(double mom, double atr)                                          // 3 buckets
{
   if(atr <= 0) return 1;
   double m = mom / atr;
   if(m < -0.3) return 0;  // DOWN
   if(m <  0.3) return 1;  // FLAT
   return 2;                // UP
}
string SessionTag()
{
   MqlDateTime dt; TimeCurrent(dt);
   int h = dt.hour;
   if((h == 10 && dt.min >= 20) || (h == 15 && dt.min <= 10)) return "FIX";
   if(h >= 13 && h < 17) return "NY";
   if(h >= 7  && h < 13) return "LDN";
   if(h >= 0  && h < 8)  return "ASIA";
   return "LATE";
}
string BuildSignature(int dir, string setupName)
{
   if(ArraySize(bufRSI) < 2 || ArraySize(bufStochK) < 2 || ArraySize(bufATR) < 2)
      return "";
   double rsi = bufRSI[1];
   double stk = bufStochK[1];
   double atr = bufATR[1];
   double mom = iClose(Symbol(), PERIOD_M5, 1) - iClose(Symbol(), PERIOD_M5, 5);
   return StringFormat("%s|%s|%d|%s|%d|%d|%d",
      RegimeName(), setupName, dir, SessionTag(),
      RsiBucket(rsi), StochBucket(stk), MomBucket(mom, atr));
}

//+------------------------------------------------------------------+
//| HIVE-MIND — 7-day global WR lookup                               |
//| Returns: 1=BOOST (+8pp), 0=NEUTRAL, -1=VETO                      |
//+------------------------------------------------------------------+
int GetHiveVerdict(string signature)
{
   if(InpBacktestMode) return 0;
   if(StringLen(InpServerURL) < 10 || StringLen(signature) == 0) return 0;
   // Cache: one WebRequest per bar per signature — prevents hammering on every tick
   int curBar = iBars(Symbol(), PERIOD_M5);
   if(signature == g_hiveLastSig && curBar == g_hiveLastBar) return g_hiveLastVerdict;

   string url = InpServerURL + "/api/ml/hive/score";
   string headers = "Content-Type: application/json\r\n";
   string body = StringFormat("{\"signature\":\"%s\",\"window_days\":7}", signature);
   char pd[], result[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 8000, pd, result, rh);
   if(res != 200) { g_hiveLastSig = signature; g_hiveLastBar = curBar; g_hiveLastVerdict = 0; return 0; }
   string response = CharArrayToString(result);
   int total = ExtractJsonInt(response, "total", 0);
   double wr = ExtractJsonDouble(response, "wr", 0.5);
   string verdict = ExtractJsonString(response, "verdict");

   int hv = 0;
   if(total < InpHiveMinTrustedSamples)
   { Print("HIVE IGNORED: sample=", total, "/", InpHiveMinTrustedSamples, " | wr=", DoubleToString(wr*100,1), "% | verdict=", verdict); }
   else
   {
      Print("HIVE TRUSTED: sample=", total, " | wr=", DoubleToString(wr*100,1), "% | verdict=", verdict);
      if(StringFind(response, "\"BOOST\"") >= 0) hv =  1;
      if(StringFind(response, "\"VETO\"")  >= 0) hv = -1;
   }
   g_hiveLastSig = signature; g_hiveLastBar = curBar; g_hiveLastVerdict = hv;
   return hv;
}

//+------------------------------------------------------------------+
//| DXY CORRELATION — cached so we don't hammer the endpoint         |
//| Returns gold_bias: +1 bullish, -1 bearish, 0 neutral/unknown     |
//+------------------------------------------------------------------+
int GetDXYBias()
{
   if(InpBacktestMode || !InpUseDXYFilter) return 0;
   if(StringLen(InpServerURL) < 10) return 0;
   // Use cached value if fresh
   if(dxyLastFetch > 0 && TimeCurrent() - dxyLastFetch < InpDXYRefreshSec)
   {
      if(dxyGoldBias == "bullish") return  1;
      if(dxyGoldBias == "bearish") return -1;
      return 0;
   }
   string url = InpServerURL + "/api/smart/dxy";
   char pd[], result[]; string rh;
   int res = WebRequest("GET", url, "", 6000, pd, result, rh);
   if(res != 200) return 0;
   string response = CharArrayToString(result);
   dxyLastFetch = TimeCurrent();
   if(StringFind(response, "\"gold_bias\":\"bullish\"") >= 0) { dxyGoldBias = "bullish"; return  1; }
   if(StringFind(response, "\"gold_bias\":\"bearish\"") >= 0) { dxyGoldBias = "bearish"; return -1; }
   dxyGoldBias = "neutral"; return 0;
}

//+------------------------------------------------------------------+
//| STREAK TRACKER — count LOSSes in last InpStreakWindowSec         |
//+------------------------------------------------------------------+
void RecordCloseForStreak(bool wasLoss)
{
   int n = ArraySize(closeTimes);
   ArrayResize(closeTimes, n+1);
   ArrayResize(closeResults, n+1);
   ArrayResize(closeDirs, n+1);
   closeTimes[n] = TimeCurrent();
   closeResults[n] = wasLoss;
   closeDirs[n] = lastTradeDir;    // latest trade direction captured at exit
   PruneStreak();
   int recentLosses = 0;
   for(int i = 0; i < ArraySize(closeResults); i++)
      if(closeResults[i]) recentLosses++;
   if(recentLosses >= InpStreakCooldownLosses)
   {
      streakPauseUntil = TimeCurrent() + InpStreakPauseSec;
      Print("STREAK COOLDOWN: ", recentLosses, " losses in window — pausing until ",
            TimeToString(streakPauseUntil, TIME_SECONDS));
   }

   // DIRECTION LOCKOUT: if last N closed trades show too many same-direction losses,
   // lock that direction for X minutes. Solves "stuck selling into a dead trend".
   if(InpDirectionLockout)
   {
      int total = ArraySize(closeDirs);
      int check = MathMin(InpDirLockoutLookback, total);
      if(check >= InpDirLockoutLossesNeeded)
      {
         int buyLosses = 0, sellLosses = 0, buyTotal = 0, sellTotal = 0;
         for(int j = total - check; j < total; j++)
         {
            if(closeDirs[j] ==  1) { buyTotal++;  if(closeResults[j]) buyLosses++; }
            if(closeDirs[j] == -1) { sellTotal++; if(closeResults[j]) sellLosses++; }
         }
         if(buyLosses >= InpDirLockoutLossesNeeded)
         {
            buyLockoutUntil = TimeCurrent() + InpDirLockoutMinutes * 60;
            Print("DIR-LOCK: BUY locked for ", InpDirLockoutMinutes, " min — ",
                  buyLosses, "/", buyTotal, " BUYs lost. Stop fighting this side.");
         }
         if(sellLosses >= InpDirLockoutLossesNeeded)
         {
            sellLockoutUntil = TimeCurrent() + InpDirLockoutMinutes * 60;
            Print("DIR-LOCK: SELL locked for ", InpDirLockoutMinutes, " min — ",
                  sellLosses, "/", sellTotal, " SELLs lost. Stop fighting this side.");
         }
      }
   }
}

// v6.1.3 — Basket direction-loss block.
// Returns true (= block entry) if existing same-direction open trades are in a net
// floating loss exceeding InpBasketDirLossBlockPct % of current balance.
// Prevents the bot adding more sells into a rising gold market that is already
// burning through the existing sell basket.
bool BasketDirectionLossBlock(int dir, string &reason)
{
   reason = "";
   if(!InpBasketDirLossBlock || dir == 0) return false;
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   if(balance <= 0) return false;
   // v6.3.2 FIX: enforce $200 minimum so the block never fires from normal spread+noise
   // float on small accounts (e.g. 2% of $3k = $60 — one open position in mild drawdown).
   double threshold = -MathMax(balance * InpBasketDirLossBlockPct / 100.0, 200.0);
   double dirFloat  = 0.0;
   int    dirCount  = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      int posDir = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
      if(posDir != dir) continue;
      dirFloat += PositionGetDouble(POSITION_PROFIT);
      dirCount++;
   }
   if(dirCount > 0 && dirFloat < threshold)
   {
      reason = StringFormat("BASKET-DIR-LOSS: %d open %s trades floating $%.2f (threshold $%.2f = %.1f%% of $%.0f balance) — no new %s entries until basket recovers",
                            dirCount, dir == 1 ? "BUY" : "SELL", dirFloat, threshold,
                            InpBasketDirLossBlockPct, balance, dir == 1 ? "BUY" : "SELL");
      return true;
   }
   return false;
}

bool IsDirectionLocked(int dir)
{
   if(!InpDirectionLockout) return false;
   if(dir ==  1 && buyLockoutUntil  > TimeCurrent()) return true;
   if(dir == -1 && sellLockoutUntil > TimeCurrent()) return true;
   return false;
}

bool IsDamageProneSetupName(string setupName)
{
   return (StringFind(setupName, "TREND_PULLBACK") >= 0 ||
           StringFind(setupName, "BREAKOUT") >= 0);
}

int RecentDirectionalLosses(int dir, int lookback, int windowMin)
{
   if(dir == 0) return 0;
   int total = ArraySize(closeDirs);
   int checked = 0;
   int dirLosses = 0;
   datetime cutoff = TimeCurrent() - windowMin * 60;
   for(int i = total - 1; i >= 0 && checked < lookback; i--)
   {
      if(closeTimes[i] < cutoff) break;
      if(closeDirs[i] != dir) continue;
      checked++;
      if(closeResults[i]) dirLosses++;
   }
   return dirLosses;
}

bool IsFastTrendRegimeForDirection(int dir)
{
   if(dir == 1)
      return (currentRegime == REGIME_TRENDING_UP || currentRegime == REGIME_BREAKOUT_UP);
   if(dir == -1)
      return (currentRegime == REGIME_TRENDING_DOWN || currentRegime == REGIME_BREAKOUT_DOWN);
   return false;
}

bool ApplyAntiBiasCorrection(int &signal, string &setupName, double setupScore,
                             double combinedScore, string grade, string &reason)
{
   reason = "";
   if(!InpAntiBiasCorrection || signal == 0) return true;
   if(!IsDamageProneSetupName(setupName)) return true;
   if(combinedScore < InpAntiBiasMinScore) return true;

   int sameSideLosses = RecentDirectionalLosses(signal, InpAntiBiasLookback, InpAntiBiasWindowMin);
   if(sameSideLosses < InpAntiBiasLossesNeeded) return true;

   double oppositeLotPenalty = 1.0;
   string oppositeWhy = "";
   bool oppositeConfirmed = AdaptiveXAUConfirm(-signal, "ANTI-BIAS-OPPOSITE",
                                               combinedScore, grade,
                                               oppositeLotPenalty, oppositeWhy, true);
   bool oppositeTrendOk = IsFastTrendRegimeForDirection(-signal);

   if(oppositeConfirmed && oppositeTrendOk)
   {
      int oldSignal = signal;
      signal = -signal;
      setupName = setupName + "_ANTI_BIAS";
      g_adaptiveConfirmLotMulti *= MathMin(1.0, oppositeLotPenalty);
      g_adaptiveConfirmReason = "ANTI-BIAS flip: " + oppositeWhy;
      reason = StringFormat("ANTI-BIAS FLIP: recent %s losses=%d/%d inside %dmin; switched to %s because fast XAU confirmation supports opposite. %s",
                            oldSignal == 1 ? "BUY" : "SELL",
                            sameSideLosses, InpAntiBiasLookback, InpAntiBiasWindowMin,
                            signal == 1 ? "BUY" : "SELL", oppositeWhy);
      Print(reason);
      CloudPostReasoning("ANTI-BIAS", reason, RegimeName(), setupName,
                         setupScore, combinedScore, grade, signal);
      return true;
   }

   if(InpTrendPullbackBRequireAntiBias && grade == "B")
   {
      reason = StringFormat("ANTI-BIAS BLOCK: %s %s has recent same-side losses=%d/%d inside %dmin and opposite confirmation is not clean. B-grade damage setups are paused instead of repeating losses. Opposite check: %s",
                            setupName, signal == 1 ? "BUY" : "SELL",
                            sameSideLosses, InpAntiBiasLookback, InpAntiBiasWindowMin,
                            oppositeWhy);
      return false;
   }

   double sameLotPenalty = 1.0;
   string sameWhy = "";
   if(!AdaptiveXAUConfirm(signal, "ANTI-BIAS-SAME", combinedScore, grade,
                          sameLotPenalty, sameWhy, true))
   {
      reason = StringFormat("ANTI-BIAS BLOCK: recent %s losses=%d/%d and same-side fast confirmation failed. %s",
                            signal == 1 ? "BUY" : "SELL",
                            sameSideLosses, InpAntiBiasLookback, sameWhy);
      return false;
   }

   g_adaptiveConfirmLotMulti *= MathMin(1.0, sameLotPenalty * 0.70);
   g_adaptiveConfirmReason = "ANTI-BIAS defensive same-side retry: " + sameWhy;
   PrintFormat("ANTI-BIAS DEFENSIVE RETRY: %s losses=%d/%d; same side allowed only with reduced lot x%.2f. %s",
               signal == 1 ? "BUY" : "SELL", sameSideLosses, InpAntiBiasLookback,
               MathMin(1.0, sameLotPenalty * 0.70), sameWhy);
   return true;
}
void PruneStreak()
{
   datetime cutoff = TimeCurrent() - InpStreakWindowSec;
   while(ArraySize(closeTimes) > 0 && closeTimes[0] < cutoff)
   {
      int n = ArraySize(closeTimes) - 1;
      for(int i = 0; i < n; i++)
      {
         closeTimes[i] = closeTimes[i+1];
         closeResults[i] = closeResults[i+1];
         closeDirs[i] = closeDirs[i+1];
      }
      ArrayResize(closeTimes, n);
      ArrayResize(closeResults, n);
      ArrayResize(closeDirs, n);
   }
}
bool IsInStreakPause()
{
   return (streakPauseUntil > 0 && TimeCurrent() < streakPauseUntil);
}

//+------------------------------------------------------------------+
//| DAILY LOSS COUNTER & DRAWDOWN RECOVERY MODE                      |
//+------------------------------------------------------------------+
void UpdateDrawdownState(bool wasLoss)
{
   MqlDateTime dtNow, dtLast; TimeCurrent(dtNow); TimeToStruct(todayLossResetDay, dtLast);
   if(dtNow.day != dtLast.day)
   {
      todayLossCount = 0;
      todayLossResetDay = TimeCurrent();
      drawdownActive = false;
      todayReEntryCount = 0;     // reset re-entry quota daily
      RecomputeAutoScale();      // re-scale thresholds to current balance
   }
   if(wasLoss) todayLossCount++;
   else todayLossCount = 0;   // v6.3.2: single win fully resets loss counter (was -1 per win, stuck bot in recovery mode after 3L+1W)
   if(InpDrawdownMode)
   {
      bool newState = (todayLossCount >= InpDrawdownLosses);
      if(newState && !drawdownActive)
         Print("DRAWDOWN RECOVERY ON: risk reduced to ", DoubleToString(InpDrawdownRisk, 2), "%");
      if(!newState && drawdownActive)
         Print("DRAWDOWN RECOVERY OFF: normal risk restored");
      drawdownActive = newState;
   }
}

//+------------------------------------------------------------------+
//| RE-ENTRY DETECTOR — called every tick (cheap)                    |
//| Fires ONCE after a loss only if price has reset to a better       |
//| same-side level. This avoids buying higher/selling lower after    |
//| a failed trade just because price reclaimed the old entry.        |
//+------------------------------------------------------------------+
void CheckReEntryOpportunity()
{
   if(!InpUseReEntry) return;
   if(!lastClose.valid || !lastClose.wasLoss || lastClose.reEntered) return;
   if(TimeCurrent() - lastClose.closeTime > InpReEntryWindow) return;
   if(CountMyPositions() > 0) return;                  // Don't stack
   if(IsInStreakPause()) return;
   // Respect direction lockout — don't re-enter a side that's just been shown to fail
   if(IsDirectionLocked(lastClose.dir))
   {
      lastClose.reEntered = true;   // mark done so we don't keep checking
      Print("RE-ENTRY BLOCKED: side ", lastClose.dir==1?"BUY":"SELL",
            " is locked — respecting direction lockout");
      return;
   }
   if(todayReEntryCount >= InpMaxReEntriesPerDay)
   {
      // One-shot log to avoid spam
      static datetime lastCapLog = 0;
      if(TimeCurrent() - lastCapLog > 3600)
      { Print("RE-ENTRY CAP reached for today (", todayReEntryCount, "/", InpMaxReEntriesPerDay, ")"); lastCapLog = TimeCurrent(); }
      return;
   }
   if(InpUseNewsFilter && !IsNewsSafe()) return;

   double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   if(bid <= 0 || ask <= 0) return;
   double curPrice = (lastClose.dir == 1) ? ask : bid;
   if(InpReEntryBetterPriceOnly && lastClose.entryPrice > 0)
   {
      double betterBuffer = 0.0;
      if(ArraySize(bufATR) >= 2 && bufATR[1] > 0)
         betterBuffer = bufATR[1] * InpPostLossBetterATR;
      bool betterPrice = (lastClose.dir == 1)
                         ? (curPrice <= lastClose.entryPrice - betterBuffer)
                         : (curPrice >= lastClose.entryPrice + betterBuffer);
      if(!betterPrice)
      {
         static datetime lastBetterPriceLog = 0;
         if(TimeCurrent() - lastBetterPriceLog > 60)
         {
            Print("RE-ENTRY BLOCKED: last ", lastClose.dir==1?"BUY":"SELL",
                  " lost from entry ", DoubleToString(lastClose.entryPrice, _Digits),
                  ". Current ", DoubleToString(curPrice, _Digits),
                  " is not a better retest by ", DoubleToString(InpPostLossBetterATR, 2),
                  "x ATR; avoiding worse-price chase after loss.");
            lastBetterPriceLog = TimeCurrent();
         }
         return;
      }
   }
   // Legacy mode chased price past the failed entry. Better-price mode turns
   // re-entry into a retest-only recovery path.
   double trigger = lastClose.slDist * InpReEntryFactor;
   bool reversalBuy  = InpReEntryBetterPriceOnly
                       ? (lastClose.dir ==  1)
                       : (lastClose.dir ==  1 && curPrice >= lastClose.entryPrice + trigger);
   bool reversalSell = InpReEntryBetterPriceOnly
                       ? (lastClose.dir == -1)
                       : (lastClose.dir == -1 && curPrice <= lastClose.entryPrice - trigger);
   if(!reversalBuy && !reversalSell) return;

   // Use latest ATR for new SL sizing; bail if indicators not ready
   if(ArraySize(bufATR) < 2 || bufATR[1] <= 0) return;

   Print("RE-ENTRY TRIGGER (", todayReEntryCount+1, "/", InpMaxReEntriesPerDay, "): last ", lastClose.dir==1?"BUY":"SELL",
         " stopped at ", DoubleToString(lastClose.entryPrice, _Digits),
         " | price now ", DoubleToString(curPrice, _Digits),
         " | retest distance ", DoubleToString(MathAbs(curPrice-lastClose.entryPrice)/lastClose.slDist, 2), "R");

   lastClose.reEntered = true;  // one-shot per original close
   todayReEntryCount++;
   lastSignalDir = lastClose.dir;
   lastSignalSignature = lastClose.signature;
   lastSignalSetup = "RE_ENTRY";
   OpenTrade(lastClose.dir, bufATR[1], "RE_ENTRY", InpReEntrySize);
}

//+------------------------------------------------------------------+
//| SMC ENTRY LAYER (v6.1.0)                                         |
//| Additive confirmation: BOS + Order Block + FVG + Kill Zone       |
//| Raises score on confluent trades. BOS opposition = log only.     |
//| All existing gates, risk engine, and exits are UNTOUCHED.        |
//+------------------------------------------------------------------+

void SMC_DetectBOS(double atr)
{
   int lookback = InpSMC_BOS_Lookback;
   double swingHigh = 0.0;
   double swingLow  = DBL_MAX;

   for(int i = 2; i < lookback + 2; i++)
   {
      double h = iHigh(Symbol(), PERIOD_H1, i);
      double l = iLow(Symbol(),  PERIOD_H1, i);
      if(h <= 0 || l <= 0) break;
      // Simple pivot: bar i is swing high if higher than both neighbours
      double hPrev = iHigh(Symbol(), PERIOD_H1, i - 1);
      double hNext = iHigh(Symbol(), PERIOD_H1, i + 1);
      double lPrev = iLow(Symbol(),  PERIOD_H1, i - 1);
      double lNext = iLow(Symbol(),  PERIOD_H1, i + 1);
      if(hPrev > 0 && hNext > 0 && h > hPrev && h > hNext)
         if(h > swingHigh) swingHigh = h;
      if(lPrev > 0 && lNext > 0 && l < lPrev && l < lNext)
         if(l < swingLow)  swingLow  = l;
   }
   if(swingHigh <= 0 || swingLow >= DBL_MAX) return;

   double h1Close = iClose(Symbol(), PERIOD_H1, 1);
   if(h1Close <= 0) return;

   if(h1Close > swingHigh)      g_smc_bos_dir =  1;   // bullish BOS
   else if(h1Close < swingLow)  g_smc_bos_dir = -1;   // bearish BOS
   // If inside range, keep previous g_smc_bos_dir (BOS persists until next structural break)
}

void SMC_DetectOrderBlocks(double atr)
{
   g_smc_ob_bull.valid = false;
   g_smc_ob_bear.valid = false;
   if(atr <= 0) return;

   double currentPrice = iClose(Symbol(), PERIOD_M5, 1);
   if(currentPrice <= 0) return;

   double impulseMin = atr * InpSMC_ImpulseATR;    // min move away from OB to confirm impulse
   double obTol      = atr * InpSMC_OB_ToleranceATR;
   int    lookback   = InpSMC_OB_Lookback;

   for(int i = 2; i <= lookback + 2; i++)
   {
      double openH  = iOpen(Symbol(),  PERIOD_H1, i);
      double closeH = iClose(Symbol(), PERIOD_H1, i);
      double highH  = iHigh(Symbol(),  PERIOD_H1, i);
      double lowH   = iLow(Symbol(),   PERIOD_H1, i);
      if(openH <= 0 || closeH <= 0) break;

      // === BULLISH ORDER BLOCK ===
      // A bearish (down) H1 candle before a bullish impulse — becomes demand zone
      if(!g_smc_ob_bull.valid && closeH < openH)
      {
         // Find highest price reached since this candle (bars i-1 down to bar 1)
         double highestSince = 0.0;
         for(int j = i - 1; j >= 1; j--)
         {
            double hj = iHigh(Symbol(), PERIOD_H1, j);
            if(hj > highestSince) highestSince = hj;
         }
         bool impulseConfirmed = (highestSince - highH) >= impulseMin;
         // Price returning INTO the OB zone from above (demand test)
         bool inZone = (currentPrice >= lowH - obTol) && (currentPrice <= highH + obTol);

         if(impulseConfirmed && inZone)
         {
            g_smc_ob_bull.valid   = true;
            g_smc_ob_bull.dir     = 1;
            g_smc_ob_bull.high    = highH;
            g_smc_ob_bull.low     = lowH;
            g_smc_ob_bull.mid     = (highH + lowH) * 0.5;
            g_smc_ob_bull.barTime = iTime(Symbol(), PERIOD_H1, i);
         }
      }

      // === BEARISH ORDER BLOCK ===
      // A bullish (up) H1 candle before a bearish impulse — becomes supply zone
      if(!g_smc_ob_bear.valid && closeH > openH)
      {
         double lowestSince = DBL_MAX;
         for(int j = i - 1; j >= 1; j--)
         {
            double lj = iLow(Symbol(), PERIOD_H1, j);
            if(lj < lowestSince) lowestSince = lj;
         }
         bool impulseConfirmed = (lowH - lowestSince) >= impulseMin;
         bool inZone = (currentPrice >= lowH - obTol) && (currentPrice <= highH + obTol);

         if(impulseConfirmed && inZone)
         {
            g_smc_ob_bear.valid   = true;
            g_smc_ob_bear.dir     = -1;
            g_smc_ob_bear.high    = highH;
            g_smc_ob_bear.low     = lowH;
            g_smc_ob_bear.mid     = (highH + lowH) * 0.5;
            g_smc_ob_bear.barTime = iTime(Symbol(), PERIOD_H1, i);
         }
      }

      if(g_smc_ob_bull.valid && g_smc_ob_bear.valid) break;
   }
}

void SMC_DetectFVGs(double atr)
{
   g_smc_fvg_bull.valid = false;
   g_smc_fvg_bear.valid = false;
   if(atr <= 0) return;

   double currentPrice = iClose(Symbol(), PERIOD_M5, 1);
   if(currentPrice <= 0) return;

   double fvgTol  = atr * InpSMC_FVG_ToleranceATR;
   int    lookback = InpSMC_FVG_Lookback;
   double minGap   = atr * 0.2;   // FVG must be at least 0.2 ATR wide to matter

   for(int i = 2; i <= lookback; i++)
   {
      // Three-candle pattern: bars [i+1], [i], [i-1] on M15
      double highPrev = iHigh(Symbol(), PERIOD_M15, i + 1);
      double lowPrev  = iLow(Symbol(),  PERIOD_M15, i + 1);
      double highNext = iHigh(Symbol(), PERIOD_M15, i - 1);
      double lowNext  = iLow(Symbol(),  PERIOD_M15, i - 1);
      if(highPrev <= 0 || lowNext <= 0) break;

      // BULLISH FVG: gap between prev candle high and next candle low (unfilled space above)
      if(!g_smc_fvg_bull.valid && highPrev < lowNext)
      {
         double gapLow  = highPrev;
         double gapHigh = lowNext;
         if(gapHigh - gapLow >= minGap)
         {
            bool inZone = (currentPrice >= gapLow - fvgTol) && (currentPrice <= gapHigh + fvgTol);
            if(inZone)
            {
               g_smc_fvg_bull.valid   = true;
               g_smc_fvg_bull.dir     = 1;
               g_smc_fvg_bull.high    = gapHigh;
               g_smc_fvg_bull.low     = gapLow;
               g_smc_fvg_bull.mid     = (gapHigh + gapLow) * 0.5;
               g_smc_fvg_bull.barTime = iTime(Symbol(), PERIOD_M15, i);
            }
         }
      }

      // BEARISH FVG: gap between next candle high and prev candle low
      if(!g_smc_fvg_bear.valid && lowPrev > highNext)
      {
         double gapHigh = lowPrev;
         double gapLow  = highNext;
         if(gapHigh - gapLow >= minGap)
         {
            bool inZone = (currentPrice >= gapLow - fvgTol) && (currentPrice <= gapHigh + fvgTol);
            if(inZone)
            {
               g_smc_fvg_bear.valid   = true;
               g_smc_fvg_bear.dir     = -1;
               g_smc_fvg_bear.high    = gapHigh;
               g_smc_fvg_bear.low     = gapLow;
               g_smc_fvg_bear.mid     = (gapHigh + gapLow) * 0.5;
               g_smc_fvg_bear.barTime = iTime(Symbol(), PERIOD_M15, i);
            }
         }
      }

      if(g_smc_fvg_bull.valid && g_smc_fvg_bear.valid) break;
   }
}

bool SMC_InKillZone()
{
   if(!InpSMC_KillZones) return false;
   MqlDateTime dt;
   TimeCurrent(dt);
   int h = dt.hour;
   return ((h >= 7 && h < 10) ||    // London open
           (h >= 12 && h < 15) ||   // NY open
           (h == 15));               // London close
}

void SMC_Update()
{
   // Run once per closed M5 bar — no extra overhead on every tick
   datetime curBar = iTime(Symbol(), PERIOD_M5, 1);
   if(curBar <= 0 || curBar == g_smc_last_bar) return;

   double atr = (ArraySize(bufATR) >= 2) ? bufATR[1] : 0.0;
   if(atr <= 0) return;   // bufATR not yet loaded — do not stamp bar, retry next tick

   g_smc_last_bar = curBar;   // stamp only after confirmed good ATR
   SMC_DetectBOS(atr);
   SMC_DetectOrderBlocks(atr);
   SMC_DetectFVGs(atr);
}

// Returns the total SMC score bonus (positive = confluent, negative = opposed).
// Populates smcReason string for logging. Never blocks — only adjusts score.
double SMC_GetScoreBonus(int dir, string &smcReason)
{
   smcReason = "";
   if(!InpSMC_Enable || dir == 0) return 0.0;

   double atr = (ArraySize(bufATR) >= 2) ? bufATR[1] : 0.0;
   if(atr <= 0) return 0.0;

   double bonus = 0.0;
   double currentPrice = iClose(Symbol(), PERIOD_M5, 1);
   double obTol  = atr * InpSMC_OB_ToleranceATR;
   double fvgTol = atr * InpSMC_FVG_ToleranceATR;

   // --- BOS alignment (bonus only — no penalty; existing Smart Guard / EPF handle bad-direction trades) ---
   if(g_smc_bos_dir != 0 && g_smc_bos_dir == dir)
   {
      bonus += InpSMC_BOS_BonusScore;
      smcReason += StringFormat("BOS%+d(+%.1f) ", g_smc_bos_dir, InpSMC_BOS_BonusScore);
   }
   else if(g_smc_bos_dir != 0 && g_smc_bos_dir != dir)
   {
      // BOS opposes — log it for awareness but do NOT reduce score (keeps aggressive growth personality)
      smcReason += "BOS_OPP(log_only) ";
   }

   // --- Order Block zone ---
   if(dir == 1 && g_smc_ob_bull.valid &&
      currentPrice >= g_smc_ob_bull.low - obTol &&
      currentPrice <= g_smc_ob_bull.high + obTol)
   {
      bonus += InpSMC_OB_BonusScore;
      smcReason += StringFormat("BULL_OB[%.2f-%.2f](+%.1f) ",
                                g_smc_ob_bull.low, g_smc_ob_bull.high, InpSMC_OB_BonusScore);
   }
   if(dir == -1 && g_smc_ob_bear.valid &&
      currentPrice >= g_smc_ob_bear.low - obTol &&
      currentPrice <= g_smc_ob_bear.high + obTol)
   {
      bonus += InpSMC_OB_BonusScore;
      smcReason += StringFormat("BEAR_OB[%.2f-%.2f](+%.1f) ",
                                g_smc_ob_bear.low, g_smc_ob_bear.high, InpSMC_OB_BonusScore);
   }

   // --- FVG zone ---
   if(dir == 1 && g_smc_fvg_bull.valid &&
      currentPrice >= g_smc_fvg_bull.low - fvgTol &&
      currentPrice <= g_smc_fvg_bull.high + fvgTol)
   {
      bonus += InpSMC_FVG_BonusScore;
      smcReason += StringFormat("BULL_FVG[%.2f-%.2f](+%.1f) ",
                                g_smc_fvg_bull.low, g_smc_fvg_bull.high, InpSMC_FVG_BonusScore);
   }
   if(dir == -1 && g_smc_fvg_bear.valid &&
      currentPrice >= g_smc_fvg_bear.low - fvgTol &&
      currentPrice <= g_smc_fvg_bear.high + fvgTol)
   {
      bonus += InpSMC_FVG_BonusScore;
      smcReason += StringFormat("BEAR_FVG[%.2f-%.2f](+%.1f) ",
                                g_smc_fvg_bear.low, g_smc_fvg_bear.high, InpSMC_FVG_BonusScore);
   }

   // --- Kill zone timing ---
   if(SMC_InKillZone())
   {
      bonus += InpSMC_KZ_BonusScore;
      smcReason += StringFormat("KILL_ZONE(+%.1f) ", InpSMC_KZ_BonusScore);
   }

   return bonus;
}

//+------------------------------------------------------------------+
//| GATE 2: SESSION FILTER (UTC)                                     |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| ASIA RANGE TRACKER — builds high/low during Asia session (0-7h)  |
//| Locks when Asia ends; used by breakout setup at London/NY open    |
//+------------------------------------------------------------------+
void UpdateAsiaRange()
{
   MqlDateTime dt; TimeCurrent(dt);
   datetime today = TimeCurrent() - (TimeCurrent() % 86400);

   // Start fresh at day rollover
   if(today != asiaRangeDay)
   {
      asiaRangeDay = today;
      asiaRangeHigh = 0; asiaRangeLow = 0; asiaRangeLocked = false;
   }

   // Actively extend range during Asia hours (0-7 UTC-ish broker time)
   if(dt.hour >= 0 && dt.hour < 7)
   {
      double h = iHigh(Symbol(), PERIOD_M5, 1);
      double l = iLow(Symbol(),  PERIOD_M5, 1);
      if(h > 0 && (asiaRangeHigh == 0 || h > asiaRangeHigh)) asiaRangeHigh = h;
      if(l > 0 && (asiaRangeLow  == 0 || l < asiaRangeLow))  asiaRangeLow  = l;
      asiaRangeLocked = false;
   }
   else if(dt.hour >= 7 && asiaRangeHigh > 0 && asiaRangeLow > 0 && !asiaRangeLocked)
   {
      asiaRangeLocked = true;
      Print("ASIA RANGE LOCKED: High=", DoubleToString(asiaRangeHigh, _Digits),
            " Low=", DoubleToString(asiaRangeLow, _Digits),
            " (", DoubleToString(asiaRangeHigh - asiaRangeLow, _Digits), " pts)");
   }
}

double GetSessionQuality()
{
   MqlDateTime dt; TimeCurrent(dt);
   int h = dt.hour;
   // v6.3.2: London fix windows — RAISED 0.65→0.85. The 10:00 and 15:00 London fix
   // are high-liquidity directional events. Scoring them 0.65 was suppressing valid
   // LONDON_FIX_PIN setups below the B-grade (3.0) combined threshold.
   if((h == 10 && dt.min >= 20) || (h == 15 && dt.min <= 10)) return 0.85;
   // NY overlap 13-17 UTC
   if(h >= 13 && h < 17) return 1.00;
   // London 07-12 UTC
   if(h >= 7 && h < 13) return 0.95;
   // Asia 00-08 UTC
   if(h >= 0 && h < 8) return 0.70;
   // Late 22-24 UTC
   if(h >= 22) return 0.50;
   // Other
   return 0.80;
}

//+------------------------------------------------------------------+
//| GATE 3: SETUP SCORING (7 patterns, score 0-7)                    |
//| Returns: signal direction + score + setup name                   |
//+------------------------------------------------------------------+
int ScoreSetups(double &score, string &setupName)
{
   score = 0;
   setupName = "";
   double emaF = bufEMAFast[1], emaS = bufEMASlow[1];
   double rsi = bufRSI[1], atr = bufATR[1];
   double bbU = bufBBUpper[1], bbL = bufBBLower[1], bbM = bufBBMid[1];
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   double close2 = iClose(Symbol(), PERIOD_M5, 2);
   double open1 = iOpen(Symbol(), PERIOD_M5, 1);
   double high1 = iHigh(Symbol(), PERIOD_M5, 1);
   double low1 = iLow(Symbol(), PERIOD_M5, 1);
   double h1F = bufEMAFast_H1[1], h1S = bufEMASlow_H1[1];
   double m15RSI = bufRSI_M15[1];
   double body = MathAbs(close1 - open1);
   double range = high1 - low1;
   double lowerWick = MathMin(open1, close1) - low1;
   double upperWick = high1 - MathMax(open1, close1);

   // ====================================================================
   // v5.4.0 — HTF TREND-STRENGTH GATE (the missing piece)
   // Measures how strongly H1 is trending. Counter-trend mean-reversion
   // setups (RANGE_REVERSAL, RSI_EXTREME, LONDON_FIX_PIN, MULTI_EXTREME)
   // get a HARD VETO if H1 trend is strong against them. This is the
   // single biggest fix to the bot's "buy the dip into the falling knife"
   // behavior the user complained about.
   //
   // h1TrendDir: +1 = strong H1 uptrend, -1 = strong H1 downtrend, 0 = flat
   // ====================================================================
   double h1Spread = (h1S > 0) ? (h1F - h1S) / h1S : 0;          // relative spread between EMAs
   int    h1TrendDir = 0;
   if(h1Spread >  0.0015) h1TrendDir =  1;     // EMA-fast > 0.15% above slow = clear uptrend
   if(h1Spread < -0.0015) h1TrendDir = -1;     // EMA-fast < 0.15% below slow = clear downtrend
   // Stretch detector: how far has price moved off the H1 fast EMA?
   // If price is already 1.5×ATR away from H1 EMA fast, fading it is suicide.
   double h1Distance = (atr > 0) ? MathAbs(close1 - h1F) / atr : 0;
   bool   h1Stretched = h1Distance > 1.5;

   // v6.1.3 — HTF (context-TF / M30) trend direction for anti-trend veto
   // bufEMAFast_H4 / bufEMASlow_H4 are loaded from InpContextTF (default M30).
   double htfF = (ArraySize(bufEMAFast_H4) >= 2) ? bufEMAFast_H4[1] : 0.0;
   double htfS = (ArraySize(bufEMASlow_H4) >= 2) ? bufEMASlow_H4[1] : 0.0;
   double htfSpread = (htfS > 0) ? (htfF - htfS) / htfS : 0;
   int    htfTrendDir = 0;
   if(htfSpread >  0.0020) htfTrendDir =  1;   // context-TF clearly bullish
   if(htfSpread < -0.0020) htfTrendDir = -1;   // context-TF clearly bearish
   // Consensus: H1 + context-TF both agree = strong directional trend
   // Mean-reversion sells during H1+HTF bull consensus = the #1 account-killer.
   bool htfBullConsensus = (h1TrendDir == 1 && htfTrendDir == 1);
   bool htfBearConsensus = (h1TrendDir == -1 && htfTrendDir == -1);
   // v6.2.0: publish for CheckForEntry to use in scoring
   g_htfConsensusDir = htfBullConsensus ? 1 : (htfBearConsensus ? -1 : 0);

   int bestDir = 0;
   double bestScore = 0;
   string bestName = "";
   int bestType = 0;

   // === SETUP 1: TREND PULLBACK ===
   // v5.8.0: DATA-DRIVEN KILL. 74 trades, 50% WR, -$48,961 net (PF 0.38).
   // This setup was responsible for 80% of historical losses. DISABLED.
   // v6.1.4: HTF OVERRIDE — when H1+HTF consensus is active, also allow this setup
   // in RANGING and LOW_VOL regimes so the bot buys M5 dips within a confirmed H1
   // bull trend (or sells M5 rallies within a confirmed H1 bear trend).
   // Without this, htfBullConsensus blocked all SELLs AND M5 RANGING/LOW_VOL had no
   // BUY setup → bot sat silent all day even while gold trended up.
   if(InpAllowTrendPullback &&
      (currentRegime == REGIME_TRENDING_UP || currentRegime == REGIME_TRENDING_DOWN ||
       (htfBullConsensus && currentRegime != REGIME_DEAD) ||
       (htfBearConsensus && currentRegime != REGIME_DEAD)))
   {
      double s = 0;
      // v6.1.4: When H1+HTF consensus active, force direction to match HTF regardless of M5 regime.
      // This lets the bot buy the dip (in bull consensus) or sell the rally (in bear consensus).
      int dir;
      if(htfBullConsensus)       dir = 1;
      else if(htfBearConsensus)  dir = -1;
      else                        dir = (currentRegime == REGIME_TRENDING_UP) ? 1 : -1;
      if(dir == 1 && emaF > emaS) s += 1.0;
      if(dir == -1 && emaF < emaS) s += 1.0;
      if(dir == 1 && h1F > h1S) s += 1.5; // MTF aligned
      if(dir == -1 && h1F < h1S) s += 1.5;
      if(dir == 1 && close2 <= emaF * 1.003 && close1 > emaF) s += 1.5; // pullback bounce
      if(dir == -1 && close2 >= emaF * 0.997 && close1 < emaF) s += 1.5;
      if(dir == 1 && rsi > 40 && rsi < 65) s += 1.0;
      if(dir == -1 && rsi > 35 && rsi < 60) s += 1.0;
      if(dir == 1 && close1 > open1 && body > range * 0.3) s += 1.0; // strong candle
      if(dir == -1 && close1 < open1 && body > range * 0.3) s += 1.0;
      if(dir == 1 && m15RSI > 45 && m15RSI < 70) s += 0.5;
      if(dir == -1 && m15RSI > 30 && m15RSI < 55) s += 0.5;
      if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "TREND_PULLBACK"; bestType = 1; }
   }

   // === SETUP 2: RANGE REVERSAL ===
   // v5.4.0 — HARD VETO when H1 is strongly trending against. Catching the
   // bottom of a strong downtrend is the #1 cause of historical losses.
   if(currentRegime == REGIME_RANGING || currentRegime == REGIME_LOW_VOL || currentRegime == REGIME_CHOPPY)
   {
      // BUY at lower BB
      double s = 0; int dir = 0;
      if(close1 <= bbL + (bbU - bbL) * 0.2 && h1TrendDir >= 0 && !h1Stretched)
      {
         dir = 1; s += 1.0;
         if(rsi < 35) s += 1.5;
         if(body > 0 && lowerWick > body * 0.5) s += 1.5; // rejection wick (guard against doji)
         if(close1 > open1) s += 1.0;
         if(m15RSI < 40) s += 0.5;
         if(close2 < close1) s += 0.5; // momentum turning
         if(h1TrendDir == 1) s += 0.5;  // bonus if H1 actually aligned
      }
      if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "RANGE_REVERSAL"; bestType = 2; }

      // SELL at upper BB — v6.3.2: allow neutral H1 (h1TrendDir <= 0) matching BUY symmetry.
      // BUY allows h1TrendDir >= 0 (neutral or bullish). SELL was requiring h1TrendDir == -1 only,
      // creating a bullish bias in RANGING — SELL setups needed confirmed bearish H1 while BUY
      // only needed non-bearish. Hard-block on HTF bull consensus preserved.
      s = 0;
      if(close1 >= bbU - (bbU - bbL) * 0.2 && h1TrendDir <= 0 && !htfBullConsensus && !h1Stretched)
      {
         dir = -1; s += 1.0;
         if(rsi > 65) s += 1.5;
         if(body > 0 && upperWick > body * 0.5) s += 1.5; // rejection wick (guard against doji)
         if(close1 < open1) s += 1.0;
         if(m15RSI > 60) s += 0.5;
         if(close2 > close1) s += 0.5;
         if(htfTrendDir == -1) s += 0.5; // bonus if HTF also bearish
      }
      if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "RANGE_REVERSAL"; bestType = 2; }
   }

   // === SETUP 3: BREAKOUT ===
   // v5.8.0: DATA-DRIVEN KILL. 11 trades, 54% WR, -$8,048 net (PF 0.34).
   if(InpAllowBreakout &&
      (currentRegime == REGIME_BREAKOUT_UP || currentRegime == REGIME_BREAKOUT_DOWN))
   {
      double s = 0;
      int dir = currentRegime == REGIME_BREAKOUT_UP ? 1 : -1;
      s += 1.5; // breakout detected by regime
      if(dir == 1 && close1 > bbU && close2 <= bbU) s += 1.5; // fresh breakout
      if(dir == -1 && close1 < bbL && close2 >= bbL) s += 1.5;
      if(body > atr * 0.5) s += 1.0; // strong candle
      long vol = iVolume(Symbol(), PERIOD_M5, 1);
      long avgVol = (iVolume(Symbol(), PERIOD_M5, 2) + iVolume(Symbol(), PERIOD_M5, 3)) / 2;
      if(avgVol > 0 && vol > (long)(avgVol * 1.5)) s += 1.0; // volume spike
      if(dir == 1 && h1F > h1S) s += 1.0;
      if(dir == -1 && h1F < h1S) s += 1.0;
      if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "BREAKOUT"; bestType = 3; }
   }

   // === SETUP 4: SQUEEZE RELEASE ===
   // v6.1.3: added H1 trend gate — no short-squeeze sells during H1 uptrend
   {
      double bbW = (bbU - bbL) / close1 * 100;
      double prevW = 0;
      if(bufBBUpper[10] > 0) prevW = (bufBBUpper[10] - bufBBLower[10]) / iClose(Symbol(), PERIOD_M5, 10) * 100;
      if(prevW > 0 && bbW > prevW * 1.5) // BB expanding 50%+
      {
         double s = 1.5;
         int dir = close1 > bbM ? 1 : -1;
         // Block sell squeeze if H1 bullish; block buy squeeze if H1 bearish
         if(dir == -1 && (h1TrendDir == 1 || htfBullConsensus)) s = 0;
         if(dir ==  1 && (h1TrendDir == -1 || htfBearConsensus)) s = 0;
         if(s > 0)
         {
            if(body > atr * 0.4) s += 1.0;
            if(dir == 1 && rsi > 50) s += 0.5;
            if(dir == -1 && rsi < 50) s += 0.5;
            if(dir == 1 && emaF > emaS) s += 1.0;
            if(dir == -1 && emaF < emaS) s += 1.0;
            if(dir == 1 && h1F > h1S) s += 1.0;
            if(dir == -1 && h1F < h1S) s += 1.0;
         }
         if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "SQUEEZE_RELEASE"; bestType = 4; }
      }
   }

   // === SETUP 5: RSI EXTREME (like VWAP reclaim) ===
   {
      double s = 0; int dir = 0;
      if(rsi < 25 && close1 > open1 && h1TrendDir >= 0 && !h1Stretched) { dir = 1; s = 2.0 + (close1 > emaF ? 1.0 : 0) + (m15RSI < 30 ? 1.0 : 0) + (body > 0 && lowerWick > body ? 1.0 : 0); }
      if(rsi > 75 && close1 < open1 && h1TrendDir <= 0 && !h1Stretched) { dir = -1; s = 2.0 + (close1 < emaF ? 1.0 : 0) + (m15RSI > 70 ? 1.0 : 0) + (body > 0 && upperWick > body ? 1.0 : 0); }
      if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "RSI_EXTREME"; bestType = 5; }
   }

   // === SETUP 6: LONDON FIX PIN ===
   // v6.1.3: CRITICAL FIX — added H1 trend gate. Fading a spike into a strong bull
   // trend is suicide. Only fade spikes that go AGAINST H1 trend (i.e. a down-spike
   // in a downtrend = buy; an up-spike in an uptrend = DO NOT sell).
   {
      MqlDateTime dt; TimeCurrent(dt);
      bool isLondonFix = (dt.hour == 10 && dt.min >= 20 && dt.min <= 40) || (dt.hour == 15 && dt.min <= 15);
      if(isLondonFix)
      {
         double s = 1.5; int dir = 0;
         double move = close1 - iClose(Symbol(), PERIOD_M5, 4);
         // Spike up → fade sell ONLY if H1 is NOT bullish (don't sell gold bull spikes)
         if(move > atr * 0.8 && h1TrendDir != 1 && !htfBullConsensus) { dir = -1; s += 1.5; }
         // Spike down → fade buy ONLY if H1 is NOT bearish (don't buy gold bear spikes)
         if(move < -atr * 0.8 && h1TrendDir != -1 && !htfBearConsensus) { dir = 1; s += 1.5; }
         if(dir == 1 && rsi < 40) s += 1.0;
         if(dir == -1 && rsi > 60) s += 1.0;
         if(dir != 0 && body > atr * 0.3) s += 0.5;
         if(s > bestScore && dir != 0) { bestScore = s; bestDir = dir; bestName = "LONDON_FIX_PIN"; bestType = 6; }
      }
   }

   // === SETUP 7: DXY REVERSAL (simplified — use RSI divergence proxy) ===
   {
      // When gold RSI is oversold AND price at BB lower = likely bounce
      // When gold RSI is overbought AND price at BB upper = likely drop
      double s = 0; int dir = 0;
      if(rsi < 28 && close1 < bbL + (bbU - bbL) * 0.15 && m15RSI < 35 && h1TrendDir >= 0 && !h1Stretched)
      {
         dir = 1; s = 2.5 + (body > 0 && lowerWick > body * 0.5 ? 1.0 : 0) + (close1 > open1 ? 1.0 : 0);
      }
      // v6.1.3: require h1TrendDir == -1 (not just <= 0) and block on bull consensus
      if(rsi > 72 && close1 > bbU - (bbU - bbL) * 0.15 && m15RSI > 65 && h1TrendDir == -1 && !htfBullConsensus && !h1Stretched)
      {
         dir = -1; s = 2.5 + (body > 0 && upperWick > body * 0.5 ? 1.0 : 0) + (close1 < open1 ? 1.0 : 0);
      }
      if(s > bestScore && dir != 0) { bestScore = s; bestDir = dir; bestName = "MULTI_EXTREME"; bestType = 7; }
   }

   // === SETUP 8: ASIA RANGE BREAKOUT (gold-specific edge) ===
   // Active only after Asia is locked (07:00+) and price has just broken out with volume
   if(InpAsiaRangeBreakout && asiaRangeLocked && asiaRangeHigh > 0 && asiaRangeLow > 0)
   {
      MqlDateTime dt; TimeCurrent(dt);
      // Valid breakout window: London + NY (07:00 - 17:00)
      if(dt.hour >= 7 && dt.hour < 17)
      {
         double rangeSize = asiaRangeHigh - asiaRangeLow;
         // Only trust the break if Asia range isn't microscopic (>= 0.3 * ATR*10 ≈ reasonable size)
         if(rangeSize > atr * 1.5)
         {
            double s = 0; int dir = 0;
            // Fresh breakout: previous bar inside range, current bar outside
            bool freshBreakUp   = (close2 <= asiaRangeHigh && close1 > asiaRangeHigh);
            bool freshBreakDown = (close2 >= asiaRangeLow  && close1 < asiaRangeLow);
            // Or: continuation breakout within 3 bars of initial break
            double hi3 = MathMax(iHigh(Symbol(), PERIOD_M5, 2), iHigh(Symbol(), PERIOD_M5, 3));
            double lo3 = MathMin(iLow(Symbol(),  PERIOD_M5, 2), iLow(Symbol(),  PERIOD_M5, 3));
            bool contBreakUp    = (close1 > asiaRangeHigh && hi3 > asiaRangeHigh && hi3 < close1);
            bool contBreakDown  = (close1 < asiaRangeLow  && lo3 < asiaRangeLow  && lo3 > close1);

            if(freshBreakUp || contBreakUp) { dir = 1; s = freshBreakUp ? 3.0 : 2.0; }
            if(freshBreakDown || contBreakDown) { dir = -1; s = freshBreakDown ? 3.0 : 2.0; }

            if(dir != 0)
            {
               // Volume confirmation
               long v1 = iVolume(Symbol(), PERIOD_M5, 1);
               long vAvg = (iVolume(Symbol(), PERIOD_M5, 2) + iVolume(Symbol(), PERIOD_M5, 3) + iVolume(Symbol(), PERIOD_M5, 4)) / 3;
               if(vAvg > 0 && v1 > (long)(vAvg * 1.3)) s += 1.5;
               // Strong candle body
               if(body > atr * 0.5) s += 1.0;
               // MTF agreement
               if(dir == 1 && h1F > h1S) s += 1.0;
               if(dir == -1 && h1F < h1S) s += 1.0;
               // London/NY power hours
               if(dt.hour >= 13 && dt.hour < 17) s += 0.5;
               if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "ASIA_BREAKOUT"; bestType = 8; }
            }
         }
      }
   }

   // === SETUP 9: HTF TREND FOLLOW ===
   // v6.2.0: The "professional trader" setup. A skilled gold trader sees H1+HTF
   // both bullish and simply BUYS unless price is overbought or at a BB extreme.
   // They don't need M5 regime to be perfect. They don't multiply confidence levels.
   // They look at the big picture and take a position.
   //
   // This fills the gap where RANGING/LOW_VOL/CHOPPY M5 regime kills every other
   // setup, leaving the bot silent all day while gold trends. A human would trade.
   //
   // Hard blocks: overbought RSI, price at BB extreme, or DEAD market.
   // Everything else gets at least a B-grade entry via the HTF consensus bonus in
   // CheckForEntry (which adds +2.5 to combined score for HTF-confirmed trades).
   if(htfBullConsensus || htfBearConsensus)
   {
      int dir = htfBullConsensus ? 1 : -1;
      double s = 0;
      if(dir == 1 && currentRegime != REGIME_DEAD)
      {
         bool overextended = (rsi > 72) || (close1 >= bbU - (bbU - bbL) * 0.08);
         if(!overextended)
         {
            s = 2.5;                                                    // base: H1+HTF consensus
            if(h1F > h1S) s += 1.0;                                    // H1 EMA aligned
            if(rsi < 55)  s += 1.0; else if(rsi < 66) s += 0.5;       // RSI has room
            if(close1 > emaF)              s += 0.5;                   // above M5 EMA
            if(close1 > open1 && body > range * 0.2) s += 0.5;        // bullish candle
         }
      }
      if(dir == -1 && currentRegime != REGIME_DEAD)
      {
         bool overextended = (rsi < 28) || (close1 <= bbL + (bbU - bbL) * 0.08);
         if(!overextended)
         {
            s = 2.5;
            if(h1F < h1S) s += 1.0;                                    // H1 EMA aligned
            if(rsi > 45)  s += 1.0; else if(rsi > 34) s += 0.5;       // RSI has room
            if(close1 < emaF)              s += 0.5;                   // below M5 EMA
            if(close1 < open1 && body > range * 0.2) s += 0.5;        // bearish candle
         }
      }
      if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "HTF_TREND_FOLLOW"; bestType = 9; }
   }

   // v6.1.3 — GLOBAL ANTI-TREND VETO (last line of defence)
   // When H1 + context-TF are both clearly trending, block mean-reversion counter-trend
   // signals regardless of which setup generated them. Exemptions:
   //   type 1 = TREND_PULLBACK (direction forced to HTF in v6.1.4)
   //   type 3 = BREAKOUT (regime-aligned)
   //   type 8 = ASIA_BREAKOUT (range-break, can be in consensus direction)
   //   type 9 = HTF_TREND_FOLLOW (v6.2.0 — always in HTF consensus direction, never counter-trend)
   if(bestDir == -1 && htfBullConsensus && bestType != 1 && bestType != 3 && bestType != 8 && bestType != 9)
   {
      Print("ANTI-TREND VETO: H1+HTF both BULL — SELL blocked | setup=", bestName,
            " h1Spread=", DoubleToString(h1Spread*100, 3), "% htfSpread=", DoubleToString(htfSpread*100, 3), "%");
      bestDir = 0; bestScore = 0; bestName = "";
   }
   if(bestDir == 1 && htfBearConsensus && bestType != 1 && bestType != 3 && bestType != 8 && bestType != 9)
   {
      Print("ANTI-TREND VETO: H1+HTF both BEAR — BUY blocked | setup=", bestName,
            " h1Spread=", DoubleToString(h1Spread*100, 3), "% htfSpread=", DoubleToString(htfSpread*100, 3), "%");
      bestDir = 0; bestScore = 0; bestName = "";
   }
   // v6.1.4: TREND_PULLBACK-specific veto removed. TREND_PULLBACK now forces direction
   // to match HTF consensus, so a SELL can never fire when htfBullConsensus=true,
   // and a BUY can never fire when htfBearConsensus=true. Safety check below is a
   // backstop in case anything slips through.
   if(bestDir == -1 && htfBullConsensus && bestType == 1)
   {
      Print("ANTI-TREND VETO BACKSTOP: TREND_PULLBACK SELL during htfBullConsensus (should not happen in v6.1.4)");
      bestDir = 0; bestScore = 0; bestName = "";
   }
   if(bestDir == 1 && htfBearConsensus && bestType == 1)
   {
      Print("ANTI-TREND VETO BACKSTOP: TREND_PULLBACK BUY during htfBearConsensus (should not happen in v6.1.4)");
      bestDir = 0; bestScore = 0; bestName = "";
   }

   score = bestScore;
   setupName = bestName;
   lastSetupType = bestType;
   lastRegime = (int)currentRegime;
   return bestDir;
}

//+------------------------------------------------------------------+
//| PYRAMID / SCALE-IN (v4.4.5)                                      |
//| Adds a smaller same-direction position when:                     |
//|   • Price moved ≥ InpPyramidMinATR × ATR (adverse or with trend) |
//|   • Regime still supports direction                              |
//|   • Not direction-locked                                         |
//|   • ≥ InpPyramidMinGapSec since last add                         |
//|   • Not exceeding InpMaxPyramidAdds                              |
//| Sizes DECREASE by InpPyramidSizeMulti each add (no martingale).  |
//+------------------------------------------------------------------+
datetime lastPyramidAddTime = 0;
double   lastPyramidPx     = 0.0;        // v5.3.0 — tracks last add price for ATR-spacing check
// v5.3.1 — last entry's grade + score (used by adverse-pyramid signal-strength gate
// and by per-position high-grade ratchet looseness).
string   g_lastEntryGrade  = "B";
double   g_lastEntryScore  = 0.0;

bool IsSmartGuardDamageSetup(string setupName)
{
   return (StringFind(setupName, "TREND_PULLBACK") >= 0 ||
           StringFind(setupName, "BREAKOUT") >= 0);
}

bool IsGradeAtLeastA(string grade)
{
   return (StringCompare(grade, "A") == 0 || StringFind(grade, "A+") >= 0);
}

struct SmartGuardStats
{
   int    samples;
   int    wins;
   int    losses;
   double weight;
   double winRate;
   double expectancy;
};

void GetSmartGuardSetupStats(int setupType, SmartGuardStats &st)
{
   st.samples = 0; st.wins = 0; st.losses = 0;
   st.weight = 0.0; st.winRate = 50.0; st.expectancy = 0.0;
   if(setupType <= 0 || patternCount <= 0) return;

   double w = 1.0;
   double weightedWins = 0.0;
   double weightedPnl = 0.0;

   // Recency decay by pattern index: newest trade gets full weight, older
   // trades fade. This prevents one bad historical cluster from poisoning a
   // setup class forever and lets recent recovery rehabilitate it.
   for(int i = patternCount - 1; i >= 0 && st.samples < 100; i--)
   {
      if(patterns[i].setupType != setupType) continue;
      st.samples++;
      if(patterns[i].wasWinner) { st.wins++; weightedWins += w; }
      else st.losses++;
      weightedPnl += patterns[i].profit * w;
      st.weight += w;
      w *= 0.92;
   }

   if(st.weight > 0.0)
   {
      st.winRate = (weightedWins / st.weight) * 100.0;
      st.expectancy = weightedPnl / st.weight;
   }
}

bool SmartGuardStrongTrendRetest(int signal, double setupScore, double combinedScore)
{
   if(signal == 0 || combinedScore < InpSmartGuardOverrideScore) return false;
   double confirmLot = 1.0;
   string confirmWhy = "";
   if(!AdaptiveXAUConfirm(signal, "SMART-GUARD-RETEST", combinedScore, "B",
                          confirmLot, confirmWhy, false))
      return false;

   bool regimeAligned =
      (signal == 1 && (currentRegime == REGIME_TRENDING_UP || currentRegime == REGIME_BREAKOUT_UP)) ||
      (signal == -1 && (currentRegime == REGIME_TRENDING_DOWN || currentRegime == REGIME_BREAKOUT_DOWN));
   if(!regimeAligned) return false;

   double atr = (ArraySize(bufATR) >= 2) ? bufATR[1] : 0.0;
   if(atr <= 0.0) return false;
   double mom = (iClose(Symbol(), PERIOD_M5, 1) - iClose(Symbol(), PERIOD_M5, 5)) / atr;
   bool momentumAligned = (signal == 1 && mom >= 0.25) || (signal == -1 && mom <= -0.25);
   if(!momentumAligned) return false;

   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   bool cleanSpread = (InpMaxSpread <= 0 || spread <= InpMaxSpread * 0.85);
   return (cleanSpread && setupScore >= 3.0);
}

bool SmartGuardInactivityRelaxed()
{
   if(InpSmartGuardRelaxAfterMin <= 0 || CountMyPositions() > 0) return false;
   datetime anchor = lastTradeClose > 0 ? lastTradeClose : lastDayReset;
   if(anchor <= 0) return false;
   return (TimeCurrent() - anchor >= InpSmartGuardRelaxAfterMin * 60);
}

bool IsTrendContinuationRegime(int dir)
{
   if(dir > 0)
      return (currentRegime == REGIME_TRENDING_UP || currentRegime == REGIME_BREAKOUT_UP);
   return (currentRegime == REGIME_TRENDING_DOWN || currentRegime == REGIME_BREAKOUT_DOWN);
}

int EffectiveMaxTradesPerDay()
{
   int cap = InpMaxTradesPerDay;
   if(!InpAdaptiveDailyCap || cap <= 0) return cap;

   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   bool cleanTrend = (currentRegime == REGIME_TRENDING_UP || currentRegime == REGIME_TRENDING_DOWN ||
                      currentRegime == REGIME_BREAKOUT_UP || currentRegime == REGIME_BREAKOUT_DOWN);
   bool weakDay = (currentRegime == REGIME_CHOPPY || currentRegime == REGIME_DEAD || drawdownActive);
   double dPnL = accInfo.Equity() - dailyStartEquity;

   if(weakDay || dPnL < -MathMax(50.0, StrategyReferenceBalance() * 0.004))
      return MathMax(5, (int)MathFloor(cap * 0.65));

   if(cleanTrend && spread <= InpMaxSpread * 0.65 && dPnL >= 0)
      return MathMax(cap, InpMaxTradesStrongDay);

   return cap;
}

double AccountSizeRiskMultiplier()
{
   if(!InpAccountSizeBoost) return 1.0;
   double equity = StrategyReferenceBalance();
   if(equity < 1000.0)   return 0.75;
   if(equity < 10000.0)  return 1.00;
   if(equity < 25000.0)  return 1.08;
   if(equity < 75000.0)  return MathMin(1.22, InpLargeAccountBoostMax);
   return MathMin(1.35, InpLargeAccountBoostMax);
}

int EffectiveMaxPyramidAdds(int dir, double moved, double atr)
{
   int maxAdds = InpMaxPyramidAdds;
   if(maxAdds <= 0) return 0;

   bool trendOk = IsTrendContinuationRegime(dir);
   bool highQuality = (IsGradeAtLeastA(g_lastEntryGrade) && g_lastEntryScore >= 4.0) ||
                      (InpPyramidAllowProtectedB && g_lastEntryScore >= InpPyramidModerateScore);
   double equity = StrategyReferenceBalance();

   if(currentRegime == REGIME_CHOPPY || currentRegime == REGIME_DEAD || currentRegime == REGIME_LOW_VOL)
      maxAdds = MathMin(maxAdds, 1);
   if(!trendOk || !highQuality || drawdownActive)
      maxAdds = MathMin(maxAdds, 1);
   if(trendOk && highQuality && equity >= 25000.0 && moved >= atr * 1.2 && !drawdownActive)
      maxAdds = MathMin(MathMax(maxAdds, 3), MathMax(1, InpMaxOpenTrades - 1));
   if(trendOk && highQuality && equity >= 50000.0 && moved >= atr * 1.8 && !drawdownActive)
      maxAdds = MathMin(MathMax(maxAdds, 4), MathMax(1, InpMaxOpenTrades - 1));

   return MathMin(maxAdds, MathMax(0, InpMaxOpenTrades - 1));
}

double PyramidMomentumATR(int dir, double atr)
{
   if(dir == 0 || atr <= 0.0) return 0.0;
   double c1 = iClose(Symbol(), PERIOD_M5, 1);
   double c4 = iClose(Symbol(), PERIOD_M5, 4);
   if(c1 <= 0.0 || c4 <= 0.0) return 0.0;
   return (dir * (c1 - c4)) / atr;
}

bool PyramidAdaptiveConfirmPass(int dir, double score, string grade,
                                double &lotMulti, string &reason, bool &softOverride)
{
   lotMulti = 1.0;
   reason = "";
   softOverride = false;

   if(!InpPyramidRequireHTF)
      return true;

   if(AdaptiveXAUConfirm(dir, "PYRAMID", score, grade, lotMulti, reason, true))
      return true;

   if(!InpPyramidSoftNeutralConfirm)
      return false;

   bool hardOppose = (StringFind(reason, "multiple fast TFs against") >= 0 ||
                      StringFind(reason, "M5:AGAINST") >= 0 ||
                      StringFind(reason, "M15:AGAINST") >= 0 ||
                      StringFind(reason, "M30:AGAINST") >= 0 ||
                      StringFind(reason, "spread") >= 0 ||
                      StringFind(reason, "danger") >= 0 ||
                      StringFind(reason, "news") >= 0);
   bool neutralFast = (StringFind(reason, "M5:NEUTRAL") >= 0 ||
                       StringFind(reason, "M15:NEUTRAL") >= 0 ||
                       StringFind(reason, "M30:NEUTRAL") >= 0);
   bool h1Supports = (StringFind(reason, "H1:OK") >= 0 ||
                      StringFind(reason, "H1 aligned bonus") >= 0);
   bool scoreOk = (score >= InpPyramidSoftConfirmMinScore);
   bool softRescueContext = (scoreOk && !hardOppose &&
                             (neutralFast || h1Supports ||
                              StringFind(reason, "score below adaptive floor") >= 0));

   if(!softRescueContext)
      return false;

   double softMulti = h1Supports ? InpPyramidSoftConfirmLotMulti : InpPyramidNeutralConfirmLotMulti;
   lotMulti = MathMax(0.30, MathMin(1.0, softMulti));
   reason = "PYRAMID SOFT-CONFIRM: neutral fast TFs are not treated as opposite; reduced-size rescue may continue. Original: " + reason;
   softOverride = true;
   return true;
}

int AdaptivePyramidMaxAdds(int dir, double moved, double atr, double quality,
                           bool baseProtected, double atrExpansion, double sessionQuality)
{
   int maxAdds = EffectiveMaxPyramidAdds(dir, moved, atr);
   if(!InpPyramidAdaptiveEngine) return maxAdds;

   bool trendOk = IsTrendContinuationRegime(dir);
   bool weakRegime = (currentRegime == REGIME_CHOPPY ||
                      currentRegime == REGIME_DEAD ||
                      currentRegime == REGIME_LOW_VOL ||
                      currentRegime == REGIME_RANGING);
   double movedATR = (atr > 0.0) ? moved / atr : 0.0;
   double equity = MathMax(accInfo.Equity(), accInfo.Balance());

   if(weakRegime || !trendOk || atrExpansion > InpPyramidVolMaxExpansion || sessionQuality < InpPyramidSessionMin)
      return MathMin(maxAdds, 1);

   if(quality >= 72.0 && baseProtected && movedATR >= 1.10 && equity >= 25000.0 && !drawdownActive)
      maxAdds = MathMax(maxAdds, MathMin(3, MathMax(1, InpMaxOpenTrades - 1)));

   if(quality >= 84.0 && movedATR >= 1.60 && equity >= 50000.0 && atrExpansion <= 1.55)
      maxAdds = MathMax(maxAdds, MathMin(4, MathMax(1, InpMaxOpenTrades - 1)));

   return MathMin(maxAdds, MathMax(0, InpMaxOpenTrades - 1));
}

void CheckPyramidOpportunity()
{
   if(!InpAllowPyramid) return;
   if(IsInStreakPause()) return;
   if(drawdownActive) return;             // don't stack in drawdown recovery
   if(dailyLimitHit || weeklyLossHit) return;

   // v4.9.7 — Don't stack new risk into a basket that's already armed and protecting profit.
   // Adding fresh trades right before a basket-flush just creates micro-loss tickets
   // (e.g. fresh trade closes at -0.25 pips when basket triggers).
   if(InpBasketMode && g_basketArmed && (InpBasketBlockPyramidWhenArmed || InpPyramidNoAddIntoArmedBasket))
   {
      static datetime lastBlockLog = 0;
      if(TimeCurrent() - lastBlockLog > 120)
      {
         Print("PYRAMID BLOCKED: basket is ARMED — no new stacks until current cycle resolves. This prevents late add tickets from closing red during basket protection.");
         lastBlockLog = TimeCurrent();
      }
      return;
   }

   // Spread guard
   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   if(spread > InpMaxSpread) return;

   if(g_lastPyramidFailTime > 0 && TimeCurrent() - g_lastPyramidFailTime < InpPyramidFailCooldownSec)
      return;

   int openCount = CountMyPositions();
   if(openCount == 0) return;                               // no base trade to stack on
   if(openCount >= InpMaxOpenTrades) return;                // global cap

   // Find the ORIGINAL (oldest) position in our magic + determine direction
   ulong  origTicket = 0;
   datetime origTime = 0;
   long   origType   = -1;
   double origPx     = 0, origSL = 0, origLot = 0, smallestLot = 1e9;
   int    totalBuys  = 0, totalSells = 0;
   double totalLots  = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong tk = PositionGetTicket(i);
      if(!posInfo.SelectByTicket(tk)) continue;
      if(posInfo.Magic() != InpMagicNumber) continue;
      if(posInfo.Symbol() != Symbol()) continue;
      datetime pt = (datetime)PositionGetInteger(POSITION_TIME);
      if(origTime == 0 || pt < origTime)
      { origTime = pt; origTicket = tk; origType = posInfo.PositionType();
        origPx = posInfo.PriceOpen(); origSL = posInfo.StopLoss();
        origLot = posInfo.Volume(); }
      if(posInfo.PositionType() == POSITION_TYPE_BUY)  totalBuys++;
      else                                              totalSells++;
      double v = posInfo.Volume();
      if(v < smallestLot) smallestLot = v;
      totalLots += v;
   }
   if(origTicket == 0 || origType < 0) return;

   bool isBuy = (origType == POSITION_TYPE_BUY);
   int dir = isBuy ? 1 : -1;

   // Must not have opposite positions hedging (skip — ambiguous)
   if(totalBuys > 0 && totalSells > 0) return;

   // Respect direction lockout (a lost side should not be re-pyramided)
   if(IsDirectionLocked(dir)) return;

   bool pyramidGradeA = IsGradeAtLeastA(g_lastEntryGrade);
   if(InpPyramidRequireGradeA && !pyramidGradeA && !InpPyramidAllowProtectedB)
   {
      static datetime lastPyrGradeLog = 0;
      if(TimeCurrent() - lastPyrGradeLog > 120)
      {
         Print("PYRAMID SKIPPED: original entry grade ", g_lastEntryGrade,
               " is below A. Smart Guard requires A/A+ before stacking.");
         lastPyrGradeLog = TimeCurrent();
      }
      return;
   }

   double pyrConfirmLot = 1.0;
   string pyrConfirmWhy = "";
   bool pyrSoftConfirm = false;
   if(!PyramidAdaptiveConfirmPass(dir, g_lastEntryScore, g_lastEntryGrade,
                                  pyrConfirmLot, pyrConfirmWhy, pyrSoftConfirm))
   {
      static datetime lastPyrHtfLog = 0;
      if(TimeCurrent() - lastPyrHtfLog > 120)
      {
         Print("PYRAMID SKIPPED: adaptive fast confirmation failed for ",
               dir == 1 ? "BUY" : "SELL", " direction. ", pyrConfirmWhy);
         lastPyrHtfLog = TimeCurrent();
      }
      return;
   }
   if(pyrSoftConfirm)
   {
      static datetime lastPyrSoftConfirmLog = 0;
      if(TimeCurrent() - lastPyrSoftConfirmLog > 120)
      {
         Print("PYRAMID SOFT-CONFIRM: ", dir == 1 ? "BUY" : "SELL",
               " reduced-size rescue path enabled. ", pyrConfirmWhy);
         lastPyrSoftConfirmLog = TimeCurrent();
      }
   }

   // Regime must still support the direction
   ENUM_REGIME r = currentRegime;
   bool regimeOk = false;
   if(isBuy)
      regimeOk = (r == REGIME_TRENDING_UP || r == REGIME_BREAKOUT_UP);
   else
      regimeOk = (r == REGIME_TRENDING_DOWN || r == REGIME_BREAKOUT_DOWN);
   if(!regimeOk) return;

   // Need ATR for distance gate
   double atr = (ArraySize(bufATR) >= 2) ? bufATR[1] : 0;
   if(atr <= 0) return;

   double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   double curPx = isBuy ? bid : ask;
   if(curPx <= 0) return;

   // Distance from original entry
   double moved = isBuy ? (curPx - origPx) : (origPx - curPx);   // +ve = with us, -ve = against
   double minMove = atr * InpPyramidMinATR;

   bool adverseTrigger = (InpPyramidOnAdverse || InpPyramidRescueMode) && moved <= -minMove;
   bool trendTrigger   = InpPyramidOnTrend   && moved >= minMove;
   if(!adverseTrigger && !trendTrigger) return;

   double movedATR = moved / atr;
   double avgAtr = XAU_AvgATR(40);
   double atrExpansion = (avgAtr > 0.0) ? atr / avgAtr : 1.0;
   double sessionQuality = GetSessionQuality();
   double momentumATR = PyramidMomentumATR(dir, atr);
   double open1 = iOpen(Symbol(), PERIOD_M5, 1);
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   double close2 = iClose(Symbol(), PERIOD_M5, 2);
   double high1 = iHigh(Symbol(), PERIOD_M5, 1);
   double low1 = iLow(Symbol(), PERIOD_M5, 1);
   double body = MathAbs(close1 - open1);
   double barRange = MathMax(high1 - low1, 0.0);
   double upperWick = high1 - MathMax(open1, close1);
   double lowerWick = MathMin(open1, close1) - low1;
   bool rescueRejection = (barRange > 0.0 &&
                           ((dir < 0 && upperWick >= barRange * 0.28) ||
                            (dir > 0 && lowerWick >= barRange * 0.28)));
   bool baseProtected = (origSL > 0 && ((isBuy && origSL >= origPx) || (!isBuy && origSL <= origPx)));
   bool baseHealthy = (movedATR >= InpPyramidMinHealthATR || baseProtected);
   double adverseATR = MathMax(-movedATR, 0.0);
   bool cleanSpread = (InpMaxSpread <= 0 || spread <= InpMaxSpread * InpPyramidMaxSpreadFrac);
   double extensionATR = 0.0;
   double resetATR = 0.0;
   bool extensionNoReset = IsXAUExtensionResetMissing(dir, atr, extensionATR, resetATR);
   bool noDivergence = !HasExhaustionDivergence(dir);
   bool pyramidBaseWasLateChase = false;
   double pyramidBaseMissedMove = 0.0;
   double pyramidBaseMissedATR = 0.0;
   if(InpXAU_BlockLateChasePyramids &&
      g_signalFirstSeenTime > 0 &&
      g_signalFirstSeenDir == dir &&
      g_signalFirstSeenPrice > 0.0)
   {
      pyramidBaseMissedMove = dir > 0 ? (origPx - g_signalFirstSeenPrice)
                                      : (g_signalFirstSeenPrice - origPx);
      double anchorAtr = MathMax(atr, g_signalFirstATR);
      pyramidBaseMissedATR = anchorAtr > 0.0 ? pyramidBaseMissedMove / anchorAtr : 0.0;
      pyramidBaseWasLateChase = (pyramidBaseMissedMove > 0.0 &&
                                 (pyramidBaseMissedATR >= InpXAU_MaxMissedMoveATR ||
                                  pyramidBaseMissedMove >= InpXAU_MaxMissedMoveUSD));
   }
   if(pyramidBaseWasLateChase && !baseProtected)
   {
      static datetime lastLatePyrBlockLog = 0;
      if(TimeCurrent() - lastLatePyrBlockLog >= 60)
      {
         Print("PYRAMID BLOCKED: base trade was a late chase from first signal zone. firstPrice=",
               DoubleToString(g_signalFirstSeenPrice, 2),
               " baseEntry=", DoubleToString(origPx, 2),
               " missedMove=", DoubleToString(pyramidBaseMissedMove, 2),
               " (", DoubleToString(pyramidBaseMissedATR, 2),
               "ATR). No clustered add until base is protected or a fresh setup resets.");
         lastLatePyrBlockLog = TimeCurrent();
      }
      return;
   }
   bool eliteTrend = (g_lastEntryScore >= InpPyramidEliteScore && (pyramidGradeA || InpPyramidAllowProtectedB) && momentumATR >= 0.50);
   bool moderateTrend = (g_lastEntryScore >= InpPyramidModerateScore && momentumATR >= 0.25);
   bool rescueMode = (adverseTrigger && !trendTrigger && InpPyramidRescueMode);
   bool rescueElite = (g_lastEntryScore >= InpPyramidRescueEliteScore &&
                       adverseATR <= MathMin(InpPyramidRescueMaxATR, 1.45) &&
                       openCount == 1 && regimeOk && cleanSpread &&
                       noDivergence &&
                       pyrConfirmLot >= InpPyramidRescueConfirmMultiMin);
   bool rescueSmartNoTurn = (InpPyramidEliteRescueNoTurn && rescueElite);
   bool rescueSoftNoTurn = (pyrSoftConfirm &&
                            g_lastEntryScore >= InpPyramidSoftConfirmMinScore &&
                            adverseATR <= MathMin(InpPyramidRescueMaxATR, 1.25) &&
                            openCount == 1 && regimeOk && cleanSpread &&
                            noDivergence);
   int retestLookback = (int)MathMax(6.0, MathMin((double)InpPyramidRetestLookbackBars, 30.0));
   double retestHigh = 0.0, retestLow = DBL_MAX;
   for(int k = 2; k <= retestLookback + 1; k++)
   {
      double h = iHigh(Symbol(), PERIOD_M5, k);
      double l = iLow(Symbol(), PERIOD_M5, k);
      if(h > 0.0) retestHigh = MathMax(retestHigh, h);
      if(l > 0.0) retestLow = MathMin(retestLow, l);
   }
   if(retestHigh <= 0.0) retestHigh = high1;
   if(retestLow == DBL_MAX) retestLow = low1;
   double ema50 = (ArraySize(bufEMAFast) >= 2) ? bufEMAFast[1] : 0.0;
   double vwap = XAU_SessionVWAP(96);
   double retestZone = atr * InpPyramidRetestZoneATR;
   double breakZone = atr * InpPyramidRetestBreakATR;
   bool retestAgainstZone = false;
   bool retestReject = false;
   bool retestBreakAgainst = false;
   if(dir < 0)
   {
      retestAgainstZone = ((retestHigh > 0.0 && high1 >= retestHigh - retestZone) ||
                           (ema50 > 0.0 && high1 >= ema50 - retestZone) ||
                           (vwap > 0.0 && high1 >= vwap - retestZone));
      retestReject = ((upperWick >= MathMax(body * 0.45, atr * 0.08) && close1 <= open1) ||
                      (close1 < open1 && close1 < close2));
      retestBreakAgainst = (retestHigh > 0.0 && close1 > retestHigh + breakZone && body >= atr * 0.30);
   }
   else
   {
      retestAgainstZone = ((retestLow > 0.0 && low1 <= retestLow + retestZone) ||
                           (ema50 > 0.0 && low1 <= ema50 + retestZone) ||
                           (vwap > 0.0 && low1 <= vwap + retestZone));
      retestReject = ((lowerWick >= MathMax(body * 0.45, atr * 0.08) && close1 >= open1) ||
                      (close1 > open1 && close1 > close2));
      retestBreakAgainst = (retestLow > 0.0 && close1 < retestLow - breakZone && body >= atr * 0.30);
   }
   bool retestRescue = (InpPyramidRetestRescueMode &&
                        rescueMode &&
                        openCount == 1 &&
                        adverseATR <= InpPyramidRescueMaxATR &&
                        g_lastEntryScore >= InpPyramidRescueMinScore &&
                        regimeOk && cleanSpread && noDivergence &&
                        retestAgainstZone && retestReject && !retestBreakAgainst &&
                        pyrConfirmLot >= InpPyramidRescueConfirmMultiMin);
   bool rescueTurn = (momentumATR >= 0.05 || rescueRejection || retestRescue ||
                      (!InpPyramidRequireTurnForRescue && (rescueSmartNoTurn || rescueSoftNoTurn)));
   bool rescueCandidate = (rescueMode &&
                           openCount == 1 &&
                           adverseATR <= InpPyramidRescueMaxATR &&
                           g_lastEntryScore >= InpPyramidRescueMinScore &&
                           regimeOk && cleanSpread && rescueTurn &&
                           noDivergence);

   if(g_propFirmMode && adverseTrigger)
   {
      if(!g_propFirmAllowOneRetestAdd || !retestRescue)
      {
         Print("PROP-FIRM PYRAMID BLOCK: adverse averaging is disabled; only one confirmed retest add may pass.");
         return;
      }
      if(openCount > 1)
      {
         Print("PROP-FIRM PYRAMID BLOCK: one confirmed retest add already used.");
         return;
      }
   }

   double pyramidQuality = 0.0;
   if(regimeOk) pyramidQuality += 22.0;
   if(baseHealthy || rescueCandidate) pyramidQuality += 20.0;
   if(baseProtected) pyramidQuality += 10.0;
   if(cleanSpread) pyramidQuality += 12.0;
   if(sessionQuality >= 0.95) pyramidQuality += 10.0;
   else if(sessionQuality >= InpPyramidSessionMin) pyramidQuality += 6.0;
   if(atrExpansion >= InpPyramidVolMinExpansion && atrExpansion <= 1.30) pyramidQuality += 12.0;
   else if(atrExpansion <= InpPyramidVolMaxExpansion) pyramidQuality += 6.0;
   if(momentumATR >= 0.55) pyramidQuality += 14.0;
   else if(momentumATR >= 0.35) pyramidQuality += 8.0;
   else if(rescueCandidate && momentumATR >= 0.10) pyramidQuality += 5.0;
   if(pyramidGradeA) pyramidQuality += 8.0;
   else if(g_lastEntryScore >= InpPyramidModerateScore) pyramidQuality += 3.0;
   if(rescueCandidate) pyramidQuality += 8.0;
   if(retestRescue) pyramidQuality += 10.0;
   if(rescueSmartNoTurn) pyramidQuality += 6.0;
   if(rescueSoftNoTurn) pyramidQuality += 5.0;
   if(extensionNoReset) pyramidQuality -= 35.0;

   static datetime lastPyramidAuditLog = 0;
   bool pyrAuditDue = (TimeCurrent() - lastPyramidAuditLog >= 60);

   if(!cleanSpread)
   {
      if(pyrAuditDue)
      {
         Print("PYRAMID BLOCKED: spread not clean for add. spread=", DoubleToString(spread, 1),
               " maxAdd=", DoubleToString(InpMaxSpread * InpPyramidMaxSpreadFrac, 1),
               " | quality=", DoubleToString(pyramidQuality, 1));
         lastPyramidAuditLog = TimeCurrent();
      }
      return;
   }

   if(atrExpansion < InpPyramidVolMinExpansion || atrExpansion > InpPyramidVolMaxExpansion)
   {
      if(pyrAuditDue)
      {
         Print("PYRAMID BLOCKED: volatility not suitable. atrExp=", DoubleToString(atrExpansion, 2),
               " allowed=", DoubleToString(InpPyramidVolMinExpansion, 2), "-",
               DoubleToString(InpPyramidVolMaxExpansion, 2),
               " | quality=", DoubleToString(pyramidQuality, 1));
         lastPyramidAuditLog = TimeCurrent();
      }
      return;
   }

   if(extensionNoReset && trendTrigger)
   {
      if(pyrAuditDue)
      {
         Print("PYRAMID BLOCKED: move already extended without reset. drive=",
               DoubleToString(extensionATR, 2), "ATR reset=", DoubleToString(resetATR, 2),
               "ATR | prevents late add near exhaustion.");
         lastPyramidAuditLog = TimeCurrent();
      }
      return;
   }

   if(sessionQuality < InpPyramidSessionMin)
   {
      if(pyrAuditDue)
      {
         Print("PYRAMID BLOCKED: weak session quality ", DoubleToString(sessionQuality, 2),
               " < ", DoubleToString(InpPyramidSessionMin, 2));
         lastPyramidAuditLog = TimeCurrent();
      }
      return;
   }

   if(rescueMode && !rescueCandidate)
   {
      if(pyrAuditDue)
      {
         string retestWhy = "";
         if(InpPyramidRetestRescueMode)
         {
            if(retestBreakAgainst)
               retestWhy = " | RETEST_RESCUE_BLOCKED_BREAKOUT_AGAINST_TRADE";
            else if(!retestAgainstZone)
               retestWhy = " | RETEST_RESCUE_BLOCKED_NOT_AT_RETEST_ZONE";
            else if(!retestReject)
               retestWhy = " | RETEST_RESCUE_BLOCKED_NO_REJECTION";
            else
               retestWhy = " | RETEST_RESCUE_READY_BUT_OTHER_GATE_FAILED";
         }
         Print("PYRAMID-RESCUE BLOCKED: adverse add failed safety test. adverse=",
               DoubleToString(adverseATR, 2), "ATR max=", DoubleToString(InpPyramidRescueMaxATR, 2),
               " score=", DoubleToString(g_lastEntryScore, 2),
               " turn=", rescueTurn ? "Y" : "N",
               " reject=", rescueRejection ? "Y" : "N",
               " elite=", rescueElite ? "Y" : "N",
               " confirmMulti=", DoubleToString(pyrConfirmLot, 2),
               " noTurnOK=", rescueSmartNoTurn ? "Y" : "N",
               " soft=", rescueSoftNoTurn ? "Y" : "N",
               " retest=", retestRescue ? "Y" : "N",
               " zone=", retestAgainstZone ? "Y" : "N",
               " retestReject=", retestReject ? "Y" : "N",
               " breakAgainst=", retestBreakAgainst ? "Y" : "N",
               " open=", openCount,
               " divergence=", HasExhaustionDivergence(dir) ? "Y" : "N",
               retestWhy);
         lastPyramidAuditLog = TimeCurrent();
      }
      return;
   }

   if(trendTrigger && !baseHealthy)
   {
      if(pyrAuditDue)
      {
         Print("PYRAMID WAIT: base trade not healthy enough. moved=",
               DoubleToString(movedATR, 2), "ATR protected=", baseProtected ? "Y" : "N",
               " need=", DoubleToString(InpPyramidMinHealthATR, 2), "ATR/protected.");
         lastPyramidAuditLog = TimeCurrent();
      }
      return;
   }

   if(!pyramidGradeA)
   {
      if(!(rescueCandidate || (InpPyramidAllowProtectedB && baseHealthy && regimeOk && moderateTrend && pyramidQuality >= InpPyramidProtectedBQuality)))
      {
         if(pyrAuditDue)
         {
            Print("PYRAMID BLOCKED: B-grade add did not pass protected-continuation test. grade=",
                  g_lastEntryGrade, " score=", DoubleToString(g_lastEntryScore, 2),
                  " momentum=", DoubleToString(momentumATR, 2),
                  " quality=", DoubleToString(pyramidQuality, 1));
            lastPyramidAuditLog = TimeCurrent();
         }
         return;
      }
   }

   int adaptiveGapSec = InpPyramidMinGapSec;
   if(InpPyramidAdaptiveEngine && rescueCandidate)
   {
      adaptiveGapSec = InpPyramidMinGapSec / 2;
      if(adaptiveGapSec < 90) adaptiveGapSec = 90;
   }
   else if(InpPyramidAdaptiveEngine && eliteTrend && sessionQuality >= 0.95 && atrExpansion <= 1.25)
   {
      adaptiveGapSec = InpPyramidMinGapSec / 2;
      if(adaptiveGapSec < 120) adaptiveGapSec = 120;
   }
   if(!rescueCandidate && InpPyramidAdaptiveEngine && (atrExpansion > 1.45 || (!pyramidGradeA && !rescueCandidate)))
   {
      if(adaptiveGapSec < InpPyramidMinGapSec) adaptiveGapSec = InpPyramidMinGapSec;
      if(adaptiveGapSec < 420) adaptiveGapSec = 420;
   }

   if(TimeCurrent() - lastPyramidAddTime < adaptiveGapSec)
   {
      if(pyrAuditDue)
      {
         Print("PYRAMID WAIT: adaptive gap active. elapsed=", TimeCurrent() - lastPyramidAddTime,
               "s need=", adaptiveGapSec,
               "s | quality=", DoubleToString(pyramidQuality, 1),
               " elite=", eliteTrend ? "Y" : "N");
         lastPyramidAuditLog = TimeCurrent();
      }
      return;
   }

   if(EPF_BlockPyramidAdd())
   {
      bool epfOverride = (InpPyramidAdaptiveEngine &&
                          epf_tier <= InpPyramidAllowEPFUpToTier &&
                          ((trendTrigger && baseProtected && eliteTrend) || rescueCandidate) &&
                          pyramidQuality >= InpPyramidEPFOverrideQuality);
      if(!epfOverride)
      {
         if(pyrAuditDue)
         {
            Print("EPF-T", epf_tier, " PYRAMID BLOCKED: preservation mode. quality=",
                  DoubleToString(pyramidQuality, 1),
                  " protected=", baseProtected ? "Y" : "N",
                  " elite=", eliteTrend ? "Y" : "N");
            lastPyramidAuditLog = TimeCurrent();
         }
         return;
      }
      if(pyrAuditDue)
      {
         Print("EPF-T", epf_tier, " PYRAMID SOFT-ALLOW: protected elite continuation; size will be reduced.");
         lastPyramidAuditLog = TimeCurrent();
      }
   }

   if(!rescueCandidate && momentumATR < 0.15)
   {
      if(pyrAuditDue)
      {
         Print("PYRAMID BLOCKED: momentum not accelerating with trade. mom=",
               DoubleToString(momentumATR, 2), "ATR quality=", DoubleToString(pyramidQuality, 1));
         lastPyramidAuditLog = TimeCurrent();
      }
      return;
   }

   int maxAddsAllowed = AdaptivePyramidMaxAdds(dir, moved, atr, pyramidQuality,
                                               baseProtected, atrExpansion, sessionQuality);
   if(rescueCandidate) maxAddsAllowed = MathMin(maxAddsAllowed, 1);
   if(openCount >= 1 + maxAddsAllowed)
   {
      static datetime lastPyrCapLog = 0;
      if(TimeCurrent() - lastPyrCapLog > 180)
      {
         Print("PYRAMID SKIPPED: adaptive cap hit. Open=", openCount,
               " allowed total=", 1 + maxAddsAllowed,
               " | regime=", RegimeName(),
               " | grade=", g_lastEntryGrade,
               " | score=", DoubleToString(g_lastEntryScore, 2));
         lastPyrCapLog = TimeCurrent();
      }
      return;
   }

   if(trendTrigger && !baseProtected && moved < atr * 1.15 && !eliteTrend)
   {
      static datetime lastPyrProtectLog = 0;
      if(TimeCurrent() - lastPyrProtectLog > 180)
      {
         Print("PYRAMID SKIPPED: base trade not protected yet and trend move only ",
               DoubleToString(moved / atr, 2), " ATR. Waiting for SL lock or stronger continuation.");
         lastPyrProtectLog = TimeCurrent();
      }
      return;
   }

   // v5.3.1 — ADVERSE-PYRAMID SIGNAL-STRENGTH GATE.
   // Adverse adds (averaging-in against the move) are only allowed when the
   // ORIGINAL entry was a high-confidence A/A+ setup AND combined score still
   // ≥ InpAdvPyrMinScore. Trend-side adds (price moving with us) skip this
   // gate — those already proved themselves.
   if(adverseTrigger && !trendTrigger && !rescueCandidate)
   {
      bool isHighGrade = (StringCompare(g_lastEntryGrade, "A") == 0 || StringFind(g_lastEntryGrade, "A+") >= 0);
      if(!isHighGrade)
      {
         Print("PYRAMID-ADVERSE SKIPPED: original entry grade ", g_lastEntryGrade,
               " is not A/A+ (signal too weak to add into drawdown)");
         return;
      }
      if(g_lastEntryScore < InpAdvPyrMinScore)
      {
         Print("PYRAMID-ADVERSE SKIPPED: original entry score ",
               DoubleToString(g_lastEntryScore, 2),
               " < min ", DoubleToString(InpAdvPyrMinScore, 2));
         return;
      }
      // Also require structure to STILL support the original direction —
      // if an exhaustion divergence has appeared, abort the adverse stack.
      if(HasExhaustionDivergence(isBuy ? +1 : -1))
      {
         Print("PYRAMID-ADVERSE SKIPPED: RSI divergence appeared — structure no longer supports add");
         return;
      }
   }

   // v5.3.0 — ATR spacing gate: prevent stacking 4 pyramids inside a 1-bar
   // micro-move (which is what caused the 09:15 / 13:45 disasters). Require
   // the new price to be ≥ InpPyramidMinSpaceATR × ATR away from the previous
   // pyramid add.
   if(InpPyramidMinSpaceATR > 0 && lastPyramidPx > 0)
   {
      double adaptiveSpaceATR = InpPyramidMinSpaceATR;
      if(InpPyramidAdaptiveEngine && eliteTrend && sessionQuality >= 0.95 && atrExpansion <= 1.20)
         adaptiveSpaceATR = MathMax(0.45, InpPyramidMinSpaceATR * 0.75);
      if(InpPyramidAdaptiveEngine && !rescueCandidate && (atrExpansion > 1.45 || !pyramidGradeA))
         adaptiveSpaceATR = InpPyramidMinSpaceATR * 1.15;
      if(InpPyramidAdaptiveEngine && rescueCandidate)
         adaptiveSpaceATR = MathMax(0.50, InpPyramidMinSpaceATR * 0.80);
      double minSpace = atr * adaptiveSpaceATR;
      if(MathAbs(curPx - lastPyramidPx) < minSpace)
      {
         Print("PYRAMID SKIPPED: spacing ", DoubleToString(MathAbs(curPx - lastPyramidPx), 2),
               " < min ", DoubleToString(minSpace, 2), " (", DoubleToString(adaptiveSpaceATR, 2),
               "× ATR ", DoubleToString(atr, 2), ")");
         return;
      }
   }

   // v5.3.0 — share the master pre-trade gate with pyramid adds too. If
   // volatility/spread/exhaustion/news says don't trade, don't pyramid either.
   string preBlock = PreTradeBlockReason(isBuy ? +1 : -1, "PYRAMID");
   if(StringLen(preBlock) > 0)
   {
      if(pyrAuditDue)
      {
         Print("PYRAMID SKIPPED: ", preBlock);
         lastPyramidAuditLog = TimeCurrent();
      }
      return;
   }

   // v4.5.5 — PYRAMID SIZING FIX
   // Previous bug: used smallestLot × 0.6 which compounded: once first add hit
   // min-lot (0.01), every subsequent add was 0.01 too. Now we base off the
   // ORIGINAL position's lot size with geometric decrement (add#N = orig × multi^N).
   // This keeps sizing predictable and symmetric regardless of partial-TP state.
   double minLot  = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
   int lotDigits = 2;
   if(lotStep > 0 && lotStep < 0.01)  lotDigits = 3;
   if(lotStep > 0 && lotStep < 0.001) lotDigits = 4;

   // Base lot = ORIGINAL entry (oldest position in our magic)
   if(origLot <= 0) origLot = smallestLot;    // fallback safety
   if(origLot <= 0 || origLot >= 1e9) return; // sanity
   int addNumber = openCount; // 0th existing = original, so this is addNumber'th add
   // Geometric decrement: pow(multi, addNumber) → add#1=0.6x, add#2=0.36x, add#3=0.22x...
   double decayFactor = MathPow(InpPyramidSizeMulti, addNumber);
   double pyramidSizeMulti = 1.0;
   if(InpPyramidAdaptiveEngine)
   {
      if(retestRescue) pyramidSizeMulti = InpPyramidRetestRescueSizeMulti;
      else if(rescueCandidate) pyramidSizeMulti = InpPyramidRescueSizeMulti;
      else if(eliteTrend && pyramidQuality >= 88.0) pyramidSizeMulti = 1.15;
      else if(pyramidQuality >= 78.0) pyramidSizeMulti = 0.90;
      else pyramidSizeMulti = 0.65;
      if(!rescueCandidate)
      {
         if(!pyramidGradeA) pyramidSizeMulti *= 0.82;
         if(atrExpansion > 1.45) pyramidSizeMulti *= 0.75;
         if(sessionQuality < 0.95) pyramidSizeMulti *= 0.90;
         if(EPF_BlockPyramidAdd()) pyramidSizeMulti *= 0.70;
      }
   }
   if(g_propFirmMode && retestRescue)
      pyramidSizeMulti *= g_propFirmRetestAddLotMulti;
   double addLotRaw = origLot * decayFactor * pyrConfirmLot * pyramidSizeMulti;
   double addLot = MathFloor(addLotRaw / lotStep) * lotStep;
   addLot = NormalizeDouble(addLot, lotDigits);

   // v4.5.5 — SKIP pyramid entirely if the calculated lot would clamp to broker
   // minimum. A 0.01 pyramid add is pointless (doesn't change avg, adds spread/commission
   // risk) and causes the infinite-minLot-spam bug the user hit.
   if(addLot < minLot)
   {
      Print("PYRAMID: SKIP — origLot=", DoubleToString(origLot, lotDigits),
            " × ", DoubleToString(decayFactor, 3), " = ",
            DoubleToString(addLotRaw, 4),
            " would clamp to minLot ", DoubleToString(minLot, lotDigits),
            ". Pyramid pointless at this scale.");
      return;
   }

   // Hard caps
   if(addLot > maxLot)      addLot = NormalizeDouble(maxLot, lotDigits);
   if(addLot > InpMaxLots)  addLot = NormalizeDouble(InpMaxLots, lotDigits);

   // v4.6.0 — Stricter margin gate: require at least 25% free margin buffer.
   //          Throttled SKIP log so it doesn't spam every tick.
   double freeMargin = accInfo.FreeMargin();
   double equityNow  = accInfo.Equity();
   double freeMarginPct = equityNow > 0 ? (freeMargin / equityNow * 100.0) : 0;
   static datetime lastPyramidSkipLog = 0;
   bool pyrLogDue = (TimeCurrent() - lastPyramidSkipLog >= 60);
   if(freeMarginPct < 25.0)
   {
      if(pyrLogDue) {
         Print("PYRAMID: SKIP — free margin only ", DoubleToString(freeMarginPct,1),
               "% of equity (need ≥25%). Account too committed for another add.");
         lastPyramidSkipLog = TimeCurrent();
      }
      return;
   }
   double marginNeeded = 0;
   ENUM_ORDER_TYPE ot = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(OrderCalcMargin(ot, Symbol(), addLot, isBuy ? ask : bid, marginNeeded))
   {
      // v4.6.0 — relaxed from 0.5 → 0.7 so pyramid can fire even when 60% of margin is in use
      if(marginNeeded > freeMargin * 0.7)
      {
         if(pyrLogDue) {
            Print("PYRAMID: SKIP — add needs $", DoubleToString(marginNeeded,2),
                  " margin, only $", DoubleToString(freeMargin,2), " free.");
            lastPyramidSkipLog = TimeCurrent();
         }
         return;
      }
   }

   // SL same as original's SL (anchor risk).  TP = original's TP (shared).
   int    digits  = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double entryPx = isBuy ? ask : bid;

   // Compose reason label
   string why = "";
   if(adverseTrigger)
   {
      if(retestRescue)
         why = StringFormat("PYR+RETEST_RESCUE (%.2f ATR pullback, reject=Y, q=%.0f)",
                            MathAbs(moved)/atr, pyramidQuality);
      else if(rescueCandidate)
         why = StringFormat("PYR+RESCUE (%.2f ATR pullback, turn=%s, q=%.0f)",
                            MathAbs(moved)/atr, rescueTurn ? "Y" : "N", pyramidQuality);
      else
         why = StringFormat("PYR+ADV (%.2f ATR adverse, avg-in)", MathAbs(moved)/atr);
   }
   else
   {
      why = StringFormat("PYR+TRN (%.2f ATR with trend, q=%.0f, mom=%.2f, atrExp=%.2f)",
                         moved/atr, pyramidQuality, momentumATR, atrExpansion);
   }

   // Get original TP too
   posInfo.SelectByTicket(origTicket);
   double origTP = posInfo.TakeProfit();

   // v4.5.6 — Don't inherit a BE-locked SL. If the original SL has been moved
   // past breakeven (i.e., "above entry" for BUY, "below entry" for SELL), the
   // pyramid add would inherit a dangerously tight SL relative to its own entry
   // price (adverse/trend continuation price). Instead, place a fresh ATR-based
   // SL for the pyramid add so it has normal breathing room.
   double pyramidSL = origSL;
   double freshSlDist = atr * InpSLMultiplier;
   if(isBuy && origSL > origPx)
   {
      pyramidSL = NormalizeDouble(entryPx - freshSlDist, digits);
      Print("PYRAMID SL: origSL ", DoubleToString(origSL, digits),
            " was BE-locked — using fresh SL ", DoubleToString(pyramidSL, digits),
            " (", DoubleToString(freshSlDist, 2), " pts = ", DoubleToString(InpSLMultiplier, 2), "xATR)");
   }
   if(!isBuy && origSL > 0 && origSL < origPx)
   {
      pyramidSL = NormalizeDouble(entryPx + freshSlDist, digits);
      Print("PYRAMID SL: origSL ", DoubleToString(origSL, digits),
            " was BE-locked — using fresh SL ", DoubleToString(pyramidSL, digits),
            " (", DoubleToString(freshSlDist, 2), " pts = ", DoubleToString(InpSLMultiplier, 2), "xATR)");
   }

   double pyramidRiskPerLot = RiskPerLotForDistance(MathAbs(entryPx - pyramidSL));
   double beforeRiskCapLot = addLot;
   if(pyramidRiskPerLot > 0)
   {
      double equity = accInfo.Equity();
      double effectiveSingleCap = EffectiveSingleRiskCapPct();
      if(effectiveSingleCap > 0)
      {
         double maxSingleLoss = equity * effectiveSingleCap / 100.0;
         double maxSingleLots = maxSingleLoss / pyramidRiskPerLot;
         if(addLot > maxSingleLots)
         {
            addLot = NormalizeVolumeDown(maxSingleLots);
            Print("PYRAMID SINGLE-RISK CAP: ", DoubleToString(beforeRiskCapLot, lotDigits),
                  " -> ", DoubleToString(addLot, lotDigits),
                  " | candidate risk $", DoubleToString(beforeRiskCapLot * pyramidRiskPerLot, 0),
                  " > ", DoubleToString(effectiveSingleCap, 2), "% equity ($",
                  DoubleToString(maxSingleLoss, 0), ")");
         }
      }

      double effectiveAggregateCap = EffectiveAggregateRiskCapPct();
      if(effectiveAggregateCap > 0)
      {
         double openRiskLots = 0.0;
         double openRisk = CurrentAggregateRiskToSL(openRiskLots);
         double maxAggRisk = equity * effectiveAggregateCap / 100.0;
         double remainingRisk = maxAggRisk - openRisk;
         if(remainingRisk <= 0)
         {
            Print("PYRAMID BLOCKED: aggregate risk already $", DoubleToString(openRisk, 0),
                  " (", DoubleToString(openRiskLots, 2), " lots) >= max $",
                  DoubleToString(maxAggRisk, 0), ". No room for add.");
            return;
         }
         double maxAggLots = remainingRisk / pyramidRiskPerLot;
         if(addLot > maxAggLots)
         {
            double beforeAggCapLot = addLot;
            addLot = NormalizeVolumeDown(maxAggLots);
            Print("PYRAMID AGG-RISK CAP: ", DoubleToString(beforeAggCapLot, lotDigits),
                  " -> ", DoubleToString(addLot, lotDigits),
                  " | openRisk=$", DoubleToString(openRisk, 0),
                  " candidate=$", DoubleToString(beforeAggCapLot * pyramidRiskPerLot, 0),
                  " maxAgg=$", DoubleToString(maxAggRisk, 0));
         }
      }

      if(addLot < minLot)
      {
         Print("PYRAMID SKIPPED: risk caps reduced add below broker min. minLot=",
               DoubleToString(minLot, lotDigits),
               " riskPerLot=$", DoubleToString(pyramidRiskPerLot, 2));
         return;
      }
   }

   Print("PYRAMID: adding #", openCount + 1, "/", (1 + maxAddsAllowed),
         " ", isBuy?"BUY":"SELL", " ", DoubleToString(addLot, lotDigits),
         " lots @ ", DoubleToString(entryPx, digits),
         " | origPx=", DoubleToString(origPx, digits),
         " | moved=", DoubleToString(moved, 2),
         " (", DoubleToString(movedATR, 2), "ATR)",
         " | totalLots=", DoubleToString(totalLots, lotDigits),
         " | quality=", DoubleToString(pyramidQuality, 1),
         " | sizeMulti=", DoubleToString(pyramidSizeMulti, 2),
         " | confirmMulti=", DoubleToString(pyrConfirmLot, 2),
         " | session=", DoubleToString(sessionQuality, 2),
         " | atrExp=", DoubleToString(atrExpansion, 2),
         " | baseProtected=", baseProtected ? "Y" : "N",
         " | rescue=", rescueCandidate ? "Y" : "N",
         " | retestRescue=", retestRescue ? "Y" : "N",
         " | rejection=", rescueRejection ? "Y" : "N",
         " | retestZone=", retestAgainstZone ? "Y" : "N",
         " | retestBreakAgainst=", retestBreakAgainst ? "Y" : "N",
         " | riskPerLot=$", DoubleToString(pyramidRiskPerLot, 0),
         " | ", why);

   bool ok;
   if(isBuy) ok = trade.Buy (addLot, Symbol(), 0, pyramidSL, origTP, "XAU-SNIPER|" + why);
   else      ok = trade.Sell(addLot, Symbol(), 0, pyramidSL, origTP, "XAU-SNIPER|" + why);

   if(ok)
   {
      lastPyramidAddTime = TimeCurrent();
      lastPyramidPx      = entryPx;       // v5.3.0 — for ATR spacing gate
      todayTradeCount++;
      Print("PYRAMID OK");
      BotMonitorActivity("PYRAMID_ADD", "TRADE",
                         StringFormat("PYRAMID #%d %.2f lot @%.2f - %s",
                                      openCount + 1, addLot, entryPx, why));

      // v5.2.2 — fan pyramid add to XauAi Cloud subscribers (was previously
      // missing; pyramid adds went master-only, breaking 1:1 mirror).
      if(CloudEnabled())
      {
         ulong dealTicket = trade.ResultDeal();
         ulong posId = 0;
         if(dealTicket > 0 && HistoryDealSelect(dealTicket))
            posId = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
         if(posId == 0) posId = trade.ResultOrder();
         double riskHintPct = InpRiskPercent;
         if(InpAccountMode == ACCT_BALANCED)     riskHintPct = 1.2;
         if(InpAccountMode == ACCT_CONSERVATIVE) riskHintPct = 0.6;
         if(InpAccountMode == ACCT_AGGRESSIVE)   riskHintPct = 2.0;
         string sigId = CloudPostSignal(Symbol(), isBuy ? "BUY" : "SELL",
                                        entryPx, pyramidSL, origTP,
                                        "PYR", riskHintPct,
                                        addLot, accInfo.Balance());
         if(StringLen(sigId) > 0 && posId > 0) CloudMapAdd(posId, sigId);
         CloudPostReasoning("PYR", StringFormat("PYRAMID #%d %.2f lot @%.2f — %s | q=%.0f sizeMulti=%.2f",
                                                openCount + 1, addLot, entryPx, why,
                                                pyramidQuality, pyramidSizeMulti),
                            RegimeName(), "", 0.0, 0.0, "PYR", isBuy ? +1 : -1);
      }
   }
   else
   {
      Print("PYRAMID FAILED: Err=", GetLastError(), " Ret=", trade.ResultRetcode());
      g_lastPyramidFailTime = TimeCurrent();
   }
}

//+------------------------------------------------------------------+
//| TICK                                                             |
//+------------------------------------------------------------------+

// ====================================================================
// v5.5.0 — EQUITY PRESERVATION FRAMEWORK FUNCTIONS
// ====================================================================

// Computes current EPF tier (0-4) from live conditions.
// v5.7.0 — EQUITY-ONLY. Removed consecutive-loss escalation per user feedback:
// "after losses become safer" was creating a death spiral. Strategy stays
// stable; only position size adapts via lot multiplier. Tier escalation now
// driven SOLELY by daily P&L milestones and peak-retrace.
int EPF_ComputeTier()
{
   if(!InpEPF_Enable || dailyStartEquity <= 0) return 0;
   double equity = accInfo.Equity();
   double dayGainPct = (equity - dailyStartEquity) / dailyStartEquity * 100.0;
   double peakGainPct = (pg_dayHWM - dailyStartEquity) / dailyStartEquity * 100.0;
   double retraceFromPeakPct = (peakGainPct > InpEPF_PeakMinPct)
                               ? (peakGainPct - dayGainPct) : 0.0;
   double slack = (dayGainPct < epf_lastDailyGainPct) ? 1.0 : 0.0;

   int tier = 0;
   if(dayGainPct >= InpEPF_DailyT1Pct - slack) tier = 1;
   if(dayGainPct >= InpEPF_DailyT2Pct - slack) tier = 2;
   if(dayGainPct >= InpEPF_DailyT3Pct - slack) tier = 3;
   if(dayGainPct >= InpEPF_DailyT4Pct - slack) tier = 4;

   if(retraceFromPeakPct >= InpEPF_PeakRetracePct && peakGainPct >= InpEPF_PeakMinPct)
      tier = MathMax(tier, 2);
   if(retraceFromPeakPct >= InpEPF_PeakRetracePct * 1.5 && peakGainPct >= InpEPF_PeakMinPct)
      tier = MathMax(tier, 3);

   // v5.7.0 — Consecutive-loss tier escalation REMOVED. Old code that bumped
   // tier on N losses is gone. User explicitly requested: "stop strategy
   // switching based on emotional logic like 'after losses become safer'".

   // v5.7.0 — HARD DAILY DRAWDOWN STOP. If account has lost more than
   // InpEPF_HardDailyDDPct % of starting equity today, lockdown for the day.
   // This is OBJECTIVE protection (not "safer mode"), kicks in only after
   // significant damage to prevent total destruction.
   if(InpEPF_HardDailyDDPct > 0 && dayGainPct <= -InpEPF_HardDailyDDPct)
      tier = 4;

   epf_lastDailyGainPct = dayGainPct;
   return tier;
}

// Lot-size multiplier applied to every new entry (not pyramids).
double EPF_LotMultiplier()
{
   if(!InpEPF_Enable) return 1.0;
   switch(epf_tier)
   {
      case 1: return 0.85;
      case 2: return 0.65;
      case 3: return 0.40;
      case 4: return InpEPF_T4AdaptiveAllowElite ? 1.0 : 0.0;   // adaptive T4 pass applies its own tiny multiplier
      default: return 1.0;
   }
}

bool EPF_IsEliteGrade(string grade)
{
   if(!InpEPF_T4RequireAorB) return true;
   return (grade == "A" || grade == "A+" || grade == "B" || grade == "B+" ||
           StringFind(grade, "A") >= 0 || StringFind(grade, "B") >= 0);
}

// Returns empty string if entry is allowed, or a reason string for block.
// v5.8.38 — T4 is no longer a blind robot lock. Hard daily drawdown still
// blocks, but elite signals can pass in guarded mode with tiny reduced size.
string EPF_EntryBlockReason(string grade, double setupScore, double combinedScore, int signal,
                            double &adaptiveLotMult, bool &adaptivePass)
{
   adaptiveLotMult = 1.0;
   adaptivePass = false;
   if(!InpEPF_Enable || epf_tier == 0) return "";
   if(epf_tier >= 4)
   {
      double eq = accInfo.Equity();
      double dayPct = (dailyStartEquity > 0.0) ? ((eq - dailyStartEquity) / dailyStartEquity * 100.0) : 0.0;
      if(InpEPF_T4BlockHardDD && InpEPF_HardDailyDDPct > 0.0 && dayPct <= -InpEPF_HardDailyDDPct)
         return StringFormat("EPF-T4 HARD LOCKDOWN: daily drawdown %.1f%% reached hard %.1f%% limit",
                             dayPct, -InpEPF_HardDailyDDPct);
      if(!InpEPF_T4AdaptiveAllowElite)
         return "EPF-T4 LOCKDOWN (adaptive elite pass disabled)";
      if(!EPF_IsEliteGrade(grade))
         return StringFormat("EPF-T4 guarded mode: %s grade blocked; only elite A/B signals may pass", grade);
      if(setupScore < InpEPF_T4EliteSetupScore || combinedScore < InpEPF_T4EliteCombinedScore)
         return StringFormat("EPF-T4 guarded mode: score below elite floor setup=%.1f/%.1f combined=%.1f/%.1f",
                             setupScore, InpEPF_T4EliteSetupScore, combinedScore, InpEPF_T4EliteCombinedScore);
      if(epf_t4AdaptiveTradesToday >= InpEPF_T4MaxTradesPerDay)
         return StringFormat("EPF-T4 guarded mode: max reduced trades reached (%d/%d)",
                             epf_t4AdaptiveTradesToday, InpEPF_T4MaxTradesPerDay);
      int waitSec = InpEPF_T4MinMinutesBetween * 60 - (int)(TimeCurrent() - epf_t4LastAdaptiveTrade);
      if(epf_t4LastAdaptiveTrade > 0 && waitSec > 0)
         return StringFormat("EPF-T4 guarded mode: waiting %d min before next reduced trade", (waitSec + 59) / 60);

      adaptiveLotMult = MathMax(0.05, MathMin(0.35, InpEPF_T4EliteLotMult));
      adaptivePass = true;
      return "";
   }
   // T1/T2/T3 do NOT block — they only reduce lot size via EPF_LotMultiplier().
   return "";
}

string EPF_BlockReason(string grade, double setupScore, int signal)
{
   double unusedLot = 1.0;
   bool unusedPass = false;
   return EPF_EntryBlockReason(grade, setupScore, setupScore, signal, unusedLot, unusedPass);
}

// Returns true if a pyramid ADD should be blocked by current tier.
// (We don't block initial entries via this — that's EPF_BlockReason's job.)
bool EPF_BlockPyramidAdd()
{
   if(!InpEPF_Enable) return false;
   // T2+ disables NEW pyramid adds. Existing pyramids continue to be managed.
   return epf_tier >= 2;
}

// Cluster protection: refuses entries too close in price+time to an existing
// same-direction position with our magic. Prevents the "stacking 5 positions
// in 3 minutes during a reversal" failure mode.
bool EPF_IsClusteredEntry(int signal, double entryPx, double atr)
{
   if(!InpEPF_Enable || !InpEPF_BlockClusters) return false;
   if(atr <= 0) return false;
   double minDist = atr * InpEPF_ClusterATR;
   datetime cutoff = TimeCurrent() - InpEPF_ClusterMaxSec;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if((long)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      ENUM_POSITION_TYPE pt = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      int posDir = (pt == POSITION_TYPE_BUY) ? 1 : -1;
      if(posDir != signal) continue;
      datetime openedAt = (datetime)PositionGetInteger(POSITION_TIME);
      if(openedAt < cutoff) continue;
      double posPx = PositionGetDouble(POSITION_PRICE_OPEN);
      if(MathAbs(posPx - entryPx) < minDist) return true;
   }
   return false;
}

// Records a ticket as "partial-closed already" so we don't double-close it.
bool EPF_AlreadyPartialClosed(ulong ticket)
{
   for(int i = 0; i < epf_partialClosedCnt && i < 20; i++)
      if((ulong)epf_partialClosed[i] == ticket) return true;
   return false;
}
void EPF_MarkPartialClosed(ulong ticket)
{
   if(epf_partialClosedCnt < 20)
   {
      epf_partialClosed[epf_partialClosedCnt] = (int)ticket;
      epf_partialClosedCnt++;
   }
}

// PROFIT-PROTECTION: At T1+ with partial-close enabled, close 50% of a
// position once it reaches +1.5R unrealized profit AND the trade is
// trend-aligned with H1 EMAs. This locks in real gains while letting the
// remainder run with the trail. Big asymmetric advantage during winning
// phases.
void EPF_ManagePartials()
{
   if(!InpEPF_Enable || !InpEPF_PartialClose || InpCloudSafeDisablePartials) return;
   if(epf_tier < 1) return;
   double atr = ArraySize(bufATR) > 1 ? bufATR[1] : 0;
   if(atr <= 0) return;
   double h1F = ArraySize(bufEMAFast_H1) > 1 ? bufEMAFast_H1[1] : 0;
   double h1S = ArraySize(bufEMASlow_H1) > 1 ? bufEMASlow_H1[1] : 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if((long)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if(EPF_AlreadyPartialClosed(t)) continue;
      double volume = PositionGetDouble(POSITION_VOLUME);
      if(volume < 0.02) continue;  // can't split a 0.01 lot
      double entryPx = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      if(sl <= 0) continue;        // need SL to compute R
      double rDist = MathAbs(entryPx - sl);
      if(rDist <= 0) continue;
      double curPx = PositionGetDouble(POSITION_PRICE_CURRENT);
      ENUM_POSITION_TYPE pt = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      bool isBuy = (pt == POSITION_TYPE_BUY);
      double profit = isBuy ? (curPx - entryPx) : (entryPx - curPx);
      if(profit < rDist * 1.5) continue;       // need +1.5R
      // Trend-aligned check
      bool aligned = (isBuy && h1F > h1S) || (!isBuy && h1F < h1S);
      if(!aligned) continue;
      // Close 50% of volume
      double step = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
      if(step <= 0) step = 0.01;
      double half = MathFloor((volume / 2.0) / step) * step;
      if(half < step) continue;
      if(trade.PositionClosePartial(t, half))
         Print(StringFormat("EPF PARTIAL-CLOSE: ticket=%d closed %.2f of %.2f lots at +1.5R profit",
                            (int)t, half, volume));
      EPF_MarkPartialClosed(t);    // mark even on failure so we don't keep retrying
   }
}

// v6.0.4: Scheduled news calendar — pure GMT time-math, no external API required.
// Returns true + fills `reason` if current time is inside a known high-impact window.
bool IsScheduledNewsWindow(string &reason)
{
   if(!InpCalendarEnable) return false;
   MqlDateTime dt; TimeGMT(dt);
   int dow  = dt.day_of_week; // 0=Sun, 1=Mon ... 6=Sat
   int gH   = dt.hour;
   int gM   = dt.min;
   int mNow = gH * 60 + gM; // minutes since midnight GMT

   // Sunday market open — gap risk, thin liquidity, wild spread
   if(InpCalSundayOpen && dow == 0 && mNow < 45)
   { reason = "CALENDAR: Sunday open gap risk (00:00-00:45 GMT)"; return true; }

   // Monday Asian open micro-spike
   if(InpCalMondayOpen && dow == 1 && mNow < 30)
   { reason = "CALENDAR: Monday Asian open spike window (00:00-00:30 GMT)"; return true; }

   // Thursday US Jobless Claims — 12:15-13:30 GMT
   if(InpCalThursJobless && dow == 4 && mNow >= 735 && mNow <= 810)
   { reason = "CALENDAR: Thursday Jobless Claims window (12:15-13:30 GMT)"; return true; }

   // Friday US data window (NFP on first Friday, other data other weeks) — 12:15-14:00 GMT
   if(InpCalFridayData && dow == 5 && mNow >= 735 && mNow <= 840)
   { reason = "CALENDAR: Friday US data window (12:15-14:00 GMT)"; return true; }

   // Custom window 1
   if(InpCalCustomDay1 >= 0 && dow == InpCalCustomDay1)
   {
      int winStart = InpCalCustomHour1 * 60 + InpCalCustomMin1;
      if(mNow >= winStart && mNow < winStart + InpCalCustomDurMin1)
      { reason = StringFormat("CALENDAR: Custom window 1 (day%d %02d:%02d GMT +%dmin)",
                              InpCalCustomDay1, InpCalCustomHour1, InpCalCustomMin1, InpCalCustomDurMin1);
        return true; }
   }
   // Custom window 2
   if(InpCalCustomDay2 >= 0 && dow == InpCalCustomDay2)
   {
      int winStart = InpCalCustomHour2 * 60 + InpCalCustomMin2;
      if(mNow >= winStart && mNow < winStart + InpCalCustomDurMin2)
      { reason = StringFormat("CALENDAR: Custom window 2 (day%d %02d:%02d GMT +%dmin)",
                              InpCalCustomDay2, InpCalCustomHour2, InpCalCustomMin2, InpCalCustomDurMin2);
        return true; }
   }
   // Custom window 3
   if(InpCalCustomDay3 >= 0 && dow == InpCalCustomDay3)
   {
      int winStart = InpCalCustomHour3 * 60 + InpCalCustomMin3;
      if(mNow >= winStart && mNow < winStart + InpCalCustomDurMin3)
      { reason = StringFormat("CALENDAR: Custom window 3 (day%d %02d:%02d GMT +%dmin)",
                              InpCalCustomDay3, InpCalCustomHour3, InpCalCustomMin3, InpCalCustomDurMin3);
        return true; }
   }
   return false;
}

void OnTick()
{
   if(!licenseValid) { g_lastSkipReason = "LICENSE_INVALID (enter correct PIN in inputs)"; return; }
   UpdateAuditDrawdown();

   // v4.9.6 — DIAGNOSTIC HEARTBEAT (prints every 60s telling user WHY bot is idle)
   if(TimeCurrent() - g_lastHeartbeat >= 60)
   {
      // Collect live state
      string sym = Symbol();
      bool symOK = (StringFind(sym, "XAU") >= 0 || StringFind(sym, "GOLD") >= 0 || StringFind(sym, "Gold") >= 0);
      bool termConn = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
      bool termAlgo = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
      bool mqlAlgo  = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
      double curSpr = (double)SymbolInfoInteger(sym, SYMBOL_SPREAD);
      int    openPs = CountMyPositions();

      string status;
      if(!termConn)        status = "BROKER DISCONNECTED — check internet/VPS connection";
      else if(!symOK)      status = StringFormat("WRONG SYMBOL '%s' — attach EA to XAUUSD chart (your broker may call it XAUUSDm / XAUUSD.r / GOLD)", sym);
      else if(!termAlgo)   status = "ALGO TRADING OFF — click the 'Algo Trading' toolbar button until it turns GREEN";
      else if(!mqlAlgo)    status = "EA-LEVEL ALGO NOT ALLOWED — re-attach EA and tick 'Allow Algo Trading' in the Common tab";
      else if(openPs > 0)  status = StringFormat("MANAGING %d OPEN POSITION(S) + SCANNING — analysis remains active while trades run", openPs);
      else if(StringLen(g_lastSkipReason) > 0) status = "IDLE — " + g_lastSkipReason;
      else                 status = StringFormat("SCANNING — spread=%.0fpts, all systems OK, waiting for A/A+ setup", curSpr);

      PrintFormat("♥ HEARTBEAT │ %s", status);
      g_lastHeartbeat = TimeCurrent();
      // Reset the reason flag so stale entries don't mislead next cycle
      g_lastSkipReason = "";
   }

   // Daily/weekly resets
   MqlDateTime dtNow, dtLast, dtWeek;
   TimeCurrent(dtNow);
   TimeToStruct(lastDayReset, dtLast);
   if(dtNow.day != dtLast.day)
   {
      dailyStartEquity = accInfo.Equity();
      ResetPropFirmDailyBaseline();
      todayTradeCount = 0; dailyLimitHit = false;
      lastDayReset = TimeCurrent();
      // v5.1.0 — reset Profit Guardian state at day boundary
      pg_dayHWM = accInfo.Equity();
      pg_dayHaltActive = false;
      pg_pauseUntil = 0;
      pg_lastReportedTier = -1;
      pg_consecutiveLosses = 0;  // v5.1.2: fresh streak each day
      pg_lastLossCycleAt = 0;
      // v5.1.9 — selective mode resets at day boundary too
      pg_selectiveActive = false;
      pg_selectiveActivatedAt = 0;
      pg_selectiveTriggerEq = 0;
      pg_selectiveLowEq = 0;
      pg_selectiveLowAt = 0;
      pg_selectiveSkippedCnt = 0;
      lastPyramidPx = 0.0;          // v5.3.0 — reset spacing tracker each session
      // v5.5.0 — reset EPF state at day boundary
      epf_tier = 0;
      epf_lastLoggedTier = -1;
      epf_cooldownUntil = 0;
      epf_lastDailyGainPct = 0.0;
      epf_t4AdaptiveTradesToday = 0;
      epf_t4LastAdaptiveTrade = 0;
      epf_partialClosedCnt = 0;
   }
   TimeToStruct(lastWeekReset, dtWeek);
   if(dtNow.day_of_week == 1 && dtWeek.day_of_week != 1)
   {
      SendWeeklyReport();
      weeklyStartEquity = accInfo.Equity();
      weeklyTargetHit = weeklyLossHit = false;
      lastWeekReset = TimeCurrent();
   }

   // Weekend
   if(InpWeekendClose && dtNow.day_of_week == 5 && dtNow.hour >= 20)
   { if(CountMyPositions() > 0) { CloseAll(); Print("WEEKEND CLOSE"); } return; }

   // v4.5.7 — HEARTBEAT: if any risk gate is active, log ONCE per 5 min so
   // user never has a silent EA again. Previously these only printed ONCE on
   // threshold breach, then returned silently forever → looks like EA is dead.
   static datetime lastGateHeartbeat = 0;
   bool heartbeatDue = (TimeCurrent() - lastGateHeartbeat >= 300);

   // Equity/daily/weekly limits — a value of 0 fully disables the gate (user choice)
   double equity = accInfo.Equity();
   string propFirmLock = PropFirmLossLockReason();
   if(StringLen(propFirmLock) > 0)
   {
      if(!g_propFirmLockActive)
      {
         Print("PROP-FIRM LOSS LOCK: ", propFirmLock,
               ". Closing exposure and pausing new trades before the firm's hard limit.");
         g_propFirmLockActive = true;
      }
      if(CountMyPositions() > 0) CloseAll();
      g_lastSkipReason = "PROP-FIRM LOSS LOCK: " + propFirmLock;
      return;
   }
   if(InpEquityProtect > 0 && equity < initialBalance * InpEquityProtect / 100.0)
   {
      CloseAll();
      if(heartbeatDue) { Print("⏸  EQUITY PROTECT ACTIVE — equity $", DoubleToString(equity,2),
         " < ", DoubleToString(InpEquityProtect,1), "% of $", DoubleToString(initialBalance,2),
         ". EA paused until equity recovers. Add funds or close losing trades.");
         lastGateHeartbeat = TimeCurrent(); }
      return;
   }

   double weeklyPnL = equity - weeklyStartEquity;
   if(InpWeeklyTarget > 0 && weeklyPnL >= weeklyStartEquity * InpWeeklyTarget / 100.0)
   {
      if(!weeklyTargetHit) { CloseAll(); Print("WEEKLY TARGET HIT: +$", DoubleToString(weeklyPnL, 2)); }
      weeklyTargetHit = true;
      if(heartbeatDue) { Print("⏸  WEEKLY TARGET HIT — +$", DoubleToString(weeklyPnL, 2),
         " reached (", DoubleToString(InpWeeklyTarget,1), "% of $", DoubleToString(weeklyStartEquity,2),
         "). EA paused until Monday to protect gains.");
         lastGateHeartbeat = TimeCurrent(); }
      return;
   }
   if(InpWeeklyMaxLoss > 0 && weeklyPnL < -(weeklyStartEquity * InpWeeklyMaxLoss / 100.0))
   {
      if(!weeklyLossHit) { CloseAll(); Print("WEEKLY LOSS LIMIT"); }
      weeklyLossHit = true;
      if(heartbeatDue) { Print("⏸  WEEKLY LOSS LIMIT — down $", DoubleToString(MathAbs(weeklyPnL),2),
         " (> ", DoubleToString(InpWeeklyMaxLoss,1), "% of weekly start $", DoubleToString(weeklyStartEquity,2),
         "). EA paused until Monday. Set InpWeeklyMaxLoss=0 to disable this gate.");
         lastGateHeartbeat = TimeCurrent(); }
      return;
   }

   double dailyPnL = equity - dailyStartEquity;
   if(InpDailyLossLimit > 0 && dailyPnL < -(dailyStartEquity * InpDailyLossLimit / 100.0))
   {
      if(!dailyLimitHit) Print("DAILY LIMIT: -$", DoubleToString(MathAbs(dailyPnL), 2));
      dailyLimitHit = true; if(CountMyPositions() > 0) CloseAll();
      if(heartbeatDue) { Print("⏸  DAILY LOSS LIMIT — down $", DoubleToString(MathAbs(dailyPnL),2),
         " (> ", DoubleToString(InpDailyLossLimit,1), "% of daily start $", DoubleToString(dailyStartEquity,2),
         "). EA paused until next trading day. Set InpDailyLossLimit=0 to disable this gate.");
         lastGateHeartbeat = TimeCurrent(); }
      return;
   }

   // v5.8.15: protect the equity curve after a profitable run. This closes open
   // positions when today's equity HWM gives back too much, even if daily loss
   // limits are disabled for demo testing.
   if(ExpectancyDayGivebackGuard())
   {
      UpdateDashboard(lastDashSignal, lastDashScore, lastDashGrade);
      return;
   }

   // === v4.9.4 BASKET PROTECT (runs BEFORE per-trade management) ===
   // v5.8.15 changed the first floor touch from "close all immediately" to a
   // partial soft-lock when possible, so runners can survive healthy gold noise.
   // True close-all still happens on fast reversal, hard giveback, or a second
   // floor failure after the soft-lock has already banked profit.
   if(ManageBasket())
   {
      UpdateDashboard(lastDashSignal, lastDashScore, lastDashGrade);
      return;
   }

   // === ALWAYS MANAGE OPEN POSITIONS (every tick, even on wide spread) ===
   // We intentionally run this BEFORE the spread gate so that news-time
   // spread spikes cannot prevent us from closing losing positions.
   ManagePositions();

   // === v5.5.0 EPF — update tier each tick + run partial-close manager ===
   // Cheap to run; tier transitions logged when they change.
   epf_tier = EPF_ComputeTier();
   if(epf_tier != epf_lastLoggedTier)
   {
      string tierName = (epf_tier == 0) ? "NORMAL"
                      : (epf_tier == 1) ? "T1-MILD"
                      : (epf_tier == 2) ? "T2-DEFENSE"
                      : (epf_tier == 3) ? "T3-PRESERVE"
                      : "T4-LOCKDOWN";
      double dayPct = (accInfo.Equity() - dailyStartEquity) / MathMax(dailyStartEquity,1) * 100.0;
      double peakPct = (pg_dayHWM - dailyStartEquity) / MathMax(dailyStartEquity,1) * 100.0;
      Print(StringFormat("⚙ EPF TIER → %s (day:+%.1f%% peak:+%.1f%% consecLoss:%d)",
                          tierName, dayPct, peakPct, pg_consecutiveLosses));
      epf_lastLoggedTier = epf_tier;
   }
   EPF_ManagePartials();

   // === RE-ENTRY WATCHER (every tick, cheap) ===
   // If we just closed a loser and price has reversed back past our entry,
   // re-enter at reduced size once. Pure MQL5 — no AI call needed.
   CheckReEntryOpportunity();

   // === PYRAMID WATCHER (every tick) ===
   // If we have an open position and price has moved a meaningful distance
   // (adverse = better entry; with-trend = continuation), stack another
   // smaller position in the same direction while signal holds.
   XAU_UpdateOpenTradeQuality();
   XAU_UpdateClosedTradeOutcomes();
   CheckPyramidOpportunity();

   // === THROTTLED DASHBOARD REFRESH (every 2s, keeps UI live between bars) ===
   // Uses cached scan state so the display doesn't flicker to zeros between scans.
   static datetime lastDashTick = 0;
   if(TimeCurrent() - lastDashTick >= 2)
   {
      UpdateDashboard(lastDashSignal, lastDashScore, lastDashGrade);
      lastDashTick = TimeCurrent();
   }

   // === XAUAI CLOUD heartbeat (every 60s, so admin panel shows master online) ===
   static datetime lastCloudHB = 0;
   if(TimeCurrent() - lastCloudHB >= 60)
   {
      CloudHeartbeat();
      FetchBotMode();   // v5.1.8 — same cadence: pull admin-set mode preset
      lastCloudHB = TimeCurrent();
   }
   if(TimeCurrent() - g_lastBotMonitorHeartbeat >= MathMax(10, InpBotMonitorHeartbeatSec))
   {
      BotMonitorHeartbeat();
      g_lastBotMonitorHeartbeat = TimeCurrent();
   }
   if(TimeCurrent() - g_lastBotCommandPoll >= 10)
   {
      BotMonitorPollCommands();
      g_lastBotCommandPoll = TimeCurrent();
   }
   // v5.1.2 — Profit Guardian: HWM tracking + per-position ratchet every tick
   PG_UpdateHWM();
   PG_PerPositionRatchet();

   // v6.3.9 UPGRADE — ATR-adaptive daily profit lock
   // Tightens all open SLs once per trigger (not on every tick). ATR-based distance
   // prevents over-tightening on high-volatility gold days with 40+ pip swings.
   if(InpDailyProfitLockPct > 0 && dailyStartEquity > 0)
   {
      double dayGainPct = (AccountInfoDouble(ACCOUNT_EQUITY) - dailyStartEquity) / dailyStartEquity * 100.0;
      if(dayGainPct >= InpDailyProfitLockPct && !g_dailyProfitLockArmed)
      {
         g_dailyProfitLockArmed = true;
         double lockATR = (ArraySize(bufATR) >= 2 && bufATR[1] > 0) ? bufATR[1] : 0.0;
         Print("PROFIT LOCK: daily gain ", DoubleToString(dayGainPct, 1),
               "% reached ", DoubleToString(InpDailyProfitLockPct, 1),
               "% threshold — tightening SLs with ATR-adaptive distance (ATR=",
               DoubleToString(lockATR, 2), ")");
         int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
         double minStop = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(Symbol(), SYMBOL_POINT);
         // Loop over ALL open positions (basket-safe)
         for(int pi = PositionsTotal() - 1; pi >= 0; pi--)
         {
            ulong ticket = PositionGetTicket(pi);
            if(ticket == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
            int    pDir    = (int)PositionGetInteger(POSITION_TYPE);
            double pOpen   = PositionGetDouble(POSITION_PRICE_OPEN);
            double pSL     = PositionGetDouble(POSITION_SL);
            double pProfit = PositionGetDouble(POSITION_PROFIT);
            if(pProfit <= 0) continue; // only tighten profitable positions
            double pBid    = SymbolInfoDouble(Symbol(), SYMBOL_BID);
            double pAsk    = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
            double curPx   = (pDir == 0) ? pBid : pAsk;
            // ATR-adaptive lock distance: at least 1.5×ATR behind price
            double lockDist = (lockATR > 0) ? MathMax(1.5 * lockATR, minStop) : MathMax(0.0010, minStop);
            double newSL = (pDir == 0) // BUY: SL below current price
                         ? NormalizeDouble(curPx - lockDist, digits)
                         : NormalizeDouble(curPx + lockDist, digits); // SELL: SL above current price
            // Validate: new SL must be in profit direction, must not cross min stop level
            bool slImproves = (pDir == 0)
                            ? (newSL > pSL + SymbolInfoDouble(Symbol(), SYMBOL_POINT) && newSL < curPx - minStop)
                            : (pSL == 0 || (newSL < pSL - SymbolInfoDouble(Symbol(), SYMBOL_POINT) && newSL > curPx + minStop));
            if(slImproves)
            {
               bool ok = trade.PositionModify(ticket, newSL, PositionGetDouble(POSITION_TP));
               if(ok) Print("PROFIT LOCK: ticket=", ticket,
                            " SL moved to ", DoubleToString(newSL, digits),
                            " (lockDist=", DoubleToString(lockDist, 2), " ATR-adaptive)");
            }
         }
      }
      // Partial reset: re-arm below 50% of lock threshold so it can fire again if
      // profits recover and the day gain climbs back above the threshold
      else if(g_dailyProfitLockArmed && dayGainPct < InpDailyProfitLockPct * 0.5)
      {
         g_dailyProfitLockArmed = false;
         Print("PROFIT LOCK: reset — day gain dropped below 50% of threshold");
      }
   }

   // Spread check — blocks NEW ENTRIES only
   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);

   // v6.0.2: track spread EMA for news spike detection (runs every tick, negligible cost)
   if(g_spreadEMA <= 0.0) g_spreadEMA = spread;
   else g_spreadEMA = g_spreadEMA * 0.98 + spread * 0.02;
   if(InpNewsAftermathEnable && g_spreadEMA > 5.0 && spread > g_spreadEMA * InpNewsSpreadMulti)
   {
      if(TimeCurrent() > g_newsAftermathUntil) // only log at the START of each new spike window
         Print(StringFormat("NEWS-SPIKE: spread %.0f pts (%.1f× baseline %.0f) — new entries paused for %d min",
                            spread, spread / g_spreadEMA, g_spreadEMA, InpNewsAftermathMins));
      g_newsAftermathUntil = TimeCurrent() + InpNewsAftermathMins * 60;
   }

   bool spreadBlocksEntry = false;
   string spreadBlockReason = "";
   if(spread > InpMaxSpread)
   {
      spreadBlocksEntry = true;
      spreadBlockReason = StringFormat("SPREAD_TOO_WIDE: %.0f > %d pts (analysis continues; entries wait for spread to narrow)", spread, InpMaxSpread);
      g_lastSkipReason = spreadBlockReason;
   }
   // v6.0.2: news aftermath block — entries paused after detected spread spike
   if(InpNewsAftermathEnable && TimeCurrent() < g_newsAftermathUntil && !spreadBlocksEntry)
   {
      int secsLeft = (int)(g_newsAftermathUntil - TimeCurrent());
      spreadBlocksEntry = true;
      spreadBlockReason = StringFormat("NEWS_AFTERMATH: entries paused %ds after spread spike (resumes %s)",
                                       secsLeft, TimeToString(g_newsAftermathUntil, TIME_MINUTES));
      g_lastSkipReason = spreadBlockReason;
   }
   // v6.0.4: scheduled news calendar — block entries during pre-defined high-impact windows
   if(!spreadBlocksEntry)
   {
      string calReason = "";
      if(IsScheduledNewsWindow(calReason))
      {
         static datetime lastCalLog = 0;
         if(TimeCurrent() - lastCalLog >= 60)
         { Print("NEWS-CALENDAR: ", calReason, " — entries blocked"); lastCalLog = TimeCurrent(); }
         spreadBlocksEntry = true;
         spreadBlockReason = calReason;
         g_lastSkipReason  = calReason;
      }
   }

   // New M5 bar only for entries, with watchdog recovery.
   datetime barOpens[1];
   datetime curBar = 0;
   int barCopied = CopyTime(Symbol(), PERIOD_M5, 0, 1, barOpens);
   if(barCopied > 0) curBar = barOpens[0];
   if(curBar <= 0)  curBar = iTime(Symbol(), PERIOD_M5, 0);

   bool newM5Bar = (curBar > 0 && curBar != g_lastEntryBarSeen);
   // v6.0 STI: refresh macro trend state on every new M5 bar (cheap, bar-cached)
   if(newM5Bar) STI_Update();
   int secondsSinceScan = (g_lastEntryScanAt > 0) ? (int)(TimeCurrent() - g_lastEntryScanAt) : 999999;
   bool watchdogDue = (InpScanWatchdogMin > 0 && secondsSinceScan >= InpScanWatchdogMin * 60);
   bool timerForced = g_timerForceScan;
   g_timerForceScan = false;

   if(!newM5Bar && !watchdogDue && !timerForced)
   {
      g_lastSkipReason = StringFormat("WAITING_FOR_NEW_M5_BAR: cur=%s last=%s sinceScan=%ds",
                                      TimeToString(curBar, TIME_MINUTES),
                                      TimeToString(g_lastEntryBarSeen, TIME_MINUTES),
                                      secondsSinceScan);
      if(TimeCurrent() - g_lastScanSkipLog >= InpScanSkipLogSec)
      {
         Print("SCAN IDLE: ", g_lastSkipReason,
               " | tick OK; management loop still active.");
         g_lastScanSkipLog = TimeCurrent();
      }
      return;
   }

   if(watchdogDue && !newM5Bar)
      Print("⚠ SCAN WATCHDOG: forcing entry scan after ", secondsSinceScan,
            "s without a completed scan. curBar=", TimeToString(curBar, TIME_MINUTES),
            " lastBar=", TimeToString(g_lastEntryBarSeen, TIME_MINUTES));

   // Update Asia-range tracker on every new M5 bar
   if(InpAsiaRangeBreakout) UpdateAsiaRange();

   // Load indicators
   if(!CopyEntryBuffer(hEMAFast, 0, 0, 12, bufEMAFast, "EMA_FAST_M5")) return;
   if(!CopyEntryBuffer(hEMASlow, 0, 0, 12, bufEMASlow, "EMA_SLOW_M5")) return;
   if(!CopyEntryBuffer(hRSI, 0, 0, 5, bufRSI, "RSI_M5")) return;
   if(!CopyEntryBuffer(hATR, 0, 0, 5, bufATR, "ATR_M5")) return;
   if(!CopyEntryBuffer(hBBUpper, 1, 0, 12, bufBBUpper, "BB_UPPER")) return;
   if(!CopyEntryBuffer(hBBUpper, 2, 0, 12, bufBBLower, "BB_LOWER")) return;
   if(!CopyEntryBuffer(hBBUpper, 0, 0, 12, bufBBMid, "BB_MID")) return;
   if(!CopyEntryBuffer(hEMAFast_H1, 0, 0, 3, bufEMAFast_H1, "EMA_FAST_H1")) return;
   if(!CopyEntryBuffer(hEMASlow_H1, 0, 0, 3, bufEMASlow_H1, "EMA_SLOW_H1")) return;
   if(!CopyEntryBuffer(hEMAFast_H4, 0, 0, 3, bufEMAFast_H4, "EMA_FAST_HTF")) return;
   if(!CopyEntryBuffer(hEMASlow_H4, 0, 0, 3, bufEMASlow_H4, "EMA_SLOW_HTF")) return;
   if(!CopyEntryBuffer(hRSI_M15, 0, 0, 3, bufRSI_M15, "RSI_M15")) return;
   if(!CopyEntryBuffer(hStoch, 0, 0, 3, bufStochK, "STOCH_K")) return;
   if(!CopyEntryBuffer(hStoch, 1, 0, 3, bufStochD, "STOCH_D")) return;
   g_indicatorBufferFailCount = 0;
   if(curBar > 0) g_lastEntryBarSeen = curBar;
   g_lastEntryScanAt = TimeCurrent();
   // v6.1.0: SMC update runs HERE — after bufATR is loaded, ATR is always fresh
   if(InpSMC_Enable) SMC_Update();
   XAU_UpdateBlockedSignalOutcomes();
   InTradeClassifier_Update(); // v6.0.1: classify open positions every bar (feeds ratchet + exit logic)

   int maxTradesToday = EffectiveMaxTradesPerDay();
   bool entryExecutionBlocked = false;
   string entryExecutionBlockReason = "";
   string entryExecutionBlockGrade = "";
   int openNowForScan = CountMyPositions();
   if(openNowForScan >= InpMaxOpenTrades)
   {
      entryExecutionBlocked = true;
      entryExecutionBlockGrade = "MAX-OPEN";
      entryExecutionBlockReason = StringFormat("max open trades reached (%d/%d); market analysis continues but fresh entries are blocked",
                                               openNowForScan, InpMaxOpenTrades);
   }
   else if(todayTradeCount >= maxTradesToday)
   {
      entryExecutionBlocked = true;
      entryExecutionBlockGrade = "MAX-DAY";
      entryExecutionBlockReason = StringFormat("adaptive daily trade cap reached (%d/%d); market analysis continues but fresh entries are blocked",
                                               todayTradeCount, maxTradesToday);
   }

   // Cooldown
   if(!entryExecutionBlocked && lastTradeClose > 0 && TimeCurrent() - lastTradeClose < InpTradeCooldown)
   {
      entryExecutionBlocked = true;
      entryExecutionBlockGrade = "CD";
      entryExecutionBlockReason = StringFormat("post-close cooldown active (%ds left); market analysis continues",
                                               (int)(InpTradeCooldown - (TimeCurrent() - lastTradeClose)));
   }

   // Streak pause (after multiple quick losses)
   if(!entryExecutionBlocked && IsInStreakPause())
   {
      entryExecutionBlocked = true;
      entryExecutionBlockGrade = "PAUSED";
      entryExecutionBlockReason = "streak pause active until " + TimeToString(streakPauseUntil, TIME_SECONDS) +
                                  "; market analysis continues but fresh entries are blocked";
   }

   // ============ GATE 1: REGIME ============
   double regimeQuality = DetectRegime();
   if(currentRegime == REGIME_DEAD)
   { Print("GATE1: DEAD market (", DoubleToString(regimeQuality, 2), ") — skip");
     UpdateDashboard(0, 0, "DEAD"); return; }

   // ============ GATE 2: SESSION ============
   double sessionQuality = GetSessionQuality();

   // ============ GATE 3: SETUP SCORING ============
   double setupScore = 0;
   string setupName = "";
   int signal = ScoreSetups(setupScore, setupName);

   // v6.1.0 — SMC confirmation layer (additive only; never blocks, never removes logic)
   if(InpSMC_Enable && signal != 0)
   {
      string smcReason = "";
      double smcBonus  = SMC_GetScoreBonus(signal, smcReason);
      if(smcBonus > 0.0)
         setupScore = MathMax(0.0, setupScore + smcBonus);
      if(InpSMC_Log && StringLen(smcReason) > 0)
         Print("SMC v6.1.0 | dir=", signal > 0 ? "BUY" : "SELL",
               " | bonus=", DoubleToString(smcBonus, 2),
               " | newScore=", DoubleToString(setupScore, 2),
               " | setup=", setupName,
               " | ", smcReason,
               " | BOS=", g_smc_bos_dir,
               " | OB_bull=", g_smc_ob_bull.valid ? "Y" : "n",
               " | OB_bear=", g_smc_ob_bear.valid ? "Y" : "n",
               " | FVG_bull=", g_smc_fvg_bull.valid ? "Y" : "n",
               " | FVG_bear=", g_smc_fvg_bear.valid ? "Y" : "n");
   }

   // Combined quality
   double combinedRaw = setupScore * regimeQuality * sessionQuality;
   // v5.1.5: floor the multiplicative drag — without this, fair-quality regimes
   // (regimeQuality ~ 0.5) drop a Score:4.5 setup to Combined:2.0 which falls
   // below gradeB (esp. after loss-streak tightening). Floor keeps the combined
   // at >= setupScore × InpScoreFloor (default 0.65) so good setups still trade.
   // v5.1.8: floor and gradeB are now admin-controllable via Bot Mode preset.
   // v5.6.0 FIX A — REGIME-AWARE FLOOR. Previously the floor (0.65) overrode
   // CHOPPY/DEAD regime quality (0.05/0.30) and let B-grade trades fire in
   // unstable conditions, producing the asymmetric losses seen in live data.
   // New: floor scales DOWN in low-quality regimes so the regime filter actually
   // works. Aggressive mode keeps the legacy floor (user observed Aggressive
   // mode wins more — don't break it).
   double effFloor   = GetEffectiveScoreFloor();
   double effGradeB  = GetEffectiveGradeB();
   double regimeFloorScale = 1.0;
   if(g_modeName != "aggressive")
   {
      switch(currentRegime)
      {
         case REGIME_DEAD:        regimeFloorScale = 0.0;  break; // never trade
         case REGIME_CHOPPY:      regimeFloorScale = 0.0;  break; // 🔑 the fix
         case REGIME_LOW_VOL:     regimeFloorScale = 0.55; break;
         case REGIME_RANGING:     regimeFloorScale = 0.80; break;
         default:                 regimeFloorScale = 1.0;  break; // trending/breakout
      }
   }
   double combinedFloor = setupScore * effFloor * regimeFloorScale;
   double combinedScore = MathMax(combinedRaw, combinedFloor);

   // v5.6.0 FIX B — REGIME-DIRECTION BONUS. With-trend setups get a score bump,
   // counter-trend setups get a small penalty. Previously the bot scored buy
   // and sell setups symmetrically regardless of regime, which is why the live
   // history showed 100% BUY trades during a clear downtrend. Now the regime
   // filter has actual directional teeth.
   if(g_modeName != "aggressive")  // Aggressive mode unaffected (user's choice)
   {
      bool isTrendingUp = (currentRegime == REGIME_TRENDING_UP || currentRegime == REGIME_BREAKOUT_UP);
      bool isTrendingDn = (currentRegime == REGIME_TRENDING_DOWN || currentRegime == REGIME_BREAKOUT_DOWN);
      if(signal == 1 && isTrendingUp)       combinedScore += 1.5;
      else if(signal == -1 && isTrendingDn) combinedScore += 1.5;
      else if(signal == 1 && isTrendingDn)  combinedScore = MathMax(0.0, combinedScore - 0.5);
      else if(signal == -1 && isTrendingUp) combinedScore = MathMax(0.0, combinedScore - 0.5);
   }

   // v6.2.0 — HTF CONSENSUS BONUS.
   // The regime quality multiplier (0.30–0.85) murders valid signals in non-trending
   // M5 conditions. In RANGING regime a perfect setup (score 4.5) computes to combined
   // 2.34 → SKIP, even when H1+HTF are both screaming bullish.
   //
   // A professional trader doesn't multiply confidence levels. When the bigger picture
   // is clear (H1 AND HTF both agree), they require LESS M5 confirmation, not more.
   //
   // This bonus (+2.5) directly compensates the regime multiplier drag for trend-aligned
   // signals during confirmed H1+HTF consensus. It is NOT applied to counter-trend
   // signals — the anti-trend veto already handles those.
   bool htfConsensusTrade = (g_htfConsensusDir == 1 && signal == 1) ||
                            (g_htfConsensusDir == -1 && signal == -1);
   if(htfConsensusTrade)
   {
      combinedScore += 2.5;
      Print("HTF_CONSENSUS_BONUS +2.5 | dir=", signal > 0 ? "BUY" : "SELL",
            " | setup=", setupName, " | combinedScore=", DoubleToString(combinedScore, 2),
            " | regime=", RegimeName(), " | htfConsensusDir=", g_htfConsensusDir);
   }

   string accelReason = "";
   double accelAdj = XAU_AcceleratedLearningAdjust(signal, setupName, combinedScore, accelReason);
   if(MathAbs(accelAdj) >= 0.01)
   {
      combinedScore = MathMax(0.0, combinedScore + accelAdj);
      Print(accelReason);
   }

   // v5.7.0 — ADAPTIVE GRADE TIGHTENING IS PERMANENTLY DISABLED.
   // User analysis of live trades concluded that the adaptive system was
   // creating a death spiral: lose → raise threshold → fewer trades, only
   // the rare "high-confidence" setups → those setups happen to be the
   // overfitted ones → they lose → raise threshold again. The strategy
   // should stay STABLE during drawdowns; only POSITION SIZE should change.
   double dynGradeB = effGradeB;
   // Adaptive grade tightening DISABLED entirely. Code block removed in v5.7.0.
   // To re-enable (not recommended), restore the block from git history.
   // v5.1.5: rename worst label "PASS" → "SKIP". The literal text "PASS" was
   // misleading — it appeared next to "— PASS" in logs making users think the
   // signal was accepted when it was actually rejected.
   string grade = combinedScore >= InpGradeAPlus ? "A+"
                : combinedScore >= InpGradeA    ? "A"
                : combinedScore >= dynGradeB    ? "B"
                : "SKIP";
   XAU_RecordMarketSnapshot("SCAN_EVALUATED", signal, setupName, grade, setupScore, combinedScore);
   // v6.3.8 Upgrade 6: count every real (non-SKIP) signal through the pipeline
   if(signal != 0 && grade != "SKIP") { g_totalSignals++; g_ftReport_Signals++; }
   // v6.3.8 Upgrade 7 / v6.3.9: 24h gate analytics report + equity watermark update + FT report tracking
   {
      double curEq = AccountInfoDouble(ACCOUNT_EQUITY);
      if(curEq > g_equityHighWatermark) { g_equityHighWatermark = curEq; }
      if(g_equityHighWatermark > 0)
      {
         double ddFromHigh = (g_equityHighWatermark - curEq) / g_equityHighWatermark * 100.0;
         if(!g_drawdownPause && ddFromHigh >= InpDrawdownFromHighPct)
         {
            g_drawdownPause = true;
            Print("DRAWDOWN PAUSE: equity ", DoubleToString(ddFromHigh, 1),
                  "% below watermark $", DoubleToString(g_equityHighWatermark, 2),
                  " — new entries suspended");
         }
         else if(g_drawdownPause && ddFromHigh <= 3.0)
         {
            g_drawdownPause = false;
            Print("DRAWDOWN RESUME: equity recovered to within 3% of watermark");
         }
      }
      if(g_gateReportLast > 0 && (TimeCurrent() - g_gateReportLast) >= 86400)
      {
         PrintGateReport();
         WriteGateReportToFile();
      }
      // v6.3.9: track max floating P&L and session drawdown for forward-test report
      double floatNow = AccountInfoDouble(ACCOUNT_PROFIT);
      if(floatNow < 0 && MathAbs(floatNow) > g_ftReport_MaxFloat)
         g_ftReport_MaxFloat = MathAbs(floatNow);
      if(floatNow > 0 && floatNow > g_ftReport_MaxFav)
         g_ftReport_MaxFav = floatNow;
      if(g_ftReport_StartEquity > 0)
      {
         double sessionDD = g_ftReport_StartEquity - curEq;
         if(sessionDD > g_ftReport_MaxDD) g_ftReport_MaxDD = sessionDD;
      }
      // v6.3.9: write forward-test report at 23:59 server time (once per day)
      MqlDateTime dtNow; TimeCurrent(dtNow);
      if(dtNow.hour == 23 && dtNow.min == 59 && dtNow.day != g_ftReport_LastWriteDay)
      {
         g_ftReport_LastWriteDay = dtNow.day;
         WriteForwardTestReport();
      }
   }

   double firstSeenPx = signal > 0 ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
                                   : SymbolInfoDouble(Symbol(), SYMBOL_BID);
   if(firstSeenPx <= 0.0) firstSeenPx = iClose(Symbol(), PERIOD_M5, 1);
   if(signal != 0 && grade != "SKIP")
      XAU_TrackSignalFirstSeen(signal, setupName, grade, setupScore, combinedScore, firstSeenPx, bufATR[1]);

   // v5.6.0 FIX C — In unstable regimes (CHOPPY/LOW_VOL/DEAD), B-grade is too
   // permissive. Live data showed B-grade trades fired in CHOPPY regime then
   // got crushed when regime transitioned back to TREND_DN. Now B-grade is
   // demoted to SKIP in those regimes. A and A+ trades still allowed because
   // their score is genuinely high. Aggressive mode preserves legacy behavior.
   //
   // v6.2.0 EXCEPTION: HTF consensus trades are EXEMPT from LOW_VOL demotion.
   // When H1+HTF are both confirmed bullish/bearish, a B-grade trend-follow
   // in LOW_VOL is still valid — that's gold consolidating within a trend,
   // not random chop. Only CHOPPY and DEAD remain hard-blocked for B-grade.
   if(grade == "B" && g_modeName != "aggressive")
   {
      bool exemptHTF = htfConsensusTrade; // v6.2.0: HTF consensus trades allowed in LOW_VOL
      if(currentRegime == REGIME_DEAD || currentRegime == REGIME_CHOPPY)
      {
         Print("⚙ FIX-C: B-grade trade demoted to SKIP in regime ", RegimeName(),
               " (mode=", g_modeName, ") — A/A+ only in dead/choppy market");
         grade = "SKIP";
      }
      else if(currentRegime == REGIME_LOW_VOL && !exemptHTF)
      {
         Print("⚙ FIX-C: B-grade trade demoted to SKIP in LOW_VOL (non-HTF consensus). ",
               "Setup=", setupName, " regime=", RegimeName());
         grade = "SKIP";
      }
   }

   g_adaptiveConfirmLotMulti = 1.0;
   g_adaptiveConfirmReason = "";
   bool bQualityReportScout = false;

   string antiBiasReason = "";
   if(!ApplyAntiBiasCorrection(signal, setupName, setupScore, combinedScore, grade, antiBiasReason))
   {
      Print("TRADE BLOCKED BECAUSE: ", antiBiasReason);
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, antiBiasReason);
      CloudPostReasoning("BLOCK", antiBiasReason, RegimeName(), setupName,
                         setupScore, combinedScore, "ANTI-BIAS", signal);
      UpdateDashboard(0, combinedScore, "ANTI-BIAS");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "ANTI-BIAS";
      return;
   }

   if(InpTrendPullbackBRequireAntiBias && grade == "B" && IsDamageProneSetupName(setupName))
   {
      double bQualityLot = 1.0;
      string bQualityWhy = "";
      if(!AdaptiveXAUConfirm(signal, "DAMAGE-B-QUALITY-" + setupName, combinedScore, grade,
                             bQualityLot, bQualityWhy, true))
      {
         string bMsg = StringFormat("B-GRADE QUALITY BLOCK: %s %s failed stricter fast XAU confirmation. %s",
                                    setupName, signal == 1 ? "BUY" : "SELL", bQualityWhy);
         string scoutWhy = "";
         if(XAU_BlockedMemoryRapidScout(setupName, signal, bMsg, scoutWhy))
         {
            bQualityReportScout = true;
            g_adaptiveConfirmLotMulti *= InpBlockedMemoryScoutLotMulti;
            g_adaptiveConfirmReason = "B-grade report-fit scout: " + scoutWhy + " | original fast-confirm: " + bQualityWhy;
            Print("REPORT-FIT B-SCOUT: ", setupName, " ", signal == 1 ? "BUY" : "SELL",
                  " allowed at tiny risk x", DoubleToString(InpBlockedMemoryScoutLotMulti, 2),
                  " because blocked-memory says this exact pattern is expensive to miss. ", scoutWhy);
            CloudPostReasoning("ALLOW", "REPORT-FIT B-SCOUT: " + scoutWhy, RegimeName(), setupName,
                               setupScore, combinedScore, "B-SCOUT", signal);
         }
         else
         {
         Print("TRADE BLOCKED BECAUSE: ", bMsg);
         XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, bMsg);
         CloudPostReasoning("BLOCK", bMsg, RegimeName(), setupName,
                            setupScore, combinedScore, "B-QUALITY", signal);
         UpdateDashboard(0, combinedScore, "B-QUALITY");
         lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "B-QUALITY";
         return;
         }
      }
      if(bQualityLot < 0.999)
      {
         g_adaptiveConfirmLotMulti *= bQualityLot;
         g_adaptiveConfirmReason = "B-grade damage setup fast-confirm penalty: " + bQualityWhy;
      }
   }

   bool smartDamageSetup = InpSmartGuardEnable && IsSmartGuardDamageSetup(setupName);
   double smartGuardExtraLotMulti = 1.0;
   if(smartDamageSetup)
   {
      if(InpSmartGuardSkipBTrendBreak && grade == "B")
      {
         SmartGuardStats sgStats;
         GetSmartGuardSetupStats(lastSetupType, sgStats);

         bool enoughSamples = (sgStats.samples >= InpSmartGuardMinHardSamples);
         bool hardBad = enoughSamples &&
                        sgStats.expectancy <= InpSmartGuardHardExpectancy &&
                        sgStats.winRate <= InpSmartGuardHardWinRate;
         bool catastrophic = enoughSamples &&
                             sgStats.expectancy <= (InpSmartGuardHardExpectancy * 2.0) &&
                             sgStats.winRate <= MathMax(20.0, InpSmartGuardHardWinRate - 10.0);
         bool strongRetest = SmartGuardStrongTrendRetest(signal, setupScore, combinedScore);
         bool inactivityRelaxed = SmartGuardInactivityRelaxed();

         if(catastrophic && !strongRetest && !inactivityRelaxed)
         {
            string sgMsg = StringFormat("SMART-GUARD HARD: %s B-grade blocked | combined %.1f | samples=%d W/L=%d/%d | decayed WR=%.0f%% exp=$%.0f | reason=statistically catastrophic. Re-enable: A-grade, HTF+momentum override >= %.1f, or inactivity relax after %d min.",
                                        setupName, combinedScore, sgStats.samples, sgStats.wins, sgStats.losses,
                                        sgStats.winRate, sgStats.expectancy, InpSmartGuardOverrideScore,
                                        InpSmartGuardRelaxAfterMin);
            Print("TRADE BLOCKED BECAUSE: ", sgMsg);
            XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, sgMsg);
            CloudPostReasoning("BLOCK", sgMsg, RegimeName(), setupName,
                               setupScore, combinedScore, "SG-HARD", signal);
            UpdateDashboard(0, combinedScore, "SG-HARD");
            lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "SG-HARD";
            return;
         }

         if(!enoughSamples || hardBad || !strongRetest)
         {
            smartGuardExtraLotMulti = InpSmartGuardSoftLotMulti;
            string mode = !enoughSamples ? "small-sample" : hardBad ? "negative-expectancy" : "B-grade-damage-class";
            string relax = inactivityRelaxed ? " | inactivity relax active: hard veto downgraded to soft retest" : "";
            string overrideTxt = strongRetest ? " | strong trend retest: HTF+momentum aligned" : "";
            Print(StringFormat("SMART-GUARD SOFT: %s allowed with reduced risk x%.2f | mode=%s | combined %.1f | samples=%d W/L=%d/%d | decayed WR=%.0f%% exp=$%.0f%s%s",
                               setupName, smartGuardExtraLotMulti, mode, combinedScore,
                               sgStats.samples, sgStats.wins, sgStats.losses,
                               sgStats.winRate, sgStats.expectancy, relax, overrideTxt));
         }
      }

      if(InpSmartGuardRequireHTF && signal != 0 && !bQualityReportScout)
      {
         double confirmLot = 1.0;
         string confirmWhy = "";
         if(!AdaptiveXAUConfirm(signal, "SMART-GUARD", combinedScore, grade,
                                confirmLot, confirmWhy, true))
         {
            string sgMsg = StringFormat("SMART-GUARD: %s blocked by adaptive fast confirmation for %s. %s",
                                        setupName, signal == 1 ? "BUY" : "SELL", confirmWhy);
            Print("TRADE BLOCKED BECAUSE: ", sgMsg);
            XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, sgMsg);
            CloudPostReasoning("BLOCK", sgMsg, RegimeName(), setupName,
                               setupScore, combinedScore, "SG-FAST", signal);
            UpdateDashboard(0, combinedScore, "SG-FAST");
            lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "SG-FAST";
            return;
         }
         if(confirmLot < 0.999)
         {
            smartGuardExtraLotMulti *= confirmLot;
            Print("SMART-GUARD FAST CONFIRM: allowed with H1 soft-context lot penalty x",
                  DoubleToString(confirmLot, 2), " | ", confirmWhy);
         }
      }
      else if(bQualityReportScout)
      {
         Print("SMART-GUARD FAST CONFIRM: bypassed only for REPORT-FIT B-SCOUT; risk remains capped by scout sizing. ",
               g_adaptiveConfirmReason);
      }

      if(InpSmartGuardNoDamageStack && CountMyPositions() > 0)
      {
         string sgMsg = StringFormat("SMART-GUARD: %s blocked while another position is open. No fresh stacking on damage-prone setup.",
                                     setupName);
         Print("TRADE BLOCKED BECAUSE: ", sgMsg);
         XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, sgMsg);
         CloudPostReasoning("BLOCK", sgMsg, RegimeName(), setupName,
                            setupScore, combinedScore, "SG-STACK", signal);
         UpdateDashboard(0, combinedScore, "SG-STACK");
         lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "SG-STACK";
         return;
      }
   }

   // v5.4.0 — A+ NOW REQUIRES H1 TREND ALIGNMENT.
   // Previously A+ was just "combinedScore >= 5.5" — which counter-trend
   // mean-reversion setups can easily hit, leading to over-confident bets
   // against the H1 trend. The user's biggest losses (-$14k, -$6k, -$5k
   // pyramids) were exactly this pattern. New rule: A+ requires either
   // (a) the signal direction matches H1 trend, OR
   // (b) the setup is a trend-following type (TREND_PULLBACK, BREAKOUT,
   //     SQUEEZE_RELEASE, ASIA_BREAKOUT) where H1 confirmation is already
   //     baked into the score.
   if(grade == "A+")
   {
      double h1Spread2 = (bufEMASlow_H1[1] > 0)
                        ? (bufEMAFast_H1[1] - bufEMASlow_H1[1]) / bufEMASlow_H1[1] : 0;
      int h1Dir = (h1Spread2 > 0.0015) ? 1 : (h1Spread2 < -0.0015 ? -1 : 0);
      bool isTrendFollowingSetup = (lastSetupType == 1 || lastSetupType == 3
                                    || lastSetupType == 4 || lastSetupType == 8);
      bool htfAligned = (h1Dir == signal);
      if(!htfAligned && !isTrendFollowingSetup)
      {
         // Demote to A — still a valid trade but loses the A+ size multiplier
         // and stops triggering the AI cloud-veto (which is overconfident on
         // counter-trend setups). Surface this clearly in logs.
         Print("A+ DEMOTED → A: setup=", setupName,
               " counter-trend without H1 alignment (h1Spread=",
               DoubleToString(h1Spread2 * 100, 3), "% signal=",
               signal == 1 ? "BUY" : "SELL", ")");
         grade = "A";
      }
   }

   if(signal == 0 || combinedScore < dynGradeB)
   {
      // v5.1.5: explicit "TRADE BLOCKED BECAUSE" log so user can SEE why
      string blockReason = (signal == 0)
         ? "no setup met regime criteria"
         : StringFormat("combined %.1f < threshold %.1f%s (raw=%.1f rq=%.2f sq=%.2f) [mode=%s]",
                        combinedScore, dynGradeB,
                        (dynGradeB > effGradeB) ? " [tightened post-loss]" : "",
                        combinedRaw, regimeQuality, sessionQuality, g_modeName);
      Print("TRADE BLOCKED BECAUSE: ", blockReason,
            " | Regime:", RegimeName(), " | Setup:", setupName,
            " | Score:", DoubleToString(setupScore, 1));
      // v5.1.5: push to cloud reasoning feed (throttled — only if reason changed
      // OR enough time elapsed) so subscribers see why their copy account is idle.
      if(blockReason != br_lastReason || (TimeCurrent() - br_lastReasonAt) >= br_minIntervalSec)
      {
         CloudPostReasoning("BLOCK", blockReason, RegimeName(), setupName,
                            setupScore, combinedScore, grade, signal);
         br_lastReason = blockReason; br_lastReasonAt = TimeCurrent();
      }
      UpdateDashboard(0, combinedScore, grade);
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = grade;
      return;
   }

   double timingLotMult = 1.0;
   string timingReason = "";
   if(!XAUEntryTimingGuard(signal, setupName, setupScore, combinedScore,
                           grade, timingLotMult, timingReason))
   {
      Print("TRADE BLOCKED BECAUSE: ", timingReason);
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, timingReason);
      CloudPostReasoning("BLOCK", timingReason, RegimeName(), setupName,
                         setupScore, combinedScore, "BAD-TIMING", signal);
      UpdateDashboard(0, combinedScore, "BAD-TIMING");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "BAD-TIMING";
      return;
   }
   if(InpXAU_LogTimingGuard && StringLen(timingReason) > 0)
      Print(timingReason);

   // v5.8.5 — Global hedge guard.
   // The old code allowed a fresh SELL while a BUY was still open (and vice versa)
   // because it only checked total position count. That creates confused master
   // exposure and can fan out mixed signals to cloud-linked accounts.
   int openDir = GetOpenExposureDirection();
   if(InpBlockNewEntriesIfHedged && openDir == 2)
   {
      string hedgeMsg = "HEDGE-GUARD: account already has BUY+SELL exposure. Managing existing trades only; no fresh entries.";
      Print("TRADE BLOCKED BECAUSE: ", hedgeMsg);
      CloudPostReasoning("BLOCK", hedgeMsg, RegimeName(), setupName,
                         setupScore, combinedScore, "HEDGE-MIXED", signal);
      UpdateDashboard(0, combinedScore, "HEDGE");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "HEDGE";
      return;
   }
   if(InpOneDirectionOnly && openDir != 0 && openDir != signal)
   {
      string hedgeMsg = StringFormat("HEDGE-GUARD: open %s exists; blocking new %s until current exposure closes.",
                                     openDir == 1 ? "BUY" : "SELL",
                                     signal == 1 ? "BUY" : "SELL");
      Print("TRADE BLOCKED BECAUSE: ", hedgeMsg);
      CloudPostReasoning("BLOCK", hedgeMsg, RegimeName(), setupName,
                         setupScore, combinedScore, "NO-HEDGE", signal);
      UpdateDashboard(0, combinedScore, "NO-HEDGE");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "NO-HEDGE";
      return;
   }

   Print("SIGNAL: ", setupName, " ", signal > 0 ? "BUY" : "SELL",
         " | Regime:", RegimeName(), "(", DoubleToString(regimeQuality, 2), ")",
         " | Session:", DoubleToString(sessionQuality, 2),
         " | Score:", DoubleToString(setupScore, 1),
         " | Combined:", DoubleToString(combinedScore, 1), " [", grade, "]");

   if(entryExecutionBlocked)
   {
      string msg = "ANALYSIS-ONLY: " + entryExecutionBlockReason;
      Print("TRADE BLOCKED BECAUSE: ", msg,
            " | live signal still evaluated: ", setupName, " ",
            signal > 0 ? "BUY" : "SELL",
            " combined=", DoubleToString(combinedScore, 1),
            " grade=", grade);
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, msg);
      CloudPostReasoning("BLOCK", msg, RegimeName(), setupName,
                         setupScore, combinedScore, entryExecutionBlockGrade, signal);
      UpdateDashboard(signal, combinedScore, entryExecutionBlockGrade);
      lastDashSignal = signal; lastDashScore = combinedScore; lastDashGrade = entryExecutionBlockGrade;
      return;
   }

   if(spreadBlocksEntry)
   {
      // v6.3.8 Upgrade 6: gate analytics
      if(StringFind(spreadBlockReason, "SPREAD_TOO_WIDE") >= 0) g_gateBlocks_Spread++;
      else g_gateBlocks_News++; // NEWS_AFTERMATH and calendar blocks
      Print("TRADE BLOCKED BECAUSE: ", spreadBlockReason,
            " | live signal still evaluated: ", setupName, " ",
            signal > 0 ? "BUY" : "SELL",
            " combined=", DoubleToString(combinedScore, 1),
            " grade=", grade);
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, spreadBlockReason);
      CloudPostReasoning("BLOCK", spreadBlockReason, RegimeName(), setupName,
                         setupScore, combinedScore, "SPREAD", signal);
      UpdateDashboard(signal, combinedScore, "SPREAD");
      lastDashSignal = signal; lastDashScore = combinedScore; lastDashGrade = "SPREAD";
      return;
   }

   // News check
   if(InpUseNewsFilter && !IsNewsSafe())
   {
      g_gateBlocks_News++; // v6.3.8 Upgrade 6
      Print("TRADE BLOCKED BECAUSE: NEWS FILTER (high-impact event nearby)");
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, "NEWS FILTER (high-impact event nearby)");
      CloudPostReasoning("BLOCK", "NEWS FILTER (high-impact event nearby)",
                         RegimeName(), setupName, setupScore, combinedScore, "NEWS", signal);
      UpdateDashboard(0, combinedScore, "NEWS");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "NEWS";
      return;
   }

   // DXY CORRELATION GATE (cached, ~every 15 min)
   if(InpUseDXYFilter)
   {
      int dxyBias = GetDXYBias();
      if(dxyBias != 0 && dxyBias != signal)
      {
         string dxyMsg = StringFormat("DXY VETO — gold_bias=%d vs signal=%s",
                                       dxyGoldBias, signal>0?"BUY":"SELL");
         Print("TRADE BLOCKED BECAUSE: ", dxyMsg,
               " (set InpUseDXYFilter=false to disable)");
         XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, dxyMsg);
         CloudPostReasoning("BLOCK", dxyMsg, RegimeName(), setupName,
                            setupScore, combinedScore, "DXY-VETO", signal);
         UpdateDashboard(0, combinedScore, "DXY-VETO");
         lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "DXY-VETO";
         return;
      }
   }

   // ============ STI GATE (v6.0 — Strategic Trend Intelligence) ============
   // Runs AFTER all existing quality gates, BEFORE the reversal cooldown.
   // STI is an additive intelligence layer: hard blocks only extreme cases,
   // borderline risk = lot reduction. The bot stays aggressive on quality setups.
   g_stiLotMulti = 1.0;  // reset each scan
   if(InpSTI_Enable && signal != 0 && grade != "SKIP")
   {
      double stiM5ATR = (ArraySize(bufATR) >= 2) ? bufATR[1] : 0.0;
      double stiTCP     = STI_ComputeTCP(signal);
      double stiExhaust = STI_ComputeExhaustion(signal);
      double stiLate    = STI_ComputeLateEntryRisk(signal, stiM5ATR);

      if(InpSTI_Log)
         PrintFormat("STI SCAN | %s %s | TCP=%.0f Exhaust=%.0f LateRisk=%.0f | macroDir=%s macro%.0f%%",
                     signal==1?"BUY":"SELL", setupName,
                     stiTCP, stiExhaust, stiLate,
                     g_sti.macroDir==1?"BULL":g_sti.macroDir==-1?"BEAR":"NEUTRAL",
                     g_sti.macroStrength*100.0);

      // --- 1. LATE ENTRY HARD BLOCK (extreme: move has run without reset) ---
      if(stiLate >= InpSTI_LateEntryBlockScore)
      {
         g_gateBlocks_STI++; // v6.3.8 Upgrade 6
         string stiMsg = StringFormat("STI_LATE_BLOCK | %s %s | lateRisk=%.0f >= %.0f (tcp=%.0f exhaust=%.0f) | trend moved too far without reset — wait for pullback",
                                      signal==1?"BUY":"SELL", setupName,
                                      stiLate, InpSTI_LateEntryBlockScore, stiTCP, stiExhaust);
         Print("TRADE BLOCKED BECAUSE: ", stiMsg);
         XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, stiMsg);
         CloudPostReasoning("BLOCK", stiMsg, RegimeName(), setupName,
                            setupScore, combinedScore, "STI-LATE", signal);
         UpdateDashboard(0, combinedScore, "STI-LATE");
         lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "STI-LATE";
         return;
      }

      // --- 2. EXHAUSTION HARD BLOCK (multiple signals confirm trend nearing end) ---
      if(stiExhaust >= InpSTI_ExhaustionBlock && stiTCP < 60.0)
      {
         g_gateBlocks_STI++; // v6.3.8 Upgrade 6
         string stiMsg = StringFormat("STI_EXHAUST_BLOCK | %s %s | exhaust=%.0f >= %.0f AND tcp=%.0f < 60 | RSI divergence + ATR contraction confirm trend fatigue",
                                      signal==1?"BUY":"SELL", setupName,
                                      stiExhaust, InpSTI_ExhaustionBlock, stiTCP);
         Print("TRADE BLOCKED BECAUSE: ", stiMsg);
         XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, stiMsg);
         CloudPostReasoning("BLOCK", stiMsg, RegimeName(), setupName,
                            setupScore, combinedScore, "STI-EXHAUST", signal);
         UpdateDashboard(0, combinedScore, "STI-EXHAUST");
         lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "STI-EXHAUST";
         return;
      }

      // --- 3. RE-ENTRY GATE (after TP, require clean pullback before same-dir re-entry) ---
      if(InpSTI_BlockLateReentry &&
         g_sti.lastProfitDir == signal && g_sti.lastProfitClose > 0 && !g_sti.pullbackReady)
      {
         int waitedMin = (int)((TimeCurrent() - g_sti.lastProfitClose) / 60);
         bool inWindow = (waitedMin < InpSTI_ReentryMaxWindowMin);
         if(inWindow && waitedMin >= 0)
         {
            g_gateBlocks_STI++; // v6.3.8 Upgrade 6
            string stiMsg = StringFormat("STI_REENTRY_WAIT | %s %s | last TP at %.2f (%d min ago) | no %.2f ATR pullback yet | chasing same dir before reset is the pattern that lost money",
                                         signal==1?"BUY":"SELL", setupName,
                                         g_sti.lastProfitPrice, waitedMin,
                                         InpSTI_ReentryPullbackATR);
            Print("TRADE BLOCKED BECAUSE: ", stiMsg);
            XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, stiMsg);
            CloudPostReasoning("BLOCK", stiMsg, RegimeName(), setupName,
                               setupScore, combinedScore, "STI-WAIT", signal);
            UpdateDashboard(0, combinedScore, "STI-WAIT");
            lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "STI-WAIT";
            return;
         }
      }

      // --- 4. SOFT REDUCTIONS (borderline: reduce lot instead of blocking) ---
      if(stiLate >= InpSTI_LateEntryReduceScore)
      {
         g_stiLotMulti = 0.65;
         if(InpSTI_Log)
            PrintFormat("STI_LATE_REDUCE | %s lateRisk=%.0f → lot x%.2f | still tradeable but reduced risk",
                        setupName, stiLate, g_stiLotMulti);
      }
      else if(stiExhaust >= InpSTI_ExhaustionReduce && stiTCP < 75.0)
      {
         g_stiLotMulti = 0.75;
         if(InpSTI_Log)
            PrintFormat("STI_EXHAUST_REDUCE | %s exhaust=%.0f tcp=%.0f → lot x%.2f",
                        setupName, stiExhaust, stiTCP, g_stiLotMulti);
      }
   }
   // ============ END STI GATE ============

   // Anti-reversal (short cooldown for direction flip)
   if(lastTradeDir != 0 && signal != lastTradeDir && lastTradeClose > 0 &&
      TimeCurrent() - lastTradeClose < InpReversalCooldown)
   {
      int rem = (int)(InpReversalCooldown - (TimeCurrent() - lastTradeClose));
      string revMsg = StringFormat("ANTI-REVERSAL cooldown (%ds left, flipping %s→%s)",
                                    rem, lastTradeDir>0?"BUY":"SELL", signal>0?"BUY":"SELL");
      Print("TRADE BLOCKED BECAUSE: ", revMsg);
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, revMsg);
      CloudPostReasoning("BLOCK", revMsg, RegimeName(), setupName,
                         setupScore, combinedScore, "REV-CD", signal);
      UpdateDashboard(0, combinedScore, "REV-CD");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "REV-CD";
      return;
   }

   // v6.1.3 — BASKET DIRECTION LOSS BLOCK
   // If existing same-direction trades are already in a net loss > threshold, do not add more.
   // Prevents stacking sells into a rising gold market that is already burning the basket.
   {
      string bdlReason = "";
      if(BasketDirectionLossBlock(signal, bdlReason))
      {
         g_gateBlocks_Basket++; // v6.3.8 Upgrade 6
         Print("TRADE BLOCKED BECAUSE: ", bdlReason);
         XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, bdlReason);
         CloudPostReasoning("BLOCK", bdlReason, RegimeName(), setupName,
                            setupScore, combinedScore, "BASKET-DIR-LOSS", signal);
         UpdateDashboard(0, combinedScore, "BASKET-LOSS");
         lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "BASKET-LOSS";
         return;
      }
   }

   // DIRECTION LOCKOUT — if this side has been losing repeatedly, skip it
   if(IsDirectionLocked(signal))
   {
      datetime until = (signal == 1) ? buyLockoutUntil : sellLockoutUntil;
      string locMsg = StringFormat("DIR-LOCK — %s side locked until %s due to recent losses",
                                    signal == 1 ? "BUY" : "SELL",
                                    TimeToString(until, TIME_SECONDS));
      Print("TRADE BLOCKED BECAUSE: ", locMsg);
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, locMsg);
      CloudPostReasoning("BLOCK", locMsg, RegimeName(), setupName,
                         setupScore, combinedScore,
                         signal == 1 ? "BUY-LOCKED" : "SELL-LOCKED", signal);
      UpdateDashboard(0, combinedScore, signal == 1 ? "BUY-LOCKED" : "SELL-LOCKED");
      lastDashSignal = 0; lastDashScore = combinedScore;
      lastDashGrade = signal == 1 ? "BUY-LOCKED" : "SELL-LOCKED";
      return;
   }

   // Build exact signature for ML lookup + hive + journal
   string signature = BuildSignature(signal, setupName);

   // ============ GATE 4: RISK SIZING ============
   // v4.9.3 — Bigger lots scale with signal strength
   double sizeMulti = grade == "A+" ? 1.10 : grade == "A" ? 0.85 : 0.45;
   int    confidenceBoostPP = 0;   // in percentage points, informational

   if(timingLotMult < 0.999)
   {
      sizeMulti *= timingLotMult;
      Print("ENTRY-TIMING SIZE: lot x", DoubleToString(timingLotMult, 2),
            " | finalGrade=", grade, " | ", timingReason);
   }

   if(g_adaptiveConfirmLotMulti < 0.999)
   {
      sizeMulti *= g_adaptiveConfirmLotMulti;
      Print("ADAPTIVE-CONFIRM SIZE: lot x",
            DoubleToString(g_adaptiveConfirmLotMulti, 2), " | ",
            g_adaptiveConfirmReason);
      g_adaptiveConfirmLotMulti = 1.0;
   }

   if(smartDamageSetup && InpSmartGuardDamageLotMulti > 0)
   {
      sizeMulti *= InpSmartGuardDamageLotMulti * smartGuardExtraLotMulti;
      Print("SMART-GUARD SIZE: ", setupName, " risk x",
            DoubleToString(InpSmartGuardDamageLotMulti * smartGuardExtraLotMulti, 2),
            " (live-history defensive sizing)");
   }

   // ----- LOCAL ML (hierarchical signature match, mirrors hive) -----
   if(InpLearnPatterns && patternCount >= 5)
   {
      int mlSamples = 0;
      double mlRaw = GetMLScoreWithSamples(signal, signature, mlSamples);
      double mlScore = SmoothedMLScore(mlRaw, signature);   // v5.8.6 — smooth only inside the same setup/direction signature
      bool mlTrusted = (mlSamples >= InpMLMinTrustedSamples);
      if(!mlTrusted)
         Print("LOCAL ML: learning mode — ", mlSamples, "/", InpMLMinTrustedSamples,
               " matching samples, no authority yet");
      else
         Print("LOCAL ML AUDIT: samples=", mlSamples,
               " wr=", DoubleToString(mlRaw * 100.0, 0),
               "% smoothed=", DoubleToString(mlScore * 100.0, 0), "%");
      if(mlTrusted && mlScore <= 0.30)
      {
         Print("TRADE BLOCKED BECAUSE: LOCAL ML VETO — WR=", DoubleToString(mlScore * 100, 0),
               "% (", mlSamples, " matching samples)");
         XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, "LOCAL ML VETO");
         UpdateDashboard(0, combinedScore, "ML-VETO");
         lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "ML-VETO";
         return;
      }
      if(mlTrusted && mlScore >= 0.60)
      {
         Print("LOCAL ML BOOST: WR=", DoubleToString(mlScore * 100, 0), "% samples=", mlSamples);
         sizeMulti += 0.15; confidenceBoostPP += 8;
      }
   }

   // ----- GLOBAL HIVE-MIND (7-day, all users, same signature) -----
   int hive = GetHiveVerdict(signature);
   if(hive == -1)
   {
      Print("TRADE BLOCKED BECAUSE: HIVE VETO — signature ", signature,
            " has WR ≤ 30% globally over last 7 days");
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, "HIVE VETO");
      UpdateDashboard(0, combinedScore, "HIVE-VETO");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "HIVE-VETO";
      return;
   }
   if(hive == 1)
   { Print("HIVE BOOST: signature ", signature, " has WR >= 60% globally (+8pp)");
     sizeMulti += 0.15; confidenceBoostPP += 8; }

   // ============ GATE 5: AI DIRECTOR (v6.3.0) ============
   // The AI Director sits above all strategies. Strategies submitted signals.
   // AI Director reviews full market context and decides: ALLOW/BLOCK/REDUCE/INCREASE.
   // Hard safety rules (max loss, margin, DD) still sit above AI Director.
   //
   // Called for: ALL grades (A+, A, B) when InpAIDirectorAllGrades=true; A+ only otherwise.
   // Authority: real veto and lot control (not advisory) when InpAIAdvisoryOnly=false.
   bool callAI = InpUseAI && StringLen(InpServerURL) >= 10 && !InpBacktestMode;
   bool gradeQualifiesForAI = (InpAIDirectorAllGrades)
                               ? (grade == "A+" || grade == "A" || grade == "B")
                               : (grade == "A+");
   if(callAI && gradeQualifiesForAI)
   {
      // --- Check AI offline state ---
      if(g_aiOffline && !InpAIOfflineSafeMode)
      {
         // User chose: if AI is offline AND safe mode is off, trade normally (no AI)
         Print("AI DIRECTOR OFFLINE — trading without AI oversight (safe mode disabled)");
      }
      else if(g_aiOffline && InpAIOfflineSafeMode)
      {
         // AI offline + safe mode: reduce lot size by 50%, no blocks/upgrades
         sizeMulti *= 0.5;
         Print("AI DIRECTOR OFFLINE — SAFE MODE: lot reduced 50%, no AI veto/boost. Fails=", g_aiConsecutiveFails);
      }
      else
      {
         // AI is online — call AI Director
         string h1DirStr = (bufEMAFast_H1[1] > bufEMASlow_H1[1]) ? "BULL" : "BEAR";
         int aiResult = GetAIAnalysis(
            bufEMAFast[1], bufEMASlow[1], bufRSI[1], bufATR[1],
            iClose(Symbol(), PERIOD_M5, 1),
            h1DirStr, spread,
            setupName, RegimeName(), signature,
            ArraySize(bufStochK) >= 2 ? bufStochK[1] : 50.0,
            iClose(Symbol(), PERIOD_M5, 1) - iClose(Symbol(), PERIOD_M5, 5),
            grade, setupScore, combinedScore);

         // --- AI Director decision log ---
         string aiVerdictStr = "UNKNOWN";
         string aiDirStr = (aiResult == 1) ? "BUY" : (aiResult == -1) ? "SELL" : "SKIP";
         bool aiConfirms    = (aiResult == signal);
         bool aiDisagrees   = (aiResult != 0 && aiResult != signal);
         // aiUnavailable: server returned 200 but no parseable action AND no skip_if/confidence
         // (true no-response). If AI said SKIP with confidence or skip_if text, it's a real SKIP.
         bool aiUnavailable = (aiResult == 0 && lastAIConfidence == 0 && StringLen(lastAISkipIf) == 0);

         Print("══════════════════ AI DIRECTOR ══════════════════");
         Print("Signal: ", setupName, " ", signal > 0 ? "BUY" : "SELL",
               " | Grade: ", grade, " | Score: ", DoubleToString(combinedScore, 1));
         Print("HTF Consensus: ", (g_htfConsensusDir == 1) ? "BULL" :
                                  (g_htfConsensusDir == -1) ? "BEAR" : "NEUTRAL",
               " | Regime: ", RegimeName(),
               " | RSI: ", DoubleToString(bufRSI[1], 1));
         Print("AI Server: ", (g_aiConsecutiveFails == 0) ? "CONNECTED" : "DEGRADED",
               " | Provider: Claude+GPT dual | Fails: ", g_aiConsecutiveFails);
         Print("Claude Vote: ", g_aiClaudeVote, " | GPT Vote: ", g_aiGPTVote);
         Print("AI Verdict: ", aiDirStr, " | Confidence: ", lastAIConfidence, "%");
         if(StringLen(currentTradeThesis) > 0)
            Print("AI Thesis: ", StringSubstr(currentTradeThesis, 0, 150));
         if(StringLen(lastAIBearishCase) > 0)
            Print("AI Risk: ", StringSubstr(lastAIBearishCase, 0, 120));

         // --- Apply AI Director authority ---
         if(InpAIAdvisoryOnly)
         {
            // Advisory mode: log only, no actual effect on entry
            aiVerdictStr = "ADVISORY";
            Print("AI DIRECTOR MODE: ADVISORY — result logged but no authority exercised");
            g_aiLastVerdict = "ADVISORY"; g_aiLastConfidence = lastAIConfidence;
         }
         else if(aiUnavailable)
         {
            // AI server responded HTTP 200 but returned no action — treat as neutral
            aiVerdictStr = "NEUTRAL";
            Print("AI DIRECTOR: Neutral/no-action response — trade proceeds at standard size");
            g_aiLastVerdict = "NEUTRAL"; g_aiLastConfidence = 0;
         }
         else if(aiDisagrees)
         {
            // v6.3.1 FIX: AI disagreement only BLOCKS when it has enough conviction.
            // A 51% AI should not kill a setup that passed every structural gate.
            // HTF consensus is a hard rule-based structural signal — weak AI never overrides it.
            bool htfConsensusTrade = (g_htfConsensusDir == 1 && signal == 1) ||
                                     (g_htfConsensusDir == -1 && signal == -1);
            if(htfConsensusTrade)
            {
               // HTF consensus overrides weak AI disagreement — reduce lot, never block
               aiVerdictStr = "HTF-OVERRIDE";
               sizeMulti = MathMin(sizeMulti, 0.70);
               Print("AI DIRECTOR: HTF-CONSENSUS OVERRIDE — AI disagrees (", lastAIConfidence,
                     "%) but HTF structure confirmed ", signal > 0 ? "BUY" : "SELL",
                     " | reducing lot x0.70, not blocking");
               g_aiLastVerdict = "HTF-OVERRIDE"; g_aiLastConfidence = lastAIConfidence;
            }
            else if(lastAIConfidence < InpAIDirectorMinConf)
            {
               // AI disagrees but with weak conviction — reduce lot, don't block
               aiVerdictStr = "WEAK-DISAGREE";
               sizeMulti = MathMin(sizeMulti, 0.65);
               Print("AI DIRECTOR: WEAK-DISAGREE (conf=", lastAIConfidence, "% < min ",
                     InpAIDirectorMinConf, "%) — reducing lot x0.65, not blocking");
               g_aiLastVerdict = "WEAK-DISAGREE"; g_aiLastConfidence = lastAIConfidence;
            }
            else
            {
               // AI disagrees with sufficient conviction — BLOCK the trade
               aiVerdictStr = "BLOCK";
               g_gateBlocks_AI++; // v6.3.8 Upgrade 6
               g_ftReport_AIBlocked++; // v6.3.9: forward-test tracking
               string blockMsg = StringFormat(
                  "AI DIRECTOR BLOCK: AI says %s (conf %d%%), strategy says %s. Sufficient conviction to veto.",
                  aiDirStr, lastAIConfidence, signal > 0 ? "BUY" : "SELL");
               Print("AI DIRECTOR: BLOCK — ", blockMsg);
               XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, blockMsg);
               CloudPostReasoning("BLOCK", blockMsg, RegimeName(), setupName, setupScore, combinedScore, grade, signal);
               UpdateDashboard(0, combinedScore, "AI-BLOCK");
               lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "AI-BLOCK";
               g_aiLastVerdict = "BLOCK"; g_aiLastConfidence = lastAIConfidence;
               Print("══════════════════════════════════════════════════");
               return;
            }
         }
         else if(aiResult == 0)
         {
            // AI says SKIP — block if confidence below minimum, else reduce size
            if(lastAIConfidence < InpAIDirectorMinConf && lastAIConfidence > 0)
            {
               aiVerdictStr = "BLOCK";
               g_gateBlocks_AI++; // v6.3.8 Upgrade 6
               g_ftReport_AIBlocked++; // v6.3.9: forward-test tracking
               string blockMsg = StringFormat(
                  "AI DIRECTOR BLOCK: AI SKIP with confidence %d%% < min %.0f%%. Trade blocked.",
                  lastAIConfidence, InpAIDirectorMinConf);
               Print("AI DIRECTOR: BLOCK LOW-CONF — ", blockMsg);
               XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, blockMsg);
               CloudPostReasoning("BLOCK", blockMsg, RegimeName(), setupName, setupScore, combinedScore, "AI-LOW-CONF", signal);
               UpdateDashboard(0, combinedScore, "AI-BLOCK");
               lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "AI-LOW-CONF";
               g_aiLastVerdict = "BLOCK"; g_aiLastConfidence = lastAIConfidence;
               Print("══════════════════════════════════════════════════");
               return;
            }
            // AI SKIP but no confidence score — reduce size, don't block
            aiVerdictStr = "REDUCE";
            sizeMulti = MathMin(sizeMulti, 0.50);
            Print("AI DIRECTOR: REDUCE (AI SKIP/no confidence) — lot x0.50");
            g_aiLastVerdict = "REDUCE"; g_aiLastConfidence = lastAIConfidence;
         }
         else if(aiConfirms)
         {
            // AI confirms same direction — apply conviction sizing
            if(InpConvictionSizing && lastAIConfidence > 0)
            {
               // v6.3.2 FIX: when AI CONFIRMS direction with low confidence — NEVER block.
               // AI agreement at any confidence level means reduce, not veto.
               // Blocking a structurally sound setup because AI is 52% sure is backwards.
               if(lastAIConfidence < InpAIDirectorMinConf)
               {
                  aiVerdictStr = "ALLOW_LOW_CONV";
                  sizeMulti *= InpConvictionLowMulti; // 0.70x mild reduce
                  Print("AI DIRECTOR: LOW-CONV CONFIRM — AI agrees at ", lastAIConfidence,
                        "% < min ", InpAIDirectorMinConf, "% | lot x", DoubleToString(InpConvictionLowMulti, 2),
                        " — NOT blocking (AI confirmed direction, just mild size-reduce)");
                  g_aiLastVerdict = "ALLOW_LOW_CONV"; g_aiLastConfidence = lastAIConfidence;
                  if(StringLen(lastAIBearishCase) > 0) Print("Devil's Advocate: ", lastAIBearishCase);
               }
               else
               {
               double convMult;
               if(lastAIConfidence >= InpHighAIConfidence)
               {
                  convMult = InpConvictionHighMulti;
                  aiVerdictStr = "ALLOW_INCREASE";
               }
               else if(lastAIConfidence >= InpNormalAIConfidence)
               {
                  convMult = 1.0;
                  aiVerdictStr = "ALLOW";
               }
               else
               {
                  convMult = InpConvictionLowMulti;
                  aiVerdictStr = "ALLOW_REDUCE";
               }
               sizeMulti *= convMult;
               Print("AI DIRECTOR: ", aiVerdictStr, " — conf=", lastAIConfidence, "% → lot x",
                     DoubleToString(convMult, 2), " (sizeMulti=", DoubleToString(sizeMulti, 2), ")");
               }  // close else block (high/normal/low conviction branch)
            }  // close if(InpConvictionSizing && lastAIConfidence > 0)
            else
            {
               aiVerdictStr = "ALLOW";
               Print("AI DIRECTOR: ALLOW — AI confirms ", signal > 0 ? "BUY" : "SELL",
                     " at ", lastAIConfidence, "% confidence");
            }
            g_aiLastVerdict = aiVerdictStr; g_aiLastConfidence = lastAIConfidence;
            if(StringLen(lastAIBearishCase) > 0)
               Print("Devil's Advocate: ", lastAIBearishCase);
         }

         Print("Strategy Votes: ", setupName, "→", signal > 0 ? "BUY" : "SELL",
               " | Memory Influence: W=", wins, "/L=", losses,
               " | Final AI Decision: ", aiVerdictStr, " | LotMult=", DoubleToString(sizeMulti, 2));
         Print("══════════════════════════════════════════════════");
      }
   }
   else if(callAI && !gradeQualifiesForAI)
   {
      // Grade is SKIP — shouldn't reach here, but defensive log
      Print("AI DIRECTOR: grade=", grade, " below threshold — AI not called");
   }

   // Store signal context for ML + journal logging
   lastSignalDir = signal;
   lastSignalRSI = bufRSI[1];
   lastSignalEMADiff = (bufEMAFast[1] - bufEMASlow[1]) / bufEMASlow[1] * 10000;
   lastSignalATR = bufATR[1];
   lastSignalSetup = setupName;
   lastSignalSignature = signature;
   g_pendingBrainGrade = grade;
   g_pendingBrainSetupScore = setupScore;
   g_pendingBrainCombinedScore = combinedScore;
   g_pendingBrainEntryAudit = timingReason;

   // v4.5.0 — Remember the AI's conviction on the trade we're about to open,
   // so mid-trade audits can reference both the thesis AND the original confidence.
   currentTradeConfidence = lastAIConfidence;

   // v4.8.0 — CONTEXT GATE (HTF + Swing S/R)
   //   Last defense before OpenTrade. Blocks entries that:
   //     (a) fight H4 bias (e.g., BUY signal but H4 EMA50 < EMA200)
   //     (b) sit within 0.4×ATR of a recent swing high/low without break-retest
   //   Rule-based, zero LLM cost.
   if(!ContextGateAllows(signal, bufATR[1]))
      return;

   // v6.3.8 Upgrade 7: drawdown pause gate
   if(g_drawdownPause)
   {
      g_gateBlocks_DailyLoss++; // re-use daily loss counter for watermark pause
      Print("DRAWDOWN PAUSE ACTIVE: equity below watermark — new entry suppressed for ",
            setupName, " ", signal==1?"BUY":"SELL");
      return;
   }

   // v5.1.0 — PROFIT GUARDIAN gate: blocks counter-trend stacks, tier-3 halt, post-loss cooldown
   // v5.1.9 — now also enforces Selective Mode (A/A+ only after giveback brake)
   string pgBlock = PG_BlockReason(signal, grade, combinedScore, setupName);
   if(StringLen(pgBlock) > 0)
   {
      // Classify gate block type for analytics
      if(StringFind(pgBlock, "volkill") >= 0 || StringFind(pgBlock, "volatility") >= 0)
         g_gateBlocks_Volatility++;
      else if(StringFind(pgBlock, "spread") >= 0)
         g_gateBlocks_Spread++;
      else if(StringFind(pgBlock, "ddfloor") >= 0 || StringFind(pgBlock, "daily loss") >= 0 || StringFind(pgBlock, "soft-DD") >= 0)
         g_gateBlocks_DailyLoss++;
      else
         g_gateBlocks_Trend++;
      Print("PROFIT GUARDIAN VETO: ", pgBlock, " (signal=", signal == 1 ? "BUY" : "SELL", " grade=", grade, ")");
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, pgBlock);
      UpdateDashboard(0, combinedScore, "PG-VETO");
      lastDashGrade = "PG-VETO";
      return;
   }

   // v5.8.38 — adaptive EPF-T4: elite signals may pass at reduced size unless hard DD is hit.
   double epfAdaptiveLotMult = 1.0;
   bool epfT4AdaptivePass = false;
   string epfBlock = EPF_EntryBlockReason(grade, setupScore, combinedScore, signal,
                                          epfAdaptiveLotMult, epfT4AdaptivePass);
   if(StringLen(epfBlock) > 0)
   {
      g_gateBlocks_EPF++; // v6.3.8 Upgrade 6
      Print("EPF VETO: ", epfBlock, " (signal=", signal == 1 ? "BUY" : "SELL",
            " setupScore=", DoubleToString(setupScore, 1),
            " combined=", DoubleToString(combinedScore, 1),
            " grade=", grade, ")");
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, epfBlock);
      CloudPostReasoning("EPF", epfBlock, RegimeName(), setupName,
                         setupScore, combinedScore, "EPF-VETO", signal);
      UpdateDashboard(0, combinedScore, StringFormat("EPF-T%d", epf_tier));
      lastDashGrade = StringFormat("EPF-T%d", epf_tier);
      return;
   }
   // Cluster protection: reject fresh entries too close in price+time to an
   // existing same-direction position. Prevents reversal-amplifying stacks.
   {
      double curPx = (signal == 1)
                     ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
                     : SymbolInfoDouble(Symbol(), SYMBOL_BID);
      if(EPF_IsClusteredEntry(signal, curPx, bufATR[1]))
      {
         g_gateBlocks_EPF++; // v6.3.8 Upgrade 6
         Print("EPF CLUSTER VETO: entry too close to existing same-direction position");
         XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, "EPF CLUSTER VETO");
         UpdateDashboard(0, combinedScore, "EPF-CLUSTER");
         lastDashGrade = "EPF-CLUSTER";
         return;
      }
   }

   // v5.1.9: while Selective Mode is active, reduce lot size by InpPG_SelectiveLotMulti
   double pgLotMult = pg_selectiveActive ? InpPG_SelectiveLotMulti : 1.0;
   // v5.3.1: soft-DD mode also reduces lots (multiplies on top of selective)
   if(IsSoftDDMode()) pgLotMult *= InpSoftDDLotMulti;
   // v5.5.0: EPF tier also reduces lots (stacks on top of selective + soft-DD)
   pgLotMult *= EPF_LotMultiplier();
   pgLotMult *= epfAdaptiveLotMult;
   if(pgLotMult <= 0.0001) {
      Print("🛑 EPF LOT MULT = 0 (lockdown active) — skipping entry");
      return;
   }

   if(epfT4AdaptivePass)
   {
      epf_t4AdaptiveTradesToday++;
      epf_t4LastAdaptiveTrade = TimeCurrent();
      Print("EPF-T4 ADAPTIVE PASS: elite ", grade, " ", (signal == 1 ? "BUY" : "SELL"),
            " allowed with reduced lot x", DoubleToString(epfAdaptiveLotMult, 2),
            " setup=", DoubleToString(setupScore, 1),
            " combined=", DoubleToString(combinedScore, 1),
            " used=", epf_t4AdaptiveTradesToday, "/", InpEPF_T4MaxTradesPerDay);
      CloudPostReasoning("EPF-T4", "Adaptive guarded pass: elite signal allowed with reduced lot",
                         RegimeName(), setupName, setupScore, combinedScore, "EPF-T4-SOFT", signal);
   }

   double brainLotMult = 1.0;
   string brainReason = "";
   if(!XAU_TradeBrainPreEntry(signal, setupName, grade, signature, brainLotMult, brainReason))
   {
      g_gateBlocks_TradeBrain++; // v6.3.8 Upgrade 6
      g_ftReport_TBBlocked++;   // v6.3.9: forward-test tracking
      Print(brainReason);
      XAU_RememberBlockedSignal(signal, setupName, grade, setupScore, combinedScore, brainReason);
      CloudPostReasoning("BLOCK", brainReason, RegimeName(), setupName,
                         setupScore, combinedScore, "TRADE-BRAIN", signal);
      UpdateDashboard(0, combinedScore, "BRAIN-BLOCK");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "BRAIN-BLOCK";
      return;
   }
   g_ftReport_TBAllowed++; // v6.3.9: TradeBrain allowed this trade through
   if(brainLotMult < 0.999)
   {
      sizeMulti *= brainLotMult;
      Print(brainReason);
   }
   else if(StringLen(brainReason) > 0)
      Print(brainReason);

   // v6.0.1 — AI Trading Committee: synthesise market narrative + human rules + pattern memory
   g_committee = Committee_Assemble(signal, setupName, grade, combinedScore);
   g_lastTradePattern  = setupName + "_" + grade;
   g_lastTradeDirLabel = g_committee.directorLabel;
   g_lastTradeCommConf = g_committee.confidence;
   if(InpCommitteeLog)
      Print(g_committee.thesis);
   double committeeSzMult = InpCommitteeLotAdj ? g_committee.lotMultiplier : 1.0;

   // Open trade with grade-scaled sizing (g_stiLotMulti = 1.0 unless STI reduced it)
   if(InpSTI_Enable && g_stiLotMulti < 0.999)
      Print(StringFormat("STI SIZE APPLIED | lot x%.2f | committee x%.2f | final sizeMulti=%.3f",
                         g_stiLotMulti, committeeSzMult, sizeMulti * pgLotMult * g_stiLotMulti * committeeSzMult));

   // v6.3.1 SIZE GUARD: prevent silent 0-lot order when multiple reduction layers stack.
   // Multiplier stacking (grade B 0.45 × AI 0.5 × pgLot × STI × committee) can compound
   // to near-zero; OpenTrade would try to submit a lot below broker minimum and fail silently.
   double finalSzMult = sizeMulti * pgLotMult * g_stiLotMulti * committeeSzMult;
   if(finalSzMult < 0.04)
   {
      Print("SIZE GUARD: finalSzMult=", DoubleToString(finalSzMult, 4),
            " (sizeMulti=", DoubleToString(sizeMulti, 3),
            " × pg=", DoubleToString(pgLotMult, 3),
            " × sti=", DoubleToString(g_stiLotMulti, 2),
            " × comm=", DoubleToString(committeeSzMult, 2),
            ") — below minimum tradeable. Clamping to 0.10x to keep the trade alive.");
      finalSzMult = 0.10;
   }
   // v6.3.8 Upgrade 6: count allowed trade
   g_totalAllowed++;
   // v6.3.9: track AI allow for forward-test report
   if(StringLen(g_aiLastVerdict) > 0 && g_aiLastVerdict != "NEUTRAL" && g_aiLastVerdict != "ADVISORY")
      g_ftReport_AIAllowed++;
   // v6.3.8 Upgrade 5: capture AI verdict for feedback loop (used at close)
   g_lastAIVerdict_ForMemory = g_aiLastVerdict;
   // v6.3.8 Upgrade 3: AI SL/TP Advisory — log what AI recommends, never auto-apply in ADVISORY mode
   // (sl_adjust and tp_adjust arrive in the AI response but are not wired to order placement)
   // They are already parsed in GetAIAnalysis() — we only need to log the advisory here.
   // The actual SL/TP is set inside OpenTrade() using ATR-based logic (unchanged).
   if(InpAISLTPMode == AI_SLTP_ADVISORY)
      Print("AI SLTP ADVISORY: AI suggests slAdj=0 tpAdj=0 (from last AI response) | Using ATR-based SL/TP | Mode=ADVISORY (log only)");
   OpenTrade(signal, bufATR[1], setupName + " [" + grade + "]", finalSzMult);
   // v5.3.1 — remember this entry's grade + score so adverse-pyramid logic and
   // high-grade ratchet looseness can reference them.
   g_lastEntryGrade = grade;
   g_lastEntryScore = combinedScore;
   UpdateDashboard(signal, combinedScore, grade);
   // Cache scan result so the 2-second throttled refresh doesn't overwrite it with zeros
   lastDashSignal = signal;
   lastDashScore  = combinedScore;
   lastDashGrade  = grade;
}

int VolumeDigitsForSymbol()
{
   double lotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
   int lotDigits = 2;
   if(lotStep > 0 && lotStep < 0.01)  lotDigits = 3;
   if(lotStep > 0 && lotStep < 0.001) lotDigits = 4;
   return lotDigits;
}

double NormalizeVolumeDown(double lots)
{
   double lotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
   if(lotStep <= 0) return NormalizeDouble(lots, VolumeDigitsForSymbol());
   double minLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
   lots = MathFloor(lots / lotStep) * lotStep;
   lots = MathMax(0.0, MathMin(maxLot, lots));
   if(lots > 0 && lots < minLot) lots = 0.0;
   return NormalizeDouble(lots, VolumeDigitsForSymbol());
}

double RiskPerLotForDistance(double dist)
{
   double tickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   if(dist <= 0 || tickSize <= 0 || tickValue <= 0) return 0.0;
   return (dist / tickSize) * tickValue;
}

double CurrentAggregateRiskToSL(double &openLots)
{
   openLots = 0.0;
   double risk = 0.0;
   double tickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong tk = PositionGetTicket(i);
      if(!posInfo.SelectByTicket(tk)) continue;
      if(posInfo.Magic() != InpMagicNumber || posInfo.Symbol() != Symbol()) continue;
      double v = posInfo.Volume();
      openLots += v;
      double sl = posInfo.StopLoss();
      if(sl <= 0 || tickSize <= 0 || tickValue <= 0) continue;
      double dist = MathAbs(posInfo.PriceOpen() - sl);
      risk += (dist / tickSize) * tickValue * v;
   }
   return risk;
}

string SetupNameFromType(int setupType)
{
   if(setupType == 1) return "TREND_PULLBACK";
   if(setupType == 2) return "BREAKOUT";
   if(setupType == 3) return "SQUEEZE_RELEASE";
   if(setupType == 4) return "RANGE_REVERSAL";
   if(setupType == 5) return "RSI_EXTREME";
   if(setupType == 6) return "LONDON_FIX_PIN";
   if(setupType == 7) return "MULTI_EXTREME";
   if(setupType == 8) return "ASIA_BREAKOUT";
   return "UNKNOWN";
}

string ExitOwnerFromReason(string reason)
{
   if(StringLen(reason) == 0) return "BROKER/UNKNOWN";
   int p = StringFind(reason, " | ");
   string key = (p > 0) ? StringSubstr(reason, 0, p) : reason;
   if(StringFind(key, "CLEAN") >= 0) return "CLEAN_EXITS";
   if(StringFind(key, "BASKET") >= 0) return "BASKET_PROTECT";
   if(StringFind(key, "PYRAMID") >= 0 || StringFind(key, "PYR") >= 0) return "PYRAMID";
   if(StringFind(key, "AI") >= 0 || StringFind(key, "CLAUDE") >= 0) return "AI";
   if(StringFind(key, "SL") >= 0) return "BROKER_SL";
   if(StringFind(key, "TP") >= 0) return "BROKER_TP";
   return key;
}

void RecordExitAudit(string reason, bool wasWin, double profit)
{
   string key = ExitOwnerFromReason(reason);
   int idx = -1;
   for(int i = 0; i < ArraySize(g_exitReasonKeys); i++)
      if(g_exitReasonKeys[i] == key) { idx = i; break; }
   if(idx < 0)
   {
      idx = ArraySize(g_exitReasonKeys);
      ArrayResize(g_exitReasonKeys, idx + 1);
      ArrayResize(g_exitReasonTrades, idx + 1);
      ArrayResize(g_exitReasonWins, idx + 1);
      ArrayResize(g_exitReasonGrossWin, idx + 1);
      ArrayResize(g_exitReasonGrossLoss, idx + 1);
      g_exitReasonKeys[idx] = key;
      g_exitReasonTrades[idx] = 0;
      g_exitReasonWins[idx] = 0;
      g_exitReasonGrossWin[idx] = 0.0;
      g_exitReasonGrossLoss[idx] = 0.0;
   }
   g_exitReasonTrades[idx]++;
   if(wasWin) g_exitReasonWins[idx]++;
   if(profit >= 0) g_exitReasonGrossWin[idx] += profit;
   else g_exitReasonGrossLoss[idx] += MathAbs(profit);
}

void UpdateAuditDrawdown()
{
   double eq = accInfo.Equity();
   if(g_peakEquityAudit <= 0.0 || eq > g_peakEquityAudit) g_peakEquityAudit = eq;
   if(g_peakEquityAudit > 0.0)
   {
      double dd = g_peakEquityAudit - eq;
      if(dd > g_maxDrawdownAudit) g_maxDrawdownAudit = dd;
   }
}

void PrintBacktestAuditReport()
{
   Print("========== XAUAI TEST MODE REPORT ==========");
   Print("Trades=", totalTrades, " Wins=", wins, " Losses=", losses,
         " MaxDD=$", DoubleToString(g_maxDrawdownAudit, 2));

   for(int st = 1; st <= 8; st++)
   {
      int trades = 0, swins = 0;
      double gw = 0.0, gl = 0.0, net = 0.0;
      for(int i = 0; i < patternCount; i++)
      {
         if(patterns[i].setupType != st) continue;
         trades++;
         if(patterns[i].wasWinner) swins++;
         net += patterns[i].profit;
         if(patterns[i].profit >= 0) gw += patterns[i].profit;
         else gl += MathAbs(patterns[i].profit);
      }
      if(trades <= 0) continue;
      double wr = (double)swins / trades * 100.0;
      double pf = (gl > 0.0) ? gw / gl : (gw > 0.0 ? 999.0 : 0.0);
      Print("SETUP REPORT | ", SetupNameFromType(st),
            " trades=", trades,
            " wr=", DoubleToString(wr, 1), "%",
            " pf=", DoubleToString(pf, 2),
            " avgWin=$", DoubleToString(swins > 0 ? gw / swins : 0.0, 2),
            " avgLoss=$", DoubleToString((trades - swins) > 0 ? gl / (trades - swins) : 0.0, 2),
            " net=$", DoubleToString(net, 2));
   }

   for(int j = 0; j < ArraySize(g_exitReasonKeys); j++)
   {
      int t = g_exitReasonTrades[j];
      if(t <= 0) continue;
      double wr2 = (double)g_exitReasonWins[j] / t * 100.0;
      double pf2 = (g_exitReasonGrossLoss[j] > 0.0) ? g_exitReasonGrossWin[j] / g_exitReasonGrossLoss[j] :
                   (g_exitReasonGrossWin[j] > 0.0 ? 999.0 : 0.0);
      Print("EXIT REPORT | ", g_exitReasonKeys[j],
            " trades=", t,
            " wr=", DoubleToString(wr2, 1), "%",
            " pf=", DoubleToString(pf2, 2),
            " grossWin=$", DoubleToString(g_exitReasonGrossWin[j], 2),
            " grossLoss=$", DoubleToString(g_exitReasonGrossLoss[j], 2));
   }

   Print("AI REPORT | influenced trades=", g_aiInfluencedTrades,
         " wins=", g_aiInfluencedWins,
         " pnl=$", DoubleToString(g_aiInfluencedPnl, 2),
         " | nonAI trades=", g_nonAiTrades,
         " wins=", g_nonAiWins,
         " pnl=$", DoubleToString(g_nonAiPnl, 2));
   Print("PYRAMID REPORT | see journal tags PYR+TRN / PYR+RESCUE and setup report; no separate position-link stats in this build.");
   Print("CLOUD REPORT | heartbeat/post failures are logged live by CLOUD POST/CloudReasoning lines; tester mode disables WebRequest.");
   Print("========== END XAUAI TEST MODE REPORT ==========");
}

//+------------------------------------------------------------------+
//| OPEN TRADE (Gate 4 sizing)                                       |
//+------------------------------------------------------------------+
void OpenTrade(int signal, double atr, string reason, double sizeMulti)
{
   int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double point = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   long stopLevel = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = stopLevel * point;
   double effectiveSingleCap = EffectiveSingleRiskCapPct();
   double effectiveAggregateCap = EffectiveAggregateRiskCapPct();

   // v5.8.6 — Execution-layer hedge backstop. The main signal path already
   // blocks this, but OpenTrade can also be reached by recovery/re-entry paths.
   int openDir = GetOpenExposureDirection();
   if(InpBlockNewEntriesIfHedged && openDir == 2)
   {
      Print("OPEN TRADE BLOCKED: existing mixed BUY+SELL exposure detected. Manage or close the hedge before adding risk.");
      return;
   }
   if(InpOneDirectionOnly && openDir != 0 && openDir != signal)
   {
      Print("OPEN TRADE BLOCKED: one-direction mode active. Existing exposure dir=", openDir,
            " new signal=", signal);
      return;
   }

   // v4.7.6 — AGGREGATE EXPOSURE GATE
   //   Sum up the $-loss-if-SL-hit across ALL currently-open positions in our magic.
   //   This early gate blocks entries when current exposure is already too high.
   //   A second final gate below includes the candidate trade after lot sizing.
   if(effectiveAggregateCap > 0)
   {
      double aggLots = 0.0;
      double aggDollar = CurrentAggregateRiskToSL(aggLots);
      double equity = accInfo.Equity();
      double maxAggDollar = equity * effectiveAggregateCap / 100.0;
      if(aggDollar > maxAggDollar)
      {
         static datetime lastAggSkip = 0;
         if(TimeCurrent() - lastAggSkip > 60)
         {
            Print("⛔ AGG-RISK BLOCK: open positions already risk $", DoubleToString(aggDollar, 0),
                  " (", DoubleToString(aggLots, 2), " lots) > ", DoubleToString(effectiveAggregateCap, 2),
                  "% equity (max $", DoubleToString(maxAggDollar, 0), "). New entries blocked until exposure drops.");
            lastAggSkip = TimeCurrent();
         }
         return;
      }
      // Also enforce InpMaxTotalLots (auto = 3% of equity worst-case at typical SL)
      double maxTotal = InpMaxTotalLots;
      if(maxTotal <= 0)
      {
         // auto: roughly 3% of equity at average SL distance ($16 per lot at 16pt SL × $10)
         maxTotal = (equity * 0.03) / 160.0;
         maxTotal = MathMax(0.5, maxTotal); // never below 0.5
      }
      if(aggLots >= maxTotal)
      {
         static datetime lastLotSkip = 0;
         if(TimeCurrent() - lastLotSkip > 60)
         {
            Print("⛔ TOTAL-LOTS BLOCK: open lots ", DoubleToString(aggLots, 2),
                  " ≥ cap ", DoubleToString(maxTotal, 2), ". New entries blocked.");
            lastLotSkip = TimeCurrent();
         }
         return;
      }
   }

   // v4.6.5 — POST-WINNER ENTRY GUARD (user-tunable, default cooldown 5 min)
   // Toggle off via InpPostWinnerGuard=false. Cooldown via InpPostWinnerCoolMin.
   double bidNow = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double askNow = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   double newEntryNow = (signal == 1) ? askNow : bidNow;
   if(InpPostWinnerGuard && InpPostWinnerCoolMin > 0 &&
      reason != "RE_ENTRY" && lastClose.valid && !lastClose.wasLoss &&
      lastClose.dir == signal &&
      TimeCurrent() - lastClose.closeTime < InpPostWinnerCoolMin * 60)
   {
      double newEntry  = newEntryNow;
      double prevEntry = lastClose.entryPrice;
      double minAdvanceATR = atr * InpPostWinnerATRBump;
      bool betterPrice = false;
      if(signal == 1)  betterPrice = (newEntry <= prevEntry - minAdvanceATR);
      if(signal == -1) betterPrice = (newEntry >= prevEntry + minAdvanceATR);
      if(!betterPrice)
      {
         Print("⏸  POST-WINNER ENTRY BLOCKED: Last ", signal==1?"BUY":"SELL",
               " closed +profit @ ", DoubleToString(prevEntry, digits),
               ". New @ ", DoubleToString(newEntry, digits),
               " not ≥", DoubleToString(InpPostWinnerATRBump,2), "×ATR (",
               DoubleToString(minAdvanceATR, 2), ") better. Cooldown ",
               InpPostWinnerCoolMin, "min.");
         return;
      }
   }

   // v5.8.25 — Trade-cycle guard. The bad pattern in live screenshots was:
   // bank a profitable SELL, then re-sell lower into exhaustion/bottom because
   // the direction still looked correct. For XAU, same-direction re-entry after
   // a winner must wait for a real reset/pullback, not just another signal.
   if(InpPostWinnerCycleGuard && InpPostWinnerCycleMin > 0 && atr > 0 &&
      reason != "RE_ENTRY" && lastClose.valid && !lastClose.wasLoss &&
      lastClose.dir == signal && lastClose.closePrice > 0 &&
      TimeCurrent() - lastClose.closeTime < InpPostWinnerCycleMin * 60)
   {
      double resetDist = atr * InpPostWinnerResetATR;
      double chaseDist = atr * InpPostWinnerChaseATR;
      bool resetSeen = false;
      bool chaseRisk = false;

      if(signal == -1)
      {
         // After a profitable SELL close, require price to pull back UP before
         // another SELL. Selling below the last close is usually late-bottom risk.
         resetSeen = (newEntryNow >= lastClose.closePrice + resetDist);
         chaseRisk = (newEntryNow <= lastClose.closePrice - chaseDist);
      }
      else
      {
         // After a profitable BUY close, require price to pull back DOWN before
         // another BUY. Buying above the last close is usually late-top risk.
         resetSeen = (newEntryNow <= lastClose.closePrice - resetDist);
         chaseRisk = (newEntryNow >= lastClose.closePrice + chaseDist);
      }

      bool basketBank = (StringFind(lastClose.exitReason, "BASKET") >= 0 ||
                         StringFind(lastClose.exitReason, "LOCK") >= 0 ||
                         StringFind(lastClose.exitReason, "peak") >= 0);
      if(!resetSeen && (chaseRisk || basketBank))
      {
         Print("⏸  POST-WINNER CYCLE BLOCK: ", signal == 1 ? "BUY" : "SELL",
               " winner closed @", DoubleToString(lastClose.closePrice, digits),
               " profit $", DoubleToString(lastClose.profit, 2),
               ". New @", DoubleToString(newEntryNow, digits),
               " before reset ", DoubleToString(resetDist, 2),
               " (", DoubleToString(InpPostWinnerResetATR, 2), "×ATR). Avoiding ",
               signal == 1 ? "buying top after bank" : "selling bottom after bank",
               ". Last exit=", lastClose.exitReason);
         return;
      }
   }

   // v5.8.38 — Post-loss same-side retest guard. This is not a drawdown cap:
   // it only blocks the specific bad pattern where a BUY loses, then the EA
   // buys again at a worse/higher price before a real retest; inverse for SELL.
   if(InpPostLossSameSideGuard && InpPostLossGuardMin > 0 && atr > 0 &&
      reason != "RE_ENTRY" && lastClose.valid && lastClose.wasLoss &&
      lastClose.dir == signal && lastClose.entryPrice > 0 &&
      TimeCurrent() - lastClose.closeTime < InpPostLossGuardMin * 60)
   {
      double betterDist = atr * InpPostLossBetterATR;
      bool betterRetest = false;
      if(signal == 1)
         betterRetest = (newEntryNow <= lastClose.entryPrice - betterDist);
      else
         betterRetest = (newEntryNow >= lastClose.entryPrice + betterDist);

      if(!betterRetest)
      {
         Print("POST-LOSS SAME-SIDE BLOCK: last ", signal == 1 ? "BUY" : "SELL",
               " lost from entry ", DoubleToString(lastClose.entryPrice, digits),
               " close ", DoubleToString(lastClose.closePrice, digits),
               ". New entry ", DoubleToString(newEntryNow, digits),
               " is not a better retest by ", DoubleToString(InpPostLossBetterATR, 2),
               "x ATR (", DoubleToString(betterDist, 2),
               "). Waiting instead of chasing after loss. Last exit=", lastClose.exitReason);
         g_lastSkipReason = "POST-LOSS SAME-SIDE BLOCK: waiting for better retest after loss";
         return;
      }
   }
   double price, sl, tp, slDist;

   // Dynamic SL/TP: Low vol = tighter, trending = wider
   double slM = InpSLMultiplier;
   double tpM = EffTPMultiplier();
   if(currentRegime == REGIME_LOW_VOL || currentRegime == REGIME_CHOPPY)
   { slM = MathMax(0.8, slM * 0.5); tpM = 1.5; }
   else if(currentRegime == REGIME_BREAKOUT_UP || currentRegime == REGIME_BREAKOUT_DOWN)
   { tpM = 2.5; }

   if(signal == 1)
   {
      price = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
      if(price <= 0) return;
      slDist = MathMax(atr * slM, minDist);
      sl = NormalizeDouble(price - slDist, digits);
      tp = NormalizeDouble(price + slDist * tpM, digits);
   }
   else
   {
      price = SymbolInfoDouble(Symbol(), SYMBOL_BID);
      if(price <= 0) return;
      slDist = MathMax(atr * slM, minDist);
      sl = NormalizeDouble(price + slDist, digits);
      tp = NormalizeDouble(price - slDist * tpM, digits);
   }

   // Lot sizing with grade multiplier
   double balance = StrategyReferenceBalance();
   // v4.8.2 — Account Mode preset overrides InpRiskPercent
   // v5.8.4 — Restore original account-based risk presets for demo/cloud testing.
   double baseRisk = InpRiskPercent;
   if(InpAccountMode == ACCT_BALANCED)     baseRisk = 1.2;
   if(InpAccountMode == ACCT_CONSERVATIVE) baseRisk = 0.6;
   if(InpAccountMode == ACCT_AGGRESSIVE)   baseRisk = 2.0;
   double riskPct = baseRisk * sizeMulti;
   bool entryQualityScout = (sizeMulti <= InpBlockedMemoryScoutLotMulti * 0.75 ||
                             StringFind(g_pendingBrainEntryAudit, "REPORT-FIT SCOUT") >= 0 ||
                             StringFind(g_pendingBrainEntryAudit, "BLOCKED-MEMORY SCOUT") >= 0);
   double riskAfterSignal = riskPct;

   double acctSizeMult = AccountSizeRiskMultiplier();
   if(acctSizeMult != 1.0)
   {
      Print("ACCOUNT-SCALE: strategy reference $", DoubleToString(StrategyReferenceBalance(), 2),
            " risk×", DoubleToString(acctSizeMult, 2),
            " (large accounts scale stronger; small accounts protected)");
      riskPct *= acctSizeMult;
   }
   if(entryQualityScout && InpEntryQualityScoutRiskCap > 0.0 && riskPct > InpEntryQualityScoutRiskCap)
   {
      Print("SCOUT-RISK CAP: memory/scout entry risk ",
            DoubleToString(riskPct, 2), "% -> ",
            DoubleToString(InpEntryQualityScoutRiskCap, 2),
            "% so blocked-memory recovery cannot become a full-size trade.");
      riskPct = InpEntryQualityScoutRiskCap;
   }
   double riskAfterAccount = riskPct;

   // v5.1.0 — PROFIT GUARDIAN: tier-based risk scaling on top of everything else
   double pgMult = PG_RiskMultiplier();
   if(pgMult < 1.0)
   {
      Print("🛡 PG risk×", DoubleToString(pgMult,2),
            " (HWM=$", DoubleToString(pg_dayHWM,2), ")");
      riskPct *= pgMult;
      if(pgMult <= 0.001) return;   // tier 3: no new lots
   }
   if(entryQualityScout && InpEntryQualityScoutRiskCap > 0.0 && riskPct > InpEntryQualityScoutRiskCap)
   {
      Print("SCOUT-RISK CAP: post-PG memory/scout risk ",
            DoubleToString(riskPct, 2), "% -> ",
            DoubleToString(InpEntryQualityScoutRiskCap, 2), "%");
      riskPct = InpEntryQualityScoutRiskCap;
   }
   double riskAfterPG = riskPct;

   // DRAWDOWN RECOVERY MODE: cap risk at InpDrawdownRisk% until we get a win
   if(drawdownActive)
   {
      double cappedRisk = MathMin(riskPct, InpDrawdownRisk);
      if(cappedRisk < riskPct)
      {
         Print("DRAWDOWN MODE: risk ", DoubleToString(riskPct,2), "% -> capped ", DoubleToString(cappedRisk,2), "%");
         riskPct = cappedRisk;
      }
   }

   // Careful mode near weekly target
   if(InpCarefulMode && weeklyStartEquity > 0)
   {
      double wPct = (accInfo.Equity() - weeklyStartEquity) / weeklyStartEquity * 100;
      if(wPct > InpWeeklyTarget * 0.75) riskPct *= 0.25;
      else if(wPct > InpWeeklyTarget * 0.5) riskPct *= 0.5;
   }
   double riskAfterCareful = riskPct;

   // Session scaling
   MqlDateTime dt; TimeCurrent(dt);
   double sessionMult = 1.0;
   if(dt.hour >= 0 && dt.hour < 8)
   {
      bool cleanHighGrade = (StringFind(reason, "[A+]") >= 0 || StringFind(reason, "[A]") >= 0);
      bool trendContinuation = IsTrendContinuationRegime(signal);
      // v6.3.2: raised Asia floor 0.40→0.55 — 0.40× on B-grade was compounding to
      // sub-minLot on small accounts (grade B 0.45 × asia 0.40 = 0.18× = $6 risk = 0-lot)
      double asianMult = 0.55;
      if(trendContinuation && cleanHighGrade && !entryQualityScout)
         asianMult = g_propFirmMode ? 0.65 : 0.80;
      else if(trendContinuation && !entryQualityScout)
         asianMult = g_propFirmMode ? 0.55 : 0.65;
      sessionMult = asianMult;
      riskPct *= asianMult; // v5.8.54: do not crush clean A/A+ continuation trades on small non-prop accounts.
   }
   double riskAfterSession = riskPct;

   // v6.3.8 Upgrade 7: performance multiplier (anti-martingale, ATR-normalized)
   double perfMult = GetPerformanceMultiplier();
   if(perfMult != 1.0)
      riskPct *= perfMult;

   // Auto risk scaling from streaks
   double patternMult = 1.0;
   if(patternCount >= 5)
   {
      int rW = 0;
      for(int p = patternCount - 1; p >= MathMax(0, patternCount - 5); p--)
         if(patterns[p].wasWinner) rW++;
      if(rW >= 4) { patternMult = 1.3; riskPct *= patternMult; }
      else if(rW == 0) { patternMult = 0.70; riskPct *= patternMult; } // v6.3.2: changed rW<=1 to rW==0 — 4L+1W was penalising the recovery trade; only reduce when ALL 5 recent are losses
   }
   double riskAfterPattern = riskPct;

   // VOLATILITY-ADAPTIVE SIZING (reduce in vol spikes, boost in calm)
   double volMult = GetVolAdaptiveMult();
   if(volMult != 1.0)
   {
      Print("VOL-ADAPT: risk × ", DoubleToString(volMult, 2),
            " (ATR vs median; ", volMult < 1.0 ? "high vol — shrinking" : "calm — slight boost", ")");
      riskPct *= volMult;
   }

   if(g_propFirmMode && g_propFirmRiskPerTradePct > 0.0 &&
      riskPct > g_propFirmRiskPerTradePct)
   {
      Print("PROP-FIRM RISK CAP: calculated entry risk ",
            DoubleToString(riskPct, 2), "% -> ",
            DoubleToString(g_propFirmRiskPerTradePct, 2),
            "%. Signal remains allowed; only position size is reduced.");
      riskPct = g_propFirmRiskPerTradePct;
   }

   double equityForSizing = StrategyReferenceBalance();
   double largeFloor = 0.0;
   if(g_propFirmMode)
      Print("PROP-FIRM MODE: large-account risk floor disabled.");
   else if(InpLargeAccountMinRiskPct > 0 && equityForSizing >= 50000.0 && !drawdownActive && pgMult > 0.40)
      largeFloor = InpLargeAccountMinRiskPct;
   else if(InpLargeAccountMinRiskPct > 0 && equityForSizing >= 25000.0 && !drawdownActive && pgMult > 0.40)
      largeFloor = MathMin(1.25, InpLargeAccountMinRiskPct);

   if(entryQualityScout && largeFloor > 0)
   {
      Print("SCOUT-RISK: large-account lot floor bypassed for memory/scout entry. risk=",
            DoubleToString(riskPct, 2), "% floor=", DoubleToString(largeFloor, 2),
            "% reason=", reason);
   }
   else if(largeFloor > 0 && riskPct < largeFloor)
   {
      Print("LOT-FLOOR: large account equity $", DoubleToString(equityForSizing, 2),
            " raised effective risk ", DoubleToString(riskPct, 2), "% -> ",
            DoubleToString(largeFloor, 2),
            "% after small multipliers. Equity cap still limits final lots.");
      riskPct = largeFloor;
   }

   double riskAmount = balance * riskPct / 100.0;
   double tickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   double minLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
   if(tickValue <= 0 || tickSize <= 0 || slDist <= 0) return;

   double slDollarPerLotRaw = (slDist / tickSize) * tickValue;
   double rawLots = riskAmount / slDollarPerLotRaw;
   double lots = MathFloor(rawLots / lotStep) * lotStep;
   double brokerLimitedLots = MathMin(maxLot, lots);
   if(brokerLimitedLots < minLot)
   {
      // v6.3.2 FIX: if rawLots > 0 the setup is real — multiplier stacking (grade, AI,
      // session, EPF, STI, pattern) compressed the size below broker minimum. Clamp to
      // minLot rather than silently skip. A minLot trade is better than no trade.
      if(rawLots > 0)
      {
         Print("LOT-CALC FLOOR: stacked multipliers compressed lots to ", DoubleToString(brokerLimitedLots,4),
               " (below minLot=", DoubleToString(minLot,4), ") — clamping to minLot to keep valid signal alive.");
         lots = minLot;
      }
      else
      {
         Print("LOT-CALC SKIP: zero rawLots — riskAmt=$", DoubleToString(riskAmount,2),
               " slDist=", DoubleToString(slDist,2), " sl$/lot=$", DoubleToString(slDollarPerLotRaw,2));
         return;
      }
   }
   lots = brokerLimitedLots;
   double beforeInpMaxLots = lots;
   if(lots > InpMaxLots) lots = InpMaxLots;
   double afterInpMaxLots = lots;

   // v4.7.5 — HARD EQUITY-% CAP: regardless of risk math, no single trade can
   //   risk more than InpMaxRiskPctEquity% of current equity if SL hits.
   //   This is the absolute backstop that prevents the "5+ lot whacked for $4k"
   //   scenario the user reported on a $100k account. SL distance × tick value
   //   × lots = $-loss-if-SL-hit. Cap that at e.g. 1.5% of equity.
   if(effectiveSingleCap > 0 && slDist > 0 && tickValue > 0 && tickSize > 0)
   {
      double equity = StrategyReferenceBalance();
      double maxDollarLoss = equity * effectiveSingleCap / 100.0;
      double slDollarPerLot = slDollarPerLotRaw;
      if(slDollarPerLot > 0)
      {
         double maxAllowedLots = maxDollarLoss / slDollarPerLot;
         if(lots > maxAllowedLots)
         {
            Print("⚠️  EQUITY-CAP: lots ", DoubleToString(lots, 2), " → ",
                  DoubleToString(maxAllowedLots, 2),
                  " (would risk $", DoubleToString(lots * slDollarPerLot, 0),
                  " > ", DoubleToString(effectiveSingleCap, 2), "% equity = $",
                  DoubleToString(maxDollarLoss, 0), ")");
            lots = maxAllowedLots;
         }
      }
   }
   // Derive lot decimal precision from broker's lotStep (not a hardcoded 2)
   int lotDigits = 2;
   if(lotStep > 0 && lotStep < 0.01) lotDigits = 3;
   if(lotStep > 0 && lotStep < 0.001) lotDigits = 4;
   lots = NormalizeDouble(lots, lotDigits);
   if(lots < minLot)
   {
      Print("LOT-CALC SKIP: final lot ", DoubleToString(lots, lotDigits),
            " below broker minimum ", DoubleToString(minLot, lotDigits),
            " after risk/equity caps. Trade skipped safely.");
      return;
   }

   if(effectiveAggregateCap > 0 && slDollarPerLotRaw > 0)
   {
      double openLots = 0.0;
      double openRisk = CurrentAggregateRiskToSL(openLots);
      double maxAggDollar = StrategyReferenceBalance() * effectiveAggregateCap / 100.0;
      double candidateRisk = lots * slDollarPerLotRaw;
      double remainingRisk = maxAggDollar - openRisk;
      if(remainingRisk <= 0)
      {
         Print("AGG-RISK FINAL BLOCK: openRisk=$", DoubleToString(openRisk, 0),
               " (", DoubleToString(openLots, 2), " lots) >= maxAgg=$",
               DoubleToString(maxAggDollar, 0), ". Candidate skipped.");
         return;
      }
      if(candidateRisk > remainingRisk)
      {
         double beforeAggLots = lots;
         lots = NormalizeVolumeDown(remainingRisk / slDollarPerLotRaw);
         Print("AGG-RISK FINAL CAP: lots ", DoubleToString(beforeAggLots, lotDigits),
               " -> ", DoubleToString(lots, lotDigits),
               " | openRisk=$", DoubleToString(openRisk, 0),
               " candidate=$", DoubleToString(candidateRisk, 0),
               " remaining=$", DoubleToString(remainingRisk, 0),
               " maxAgg=$", DoubleToString(maxAggDollar, 0));
         if(lots < minLot)
         {
            Print("AGG-RISK FINAL SKIP: remaining risk room cannot support broker min lot ",
                  DoubleToString(minLot, lotDigits), ".");
            return;
         }
      }
   }

   // Margin check
   double freeMargin = accInfo.FreeMargin();
   double marginNeeded = 0;
   double desiredLots = lots;   // v4.5.5 — remember pre-clamp lot for WARN log
   if(OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded))
   {
      while(lots > minLot && marginNeeded > freeMargin * 0.5)
      {
         lots -= lotStep; lots = MathMax(minLot, lots);
         if(!OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded))
         {
            Print("OrderCalcMargin failed — skip trade");
            return;
         }
      }
      if(marginNeeded > freeMargin * 0.8) { Print("NO MARGIN"); return; }
   }
   lots = NormalizeDouble(lots, lotDigits);

   Print("LOT-CALC: balance=$", DoubleToString(balance,2),
         " equity=$", DoubleToString(equityForSizing,2),
         " modeRisk=", DoubleToString(baseRisk,2), "%",
         " signalMult=", DoubleToString(sizeMulti,2),
         " riskSignal=", DoubleToString(riskAfterSignal,2), "%",
         " acctMult=", DoubleToString(acctSizeMult,2),
         " riskAcct=", DoubleToString(riskAfterAccount,2), "%",
         " pgMult=", DoubleToString(pgMult,2),
         " riskPG=", DoubleToString(riskAfterPG,2), "%",
         " riskCareful=", DoubleToString(riskAfterCareful,2), "%",
         " sessionMult=", DoubleToString(sessionMult,2),
         " riskSession=", DoubleToString(riskAfterSession,2), "%",
         " patternMult=", DoubleToString(patternMult,2),
         " riskPattern=", DoubleToString(riskAfterPattern,2), "%",
         " volMult=", DoubleToString(volMult,2),
         " finalRisk=", DoubleToString(riskPct,2), "%",
         " riskUSD=$", DoubleToString(riskAmount,2),
         " slDist=", DoubleToString(slDist,2),
         " sl$/lot=$", DoubleToString(slDollarPerLotRaw,2),
         " rawLots=", DoubleToString(rawLots,3),
         " brokerLots=", DoubleToString(brokerLimitedLots,lotDigits),
         " beforeMax=", DoubleToString(beforeInpMaxLots,lotDigits),
         " maxInputLots=", DoubleToString(InpMaxLots,2),
         " afterMax=", DoubleToString(afterInpMaxLots,lotDigits),
         " finalLots=", DoubleToString(lots,lotDigits));

   // v5.8.52: append structured lot-sizing detail for Command Center / Intelligence CSV.
   {
      string lotDetail = StringFormat(
         " | APLUS_LOT_REDUCED_REASON: gradeLotMultiplier=%.2f baseRisk=%.2f%% "
         "acctMult=%.2f pgMult=%.2f sessionMult=%.2f patternMult=%.2f "
         "volMult=%.2f finalRisk=%.2f%% riskCap=%.2f%% equityRisk=$%.2f "
         "slDist=%.2f rawLot=%.3f finalLot=%.2f",
         sizeMulti, baseRisk, acctSizeMult, pgMult, sessionMult, patternMult,
         volMult, riskPct, effectiveSingleCap, riskAmount, slDist, rawLots, lots);
      g_pendingBrainEntryAudit += lotDetail;
   }

   // v4.5.5 — LOUD WARN if margin forced a lot reduction > 20%.
   // v4.5.6 — Throttled to once per 5 min to avoid log spam.
   if(desiredLots > 0 && (desiredLots - lots) / desiredLots > 0.20)
   {
      static datetime lastMarginWarnTime = 0;
      if(TimeCurrent() - lastMarginWarnTime > 300)
      {
         Print("⚠️  MARGIN-CAPPED: desired ", DoubleToString(desiredLots, lotDigits),
               " lots → reduced to ", DoubleToString(lots, lotDigits),
               " (free margin $", DoubleToString(freeMargin,2),
               " too low to support full size). Consider closing some open positions.");
         lastMarginWarnTime = TimeCurrent();
      }
      // Extra guard: if resulting lot is at/near minLot AND we wanted much bigger,
      // SKIP entirely rather than opening a pointless minLot trade + pyramid chain.
      if(lots <= minLot * 1.01 && desiredLots >= minLot * 5)
      {
         Print("⚠️  SKIPPING TRADE: margin-clamp dropped lot to broker minimum — trade would be meaningless.");
         return;
      }
   }

   Print("EXECUTING: ", signal > 0 ? "BUY" : "SELL",
         " Price=", DoubleToString(price, digits),
         " SL=", DoubleToString(sl, digits),
         " TP=", DoubleToString(tp, digits),
         " Lots=", DoubleToString(lots, lotDigits),
         " | ", reason);

   bool ok;
   if(signal == 1) ok = trade.Buy(lots, Symbol(), 0, sl, tp, "XAU-SNIPER|" + reason);
   else ok = trade.Sell(lots, Symbol(), 0, sl, tp, "XAU-SNIPER|" + reason);

   ulong openedDealTicket = ok ? trade.ResultDeal() : 0;
   ulong openedPosId = 0;
   if(ok && openedDealTicket > 0 && HistoryDealSelect(openedDealTicket))
      openedPosId = (ulong)HistoryDealGetInteger(openedDealTicket, DEAL_POSITION_ID);
   if(ok && openedPosId == 0) openedPosId = trade.ResultOrder(); // fallback (broker-dependent)

   if(ok)
   {
      // v5.8.51: slippage monitoring — tracks difference between requested and filled price.
      // On live ECN accounts, slippage is a real cost. Logged when > 0.20×ATR.
      {
         double fillPx = trade.ResultPrice();
         MqlDateTime dt; TimeCurrent(dt);
         datetime today = StringToTime(StringFormat("%04d.%02d.%02d", dt.year, dt.mon, dt.day));
         if(g_slippageResetDay != today) { g_dailySlippageTotal = 0; g_dailySlippageCount = 0; g_slippageResetDay = today; }
         if(fillPx > 0 && price > 0)
         {
            double slippagePts = MathAbs(fillPx - price);
            g_dailySlippageTotal += slippagePts;
            g_dailySlippageCount++;
            if(atr > 0 && slippagePts / atr > 0.20)
               Print("SLIPPAGE WARN: ", signal > 0 ? "BUY" : "SELL",
                     " req=", DoubleToString(price, digits),
                     " fill=", DoubleToString(fillPx, digits),
                     " slip=", DoubleToString(slippagePts, digits),
                     " (", DoubleToString(slippagePts / atr * 100.0, 1), "% ATR)",
                     " | daily avg=", DoubleToString(g_dailySlippageCount > 0 ? g_dailySlippageTotal / g_dailySlippageCount : 0, digits));
         }
      }
      todayTradeCount++;
      lastTradeDir = signal;
      XAU_BrainRecordOpen(openedPosId, signal, price, sl, tp, lots, atr,
                          lastSignalSetup, g_pendingBrainGrade, lastSignalSignature,
                          g_pendingBrainSetupScore, g_pendingBrainCombinedScore,
                          reason + " | " + g_pendingBrainEntryAudit);
      BotMonitorActivity("TRADE_EXECUTED", "TRADE",
                         StringFormat("FIRED %s %.2f lot @%.2f SL:%.2f TP:%.2f grade=%s",
                                      signal == 1 ? "BUY" : "SELL", lots, price, sl, tp,
                                      g_pendingBrainGrade));
   }
   else
   {
      Print("TRADE FAILED: Err=", GetLastError(), " Ret=", trade.ResultRetcode());
      BotMonitorActivity("TRADE_FAILED", "ERROR",
                         StringFormat("Trade failed err=%d ret=%d", GetLastError(), trade.ResultRetcode()));
   }

   // v5.0.0 — XAUAI CLOUD fanout: mirror this open to subscribers
   if(ok && CloudEnabled())
   {
      string grade = CloudExtractGrade(reason);
      double riskHintPct = InpRiskPercent;
      if(InpAccountMode == ACCT_BALANCED)     riskHintPct = 1.2;
      if(InpAccountMode == ACCT_CONSERVATIVE) riskHintPct = 0.6;
      if(InpAccountMode == ACCT_AGGRESSIVE)   riskHintPct = 2.0;
      string sigId = CloudPostSignal(Symbol(), signal == 1 ? "BUY" : "SELL",
                                     price, sl, tp, grade, riskHintPct,
                                     lots,                                // v1.3: master lot size
                                     accInfo.Balance());                  // v1.3: master balance ($)
      if(StringLen(sigId) > 0 && openedPosId > 0) CloudMapAdd(openedPosId, sigId);
      // v5.1.5 — push to bot-reasoning feed so subscribers see EVERY trade fire
      string setupForCloud = reason;
      int setupBracket = StringFind(setupForCloud, " [");
      if(setupBracket >= 0) setupForCloud = StringSubstr(setupForCloud, 0, setupBracket);
      string fireMsg = StringFormat("FIRED %s @%.2f SL:%.2f TP:%.2f grade=%s setup=%s",
                                     signal == 1 ? "BUY" : "SELL", price, sl, tp, grade, setupForCloud);
      CloudPostReasoning("FIRE", fireMsg, RegimeName(), setupForCloud, 0.0, 0.0, grade, signal);
      br_lastReason = ""; br_lastReasonAt = 0; // reset block-throttle
   }
}

//+------------------------------------------------------------------+
//| LogExit — structured trader-style exit card                      |
//| Produces 3 lines per exit:                                       |
//|   1. One-line summary (greppable)                                |
//|   2. Full market context at close                                |
//|   3. Plain-English reason                                        |
//| Also saved to "lastExitReason" for dashboard + journal.          |
//+------------------------------------------------------------------+
string lastExitReason = "";    // visible on dashboard

void LogExit(ulong ticket, string dir, double openPx, double closePx,
             double profit, double peak, int minsOpen,
             double rsi, double emaFast, double close1, double open1,
             string path, string reason)
{
   double priceMove = (dir == "BUY") ? (closePx - openPx) : (openPx - closePx);
   string barDir = (close1 > open1) ? "GREEN" : (close1 < open1) ? "RED" : "DOJI";
   string emaRel = (close1 > emaFast) ? "above-EMA" : "below-EMA";
   string rsiZone = rsi > 70 ? "OB" : rsi > 55 ? "bull" : rsi > 45 ? "neutral" : rsi > 30 ? "bear" : "OS";

   // Line 1: summary
   Print("┌─ EXIT #", ticket, " ", dir, " @ ", DoubleToString(closePx, _Digits),
         "  P/L: $", DoubleToString(profit, 2), "  Peak: $", DoubleToString(peak, 2),
         "  Move: ", DoubleToString(priceMove, _Digits), "  T+", minsOpen, "min");
   // Line 2: context
   Print("│  Path: ", path, "  |  Bar: ", barDir, "  EMA: ", emaRel,
         "  RSI: ", DoubleToString(rsi, 1), " (", rsiZone, ")");
   // Line 3: human explanation
   Print("└─ Reason: ", reason);

   lastExitReason = path + " | $" + DoubleToString(profit, 2) + " | " + reason;
}

bool CloseBasketPartial(double closePct, string reason)
{
   if(InpCloudSafeDisablePartials)
   {
      PrintFormat("BASKET PARTIAL SKIPPED: cloud-safe lifecycle enabled; no partial basket close (%s)", reason);
      return false;
   }

   bool anyClosed = false;
   double pct = MathMax(1.0, MathMin(closePct, 90.0));

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != InpMagicNumber || posInfo.Symbol() != Symbol()) continue;

      ulong ticket = posInfo.Ticket();
      double lotsOpen = posInfo.Volume();
      double step = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
      double minL = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
      int lotDig = 2;
      if(step > 0 && step < 0.01)  lotDig = 3;
      if(step > 0 && step < 0.001) lotDig = 4;

      double closeLots = lotsOpen * pct / 100.0;
      if(step > 0) closeLots = MathFloor(closeLots / step) * step;
      closeLots = NormalizeDouble(closeLots, lotDig);
      double runnerLots = NormalizeDouble(lotsOpen - closeLots, lotDig);

      if(closeLots < minL || runnerLots < minL)
      {
         PrintFormat("BASKET SOFT-LOCK SKIP #%I64u | lots %.2f close %.2f runner %.2f min %.2f — too small to split",
                     ticket, lotsOpen, closeLots, runnerLots, minL);
         continue;
      }

      if(trade.PositionClosePartial(ticket, closeLots))
      {
         anyClosed = true;
         PrintFormat("BASKET SOFT-LOCK #%I64u | %s | banked %.2f lots (%.0f%%), runner %.2f lots stays alive",
                     ticket, reason, closeLots, pct, runnerLots);
      }
      else
      {
         PrintFormat("BASKET SOFT-LOCK FAIL #%I64u | wanted %.2f lots from %.2f, ret=%d err=%d",
                     ticket, closeLots, lotsOpen, trade.ResultRetcode(), GetLastError());
      }
   }

   return anyClosed;
}
//+------------------------------------------------------------------+
//| v4.9.4 — BASKET PROTECT                                          |
//|   Treat ALL open EA positions as a single basket. Protect the    |
//|   AGGREGATE floating PnL (not per-trade). v5.8.15 banks partial  |
//|   basket profit first and keeps a runner alive. Close-all is     |
//|   reserved for fast reversal, hard giveback, or second failure.  |
//|                                                                  |
//|   Returns true if it closed all positions this tick — caller     |
//|   should skip per-trade ManagePositions() to avoid redundant     |
//|   work on an empty book.                                         |
//+------------------------------------------------------------------+
bool ManageBasket()
{
   if(!InpBasketMode) return false;

   // Reset state when flat
   if(CountMyPositions() == 0)
   {
      if(g_basketArmed || g_basketBEHit || g_basketPeakUSD != 0 || g_basketFloorUSD != 0)
      {
         g_basketPeakUSD  = 0;
         g_basketFloorUSD = 0;
         g_basketArmed    = false;
         g_basketBEHit    = false;
         g_basketSoftLockTaken = false;
         ArrayResize(g_basketSnapPnL, 0); ArrayResize(g_basketSnapTime, 0);
      }
      return false;
   }

   // Aggregate floating PnL across all EA positions on this symbol
   double totalPnL = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != InpMagicNumber || posInfo.Symbol() != Symbol()) continue;
      totalPnL += posInfo.Profit() + posInfo.Swap() + posInfo.Commission();
   }

   // Update peak
   if(totalPnL > g_basketPeakUSD) g_basketPeakUSD = totalPnL;

   double bal = StrategyReferenceBalance();
   if(bal <= 0) return false;

   // Arm the basket-lock once peak crosses threshold
   double armUSD = MathMax(InpBasketArmFloor, bal * EffBasketArmPct() / 100.0);
   // v5.3.0 — Phase 3: dynamic basket TP. If momentum is still accelerating
   // (last 3 M5 closes are higher-highs for buys / lower-lows for sells AND
   // ATR is rising), push arm threshold +25% so we don't flush too early on
   // a strong trend continuation.
   if(InpDynamicBasketTP && !g_basketArmed)
   {
      double cl[3]; int hATR_dbtp = iATR(Symbol(), PERIOD_M5, 14);
      double atrBuf[3];
      if(CopyClose(Symbol(), PERIOD_M5, 0, 3, cl) >= 3 &&
         hATR_dbtp != INVALID_HANDLE && CopyBuffer(hATR_dbtp, 0, 0, 3, atrBuf) >= 3)
      {
         bool risingATR = atrBuf[0] > atrBuf[2];
         bool acceleratingUp   = (cl[0] > cl[1] && cl[1] > cl[2]);
         bool acceleratingDown = (cl[0] < cl[1] && cl[1] < cl[2]);
         if(risingATR && (acceleratingUp || acceleratingDown))
            armUSD *= 1.25;     // give the trend extra room
      }
   }
   if(!g_basketArmed && g_basketPeakUSD >= armUSD) g_basketArmed = true;

   // BE flag: once basket reached BE threshold, never let it go negative
   double beArmUSD = bal * EffBasketBEPct() / 100.0;
   if(!g_basketBEHit && g_basketPeakUSD >= beArmUSD) g_basketBEHit = true;

   // Compute dynamic floor based on tiered peak thresholds
   //   Base rule: floor = BasketLockMinPct% of peak (40% max giveback).
   //   As peak grows past T1/T2/T3 tiers, lock tightens (50% / 60% / 70%).
   double floorUSD = 0;
   if(g_basketArmed)
   {
      double lockPct = EffBasketLockMinPct();
      double t1USD = bal * EffBasketRatchetT1Pct() / 100.0;
      double t2USD = bal * EffBasketRatchetT2Pct() / 100.0;
      double t3USD = bal * EffBasketRatchetT3Pct() / 100.0;
      if(g_basketPeakUSD >= t1USD) lockPct = MathMax(lockPct, 50.0);
      if(g_basketPeakUSD >= t2USD) lockPct = MathMax(lockPct, 60.0);
      if(g_basketPeakUSD >= t3USD) lockPct = MathMax(lockPct, 70.0);
      floorUSD = g_basketPeakUSD * lockPct / 100.0;
   }

   // BE safety: once BE armed, floor can never go below $1 (protect against full giveback)
   if(g_basketBEHit) floorUSD = MathMax(floorUSD, 1.0);

   // Floor can only ratchet UP, never down
   if(floorUSD > g_basketFloorUSD) g_basketFloorUSD = floorUSD;

   // Log state every 60s so user can watch live
   if(TimeCurrent() - g_basketLastLog >= 60)
   {
      PrintFormat("BASKET │ PnL=$%.2f │ Peak=$%.2f │ Floor=$%.2f │ Armed=%s BE=%s",
                  totalPnL, g_basketPeakUSD, g_basketFloorUSD,
                  g_basketArmed ? "Y" : "N", g_basketBEHit ? "Y" : "N");
      g_basketLastLog = TimeCurrent();
   }

   // ============ v4.9.7 SMART GUARDS (run BEFORE floor trigger) ============
   //
   //   Guard 1 — FAST REVERSAL CIRCUIT BREAKER
   //   Push current PnL into rolling buffer. If basket gives back ≥ FastDropPct%
   //   of peak within FastWindowSec → close immediately. This catches news spikes
   //   and 1-minute reversals where price collapses faster than the floor logic
   //   can react. Without this, a longer arm threshold means more exposure.
   //
   //   Guard 2 — HARD $ GIVEBACK CAP
   //   Regardless of percentage rules, never give back more than HardGivebackPct%
   //   of balance from peak. This is the absolute backstop for tail-risk events.
   //
   if(g_basketArmed)
   {
      // append snapshot
      int sz = ArraySize(g_basketSnapPnL);
      ArrayResize(g_basketSnapPnL, sz + 1);
      ArrayResize(g_basketSnapTime, sz + 1);
      g_basketSnapPnL[sz]  = totalPnL;
      g_basketSnapTime[sz] = TimeCurrent();
      // trim any samples older than the window (and cap the array)
      datetime cutoff = TimeCurrent() - InpBasketFastWindowSec;
      int firstKeep = 0;
      while(firstKeep < ArraySize(g_basketSnapTime) && g_basketSnapTime[firstKeep] < cutoff) firstKeep++;
      if(firstKeep > 0)
      {
         int newN = ArraySize(g_basketSnapTime) - firstKeep;
         double tmpP[]; datetime tmpT[];
         ArrayResize(tmpP, newN); ArrayResize(tmpT, newN);
         for(int k = 0; k < newN; k++) { tmpP[k] = g_basketSnapPnL[firstKeep + k]; tmpT[k] = g_basketSnapTime[firstKeep + k]; }
         ArrayResize(g_basketSnapPnL, newN); ArrayResize(g_basketSnapTime, newN);
         for(int k = 0; k < newN; k++) { g_basketSnapPnL[k] = tmpP[k]; g_basketSnapTime[k] = tmpT[k]; }
      }
      // also cap absolute size
      if(ArraySize(g_basketSnapPnL) > g_basketSnapMax)
      {
         int dropN = ArraySize(g_basketSnapPnL) - g_basketSnapMax;
         double tmpP[]; datetime tmpT[];
         ArrayResize(tmpP, g_basketSnapMax); ArrayResize(tmpT, g_basketSnapMax);
         for(int k = 0; k < g_basketSnapMax; k++) { tmpP[k] = g_basketSnapPnL[dropN + k]; tmpT[k] = g_basketSnapTime[dropN + k]; }
         ArrayResize(g_basketSnapPnL, g_basketSnapMax); ArrayResize(g_basketSnapTime, g_basketSnapMax);
         for(int k = 0; k < g_basketSnapMax; k++) { g_basketSnapPnL[k] = tmpP[k]; g_basketSnapTime[k] = tmpT[k]; }
      }

      // GUARD 1: fast reversal — find max PnL in window, see how far we've fallen.
      // v5.8.17: this may bank a still-profitable basket, but it must not
      // panic-close a losing/pullback basket. Gold often sweeps hard before
      // continuing; once the basket is negative, the structure SL/clean-exit
      // engine owns the decision.
      if(InpBasketFastReversalGuard && ArraySize(g_basketSnapPnL) >= 2 && g_basketPeakUSD > 0)
      {
         double winMax = totalPnL;
         for(int k = 0; k < ArraySize(g_basketSnapPnL); k++)
            if(g_basketSnapPnL[k] > winMax) winMax = g_basketSnapPnL[k];
         double dropFromWinMax = winMax - totalPnL;
         double dropPctOfPeak  = (g_basketPeakUSD > 0) ? (dropFromWinMax / g_basketPeakUSD) * 100.0 : 0.0;
         // Only fire if we've actually given back meaningful $ AND % of peak
         if(dropFromWinMax > MathMax(50.0, bal * 0.001) && dropPctOfPeak >= InpBasketFastDropPct)
         {
            if(totalPnL > 0)
            {
               PrintFormat(">>> BASKET FAST-REVERSAL │ dropped $%.2f (%.1f%% of peak $%.2f) in %ds → BANK PROFIT",
                           dropFromWinMax, dropPctOfPeak, g_basketPeakUSD, InpBasketFastWindowSec);
               lastExitReason = StringFormat("BASKET FAST-REV │ peak $%.2f → $%.2f in %ds", g_basketPeakUSD, totalPnL, InpBasketFastWindowSec);
               CloseAll();
               PG_OnBasketWin();  // v5.1.2 — winner resets consecutive-loss streak
               g_basketPeakUSD  = 0; g_basketFloorUSD = 0;
               g_basketArmed    = false; g_basketBEHit = false;
               ArrayResize(g_basketSnapPnL, 0); ArrayResize(g_basketSnapTime, 0);
               return true;
            }
            PrintFormat("BASKET_FAST_REV_BREATHE │ peak $%.2f -> pnl $%.2f, drop %.1f%% in %ds, but basket is not profitable; SL/structure manages recovery",
                        g_basketPeakUSD, totalPnL, dropPctOfPeak, InpBasketFastWindowSec);
         }
      }

      // GUARD 2: hard $ giveback cap. v5.8.17: same principle as above;
      // bank remaining profit, but don't convert normal XAU pullback into
      // a forced red close unless the real SL/clean-exit engine confirms failure.
      double hardGivebackPct = EffBasketHardGivebackPct();
      if(hardGivebackPct > 0)
      {
         double maxGivebackUSD = bal * hardGivebackPct / 100.0;
         double currGivebackUSD = g_basketPeakUSD - totalPnL;
         if(currGivebackUSD >= maxGivebackUSD)
         {
            if(totalPnL > 0)
            {
               PrintFormat(">>> BASKET HARD-CAP │ giveback $%.2f ≥ cap $%.2f (%.1f%% of bal) → BANK PROFIT",
                           currGivebackUSD, maxGivebackUSD, hardGivebackPct);
               lastExitReason = StringFormat("BASKET HARD-CAP │ peak $%.2f → $%.2f (giveback $%.2f)", g_basketPeakUSD, totalPnL, currGivebackUSD);
               CloseAll();
               PG_OnBasketWin();  // v5.1.2
               g_basketPeakUSD  = 0; g_basketFloorUSD = 0;
               g_basketArmed    = false; g_basketBEHit = false;
               ArrayResize(g_basketSnapPnL, 0); ArrayResize(g_basketSnapTime, 0);
               return true;
            }
            PrintFormat("BASKET_HARD_CAP_BREATHE │ peak $%.2f -> pnl $%.2f, giveback $%.2f >= cap $%.2f, but basket is not profitable; holding for SL/structure",
                        g_basketPeakUSD, totalPnL, currGivebackUSD, maxGivebackUSD);
         }
      }
   }

   // TRIGGER: if armed and current falls below floor.
   // v5.8.15: first hit banks partial profit and keeps a runner alive. A later
   // floor hit can still close all if the remaining runner truly fails.
   if(g_basketArmed && g_basketFloorUSD > 0 && totalPnL < g_basketFloorUSD)
   {
      if(InpBasketSoftLockFirst && !InpCloudSafeDisablePartials && !g_basketSoftLockTaken && totalPnL > 0)
      {
         PrintFormat(">>> BASKET SOFT-LOCK │ PnL=$%.2f < Floor=$%.2f │ Peak=$%.2f │ banking %.0f%%, runner stays alive",
                     totalPnL, g_basketFloorUSD, g_basketPeakUSD, InpBasketSoftLockPct);

         bool partialDone = CloseBasketPartial(InpBasketSoftLockPct,
                                               StringFormat("peak $%.2f -> pnl $%.2f", g_basketPeakUSD, totalPnL));
         g_basketSoftLockTaken = true;

         if(partialDone)
         {
            lastExitReason = StringFormat("BASKET SOFT-LOCK │ peak $%.2f -> $%.2f; runner alive", g_basketPeakUSD, totalPnL);
            g_basketPeakUSD = totalPnL;
            g_basketFloorUSD = MathMax(1.0, totalPnL * InpBasketRunnerFloorPct / 100.0);
            ArrayResize(g_basketSnapPnL, 0); ArrayResize(g_basketSnapTime, 0);
            return true;
         }
      }

      if(totalPnL > 0)
      {
         PrintFormat(">>> BASKET CLOSE │ PnL=$%.2f < Floor=$%.2f │ Peak=$%.2f │ banking %.1f%% of peak",
                     totalPnL, g_basketFloorUSD, g_basketPeakUSD,
                     g_basketPeakUSD > 0 ? (totalPnL / g_basketPeakUSD) * 100.0 : 0.0);
         lastExitReason = StringFormat("BASKET LOCK │ $%.2f peak → $%.2f banked", g_basketPeakUSD, totalPnL);
         CloseAll();
         // reset so the state doesn't instantly re-arm if a residual slippage trade lingers
         g_basketPeakUSD  = 0;
         g_basketFloorUSD = 0;
         g_basketArmed    = false;
         g_basketBEHit    = false;
         g_basketSoftLockTaken = false;
         ArrayResize(g_basketSnapPnL, 0); ArrayResize(g_basketSnapTime, 0);
         return true;
      }
      PrintFormat("BASKET_LOCK_BREATHE │ PnL=$%.2f < Floor=$%.2f after peak $%.2f, but basket is red; no panic close, SL/structure owns exit",
                  totalPnL, g_basketFloorUSD, g_basketPeakUSD);
   }

   return false;
}

//+------------------------------------------------------------------+
//| v5.8.3 — CLEAN EXITS                                             |
//|   ONE exit authority per phase. No competing systems.            |
//|                                                                  |
//|   Losses: close only after structure + EMA/RSI/momentum          |
//|           confirm that drawdown is invalidation, not noise.      |
//|   Winners: partial at +2R, delayed BE in strong trends,          |
//|            adaptive Chandelier trail after momentum confirms.    |
//|   Stale: close only flat/choppy trades that fail to progress.    |
//+------------------------------------------------------------------+
// Per-ticket state: was partial/de-risk taken already?
ulong g_cePartialTickets[];       // tickets that have had their profit partial close
ulong g_ceLossReduceTickets[];    // tickets that have had their loss-side soft de-risk

bool CleanPartialAlreadyTaken(ulong ticket)
{
   for(int i = ArraySize(g_cePartialTickets) - 1; i >= 0; i--)
      if(g_cePartialTickets[i] == ticket) return true;
   return false;
}

void CleanMarkPartialTaken(ulong ticket)
{
   int n = ArraySize(g_cePartialTickets);
   ArrayResize(g_cePartialTickets, n + 1);
   g_cePartialTickets[n] = ticket;
   // GC: if array grows too large, trim oldest
   if(ArraySize(g_cePartialTickets) > 200)
   {
      ulong tmp[];
      ArrayResize(tmp, 100);
      for(int j = 0; j < 100; j++) tmp[j] = g_cePartialTickets[ArraySize(g_cePartialTickets) - 100 + j];
      ArrayResize(g_cePartialTickets, 100);
      for(int j = 0; j < 100; j++) g_cePartialTickets[j] = tmp[j];
   }
}

bool CleanLossReduceAlreadyTaken(ulong ticket)
{
   for(int i = ArraySize(g_ceLossReduceTickets) - 1; i >= 0; i--)
      if(g_ceLossReduceTickets[i] == ticket) return true;
   return false;
}

void CleanMarkLossReduceTaken(ulong ticket)
{
   int n = ArraySize(g_ceLossReduceTickets);
   ArrayResize(g_ceLossReduceTickets, n + 1);
   g_ceLossReduceTickets[n] = ticket;
   if(ArraySize(g_ceLossReduceTickets) > 200)
   {
      ulong tmp[];
      ArrayResize(tmp, 100);
      for(int j = 0; j < 100; j++) tmp[j] = g_ceLossReduceTickets[ArraySize(g_ceLossReduceTickets) - 100 + j];
      ArrayResize(g_ceLossReduceTickets, 100);
      for(int j = 0; j < 100; j++) g_ceLossReduceTickets[j] = tmp[j];
   }
}

int CleanMomentumScore(bool isBuy, double close1, double open1, double close2, double emaF, double emaS, double rsi)
{
   int score = 0;
   if(isBuy)
   {
      if(close1 > open1)  score++;
      if(close1 > close2) score++;
      if(close1 > emaF)   score++;
      if(emaF > emaS)     score++;
      if(rsi > 50 && rsi < 78) score++;
   }
   else
   {
      if(close1 < open1)  score++;
      if(close1 < close2) score++;
      if(close1 < emaF)   score++;
      if(emaF < emaS)     score++;
      if(rsi < 50 && rsi > 22) score++;
   }
   return score;
}

bool CleanRegimeAligned(bool isBuy)
{
   if(isBuy)
      return (currentRegime == REGIME_TRENDING_UP || currentRegime == REGIME_BREAKOUT_UP);
   return (currentRegime == REGIME_TRENDING_DOWN || currentRegime == REGIME_BREAKOUT_DOWN);
}

bool CleanChoppyRegime()
{
   return (currentRegime == REGIME_CHOPPY ||
           currentRegime == REGIME_LOW_VOL ||
           currentRegime == REGIME_RANGING);
}

void CleanStructureLevels(int lookback, double &swingLow, double &swingHigh)
{
   swingLow = DBL_MAX;
   swingHigh = -DBL_MAX;
   int lb = MathMax(lookback, 4);
   for(int k = 2; k <= lb + 1; k++)
   {
      double hk = iHigh(Symbol(), PERIOD_M5, k);
      double lk = iLow(Symbol(), PERIOD_M5, k);
      if(hk > 0 && hk > swingHigh) swingHigh = hk;
      if(lk > 0 && lk < swingLow)  swingLow = lk;
   }
}

int CleanStructureBreakBars(bool isBuy, double swingLow, double swingHigh, double structBuf)
{
   int need = MathMax(1, InpGoldPullbackConfirmBars);
   int broken = 0;
   for(int k = 1; k <= need; k++)
   {
      double c = iClose(Symbol(), PERIOD_M5, k);
      if(c <= 0) break;
      bool broke = false;
      if(isBuy && swingLow < DBL_MAX)
         broke = (c < swingLow - structBuf);
      if(!isBuy && swingHigh > -DBL_MAX)
         broke = (c > swingHigh + structBuf);
      if(!broke) break;
      broken++;
   }
   return broken;
}

bool CleanRecoveryLikely(bool isBuy, bool trendAligned, int momentumScore,
                         bool structureConfirmedBroken, bool emaAgainst,
                         bool rsiAgainst, double rMult)
{
   if(!InpGoldPullbackSurvivalMode) return false;
   if(rMult <= -InpCleanEmergencyLossR) return false;
   if(structureConfirmedBroken && emaAgainst && rsiAgainst) return false;
   if(trendAligned && momentumScore >= InpGoldPullbackMinMomentum && !structureConfirmedBroken)
      return true;
   if(trendAligned && momentumScore >= 2 && !emaAgainst && !structureConfirmedBroken)
      return true;
   return false;
}

// Returns true if position was closed this tick (caller should skip further logic)
bool ManageCleanExitsForPosition(ulong ticket, bool isBuy, double openPx, double curPrice,
                                 double curSL, double curTP, double slDist, double atr,
                                 double emaF, double emaS, double close1, double open1, int digits, double rsi,
                                 int minsOpen, double lotsOpen,
                                 double peak = 0.0,     // v5.8.52: best floating profit seen (USD)
                                 double rDollars = 0.0  // v5.8.52: USD value of 1R for this position
                                 )
{
   if(!InpCleanExits) return false;
   if(slDist <= 0 || atr <= 0) return false;

   // Compute current R-multiple of profit in price terms
   double priceProfit = isBuy ? (curPrice - openPx) : (openPx - curPrice);
   double rMult = priceProfit / slDist;   // negative if underwater
   double close2 = iClose(Symbol(), PERIOD_M5, 2);
   int momentumScore = CleanMomentumScore(isBuy, close1, open1, close2, emaF, emaS, rsi);
   bool trendAligned = CleanRegimeAligned(isBuy);
   bool choppyRegime = CleanChoppyRegime();
   double swingLow, swingHigh;
   CleanStructureLevels(InpCleanStructureLookback, swingLow, swingHigh);
   double structBuf = atr * InpCleanStructureATRBuffer;
   bool structureBroken = false;
   if(isBuy && swingLow < DBL_MAX)
      structureBroken = (close1 < swingLow - structBuf);
   if(!isBuy && swingHigh > -DBL_MAX)
      structureBroken = (close1 > swingHigh + structBuf);
   int structureBreakBars = CleanStructureBreakBars(isBuy, swingLow, swingHigh, structBuf);
   bool structureConfirmedBroken = (structureBreakBars >= MathMax(1, InpGoldPullbackConfirmBars));
   bool emaAgainst = isBuy ? (close1 < emaF && emaF < emaS) : (close1 > emaF && emaF > emaS);
   bool rsiAgainst = isBuy ? (rsi < 42) : (rsi > 58);
   bool reversalCandle = isBuy ? (close1 < open1 && MathAbs(close1 - open1) >= atr * 0.45)
                               : (close1 > open1 && MathAbs(close1 - open1) >= atr * 0.45);
   int invalidScore = 0;
   if(structureConfirmedBroken) invalidScore += 2;
   if(emaAgainst)      invalidScore++;
   if(rsiAgainst)      invalidScore++;
   if(reversalCandle)  invalidScore++;
   bool recoveryLikely = CleanRecoveryLikely(isBuy, trendAligned, momentumScore,
                                             structureConfirmedBroken, emaAgainst,
                                             rsiAgainst, rMult);

   // ============ STALE CUT ============
   // v6.0 STI: if the macro trend TCP is still strongly aligned AND the trade is
   // meaningfully profitable, suppress stagnant/stale exits. The EA was exiting
   // profitable runners purely because short-term momentum paused — this is wrong
   // when the higher-timeframe trend is still fully intact.
   // Only active on profitable trades (rMult >= 0.25) with TCP >= configured minimum.
   bool stiHighTCP = false;
   if(InpSTI_Enable && rMult >= 0.25)
   {
      double tcpNow = STI_ComputeTCP(isBuy ? 1 : -1);
      stiHighTCP = (tcpNow >= InpSTI_TCPContinueMinimum);
      if(stiHighTCP)
      {
         static datetime lastTCPHoldLog = 0;
         if(TimeCurrent() - lastTCPHoldLog >= 120)
         {
            PrintFormat("STI_TCP_HOLD #%I64u %s | rMult=%.2fR tcp=%.0f >= %.0f | macro trend valid — suppressing premature stagnant/stale exit, runner continues",
                        ticket, isBuy?"BUY":"SELL", rMult, tcpNow, InpSTI_TCPContinueMinimum);
            lastTCPHoldLog = TimeCurrent();
         }
      }
   }

   if(!stiHighTCP && InpCleanStagnantMinutes > 0 && minsOpen >= InpCleanStagnantMinutes &&
      MathAbs(rMult) <= InpCleanStagnantMaxR && choppyRegime && !trendAligned)
   {
      PrintFormat("CLEAN_STAGNANT #%I64u %s | %dm open, %.2fR in %s → CLOSE",
                  ticket, isBuy?"BUY":"SELL", minsOpen, rMult, RegimeName());
      lastExitReason = StringFormat("STAGNANT │ %.2fR after %dm in %s", rMult, minsOpen, RegimeName());
      trade.PositionClose(ticket);
      return true;
   }

   if(!stiHighTCP && InpCleanStaleHours > 0 && minsOpen >= InpCleanStaleHours * 60 &&
      rMult < InpCleanStaleMinR && (!trendAligned || momentumScore <= 2))
   {
      PrintFormat("CLEAN_STALE #%I64u %s | %dm open, %.2fR, trendAligned=%s momentum=%d/5 → CLOSE",
                  ticket, isBuy?"BUY":"SELL", minsOpen, rMult, trendAligned?"Y":"N", momentumScore);
      lastExitReason = StringFormat("STALE │ %.2fR after %dm momentum %d/5", rMult, minsOpen, momentumScore);
      trade.PositionClose(ticket);
      return true;
   }

   // ============ MOMENTUM-FLIP INVALIDATION ============
   // Requires structure + volatility/momentum evidence, so normal gold pullbacks survive.
   int minInvalidationMin = EffCleanMinInvalidationMin();
   if(InpCleanMomentumInvalidation && minsOpen >= minInvalidationMin)
   {
      bool confirmedInvalid = !recoveryLikely &&
                              ((rMult <= -InpCleanMaxLossR && invalidScore >= 3) ||
                               (rMult <= -0.80 && structureConfirmedBroken && emaAgainst && rsiAgainst && invalidScore >= 4));
      bool emergencyInvalid = (rMult <= -InpCleanEmergencyLossR && invalidScore >= 3);
      if(confirmedInvalid || emergencyInvalid)
      {
         PrintFormat("CLEAN_INVALID #%I64u %s | %.2fR invalidScore=%d struct=%s bars=%d/%d ema=%s rsi=%s rev=%s recovery=%s → CLOSE",
                     ticket, isBuy?"BUY":"SELL", rMult, invalidScore,
                     structureConfirmedBroken?"Y":"N", structureBreakBars, InpGoldPullbackConfirmBars,
                     emaAgainst?"Y":"N", rsiAgainst?"Y":"N", reversalCandle?"Y":"N",
                     recoveryLikely?"Y":"N");
         lastExitReason = StringFormat("INVALIDATION │ %.2fR score %d", rMult, invalidScore);
         trade.PositionClose(ticket);
         return true;
      }
      else if(rMult < 0 && recoveryLikely && structureBroken)
      {
         static datetime lastRecoveryLog = 0;
         if(TimeCurrent() - lastRecoveryLog >= 60)
         {
            PrintFormat("CLEAN_BREATHE #%I64u %s | %.2fR pullback but recovery likely: trend=%s momentum=%d/5 structureBars=%d/%d emaAgainst=%s rsiAgainst=%s",
                        ticket, isBuy?"BUY":"SELL", rMult, trendAligned?"Y":"N", momentumScore,
                        structureBreakBars, InpGoldPullbackConfirmBars,
                        emaAgainst?"Y":"N", rsiAgainst?"Y":"N");
            lastRecoveryLog = TimeCurrent();
         }
      }
   }

   // Structure runner fail-fast is deliberately strict: only cut before the wider
   // runner logic if adverse move, structure, and momentum all confirm failure.
   if(StructureRunnerActive() && minsOpen >= InpStructureFailFastMinMinutes && rMult <= -InpStructureFailFastLossR)
   {
      double adverseDist = MathAbs(curPrice - openPx);
      bool adverseWide = (atr > 0 && adverseDist >= atr * InpStructureFailFastMaxAdverseATR);
      bool failedStructure = structureConfirmedBroken && invalidScore >= 4 && !recoveryLikely;
      bool failedMomentum = (emaAgainst && rsiAgainst && !trendAligned && momentumScore <= 1);
      if(adverseWide && failedStructure && failedMomentum)
      {
         PrintFormat("STRUCTURE_FAILFAST #%I64u %s | %.2fR adverse=%.2fATR invalidScore=%d structBars=%d/%d momentum=%d/5 recovery=%s → CLOSE",
                     ticket, isBuy?"BUY":"SELL", rMult, adverseDist/atr, invalidScore,
                     structureBreakBars, InpGoldPullbackConfirmBars, momentumScore,
                     recoveryLikely?"Y":"N");
         lastExitReason = StringFormat("STRUCTURE_FAILFAST │ %.2fR confirmed failed structure", rMult);
         trade.PositionClose(ticket);
         return true;
      }
   }

   // ============ v5.8.55: A+ PROFIT SHIELD (runner-restore, report-backed) ============
   //
   // TIER 1 — observation arm.
   //   Records that the trade produced proven floating profit, but does NOT move SL
   //   by default. This restores v5.8.50-style runner breathing and prevents
   //   good A/A+ trades from becoming $0.49/$1.50 scratch exits.
   //
   // TIER 2 — Active protection (fires only after account-meaningful profit or large R):
   //   a) Peak was MEANINGFUL (>= configured % balance, or >= min USD + configured R)
   //   b) Momentum CONFIRMS reversal (score <= InpAPlusReversalMomentum) — not a pullback
   //   If momentum says continuation → log APLUS_PULLBACK_DETECTED and leave trade alone.
   //
   if(InpAPlusShield && peak > 0 && rDollars > 0)
   {
      // v6.0.1 FIX: g_lastEntryGrade is a global that changes every time any trade opens,
      // so pyramid tickets read the wrong grade. Read from POSITION_COMMENT instead —
      // it was stamped with "[A]" or "[A+]" at entry and is per-position authoritative.
      string posCmtShield = "";
      if(PositionSelectByTicket(ticket))
         posCmtShield = PositionGetString(POSITION_COMMENT);
      bool   isAPlus = (StringFind(posCmtShield, "[A+]") >= 0 || StringFind(posCmtShield, "[A]") >= 0);
      string grade   = StringFind(posCmtShield, "[A+]") >= 0 ? "A+" :
                       isAPlus ? "A" : g_lastEntryGrade;
      if(isAPlus)
      {
         double refBal        = StrategyReferenceBalance();
         double tickVal       = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
         double tickSz        = MathMax(SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE), 0.000001);
         double curProfitUSD  = isBuy ? (curPrice - openPx) : (openPx - curPrice);
         curProfitUSD        *= lotsOpen * tickVal / tickSz;
         double peakR         = (rDollars > 0) ? peak / rDollars : 0.0;

         // ---- TIER 1: arm condition (observe by default, no BE move) ----
         double tier1ArmUSD  = MathMax(InpAPlusShieldMinArmUSD, refBal * InpAPlusShieldEquityPct / 100.0);
         bool   tier1Equity  = (peak >= tier1ArmUSD);
         bool   tier1R       = (peak >= InpAPlusShieldMinArmUSD && peakR >= InpAPlusShieldArmR);
         double tier2ArmUSD  = MathMax(InpAPlusShieldMinProtectUSD, refBal * InpAPlusShieldProtectEquityPct / 100.0);
         bool   tier2Equity  = (peak >= tier2ArmUSD);
         bool   tier2R       = (peak >= InpAPlusShieldMinProtectUSD && peakR >= InpAPlusShieldProtectR);
         bool   tier2Ready   = InpAPlusShieldRequireUSDAndR ? (tier2Equity && tier2R) : (tier2Equity || tier2R);

         if((tier1Equity || tier1R) && !APlusShieldArmed(ticket))
         {
            APlusMarkShieldArmed(ticket);
            PrintFormat("APLUS_PROFIT_SHIELD_ARMED #%I64u %s | grade=%s peakUSD=$%.2f peakR=%.2fR | "
                        "trigger=%s | tier2needs>=%.2f%%($%.2f) %s %.2fR",
                        ticket, isBuy?"BUY":"SELL", grade, peak, peakR,
                        tier1Equity?"EQUITY_PCT":"R_MULT",
                        InpAPlusShieldProtectEquityPct,
                        MathMax(InpAPlusShieldMinProtectUSD, refBal * InpAPlusShieldProtectEquityPct / 100.0),
                        InpAPlusShieldRequireUSDAndR ? "and" : "or",
                        InpAPlusShieldProtectR);
         }

         if(APlusShieldArmed(ticket))
         {
            // TIER 1 is observe-only by default. Move BE only if explicitly enabled,
            // or if tier 2 is already ready and the trade has earned meaningful protection.
            double cushionDist  = slDist * InpAPlusShieldBECushR;
            double shieldBESL   = isBuy ? NormalizeDouble(openPx + cushionDist, digits)
                                        : NormalizeDouble(openPx - cushionDist, digits);
            bool   allowBEMove  = (InpAPlusShieldMoveBEOnTier1 || tier2Ready);
            bool   beShouldMove = allowBEMove && (isBuy ? (shieldBESL > curSL) : (shieldBESL < curSL || curSL == 0));
            if(beShouldMove)
            {
               double pt  = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
               long   lvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
               double buf = MathMax(lvl * pt, pt * 30);
               bool   sane = isBuy ? (shieldBESL < curPrice - buf) : (shieldBESL > curPrice + buf);
               if(sane && SafeModifySL(ticket, shieldBESL, curTP, isBuy, curPrice, "APLUS_BE"))
                  PrintFormat("APLUS_BE_MOVED #%I64u %s | trigger=%s peakUSD=$%.2f peakR=%.2fR | "
                              "newSL=%s | meaningful protection active, runner still open",
                              ticket, isBuy?"BUY":"SELL",
                              tier2Ready ? "TIER2" : "TIER1_OPT_IN",
                              peak, peakR,
                              DoubleToString(shieldBESL, digits));
            }

            // ---- TIER 2: trail + force-close — only on significant peaks + confirmed reversal ----
            if(tier2Ready)
            {
               double givebackPct = (peak > 0 && curProfitUSD < peak)
                                    ? ((peak - curProfitUSD) / peak) * 100.0 : 0.0;

               // Momentum check: is this a pullback or a reversal?
               // CleanMomentumScore already computed in the outer scope — but we need it fresh here.
               // score >= 3 + trend aligned = still running. score <= InpAPlusReversalMomentum = reversing.
               bool trendStillWith  = CleanRegimeAligned(isBuy);
               bool momentumAgainst = (momentumScore <= InpAPlusReversalMomentum);
               bool confirmReversal = momentumAgainst && !trendStillWith;
               // Also confirm if RSI is crossing against (overbought on sell, oversold on buy)
               bool rsiAgainst      = isBuy ? (rsi < 40) : (rsi > 60);
               bool strongReversal  = confirmReversal || (momentumAgainst && rsiAgainst);

               if(givebackPct >= InpAPlusForceExitGivePct)
               {
                  if(strongReversal)
                  {
                     if(InpAPlusShieldAllowMarketClose)
                     {
                        PrintFormat("APLUS_GIVEBACK_EXIT #%I64u %s | peakUSD=$%.2f peakR=%.2fR | "
                                    "curProfit=$%.2f givebackPct=%.0f%% | momentum=%d trendWith=%s rsi=%.1f",
                                    ticket, isBuy?"BUY":"SELL", peak, peakR,
                                    curProfitUSD, givebackPct, momentumScore,
                                    trendStillWith?"Y":"N", rsi);
                        lastExitReason = StringFormat("APLUS_GIVEBACK_EXIT | %.0f%% giveback from $%.2f peak, reversal confirmed",
                                                      givebackPct, peak);
                        trade.PositionClose(ticket);
                        return true;
                     }

                     double lockUSD  = MathMax(rDollars * 0.25, peak * InpAPlusShieldPeakLockPct / 100.0);
                     double lockDist = (tickVal > 0 && lotsOpen > 0)
                                       ? (lockUSD * tickSz / (lotsOpen * tickVal))
                                       : (slDist * 0.25);
                     double pt3  = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
                     long   lvl3 = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
                     double buf3 = MathMax(lvl3 * pt3, pt3 * 30);
                     double peakLockSL = isBuy ? NormalizeDouble(openPx + lockDist, digits)
                                               : NormalizeDouble(openPx - lockDist, digits);
                     double validSideSL = isBuy ? NormalizeDouble(curPrice - buf3, digits)
                                                : NormalizeDouble(curPrice + buf3, digits);
                     double patientSL = isBuy ? MathMin(MathMax(shieldBESL, peakLockSL), validSideSL)
                                               : MathMax(MathMin(shieldBESL, peakLockSL), validSideSL);
                     patientSL = NormalizeDouble(patientSL, digits);
                     bool patientAdv = isBuy ? (patientSL > curSL) : (patientSL < curSL || curSL == 0);
                     bool patientSane = isBuy ? (patientSL < curPrice - buf3) : (patientSL > curPrice + buf3);
                     if(patientAdv && patientSane && SafeModifySL(ticket, patientSL, curTP, isBuy, curPrice, "APLUS_PATIENT_LOCK"))
                     {
                        PrintFormat("APLUS_PATIENT_LOCK #%I64u %s | market-close OFF | peakUSD=$%.2f peakR=%.2fR "
                                    "givebackPct=%.0f%% lockUSD=$%.2f newSL=%s | trade still allowed to run",
                                    ticket, isBuy?"BUY":"SELL", peak, peakR, givebackPct,
                                    lockUSD, DoubleToString(patientSL, digits));
                     }
                     else
                     {
                        PrintFormat("APLUS_PATIENT_HOLD #%I64u %s | market-close OFF | peakUSD=$%.2f peakR=%.2fR "
                                    "givebackPct=%.0f%% | no valid tighter SL yet",
                                    ticket, isBuy?"BUY":"SELL", peak, peakR, givebackPct);
                     }
                  }
                  else
                  {
                     // Big giveback but momentum/trend still with us — this is a pullback, hold.
                     PrintFormat("APLUS_PULLBACK_DETECTED #%I64u %s | givebackPct=%.0f%% BUT momentum=%d trendWith=%s rsi=%.1f — holding, not closing",
                                 ticket, isBuy?"BUY":"SELL", givebackPct,
                                 momentumScore, trendStillWith?"Y":"N", rsi);
                  }
               }
               else if(givebackPct >= InpAPlusGivebackPct)
               {
                  if(strongReversal)
                  {
                     // Reversal confirmed — trail tightly to lock in remaining profit
                     double trailDist = atr * InpAPlusGivebackTrailATR;
                     double trailSL   = isBuy ? NormalizeDouble(curPrice - trailDist, digits)
                                              : NormalizeDouble(curPrice + trailDist, digits);
                     bool   trailAdv  = isBuy ? (trailSL > curSL) : (trailSL < curSL || curSL == 0);
                     if(trailAdv)
                     {
                        double pt2  = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
                        long   lvl2 = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
                        double buf2 = MathMax(lvl2 * pt2, pt2 * 30);
                        bool   sane2 = isBuy ? (trailSL < curPrice - buf2) : (trailSL > curPrice + buf2);
                        if(sane2 && SafeModifySL(ticket, trailSL, curTP, isBuy, curPrice, "APLUS_TRAIL"))
                           PrintFormat("APLUS_TRAIL_LOCKED #%I64u %s | peakUSD=$%.2f givebackPct=%.0f%% | "
                                       "trailSL=%s momentum=%d trendWith=%s",
                                       ticket, isBuy?"BUY":"SELL", peak, givebackPct,
                                       DoubleToString(trailSL, digits), momentumScore, trendStillWith?"Y":"N");
                     }
                  }
                  else
                  {
                     // Giveback but still looks like a pullback — give it room, do not trail yet
                     PrintFormat("APLUS_PULLBACK_DETECTED #%I64u %s | givebackPct=%.0f%% | momentum=%d trendWith=%s — giving room",
                                 ticket, isBuy?"BUY":"SELL", givebackPct,
                                 momentumScore, trendStillWith?"Y":"N");
                  }
               }
            }
            // If tier2 not ready: BE is set, CleanExits manages the rest. No aggressive action.
         }
      }
   }
   // ============ END A+ PROFIT SHIELD ============

   // ============ PHASE 1: BREAKEVEN LOCK @ +1R ============
   double beActivateR = EffCleanBEActivateR();
   if(trendAligned && momentumScore >= 4) beActivateR += 0.35;
   if(choppyRegime) beActivateR = MathMax(1.0, beActivateR - 0.25);
   if(rMult >= beActivateR)
   {
      double cushionDist = slDist * EffCleanBECushionR();
      double beSL = isBuy ? NormalizeDouble(openPx + cushionDist, digits)
                          : NormalizeDouble(openPx - cushionDist, digits);
      // Only move SL forward, never back
      bool shouldMove = isBuy ? (beSL > curSL) : (beSL < curSL || curSL == 0);
      if(shouldMove && rMult < EffCleanChandelierStartR())
      {
         // Broker stops-level buffer
         double pt = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
         long   lvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
         double buf = MathMax(lvl * pt, pt * 30);
         bool sane = isBuy ? (beSL < curPrice - buf) : (beSL > curPrice + buf);
         if(sane)
         {
            if(SafeModifySL(ticket, beSL, curTP, isBuy, curPrice, "CLEAN_BE"))
               PrintFormat("CLEAN_BE #%I64u %s | %.2fR → SL=%s (lock +%.2fR, trigger %.2fR)",
                           ticket, isBuy?"BUY":"SELL", rMult,
                           DoubleToString(beSL, digits), EffCleanBECushionR(), beActivateR);
         }
      }
   }

   // ============ PHASE 3: PARTIAL @ +3R (close 30% once) ============
   if(rMult >= InpCleanPartialR && !InpCloudSafeDisablePartials && !CleanPartialAlreadyTaken(ticket) &&
      InpCleanPartialPct > 0 && lotsOpen > 0)
   {
      double step = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
      double minL = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
      double partialLots = lotsOpen * InpCleanPartialPct / 100.0;
      if(step > 0) partialLots = MathFloor(partialLots / step) * step;
      // Must leave at least minL behind for the runner
      if(partialLots >= minL && (lotsOpen - partialLots) >= minL)
      {
         if(trade.PositionClosePartial(ticket, partialLots))
         {
            CleanMarkPartialTaken(ticket);
            PrintFormat("CLEAN_PARTIAL #%I64u %s | %.2fR → closed %.2f lots (%.0f%%), runner=%.2f",
                        ticket, isBuy?"BUY":"SELL", rMult, partialLots,
                        InpCleanPartialPct, lotsOpen - partialLots);
         }
      }
   }

   // ============ PHASE 2 & 4: CHANDELIER TRAIL ============
   double trailStartR = EffCleanChandelierStartR();
   if(trendAligned && momentumScore >= 4) trailStartR += 0.50;
   if(choppyRegime) trailStartR = MathMax(1.50, trailStartR - 0.50);
   bool momentumConfirmed = (momentumScore >= (trendAligned ? 3 : 2)) || rMult >= 4.0;
   if(rMult >= trailStartR && momentumConfirmed)
   {
      // v6.3.4 ADAPTIVE CHANDELIER: ATR multiplier adapts to market state in real time.
      // Base: 3.2× (start) or 2.5× (after +4R). Adjusts up or down based on:
      //   + HTF consensus still matches position dir  → widen (+0.5) — let runner run
      //   + Momentum score 4-5/5                      → widen (+0.4) — trend accelerating
      //   - Regime choppy/ranging                     → tighten (-0.7) — protect gains
      //   - Momentum score ≤ 2                         → tighten (-0.5) — momentum fading
      //   - RSI extreme against position               → tighten (-0.3) — overextended
      // Floor: 1.8× (always gives price 1-2 ATR breathing room to avoid normal pullback exit)
      double chanATR = (rMult >= 4.0) ? EffCleanChandelierATR2() : EffCleanChandelierATR1();
      // Widen: HTF consensus still confirms our direction → trend is structurally sound → hold
      bool htfStillWithUs = (isBuy && g_htfConsensusDir == 1) || (!isBuy && g_htfConsensusDir == -1);
      if(htfStillWithUs) chanATR += 0.50;
      if(trendAligned && momentumScore >= 4) chanATR += 0.40;
      // Tighten: trend structure failing or momentum exhausting → protect what we have
      if(choppyRegime) chanATR -= 0.70;
      if(momentumScore <= 2) chanATR -= 0.50;
      double rsiVal = bufRSI[0]; // current RSI
      bool rsiExtreme = (isBuy && rsiVal > 75) || (!isBuy && rsiVal < 25);
      if(rsiExtreme) chanATR -= 0.30; // overextended — tighten before reversal
      chanATR = MathMax(1.80, chanATR); // never less than 1.8× — respect normal M5 pullbacks
      double chanDist = atr * chanATR;
      // Find highest high / lowest low over lookback bars (Chandelier Exit classic)
      int lb = InpCleanChandelierLookback;
      if(lb < 3) lb = 3;
      double anchor = isBuy ? iHigh(Symbol(), PERIOD_M5, iHighest(Symbol(), PERIOD_M5, MODE_HIGH, lb, 0))
                            : iLow(Symbol(),  PERIOD_M5, iLowest(Symbol(),  PERIOD_M5, MODE_LOW,  lb, 0));
      double chanSL = isBuy ? NormalizeDouble(anchor - chanDist, digits)
                            : NormalizeDouble(anchor + chanDist, digits);

      // Ratchet only
      bool advance = isBuy ? (chanSL > curSL) : (chanSL < curSL || curSL == 0);
      // Sanity — must stay on correct side of entry (never below BE once armed)
      bool profitZone = isBuy ? (chanSL >= openPx) : (chanSL <= openPx);
      // Broker stops-level buffer
      double pt = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
      long   lvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
      double buf = MathMax(lvl * pt, pt * 30);
      bool sane = isBuy ? (chanSL < curPrice - buf) : (chanSL > curPrice + buf);

      if(advance && profitZone && sane)
      {
         if(SafeModifySL(ticket, chanSL, curTP, isBuy, curPrice, "CLEAN_CHAN"))
            PrintFormat("CLEAN_CHAN #%I64u %s | %.2fR | chan=%.1fxATR | momentum=%d/5 | SL=%s",
                        ticket, isBuy?"BUY":"SELL", rMult, chanATR, momentumScore,
                        DoubleToString(chanSL, digits));
      }
   }

   return false;
}

//+------------------------------------------------------------------+
//| 3-PATH SMART EXIT SYSTEM                                         |
//| Path 0: Hard Loss Armor (stop nukes, early adverse, peak retrace)|
//| Path A: Deterministic Trailing                                   |
//| Path B: Smart Momentum (BE lock, quick profit, smart cut, stale) |
//| Path C: Claude AI Semantic Exit                                  |
//+------------------------------------------------------------------+
void ManagePositions()
{
   int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   if(ArraySize(bufATR) < 2 || bufATR[1] <= 0) return;
   // GUARD: Do not attempt any momentum logic until ALL indicator buffers are ready.
   // Previously emaF/emaS defaulted to 0 on stale buffers → `close1 > emaF` always true →
   // SELL trades silently flagged "momentum fading" and closed for no real reason.
   if(ArraySize(bufRSI) < 2 || ArraySize(bufEMAFast) < 2 || ArraySize(bufEMASlow) < 2) return;
   double atr = bufATR[1];
   double rsi = bufRSI[1];
   double emaF = bufEMAFast[1];
   double emaS = bufEMASlow[1];
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   double open1 = iOpen(Symbol(), PERIOD_M5, 1);
   double tickPrice = SymbolInfoDouble(Symbol(), SYMBOL_BID);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != InpMagicNumber || posInfo.Symbol() != Symbol()) continue;

      double curPrice = posInfo.PriceCurrent();
      double openPx = posInfo.PriceOpen();
      double curSL = posInfo.StopLoss();
      double curTP = posInfo.TakeProfit();
      ulong ticket = posInfo.Ticket();
      double profit = posInfo.Profit() + posInfo.Swap() + posInfo.Commission();
      int minsOpen = (int)((TimeCurrent() - posInfo.Time()) / 60);
      bool isBuy = posInfo.PositionType() == POSITION_TYPE_BUY;
      double slDist = isBuy ? (openPx - curSL) : (curSL - openPx);
      if(slDist <= 0) slDist = atr * InpSLMultiplier;

      // Convert 1R into ACCOUNT CURRENCY so we can compare against `profit` (USD).
      double tickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
      double tickSize  = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
      double lotsOpen  = posInfo.Volume();
      double rDollars  = (tickSize > 0 && tickValue > 0)
                         ? lotsOpen * (slDist / tickSize) * tickValue
                         : MathMax(30.0, MathAbs(profit));

      // Track peak (for retrace exit + logging)
      double peak = UpdatePeakProfit(ticket, profit);
      double retracePct = (peak > 0 && profit < peak) ? ((peak - profit) / peak) * 100.0 : 0.0;

      // Dir string for logging
      string dirStr = isBuy ? "BUY" : "SELL";
      double swingLowEA, swingHighEA;
      CleanStructureLevels(InpCleanStructureLookback, swingLowEA, swingHighEA);
      double structBufEA = atr * InpCleanStructureATRBuffer;
      int structureBreakBarsEA = CleanStructureBreakBars(isBuy, swingLowEA, swingHighEA, structBufEA);
      bool structureConfirmedEA = (structureBreakBarsEA >= MathMax(1, InpGoldPullbackConfirmBars));
      double close2EA = iClose(Symbol(), PERIOD_M5, 2);
      int momentumScoreEA = CleanMomentumScore(isBuy, close1, open1, close2EA, emaF, emaS, rsi);
      bool trendAlignedEA = CleanRegimeAligned(isBuy);
      bool emaAgainstEA = isBuy ? (close1 < emaF && emaF < emaS) : (close1 > emaF && emaF > emaS);
      bool rsiAgainstEA = isBuy ? (rsi < 42) : (rsi > 58);
	      double rMultEA = (rDollars > 0 ? profit / rDollars : 0.0);
	      bool recoveryLikelyEA = CleanRecoveryLikely(isBuy, trendAlignedEA, momentumScoreEA,
	                                                   structureConfirmedEA, emaAgainstEA,
	                                                   rsiAgainstEA, rMultEA);

	      // v5.8.15 EXPECTANCY LOSS ARMOR
      // Breathe first: if drawdown becomes unhealthy, reduce part of the size
      // once and keep a runner alive. Full close is reserved for dangerous
	      // equity damage or deep R loss.
	      int ageSec = (int)(TimeCurrent() - posInfo.Time());
	      if(!InpCleanExits && InpExpectancyLossArmor && InpNoPartialSmartLossArmor && InpCloudSafeDisablePartials &&
	         rDollars > 0 && ageSec >= InpNoPartialSmartLossMinSec && profit < 0)
	      {
	         double smartLossUSD = rDollars * InpNoPartialSmartLossR;
	         double smartEqCap = StrategyReferenceBalance() * InpNoPartialSmartLossPctEq / 100.0;
	         if(smartEqCap > 0) smartLossUSD = MathMin(smartLossUSD, smartEqCap);
	         bool confirmedFailed = (!recoveryLikelyEA &&
	                                 structureConfirmedEA &&
	                                 emaAgainstEA &&
	                                 rsiAgainstEA &&
	                                 momentumScoreEA <= InpNoPartialSmartMaxMomentum);
	         if(confirmedFailed && profit <= -smartLossUSD)
	         {
	            LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
	                    "NO_PARTIAL_SMART_LOSS",
	                    StringFormat("Cloud-safe no-partials active. Down %.2fR ($%.2f / 1R=$%.2f) >= smart cap $%.2f after %ds, with confirmed structure+EMA+RSI failure and momentum=%d/5. Closing full position instead of waiting for disaster cap.",
	                                 MathAbs(profit) / rDollars, profit, rDollars, smartLossUSD, ageSec,
	                                 momentumScoreEA));
	            trade.PositionClose(ticket);
	            lastTradeClose = TimeCurrent();
	            continue;
	         }
	      }

	      if(!InpCleanExits && InpExpectancyLossArmor && rDollars > 0 && ageSec >= InpExpectancyMinAgeSec)
	      {
	         double maxLossR = InpExpectancyMaxLossR;
         if(InpHardStopRBased && InpHardStopRMulti > 0)
            maxLossR = MathMin(maxLossR, InpHardStopRMulti);
         double equityLossCap = StrategyReferenceBalance() * InpExpectancyMaxLossPctEq / 100.0;
         double hardLossUSD = rDollars * maxLossR;
         if(equityLossCap > 0) hardLossUSD = MathMin(hardLossUSD, equityLossCap);
         if(recoveryLikelyEA && InpGoldPullbackCapBoost > 1.0)
            hardLossUSD *= InpGoldPullbackCapBoost;

	         if(profit <= -hardLossUSD)
	         {
	            bool catastrophicEquityHit = (equityLossCap > 0 && profit <= -equityLossCap);
	            bool structureGateOk = (!InpExpectancyRequireStructureBreak ||
	                                    structureConfirmedEA ||
	                                    catastrophicEquityHit);
	            if(structureGateOk)
	            {
	               LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
	                       "EXPECTANCY_MAX_LOSS",
	                       StringFormat("Down %.2fR ($%.2f / 1R=$%.2f) >= hard cap $%.2f after %ds. recovery=%s structBars=%d/%d momentum=%d/5. Structure gate=%s. Preventing account damage.",
	                                    MathAbs(profit) / rDollars, profit, rDollars, hardLossUSD, ageSec,
	                                    recoveryLikelyEA?"Y":"N", structureBreakBarsEA, InpGoldPullbackConfirmBars,
	                                    momentumScoreEA, structureConfirmedEA?"broken":"emergency"));
	               trade.PositionClose(ticket);
	               lastTradeClose = TimeCurrent();
	               continue;
	            }
	            else
	            {
	               static datetime lastStructHoldLog = 0;
	               if(TimeCurrent() - lastStructHoldLog >= 60)
	               {
	                  PrintFormat("EXPECTANCY_HOLD_STRUCTURE #%I64u %s | down %.2fR ($%.2f) crossed cap $%.2f, but structure still intact (%d/%d). Holding for recovery/SL instead of closing red early.",
	                              ticket, dirStr, MathAbs(profit) / rDollars, profit, hardLossUSD,
	                              structureBreakBarsEA, InpGoldPullbackConfirmBars);
	                  lastStructHoldLog = TimeCurrent();
	               }
	            }
	         }
	      }

      if(!InpCleanExits && InpExpectancyLossArmor && InpExpectancySoftDeRisk && !InpCloudSafeDisablePartials && rDollars > 0 &&
         ageSec >= InpExpectancySoftMinAgeSec && !CleanLossReduceAlreadyTaken(ticket) &&
         profit < 0)
      {
         double softLossUSD = rDollars * InpExpectancySoftLossR;
         double softEqCap = StrategyReferenceBalance() * InpExpectancySoftLossPctEq / 100.0;
         if(softEqCap > 0) softLossUSD = MathMin(softLossUSD, softEqCap);
         if(recoveryLikelyEA && InpGoldPullbackCapBoost > 1.0)
            softLossUSD *= InpGoldPullbackCapBoost;

         if(profit <= -softLossUSD)
         {
            double step = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
            double minL = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
            int lotDig = 2;
            if(step > 0 && step < 0.01)  lotDig = 3;
            if(step > 0 && step < 0.001) lotDig = 4;

            double reduceLots = lotsOpen * InpExpectancySoftClosePct / 100.0;
            if(step > 0) reduceLots = MathFloor(reduceLots / step) * step;
            reduceLots = NormalizeDouble(reduceLots, lotDig);
            double remaining = NormalizeDouble(lotsOpen - reduceLots, lotDig);

            if(reduceLots >= minL && remaining >= minL && trade.PositionClosePartial(ticket, reduceLots))
            {
               CleanMarkLossReduceTaken(ticket);
               PrintFormat("EXPECTANCY_SOFT_DERISK #%I64u %s | loss $%.2f (%.2fR) >= soft cap $%.2f | recovery=%s structBars=%d/%d momentum=%d/5 | closed %.2f lots (%.0f%%), runner %.2f stays alive",
                           ticket, dirStr, profit, MathAbs(profit) / rDollars, softLossUSD,
                           recoveryLikelyEA?"Y":"N", structureBreakBarsEA, InpGoldPullbackConfirmBars,
                           momentumScoreEA,
                           reduceLots, InpExpectancySoftClosePct, remaining);
            }
            else
            {
               CleanMarkLossReduceTaken(ticket);
               PrintFormat("EXPECTANCY_SOFT_DERISK_SKIP #%I64u %s | wanted %.2f lots from %.2f, min %.2f, step %.4f, ret=%d err=%d",
                           ticket, dirStr, reduceLots, lotsOpen, minL, step,
                           trade.ResultRetcode(), GetLastError());
            }
         }
      }

      // ============ v6.3.4 AI PROACTIVE EXIT AUDIT (runs before CleanExits) ============
      // Moved here from Path C so AI can HOLD/CLOSE/LOCK positions even when CleanExits=true.
      // Previously, the `continue` at line 9021 meant AI exit override had ZERO effect.
      // Now AI runs first, can: LOCK the SL to bank profit, or CLOSE early if thesis is dead.
      // Cooldown: InpClaudeAuditSec (default 900s = 15min) — doesn't spam the API.
      {
         static datetime lastClaudeCheckCE = 0;
         if(InpUseAI && InpAIExitOverride && !InpAIAdvisoryOnly &&
            StringLen(InpServerURL) >= 10 && minsOpen >= 3 &&
            TimeCurrent() - lastClaudeCheckCE > InpClaudeAuditSec &&
            AIVetoCooldownOK(ticket, InpAIExitMinSec))
         {
            AIExitVerdict v = CheckPositionWithAI(
               isBuy ? "BUY" : "SELL", openPx, curPrice, profit,
               lotsOpen, rsi, emaF, emaS, atr, minsOpen, curSL, curTP,
               peak, "", RegimeName());
            lastClaudeCheckCE = TimeCurrent();
            RecordAIVetoCall(ticket);

            if(v.action == 1 && v.lockUSD > 0 && rDollars > 0)
            {
               // AI wants to LOCK profit — move SL to bank the specified USD amount
               double lockDist = (v.lockUSD / rDollars) * slDist;
               double newSL = isBuy ? NormalizeDouble(openPx + lockDist, digits)
                                    : NormalizeDouble(openPx - lockDist, digits);
               double pp2 = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
               long   slLvl2 = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
               double bufPts2 = MathMax(slLvl2 * pp2, pp2 * 30);
               bool sane2   = isBuy ? (newSL > openPx && newSL < curPrice - bufPts2)
                                    : (newSL < openPx && newSL > curPrice + bufPts2);
               bool ratchet2 = isBuy ? (newSL > curSL) : (newSL < curSL || curSL == 0);
               if(sane2 && ratchet2 && SafeModifySL(ticket, newSL, curTP, isBuy, curPrice, "AI_LOCK_CE"))
                  Print("AI DIRECTOR EXIT LOCK #", ticket, " — locked +$", DoubleToString(v.lockUSD,2),
                        " | SL=", DoubleToString(newSL, digits), " | reason: ", v.reason);
            }
            else if(v.action == -1 && profit > rDollars * 0.3)
            {
               // AI wants to CLOSE — only execute if we're in meaningful profit (>0.3R).
               // Never let AI close a losing trade early (let SL handle that).
               Print("AI DIRECTOR EXIT CLOSE #", ticket, " | profit=$", DoubleToString(profit,2),
                     " | reason: ", v.reason);
               trade.PositionClose(ticket);
               continue;
            }
            else if(v.action == 0)
            {
               // AI says HOLD — log it, do nothing (CleanExits still manages normally)
               Print("AI DIRECTOR EXIT HOLD #", ticket, " | conf=", v.confidence, "% | ", v.reason);
            }
         }
      }

      // ============ v4.9.5 CLEAN EXITS (single exit authority) ============
      // When enabled, this handles: BE lock, chandelier trail, partial TP,
      // momentum-flip cut, stale cut. All legacy systems (Peak-Lock, Profit
      // Ratchet, Adaptive Runner, Trend-Hold, Profit Ladder) are disabled.
      // If Clean Exits closes the position, skip further logic for this ticket.
      if(InpCleanExits)
      {
         // v5.8.52: pass peak and rDollars so A+ Profit Shield can arm inside
         if(ManageCleanExitsForPosition(ticket, isBuy, openPx, curPrice, curSL, curTP,
                                        slDist, atr, emaF, emaS, close1, open1, digits, rsi,
                                        minsOpen, lotsOpen, peak, rDollars))
            continue;
         // Skip ALL legacy trailing systems below — Clean Exits owns this ticket.
         // The original SL set at order-open time remains as the hard downside
         // cap. Clean Exits ratchets it forward through BE → Chandelier phases.
         continue;
      }

      // v4.7.3/v4.7.4 — TP AUTO-EXTEND (push TP forward as winner runs)
      //   When profit reaches the effective TP extension threshold, add the
      //   effective ATR extension distance so entry quality guards get more room.
      //   on the original target. SL ratchets (Ladder/Peak/Moon) protect the
      //   gains; this just removes the artificial ceiling.
      //   v4.7.4 — ONLY extend when market shows REAL continuation strength.
      //   In ranging / choppy / low-vol markets we let the original TP hit
      //   naturally because chasing TP in chop = trade gives back the win.
      if(InpTPAutoExtend && curTP > 0 && profit > 0 && atr > 0 &&
         GetTPExtendCount(ticket) < InpTPExtendMaxTimes)
      {
         double tpDist = isBuy ? (curTP - openPx) : (openPx - curTP);
         double profitDist = isBuy ? (curPrice - openPx) : (openPx - curPrice);
         if(tpDist > 0 && profitDist >= tpDist * (EffTPExtendTriggerPct() / 100.0))
         {
            // Regime gate: only extend if trend or breakout regime
            bool regimeStrong = (currentRegime == REGIME_TRENDING_UP ||
                                 currentRegime == REGIME_TRENDING_DOWN ||
                                 currentRegime == REGIME_BREAKOUT_UP ||
                                 currentRegime == REGIME_BREAKOUT_DOWN);
            // Direction gate: regime must align with our trade direction
            bool regimeAligned = false;
            if(isBuy)  regimeAligned = (currentRegime == REGIME_TRENDING_UP   ||
                                        currentRegime == REGIME_BREAKOUT_UP);
            if(!isBuy) regimeAligned = (currentRegime == REGIME_TRENDING_DOWN ||
                                        currentRegime == REGIME_BREAKOUT_DOWN);
            // EMA confirmation: price still on the right side of fast EMA
            bool emaConfirm = isBuy ? (curPrice > emaF) : (curPrice < emaF);
            // RSI not at exhaustion (don't chase TP into RSI overbought/oversold)
            bool rsiHealthy = isBuy ? (rsi < 78) : (rsi > 22);

            bool shouldExtend = regimeStrong && regimeAligned && emaConfirm && rsiHealthy;

            if(!shouldExtend)
            {
               static datetime lastTPSkip = 0;
               if(TimeCurrent() - lastTPSkip > 60)
               {
                  Print("TP_EXTEND SKIP #", ticket, " — market not strong enough to chase TP. Regime=",
                        RegimeName(), " emaConfirm=", emaConfirm?"Y":"N", " rsiHealthy=", rsiHealthy?"Y":"N",
                        ". Letting original TP hit at ", DoubleToString(curTP, digits), ".");
                  lastTPSkip = TimeCurrent();
               }
            }
            else
            {
               double tpAdd = atr * EffTPExtendATRMulti();
               double newTP = isBuy ? NormalizeDouble(curTP + tpAdd, digits)
                                     : NormalizeDouble(curTP - tpAdd, digits);
               // Sanity: must be on correct side of current price + respect stops level
               double pp = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
               long   slLvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
               double bufPts = MathMax(slLvl * pp, pp * 30);
               bool tpSane = isBuy ? (newTP > curPrice + bufPts) : (newTP < curPrice - bufPts);
               if(tpSane && trade.PositionModify(ticket, curSL, newTP))
               {
                  IncTPExtendCount(ticket);
                  Print("TP_EXTEND #", ticket, " (", GetTPExtendCount(ticket), "/", InpTPExtendMaxTimes,
                        ") profit $", DoubleToString(profit,2),
                        " reached ", DoubleToString(EffTPExtendTriggerPct(),0), "% of TP, regime=",
                        RegimeName(), " — TP pushed ", DoubleToString(tpAdd, digits),
                        " further to ", DoubleToString(newTP, digits), ". Runner keeps running.");
               }
            }
         }
      }

      // ===== PATH 0: HARD LOSS PROTECTION (v4.4.5 — R-based, adaptive) =====
      // R-BASED hard stop fires only at catastrophic loss (e.g. 3× original SL risk).
      // This prevents the bug where a big lot + small $-cap = stopped out on 1-point noise.
      if(InpHardStopRBased && profit <= -(rDollars * InpHardStopRMulti))
      {
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "HARD_STOP_R",
                 StringFormat("Down %.1fR ($%.2f of %.2f) — %.1fR catastrophic cap hit. Capital preservation.",
                              MathAbs(profit)/rDollars, profit, rDollars, InpHardStopRMulti));
         trade.PositionClose(ticket); continue;
      }
      // Absolute $ cap ONLY fires if explicitly set and R-based disabled (legacy)
      if(!InpHardStopRBased && EffHardStopUSD() > 0 && profit <= -EffHardStopUSD())
      {
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "HARD_STOP",
                 StringFormat("Loss $%.2f breached absolute cap $%.2f. Capital preservation override.",
                              profit, EffHardStopUSD()));
         trade.PositionClose(ticket); continue;
      }
      if(InpEarlyAdverseCut && minsOpen <= InpEarlyAdverseMin &&
         profit <= -(rDollars * InpEarlyAdverseR))
      {
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "EARLY_ADVERSE",
                 StringFormat("Down %.1fR ($%.2f of %.2f) within first %d min. Entry was wrong — cut fast.",
                              MathAbs(profit)/rDollars, profit, rDollars, InpEarlyAdverseMin));
         trade.PositionClose(ticket); continue;
      }
      // v4.7.2 — In Preservation Mode, PEAK_RETRACE only fires on DEEP retraces
      //   from BIG peaks (90% retrace from $200+) — it's a runner-saver, not a scalper.
      double effRetracePct = InpPreservationMode ? MathMax(InpPeakRetracePct, 90.0) : InpPeakRetracePct;
      double effPeakMin    = InpPreservationMode ? MathMax(EffPeakMinUSD(), 200.0)  : EffPeakMinUSD();
      if(InpPeakRetraceExit && peak >= effPeakMin && retracePct >= effRetracePct)
      {
         if(AIBlocksClose("PEAK_RETRACE", ticket, isBuy, openPx, curPrice,
                          profit, peak, rDollars, slDist, curSL, curTP,
                          digits, rsi, emaF, emaS, atr, minsOpen, posInfo.Volume()))
            continue;
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "PEAK_RETRACE",
                 StringFormat("Peak was $%.2f, now $%.2f — gave back %.0f%% (threshold %.0f%%).",
                              peak, profit, retracePct, effRetracePct));
         trade.PositionClose(ticket); continue;
      }

      // ===== ADAPTIVE RUNNER (v4.7.7) — 2-stage tick-1 trailing =====
      //   Fixes: slow SL activation, giveback from +$3,938 peak to loss.
      //   Stage 0: Break-even at +0.5R (lock tiny profit cushion)
      //   Stage 1: +0.3R → tight 1.0×ATR trail (protect early winners)
      //   Stage 2: +1.0R → wider 2.2×ATR trail (let runner breathe)
      //   Adaptive: tighter trail in strong momentum (faster ratchet).
      //   Anti-noise: SL never closer than InpARMinTrailPoints (prevents chop stops).
      //   Runs every tick — no time-in-trade gate.
      //   Co-exists with Profit Ladder / Peak-Lock (those only move SL FURTHER,
      //   and SafeModifySL ratchets only → no conflict).
      // v4.9.1 — PROFIT RATCHET (user's spec: SL = 50% of current profit, fast, account-aware)
      //   Arm at InpRatchetArmPct% of balance (floor $50). $100k → arms at $500.
      //   Every tick while armed: compute new SL price that would bank 50% of CURRENT profit.
      //   Only ratchet forward (never pull back). Respects broker stops-level.
      //   This replaces the old AR_BE + AR_S1 + AR_S2 staging when enabled.
      if(InpProfitRatchet && profit > 0 && rDollars > 0 &&
         !(InpBasketMode && InpBasketDisablePerTrade))
      {
         double accBal = StrategyReferenceBalance();
         double armUSD = MathMax(InpRatchetArmFloor, accBal * InpRatchetArmPct / 100.0);

         if(profit >= armUSD)
         {
            double lockUSD = profit * InpRatchetLockPct / 100.0;
            // Convert $ lock to price distance using R: (lockUSD / rDollars) × slDist
            double lockDist = (lockUSD / rDollars) * slDist;
            double newSL = isBuy ? NormalizeDouble(openPx + lockDist, digits)
                                  : NormalizeDouble(openPx - lockDist, digits);
            // Sanity: must sit in profit zone with broker stops-level buffer
            double rPoint = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
            long   rSlLvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
            double rBufPts = MathMax(rSlLvl * rPoint, rPoint * 30);
            bool rSane = isBuy ? (newSL > openPx && newSL < curPrice - rBufPts)
                               : (newSL < openPx && newSL > curPrice + rBufPts);
            // Ratchet only — never move SL backward
            bool rRatchet = isBuy ? (newSL > curSL) : (newSL < curSL || curSL == 0);
            if(rSane && rRatchet)
            {
               if(SafeModifySL(ticket, newSL, curTP, isBuy, curPrice, "P_RATCHET"))
               {
                  static datetime lastRatchetLog = 0;
                  if(TimeCurrent() - lastRatchetLog > 30)
                  {
                     Print("P_RATCHET #", ticket, " profit $", DoubleToString(profit,0),
                           " — SL locks $", DoubleToString(lockUSD,0),
                           " (", DoubleToString(InpRatchetLockPct,0),
                           "%) at ", DoubleToString(newSL, digits));
                     lastRatchetLog = TimeCurrent();
                  }
               }
            }
         }
      }

      // v4.7.7 — ADAPTIVE RUNNER (legacy 2-stage — DISABLED when ProfitRatchet is on)
      //   v4.8.8 — SKIPPED in SIMPLE mode (pyramid-style: only Peak-Lock + initial SL/TP).
      //   Pyramid trades work well because they don't get active management — let's
      //   apply that same simplicity to initial trades by default.
      if(InpMgmtMode != MGMT_SIMPLE && InpAdaptiveRunner && profit > 0 && rDollars > 0 && atr > 0)
      {
         double profitR = profit / rDollars;
         double point = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
         double minDist = InpARMinTrailPoints * point;

         // v4.8.4 — TREND HOLD detection: H4+H1+M5 all aligned WITH trade direction
         bool trendHold = false;
         if(InpTrendHoldMode)
         {
            double h4F = (ArraySize(bufEMAFast_H4) > 1) ? bufEMAFast_H4[1] : 0;
            double h4S = (ArraySize(bufEMASlow_H4) > 1) ? bufEMASlow_H4[1] : 0;
            double h1F = (ArraySize(bufEMAFast_H1) > 1) ? bufEMAFast_H1[1] : 0;
            double h1S = (ArraySize(bufEMASlow_H1) > 1) ? bufEMASlow_H1[1] : 0;
            if(h4F > 0 && h1F > 0)
            {
               bool h4AlignUp   = (h4F > h4S);
               bool h1AlignUp   = (h1F > h1S);
               bool m5AlignUp   = (emaF > emaS);
               if(isBuy  && h4AlignUp && h1AlignUp && m5AlignUp)  trendHold = true;
               if(!isBuy && !h4AlignUp && !h1AlignUp && !m5AlignUp) trendHold = true;
            }
         }

         // Momentum detector: strong bar in our direction → tighten trail for faster lock
         double barRange = MathAbs(close1 - open1);
         bool strongMomentum = (barRange > atr * 1.2) &&
                               ((isBuy && close1 > open1) || (!isBuy && close1 < open1));
         double trailMulti = 0;

         // Pick stage based on R profit
         // v4.8.6 — Compute dollar thresholds from account balance
         double accBal = StrategyReferenceBalance();
         double arS1MinProfit = MathMax(30.0, accBal * InpARStage1MinPct / 100.0);
         double arBEMinProfit = MathMax(50.0, accBal * InpARBreakEvenMinPct / 100.0);

         // v4.8.6 — Trend Hold: force wide trail regardless of stage thresholds
         //   BUT still require profit ≥ arS1MinProfit so we don't micro-trail tiny wins
         if(trendHold && profitR >= InpARStage1ActivateR && profit >= arS1MinProfit)
         {
            trailMulti = InpTrendHoldTrailATR;  // wide trail, let it RUN
            // no momentum-tightening in trend-hold — we want breathing room
         }
         else if(profitR >= InpARStage2ActivateR)
         {
            trailMulti = InpARStage2TrailATR;
            if(strongMomentum) trailMulti *= InpARMomentumBoostMulti;
         }
         else if(profitR >= InpARStage1ActivateR && profit >= arS1MinProfit)
         {
            trailMulti = InpARStage1TrailATR;
            if(strongMomentum) trailMulti *= InpARMomentumBoostMulti;
         }

         // Stage 0: Break-even lock at +BreakEvenR (fires even before Stage 1 trail)
         // v4.8.6 — ALSO require profit >= arBEMinProfit (scales with balance).
         if(profitR >= InpARBreakEvenR && profit >= arBEMinProfit)
         {
            double beProfitDist = slDist * InpARBreakEvenProfitR;
            double beSL = isBuy ? NormalizeDouble(openPx + beProfitDist, digits)
                                 : NormalizeDouble(openPx - beProfitDist, digits);
            // Respect anti-noise: ensure BE SL is at least minDist from current price
            bool beSane = isBuy ? (beSL < curPrice - minDist) : (beSL > curPrice + minDist);
            bool beRatchet = isBuy ? (beSL > curSL) : (beSL < curSL || curSL == 0);
            if(beSane && beRatchet)
            {
               if(SafeModifySL(ticket, beSL, curTP, isBuy, curPrice, "AR_BE"))
                  Print("AR_BE #", ticket, " profitR=", DoubleToString(profitR,2),
                        " — locked BE+", DoubleToString(InpARBreakEvenProfitR,2), "R at ",
                        DoubleToString(beSL, digits));
            }
         }

         // Stage 1/2: Adaptive ATR trail
         if(trailMulti > 0)
         {
            double trailDist = MathMax(atr * trailMulti, minDist);
            double newSL = isBuy ? NormalizeDouble(curPrice - trailDist, digits)
                                  : NormalizeDouble(curPrice + trailDist, digits);
            // Must be in profit zone AND ratchet only
            bool sane = isBuy ? (newSL > openPx - (slDist * 0.3) && newSL < curPrice - minDist)
                              : (newSL < openPx + (slDist * 0.3) && newSL > curPrice + minDist);
            bool ratchet = isBuy ? (newSL > curSL) : (newSL < curSL || curSL == 0);
            if(sane && ratchet)
            {
               string tag = trendHold ? "AR_TH" :
                            (profitR >= InpARStage2ActivateR ? "AR_S2" : "AR_S1");
               if(SafeModifySL(ticket, newSL, curTP, isBuy, curPrice, tag))
               {
                  static datetime lastARLog = 0;
                  if(TimeCurrent() - lastARLog > 30)  // throttle 30s to keep journal clean
                  {
                     Print(tag, " #", ticket, " profitR=", DoubleToString(profitR,2),
                           strongMomentum ? " [MOM+]" : "",
                           " — SL→", DoubleToString(newSL, digits),
                           " (", DoubleToString(trailMulti,2), "×ATR, min ",
                           DoubleToString(InpARMinTrailPoints,0), "pts)");
                     lastARLog = TimeCurrent();
                  }
               }
            }
         }
      }

      // ===== PATH A: DETERMINISTIC TRAILING =====
      // Trail at 1.2x ATR behind price.
      // SKIPPED if Profit Ladder OR Adaptive Runner OR Clean Exits is active.
      if(!InpProfitLadder && !InpAdaptiveRunner && !InpCleanExits)
      {
         double trailDist = MathMax(atr * 1.2, SymbolInfoDouble(Symbol(), SYMBOL_POINT) * 200);
         if(isBuy && profit > 0)
         {
            double newSL = NormalizeDouble(curPrice - trailDist, digits);
            if(newSL > curSL && newSL > openPx)
               SafeModifySL(ticket, newSL, curTP, true, curPrice, "TRAIL-A");
         }
         if(!isBuy && profit > 0)
         {
            double newSL = NormalizeDouble(curPrice + trailDist, digits);
            if(newSL < curSL && newSL < openPx)
               SafeModifySL(ticket, newSL, curTP, false, curPrice, "TRAIL-A");
         }
      }

      // ===== PATH B: SMART MANAGEMENT =====

      // B1: Breakeven lock — SKIPPED if Profit Ladder OR Adaptive Runner OR Clean Exits is active.
      //   Clean Exits has its own BE logic at +1R (ManageCleanExits) that supersedes this.
      if(!InpProfitLadder && !InpAdaptiveRunner && !InpCleanExits)
      {
         double activateDist = slDist * InpBELockActivateR;
         double lockProfitDist = slDist * InpBELockProfitR;
         if(isBuy && curPrice > openPx + activateDist)
         {
            double beSL = NormalizeDouble(openPx + lockProfitDist, digits);
            if(beSL > curSL)
            {
               if(SafeModifySL(ticket, beSL, curTP, true, curPrice, "BE_LOCK"))
                  Print("BE_LOCK #", ticket, " SL→", DoubleToString(beSL, digits),
                        " (+", DoubleToString(InpBELockActivateR,2), "R reached, locking +",
                        DoubleToString(InpBELockProfitR,2), "R profit)");
            }
         }
         if(!isBuy && curPrice < openPx - activateDist)
         {
            double beSL = NormalizeDouble(openPx - lockProfitDist, digits);
            if(beSL < curSL || curSL == 0)
            {
               if(SafeModifySL(ticket, beSL, curTP, false, curPrice, "BE_LOCK"))
                  Print("BE_LOCK #", ticket, " SL→", DoubleToString(beSL, digits),
                        " (+", DoubleToString(InpBELockActivateR,2), "R reached, locking +",
                        DoubleToString(InpBELockProfitR,2), "R profit)");
            }
         }
      }

      // v4.6.7 / v4.8.3 / v4.8.6 — PEAK-LOCK BACKSTOP (dynamic scaling, account-size aware arm)
      // Arm threshold now scales with balance: 0.3% of balance, min $8 floor.
      //   $1k acc → arm at peak $8
      //   $10k acc → arm at peak $30
      //   $100k acc → arm at peak $300
      //   $1M acc → arm at peak $3,000
      double plBal = StrategyReferenceBalance();
      double peakArmUSD = MathMax(20.0, plBal * InpPeakLockArmPct / 100.0);
      if(InpPeakLockBackstop && peak >= peakArmUSD && rDollars > 0 &&
         !(InpBasketMode && InpBasketDisablePerTrade))
      {
         double effPct = InpPeakLockMinPct;
         if(peak >= 300.0)  effPct = MathMax(effPct, 50.0);
         if(peak >= 1000.0) effPct = MathMax(effPct, 60.0);
         if(peak >= 3000.0) effPct = MathMax(effPct, 70.0);
         double minLockUSD = peak * effPct / 100.0;
         if(minLockUSD > 0)
         {
            double pBackDist = (minLockUSD / rDollars) * slDist;
            double pBackSL   = isBuy ? NormalizeDouble(openPx + pBackDist, digits)
                                     : NormalizeDouble(openPx - pBackDist, digits);
            // Sanity: must sit in profit zone with broker stops-level buffer
            double pPoint = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
            long   pStopsLvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
            double pBufPts   = MathMax(pStopsLvl * pPoint, pPoint * 30);
            bool pSane = isBuy ? (pBackSL > openPx && pBackSL < curPrice - pBufPts)
                               : (pBackSL < openPx && pBackSL > curPrice + pBufPts);
            // Ratchet only — never move SL backward
            bool pShould = isBuy ? (pBackSL > curSL)
                                 : (pBackSL < curSL || curSL == 0);
            if(pSane && pShould)
            {
               if(SafeModifySL(ticket, pBackSL, curTP, isBuy, curPrice, "PEAK_LOCK"))
                  Print("PEAK_LOCK #", ticket, " peak $", DoubleToString(peak,2),
                        " — dynamic ", DoubleToString(effPct,0),
                        "% = +$", DoubleToString(minLockUSD,2),
                        " locked (price ", DoubleToString(pBackSL, digits), "). Worst case = banked.");
            }
         }
      }

      // v4.6.2 — PROFIT LADDER (account-scaled)
      // Once trade reaches each profit tier, push SL to lock guaranteed dollar profit.
      // Tiers are % of CURRENT BALANCE so a $500 account uses $5/$2 tier-1, a $50k
      // account uses $250/$100, etc. Absolute floors prevent micro accounts from
      // having $0 lock amounts. Set InpLadderUsePct=false for fixed $ legacy mode.
      if(InpProfitLadder && profit > 0)
      {
         double bal = StrategyReferenceBalance();
         double t1p, t1l, t2p, t2l, t3p, t3l, t4p, t4l, t5p, t5l, t6p, t6l, t7p, t7l;
         if(InpLadderUsePct)
         {
            t1p = bal * InpLadderTier1ProfPct / 100.0;
            t1l = bal * InpLadderTier1LockPct / 100.0;
            t2p = bal * InpLadderTier2ProfPct / 100.0;
            t2l = bal * InpLadderTier2LockPct / 100.0;
            t3p = bal * InpLadderTier3ProfPct / 100.0;
            t3l = bal * InpLadderTier3LockPct / 100.0;
            t4p = bal * InpLadderTier4ProfPct / 100.0;
            t4l = bal * InpLadderTier4LockPct / 100.0;
            t5p = bal * InpLadderTier5ProfPct / 100.0;
            t5l = bal * InpLadderTier5LockPct / 100.0;
            t6p = bal * InpLadderTier6ProfPct / 100.0;
            t6l = bal * InpLadderTier6LockPct / 100.0;
            t7p = bal * InpLadderTier7ProfPct / 100.0;
            t7l = bal * InpLadderTier7LockPct / 100.0;
            // Apply micro-account floors so tiers stay viable on tiny balances
            if(t1p < InpLadderMinProfFloor) t1p = InpLadderMinProfFloor;
            if(t1l < InpLadderMinLockFloor) t1l = InpLadderMinLockFloor;
         }
         else
         {
            t1p = InpLadderTier1Profit; t1l = InpLadderTier1Lock;
            t2p = InpLadderTier2Profit; t2l = InpLadderTier2Lock;
            t3p = InpLadderTier3Profit; t3l = InpLadderTier3Lock;
            t4p = InpLadderTier4Profit; t4l = InpLadderTier4Lock;
            t5p = InpLadderTier5Profit; t5l = InpLadderTier5Lock;
            t6p = InpLadderTier6Profit; t6l = InpLadderTier6Lock;
            t7p = InpLadderTier7Profit; t7l = InpLadderTier7Lock;
         }

         double lockProfitUSD = 0;
         double tierTriggered = 0;
         bool   moonTier = false;
         if(profit >= t7p)      { lockProfitUSD = t7l; tierTriggered = t7p; moonTier = true; }
         else if(profit >= t6p) { lockProfitUSD = t6l; tierTriggered = t6p; }
         else if(profit >= t5p) { lockProfitUSD = t5l; tierTriggered = t5p; }
         else if(profit >= t4p) { lockProfitUSD = t4l; tierTriggered = t4p; }
         else if(profit >= t3p) { lockProfitUSD = t3l; tierTriggered = t3p; }
         else if(profit >= t2p) { lockProfitUSD = t2l; tierTriggered = t2p; }
         else if(profit >= t1p) { lockProfitUSD = t1l; tierTriggered = t1p; }

         if(lockProfitUSD > 0 && rDollars > 0)
         {
            // Convert $-lock into a price level
            double lockDist = (lockProfitUSD / rDollars) * slDist;
            double newLockSL = isBuy ? NormalizeDouble(openPx + lockDist, digits)
                                     : NormalizeDouble(openPx - lockDist, digits);

            // v4.6.4 — SANITY CHECK: lock SL must be in the PROFIT ZONE
            //   (between entry and current price, with broker stops-level buffer).
            //   Without this, profit retracing below the high-tier lock would
            //   place SL on wrong side → broker rejects with "invalid stops".
            double point = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
            long stopsLvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
            double minStopsDist = stopsLvl * point;
            double bufferPts = MathMax(minStopsDist, point * 30); // +30 pts breathing room
            bool sane = false;
            if(isBuy)  sane = (newLockSL > openPx) && (newLockSL < curPrice - bufferPts);
            else       sane = (newLockSL < openPx) && (newLockSL > curPrice + bufferPts);
            if(!sane)
            {
               static datetime lastLadderSkip = 0;
               if(TimeCurrent() - lastLadderSkip > 60)
               {
                  Print("LADDER SKIP: lock $", DoubleToString(lockProfitUSD,0),
                        " (price ", DoubleToString(newLockSL,digits), ") doesn't fit in profit zone (entry ",
                        DoubleToString(openPx,digits), ", price ", DoubleToString(curPrice,digits),
                        "). Profit retraced below tier — waiting for it to rebuild.");
                  lastLadderSkip = TimeCurrent();
               }
            }
            else
            {
               // Only ratchet UP for BUY or DOWN for SELL
               bool shouldUpdate = isBuy ? (newLockSL > curSL)
                                         : (newLockSL < curSL || curSL == 0);
               if(shouldUpdate)
               {
                  if(SafeModifySL(ticket, newLockSL, curTP, isBuy, curPrice, "LADDER"))
                     Print("PROFIT_LADDER #", ticket, " profit $", DoubleToString(profit,2),
                           " ≥ tier $", DoubleToString(tierTriggered, 0),
                           " (bal $", DoubleToString(bal, 0), ")",
                           " — SL locked at +$", DoubleToString(lockProfitUSD, 0),
                           " (price ", DoubleToString(newLockSL, digits), "). Worst case = banked profit.");
               }
            }

            // v4.6.6 — MOON TRAIL: once tier 7 is hit (massive profit), switch to a
            //   wide ATR trail so any NEW HIGH automatically pushes SL up, banking
            //   each fresh peak. This is what makes "let it run forever" actually
            //   capture the gains instead of giving them all back.
            if(moonTier && InpLadderMoonTrail && atr > 0)
            {
               double moonDist = atr * InpLadderMoonTrailATR;
               double moonSL   = isBuy ? NormalizeDouble(curPrice - moonDist, digits)
                                       : NormalizeDouble(curPrice + moonDist, digits);
               // Only ratchet — never give back ground
               bool moonShould = isBuy ? (moonSL > curSL && moonSL > newLockSL)
                                       : ((moonSL < curSL || curSL == 0) && moonSL < newLockSL);
               // Sanity: must still sit in profit zone vs current price
               bool moonSane = isBuy ? (moonSL > openPx && moonSL < curPrice - bufferPts)
                                     : (moonSL < openPx && moonSL > curPrice + bufferPts);
               if(moonShould && moonSane)
               {
                  if(SafeModifySL(ticket, moonSL, curTP, isBuy, curPrice, "MOON"))
                     Print("MOON_TRAIL #", ticket, " profit $", DoubleToString(profit,2),
                           " — SL ratcheted to ", DoubleToString(moonSL, digits),
                           " (", DoubleToString(InpLadderMoonTrailATR,2), "×ATR behind price). Riding the giant.");
               }
            }
         }
      }

      // v4.5.4 — PARTIAL TAKE-PROFIT
      // At +1R (default), close a fraction of the position to lock guaranteed profit,
      // let the remainder ride the trailing SL. Fires ONCE per ticket.
      // Skipped on high-conviction trades (>= InpConvRunMinConf) — those are meant
      // to fully run via the conviction runner wide trail.
      if(InpPartialTP && !InpCloudSafeDisablePartials && !PartialAlreadyTaken(ticket))
      {
         bool skipHighConf = InpPartialSkipHighConf &&
                             currentTradeConfidence >= InpConvRunMinConf;
         double profitR = (rDollars > 0) ? (profit / rDollars) : 0;
         // v4.6.0 — Don't fire partial within first N minutes; give the trade
         // time to develop. Premature partials cap winners on noise spikes.
         bool tooEarly = (minsOpen < InpPartialMinMinutes);
         if(!skipHighConf && !tooEarly && profitR >= InpPartialTPAtR)
         {
            double curLots = posInfo.Volume();
            double minLot  = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
            double lotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
            int    lotDig  = 2;
            if(lotStep > 0 && lotStep < 0.01)  lotDig = 3;
            if(lotStep > 0 && lotStep < 0.001) lotDig = 4;

            double partialLots = curLots * InpPartialPct;
            partialLots = MathFloor(partialLots / lotStep) * lotStep;
            partialLots = NormalizeDouble(partialLots, lotDig);

            // Only fire if both the partial AND the remaining chunk are >= broker minimum
            double remaining = NormalizeDouble(curLots - partialLots, lotDig);
            if(partialLots >= minLot && remaining >= minLot)
            {
               if(trade.PositionClosePartial(ticket, partialLots))
               {
                  MarkPartialTaken(ticket);
                  // v4.5.6 — Use proportional profit math (closed_fraction × total P/L)
                  double lockedProfit = profit * (partialLots / curLots);
                  Print("PARTIAL_TP #", ticket, " closed ", DoubleToString(partialLots, lotDig),
                        " of ", DoubleToString(curLots, lotDig), " lots at +",
                        DoubleToString(profitR, 2), "R ($", DoubleToString(lockedProfit, 2),
                        " locked). Remainder ", DoubleToString(remaining, lotDig),
                        " rides the trail.");
               }
               else
               {
                  Print("PARTIAL_TP FAIL #", ticket, " Err=", GetLastError(),
                        " Ret=", trade.ResultRetcode());
                  // Mark anyway to avoid retry-spam on persistent broker errors
                  MarkPartialTaken(ticket);
               }
            }
         }
      }

      // B2: Quick profit take — FOUR-factor confirmation for fading
      // v5.8.0 DATA-DRIVEN FIX: forensic analysis of 173 live trades showed
      // winners exiting at +0.19R median (vs planned 4R targets) while losers
      // hit -1.0R full stop. Net realized R:R was inverted. Root cause: this
      // block fires whenever profit > $150 ABSOLUTE, ignoring R-multiple. On
      // a 1-lot trade $150 = 1.5pts of move = 0.15R. The trade gets clipped
      // before it has a chance to earn its R.
      //
      // NEW GATE: do NOT consider quick exits until profit >= 1R AND >= $150.
      // This lets the trade BREATHE to its first R milestone, then the fade
      // logic can take winners that are genuinely turning.
      bool earnedFirstR = (rDollars > 0) && (profit >= rDollars);
      if(profit >= EffProfitTakeMin()
         && profit >= MathMax(75, EffProfitTakeMin() * 0.5)
         && earnedFirstR)
      {
         double close2alt = iClose(Symbol(), PERIOD_M5, 2);
         bool barReverse = isBuy ? (close1 < open1) : (close1 > open1);
         bool emaBroken  = isBuy ? (close1 < emaF)  : (close1 > emaF);
         bool rsiTurning = false;
         if(ArraySize(bufRSI) >= 3)
         {
            double rsiPrev = bufRSI[2];
            // RSI must be extreme AND turning back (not just high — that's normal in trends)
            if(isBuy)  rsiTurning = (rsi > 72 && rsi < rsiPrev);
            else       rsiTurning = (rsi < 28 && rsi > rsiPrev);
         }
         bool streakBroken = isBuy ? (close1 < close2alt) : (close1 > close2alt);

         // STRUCTURE BREAK: did price break a key swing level? (strong trader signal)
         // For BUY: broke below the recent swing low (last 5 bars)
         // For SELL: broke above the recent swing high
         bool structureBroken = false;
         double swingLow = close1, swingHigh = close1;
         for(int k = 2; k <= 6; k++)
         {
            double hk = iHigh(Symbol(), PERIOD_M5, k);
            double lk = iLow(Symbol(), PERIOD_M5, k);
            if(lk < swingLow)  swingLow  = lk;
            if(hk > swingHigh) swingHigh = hk;
         }
         if(isBuy  && close1 < swingLow)  structureBroken = true;
         if(!isBuy && close1 > swingHigh) structureBroken = true;

         // STRONG = 3 of 4 momentum-positive conditions hold
         int strongScore = 0;
         if(isBuy)
         {
            if(close1 > open1) strongScore++;
            if(close1 > emaF)  strongScore++;
            if(close1 > close2alt) strongScore++;
            if(rsi < 75 && rsi > 50) strongScore++;
         }
         else
         {
            if(close1 < open1) strongScore++;
            if(close1 < emaF)  strongScore++;
            if(close1 < close2alt) strongScore++;
            if(rsi > 25 && rsi < 50) strongScore++;
         }
         bool momentumStrong = strongScore >= 3;

         // FADE TRIGGER (exit a winner):
         //   Structure break alone = exit (price broke the swing, real reversal)
         //   OR 3-of-4 momentum signals = exit (RSI-turn + bar-reverse + EMA + streak)
         int fadeScore = 0;
         if(rsiTurning)   fadeScore++;
         if(barReverse)   fadeScore++;
         if(emaBroken)    fadeScore++;
         if(streakBroken) fadeScore++;
         bool momentumFading = structureBroken || fadeScore >= InpMomentumFadeScore;

         bool timeExpired = minsOpen > InpQuickExitMin;
         bool capReached  = profit >= EffProfitTakeMax();

         // v4.4.4 — MOMENTUM-FADE check FIRST (always wins, at any profit level)
         //           "Real reversal" = exit regardless of cap.
         if(momentumFading)
         {
            LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                    "MOMENTUM_FADE",
                    StringFormat("Real reversal: structure-broken=%s rsi-turn=%s bar-reverse=%s ema-broken=%s streak-broken=%s. Profit $%.2f peak $%.2f.",
                                 structureBroken?"Y":"N", rsiTurning?"Y":"N", barReverse?"Y":"N", emaBroken?"Y":"N", streakBroken?"Y":"N",
                                 profit, peak));
            trade.PositionClose(ticket); continue;
         }

         // v4.4.4 — CAP REACHED: only force-close if smart cap disabled.
         //           Otherwise, trail SL tight and LET THE RUNNER RUN up to ceiling.
         if(capReached && !InpSmartCapExit)
         {
            LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                    "QUICK_PROFIT_CAP",
                    StringFormat("Hit max profit target $%.2f (cap $%.2f). Taking the win.", profit, EffProfitTakeMax()));
            trade.PositionClose(ticket); continue;
         }
         if(capReached && InpSmartCapExit)
         {
            // v4.6.6 — When Profit Ladder is ON, the Ladder/Moon trail is the SOLE
            //   SL ratcheter. CAP_RUNNER's tighter trail (1.5–2.5×ATR) was clipping
            //   massive winners that the Moon trail (3.5×ATR) was meant to ride.
            //   Skip CAP_RUNNER's SL modify when Ladder is on; let Moon handle it.
            if(InpProfitLadder)
            {
               // Still skip force-close (already letting it run) — just don't tighten SL.
               // Moon trail above already moved SL if appropriate.
            }
            else
            {
            // v4.5.2 — Trend-aware, volatility-aware trailing distance.
            // v4.5.3 — Pass profit/R ratio so conviction-runner upgrade can fire.
            double profitR = (rDollars > 0) ? (profit / rDollars) : 0;
            double trailATR = GetTrailATRMulti(profitR);
            double trailDist = atr * trailATR;

            double lockSL;
            if(isBuy)
            {
               lockSL = NormalizeDouble(curPrice - trailDist, digits);
               if(lockSL > curSL && lockSL > openPx)
               {
                  if(SafeModifySL(ticket, lockSL, curTP, true, curPrice, "CAP_RUNNER"))
                     Print("CAP_RUNNER #", ticket, " profit $", DoubleToString(profit,2),
                           " peak $", DoubleToString(peak,2), " past cap $", DoubleToString(EffProfitTakeMax(),2),
                           " — SL trailed to ", DoubleToString(lockSL, digits),
                           " (", DoubleToString(trailATR,2), "xATR, regime=", RegimeName(), "). Letting it run.");
               }
            }
            else
            {
               lockSL = NormalizeDouble(curPrice + trailDist, digits);
               if((lockSL < curSL || curSL == 0) && lockSL < openPx)
               {
                  if(SafeModifySL(ticket, lockSL, curTP, false, curPrice, "CAP_RUNNER"))
                     Print("CAP_RUNNER #", ticket, " profit $", DoubleToString(profit,2),
                           " peak $", DoubleToString(peak,2), " past cap $", DoubleToString(EffProfitTakeMax(),2),
                           " — SL trailed to ", DoubleToString(lockSL, digits),
                           " (", DoubleToString(trailATR,2), "xATR, regime=", RegimeName(), "). Letting it run.");
               }
            }
            }

            // Hard ceiling escape: absurdly large runner still gets banked
            // (protects against unrealistic expectations on small accounts)
            if(profit >= InpProfMaxCeilUSD)
            {
               LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                       "PROFIT_CEILING",
                       StringFormat("Hit absolute ceiling $%.2f (max $%.2f). Banking the monster.",
                                    profit, InpProfMaxCeilUSD));
               trade.PositionClose(ticket); continue;
            }
            // else: let it run, next tick evaluates again
         }
         // v4.7.2 — When InpPreservationMode is ON, never close a profitable trade
         //   on the clock alone. Time only matters when we're losing.
         if(timeExpired && profit > 0 && InpPreservationMode)
         {
            // Skip — let the runner ride. Trail will catch the reversal.
         }
         else if(timeExpired && !(InpMomentumGuard && momentumStrong))
         {
            if(AIBlocksClose("TIME_EXPIRED", ticket, isBuy, openPx, curPrice,
                             profit, peak, rDollars, slDist, curSL, curTP,
                             digits, rsi, emaF, emaS, atr, minsOpen, posInfo.Volume()))
               continue;
            LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                    "TIME_EXPIRED",
                    StringFormat("Open %d min > cap %d min; momentum score only %d/4. Book what we have.",
                                 minsOpen, InpQuickExitMin, strongScore));
            trade.PositionClose(ticket); continue;
         }
         if(timeExpired && InpMomentumGuard && momentumStrong)
         {
            // v4.5.2 — Same trend-aware trail on time-expired runners
            // v4.5.3 — Pass profit/R ratio so conviction-runner upgrade can fire.
            double profitR2 = (rDollars > 0) ? (profit / rDollars) : 0;
            double trailATR2 = GetTrailATRMulti(profitR2);
            double trailDist2 = atr * trailATR2;

            double lockSL;
            if(isBuy)
            {
               lockSL = NormalizeDouble(curPrice - trailDist2, digits);
               if(lockSL > curSL && lockSL > openPx)
               { if(SafeModifySL(ticket, lockSL, curTP, true, curPrice, "RUNNER"))
                   Print("RUNNER #", ticket, " ", minsOpen, "min, score ", strongScore, "/4, SL→",
                         DoubleToString(lockSL, digits), " (", DoubleToString(trailATR2,2), "xATR, ", RegimeName(), ")"); }
            }
            else
            {
               lockSL = NormalizeDouble(curPrice + trailDist2, digits);
               if(lockSL < curSL && lockSL < openPx)
               { if(SafeModifySL(ticket, lockSL, curTP, false, curPrice, "RUNNER"))
                   Print("RUNNER #", ticket, " ", minsOpen, "min, score ", strongScore, "/4, SL→",
                         DoubleToString(lockSL, digits), " (", DoubleToString(trailATR2,2), "xATR, ", RegimeName(), ")"); }
            }
         }
      }

      // B3: Smart loss cut — R-multiple based (scales to any account size)
      // v4.7.2 — Preservation Mode raises threshold to -1.5R + needs MORE evidence
      //   so we don't bail on a -0.5R noise blip when bot direction is right.
      double scThresh = InpPreservationMode ? 1.5 : 0.25;
      double scDeep   = InpPreservationMode ? 2.0 : 0.5;
      int    scMinAge = InpPreservationMode ? 8   : 3;
      if(profit <= -(rDollars * scThresh) && minsOpen >= scMinAge)
      {
         bool emaAgainst = isBuy ? (close1 < emaF) : (close1 > emaF);
         bool rsiFailing = isBuy ? (rsi < 40) : (rsi > 60);
         bool deepLoss   = profit <= -(rDollars * scDeep) && minsOpen > 15;

         if((emaAgainst && rsiFailing) || deepLoss)
         {
            LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                    "SMART_CUT",
                    StringFormat("%.2fR loss + %s (EMA-against=%s RSI-failing=%s). Stop bleeding.",
                                 MathAbs(profit)/rDollars, deepLoss?"deep+time":"no-recovery",
                                 emaAgainst?"Y":"N", rsiFailing?"Y":"N"));
            trade.PositionClose(ticket); continue;
         }
      }

      // B4: Stale exit — regime-aware
      // v4.7.2 — Preservation Mode raises stale-loss bar (-2R from -0.6R) and
      //   disables stale-DRIFT entirely (drift trades are usually winners catching breath).
      int staleCap = (currentRegime == REGIME_LOW_VOL || currentRegime == REGIME_CHOPPY) ? 35 : 90;
      double staleR = InpPreservationMode ? 2.0 : 0.6;
      if(minsOpen > staleCap && profit <= -(rDollars * staleR))
      {
         if(AIBlocksClose("STALE_LOSS", ticket, isBuy, openPx, curPrice,
                          profit, peak, rDollars, slDist, curSL, curTP,
                          digits, rsi, emaF, emaS, atr, minsOpen, posInfo.Volume()))
            continue;
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "STALE_LOSS",
                 StringFormat("Open %d min > regime cap %d min at -%.2fR. Free the margin.",
                              minsOpen, staleCap, MathAbs(profit)/rDollars));
         trade.PositionClose(ticket); continue;
      }
      // v5.9.0: Only close drifting trades when EMA confirms the flat position has NO thesis.
      // If EMA fast is still above EMA slow for a BUY (or below for SELL), the trade is
      // aligned with the prevailing trend and may simply be consolidating — hold it.
      bool emaAgainstDrift = isBuy ? (emaF < emaS) : (emaF > emaS);
      if(!InpPreservationMode && minsOpen > 60 && profit > -30 && profit < 30 && emaAgainstDrift)
      {
         if(AIBlocksClose("STALE_DRIFT", ticket, isBuy, openPx, curPrice,
                          profit, peak, rDollars, slDist, curSL, curTP,
                          digits, rsi, emaF, emaS, atr, minsOpen, posInfo.Volume()))
            continue;
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "STALE_DRIFT",
                 StringFormat("Open %d min (>60min cap) with P/L $%.2f and EMA opposing trade. No valid thesis — free margin.", minsOpen, profit));
         trade.PositionClose(ticket); continue;
      }

      // ===== PATH C: CLAUDE SEMANTIC EXIT (proactive audit, every InpClaudeAuditSec) =====
      // v4.7.0 — uses AIExitVerdict (HOLD / CLOSE / LOCK $X). Cooldown is shared
      //   with the AI veto so we don't double-spend on Claude calls.
      static datetime lastClaudeCheck = 0;
      if(InpUseAI && !InpAIAdvisoryOnly && StringLen(InpServerURL) >= 10 && minsOpen >= 3 &&
         TimeCurrent() - lastClaudeCheck > InpClaudeAuditSec &&
         AIVetoCooldownOK(ticket, InpAIExitMinSec))
      {
         AIExitVerdict v = CheckPositionWithAI(
            isBuy ? "BUY" : "SELL", openPx, curPrice, profit,
            posInfo.Volume(), rsi, emaF, emaS, atr, minsOpen, curSL, curTP,
            peak, "", RegimeName());
         lastClaudeCheck = TimeCurrent();
         RecordAIVetoCall(ticket);

         if(v.action == 1 && v.lockUSD > 0 && rDollars > 0)
         {
            // Claude wants to LOCK $X — bank profit without exiting
            double lockDist = (v.lockUSD / rDollars) * slDist;
            double newSL = isBuy ? NormalizeDouble(openPx + lockDist, digits)
                                 : NormalizeDouble(openPx - lockDist, digits);
            double pp = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
            long   slLvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
            double bufPts = MathMax(slLvl * pp, pp * 30);
            bool sane    = isBuy ? (newSL > openPx && newSL < curPrice - bufPts)
                                 : (newSL < openPx && newSL > curPrice + bufPts);
            bool ratchet = isBuy ? (newSL > curSL) : (newSL < curSL || curSL == 0);
            if(sane && ratchet && SafeModifySL(ticket, newSL, curTP, isBuy, curPrice, "AI_LOCK"))
               Print("AI LOCK (audit) #", ticket, " — locked +$", DoubleToString(v.lockUSD,2),
                     " at ", DoubleToString(newSL, digits), ". ", v.reason);
         }
         else if(v.action == -1) // CLOSE
         {
            // Safety net: if losing AND small loss (<0.3R), let SL handle it
            if(profit < 0 && profit > -(rDollars * 0.3))
            {
               Print("CLAUDE_EXIT_BLOCKED #", ticket, " losing -$", DoubleToString(MathAbs(profit), 2),
                     " but < 0.3R — letting SL handle");
            }
            else
            {
               LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                       "CLAUDE_AI",
                       StringFormat("Claude 4.5 said CLOSE. P/L $%.2f (%.2fR). %s",
                                    profit, profit/rDollars, v.reason));
               trade.PositionClose(ticket); continue;
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| AI FUNCTIONS                                                     |
//+------------------------------------------------------------------+
// Tiny JSON string extractor: pulls raw value of first occurrence of "key":"..."
// Handles basic escaping (\" and \\). Returns empty string if not found.
string ExtractJsonString(const string &json, const string key)
{
   string needle = "\"" + key + "\":";
   int p = StringFind(json, needle);
   if(p < 0) return "";
   p += StringLen(needle);
   // Skip whitespace
   while(p < StringLen(json) && (StringGetCharacter(json, p) == ' ' || StringGetCharacter(json, p) == '\t')) p++;
   if(p >= StringLen(json) || StringGetCharacter(json, p) != '"') return "";
   p++; // past opening quote
   string out = "";
   while(p < StringLen(json))
   {
      ushort c = StringGetCharacter(json, p);
      if(c == '\\' && p + 1 < StringLen(json))
      {
         ushort n = StringGetCharacter(json, p + 1);
         if(n == '"')  { out += "\""; p += 2; continue; }
         if(n == '\\') { out += "\\"; p += 2; continue; }
         if(n == 'n')  { out += " ";  p += 2; continue; }  // collapse newlines to space for log
         out += ShortToString((ushort)n);
         p += 2; continue;
      }
      if(c == '"') break;   // closing quote
      out += ShortToString(c);
      p++;
   }
   return out;
}

double ExtractJsonDouble(const string &json, const string key, double fallback)
{
   string needle = "\"" + key + "\":";
   int p = StringFind(json, needle);
   if(p < 0) return fallback;
   p += StringLen(needle);
   while(p < StringLen(json) && (StringGetCharacter(json, p) == ' ' || StringGetCharacter(json, p) == '\t')) p++;
   string num = "";
   while(p < StringLen(json))
   {
      ushort c = StringGetCharacter(json, p);
      if((c >= '0' && c <= '9') || c == '.' || c == '-') { num += ShortToString(c); p++; }
      else break;
   }
   if(StringLen(num) == 0) return fallback;
   return StringToDouble(num);
}

int ExtractJsonInt(const string &json, const string key, int fallback)
{
   return (int)ExtractJsonDouble(json, key, (double)fallback);
}

// v6.3.0: enriched GetAIAnalysis — sends full market context to AI Director
// Added: htf_consensus, session, open_positions, basket_float_pl, recent_wins,
//        recent_losses, account_equity, daily_pct, grade, setup_score, combined_score
// v6.3.7: FIX — recent_wins/recent_losses now use last-10-trade sliding window from
//         patterns[] instead of all-time cumulative wins/losses counters.
// v6.3.7: PERF — per-bar AI cache keyed on (signature + bar open time) to prevent
//         duplicate LLM calls when the same signal fires on multiple ticks within
//         one M5 bar. Cache evicted automatically when the bar changes.
// v6.3.7: CONTEXT — recent_candles field now populated with last 5 closed M5 OHLC
//         candles so the AI can reason about price action, not just indicator values.
int GetAIAnalysis(double emaF, double emaS, double rsi, double atr, double price, string h1Dir, double spread,
                  string setup, string regime, string signature, double stoch, double mom,
                  string grade = "", double setupScore = 0, double combinedScore = 0)
{
   // Reset cached outputs
   lastAIConfidence = 0;
   lastAIBearishCase = "";
   lastAISkipIf = "";
   g_aiClaudeVote = "unknown";
   g_aiGPTVote    = "unknown";

   if(!InpUseAI || InpBacktestMode || StringLen(InpServerURL) < 10) return 0;

   // -----------------------------------------------------------------------
   // v6.3.7 IMPROVEMENT 2: Per-bar AI response cache.
   // Within a single M5 bar, calling GetAIAnalysis multiple times for the
   // same signature produces identical results (same price context, same
   // indicators). Each call blocks tick processing for up to 16 s (2 × 8 s
   // AI timeout). Cache the result and replay it instantly for duplicate
   // calls on the same bar+signature pair.
   // -----------------------------------------------------------------------
   static string g_aiCacheSig     = "";
   static datetime g_aiCacheBar   = 0;
   static int      g_aiCacheDir   = 0;
   static int      g_aiCacheConf  = 0;
   static string   g_aiCacheThesis = "";
   static string   g_aiCacheInval  = "";
   static string   g_aiCacheTarget = "";
   static string   g_aiCacheBearish = "";
   static string   g_aiCacheSkipIf  = "";
   static string   g_aiCacheClaudeV = "";
   static string   g_aiCacheGPTV    = "";

   datetime currentBarOpen = iTime(Symbol(), PERIOD_M5, 0);
   if(g_aiCacheBar == currentBarOpen && g_aiCacheSig == signature && g_aiCacheDir != -999)
   {
      // Replay cached response — no network call
      lastAIConfidence    = g_aiCacheConf;
      currentTradeThesis       = g_aiCacheThesis;
      currentTradeInvalidation = g_aiCacheInval;
      currentTradeTarget       = g_aiCacheTarget;
      currentTradeBearishCase  = g_aiCacheBearish;
      lastAIBearishCase        = g_aiCacheBearish;
      lastAISkipIf             = g_aiCacheSkipIf;
      g_aiClaudeVote           = g_aiCacheClaudeV;
      g_aiGPTVote              = g_aiCacheGPTV;
      Print("AI DIRECTOR CACHE HIT: reusing ", signature, " result from this bar (dir=",
            g_aiCacheDir, " conf=", g_aiCacheConf, "%) — no LLM call needed");
      return g_aiCacheDir;
   }

   // Gather rich context
   string htfConsensusStr = (g_htfConsensusDir == 1) ? "BULL" : (g_htfConsensusDir == -1) ? "BEAR" : "NEUTRAL";
   string sessionName = "";
   double sessQ = GetSessionQuality();
   MqlDateTime dt; TimeCurrent(dt);
   int gmt = dt.hour;
   if(gmt >= 0  && gmt < 3)  sessionName = "SYDNEY";
   else if(gmt >= 3  && gmt < 8)  sessionName = "TOKYO";
   else if(gmt >= 8  && gmt < 13) sessionName = "LONDON";
   else if(gmt >= 13 && gmt < 17) sessionName = "NEW_YORK";
   else if(gmt >= 17 && gmt < 21) sessionName = "NY_LONDON_CLOSE";
   else                            sessionName = "OFF_HOURS";

   int openPositions = PositionsTotal();
   double basketFloat = 0;
   for(int pi = 0; pi < openPositions; pi++) {
      ulong t = PositionGetTicket(pi);
      if(t > 0 && PositionGetString(POSITION_SYMBOL) == Symbol())
         basketFloat += PositionGetDouble(POSITION_PROFIT);
   }
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   double dailyPct = (dailyStartEquity > 0) ? ((equity - dailyStartEquity) / dailyStartEquity * 100.0) : 0.0;

   // -----------------------------------------------------------------------
   // v6.3.7 IMPROVEMENT 1: Fix recent_wins / recent_losses context bug.
   // The previous code passed the all-time career totals `wins` and `losses`
   // as "Recent" performance to the AI — e.g. "Recent: 310W / 190L" after
   // hundreds of trades, which is meaningless for assessing current conditions.
   // Now we compute a true last-10-trade sliding window from patterns[].
   // patterns[] is a FIFO array of closed-trade structs; the last N entries
   // are the most recently closed trades.
   // -----------------------------------------------------------------------
   int recentWins10 = 0, recentLosses10 = 0;
   {
      int windowSize = 10;
      int startIdx = MathMax(0, patternCount - windowSize);
      for(int pw = startIdx; pw < patternCount; pw++)
      {
         if(patterns[pw].wasWinner) recentWins10++;
         else                        recentLosses10++;
      }
   }

   // -----------------------------------------------------------------------
   // v6.3.7 IMPROVEMENT 3: Populate recent_candles with last 5 closed M5
   // OHLC candles. The AI receives indicator values but zero price action.
   // Five candles of OHLC context (in compact CSV format O/H/L/C) let the
   // AI assess momentum, inside bars, pin bars and engulfing patterns that
   // pure RSI/EMA cannot express. Format: "O/H/L/C O/H/L/C ..." oldest-first.
   // -----------------------------------------------------------------------
   string recentCandlesStr = "";
   {
      for(int ci = 5; ci >= 1; ci--)
      {
         double cO = iOpen(Symbol(),  PERIOD_M5, ci);
         double cH = iHigh(Symbol(),  PERIOD_M5, ci);
         double cL = iLow(Symbol(),   PERIOD_M5, ci);
         double cC = iClose(Symbol(), PERIOD_M5, ci);
         string cEntry = StringFormat("%.2f/%.2f/%.2f/%.2f", cO, cH, cL, cC);
         if(StringLen(recentCandlesStr) > 0) recentCandlesStr += " ";
         recentCandlesStr += cEntry;
      }
   }

   string url = InpServerURL + "/api/ai/analyze";
   string headers = "Content-Type: application/json\r\n";
   string body = StringFormat(
      "{\"price\":%.2f,\"ema_fast\":%.2f,\"ema_slow\":%.2f,\"rsi\":%.1f,\"stoch\":%.1f,\"mom\":%.2f,\"atr\":%.2f,"
      "\"h1_trend\":\"%s\",\"htf_consensus\":\"%s\",\"spread\":%.0f,\"setup\":\"%s\",\"regime\":\"%s\","
      "\"session\":\"%s\",\"session_quality\":%.2f,\"open_positions\":%d,\"basket_float_pl\":%.2f,"
      "\"recent_wins\":%d,\"recent_losses\":%d,\"account_equity\":%.2f,\"daily_pct\":%.2f,"
      "\"grade\":\"%s\",\"setup_score\":%.2f,\"combined_score\":%.2f,\"signature\":\"%s\","
      "\"recent_candles\":\"%s\"}",
      price, emaF, emaS, rsi, stoch, mom, atr,
      h1Dir, htfConsensusStr, spread, setup, regime,
      sessionName, sessQ, openPositions, basketFloat,
      recentWins10, recentLosses10, equity, dailyPct,
      grade, setupScore, combinedScore, signature,
      recentCandlesStr);
   char postData[], result[]; string rh;
   StringToCharArray(body, postData, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 15000, postData, result, rh);
   if(res != 200)
   {
      g_aiConsecutiveFails++;
      if(g_aiConsecutiveFails >= InpAIOfflineMaxFails && !g_aiOffline)
      {
         g_aiOffline = true;
         g_aiOfflineSince = TimeCurrent();
         Print("AI DIRECTOR OFFLINE: ", g_aiConsecutiveFails, " consecutive failures. Switching to SAFE DEGRADED mode (", InpAIOfflineSafeMode ? "50% lot size" : "full size, no AI checks", ")");
      }
      // v6.3.2: auto-recovery attempt — after 30 minutes offline, reset fail counter so
      // the next call gets a fresh try instead of staying degraded indefinitely.
      if(g_aiOffline && g_aiOfflineSince > 0 && (TimeCurrent() - g_aiOfflineSince) > 1800)
      {
         g_aiConsecutiveFails = 0;
         g_aiOffline = false;
         g_aiOfflineSince = 0;
         Print("AI DIRECTOR AUTO-RECOVERY: 30 min elapsed — resetting fail counter for fresh retry.");
      }
      return 0;
   }
   // Success — reset fail counter
   if(g_aiConsecutiveFails > 0 || g_aiOffline)
   {
      g_aiConsecutiveFails = 0;
      if(g_aiOffline) { g_aiOffline = false; Print("AI DIRECTOR BACK ONLINE — resuming full authority"); }
   }
   string response = CharArrayToString(result);

   // v6.3.1 FIX: parse confidence FIRST (before action check) so that when AI
   // returns SKIP, lastAIConfidence is populated and CheckForEntry can correctly
   // distinguish a genuine SKIP (confidence known) from a no-response (confidence==0).
   int confIdx0 = StringFind(response, "\"confidence\":");
   if(confIdx0 >= 0)
   {
      int p0 = confIdx0 + StringLen("\"confidence\":");
      while(p0 < StringLen(response) && (StringGetCharacter(response, p0) == ' ' ||
            StringGetCharacter(response, p0) == '\t')) p0++;
      string numStr0 = "";
      while(p0 < StringLen(response)) {
         ushort c0 = StringGetCharacter(response, p0);
         if(c0 >= '0' && c0 <= '9') { numStr0 += ShortToString(c0); p0++; }
         else break;
      }
      if(StringLen(numStr0) > 0) lastAIConfidence = (int)StringToInteger(numStr0);
   }
   // Also pre-parse skip_if so SKIP vs no-response is distinguishable downstream
   lastAISkipIf = ExtractJsonString(response, "skip_if");

   int actIdx = StringFind(response, "\"action\":");
   if(actIdx < 0) return 0;
   string tail = StringSubstr(response, actIdx, 40);
   int dir = 0;
   if(StringFind(tail, "\"BUY\"")  >= 0) dir = 1;
   else if(StringFind(tail, "\"SELL\"") >= 0) dir = -1;
   // AI returned SKIP — confidence and skip_if are already parsed above; return 0 so
   // CheckForEntry falls into the aiResult==0 branch (not aiUnavailable).
   else return 0;

   // Capture the full trader thesis for storage + display
   currentTradeThesis       = ExtractJsonString(response, "thesis");
   currentTradeInvalidation = ExtractJsonString(response, "invalidation");
   currentTradeTarget       = ExtractJsonString(response, "target");
   currentTradeBearishCase  = ExtractJsonString(response, "bearish_case");

   // Confidence and skip_if already parsed above (before action check — v6.3.1 fix)
   lastAIBearishCase = currentTradeBearishCase;

   // v6.3.0: extract individual Claude + GPT votes from backend dual-vote response
   // Backend returns: "claude":{"action":"BUY","confidence":78}, "gpt":{"action":"BUY","confidence":72}
   // We find the claude block first, then gpt block, extracting action from each
   {
      int cIdx = StringFind(response, "\"claude\":");
      if(cIdx >= 0)
      {
         int aIdx = StringFind(response, "\"action\":", cIdx);
         if(aIdx > cIdx && aIdx < cIdx + 120)
         {
            string tail = StringSubstr(response, aIdx, 30);
            if(StringFind(tail, "\"BUY\"")  >= 0)  g_aiClaudeVote = "BUY";
            else if(StringFind(tail, "\"SELL\"") >= 0) g_aiClaudeVote = "SELL";
            else                                        g_aiClaudeVote = "SKIP";
         }
      }
      int gIdx = StringFind(response, "\"gpt\":");
      if(gIdx >= 0)
      {
         int aIdx = StringFind(response, "\"action\":", gIdx);
         if(aIdx > gIdx && aIdx < gIdx + 120)
         {
            string tail = StringSubstr(response, aIdx, 30);
            if(StringFind(tail, "\"BUY\"")  >= 0)  g_aiGPTVote = "BUY";
            else if(StringFind(tail, "\"SELL\"") >= 0) g_aiGPTVote = "SELL";
            else                                        g_aiGPTVote = "SKIP";
         }
      }
   }

   if(StringLen(currentTradeThesis) > 0)
   {
      Print("AI THESIS (", lastAIConfidence, "% conf): ", currentTradeThesis);
      if(StringLen(currentTradeBearishCase) > 0) Print("  Devil's Advocate: ", currentTradeBearishCase);
      if(StringLen(lastAISkipIf) > 0)           Print("  Skip if: ",           lastAISkipIf);
      if(StringLen(currentTradeInvalidation) > 0) Print("  Invalid if: ",      currentTradeInvalidation);
      if(StringLen(currentTradeTarget) > 0)       Print("  Target: ",          currentTradeTarget);
   }

   // -----------------------------------------------------------------------
   // v6.3.7 IMPROVEMENT 2: Store result in per-bar cache for this signature.
   // On the next tick (still same bar, same signal), GetAIAnalysis returns
   // immediately from cache above without any network call.
   // -----------------------------------------------------------------------
   g_aiCacheSig      = signature;
   g_aiCacheBar      = currentBarOpen;
   g_aiCacheDir      = dir;
   g_aiCacheConf     = lastAIConfidence;
   g_aiCacheThesis   = currentTradeThesis;
   g_aiCacheInval    = currentTradeInvalidation;
   g_aiCacheTarget   = currentTradeTarget;
   g_aiCacheBearish  = currentTradeBearishCase;
   g_aiCacheSkipIf   = lastAISkipIf;
   g_aiCacheClaudeV  = g_aiClaudeVote;
   g_aiCacheGPTV     = g_aiGPTVote;

   // v6.3.9: AI CONSENSUS logging — determine and log consensus_source
   {
      string csSource = "none";
      bool cOk = (g_aiClaudeVote == "BUY" || g_aiClaudeVote == "SELL");
      bool gOk = (g_aiGPTVote   == "BUY" || g_aiGPTVote   == "SELL");
      if(cOk && gOk && g_aiClaudeVote == g_aiGPTVote) csSource = "dual_consensus";
      else if(cOk && !gOk)  csSource = "claude_only";
      else if(!cOk && gOk)  csSource = "gpt_only";
      string finalStr = (dir == 1) ? "BUY" : (dir == -1) ? "SELL" : "NONE";
      Print("AI DIRECTOR: Claude=", g_aiClaudeVote,
            " GPT=", g_aiGPTVote,
            " consensus=", csSource,
            " final=", finalStr);
   }

   return dir;
}

// v4.7.0 — AI position auditor: returns AIExitVerdict struct (defined near top of file)
AIExitVerdict CheckPositionWithAI(string dir, double entry, double current, double profit, double lots,
                                   double rsi, double emaF, double emaS, double atr, int minsOpen, double sl, double tp,
                                   double peakProfit, string pendingExitReason, string regime)
{
   AIExitVerdict v; v.action = 0; v.lockUSD = 0; v.reason = ""; v.confidence = 0;
   if(InpBacktestMode) return v;                   // Tester: no network
   if(StringLen(InpServerURL) < 10) return v;
   string url = InpServerURL + "/api/ai/manage-position";
   string headers = "Content-Type: application/json\r\n";

   // v4.5.0 — Pass the ORIGINAL entry thesis + invalidation + confidence so Claude
   // can audit whether the REASON we took this trade still holds, rather than using
   // mechanical P/L rules. Escape quotes inside the thesis to keep JSON valid.
   string thesisEsc = currentTradeThesis;
   StringReplace(thesisEsc, "\"", "'");
   StringReplace(thesisEsc, "\n", " ");
   string invalEsc  = currentTradeInvalidation;
   StringReplace(invalEsc,  "\"", "'");
   StringReplace(invalEsc,  "\n", " ");

   // v6.3.5: enriched exit payload — add rMult, HTF consensus, session, setup, daily %, positions
   double slDist2 = MathAbs(entry - sl);
   double rMult2  = (slDist2 > 0 && profit != 0) ? profit / (slDist2 * lots * SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE) / SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE) * SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE)) : 0;
   // Simplified rMult: use profit vs estimated 1R (peakProfit can help gauge scale)
   string htfConsStr = (g_htfConsensusDir == 1) ? "BULL" : (g_htfConsensusDir == -1) ? "BEAR" : "NEUTRAL";
   double dailyPct2  = (dailyStartEquity > 0) ? ((AccountInfoDouble(ACCOUNT_EQUITY) - dailyStartEquity) / dailyStartEquity * 100.0) : 0.0;
   string sessionNow = "";
   MqlDateTime dt2; TimeCurrent(dt2);
   int gh = dt2.hour;
   if(gh >= 13 && gh < 17) sessionNow = "NY_LONDON";
   else if(gh >= 8 && gh < 13) sessionNow = "LONDON";
   else if(gh >= 0 && gh < 8) sessionNow = "ASIA";
   else sessionNow = "OFF_HOURS";

   string body = StringFormat(
      "{\"direction\":\"%s\",\"entry_price\":%.2f,\"current_price\":%.2f,\"profit\":%.2f,"
      "\"lots\":%.2f,\"rsi\":%.1f,\"ema_fast\":%.2f,\"ema_slow\":%.2f,\"atr\":%.2f,"
      "\"minutes_open\":%d,\"sl\":%.2f,\"tp\":%.2f,\"thesis\":\"%s\",\"invalidation\":\"%s\","
      "\"confidence\":%d,\"peak_profit\":%.2f,\"pending_exit_reason\":\"%s\",\"regime\":\"%s\","
      "\"r_mult\":%.2f,\"htf_consensus\":\"%s\",\"session\":\"%s\","
      "\"daily_pct\":%.2f,\"open_positions\":%d,\"setup_name\":\"%s\"}",
      dir, entry, current, profit,
      lots, rsi, emaF, emaS, atr,
      minsOpen, sl, tp, thesisEsc, invalEsc,
      currentTradeConfidence, peakProfit, pendingExitReason, regime,
      rMult2, htfConsStr, sessionNow,
      dailyPct2, PositionsTotal(), g_lastTradePattern);
   char postData[], result[]; string rh;
   StringToCharArray(body, postData, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 10000, postData, result, rh);
   if(res != 200) return v;
   string response = CharArrayToString(result);
   v.reason = ExtractJsonString(response, "reason");
   // Parse confidence from exit verdict response and store on struct
   {
      int confIdx = StringFind(response, "\"confidence\":");
      if(confIdx >= 0)
      {
         int cp = confIdx + StringLen("\"confidence\":");
         while(cp < StringLen(response) && (StringGetCharacter(response, cp) == ' ' ||
               StringGetCharacter(response, cp) == '\t')) cp++;
         string cnum = "";
         while(cp < StringLen(response)) {
            ushort cc = StringGetCharacter(response, cp);
            if(cc >= '0' && cc <= '9') { cnum += ShortToString(cc); cp++; }
            else break;
         }
         if(StringLen(cnum) > 0) { lastAIConfidence = (int)StringToInteger(cnum); v.confidence = lastAIConfidence; }
      }
   }
   if(StringFind(response, "\"CLOSE\"") >= 0) { v.action = -1; return v; }
   if(StringFind(response, "\"LOCK\"")  >= 0)
   {
      v.action = 1;
      // Parse lock_usd value — it's a number, not a string
      int lp = StringFind(response, "\"lock_usd\":");
      if(lp >= 0)
      {
         lp += StringLen("\"lock_usd\":");
         while(lp < StringLen(response) && (StringGetCharacter(response, lp) == ' ')) lp++;
         string num = "";
         while(lp < StringLen(response))
         {
            ushort c = StringGetCharacter(response, lp);
            if((c >= '0' && c <= '9') || c == '.' || c == '-') { num += ShortToString(c); lp++; }
            else break;
         }
         v.lockUSD = StringToDouble(num);
      }
      if(v.lockUSD <= 0) v.action = 0;  // degrade to HOLD if no valid lock
      return v;
   }
   return v;
}

bool IsNewsSafe()
{
   if(InpBacktestMode) return true;                  // Tester: assume safe
   if(!InpUseNewsFilter || StringLen(InpServerURL) < 10) return true;
   string url = InpServerURL + "/api/news/check";
   char pd[], result[]; string rh;
   int res = WebRequest("GET", url, "", 5000, pd, result, rh);
   if(res != 200) return true;
   string response = CharArrayToString(result);
   if(StringFind(response, "\"safe_to_trade\":false") >= 0 || StringFind(response, "\"safe_to_trade\": false") >= 0)
   { Print("NEWS BLOCK: ", response); return false; }
   return true;
}

//+------------------------------------------------------------------+
//| ML FUNCTIONS                                                     |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| LOCAL ML — hierarchical signature matching (mirrors hive logic)  |
//| Input: current signature string + direction                      |
//| Returns WR (0..1) at the MOST SPECIFIC level with >= 5 matches.  |
//| Rollup levels: exact -> drop_mom -> drop_stoch -> drop_rsi ->    |
//|                drop_session -> regime+setup+dir                  |
//+------------------------------------------------------------------+
double GetMLScoreWithSamples(int dir, string signature, int &matchedSamples)
{
   matchedSamples = 0;
   if(patternCount < 5 || StringLen(signature) == 0) return 0.5;

   // Build rollup prefixes (same hierarchy as backend hive)
   string parts[];
   int nParts = StringSplit(signature, '|', parts);
   if(nParts != 7) return 0.5;

   string rollups[5];
   rollups[0] = signature;                                               // exact
   rollups[1] = parts[0]+"|"+parts[1]+"|"+parts[2]+"|"+parts[3]+"|"+parts[4]+"|"+parts[5];  // drop_mom
   rollups[2] = parts[0]+"|"+parts[1]+"|"+parts[2]+"|"+parts[3]+"|"+parts[4];               // drop_stoch
   rollups[3] = parts[0]+"|"+parts[1]+"|"+parts[2]+"|"+parts[3];                             // drop_rsi
   rollups[4] = parts[0]+"|"+parts[1]+"|"+parts[2];                                          // drop_session

   for(int lvl = 0; lvl < 5; lvl++)
   {
      string target = rollups[lvl];
      int tLen = StringLen(target);
      int matches = 0, loc_wins = 0;
      for(int i = 0; i < patternCount; i++)
      {
         if(patterns[i].direction != dir) continue;
         string ps = patterns[i].signature;
         if(StringLen(ps) == 0) continue;
         bool match;
         if(lvl == 0) match = (ps == target);
         else
         {
            // Prefix match + pipe anchor
            if(StringLen(ps) <= tLen) continue;
            if(StringSubstr(ps, 0, tLen) != target) continue;
            if(StringGetCharacter(ps, tLen) != '|') continue;
            match = true;
         }
         if(!match) continue;
         matches++;
         if(patterns[i].wasWinner) loc_wins++;
      }
      if(matches >= 5)
      {
         matchedSamples = matches;
         return (double)loc_wins / matches;
      }
   }
   return 0.5;
}

double GetMLScore(int dir, string signature)
{
   int matchedSamples = 0;
   return GetMLScoreWithSamples(dir, signature, matchedSamples);
}

void RecordPattern(bool wasWin, double profit)
{
   if(!InpLearnPatterns) return;
   MqlDateTime dt; TimeCurrent(dt);
   TradePattern p;
   p.direction = lastSignalDir; p.emaDiff = lastSignalEMADiff;
   p.rsi = lastSignalRSI; p.atr = lastSignalATR;
   p.hour = dt.hour; p.dayOfWeek = dt.day_of_week;
   p.regime = lastRegime; p.setupType = lastSetupType;
   p.wasWinner = wasWin; p.profit = profit;
   p.signature = lastSignalSignature;      // 7-field signature for local ML matching
   if(patternCount >= InpMaxPatterns)
   { for(int i = 0; i < patternCount - 1; i++) patterns[i] = patterns[i+1]; patternCount--; }
   ArrayResize(patterns, patternCount + 1);
   patterns[patternCount] = p; patternCount++;
   Print("ML: #", patternCount, " ", wasWin ? "WIN" : "LOSS", " $", DoubleToString(profit, 2), " sig=", p.signature);
   if(patternCount % 5 == 0) SavePatterns();
}

//+------------------------------------------------------------------+
//| SAVE/LOAD PATTERNS (Cloud + Local)                               |
//+------------------------------------------------------------------+
void SavePatterns()
{
   if(patternCount == 0) return;
   // Local backup — v2 format adds signature string + magic header
   string fn = "AIS_Patterns_" + Symbol() + ".bin";
   int h = FileOpen(fn, FILE_WRITE | FILE_BIN);
   if(h != INVALID_HANDLE)
   {
      FileWriteInteger(h, 0xA15E2);              // magic "AI SIG v2"
      FileWriteInteger(h, patternCount);
      for(int i = 0; i < patternCount; i++)
      {
         FileWriteInteger(h, patterns[i].direction); FileWriteDouble(h, patterns[i].emaDiff);
         FileWriteDouble(h, patterns[i].rsi); FileWriteDouble(h, patterns[i].atr);
         FileWriteInteger(h, patterns[i].hour); FileWriteInteger(h, patterns[i].dayOfWeek);
         FileWriteInteger(h, patterns[i].regime); FileWriteInteger(h, patterns[i].setupType);
         FileWriteInteger(h, patterns[i].wasWinner ? 1 : 0); FileWriteDouble(h, patterns[i].profit);
         FileWriteString(h, patterns[i].signature);
      }
      FileClose(h);
   }
   // Cloud save (skip in backtest)
   if(!InpBacktestMode && StringLen(InpServerURL) >= 10)
   {
      string url = InpServerURL + "/api/ml/patterns/save";
      string headers = "Content-Type: application/json\r\n";
      string jp = "[";
      for(int i = 0; i < patternCount; i++)
      {
         if(i > 0) jp += ",";
         jp += StringFormat("{\"d\":%d,\"ed\":%.4f,\"r\":%.1f,\"a\":%.2f,\"h\":%d,\"dw\":%d,\"rg\":%d,\"st\":%d,\"w\":%d,\"p\":%.2f,\"sig\":\"%s\"}",
            patterns[i].direction, patterns[i].emaDiff, patterns[i].rsi, patterns[i].atr,
            patterns[i].hour, patterns[i].dayOfWeek, patterns[i].regime, patterns[i].setupType,
            patterns[i].wasWinner ? 1 : 0, patterns[i].profit, patterns[i].signature);
      }
      jp += "]";
      string body = StringFormat("{\"pin\":\"%s\",\"symbol\":\"%s\",\"patterns\":%s}", InpLicensePIN, Symbol(), jp);
      char pd[], res[]; string rh;
      StringToCharArray(body, pd, 0, StringLen(body));
      WebRequest("POST", url, headers, 10000, pd, res, rh);
   }
}

void LoadPatterns()
{
   // FRESH START option — skip loading legacy patterns from old EA versions
   if(InpResetML)
   {
      string fn = "AIS_Patterns_" + Symbol() + ".bin";
      if(FileIsExist(fn)) FileDelete(fn);
      patternCount = 0;
      ArrayResize(patterns, 0);
      Print("═══════════════════════════════════════════════════════");
      Print("ML RESET: Local patterns wiped per InpResetML=true.");
      Print("  Fresh learning starts now. Cloud patterns untouched.");
      Print("  Adaptive grade threshold resets to default.");
      Print("═══════════════════════════════════════════════════════");
      return;
   }

   // Try cloud first (skip in backtest)
   if(!InpBacktestMode && StringLen(InpServerURL) >= 10)
   {
      string url = InpServerURL + "/api/ml/patterns/load";
      string headers = "Content-Type: application/json\r\n";
      string body = StringFormat("{\"pin\":\"%s\",\"symbol\":\"%s\"}", InpLicensePIN, Symbol());
      char pd[], result[]; string rh;
      StringToCharArray(body, pd, 0, StringLen(body));
      int res = WebRequest("POST", url, headers, 15000, pd, result, rh);
      if(res == 200)
      {
         string response = CharArrayToString(result);
         // v6.3.5 FIX: actually parse patterns[] from cloud JSON, not just log count
         int arrStart = StringFind(response, "\"patterns\":[");
         if(arrStart >= 0)
         {
            arrStart += 12; // skip past "patterns":[
            int cloudCount = 0;
            int pos = arrStart;
            while(pos < StringLen(response) && cloudCount < InpMaxPatterns)
            {
               int objStart = StringFind(response, "{", pos);
               if(objStart < 0) break;
               int objEnd = StringFind(response, "}", objStart);
               if(objEnd < 0) break;
               string obj = StringSubstr(response, objStart, objEnd - objStart + 1);
               TradePattern p;
               p.direction  = ExtractJsonInt(obj, "d", 0);
               p.emaDiff    = ExtractJsonDouble(obj, "ed", 0);
               p.rsi        = ExtractJsonDouble(obj, "r", 50);
               p.atr        = ExtractJsonDouble(obj, "a", 0);
               p.hour       = ExtractJsonInt(obj, "h", 0);
               p.dayOfWeek  = ExtractJsonInt(obj, "dw", 0);
               p.regime     = ExtractJsonInt(obj, "rg", 0);
               p.setupType  = ExtractJsonInt(obj, "st", 0);
               p.wasWinner  = ExtractJsonInt(obj, "w", 0) == 1;
               p.profit     = ExtractJsonDouble(obj, "p", 0);
               p.signature  = ExtractJsonString(obj, "sig");
               if(p.direction != 0 && StringLen(p.signature) > 0)
               {
                  ArrayResize(patterns, cloudCount + 1);
                  patterns[cloudCount] = p;
                  cloudCount++;
               }
               pos = objEnd + 1;
            }
            if(cloudCount > 0)
            {
               patternCount = cloudCount;
               Print("ML CLOUD: Warm-start — loaded ", patternCount, " patterns, ML authority immediate");
               SavePatterns(); // write local .bin so future restarts use fast local path
               return;        // skip local file read — cloud data is authoritative
            }
         }
         // No patterns array or empty — just log the server count
         int countIdx = StringFind(response, "\"count\":");
         if(countIdx >= 0)
         {
            string cs = StringSubstr(response, countIdx + 8, 10);
            int ci = StringFind(cs, ","); if(ci < 0) ci = StringFind(cs, "}");
            if(ci > 0) { cs = StringSubstr(cs, 0, ci); Print("ML CLOUD: server reports ", cs, " patterns (none parsed — fresh start)"); }
         }
      }
   }
   // Local fallback (v2 format: magic + count + [...fields, signature])
   string fn = "AIS_Patterns_" + Symbol() + ".bin";
   if(!FileIsExist(fn)) { Print("ML: Fresh start"); return; }
   int h = FileOpen(fn, FILE_READ | FILE_BIN);
   if(h == INVALID_HANDLE) return;
   int magic = FileReadInteger(h);
   if(magic != 0xA15E2)
   {
      // Old format — discard and start fresh with signature-aware store
      FileClose(h);
      Print("ML LOCAL: old pattern file detected (no signatures) — starting fresh for v4.2");
      patternCount = 0;
      ArrayResize(patterns, 0);
      return;
   }
   patternCount = FileReadInteger(h);
   ArrayResize(patterns, patternCount);
   for(int i = 0; i < patternCount; i++)
   {
      patterns[i].direction = FileReadInteger(h); patterns[i].emaDiff = FileReadDouble(h);
      patterns[i].rsi = FileReadDouble(h); patterns[i].atr = FileReadDouble(h);
      patterns[i].hour = FileReadInteger(h); patterns[i].dayOfWeek = FileReadInteger(h);
      patterns[i].regime = FileReadInteger(h); patterns[i].setupType = FileReadInteger(h);
      patterns[i].wasWinner = FileReadInteger(h) == 1; patterns[i].profit = FileReadDouble(h);
      patterns[i].signature = FileReadString(h);
   }
   FileClose(h);
   Print("ML LOCAL: Loaded ", patternCount, " patterns (v2 with signatures)");
}

//+------------------------------------------------------------------+
//| TRADE RESULT TRACKING                                            |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans, const MqlTradeRequest& request, const MqlTradeResult& result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   ulong dealTicket = trans.deal;
   if(dealTicket == 0) return;
   if(!HistoryDealSelect(dealTicket)) return;

   long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
   if(magic != InpMagicNumber) return;

   ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);

   // v6.0.2: capture committee data per-position at the moment a trade opens.
   // Fixes basket race condition: g_lastTradePattern was shared across all positions,
   // so a pyramid add would overwrite it before the original position closed and recorded.
   if(entry == DEAL_ENTRY_IN)
   {
      ulong openPosId = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      if(openPosId > 0 && StringLen(g_lastTradePattern) > 0)
      {
         for(int s = 0; s < 10; s++)
         {
            if(!g_posCommData[s].valid || g_posCommData[s].posId == openPosId)
            {
               g_posCommData[s].posId    = openPosId;
               g_posCommData[s].pattern  = g_lastTradePattern;
               g_posCommData[s].dirLabel = g_lastTradeDirLabel;
               g_posCommData[s].conf     = g_lastTradeCommConf;
               g_posCommData[s].valid    = true;
               break;
            }
         }
      }
      return;
   }
   if(entry != DEAL_ENTRY_OUT) return;

   // v4.5.9 — Detect PARTIAL close vs FULL close.
   // A partial close still leaves the position open with the same posId.
   // If we treat partials as full closes, we double-count wins/losses, corrupt
   // streak/drawdown tracking, and PartialAlreadyTaken gets cleared → repeat fires.
   ulong posId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
   bool stillOpen = false;
   if(posId > 0)
   {
      for(int i = 0; i < PositionsTotal(); i++)
      {
         ulong tk = PositionGetTicket(i);
         if(tk == 0 || !PositionSelectByTicket(tk)) continue;
         if((ulong)PositionGetInteger(POSITION_IDENTIFIER) == posId)
         {
            stillOpen = true;
            break;
         }
      }
   }
   if(stillOpen)
   {
      // Partial close — log and skip all counters/cleanup.
      double partProfit = HistoryDealGetDouble(dealTicket, DEAL_PROFIT)
                        + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
                        + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      Print("PARTIAL CLOSE event #", posId, " profit $", DoubleToString(partProfit, 2),
            " — position still open, NOT counted as full trade.");
      if(CloudEnabled())
      {
         double closeVol = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
         double remainVol = 0.0;
         for(int i = 0; i < PositionsTotal(); i++)
         {
            ulong tk = PositionGetTicket(i);
            if(tk == 0 || !PositionSelectByTicket(tk)) continue;
            if((ulong)PositionGetInteger(POSITION_IDENTIFIER) == posId)
            {
               remainVol = PositionGetDouble(POSITION_VOLUME);
               break;
            }
         }
         double pct = (closeVol > 0 && (closeVol + remainVol) > 0)
                      ? (100.0 * closeVol / (closeVol + remainVol))
                      : 0.0;
         string sigId = CloudMapGet(posId);
         if(StringLen(sigId) > 0 && pct > 0)
            CloudPostSignalPartial(sigId, HistoryDealGetDouble(dealTicket, DEAL_PRICE),
                                   pct, "master partial close");
         else
            Print("☁  CLOUD partial skipped: no signal map or invalid percent for posId=", posId);
      }
      return;
   }

   double dProfit     = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
   double dSwap       = HistoryDealGetDouble(dealTicket, DEAL_SWAP);
   double dCommission = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
   double profit      = dProfit + dSwap + dCommission;
   double dPrice      = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
   double dVolume     = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
   ENUM_DEAL_TYPE dType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
   // On exit, the closing deal is opposite side of the position
   string dirStr = (dType == DEAL_TYPE_SELL) ? "BUY" : "SELL";

   totalTrades++;
   // Treat anything <= -$0.01 as real loss; anything >= $0.01 as win; else BE (no counter change)
   bool wasLoss = (profit <= -0.01);
   bool wasWin  = (profit >=  0.01);
   if(wasWin) wins++;
   else if(wasLoss) losses++;
   // v6.3.9: forward-test report tracking — record this trade close
   FTReport_RecordTrade(lastSignalSetup, wasWin, profit);
   RegisterClosedTradeCooldown(wasWin, wasLoss, profit);
   // v6.0 STI: record profitable closes so re-entry intelligence can watch
   // for a clean pullback before allowing the same-direction trade again.
   // dType is the CLOSING deal type; the original position is the opposite side.
   if(wasWin)
   {
      int origDir = (dType == DEAL_TYPE_SELL) ? 1 : -1; // closing SELL = was a BUY
      STI_AfterProfitableClose(origDir, dPrice);
   }
   // else: break-even — don't count either way
   lastTradeClose = TimeCurrent();
   Print("CLOSED: ", wasWin ? "WIN" : wasLoss ? "LOSS" : "BREAK-EVEN",
         " $", DoubleToString(profit, 2),
         " | T:", totalTrades, " W:", wins, " L:", losses);
   bool aiInfluenced = (currentTradeConfidence > 0 || StringFind(lastExitReason, "AI") >= 0 || StringFind(lastExitReason, "CLAUDE") >= 0);
   if(aiInfluenced)
   {
      g_aiInfluencedTrades++;
      if(wasWin) g_aiInfluencedWins++;
      g_aiInfluencedPnl += profit;
   }
   else
   {
      g_nonAiTrades++;
      if(wasWin) g_nonAiWins++;
      g_nonAiPnl += profit;
   }
   RecordExitAudit(lastExitReason, wasWin, profit);
   // v6.0.2: record this closed trade into the committee's pattern memory.
   // Uses per-position data (captured at open via DEAL_ENTRY_IN) instead of the global,
   // so baskets record the correct pattern for each individual position.
   {
      string memPattern  = g_lastTradePattern;   // fallback to global if no per-pos record found
      string memDirLabel = g_lastTradeDirLabel;
      int    memConf     = g_lastTradeCommConf;
      for(int s = 0; s < 10; s++)
      {
         if(g_posCommData[s].valid && g_posCommData[s].posId == posId)
         {
            memPattern  = g_posCommData[s].pattern;
            memDirLabel = g_posCommData[s].dirLabel;
            memConf     = g_posCommData[s].conf;
            g_posCommData[s].valid = false; // free the slot
            break;
         }
      }
      if(StringLen(memPattern) > 0)
      {
         double rMult = (autoHardStopUSD > 0.01) ? profit / autoHardStopUSD
                       : (profit > 0 ? 1.0 : profit < 0 ? -1.0 : 0.0);
         // v6.3.8: pass extended fields for ATR-norm matching + AI feedback
         int    memDir      = (dType == DEAL_TYPE_SELL) ? 1 : -1; // closing SELL = was BUY
         string memSession  = SessionTag();
         double memATR      = lastSignalATR;
         int    memHTF      = g_htfConsensusDir;
         // max DD will be 0 here; XAU_PopTradeQuality runs after this block
         double memMaxDD    = 0.0;
         double memMaxFav   = (rMult > 0) ? rMult : 0.0; // close R as proxy for max fav
         TradeMemory_Record(memPattern, memDirLabel, memConf, rMult,
                            memDir, memSession, memATR, memHTF,
                            memMaxDD, memMaxFav,
                            g_lastAIVerdict_ForMemory, currentTradeConfidence);
         if(InpCommitteeLog)
            Print(StringFormat("COMMITTEE-MEMORY: stored pattern=%s dir=%s conf=%d%% rMult=%.2f P/L=$%.2f aiVerdict=%s",
                               memPattern, memDirLabel, memConf, rMult, profit, g_lastAIVerdict_ForMemory));
         // v6.3.8 Upgrade 5: send AI outcome feedback to backend
         if(!InpBacktestMode && StringLen(InpServerURL) >= 10 && StringLen(g_lastAIVerdict_ForMemory) > 0)
         {
            string outcome = "";
            if(g_lastAIVerdict_ForMemory == "ALLOW" || g_lastAIVerdict_ForMemory == "ALLOW_LOW_CONV")
               outcome = (rMult > 0) ? "CORRECT" : "WRONG";
            else if(g_lastAIVerdict_ForMemory == "REDUCE" || g_lastAIVerdict_ForMemory == "REDUCE_SIZE")
               outcome = (rMult > 0) ? "CONSERVATIVE_CORRECT" : "WRONG";
            if(StringLen(outcome) > 0)
            {
               string sessTag = SessionTag();
               string regTag  = RegimeName();
               // v6.3.9: build feedback body with all required fields
               string fbDirStr = (lastTradeDir > 0) ? "BUY" : (lastTradeDir < 0) ? "SELL" : "UNKNOWN";
               string fbReasonEsc = currentTradeThesis;
               StringReplace(fbReasonEsc, "\"", "'");
               StringReplace(fbReasonEsc, "\n", " ");
               string fbBody = StringFormat(
                  "{\"trade_id\":\"%I64u\",\"ai_verdict\":\"%s\",\"ai_confidence\":%d,"
                  "\"ai_reason\":\"%s\",\"outcome\":\"%s\",\"r_multiple\":%.2f,"
                  "\"strategy\":\"%s\",\"session\":\"%s\",\"regime\":\"%s\","
                  "\"direction\":\"%s\"}",
                  posId, g_lastAIVerdict_ForMemory, currentTradeConfidence,
                  fbReasonEsc, outcome, rMult, lastSignalSetup, sessTag, regTag,
                  fbDirStr);
               char fbData[], fbResult[]; string fbHdr;
               StringToCharArray(fbBody, fbData, 0, StringLen(fbBody));
               int fbCode = WebRequest("POST", InpServerURL + "/api/ai/feedback",
                                       "Content-Type: application/json\r\n",
                                       5000, fbData, fbResult, fbHdr);
               int fbErr = GetLastError();
               if(fbCode == -1 && fbErr == 4060)
                  Print("AI FEEDBACK ERROR: WebRequest failed code=", fbErr, " — add URL to Tools→Options→Expert Advisors");
               else if(fbCode == -1)
                  Print("AI FEEDBACK ERROR: WebRequest failed code=", fbErr, " (network error or timeout)");
               else if(fbCode < 200 || fbCode >= 300)
                  Print("AI FEEDBACK ERROR: server returned HTTP ", fbCode);
               else
                  Print("AI FEEDBACK SENT: verdict=", g_lastAIVerdict_ForMemory, " outcome=", outcome, " rMult=", DoubleToString(rMult, 2));
            }
         }
         g_lastAIVerdict_ForMemory = ""; // reset for next trade
      }
   }
   double worstFloatingPnl = 0.0;
   int secondsNegative = 0;
   XAU_PopTradeQuality(posId, worstFloatingPnl, secondsNegative);
   if(worstFloatingPnl < -1.0 || secondsNegative > 0)
   {
      double recoveryQuality = profit > 0.0 && worstFloatingPnl < 0.0 ? profit / MathAbs(worstFloatingPnl) : 0.0;
      string q = (profit > 0.0 && worstFloatingPnl <= -10000.0 && recoveryQuality < 0.60) ? "BAD-ENTRY-RECOVERY" :
                 (worstFloatingPnl <= -5000.0 ? "DEEP-DRAWDOWN" : "OK");
      Print("TRADE-QUALITY: ", q,
            " worstFloating=$", DoubleToString(worstFloatingPnl, 2),
            " secondsNegative=", secondsNegative,
            " closeProfit=$", DoubleToString(profit, 2),
            " recoveryQuality=", DoubleToString(recoveryQuality, 2),
            " note=green close after deep drawdown is still poor entry timing.");
   }
   if(InpTradeBrainMemory && IsXAUFastSymbol())
   {
      int brainIdx = XAU_FindBrainOpen(posId);
      TradeBrainOpen brainRec;
      if(brainIdx >= 0)
         brainRec = g_brainOpenTrades[brainIdx];
      else
      {
         brainRec.posId = posId;
         brainRec.entryTime = TimeCurrent();
         brainRec.dir = (dirStr == "BUY") ? 1 : -1;
         brainRec.entryPrice = dPrice;
         brainRec.sl = 0.0;
         brainRec.tp = 0.0;
         brainRec.lots = dVolume;
         brainRec.atr = lastSignalATR;
         brainRec.setupScore = 0.0;
         brainRec.combinedScore = g_lastEntryScore;
         brainRec.regime = (int)currentRegime;
         brainRec.aiConfidence = currentTradeConfidence;
         brainRec.setup = StringLen(lastSignalSetup) > 0 ? lastSignalSetup : "UNKNOWN";
         brainRec.grade = StringLen(g_lastEntryGrade) > 0 ? g_lastEntryGrade : "UNKNOWN";
         brainRec.signature = lastSignalSignature;
         brainRec.session = SessionTag();
         brainRec.entryReason = "fallback: open record not found";
      }
      string outcome = wasWin ? "WIN" : wasLoss ? "LOSS" : "BREAK_EVEN";
      if(wasWin && worstFloatingPnl <= -10000.0)
         outcome = "WIN_AFTER_DEEP_DD";
      else if(wasWin && worstFloatingPnl < 0.0 && profit > 0.0 && profit / MathAbs(worstFloatingPnl) < 0.60)
         outcome = "WEAK_RECOVERY_WIN";

      // v5.8.52: retrieve best floating profit and refine outcome classification.
      double bestFloatingPnl = 0.0;
      { int bfIdx = FindPeakIdx(posId); if(bfIdx >= 0) bestFloatingPnl = peakProfits[bfIdx]; }
      double shieldMeaningfulUSD = StrategyReferenceBalance() * 0.015;
      if(outcome == "BREAK_EVEN" && bestFloatingPnl >= shieldMeaningfulUSD)
         outcome = "APLUS_PROTECTED_BE";   // had real profit, shield moved SL to entry — correct outcome
      else if(outcome == "LOSS" && bestFloatingPnl >= shieldMeaningfulUSD)
         outcome = "APLUS_GIVEBACK_LOSS";  // had real profit, still took a loss — shield may need tuning
      string shieldExtra = StringFormat("bestFloating=%.2f shieldArmed=%s",
                                        bestFloatingPnl, APlusShieldArmed(posId) ? "Y" : "N");

      XAU_AppendTradeBrain("CLOSE", brainRec, dPrice, profit, worstFloatingPnl,
                           secondsNegative, outcome, lastExitReason + " | " + shieldExtra);
      XAU_BrainWatchClosedTrade(brainRec, dPrice, profit);
      Print("TRADE-BRAIN CLOSE: ", outcome,
            " posId=", posId,
            " setup=", brainRec.setup,
            " grade=", XAU_GradeBucket(brainRec.grade),
            " profit=$", DoubleToString(profit, 2),
            " bestFloating=$", DoubleToString(bestFloatingPnl, 2),
            " worstFloating=$", DoubleToString(worstFloatingPnl, 2),
            " shieldArmed=", APlusShieldArmed(posId)?"Y":"N",
            " exitReason=", XAU_BlockReasonKey(lastExitReason));
      if(brainIdx >= 0) XAU_RemoveBrainOpen(brainIdx);
   }

   // Populate lastClose for RE-ENTRY detector
   lastClose.valid      = true;
   lastClose.wasLoss    = wasLoss;
   lastClose.reEntered  = false;
   lastClose.dir        = (dirStr == "BUY") ? 1 : -1;
   lastClose.lots       = dVolume;
   lastClose.profit     = profit;
   lastClose.closeTime  = TimeCurrent();
   lastClose.signature  = lastSignalSignature;
   lastClose.setup      = lastSignalSetup;
   lastClose.closePrice = dPrice;
   lastClose.exitReason = lastExitReason;
   // Approximate original entry and SL distance from deal history.
   // dPrice here is the CLOSE price; for re-entry we want the ORIGINAL entry.
   // Fetch it by looking at the position's first deal (entry) with same position ID.
   lastClose.entryPrice = dPrice;   // fallback
   lastClose.slDist     = lastSignalATR > 0 ? lastSignalATR * InpSLMultiplier : 3.0;
   if(posId > 0 && HistorySelectByPosition(posId))
   {
      int nDeals = HistoryDealsTotal();
      for(int i = 0; i < nDeals; i++)
      {
         ulong t = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(t, DEAL_POSITION_ID) != (long)posId) continue;
         if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(t, DEAL_ENTRY) == DEAL_ENTRY_IN)
         {
            lastClose.entryPrice = HistoryDealGetDouble(t, DEAL_PRICE);
            break;
         }
      }
   }

   // Streak + drawdown bookkeeping
   RecordCloseForStreak(wasLoss);
   UpdateDrawdownState(wasLoss);

   // v4.5.9 — Position fully closed (verified above) — clear trackers.
   // v5.8.52: also clear A+ shield armed state.
   if(posId > 0) { ClearPeakProfit(posId); ClearPartialTaken(posId); ClearAIVeto(posId); ClearTPExtend(posId); APlusClearShield(posId); }
   // Clear active thesis (no open position now until next entry)
   if(CountMyPositions() == 0)
   {
      currentTradeThesis = "";
      currentTradeInvalidation = "";
      currentTradeTarget = "";
      currentTradeBearishCase = "";
      currentTradeConfidence = 0;
   }

   RecordPattern(wasWin, profit);
   // v5.0.0 — XAUAI CLOUD fanout: mirror this close to subscribers
   if(CloudEnabled() && posId > 0)
   {
      string sigId = CloudMapPop(posId);
      if(StringLen(sigId) > 0)
      {
         string reason = StringLen(lastExitReason) > 0 ? lastExitReason :
                         (wasWin ? "tp/profit close" : wasLoss ? "sl/loss close" : "break-even close");
         CloudPostSignalClose(sigId, dPrice, reason);
      }
   }
   LogTradeToServer(wasWin ? "WIN" : wasLoss ? "LOSS" : "BE", dPrice, profit, dVolume, dirStr);
}

//+------------------------------------------------------------------+
//| HELPERS                                                          |
//+------------------------------------------------------------------+
int CountMyPositions()
{
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Magic() == InpMagicNumber && posInfo.Symbol() == Symbol()) c++;
   return c;
}

int GetOpenExposureDirection()
{
   int buys = 0, sells = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != InpMagicNumber || posInfo.Symbol() != Symbol()) continue;
      if(posInfo.PositionType() == POSITION_TYPE_BUY) buys++;
      else sells++;
   }
   if(buys > 0 && sells > 0) return 2;   // mixed hedge already exists
   if(buys > 0) return 1;
   if(sells > 0) return -1;
   return 0;
}

void CloseAll()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Magic() == InpMagicNumber && posInfo.Symbol() == Symbol())
      { trade.PositionClose(posInfo.Ticket()); Print("FORCE CLOSE: #", posInfo.Ticket()); }
}

double BasketFloatingPnL()
{
   double total = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != InpMagicNumber || posInfo.Symbol() != Symbol()) continue;
      total += posInfo.Profit() + posInfo.Swap() + posInfo.Commission();
   }
   return total;
}

bool ExpectancyDayGivebackGuard()
{
   if(!InpExpectancyLossArmor || !InpExpectancyUseDayGiveback || dailyStartEquity <= 0)
      return false;

   double equity = accInfo.Equity();
   if(equity > pg_dayHWM) pg_dayHWM = equity;

   double dayPeakGain = pg_dayHWM - dailyStartEquity;
   double armGainUSD  = MathMax(InpExpectancyDayGiveFloorUSD,
                                dailyStartEquity * InpExpectancyDayArmPct / 100.0);
   if(dayPeakGain < armGainUSD)
      return false;

   double givebackUSD = pg_dayHWM - equity;
   double maxGiveback = MathMax(InpExpectancyDayGiveFloorUSD,
                                dayPeakGain * InpExpectancyDayMaxGivePct / 100.0);
   if(givebackUSD < maxGiveback)
      return false;

   if(CountMyPositions() <= 0)
      return false;

   double openPnL = BasketFloatingPnL();
   if(openPnL <= 0)
   {
      PrintFormat("EXPECTANCY_DAY_GUARD_BREATHE: HWM giveback hit ($%.2f of $%.2f), but open basket is $%.2f. No forced red close; SL/structure manages XAU pullback.",
                  givebackUSD, dayPeakGain, openPnL);
      return false;
   }

   PrintFormat("EXPECTANCY_DAY_GUARD: equity HWM $%.2f start $%.2f current $%.2f | peakGain $%.2f giveback $%.2f >= cap $%.2f (%.1f%%) -> BANK PROFIT ONLY",
               pg_dayHWM, dailyStartEquity, equity, dayPeakGain, givebackUSD,
               maxGiveback, InpExpectancyDayMaxGivePct);
   lastExitReason = StringFormat("EXPECTANCY DAY GUARD | gave back $%.2f of $%.2f peak gain",
                                 givebackUSD, dayPeakGain);
   CloseAll();
   lastTradeClose = TimeCurrent();
   return true;
}

//+------------------------------------------------------------------+
//| v5.1.0 — PROFIT GUARDIAN                                          |
//| 1. Tracks daily HWM and tightens risk in 3 tiers as gain grows.   |
//| 2. Hard halt if equity gives back >25% of HWM-gain (stops bleed). |
//| 3. HTF trend lock blocks counter-trend SELLs in H4 uptrends, etc. |
//| 4. 30-min pause after any basket loss >5% (anti-revenge guard).   |
//+------------------------------------------------------------------+

// Returns 0/1/2/3. Higher tier = more protective.
int PG_Tier()
{
   if(!InpProfitGuardian || dailyStartEquity <= 0) return 0;
   double equity = accInfo.Equity();
   double gainPct = (equity - dailyStartEquity) / dailyStartEquity * 100.0;
   if(gainPct >= InpPG_Tier3Pct) return 3;
   if(gainPct >= InpPG_Tier2Pct) return 2;
   if(gainPct >= InpPG_Tier1Pct) return 1;
   return 0;
}

// Risk size multiplier based on guardian tier (composes with existing logic).
// v5.1.3: returns 1.0 when InpProfitGuardian=false → no automatic risk reduction.
double PG_RiskMultiplier()
{
   if(!InpProfitGuardian) return 1.0;
   int tier = PG_Tier();
   if(tier == 1) return 0.50;   // halve risk when up 30%+
   if(tier == 2) return 0.25;   // quarter risk when up 50%+
   if(tier == 3) return 0.0;    // no new lots when up 75%+ (just trail)
   return 1.0;
}

// Daily HWM tracking + giveback halt (called every tick).
// v5.1.2: giveback% now tightens automatically as the day's gain grows, so a
// +70% day can only give back ~7% before halt (instead of 25%).
double PG_HWMGivebackPctEffective(double gainPct)
{
   if(!InpPG_EscalatingGiveback) return InpPG_HWMGivebackPct;
   if(gainPct >= InpPG_Tier3Pct) return InpPG_GivebackAt75Pct;  // ≥75% gain → 10% giveback
   if(gainPct >= InpPG_Tier2Pct) return InpPG_GivebackAt50Pct;  // ≥50% gain → 15% giveback
   if(gainPct >= InpPG_Tier1Pct) return InpPG_GivebackAt30Pct;  // ≥30% gain → 20% giveback
   return InpPG_HWMGivebackPct;                                  // <30% gain → 25% giveback (base)
}

void PG_UpdateHWM()
{
   // v5.1.3: runs whenever InpProfitLock OR InpProfitGuardian is on
   if((!InpProfitLock && !InpProfitGuardian) || dailyStartEquity <= 0) return;
   double equity = accInfo.Equity();
   if(equity > pg_dayHWM) pg_dayHWM = equity;

   // reset day-halt at session boundary
   MqlDateTime dt; TimeCurrent(dt);
   datetime today = StringToTime(StringFormat("%04d.%02d.%02d", dt.year, dt.mon, dt.day));
   if(pg_dayHaltDay != today) { pg_dayHaltActive = false; }

   // hard giveback brake: if profit shrinks below (HWM gain × giveback%) of starting equity
   double hwmGain   = pg_dayHWM - dailyStartEquity;
   double dayGainPct = (equity - dailyStartEquity) / dailyStartEquity * 100.0;
   double hwmGainPct = hwmGain / dailyStartEquity * 100.0;
   double effectiveGivebackPct = PG_HWMGivebackPctEffective(dayGainPct);
   // v5.1.4: don't arm the brake on noise — require meaningful HWM gain first.
   if(hwmGainPct < InpPG_GivebackMinGainPct) return;
   // v5.1.9: extra gate — Profit Guardian only triggers after the day has
   // genuinely run (≥ InpPG_SelectiveMinDayGain%). Below that, no PG block at all.
   bool bigDayRun = (hwmGainPct >= InpPG_SelectiveMinDayGain);
   if(hwmGain > 0)
   {
      double maxAllowedGiveback = hwmGain * (effectiveGivebackPct / 100.0);
      double currentDrawback    = pg_dayHWM - equity;
      if(currentDrawback >= maxAllowedGiveback)
      {
         // v5.1.9: only flip into protection if the day has had a real run.
         if(!bigDayRun) return;
         if(InpPG_SelectiveMode)
         {
            // Selective Mode: don't halt — restrict to A/A+ only.
            if(!pg_selectiveActive)
            {
               pg_selectiveActive      = true;
               pg_selectiveActivatedAt = TimeCurrent();
               pg_selectiveTriggerEq   = equity;
               pg_selectiveLowEq       = equity;
               pg_selectiveLowAt       = TimeCurrent();
               pg_selectiveSkippedCnt  = 0;
               Print("🛡 PG SELECTIVE MODE ACTIVATED — high-confidence trades only. ",
                     "HWM gain $", DoubleToString(hwmGain,2),
                     " | giveback $", DoubleToString(currentDrawback,2),
                     " (>=", DoubleToString(effectiveGivebackPct,1), "% of gain @ dayGain=",
                     DoubleToString(dayGainPct,1), "%). ",
                     "Min combined score=", DoubleToString(InpPG_SelectiveMinScore,1),
                     " | lot×=", DoubleToString(InpPG_SelectiveLotMulti,2),
                     " | confirm=", InpPG_SelectiveRequireHTF ? "adaptive XAU fast" : "off");
            }
         }
         else if(pg_pauseUntil <= TimeCurrent())
         {
            // v5.8.50: the old full-day halt missed later high-quality sessions.
            // Keep monitoring and managing positions, then resume fresh entries.
            pg_dayHaltActive = false;
            pg_pauseUntil = TimeCurrent() + MathMax(1, InpProfitLockCooldownMin) * 60;
            Print("🛡 PROFIT-LOCK COOLDOWN: HWM gain $",
                  DoubleToString(hwmGain,2), " | giveback $",
                  DoubleToString(currentDrawback,2), " (>=",
                  DoubleToString(effectiveGivebackPct,1), "% of gain @ dayGain=",
                  DoubleToString(dayGainPct,1), "%). Fresh entries paused for ",
                  InpProfitLockCooldownMin, " minutes; market monitoring and open-trade management continue.");
         }
      }
   }

   // v5.1.9: maintain selective-mode low-equity tracker (for optional auto-recovery)
   if(pg_selectiveActive)
   {
      if(equity < pg_selectiveLowEq)
      {
         pg_selectiveLowEq = equity;
         pg_selectiveLowAt = TimeCurrent();   // reset stability timer on new low
      }
      // Auto-recover: if no further drawdown for InpPG_SelectiveRecoverMin minutes
      // AND equity is back above trigger equity, drop selective mode.
      if(InpPG_SelectiveRecoverMin > 0 && pg_selectiveLowAt > 0)
      {
         int stableMin = (int)((TimeCurrent() - pg_selectiveLowAt) / 60);
         if(stableMin >= InpPG_SelectiveRecoverMin && equity >= pg_selectiveTriggerEq)
         {
            Print("🛡 PG SELECTIVE MODE → NORMAL — equity stabilized for ",
                  stableMin, "min, no further drawdown. Skipped ",
                  pg_selectiveSkippedCnt, " sub-A trades while restricted.");
            pg_selectiveActive = false;
         }
      }
   }
}

// HTF trend strength check. Returns +1 strong up, -1 strong down, 0 neutral.
// v5.1.2: if last InpPG_ConsolidationLookback bars are RANGING (true range / ATR
// < InpPG_ConsolidationATR), return 0 → trend lock disabled, scalping allowed.
int PG_HTFTrend()
{
   if(!InpPG_HTFTrendLock) return 0;
   // Cached based on TF: M30=60s, H4=300s, etc.
   static datetime lastCheck = 0; static int lastTrend = 0;
   int cacheSec = (InpPG_HTFTrendTF >= PERIOD_H1) ? 300 : 60;
   if(TimeCurrent() - lastCheck < cacheSec) return lastTrend;
   lastCheck = TimeCurrent();
   double ema[3], close[3], atr[3];
   int hEMA = iMA(Symbol(), InpPG_HTFTrendTF, 50, 0, MODE_EMA, PRICE_CLOSE);
   int loc_hATR = iATR(Symbol(), InpPG_HTFTrendTF, 14);
   if(hEMA == INVALID_HANDLE || loc_hATR == INVALID_HANDLE)
   {
      if(hEMA != INVALID_HANDLE) IndicatorRelease(hEMA);
      if(loc_hATR != INVALID_HANDLE) IndicatorRelease(loc_hATR);
      return lastTrend;
   }
   bool dataOk = (CopyBuffer(hEMA, 0, 0, 3, ema)           > 0 &&
                  CopyBuffer(loc_hATR, 0, 0, 3, atr)       > 0 &&
                  CopyClose(Symbol(), InpPG_HTFTrendTF, 0, 3, close) > 0);
   IndicatorRelease(hEMA);
   IndicatorRelease(loc_hATR);
   if(!dataOk) return lastTrend;
   double price = close[0];
   double diff  = price - ema[0];
   double thr   = atr[0] * InpPG_HTFTrendATR;

   // v5.1.2 — consolidation carve-out: in a ranging market the trend lock is
   // useless (and blocks all the easy mean-reversion scalps). If the last 10
   // M30 bars' aggregate range is small relative to ATR, treat as neutral.
   if(InpPG_ConsolidationCarveout)
   {
      double highs[10], lows[10];
      if(CopyHigh(Symbol(), InpPG_HTFTrendTF, 0, 10, highs) == 10 &&
         CopyLow(Symbol(),  InpPG_HTFTrendTF, 0, 10, lows)  == 10 && atr[0] > 0)
      {
         double hi = highs[0], lo = lows[0];
         for(int i=1; i<10; i++) { if(highs[i] > hi) hi = highs[i]; if(lows[i] < lo) lo = lows[i]; }
         double rangeAtr = (hi - lo) / atr[0];
         if(rangeAtr < InpPG_ConsolidationATR) { lastTrend = 0; return 0; }  // chop → no lock
      }
   }

   if(diff >  thr) lastTrend = +1;
   else if(diff < -thr) lastTrend = -1;
   else lastTrend = 0;
   return lastTrend;
}

// v5.2.1 — Startup cooldown gate. Returns "" if OK to trade, otherwise a reason.
// Two stacked conditions:
//   (a) at least InpStartupCooldownMin minutes have elapsed since OnInit
//   (b) at least one fresh M5 bar has CLOSED since OnInit (so no carry-over
//       signal from before the restart can fire on the same candle)
// Once both pass, sets a sticky flag so we don't re-log every tick.
string StartupCooldownReason()
{
   if(g_remoteStopTrading) return "remote command stop trading active";
   if(g_remotePauseNewTrades) return "remote command pause new trades active";
   if(g_startupCooldownDone) return "";
   if(InpStartupIntelSync)
   {
      if(!g_startupIntelSyncDone)
         return "startup intelligence sync (recovering memory/context)";
      if(!g_startupIntelSyncOk)
         return "startup intelligence sync failed: " + g_startupIntelSyncReason;
   }
   datetime now = TimeCurrent();
   int waitedMin = (int)((now - g_startupAt) / 60);
   if(InpStartupCooldownMin > 0 && waitedMin < InpStartupCooldownMin)
      return StringFormat("startup cooldown (%d/%d min elapsed)",
                          waitedMin, InpStartupCooldownMin);
   if(InpStartupRequireNewBar)
   {
      datetime barOpens[1];
      if(CopyTime(Symbol(), PERIOD_M5, 0, 1, barOpens) <= 0)
         return "startup cooldown (waiting on M5 bar data)";
      // Require the current open bar to be DIFFERENT from the one at boot —
      // i.e. at least one bar boundary has crossed.
      if(barOpens[0] <= g_startupBarTime)
         return "startup cooldown (waiting for next M5 bar)";
   }
   g_startupCooldownDone = true;
   Print("🟢 Startup cooldown complete — trading enabled.");
   return "";
}

bool IsXAUFastSymbol();
bool AdaptiveXAUConfirm(int signal, string gateName, double combinedScore, string grade,
                        double &lotMulti, string &reason, bool logDecision);
bool IsXAUConfirmedBreakoutContinuation(int signal, string setupName);

// v5.8.25 — Adaptive XAU volatility gate.
// Old behavior hard-blocked at 2x ATR. On gold that often blocked the first
// clean flush/pump, then allowed a late bottom/top entry after ATR cooled.
// New behavior:
//   • normal symbols keep the old hard 2x gate
//   • XAU/GOLD hard-blocks only extreme chaos
//   • moderate ATR expansion soft-passes if fast confirmation/breakout agrees
string VolatilityKillReason(int signal, string setupName)
{
   if(!InpVolKillEnabled) return "";
   int hVK = iATR(Symbol(), PERIOD_M5, 14);
   if(hVK == INVALID_HANDLE) return "";
   double atrBuf[51];
   if(CopyBuffer(hVK, 0, 0, 51, atrBuf) < 51)
   {
      IndicatorRelease(hVK);
      return "";
   }
   IndicatorRelease(hVK);
   // Median over the last 50 closed bars (skip current forming bar at index 0).
   double sample[50];
   for(int i = 0; i < 50; i++) sample[i] = atrBuf[i + 1];
   ArraySort(sample);
   double median = sample[25];
   double cur = atrBuf[1];                  // last fully-closed bar
   if(median <= 0 || cur <= 0) return "";
   double ratio = cur / median;
   if(ratio < InpVolKillMultiplier) return "";

   bool xauFast = (InpVolKillXAUAdaptiveBypass && IsXAUFastSymbol() && signal != 0);
   double hardMult = MathMax(InpVolKillHardMultiplier, InpVolKillMultiplier);
   if(!xauFast)
      return StringFormat("ATR turbulent (%.2f / median %.2f = %.2fx ≥ %.2fx)",
                          cur, median, ratio, InpVolKillMultiplier);

   if(ratio >= hardMult)
      return StringFormat("ATR extreme chaos (%.2f / median %.2f = %.2fx ≥ hard %.2fx)",
                          cur, median, ratio, hardMult);

   double lm = 1.0;
   string why = "";
   bool fastConfirm = AdaptiveXAUConfirm(signal, "VOLKILL", 0.0, "", lm, why, false);
   bool breakoutOK = IsXAUConfirmedBreakoutContinuation(signal, setupName);
   if(fastConfirm || breakoutOK)
   {
      if(TimeCurrent() - g_lastVolKillSoftPassLog >= 45)
      {
         Print("VOLKILL SOFT-PASS: moderate XAU ATR expansion ",
               DoubleToString(cur, 2), " / median ", DoubleToString(median, 2),
               " = ", DoubleToString(ratio, 2), "x. Allowed because fastConfirm=",
               fastConfirm ? "Y" : "N", " breakout=", breakoutOK ? "Y" : "N",
               ". Entry timing guard still protects against selling bottoms/buying tops. ",
               why);
         g_lastVolKillSoftPassLog = TimeCurrent();
      }
      return "";
   }

   return StringFormat("ATR turbulent without fast XAU confirmation (%.2f / median %.2f = %.2fx ≥ %.2fx; hard %.2fx)",
                       cur, median, ratio, InpVolKillMultiplier, hardMult);
}

// v5.3.0 — Phase 1: Spread spike protection.
// Compares current spread to the median spread sampled over the last 60 ticks
// (we just store the most recent reading on each call — cheap rolling sample).
double  g_spreadSamples[60];
int     g_spreadIdx = 0;
int     g_spreadCount = 0;
string SpreadKillReason()
{
   if(!InpSpreadKillEnabled) return "";
   double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   double point = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   if(bid <= 0 || ask <= 0 || point <= 0) return "";
   double sp = (ask - bid) / point;          // spread in points
   g_spreadSamples[g_spreadIdx] = sp;
   g_spreadIdx = (g_spreadIdx + 1) % 60;
   if(g_spreadCount < 60) g_spreadCount++;
   if(g_spreadCount < 20) return "";          // not enough data yet
   double sample[60];
   int copied = ArrayCopy(sample, g_spreadSamples, 0, 0, g_spreadCount);
   if(copied <= 0) return "";
   ArraySort(sample);
   double median = sample[g_spreadCount / 2];
   if(median <= 0) return "";
   double ratio = sp / median;
   if(ratio >= InpSpreadKillMultiplier)
   {
      // v5.8.51: on live accounts spread spikes often recur in quick bursts
      // (news releases, session opens, liquidity gaps). Arm a 90-second
      // recovery window so a brief dip below the threshold does not
      // immediately allow a new entry into still-unstable conditions.
      g_spreadSpikeUntil = TimeCurrent() + 90;
      return StringFormat("spread spike %.0f pt / median %.0f pt = %.2fx ≥ %.2fx",
                          sp, median, ratio, InpSpreadKillMultiplier);
   }
   // v5.8.51: spread is currently normal but we may be in a post-spike window
   if(g_spreadSpikeUntil > 0 && TimeCurrent() < g_spreadSpikeUntil)
      return StringFormat("spread recovery (90s cooldown after spike — %ds remaining)",
                          (int)(g_spreadSpikeUntil - TimeCurrent()));
   return "";
}

// v5.3.0/v5.3.1 — Daily DD guards.
// SOFT mode (default -2.5%): A/A+ only + 0.7× lots + tighter ML — keeps trading.
// HARD halt (default -6%): true emergency, blocks new entries.
// Replaces the old hard -3% blanket which was killing recovery cycles.
bool IsSoftDDMode()
{
   if(InpSoftDDPct <= 0 || dailyStartEquity <= 0) return false;
   double pnlPct = (accInfo.Equity() - dailyStartEquity) / dailyStartEquity * 100.0;
   return (pnlPct <= -InpSoftDDPct);
}
string HardDailyDDReason()
{
   if(InpHardDailyDDPct <= 0 || dailyStartEquity <= 0) return "";
   double pnlPct = (accInfo.Equity() - dailyStartEquity) / dailyStartEquity * 100.0;
   if(pnlPct <= -InpHardDailyDDPct)
      return StringFormat("hard daily DD floor (%.2f%% ≤ -%.2f%% — extreme DD lockout)",
                          pnlPct, InpHardDailyDDPct);
   return "";
}

// v5.3.0 — Phase 2: RSI divergence (entry exhaustion gate).
// For BUY: bearish-divergence = price made new HH but RSI made LOWER HH.
// For SELL: bullish-divergence = price made new LL but RSI made HIGHER LL.
bool HasExhaustionDivergence(int signal)
{
   if(!InpRSIDivergenceFilter) return false;
   int hRSI_div = iRSI(Symbol(), PERIOD_M5, 14, PRICE_CLOSE);
   if(hRSI_div == INVALID_HANDLE) return false;
   double rsi[20], hi[20], lo[20];
   if(CopyBuffer(hRSI_div, 0, 1, 20, rsi) < 20) { IndicatorRelease(hRSI_div); return false; }
   if(CopyHigh(Symbol(), PERIOD_M5, 1, 20, hi) < 20) { IndicatorRelease(hRSI_div); return false; }
   if(CopyLow (Symbol(), PERIOD_M5, 1, 20, lo) < 20) { IndicatorRelease(hRSI_div); return false; }
   // Find two most recent local maxima/minima (simple 3-bar pivots).
   int p1 = -1, p2 = -1;
   for(int i = 2; i < 17; i++)
   {
      if(signal == +1) {  // looking at price highs
         if(hi[i] > hi[i-1] && hi[i] > hi[i+1]) {
            if(p1 < 0) p1 = i; else if(p2 < 0) { p2 = i; break; }
         }
      } else {            // looking at price lows
         if(lo[i] < lo[i-1] && lo[i] < lo[i+1]) {
            if(p1 < 0) p1 = i; else if(p2 < 0) { p2 = i; break; }
         }
      }
   }
   if(p1 < 0 || p2 < 0) { IndicatorRelease(hRSI_div); return false; }
   bool diverged = false;
   if(signal == +1) {
      // p1 is the more recent high (smaller index)
      if(hi[p1] > hi[p2] && rsi[p1] < rsi[p2] && rsi[p2] >= 60.0) diverged = true;
   } else {
      if(lo[p1] < lo[p2] && rsi[p1] > rsi[p2] && rsi[p2] <= 40.0) diverged = true;
   }
   IndicatorRelease(hRSI_div);
   return diverged;
}

// v5.3.0 — Phase 2: Momentum slowdown (entry-bar weakness check).
// Block if the most recent close sits in the LOWER 30% of the last 3 candles'
// combined high-low range for buys, or upper 30% for sells.
bool IsMomentumWeak(int signal)
{
   if(!InpMomentumSlowdown) return false;
   double hi[3], lo[3], cl[3];
   if(CopyHigh(Symbol(), PERIOD_M5, 1, 3, hi) < 3) return false;
   if(CopyLow (Symbol(), PERIOD_M5, 1, 3, lo) < 3) return false;
   if(CopyClose(Symbol(), PERIOD_M5, 1, 3, cl) < 3) return false;
   double maxH = MathMax(hi[0], MathMax(hi[1], hi[2]));
   double minL = MathMin(lo[0], MathMin(lo[1], lo[2]));
   double range = maxH - minL;
   if(range <= 0) return false;
   double loc_lastClose = cl[0];
   double posPct = (loc_lastClose - minL) / range;
   if(signal == +1 && posPct < 0.30) return true;       // close in lower 30% — buyers exhausted
   if(signal == -1 && posPct > 0.70) return true;       // close in upper 30% — sellers exhausted
   return false;
}

double XAU_DirectionalExtensionATR(int signal, int bars, double atr, double &resetATR)
{
   resetATR = 999.0;
   if(signal == 0 || atr <= 0.0) return 0.0;
   int lookback = bars;
   if(lookback < 4) lookback = 4;
   if(lookback > 30) lookback = 30;
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   if(close1 <= 0.0) return 0.0;

   double hi = iHigh(Symbol(), PERIOD_M5, 1);
   double lo = iLow(Symbol(), PERIOD_M5, 1);
   if(hi <= 0.0 || lo <= 0.0) return 0.0;

   for(int i = 2; i <= lookback; i++)
   {
      double h = iHigh(Symbol(), PERIOD_M5, i);
      double l = iLow(Symbol(), PERIOD_M5, i);
      if(h > 0.0) hi = MathMax(hi, h);
      if(l > 0.0) lo = MathMin(lo, l);
   }

   if(signal == -1)
   {
      resetATR = MathMax((close1 - lo) / atr, 0.0);
      return MathMax((hi - close1) / atr, 0.0);
   }

   resetATR = MathMax((hi - close1) / atr, 0.0);
   return MathMax((close1 - lo) / atr, 0.0);
}

bool IsXAUExtensionResetMissing(int signal, double atr, double &extensionATR, double &resetATR)
{
   extensionATR = XAU_DirectionalExtensionATR(signal, InpXAU_ExtensionLookbackBars, atr, resetATR);
   return (extensionATR >= InpXAU_MaxExtensionDriveATR &&
           resetATR < InpXAU_MinExtensionResetATR);
}

// v5.8.25 - Gold breakout exception for the generic momentum-slowdown guard.
// The old check treated any SELL close in the upper part of a 3-bar range as
// weak momentum, even when the broader regime had already flipped into a fast
// breakout. That blocked real XAU flushes before they moved. This helper keeps
// the slowdown guard for normal pullbacks, but lets confirmed breakout
// continuation pass with reduced false vetoes.
bool IsXAUConfirmedBreakoutContinuation(int signal, string setupName)
{
   if(signal == 0 || !IsXAUFastSymbol()) return false;

   bool setupBreakout = (StringFind(setupName, "BREAKOUT") >= 0 ||
                         StringFind(setupName, "BRKT") >= 0);
   bool regimeBreakout =
      (signal ==  1 && currentRegime == REGIME_BREAKOUT_UP) ||
      (signal == -1 && currentRegime == REGIME_BREAKOUT_DOWN);
   if(!setupBreakout && !regimeBreakout) return false;

   double o[3], h[3], l[3], c[3];
   if(CopyOpen (Symbol(), PERIOD_M5, 1, 3, o) < 3) return false;
   if(CopyHigh (Symbol(), PERIOD_M5, 1, 3, h) < 3) return false;
   if(CopyLow  (Symbol(), PERIOD_M5, 1, 3, l) < 3) return false;
   if(CopyClose(Symbol(), PERIOD_M5, 1, 3, c) < 3) return false;

   double atr = 0.0;
   if(ArraySize(bufATR) > 1) atr = bufATR[1];
   if(atr <= 0.0) return false;

   double extensionATR = 0.0, resetATR = 0.0;
   if(IsXAUExtensionResetMissing(signal, atr, extensionATR, resetATR))
      return false; // Do not let the breakout exception sell bottoms / buy tops after the flush is already stretched.

   double bodyATR = MathAbs(c[0] - o[0]) / atr;
   double rangeATR = (h[0] - l[0]) / atr;
   bool directionalBody = (signal == 1 ? c[0] > o[0] : c[0] < o[0]);
   bool brokePriorSwing = (signal == 1 ? c[0] > MathMax(h[1], h[2])
                                      : c[0] < MathMin(l[1], l[2]));
   bool continuationClose = (signal == 1 ? c[0] > c[1] : c[0] < c[1]);

   return directionalBody &&
          continuationClose &&
          (brokePriorSwing || bodyATR >= 0.35 || rangeATR >= 0.80);
}

// v5.3.0 — Phase 2: ML score smoothing (WMA over last N).
double  g_mlHistory[10];
int     g_mlHistIdx = 0;
int     g_mlHistCount = 0;
string  g_mlLastSignature = "";
double SmoothedMLScore(double rawScore, string signature)
{
   if(InpMLSmoothingBars <= 1) return rawScore;
   int n = MathMin(InpMLSmoothingBars, 10);
   if(InpResetMLSmoothingBySignature && signature != g_mlLastSignature)
   {
      ArrayInitialize(g_mlHistory, 0.0);
      g_mlHistIdx = 0;
      g_mlHistCount = 0;
      g_mlLastSignature = signature;
   }
   g_mlHistory[g_mlHistIdx] = rawScore;
   g_mlHistIdx = (g_mlHistIdx + 1) % n;
   if(g_mlHistCount < n) g_mlHistCount++;
   if(g_mlHistCount < 3) return rawScore;
   double num = 0, den = 0;
   for(int i = 0; i < g_mlHistCount; i++)
   {
      // give MORE weight to most recent (i closest to g_mlHistIdx-1)
      int age = (g_mlHistIdx - 1 - i + n) % n;
      double w = (double)(n - age);
      num += g_mlHistory[i] * w;
      den += w;
   }
   return den > 0 ? num / den : rawScore;
}

// v5.3.0 — Phase 3: Fake-breakout guard. After a Donchian-N break, require the
// subsequent bar to CLOSE beyond the breakout level (not just wick through).
bool IsFakeBreakout(int signal)
{
   if(!InpFakeBreakoutGuard) return false;
   int N = 20;
   double hi[20], lo[20], cl[2];
   if(CopyHigh(Symbol(), PERIOD_M5, 2, N, hi) < N) return false;
   if(CopyLow (Symbol(), PERIOD_M5, 2, N, lo) < N) return false;
   if(CopyClose(Symbol(), PERIOD_M5, 1, 2, cl) < 2) return false;
   double maxH = hi[ArrayMaximum(hi)];
   double minL = lo[ArrayMinimum(lo)];
   if(signal == +1) {
      // If price wicked above maxH but the most recent CLOSE is back below it → fake.
      if(cl[1] > maxH && cl[0] < maxH) return true;
   } else {
      if(cl[1] < minL && cl[0] > minL) return true;
   }
   return false;
}

double XAU_SessionVWAP(int lookbackBars)
{
   if(lookbackBars < 8) lookbackBars = 8;
   double sumPV = 0.0, sumV = 0.0;
   MqlDateTime nowDt, barDt;
   TimeCurrent(nowDt);
   for(int i = 1; i <= lookbackBars; i++)
   {
      datetime bt = iTime(Symbol(), PERIOD_M5, i);
      if(bt <= 0) break;
      TimeToStruct(bt, barDt);
      if(barDt.year != nowDt.year || barDt.mon != nowDt.mon || barDt.day != nowDt.day)
         break;

      double h = iHigh(Symbol(), PERIOD_M5, i);
      double l = iLow(Symbol(), PERIOD_M5, i);
      double c = iClose(Symbol(), PERIOD_M5, i);
      long   v = iVolume(Symbol(), PERIOD_M5, i);
      if(h <= 0 || l <= 0 || c <= 0 || v <= 0) continue;
      double typical = (h + l + c) / 3.0;
      sumPV += typical * (double)v;
      sumV  += (double)v;
   }
   return (sumV > 0.0) ? (sumPV / sumV) : 0.0;
}

double XAU_AvgATR(int bars)
{
   if(bars < 10) bars = 10;
   double arr[];
   ArraySetAsSeries(arr, true);
   int got = CopyBuffer(hATR, 0, 1, bars, arr);
   if(got <= 5) return (ArraySize(bufATR) > 1 ? bufATR[1] : 0.0);
   double sum = 0.0;
   int n = 0;
   for(int i = 0; i < got; i++)
   {
      if(arr[i] > 0.0) { sum += arr[i]; n++; }
   }
   return n > 0 ? sum / n : (ArraySize(bufATR) > 1 ? bufATR[1] : 0.0);
}

string DowngradeGradeOneStep(string grade)
{
   if(StringFind(grade, "A+") >= 0) return "A";
   if(grade == "A") return "B";
   if(grade == "B") return "SKIP";
   return grade;
}

string XAU_CsvSafe(string s)
{
   StringReplace(s, ",", ";");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\"", "'");
   if(StringLen(s) > 700) s = StringSubstr(s, 0, 700);
   return s;
}

string XAU_BlockReasonKey(string reason)
{
   string r = reason;
   int cut = StringFind(r, ":");
   if(cut > 0) r = StringSubstr(r, 0, cut);
   cut = StringFind(r, "|");
   if(cut > 0) r = StringSubstr(r, 0, cut);
   if(StringLen(r) > 64) r = StringSubstr(r, 0, 64);
   return XAU_CsvSafe(r);
}

string XAU_BlockedMemoryFile()
{
   return "XAUAI_BlockedTradeMemory_" + Symbol() + ".csv";
}

string XAU_TradeBrainFile()
{
   return "XAUAI_ExecutedTradeBrain_" + Symbol() + ".csv";
}

string XAU_EntryQualityFile()
{
   return "XAUAI_EntryQualityReview_" + Symbol() + ".csv";
}

string XAU_TradingIntelCsvFile()
{
   return "XAUAI_TradingIntelligence_" + Symbol() + ".csv";
}

string XAU_TradingIntelJsonFile()
{
   return "XAUAI_TradingIntelligence_" + Symbol() + ".jsonl";
}

int XAU_CountCsvDataRows(string fn)
{
   if(!FileIsExist(fn, FILE_COMMON)) return 0;
   int h = FileOpen(fn, FILE_READ | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE) return 0;
   int rows = 0;
   bool header = true;
   while(!FileIsEnding(h))
   {
      string first = FileReadString(h);
      if(StringLen(first) == 0 && FileIsEnding(h)) break;
      for(int guard = 0; guard < 80 && !FileIsLineEnding(h) && !FileIsEnding(h); guard++)
         FileReadString(h);
      if(header) header = false;
      else rows++;
   }
   FileClose(h);
   return rows;
}

int XAU_RecoverOpenPositionQuality()
{
   int recovered = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || !PositionSelectByTicket(tk)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      ulong posId = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
      if(posId == 0) continue;
      if(XAU_FindQualityIdx(posId) < 0)
      {
         int n = ArraySize(g_qualityPosIds);
         ArrayResize(g_qualityPosIds, n + 1);
         ArrayResize(g_qualityWorstPnl, n + 1);
         ArrayResize(g_qualityNegativeSince, n + 1);
         ArrayResize(g_qualityNegativeSec, n + 1);
         ArrayResize(g_qualityMaxFavMove, n + 1);
         ArrayResize(g_qualityMaxAdvMove, n + 1);
         double pnl = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
         g_qualityPosIds[n] = posId;
         g_qualityWorstPnl[n] = MathMin(0.0, pnl);
         g_qualityNegativeSince[n] = pnl < 0.0 ? TimeCurrent() : 0;
         g_qualityNegativeSec[n] = 0;
         g_qualityMaxFavMove[n] = 0.0;
         g_qualityMaxAdvMove[n] = 0.0;
      }
      recovered++;
   }
   return recovered;
}

int XAU_CountMyHistoryDeals(int daysBack)
{
   datetime to = TimeCurrent();
   datetime from = to - MathMax(daysBack, 1) * 86400;
   if(!HistorySelect(from, to)) return 0;
   int count = 0;
   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      if(HistoryDealGetInteger(deal, DEAL_MAGIC) != InpMagicNumber) continue;
      if(HistoryDealGetString(deal, DEAL_SYMBOL) != Symbol()) continue;
      count++;
   }
   return count;
}

void XAU_LogTradingIntelStartupHealth()
{
   if(!InpTradingIntelDataset || !IsXAUFastSymbol()) return;
   string csvFile = XAU_TradingIntelCsvFile();
   string jsonFile = XAU_TradingIntelJsonFile();
   string extra = "csv=" + csvFile +
                  " json=" + jsonFile +
                  " cloudFanout=" + (InpCloudFanout ? "ON" : "OFF") +
                  " localSourceOfTruth=Y";
   XAU_IntelAppend("DATASET_READY", "startup_" + (string)((long)TimeCurrent()), 0, 0,
                   "SYSTEM", "", "", (int)currentRegime, SessionTag(),
                   "DATASET", "READY", "LOCAL_REPORTS_READY",
                   0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                   0.0, 0.0, 0, 0, 0.0, 0.0,
                   "startup health check", "", "", 0, true, extra);
   Print("TRADING-INTEL READY: CSV=", csvFile,
         " JSON=", InpTradingIntelJson ? jsonFile : "OFF",
         " | CloudFanout=", InpCloudFanout ? "ON" : "OFF",
         " | local source of truth enabled.");
}

void XAU_RunStartupIntelligenceSync()
{
   if(!InpStartupIntelSync || !IsXAUFastSymbol())
   {
      g_startupIntelSyncDone = true;
      g_startupIntelSyncOk = true;
      g_startupIntelSyncReason = "disabled_or_not_xau";
      return;
   }

   datetime started = TimeCurrent();
   int barsM5 = Bars(Symbol(), PERIOD_M5);
   int openRecovered = XAU_RecoverOpenPositionQuality();
   int tradeBrainRows = XAU_CountCsvDataRows(XAU_TradeBrainFile());
   int blockedRows = XAU_CountCsvDataRows(XAU_BlockedMemoryFile());
   int intelRows = XAU_CountCsvDataRows(XAU_TradingIntelCsvFile());
   int historyDeals = XAU_CountMyHistoryDeals(14);
   bool memoryOk = (InpTradeBrainMemory ? (FileIsExist(XAU_TradeBrainFile(), FILE_COMMON) || tradeBrainRows >= 0) : true);
   bool contextCriticalOk = (barsM5 >= 100);
   bool contextTargetMet = (barsM5 >= InpStartupIntelMinCandles);
   bool positionsOk = true;
   g_startupIntelSyncOk = (memoryOk && contextCriticalOk && positionsOk);
   g_startupIntelSyncDone = true;
   g_startupIntelSyncReason = g_startupIntelSyncOk ? (contextTargetMet ? "OK" : "OK_WARN_CONTEXT_TARGET_NOT_MET") : "FAILED";
   if(!contextCriticalOk)
      g_startupIntelSyncReason = StringFormat("FAILED: only %d M5 bars loaded; critical minimum 100, target %d",
                                              barsM5, InpStartupIntelMinCandles);

   double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   double mid = (bid > 0.0 && ask > 0.0) ? (bid + ask) * 0.5 : iClose(Symbol(), PERIOD_M5, 0);
   double atr = (ArraySize(bufATR) > 1 ? bufATR[1] : 0.0);
   string extra = StringFormat("version=5.9.1 syncDurationSec=%d historyDeals=%d openPositions=%d tradeBrainRows=%d blockedRows=%d intelRows=%d barsM5=%d contextTarget=%d contextTargetMet=%s tradingEnabled=%s reason=%s",
                               (int)(TimeCurrent() - started), historyDeals, openRecovered,
                               tradeBrainRows, blockedRows, intelRows, barsM5,
                               InpStartupIntelMinCandles, contextTargetMet ? "Y" : "N",
                               g_startupIntelSyncOk ? "Y" : "N",
                               g_startupIntelSyncReason);
   XAU_IntelAppend("STARTUP_SYNC", "startup_sync_" + (string)((long)started), 0, 0,
                   "SYSTEM", "", "", (int)currentRegime, SessionTag(),
                   "STARTUP_SYNC", "RECOVER", g_startupIntelSyncReason,
                   0.0, 0.0, atr, mid, 0.0, 0.0, 0.0, 0.0, 0.0,
                   0.0, 0.0, 0, 0, 0.0, 0.0,
                   "startup intelligence sync", "", "", 0, g_startupIntelSyncOk, extra);
   Print("STARTUP-INTEL SYNC: ", extra);
}

void XAU_RecordMarketSnapshot(string phase, int signal, string setupName, string grade,
                              double setupScore, double combinedScore)
{
   if(!InpMarketIntelSnapshots || !InpTradingIntelDataset || !IsXAUFastSymbol()) return;
   if(ArraySize(bufATR) < 2 || ArraySize(bufRSI) < 2 ||
      ArraySize(bufEMAFast) < 2 || ArraySize(bufEMASlow) < 2) return;

   double o[2], h[2], l[2], c[2];
   if(CopyOpen(Symbol(), PERIOD_M5, 1, 1, o) < 1) return;
   if(CopyHigh(Symbol(), PERIOD_M5, 1, 1, h) < 1) return;
   if(CopyLow(Symbol(), PERIOD_M5, 1, 1, l) < 1) return;
   if(CopyClose(Symbol(), PERIOD_M5, 1, 1, c) < 1) return;
   double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   double mid = (bid > 0.0 && ask > 0.0) ? (bid + ask) * 0.5 : c[0];
   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   double atr = bufATR[1];
   double emaFast = bufEMAFast[1];
   double emaSlow = bufEMASlow[1];
   double rsi = bufRSI[1];
   double stoch = ArraySize(bufStochK) > 1 ? bufStochK[1] : 0.0;
   long vol = iVolume(Symbol(), PERIOD_M5, 1);
   string structure = emaFast > emaSlow ? "EMA_BULL" : (emaFast < emaSlow ? "EMA_BEAR" : "EMA_FLAT");
   string extra = StringFormat("phase=%s tf=M5 o=%.2f h=%.2f l=%.2f c=%.2f spread=%.0f atr=%.2f rsi=%.1f stoch=%.1f emaFast=%.2f emaSlow=%.2f volume=%d regime=%s session=%s structure=%s dxy=%s openPositions=%d lastSkip=%s",
                               phase, o[0], h[0], l[0], c[0], spread, atr, rsi, stoch,
                               emaFast, emaSlow, (int)vol, RegimeName(), SessionTag(),
                               structure, dxyGoldBias, CountMyPositions(), g_lastSkipReason);
   XAU_IntelAppend("MARKET_SNAPSHOT", "snap_" + (string)((long)TimeCurrent()), 0, signal,
                   setupName, grade, lastSignalSignature, (int)currentRegime, SessionTag(),
                   "MARKET", phase, "M5_CONTEXT",
                   setupScore, combinedScore, atr, mid, 0.0, 0.0, 0.0, 0.0, 0.0,
                   0.0, 0.0, 0, 0, 0.0, 0.0,
                   "market snapshot", "", "", 0, true, extra);
}

string XAU_IntelJsonSafe(string s, int maxLen)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   if(maxLen > 0 && StringLen(s) > maxLen) s = StringSubstr(s, 0, maxLen);
   return s;
}

void XAU_IntelAppendJson(string eventName, string decisionId, ulong posId, int dir,
                         string setupName, string grade, string signature, int regime,
                         string session, string owner, string action, string reasonKey,
                         double setupScore, double combinedScore, double atr,
                         double price, double entryPrice, double exitPrice,
                         double lots, double sl, double tp, double profit,
                         double worstFloating, int secondsNegative, int checkpointMin,
                         double favATR, double advATR, string entryReason,
                         string exitReason, string cloudSignalId, int cloudCode,
                         bool cloudOk, string extra)
{
   if(!InpTradingIntelJson) return;
   string fn = XAU_TradingIntelJsonFile();
   bool exists = FileIsExist(fn, FILE_COMMON);
   int h = exists
           ? FileOpen(fn, FILE_READ | FILE_WRITE | FILE_TXT | FILE_COMMON)
           : FileOpen(fn, FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(h == INVALID_HANDLE)
   {
      Print("TRADING-INTEL JSON: FileOpen failed err=", GetLastError());
      return;
   }
   if(exists) FileSeek(h, 0, SEEK_END);
   MqlDateTime dt; TimeCurrent(dt);
   string line = "{";
   line += "\"schema\":\"xauai_trading_intelligence_v1\"";
   line += ",\"event\":\"" + XAU_IntelJsonSafe(eventName, 64) + "\"";
   line += ",\"time\":\"" + TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS) + "\"";
   line += ",\"symbol\":\"" + XAU_IntelJsonSafe(Symbol(), 24) + "\"";
   line += ",\"decisionId\":\"" + XAU_IntelJsonSafe(decisionId, 80) + "\"";
   line += ",\"posId\":\"" + (string)posId + "\"";
   line += ",\"dir\":\"" + (dir > 0 ? "BUY" : (dir < 0 ? "SELL" : "NA")) + "\"";
   line += ",\"setup\":\"" + XAU_IntelJsonSafe(setupName, 80) + "\"";
   line += ",\"grade\":\"" + XAU_IntelJsonSafe(XAU_GradeBucket(grade), 24) + "\"";
   line += ",\"signature\":\"" + XAU_IntelJsonSafe(signature, 120) + "\"";
   line += ",\"regime\":" + (string)regime;
   line += ",\"session\":\"" + XAU_IntelJsonSafe(session, 32) + "\"";
   line += ",\"hour\":" + (string)dt.hour;
   line += ",\"owner\":\"" + XAU_IntelJsonSafe(owner, 40) + "\"";
   line += ",\"action\":\"" + XAU_IntelJsonSafe(action, 40) + "\"";
   line += ",\"reasonKey\":\"" + XAU_IntelJsonSafe(reasonKey, 90) + "\"";
   line += ",\"setupScore\":" + DoubleToString(setupScore, 2);
   line += ",\"combined\":" + DoubleToString(combinedScore, 2);
   line += ",\"atr\":" + DoubleToString(atr, 4);
   line += ",\"price\":" + DoubleToString(price, 5);
   line += ",\"entryPrice\":" + DoubleToString(entryPrice, 5);
   line += ",\"exitPrice\":" + DoubleToString(exitPrice, 5);
   line += ",\"lots\":" + DoubleToString(lots, 2);
   line += ",\"sl\":" + DoubleToString(sl, 5);
   line += ",\"tp\":" + DoubleToString(tp, 5);
   line += ",\"profit\":" + DoubleToString(profit, 2);
   line += ",\"worstFloating\":" + DoubleToString(worstFloating, 2);
   line += ",\"secondsNegative\":" + (string)secondsNegative;
   line += ",\"checkpointMin\":" + (string)checkpointMin;
   line += ",\"favATR\":" + DoubleToString(favATR, 2);
   line += ",\"advATR\":" + DoubleToString(advATR, 2);
   line += ",\"entryReason\":\"" + XAU_IntelJsonSafe(entryReason, 700) + "\"";
   line += ",\"exitReason\":\"" + XAU_IntelJsonSafe(exitReason, 700) + "\"";
   line += ",\"cloudSignalId\":\"" + XAU_IntelJsonSafe(cloudSignalId, 80) + "\"";
   line += ",\"cloudCode\":" + (string)cloudCode;
   line += ",\"cloudOk\":" + (cloudOk ? "true" : "false");
   line += ",\"extra\":\"" + XAU_IntelJsonSafe(extra, 500) + "\"";
   line += "}";
   FileWriteString(h, line + "\n");
   FileClose(h);
}

void XAU_IntelAppend(string eventName, string decisionId, ulong posId, int dir,
                     string setupName, string grade, string signature, int regime,
                     string session, string owner, string action, string reasonKey,
                     double setupScore, double combinedScore, double atr,
                     double price, double entryPrice, double exitPrice,
                     double lots, double sl, double tp, double profit,
                     double worstFloating, int secondsNegative, int checkpointMin,
                     double favATR, double advATR, string entryReason,
                     string exitReason, string cloudSignalId, int cloudCode,
                     bool cloudOk, string extra)
{
   if(!InpTradingIntelDataset || !IsXAUFastSymbol()) return;
   string fn = XAU_TradingIntelCsvFile();
   bool exists = FileIsExist(fn, FILE_COMMON);
   int h = exists
           ? FileOpen(fn, FILE_READ | FILE_WRITE | FILE_CSV | FILE_COMMON, ',')
           : FileOpen(fn, FILE_WRITE | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE)
   {
      Print("TRADING-INTEL CSV: FileOpen failed err=", GetLastError());
      return;
   }
   if(exists) FileSeek(h, 0, SEEK_END);
   if(!exists || FileTell(h) == 0)
   {
      FileWrite(h, "schema", "event", "time", "symbol", "decisionId", "posId",
                "dir", "setup", "grade", "signature", "regime", "session", "hour",
                "owner", "action", "reasonKey", "setupScore", "combined", "atr",
                "price", "entryPrice", "exitPrice", "lots", "sl", "tp", "profit",
                "worstFloating", "secondsNegative", "checkpointMin", "favATR", "advATR",
                "entryReason", "exitReason", "cloudSignalId", "cloudCode", "cloudOk", "extra");
   }
   MqlDateTime dt; TimeCurrent(dt);
   FileWrite(h,
             "xauai_trading_intelligence_v1",
             XAU_CsvSafe(eventName),
             TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS),
             Symbol(),
             XAU_CsvSafe(decisionId),
             (string)posId,
             dir > 0 ? "BUY" : (dir < 0 ? "SELL" : "NA"),
             XAU_CsvSafe(setupName),
             XAU_CsvSafe(XAU_GradeBucket(grade)),
             XAU_CsvSafe(signature),
             regime,
             XAU_CsvSafe(session),
             dt.hour,
             XAU_CsvSafe(owner),
             XAU_CsvSafe(action),
             XAU_CsvSafe(reasonKey),
             DoubleToString(setupScore, 2),
             DoubleToString(combinedScore, 2),
             DoubleToString(atr, 4),
             DoubleToString(price, 5),
             DoubleToString(entryPrice, 5),
             DoubleToString(exitPrice, 5),
             DoubleToString(lots, 2),
             DoubleToString(sl, 5),
             DoubleToString(tp, 5),
             DoubleToString(profit, 2),
             DoubleToString(worstFloating, 2),
             secondsNegative,
             checkpointMin,
             DoubleToString(favATR, 2),
             DoubleToString(advATR, 2),
             XAU_CsvSafe(entryReason),
             XAU_CsvSafe(exitReason),
             XAU_CsvSafe(cloudSignalId),
             cloudCode,
             cloudOk ? "Y" : "N",
             XAU_CsvSafe(extra));
   FileClose(h);

   XAU_IntelAppendJson(eventName, decisionId, posId, dir, setupName, grade, signature,
                       regime, session, owner, action, reasonKey, setupScore, combinedScore,
                       atr, price, entryPrice, exitPrice, lots, sl, tp, profit,
                       worstFloating, secondsNegative, checkpointMin, favATR, advATR,
                       entryReason, exitReason, cloudSignalId, cloudCode, cloudOk, extra);
}

string XAU_GradeBucket(string grade)
{
   if(StringFind(grade, "A+") >= 0) return "A+";
   if(grade == "A") return "A";
   if(grade == "B" || StringFind(grade, "B+") >= 0) return "B";
   return grade;
}

double XAU_AcceleratedLearningAdjust(int signal, string setupName,
                                     double combinedScore, string &reason)
{
   reason = "";
   if(!InpAcceleratedLearningMode || !InpTradeBrainMemory || !IsXAUFastSymbol()) return 0.0;
   if(signal == 0 || StringLen(setupName) == 0) return 0.0;
   string fn = XAU_TradeBrainFile();
   if(!FileIsExist(fn, FILE_COMMON)) return 0.0;

   int h = FileOpen(fn, FILE_READ | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE) return 0.0;

   int samples = 0, loc_wins = 0;
   int asia = 0, london = 0, ny = 0;
   bool has24h = false;
   double grossWin = 0.0, grossLoss = 0.0, worstSum = 0.0, profitSum = 0.0;
   bool header = true;
   while(!FileIsEnding(h))
   {
      string eventName = FileReadString(h);
      if(StringLen(eventName) == 0 && FileIsEnding(h)) break;
      string tm = FileReadString(h);
      FileReadString(h); // posId
      string sym = FileReadString(h);
      string dirTxt = FileReadString(h);
      string setup = FileReadString(h);
      FileReadString(h); // grade
      FileReadString(h); // signature
      FileReadString(h); // regime
      string session = FileReadString(h);
      FileReadString(h); // hour
      FileReadString(h); // entryPrice
      FileReadString(h); // exitPrice
      FileReadString(h); // lots
      FileReadString(h); // sl
      FileReadString(h); // tp
      string profitTxt = FileReadString(h);
      string worstTxt = FileReadString(h);
      FileReadString(h); // secondsNegative
      FileReadString(h); // outcome
      FileReadString(h); // exitReason
      FileReadString(h); // entryReason
      FileReadString(h); // setupScore
      FileReadString(h); // combined
      FileReadString(h); // atr
      FileReadString(h); // aiConfidence

      if(header) { header = false; continue; }
      if(eventName != "CLOSE") continue;
      if(sym != Symbol()) continue;
      if((signal > 0 && dirTxt != "BUY") || (signal < 0 && dirTxt != "SELL")) continue;
      if(setup != setupName) continue;

      double profit = StringToDouble(profitTxt);
      double worst = StringToDouble(worstTxt);
      samples++;
      profitSum += profit;
      worstSum += worst;
      if(profit > 0.0) { loc_wins++; grossWin += profit; }
      else grossLoss += MathAbs(profit);
      if(session == "ASIA") asia++;
      else if(session == "LONDON") london++;
      else if(session == "NY") ny++;
      datetime rowTime = StringToTime(tm);
      if(rowTime > 0 && (TimeCurrent() - rowTime) >= InpAccelLearningMinHours * 3600)
         has24h = true;
   }
   FileClose(h);

   if(samples < InpAccelLearningMinObs || !has24h) return 0.0;
   int activeSessions = (asia > 0 ? 1 : 0) + (london > 0 ? 1 : 0) + (ny > 0 ? 1 : 0);
   if(activeSessions < 2) return 0.0;

   double wr = samples > 0 ? (100.0 * loc_wins / samples) : 0.0;
   double pf = grossLoss > 0.0 ? grossWin / grossLoss : (grossWin > 0.0 ? 99.0 : 0.0);
   double avg = samples > 0 ? profitSum / samples : 0.0;
   double avgWorst = samples > 0 ? worstSum / samples : 0.0;
   double adj = 0.0;
   string verdict = "NO_CHANGE";

   if(wr >= InpAccelLearningMinWR && pf >= InpAccelLearningMinPF && avg > 0.0)
   {
      adj = MathMin(InpAccelLearningMaxScoreAdj, 0.10 + MathMin(0.15, (pf - InpAccelLearningMinPF) * 0.08));
      verdict = "PATTERN_STRENGTHENED";
   }
   else if(wr <= 42.0 || pf < 0.85 || avg < 0.0)
   {
      adj = -MathMin(InpAccelLearningMaxScoreAdj, 0.10 + MathMin(0.15, (0.85 - MathMin(pf, 0.85)) * 0.10));
      verdict = "PATTERN_WEAKENED";
   }
   if(MathAbs(adj) < 0.01) return 0.0;

   double afterScore = MathMax(0.0, combinedScore + adj);
   reason = StringFormat("ACCEL-LEARNING %s LOW_RISK_SCORE_ONLY setup=%s dir=%s samples=%d wr=%.1f pf=%.2f avg=$%.0f avgWorst=$%.0f scoreAdj=%.2f before=%.2f after=%.2f; does not change lot, SL, TP, max risk, drawdown, or emergency locks",
                         verdict, setupName, signal > 0 ? "BUY" : "SELL", samples,
                         wr, pf, avg, avgWorst, adj, combinedScore, afterScore);
   XAU_IntelAppend("ACCEL_LEARNING", "accel_" + setupName + "_" + (signal > 0 ? "BUY" : "SELL"),
                   0, signal, setupName, "", lastSignalSignature, (int)currentRegime, SessionTag(),
                   "LEARNING", "SCORE_ADJUST", verdict,
                   0.0, afterScore, 0.0, SymbolInfoDouble(Symbol(), SYMBOL_BID),
                   0.0, 0.0, 0.0, 0.0, 0.0, avg,
                   avgWorst, 0, 0, 0.0, 0.0,
                   "accelerated learning evidence", "", "", 0, true, reason);
   return adj;
}

int XAU_FindBrainOpen(ulong posId)
{
   for(int i = 0; i < ArraySize(g_brainOpenTrades); i++)
      if(g_brainOpenTrades[i].posId == posId) return i;
   return -1;
}

void XAU_RemoveBrainOpen(int idx)
{
   int n = ArraySize(g_brainOpenTrades);
   if(idx < 0 || idx >= n) return;
   for(int i = idx; i < n - 1; i++)
      g_brainOpenTrades[i] = g_brainOpenTrades[i + 1];
   ArrayResize(g_brainOpenTrades, n - 1);
}

double XAU_MoveToMoney(double move, double lots)
{
   double tickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   if(tickValue <= 0.0 || tickSize <= 0.0 || lots <= 0.0) return 0.0;
   return (move / tickSize) * tickValue * lots;
}

void XAU_AppendTradeBrain(string eventName, TradeBrainOpen &r,
                          double exitPrice, double profit,
                          double worstFloatingPnl, int secondsNegative,
                          string outcome, string exitReason)
{
   if(!InpTradeBrainMemory || !IsXAUFastSymbol()) return;
   string fn = XAU_TradeBrainFile();
   bool exists = FileIsExist(fn, FILE_COMMON);
   int h = exists
           ? FileOpen(fn, FILE_READ | FILE_WRITE | FILE_CSV | FILE_COMMON, ',')
           : FileOpen(fn, FILE_WRITE | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE)
   {
      Print("TRADE-BRAIN: FileOpen failed err=", GetLastError());
      return;
   }
   if(exists) FileSeek(h, 0, SEEK_END);
   if(!exists || FileTell(h) == 0)
   {
      FileWrite(h, "event", "time", "posId", "symbol", "dir", "setup", "grade", "signature",
                "regime", "session", "hour", "entryPrice", "exitPrice", "lots", "sl", "tp",
                "profit", "worstFloating", "secondsNegative", "outcome", "exitReason",
                "entryReason", "setupScore", "combined", "atr", "aiConfidence");
   }
   MqlDateTime dt; TimeCurrent(dt);
   FileWrite(h, eventName,
             TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS),
             (string)r.posId,
             Symbol(),
             r.dir > 0 ? "BUY" : "SELL",
             XAU_CsvSafe(r.setup),
             XAU_CsvSafe(XAU_GradeBucket(r.grade)),
             XAU_CsvSafe(r.signature),
             r.regime,
             XAU_CsvSafe(r.session),
             dt.hour,
             DoubleToString(r.entryPrice, 2),
             DoubleToString(exitPrice, 2),
             DoubleToString(r.lots, VolumeDigitsForSymbol()),
             DoubleToString(r.sl, 2),
             DoubleToString(r.tp, 2),
             DoubleToString(profit, 2),
             DoubleToString(worstFloatingPnl, 2),
             secondsNegative,
             XAU_CsvSafe(outcome),
             XAU_CsvSafe(exitReason),
             XAU_CsvSafe(r.entryReason),
             DoubleToString(r.setupScore, 2),
             DoubleToString(r.combinedScore, 2),
             DoubleToString(r.atr, 2),
             r.aiConfidence);
   FileClose(h);

   string owner = "TRADE";
   string action = eventName;
   string reasonKey = eventName == "OPEN" ? "TRADE_OPEN" : XAU_BlockReasonKey(exitReason);
   if(eventName == "OPEN") owner = "ENTRY";
   else if(eventName == "CLOSE") owner = "EXIT";
   else if(eventName == "POST_CLOSE") owner = "EXIT_BRAIN";
   XAU_IntelAppend(eventName, (string)r.posId, r.posId, r.dir,
                   r.setup, r.grade, r.signature, r.regime, r.session,
                   owner, action, reasonKey,
                   r.setupScore, r.combinedScore, r.atr,
                   eventName == "OPEN" ? r.entryPrice : exitPrice,
                   r.entryPrice, exitPrice, r.lots, r.sl, r.tp, profit,
                   worstFloatingPnl, secondsNegative,
                   eventName == "POST_CLOSE" ? secondsNegative : 0,
                   0.0, 0.0, r.entryReason, exitReason,
                   CloudMapGet(r.posId), 0, true, outcome);
}

void XAU_BrainWatchClosedTrade(TradeBrainOpen &r, double closePrice, double closeProfit)
{
   if(!InpTradeBrainMemory || !InpTradeBrainMonitorAfterExit || !IsXAUFastSymbol()) return;
   if(r.posId == 0 || r.dir == 0 || closePrice <= 0.0) return;
   int n = ArraySize(g_brainClosedWatch);
   if(n >= 60)
   {
      for(int i = 0; i < n - 1; i++) g_brainClosedWatch[i] = g_brainClosedWatch[i + 1];
      ArrayResize(g_brainClosedWatch, n - 1);
      n--;
   }
   ArrayResize(g_brainClosedWatch, n + 1);
   g_brainClosedWatch[n].active = true;
   g_brainClosedWatch[n].closeTime = TimeCurrent();
   g_brainClosedWatch[n].nextCheckpointMin = 5;
   g_brainClosedWatch[n].closePrice = closePrice;
   g_brainClosedWatch[n].closeProfit = closeProfit;
   g_brainClosedWatch[n].maxMoreMove = 0.0;
   g_brainClosedWatch[n].maxReverseMove = 0.0;
   g_brainClosedWatch[n].rec = r;
   Print("EXIT-BRAIN WATCH: posId=", r.posId,
         " closePrice=", DoubleToString(closePrice, 2),
         " closeProfit=$", DoubleToString(closeProfit, 2),
         " will monitor 5/10/15/30/60m to judge early-vs-good exit.");
}

void XAU_UpdateClosedTradeOutcomes()
{
   if(!InpTradeBrainMemory || !InpTradeBrainMonitorAfterExit || !IsXAUFastSymbol()) return;
   int n = ArraySize(g_brainClosedWatch);
   if(n <= 0) return;
   double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   double mid = (bid > 0.0 && ask > 0.0) ? (bid + ask) * 0.5 : iClose(Symbol(), PERIOD_M5, 0);
   if(mid <= 0.0) return;

   for(int i = 0; i < n; i++)
   {
      if(!g_brainClosedWatch[i].active) continue;
      TradeBrainOpen r = g_brainClosedWatch[i].rec;
      double moveAfterClose = r.dir > 0 ? (mid - g_brainClosedWatch[i].closePrice)
                                        : (g_brainClosedWatch[i].closePrice - mid);
      g_brainClosedWatch[i].maxMoreMove = MathMax(g_brainClosedWatch[i].maxMoreMove, moveAfterClose);
      g_brainClosedWatch[i].maxReverseMove = MathMax(g_brainClosedWatch[i].maxReverseMove, -moveAfterClose);

      int ageMin = (int)((TimeCurrent() - g_brainClosedWatch[i].closeTime) / 60);
      if(ageMin < g_brainClosedWatch[i].nextCheckpointMin) continue;

      double atr = MathMax(r.atr, 0.01);
      double moreATR = g_brainClosedWatch[i].maxMoreMove / atr;
      double reverseATR = g_brainClosedWatch[i].maxReverseMove / atr;
      double missedMoney = XAU_MoveToMoney(g_brainClosedWatch[i].maxMoreMove, r.lots);
      double avoidedMoney = XAU_MoveToMoney(g_brainClosedWatch[i].maxReverseMove, r.lots);
      string verdict = "EXIT_OK";
      if(moreATR >= InpExitBrainEarlyProfitATR && moreATR > reverseATR * 1.15)
         verdict = "EXIT_EARLY_LEFT_PROFIT";
      else if(reverseATR >= InpExitBrainGoodAvoidATR && reverseATR > moreATR * 1.10)
         verdict = "EXIT_GOOD_AVOIDED_REVERSAL";
      else if(moreATR >= InpExitBrainEarlyProfitATR && reverseATR >= InpExitBrainGoodAvoidATR)
         verdict = "EXIT_MIXED_VOLATILE_AFTER_CLOSE";

      string extra = StringFormat("%s checkpoint=%dm closeProfit=$%.2f maxMore=%.2fATR($%.0f) maxReverse=%.2fATR($%.0f) closePrice=%.2f current=%.2f",
                                  verdict, g_brainClosedWatch[i].nextCheckpointMin,
                                  g_brainClosedWatch[i].closeProfit,
                                  moreATR, missedMoney, reverseATR, avoidedMoney,
                                  g_brainClosedWatch[i].closePrice, mid);
      XAU_AppendTradeBrain("POST_CLOSE", r, mid, g_brainClosedWatch[i].closeProfit,
                           missedMoney, g_brainClosedWatch[i].nextCheckpointMin,
                           verdict, extra);
      Print("EXIT-BRAIN CHECK: posId=", r.posId,
            " ", extra);

      if(g_brainClosedWatch[i].nextCheckpointMin < 10) g_brainClosedWatch[i].nextCheckpointMin = 10;
      else if(g_brainClosedWatch[i].nextCheckpointMin < 15) g_brainClosedWatch[i].nextCheckpointMin = 15;
      else if(g_brainClosedWatch[i].nextCheckpointMin < 30) g_brainClosedWatch[i].nextCheckpointMin = 30;
      else if(g_brainClosedWatch[i].nextCheckpointMin < 60) g_brainClosedWatch[i].nextCheckpointMin = 60;
      else g_brainClosedWatch[i].active = false;
   }
}

void XAU_BrainRecordOpen(ulong posId, int signal, double entryPrice, double sl, double tp,
                         double lots, double atr, string setupName, string grade,
                         string signature, double setupScore, double combinedScore,
                         string entryReason)
{
   if(!InpTradeBrainMemory || posId == 0 || signal == 0 || !IsXAUFastSymbol()) return;
   int idx = XAU_FindBrainOpen(posId);
   if(idx < 0)
   {
      int n = ArraySize(g_brainOpenTrades);
      ArrayResize(g_brainOpenTrades, n + 1);
      idx = n;
   }
   g_brainOpenTrades[idx].posId = posId;
   g_brainOpenTrades[idx].entryTime = TimeCurrent();
   g_brainOpenTrades[idx].dir = signal;
   g_brainOpenTrades[idx].entryPrice = entryPrice;
   g_brainOpenTrades[idx].sl = sl;
   g_brainOpenTrades[idx].tp = tp;
   g_brainOpenTrades[idx].lots = lots;
   g_brainOpenTrades[idx].atr = atr;
   g_brainOpenTrades[idx].setupScore = setupScore;
   g_brainOpenTrades[idx].combinedScore = combinedScore;
   g_brainOpenTrades[idx].regime = (int)currentRegime;
   g_brainOpenTrades[idx].aiConfidence = currentTradeConfidence;
   g_brainOpenTrades[idx].setup = setupName;
   g_brainOpenTrades[idx].grade = grade;
   g_brainOpenTrades[idx].signature = signature;
   g_brainOpenTrades[idx].session = SessionTag();
   g_brainOpenTrades[idx].entryReason = entryReason;
   XAU_AppendTradeBrain("OPEN", g_brainOpenTrades[idx], 0.0, 0.0, 0.0, 0, "OPEN", "");
   Print("TRADE-BRAIN OPEN: posId=", posId,
         " ", signal > 0 ? "BUY" : "SELL",
         " setup=", setupName,
         " grade=", XAU_GradeBucket(grade),
         " signature=", signature,
         " file=", XAU_TradeBrainFile());
}

bool XAU_TradeBrainStats(string setupName, int signal, string grade, string signature,
                         int &samples, double &winRate, double &profitFactor,
                         double &avgProfit, double &avgWorstDD, double &badRecoveryRate)
{
   samples = 0;
   winRate = 0.0;
   profitFactor = 0.0;
   avgProfit = 0.0;
   avgWorstDD = 0.0;
   badRecoveryRate = 0.0;
   if(!InpTradeBrainMemory || !IsXAUFastSymbol()) return false;
   string fn = XAU_TradeBrainFile();
   if(!FileIsExist(fn, FILE_COMMON)) return false;
   int h = FileOpen(fn, FILE_READ | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE) return false;

   string wantDir = signal > 0 ? "BUY" : "SELL";
   string wantGrade = XAU_GradeBucket(grade);
   int winsMem = 0;
   int badRecovery = 0;
   double grossWin = 0.0;
   double grossLoss = 0.0;
   double totalWorst = 0.0;
   double totalProfit = 0.0;
   int exactSigSamples = 0;
   int exactSigWins = 0;

   while(!FileIsEnding(h))
   {
      string ev = FileReadString(h);
      string tm = FileReadString(h);
      string posIdTxt = FileReadString(h);
      string sym = FileReadString(h);
      string dir = FileReadString(h);
      string setup = FileReadString(h);
      string gr = FileReadString(h);
      string sig = FileReadString(h);
      string regimeTxt = FileReadString(h);
      string sess = FileReadString(h);
      string hourTxt = FileReadString(h);
      string entryTxt = FileReadString(h);
      string exitTxt = FileReadString(h);
      string lotsTxt = FileReadString(h);
      string slTxt = FileReadString(h);
      string tpTxt = FileReadString(h);
      string profitTxt = FileReadString(h);
      string worstTxt = FileReadString(h);
      string negTxt = FileReadString(h);
      string outcome = FileReadString(h);
      string exitR = FileReadString(h);
      string entryR = FileReadString(h);
      string setupScoreTxt = FileReadString(h);
      string combinedTxt = FileReadString(h);
      string atrTxt = FileReadString(h);
      string aiTxt = FileReadString(h);

      if(ev != "CLOSE" || sym != Symbol() || dir != wantDir || setup != setupName)
         continue;
      bool gradeCompatible = (gr == wantGrade || sig == signature);
      if(!gradeCompatible) continue;

      double p = StringToDouble(profitTxt);
      double worst = StringToDouble(worstTxt);
      samples++;
      totalProfit += p;
      totalWorst += worst;
      if(p >= 0.01) { winsMem++; grossWin += p; }
      else if(p <= -0.01) grossLoss += MathAbs(p);
      if(sig == signature)
      {
         exactSigSamples++;
         if(p >= 0.01) exactSigWins++;
      }
      if(p > 0.0 && worst < -1.0 && p / MathAbs(worst) < 0.60)
         badRecovery++;
   }
   FileClose(h);
   if(samples <= 0) return false;
   winRate = (double)winsMem / samples * 100.0;
   profitFactor = grossLoss > 0.0 ? grossWin / grossLoss : (grossWin > 0.0 ? 999.0 : 0.0);
   avgProfit = totalProfit / samples;
   avgWorstDD = totalWorst / samples;
   badRecoveryRate = (double)badRecovery / samples * 100.0;
   if(exactSigSamples >= InpTradeBrainMinSamples)
      Print("TRADE-BRAIN EXACT-SIGNATURE: ", signature,
            " samples=", exactSigSamples,
            " WR=", DoubleToString((double)exactSigWins / exactSigSamples * 100.0, 0), "%");
   return (samples >= InpTradeBrainMinSamples);
}

bool XAU_TradeBrainPreEntry(int signal, string setupName, string grade, string signature,
                            double &lotMulti, string &brainReason)
{
   lotMulti = 1.0;
   brainReason = "";
   if(!InpTradeBrainMemory || signal == 0 || !IsXAUFastSymbol()) return true;
   int samples = 0;
   double wr = 0.0, pf = 0.0, avgP = 0.0, avgDD = 0.0, badRec = 0.0;
   bool trusted = XAU_TradeBrainStats(setupName, signal, grade, signature,
                                      samples, wr, pf, avgP, avgDD, badRec);
   if(!trusted)
   {
      brainReason = StringFormat("TRADE-BRAIN AUDIT: pattern has %d/%d samples; recording only, no behavior change.",
                                 samples, InpTradeBrainMinSamples);
      return true;
   }

   bool poorEntryQuality = (avgP > 0.0 && avgDD < 0.0 &&
                            MathAbs(avgDD) > avgP * InpTradeBrainBadDDProfitRatio);
   brainReason = StringFormat("TRADE-BRAIN AUDIT: samples=%d WR=%.0f%% PF=%.2f avgP=$%.0f avgWorstDD=$%.0f badRecovery=%.0f%% poorEntry=%s",
                              samples, wr, pf, avgP, avgDD, badRec,
                              poorEntryQuality ? "Y" : "N");

   if(wr <= InpTradeBrainBlockWR && pf < InpTradeBrainMinPF)
   {
      brainReason = "TRADE-BRAIN BLOCK: similar executed trades have poor proven expectancy. " + brainReason;
      return false;
   }
   if(wr <= InpTradeBrainReduceWR || pf < InpTradeBrainMinPF || poorEntryQuality || badRec >= 45.0)
   {
      lotMulti = InpTradeBrainWeakLotMulti;
      brainReason = StringFormat("TRADE-BRAIN REDUCE: similar pattern is weak, lot x%.2f. ",
                                 lotMulti) + brainReason;
   }
   return true;
}

void XAU_AppendBlockedMemory(string eventName, BlockedIdea &idea, int checkpointMin,
                             double curPrice, string extra)
{
   if(!InpBlockedTradeMemoryReport || !IsXAUFastSymbol()) return;
   string fn = XAU_BlockedMemoryFile();
   bool exists = FileIsExist(fn, FILE_COMMON);
   int h = exists
           ? FileOpen(fn, FILE_READ | FILE_WRITE | FILE_CSV | FILE_COMMON, ',')
           : FileOpen(fn, FILE_WRITE | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE)
   {
      Print("BLOCKED-MEMORY: FileOpen failed err=", GetLastError());
      return;
   }
   if(exists) FileSeek(h, 0, SEEK_END);
   if(!exists || FileTell(h) == 0)
   {
      FileWrite(h, "event", "time", "symbol", "dir", "setup", "grade", "reasonKey",
                "signalPrice", "currentPrice", "atr", "checkpointMin",
                "favATR", "advATR", "regime", "setupScore", "combined", "extra");
   }
   double favATR = idea.atr > 0.0 ? idea.maxFav / idea.atr : 0.0;
   double advATR = idea.atr > 0.0 ? idea.maxAdv / idea.atr : 0.0;
   FileWrite(h, eventName,
             TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS),
             Symbol(),
             idea.dir > 0 ? "BUY" : "SELL",
             XAU_CsvSafe(idea.setup),
             XAU_CsvSafe(idea.grade),
             XAU_BlockReasonKey(idea.reason),
             DoubleToString(idea.signalPrice, 2),
             DoubleToString(curPrice, 2),
             DoubleToString(idea.atr, 2),
             checkpointMin,
             DoubleToString(favATR, 2),
             DoubleToString(advATR, 2),
             idea.regime,
             DoubleToString(idea.setupScore, 2),
             DoubleToString(idea.combinedScore, 2),
             XAU_CsvSafe(extra));
   FileClose(h);

   string intelEvent = (eventName == "CHECK") ? "BLOCK_CHECK" : eventName;
   string decisionId = (string)((long)idea.firstTime) + "_" +
                       (idea.dir > 0 ? "BUY" : "SELL") + "_" +
                       XAU_CsvSafe(idea.setup) + "_" +
                       XAU_BlockReasonKey(idea.reason);
   XAU_IntelAppend(intelEvent, decisionId, 0, idea.dir,
                   idea.setup, idea.grade, "", idea.regime, SessionTag(),
                   eventName == "CHECK" ? "BLOCKED_OUTCOME" : "VETO",
                   eventName == "CHECK" ? "CHECK" : "BLOCK",
                   XAU_BlockReasonKey(idea.reason),
                   idea.setupScore, idea.combinedScore, idea.atr,
                   curPrice, idea.signalPrice, 0.0, 0.0, 0.0, 0.0, 0.0,
                   0.0, 0, checkpointMin, favATR, advATR,
                   "blockedSignal", "", "", 0, true, extra);
}

void XAU_TrackSignalFirstSeen(int signal, string setupName, string grade,
                              double setupScore, double combinedScore,
                              double price, double atr)
{
   if(!InpXAU_FirstSignalMemory || signal == 0 || price <= 0.0 || atr <= 0.0)
      return;

   bool reset = (g_signalFirstSeenTime == 0 ||
                 g_signalFirstSeenDir != signal ||
                 g_signalFirstSeenSetup != setupName ||
                 TimeCurrent() - g_signalFirstSeenTime > 90 * 60);

   if(reset)
   {
      g_signalFirstSeenTime = TimeCurrent();
      g_signalFirstSeenPrice = price;
      g_signalFirstSeenDir = signal;
      g_signalFirstSeenSetup = setupName;
      g_signalFirstSeenGrade = grade;
      g_signalFirstBlockReason = "";
      g_signalFirstSetupScore = setupScore;
      g_signalFirstCombined = combinedScore;
      g_signalFirstATR = atr;
      Print("FIRST-SIGNAL: ", signal > 0 ? "BUY" : "SELL",
            " setup=", setupName,
            " grade=", grade,
            " signalFirstSeenPrice=", DoubleToString(price, 2),
            " score=", DoubleToString(setupScore, 1),
            " combined=", DoubleToString(combinedScore, 1));
   }
}

void XAU_RememberBlockedSignal(int signal, string setupName, string grade,
                               double setupScore, double combinedScore,
                               string reason)
{
   if(!InpBlockedTradeMemoryReport || signal == 0 || !IsXAUFastSymbol()) return;
   double atr = (ArraySize(bufATR) >= 2) ? bufATR[1] : 0.0;
   if(atr <= 0.0) return;
   double px = (signal > 0) ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
                            : SymbolInfoDouble(Symbol(), SYMBOL_BID);
   if(px <= 0.0) px = iClose(Symbol(), PERIOD_M5, 1);
   if(px <= 0.0) return;

   if(g_signalFirstSeenDir == signal && g_signalFirstSeenSetup == setupName && g_signalFirstSeenTime > 0)
      g_signalFirstBlockReason = reason;

   int idx = -1;
   for(int i = 0; i < g_blockedIdeaCount; i++)
   {
      if(g_blockedIdeas[i].active &&
         g_blockedIdeas[i].dir == signal &&
         g_blockedIdeas[i].setup == setupName &&
         XAU_BlockReasonKey(g_blockedIdeas[i].reason) == XAU_BlockReasonKey(reason))
      {
         idx = i;
         break;
      }
   }
   if(idx < 0)
   {
      if(g_blockedIdeaCount >= 40)
      {
         for(int j = 0; j < g_blockedIdeaCount - 1; j++) g_blockedIdeas[j] = g_blockedIdeas[j + 1];
         g_blockedIdeaCount--;
      }
      ArrayResize(g_blockedIdeas, g_blockedIdeaCount + 1);
      idx = g_blockedIdeaCount++;
      g_blockedIdeas[idx].active = true;
      g_blockedIdeas[idx].firstTime = TimeCurrent();
      g_blockedIdeas[idx].lastCheck = TimeCurrent();
      g_blockedIdeas[idx].nextCheckpointMin = 5;
      g_blockedIdeas[idx].dir = signal;
      g_blockedIdeas[idx].signalPrice = px;
      g_blockedIdeas[idx].atr = atr;
      g_blockedIdeas[idx].maxFav = 0.0;
      g_blockedIdeas[idx].maxAdv = 0.0;
      g_blockedIdeas[idx].setupScore = setupScore;
      g_blockedIdeas[idx].combinedScore = combinedScore;
      g_blockedIdeas[idx].regime = (int)currentRegime;
      g_blockedIdeas[idx].setup = setupName;
      g_blockedIdeas[idx].grade = grade;
      g_blockedIdeas[idx].reason = reason;
      XAU_AppendBlockedMemory("BLOCKED", g_blockedIdeas[idx], 0, px, reason);
      Print("BLOCKED-MEMORY: saved virtual ", signal > 0 ? "BUY" : "SELL",
            " setup=", setupName,
            " grade=", grade,
            " signalPrice=", DoubleToString(px, 2),
            " reason=", XAU_BlockReasonKey(reason));
   }
}

void XAU_UpdateBlockedSignalOutcomes()
{
   if(!InpBlockedTradeMemoryReport || g_blockedIdeaCount <= 0 || !IsXAUFastSymbol()) return;
   double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   double mid = (bid > 0.0 && ask > 0.0) ? (bid + ask) * 0.5 : iClose(Symbol(), PERIOD_M5, 0);
   if(mid <= 0.0) return;

   int active = 0;
   double totalFavATR = 0.0;
   for(int i = 0; i < g_blockedIdeaCount; i++)
   {
      if(!g_blockedIdeas[i].active) continue;
      double move = g_blockedIdeas[i].dir > 0 ? (mid - g_blockedIdeas[i].signalPrice)
                                              : (g_blockedIdeas[i].signalPrice - mid);
      g_blockedIdeas[i].maxFav = MathMax(g_blockedIdeas[i].maxFav, move);
      g_blockedIdeas[i].maxAdv = MathMax(g_blockedIdeas[i].maxAdv, -move);

      int ageMin = (int)((TimeCurrent() - g_blockedIdeas[i].firstTime) / 60);
      if(ageMin >= g_blockedIdeas[i].nextCheckpointMin)
      {
         string extra = StringFormat("wouldTP2R=%s wouldSL1R=%s",
                                     g_blockedIdeas[i].maxFav >= g_blockedIdeas[i].atr * 2.0 ? "Y" : "N",
                                     g_blockedIdeas[i].maxAdv >= g_blockedIdeas[i].atr * 1.0 ? "Y" : "N");
         XAU_AppendBlockedMemory("CHECK", g_blockedIdeas[i], g_blockedIdeas[i].nextCheckpointMin, mid, extra);
         if(g_blockedIdeas[i].nextCheckpointMin < 10) g_blockedIdeas[i].nextCheckpointMin = 10;
         else if(g_blockedIdeas[i].nextCheckpointMin < 15) g_blockedIdeas[i].nextCheckpointMin = 15;
         else if(g_blockedIdeas[i].nextCheckpointMin < 30) g_blockedIdeas[i].nextCheckpointMin = 30;
         else if(g_blockedIdeas[i].nextCheckpointMin < 60) g_blockedIdeas[i].nextCheckpointMin = 60;
         else g_blockedIdeas[i].active = false;
      }

      if(g_blockedIdeas[i].active)
      {
         active++;
         if(g_blockedIdeas[i].atr > 0.0) totalFavATR += g_blockedIdeas[i].maxFav / g_blockedIdeas[i].atr;
      }
   }

   if(active > 0 && TimeCurrent() - g_lastBlockedMemorySummary >= 300)
   {
      Print("BLOCKED-MEMORY SUMMARY: active=", active,
            " avgMaxFavorable=", DoubleToString(totalFavATR / active, 2),
            "ATR minSamplesBeforeInfluence=", InpBlockedMemoryMinSamples,
            ". CSV=", XAU_BlockedMemoryFile());
      g_lastBlockedMemorySummary = TimeCurrent();
   }
}

bool XAU_BlockedMemoryStats(string setupName, int signal, string reason,
                            int &samples, double &winRate, double &avgFavATR, double &avgAdvATR)
{
   samples = 0;
   winRate = 0.0;
   avgFavATR = 0.0;
   avgAdvATR = 0.0;
   if(!InpBlockedTradeMemoryReport || !IsXAUFastSymbol()) return false;
   string fn = XAU_BlockedMemoryFile();
   if(!FileIsExist(fn, FILE_COMMON)) return false;
   int h = FileOpen(fn, FILE_READ | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE) return false;

   string wantDir = signal > 0 ? "BUY" : "SELL";
   string wantReason = XAU_BlockReasonKey(reason);
   int winsMem = 0;
   int lossesMem = 0;
   while(!FileIsEnding(h))
   {
      string ev = FileReadString(h);
      string tm = FileReadString(h);
      string sym = FileReadString(h);
      string dir = FileReadString(h);
      string setup = FileReadString(h);
      string grade = FileReadString(h);
      string reasonKey = FileReadString(h);
      string sigPx = FileReadString(h);
      string curPx = FileReadString(h);
      string atrTxt = FileReadString(h);
      string cpTxt = FileReadString(h);
      string favTxt = FileReadString(h);
      string advTxt = FileReadString(h);
      string regimeTxt = FileReadString(h);
      string setupScoreTxt = FileReadString(h);
      string combinedTxt = FileReadString(h);
      string extra = FileReadString(h);
      if(ev != "CHECK" || sym != Symbol() || dir != wantDir || setup != setupName || reasonKey != wantReason)
         continue;
      int checkpoint = (int)StringToInteger(cpTxt);
      if(checkpoint < 30) continue;
      double fav = StringToDouble(favTxt);
      double adv = StringToDouble(advTxt);
      samples++;
      avgFavATR += fav;
      avgAdvATR += adv;
      if(fav >= 2.0 && adv < 1.20) winsMem++;
      else if(adv >= 1.0 && fav < 1.50) lossesMem++;
   }
   FileClose(h);
   if(samples <= 0) return false;
   avgFavATR /= samples;
   avgAdvATR /= samples;
   int decided = winsMem + lossesMem;
   winRate = decided > 0 ? (double)winsMem / decided * 100.0 : 50.0;
   return (samples >= InpBlockedMemoryMinSamples);
}

bool XAU_BlockedMemoryEdgeSupportsScout(string setupName, int signal, string reason,
                                        int &samples, double &winRate,
                                        double &avgFavATR, double &avgAdvATR,
                                        string &why)
{
   why = "";
   if(!InpBlockedMemoryScoutEnable)
      return false;

   if(!XAU_BlockedMemoryStats(setupName, signal, reason,
                              samples, winRate, avgFavATR, avgAdvATR))
      return false;

   double edgeATR = avgFavATR - avgAdvATR;
   bool enoughEdge = (edgeATR >= InpBlockedMemoryScoutEdgeATR &&
                      avgFavATR >= InpBlockedMemoryScoutMinFavATR &&
                      avgAdvATR <= InpBlockedMemoryScoutMaxAdvATR &&
                      winRate >= InpBlockedMemoryScoutMinWR);
   if(!enoughEdge)
   {
      Print("BLOCKED-MEMORY SCOUT DENIED: samples=", samples,
            " WR=", DoubleToString(winRate, 0), "% < min ",
            DoubleToString(InpBlockedMemoryScoutMinWR, 0), "% or edge not strong enough. avgFav=",
            DoubleToString(avgFavATR, 2), "ATR avgAdv=", DoubleToString(avgAdvATR, 2),
            "ATR. No scout; wait for better entry.");
      return false;
   }

   why = StringFormat("blocked-memory edge samples=%d WR=%.0f%% avgFav=%.2fATR avgAdv=%.2fATR edge=%.2fATR",
                      samples, winRate, avgFavATR, avgAdvATR, edgeATR);
   return true;
}

bool XAU_BlockedMemoryRapidScout(string setupName, int signal, string reason, string &why)
{
   why = "";
   if(!InpBlockedMemoryScoutEnable || !InpBlockedTradeMemoryReport || !IsXAUFastSymbol())
      return false;

   string fn = XAU_BlockedMemoryFile();
   if(!FileIsExist(fn, FILE_COMMON))
      return false;

   int h = FileOpen(fn, FILE_READ | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE)
      return false;

   string wantDir = signal > 0 ? "BUY" : "SELL";
   string wantReason = XAU_BlockReasonKey(reason);
   int samples = 0;
   int tp2r = 0;
   int sl1r = 0;
   double avgFavATR = 0.0;
   double avgAdvATR = 0.0;

   while(!FileIsEnding(h))
   {
      string ev = FileReadString(h);
      string tm = FileReadString(h);
      string sym = FileReadString(h);
      string dir = FileReadString(h);
      string setup = FileReadString(h);
      string grade = FileReadString(h);
      string reasonKey = FileReadString(h);
      string sigPx = FileReadString(h);
      string curPx = FileReadString(h);
      string atrTxt = FileReadString(h);
      string cpTxt = FileReadString(h);
      string favTxt = FileReadString(h);
      string advTxt = FileReadString(h);
      string regimeTxt = FileReadString(h);
      string setupScoreTxt = FileReadString(h);
      string combinedTxt = FileReadString(h);
      string extra = FileReadString(h);

      if(ev != "CHECK" || sym != Symbol() || dir != wantDir || setup != setupName || reasonKey != wantReason)
         continue;

      int checkpoint = (int)StringToInteger(cpTxt);
      if(checkpoint < 30)
         continue;

      double fav = StringToDouble(favTxt);
      double adv = StringToDouble(advTxt);
      samples++;
      avgFavATR += fav;
      avgAdvATR += adv;
      if(StringFind(extra, "wouldTP2R=Y") >= 0) tp2r++;
      if(StringFind(extra, "wouldSL1R=Y") >= 0) sl1r++;
   }
   FileClose(h);

   if(samples <= 0)
      return false;

   avgFavATR /= samples;
   avgAdvATR /= samples;

   bool cleanRapidEdge = (samples >= 5 &&
                          tp2r >= 3 &&
                          sl1r == 0 &&
                          avgFavATR >= 2.00 &&
                          avgAdvATR <= 0.45);

   if(!cleanRapidEdge)
      return false;

   why = StringFormat("rapid blocked-memory edge samples=%d TP2R=%d SL1R=%d avgFav=%.2fATR avgAdv=%.2fATR",
                      samples, tp2r, sl1r, avgFavATR, avgAdvATR);
   return true;
}

int XAU_FindQualityIdx(ulong posId)
{
   for(int i = 0; i < ArraySize(g_qualityPosIds); i++)
      if(g_qualityPosIds[i] == posId) return i;
   return -1;
}

void XAU_UpdateOpenTradeQuality()
{
   if(!IsXAUFastSymbol()) return;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || !PositionSelectByTicket(tk)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      ulong posId = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
      if(posId == 0) continue;
      int idx = XAU_FindQualityIdx(posId);
      if(idx < 0)
      {
         int n = ArraySize(g_qualityPosIds);
         ArrayResize(g_qualityPosIds, n + 1);
         ArrayResize(g_qualityWorstPnl, n + 1);
         ArrayResize(g_qualityNegativeSince, n + 1);
         ArrayResize(g_qualityNegativeSec, n + 1);
         idx = n;
         g_qualityPosIds[idx] = posId;
         g_qualityWorstPnl[idx] = 0.0;
         g_qualityNegativeSince[idx] = 0;
         g_qualityNegativeSec[idx] = 0;
      }
      double pnl = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      if(pnl < g_qualityWorstPnl[idx]) g_qualityWorstPnl[idx] = pnl;
      if(pnl < 0.0)
      {
         if(g_qualityNegativeSince[idx] == 0) g_qualityNegativeSince[idx] = TimeCurrent();
         g_qualityNegativeSec[idx] = (int)(TimeCurrent() - g_qualityNegativeSince[idx]);
      }
      else
      {
         g_qualityNegativeSince[idx] = 0;
      }
   }
}

void XAU_PopTradeQuality(ulong posId, double &worstPnl, int &negativeSec)
{
   worstPnl = 0.0;
   negativeSec = 0;
   int idx = XAU_FindQualityIdx(posId);
   if(idx < 0) return;
   worstPnl = g_qualityWorstPnl[idx];
   negativeSec = g_qualityNegativeSec[idx];
   int n = ArraySize(g_qualityPosIds);
   for(int i = idx; i < n - 1; i++)
   {
      g_qualityPosIds[i] = g_qualityPosIds[i + 1];
      g_qualityWorstPnl[i] = g_qualityWorstPnl[i + 1];
      g_qualityNegativeSince[i] = g_qualityNegativeSince[i + 1];
      g_qualityNegativeSec[i] = g_qualityNegativeSec[i + 1];
   }
   ArrayResize(g_qualityPosIds, n - 1);
   ArrayResize(g_qualityWorstPnl, n - 1);
   ArrayResize(g_qualityNegativeSince, n - 1);
   ArrayResize(g_qualityNegativeSec, n - 1);
}

bool XAU_APlusPositioningQualified(double timingQuality, double lateProbability,
                                   double exhaustionProbability, double rrQuality,
                                   double directionalRoomATR, bool cleanContinuation,
                                   bool trueBreakoutContinuation)
{
   bool structureConfirmed = (cleanContinuation || trueBreakoutContinuation);
   return (timingQuality >= InpXAU_APlusMinTimingQuality &&
           lateProbability <= InpXAU_APlusMaxLateProb &&
           exhaustionProbability <= InpXAU_APlusMaxExhaustionProb &&
           rrQuality >= InpXAU_APlusMinRRQuality &&
           directionalRoomATR >= InpXAU_MinDirectionalRoomATR &&
           structureConfirmed);
}

bool XAUEntryTimingGuard(int signal, string setupName, double setupScore, double combinedScore,
                         string &grade, double &lotMulti, string &reason)
{
   lotMulti = 1.0;
   reason = "";
   if(!InpXAU_TimingGuard || signal == 0) return true;
   if(!IsXAUFastSymbol()) return true;
   if(ArraySize(bufATR) < 2 || ArraySize(bufEMAFast) < 2 || bufATR[1] <= 0.0 || bufEMAFast[1] <= 0.0)
   {
      reason = "timing data not ready";
      return true;
   }

   double atr = bufATR[1];
   double avgAtr = XAU_AvgATR(40);
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   double close2 = iClose(Symbol(), PERIOD_M5, 2);
   double close4 = iClose(Symbol(), PERIOD_M5, 4);
   double open1  = iOpen(Symbol(), PERIOD_M5, 1);
   double high1  = iHigh(Symbol(), PERIOD_M5, 1);
   double low1   = iLow(Symbol(), PERIOD_M5, 1);
   double ema50  = bufEMAFast[1];
   double vwap   = XAU_SessionVWAP(96);
   if(close1 <= 0 || open1 <= 0 || high1 <= 0 || low1 <= 0 || ema50 <= 0) return true;

   double body = MathAbs(close1 - open1);
   double range = MathMax(high1 - low1, 0.0);
   double upperWick = high1 - MathMax(open1, close1);
   double lowerWick = MathMin(open1, close1) - low1;
   double impulseATR = range / atr;
   double bodyATR = body / atr;
   double atrExpansion = (avgAtr > 0.0) ? atr / avgAtr : 1.0;
   double emaDistATR = MathAbs(close1 - ema50) / atr;
   double vwapDistATR = (vwap > 0.0) ? MathAbs(close1 - vwap) / atr : 0.0;
   double threeBarDriveATR = (close4 > 0.0) ? MathAbs(close1 - close4) / atr : 0.0;
   double extensionResetATR = 0.0;
   double extensionDriveATR = XAU_DirectionalExtensionATR(signal, InpXAU_ExtensionLookbackBars, atr, extensionResetATR);

   double hi6 = high1, lo6 = low1;
   for(int i = 1; i <= 6; i++)
   {
      hi6 = MathMax(hi6, iHigh(Symbol(), PERIOD_M5, i));
      lo6 = MathMin(lo6, iLow(Symbol(), PERIOD_M5, i));
   }

   int locLookback = (int)MathMax(6.0, MathMin((double)InpXAU_BadLocationLookbackBars, 30.0));
   double locHigh = high1, locLow = low1;
   for(int i = 1; i <= locLookback; i++)
   {
      double h = iHigh(Symbol(), PERIOD_M5, i);
      double l = iLow(Symbol(), PERIOD_M5, i);
      if(h > 0.0) locHigh = MathMax(locHigh, h);
      if(l > 0.0) locLow = MathMin(locLow, l);
   }
   double locRange = MathMax(locHigh - locLow, atr * 0.10);
   double locPct = (locRange > 0.0) ? (close1 - locLow) / locRange : 0.50;
   locPct = MathMax(0.0, MathMin(1.0, locPct));
   double lowClearanceATR = MathMax((close1 - locLow) / atr, 0.0);
   double highClearanceATR = MathMax((locHigh - close1) / atr, 0.0);
   double extremePct = MathMax(5.0, MathMin(InpXAU_ExtremeLocationPct, 45.0)) / 100.0;

   int failLookback = (int)MathMax(4.0, MathMin((double)InpXAU_FailedImpulseLookbackBars, 24.0));
   double failHigh = high1, failLow = low1;
   int failHighShift = 1, failLowShift = 1;
   for(int i = 1; i <= failLookback; i++)
   {
      double h = iHigh(Symbol(), PERIOD_M5, i);
      double l = iLow(Symbol(), PERIOD_M5, i);
      if(h > 0.0 && h > failHigh) { failHigh = h; failHighShift = i; }
      if(l > 0.0 && l < failLow)  { failLow = l; failLowShift = i; }
   }
   double dropFromFailHighATR = MathMax((failHigh - close1) / atr, 0.0);
   double bounceFromFailLowATR = MathMax((close1 - failLow) / atr, 0.0);
   bool postSweepTrap = false;
   double dayGainPct = (dailyStartEquity > 0.0) ? ((accInfo.Equity() - dailyStartEquity) / dailyStartEquity * 100.0) : 0.0;
   bool cycleHot = (InpXAU_CycleGivebackArmor && dayGainPct >= InpXAU_CycleArmGainPct);
   double cycleExtremePct = MathMax(10.0, MathMin(InpXAU_CycleExtremePct, 45.0)) / 100.0;
   bool cycleExtremeLocation = false;
   bool failedImpulse = false;

   bool trendSetup = (StringFind(setupName, "TREND_PULLBACK") >= 0 ||
                      StringFind(setupName, "BREAKOUT") >= 0 ||
                      StringFind(setupName, "SQUEEZE") >= 0 ||
                      StringFind(setupName, "ASIA_BREAKOUT") >= 0);
   bool isA = (grade == "A" || StringFind(grade, "A+") >= 0);

   bool hasPullback = false;
   bool hasRejection = false;
   bool chasingAway = false;
   bool wrongCandle = false;
   bool betterValue = false;
   bool badLocation = false;
   double pullbackATR = 0.0;

   if(signal == -1)
   {
      // SELL continuation needs price to have pulled up away from recent lows.
      // The old logic used distance down from highs, which rewarded selling after
      // the dump. This uses low clearance/value instead.
      pullbackATR = lowClearanceATR;
      bool nearRecentLow = (locPct <= extremePct || lowClearanceATR < InpXAU_MinLowHighClearanceATR);
      betterValue = (pullbackATR >= InpXAU_MinPullbackValueATR &&
                     (close1 >= ema50 - atr * InpXAU_ValueAreaEMABufferATR ||
                      (vwap > 0.0 && close1 >= vwap - atr * InpXAU_ValueAreaVWAPBufferATR) ||
                      locPct >= 0.35));
      hasPullback = (pullbackATR >= InpXAU_MinPullbackATR ||
                     high1 >= ema50 - atr * 0.25 ||
                     close2 >= ema50 - atr * 0.35);
      if(trendSetup && InpXAU_RequirePullbackValueForTrend)
         hasPullback = (hasPullback && betterValue);
      hasRejection = ((upperWick >= MathMax(body * 0.45, atr * 0.08) && close1 <= open1) ||
                      (close1 < open1 && close1 < close2));
      chasingAway = (close1 < ema50 - atr * InpXAU_MaxEMADistanceATR);
      wrongCandle = (close1 > open1 && lowerWick < body * 0.35);
      badLocation = (nearRecentLow || (chasingAway && !betterValue));
      bool bounceAfterFlush = (bounceFromFailLowATR >= InpXAU_FailedImpulseRetraceATR &&
                               (close1 > open1 || close1 > close2) &&
                               !hasRejection);
      failedImpulse = bounceAfterFlush;
      postSweepTrap = (InpXAU_BlockPostSweepAPlus &&
                       failLowShift <= InpXAU_PostSweepLookbackBars &&
                       bounceFromFailLowATR >= InpXAU_PostSweepRetraceATR &&
                       close1 > failLow + atr * 0.35);
      cycleExtremeLocation = (locPct <= cycleExtremePct || bounceFromFailLowATR >= InpXAU_FailedImpulseRetraceATR);
   }
   else
   {
      // BUY continuation needs price to have pulled down away from recent highs.
      pullbackATR = highClearanceATR;
      bool nearRecentHigh = (locPct >= (1.0 - extremePct) || highClearanceATR < InpXAU_MinLowHighClearanceATR);
      betterValue = (pullbackATR >= InpXAU_MinPullbackValueATR &&
                     (close1 <= ema50 + atr * InpXAU_ValueAreaEMABufferATR ||
                      (vwap > 0.0 && close1 <= vwap + atr * InpXAU_ValueAreaVWAPBufferATR) ||
                      locPct <= 0.65));
      hasPullback = (pullbackATR >= InpXAU_MinPullbackATR ||
                     low1 <= ema50 + atr * 0.25 ||
                     close2 <= ema50 + atr * 0.35);
      if(trendSetup && InpXAU_RequirePullbackValueForTrend)
         hasPullback = (hasPullback && betterValue);
      hasRejection = ((lowerWick >= MathMax(body * 0.45, atr * 0.08) && close1 >= open1) ||
                      (close1 > open1 && close1 > close2));
      chasingAway = (close1 > ema50 + atr * InpXAU_MaxEMADistanceATR);
      wrongCandle = (close1 < open1 && upperWick < body * 0.35);
      badLocation = (nearRecentHigh || (chasingAway && !betterValue));
      bool dropAfterSpike = (dropFromFailHighATR >= InpXAU_FailedImpulseRetraceATR &&
                             (close1 < open1 || close1 < close2) &&
                             !hasRejection);
      failedImpulse = dropAfterSpike;
      postSweepTrap = (InpXAU_BlockPostSweepAPlus &&
                       failHighShift <= InpXAU_PostSweepLookbackBars &&
                       dropFromFailHighATR >= InpXAU_PostSweepRetraceATR &&
                       close1 < failHigh - atr * 0.35);
      cycleExtremeLocation = (locPct >= (1.0 - cycleExtremePct) || dropFromFailHighATR >= InpXAU_FailedImpulseRetraceATR);
   }

   bool impulseBlock = (impulseATR >= InpXAU_ImpulseATRBlock && bodyATR >= 0.65);
   bool impulseWarn  = (impulseATR >= InpXAU_ImpulseATRDowngrade || atrExpansion >= 1.45);
   bool vwapFar = (vwap > 0.0 && vwapDistATR > InpXAU_MaxVWAPDistanceATR);
   bool driveFar = (threeBarDriveATR > InpXAU_MaxThreeBarDriveATR);
   bool cleanContinuation = (hasPullback && hasRejection && !wrongCandle && !badLocation);
   bool locationBlock = (trendSetup && badLocation && !cleanContinuation);
   bool extensionNoReset = (trendSetup &&
                            extensionDriveATR >= InpXAU_MaxExtensionDriveATR &&
                            extensionResetATR < InpXAU_MinExtensionResetATR);
   bool failedImpulseBlock = (trendSetup && InpXAU_BlockFailedImpulse && failedImpulse && !cleanContinuation);
   bool cycleGivebackBlock = (trendSetup && cycleHot && cycleExtremeLocation && !cleanContinuation);
   bool cycleLotReduce = (trendSetup && cycleHot);
   bool trueBreakoutContinuation = IsXAUConfirmedBreakoutContinuation(signal, setupName);
   double directionalRoomATR = (signal == -1) ? lowClearanceATR : highClearanceATR;
   bool nearLiquiditySweep = (directionalRoomATR < InpXAU_MinDirectionalRoomATR);
   bool sameFirstSignal = (InpXAU_FirstSignalMemory &&
                           g_signalFirstSeenTime > 0 &&
                           g_signalFirstSeenDir == signal &&
                           g_signalFirstSeenSetup == setupName);
   double missedMoveDistance = 0.0;
   double missedMoveATRFromFirst = 0.0;
   int candlesSinceSignal = 0;
   if(sameFirstSignal)
   {
      missedMoveDistance = signal > 0 ? (close1 - g_signalFirstSeenPrice)
                                      : (g_signalFirstSeenPrice - close1);
      double anchorAtr = MathMax(atr, g_signalFirstATR);
      missedMoveATRFromFirst = anchorAtr > 0.0 ? missedMoveDistance / anchorAtr : 0.0;
      candlesSinceSignal = (int)((TimeCurrent() - g_signalFirstSeenTime) / 300);
   }
   bool signalPlayedOut = (trendSetup && sameFirstSignal &&
                           missedMoveDistance > 0.0 &&
                           (missedMoveATRFromFirst >= InpXAU_MaxMissedMoveATR ||
                            missedMoveDistance >= InpXAU_MaxMissedMoveUSD ||
                            candlesSinceSignal > InpXAU_MaxSignalAgeBars));
   bool realLateRetest = (cleanContinuation &&
                          pullbackATR >= InpXAU_MinLateRetestATR &&
                          !chasingAway &&
                          emaDistATR <= InpXAU_MaxEMADistanceATR * 1.15 &&
                          (vwap <= 0.0 || vwapDistATR <= InpXAU_MaxVWAPDistanceATR * 1.10));
   bool lateChaseEntry = (signalPlayedOut && !realLateRetest);
   bool spikeCooldown = (trendSetup &&
                         extensionDriveATR >= MathMax(InpXAU_MaxExtensionDriveATR, InpXAU_MaxMissedMoveATR) &&
                         extensionResetATR < InpXAU_MinLateRetestATR &&
                         candlesSinceSignal <= MathMax(2, InpXAU_MaxSignalAgeBars));
   bool missedMove = (trendSetup &&
                      extensionDriveATR >= InpXAU_MissedMoveDriveATR &&
                      extensionResetATR < InpXAU_MinExtensionResetATR &&
                      !cleanContinuation);
   double exhaustionProb = 0.0;
   if(badLocation) exhaustionProb += 28.0;
   if(failedImpulse) exhaustionProb += 24.0;
   if(postSweepTrap) exhaustionProb += 30.0;
   if(extensionNoReset || missedMove) exhaustionProb += 18.0;
   if(impulseWarn) exhaustionProb += 10.0;
   if(vwapFar) exhaustionProb += 8.0;
   if(wrongCandle) exhaustionProb += 12.0;
   if(nearLiquiditySweep) exhaustionProb += 16.0;
   if(lateChaseEntry) exhaustionProb += 32.0;
   if(spikeCooldown) exhaustionProb += 22.0;
   if(!hasPullback) exhaustionProb += 10.0;
   if(cleanContinuation) exhaustionProb -= 25.0;
   exhaustionProb = MathMax(0.0, MathMin(100.0, exhaustionProb));

   double lateEntryProb = 0.0;
   if(chasingAway) lateEntryProb += 25.0;
   if(driveFar) lateEntryProb += 20.0;
   if(impulseWarn) lateEntryProb += 15.0;
   if(extensionDriveATR >= InpXAU_MissedMoveDriveATR) lateEntryProb += 18.0;
   if(!betterValue) lateEntryProb += 12.0;
   if(nearLiquiditySweep) lateEntryProb += 15.0;
   if(postSweepTrap) lateEntryProb += 20.0;
   if(signalPlayedOut) lateEntryProb += 30.0;
   if(spikeCooldown) lateEntryProb += 20.0;
   if(cleanContinuation) lateEntryProb -= 30.0;
   lateEntryProb = MathMax(0.0, MathMin(100.0, lateEntryProb));

   double entryEfficiency = 100.0;
   entryEfficiency -= lateEntryProb * 0.45;
   entryEfficiency -= exhaustionProb * 0.35;
   if(!hasPullback) entryEfficiency -= 10.0;
   if(!hasRejection) entryEfficiency -= 8.0;
   if(betterValue) entryEfficiency += 8.0;
   if(cleanContinuation) entryEfficiency += 12.0;
   entryEfficiency = MathMax(0.0, MathMin(100.0, entryEfficiency));

   double rrQuality = MathMin(100.0, (directionalRoomATR / MathMax(0.10, InpXAU_MinDirectionalRoomATR)) * 45.0);
   if(cleanContinuation) rrQuality = MathMin(100.0, rrQuality + 20.0);
   if(missedMove || failedImpulse || lateChaseEntry) rrQuality = MathMax(0.0, rrQuality - 25.0);

   string timingState = locationBlock ? "bad-location" : (cleanContinuation ? "clean-pullback" : "weak-timing");
   if(extensionNoReset) timingState = "extended-no-reset";
   if(failedImpulseBlock) timingState = "failed-impulse";
   if(cycleGivebackBlock) timingState = "cycle-giveback";
   if(signalPlayedOut) timingState = realLateRetest ? "missed-move-retest" : "late-chase-entry";
   if(missedMove && timingState == "weak-timing") timingState = "missed-move";
   bool severeLate = trendSetup && chasingAway && (impulseBlock || driveFar || vwapFar) && !cleanContinuation;
   bool moderateLate = trendSetup && (chasingAway || impulseWarn || driveFar || vwapFar || !hasPullback || wrongCandle) && !cleanContinuation;

   if(InpXAU_TimingQualityGrades && trendSetup && (grade == "A" || StringFind(grade, "A+") >= 0))
   {
      bool wasAPlus = (StringFind(grade, "A+") >= 0);
      bool aPlusQualified = XAU_APlusPositioningQualified(entryEfficiency, lateEntryProb,
                                                          exhaustionProb, rrQuality,
                                                          directionalRoomATR,
                                                          cleanContinuation,
                                                          trueBreakoutContinuation);
      bool aPlusBadTiming = (wasAPlus && (!aPlusQualified ||
	                                      missedMove || failedImpulse || postSweepTrap ||
	                                      nearLiquiditySweep || lateChaseEntry));
      bool aBadRR = (rrQuality < 35.0 && (missedMove || nearLiquiditySweep || failedImpulse || postSweepTrap || lateChaseEntry));
      if(aPlusBadTiming)
      {
         string oldGrade = grade;
         grade = "A";
         lotMulti *= MathMin(0.80, InpXAU_FairTimingLotMulti);
         reason = StringFormat("A+ EVIDENCE DEMOTION: %s→A because score strength was not matched by clean positioning. Trade remains eligible at A-size; this is an honest grade correction, not another veto. timingQ=%.0f late=%.0f%% exhaustion=%.0f%% rrQ=%.0f cleanContinuation=%s breakoutContinuation=%s missedMove=%s lateChase=%s failedImpulse=%s postSweep=%s liquidityDist=%.2fATR. ",
                               oldGrade, entryEfficiency, lateEntryProb, exhaustionProb, rrQuality,
                               cleanContinuation ? "Y" : "N", trueBreakoutContinuation ? "Y" : "N",
                               missedMove ? "Y" : "N", lateChaseEntry ? "Y" : "N", failedImpulse ? "Y" : "N",
                               postSweepTrap ? "Y" : "N", directionalRoomATR);
      }
      if(wasAPlus && postSweepTrap && InpXAU_BlockLateA)
      {
         reason += StringFormat("POST-SWEEP A+ BLOCK: gold swept local liquidity then snapped back; not allowing A+ continuation chase until a fresh pullback/retest forms. timingQ=%.0f late=%.0f%% exhaustion=%.0f%% rrQ=%.0f liquidityDist=%.2fATR. ",
                                entryEfficiency, lateEntryProb, exhaustionProb, rrQuality, directionalRoomATR);
         return false;
      }
      if(aBadRR && InpXAU_BlockLateA)
      {
         reason += StringFormat("BAD-RR TIMING BLOCK: A/A+ continuation has poor directional room after the move already travelled; waiting for fresh pullback/retest. timingQ=%.0f late=%.0f%% exhaustion=%.0f%% rrQ=%.0f liquidityDist=%.2fATR missedMove=%s lateChase=%s failedImpulse=%s postSweep=%s. ",
                                entryEfficiency, lateEntryProb, exhaustionProb, rrQuality,
                                directionalRoomATR, missedMove ? "Y" : "N", lateChaseEntry ? "Y" : "N", failedImpulse ? "Y" : "N",
                                postSweepTrap ? "Y" : "N");
         return false;
      }
   }

   reason += StringFormat("XAU-TIMING: setup=%s grade=%s setupScore=%.1f combined=%.1f timing=%s timingQ=%.0f lateProb=%.0f%% exhaustion=%.0f%% rrQ=%.0f signalFirstSeenPrice=%.2f entryPrice=%.2f missedMoveDistance=%.2f missedMoveATR=%.2f candlesSinceSignal=%d reasonBlockedAtFirstSignal=%s lateEntryVeto=%s spikeDetected=%s lotReductionReason=%s whyTradeAllowedAfterDelay=%s liquidityDist=%.2fATR expansionOrigin=%.2fATR expectedPullback=%.2fATR emaDist=%.2fATR vwapDist=%.2fATR impulse=%.2fATR body=%.2fATR atrExp=%.2fx drive3=%.2fATR drive%d=%.2fATR reset=%.2fATR pullbackFromExtreme=%.2fATR loc=%.0f%% lowClr=%.2fATR highClr=%.2fATR value=%s badLoc=%s rejection=%s wrongCandle=%s dayGain=%.1f%% cycle=%s failedImpulse=%s postSweep=%s missedMove=%s dropHigh=%.2fATR(%d) bounceLow=%.2fATR(%d)",
                         setupName, grade, setupScore, combinedScore, timingState,
                         entryEfficiency, lateEntryProb, exhaustionProb, rrQuality,
                         sameFirstSignal ? g_signalFirstSeenPrice : 0.0, close1,
                         missedMoveDistance, missedMoveATRFromFirst, candlesSinceSignal,
                         StringLen(g_signalFirstBlockReason) > 0 ? XAU_BlockReasonKey(g_signalFirstBlockReason) : "none",
                         lateChaseEntry ? "Y" : "N",
                         (spikeCooldown || impulseBlock) ? "Y" : "N",
                         signalPlayedOut ? (realLateRetest ? "late-retest-small-lot" : "missed-move-block") : "none",
                         signalPlayedOut ? (realLateRetest ? "real-retest-structure-confirmed" : "not-allowed-move-played-out") : "fresh-signal",
                         directionalRoomATR, extensionDriveATR, InpXAU_MinExtensionResetATR,
                         emaDistATR, vwapDistATR, impulseATR, bodyATR, atrExpansion,
                         threeBarDriveATR, InpXAU_ExtensionLookbackBars, extensionDriveATR, extensionResetATR,
                         pullbackATR, locPct * 100.0, lowClearanceATR, highClearanceATR,
                         betterValue ? "yes" : "no",
                         badLocation ? "yes" : "no",
                         hasRejection ? "yes" : "no",
                         wrongCandle ? "yes" : "no",
                         dayGainPct,
                         cycleHot ? "armed" : "off",
                         failedImpulse ? "yes" : "no",
                         postSweepTrap ? "yes" : "no",
                         missedMove ? "yes" : "no",
                         dropFromFailHighATR, failHighShift,
                         bounceFromFailLowATR, failLowShift);

   if(lateChaseEntry && InpXAU_BlockLateA)
   {
      reason = StringFormat("LATE-CHASE ENTRY BLOCK: first %s %s was seen at %.2f, current entry %.2f after %.2f (%.2fATR) and %d M5 candles; the move already played out, so no full-size A/A+ chase without real pullback/retest/structure. ",
                            signal == 1 ? "BUY" : "SELL", setupName,
                            g_signalFirstSeenPrice, close1, missedMoveDistance,
                            missedMoveATRFromFirst, candlesSinceSignal) + reason;
      int memSamples = 0;
      double memWR = 0.0, memFav = 0.0, memAdv = 0.0;
      string memWhy = "";
      bool memorySupportsScout = XAU_BlockedMemoryEdgeSupportsScout(setupName, signal, reason,
                                                                    memSamples, memWR, memFav, memAdv, memWhy) &&
                                 !spikeCooldown &&
                                 entryEfficiency >= 35.0 &&
                                 exhaustionProb <= 78.0 &&
                                 directionalRoomATR >= 0.35;
      if(memorySupportsScout)
      {
         string oldGrade = grade;
         lotMulti *= InpBlockedMemoryScoutLotMulti;
         grade = DowngradeGradeOneStep(grade);
         reason = StringFormat("REPORT-FIT SCOUT: LATE-CHASE hard block is expensive in memory (%s); allowing tiny scout only %s→%s lot x%.2f, not full-size chase. ",
                               memWhy, oldGrade, grade, lotMulti) + reason;
         return true;
      }
      return false;
   }

   if(signalPlayedOut && realLateRetest)
   {
      string oldGrade = grade;
      lotMulti *= InpXAU_ExtremeLateLotMulti;
      grade = DowngradeGradeOneStep(grade);
      reason = StringFormat("MISSED-MOVE RETEST: same idea already travelled %.2f (%.2fATR) from first signal; retest is valid but size forced x%.2f and %s→%s. ",
                            missedMoveDistance, missedMoveATRFromFirst,
                            InpXAU_ExtremeLateLotMulti, oldGrade, grade) + reason;
   }

   if(locationBlock)
   {
      reason = StringFormat("BAD-LOCATION BLOCK: %s is too close to the recent %s after movement; waiting for pullback into value area + rejection. ",
                            signal == -1 ? "SELL" : "BUY",
                            signal == -1 ? "low" : "high") + reason;
      int memSamples = 0;
      double memWR = 0.0, memFav = 0.0, memAdv = 0.0;
      string memWhy = "";
      bool memorySupportsScout = XAU_BlockedMemoryEdgeSupportsScout(setupName, signal, reason,
                                                                    memSamples, memWR, memFav, memAdv, memWhy) &&
                                 entryEfficiency >= 38.0 &&
                                 exhaustionProb <= 82.0 &&
                                 !spikeCooldown;
      if(memorySupportsScout)
      {
         string oldGrade = grade;
         lotMulti *= InpBlockedMemoryScoutLotMulti;
         grade = DowngradeGradeOneStep(grade);
         reason = StringFormat("REPORT-FIT SCOUT: BAD-LOCATION block has been too expensive in memory (%s); allowing controlled tiny scout %s→%s lot x%.2f instead of blind hard block. ",
                               memWhy, oldGrade, grade, lotMulti) + reason;
         return true;
      }
      return false;
   }

   if(extensionNoReset)
   {
      reason = "BAD-TIMING BLOCK: extended XAU move has not reset yet; waiting for pullback before another same-direction entry. " + reason;
      return false;
   }

   if(failedImpulseBlock)
   {
      reason = StringFormat("FAILED-IMPULSE BLOCK: %s is trying to join after gold already rejected the latest %s; waiting for fresh pullback continuation instead. ",
                            signal == 1 ? "BUY" : "SELL",
                            signal == 1 ? "spike high" : "flush low") + reason;
      int memSamples = 0;
      double memWR = 0.0, memFav = 0.0, memAdv = 0.0;
      bool memorySupportsScout = XAU_BlockedMemoryStats(setupName, signal, reason,
                                                        memSamples, memWR, memFav, memAdv) &&
                                 memWR >= 70.0 && memFav >= 1.80 && memAdv <= 1.00 &&
                                 !lateChaseEntry && !spikeCooldown;
      if(memorySupportsScout)
      {
         string oldGrade = grade;
         lotMulti *= InpXAU_ExtremeLateLotMulti;
         grade = DowngradeGradeOneStep(grade);
         reason = StringFormat("BLOCKED-MEMORY SCOUT: failed-impulse blocks for this pattern have worked after block (samples=%d WR=%.0f%% avgFav=%.2fATR avgAdv=%.2fATR), so allowing controlled scout %s→%s lot x%.2f. ",
                               memSamples, memWR, memFav, memAdv,
                               oldGrade, grade, lotMulti) + reason;
         return true;
      }
      return false;
   }

   if(cycleGivebackBlock)
   {
      reason = StringFormat("CYCLE-GIVEBACK BLOCK: day already up %.1f%%; entry is near an exhaustion zone without clean continuation, so protecting session profit. ",
                            dayGainPct) + reason;
      return false;
   }

	   if(severeLate && (InpXAU_BlockLateA || !cleanContinuation))
	   {
	      reason = "BAD-TIMING BLOCK: late gold chase / overextended entry. " + reason +
	               " | wait for retracement + rejection before entering.";
	      return false;
	   }

	   if(InpXAU_RequireExcellentDamageTiming && trendSetup && !cleanContinuation && !trueBreakoutContinuation)
	   {
	      reason = "DAMAGE-SETUP QUALITY BLOCK: trend/breakout setup is not a clean pullback and not a confirmed breakout continuation. " +
	               reason + " | waiting for a cleaner entry instead of taking a fair/late reduced-lot trade.";
	      return false;
	   }

	   if(moderateLate)
	   {
      string oldGrade = grade;
      lotMulti *= InpXAU_FairTimingLotMulti;
      if(cycleLotReduce)
         lotMulti *= InpXAU_CycleLotMulti;
      grade = DowngradeGradeOneStep(grade);
      reason = StringFormat("BAD-TIMING SOFT: %s downgraded %s→%s, lot x%.2f. ",
                            signal == 1 ? "BUY" : "SELL", oldGrade, grade, lotMulti) + reason;
      if(grade == "SKIP")
      {
         reason = "BAD-TIMING BLOCK: B-grade timing was only fair/late, skipped instead of forcing entry. " + reason;
         return false;
      }
      return true;
   }

   if(cycleLotReduce)
   {
      lotMulti *= InpXAU_CycleLotMulti;
      reason = StringFormat("CYCLE ARMOR SOFT: dayGain %.1f%%, lot x%.2f so one late trade cannot wipe many wins. ",
                            dayGainPct, InpXAU_CycleLotMulti) + reason;
      if(grade == "B" && dayGainPct >= InpXAU_CycleBGradeDeepGainPct)
      {
         lotMulti *= InpXAU_CycleBGradeLotMulti;
         reason = StringFormat("REPORT-FIT B-CYCLE CUT: prior report loss was B-grade after a hot winning cycle; dayGain %.1f%% >= %.1f%% so B risk x%.2f extra. ",
                               dayGainPct, InpXAU_CycleBGradeDeepGainPct,
                               InpXAU_CycleBGradeLotMulti) + reason;
      }
   }

   if(isA && cleanContinuation)
      reason = "A-grade timing confirmed: pullback continuation entry, not late confirmation chase. " + reason;
   else
      reason = "ENTRY TIMING PASS: " + reason;
   return true;
}

// v5.3.0 — master pre-trade gate aggregator. Anything returned non-empty
// blocks new entries (but lets EXISTING positions trail/manage).
string PreTradeBlockReason(int signal, string setupName = "")
{
   string r;
   r = StartupCooldownReason();   if(StringLen(r) > 0) return "startup: "  + r;
   r = HardDailyDDReason();       if(StringLen(r) > 0) return "ddfloor: "  + r;
   r = VolatilityKillReason(signal, setupName); if(StringLen(r) > 0) return "volkill: "  + r;
   r = SpreadKillReason();        if(StringLen(r) > 0) return "spread: "   + r;
   if(IsMomentumWeak(signal) && !IsXAUConfirmedBreakoutContinuation(signal, setupName))
      return "momentum slowdown (close in opposite 30% of last 3-bar range)";
   if(HasExhaustionDivergence(signal)) return "RSI divergence (exhaustion vs price extreme)";
   if(IsFakeBreakout(signal))     return "fake breakout (last close back inside Donchian-20)";
   return "";
}

bool IsXAUFastSymbol()
{
   string s = Symbol();
   StringToUpper(s);
   return (StringFind(s, "XAU") >= 0 || StringFind(s, "GOLD") >= 0);
}

string TFShortName(ENUM_TIMEFRAMES tf)
{
   if(tf == PERIOD_M5)  return "M5";
   if(tf == PERIOD_M15) return "M15";
   if(tf == PERIOD_M30) return "M30";
   if(tf == PERIOD_H1)  return "H1";
   return EnumToString(tf);
}

int TFDirectionByEMA(int signal, ENUM_TIMEFRAMES tf, double atrThreshold, string &why)
{
   int hEMA = iMA(Symbol(), tf, 50, 0, MODE_EMA, PRICE_CLOSE);
   int loc_hATR = iATR(Symbol(), tf, 14);
   if(hEMA == INVALID_HANDLE || loc_hATR == INVALID_HANDLE)
   {
      why = TFShortName(tf) + ":DATA";
      return 0;
   }

   double ema[2], atr[2], close[2];
   bool ok = (CopyBuffer(hEMA, 0, 0, 2, ema) > 0 &&
              CopyBuffer(loc_hATR, 0, 0, 2, atr) > 0 &&
              CopyClose(Symbol(), tf, 0, 2, close) > 0);
   IndicatorRelease(hEMA);
   IndicatorRelease(loc_hATR);
   if(!ok || atr[0] <= 0.0)
   {
      why = TFShortName(tf) + ":WAIT";
      return 0;
   }

   double diff = close[0] - ema[0];
   double thr = atr[0] * atrThreshold;
   int dir = 0;
   if(diff > thr) dir = 1;
   else if(diff < -thr) dir = -1;

   string state = (dir == signal) ? "OK" : (dir == -signal ? "AGAINST" : "NEUTRAL");
   why = StringFormat("%s:%s diff=%.2f thr=%.2f", TFShortName(tf), state, diff, thr);
   return dir;
}

// v5.8.16 — shared adaptive confirmation engine.
// On XAU/GOLD, M5/M15/M30 carry the hard decision; H1 is soft context.
// Non-gold symbols retain the older strict M15+H1 behavior.
bool AdaptiveXAUConfirm(int signal, string gateName, double combinedScore, string grade,
                        double &lotMulti, string &reason, bool logDecision)
{
   lotMulti = 1.0;
   reason = "";
   if(signal == 0) { reason = "no direction"; return false; }

   bool xauFast = (InpXAU_AdaptiveConfirm && IsXAUFastSymbol());
   double tfThreshold = 0.30;
   bool fastRegime =
      (currentRegime == REGIME_TRENDING_UP || currentRegime == REGIME_TRENDING_DOWN ||
       currentRegime == REGIME_BREAKOUT_UP || currentRegime == REGIME_BREAKOUT_DOWN);
   bool choppyRegime =
      (currentRegime == REGIME_RANGING || currentRegime == REGIME_CHOPPY ||
       currentRegime == REGIME_LOW_VOL || currentRegime == REGIME_DEAD);

   if(fastRegime) tfThreshold = 0.20;
   if(choppyRegime) tfThreshold = 0.40;

   string m5Why, m15Why, m30Why, h1Why;
   int m5  = TFDirectionByEMA(signal, PERIOD_M5,  tfThreshold, m5Why);
   int m15 = TFDirectionByEMA(signal, PERIOD_M15, tfThreshold, m15Why);
   int m30 = TFDirectionByEMA(signal, PERIOD_M30, tfThreshold, m30Why);
   int h1  = TFDirectionByEMA(signal, PERIOD_H1,  tfThreshold, h1Why);

   if(!xauFast)
   {
      bool okLegacy = (m15 == signal && h1 == signal);
      reason = okLegacy
               ? "legacy strict M15+H1 aligned"
               : "legacy strict M15+H1 not aligned | " + m15Why + " | " + h1Why;
      return okLegacy;
   }

   double fastScore = 0.0;
   int fastAgainst = 0;
   if(m5 == signal) fastScore += 20.0; else if(m5 == -signal) fastAgainst++;
   if(m15 == signal) fastScore += 35.0; else if(m15 == -signal) fastAgainst++;
   if(m30 == signal) fastScore += 30.0; else if(m30 == -signal) fastAgainst++;

   double h1Soft = 0.0;
   bool h1Against = (h1 == -signal);
   bool h1Aligned = (h1 == signal);
   if(h1Aligned) h1Soft = 15.0;
   if(h1Against)
   {
      lotMulti *= InpXAU_H1PenaltyLotMulti;
      h1Soft = -InpXAU_H1PenaltyScore;
   }

   double totalScore = fastScore + h1Soft;
   double requiredFast = choppyRegime ? InpXAU_ChopMinScore : InpXAU_FastTrendMinScore;
   if(StringFind(gateName, "PYRAMID") >= 0)
      requiredFast = MathMax(requiredFast, 65.0);
   if(StringFind(gateName, "DAMAGE-B") >= 0)
      requiredFast = MathMax(requiredFast, 70.0);
   if(StringFind(gateName, "ANTI-BIAS") >= 0)
      requiredFast = MathMax(requiredFast, 65.0);
   if(StringFind(grade, "A+") >= 0)
      requiredFast = MathMax(InpXAU_FastTrendMinScore, requiredFast - 5.0);

   bool breakoutContinuation = IsXAUConfirmedBreakoutContinuation(signal, gateName);
   bool momentumBad = IsMomentumWeak(signal);
   // v5.8.51: when ALL fast TFs are aligned at near-maximum score and no TF opposes,
   // downgrade the momentum slowdown from a hard block to a lot penalty (x0.80).
   // Evidence: June 18 log showed a TREND_PULLBACK SELL with fastScore=85/85, all TFs OK,
   // H1 aligned, being hard-blocked solely because close was in top 30% of 3-bar M5 range
   // (a tiny local bounce within a clearly confirmed downtrend). This costs profitable trades.
   // Hard block is preserved when fastScore < 80 or any fast TF is actively against us.
   bool momentumSoftMode = (momentumBad && !breakoutContinuation &&
                            fastScore >= 80.0 && fastAgainst == 0);
   bool momentumHardBlock = (momentumBad && !breakoutContinuation && !momentumSoftMode);
   if(momentumBad && breakoutContinuation)
      lotMulti *= 0.85; // still respect the warning, but do not kill a real gold flush.
   else if(momentumSoftMode)
      lotMulti *= 0.80; // max-alignment soft pass: reduce size, do not block

   bool allow = (fastScore >= requiredFast && fastAgainst < 2 && !momentumHardBlock);

   string h1Text = h1Against
                   ? "H1 disagreement treated as soft penalty"
                   : (h1Aligned ? "H1 aligned bonus" : "H1 neutral soft context");
   reason = StringFormat("Fast gold mode enabled | gate=%s | fastScore=%.0f/85 required=%.0f total=%.0f | %s | lotPenalty=%.2f | %s | %s | %s | %s",
                         gateName, fastScore, requiredFast, totalScore, h1Text, lotMulti,
                         m5Why, m15Why, m30Why, h1Why);

   if(!allow)
   {
      if(fastAgainst >= 2)
         reason = "Trade blocked due to weak fast-timeframe confirmation: multiple fast TFs against | " + reason;
      else if(momentumHardBlock)
         reason = "Trade blocked due to weak fast-timeframe confirmation: momentum slowdown | " + reason;
      else
         reason = "Trade blocked due to weak fast-timeframe confirmation: score below adaptive floor | " + reason;
   }
   else if(momentumBad && breakoutContinuation)
      reason = "Trade allowed because confirmed XAU breakout continuation overrides momentum-slowdown hard veto; lot reduced x0.85 | " + reason;
   else if(momentumSoftMode)
      reason = "Trade allowed at x0.80 size: strong fast-TF consensus (all aligned, score " + DoubleToString(fastScore,0) + "/85) overrides momentum-slowdown (soft mode); lot reduced to protect against local bounce | " + reason;
   else if(h1Against)
      reason = "Trade allowed due to strong M5/M15/M30 momentum; H1 not aligned but ignored as soft context for XAU fast mode | " + reason;
   else
      reason = "Trade allowed because M5/M15/M30 momentum align | " + reason;

   if(logDecision && InpXAU_LogAdaptiveConfirm && TimeCurrent() - g_lastAdaptiveConfirmLog >= 45)
   {
      Print("ADAPTIVE-CONFIRM: ", allow ? "ALLOW — " : "BLOCK — ", reason);
      g_lastAdaptiveConfirmLog = TimeCurrent();
   }
   return allow;
}

// Backwards-compatible name used by older gates. On XAU it now calls the
// adaptive fast-gold engine; H1 is no longer a hard blocker.
bool PG_HTFAlignedM15H1(int signal)
{
   double lm;
   string why;
   bool ok = AdaptiveXAUConfirm(signal, "SHARED", 0.0, "", lm, why, true);
   g_adaptiveConfirmLotMulti = lm;
   g_adaptiveConfirmReason = why;
   return ok;
}

// Returns "" if OK to open, otherwise the reason to block.
// signal: +1 buy, -1 sell. grade: "A+","A","B"... (we keep counter-trend open for A+ only).
// v5.1.3: when InpProfitGuardian=false but InpProfitLock=true, ONLY the day-halt
// (escalating giveback brake) blocks new entries — restores v4.9.7 trading aggression.
// v5.1.9: replaces day-halt with Selective Mode (A/A+ only, lot reduction).
string PG_BlockReason(int signal, string grade, double combinedScore, string setupName = "")
{
   // v5.3.0 — Phase 1-3 master gate. Aggregates startup cooldown + DD floor +
   // volatility/spread kill + RSI divergence + momentum slowdown + fake breakout.
   string preBlock = PreTradeBlockReason(signal, setupName);
   if(StringLen(preBlock) > 0)
      return "Trade blocked — " + preBlock;

   // v5.8.50: cooldown is independent of Profit Guardian. It pauses only fresh
   // entries; OnTick continues market monitoring and open-position management.
   if(pg_pauseUntil > 0 && TimeCurrent() < pg_pauseUntil)
   {
      int secs = (int)(pg_pauseUntil - TimeCurrent());
      return StringFormat("COOLDOWN_ACTIVE | Reason=consecutive-loss/profit-lock pause | LossCount=%d | PauseUntil=%s | Remaining=%d:%02d | ResumeCondition=time elapsed",
                          pg_consecutiveLosses,
                          TimeToString(pg_pauseUntil, TIME_DATE|TIME_MINUTES),
                          secs/60, secs%60);
   }

   // v5.3.1 — Soft DD mode: keep trading but A/A+ only with high score.
   //   This REPLACES the old -3% hard halt that was killing recovery cycles.
   if(IsSoftDDMode())
   {
      bool isAGrade = (StringCompare(grade, "A") == 0 || StringFind(grade, "A+") >= 0);
      if(!isAGrade)
         return StringFormat("soft-DD mode (%.1f%% drawdown) — only A/A+ allowed, this is %s",
                             (accInfo.Equity() - dailyStartEquity) / dailyStartEquity * 100.0, grade);
      if(combinedScore < InpPG_SelectiveMinScore)
         return StringFormat("soft-DD mode — combined %.1f < min %.1f required",
                             combinedScore, InpPG_SelectiveMinScore);
   }

   if(!InpProfitGuardian && !InpProfitLock) return "";
   PG_UpdateHWM();

   // 1a. Selective Mode active — allow only A/A+ with strict score + HTF alignment.
   if(pg_selectiveActive)
   {
      bool isAPlus = (StringFind(grade, "A+") >= 0);
      bool isA     = (grade == "A" || isAPlus);
      if(!isA)
      {
         pg_selectiveSkippedCnt++;
         return StringFormat("PG selective: only A/A+ allowed, this trade is grade %s (skipped %d sub-A so far)",
                             grade, pg_selectiveSkippedCnt);
      }
      if(combinedScore < InpPG_SelectiveMinScore)
      {
         pg_selectiveSkippedCnt++;
         return StringFormat("PG selective: combined score %.1f < min %.1f required while restricted",
                             combinedScore, InpPG_SelectiveMinScore);
      }
      double pgConfirmLot = 1.0;
      string pgConfirmWhy = "";
      if(InpPG_SelectiveRequireHTF &&
         !AdaptiveXAUConfirm(signal, "PG-SELECTIVE", combinedScore, grade,
                             pgConfirmLot, pgConfirmWhy, true))
      {
         pg_selectiveSkippedCnt++;
         return "PG selective: adaptive fast confirmation failed — " + pgConfirmWhy;
      }
      // Passed all selective gates → trade may proceed (lot reduction applied at OpenTrade)
   }

   // When Profit Guardian master is OFF, skip everything below — v4.9.7 trading style.
   if(!InpProfitGuardian) return "";

   // 2. Tier 3 (no new lots, just trail)
   int tier = PG_Tier();
   if(tier >= 3) return "PG tier3 (>=75% daily gain — preservation mode, no new entries)";

   // 3. HTF trend lock — block counter-trend unless A+ grade
   int htf = PG_HTFTrend();
   bool isAPlusOuter = (StringFind(grade, "A+") >= 0);
   if(htf == +1 && signal == -1 && !isAPlusOuter)
      return "PG HTF lock (M30 strong UP — sells blocked, A+ only would pass)";
   if(htf == -1 && signal == +1 && !isAPlusOuter)
      return "PG HTF lock (M30 strong DOWN — buys blocked, A+ only would pass)";

   // 5. Tier 2 — v6.3.2: allow A AND A+ through (only block B-grade at Tier 2).
   // A-grade setups (score 4.0-5.4) scored through every structural gate and deserve
   // to run on good days — blocking them at Tier 2 was capping earning on the bot's
   // best days.
   bool isAOuter = (grade == "A" || isAPlusOuter);
   if(tier >= 2 && !isAOuter)
      return "PG tier2 (>=50% daily gain — A/A+ pass, B-grade blocked)";

   // Log tier transitions once
   if(tier != pg_lastReportedTier)
   {
      Print("🛡 PROFIT GUARDIAN tier=", tier, " HWM=$",
            DoubleToString(pg_dayHWM,2), " gain=",
            DoubleToString((accInfo.Equity()-dailyStartEquity)/dailyStartEquity*100.0,1),
            "% effGiveback=",
            DoubleToString(PG_HWMGivebackPctEffective((accInfo.Equity()-dailyStartEquity)/dailyStartEquity*100.0),1), "%");
      pg_lastReportedTier = tier;
   }
   return "";
}

// Called when a basket flush happens. lossPct is % of starting equity given back.
// v5.1.2 — adaptive cooldown: 1 loss=base, 2 consecutive=3×, 3+=8×.
int PG_AdaptiveCooldownMin()
{
   if(!InpPG_AdaptiveCooldown) return InpPG_PostLossCooldown;
   if(pg_consecutiveLosses >= 3) return InpPG_PostLossCooldown * 8;   // 240 min default
   if(pg_consecutiveLosses == 2) return InpPG_PostLossCooldown * 3;   //  90 min default
   return InpPG_PostLossCooldown;                                     //  30 min default
}

void PG_OnBasketLoss(double lossPct)
{
   if(!InpProfitGuardian) return;
   pg_consecutiveLosses++;
   if(lossPct >= 5.0 && InpPG_PostLossCooldown > 0)
   {
      int cdMin = PG_AdaptiveCooldownMin();
      pg_pauseUntil = TimeCurrent() + cdMin * 60;
      Print("🛡 PROFIT GUARDIAN: Adaptive cooldown ", cdMin,
            "min triggered (basket loss ", DoubleToString(lossPct,2),
            "% of balance, consecutive=", pg_consecutiveLosses, ").");
   }
}

// Call this when a TP / winner closes — keeps consecutive-loss streak honest.
void PG_OnBasketWin()
{
   if(pg_consecutiveLosses != 0)
   {
      Print("🛡 PROFIT GUARDIAN: winner reset cooldown streak (was ",
            pg_consecutiveLosses, ").");
      pg_consecutiveLosses = 0;
   }
}

void RegisterClosedTradeCooldown(bool wasWin, bool wasLoss, double profit)
{
   if(wasWin)
   {
      PG_OnBasketWin();
      return;
   }
   if(!wasLoss) return;

   datetime now = TimeCurrent();
   if(pg_lastLossCycleAt > 0 && now - pg_lastLossCycleAt <= MathMax(1, InpLossCycleDedupSec))
   {
      Print("COOLDOWN LOSS DEDUP: layered close $", DoubleToString(profit, 2),
            " belongs to the same basket cycle; consecutive count remains ",
            pg_consecutiveLosses, ".");
      return;
   }

   pg_lastLossCycleAt = now;
   pg_consecutiveLosses++;
   if(pg_consecutiveLosses >= 2 && InpTwoLossCooldownMin > 0)
   {
      pg_pauseUntil = now + InpTwoLossCooldownMin * 60;
      Print("COOLDOWN_ACTIVE",
            " | Reason=two consecutive losing trade cycles",
            " | LossCount=", pg_consecutiveLosses,
            " | LastLoss=$", DoubleToString(profit, 2),
            " | PauseUntil=", TimeToString(pg_pauseUntil, TIME_DATE|TIME_MINUTES),
            " | ResumeCondition=5h elapsed; hard drawdown protections remain active");
   }
}

// +------------------------------------------------------------------+
// | v6.0.1 — AI TRADING COMMITTEE                                   |
// | Three reasoning modules vote before every entry.                |
// |   1. Market Director  — what is the market doing and why?       |
// |   2. Human Reasoning  — would a professional actually enter?    |
// |   3. Trade Memory     — how has this pattern performed lately?  |
// | Votes aggregate into a lot multiplier (0.50–1.25×) and a       |
// | one-line thesis printed before every trade. No extra blocking.  |
// +------------------------------------------------------------------+

// ---- Market Director narrative labels ----
#define MD_FRESH_IMPULSE   "FRESH_IMPULSE"
#define MD_TREND_RUNNING   "TREND_RUNNING"
#define MD_PULLBACK_ENTRY  "PULLBACK_ENTRY"
#define MD_LATE_EXTENDED   "LATE_EXTENDED"
#define MD_NEAR_EXHAUSTION "NEAR_EXHAUSTION"
#define MD_COUNTER_TREND   "COUNTER_TREND"
#define MD_NEUTRAL_CTX     "NEUTRAL_CTX"

// ---- In-trade position state codes ----
#define PSTATE_UNKNOWN       0
#define PSTATE_HEALTHY       1
#define PSTATE_PULLBACK      2
#define PSTATE_CONSOLIDATING 3
#define PSTATE_WEAKENING     4
#define PSTATE_EXHAUSTING    5
#define PSTATE_REVERSING     6

// Position-class lookup (used by RatchetExitContext to avoid re-reading indicators every tick)
int GetPositionClassState(ulong ticket)
{
   for(int s = 0; s < 10; s++)
      if(g_posClassTicket[s] == ticket) return g_posClassState[s];
   return PSTATE_UNKNOWN;
}

// ---------- MODULE 1: Market Director ----------
// Synthesises multi-TF trend context into a single narrative label and score.
// Reads: STI TCP/exhaustion/late-risk, EMA alignment, ATR extension.
CommitteeVote MarketDirector_Assess(int signal)
{
   CommitteeVote v;
   v.module = "DIR"; v.score = 0; v.label = MD_NEUTRAL_CTX; v.reasoning = "";
   if(signal == 0 || ArraySize(bufATR) < 2 || bufATR[1] <= 0) return v;

   bool   isBuy    = (signal == 1);
   double atr      = bufATR[1];
   double tcpScore = STI_ComputeTCP(signal);
   double exhaust  = STI_ComputeExhaustion(signal);
   double lateRisk = STI_ComputeLateEntryRisk(signal, atr);
   bool   regOK    = CleanRegimeAligned(isBuy);

   double c1 = iClose(Symbol(), PERIOD_M5, 1);
   double c6 = iClose(Symbol(), PERIOD_M5, 6);
   double emaDist   = (ArraySize(bufEMASlow) >= 2 && bufEMASlow[1] > 0)
                      ? MathAbs(c1 - bufEMASlow[1]) / atr : 0.0;
   double runLast6  = MathAbs(c1 - c6) / atr;
   bool m5Aligned   = isBuy ? (bufEMAFast[1] > bufEMASlow[1]) : (bufEMAFast[1] < bufEMASlow[1]);
   bool h1Aligned   = false;
   bool h4Aligned   = false;
   if(ArraySize(bufEMAFast_H1) >= 2 && bufEMAFast_H1[1] > 0)
      h1Aligned = isBuy ? (bufEMAFast_H1[1] > bufEMASlow_H1[1])
                        : (bufEMAFast_H1[1] < bufEMASlow_H1[1]);
   if(ArraySize(bufEMAFast_H4) >= 2 && bufEMAFast_H4[1] > 0)
      h4Aligned = isBuy ? (bufEMAFast_H4[1] > bufEMASlow_H4[1])
                        : (bufEMAFast_H4[1] < bufEMASlow_H4[1]);

   // Late / Extended — highest priority (price already ran far from value)
   if(lateRisk >= 65 || (runLast6 >= 2.8 && emaDist >= 3.0))
   {
      v.label = MD_LATE_EXTENDED; v.score = -2;
      v.reasoning = StringFormat("%.1f×ATR from EMA, %.1f×ATR run in 6 bars, late risk %.0f — chasing a mature move", emaDist, runLast6, lateRisk);
      return v;
   }
   // Exhaustion — trend momentum genuinely fading
   if(exhaust >= 62 && tcpScore < 55)
   {
      v.label = MD_NEAR_EXHAUSTION; v.score = -1;
      v.reasoning = StringFormat("Exhaustion %.0f, TCP %.0f — momentum fading, reversal risk elevated", exhaust, tcpScore);
      return v;
   }
   // Counter-trend — both M5 and H1 oppose the signal
   if(!m5Aligned && !h1Aligned)
   {
      v.label = MD_COUNTER_TREND; v.score = -2;
      v.reasoning = "M5 and H1 EMAs both oppose this direction — genuine counter-trend entry";
      return v;
   }
   // Fresh impulse — all TFs aligned near EMA, TCP high (best setups)
   if(m5Aligned && h1Aligned && h4Aligned && tcpScore >= 70 && regOK && emaDist <= 2.0)
   {
      v.label = MD_FRESH_IMPULSE; v.score = +2;
      v.reasoning = StringFormat("M5+H1+H4 aligned, TCP %.0f, price near EMA — early trend entry with full multi-TF backing", tcpScore);
      return v;
   }
   // Trend running — established trend, clean continuation
   if(m5Aligned && h1Aligned && tcpScore >= 57 && regOK)
   {
      v.label = MD_TREND_RUNNING; v.score = +1;
      v.reasoning = StringFormat("H1+M5 aligned, TCP %.0f, regime confirms — established trend, continuation is valid", tcpScore);
      return v;
   }
   // Pullback entry — temporarily against M5 but H1 trend intact
   if(!m5Aligned && h1Aligned && emaDist <= 1.8)
   {
      v.label = MD_PULLBACK_ENTRY; v.score = +1;
      v.reasoning = "M5 temporarily against H1 trend — price pulling back to EMA in a valid trend (not reversing)";
      return v;
   }
   // Default neutral
   v.reasoning = StringFormat("TCP %.0f, H1 %s, H4 %s, regime %s — no strong directional conviction",
                               tcpScore, h1Aligned?"aligned":"mixed", h4Aligned?"aligned":"mixed", regOK?"OK":"mixed");
   return v;
}

// ---------- MODULE 2: Human Reasoning Engine ----------
// Deterministic discretionary rules: would an experienced XAUUSD trader take this trade?
// Each rule returns immediately so at most one rule fires per scan.
CommitteeVote HumanReasoning_Assess(int signal, string setupName, string grade)
{
   CommitteeVote v;
   v.module = "HUMAN"; v.score = 0; v.label = "VALID_STANDARD";
   v.reasoning = "No special discretionary enhancement or concern";
   if(signal == 0) return v;

   bool   isBuy = (signal == 1);
   double atr   = (ArraySize(bufATR) >= 2 && bufATR[1] > 0) ? bufATR[1] : 0;
   double rsi   = (ArraySize(bufRSI) >= 2) ? bufRSI[1] : 50;
   double c1    = iClose(Symbol(), PERIOD_M5, 1);
   double c6    = iClose(Symbol(), PERIOD_M5, 6);
   double run6  = (atr > 0) ? MathAbs(c1 - c6) / atr : 0;
   double emaDist = (atr > 0 && ArraySize(bufEMASlow) >= 2 && bufEMASlow[1] > 0)
                    ? MathAbs(c1 - bufEMASlow[1]) / atr : 0;
   bool m5OK = (ArraySize(bufEMAFast) >= 2 && ArraySize(bufEMASlow) >= 2)
               ? (isBuy ? (bufEMAFast[1] > bufEMASlow[1]) : (bufEMAFast[1] < bufEMASlow[1])) : false;
   bool h1OK = false;
   if(ArraySize(bufEMAFast_H1) >= 2 && bufEMAFast_H1[1] > 0)
      h1OK = isBuy ? (bufEMAFast_H1[1] > bufEMASlow_H1[1]) : (bufEMAFast_H1[1] < bufEMASlow_H1[1]);
   bool h4OK = false;
   if(ArraySize(bufEMAFast_H4) >= 2 && bufEMAFast_H4[1] > 0)
      h4OK = isBuy ? (bufEMAFast_H4[1] > bufEMASlow_H4[1]) : (bufEMAFast_H4[1] < bufEMASlow_H4[1]);

   MqlDateTime dt; TimeGMT(dt);
   bool londonOpen  = (dt.hour == 7  && dt.min < 45);
   bool nyOpen      = (dt.hour == 13 && dt.min < 45);
   bool asianMid    = (dt.hour >= 2  && dt.hour < 6);
   bool lnNyOverlap = (dt.hour >= 13 && dt.hour < 17);

   // ---- PRIMARY RULES (early return — highest priority) ----

   // Rule 1: Chasing — price ran hard without pause (non-A+ only)
   if(run6 >= 3.0 && grade != "A+")
   {
      v.label = "WAIT_FOR_PULLBACK"; v.score = -1;
      v.reasoning = StringFormat("%.1f×ATR move in 6 bars without pause — professional waits for retrace, not chasing now", run6);
      return v;
   }
   // Rule 2: RSI extreme — momentum over-extended
   if((isBuy && rsi > 74) || (!isBuy && rsi < 26))
   {
      v.label = "RSI_OVEREXTENDED"; v.score = -1;
      v.reasoning = StringFormat("RSI %.0f is extreme — sharp counter-reversal risk; A+ only here", rsi);
      return v;
   }
   // Rule 3: Clean EMA retest in intact trend — professional entry zone
   if(h1OK && emaDist <= 1.0 && rsi > 42 && rsi < 60)
   {
      v.label = "EMA_RETEST_VALID"; v.score = +2;
      v.reasoning = StringFormat("Price %.1f×ATR from EMA, RSI %.0f neutral, H1 aligned — textbook institutional entry zone", emaDist, rsi);
      return v;
   }
   // Rule 4: Session open caution (London 07:00-07:45 GMT / NY 13:00-13:45 GMT)
   if(londonOpen || nyOpen)
   {
      v.label = "SESSION_OPEN_CAUTION"; v.score = -1;
      v.reasoning = StringFormat("%s first 45 min — direction frequently false-breaks before true move begins",
                                  londonOpen ? "London open" : "New York open");
      return v;
   }
   // Rule 5: A+ with full alignment — pro takes full size without hesitation
   if(grade == "A+" && m5OK && h1OK && rsi > 44 && rsi < 72)
   {
      v.label = "HIGH_QUALITY_ENTRY"; v.score = +1;
      v.reasoning = "A+ grade, M5+H1 aligned, RSI healthy — professional takes full size, no hesitation";
      return v;
   }

   // ---- SECONDARY RULES (first match wins; ordered risk-before-opportunity) ----

   // Rule 6: Against both H4 AND H1 trend — fighting the full daily flow
   if(!h4OK && !h1OK)
   {
      v.label = "AGAINST_H4_TREND"; v.score = -1;
      v.reasoning = "H4 and H1 EMAs both oppose this direction — counter-trend vs daily flow, professional reduces size";
      return v;
   }
   // Rule 7: Consecutive losses today on B-grade — emotional discipline
   if(pg_consecutiveLosses >= 2 && grade == "B")
   {
      v.label = "LOSS_STREAK_CAUTION"; v.score = -1;
      v.reasoning = StringFormat("%d consecutive losses — professional tightens criteria after a losing streak; B-grade reduced", pg_consecutiveLosses);
      return v;
   }
   // Rule 8: Asian mid-session, B-grade — low liquidity, false breakouts common
   if(asianMid && grade == "B")
   {
      v.label = "ASIAN_RANGING"; v.score = -1;
      v.reasoning = "Asian mid-session (02:00-06:00 GMT) — low-liquidity, choppy range-bound; B-grade entries often reverse";
      return v;
   }
   // Rule 9: Spread elevated vs recent baseline — microstructure risk
   if(g_spreadEMA > 5.0)
   {
      double curSpreadPts = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
      if(curSpreadPts > g_spreadEMA * 1.8)
      {
         v.label = "SPREAD_ELEVATED"; v.score = -1;
         v.reasoning = StringFormat("Spread %.0f pts (%.1f× baseline %.0f) — elevated microstructure risk, likely news or low liquidity", curSpreadPts, curSpreadPts / g_spreadEMA, g_spreadEMA);
         return v;
      }
   }
   // Rule 10: Triple TF alignment — highest conviction setup, daily flow trade
   if(h4OK && h1OK && m5OK)
   {
      v.label = "TRIPLE_TF_ALIGNED"; v.score = +1;
      v.reasoning = "H4+H1+M5 all aligned in same direction — trading with full daily flow, highest timeframe conviction";
      return v;
   }
   // Rule 11: London-NY overlap with aligned H1 — highest liquidity window
   if(lnNyOverlap && h1OK && m5OK)
   {
      v.label = "LN_NY_OVERLAP"; v.score = +1;
      v.reasoning = "London-NY overlap (13:00-17:00 GMT), H1+M5 aligned — peak liquidity, institutional flows dominate, trend continuation most reliable";
      return v;
   }
   // Rule 12: H1 aligned, RSI healthy, spread normal — clean entry environment
   double liveSpread12 = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   bool spreadOK12 = (g_spreadEMA <= 5.0 || liveSpread12 < g_spreadEMA * 1.3);
   if(h1OK && rsi > 40 && rsi < 65 && spreadOK12)
   {
      v.label = "CLEAN_ENTRY_CONDITIONS"; v.score = +1;
      v.reasoning = StringFormat("H1 aligned, RSI %.0f in healthy range, spread normal — clean conditions for entry", rsi);
      return v;
   }
   return v;
}

// ---------- MODULE 3: Trade Memory ----------
// Circular buffer of last 100 closed trades. Adjusts lot size per pattern
// based on recent 30-day performance. Minimum 8 samples before adjusting.
double TradeMemory_LotAdjust(string pattern)
{
   int    samples = 0, loc_wins = 0;
   double totalR  = 0.0;
   datetime cutoff = TimeCurrent() - 30 * 24 * 3600;
   for(int i = 0; i < 500; i++)
   {
      if(!g_tradeMemory[i].valid || g_tradeMemory[i].pattern != pattern) continue;
      if(g_tradeMemory[i].closedAt < cutoff) continue;
      samples++;
      if(g_tradeMemory[i].rMultiple > 0.0) loc_wins++;
      totalR += g_tradeMemory[i].rMultiple;
   }

   // v6.0.4: Grade-based prior warm start. Before we have 8 real samples, use a grade-informed
   // prior instead of returning neutral 1.0. Blends out linearly as real data accumulates.
   // Prior is conservative: A+ is historically proven, B has lower expectancy.
   // At 8+ samples, prior weight = 0 and real data takes over completely.
   double priorAdj = 1.0;
   if(StringFind(pattern, "_A+") >= 0)     priorAdj = 1.06; // A+ grade historically ~70%+ WR
   else if(StringFind(pattern, "_A") >= 0) priorAdj = 1.01; // A grade slightly positive prior
   else if(StringFind(pattern, "_B") >= 0) priorAdj = 0.91; // B grade lower expectancy prior

   if(samples < 8)
   {
      double priorWeight = 1.0 - (double)samples / 8.0; // 1.0 at 0 samples, 0.0 at 8 samples
      double dataWeight  = 1.0 - priorWeight;
      if(samples == 0) return priorAdj;
      // Blend: prior × priorWeight + real_data_adj × dataWeight
      double realWR  = (double)loc_wins / samples;
      double realAvgR = totalR / samples;
      double realAdj = (realWR >= 0.65 && realAvgR >= 0.5) ? MathMin(1.20, 1.0 + (realWR - 0.60) * 0.80)
                     : (realWR <  0.38 || realAvgR < -0.30) ? MathMax(0.65, 1.0 - (0.45 - realWR) * 0.80)
                     : 1.0;
      return priorAdj * priorWeight + realAdj * dataWeight;
   }

   double wr   = (double)loc_wins / samples;
   double avgR = totalR / samples;
   if(wr >= 0.65 && avgR >= 0.5)  return MathMin(1.20, 1.0 + (wr - 0.60) * 0.80);
   if(wr <  0.38 || avgR < -0.30) return MathMax(0.65, 1.0 - (0.45 - wr) * 0.80);
   return 1.0;
}

void TradeMemory_Record(string pattern, string dirLabel, int conf, double rMult,
                        int dir=0, string session="", double atrAtEntry=0.0,
                        int htfTrend=0, double maxDD=0.0, double maxFav=0.0,
                        string aiVerdict="", int aiConf=0)
{
   // Classify ATR bucket (pip-equivalent: 1 pip = 10 points for XAU with 2-decimal quotes)
   double atrPips = atrAtEntry * 10.0;
   int atrBucket  = (atrPips < 10.0) ? 0 : (atrPips < 18.0) ? 1 : 2;

   g_tradeMemory[g_tradeMemHead].pattern       = pattern;
   g_tradeMemory[g_tradeMemHead].directorLabel = dirLabel;
   g_tradeMemory[g_tradeMemHead].committeeConf = conf;
   g_tradeMemory[g_tradeMemHead].rMultiple     = rMult;
   g_tradeMemory[g_tradeMemHead].closedAt      = TimeCurrent();
   g_tradeMemory[g_tradeMemHead].valid         = true;
   g_tradeMemory[g_tradeMemHead].dir           = dir;
   g_tradeMemory[g_tradeMemHead].session       = session;
   g_tradeMemory[g_tradeMemHead].atrAtEntry    = atrAtEntry;
   g_tradeMemory[g_tradeMemHead].htfTrend      = htfTrend;
   g_tradeMemory[g_tradeMemHead].atrRegime     = atrBucket;
   g_tradeMemory[g_tradeMemHead].maxDD         = maxDD;
   g_tradeMemory[g_tradeMemHead].maxFav        = maxFav;
   g_tradeMemory[g_tradeMemHead].aiVerdict     = aiVerdict;
   g_tradeMemory[g_tradeMemHead].aiConf        = aiConf;
   g_tradeMemHead = (g_tradeMemHead + 1) % 500;
   if(g_tradeMemCount < 500) g_tradeMemCount++;
   // Upgrade 1: persist to disk every time a new entry is added
   SaveTradeBrainMemory();
}

// ============================================================
// v6.3.8 UPGRADE 1 — TradeBrain disk persistence
// File: MQL5/Files/XAUAI_TradeBrain_v1.csv (common files folder)
// ============================================================
#define TRADEBBRAIN_FILE  "XAUAI_TradeBrain_v1.csv"
#define TRADEBBRAIN_HEADER "#XAUAI_TradeBrain_v1"

void SaveTradeBrainMemory()
{
   if(InpBacktestMode) return; // no file I/O in strategy tester
   int h = FileOpen(TRADEBBRAIN_FILE, FILE_WRITE | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE)
   {
      Print("TRADEBRAIN SAVE ERROR: cannot open file for write (err=", GetLastError(), ")");
      return;
   }
   FileWrite(h, TRADEBBRAIN_HEADER);
   // Write header row
   FileWrite(h, "closedAt","pattern","directorLabel","committeeConf","rMultiple",
               "dir","session","atrAtEntry","htfTrend","atrRegime",
               "maxDD","maxFav","aiVerdict","aiConf");
   int count = 0;
   // Iterate in chronological order: oldest first (head is the NEXT write slot)
   for(int k = 0; k < 500; k++)
   {
      int idx = (g_tradeMemHead + k) % 500;
      if(!g_tradeMemory[idx].valid) continue;
      FileWrite(h,
         IntegerToString((long)g_tradeMemory[idx].closedAt),
         g_tradeMemory[idx].pattern,
         g_tradeMemory[idx].directorLabel,
         IntegerToString(g_tradeMemory[idx].committeeConf),
         DoubleToString(g_tradeMemory[idx].rMultiple, 4),
         IntegerToString(g_tradeMemory[idx].dir),
         g_tradeMemory[idx].session,
         DoubleToString(g_tradeMemory[idx].atrAtEntry, 5),
         IntegerToString(g_tradeMemory[idx].htfTrend),
         IntegerToString(g_tradeMemory[idx].atrRegime),
         DoubleToString(g_tradeMemory[idx].maxDD, 4),
         DoubleToString(g_tradeMemory[idx].maxFav, 4),
         g_tradeMemory[idx].aiVerdict,
         IntegerToString(g_tradeMemory[idx].aiConf)
      );
      count++;
   }
   FileClose(h);
   Print("TRADEBRAIN SAVE: ", count, " patterns written");
}

void LoadTradeBrainMemory()
{
   if(InpBacktestMode) return;
   if(!FileIsExist(TRADEBBRAIN_FILE, FILE_COMMON)) return; // first run — start empty
   int h = FileOpen(TRADEBBRAIN_FILE, FILE_READ | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE) { Print("TRADEBRAIN LOAD: cannot open file (err=", GetLastError(), ")"); return; }

   // First line must be the version header
   string hdr = FileReadString(h);
   if(hdr != TRADEBBRAIN_HEADER)
   {
      Print("TRADEBRAIN LOAD: header mismatch ('", hdr, "') — skipping file (version mismatch)");
      FileClose(h); return;
   }
   // Skip column name row
   if(!FileIsEnding(h))
   {
      for(int col = 0; col < 14; col++) FileReadString(h);
   }

   // Reset memory
   for(int i = 0; i < 500; i++) { g_tradeMemory[i].valid = false; }
   g_tradeMemHead  = 0;
   g_tradeMemCount = 0;
   int loaded = 0, skipped = 0;

   while(!FileIsEnding(h) && g_tradeMemCount < 500)
   {
      string closedAtStr   = FileReadString(h); if(FileIsEnding(h) && StringLen(closedAtStr) == 0) break;
      string pattern       = FileReadString(h);
      string dirLabel      = FileReadString(h);
      string confStr       = FileReadString(h);
      string rMultStr      = FileReadString(h);
      string dirStr        = FileReadString(h);
      string session       = FileReadString(h);
      string atrStr        = FileReadString(h);
      string htfStr        = FileReadString(h);
      string atrRegStr     = FileReadString(h);
      string maxDDStr      = FileReadString(h);
      string maxFavStr     = FileReadString(h);
      string aiVerdict     = FileReadString(h);
      string aiConfStr     = FileReadString(h);

      // Basic validation
      if(StringLen(closedAtStr) < 5 || StringLen(pattern) == 0)
      {
         skipped++;
         if(skipped <= 3) Print("TRADEBRAIN LOAD: skipping corrupt/partial line at row ", loaded + skipped);
         continue;
      }
      long closedAtLong = StringToInteger(closedAtStr);
      if(closedAtLong <= 0) { skipped++; continue; }

      int idx = g_tradeMemHead;
      g_tradeMemory[idx].closedAt      = (datetime)closedAtLong;
      g_tradeMemory[idx].pattern       = pattern;
      g_tradeMemory[idx].directorLabel = dirLabel;
      g_tradeMemory[idx].committeeConf = (int)StringToInteger(confStr);
      g_tradeMemory[idx].rMultiple     = StringToDouble(rMultStr);
      g_tradeMemory[idx].dir           = (int)StringToInteger(dirStr);
      g_tradeMemory[idx].session       = session;
      g_tradeMemory[idx].atrAtEntry    = StringToDouble(atrStr);
      g_tradeMemory[idx].htfTrend      = (int)StringToInteger(htfStr);
      g_tradeMemory[idx].atrRegime     = (int)StringToInteger(atrRegStr);
      g_tradeMemory[idx].maxDD         = StringToDouble(maxDDStr);
      g_tradeMemory[idx].maxFav        = StringToDouble(maxFavStr);
      g_tradeMemory[idx].aiVerdict     = aiVerdict;
      g_tradeMemory[idx].aiConf        = (int)StringToInteger(aiConfStr);
      g_tradeMemory[idx].valid         = true;

      g_tradeMemHead = (g_tradeMemHead + 1) % 500;
      g_tradeMemCount++;
      loaded++;
   }
   FileClose(h);
   if(skipped > 0) Print("TRADEBRAIN LOAD: skipped ", skipped, " corrupt lines");
   Print("TRADEBRAIN LOAD: loaded ", loaded, " patterns from disk");
}

// ============================================================
// v6.3.8 UPGRADE 2 — ATR-normalized pattern matching
// Enhanced win-rate lookup with ATR regime, session, trend, recency weighting
// ============================================================
double TradeBrain_GetATRNormWinRate(int signal, string pattern, string session, int htfTrend, double atrAtEntry)
{
   double atrPips   = atrAtEntry * 10.0;
   int    atrBucket = (atrPips < 10.0) ? 0 : (atrPips < 18.0) ? 1 : 2;
   string atrName   = (atrBucket == 0) ? "LOW" : (atrBucket == 1) ? "MEDIUM" : "HIGH";

   // Phase 1: full filtered match (ATR bucket + session + HTF trend)
   double weightedWins = 0.0, totalWeight = 0.0;
   int    matchCount = 0;
   for(int k = 0; k < 500; k++)
   {
      int idx = (g_tradeMemHead + k) % 500;
      if(!g_tradeMemory[idx].valid)         continue;
      if(g_tradeMemory[idx].pattern != pattern) continue;
      if(g_tradeMemory[idx].dir != signal)   continue;
      if(g_tradeMemory[idx].atrRegime != atrBucket) continue;
      if(g_tradeMemory[idx].session  != session)    continue;
      if(g_tradeMemory[idx].htfTrend != htfTrend)   continue;

      // Recency weighting: last 20 trades get 2x, older than 100 get 0.5x
      int age = g_tradeMemCount - k - 1; // approximate age index (0=newest)
      double recencyW = (age < 20) ? 2.0 : (age > 100) ? 0.5 : 1.0;
      double w = recencyW;
      totalWeight += w;
      if(g_tradeMemory[idx].rMultiple > 0.0) weightedWins += w;
      matchCount++;
   }

   double winRate = 0.5;
   if(matchCount >= 5 && totalWeight > 0)
   {
      winRate = weightedWins / totalWeight;
      Print("TRADEBRAIN MATCH: ", matchCount, " patterns (ATR=", atrName,
            " sess=", session, " regime=", htfTrend == 1 ? "BULL" : htfTrend == -1 ? "BEAR" : "RANGING",
            ") WR=", StringFormat("%.1f", winRate * 100.0), "%");
      return winRate;
   }

   // Phase 2: session-only fallback (drop ATR and trend filters)
   double w2 = 0.0, wW2 = 0.0; int m2 = 0;
   for(int k = 0; k < 500; k++)
   {
      int idx = (g_tradeMemHead + k) % 500;
      if(!g_tradeMemory[idx].valid) continue;
      if(g_tradeMemory[idx].pattern != pattern) continue;
      if(g_tradeMemory[idx].dir != signal) continue;
      if(g_tradeMemory[idx].session != session) continue;
      int age = g_tradeMemCount - k - 1;
      double rw = (age < 20) ? 2.0 : (age > 100) ? 0.5 : 1.0;
      w2 += rw; if(g_tradeMemory[idx].rMultiple > 0.0) wW2 += rw;
      m2++;
   }
   if(m2 >= 3 && w2 > 0) { winRate = wW2 / w2; return winRate; }

   // Phase 3: global average (no filters)
   double w3 = 0.0, wW3 = 0.0;
   for(int k = 0; k < 500; k++)
   {
      int idx = (g_tradeMemHead + k) % 500;
      if(!g_tradeMemory[idx].valid) continue;
      int age = g_tradeMemCount - k - 1;
      double rw = (age < 20) ? 2.0 : (age > 100) ? 0.5 : 1.0;
      w3 += rw; if(g_tradeMemory[idx].rMultiple > 0.0) wW3 += rw;
   }
   if(w3 > 0) { winRate = wW3 / w3; return winRate; }

   return 0.5; // neutral default — never return zero
}

// ============================================================
// v6.3.8 UPGRADE 6 — Gate Analytics Report
// ============================================================
void PrintGateReport()
{
   g_gateReportLast = TimeCurrent();
   int blocked = g_totalSignals - g_totalAllowed;
   double allowPct = (g_totalSignals > 0) ? (double)g_totalAllowed / g_totalSignals * 100.0 : 0.0;
   double blockPct = 100.0 - allowPct;
   Print("=== GATE ANALYTICS REPORT ===");
   Print("Total signals:   ", g_totalSignals);
   Print("Allowed trades:  ", g_totalAllowed, " (", StringFormat("%.1f", allowPct), "%)");
   Print("Blocked trades:  ", blocked, " (", StringFormat("%.1f", blockPct), "%)");
   Print("  Spread:        ", g_gateBlocks_Spread);
   Print("  News:          ", g_gateBlocks_News);
   Print("  Trend/PG:      ", g_gateBlocks_Trend);
   Print("  Committee:     ", g_gateBlocks_Committee);
   Print("  AI Director:   ", g_gateBlocks_AI);
   Print("  TradeBrain:    ", g_gateBlocks_TradeBrain);
   Print("  STI:           ", g_gateBlocks_STI);
   Print("  Basket:        ", g_gateBlocks_Basket);
   Print("  Daily Loss/HWM:", g_gateBlocks_DailyLoss);
   Print("  Volatility:    ", g_gateBlocks_Volatility);
   Print("  EPF:           ", g_gateBlocks_EPF);
   Print("=============================");
}

// ============================================================
// v6.3.9 UPGRADE — Gate Analytics File Report
// ============================================================
void WriteGateReportToFile()
{
   string fname = "XAUAI_GateReport_" + TimeToString(TimeCurrent(), TIME_DATE) + ".txt";
   int fh = FileOpen(fname, FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(fh == INVALID_HANDLE) { Print("GATE REPORT: failed to open file (err=", GetLastError(), ")"); return; }
   int blocked = g_totalSignals - g_totalAllowed;
   double allowPct = (g_totalSignals > 0) ? (100.0 * g_totalAllowed / g_totalSignals) : 0.0;
   FileWrite(fh, "=== XAUAI GATE ANALYTICS REPORT ===");
   FileWrite(fh, "Date: " + TimeToString(TimeCurrent()));
   FileWrite(fh, "Total signals:   " + IntegerToString(g_totalSignals));
   FileWrite(fh, "Allowed trades:  " + IntegerToString(g_totalAllowed) + " (" +
             DoubleToString(allowPct, 1) + "%)");
   FileWrite(fh, "Blocked trades:  " + IntegerToString(blocked));
   FileWrite(fh, "  Spread:        " + IntegerToString(g_gateBlocks_Spread));
   FileWrite(fh, "  News:          " + IntegerToString(g_gateBlocks_News));
   FileWrite(fh, "  Trend/PG:      " + IntegerToString(g_gateBlocks_Trend));
   FileWrite(fh, "  Committee:     " + IntegerToString(g_gateBlocks_Committee));
   FileWrite(fh, "  AI Director:   " + IntegerToString(g_gateBlocks_AI));
   FileWrite(fh, "  TradeBrain:    " + IntegerToString(g_gateBlocks_TradeBrain));
   FileWrite(fh, "  STI:           " + IntegerToString(g_gateBlocks_STI));
   FileWrite(fh, "  Basket:        " + IntegerToString(g_gateBlocks_Basket));
   FileWrite(fh, "  Daily Loss:    " + IntegerToString(g_gateBlocks_DailyLoss));
   FileWrite(fh, "  Volatility:    " + IntegerToString(g_gateBlocks_Volatility));
   FileWrite(fh, "  EPF:           " + IntegerToString(g_gateBlocks_EPF));
   if(g_totalSignals > 20)
   {
      double passRate = allowPct;
      if(passRate < 10.0)       FileWrite(fh, "DIAGNOSIS: SEVERE over-filtering — fewer than 10% of signals pass");
      else if(passRate < 20.0)  FileWrite(fh, "DIAGNOSIS: Moderate over-filtering — fewer than 20% pass");
      else if(passRate > 60.0)  FileWrite(fh, "DIAGNOSIS: Possible under-filtering — over 60% of signals pass");
      else                      FileWrite(fh, "DIAGNOSIS: Pass rate is in normal range (20-60%)");
   }
   FileClose(fh);
   Print("GATE REPORT: written to ", fname);
}

// ============================================================
// v6.3.9 UPGRADE — 24h Forward-Test Report
// ============================================================
void FTReport_RecordTrade(string stratName, bool wasWin, double pnl)
{
   g_ftReport_Trades++;
   if(wasWin) g_ftReport_Wins++; else g_ftReport_Losses++;
   g_ftReport_TotalPnL += pnl;
   // Update strategy breakdown
   for(int si = 0; si < g_ftReport_StratCount; si++)
   {
      if(g_ftReport_StratNames[si] == stratName)
      {
         if(wasWin) g_ftReport_StratWins[si]++; else g_ftReport_StratLosses[si]++;
         return;
      }
   }
   if(g_ftReport_StratCount < 20)
   {
      g_ftReport_StratNames[g_ftReport_StratCount]  = stratName;
      g_ftReport_StratWins[g_ftReport_StratCount]   = wasWin ? 1 : 0;
      g_ftReport_StratLosses[g_ftReport_StratCount] = wasWin ? 0 : 1;
      g_ftReport_StratCount++;
   }
}

void WriteForwardTestReport()
{
   MqlDateTime dt; TimeCurrent(dt);
   string dateStr = StringFormat("%04d.%02d.%02d", dt.year, dt.mon, dt.day);
   string fname = "XAUAI_ForwardTest_" + dateStr + ".txt";
   int fh = FileOpen(fname, FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(fh == INVALID_HANDLE) { Print("FT REPORT: failed to open file (err=", GetLastError(), ")"); return; }

   double curEq = AccountInfoDouble(ACCOUNT_EQUITY);
   double netPnL = curEq - g_ftReport_StartEquity;
   double netPct = (g_ftReport_StartEquity > 0) ? (netPnL / g_ftReport_StartEquity * 100.0) : 0.0;
   double ddPct  = (g_ftReport_StartEquity > 0) ? (g_ftReport_MaxDD / g_ftReport_StartEquity * 100.0) : 0.0;
   double mfPct  = (g_ftReport_StartEquity > 0) ? (g_ftReport_MaxFloat / g_ftReport_StartEquity * 100.0) : 0.0;
   double favPct = (g_ftReport_StartEquity > 0) ? (g_ftReport_MaxFav / g_ftReport_StartEquity * 100.0) : 0.0;
   int    tWins  = g_ftReport_Wins;
   int    tLoss  = g_ftReport_Losses;
   int    tTotal = g_ftReport_Trades;
   double wr     = (tTotal > 0) ? (100.0 * tWins / tTotal) : 0.0;
   double lossR  = (tTotal > 0) ? (100.0 * tLoss / tTotal) : 0.0;
   double aiPassR = (g_ftReport_AIAllowed + g_ftReport_AIBlocked > 0)
                  ? (100.0 * g_ftReport_AIAllowed / (g_ftReport_AIAllowed + g_ftReport_AIBlocked)) : 0.0;

   FileWrite(fh, "=== XAUAI SNIPER v6.3.9 — 24H FORWARD TEST REPORT ===");
   FileWrite(fh, "Date:              " + dateStr);
   FileWrite(fh, "Start equity:      $" + DoubleToString(g_ftReport_StartEquity, 2));
   FileWrite(fh, "End equity:        $" + DoubleToString(curEq, 2));
   FileWrite(fh, "Net P&L:           " + (netPnL >= 0 ? "+" : "") + "$" +
             DoubleToString(netPnL, 2) + " (" + (netPct >= 0 ? "+" : "") +
             DoubleToString(netPct, 2) + "%)");
   FileWrite(fh, "---");
   FileWrite(fh, "Signals generated: " + IntegerToString(g_ftReport_Signals));
   FileWrite(fh, "Trades opened:     " + IntegerToString(tTotal));
   FileWrite(fh, "  Wins:            " + IntegerToString(tWins) + " (" + DoubleToString(wr, 1) + "%)");
   FileWrite(fh, "  Losses:          " + IntegerToString(tLoss) + " (" + DoubleToString(lossR, 1) + "%)");
   FileWrite(fh, "Max drawdown:      -$" + DoubleToString(g_ftReport_MaxDD, 2) +
             " (-" + DoubleToString(ddPct, 2) + "%)");
   FileWrite(fh, "Max floating loss: -$" + DoubleToString(g_ftReport_MaxFloat, 2) +
             " (-" + DoubleToString(mfPct, 2) + "%)");
   FileWrite(fh, "Max floating gain: +$" + DoubleToString(g_ftReport_MaxFav, 2) +
             " (+" + DoubleToString(favPct, 2) + "%)");
   FileWrite(fh, "---");
   FileWrite(fh, "AI Director");
   FileWrite(fh, "  Allowed:         " + IntegerToString(g_ftReport_AIAllowed));
   FileWrite(fh, "  Blocked:         " + IntegerToString(g_ftReport_AIBlocked));
   FileWrite(fh, "  Pass rate:       " + DoubleToString(aiPassR, 1) + "%");
   FileWrite(fh, "TradeBrain");
   FileWrite(fh, "  Allowed:         " + IntegerToString(g_ftReport_TBAllowed));
   FileWrite(fh, "  Blocked:         " + IntegerToString(g_ftReport_TBBlocked));
   FileWrite(fh, "---");
   FileWrite(fh, "Strategy performance:");
   for(int si = 0; si < g_ftReport_StratCount; si++)
   {
      int sw = g_ftReport_StratWins[si], sl = g_ftReport_StratLosses[si];
      int st = sw + sl;
      double swr = (st > 0) ? (100.0 * sw / st) : 0.0;
      FileWrite(fh, "  " + g_ftReport_StratNames[si] + ":  " + IntegerToString(st) +
                " trades  " + IntegerToString(sw) + "W/" + IntegerToString(sl) + "L" +
                "  WR=" + DoubleToString(swr, 1) + "%");
   }
   FileWrite(fh, "---");
   // Biggest gate block
   int maxBlockVal = 0; string maxBlockName = "None";
   int blockVals[11];
   string blockNames[11];
   blockVals[0]=g_gateBlocks_Spread;    blockNames[0]="Spread";
   blockVals[1]=g_gateBlocks_News;      blockNames[1]="News";
   blockVals[2]=g_gateBlocks_Trend;     blockNames[2]="Trend/PG";
   blockVals[3]=g_gateBlocks_Committee; blockNames[3]="Committee";
   blockVals[4]=g_gateBlocks_AI;        blockNames[4]="AI Director";
   blockVals[5]=g_gateBlocks_TradeBrain;blockNames[5]="TradeBrain";
   blockVals[6]=g_gateBlocks_STI;       blockNames[6]="STI";
   blockVals[7]=g_gateBlocks_Basket;    blockNames[7]="Basket";
   blockVals[8]=g_gateBlocks_DailyLoss; blockNames[8]="Daily Loss";
   blockVals[9]=g_gateBlocks_Volatility;blockNames[9]="Volatility";
   blockVals[10]=g_gateBlocks_EPF;      blockNames[10]="EPF";
   for(int bi = 0; bi < 11; bi++)
      if(blockVals[bi] > maxBlockVal) { maxBlockVal = blockVals[bi]; maxBlockName = blockNames[bi]; }
   FileWrite(fh, "Biggest gate block: " + maxBlockName + " (" + IntegerToString(maxBlockVal) + " blocks)");
   FileWrite(fh, "---");
   int totalSig = g_ftReport_Signals;
   double passRate2 = (totalSig > 0) ? (100.0 * g_ftReport_Trades / totalSig) : 0.0;
   if(totalSig > 20)
   {
      if(passRate2 < 10.0)
         FileWrite(fh, "DIAGNOSIS: SEVERE over-filtering — fewer than 10% of signals passed.");
      else if(passRate2 < 20.0)
         FileWrite(fh, "DIAGNOSIS: Pass rate " + DoubleToString(passRate2, 1) + "% — moderate, check gate counters above.");
      else if(passRate2 > 60.0)
         FileWrite(fh, "DIAGNOSIS: Pass rate " + DoubleToString(passRate2, 1) + "% — high, possible under-filtering.");
      else
         FileWrite(fh, "DIAGNOSIS: Pass rate " + DoubleToString(passRate2, 1) + "% — normal range.");
   }
   if(g_ftReport_AIBlocked > 0 && g_ftReport_AIAllowed > 0)
   {
      double aiBlkPct = 100.0 * g_ftReport_AIBlocked / (g_ftReport_AIAllowed + g_ftReport_AIBlocked);
      if(aiBlkPct > 50.0)
         FileWrite(fh, "RECOMMENDATION: Monitor AI block rate. If AI blocks >50% of setups, review AI confidence threshold.");
   }
   FileClose(fh);
   Print("FT REPORT: written to ", fname);
}

// ============================================================
// v6.3.8 UPGRADE 7 — Performance multiplier (anti-martingale)
// ============================================================
double GetPerformanceMultiplier()
{
   // v6.3.9: SAFETY OVERRIDE 4 — TradeBrain sample size guard
   // If fewer than 10 historical patterns in memory, don't boost
   if(g_tradeMemCount < 10) return 1.0;

   // Need at least 5 recent trades in g_tradeMemory to act
   int count = 0;
   for(int k = 0; k < 500; k++)
   {
      int idx = (g_tradeMemHead + 499 - k) % 500; // newest first
      if(!g_tradeMemory[idx].valid) continue;
      count++;
      if(count >= 10) break;
   }
   if(count < 5) return 1.0; // not enough data — neutral

   // Compute last-10-trade stats
   int wins10 = 0, total10 = 0, streak = 0;
   bool streakIsWin = false;
   for(int k = 0; k < 500 && total10 < 10; k++)
   {
      int idx = (g_tradeMemHead + 499 - k) % 500;
      if(!g_tradeMemory[idx].valid) continue;
      bool w = (g_tradeMemory[idx].rMultiple > 0.0);
      if(total10 == 0) { streakIsWin = w; streak = 1; }
      else if(w == streakIsWin) streak++;
      else break; // streak broken
      if(w) wins10++;
      total10++;
   }
   double wr10 = (total10 > 0) ? (double)wins10 / total10 : 0.5;

   double mult = 1.0;
   if(wr10 >= 0.70 && streakIsWin && streak >= 3) mult = 1.15;
   else if(wr10 >= 0.55) mult = 1.0;
   else if(wr10 >= 0.40) mult = 0.85;
   // v6.3.9: consecutive loss thresholds fire immediately
   if(!streakIsWin && streak >= 5) { mult = 0.50; }       // 5+ losses → 0.50 immediately
   else if(!streakIsWin && streak >= 3) { mult = 0.70; }  // 3+ losses → 0.70 immediately
   else if(wr10 < 0.40) mult = MathMin(mult, 0.70);
   // Also respect pg_consecutiveLosses counter (aligned with EPF loss-streak tracking)
   if(pg_consecutiveLosses >= 5) mult = MathMin(mult, 0.50);
   else if(pg_consecutiveLosses >= 3) mult = MathMin(mult, 0.70);

   // v6.3.9: SAFETY OVERRIDE 1 — Never increase lots during floating drawdown > 0.5% balance
   double floatingPL = AccountInfoDouble(ACCOUNT_PROFIT);
   if(floatingPL < 0 && MathAbs(floatingPL) > AccountInfoDouble(ACCOUNT_BALANCE) * 0.005)
      mult = MathMin(mult, 1.0);

   // v6.3.9: SAFETY OVERRIDE 2 — Never increase during high volatility (ATR > 1.5× 50-bar median)
   if(ArraySize(bufATR) >= 2 && bufATR[1] > 0)
   {
      double curATR = bufATR[1];
      // Compute 50-bar ATR median (same method as VolatilityKillReason — no extra handle)
      int hVolATR = iATR(Symbol(), PERIOD_M5, 14);
      if(hVolATR != INVALID_HANDLE)
      {
         double atrSamples[51];
         if(CopyBuffer(hVolATR, 0, 0, 51, atrSamples) == 51)
         {
            double sample50[50];
            for(int si = 0; si < 50; si++) sample50[si] = atrSamples[si + 1];
            ArraySort(sample50);
            double atrMedian = sample50[25];
            if(atrMedian > 0 && curATR > atrMedian * 1.5)
               mult = MathMin(mult, 1.0);
         }
         IndicatorRelease(hVolATR);
      }
   }

   // v6.3.9: SAFETY OVERRIDE 3 — Never increase after daily loss
   if(dailyStartEquity > 0)
   {
      double dailyResult = AccountInfoDouble(ACCOUNT_EQUITY) - dailyStartEquity;
      if(dailyResult < 0) mult = MathMin(mult, 1.0);
   }

   // v6.3.9: SAFETY OVERRIDE 5 — Hard cap at 1.15× (was 1.30×)
   mult = MathMax(0.50, MathMin(1.15, mult));

   // Log when multiplier changes
   if(MathAbs(mult - g_perfMultLast) > 0.05)
   {
      Print("PERF MULTIPLIER: ", DoubleToString(mult, 2),
            " (WR10=", StringFormat("%.0f", wr10 * 100.0), "%",
            " streak=", streak, streakIsWin?" wins":" losses",
            " pg_consec=", pg_consecutiveLosses,
            " floatPL=", DoubleToString(AccountInfoDouble(ACCOUNT_PROFIT), 2),
            ") — lot sizing adjusted");
      g_perfMultLast = mult;
   }
   return mult;
}

// ---------- COMMITTEE ASSEMBLER ----------
// Combines all three module votes into one CommitteeDecision.
CommitteeDecision Committee_Assemble(int signal, string setupName, string grade, double combinedScore)
{
   CommitteeDecision dec;
   dec.lotMultiplier = 1.0;
   dec.totalScore    = 0;
   dec.directorLabel = MD_NEUTRAL_CTX;
   dec.thesis        = "";
   dec.confidence    = 50;
   if(!InpCommitteeEnable || signal == 0) return dec;

   CommitteeVote dirVote = MarketDirector_Assess(signal);
   CommitteeVote humVote = HumanReasoning_Assess(signal, setupName, grade);

   CommitteeVote memVote;
   memVote.module = "MEM";
   double memAdj  = InpCommitteeLotAdj ? TradeMemory_LotAdjust(setupName + "_" + grade) : 1.0;
   memVote.score  = (memAdj >= 1.12) ? +1 : (memAdj <= 0.78) ? -1 : 0;
   memVote.label  = (memAdj >= 1.12) ? "PROVEN" : (memAdj <= 0.78) ? "WEAK" : "NEUTRAL";
   memVote.reasoning = StringFormat("30d '%s_%s' → lot×%.2f", setupName, grade, memAdj);

   int total = dirVote.score + humVote.score + memVote.score;

   double lotMult = 1.0;
   if(InpCommitteeLotAdj)
   {
      if(total >=  4)      lotMult = 1.15;
      else if(total >= 2)  lotMult = 1.08;
      else if(total == 1)  lotMult = 1.03;
      else if(total == 0)  lotMult = 1.00;
      else if(total == -1) lotMult = 0.92;
      else if(total == -2) lotMult = 0.82;
      else                 lotMult = 0.70;
      lotMult = MathMax(0.70, MathMin(1.25, lotMult * memAdj)); // v6.0.3: floor raised 0.50→0.70 — prevents committee+STI stacking to microscopic lots on small account
   }

   int baseConf = (grade == "A+") ? 82 : (grade == "A") ? 68 : 50;
   int conf     = (int)MathMax(20, MathMin(97, baseConf + total * 4));

   dec.lotMultiplier = lotMult;
   dec.totalScore    = total;
   dec.directorLabel = dirVote.label;
   dec.confidence    = conf;
   dec.thesis = StringFormat(
      "COMMITTEE | DIR:%s(%+d) %s | HUMAN:%s(%+d) | MEM:%s(%+d) → lot×%.2f conf:%d%%",
      dirVote.label, dirVote.score, dirVote.reasoning,
      humVote.label, humVote.score,
      memVote.label, memVote.score,
      lotMult, conf);
   return dec;
}

// ---------- IN-TRADE CLASSIFIER ----------
// Called every new M5 bar. Tracks position state so exit modules can act
// intelligently without re-reading every indicator on every tick.
void InTradeClassifier_Update()
{
   if(!InpInTradeClassify) return;
   if(ArraySize(bufEMAFast) < 3 || ArraySize(bufRSI) < 2 || bufATR[1] <= 0) return;
   double atr = bufATR[1];
   string snames[] = {"UNKNOWN","HEALTHY","PULLBACK","CONSOLIDATING","WEAKENING","EXHAUSTING","REVERSING"};

   // Expire slots for positions that are no longer open
   for(int s = 0; s < 10; s++)
   {
      if(g_posClassTicket[s] == 0) continue;
      if(!PositionSelectByTicket(g_posClassTicket[s]))
      { g_posClassTicket[s] = 0; g_posClassState[s] = PSTATE_UNKNOWN; }
   }

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;

      bool   isBuy     = ((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double entry     = PositionGetDouble(POSITION_PRICE_OPEN);
      double price     = isBuy ? SymbolInfoDouble(Symbol(), SYMBOL_BID)
                               : SymbolInfoDouble(Symbol(), SYMBOL_ASK);
      double profitATR = isBuy ? (price - entry) / atr : (entry - price) / atr;
      double emaF = bufEMAFast[1], emaS = bufEMASlow[1], rsi = bufRSI[1];
      double c1 = iClose(Symbol(), PERIOD_M5, 1);
      double o1 = iOpen(Symbol(), PERIOD_M5, 1);
      double c2 = iClose(Symbol(), PERIOD_M5, 2);
      int    mom = CleanMomentumScore(isBuy, c1, o1, c2, emaF, emaS, rsi);
      bool   m5OK = isBuy ? (emaF > emaS) : (emaF < emaS);
      bool   h1OK = false;
      if(ArraySize(bufEMAFast_H1) >= 2 && bufEMAFast_H1[1] > 0)
         h1OK = isBuy ? (bufEMAFast_H1[1] > bufEMASlow_H1[1])
                      : (bufEMAFast_H1[1] < bufEMASlow_H1[1]);

      int ns;
      if(!m5OK && !h1OK && mom <= 1)         ns = PSTATE_REVERSING;
      else if(!m5OK && !h1OK)                ns = PSTATE_WEAKENING;
      else if(!m5OK && profitATR >= 0.5)     ns = PSTATE_PULLBACK;
      else if(mom <= 1 && profitATR >= 2.0)  ns = PSTATE_EXHAUSTING;
      else if(m5OK && mom >= 3)              ns = PSTATE_HEALTHY;
      else                                   ns = PSTATE_CONSOLIDATING;

      int slot = -1;
      for(int s = 0; s < 10; s++) if(g_posClassTicket[s] == tk) { slot = s; break; }
      if(slot < 0) for(int s = 0; s < 10; s++) if(g_posClassTicket[s] == 0) { slot = s; break; }
      if(slot < 0) continue;

      if(g_posClassState[slot] != ns)
         Print("TRADE-CLASS #", tk, " ", isBuy?"BUY":"SELL",
               " ", snames[g_posClassState[slot]], " → ", snames[ns],
               " | profitATR=", DoubleToString(profitATR,2), " mom=", mom,
               " m5=", m5OK?"OK":"x", " h1=", h1OK?"OK":"x");
      g_posClassTicket[slot] = tk;
      g_posClassState[slot]  = ns;
   }
}

// v6.0.1 — RatchetExitContext: determines how aggressively to tighten SL based on real trend state.
// Returns: 2=trend confirmed (DEFER — don't move SL at all, original SL protects against catastrophe)
//          1=trend weakening  (CUSHION — move SL to entry + InpRatchetBECushionATR×ATR, lock small profit)
//          0=reversal confirmed (HARD — move SL to exact entry, old behaviour, protect capital)
// posTicket: if provided and InTradeClassifier has classified this position, uses that state first.
// Called once per position per tick inside PG_PerPositionRatchet.
int RatchetExitContext(bool isBuy, ulong posTicket = 0)
{
   // Fast path: use InTradeClassifier state if available (avoids re-reading indicators every tick)
   if(posTicket > 0 && InpInTradeClassify)
   {
      int cls = GetPositionClassState(posTicket);
      if(cls == PSTATE_REVERSING)                    return 0; // confirmed reversal → fire hard
      if(cls == PSTATE_WEAKENING)                    return 1; // trend losing power → cushion
      if(cls == PSTATE_EXHAUSTING)                   return 1; // near top/bottom → cushion
      if(cls == PSTATE_CONSOLIDATING)                return 1; // unclear → cushion
      if(cls == PSTATE_PULLBACK || cls == PSTATE_HEALTHY) return 2; // intact → defer
      // PSTATE_UNKNOWN falls through to indicator-based logic below
   }

   bool hasM5  = (ArraySize(bufEMAFast) >= 3 && ArraySize(bufEMASlow) >= 3 && ArraySize(bufRSI) >= 2);
   bool hasH1  = (ArraySize(bufEMAFast_H1) >= 2 && ArraySize(bufEMASlow_H1) >= 2 &&
                  bufEMAFast_H1[1] > 0 && bufEMASlow_H1[1] > 0);
   if(!hasM5) return 1; // insufficient data — default to cushioned BE

   double emaF   = bufEMAFast[1];
   double emaS   = bufEMASlow[1];
   double rsi    = bufRSI[1];
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   double open1  = iOpen(Symbol(), PERIOD_M5, 1);
   double close2 = iClose(Symbol(), PERIOD_M5, 2);

   bool m5Aligned  = isBuy ? (emaF > emaS)  : (emaF < emaS);
   bool rsiOK      = isBuy ? (rsi > 45.0)   : (rsi < 55.0);
   bool rsiExtreme = isBuy ? (rsi < 38.0)   : (rsi > 62.0); // RSI strongly against = reversal signal
   bool regimeOK   = CleanRegimeAligned(isBuy);
   int  mom        = CleanMomentumScore(isBuy, close1, open1, close2, emaF, emaS, rsi);

   bool h1Aligned = true; // assume aligned when H1 data unavailable (conservative)
   if(hasH1)
      h1Aligned = isBuy ? (bufEMAFast_H1[1] > bufEMASlow_H1[1])
                        : (bufEMAFast_H1[1] < bufEMASlow_H1[1]);

   // ---- REVERSAL CONFIRMED: 0 — fire hard BE ----
   if(!m5Aligned && rsiExtreme && mom <= 1) return 0;  // M5 crossed + RSI extreme + flat momentum
   if(!m5Aligned && !h1Aligned && mom <= 2) return 0;  // both M5 and H1 EMAs against the trade

   // ---- TREND CONFIRMED: 2 — defer BE, original SL holds ----
   if(m5Aligned && h1Aligned && rsiOK && mom >= InpRatchetTrendMinMoment && regimeOK) return 2;
   if(m5Aligned && h1Aligned && mom >= (InpRatchetTrendMinMoment + 1)) return 2; // very strong momentum

   // ---- WEAKENING: 1 — cushioned BE (default) ----
   return 1;
}

// v5.1.2 — per-position ratchet: lock individual winners (v6.0.1: context-aware).
//   Context 2 (trend confirmed)  → DEFERRED: don't move SL; original SL protects; avoid unnecessary BE exit
//   Context 1 (trend weakening)  → CUSHION:  SL = entry ± InpRatchetBECushionATR×ATR (lock small profit)
//   Context 0 (reversal)         → HARD BE:  SL = exact entry (original behaviour, protect capital)
//   Trail phase (profitInAtr >= trailStartATR) → adaptive width based on momentum score
// Called every tick (cheap — O(positions)).
void PG_PerPositionRatchet()
{
   if(!InpPG_PerPositionRatchet) return;
   // v5.9.0: use the already-maintained global bufATR instead of creating a new
   // iATR handle on every call (which was happening every tick during active management).
   if(ArraySize(bufATR) < 2 || bufATR[1] <= 0) return;
   double atr = bufATR[1];
   if(atr <= 0) return;
   double point  = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);

   // v6.0.1: pre-check if context buffers are populated (same for every position this tick)
   bool hasGoodBuffers = (ArraySize(bufEMAFast) >= 3 && ArraySize(bufEMASlow) >= 3 &&
                          ArraySize(bufRSI) >= 2);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      // Only ratchet our magic-number positions (don't touch user manual trades)
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;

      ENUM_POSITION_TYPE ptype = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      bool   isBuy  = (ptype == POSITION_TYPE_BUY);
      double entry  = PositionGetDouble(POSITION_PRICE_OPEN);
      double curSL  = PositionGetDouble(POSITION_SL);
      double curTP  = PositionGetDouble(POSITION_TP);
      double price  = isBuy ? SymbolInfoDouble(Symbol(), SYMBOL_BID)
                            : SymbolInfoDouble(Symbol(), SYMBOL_ASK);
      double profitDist = isBuy ? (price - entry) : (entry - price);
      if(profitDist <= 0) continue;
      double profitInAtr = profitDist / atr;

      // v5.3.1 — HIGH-GRADE BREATHING ROOM. A/A+ trades use looser thresholds
      // so winners run further. Grade is read from position comment (set at entry).
      string posCmt    = PositionGetString(POSITION_COMMENT);
      bool isHighGrade = (StringFind(posCmt, "[A]") >= 0 || StringFind(posCmt, "[A+]") >= 0);
      double beTriggerATR  = isHighGrade ? InpHighGradeBETriggerATR  : InpPG_RatchetBETrigger;
      double trailStartATR = isHighGrade ? InpHighGradeTrailStartATR : InpPG_RatchetTrailStart;
      double trailDistATR  = isHighGrade ? InpHighGradeTrailDistATR  : InpPG_RatchetTrailDist;

      // v6.0.1: trend context decides how aggressively to ratchet.
      // Pass ticket so classifier state is used first (cheap); falls back to indicator logic.
      int trendCtx = 1; // default: cushioned BE when buffers not available
      if(InpRatchetTrendGate && hasGoodBuffers)
         trendCtx = RatchetExitContext(isBuy, tk);

      double newSL = curSL;

      // Stage 1: BE move (context-aware, only in the window below trail start)
      if(profitInAtr >= beTriggerATR && profitInAtr < trailStartATR)
      {
         if(trendCtx == 2)
         {
            // Trend confirmed → defer BE entirely; original SL is the backstop.
            // newSL stays == curSL; position loops continues to stage 2 (won't fire yet).
         }
         else
         {
            // trendCtx 1=cushion (small locked profit), 0=hard (zero profit = old behaviour)
            // v6.0.4: mid-zone step — at 2×ATR in CUSHIONED mode, lock 0.75×ATR instead of 0.35×ATR.
            // Addresses the profit giveback gap between initial BE lock (1.5×ATR) and trail start (3.0×ATR).
            double cushion;
            if(trendCtx == 1 && profitInAtr >= 2.0)
               cushion = atr * 0.75;   // mid-zone lock: 75% of ATR preserved
            else if(trendCtx == 1)
               cushion = atr * InpRatchetBECushionATR; // initial BE cushion (default 0.35×ATR)
            else
               cushion = 0.0;          // HARD: lock to exact entry
            double beSL = isBuy ? (entry + cushion) : (entry - cushion);
            if(isBuy  && (curSL == 0 || curSL < beSL))  newSL = beSL;
            if(!isBuy && (curSL == 0 || curSL > beSL))  newSL = beSL;
         }
      }

      // Stage 2: trail (fires at trailStartATR regardless of context; width adapts to momentum)
      if(profitInAtr >= trailStartATR)
      {
         double adaptiveMult = 1.0;
         if(InpRatchetAdaptiveTrail && hasGoodBuffers)
         {
            double emaF2 = bufEMAFast[1], emaS2 = bufEMASlow[1], rsi2 = bufRSI[1];
            double c1 = iClose(Symbol(), PERIOD_M5, 1);
            double o1 = iOpen(Symbol(), PERIOD_M5, 1);
            double c2 = iClose(Symbol(), PERIOD_M5, 2);
            int mom = CleanMomentumScore(isBuy, c1, o1, c2, emaF2, emaS2, rsi2);
            // Strong momentum → wider trail (survive pullbacks in running trends)
            // Weak momentum   → normal trail (protect locked profit on reversals)
            adaptiveMult = (mom >= 4) ? InpRatchetStrongMomMulti
                         : (mom <= 2) ? InpRatchetWeakMomMulti
                         : 1.0;
         }
         double trail   = atr * trailDistATR * adaptiveMult;
         double trailSL = isBuy ? (price - trail) : (price + trail);
         if(isBuy  && trailSL > newSL) newSL = trailSL;
         if(!isBuy && (newSL == 0 || trailSL < newSL)) newSL = trailSL;
      }

      // Round + apply only if we actually tightened
      newSL = NormalizeDouble(newSL, digits);
      if(newSL == curSL) continue;
      // Sanity: reject if SL is on wrong side of price
      if(isBuy  && newSL >= price) continue;
      if(!isBuy && newSL <= price) continue;
      // Respect broker stops level
      long stopsLevel = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
      if(MathAbs(price - newSL) < stopsLevel * point) continue;

      MqlTradeRequest req; ZeroMemory(req);
      MqlTradeResult  res; ZeroMemory(res);
      req.action   = TRADE_ACTION_SLTP;
      req.position = tk;
      req.symbol   = Symbol();
      req.sl       = newSL;
      req.tp       = curTP;
      if(OrderSend(req, res) && res.retcode == TRADE_RETCODE_DONE)
      {
         string ctxTag = (trendCtx == 2) ? "TRAIL_OVR"
                       : (trendCtx == 1 && profitInAtr >= 2.0) ? "CUSHION_MID" // v6.0.4 mid-zone lock
                       : (trendCtx == 1) ? "CUSHION_BE"
                       :                   "HARD_BE";
         Print("PG ratchet: ticket=", tk, " ", isBuy ? "BUY" : "SELL",
               " profit=", DoubleToString(profitInAtr, 2), "xATR [", ctxTag, "]",
               "  SL: ", DoubleToString(curSL, digits), " -> ", DoubleToString(newSL, digits));
      }
   }
}

//+------------------------------------------------------------------+
//| XAUAI CLOUD — broadcast master signals to subscribers            |
//| When InpCloudFanout=true, every trade OPEN and CLOSE is posted   |
//| to the XauAi Cloud backend, which fans the signal out (shadow or |
//| live) to all connected subscriber MT5 accounts via VPS workers.  |
//+------------------------------------------------------------------+
ulong   g_cloudPosIds[];     // parallel arrays: posId → signalId
string  g_cloudSigIds[];

// v5.2.0 — persistence file. Without this, an EA restart/recompile wipes the
// in-memory map, so when the master later closes a position the mirrored cloud
// trades stay open forever. Persist after every Add/Pop and load on OnInit.
#define CLOUD_MAP_FILE "xauai_cloud_map.csv"

void CloudMapSave()
{
   int h = FileOpen(CLOUD_MAP_FILE, FILE_WRITE | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE) { Print("CloudMapSave: FileOpen err=", GetLastError()); return; }
   int n = ArraySize(g_cloudPosIds);
   for(int i = 0; i < n; i++)
   {
      FileWrite(h, (string)g_cloudPosIds[i], g_cloudSigIds[i]);
   }
   FileClose(h);
}

void CloudMapLoad()
{
   if(!FileIsExist(CLOUD_MAP_FILE, FILE_COMMON)) return;
   int h = FileOpen(CLOUD_MAP_FILE, FILE_READ | FILE_CSV | FILE_COMMON, ',');
   if(h == INVALID_HANDLE) { Print("CloudMapLoad: FileOpen err=", GetLastError()); return; }
   ArrayResize(g_cloudPosIds, 0);
   ArrayResize(g_cloudSigIds, 0);
   while(!FileIsEnding(h))
   {
      string sPos = FileReadString(h);
      if(StringLen(sPos) == 0) break;
      string sSig = FileReadString(h);
      ulong  pid  = (ulong)StringToInteger(sPos);
      if(pid > 0 && StringLen(sSig) > 0)
      {
         int n = ArraySize(g_cloudPosIds);
         ArrayResize(g_cloudPosIds, n + 1);
         ArrayResize(g_cloudSigIds, n + 1);
         g_cloudPosIds[n] = pid;
         g_cloudSigIds[n] = sSig;
      }
   }
   FileClose(h);
   Print("☁  CloudMapLoad: restored ", ArraySize(g_cloudPosIds), " open position→signal mappings");
}

bool CloudEnabled()
{
   return (InpCloudFanout && !InpBacktestMode
           && StringLen(InpCloudURL) >= 10
           && StringLen(InpCloudAgentToken) >= 8);
}

bool BotMonitorEnabled()
{
   return (InpBotMonitorEnable && !InpBacktestMode
           && StringLen(InpCloudURL) >= 10
           && StringLen(InpLicensePIN) >= 10);
}

string BotMonitorJsonSafe(string s, int maxLen)
{
   StringReplace(s, "\\", "/");
   StringReplace(s, "\"", "'");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\t", " ");
   StringReplace(s, "—", "-");
   StringReplace(s, "–", "-");
   StringReplace(s, "→", "->");
   StringReplace(s, "≤", "<=");
   StringReplace(s, "≥", ">=");
   if(StringLen(s) > maxLen) s = StringSubstr(s, 0, maxLen);
   return s;
}

string BotMonitorBool(bool v)
{
   return v ? "true" : "false";
}

void BotMonitorActivity(string eventType, string severity, string message)
{
   if(!BotMonitorEnabled()) return;
   string ev = BotMonitorJsonSafe(eventType, 40);
   string sev = BotMonitorJsonSafe(severity, 16);
   string msg = BotMonitorJsonSafe(message, 420);
   string account = (string)AccountInfoInteger(ACCOUNT_LOGIN);
   string body = StringFormat(
      "{\"pin\":\"%s\",\"license_key\":\"%s\",\"event_type\":\"%s\",\"severity\":\"%s\",\"account\":\"%s\",\"symbol\":\"%s\","
      "\"message\":\"%s\",\"details\":{\"regime\":\"%s\",\"session\":\"%s\",\"last_skip\":\"%s\"}}",
      BotMonitorJsonSafe(InpLicensePIN, 32), BotMonitorJsonSafe(InpLicensePIN, 32),
      ev, sev, account, Symbol(), msg, BotMonitorJsonSafe(RegimeName(), 32),
      BotMonitorJsonSafe(SessionTag(), 16), BotMonitorJsonSafe(g_lastSkipReason, 180));
   char pd[], res[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   string hdr = "Content-Type: application/json\r\nX-Agent-Token: " + InpCloudAgentToken + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", InpCloudURL + "/api/cloud/monitor/activity",
                         hdr, InpCloudTimeoutMs, pd, res, rh);
   if(code != 200)
   {
      string responseBody = CharArrayToString(res);
      Print("BOT-MONITOR activity POST failed url=", InpCloudURL, "/api/cloud/monitor/activity",
            " http=", code, " err=", GetLastError(),
            " pin=", BotMonitorJsonSafe(InpLicensePIN, 32),
            " response=", BotMonitorJsonSafe(responseBody, 360));
   }
}

void BotMonitorHeartbeat()
{
   if(!BotMonitorEnabled()) return;
   bool termConn = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   bool termAlgo = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   bool mqlAlgo  = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   bool tradeAllowed = termConn && termAlgo && mqlAlgo && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
   int openPs = CountMyPositions();
   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   double equity = accInfo.Equity();
   double balance = accInfo.Balance();
   double dd = balance > 0.0 ? MathMax(0.0, (balance - equity) / balance * 100.0) : 0.0;
   string state = "SCANNING";
   if(!termConn) state = "MT5_DISCONNECTED";
   else if(!termAlgo) state = "ALGO_DISABLED";
   else if(!mqlAlgo) state = "EA_TRADING_DISABLED";
   else if(!g_startupIntelSyncDone) state = "STARTUP_SYNCING";
   else if(g_remoteStopTrading) state = "REMOTE_STOPPED";
   else if(g_remotePauseNewTrades) state = "REMOTE_PAUSED";
   else if(openPs > 0) state = "MANAGING_TRADES";
   else if(StringLen(g_lastSkipReason) > 0) state = "WAITING";
   // Do not publish stale MQL runtime codes as live bot errors. Trade/order
   // failures are logged explicitly where they happen; heartbeat is state only.
   string lastErr = "";
   ResetLastError();
   string body = StringFormat(
      "{\"pin\":\"%s\",\"license_key\":\"%s\",\"bot_online\":true,\"ea_version\":\"v5.9.1\",\"account_number\":\"%I64d\","
      "\"broker_server\":\"%s\",\"symbol\":\"%s\",\"timeframe\":\"M5\",\"spread\":%.0f,"
      "\"equity\":%.2f,\"balance\":%.2f,\"daily_pnl\":%.2f,\"drawdown\":%.2f,"
      "\"open_positions\":%d,\"algo_trading\":%s,\"trading_allowed\":%s,"
      "\"mt5_connected\":%s,\"account_connected\":%s,\"ea_active\":true,"
      "\"bot_state\":\"%s\",\"last_action\":\"%s\",\"last_tick_time\":\"%s\","
      "\"last_decision_time\":\"%s\",\"last_error\":\"%s\",\"epf_state\":\"T%d\","
      "\"sync_state\":\"%s\",\"prop_firm_mode\":%s,\"prop_daily_loss_pct\":%.2f,"
      "\"prop_max_loss_pct\":%.2f,\"prop_safety_buffer_pct\":%.2f,"
      "\"prop_risk_per_trade_pct\":%.2f,\"prop_max_basket_risk_pct\":%.2f}",
      BotMonitorJsonSafe(InpLicensePIN, 32),
      BotMonitorJsonSafe(InpLicensePIN, 32),
      AccountInfoInteger(ACCOUNT_LOGIN),
      BotMonitorJsonSafe(AccountInfoString(ACCOUNT_SERVER), 80),
      Symbol(), spread, equity, balance, (equity - dailyStartEquity), dd, openPs,
      BotMonitorBool(termAlgo), BotMonitorBool(tradeAllowed),
      BotMonitorBool(termConn), BotMonitorBool(AccountInfoInteger(ACCOUNT_LOGIN) > 0),
      BotMonitorJsonSafe(state, 48), BotMonitorJsonSafe(StringLen(g_lastRemoteCommandState) > 0 ? g_lastRemoteCommandState : g_lastSkipReason, 180),
      TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS),
      TimeToString(g_lastEntryScanAt > 0 ? g_lastEntryScanAt : TimeCurrent(), TIME_DATE | TIME_SECONDS),
      BotMonitorJsonSafe(lastErr, 120), epf_tier,
      BotMonitorJsonSafe(g_startupIntelSyncReason, 120),
      BotMonitorBool(g_propFirmMode), g_propFirmDailyLossPct,
      g_propFirmMaxLossPct, g_propFirmSafetyBufferPct,
      g_propFirmRiskPerTradePct, g_propFirmMaxBasketRiskPct);
   char pd[], res[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   string hdr = "Content-Type: application/json\r\nX-Agent-Token: " + InpCloudAgentToken + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", InpCloudURL + "/api/cloud/monitor/heartbeat",
                         hdr, InpCloudTimeoutMs, pd, res, rh);
   if(code != 200)
   {
      string responseBody = CharArrayToString(res);
      Print("BOT-MONITOR heartbeat POST failed url=", InpCloudURL, "/api/cloud/monitor/heartbeat",
            " http=", code, " err=", GetLastError(),
            " pin=", BotMonitorJsonSafe(InpLicensePIN, 32),
            " account=", (string)AccountInfoInteger(ACCOUNT_LOGIN),
            " payloadFields=pin,license_key,account_number,ea_version,symbol,timeframe,equity,balance",
            " response=", BotMonitorJsonSafe(responseBody, 520),
            " (monitor only; trading continues locally)");
   }
   else
   {
      string responseBody = CharArrayToString(res);
      Print("BOT-MONITOR heartbeat OK account=", (string)AccountInfoInteger(ACCOUNT_LOGIN),
            " pin=", BotMonitorJsonSafe(InpLicensePIN, 32),
            " response=", BotMonitorJsonSafe(responseBody, 220));
   }
}

void BotMonitorAckCommand(string commandId, string status, string message)
{
   if(!BotMonitorEnabled() || StringLen(commandId) < 8) return;
   string body = StringFormat(
      "{\"pin\":\"%s\",\"license_key\":\"%s\",\"account\":\"%I64d\",\"command_id\":\"%s\",\"status\":\"%s\",\"message\":\"%s\","
      "\"details\":{\"remote_pause\":%s,\"remote_stop\":%s,\"open_positions\":%d}}",
      BotMonitorJsonSafe(InpLicensePIN, 32), BotMonitorJsonSafe(InpLicensePIN, 32),
      AccountInfoInteger(ACCOUNT_LOGIN),
      BotMonitorJsonSafe(commandId, 80), BotMonitorJsonSafe(status, 16),
      BotMonitorJsonSafe(message, 260), BotMonitorBool(g_remotePauseNewTrades),
      BotMonitorBool(g_remoteStopTrading), CountMyPositions());
   char pd[], res[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   string hdr = "Content-Type: application/json\r\nX-Agent-Token: " + InpCloudAgentToken + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", InpCloudURL + "/api/cloud/command/ack",
                         hdr, InpCloudTimeoutMs, pd, res, rh);
   if(code != 200)
   {
      string responseBody = CharArrayToString(res);
      Print("BOT-COMMAND ack failed http=", code, " err=", GetLastError(),
            " pin=", BotMonitorJsonSafe(InpLicensePIN, 32),
            " response=", BotMonitorJsonSafe(responseBody, 360));
   }
}

void BotMonitorPollCommands()
{
   if(!BotMonitorEnabled()) return;
   char pd[], res[]; string rh;
   StringToCharArray("", pd, 0, 0);
   string hdr = "X-Agent-Token: " + InpCloudAgentToken + "\r\n";
   ResetLastError();
   string pendingUrl = InpCloudURL + "/api/cloud/command/pending?limit=1&pin=" +
                       BotMonitorJsonSafe(InpLicensePIN, 32) +
                       "&account=" + (string)AccountInfoInteger(ACCOUNT_LOGIN);
   int code = WebRequest("GET", pendingUrl,
                         hdr, InpCloudTimeoutMs, pd, res, rh);
   if(code != 200 || ArraySize(res) == 0)
   {
      if(code != 200)
      {
         string responseBody = CharArrayToString(res);
         Print("BOT-COMMAND pending GET failed url=", pendingUrl,
               " http=", code, " err=", GetLastError(),
               " response=", BotMonitorJsonSafe(responseBody, 360));
      }
      return;
   }

   string body = CharArrayToString(res);
   string commandId = JsonStringField(body, "id");
   string action = JsonStringField(body, "action");
   if(StringLen(commandId) < 8 || StringLen(action) < 3) return;
   StringToUpper(action);

   string result = "Command ignored";
   string status = "SKIPPED";
   if(action == "PAUSE_NEW_TRADES")
   {
      g_remotePauseNewTrades = true;
      g_remoteStopTrading = false;
      status = "EXECUTED";
      result = "New entries paused; existing positions still managed.";
   }
   else if(action == "RESUME_TRADING")
   {
      g_remotePauseNewTrades = false;
      g_remoteStopTrading = false;
      status = "EXECUTED";
      result = "Remote pause/stop cleared; normal entry scanning resumed.";
   }
   else if(action == "STOP_TRADING")
   {
      g_remoteStopTrading = true;
      g_remotePauseNewTrades = false;
      status = "EXECUTED";
      result = "Fresh entries stopped; management of open positions continues.";
   }
   else if(action == "CLOSE_ALL_TRADES")
   {
      int before = CountMyPositions();
      CloseAll();
      status = "EXECUTED";
      result = StringFormat("Close-all requested; positions before command=%d.", before);
   }
   else if(action == "FORCE_SYNC")
   {
      g_startupIntelSyncDone = false;
      g_startupIntelSyncOk = false;
      XAU_RunStartupIntelligenceSync();
      status = g_startupIntelSyncOk ? "EXECUTED" : "FAILED";
      result = "Startup intelligence sync forced: " + g_startupIntelSyncReason;
   }
   else if(action == "FORCE_REPORT_UPLOAD")
   {
      status = "EXECUTED";
      result = "Report upload marker recorded; local CSV/JSONL remains the source of truth.";
   }
   else if(action == "UPDATE_PROP_FIRM_CONFIG")
   {
      string enabledRaw = JsonStringField(body, "enabled");
      string retestRaw = JsonStringField(body, "allow_retest_add");
      g_propFirmMode = (StringFind(enabledRaw, "true") >= 0 || enabledRaw == "1");
      g_propFirmConfiguredBalance = MathMax(0.0, JsonNumberField(body, "starting_balance"));
      g_propFirmDailyLossPct = MathMax(0.5, MathMin(20.0, JsonNumberField(body, "daily_loss_pct")));
      g_propFirmMaxLossPct = MathMax(g_propFirmDailyLossPct, MathMin(30.0, JsonNumberField(body, "max_loss_pct")));
      g_propFirmSafetyBufferPct = MathMax(0.0, MathMin(g_propFirmDailyLossPct - 0.10,
                                                       JsonNumberField(body, "safety_buffer_pct")));
      g_propFirmRiskPerTradePct = MathMax(0.01, MathMin(2.0, JsonNumberField(body, "risk_per_trade_pct")));
      g_propFirmMaxBasketRiskPct = MathMax(g_propFirmRiskPerTradePct,
                                           MathMin(4.0, JsonNumberField(body, "max_basket_risk_pct")));
      g_propFirmAllowOneRetestAdd = (StringFind(retestRaw, "true") >= 0 || retestRaw == "1");
      g_propFirmRetestAddLotMulti = MathMax(0.05, MathMin(0.50,
                                             JsonNumberField(body, "retest_add_lot_multi")));
      SavePropFirmConfig();
      LoadPropFirmBaseline();
      g_propFirmLockActive = false;
      status = "EXECUTED";
      result = StringFormat("PropFirm=%s daily=%.2f%% total=%.2f%% risk=%.2f%% basket=%.2f%% buffer=%.2f%% retest=%s.",
                            g_propFirmMode ? "ON" : "OFF",
                            g_propFirmDailyLossPct, g_propFirmMaxLossPct,
                            g_propFirmRiskPerTradePct, g_propFirmMaxBasketRiskPct,
                            g_propFirmSafetyBufferPct,
                            g_propFirmAllowOneRetestAdd ? "ONE" : "OFF");
   }

   g_lastRemoteCommandState = action + ": " + result;
   Print("BOT-COMMAND ", status, " ", action, " - ", result);
   BotMonitorActivity("REMOTE_COMMAND_" + status, status == "FAILED" ? "ERROR" : "COMMAND", g_lastRemoteCommandState);
   BotMonitorAckCommand(commandId, status, result);
}

void CloudMapAdd(ulong posId, string sigId)
{
   int n = ArraySize(g_cloudPosIds);
   ArrayResize(g_cloudPosIds, n + 1);
   ArrayResize(g_cloudSigIds, n + 1);
   g_cloudPosIds[n] = posId;
   g_cloudSigIds[n] = sigId;
   CloudMapSave();        // v5.2.0 — survive restart/recompile
}

string CloudMapPop(ulong posId)
{
   int n = ArraySize(g_cloudPosIds);
   for(int i = 0; i < n; i++)
   {
      if(g_cloudPosIds[i] == posId)
      {
         string sig = g_cloudSigIds[i];
         // shift-remove
         for(int j = i; j < n - 1; j++)
         {
            g_cloudPosIds[j] = g_cloudPosIds[j + 1];
            g_cloudSigIds[j] = g_cloudSigIds[j + 1];
         }
         ArrayResize(g_cloudPosIds, n - 1);
         ArrayResize(g_cloudSigIds, n - 1);
         CloudMapSave();   // v5.2.0 — survive restart/recompile
         return sig;
      }
   }
   return "";
}

string CloudMapGet(ulong posId)
{
   int n = ArraySize(g_cloudPosIds);
   for(int i = 0; i < n; i++)
      if(g_cloudPosIds[i] == posId)
         return g_cloudSigIds[i];
   return "";
}

// Extract a substring between the first occurrence of `needle` followed by
// `"` and the next `"`. Tiny JSON-value extractor — we only need `signal_id`.
string JsonStr(string src, string key)
{
   string probe = "\"" + key + "\":\"";
   int a = StringFind(src, probe);
   if(a < 0) return "";
   a += StringLen(probe);
   int b = StringFind(src, "\"", a);
   if(b < 0) return "";
   return StringSubstr(src, a, b - a);
}

string CloudPostSignal(string symbol, string side, double entry, double sl, double tp,
                       string grade, double riskHintPct,
                       double masterLots, double masterBalance)
{
   if(!CloudEnabled()) return "";
   string body = StringFormat(
      "{\"symbol\":\"%s\",\"side\":\"%s\",\"entry\":%.5f,\"sl\":%.5f,\"tp\":%.5f,"
      "\"grade\":\"%s\",\"risk_hint_pct\":%.3f,"
      "\"master_lots\":%.2f,\"master_balance\":%.2f}",
      symbol, side, entry, sl, tp, grade, riskHintPct, masterLots, masterBalance);
   char pd[], res[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   string url = InpCloudURL + "/api/cloud/master/signal";
   string hdr = "Content-Type: application/json\r\nX-Agent-Token: " + InpCloudAgentToken + "\r\n";
   int code = WebRequest("POST", url, hdr, InpCloudTimeoutMs, pd, res, rh);
   if(code != 200)
   {
      Print("☁  CLOUD signal POST failed: http=", code, " err=", GetLastError(),
            " (check WebRequest whitelist for ", InpCloudURL, ")");
      XAU_IntelAppend("CLOUD_SIGNAL", "", 0, side == "BUY" ? 1 : (side == "SELL" ? -1 : 0),
                      "", grade, "", (int)currentRegime, SessionTag(), "CLOUD",
                      "SIGNAL_POST", "CLOUD_SIGNAL_POST_FAILED",
                      0.0, 0.0, 0.0, entry, entry, 0.0, masterLots, sl, tp,
                      0.0, 0.0, 0, 0, 0.0, 0.0, "",
                      "cloud signal POST failed", "", code, false,
                      "url=" + InpCloudURL + " err=" + (string)GetLastError());
      return "";
   }
   string resp = CharArrayToString(res);
   string sigId = JsonStr(resp, "signal_id");
   Print("☁  CLOUD signal fanout OK — signal_id=", sigId, " ", side, " @", entry,
         " masterLots=", DoubleToString(masterLots,2), " masterBal=$", DoubleToString(masterBalance,0));
   XAU_IntelAppend("CLOUD_SIGNAL", sigId, 0, side == "BUY" ? 1 : (side == "SELL" ? -1 : 0),
                   "", grade, "", (int)currentRegime, SessionTag(), "CLOUD",
                   "SIGNAL_POST", "CLOUD_SIGNAL_POST_OK",
                   0.0, 0.0, 0.0, entry, entry, 0.0, masterLots, sl, tp,
                   0.0, 0.0, 0, 0, 0.0, 0.0, "",
                   "cloud signal accepted", sigId, code, true,
                   "masterBalance=" + DoubleToString(masterBalance, 2));
   return sigId;
}

void CloudPostSignalClose(string sigId, double exitPrice, string reason)
{
   if(!CloudEnabled() || StringLen(sigId) < 4) return;
   // strip quotes and trim reason
   string r = reason;
   StringReplace(r, "\"", "'");
   if(StringLen(r) > 120) r = StringSubstr(r, 0, 120);
   string body = StringFormat("{\"signal_id\":\"%s\",\"exit_price\":%.5f,\"reason\":\"%s\"}",
                              sigId, exitPrice, r);
   char pd[], res[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   string url = InpCloudURL + "/api/cloud/master/signal-close";
   string hdr = "Content-Type: application/json\r\nX-Agent-Token: " + InpCloudAgentToken + "\r\n";
   int code = WebRequest("POST", url, hdr, InpCloudTimeoutMs, pd, res, rh);
   if(code != 200)
   {
      Print("☁  CLOUD close POST failed: http=", code, " err=", GetLastError());
      XAU_IntelAppend("CLOUD_CLOSE", sigId, 0, 0, "", "", "", (int)currentRegime,
                      SessionTag(), "CLOUD", "CLOSE_POST", "CLOUD_CLOSE_POST_FAILED",
                      0.0, 0.0, 0.0, exitPrice, 0.0, exitPrice, 0.0, 0.0, 0.0,
                      0.0, 0.0, 0, 0, 0.0, 0.0, "", reason, sigId, code, false,
                      "err=" + (string)GetLastError());
   }
   else
   {
      Print("☁  CLOUD close fanout OK — signal_id=", sigId, " exit=", exitPrice);
      XAU_IntelAppend("CLOUD_CLOSE", sigId, 0, 0, "", "", "", (int)currentRegime,
                      SessionTag(), "CLOUD", "CLOSE_POST", "CLOUD_CLOSE_POST_OK",
                      0.0, 0.0, 0.0, exitPrice, 0.0, exitPrice, 0.0, 0.0, 0.0,
                      0.0, 0.0, 0, 0, 0.0, 0.0, "", reason, sigId, code, true,
                      "");
   }
}

void CloudPostSignalPartial(string sigId, double exitPrice, double closePct, string reason)
{
   if(!CloudEnabled() || StringLen(sigId) < 4 || closePct <= 0) return;
   string r = reason;
   StringReplace(r, "\"", "'");
   if(StringLen(r) > 120) r = StringSubstr(r, 0, 120);
   string body = StringFormat("{\"signal_id\":\"%s\",\"exit_price\":%.5f,\"close_percent\":%.2f,\"reason\":\"%s\"}",
                              sigId, exitPrice, closePct, r);
   char pd[], res[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   string url = InpCloudURL + "/api/cloud/master/signal-partial";
   string hdr = "Content-Type: application/json\r\nX-Agent-Token: " + InpCloudAgentToken + "\r\n";
   int code = WebRequest("POST", url, hdr, InpCloudTimeoutMs, pd, res, rh);
   if(code != 200)
   {
      Print("☁  CLOUD partial POST failed: http=", code, " err=", GetLastError());
      XAU_IntelAppend("CLOUD_PARTIAL", sigId, 0, 0, "", "", "", (int)currentRegime,
                      SessionTag(), "CLOUD", "PARTIAL_POST", "CLOUD_PARTIAL_POST_FAILED",
                      0.0, 0.0, 0.0, exitPrice, 0.0, exitPrice, closePct, 0.0, 0.0,
                      0.0, 0.0, 0, 0, 0.0, 0.0, "", reason, sigId, code, false,
                      "closePct=" + DoubleToString(closePct, 2) + " err=" + (string)GetLastError());
   }
   else
   {
      Print("☁  CLOUD partial fanout OK — signal_id=", sigId,
            " closePct=", DoubleToString(closePct, 1), "% exit=", exitPrice);
      XAU_IntelAppend("CLOUD_PARTIAL", sigId, 0, 0, "", "", "", (int)currentRegime,
                      SessionTag(), "CLOUD", "PARTIAL_POST", "CLOUD_PARTIAL_POST_OK",
                      0.0, 0.0, 0.0, exitPrice, 0.0, exitPrice, closePct, 0.0, 0.0,
                      0.0, 0.0, 0, 0, 0.0, 0.0, "", reason, sigId, code, true,
                      "closePct=" + DoubleToString(closePct, 2));
   }
}

void CloudHeartbeat()
{
   if(!CloudEnabled()) return;
   char pd[], res[]; string rh;
   StringToCharArray("{}", pd, 0, 2);
   string url = InpCloudURL + "/api/cloud/master/heartbeat";
   string hdr = "Content-Type: application/json\r\nX-Agent-Token: " + InpCloudAgentToken + "\r\n";
   WebRequest("POST", url, hdr, InpCloudTimeoutMs, pd, res, rh);
}

// v5.1.8 — pull the admin-set bot mode every ~60s so admins can flip
// Conservative/Balanced/Aggressive from the dashboard without restarting MT5.
void FetchBotMode()
{
   if(!CloudEnabled()) return;
   if(TimeCurrent() - g_modeLastFetch < g_modeFetchIntervalSec) return;
   g_modeLastFetch = TimeCurrent();
   char pd[], res[]; string rh;
   StringToCharArray("", pd, 0, 0);
   string url = InpCloudURL + "/api/cloud/master/config";
   string hdr = "X-Agent-Token: " + InpCloudAgentToken + "\r\n";
   ResetLastError();
   int code = WebRequest("GET", url, hdr, InpCloudTimeoutMs, pd, res, rh);
   if(code != 200 || ArraySize(res) == 0) return;
   string body = CharArrayToString(res);
   // Quick string-based JSON parse (no nested-object library dependency)
   string newMode = JsonStringField(body, "mode");
   if(StringLen(newMode) == 0) return;
   double newGradeB    = JsonNumberField(body, "gradeB");
   double newFloor     = JsonNumberField(body, "scoreFloor");
   double newCtxTF     = JsonNumberField(body, "contextTF");
   string useHTF       = JsonStringField(body, "useHTFBias");
   string adapt        = JsonStringField(body, "adaptiveTighten");
   bool   useHTFBool   = (StringFind(useHTF, "true") >= 0);
   bool   adaptBool    = (StringFind(adapt,  "true") >= 0);
   bool changed = (newMode != g_modeName);
   g_modeName        = newMode;
   g_modeGradeB      = newGradeB;
   g_modeScoreFloor  = newFloor;
   g_modeContextTF   = (ENUM_TIMEFRAMES)((int)newCtxTF);
   g_modeUseHTFBias  = useHTFBool;
   g_modeUseHTFBiasSet = true;
   g_modeAdaptive    = adaptBool;
   g_modeAdaptiveSet = true;
   if(changed)
      PrintFormat("🎛 BOT MODE → %s (gradeB=%.1f, floor=%.2f, ctxTF=%d, useHTF=%s, adaptive=%s)",
                  newMode, newGradeB, newFloor, (int)newCtxTF,
                  useHTFBool?"true":"false", adaptBool?"true":"false");
}

// Tiny JSON helpers — extract one top-level field as string or number.
// Good enough for the flat config payload we own (no nested objects there).
string JsonStringField(const string body, const string key)
{
   string needle = "\"" + key + "\":";
   int p = StringFind(body, needle);
   if(p < 0) return "";
   p += StringLen(needle);
   while(p < StringLen(body) && (StringGetCharacter(body,p) == ' ' || StringGetCharacter(body,p) == '\t')) p++;
   if(p >= StringLen(body)) return "";
   if(StringGetCharacter(body, p) == '"')
   {
      int end = StringFind(body, "\"", p + 1);
      if(end < 0) return "";
      return StringSubstr(body, p + 1, end - p - 1);
   }
   // bool / non-string scalar — return up to next , } ]
   int e1 = StringFind(body, ",", p); int e2 = StringFind(body, "}", p); int e3 = StringFind(body, "]", p);
   int end = StringLen(body);
   if(e1 >= 0 && e1 < end) end = e1;
   if(e2 >= 0 && e2 < end) end = e2;
   if(e3 >= 0 && e3 < end) end = e3;
   return StringSubstr(body, p, end - p);
}
double JsonNumberField(const string body, const string key)
{
   string raw = JsonStringField(body, key);
   StringTrimLeft(raw); StringTrimRight(raw);
   return StringToDouble(raw);
}

// Effective getters used inside the trade gates. Always prefer admin override
// if it's been set; otherwise fall back to the EA input. This means everyone
// running v5.1.8+ EAs can be remote-controlled via the admin Bot Mode panel.
double GetEffectiveGradeB()
{
   if(g_modeGradeB > 0.0) return g_modeGradeB;
   return InpGradeB;
}
double GetEffectiveScoreFloor()
{
   if(g_modeScoreFloor > 0.0) return g_modeScoreFloor;
   return InpScoreFloor;
}
ENUM_TIMEFRAMES GetEffectiveContextTF()
{
   if(g_modeContextTF != PERIOD_CURRENT) return g_modeContextTF;
   return InpContextTF;
}
bool GetEffectiveUseHTFBias()
{
   if(g_modeUseHTFBiasSet) return g_modeUseHTFBias;
   return InpUseH4Bias;
}
bool GetEffectiveAdaptiveGrade()
{
   if(g_modeAdaptiveSet) return g_modeAdaptive;
   return InpAdaptiveGradeB;
}

string CloudJsonSafe(string s, int maxLen)
{
   StringReplace(s, "\\", "/");
   StringReplace(s, "\"", "'");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\t", " ");
   StringReplace(s, "—", "-");
   StringReplace(s, "–", "-");
   StringReplace(s, "→", "->");
   StringReplace(s, "≤", "<=");
   StringReplace(s, "≥", ">=");
   StringReplace(s, "☁", "cloud");
   StringReplace(s, "🛡", "guard");
   StringReplace(s, "⚙", "fix");
   if(StringLen(s) > maxLen) s = StringSubstr(s, 0, maxLen);
   return s;
}

// v5.1.5 — push every "TRADE BLOCKED BECAUSE: <reason>" + "TRADE FIRED" event
// to the cloud so subscribers see WHY their copy account isn't trading. Throttled
// in caller so we don't spam (only on state change or signal).
void CloudPostReasoning(string event_type, string reason, string regime, string setup,
                        double setup_score, double combined_score, string grade, int signal_dir)
{
   string monitorSeverity = "INFO";
   if(event_type == "FIRE" || event_type == "PYR") monitorSeverity = "TRADE";
   else if(event_type == "BLOCK" || StringFind(reason, "VETO") >= 0) monitorSeverity = "BLOCK";
   else if(StringFind(reason, "ERROR") >= 0 || StringFind(reason, "FAILED") >= 0) monitorSeverity = "ERROR";
   else if(StringFind(reason, "SYNC") >= 0) monitorSeverity = "SYNC";
   BotMonitorActivity(event_type, monitorSeverity, reason);
   if(!CloudEnabled()) return;
   string r = CloudJsonSafe(reason, 240);
   string ev = CloudJsonSafe(event_type, 32);
   string rg = CloudJsonSafe(regime, 32);
   string st = CloudJsonSafe(setup, 48);
   string gr = CloudJsonSafe(grade, 24);
   string body = StringFormat(
      "{\"event_type\":\"%s\",\"reason\":\"%s\",\"regime\":\"%s\",\"setup\":\"%s\","
      "\"setup_score\":%.2f,\"combined_score\":%.2f,\"grade\":\"%s\",\"signal_dir\":%d}",
      ev, r, rg, st, setup_score, combined_score, gr, signal_dir);
   char pd[], res[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   string url = InpCloudURL + "/api/cloud/master/reasoning";
   string hdr = "Content-Type: application/json\r\nX-Agent-Token: " + InpCloudAgentToken + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", url, hdr, InpCloudTimeoutMs, pd, res, rh);
   // v5.1.6: log explicit failure ONCE per error code so user can see auth/whitelist issues.
   //         Without this, reasoning posts silently disappear and the cloud feed stays empty.
   static int lastReportedCode = 0;
   if(code != 200 && code != lastReportedCode)
   {
      string body_str = "";
      if(ArraySize(res) > 0) body_str = CharArrayToString(res);
      PrintFormat("[CloudReasoning] POST failed code=%d err=%d body=%s — check that '%s' is in MT5 → Tools → Options → Expert Advisors → Allowed URLs, AND that InpCloudAgentToken matches the master token in cloud_settings.agent_token.",
                  code, GetLastError(),
                  StringSubstr(body_str, 0, 120),
                  InpCloudURL);
      lastReportedCode = code;
   }
   else if(code == 200 && lastReportedCode != 0)
   {
      Print("[CloudReasoning] POST recovered — events flowing again.");
      lastReportedCode = 0;
   }
}

// Extract grade tag like "A+" / "A" / "B" from a reason string "SETUP [A+]"
string CloudExtractGrade(string reason)
{
   int a = StringFind(reason, "[");
   int b = StringFind(reason, "]", a);
   if(a < 0 || b < 0 || b <= a + 1) return "";
   return StringSubstr(reason, a + 1, b - a - 1);
}

void LogTradeToServer(string result2, double price, double profit, double lots, string dir)
{
   if(InpBacktestMode) return;                    // Tester: no network
   if(StringLen(InpServerURL) < 10) return;
   MqlDateTime dt; TimeCurrent(dt);
   string body = StringFormat("{\"pin\":\"%s\",\"symbol\":\"%s\",\"direction\":\"%s\",\"result\":\"%s\",\"price\":%.2f,\"profit\":%.2f,\"lots\":%.2f,\"hour\":%d,\"day_of_week\":%d,\"total_trades\":%d,\"wins\":%d,\"losses\":%d,\"balance\":%.2f,\"signature\":\"%s\",\"setup\":\"%s\",\"regime\":\"%s\"}",
      InpLicensePIN, Symbol(), dir, result2, price, profit, lots, dt.hour, dt.day_of_week, totalTrades, wins, losses, accInfo.Balance(),
      lastSignalSignature, lastSignalSetup, RegimeName());
   char pd[], res[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   WebRequest("POST", InpServerURL + "/api/journal/log", "Content-Type: application/json\r\n", 5000, pd, res, rh);
}

void SendWeeklyReport()
{
   if(InpBacktestMode) return;                    // Tester: no network
   if(StringLen(InpServerURL) < 10 || totalTrades == 0) return;
   double wr = totalTrades > 0 ? (double)wins / totalTrades * 100 : 0;
   double wPnL = accInfo.Equity() - weeklyStartEquity;
   double wPct = weeklyStartEquity > 0 ? wPnL / weeklyStartEquity * 100 : 0.0;
   string body = StringFormat("{\"pin\":\"%s\",\"symbol\":\"%s\",\"trades\":%d,\"wins\":%d,\"losses\":%d,\"win_rate\":%.1f,\"weekly_pnl\":%.2f,\"weekly_pct\":%.1f,\"balance\":%.2f,\"patterns\":%d,\"best_hour\":0,\"worst_hour\":0}",
      InpLicensePIN, Symbol(), totalTrades, wins, losses, wr, wPnL, wPct, accInfo.Equity(), patternCount);
   char pd[], res[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   WebRequest("POST", InpServerURL + "/api/journal/weekly-report", "Content-Type: application/json\r\n", 10000, pd, res, rh);
}

//+------------------------------------------------------------------+
//| DASHBOARD                                                        |
//+------------------------------------------------------------------+
void UpdateDashboard(int signal, double score, string grade)
{
   double eq = accInfo.Equity(), bal = accInfo.Balance();
   double dPnL = eq - dailyStartEquity, wPnL = eq - weeklyStartEquity;
   double wr = totalTrades > 0 ? (double)wins / totalTrades * 100 : 0;
   string d = "\n";
   d += "==========================================\n";
   d += " XAUAI SNIPER v5.9.1 | MODE:" + g_modeName + " | ";
   d += InpBacktestMode ? "BACKTEST MODE\n" : "LIVE\n";
   d += "==========================================\n";
   d += StringFormat("Bal: $%.0f | Eq: $%.0f\n", bal, eq);
   d += StringFormat("Daily: $%.0f | Weekly: $%.0f (%.1f%%/%.0f%%)\n", dPnL, wPnL, weeklyStartEquity > 0 ? wPnL/weeklyStartEquity*100 : 0.0, InpWeeklyTarget);
   d += "------------------------------------------\n";
   d += StringFormat("Regime: %s | Session: %.2f\n", RegimeName(), GetSessionQuality());
   double dRsi = ArraySize(bufRSI) >= 2 ? bufRSI[1] : 0;
   double dAtr = ArraySize(bufATR) >= 2 ? bufATR[1] : 0;
   d += StringFormat("RSI: %.1f | ATR: %.2f | Spread: %.0f\n", dRsi, dAtr, (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD));
   d += StringFormat("Last Score: %.1f [%s]\n", score, grade);
   d += "------------------------------------------\n";
   d += StringFormat("Open: %d/%d (pyr max %d) | Today: %d/%d\n", CountMyPositions(), InpMaxOpenTrades, 1+InpMaxPyramidAdds, todayTradeCount, EffectiveMaxTradesPerDay());
   d += StringFormat("Trades: %d | Win: %.0f%% | ML: %d\n", totalTrades, wr, patternCount);
   d += StringFormat("AI: %s | News: %s | Careful: %s\n", InpUseAI?"ON":"OFF", InpUseNewsFilter?"ON":"OFF", InpCarefulMode?"ON":"OFF");
   if(StringLen(g_lastSkipReason) > 0)
      d += "Idle reason: " + StringSubstr(g_lastSkipReason, 0, 120) + "\n";
   d += StringFormat("DXY: %s (%s) | Drawdown: %s | Re-entry: %s\n",
        dxyGoldBias, InpUseDXYFilter?"ON":"OFF",
        drawdownActive?"ACTIVE":"off",
        (lastClose.valid && lastClose.wasLoss && !lastClose.reEntered && TimeCurrent()-lastClose.closeTime < InpReEntryWindow) ? "WATCHING" : "idle");
   if(IsInStreakPause()) d += StringFormat("STREAK PAUSE until %s\n", TimeToString(streakPauseUntil, TIME_SECONDS));
   if(buyLockoutUntil  > TimeCurrent()) d += StringFormat("DIR-LOCK BUY until %s\n",  TimeToString(buyLockoutUntil,  TIME_SECONDS));
   if(sellLockoutUntil > TimeCurrent()) d += StringFormat("DIR-LOCK SELL until %s\n", TimeToString(sellLockoutUntil, TIME_SECONDS));
   // v4.9.4 — Basket Protect live state
   if(InpBasketMode && CountMyPositions() > 0)
   {
      double bskPnL = 0;
      for(int bi = PositionsTotal() - 1; bi >= 0; bi--)
         if(posInfo.SelectByIndex(bi) && posInfo.Magic() == InpMagicNumber && posInfo.Symbol() == Symbol())
            bskPnL += posInfo.Profit() + posInfo.Swap() + posInfo.Commission();
      d += StringFormat("BASKET │ PnL $%.2f │ Peak $%.2f │ Floor $%.2f │ %s%s\n",
           bskPnL, g_basketPeakUSD, g_basketFloorUSD,
           g_basketArmed ? "ARMED" : "watching",
           g_basketBEHit ? " +BE" : "");
   }
   if(StringLen(currentTradeThesis) > 0 && CountMyPositions() > 0)
   {
      d += "-- TRADE THESIS --\n";
      if(currentTradeConfidence > 0) d += StringFormat("Confidence: %d%%\n", currentTradeConfidence);
      d += currentTradeThesis + "\n";
      if(StringLen(currentTradeBearishCase) > 0) d += "Counter: " + currentTradeBearishCase + "\n";
      if(StringLen(currentTradeInvalidation) > 0) d += "Invalidation: " + currentTradeInvalidation + "\n";
      if(StringLen(currentTradeTarget) > 0)       d += "Target: " + currentTradeTarget + "\n";
   }
   if(StringLen(lastExitReason) > 0) d += StringFormat("Last Exit: %s\n", lastExitReason);
   d += "==========================================\n";
   if(weeklyTargetHit) d += ">> WEEKLY TARGET HIT — RESTING <<\n";
   if(weeklyLossHit) d += "!! WEEKLY LOSS LIMIT — STOPPED !!\n";
   if(dailyLimitHit) d += "!! DAILY LIMIT — CLOSED ALL !!\n";
   Comment(d);
}
//+------------------------------------------------------------------+
