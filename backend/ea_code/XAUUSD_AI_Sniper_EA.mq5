//+------------------------------------------------------------------+
//|                                     XAUUSD_AI_Sniper_EA.mq5      |
//|                                     XauAI Sniper — M5 Gold Edition|
//|                                     v4.5.9 — Partial Sanity      |
//+------------------------------------------------------------------+
#property copyright "XauAI Sniper by emriz.eth"
#property link      "https://xauaisniper.com"
#property version   "4.59"
#property description "XAUUSD AI Sniper v4.5.9 — Partial Sanity (no double-fire, no inflated stats)"
#property description "Fixed: 3-decimal lot brokers, doji false signals, dashboard cache leaks"
#property description "Re-entry respects direction lockout, status labels for all skip paths"
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
input double InpRiskPercent    = 1.0;      // Base risk per trade (%)
input double InpMaxLots        = 10.0;     // Hard max lots
input double InpDailyLossLimit = 6.0;      // Daily loss cap (%) — set 0 to disable
input int    InpMaxOpenTrades  = 5;        // Max open positions
input int    InpMaxTradesPerDay= 30;       // No artificial limit until target
input double InpWeeklyTarget   = 50.0;     // Weekly profit target (%) — set 0 to disable
input double InpWeeklyMaxLoss  = 15.0;     // Weekly max loss (%) — set 0 to disable
input bool   InpCarefulMode    = true;     // Scale down near target

input group "=== STRATEGY ==="
input int    InpEMAFast        = 50;       // Fast EMA
input int    InpEMASlow        = 200;      // Slow EMA
input int    InpRSIPeriod      = 14;       // RSI Period
input int    InpATRPeriod      = 14;       // ATR Period
input double InpSLMultiplier   = 2.0;      // SL = ATR x this
input double InpTPMultiplier   = 2.0;      // TP = SL x this

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
input bool   InpPartialTP         = true;  // Close part of the position at +1R, let rest run
input double InpPartialTPAtR      = 1.0;   // Fire partial at this R-multiple of profit
input double InpPartialPct        = 0.5;   // Fraction of position to close (0.5 = 50%)
input bool   InpPartialSkipHighConf = true;// Skip partial on 90%+ trades (let them fully run)

input group "=== AUTO-SCALE (v4.4.4 — smart bounds for profit cap) ==="
input bool   InpAutoScale      = true;     // TRUE = auto-derive $ thresholds from balance
input double InpAutoRiskPct    = 0.8;      // Hard stop = this % of balance (e.g. 0.8% of $1000 = $8)
input double InpAutoProfMinPct = 0.15;     // Profit floor scan start = this % of balance
input double InpAutoProfMaxPct = 3.0;      // Profit soft-cap = this % of balance (was 0.5, let runners run)
input double InpAutoPeakMinPct = 0.25;     // Peak-retrace arm threshold = this % of balance
input double InpProfMinFloorUSD  = 25.0;   // ProfitMin NEVER below this $ (micro-account floor)
input double InpProfMaxFloorUSD  = 50.0;   // ProfitMax NEVER below this $ (micro-account floor)
input double InpProfMaxCeilUSD   = 5000.0; // ProfitMax NEVER above this $ (large-account ceiling)
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
double bufEMAFast[], bufEMASlow[], bufRSI[], bufATR[];
double bufBBUpper[], bufBBLower[], bufBBMid[];
double bufEMAFast_H1[], bufEMASlow_H1[], bufRSI_M15[];
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

// AUTO-SCALE derived values (computed in OnInit when InpAutoScale=true)
double     autoHardStopUSD    = 0;
double     autoProfitTakeMin  = 0;
double     autoProfitTakeMax  = 0;
double     autoPeakMinUSD     = 0;

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
      // 10025 DONE_PARTIAL is a warning not a failure; also tolerate REQUOTE etc
      Print("SL-MOD FAIL #", ticket, " (", logTag, ") Ret=", ret,
            " Err=", GetLastError(), " newSL=", DoubleToString(newSL, digits));
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
   hRSI_M15  = iRSI(Symbol(), PERIOD_M15, InpRSIPeriod, PRICE_CLOSE);
   hStoch    = iStochastic(Symbol(), PERIOD_M5, 14, 3, 3, MODE_SMA, STO_LOWHIGH);

   if(hEMAFast==INVALID_HANDLE || hEMASlow==INVALID_HANDLE || hRSI==INVALID_HANDLE ||
      hATR==INVALID_HANDLE || hBBUpper==INVALID_HANDLE || hEMAFast_H1==INVALID_HANDLE ||
      hEMASlow_H1==INVALID_HANDLE || hRSI_M15==INVALID_HANDLE || hStoch==INVALID_HANDLE)
   { Print("ERROR: Indicators failed"); return INIT_FAILED; }

   ArraySetAsSeries(bufEMAFast, true); ArraySetAsSeries(bufEMASlow, true);
   ArraySetAsSeries(bufRSI, true);     ArraySetAsSeries(bufATR, true);
   ArraySetAsSeries(bufBBUpper, true); ArraySetAsSeries(bufBBLower, true);
   ArraySetAsSeries(bufBBMid, true);
   ArraySetAsSeries(bufEMAFast_H1, true); ArraySetAsSeries(bufEMASlow_H1, true);
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
   currentTradeThesis = ""; currentTradeInvalidation = ""; currentTradeTarget = "";
   currentTradeBearishCase = ""; currentTradeConfidence = 0;
   lastDashSignal = 0; lastDashScore = 0.0; lastDashGrade = "";
   RecomputeAutoScale();
   lastClose.valid = false; lastClose.reEntered = false; lastClose.wasLoss = false;
   lastClose.dir = 0; lastClose.entryPrice = 0; lastClose.slDist = 0;
   lastClose.lots = 0; lastClose.closeTime = 0; lastClose.signature = ""; lastClose.setup = "";
   dxyLastFetch = 0; dxyGoldBias = "neutral";
   LoadPatterns();

   Print("=== XAUAI SNIPER v4.5.9 (PARTIAL SANITY) READY ===");
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
   IndicatorRelease(hStoch);
   SavePatterns();
   Print("=== v4.5.9 STOPPED | Trades:", totalTrades, " W:", wins, " L:", losses, " ===");
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

   // v4.5.5 — Stricter margin gate: require at least 40% free margin buffer.
   // Also explicitly SKIP (don't fire at all) rather than silently clamping lot down.
   double freeMargin = accInfo.FreeMargin();
   double equityNow  = accInfo.Equity();
   double freeMarginPct = equityNow > 0 ? (freeMargin / equityNow * 100.0) : 0;
   if(freeMarginPct < 30.0)
   {
      Print("PYRAMID: SKIP — free margin only ", DoubleToString(freeMarginPct,1),
            "% of equity (need ≥30%). Account too committed for another add.");
      return;
   }
   double marginNeeded = 0;
   ENUM_ORDER_TYPE ot = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(OrderCalcMargin(ot, Symbol(), addLot, isBuy ? ask : bid, marginNeeded))
   {
      if(marginNeeded > freeMargin * 0.5)
      {
         Print("PYRAMID: SKIP — add needs $", DoubleToString(marginNeeded,2),
               " margin, only $", DoubleToString(freeMargin,2), " free.");
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
   if(!licenseValid) return;

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

   // Spread check — blocks NEW ENTRIES only (silent)
   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   if(spread > InpMaxSpread) return;

   // New M5 bar only for entries
   static datetime lastBar = 0;
   datetime curBar = iTime(Symbol(), PERIOD_M5, 0);
   if(curBar == lastBar) return;
   lastBar = curBar;

   // Update Asia-range tracker on every new M5 bar
   if(InpAsiaRangeBreakout) UpdateAsiaRange();

   // Load indicators
   if(CopyBuffer(hEMAFast, 0, 0, 12, bufEMAFast) < 12) return;
   if(CopyBuffer(hEMASlow, 0, 0, 12, bufEMASlow) < 12) return;
   if(CopyBuffer(hRSI, 0, 0, 5, bufRSI) < 5) return;
   if(CopyBuffer(hATR, 0, 0, 5, bufATR) < 5) return;
   if(CopyBuffer(hBBUpper, 1, 0, 12, bufBBUpper) < 12) return;
   if(CopyBuffer(hBBUpper, 2, 0, 12, bufBBLower) < 12) return;
   if(CopyBuffer(hBBUpper, 0, 0, 12, bufBBMid) < 12) return;
   if(CopyBuffer(hEMAFast_H1, 0, 0, 3, bufEMAFast_H1) < 3) return;
   if(CopyBuffer(hEMASlow_H1, 0, 0, 3, bufEMASlow_H1) < 3) return;
   if(CopyBuffer(hRSI_M15, 0, 0, 3, bufRSI_M15) < 3) return;
   if(CopyBuffer(hStoch, 0, 0, 3, bufStochK) < 3) return;
   if(CopyBuffer(hStoch, 1, 0, 3, bufStochD) < 3) return;

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
   double sizeMulti = grade == "A+" ? 1.0 : grade == "A" ? 0.85 : 0.55;
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
   double riskPct = InpRiskPercent * sizeMulti;

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
      if(InpPeakRetraceExit && peak >= EffPeakMinUSD() && retracePct >= InpPeakRetracePct)
      {
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "PEAK_RETRACE",
                 StringFormat("Peak was $%.2f, now $%.2f — gave back %.0f%% (threshold %.0f%%).",
                              peak, profit, retracePct, InpPeakRetracePct));
         trade.PositionClose(ticket); continue;
      }

      // ===== PATH A: DETERMINISTIC TRAILING =====
      // Trail at 1.2x ATR behind price
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

      // ===== PATH B: SMART MANAGEMENT =====

      // B1: Breakeven lock (v4.5.1 — wait for +1R before locking, and lock at +0.25R of profit)
      //  WAS: +0.5R activate, SL = openPx + 10 points (basically zero profit)
      //  NOW: +1.0R activate, SL = openPx + 0.25R (locks real profit; survives normal noise)
      double activateDist = slDist * InpBELockActivateR;
      double lockProfitDist = slDist * InpBELockProfitR;
      if(isBuy && curPrice > openPx + activateDist)
      {
         double beSL = NormalizeDouble(openPx + lockProfitDist, digits);
         // Only raise SL — never lower it (this was a bug: trail could already be higher)
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
         if(!skipHighConf && profitR >= InpPartialTPAtR)
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
         if(timeExpired && !(InpMomentumGuard && momentumStrong))
         {
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
      if(profit <= -(rDollars * 0.25) && minsOpen >= 3)
      {
         bool emaAgainst = isBuy ? (close1 < emaF) : (close1 > emaF);
         bool rsiFailing = isBuy ? (rsi < 40) : (rsi > 60);
         bool deepLoss   = profit <= -(rDollars * 0.5) && minsOpen > 15;

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
      int staleCap = (currentRegime == REGIME_LOW_VOL || currentRegime == REGIME_CHOPPY) ? 35 : 90;
      if(minsOpen > staleCap && profit <= -(rDollars * 0.6))
      {
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "STALE_LOSS",
                 StringFormat("Open %d min > regime cap %d min at -%.2fR. Free the margin.",
                              minsOpen, staleCap, MathAbs(profit)/rDollars));
         trade.PositionClose(ticket); continue;
      }
      if(minsOpen > 60 && profit > -30 && profit < 30)
      {
         LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                 "STALE_DRIFT",
                 StringFormat("Open %d min (>60min cap) with P/L $%.2f. No movement either way — free margin.", minsOpen, profit));
         trade.PositionClose(ticket); continue;
      }

      // ===== PATH C: CLAUDE SEMANTIC EXIT (A+ only, every InpClaudeAuditSec) =====
      static datetime lastClaudeCheck = 0;
      if(InpUseAI && StringLen(InpServerURL) >= 10 && minsOpen >= 3 && // 3min grace period
         TimeCurrent() - lastClaudeCheck > InpClaudeAuditSec)
      {
         int claudeResult = CheckPositionWithAI(
            isBuy ? "BUY" : "SELL", openPx, curPrice, profit,
            posInfo.Volume(), rsi, emaF, emaS, atr, minsOpen, curSL, curTP);
         lastClaudeCheck = TimeCurrent();

         if(claudeResult == -1) // CLOSE
         {
            // Safety net: if losing AND small loss (<0.3R in dollars), let SL handle it
            if(profit < 0 && profit > -(rDollars * 0.3))
            {
               Print("CLAUDE_EXIT_BLOCKED #", ticket, " losing -$", DoubleToString(MathAbs(profit), 2),
                     " but < 0.3R ($", DoubleToString(rDollars*0.3, 2), ") — letting SL handle");
            }
            else
            {
               LogExit(ticket, dirStr, openPx, curPrice, profit, peak, minsOpen, rsi, emaF, close1, open1,
                       "CLAUDE_AI",
                       StringFormat("Claude 4.5 said CLOSE. P/L $%.2f (%.2fR). AI analyzed context and decided exit.",
                                    profit, profit/rDollars));
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

int CheckPositionWithAI(string dir, double entry, double current, double profit, double lots,
                         double rsi, double emaF, double emaS, double atr, int minsOpen, double sl, double tp)
{
   if(InpBacktestMode) return 0;                   // Tester: no network
   if(StringLen(InpServerURL) < 10) return 0;
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

   string body = StringFormat("{\"direction\":\"%s\",\"entry_price\":%.2f,\"current_price\":%.2f,\"profit\":%.2f,\"lots\":%.2f,\"rsi\":%.1f,\"ema_fast\":%.2f,\"ema_slow\":%.2f,\"atr\":%.2f,\"minutes_open\":%d,\"sl\":%.2f,\"tp\":%.2f,\"thesis\":\"%s\",\"invalidation\":\"%s\",\"confidence\":%d}",
      dir, entry, current, profit, lots, rsi, emaF, emaS, atr, minsOpen, sl, tp,
      thesisEsc, invalEsc, currentTradeConfidence);
   char postData[], result[]; string rh;
   StringToCharArray(body, postData, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 10000, postData, result, rh);
   if(res != 200) return 0;
   string response = CharArrayToString(result);
   if(StringFind(response, "\"CLOSE\"") >= 0) { Print("CLAUDE_AUDIT: ", response); return -1; }
   return 0;
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
   if(posId > 0) { ClearPeakProfit(posId); ClearPartialTaken(posId); }
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
   d += " XAUAI SNIPER v4.5.9 | PARTIAL SANITY | ";
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
