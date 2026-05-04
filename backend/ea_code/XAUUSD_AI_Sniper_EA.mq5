//+------------------------------------------------------------------+
//|                                     XAUUSD_AI_Sniper_EA.mq5      |
//|                                     XauAI Sniper — M5 Gold Edition|
//|                                     v4.9.6 — Self-Diagnostic       |
//+------------------------------------------------------------------+
#property copyright "XauAI Sniper by emriz.eth"
#property link      "https://xauaisniper.com"
#property version   "4.96"
#property description "XAUUSD AI Sniper v4.9.6 — Self-Diagnostic (startup banner + live heartbeat)"
#property description "Prints exactly why bot is idle every 60s. Plus all v4.9.5 Clean Exits logic."
#property description "Catches: symbol mismatch, WebRequest not whitelisted, Algo Trading off, spread too wide, buffers not ready"
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
input group "=== PRESERVATION MODE (v4.7.2 — let winners run, don't trade like scalper) ==="
input group "=== ACCOUNT MODE (v4.8.2 — one-input preset for risk profile) ==="
enum ENUM_ACCT_MODE { ACCT_BALANCED, ACCT_CONSERVATIVE, ACCT_AGGRESSIVE };
input ENUM_ACCT_MODE InpAccountMode = ACCT_BALANCED;  // v4.9.3: BALANCED=1.2% | CONSERVATIVE=0.6% | AGGRESSIVE=2.0%

input bool   InpPreservationMode = true;  // Master toggle: disables premature profit-side exits
input double InpRiskPercent    = 0.4;      // Base risk per trade (%) — IGNORED if InpAccountMode != BALANCED uses preset

input group "=== TP AUTO-EXTEND (v4.7.3 — push TP forward as winner runs) ==="
input bool   InpTPAutoExtend     = true;   // When profit nears TP, push TP further so the runner keeps running
input double InpTPExtendTriggerPct = 80.0; // Extend TP when profit reaches this % of TP-distance (e.g. 80%)
input double InpTPExtendATRMulti = 1.5;    // Extend by this × ATR (added to current TP)
input int    InpTPExtendMaxTimes = 5;      // Max extensions per position (cost: 0 — pure MQL5)
input double InpMaxLots        = 10.0;     // Hard max lots
input double InpMaxRiskPctEquity = 3.0;    // v4.9.3 — Was 1.5, now 3.0 (allow A+ big signals to pass)
input double InpMaxTotalLots   = 0;        // v4.7.6 — Hard cap on TOTAL OPEN LOTS across all positions (0 = auto = 3% equity worst-case)
input double InpMaxAggregateRiskPct = 8.0; // v4.9.3 — Was 4.0, now 8.0 (more room for layered trades)
input double InpDailyLossLimit = 6.0;      // Daily loss cap (%) — set 0 to disable
input int    InpMaxOpenTrades  = 5;        // Max open positions
input int    InpMaxTradesPerDay= 30;       // No artificial limit until target
input double InpWeeklyTarget   = 50.0;     // Weekly profit target (%) — set 0 to disable
input double InpWeeklyMaxLoss  = 15.0;     // Weekly max loss (%) — set 0 to disable
input bool   InpCarefulMode    = true;     // Scale down near target

input group "=== STRATEGY ==="
input int    InpEMAFast        = 50;       // Fast EMA
input int    InpEMASlow        = 200;      // Slow EMA

input group "=== CONTEXT ENGINE (v4.8.0/v4.8.1 — HTF + Swing-S/R, smarter entries) ==="
input bool   InpUseH4Bias        = true;   // Require H4 EMA align with trade direction (strong bias filter)
input double InpH4NeutralPct     = 0.25;   // v4.8.1 — If H4 EMAs within this % apart → treat as neutral (allow trade)
input bool   InpUseSRFilter      = true;   // Block entries too close to recent swing highs/lows
input int    InpSRLookback       = 40;     // v4.8.1 — Bars back (was 60 = 5hr; now 40 = 3.3hr, less cluttered)
input double InpSRProximityATR   = 0.2;    // v4.8.1 — Block if within X × ATR of swing (was 0.4 = way too strict)
input bool   InpContextGateLog   = true;   // Print PASS lines too so you can see the gate is working
input int    InpRSIPeriod      = 14;       // RSI Period
input int    InpATRPeriod      = 14;       // ATR Period
input double InpSLMultiplier   = 2.5;      // v4.9.5 — wider SL (was 2.0) to survive M5 noise
input double InpTPMultiplier   = 4.0;      // v4.9.5 — wider TP (was 2.0) so runners can reach +4R

input group "=== SMART FEATURES ==="
input bool   InpUseAI          = true;     // Use Claude + GPT-5.2
input bool   InpUseNewsFilter  = true;     // Hard-block ±10min around news
input bool   InpLearnPatterns  = true;     // ML learning loop
input int    InpMaxPatterns    = 500;      // Pattern memory size
input string InpServerURL      = "https://xauaisniper.com";
input bool   InpBacktestMode   = false;    // TRUE = Strategy Tester (disables ALL WebRequests)

input group "=== TUNABLE THRESHOLDS (walk-forward optimize these) ==="
input double InpGradeAPlus     = 5.5;      // Combined score for A+ (default 5.5)
input double InpGradeA         = 4.0;      // Combined score for A  (default 4.0)
input double InpGradeB         = 2.5;      // Combined score for B / pass cutoff (default 2.5)
input int    InpTradeCooldown  = 300;      // Seconds between trades after a close (default 300)
input int    InpReversalCooldown = 600;    // Extra seconds required to flip direction (default 600)
input int    InpProfitTakeMin  = 150;      // Start scanning for quick exit (USD, default 150)
input int    InpProfitTakeMax  = 500;      // Auto-close at this profit (USD, default 500)
input int    InpQuickExitMin   = 18;       // Auto-close minutes threshold (default 18)

input group "=== RE-ENTRY ENGINE (reverse-move recovery) ==="
input bool   InpUseReEntry     = true;     // Auto re-enter if SL was noise
input int    InpReEntryWindow  = 900;      // Seconds after close to watch for reversal (15min)
input double InpReEntryFactor  = 1.2;      // Price must move this x SL past original entry
input double InpReEntrySize    = 0.5;      // Re-entry size multiplier (0.5 = half original)
input int    InpMaxReEntriesPerDay = 3;    // Hard cap on re-entries per trading day

input group "=== SMART FILTERS ==="
input bool   InpUseDXYFilter   = true;     // Skip trades fighting DXY direction
input int    InpDXYRefreshSec  = 900;      // Refresh DXY every N seconds (15min)
input bool   InpDrawdownMode   = true;     // Auto-reduce risk after losing streak
input int    InpDrawdownLosses = 3;        // # losses in a day that trigger recovery
input double InpDrawdownRisk   = 0.5;      // Risk % during recovery mode (default 0.5)
input int    InpStreakCooldownLosses = 3;  // # losses in short window = pause
input int    InpStreakWindowSec = 2700;    // Window for loss-streak detection (45min)
input int    InpStreakPauseSec = 1200;     // Pause duration after streak (20min)
input bool   InpAsiaRangeBreakout = true;  // Enable Asia-range breakout setup at London/NY open
input bool   InpAdaptiveGrades = true;     // Auto-tune grade thresholds from recent win rate
input bool   InpResetML        = false;    // TRUE = clear local ML on attach (fresh start for this version)
input bool   InpDirectionLockout = true;   // Lock a direction if too many same-direction losses
input int    InpDirLockoutLookback = 5;    // Check last N trades
input int    InpDirLockoutLossesNeeded = 3;// If N of last M were losses in same direction
input int    InpDirLockoutMinutes = 60;    // Lock that direction for X minutes

input group "=== CONVICTION-WEIGHTED SIZING (v4.5.0 — use Claude/GPT confidence) ==="
input bool   InpConvictionSizing = true;   // Scale lot size by AI confidence
input int    InpMinAIConfidence  = 60;     // Below this, SKIP entirely (AI is too uncertain)
input int    InpNormalAIConfidence = 75;   // At/above this, use normal 1.0x size
input int    InpHighAIConfidence   = 90;   // At/above this, use 1.3x boost size
input double InpConvictionLowMulti  = 0.5; // 60-74% confidence -> 0.5x size
input double InpConvictionHighMulti = 1.3; // >=90% confidence -> 1.3x size
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

input group "=== BASKET PROTECT (v4.9.4 — protect TOTAL floating profit across ALL open trades) ==="
input bool   InpBasketMode          = true;   // Master toggle: SL logic works on AGGREGATE PnL, not per-trade
input double InpBasketArmPct        = 1.0;    // Arm basket-lock when total floating ≥ X% of balance ($53k×1% = $530)
input double InpBasketArmFloor      = 100.0;  // Absolute floor: don't arm before $100 floating (micro-accts)
input double InpBasketLockMinPct    = 60.0;   // Once armed, lock AT LEAST this % of peak as floor (60% = 40% max giveback)
input double InpBasketRatchetT1Pct  = 0.5;    // Tier 1 giveback floor: at peak≥0.5% bal, floor=50% of peak
input double InpBasketRatchetT2Pct  = 2.5;    // Tier 2: at peak≥2.5% bal, floor=60% of peak (ratchets UP)
input double InpBasketRatchetT3Pct  = 5.0;    // Tier 3: at peak≥5% bal,   floor=70% of peak (very protective)
input double InpBasketBEPct         = 0.3;    // Once basket reached +0.3% balance, never let it go negative again
input bool   InpBasketDisablePerTrade = true; // When basket active, disable per-trade peak-lock & ratchet (no conflict)

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

input group "=== CLEAN EXITS (v4.9.5 — ONE exit authority per phase, simple & effective) ==="
input bool   InpCleanExits          = true;   // MASTER toggle — disables all other per-trade trails
input double InpCleanBEActivateR    = 1.0;    // At +1R, move SL to entry + small cushion
input double InpCleanBECushionR     = 0.2;    // Cushion locked at BE trigger (+0.2R profit)
input double InpCleanChandelierStartR = 2.0;  // At +2R, chandelier trail kicks in
input double InpCleanChandelierATR1 = 3.0;    // Chandelier distance +2R→+4R (wide, let runner breathe)
input double InpCleanChandelierATR2 = 2.0;    // Chandelier distance +4R+ (tighter, bank more)
input double InpCleanPartialR       = 3.0;    // At +3R, close partial
input double InpCleanPartialPct     = 30.0;   // % of position to close at +3R
input int    InpCleanChandelierLookback = 20; // Bars to scan for highest high / lowest low
input bool   InpCleanMomentumInvalidation = true; // Cut trade if momentum flips hard against us
input int    InpCleanStaleHours     = 4;      // Close if > X hours in AND profit < StaleMinR
input double InpCleanStaleMinR      = 0.5;    // Threshold below which we consider trade stale

input group "=== AI EXIT BRAIN (v4.7.0 — let Claude veto bad rule-based closes) ==="
input bool   InpAIExitOverride   = true;   // Ask Claude before any rule-based close (HOLD/CLOSE/LOCK $X)
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
input bool   InpHardStopRBased = true;     // TRUE = HardStop = 3× original SL risk (adaptive, not $-absolute)
input double InpHardStopRMulti = 3.0;      // HardStop fires at this × initial risk (3R = catastrophic only)
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
input int    InpMaxPyramidAdds  = 4;       // Total concurrent = 1 original + this many adds (default 5 total)
input double InpPyramidMinATR   = 0.3;     // Price must move at least this × ATR before adding
input double InpPyramidSizeMulti= 0.6;     // Each add is this × previous size (prevents martingale blow-up)
input int    InpPyramidMinGapSec= 120;     // Min seconds between pyramid adds
input bool   InpPyramidOnAdverse= true;    // Add when price moves AGAINST us (better entry, averaging in)
input bool   InpPyramidOnTrend  = true;    // Add when price moves WITH us (trend continuation)

input group "=== POST-WINNER ENTRY GUARD (v4.6.5 — user-tunable cooldown) ==="
input bool   InpPostWinnerGuard    = true;   // Block re-entry in same direction after a winner (set false to disable)
input int    InpPostWinnerCoolMin  = 5;      // Cooldown minutes after a winning close (was 30, now 5)
input double InpPostWinnerATRBump  = 0.5;    // Need price ≥ this×ATR better to bypass cooldown

//+------------------------------------------------------------------+
//| ENUMS                                                            |
//+------------------------------------------------------------------+
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
string lastSignalSetup = "";
string lastSignalSignature = "";

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
   double slDist;          // price distance of SL at entry
   double lots;
   datetime closeTime;
   string signature;
   string setup;
};
LastClose  lastClose;

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

// Re-entry safety counters
int        todayReEntryCount = 0;

// Asia range tracking (reset daily, tracked between 00:00-07:00 broker time)
double     asiaRangeHigh = 0;
double     asiaRangeLow  = 0;
bool       asiaRangeLocked = false;
datetime   asiaRangeDay = 0;

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
datetime   g_basketLastLog   = 0;     // Throttle "basket state" prints

// v4.9.6 — DIAGNOSTIC HEARTBEAT state
string     g_lastSkipReason  = "";    // Updated every time OnTick returns silently
datetime   g_lastHeartbeat   = 0;     // Throttle heartbeat to 1/minute
int        g_ticksSinceEntry = 0;     // How many ticks since last position opened

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

// Dashboard state cache — prevents throttled refresh from wiping scan data to zero
int        lastDashSignal = 0;
double     lastDashScore  = 0.0;
string     lastDashGrade  = "";

// Peak helpers
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

   // Execute modify — log any failure so they're no longer silent
   if(!trade.PositionModify(ticket, newSL, tp))
   {
      uint ret = trade.ResultRetcode();
      int  err = GetLastError();
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
   double bal = accInfo.Balance();
   if(bal <= 0) bal = accInfo.Equity();
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

   // Pull last 50 ATR values, compute median
   double samples[50];
   int got = CopyBuffer(hATR, 0, 1, 50, samples);
   if(got < 20) return 1.0;
   // Simple selection sort top-50 — small enough to be cheap
   for(int a = 0; a < got - 1; a++)
      for(int b = a + 1; b < got; b++)
         if(samples[b] < samples[a])
         { double t = samples[a]; samples[a] = samples[b]; samples[b] = t; }
   double median = samples[got / 2];
   if(median <= 0) return 1.0;

   double ratio = cur / median;
   if(ratio >= InpVolSpikeMulti) return InpVolSpikeReduce;
   if(ratio <= InpVolCalmMulti)  return InpVolCalmBoost;
   return 1.0;
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
   // === Gate 1: H4 HTF bias alignment ===
   if(InpUseH4Bias)
   {
      double h4F = (ArraySize(bufEMAFast_H4) > 1) ? bufEMAFast_H4[1] : 0;
      double h4S = (ArraySize(bufEMASlow_H4) > 1) ? bufEMASlow_H4[1] : 0;
      if(h4F > 0 && h4S > 0)
      {
         bool h4Up   = (h4F > h4S);
         bool h4Down = (h4F < h4S);
         // Neutral zone: H4 EMAs close together = no strong HTF bias, allow trade.
         // Default 0.25% apart — wider than v4.8.0's 0.1% which was blocking too many valid entries.
         double spread = MathAbs(h4F - h4S) / h4S * 100;
         if(spread >= InpH4NeutralPct)
         {
            if(signal == 1 && !h4Up)
            {
               Print("⛔ CONTEXT-GATE: BUY blocked — H4 EMA50 < EMA200 (bearish HTF bias). Don't fight the trend.");
               return false;
            }
            if(signal == -1 && !h4Down)
            {
               Print("⛔ CONTEXT-GATE: SELL blocked — H4 EMA50 > EMA200 (bullish HTF bias). Don't fight the trend.");
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

      // BUY trying to enter within proxDist BELOW a swing high = entering into resistance
      if(signal == 1 && swingHigh > 0 && (swingHigh - curPrice) > 0 && (swingHigh - curPrice) < proxDist)
      {
         Print("⛔ CONTEXT-GATE: BUY blocked — price ", DoubleToString(curPrice, 2),
               " is ", DoubleToString(swingHigh - curPrice, 2),
               " below swing high ", DoubleToString(swingHigh, 2),
               " (< ", DoubleToString(proxDist, 2), " = ", DoubleToString(InpSRProximityATR, 1),
               "×ATR). Entering into resistance without break-retest.");
         return false;
      }
      // SELL trying to enter within proxDist ABOVE a swing low = entering into support
      if(signal == -1 && swingLow < 999999 && (curPrice - swingLow) > 0 && (curPrice - swingLow) < proxDist)
      {
         Print("⛔ CONTEXT-GATE: SELL blocked — price ", DoubleToString(curPrice, 2),
               " is ", DoubleToString(curPrice - swingLow, 2),
               " above swing low ", DoubleToString(swingLow, 2),
               " (< ", DoubleToString(proxDist, 2), " = ", DoubleToString(InpSRProximityATR, 1),
               "×ATR). Entering into support without break-retest.");
         return false;
      }
   }

   if(InpContextGateLog)
      Print("✅ CONTEXT-GATE PASS: ", signal==1?"BUY":"SELL",
            " cleared H4 bias + Swing-SR checks. Proceeding to OpenTrade.");
   return true;
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
   hEMAFast_H4 = iMA(Symbol(), PERIOD_H4, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow_H4 = iMA(Symbol(), PERIOD_H4, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
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
   currentTradeThesis = ""; currentTradeInvalidation = ""; currentTradeTarget = "";
   currentTradeBearishCase = ""; currentTradeConfidence = 0;
   lastDashSignal = 0; lastDashScore = 0.0; lastDashGrade = "";
   RecomputeAutoScale();
   lastClose.valid = false; lastClose.reEntered = false; lastClose.wasLoss = false;
   lastClose.dir = 0; lastClose.entryPrice = 0; lastClose.slDist = 0;
   lastClose.lots = 0; lastClose.closeTime = 0; lastClose.signature = ""; lastClose.setup = "";
   dxyLastFetch = 0; dxyGoldBias = "neutral";
   LoadPatterns();

   Print("=== XAUAI SNIPER v4.9.6 (SELF-DIAGNOSTIC) READY ===");

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
         " | OnTrend=", InpPyramidOnTrend?"Y":"N");
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
   Print("CONVICTION: ", InpConvictionSizing?"ON":"OFF",
         " | MinConf=", InpMinAIConfidence, "% (below = SKIP)",
         " | NormalConf=", InpNormalAIConfidence, "% (x1.0)",
         " | HighConf=", InpHighAIConfidence, "% (x", DoubleToString(InpConvictionHighMulti, 2), ")",
         " | LowMulti=x", DoubleToString(InpConvictionLowMulti, 2));
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
   Print("PARTIAL-TP v4.5.4: ", InpPartialTP?"ON":"OFF",
         " | Fires at +", DoubleToString(InpPartialTPAtR,2), "R",
         " | Close ", DoubleToString(InpPartialPct*100, 0), "% of position",
         " | Skip on ≥", InpConvRunMinConf, "% conf=", InpPartialSkipHighConf?"Y":"N");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hEMAFast); IndicatorRelease(hEMASlow);
   IndicatorRelease(hRSI); IndicatorRelease(hATR); IndicatorRelease(hBBUpper);
   IndicatorRelease(hEMAFast_H1); IndicatorRelease(hEMASlow_H1); IndicatorRelease(hRSI_M15);
   IndicatorRelease(hEMAFast_H4); IndicatorRelease(hEMASlow_H4);
   IndicatorRelease(hStoch);
   SavePatterns();
   Print("=== v4.9.6 STOPPED | Trades:", totalTrades, " W:", wins, " L:", losses, " ===");
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
   if(InpBacktestMode) return 0;                       // Tester: no network
   if(StringLen(InpServerURL) < 10 || StringLen(signature) == 0) return 0;
   string url = InpServerURL + "/api/ml/hive/score";
   string headers = "Content-Type: application/json\r\n";
   string body = StringFormat("{\"signature\":\"%s\",\"window_days\":7}", signature);
   char pd[], result[]; string rh;
   StringToCharArray(body, pd, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 8000, pd, result, rh);
   if(res != 200) return 0;
   string response = CharArrayToString(result);
   if(StringFind(response, "\"BOOST\"") >= 0) return 1;
   if(StringFind(response, "\"VETO\"")  >= 0) return -1;
   return 0;
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

bool IsDirectionLocked(int dir)
{
   if(!InpDirectionLockout) return false;
   if(dir ==  1 && buyLockoutUntil  > TimeCurrent()) return true;
   if(dir == -1 && sellLockoutUntil > TimeCurrent()) return true;
   return false;
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
   else if(todayLossCount > 0) todayLossCount--;   // a win reduces recent-loss stress
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
//| Fires ONCE if lastClose was a LOSS and price has now reversed    |
//| back past original entry in the original direction.              |
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
   // Reversal threshold: price must travel >= factor * SL past original entry
   double trigger = lastClose.slDist * InpReEntryFactor;
   bool reversalBuy  = (lastClose.dir ==  1 && curPrice >= lastClose.entryPrice + trigger);
   bool reversalSell = (lastClose.dir == -1 && curPrice <= lastClose.entryPrice - trigger);
   if(!reversalBuy && !reversalSell) return;

   // Use latest ATR for new SL sizing; bail if indicators not ready
   if(ArraySize(bufATR) < 2 || bufATR[1] <= 0) return;

   Print("RE-ENTRY TRIGGER (", todayReEntryCount+1, "/", InpMaxReEntriesPerDay, "): last ", lastClose.dir==1?"BUY":"SELL",
         " stopped at ", DoubleToString(lastClose.entryPrice, _Digits),
         " | price now ", DoubleToString(curPrice, _Digits),
         " (", DoubleToString((curPrice-lastClose.entryPrice)/lastClose.slDist, 2), "R past entry)");

   lastClose.reEntered = true;  // one-shot per original close
   todayReEntryCount++;
   lastSignalDir = lastClose.dir;
   lastSignalSignature = lastClose.signature;
   lastSignalSetup = "RE_ENTRY";
   OpenTrade(lastClose.dir, bufATR[1], "RE_ENTRY", InpReEntrySize);
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
   // London fix windows (special regime)
   if((h == 10 && dt.min >= 20) || (h == 15 && dt.min <= 10)) return 0.65;
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

   int bestDir = 0;
   double bestScore = 0;
   string bestName = "";
   int bestType = 0;

   // === SETUP 1: TREND PULLBACK ===
   if(currentRegime == REGIME_TRENDING_UP || currentRegime == REGIME_TRENDING_DOWN)
   {
      double s = 0;
      int dir = currentRegime == REGIME_TRENDING_UP ? 1 : -1;
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
   if(currentRegime == REGIME_RANGING || currentRegime == REGIME_LOW_VOL || currentRegime == REGIME_CHOPPY)
   {
      // BUY at lower BB
      double s = 0; int dir = 0;
      if(close1 <= bbL + (bbU - bbL) * 0.2)
      {
         dir = 1; s += 1.0;
         if(rsi < 35) s += 1.5;
         if(body > 0 && lowerWick > body * 0.5) s += 1.5; // rejection wick (guard against doji)
         if(close1 > open1) s += 1.0;
         if(m15RSI < 40) s += 0.5;
         if(close2 < close1) s += 0.5; // momentum turning
      }
      if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "RANGE_REVERSAL"; bestType = 2; }

      // SELL at upper BB
      s = 0;
      if(close1 >= bbU - (bbU - bbL) * 0.2)
      {
         dir = -1; s += 1.0;
         if(rsi > 65) s += 1.5;
         if(body > 0 && upperWick > body * 0.5) s += 1.5; // rejection wick (guard against doji)
         if(close1 < open1) s += 1.0;
         if(m15RSI > 60) s += 0.5;
         if(close2 > close1) s += 0.5;
      }
      if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "RANGE_REVERSAL"; bestType = 2; }
   }

   // === SETUP 3: BREAKOUT ===
   if(currentRegime == REGIME_BREAKOUT_UP || currentRegime == REGIME_BREAKOUT_DOWN)
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
   {
      double bbW = (bbU - bbL) / close1 * 100;
      double prevW = 0;
      if(bufBBUpper[10] > 0) prevW = (bufBBUpper[10] - bufBBLower[10]) / iClose(Symbol(), PERIOD_M5, 10) * 100;
      if(prevW > 0 && bbW > prevW * 1.5) // BB expanding 50%+
      {
         double s = 1.5;
         int dir = close1 > bbM ? 1 : -1;
         if(body > atr * 0.4) s += 1.0;
         if(dir == 1 && rsi > 50) s += 0.5;
         if(dir == -1 && rsi < 50) s += 0.5;
         if(dir == 1 && emaF > emaS) s += 1.0;
         if(dir == -1 && emaF < emaS) s += 1.0;
         if(dir == 1 && h1F > h1S) s += 1.0;
         if(dir == -1 && h1F < h1S) s += 1.0;
         if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "SQUEEZE_RELEASE"; bestType = 4; }
      }
   }

   // === SETUP 5: RSI EXTREME (like VWAP reclaim) ===
   {
      double s = 0; int dir = 0;
      if(rsi < 25 && close1 > open1) { dir = 1; s = 2.0 + (close1 > emaF ? 1.0 : 0) + (m15RSI < 30 ? 1.0 : 0) + (body > 0 && lowerWick > body ? 1.0 : 0); }
      if(rsi > 75 && close1 < open1) { dir = -1; s = 2.0 + (close1 < emaF ? 1.0 : 0) + (m15RSI > 70 ? 1.0 : 0) + (body > 0 && upperWick > body ? 1.0 : 0); }
      if(s > bestScore) { bestScore = s; bestDir = dir; bestName = "RSI_EXTREME"; bestType = 5; }
   }

   // === SETUP 6: LONDON FIX PIN ===
   {
      MqlDateTime dt; TimeCurrent(dt);
      bool isLondonFix = (dt.hour == 10 && dt.min >= 20 && dt.min <= 40) || (dt.hour == 15 && dt.min <= 15);
      if(isLondonFix)
      {
         double s = 1.5; int dir = 0;
         // Fade the pin — if price spiked up, sell; if spiked down, buy
         double move = close1 - iClose(Symbol(), PERIOD_M5, 4);
         if(move > atr * 0.8) { dir = -1; s += 1.5; } // spike up → fade sell
         if(move < -atr * 0.8) { dir = 1; s += 1.5; } // spike down → fade buy
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
      if(rsi < 28 && close1 < bbL + (bbU - bbL) * 0.15 && m15RSI < 35)
      {
         dir = 1; s = 2.5 + (body > 0 && lowerWick > body * 0.5 ? 1.0 : 0) + (close1 > open1 ? 1.0 : 0);
      }
      if(rsi > 72 && close1 > bbU - (bbU - bbL) * 0.15 && m15RSI > 65)
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

void CheckPyramidOpportunity()
{
   if(!InpAllowPyramid) return;
   if(IsInStreakPause()) return;
   if(drawdownActive) return;             // don't stack in drawdown recovery
   if(dailyLimitHit || weeklyLossHit) return;

   // Spread guard
   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   if(spread > InpMaxSpread) return;

   // Throttle: min gap between pyramid adds
   if(TimeCurrent() - lastPyramidAddTime < InpPyramidMinGapSec) return;

   int openCount = CountMyPositions();
   if(openCount == 0) return;                               // no base trade to stack on
   if(openCount >= 1 + InpMaxPyramidAdds) return;           // cap hit
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

   // Regime must still support the direction
   ENUM_REGIME r = currentRegime;
   bool regimeOk = false;
   if(isBuy)
      regimeOk = (r == REGIME_TRENDING_UP || r == REGIME_BREAKOUT_UP ||
                  r == REGIME_RANGING || r == REGIME_LOW_VOL);
   else
      regimeOk = (r == REGIME_TRENDING_DOWN || r == REGIME_BREAKOUT_DOWN ||
                  r == REGIME_RANGING || r == REGIME_LOW_VOL);
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

   bool adverseTrigger = InpPyramidOnAdverse && moved <= -minMove;
   bool trendTrigger   = InpPyramidOnTrend   && moved >=  (atr * 0.5);
   if(!adverseTrigger && !trendTrigger) return;

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
   double addLotRaw = origLot * decayFactor;
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
   string why = adverseTrigger
      ? StringFormat("PYR+ADV (%.2f ATR adverse, avg-in)", MathAbs(moved)/atr)
      : StringFormat("PYR+TRN (%.2f ATR with trend)", moved/atr);

   Print("PYRAMID: adding #", openCount + 1, "/", (1 + InpMaxPyramidAdds),
         " ", isBuy?"BUY":"SELL", " ", DoubleToString(addLot, lotDigits),
         " lots @ ", DoubleToString(entryPx, digits),
         " | origPx=", DoubleToString(origPx, digits),
         " | moved=", DoubleToString(moved, 2),
         " | totalLots=", DoubleToString(totalLots, lotDigits),
         " | ", why);

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

   bool ok;
   if(isBuy) ok = trade.Buy (addLot, Symbol(), 0, pyramidSL, origTP, "XAU-SNIPER|" + why);
   else      ok = trade.Sell(addLot, Symbol(), 0, pyramidSL, origTP, "XAU-SNIPER|" + why);

   if(ok)
   {
      lastPyramidAddTime = TimeCurrent();
      todayTradeCount++;
      Print("PYRAMID OK");
   }
   else
   {
      Print("PYRAMID FAILED: Err=", GetLastError(), " Ret=", trade.ResultRetcode());
   }
}

//+------------------------------------------------------------------+
//| TICK                                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!licenseValid) { g_lastSkipReason = "LICENSE_INVALID (enter correct PIN in inputs)"; return; }

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
      else if(openPs > 0)  status = StringFormat("MANAGING %d OPEN POSITION(S) — entries paused while positions active", openPs);
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
      todayTradeCount = 0; dailyLimitHit = false;
      lastDayReset = TimeCurrent();
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

   // === v4.9.4 BASKET PROTECT (runs BEFORE per-trade management) ===
   // If total floating profit retraces past the dynamic basket floor,
   // ManageBasket() closes ALL positions at once. When that fires we
   // skip ManagePositions() entirely (the book is empty) and let the
   // dashboard update once before the next tick.
   if(ManageBasket())
   {
      UpdateDashboard(lastDashSignal, lastDashScore, lastDashGrade);
      return;
   }

   // === ALWAYS MANAGE OPEN POSITIONS (every tick, even on wide spread) ===
   // We intentionally run this BEFORE the spread gate so that news-time
   // spread spikes cannot prevent us from closing losing positions.
   ManagePositions();

   // === RE-ENTRY WATCHER (every tick, cheap) ===
   // If we just closed a loser and price has reversed back past our entry,
   // re-enter at reduced size once. Pure MQL5 — no AI call needed.
   CheckReEntryOpportunity();

   // === PYRAMID WATCHER (every tick) ===
   // If we have an open position and price has moved a meaningful distance
   // (adverse = better entry; with-trend = continuation), stack another
   // smaller position in the same direction while signal holds.
   CheckPyramidOpportunity();

   // === THROTTLED DASHBOARD REFRESH (every 2s, keeps UI live between bars) ===
   // Uses cached scan state so the display doesn't flicker to zeros between scans.
   static datetime lastDashTick = 0;
   if(TimeCurrent() - lastDashTick >= 2)
   {
      UpdateDashboard(lastDashSignal, lastDashScore, lastDashGrade);
      lastDashTick = TimeCurrent();
   }

   // Spread check — blocks NEW ENTRIES only
   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   if(spread > InpMaxSpread)
   {
      g_lastSkipReason = StringFormat("SPREAD_TOO_WIDE: %.0f > %d pts (wait for spread to narrow, or raise InpMaxSpread)", spread, InpMaxSpread);
      return;
   }

   // New M5 bar only for entries
   static datetime lastBar = 0;
   datetime curBar = iTime(Symbol(), PERIOD_M5, 0);
   if(curBar == lastBar) { g_lastSkipReason = "WAITING_FOR_NEW_M5_BAR"; return; }
   lastBar = curBar;

   // Update Asia-range tracker on every new M5 bar
   if(InpAsiaRangeBreakout) UpdateAsiaRange();

   // Load indicators
   if(CopyBuffer(hEMAFast, 0, 0, 12, bufEMAFast) < 12)      { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: EMA_FAST_M5"; return; }
   if(CopyBuffer(hEMASlow, 0, 0, 12, bufEMASlow) < 12)      { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: EMA_SLOW_M5"; return; }
   if(CopyBuffer(hRSI, 0, 0, 5, bufRSI) < 5)                 { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: RSI_M5"; return; }
   if(CopyBuffer(hATR, 0, 0, 5, bufATR) < 5)                 { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: ATR_M5"; return; }
   if(CopyBuffer(hBBUpper, 1, 0, 12, bufBBUpper) < 12)       { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: BB_UPPER"; return; }
   if(CopyBuffer(hBBUpper, 2, 0, 12, bufBBLower) < 12)       { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: BB_LOWER"; return; }
   if(CopyBuffer(hBBUpper, 0, 0, 12, bufBBMid) < 12)         { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: BB_MID"; return; }
   if(CopyBuffer(hEMAFast_H1, 0, 0, 3, bufEMAFast_H1) < 3)   { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: EMA_FAST_H1 (broker may need time to load H1 history)"; return; }
   if(CopyBuffer(hEMASlow_H1, 0, 0, 3, bufEMASlow_H1) < 3)   { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: EMA_SLOW_H1"; return; }
   if(CopyBuffer(hEMAFast_H4, 0, 0, 3, bufEMAFast_H4) < 3)   { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: EMA_FAST_H4 (load H4 chart once to prime buffer)"; return; }
   if(CopyBuffer(hEMASlow_H4, 0, 0, 3, bufEMASlow_H4) < 3)   { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: EMA_SLOW_H4"; return; }
   if(CopyBuffer(hRSI_M15, 0, 0, 3, bufRSI_M15) < 3)          { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: RSI_M15"; return; }
   if(CopyBuffer(hStoch, 0, 0, 3, bufStochK) < 3)             { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: STOCH_K"; return; }
   if(CopyBuffer(hStoch, 1, 0, 3, bufStochD) < 3)             { g_lastSkipReason="INDICATOR_BUFFER_NOT_READY: STOCH_D"; return; }

   if(CountMyPositions() >= InpMaxOpenTrades || todayTradeCount >= InpMaxTradesPerDay)
   { UpdateDashboard(0, 0, "MAX"); lastDashSignal=0; lastDashScore=0; lastDashGrade="MAX"; return; }

   // Cooldown
   if(lastTradeClose > 0 && TimeCurrent() - lastTradeClose < InpTradeCooldown)
   { UpdateDashboard(0, 0, "CD"); lastDashSignal=0; lastDashScore=0; lastDashGrade="CD"; return; }

   // Streak pause (after multiple quick losses)
   if(IsInStreakPause())
   {
      Print("STREAK PAUSE active — no new entries until ",
            TimeToString(streakPauseUntil, TIME_SECONDS));
      UpdateDashboard(0, 0, "PAUSED"); lastDashSignal=0; lastDashScore=0; lastDashGrade="PAUSED";
      return;
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

   // Combined quality
   double combinedScore = setupScore * regimeQuality * sessionQuality;

   // Adaptive grade threshold: tighten when recent WR is poor, loosen when strong
   double dynGradeB = InpGradeB;
   if(InpAdaptiveGrades && patternCount >= 20)
   {
      int winN = 0, lossN = 0;
      for(int i = patternCount - 1; i >= MathMax(0, patternCount - 20); i--)
      {
         if(patterns[i].wasWinner) winN++; else lossN++;
      }
      int totalN = winN + lossN;
      if(totalN >= 10)
      {
         double recentWR = (double)winN / totalN;
         if(recentWR < 0.40)      dynGradeB = MathMin(3.5, InpGradeB + 0.75);  // tighten
         else if(recentWR > 0.60) dynGradeB = MathMax(1.8, InpGradeB - 0.50);  // loosen
         // else keep default
      }
   }
   string grade = combinedScore >= InpGradeAPlus ? "A+" : combinedScore >= InpGradeA ? "A" : combinedScore >= dynGradeB ? "B" : "PASS";

   if(signal == 0 || combinedScore < dynGradeB)
   {
      Print("SCAN: ", RegimeName(), " | Session:", DoubleToString(sessionQuality, 2),
            " | Setup:", setupName, " Score:", DoubleToString(setupScore, 1),
            " Combined:", DoubleToString(combinedScore, 1), " [", grade, "] — PASS");
      UpdateDashboard(0, combinedScore, grade);
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = grade;
      return;
   }

   Print("SIGNAL: ", setupName, " ", signal > 0 ? "BUY" : "SELL",
         " | Regime:", RegimeName(), "(", DoubleToString(regimeQuality, 2), ")",
         " | Session:", DoubleToString(sessionQuality, 2),
         " | Score:", DoubleToString(setupScore, 1),
         " | Combined:", DoubleToString(combinedScore, 1), " [", grade, "]");

   // News check
   if(InpUseNewsFilter && !IsNewsSafe())
   {
      Print("NEWS BLOCK");
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
         Print("DXY VETO: gold_bias=", dxyGoldBias, " vs signal=", signal>0?"BUY":"SELL", " — skip");
         UpdateDashboard(0, combinedScore, "DXY-VETO");
         lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "DXY-VETO";
         return;
      }
   }

   // Anti-reversal (short cooldown for direction flip)
   if(lastTradeDir != 0 && signal != lastTradeDir && lastTradeClose > 0 &&
      TimeCurrent() - lastTradeClose < InpReversalCooldown)
   {
      Print("ANTI-REVERSAL: Wait before flipping direction");
      UpdateDashboard(0, combinedScore, "REV-CD");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "REV-CD";
      return;
   }

   // DIRECTION LOCKOUT — if this side has been losing repeatedly, skip it
   if(IsDirectionLocked(signal))
   {
      datetime until = (signal == 1) ? buyLockoutUntil : sellLockoutUntil;
      Print("DIR-LOCK VETO: ", signal == 1 ? "BUY" : "SELL",
            " side locked until ", TimeToString(until, TIME_SECONDS),
            " due to recent losses on this side");
      UpdateDashboard(0, combinedScore, signal == 1 ? "BUY-LOCKED" : "SELL-LOCKED");
      lastDashSignal = 0; lastDashScore = combinedScore;
      lastDashGrade = signal == 1 ? "BUY-LOCKED" : "SELL-LOCKED";
      return;
   }

   // Build exact signature for ML lookup + hive + journal
   string signature = BuildSignature(signal, setupName);

   // ============ GATE 4: RISK SIZING ============
   // v4.9.3 — Bigger lots scale with signal strength
   double sizeMulti = grade == "A+" ? 1.5 : grade == "A" ? 1.2 : 0.8;
   int    confidenceBoostPP = 0;   // in percentage points, informational

   // ----- LOCAL ML (hierarchical signature match, mirrors hive) -----
   if(InpLearnPatterns && patternCount >= 5)
   {
      double mlScore = GetMLScore(signal, signature);
      if(mlScore <= 0.30 && patternCount >= 10)
      {
         Print("LOCAL ML VETO: WR=", DoubleToString(mlScore * 100, 0), "% (", patternCount, " patterns) — HARD BLOCK");
         UpdateDashboard(0, combinedScore, "ML-VETO");
         lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "ML-VETO";
         return;
      }
      if(mlScore >= 0.60) { Print("LOCAL ML BOOST: WR=", DoubleToString(mlScore * 100, 0), "%"); sizeMulti += 0.15; confidenceBoostPP += 8; }
   }

   // ----- GLOBAL HIVE-MIND (7-day, all users, same signature) -----
   int hive = GetHiveVerdict(signature);
   if(hive == -1)
   {
      Print("HIVE VETO: signature ", signature, " has WR <= 30% globally — HARD BLOCK");
      UpdateDashboard(0, combinedScore, "HIVE-VETO");
      lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "HIVE-VETO";
      return;
   }
   if(hive == 1)
   { Print("HIVE BOOST: signature ", signature, " has WR >= 60% globally (+8pp)");
     sizeMulti += 0.15; confidenceBoostPP += 8; }

   // ============ GATE 5: DUAL-AI ENTRY (Claude 4.5 + GPT-5.2) ============
   if(grade == "A+" && InpUseAI && StringLen(InpServerURL) >= 10)
   {
      int aiResult = GetAIAnalysis(bufEMAFast[1], bufEMASlow[1], bufRSI[1], bufATR[1],
         iClose(Symbol(), PERIOD_M5, 1),    // closed bar — consistent with setup scoring
         bufEMAFast_H1[1] > bufEMASlow_H1[1] ? "BULL" : "BEAR", spread,
         setupName, RegimeName(), signature,
         ArraySize(bufStochK) >= 2 ? bufStochK[1] : 50.0,
         iClose(Symbol(), PERIOD_M5, 1) - iClose(Symbol(), PERIOD_M5, 5));

      if(aiResult == 0)
      { Print("DUAL-AI: SKIP — reducing to B size"); sizeMulti = MathMin(sizeMulti, 0.55); }
      else if(aiResult != signal)
      { Print("DUAL-AI: Disagrees — reducing to B size"); sizeMulti = MathMin(sizeMulti, 0.55); }
      else
      {
         Print("DUAL-AI: Confirms ", signal > 0 ? "BUY" : "SELL", " at ", lastAIConfidence, "% conf");

         // v4.5.0 — CONVICTION GATE: skip the trade entirely if AI is too uncertain.
         // Prevents marginal 50-60% confidence trades that historically lose money.
         if(InpConvictionSizing && lastAIConfidence > 0 && lastAIConfidence < InpMinAIConfidence)
         {
            Print("CONVICTION-VETO: AI confidence ", lastAIConfidence, "% < min ", InpMinAIConfidence, "% — SKIP");
            UpdateDashboard(0, combinedScore, "LOW-CONV");
            lastDashSignal = 0; lastDashScore = combinedScore; lastDashGrade = "LOW-CONV";
            return;
         }

         // v4.5.0 — CONVICTION-WEIGHTED SIZING:
         //   < min        -> already skipped above
         //   min .. normal -> 0.5x (low conviction = small size)
         //   normal..high  -> 1.0x (standard size)
         //   >= high       -> 1.3x (high conviction = bigger size)
         if(InpConvictionSizing && lastAIConfidence > 0)
         {
            double convMult;
            if(lastAIConfidence >= InpHighAIConfidence)
               convMult = InpConvictionHighMulti;
            else if(lastAIConfidence >= InpNormalAIConfidence)
               convMult = 1.0;
            else
               convMult = InpConvictionLowMulti;
            sizeMulti *= convMult;
            Print("CONVICTION-SIZE: ", lastAIConfidence, "% -> size x",
                  DoubleToString(convMult, 2), " (final sizeMulti=",
                  DoubleToString(sizeMulti, 2), ")");
         }

         // v4.5.0 — Devil's Advocate log (for user visibility)
         if(StringLen(lastAIBearishCase) > 0)
            Print("DEVIL'S-ADVOCATE: ", lastAIBearishCase);
      }
   }

   // Store signal context for ML + journal logging
   lastSignalDir = signal;
   lastSignalRSI = bufRSI[1];
   lastSignalEMADiff = (bufEMAFast[1] - bufEMASlow[1]) / bufEMASlow[1] * 10000;
   lastSignalATR = bufATR[1];
   lastSignalSetup = setupName;
   lastSignalSignature = signature;

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

   // Open trade with grade-scaled sizing
   OpenTrade(signal, bufATR[1], setupName + " [" + grade + "]", sizeMulti);
   UpdateDashboard(signal, combinedScore, grade);
   // Cache scan result so the 2-second throttled refresh doesn't overwrite it with zeros
   lastDashSignal = signal;
   lastDashScore  = combinedScore;
   lastDashGrade  = grade;
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

   // v4.7.6 — AGGREGATE EXPOSURE GATE
   //   Sum up the $-loss-if-SL-hit across ALL currently-open positions in our magic.
   //   If it already exceeds InpMaxAggregateRiskPct% of equity, BLOCK new entries.
   //   This stops the "sell 5.84 + open new sell 6.31 = $1200/pt = -$6k on next wick" scenario.
   if(InpMaxAggregateRiskPct > 0)
   {
      double tickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
      double tickSize  = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
      double aggDollar = 0;
      double aggLots   = 0;
      for(int i = 0; i < PositionsTotal(); i++)
      {
         ulong tk = PositionGetTicket(i);
         if(!posInfo.SelectByTicket(tk)) continue;
         if(posInfo.Magic() != InpMagicNumber || posInfo.Symbol() != Symbol()) continue;
         double sl = posInfo.StopLoss();
         double op = posInfo.PriceOpen();
         double v  = posInfo.Volume();
         aggLots += v;
         if(sl > 0 && tickSize > 0 && tickValue > 0)
         {
            double dist = MathAbs(op - sl);
            aggDollar += (dist / tickSize) * tickValue * v;
         }
      }
      double equity = accInfo.Equity();
      double maxAggDollar = equity * InpMaxAggregateRiskPct / 100.0;
      if(aggDollar > maxAggDollar)
      {
         static datetime lastAggSkip = 0;
         if(TimeCurrent() - lastAggSkip > 60)
         {
            Print("⛔ AGG-RISK BLOCK: open positions already risk $", DoubleToString(aggDollar, 0),
                  " (", DoubleToString(aggLots, 2), " lots) > ", DoubleToString(InpMaxAggregateRiskPct, 1),
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
   if(InpPostWinnerGuard && InpPostWinnerCoolMin > 0 &&
      reason != "RE_ENTRY" && lastClose.valid && !lastClose.wasLoss &&
      lastClose.dir == signal &&
      TimeCurrent() - lastClose.closeTime < InpPostWinnerCoolMin * 60)
   {
      double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
      double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
      double newEntry  = (signal == 1) ? ask : bid;
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
   double price, sl, tp, slDist;

   // Dynamic SL/TP: Low vol = tighter, trending = wider
   double slM = InpSLMultiplier;
   double tpM = InpTPMultiplier;
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
   double balance = accInfo.Balance();
   // v4.8.2 — Account Mode preset overrides InpRiskPercent
   // v4.9.3 — Account mode risks bumped for bigger lots.
   //   Old: BALANCED 0.8 / CONSERVATIVE 0.4 / AGGRESSIVE 1.2
   //   New: BALANCED 1.2 / CONSERVATIVE 0.6 / AGGRESSIVE 2.0
   double baseRisk = InpRiskPercent;
   if(InpAccountMode == ACCT_BALANCED)     baseRisk = 1.2;
   if(InpAccountMode == ACCT_CONSERVATIVE) baseRisk = 0.6;
   if(InpAccountMode == ACCT_AGGRESSIVE)   baseRisk = 2.0;
   double riskPct = baseRisk * sizeMulti;

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

   // Session scaling
   MqlDateTime dt; TimeCurrent(dt);
   if(dt.hour >= 0 && dt.hour < 8) riskPct *= 0.3; // Asian

   // Auto risk scaling from streaks
   if(patternCount >= 5)
   {
      int rW = 0;
      for(int p = patternCount - 1; p >= MathMax(0, patternCount - 5); p--)
         if(patterns[p].wasWinner) rW++;
      if(rW >= 4) riskPct *= 1.3;
      else if(rW <= 1) riskPct *= 0.5;
   }

   // VOLATILITY-ADAPTIVE SIZING (reduce in vol spikes, boost in calm)
   double volMult = GetVolAdaptiveMult();
   if(volMult != 1.0)
   {
      Print("VOL-ADAPT: risk × ", DoubleToString(volMult, 2),
            " (ATR vs median; ", volMult < 1.0 ? "high vol — shrinking" : "calm — slight boost", ")");
      riskPct *= volMult;
   }

   double riskAmount = balance * riskPct / 100.0;
   double tickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   double minLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
   if(tickValue <= 0 || tickSize <= 0 || slDist <= 0) return;

   double lots = riskAmount / (slDist / tickSize * tickValue);
   lots = MathFloor(lots / lotStep) * lotStep;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   if(lots > InpMaxLots) lots = InpMaxLots;

   // v4.7.5 — HARD EQUITY-% CAP: regardless of risk math, no single trade can
   //   risk more than InpMaxRiskPctEquity% of current equity if SL hits.
   //   This is the absolute backstop that prevents the "5+ lot whacked for $4k"
   //   scenario the user reported on a $100k account. SL distance × tick value
   //   × lots = $-loss-if-SL-hit. Cap that at e.g. 1.5% of equity.
   if(InpMaxRiskPctEquity > 0 && slDist > 0 && tickValue > 0 && tickSize > 0)
   {
      double equity = accInfo.Equity();
      double maxDollarLoss = equity * InpMaxRiskPctEquity / 100.0;
      double slDollarPerLot = (slDist / tickSize) * tickValue;
      if(slDollarPerLot > 0)
      {
         double maxAllowedLots = maxDollarLoss / slDollarPerLot;
         if(lots > maxAllowedLots)
         {
            Print("⚠️  EQUITY-CAP: lots ", DoubleToString(lots, 2), " → ",
                  DoubleToString(maxAllowedLots, 2),
                  " (would risk $", DoubleToString(lots * slDollarPerLot, 0),
                  " > ", DoubleToString(InpMaxRiskPctEquity, 1), "% equity = $",
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

   // Margin check
   double freeMargin = accInfo.FreeMargin();
   double marginNeeded = 0;
   double desiredLots = lots;   // v4.5.5 — remember pre-clamp lot for WARN log
   if(OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded))
   {
      while(lots > minLot && marginNeeded > freeMargin * 0.5)
      {
         lots -= lotStep; lots = MathMax(minLot, lots);
         OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded);
      }
      if(marginNeeded > freeMargin * 0.8) { Print("NO MARGIN"); return; }
   }
   lots = NormalizeDouble(lots, lotDigits);

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

   if(ok) { todayTradeCount++; lastTradeDir = signal; }
   else Print("TRADE FAILED: Err=", GetLastError(), " Ret=", trade.ResultRetcode());
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
//+------------------------------------------------------------------+
//| v4.9.4 — BASKET PROTECT                                          |
//|   Treat ALL open EA positions as a single basket. Protect the    |
//|   AGGREGATE floating PnL (not per-trade). When the basket peak   |
//|   retraces past a dynamic floor, CLOSE ALL at once — you bank    |
//|   the move as a whole instead of each trade trailing separately  |
//|   and getting shaken out on noise while others wait to arm.      |
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

   double bal = accInfo.Balance();
   if(bal <= 0) return false;

   // Arm the basket-lock once peak crosses threshold
   double armUSD = MathMax(InpBasketArmFloor, bal * InpBasketArmPct / 100.0);
   if(!g_basketArmed && g_basketPeakUSD >= armUSD) g_basketArmed = true;

   // BE flag: once basket reached BE threshold, never let it go negative
   double beArmUSD = bal * InpBasketBEPct / 100.0;
   if(!g_basketBEHit && g_basketPeakUSD >= beArmUSD) g_basketBEHit = true;

   // Compute dynamic floor based on tiered peak thresholds
   //   Base rule: floor = BasketLockMinPct% of peak (40% max giveback).
   //   As peak grows past T1/T2/T3 tiers, lock tightens (50% / 60% / 70%).
   double floorUSD = 0;
   if(g_basketArmed)
   {
      double lockPct = InpBasketLockMinPct;
      double t1USD = bal * InpBasketRatchetT1Pct / 100.0;
      double t2USD = bal * InpBasketRatchetT2Pct / 100.0;
      double t3USD = bal * InpBasketRatchetT3Pct / 100.0;
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

   // TRIGGER: if armed and current falls below floor → close ALL
   if(g_basketArmed && g_basketFloorUSD > 0 && totalPnL < g_basketFloorUSD)
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
      return true;
   }

   return false;
}

//+------------------------------------------------------------------+
//| v4.9.5 — CLEAN EXITS                                             |
//|   ONE exit authority per phase. No competing systems.            |
//|                                                                  |
//|   Phase 0 (0 to +1R):   initial SL only, zero trailing           |
//|   Phase 1 (+1R to +2R): SL → entry + 0.2R cushion (lock tiny win)|
//|   Phase 2 (+2R to +4R): Chandelier 3×ATR trail behind swing      |
//|   Phase 3 (+3R):        close 30% partial (runner continues)     |
//|   Phase 4 (+4R+):       Chandelier 2×ATR (tighter, bank more)    |
//|   Invalidation:         M5 close strongly against + EMA flip     |
//|   Stale:                > 4h AND profit < 0.5R → close           |
//+------------------------------------------------------------------+
// Per-ticket state: was partial taken already?
ulong g_cePartialTickets[];   // tickets that have had their 30% partial close

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

// Returns true if position was closed this tick (caller should skip further logic)
bool ManageCleanExitsForPosition(ulong ticket, bool isBuy, double openPx, double curPrice,
                                 double curSL, double curTP, double slDist, double atr,
                                 double emaF, double close1, int digits, double rsi,
                                 int minsOpen, double lotsOpen)
{
   if(!InpCleanExits) return false;
   if(slDist <= 0 || atr <= 0) return false;

   // Compute current R-multiple of profit in price terms
   double priceProfit = isBuy ? (curPrice - openPx) : (openPx - curPrice);
   double rMult = priceProfit / slDist;   // negative if underwater

   // ============ STALE CUT ============
   if(InpCleanStaleHours > 0 && minsOpen >= InpCleanStaleHours * 60 && rMult < InpCleanStaleMinR)
   {
      PrintFormat("CLEAN_STALE #%I64u %s | %dm open, only %.2fR → CLOSE",
                  ticket, isBuy?"BUY":"SELL", minsOpen, rMult);
      lastExitReason = StringFormat("STALE │ %.2fR after %dm", rMult, minsOpen);
      trade.PositionClose(ticket);
      return true;
   }

   // ============ MOMENTUM-FLIP INVALIDATION ============
   // Only after a decent window (>10 bars = 50min) so we don't cut to fakeouts
   if(InpCleanMomentumInvalidation && minsOpen >= 50)
   {
      // Strong close against direction (> 1× ATR body) + EMA flipped against us
      double open1 = iOpen(Symbol(), PERIOD_M5, 1);
      double bodySize = MathAbs(close1 - open1);
      bool strongReversalBar = bodySize > atr * 0.8;
      bool closeAgainst = isBuy ? (close1 < open1) : (close1 > open1);
      bool emaAgainst = isBuy ? (close1 < emaF) : (close1 > emaF);
      // Extra filter: RSI crossed mid (50) against us — confirms real momentum shift
      bool rsiAgainst = isBuy ? (rsi < 45) : (rsi > 55);

      if(strongReversalBar && closeAgainst && emaAgainst && rsiAgainst && rMult < 1.0)
      {
         PrintFormat("CLEAN_FLIP #%I64u %s | body=%.2f atr=%.2f emaFlip=Y rsi=%.1f → CLOSE",
                     ticket, isBuy?"BUY":"SELL", bodySize, atr, rsi);
         lastExitReason = StringFormat("MOMENTUM FLIP │ %.2fR cut early", rMult);
         trade.PositionClose(ticket);
         return true;
      }
   }

   // ============ PHASE 1: BREAKEVEN LOCK @ +1R ============
   if(rMult >= InpCleanBEActivateR)
   {
      double cushionDist = slDist * InpCleanBECushionR;
      double beSL = isBuy ? NormalizeDouble(openPx + cushionDist, digits)
                          : NormalizeDouble(openPx - cushionDist, digits);
      // Only move SL forward, never back
      bool shouldMove = isBuy ? (beSL > curSL) : (beSL < curSL || curSL == 0);
      if(shouldMove && rMult < InpCleanChandelierStartR)
      {
         // Broker stops-level buffer
         double pt = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
         long   lvl = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
         double buf = MathMax(lvl * pt, pt * 30);
         bool sane = isBuy ? (beSL < curPrice - buf) : (beSL > curPrice + buf);
         if(sane)
         {
            if(SafeModifySL(ticket, beSL, curTP, isBuy, curPrice, "CLEAN_BE"))
               PrintFormat("CLEAN_BE #%I64u %s | %.2fR → SL=%s (lock +%.2fR)",
                           ticket, isBuy?"BUY":"SELL", rMult,
                           DoubleToString(beSL, digits), InpCleanBECushionR);
         }
      }
   }

   // ============ PHASE 3: PARTIAL @ +3R (close 30% once) ============
   if(rMult >= InpCleanPartialR && !CleanPartialAlreadyTaken(ticket) &&
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
   if(rMult >= InpCleanChandelierStartR)
   {
      // Tighter trail once we're past +4R (bank more of the move)
      double chanATR = (rMult >= 4.0) ? InpCleanChandelierATR2 : InpCleanChandelierATR1;
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
            PrintFormat("CLEAN_CHAN #%I64u %s | %.2fR | chan=%.1fxATR | SL=%s",
                        ticket, isBuy?"BUY":"SELL", rMult, chanATR,
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

      // ============ v4.9.5 CLEAN EXITS (single exit authority) ============
      // When enabled, this handles: BE lock, chandelier trail, partial TP,
      // momentum-flip cut, stale cut. All legacy systems (Peak-Lock, Profit
      // Ratchet, Adaptive Runner, Trend-Hold, Profit Ladder) are disabled.
      // If Clean Exits closes the position, skip further logic for this ticket.
      if(InpCleanExits)
      {
         if(ManageCleanExitsForPosition(ticket, isBuy, openPx, curPrice, curSL, curTP,
                                        slDist, atr, emaF, close1, digits, rsi,
                                        minsOpen, lotsOpen))
            continue;
         // Skip ALL legacy trailing systems below — Clean Exits owns this ticket.
         // The original SL set at order-open time remains as the hard downside
         // cap. Clean Exits ratchets it forward through BE → Chandelier phases.
         continue;
      }

      // v4.7.3/v4.7.4 — TP AUTO-EXTEND (push TP forward as winner runs)
      //   When profit is ≥ InpTPExtendTriggerPct% of the way to current TP,
      //   add InpTPExtendATRMulti × ATR to TP so the runner doesn't get clipped
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
         if(tpDist > 0 && profitDist >= tpDist * (InpTPExtendTriggerPct / 100.0))
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
               double tpAdd = atr * InpTPExtendATRMulti;
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
                        " reached ", DoubleToString(InpTPExtendTriggerPct,0), "% of TP, regime=",
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
         double accBal = accInfo.Balance();
         if(accBal <= 0) accBal = accInfo.Equity();
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
         double accBal = accInfo.Balance();
         if(accBal <= 0) accBal = accInfo.Equity();
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
      double plBal = accInfo.Balance();
      if(plBal <= 0) plBal = accInfo.Equity();
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
         double bal = accInfo.Balance();
         if(bal <= 0) bal = accInfo.Equity();   // fallback
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
      if(InpPartialTP && !PartialAlreadyTaken(ticket))
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
      if(profit >= EffProfitTakeMin() && profit >= MathMax(75, EffProfitTakeMin() * 0.5))
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
      if(!InpPreservationMode && minsOpen > 60 && profit > -30 && profit < 30)
      {
         if(AIBlocksClose("STALE_DRIFT", ticket, isBuy, openPx, curPrice,
                          profit, peak, rDollars, slDist, curSL, curTP,
                          digits, rsi, emaF, emaS, atr, minsOpen, posInfo.Volume()))
            continue;
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "STALE_DRIFT",
                 StringFormat("Open %d min (>60min cap) with P/L $%.2f. No movement either way — free margin.", minsOpen, profit));
         trade.PositionClose(ticket); continue;
      }

      // ===== PATH C: CLAUDE SEMANTIC EXIT (proactive audit, every InpClaudeAuditSec) =====
      // v4.7.0 — uses AIExitVerdict (HOLD / CLOSE / LOCK $X). Cooldown is shared
      //   with the AI veto so we don't double-spend on Claude calls.
      static datetime lastClaudeCheck = 0;
      if(InpUseAI && StringLen(InpServerURL) >= 10 && minsOpen >= 3 &&
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

int GetAIAnalysis(double emaF, double emaS, double rsi, double atr, double price, string h1Dir, double spread,
                  string setup, string regime, string signature, double stoch, double mom)
{
   // Reset cached outputs
   lastAIConfidence = 0;
   lastAIBearishCase = "";
   lastAISkipIf = "";

   if(!InpUseAI || InpBacktestMode || StringLen(InpServerURL) < 10) return 0;
   string url = InpServerURL + "/api/ai/analyze";
   string headers = "Content-Type: application/json\r\n";
   string body = StringFormat(
      "{\"price\":%.2f,\"ema_fast\":%.2f,\"ema_slow\":%.2f,\"rsi\":%.1f,\"stoch\":%.1f,\"mom\":%.2f,\"atr\":%.2f,\"h1_trend\":\"%s\",\"spread\":%.0f,\"setup\":\"%s\",\"regime\":\"%s\",\"signature\":\"%s\"}",
      price, emaF, emaS, rsi, stoch, mom, atr, h1Dir, spread, setup, regime, signature);
   char postData[], result[]; string rh;
   StringToCharArray(body, postData, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 15000, postData, result, rh);
   if(res != 200) return 0;
   string response = CharArrayToString(result);
   int actIdx = StringFind(response, "\"action\":");
   if(actIdx < 0) return 0;
   string tail = StringSubstr(response, actIdx, 40);
   int dir = 0;
   if(StringFind(tail, "\"BUY\"")  >= 0) dir = 1;
   else if(StringFind(tail, "\"SELL\"") >= 0) dir = -1;
   else return 0;

   // Capture the full trader thesis for storage + display
   currentTradeThesis       = ExtractJsonString(response, "thesis");
   currentTradeInvalidation = ExtractJsonString(response, "invalidation");
   currentTradeTarget       = ExtractJsonString(response, "target");
   currentTradeBearishCase  = ExtractJsonString(response, "bearish_case");

   // v4.5.0 — Parse confidence integer from "confidence":NN (not a string)
   int confIdx = StringFind(response, "\"confidence\":");
   if(confIdx >= 0)
   {
      int p = confIdx + StringLen("\"confidence\":");
      // Skip whitespace
      while(p < StringLen(response) && (StringGetCharacter(response, p) == ' ' ||
            StringGetCharacter(response, p) == '\t')) p++;
      string numStr = "";
      while(p < StringLen(response))
      {
         ushort c = StringGetCharacter(response, p);
         if(c >= '0' && c <= '9') { numStr += ShortToString(c); p++; }
         else break;
      }
      if(StringLen(numStr) > 0) lastAIConfidence = (int)StringToInteger(numStr);
   }
   lastAIBearishCase = currentTradeBearishCase;
   lastAISkipIf      = ExtractJsonString(response, "skip_if");

   if(StringLen(currentTradeThesis) > 0)
   {
      Print("AI THESIS (", lastAIConfidence, "% conf): ", currentTradeThesis);
      if(StringLen(currentTradeBearishCase) > 0) Print("  Devil's Advocate: ", currentTradeBearishCase);
      if(StringLen(lastAISkipIf) > 0)           Print("  Skip if: ",           lastAISkipIf);
      if(StringLen(currentTradeInvalidation) > 0) Print("  Invalid if: ",      currentTradeInvalidation);
      if(StringLen(currentTradeTarget) > 0)       Print("  Target: ",          currentTradeTarget);
   }
   return dir;
}

// v4.7.0 — AI position auditor: returns AIExitVerdict struct (defined near top of file)
AIExitVerdict CheckPositionWithAI(string dir, double entry, double current, double profit, double lots,
                                   double rsi, double emaF, double emaS, double atr, int minsOpen, double sl, double tp,
                                   double peakProfit, string pendingExitReason, string regime)
{
   AIExitVerdict v; v.action = 0; v.lockUSD = 0; v.reason = "";
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

   string body = StringFormat("{\"direction\":\"%s\",\"entry_price\":%.2f,\"current_price\":%.2f,\"profit\":%.2f,\"lots\":%.2f,\"rsi\":%.1f,\"ema_fast\":%.2f,\"ema_slow\":%.2f,\"atr\":%.2f,\"minutes_open\":%d,\"sl\":%.2f,\"tp\":%.2f,\"thesis\":\"%s\",\"invalidation\":\"%s\",\"confidence\":%d,\"peak_profit\":%.2f,\"pending_exit_reason\":\"%s\",\"regime\":\"%s\"}",
      dir, entry, current, profit, lots, rsi, emaF, emaS, atr, minsOpen, sl, tp,
      thesisEsc, invalEsc, currentTradeConfidence, peakProfit, pendingExitReason, regime);
   char postData[], result[]; string rh;
   StringToCharArray(body, postData, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 10000, postData, result, rh);
   if(res != 200) return v;
   string response = CharArrayToString(result);
   v.reason = ExtractJsonString(response, "reason");
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
double GetMLScore(int dir, string signature)
{
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
      int matches = 0, wins = 0;
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
         if(patterns[i].wasWinner) wins++;
      }
      if(matches >= 5) return (double)wins / matches;
   }
   return 0.5;
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
      int res = WebRequest("POST", url, headers, 10000, pd, result, rh);
      if(res == 200)
      {
         string response = CharArrayToString(result);
         int countIdx = StringFind(response, "\"count\":");
         if(countIdx >= 0)
         {
            string cs = StringSubstr(response, countIdx + 8, 10);
            int ci = StringFind(cs, ","); if(ci < 0) ci = StringFind(cs, "}");
            if(ci > 0) { cs = StringSubstr(cs, 0, ci); if(StringToInteger(cs) > 0) { Print("ML CLOUD: ", cs, " patterns"); } }
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
         if(PositionGetTicket(i) == posId) { stillOpen = true; break; }
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
   // else: break-even — don't count either way
   lastTradeClose = TimeCurrent();
   Print("CLOSED: ", wasWin ? "WIN" : wasLoss ? "LOSS" : "BREAK-EVEN",
         " $", DoubleToString(profit, 2),
         " | T:", totalTrades, " W:", wins, " L:", losses);

   // Populate lastClose for RE-ENTRY detector
   lastClose.valid      = true;
   lastClose.wasLoss    = wasLoss;
   lastClose.reEntered  = false;
   lastClose.dir        = (dirStr == "BUY") ? 1 : -1;
   lastClose.lots       = dVolume;
   lastClose.closeTime  = TimeCurrent();
   lastClose.signature  = lastSignalSignature;
   lastClose.setup      = lastSignalSetup;
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
   if(posId > 0) { ClearPeakProfit(posId); ClearPartialTaken(posId); ClearAIVeto(posId); ClearTPExtend(posId); }
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

void CloseAll()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Magic() == InpMagicNumber && posInfo.Symbol() == Symbol())
      { trade.PositionClose(posInfo.Ticket()); Print("FORCE CLOSE: #", posInfo.Ticket()); }
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
   d += " XAUAI SNIPER v4.9.6 | SELF-DIAGNOSTIC | ";
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
   d += StringFormat("Open: %d/%d (pyr max %d) | Today: %d/%d\n", CountMyPositions(), InpMaxOpenTrades, 1+InpMaxPyramidAdds, todayTradeCount, InpMaxTradesPerDay);
   d += StringFormat("Trades: %d | Win: %.0f%% | ML: %d\n", totalTrades, wr, patternCount);
   d += StringFormat("AI: %s | News: %s | Careful: %s\n", InpUseAI?"ON":"OFF", InpUseNewsFilter?"ON":"OFF", InpCarefulMode?"ON":"OFF");
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
