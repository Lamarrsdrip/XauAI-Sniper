//+------------------------------------------------------------------+
//|                                     XAUUSD_AI_Sniper_EA.mq5      |
//|                                     AI-Assisted Gold Trading Bot  |
//|                                     Professional Grade EA v2.0    |
//+------------------------------------------------------------------+
#property copyright "AI Sniper Trading Systems"
#property link      "https://ai-sniper-ea.com"
#property version   "2.00"
#property description "Advanced AI-Assisted XAUUSD Trading Expert Advisor"
#property description "Multi-Strategy | Adaptive ML | Strict Risk Management"
#property description "LICENSE REQUIRED: Enter your unique PIN to activate"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>
#include <Trade\SymbolInfo.mqh>
#include <Trade\AccountInfo.mqh>

//+------------------------------------------------------------------+
//| LICENSE ACTIVATION                                               |
//+------------------------------------------------------------------+
input group "=== LICENSE ==="
input string   InpLicensePIN        = "";       // License PIN (required)
input string   InpValidationURL     = "";       // Online Validation URL (optional - leave empty for offline)

//+------------------------------------------------------------------+
//| INPUT PARAMETERS - User Configurable                             |
//+------------------------------------------------------------------+

//--- Risk Management
input group "=== RISK MANAGEMENT ==="
input double   InpRiskPercent        = 1.0;     // Risk per trade (%)
input double   InpDailyLossLimit     = 3.0;     // Daily loss limit (%)
input double   InpWeeklyDrawdownLimit= 10.0;    // Weekly drawdown limit (%)
input double   InpWeeklyProfitTarget = 35.0;    // Weekly profit target (%)
input int      InpMaxOpenTrades      = 2;       // Max simultaneous open trades
input int      InpMaxTradesPerDay    = 6;       // Max trades per day
input double   InpMaxSpread          = 100.0;   // Max allowed spread (points) - Gold needs wider

//--- Profit Mode Presets
input group "=== PROFIT TARGET MODE ==="
input int      InpProfitMode         = 2;       // Profit Mode: 1=Conservative(20%), 2=Moderate(35%), 3=Aggressive(50%)

//--- Strategy Selection
input group "=== STRATEGY MODES ==="
input bool     InpEnableTrendMode    = true;    // Enable Trend Following Mode
input bool     InpEnableRangeMode    = true;    // Enable Range Trading Mode
input bool     InpEnableBreakoutMode = true;    // Enable Breakout Mode
input int      InpConfidenceThreshold= 55;      // Min confidence score (0-100)

//--- Indicator Parameters
input group "=== INDICATORS ==="
input int      InpEMAFast            = 50;      // Fast EMA Period
input int      InpEMASlow            = 200;     // Slow EMA Period
input int      InpRSIPeriod          = 14;      // RSI Period
input int      InpATRPeriod          = 14;      // ATR Period
input int      InpBBPeriod           = 20;      // Bollinger Bands Period
input double   InpBBDeviation        = 2.0;     // BB Deviation

//--- Trade Management
input group "=== TRADE MANAGEMENT ==="
input double   InpMinRRRatio         = 1.5;     // Minimum Risk:Reward Ratio
input double   InpMaxRRRatio         = 3.0;     // Maximum Risk:Reward Ratio
input double   InpPartialClosePercent= 50.0;    // Partial close at 1st target (%)
input double   InpTrailingATRMulti   = 1.5;     // Trailing stop ATR multiplier
input double   InpSLATRMultiplier    = 2.0;     // Stop Loss ATR multiplier
input int      InpCooldownMinutes    = 30;      // Cooldown after consecutive losses

//--- Session Filter
input group "=== SESSION FILTER ==="
input bool     InpTradeOnlyLondon    = false;   // Trade London Session
input bool     InpTradeOnlyNewYork   = false;   // Trade New York Session
input int      InpLondonStartHour    = 8;       // London Session Start (Server Time)
input int      InpLondonEndHour      = 16;      // London Session End
input int      InpNYStartHour        = 13;      // New York Session Start
input int      InpNYEndHour          = 21;      // New York Session End

//--- News Filter
input group "=== NEWS FILTER ==="
input bool     InpEnableNewsFilter   = true;    // Enable News Filter
input int      InpNewsMinutesBefore  = 30;      // Avoid trading X min before news
input int      InpNewsMinutesAfter   = 15;      // Avoid trading X min after news

//--- Safety Features
input group "=== SAFETY ==="
input double   InpEquityProtection   = 70.0;    // Equity protection level (% of initial)
input int      InpConsecutiveLossMax = 3;        // Max consecutive losses before cooldown
input bool     InpEmergencyStop      = false;    // Emergency Stop (close all, stop)
input int      InpMagicNumber        = 20250101; // Magic Number

//--- ML Learning
input group "=== AI / MACHINE LEARNING ==="
input bool     InpEnableLearning     = true;    // Enable Pattern Learning
input int      InpPatternMemorySize  = 500;     // Max local patterns to remember
input double   InpLearningWeight     = 0.3;     // Learning influence on confidence (0-1)
input int      InpMinPatternsForML   = 20;      // Min patterns before ML kicks in
input bool     InpUseCloudML         = true;    // Use Cloud ML (learns from ALL users globally)
input string   InpCloudMLURL         = "";       // Cloud Server URL (optional - leave empty to use local ML only)

//--- Smart Features
input group "=== SMART FEATURES ==="
input bool     InpSmartTradeCheck    = true;    // Use Smart Trade Check (News+DXY+Session combined)
input bool     InpWeekendProtection  = true;    // Close trades before weekend (Friday 20:00)
input int      InpFridayCloseHour    = 20;      // Hour to close all trades on Friday (server time)
input bool     InpDrawdownRecovery   = true;    // Enable Drawdown Recovery Mode
input double   InpRecoveryThreshold  = 50.0;    // Recovery triggers at X% of daily loss limit

//+------------------------------------------------------------------+
//| ENUMERATIONS                                                     |
//+------------------------------------------------------------------+
enum ENUM_MARKET_CONDITION
{
   MARKET_TRENDING_UP    = 0,
   MARKET_TRENDING_DOWN  = 1,
   MARKET_RANGING        = 2,
   MARKET_BREAKOUT_UP    = 3,
   MARKET_BREAKOUT_DOWN  = 4,
   MARKET_UNDEFINED      = 5
};

enum ENUM_STRATEGY_MODE
{
   STRATEGY_TREND     = 0,
   STRATEGY_RANGE     = 1,
   STRATEGY_BREAKOUT  = 2,
   STRATEGY_NONE      = 3
};

//+------------------------------------------------------------------+
//| PATTERN MEMORY STRUCTURE (ML)                                    |
//+------------------------------------------------------------------+
struct TradePattern
{
   ENUM_MARKET_CONDITION  marketState;
   ENUM_STRATEGY_MODE     strategy;
   double  emaDiff;         // EMA fast-slow difference
   double  rsiValue;        // RSI at entry
   double  atrValue;        // ATR at entry
   double  bbWidth;         // BB width at entry
   int     hourOfDay;       // Hour of trade
   int     dayOfWeek;       // Day of week
   double  candleBodyRatio; // Body/range ratio of signal candle
   bool    wasWinner;       // Outcome
   double  profitPips;      // Profit in pips
   int     confidence;      // Original confidence score
};

//+------------------------------------------------------------------+
//| GLOBAL VARIABLES                                                 |
//+------------------------------------------------------------------+
CTrade         trade;
CPositionInfo  posInfo;
CSymbolInfo    symInfo;
CAccountInfo   accInfo;

// License
bool licenseValid = false;

// Indicator handles
int handleEMAFast, handleEMASlow, handleRSI, handleATR, handleBB;
int handleEMAFast_H1, handleEMASlow_H1, handleRSI_H1;
int handleEMAFast_H4, handleEMASlow_H4;

// Buffers
double bufEMAFast[], bufEMASlow[], bufRSI[], bufATR[];
double bufBBUpper[], bufBBMiddle[], bufBBLower[];
double bufEMAFast_H1[], bufEMASlow_H1[], bufRSI_H1[];
double bufEMAFast_H4[], bufEMASlow_H4[];

// State tracking
double         initialBalance;
double         dailyStartEquity;
double         weeklyStartEquity;
int            todayTradeCount;
int            consecutiveLosses;
datetime       lastTradeTime;
datetime       lastDayReset;
datetime       lastWeekReset;
datetime       cooldownUntil;
bool           dailyLimitReached;
bool           weeklyLimitReached;
bool           weeklyTargetReached;
double         effectiveWeeklyTarget;

// Performance tracking
int            totalTrades;
int            winningTrades;
int            losingTrades;
double         totalProfit;
double         totalLoss;
double         maxDrawdown;
double         peakEquity;

// Market state
ENUM_MARKET_CONDITION currentMarketCondition;
ENUM_STRATEGY_MODE    activeStrategy;
int                   tradeConfidence;

// ML Pattern Memory
TradePattern   patternMemory[];
int            patternCount;
int            mlBoostApplied;

// Smart Features
bool           recoveryModeActive;
int            smartCheckResult;

//+------------------------------------------------------------------+
//| PIN VALIDATION                                                   |
//| Works offline by default. Online validation is optional.         |
//+------------------------------------------------------------------+
bool ValidatePINOffline(string pin)
{
   // Format: ASE-XXXX-XXXX = 13 characters
   // A(0)S(1)E(2)-(3)X(4)X(5)X(6)X(7)-(8)X(9)X(10)X(11)X(12)
   if(StringLen(pin) != 13) return false;
   if(StringSubstr(pin, 0, 3) != "ASE") return false;
   if(StringGetCharacter(pin, 3) != '-') return false;
   if(StringGetCharacter(pin, 8) != '-') return false;
   
   for(int i = 4; i < 13; i++)
   {
      if(i == 8) continue;
      ushort ch = StringGetCharacter(pin, i);
      if(!((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z')))
         return false;
   }
   
   return true;
}

bool ValidatePINOnline(string pin)
{
   // If no validation URL set, use offline validation only
   if(StringLen(InpValidationURL) < 10 || StringFind(InpValidationURL, "your-domain") >= 0)
   {
      Print("LICENSE: Using offline validation (no server URL configured).");
      return ValidatePINOffline(pin);
   }
   
   // Try online validation
   string headers = "Content-Type: application/json\r\n";
   string postData = "{\"pin\":\"" + pin + "\",\"mt5_account\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\"}";
   
   char post[];
   char result[];
   string resultHeaders;
   
   StringToCharArray(postData, post, 0, StringLen(postData));
   
   int timeout = 5000;
   int res = WebRequest("POST", InpValidationURL, headers, timeout, post, result, resultHeaders);
   
   if(res == 200)
   {
      string response = CharArrayToString(result);
      if(StringFind(response, "\"valid\": true") >= 0 || StringFind(response, "\"valid\":true") >= 0)
         return true;
      // Server returned 200 but said invalid
      Print("LICENSE: Server rejected PIN.");
      return false;
   }
   
   // Server unreachable or error - ALWAYS fall back to offline
   Print("WARNING: License server unreachable (code: ", res, "). Using offline validation.");
   return ValidatePINOffline(pin);
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   // === LICENSE VALIDATION ===
   if(StringLen(InpLicensePIN) == 0)
   {
      Alert("LICENSE REQUIRED: Please enter your license PIN in the EA settings (Inputs tab > License PIN).");
      Print("ERROR: No license PIN provided. EA cannot start.");
      return(INIT_FAILED);
   }
   
   // Validate PIN: offline first (always works), online if URL configured
   licenseValid = ValidatePINOnline(InpLicensePIN);
   
   if(!licenseValid)
   {
      Alert("INVALID LICENSE PIN: The PIN '" + InpLicensePIN + "' is not valid. Please check the format: ASE-XXXX-XXXX");
      Print("ERROR: License validation failed for PIN: ", InpLicensePIN);
      Print("HINT: PIN must be format ASE-XXXX-XXXX where X is A-Z or 0-9");
      return(INIT_FAILED);
   }
   
   Print("LICENSE VALIDATED: PIN ", InpLicensePIN, " accepted. EA authorized to trade.");
   
   // Validate symbol
   if(StringFind(Symbol(), "XAU") < 0 && StringFind(Symbol(), "GOLD") < 0)
   {
      Print("WARNING: This EA is optimized for XAUUSD (Gold). Current symbol: ", Symbol());
   }
   
   // Emergency stop check
   if(InpEmergencyStop)
   {
      CloseAllPositions();
      Print("EMERGENCY STOP ACTIVATED - All positions closed, EA stopped");
      return(INIT_FAILED);
   }
   
   // Set effective weekly target based on profit mode
   switch(InpProfitMode)
   {
      case 1: effectiveWeeklyTarget = 20.0; break;  // Conservative
      case 3: effectiveWeeklyTarget = 50.0; break;  // Aggressive
      default: effectiveWeeklyTarget = InpWeeklyProfitTarget; break; // Moderate or custom
   }
   
   // Initialize trade object
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(30);
   
   // Auto-detect broker's supported filling mode
   long fillMode = SymbolInfoInteger(Symbol(), SYMBOL_FILLING_MODE);
   if((fillMode & SYMBOL_FILLING_FOK) != 0)
      trade.SetTypeFilling(ORDER_FILLING_FOK);
   else if((fillMode & SYMBOL_FILLING_IOC) != 0)
      trade.SetTypeFilling(ORDER_FILLING_IOC);
   else
      trade.SetTypeFilling(ORDER_FILLING_RETURN);
   
   Print("FILL MODE: ", (fillMode & SYMBOL_FILLING_FOK) != 0 ? "FOK" : (fillMode & SYMBOL_FILLING_IOC) != 0 ? "IOC" : "RETURN");
   
   // Initialize symbol info
   symInfo.Name(Symbol());
   symInfo.Refresh();
   
   // Create indicator handles - M5 (Entry Timeframe)
   handleEMAFast = iMA(Symbol(), PERIOD_M5, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   handleEMASlow = iMA(Symbol(), PERIOD_M5, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   handleRSI     = iRSI(Symbol(), PERIOD_M5, InpRSIPeriod, PRICE_CLOSE);
   handleATR     = iATR(Symbol(), PERIOD_M5, InpATRPeriod);
   handleBB      = iBands(Symbol(), PERIOD_M5, InpBBPeriod, 0, InpBBDeviation, PRICE_CLOSE);
   
   // Create indicator handles - H1 (Confirmation)
   handleEMAFast_H1 = iMA(Symbol(), PERIOD_H1, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   handleEMASlow_H1 = iMA(Symbol(), PERIOD_H1, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   handleRSI_H1     = iRSI(Symbol(), PERIOD_H1, InpRSIPeriod, PRICE_CLOSE);
   
   // Create indicator handles - H4 (Trend)
   handleEMAFast_H4 = iMA(Symbol(), PERIOD_H4, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   handleEMASlow_H4 = iMA(Symbol(), PERIOD_H4, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   
   // Validate handles
   if(handleEMAFast == INVALID_HANDLE || handleEMASlow == INVALID_HANDLE ||
      handleRSI == INVALID_HANDLE || handleATR == INVALID_HANDLE ||
      handleBB == INVALID_HANDLE)
   {
      Print("ERROR: Failed to create indicator handles");
      return(INIT_FAILED);
   }
   
   // Set array directions
   ArraySetAsSeries(bufEMAFast, true);
   ArraySetAsSeries(bufEMASlow, true);
   ArraySetAsSeries(bufRSI, true);
   ArraySetAsSeries(bufATR, true);
   ArraySetAsSeries(bufBBUpper, true);
   ArraySetAsSeries(bufBBMiddle, true);
   ArraySetAsSeries(bufBBLower, true);
   ArraySetAsSeries(bufEMAFast_H1, true);
   ArraySetAsSeries(bufEMASlow_H1, true);
   ArraySetAsSeries(bufRSI_H1, true);
   ArraySetAsSeries(bufEMAFast_H4, true);
   ArraySetAsSeries(bufEMASlow_H4, true);
   
   // Initialize state
   initialBalance     = accInfo.Balance();
   dailyStartEquity   = accInfo.Equity();
   weeklyStartEquity  = accInfo.Equity();
   todayTradeCount    = 0;
   consecutiveLosses  = 0;
   lastTradeTime      = 0;
   lastDayReset       = TimeCurrent();
   lastWeekReset      = TimeCurrent();
   cooldownUntil      = 0;
   dailyLimitReached  = false;
   weeklyLimitReached = false;
   weeklyTargetReached= false;
   
   // Performance
   totalTrades    = 0;
   winningTrades  = 0;
   losingTrades   = 0;
   totalProfit    = 0;
   totalLoss      = 0;
   maxDrawdown    = 0;
   peakEquity     = accInfo.Equity();
   
   // ML Pattern Memory
   ArrayResize(patternMemory, 0);
   patternCount = 0;
   mlBoostApplied = 0;
   
   // Load saved patterns from file if exists
   LoadPatternMemory();
   
   Print("=== AI SNIPER EA v2.0 INITIALIZED ===");
   Print("License: VALID | Symbol: ", Symbol(), " | Balance: ", DoubleToString(initialBalance, 2));
   Print("Risk: ", InpRiskPercent, "% | Weekly Target: ", effectiveWeeklyTarget, "%");
   Print("Profit Mode: ", InpProfitMode == 1 ? "CONSERVATIVE" : InpProfitMode == 3 ? "AGGRESSIVE" : "MODERATE");
   Print("ML Learning: ", InpEnableLearning ? "ON" : "OFF", " | Patterns loaded: ", patternCount);
   Print("Trend: ", InpEnableTrendMode ? "ON" : "OFF",
         " | Range: ", InpEnableRangeMode ? "ON" : "OFF",
         " | Breakout: ", InpEnableBreakoutMode ? "ON" : "OFF");
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   // Save pattern memory
   SavePatternMemory();
   
   // Release indicator handles
   IndicatorRelease(handleEMAFast);
   IndicatorRelease(handleEMASlow);
   IndicatorRelease(handleRSI);
   IndicatorRelease(handleATR);
   IndicatorRelease(handleBB);
   IndicatorRelease(handleEMAFast_H1);
   IndicatorRelease(handleEMASlow_H1);
   IndicatorRelease(handleRSI_H1);
   IndicatorRelease(handleEMAFast_H4);
   IndicatorRelease(handleEMASlow_H4);
   
   PrintPerformanceSummary();
   Print("=== AI SNIPER EA DEINITIALIZED | Patterns saved: ", patternCount, " ===");
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!licenseValid) return;
   
   symInfo.Refresh();
   
   CheckDailyReset();
   CheckWeeklyReset();
   
   // === WEEKEND PROTECTION: Close all trades Friday before close ===
   if(InpWeekendProtection)
   {
      MqlDateTime dtw;
      TimeCurrent(dtw);
      if(dtw.day_of_week == 5 && dtw.hour >= InpFridayCloseHour)
      {
         if(CountOpenPositions() > 0)
         {
            CloseAllPositions();
            Print("WEEKEND PROTECTION: All trades closed before weekend gap risk");
         }
         return; // No new trades on Friday evening
      }
   }
   
   // === DRAWDOWN RECOVERY MODE ===
   if(InpDrawdownRecovery)
   {
      double dailyPnL = accInfo.Equity() - dailyStartEquity;
      double halfDailyLimit = dailyStartEquity * InpDailyLossLimit / 100.0 * (InpRecoveryThreshold / 100.0);
      recoveryModeActive = (dailyPnL < -halfDailyLimit);
   }
   
   if(!PassSafetyChecks()) return;
   
   static datetime lastBarTime = 0;
   datetime currentBarTime = iTime(Symbol(), PERIOD_M5, 0);
   if(currentBarTime == lastBarTime) return;
   lastBarTime = currentBarTime;
   
   if(!UpdateIndicators())
   {
      Print("BLOCKED: Indicator data not ready yet");
      return;
   }
   
   ManageOpenPositions();
   
   if(!CanOpenNewTrade())
   {
      Print("SCAN: Skipped - max trades reached (open:", CountOpenPositions(), "/", InpMaxOpenTrades, " today:", todayTradeCount, "/", InpMaxTradesPerDay, ")");
      return;
   }
   
   currentMarketCondition = ClassifyMarket();
   activeStrategy = SelectStrategy(currentMarketCondition);
   if(activeStrategy == STRATEGY_NONE)
   {
      Print("SCAN: Market=", MarketConditionName(currentMarketCondition), " | No matching strategy enabled");
      return;
   }
   
   int signal = 0;
   tradeConfidence = 0;
   
   switch(activeStrategy)
   {
      case STRATEGY_TREND:    signal = TrendStrategy();    break;
      case STRATEGY_RANGE:    signal = RangeStrategy();    break;
      case STRATEGY_BREAKOUT: signal = BreakoutStrategy(); break;
   }
   
   // Apply ML: Smart Trade Check (all-in-one) or Cloud ML + Local fallback
   if(InpEnableLearning && signal != 0)
   {
      int cloudAdj = 0;
      bool useLocal = true;
      
      // TRY SMART TRADE CHECK (News + DXY + Session + ML combined)
      if(InpSmartTradeCheck && InpUseCloudML)
      {
         int smartAdj = GetSmartTradeCheck();
         if(smartAdj == -100)
         {
            signal = 0;
            tradeConfidence = 0;
            useLocal = false;
            Print("SMART CHECK: Trade BLOCKED (News/DXY/Weekend/ML)");
         }
         else
         {
            tradeConfidence += smartAdj;
            mlBoostApplied = smartAdj;
            useLocal = false;
         }
      }
      // FALLBACK: Cloud ML only
      else if(InpUseCloudML)
      {
         cloudAdj = GetCloudMLConfidence();
         if(cloudAdj == -100)
         {
            signal = 0;
            tradeConfidence = 0;
            useLocal = false;
         }
         else if(cloudAdj != 0)
         {
            tradeConfidence += cloudAdj;
            mlBoostApplied = cloudAdj;
            useLocal = false;
         }
      }
      
      // FALLBACK TO LOCAL ML
      if(useLocal && patternCount >= InpMinPatternsForML)
      {
         int localAdj = GetMLConfidenceAdjustment();
         tradeConfidence += localAdj;
         mlBoostApplied = localAdj;
      }
      
      tradeConfidence = MathMax(0, MathMin(100, tradeConfidence));
      
      // LOCAL LOSS AVOIDANCE
      if(signal != 0 && IsHighLossTimeSlot())
      {
         tradeConfidence -= 10;
         if(tradeConfidence < InpConfidenceThreshold)
         {
            signal = 0;
            Print("ML: Skipping - historically bad time slot");
         }
      }
      
      // STREAK AWARENESS
      if(signal != 0 && consecutiveLosses >= 2)
      {
         tradeConfidence -= 5;
      }
      
      // RECOVERY MODE: If active, slightly tighten confidence
      if(signal != 0 && recoveryModeActive)
      {
         tradeConfidence -= 5;
         Print("RECOVERY MODE: Active - tightened confidence by -5");
      }
   }
   
   // Dynamic threshold
   int effectiveThreshold = InpConfidenceThreshold;
   if(patternCount >= 50)
   {
      double recentWinRate = GetRecentWinRate(20);
      if(recentWinRate < 0.4) effectiveThreshold += 5;  // Only raise if win rate is truly bad
   }
   // Recovery mode raises threshold slightly
   if(recoveryModeActive) effectiveThreshold += 5;
   
   if(signal != 0 && tradeConfidence >= effectiveThreshold)
   {
      Print(">>> EXECUTING TRADE: Signal=", signal > 0 ? "BUY" : "SELL",
            " | Confidence=", tradeConfidence, "/", effectiveThreshold,
            " | Strategy=", StrategyName(activeStrategy));
      ExecuteTrade(signal);
   }
   else if(signal != 0)
   {
      Print("SCAN: Signal=", signal > 0 ? "BUY" : "SELL",
            " but confidence too low (", tradeConfidence, " < ", effectiveThreshold,
            ") | Strategy=", StrategyName(activeStrategy),
            " | Market=", MarketConditionName(currentMarketCondition));
   }
   else
   {
      Print("SCAN: No signal | Market=", MarketConditionName(currentMarketCondition),
            " | Strategy=", StrategyName(activeStrategy),
            " | Spread=", DoubleToString(symInfo.Spread(), 0));
   }
   
   UpdateDashboard();
}

//+------------------------------------------------------------------+
//| ML: GET CONFIDENCE ADJUSTMENT FROM PATTERN MEMORY                |
//+------------------------------------------------------------------+
int GetMLConfidenceAdjustment()
{
   if(patternCount < InpMinPatternsForML) return 0;
   
   // Find similar patterns in memory
   double currentEMADiff = (bufEMAFast[1] - bufEMASlow[1]) / bufEMASlow[1] * 10000;
   double currentRSI = bufRSI[1];
   double currentATR = bufATR[1];
   double currentBBWidth = (bufBBUpper[1] - bufBBLower[1]) / iClose(Symbol(), PERIOD_M5, 1);
   
   MqlDateTime dt;
   TimeCurrent(dt);
   int currentHour = dt.hour;
   int currentDow = dt.day_of_week;
   
   int matchCount = 0;
   int winCount = 0;
   double totalProfitPips = 0;
   
   for(int i = 0; i < patternCount; i++)
   {
      // Check similarity (weighted distance)
      bool sameMarket = (patternMemory[i].marketState == currentMarketCondition);
      bool sameStrategy = (patternMemory[i].strategy == activeStrategy);
      bool similarRSI = MathAbs(patternMemory[i].rsiValue - currentRSI) < 15;
      bool similarTime = (MathAbs(patternMemory[i].hourOfDay - currentHour) <= 2);
      
      // Need at least market + strategy match
      if(sameMarket && sameStrategy)
      {
         matchCount++;
         if(patternMemory[i].wasWinner)
         {
            winCount++;
            totalProfitPips += patternMemory[i].profitPips;
         }
         
         // Bonus for time similarity
         if(similarRSI && similarTime)
         {
            matchCount++; // Double weight for close matches
            if(patternMemory[i].wasWinner) winCount++;
         }
      }
   }
   
   if(matchCount < 5) return 0;
   
   double mlWinRate = (double)winCount / matchCount;
   
   // Convert to confidence adjustment (-20 to +20) - wider range for more impact
   int adjustment = (int)((mlWinRate - 0.5) * 40.0 * InpLearningWeight);
   return MathMax(-20, MathMin(20, adjustment));
}

//+------------------------------------------------------------------+
//| ML: CHECK IF CURRENT TIME IS HISTORICALLY A LOSING TIME          |
//+------------------------------------------------------------------+
bool IsHighLossTimeSlot()
{
   if(patternCount < 30) return false;
   
   MqlDateTime dt;
   TimeCurrent(dt);
   int currentHour = dt.hour;
   int currentDow = dt.day_of_week;
   
   int slotTotal = 0;
   int slotLosses = 0;
   
   for(int i = 0; i < patternCount; i++)
   {
      // Match same hour range (+/- 1hr) and same day of week
      if(MathAbs(patternMemory[i].hourOfDay - currentHour) <= 1 && patternMemory[i].dayOfWeek == currentDow)
      {
         slotTotal++;
         if(!patternMemory[i].wasWinner) slotLosses++;
      }
   }
   
   if(slotTotal < 5) return false;
   
   double lossRate = (double)slotLosses / slotTotal;
   return lossRate > 0.65; // If >65% of trades at this time lose, avoid it
}

//+------------------------------------------------------------------+
//| ML: GET RECENT WIN RATE FROM LAST N PATTERNS                     |
//+------------------------------------------------------------------+
double GetRecentWinRate(int lookback)
{
   if(patternCount < lookback) return 0.5;
   
   int wins = 0;
   int start = patternCount - lookback;
   
   for(int i = start; i < patternCount; i++)
   {
      if(patternMemory[i].wasWinner) wins++;
   }
   
   return (double)wins / lookback;
}

//+------------------------------------------------------------------+
//| ML: RECORD TRADE PATTERN                                         |
//+------------------------------------------------------------------+
void RecordTradePattern(bool wasWin, double profitPips)
{
   if(!InpEnableLearning) return;
   
   TradePattern pattern;
   pattern.marketState = currentMarketCondition;
   pattern.strategy = activeStrategy;
   pattern.emaDiff = (bufEMAFast[1] - bufEMASlow[1]) / bufEMASlow[1] * 10000;
   pattern.rsiValue = bufRSI[1];
   pattern.atrValue = bufATR[1];
   pattern.bbWidth = (bufBBUpper[1] - bufBBLower[1]) / iClose(Symbol(), PERIOD_M5, 1);
   
   MqlDateTime dt;
   TimeCurrent(dt);
   pattern.hourOfDay = dt.hour;
   pattern.dayOfWeek = dt.day_of_week;
   
   double open1 = iOpen(Symbol(), PERIOD_M5, 1);
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   double high1 = iHigh(Symbol(), PERIOD_M5, 1);
   double low1 = iLow(Symbol(), PERIOD_M5, 1);
   double range = high1 - low1;
   pattern.candleBodyRatio = range > 0 ? MathAbs(close1 - open1) / range : 0;
   
   pattern.wasWinner = wasWin;
   pattern.profitPips = profitPips;
   pattern.confidence = tradeConfidence;
   
   // Add to memory (FIFO if full)
   if(patternCount >= InpPatternMemorySize)
   {
      // Remove oldest
      for(int i = 0; i < patternCount - 1; i++)
         patternMemory[i] = patternMemory[i + 1];
      patternCount--;
   }
   
   ArrayResize(patternMemory, patternCount + 1);
   patternMemory[patternCount] = pattern;
   patternCount++;
   
   Print("ML: Pattern recorded (#", patternCount, ") | Win: ", wasWin, " | Pips: ", DoubleToString(profitPips, 1));
   
   // === CLOUD ML: Submit pattern to global server ===
   if(InpUseCloudML && StringLen(InpCloudMLURL) > 10)
   {
      SubmitPatternToCloud(pattern);
   }
}

//+------------------------------------------------------------------+
//| CLOUD ML: Submit pattern to global learning server               |
//+------------------------------------------------------------------+
void SubmitPatternToCloud(TradePattern &pat)
{
   string url = InpCloudMLURL + "/submit-pattern";
   string headers = "Content-Type: application/json\r\n";
   
   string json = StringFormat(
      "{\"pin\":\"%s\",\"market_state\":%d,\"strategy\":%d,\"ema_diff\":%.4f,"
      "\"rsi_value\":%.2f,\"atr_value\":%.4f,\"bb_width\":%.6f,"
      "\"hour_of_day\":%d,\"day_of_week\":%d,\"candle_body_ratio\":%.4f,"
      "\"was_winner\":%s,\"profit_pips\":%.2f,\"confidence\":%d}",
      InpLicensePIN, (int)pat.marketState, (int)pat.strategy, pat.emaDiff,
      pat.rsiValue, pat.atrValue, pat.bbWidth,
      pat.hourOfDay, pat.dayOfWeek, pat.candleBodyRatio,
      pat.wasWinner ? "true" : "false", pat.profitPips, pat.confidence
   );
   
   char post[], result[];
   string resultHeaders;
   StringToCharArray(json, post, 0, StringLen(json));
   
   int res = WebRequest("POST", url, headers, 5000, post, result, resultHeaders);
   
   if(res == 200)
   {
      Print("CLOUD ML: Pattern submitted to global server successfully");
   }
   else
   {
      Print("CLOUD ML: Submit failed (code: ", res, ") - using local ML only");
   }
}

//+------------------------------------------------------------------+
//| CLOUD ML: Get confidence adjustment from global server           |
//+------------------------------------------------------------------+
int GetCloudMLConfidence()
{
   if(!InpUseCloudML || StringLen(InpCloudMLURL) < 10) return 0;
   
   string url = InpCloudMLURL + "/get-confidence";
   string headers = "Content-Type: application/json\r\n";
   
   double emaDiff = (bufEMAFast[1] - bufEMASlow[1]) / bufEMASlow[1] * 10000;
   double bbWidth = (bufBBUpper[1] - bufBBLower[1]) / iClose(Symbol(), PERIOD_M5, 1);
   
   MqlDateTime dt;
   TimeCurrent(dt);
   
   string json = StringFormat(
      "{\"pin\":\"%s\",\"market_state\":%d,\"strategy\":%d,\"ema_diff\":%.4f,"
      "\"rsi_value\":%.2f,\"atr_value\":%.4f,\"bb_width\":%.6f,"
      "\"hour_of_day\":%d,\"day_of_week\":%d}",
      InpLicensePIN, (int)currentMarketCondition, (int)activeStrategy,
      emaDiff, bufRSI[1], bufATR[1], bbWidth, dt.hour, dt.day_of_week
   );
   
   char post[], result[];
   string resultHeaders;
   StringToCharArray(json, post, 0, StringLen(json));
   
   int res = WebRequest("POST", url, headers, 5000, post, result, resultHeaders);
   
   if(res == 200)
   {
      string response = CharArrayToString(result);
      
      // Check for skip_trade flag
      if(StringFind(response, "\"skip_trade\": true") >= 0 || StringFind(response, "\"skip_trade\":true") >= 0)
      {
         Print("CLOUD ML: Trade SKIPPED by global intelligence - historically bad setup");
         return -100; // Signal to skip trade entirely
      }
      
      // Parse adjustment value
      int adjStart = StringFind(response, "\"adjustment\":");
      if(adjStart >= 0)
      {
         adjStart += 14; // length of "\"adjustment\":"
         string adjStr = "";
         for(int i = adjStart; i < StringLen(response); i++)
         {
            ushort ch = StringGetCharacter(response, i);
            if((ch >= '0' && ch <= '9') || ch == '-') adjStr += ShortToString(ch);
            else if(StringLen(adjStr) > 0) break;
         }
         if(StringLen(adjStr) > 0)
         {
            int cloudAdj = (int)StringToInteger(adjStr);
            Print("CLOUD ML: Global confidence adjustment: ", cloudAdj);
            return cloudAdj;
         }
      }
   }
   else
   {
      Print("CLOUD ML: Server unreachable (code: ", res, ") - using local ML");
   }
   
   return 0; // Fallback: no adjustment
}

//+------------------------------------------------------------------+
//| SMART TRADE CHECK: All-in-one (News+DXY+Session+ML combined)     |
//+------------------------------------------------------------------+
int GetSmartTradeCheck()
{
   if(StringLen(InpCloudMLURL) < 10) return 0;
   
   string url = InpCloudMLURL + "/smart/check-trade";
   string headers = "Content-Type: application/json\r\n";
   
   double emaDiff = (bufEMAFast[1] - bufEMASlow[1]) / bufEMASlow[1] * 10000;
   double bbWidth = (bufBBUpper[1] - bufBBLower[1]) / iClose(Symbol(), PERIOD_M5, 1);
   
   MqlDateTime dt;
   TimeCurrent(dt);
   
   string json = StringFormat(
      "{\"pin\":\"%s\",\"market_state\":%d,\"strategy\":%d,\"ema_diff\":%.4f,"
      "\"rsi_value\":%.2f,\"atr_value\":%.4f,\"bb_width\":%.6f,"
      "\"hour_of_day\":%d,\"day_of_week\":%d}",
      InpLicensePIN, (int)currentMarketCondition, (int)activeStrategy,
      emaDiff, bufRSI[1], bufATR[1], bbWidth, dt.hour, dt.day_of_week
   );
   
   char post[], result[];
   string resultHeaders;
   StringToCharArray(json, post, 0, StringLen(json));
   
   int res = WebRequest("POST", url, headers, 8000, post, result, resultHeaders);
   
   if(res == 200)
   {
      string response = CharArrayToString(result);
      
      // Check allow_trade flag
      if(StringFind(response, "\"allow_trade\": false") >= 0 || StringFind(response, "\"allow_trade\":false") >= 0)
      {
         Print("SMART CHECK: Trade NOT ALLOWED by server");
         return -100;
      }
      
      // Parse final_adjustment
      int adjStart = StringFind(response, "\"final_adjustment\":");
      if(adjStart >= 0)
      {
         adjStart += 20;
         string adjStr = "";
         for(int i = adjStart; i < StringLen(response); i++)
         {
            ushort ch = StringGetCharacter(response, i);
            if((ch >= '0' && ch <= '9') || ch == '-') adjStr += ShortToString(ch);
            else if(StringLen(adjStr) > 0) break;
         }
         if(StringLen(adjStr) > 0)
         {
            int smartAdj = (int)StringToInteger(adjStr);
            Print("SMART CHECK: Combined adjustment: ", smartAdj);
            return smartAdj;
         }
      }
   }
   else
   {
      Print("SMART CHECK: Server unreachable (", res, ") - falling back to local");
   }
   
   return 0;
}


//+------------------------------------------------------------------+
//| ML: SAVE PATTERN MEMORY TO FILE                                  |
//+------------------------------------------------------------------+
void SavePatternMemory()
{
   if(patternCount == 0) return;
   
   string filename = "AI_Sniper_Patterns_" + Symbol() + ".bin";
   int handle = FileOpen(filename, FILE_WRITE | FILE_BIN);
   if(handle == INVALID_HANDLE) return;
   
   FileWriteInteger(handle, patternCount);
   for(int i = 0; i < patternCount; i++)
   {
      FileWriteInteger(handle, (int)patternMemory[i].marketState);
      FileWriteInteger(handle, (int)patternMemory[i].strategy);
      FileWriteDouble(handle, patternMemory[i].emaDiff);
      FileWriteDouble(handle, patternMemory[i].rsiValue);
      FileWriteDouble(handle, patternMemory[i].atrValue);
      FileWriteDouble(handle, patternMemory[i].bbWidth);
      FileWriteInteger(handle, patternMemory[i].hourOfDay);
      FileWriteInteger(handle, patternMemory[i].dayOfWeek);
      FileWriteDouble(handle, patternMemory[i].candleBodyRatio);
      FileWriteInteger(handle, patternMemory[i].wasWinner ? 1 : 0);
      FileWriteDouble(handle, patternMemory[i].profitPips);
      FileWriteInteger(handle, patternMemory[i].confidence);
   }
   FileClose(handle);
}

//+------------------------------------------------------------------+
//| ML: LOAD PATTERN MEMORY FROM FILE                                |
//+------------------------------------------------------------------+
void LoadPatternMemory()
{
   string filename = "AI_Sniper_Patterns_" + Symbol() + ".bin";
   
   if(!FileIsExist(filename)) return;
   
   int handle = FileOpen(filename, FILE_READ | FILE_BIN);
   if(handle == INVALID_HANDLE) return;
   
   patternCount = FileReadInteger(handle);
   ArrayResize(patternMemory, patternCount);
   
   for(int i = 0; i < patternCount; i++)
   {
      patternMemory[i].marketState = (ENUM_MARKET_CONDITION)FileReadInteger(handle);
      patternMemory[i].strategy = (ENUM_STRATEGY_MODE)FileReadInteger(handle);
      patternMemory[i].emaDiff = FileReadDouble(handle);
      patternMemory[i].rsiValue = FileReadDouble(handle);
      patternMemory[i].atrValue = FileReadDouble(handle);
      patternMemory[i].bbWidth = FileReadDouble(handle);
      patternMemory[i].hourOfDay = FileReadInteger(handle);
      patternMemory[i].dayOfWeek = FileReadInteger(handle);
      patternMemory[i].candleBodyRatio = FileReadDouble(handle);
      patternMemory[i].wasWinner = FileReadInteger(handle) == 1;
      patternMemory[i].profitPips = FileReadDouble(handle);
      patternMemory[i].confidence = FileReadInteger(handle);
   }
   FileClose(handle);
}

//+------------------------------------------------------------------+
//| UPDATE INDICATORS                                                |
//+------------------------------------------------------------------+
bool UpdateIndicators()
{
   if(CopyBuffer(handleEMAFast, 0, 0, 10, bufEMAFast) < 10) return false;
   if(CopyBuffer(handleEMASlow, 0, 0, 10, bufEMASlow) < 10) return false;
   if(CopyBuffer(handleRSI, 0, 0, 10, bufRSI) < 10) return false;
   if(CopyBuffer(handleATR, 0, 0, 10, bufATR) < 10) return false;
   if(CopyBuffer(handleBB, 1, 0, 10, bufBBUpper) < 10) return false;
   if(CopyBuffer(handleBB, 0, 0, 10, bufBBMiddle) < 10) return false;
   if(CopyBuffer(handleBB, 2, 0, 10, bufBBLower) < 10) return false;
   if(CopyBuffer(handleEMAFast_H1, 0, 0, 5, bufEMAFast_H1) < 5) return false;
   if(CopyBuffer(handleEMASlow_H1, 0, 0, 5, bufEMASlow_H1) < 5) return false;
   if(CopyBuffer(handleRSI_H1, 0, 0, 5, bufRSI_H1) < 5) return false;
   if(CopyBuffer(handleEMAFast_H4, 0, 0, 5, bufEMAFast_H4) < 5) return false;
   if(CopyBuffer(handleEMASlow_H4, 0, 0, 5, bufEMASlow_H4) < 5) return false;
   return true;
}

//+------------------------------------------------------------------+
//| MARKET CLASSIFICATION ENGINE                                     |
//+------------------------------------------------------------------+
ENUM_MARKET_CONDITION ClassifyMarket()
{
   double emaFast = bufEMAFast[1];
   double emaSlow = bufEMASlow[1];
   double bbUpper = bufBBUpper[1];
   double bbLower = bufBBLower[1];
   double close1  = iClose(Symbol(), PERIOD_M5, 1);
   double h4Fast  = bufEMAFast_H4[1];
   double h4Slow  = bufEMASlow_H4[1];
   
   double bbWidth = (bbUpper - bbLower) / close1;
   double prevBBWidth = (bufBBUpper[3] - bufBBLower[3]) / iClose(Symbol(), PERIOD_M5, 3);
   bool bbSqueeze = prevBBWidth < bbWidth * 0.7;
   
   if(bbSqueeze && close1 > bbUpper) return MARKET_BREAKOUT_UP;
   if(bbSqueeze && close1 < bbLower) return MARKET_BREAKOUT_DOWN;
   
   double emaDiff = MathAbs(emaFast - emaSlow) / close1 * 10000;
   
   // Relaxed: M5 EMA direction is primary, H4 is bonus (not required)
   if(emaFast > emaSlow && emaDiff > 2) return MARKET_TRENDING_UP;
   if(emaFast < emaSlow && emaDiff > 2) return MARKET_TRENDING_DOWN;
   
   // Anything not clearly trending is ranging (no more UNDEFINED dead zone)
   return MARKET_RANGING;
}

//+------------------------------------------------------------------+
//| STRATEGY SELECTION                                               |
//+------------------------------------------------------------------+
ENUM_STRATEGY_MODE SelectStrategy(ENUM_MARKET_CONDITION condition)
{
   switch(condition)
   {
      case MARKET_TRENDING_UP:
      case MARKET_TRENDING_DOWN:
         if(InpEnableTrendMode) return STRATEGY_TREND;
         break;
      case MARKET_RANGING:
         if(InpEnableRangeMode) return STRATEGY_RANGE;
         break;
      case MARKET_BREAKOUT_UP:
      case MARKET_BREAKOUT_DOWN:
         if(InpEnableBreakoutMode) return STRATEGY_BREAKOUT;
         break;
   }
   return STRATEGY_NONE;
}

//+------------------------------------------------------------------+
//| TREND STRATEGY                                                   |
//+------------------------------------------------------------------+
int TrendStrategy()
{
   double close1  = iClose(Symbol(), PERIOD_M5, 1);
   double close2  = iClose(Symbol(), PERIOD_M5, 2);
   double close3  = iClose(Symbol(), PERIOD_M5, 3);
   double open1   = iOpen(Symbol(), PERIOD_M5, 1);
   double emaFast = bufEMAFast[1];
   double emaSlow = bufEMASlow[1];
   double rsi     = bufRSI[1];
   double h1Fast  = bufEMAFast_H1[1];
   double h1Slow  = bufEMASlow_H1[1];
   double h1RSI   = bufRSI_H1[1];
   double h4Fast  = bufEMAFast_H4[1];
   double h4Slow  = bufEMASlow_H4[1];
   
   int confidence = 0;
   int signal = 0;
   
   // === BULLISH TREND ===
   if(emaFast > emaSlow)
   {
      // Core: price is above fast EMA and moving up
      bool priceAboveEMA = close1 > emaFast;
      // Pullback: price was near or touched EMA and bounced
      bool pullbackBounce = close2 <= emaFast * 1.005 && close1 > close2;
      // Momentum: 2 consecutive higher closes
      bool momentum = close1 > close2 && close2 > close3;
      // RSI in bullish zone
      bool rsiBullish = rsi >= 30 && rsi <= 75;
      // Bullish candle
      bool bullishCandle = close1 > open1;
      // Strong candle (above average body)
      bool strongCandle = bullishCandle && (close1 - open1) > (bufATR[1] * 0.1);
      // H1 confirmation
      bool h1Confirm = h1Fast > h1Slow;
      // H4 confirmation
      bool h4Confirm = h4Fast > h4Slow;
      
      // Build confidence score
      if(priceAboveEMA) confidence += 15;
      if(pullbackBounce) confidence += 20;
      if(momentum) confidence += 15;
      if(rsiBullish) confidence += 15;
      if(strongCandle) confidence += 15;
      else if(bullishCandle) confidence += 10;
      if(h1Confirm) confidence += 10;
      if(h4Confirm) confidence += 10;
      
      // Signal fires if confidence is strong enough (EMA direction = trade direction)
      if(confidence >= 40) signal = 1;
   }
   
   // === BEARISH TREND ===
   if(signal == 0 && emaFast < emaSlow)
   {
      bool priceBelowEMA = close1 < emaFast;
      bool pullbackBounce = close2 >= emaFast * 0.995 && close1 < close2;
      bool momentum = close1 < close2 && close2 < close3;
      bool rsiBearish = rsi >= 25 && rsi <= 70;
      bool bearishCandle = close1 < open1;
      bool strongCandle = bearishCandle && (open1 - close1) > (bufATR[1] * 0.1);
      bool h1Confirm = h1Fast < h1Slow;
      bool h4Confirm = h4Fast < h4Slow;
      
      confidence = 0;
      if(priceBelowEMA) confidence += 15;
      if(pullbackBounce) confidence += 20;
      if(momentum) confidence += 15;
      if(rsiBearish) confidence += 15;
      if(strongCandle) confidence += 15;
      else if(bearishCandle) confidence += 10;
      if(h1Confirm) confidence += 10;
      if(h4Confirm) confidence += 10;
      
      // Signal fires if confidence is strong enough (EMA direction = trade direction)
      if(confidence >= 40) signal = -1;
   }
   
   tradeConfidence = confidence;
   return signal;
}

//+------------------------------------------------------------------+
//| RANGE STRATEGY                                                   |
//+------------------------------------------------------------------+
int RangeStrategy()
{
   double close1  = iClose(Symbol(), PERIOD_M5, 1);
   double open1   = iOpen(Symbol(), PERIOD_M5, 1);
   double bbUpper = bufBBUpper[1];
   double bbLower = bufBBLower[1];
   double rsi     = bufRSI[1];
   
   int confidence = 0;
   int signal = 0;
   
   double bbRange = bbUpper - bbLower;
   double lowerZone = bbLower + bbRange * 0.20;
   double upperZone = bbUpper - bbRange * 0.20;
   
   // === BUY at lower BB zone ===
   if(close1 <= lowerZone)
   {
      bool bullishRejection = close1 > open1;
      bool rsiOversold = rsi < 40;
      bool risingRSI = bufRSI[2] < bufRSI[1];
      
      if(bullishRejection) confidence += 25;
      if(rsiOversold) confidence += 25;
      if(close1 > bbLower) confidence += 15;
      if(risingRSI) confidence += 20;
      if(rsi < 30) confidence += 15;  // Bonus for deeply oversold
      
      // Signal if confidence is strong enough at lower BB
      if(confidence >= 40) signal = 1;
   }
   
   // === SELL at upper BB zone ===
   if(signal == 0 && close1 >= upperZone)
   {
      bool bearishRejection = close1 < open1;
      bool rsiOverbought = rsi > 60;
      bool fallingRSI = bufRSI[2] > bufRSI[1];
      
      if(bearishRejection) confidence += 25;
      if(rsiOverbought) confidence += 25;
      if(close1 < bbUpper) confidence += 15;
      if(fallingRSI) confidence += 20;
      if(rsi > 70) confidence += 15;  // Bonus for deeply overbought
      
      // Signal if confidence is strong enough at upper BB
      if(confidence >= 40) signal = -1;
   }
   
   tradeConfidence = confidence;
   return signal;
}

//+------------------------------------------------------------------+
//| BREAKOUT STRATEGY                                                |
//+------------------------------------------------------------------+
int BreakoutStrategy()
{
   double close1  = iClose(Symbol(), PERIOD_M5, 1);
   double close2  = iClose(Symbol(), PERIOD_M5, 2);
   double open1   = iOpen(Symbol(), PERIOD_M5, 1);
   double bbUpper = bufBBUpper[1];
   double bbLower = bufBBLower[1];
   double atr     = bufATR[1];
   double rsi     = bufRSI[1];
   
   int confidence = 0;
   int signal = 0;
   
   double bbWidth = bbUpper - bbLower;
   double prevBBWidth = bufBBUpper[5] - bufBBLower[5];
   bool wasSqueezing = bbWidth > prevBBWidth * 1.2;
   
   double bodySize = MathAbs(close1 - open1);
   bool strongBody = bodySize > atr * 0.3;
   
   // === BREAKOUT UP ===
   if(close1 > bbUpper && close2 <= bufBBUpper[2])
   {
      if(wasSqueezing) confidence += 25;
      if(strongBody) confidence += 20;
      if(rsi > 50) confidence += 15;
      if(close1 > open1) confidence += 15;
      if(bufEMAFast_H1[1] > bufEMASlow_H1[1]) confidence += 15;
      if(bodySize > atr * 0.5) confidence += 10;
      
      // Signal on breakout up - confidence drives it
      if(confidence >= 40) signal = 1;
   }
   
   // === BREAKOUT DOWN ===
   if(signal == 0 && close1 < bbLower && close2 >= bufBBLower[2])
   {
      if(wasSqueezing) confidence += 25;
      if(strongBody) confidence += 20;
      if(rsi < 50) confidence += 15;
      if(close1 < open1) confidence += 15;
      if(bufEMAFast_H1[1] < bufEMASlow_H1[1]) confidence += 15;
      if(bodySize > atr * 0.5) confidence += 10;
      
      // Signal on breakout down - confidence drives it
      if(confidence >= 40) signal = -1;
   }
   
   tradeConfidence = confidence;
   return signal;
}

//+------------------------------------------------------------------+
//| TRADE EXECUTION                                                  |
//+------------------------------------------------------------------+
void ExecuteTrade(int signal)
{
   double atr = bufATR[1];
   double price, sl, tp;
   double lotSize;
   int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double point = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   long stopLevel = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
   double minStopDist = stopLevel * point;
   
   if(signal == 1)
   {
      price = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
      if(price <= 0) { Print("ERROR: Ask price is 0 - cannot trade"); return; }
      
      sl = price - atr * InpSLATRMultiplier;
      
      double swingLow = FindSwingLow(10);
      if(swingLow > 0 && swingLow < price)
      {
         double structureSL = swingLow - atr * 0.2;
         if(structureSL > sl) sl = structureSL;
      }
      
      // Ensure minimum stop distance from broker
      if(price - sl < minStopDist) sl = price - minStopDist;
      
      double slDistance = price - sl;
      if(slDistance <= 0) { Print("ERROR: Invalid SL distance for BUY"); return; }
      
      tp = price + slDistance * InpMinRRRatio;
      double maxTP = price + slDistance * InpMaxRRRatio;
      if(tp > maxTP) tp = maxTP;
      
      // Ensure TP also meets minimum stop distance
      if(tp - price < minStopDist) tp = price + minStopDist * InpMinRRRatio;
      
      // Normalize all prices
      sl = NormalizeDouble(sl, digits);
      tp = NormalizeDouble(tp, digits);
      price = NormalizeDouble(price, digits);
      
      lotSize = CalculateLotSize(slDistance);
      if(lotSize <= 0) { Print("ERROR: Lot size calculated as 0"); return; }
      
      Print("TRADE ATTEMPT BUY: Price=", DoubleToString(price, digits),
            " SL=", DoubleToString(sl, digits), " TP=", DoubleToString(tp, digits),
            " Lots=", DoubleToString(lotSize, 2));
      
      if(trade.Buy(lotSize, Symbol(), 0, sl, tp,
         StringFormat("AI_Sniper|%s|Conf:%d|ML:%d", StrategyName(activeStrategy), tradeConfidence, mlBoostApplied)))
      {
         LogTrade("BUY", price, sl, tp, lotSize, tradeConfidence);
         todayTradeCount++;
         lastTradeTime = TimeCurrent();
      }
      else
      {
         Print("TRADE FAILED BUY: Error=", GetLastError(), " RetCode=", trade.ResultRetcode());
      }
   }
   else if(signal == -1)
   {
      price = SymbolInfoDouble(Symbol(), SYMBOL_BID);
      if(price <= 0) { Print("ERROR: Bid price is 0 - cannot trade"); return; }
      
      sl = price + atr * InpSLATRMultiplier;
      
      double swingHigh = FindSwingHigh(10);
      if(swingHigh > 0 && swingHigh > price)
      {
         double structureSL = swingHigh + atr * 0.2;
         if(structureSL < sl) sl = structureSL;
      }
      
      // Ensure minimum stop distance from broker
      if(sl - price < minStopDist) sl = price + minStopDist;
      
      double slDistance = sl - price;
      if(slDistance <= 0) { Print("ERROR: Invalid SL distance for SELL"); return; }
      
      tp = price - slDistance * InpMinRRRatio;
      double maxTP = price - slDistance * InpMaxRRRatio;
      if(tp < maxTP) tp = maxTP;
      
      // Ensure TP also meets minimum stop distance
      if(price - tp < minStopDist) tp = price - minStopDist * InpMinRRRatio;
      
      // Normalize all prices
      sl = NormalizeDouble(sl, digits);
      tp = NormalizeDouble(tp, digits);
      price = NormalizeDouble(price, digits);
      
      lotSize = CalculateLotSize(slDistance);
      if(lotSize <= 0) { Print("ERROR: Lot size calculated as 0"); return; }
      
      Print("TRADE ATTEMPT SELL: Price=", DoubleToString(price, digits),
            " SL=", DoubleToString(sl, digits), " TP=", DoubleToString(tp, digits),
            " Lots=", DoubleToString(lotSize, 2));
      
      if(trade.Sell(lotSize, Symbol(), 0, sl, tp,
         StringFormat("AI_Sniper|%s|Conf:%d|ML:%d", StrategyName(activeStrategy), tradeConfidence, mlBoostApplied)))
      {
         LogTrade("SELL", price, sl, tp, lotSize, tradeConfidence);
         todayTradeCount++;
         lastTradeTime = TimeCurrent();
      }
      else
      {
         Print("TRADE FAILED SELL: Error=", GetLastError(), " RetCode=", trade.ResultRetcode());
      }
   }
}

//+------------------------------------------------------------------+
//| POSITION MANAGEMENT                                              |
//+------------------------------------------------------------------+
void ManageOpenPositions()
{
   int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != InpMagicNumber) continue;
      if(posInfo.Symbol() != Symbol()) continue;
      
      double currentPrice = posInfo.PriceCurrent();
      double openPrice    = posInfo.PriceOpen();
      double currentSL    = posInfo.StopLoss();
      double currentTP    = posInfo.TakeProfit();
      double atr          = bufATR[1];
      ulong  ticket       = posInfo.Ticket();
      
      if(posInfo.PositionType() == POSITION_TYPE_BUY)
      {
         double trailSL = NormalizeDouble(currentPrice - atr * InpTrailingATRMulti, digits);
         if(currentPrice > openPrice + atr && trailSL > currentSL)
            trade.PositionModify(ticket, trailSL, currentTP);
         
         double slDistance = openPrice - currentSL;
         if(slDistance <= 0) continue;
         double firstTarget = openPrice + slDistance * 1.0;
         
         if(currentPrice >= firstTarget && posInfo.Volume() > SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN))
         {
            double closeVolume = NormalizeDouble(posInfo.Volume() * InpPartialClosePercent / 100.0, 2);
            double minVol = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
            if(closeVolume >= minVol)
               trade.PositionClosePartial(ticket, closeVolume);
         }
      }
      else if(posInfo.PositionType() == POSITION_TYPE_SELL)
      {
         double trailSL = NormalizeDouble(currentPrice + atr * InpTrailingATRMulti, digits);
         if(currentPrice < openPrice - atr && trailSL < currentSL)
            trade.PositionModify(ticket, trailSL, currentTP);
         
         double slDistance = currentSL - openPrice;
         if(slDistance <= 0) continue;
         double firstTarget = openPrice - slDistance * 1.0;
         
         if(currentPrice <= firstTarget && posInfo.Volume() > SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN))
         {
            double closeVolume = NormalizeDouble(posInfo.Volume() * InpPartialClosePercent / 100.0, 2);
            double minVol = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
            if(closeVolume >= minVol)
               trade.PositionClosePartial(ticket, closeVolume);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| POSITION SIZING                                                  |
//+------------------------------------------------------------------+
double CalculateLotSize(double slDistancePoints)
{
   double balance = accInfo.Balance();
   double riskAmount = balance * InpRiskPercent / 100.0;
   
   double tickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   double minLot    = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
   double maxLot    = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
   double lotStep   = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
   
   if(tickValue == 0 || tickSize == 0 || slDistancePoints == 0) return 0;
   
   double lotSize = riskAmount / (slDistancePoints / tickSize * tickValue);
   
   // RECOVERY MODE: Cut lot size in half to protect remaining capital
   if(recoveryModeActive)
   {
      lotSize *= 0.5;
      Print("RECOVERY MODE: Lot size halved to ", DoubleToString(lotSize, 2));
   }
   
   lotSize = MathFloor(lotSize / lotStep) * lotStep;
   lotSize = MathMax(minLot, MathMin(maxLot, lotSize));
   
   return NormalizeDouble(lotSize, 2);
}

//+------------------------------------------------------------------+
//| SAFETY CHECKS                                                    |
//+------------------------------------------------------------------+
bool PassSafetyChecks()
{
   double currentEquity = accInfo.Equity();
   double protectionLevel = initialBalance * InpEquityProtection / 100.0;
   if(currentEquity < protectionLevel)
   {
      CloseAllPositions();
      Print("BLOCKED: EQUITY PROTECTION TRIGGERED - equity below ", DoubleToString(protectionLevel, 2));
      return false;
   }
   
   if(dailyLimitReached)
   {
      static datetime lastDailyMsg = 0;
      if(TimeCurrent() - lastDailyMsg > 300) { Print("BLOCKED: Daily loss limit already reached"); lastDailyMsg = TimeCurrent(); }
      return false;
   }
   double dailyPnL = currentEquity - dailyStartEquity;
   double dailyLossMax = dailyStartEquity * InpDailyLossLimit / 100.0;
   if(dailyPnL < -dailyLossMax)
   {
      dailyLimitReached = true;
      Print("BLOCKED: Daily loss limit hit (", DoubleToString(dailyPnL, 2), " < -", DoubleToString(dailyLossMax, 2), ")");
      return false;
   }
   
   if(weeklyLimitReached)
   {
      static datetime lastWeekMsg = 0;
      if(TimeCurrent() - lastWeekMsg > 300) { Print("BLOCKED: Weekly drawdown limit already reached"); lastWeekMsg = TimeCurrent(); }
      return false;
   }
   double weeklyPnL = currentEquity - weeklyStartEquity;
   double weeklyLossMax = weeklyStartEquity * InpWeeklyDrawdownLimit / 100.0;
   if(weeklyPnL < -weeklyLossMax)
   {
      weeklyLimitReached = true;
      CloseAllPositions();
      Print("BLOCKED: Weekly drawdown limit hit");
      return false;
   }
   
   if(weeklyTargetReached)
   {
      static datetime lastTargetMsg = 0;
      if(TimeCurrent() - lastTargetMsg > 300) { Print("BLOCKED: Weekly target already reached - bot resting"); lastTargetMsg = TimeCurrent(); }
      return false;
   }
   double weeklyTarget = weeklyStartEquity * effectiveWeeklyTarget / 100.0;
   if(weeklyPnL >= weeklyTarget)
   {
      weeklyTargetReached = true;
      Print("BLOCKED: Weekly profit target reached! Taking profit.");
      return false;
   }
   
   if(TimeCurrent() < cooldownUntil)
   {
      static datetime lastCoolMsg = 0;
      if(TimeCurrent() - lastCoolMsg > 60) { Print("BLOCKED: Cooldown active until ", TimeToString(cooldownUntil)); lastCoolMsg = TimeCurrent(); }
      return false;
   }
   
   symInfo.Refresh();
   double currentSpread = symInfo.Spread();
   if(currentSpread > InpMaxSpread)
   {
      static datetime lastSpreadMsg = 0;
      if(TimeCurrent() - lastSpreadMsg > 300) { Print("BLOCKED: Spread too wide (", DoubleToString(currentSpread, 0), " > ", DoubleToString(InpMaxSpread, 0), ")"); lastSpreadMsg = TimeCurrent(); }
      return false;
   }
   
   if(!IsWithinTradingSession())
   {
      static datetime lastSessionMsg = 0;
      if(TimeCurrent() - lastSessionMsg > 600) { Print("BLOCKED: Outside trading session hours"); lastSessionMsg = TimeCurrent(); }
      return false;
   }
   
   if(currentEquity > peakEquity) peakEquity = currentEquity;
   double currentDrawdown = (peakEquity - currentEquity) / peakEquity * 100;
   if(currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;
   
   return true;
}

bool CanOpenNewTrade()
{
   int openCount = CountOpenPositions();
   if(openCount >= InpMaxOpenTrades) return false;
   if(todayTradeCount >= InpMaxTradesPerDay) return false;
   return true;
}

bool IsWithinTradingSession()
{
   MqlDateTime dt;
   TimeCurrent(dt);
   int hour = dt.hour;
   
   bool inLondon = (hour >= InpLondonStartHour && hour < InpLondonEndHour);
   bool inNY     = (hour >= InpNYStartHour && hour < InpNYEndHour);
   
   if(InpTradeOnlyLondon && inLondon) return true;
   if(InpTradeOnlyNewYork && inNY) return true;
   if(!InpTradeOnlyLondon && !InpTradeOnlyNewYork) return true;
   
   return false;
}

double FindSwingLow(int lookback)
{
   double lowest = DBL_MAX;
   for(int i = 1; i <= lookback; i++)
   {
      double low = iLow(Symbol(), PERIOD_M5, i);
      if(low < lowest) lowest = low;
   }
   return lowest;
}

double FindSwingHigh(int lookback)
{
   double highest = 0;
   for(int i = 1; i <= lookback; i++)
   {
      double high = iHigh(Symbol(), PERIOD_M5, i);
      if(high > highest) highest = high;
   }
   return highest;
}

int CountOpenPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(posInfo.SelectByIndex(i))
         if(posInfo.Magic() == InpMagicNumber && posInfo.Symbol() == Symbol())
            count++;
   }
   return count;
}

void CloseAllPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(posInfo.SelectByIndex(i))
         if(posInfo.Magic() == InpMagicNumber && posInfo.Symbol() == Symbol())
            trade.PositionClose(posInfo.Ticket());
   }
}

void CheckDailyReset()
{
   MqlDateTime dtNow, dtLast;
   TimeCurrent(dtNow);
   TimeToStruct(lastDayReset, dtLast);
   
   if(dtNow.day != dtLast.day)
   {
      dailyStartEquity  = accInfo.Equity();
      todayTradeCount   = 0;
      dailyLimitReached = false;
      lastDayReset      = TimeCurrent();
   }
}

void CheckWeeklyReset()
{
   MqlDateTime dtNow, dtLast;
   TimeCurrent(dtNow);
   TimeToStruct(lastWeekReset, dtLast);
   
   if(dtNow.day_of_week == 1 && dtLast.day_of_week != 1)
   {
      weeklyStartEquity  = accInfo.Equity();
      weeklyLimitReached = false;
      weeklyTargetReached= false;
      lastWeekReset      = TimeCurrent();
   }
}

void LogTrade(string type, double price, double sl, double tp, double lots, int confidence)
{
   Print("=== TRADE EXECUTED ===");
   Print("Type: ", type, " | Strategy: ", StrategyName(activeStrategy));
   Print("Price: ", DoubleToString(price, 2), " | SL: ", DoubleToString(sl, 2), " | TP: ", DoubleToString(tp, 2));
   Print("Lots: ", DoubleToString(lots, 2), " | Confidence: ", confidence, " | ML Boost: ", mlBoostApplied);
}

void PrintPerformanceSummary()
{
   double equity = accInfo.Equity();
   double totalReturn = ((equity - initialBalance) / initialBalance) * 100;
   double winRate = totalTrades > 0 ? (double)winningTrades / totalTrades * 100 : 0;
   double profitFactor = totalLoss != 0 ? MathAbs(totalProfit / totalLoss) : 0;
   
   Print("=== PERFORMANCE SUMMARY ===");
   Print("Trades: ", totalTrades, " | Win Rate: ", DoubleToString(winRate, 1), "%");
   Print("Profit Factor: ", DoubleToString(profitFactor, 2), " | Max DD: ", DoubleToString(maxDrawdown, 2), "%");
   Print("Return: ", DoubleToString(totalReturn, 2), "% | ML Patterns: ", patternCount);
}

void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      CDealInfo deal;
      if(deal.SelectByIndex(HistoryDealsTotal() - 1))
      {
         if(deal.Magic() == InpMagicNumber && deal.Entry() == DEAL_ENTRY_OUT)
         {
            double profit = deal.Profit() + deal.Swap() + deal.Commission();
            totalTrades++;
            
            bool isWin = profit > 0;
            
            if(isWin)
            {
               winningTrades++;
               totalProfit += profit;
               consecutiveLosses = 0;
            }
            else
            {
               losingTrades++;
               totalLoss += profit;
               consecutiveLosses++;
               
               if(consecutiveLosses >= InpConsecutiveLossMax)
               {
                  cooldownUntil = TimeCurrent() + InpCooldownMinutes * 60;
                  consecutiveLosses = 0;
               }
            }
            
            // ML: Record pattern
            RecordTradePattern(isWin, profit);
         }
      }
   }
}

string StrategyName(ENUM_STRATEGY_MODE mode)
{
   switch(mode)
   {
      case STRATEGY_TREND:    return "TREND";
      case STRATEGY_RANGE:    return "RANGE";
      case STRATEGY_BREAKOUT: return "BREAKOUT";
      default:                return "NONE";
   }
}

string MarketConditionName(ENUM_MARKET_CONDITION condition)
{
   switch(condition)
   {
      case MARKET_TRENDING_UP:    return "TREND UP";
      case MARKET_TRENDING_DOWN:  return "TREND DOWN";
      case MARKET_RANGING:        return "RANGING";
      case MARKET_BREAKOUT_UP:    return "BREAKOUT UP";
      case MARKET_BREAKOUT_DOWN:  return "BREAKOUT DN";
      default:                    return "UNDEFINED";
   }
}

void UpdateDashboard()
{
   double equity = accInfo.Equity();
   double balance = accInfo.Balance();
   double dailyPnL = equity - dailyStartEquity;
   double weeklyPnL = equity - weeklyStartEquity;
   double winRate = totalTrades > 0 ? (double)winningTrades / totalTrades * 100 : 0;
   
   // ML stats
   double mlWinRate = 0;
   int mlWins = 0;
   for(int i = 0; i < patternCount; i++)
      if(patternMemory[i].wasWinner) mlWins++;
   if(patternCount > 0) mlWinRate = (double)mlWins / patternCount * 100;
   
   string dashboard = "\n";
   dashboard += "============================================\n";
   dashboard += "   XauAI SNIPER v2.0 | XAUUSD | LICENSED\n";
   dashboard += "============================================\n";
   dashboard += StringFormat("Balance: $%.2f | Equity: $%.2f\n", balance, equity);
   dashboard += StringFormat("Daily P/L: $%.2f | Weekly: $%.2f\n", dailyPnL, weeklyPnL);
   dashboard += "--------------------------------------------\n";
   dashboard += StringFormat("Market: %s | Strategy: %s\n", MarketConditionName(currentMarketCondition), StrategyName(activeStrategy));
   dashboard += StringFormat("Confidence: %d%% | ML Boost: %+d\n", tradeConfidence, mlBoostApplied);
   dashboard += StringFormat("Open: %d/%d | Today: %d/%d\n",
                CountOpenPositions(), InpMaxOpenTrades, todayTradeCount, InpMaxTradesPerDay);
   dashboard += "--------------------------------------------\n";
   dashboard += StringFormat("Trades: %d | Win Rate: %.1f%%\n", totalTrades, winRate);
   dashboard += StringFormat("Max DD: %.2f%% | Target: %.0f%%\n", maxDrawdown, effectiveWeeklyTarget);
   dashboard += StringFormat("ML Patterns: %d | ML Win%%: %.1f%%\n", patternCount, mlWinRate);
   dashboard += "--------------------------------------------\n";
   dashboard += StringFormat("Smart Check: %s | Cloud ML: %s\n",
                InpSmartTradeCheck ? "ON" : "OFF", InpUseCloudML ? "ON" : "OFF");
   dashboard += StringFormat("Recovery: %s | Weekend Prot: %s\n",
                recoveryModeActive ? "ACTIVE!" : "OFF", InpWeekendProtection ? "ON" : "OFF");
   dashboard += "============================================\n";
   
   if(dailyLimitReached) dashboard += "!! DAILY LOSS LIMIT REACHED !!\n";
   if(weeklyLimitReached) dashboard += "!! WEEKLY DRAWDOWN LIMIT !!\n";
   if(weeklyTargetReached) dashboard += ">> WEEKLY TARGET REACHED <<\n";
   if(TimeCurrent() < cooldownUntil) dashboard += "** COOLDOWN ACTIVE **\n";
   
   Comment(dashboard);
}
//+------------------------------------------------------------------+
