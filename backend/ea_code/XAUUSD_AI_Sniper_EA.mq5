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
input string   InpValidationURL     = "https://your-domain.com/api/pins/validate"; // Validation Server URL

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
input int      InpMaxTradesPerDay    = 3;       // Max trades per day
input double   InpMaxSpread          = 40.0;    // Max allowed spread (points)

//--- Profit Mode Presets
input group "=== PROFIT TARGET MODE ==="
input int      InpProfitMode         = 2;       // Profit Mode: 1=Conservative(20%), 2=Moderate(35%), 3=Aggressive(50%)

//--- Strategy Selection
input group "=== STRATEGY MODES ==="
input bool     InpEnableTrendMode    = true;    // Enable Trend Following Mode
input bool     InpEnableRangeMode    = true;    // Enable Range Trading Mode
input bool     InpEnableBreakoutMode = true;    // Enable Breakout Mode
input int      InpConfidenceThreshold= 75;      // Min confidence score (0-100)

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
input bool     InpTradeOnlyLondon    = true;    // Trade London Session
input bool     InpTradeOnlyNewYork   = true;    // Trade New York Session
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
input int      InpPatternMemorySize  = 500;     // Max patterns to remember
input double   InpLearningWeight     = 0.3;     // Learning influence on confidence (0-1)
input int      InpMinPatternsForML   = 20;      // Min patterns before ML kicks in

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

//+------------------------------------------------------------------+
//| PIN VALIDATION (OFFLINE HASH CHECK)                              |
//| Online validation requires WebRequest - use ValidateOnline()     |
//+------------------------------------------------------------------+
bool ValidatePINOffline(string pin)
{
   // Check format: ASE-XXXX-XXXX
   if(StringLen(pin) != 12) return false;
   if(StringSubstr(pin, 0, 3) != "ASE") return false;
   if(StringGetCharacter(pin, 3) != '-') return false;
   if(StringGetCharacter(pin, 8) != '-') return false;
   
   // Validate characters are alphanumeric
   for(int i = 4; i < 12; i++)
   {
      if(i == 8) continue; // Skip dash
      ushort ch = StringGetCharacter(pin, i);
      if(!((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z')))
         return false;
   }
   
   return true;
}

bool ValidatePINOnline(string pin)
{
   // Attempt online validation via WebRequest
   // NOTE: User must add the validation URL to MT5 allowed URLs
   // Tools > Options > Expert Advisors > Allow WebRequest for listed URLs
   
   if(StringLen(InpValidationURL) < 10) return ValidatePINOffline(pin);
   
   string headers = "Content-Type: application/json\r\n";
   string postData = "{\"pin\":\"" + pin + "\",\"mt5_account\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\"}";
   
   char post[];
   char result[];
   string resultHeaders;
   
   StringToCharArray(postData, post, 0, StringLen(postData));
   
   int timeout = 5000; // 5 seconds
   int res = WebRequest("POST", InpValidationURL, headers, timeout, post, result, resultHeaders);
   
   if(res == 200)
   {
      string response = CharArrayToString(result);
      // Check if response contains "valid": true
      if(StringFind(response, "\"valid\": true") >= 0 || StringFind(response, "\"valid\":true") >= 0)
         return true;
   }
   
   // Fallback to offline validation if server unreachable
   if(res == -1)
   {
      Print("WARNING: Could not reach license server. Using offline validation.");
      return ValidatePINOffline(pin);
   }
   
   return false;
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   // === LICENSE VALIDATION ===
   if(StringLen(InpLicensePIN) == 0)
   {
      Alert("LICENSE REQUIRED: Please enter your license PIN in the EA settings.");
      Print("ERROR: No license PIN provided. EA cannot start.");
      return(INIT_FAILED);
   }
   
   // Try online first, fallback to offline
   licenseValid = ValidatePINOnline(InpLicensePIN);
   
   if(!licenseValid)
   {
      Alert("INVALID LICENSE: The PIN you entered is not valid. Please check your PIN.");
      Print("ERROR: License validation failed for PIN: ", InpLicensePIN);
      return(INIT_FAILED);
   }
   
   Print("LICENSE VALIDATED: PIN accepted. EA authorized to trade.");
   
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
   trade.SetTypeFilling(ORDER_FILLING_IOC);
   
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
   
   if(!PassSafetyChecks()) return;
   
   static datetime lastBarTime = 0;
   datetime currentBarTime = iTime(Symbol(), PERIOD_M5, 0);
   if(currentBarTime == lastBarTime) return;
   lastBarTime = currentBarTime;
   
   if(!UpdateIndicators()) return;
   
   ManageOpenPositions();
   
   if(!CanOpenNewTrade()) return;
   
   currentMarketCondition = ClassifyMarket();
   activeStrategy = SelectStrategy(currentMarketCondition);
   if(activeStrategy == STRATEGY_NONE) return;
   
   int signal = 0;
   tradeConfidence = 0;
   
   switch(activeStrategy)
   {
      case STRATEGY_TREND:    signal = TrendStrategy();    break;
      case STRATEGY_RANGE:    signal = RangeStrategy();    break;
      case STRATEGY_BREAKOUT: signal = BreakoutStrategy(); break;
   }
   
   // Apply ML pattern boost/penalty
   if(InpEnableLearning && patternCount >= InpMinPatternsForML && signal != 0)
   {
      int mlAdjustment = GetMLConfidenceAdjustment();
      tradeConfidence += mlAdjustment;
      mlBoostApplied = mlAdjustment;
      tradeConfidence = MathMax(0, MathMin(100, tradeConfidence));
      
      // LOSS AVOIDANCE: Check if this hour/day historically loses
      if(IsHighLossTimeSlot())
      {
         tradeConfidence -= 20; // Heavy penalty for historically bad times
         if(tradeConfidence < InpConfidenceThreshold)
         {
            signal = 0; // Skip trade entirely
            Print("ML LOSS AVOIDANCE: Skipping trade - historically bad time slot");
         }
      }
      
      // STREAK AWARENESS: If on a winning streak, slightly tighten entry
      // If on a losing streak, require MUCH higher confidence
      if(consecutiveLosses >= 2)
      {
         tradeConfidence -= 10; // Require even higher confidence after losses
      }
   }
   
   // Dynamic threshold: after enough learning, require higher confidence for better win rate
   int effectiveThreshold = InpConfidenceThreshold;
   if(patternCount >= 50)
   {
      double recentWinRate = GetRecentWinRate(20);
      if(recentWinRate < 0.6) effectiveThreshold += 10; // Tighten if recent performance is poor
   }
   
   if(signal != 0 && tradeConfidence >= effectiveThreshold)
   {
      ExecuteTrade(signal);
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
   
   if(emaFast > emaSlow && emaDiff > 5 && h4Fast > h4Slow) return MARKET_TRENDING_UP;
   if(emaFast < emaSlow && emaDiff > 5 && h4Fast < h4Slow) return MARKET_TRENDING_DOWN;
   if(emaDiff < 3) return MARKET_RANGING;
   
   return MARKET_UNDEFINED;
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
   double open1   = iOpen(Symbol(), PERIOD_M5, 1);
   double emaFast = bufEMAFast[1];
   double emaSlow = bufEMASlow[1];
   double rsi     = bufRSI[1];
   double h1Fast  = bufEMAFast_H1[1];
   double h1Slow  = bufEMASlow_H1[1];
   double h1RSI   = bufRSI_H1[1];
   
   int confidence = 0;
   int signal = 0;
   
   if(emaFast > emaSlow && h1Fast > h1Slow)
   {
      bool nearEMA50 = close2 <= emaFast * 1.001 && close1 > emaFast;
      bool rsiBullish = rsi >= 45 && rsi <= 65;
      bool bullishCandle = close1 > open1 && (close1 - open1) > (bufATR[1] * 0.3);
      bool h1Confirm = h1RSI > 45 && h1RSI < 70;
      
      if(nearEMA50) confidence += 30;
      if(rsiBullish) confidence += 20;
      if(bullishCandle) confidence += 25;
      if(h1Confirm) confidence += 15;
      if(close1 > emaSlow) confidence += 10;
      
      if(nearEMA50 && rsiBullish && bullishCandle) signal = 1;
   }
   
   if(emaFast < emaSlow && h1Fast < h1Slow)
   {
      bool nearEMA50 = close2 >= emaFast * 0.999 && close1 < emaFast;
      bool rsiBearish = rsi >= 35 && rsi <= 55;
      bool bearishCandle = close1 < open1 && (open1 - close1) > (bufATR[1] * 0.3);
      bool h1Confirm = h1RSI < 55 && h1RSI > 30;
      
      confidence = 0;
      if(nearEMA50) confidence += 30;
      if(rsiBearish) confidence += 20;
      if(bearishCandle) confidence += 25;
      if(h1Confirm) confidence += 15;
      if(close1 < emaSlow) confidence += 10;
      
      if(nearEMA50 && rsiBearish && bearishCandle) signal = -1;
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
   double lowerZone = bbLower + bbRange * 0.15;
   double upperZone = bbUpper - bbRange * 0.15;
   
   if(close1 <= lowerZone)
   {
      bool bullishRejection = close1 > open1;
      bool rsiOversold = rsi < 35;
      
      if(bullishRejection) confidence += 30;
      if(rsiOversold) confidence += 30;
      if(close1 > bbLower) confidence += 20;
      if(bufRSI[2] < bufRSI[1]) confidence += 20;
      
      if(bullishRejection && rsiOversold) signal = 1;
   }
   
   if(close1 >= upperZone)
   {
      bool bearishRejection = close1 < open1;
      bool rsiOverbought = rsi > 65;
      
      if(bearishRejection) confidence += 30;
      if(rsiOverbought) confidence += 30;
      if(close1 < bbUpper) confidence += 20;
      if(bufRSI[2] > bufRSI[1]) confidence += 20;
      
      if(bearishRejection && rsiOverbought) signal = -1;
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
   bool wasSqueezing = bbWidth > prevBBWidth * 1.3;
   
   double bodySize = MathAbs(close1 - open1);
   bool strongBody = bodySize > atr * 0.5;
   
   if(close1 > bbUpper && close2 <= bufBBUpper[2])
   {
      if(wasSqueezing) confidence += 25;
      if(strongBody) confidence += 25;
      if(rsi > 55) confidence += 20;
      if(close1 > open1) confidence += 15;
      if(bufEMAFast_H1[1] > bufEMASlow_H1[1]) confidence += 15;
      
      if(strongBody && rsi > 55) signal = 1;
   }
   
   if(close1 < bbLower && close2 >= bufBBLower[2])
   {
      if(wasSqueezing) confidence += 25;
      if(strongBody) confidence += 25;
      if(rsi < 45) confidence += 20;
      if(close1 < open1) confidence += 15;
      if(bufEMAFast_H1[1] < bufEMASlow_H1[1]) confidence += 15;
      
      if(strongBody && rsi < 45) signal = -1;
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
   
   symInfo.Refresh();
   
   if(signal == 1)
   {
      price = symInfo.Ask();
      sl = price - atr * InpSLATRMultiplier;
      
      double swingLow = FindSwingLow(10);
      if(swingLow > 0 && swingLow < price)
      {
         double structureSL = swingLow - atr * 0.2;
         if(structureSL > sl) sl = structureSL;
      }
      
      double slDistance = price - sl;
      tp = price + slDistance * InpMinRRRatio;
      double maxTP = price + slDistance * InpMaxRRRatio;
      if(tp > maxTP) tp = maxTP;
      
      lotSize = CalculateLotSize(slDistance);
      if(lotSize <= 0) return;
      
      if(trade.Buy(lotSize, Symbol(), price, sl, tp,
         StringFormat("AI_Sniper|%s|Conf:%d|ML:%d", StrategyName(activeStrategy), tradeConfidence, mlBoostApplied)))
      {
         LogTrade("BUY", price, sl, tp, lotSize, tradeConfidence);
         todayTradeCount++;
         lastTradeTime = TimeCurrent();
      }
   }
   else if(signal == -1)
   {
      price = symInfo.Bid();
      sl = price + atr * InpSLATRMultiplier;
      
      double swingHigh = FindSwingHigh(10);
      if(swingHigh > 0 && swingHigh > price)
      {
         double structureSL = swingHigh + atr * 0.2;
         if(structureSL < sl) sl = structureSL;
      }
      
      double slDistance = sl - price;
      tp = price - slDistance * InpMinRRRatio;
      double maxTP = price - slDistance * InpMaxRRRatio;
      if(tp < maxTP) tp = maxTP;
      
      lotSize = CalculateLotSize(slDistance);
      if(lotSize <= 0) return;
      
      if(trade.Sell(lotSize, Symbol(), price, sl, tp,
         StringFormat("AI_Sniper|%s|Conf:%d|ML:%d", StrategyName(activeStrategy), tradeConfidence, mlBoostApplied)))
      {
         LogTrade("SELL", price, sl, tp, lotSize, tradeConfidence);
         todayTradeCount++;
         lastTradeTime = TimeCurrent();
      }
   }
}

//+------------------------------------------------------------------+
//| POSITION MANAGEMENT                                              |
//+------------------------------------------------------------------+
void ManageOpenPositions()
{
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
         double trailSL = currentPrice - atr * InpTrailingATRMulti;
         if(currentPrice > openPrice + atr && trailSL > currentSL)
            trade.PositionModify(ticket, trailSL, currentTP);
         
         double slDistance = openPrice - currentSL;
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
         double trailSL = currentPrice + atr * InpTrailingATRMulti;
         if(currentPrice < openPrice - atr && trailSL < currentSL)
            trade.PositionModify(ticket, trailSL, currentTP);
         
         double slDistance = currentSL - openPrice;
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
      Print("EQUITY PROTECTION TRIGGERED");
      return false;
   }
   
   if(dailyLimitReached) return false;
   double dailyPnL = currentEquity - dailyStartEquity;
   double dailyLossMax = dailyStartEquity * InpDailyLossLimit / 100.0;
   if(dailyPnL < -dailyLossMax)
   {
      dailyLimitReached = true;
      return false;
   }
   
   if(weeklyLimitReached) return false;
   double weeklyPnL = currentEquity - weeklyStartEquity;
   double weeklyLossMax = weeklyStartEquity * InpWeeklyDrawdownLimit / 100.0;
   if(weeklyPnL < -weeklyLossMax)
   {
      weeklyLimitReached = true;
      CloseAllPositions();
      return false;
   }
   
   if(weeklyTargetReached) return false;
   double weeklyTarget = weeklyStartEquity * effectiveWeeklyTarget / 100.0;
   if(weeklyPnL >= weeklyTarget)
   {
      weeklyTargetReached = true;
      return false;
   }
   
   if(TimeCurrent() < cooldownUntil) return false;
   
   double currentSpread = symInfo.Spread();
   if(currentSpread > InpMaxSpread) return false;
   
   if(!IsWithinTradingSession()) return false;
   
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
   dashboard += "     AI SNIPER EA v2.0 | XAUUSD | LICENSED\n";
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
   dashboard += "============================================\n";
   
   if(dailyLimitReached) dashboard += "!! DAILY LOSS LIMIT REACHED !!\n";
   if(weeklyLimitReached) dashboard += "!! WEEKLY DRAWDOWN LIMIT !!\n";
   if(weeklyTargetReached) dashboard += ">> WEEKLY TARGET REACHED <<\n";
   if(TimeCurrent() < cooldownUntil) dashboard += "** COOLDOWN ACTIVE **\n";
   
   Comment(dashboard);
}
//+------------------------------------------------------------------+
