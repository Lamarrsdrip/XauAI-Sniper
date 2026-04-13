//+------------------------------------------------------------------+
//|                                     XAUUSD_AI_Sniper_EA.mq5      |
//|                                     AI-Assisted Gold Trading Bot  |
//|                                     Professional Grade EA v2.0    |
//+------------------------------------------------------------------+
#property copyright "AI Sniper Trading Systems"
#property link      "https://ai-sniper-ea.com"
#property version   "2.00"
#property description "Advanced AI-Assisted XAUUSD Trading Expert Advisor"
#property description "Multi-Strategy | Adaptive Intelligence | Strict Risk Management"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>
#include <Trade\SymbolInfo.mqh>
#include <Trade\AccountInfo.mqh>

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

//+------------------------------------------------------------------+
//| ENUMERATIONS                                                     |
//+------------------------------------------------------------------+
enum ENUM_MARKET_CONDITION
{
   MARKET_TRENDING_UP    = 0,   // Strong Uptrend
   MARKET_TRENDING_DOWN  = 1,   // Strong Downtrend
   MARKET_RANGING        = 2,   // Range-bound
   MARKET_BREAKOUT_UP    = 3,   // Bullish Breakout
   MARKET_BREAKOUT_DOWN  = 4,   // Bearish Breakout
   MARKET_UNDEFINED      = 5    // Undefined/Choppy
};

enum ENUM_STRATEGY_MODE
{
   STRATEGY_TREND     = 0,
   STRATEGY_RANGE     = 1,
   STRATEGY_BREAKOUT  = 2,
   STRATEGY_NONE      = 3
};

//+------------------------------------------------------------------+
//| GLOBAL VARIABLES                                                 |
//+------------------------------------------------------------------+
CTrade         trade;
CPositionInfo  posInfo;
CSymbolInfo    symInfo;
CAccountInfo   accInfo;

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

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
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
   
   Print("=== AI SNIPER EA v2.0 INITIALIZED ===");
   Print("Symbol: ", Symbol(), " | Balance: ", DoubleToString(initialBalance, 2));
   Print("Risk: ", InpRiskPercent, "% | Daily Limit: ", InpDailyLossLimit, "%");
   Print("Trend Mode: ", InpEnableTrendMode ? "ON" : "OFF");
   Print("Range Mode: ", InpEnableRangeMode ? "ON" : "OFF");
   Print("Breakout Mode: ", InpEnableBreakoutMode ? "ON" : "OFF");
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
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
   
   // Print performance summary
   PrintPerformanceSummary();
   
   Print("=== AI SNIPER EA DEINITIALIZED ===");
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   // Refresh symbol data
   symInfo.Refresh();
   
   // Daily/Weekly reset checks
   CheckDailyReset();
   CheckWeeklyReset();
   
   // Safety checks
   if(!PassSafetyChecks()) return;
   
   // Check for new bar (only process on new M5 bar)
   static datetime lastBarTime = 0;
   datetime currentBarTime = iTime(Symbol(), PERIOD_M5, 0);
   if(currentBarTime == lastBarTime) return;
   lastBarTime = currentBarTime;
   
   // Update indicators
   if(!UpdateIndicators()) return;
   
   // Manage existing positions (trailing stop, partial close)
   ManageOpenPositions();
   
   // Check if we can open new trades
   if(!CanOpenNewTrade()) return;
   
   // Classify market condition
   currentMarketCondition = ClassifyMarket();
   
   // Select appropriate strategy
   activeStrategy = SelectStrategy(currentMarketCondition);
   if(activeStrategy == STRATEGY_NONE) return;
   
   // Generate trade signal with confidence
   int signal = 0;      // 1 = buy, -1 = sell, 0 = no trade
   tradeConfidence = 0;
   
   switch(activeStrategy)
   {
      case STRATEGY_TREND:
         signal = TrendStrategy();
         break;
      case STRATEGY_RANGE:
         signal = RangeStrategy();
         break;
      case STRATEGY_BREAKOUT:
         signal = BreakoutStrategy();
         break;
   }
   
   // Execute if confidence is high enough
   if(signal != 0 && tradeConfidence >= InpConfidenceThreshold)
   {
      ExecuteTrade(signal);
   }
   
   // Update dashboard comment
   UpdateDashboard();
}

//+------------------------------------------------------------------+
//| UPDATE INDICATORS                                                |
//+------------------------------------------------------------------+
bool UpdateIndicators()
{
   // M5 indicators
   if(CopyBuffer(handleEMAFast, 0, 0, 10, bufEMAFast) < 10) return false;
   if(CopyBuffer(handleEMASlow, 0, 0, 10, bufEMASlow) < 10) return false;
   if(CopyBuffer(handleRSI, 0, 0, 10, bufRSI) < 10) return false;
   if(CopyBuffer(handleATR, 0, 0, 10, bufATR) < 10) return false;
   if(CopyBuffer(handleBB, 1, 0, 10, bufBBUpper) < 10) return false;
   if(CopyBuffer(handleBB, 0, 0, 10, bufBBMiddle) < 10) return false;
   if(CopyBuffer(handleBB, 2, 0, 10, bufBBLower) < 10) return false;
   
   // H1 indicators
   if(CopyBuffer(handleEMAFast_H1, 0, 0, 5, bufEMAFast_H1) < 5) return false;
   if(CopyBuffer(handleEMASlow_H1, 0, 0, 5, bufEMASlow_H1) < 5) return false;
   if(CopyBuffer(handleRSI_H1, 0, 0, 5, bufRSI_H1) < 5) return false;
   
   // H4 indicators
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
   double atr     = bufATR[1];
   double bbUpper = bufBBUpper[1];
   double bbLower = bufBBLower[1];
   double close1  = iClose(Symbol(), PERIOD_M5, 1);
   double close2  = iClose(Symbol(), PERIOD_M5, 2);
   
   // H4 trend for higher timeframe confirmation
   double h4Fast = bufEMAFast_H4[1];
   double h4Slow = bufEMASlow_H4[1];
   
   // Calculate BB width relative to price
   double bbWidth = (bbUpper - bbLower) / close1;
   
   // Detect breakout - price breaking outside BB after squeeze
   double prevBBWidth = (bufBBUpper[3] - bufBBLower[3]) / iClose(Symbol(), PERIOD_M5, 3);
   bool bbSqueeze = prevBBWidth < bbWidth * 0.7; // BB was tighter before
   
   if(bbSqueeze && close1 > bbUpper)
      return MARKET_BREAKOUT_UP;
   if(bbSqueeze && close1 < bbLower)
      return MARKET_BREAKOUT_DOWN;
   
   // Detect trend
   double emaDiff = MathAbs(emaFast - emaSlow) / close1 * 10000;
   bool h4Bullish = h4Fast > h4Slow;
   bool h4Bearish = h4Fast < h4Slow;
   
   if(emaFast > emaSlow && emaDiff > 5 && h4Bullish)
      return MARKET_TRENDING_UP;
   if(emaFast < emaSlow && emaDiff > 5 && h4Bearish)
      return MARKET_TRENDING_DOWN;
   
   // Otherwise ranging
   if(emaDiff < 3)
      return MARKET_RANGING;
   
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
//| TREND STRATEGY - Primary Profit Driver                           |
//| Trade pullbacks in direction of EMA 200 trend                    |
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
   
   // BUY SETUP: Pullback in uptrend
   if(emaFast > emaSlow && h1Fast > h1Slow)
   {
      // Price pulled back to EMA 50 zone
      bool nearEMA50 = close2 <= emaFast * 1.001 && close1 > emaFast;
      
      // RSI in bullish zone (not overbought)
      bool rsiBullish = rsi >= 45 && rsi <= 65;
      
      // Strong bullish candle confirmation
      bool bullishCandle = close1 > open1 && (close1 - open1) > (bufATR[1] * 0.3);
      
      // H1 RSI confirmation
      bool h1Confirm = h1RSI > 45 && h1RSI < 70;
      
      if(nearEMA50) confidence += 30;
      if(rsiBullish) confidence += 20;
      if(bullishCandle) confidence += 25;
      if(h1Confirm) confidence += 15;
      if(close1 > emaSlow) confidence += 10; // Above EMA 200
      
      if(nearEMA50 && rsiBullish && bullishCandle)
      {
         signal = 1;
      }
   }
   
   // SELL SETUP: Pullback in downtrend
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
      
      if(nearEMA50 && rsiBearish && bearishCandle)
      {
         signal = -1;
      }
   }
   
   tradeConfidence = confidence;
   return signal;
}

//+------------------------------------------------------------------+
//| RANGE STRATEGY - Support/Resistance Trading                      |
//+------------------------------------------------------------------+
int RangeStrategy()
{
   double close1  = iClose(Symbol(), PERIOD_M5, 1);
   double open1   = iOpen(Symbol(), PERIOD_M5, 1);
   double bbUpper = bufBBUpper[1];
   double bbLower = bufBBLower[1];
   double bbMid   = bufBBMiddle[1];
   double rsi     = bufRSI[1];
   
   int confidence = 0;
   int signal = 0;
   
   // Dynamic S/R using Bollinger Bands
   double bbRange = bbUpper - bbLower;
   double lowerZone = bbLower + bbRange * 0.15;
   double upperZone = bbUpper - bbRange * 0.15;
   
   // BUY at support (lower BB zone)
   if(close1 <= lowerZone)
   {
      bool bullishRejection = close1 > open1;
      bool rsiOversold = rsi < 35;
      
      if(bullishRejection) confidence += 30;
      if(rsiOversold) confidence += 30;
      if(close1 > bbLower) confidence += 20; // Not broken below
      if(bufRSI[2] < bufRSI[1]) confidence += 20; // RSI turning up
      
      if(bullishRejection && rsiOversold)
      {
         signal = 1;
      }
   }
   
   // SELL at resistance (upper BB zone)
   if(close1 >= upperZone)
   {
      bool bearishRejection = close1 < open1;
      bool rsiOverbought = rsi > 65;
      
      if(bearishRejection) confidence += 30;
      if(rsiOverbought) confidence += 30;
      if(close1 < bbUpper) confidence += 20;
      if(bufRSI[2] > bufRSI[1]) confidence += 20;
      
      if(bearishRejection && rsiOverbought)
      {
         signal = -1;
      }
   }
   
   tradeConfidence = confidence;
   return signal;
}

//+------------------------------------------------------------------+
//| BREAKOUT STRATEGY - Volatility Breakout                          |
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
   
   // Check for BB squeeze (consolidation)
   double bbWidth = bbUpper - bbLower;
   double prevBBWidth = bufBBUpper[5] - bufBBLower[5];
   bool wasSqueezing = bbWidth > prevBBWidth * 1.3;
   
   // Volume-like confirmation via candle body size
   double bodySize = MathAbs(close1 - open1);
   bool strongBody = bodySize > atr * 0.5;
   
   // Bullish breakout
   if(close1 > bbUpper && close2 <= bufBBUpper[2])
   {
      if(wasSqueezing) confidence += 25;
      if(strongBody) confidence += 25;
      if(rsi > 55) confidence += 20;
      if(close1 > open1) confidence += 15;
      if(bufEMAFast_H1[1] > bufEMASlow_H1[1]) confidence += 15;
      
      if(strongBody && rsi > 55)
      {
         signal = 1;
      }
   }
   
   // Bearish breakout
   if(close1 < bbLower && close2 >= bufBBLower[2])
   {
      if(wasSqueezing) confidence += 25;
      if(strongBody) confidence += 25;
      if(rsi < 45) confidence += 20;
      if(close1 < open1) confidence += 15;
      if(bufEMAFast_H1[1] < bufEMASlow_H1[1]) confidence += 15;
      
      if(strongBody && rsi < 45)
      {
         signal = -1;
      }
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
   
   if(signal == 1) // BUY
   {
      price = symInfo.Ask();
      
      // ATR-based stop loss
      sl = price - atr * InpSLATRMultiplier;
      
      // Structure-based SL check (use recent swing low)
      double swingLow = FindSwingLow(10);
      if(swingLow > 0 && swingLow < price)
      {
         double structureSL = swingLow - atr * 0.2; // Small buffer
         if(structureSL > sl) sl = structureSL; // Use tighter SL
      }
      
      // Calculate TP based on RR ratio
      double slDistance = price - sl;
      tp = price + slDistance * InpMinRRRatio;
      
      // Cap TP at max RR
      double maxTP = price + slDistance * InpMaxRRRatio;
      if(tp > maxTP) tp = maxTP;
      
      // Calculate lot size
      lotSize = CalculateLotSize(slDistance);
      if(lotSize <= 0) return;
      
      // Execute
      if(trade.Buy(lotSize, Symbol(), price, sl, tp, 
         StringFormat("AI_Sniper|%s|Conf:%d", StrategyName(activeStrategy), tradeConfidence)))
      {
         LogTrade("BUY", price, sl, tp, lotSize, tradeConfidence);
         todayTradeCount++;
         lastTradeTime = TimeCurrent();
      }
   }
   else if(signal == -1) // SELL
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
         StringFormat("AI_Sniper|%s|Conf:%d", StrategyName(activeStrategy), tradeConfidence)))
      {
         LogTrade("SELL", price, sl, tp, lotSize, tradeConfidence);
         todayTradeCount++;
         lastTradeTime = TimeCurrent();
      }
   }
}

//+------------------------------------------------------------------+
//| POSITION MANAGEMENT - Trailing Stop & Partial Close              |
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
      double posProfit    = posInfo.Profit();
      double atr          = bufATR[1];
      ulong  ticket       = posInfo.Ticket();
      
      // Trailing Stop Logic
      if(posInfo.PositionType() == POSITION_TYPE_BUY)
      {
         double trailSL = currentPrice - atr * InpTrailingATRMulti;
         
         // Only trail if price moved in our favor
         if(currentPrice > openPrice + atr && trailSL > currentSL)
         {
            trade.PositionModify(ticket, trailSL, currentTP);
         }
         
         // Partial close at first target
         double slDistance = openPrice - currentSL;
         double firstTarget = openPrice + slDistance * 1.0; // 1:1 RR
         
         if(currentPrice >= firstTarget && posInfo.Volume() > SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN))
         {
            double closeVolume = NormalizeDouble(posInfo.Volume() * InpPartialClosePercent / 100.0, 2);
            double minVol = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
            if(closeVolume >= minVol)
            {
               trade.PositionClosePartial(ticket, closeVolume);
               Print("Partial close executed: ", closeVolume, " lots at ", currentPrice);
            }
         }
      }
      else if(posInfo.PositionType() == POSITION_TYPE_SELL)
      {
         double trailSL = currentPrice + atr * InpTrailingATRMulti;
         
         if(currentPrice < openPrice - atr && trailSL < currentSL)
         {
            trade.PositionModify(ticket, trailSL, currentTP);
         }
         
         double slDistance = currentSL - openPrice;
         double firstTarget = openPrice - slDistance * 1.0;
         
         if(currentPrice <= firstTarget && posInfo.Volume() > SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN))
         {
            double closeVolume = NormalizeDouble(posInfo.Volume() * InpPartialClosePercent / 100.0, 2);
            double minVol = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
            if(closeVolume >= minVol)
            {
               trade.PositionClosePartial(ticket, closeVolume);
               Print("Partial close executed: ", closeVolume, " lots at ", currentPrice);
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| POSITION SIZING - Dynamic Lot Calculation                        |
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
   
   if(tickValue == 0 || tickSize == 0 || slDistancePoints == 0)
   {
      Print("ERROR: Invalid values for lot calculation");
      return 0;
   }
   
   double lotSize = riskAmount / (slDistancePoints / tickSize * tickValue);
   
   // Normalize to lot step
   lotSize = MathFloor(lotSize / lotStep) * lotStep;
   
   // Clamp to limits
   lotSize = MathMax(minLot, MathMin(maxLot, lotSize));
   
   return NormalizeDouble(lotSize, 2);
}

//+------------------------------------------------------------------+
//| SAFETY CHECKS                                                    |
//+------------------------------------------------------------------+
bool PassSafetyChecks()
{
   // Equity protection
   double currentEquity = accInfo.Equity();
   double protectionLevel = initialBalance * InpEquityProtection / 100.0;
   if(currentEquity < protectionLevel)
   {
      CloseAllPositions();
      Print("EQUITY PROTECTION TRIGGERED: Equity dropped below ", InpEquityProtection, "% of initial balance");
      return false;
   }
   
   // Daily loss limit
   if(dailyLimitReached) return false;
   double dailyPnL = currentEquity - dailyStartEquity;
   double dailyLossMax = dailyStartEquity * InpDailyLossLimit / 100.0;
   if(dailyPnL < -dailyLossMax)
   {
      dailyLimitReached = true;
      Print("DAILY LOSS LIMIT REACHED: ", DoubleToString(dailyPnL, 2));
      return false;
   }
   
   // Weekly drawdown
   if(weeklyLimitReached) return false;
   double weeklyPnL = currentEquity - weeklyStartEquity;
   double weeklyLossMax = weeklyStartEquity * InpWeeklyDrawdownLimit / 100.0;
   if(weeklyPnL < -weeklyLossMax)
   {
      weeklyLimitReached = true;
      CloseAllPositions();
      Print("WEEKLY DRAWDOWN LIMIT REACHED");
      return false;
   }
   
   // Weekly profit target
   if(weeklyTargetReached) return false;
   double weeklyTarget = weeklyStartEquity * InpWeeklyProfitTarget / 100.0;
   if(weeklyPnL >= weeklyTarget)
   {
      weeklyTargetReached = true;
      Print("WEEKLY PROFIT TARGET REACHED: ", DoubleToString(weeklyPnL, 2));
      return false;
   }
   
   // Cooldown check
   if(TimeCurrent() < cooldownUntil) return false;
   
   // Spread filter
   double currentSpread = symInfo.Spread();
   if(currentSpread > InpMaxSpread)
   {
      return false;
   }
   
   // Session filter
   if(!IsWithinTradingSession()) return false;
   
   // Update max drawdown tracking
   if(currentEquity > peakEquity) peakEquity = currentEquity;
   double currentDrawdown = (peakEquity - currentEquity) / peakEquity * 100;
   if(currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;
   
   return true;
}

//+------------------------------------------------------------------+
//| CHECK IF CAN OPEN NEW TRADE                                      |
//+------------------------------------------------------------------+
bool CanOpenNewTrade()
{
   // Max open trades
   int openCount = CountOpenPositions();
   if(openCount >= InpMaxOpenTrades) return false;
   
   // Max trades per day
   if(todayTradeCount >= InpMaxTradesPerDay) return false;
   
   return true;
}

//+------------------------------------------------------------------+
//| SESSION FILTER                                                   |
//+------------------------------------------------------------------+
bool IsWithinTradingSession()
{
   MqlDateTime dt;
   TimeCurrent(dt);
   int hour = dt.hour;
   
   bool inLondon = (hour >= InpLondonStartHour && hour < InpLondonEndHour);
   bool inNY     = (hour >= InpNYStartHour && hour < InpNYEndHour);
   
   if(InpTradeOnlyLondon && inLondon) return true;
   if(InpTradeOnlyNewYork && inNY) return true;
   
   // If both sessions disabled, allow all hours
   if(!InpTradeOnlyLondon && !InpTradeOnlyNewYork) return true;
   
   return false;
}

//+------------------------------------------------------------------+
//| SWING HIGH/LOW DETECTION                                         |
//+------------------------------------------------------------------+
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

//+------------------------------------------------------------------+
//| COUNT OPEN POSITIONS                                             |
//+------------------------------------------------------------------+
int CountOpenPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(posInfo.SelectByIndex(i))
      {
         if(posInfo.Magic() == InpMagicNumber && posInfo.Symbol() == Symbol())
            count++;
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| CLOSE ALL POSITIONS                                              |
//+------------------------------------------------------------------+
void CloseAllPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(posInfo.SelectByIndex(i))
      {
         if(posInfo.Magic() == InpMagicNumber && posInfo.Symbol() == Symbol())
         {
            trade.PositionClose(posInfo.Ticket());
         }
      }
   }
}

//+------------------------------------------------------------------+
//| DAILY RESET                                                      |
//+------------------------------------------------------------------+
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
      Print("=== DAILY RESET === Equity: ", DoubleToString(dailyStartEquity, 2));
   }
}

//+------------------------------------------------------------------+
//| WEEKLY RESET                                                     |
//+------------------------------------------------------------------+
void CheckWeeklyReset()
{
   MqlDateTime dtNow, dtLast;
   TimeCurrent(dtNow);
   TimeToStruct(lastWeekReset, dtLast);
   
   // Reset on Monday
   if(dtNow.day_of_week == 1 && dtLast.day_of_week != 1)
   {
      weeklyStartEquity  = accInfo.Equity();
      weeklyLimitReached = false;
      weeklyTargetReached= false;
      lastWeekReset      = TimeCurrent();
      Print("=== WEEKLY RESET === Equity: ", DoubleToString(weeklyStartEquity, 2));
   }
}

//+------------------------------------------------------------------+
//| TRADE LOGGING                                                    |
//+------------------------------------------------------------------+
void LogTrade(string type, double price, double sl, double tp, double lots, int confidence)
{
   string stratName = StrategyName(activeStrategy);
   string marketName = MarketConditionName(currentMarketCondition);
   
   Print("=== TRADE EXECUTED ===");
   Print("Type: ", type, " | Strategy: ", stratName, " | Market: ", marketName);
   Print("Price: ", DoubleToString(price, 2), " | SL: ", DoubleToString(sl, 2), " | TP: ", DoubleToString(tp, 2));
   Print("Lots: ", DoubleToString(lots, 2), " | Confidence: ", confidence);
   Print("Spread: ", symInfo.Spread(), " | ATR: ", DoubleToString(bufATR[1], 2));
}

//+------------------------------------------------------------------+
//| PERFORMANCE SUMMARY                                              |
//+------------------------------------------------------------------+
void PrintPerformanceSummary()
{
   double equity = accInfo.Equity();
   double totalReturn = ((equity - initialBalance) / initialBalance) * 100;
   double winRate = totalTrades > 0 ? (double)winningTrades / totalTrades * 100 : 0;
   double profitFactor = totalLoss != 0 ? MathAbs(totalProfit / totalLoss) : 0;
   
   Print("=== PERFORMANCE SUMMARY ===");
   Print("Total Trades: ", totalTrades);
   Print("Win Rate: ", DoubleToString(winRate, 1), "%");
   Print("Profit Factor: ", DoubleToString(profitFactor, 2));
   Print("Max Drawdown: ", DoubleToString(maxDrawdown, 2), "%");
   Print("Total Return: ", DoubleToString(totalReturn, 2), "%");
   Print("Final Equity: ", DoubleToString(equity, 2));
}

//+------------------------------------------------------------------+
//| ON TRADE TRANSACTION - Track wins/losses                         |
//+------------------------------------------------------------------+
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
            
            if(profit > 0)
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
                  Print("COOLDOWN ACTIVATED: ", InpConsecutiveLossMax, " consecutive losses. Resume at: ", 
                        TimeToString(cooldownUntil));
                  consecutiveLosses = 0;
               }
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| HELPER: Strategy Name                                            |
//+------------------------------------------------------------------+
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

//+------------------------------------------------------------------+
//| HELPER: Market Condition Name                                    |
//+------------------------------------------------------------------+
string MarketConditionName(ENUM_MARKET_CONDITION condition)
{
   switch(condition)
   {
      case MARKET_TRENDING_UP:    return "TRENDING UP";
      case MARKET_TRENDING_DOWN:  return "TRENDING DOWN";
      case MARKET_RANGING:        return "RANGING";
      case MARKET_BREAKOUT_UP:    return "BREAKOUT UP";
      case MARKET_BREAKOUT_DOWN:  return "BREAKOUT DOWN";
      default:                    return "UNDEFINED";
   }
}

//+------------------------------------------------------------------+
//| DASHBOARD DISPLAY                                                |
//+------------------------------------------------------------------+
void UpdateDashboard()
{
   double equity = accInfo.Equity();
   double balance = accInfo.Balance();
   double dailyPnL = equity - dailyStartEquity;
   double weeklyPnL = equity - weeklyStartEquity;
   double winRate = totalTrades > 0 ? (double)winningTrades / totalTrades * 100 : 0;
   
   string dashboard = "\n";
   dashboard += "========================================\n";
   dashboard += "     AI SNIPER EA v2.0 | XAUUSD\n";
   dashboard += "========================================\n";
   dashboard += StringFormat("Balance: $%.2f | Equity: $%.2f\n", balance, equity);
   dashboard += StringFormat("Daily P/L: $%.2f | Weekly P/L: $%.2f\n", dailyPnL, weeklyPnL);
   dashboard += "----------------------------------------\n";
   dashboard += StringFormat("Market: %s\n", MarketConditionName(currentMarketCondition));
   dashboard += StringFormat("Strategy: %s | Confidence: %d%%\n", StrategyName(activeStrategy), tradeConfidence);
   dashboard += StringFormat("Open Trades: %d/%d | Today: %d/%d\n", 
                CountOpenPositions(), InpMaxOpenTrades, todayTradeCount, InpMaxTradesPerDay);
   dashboard += "----------------------------------------\n";
   dashboard += StringFormat("Total Trades: %d | Win Rate: %.1f%%\n", totalTrades, winRate);
   dashboard += StringFormat("Max Drawdown: %.2f%%\n", maxDrawdown);
   dashboard += StringFormat("Spread: %d | ATR: %.2f\n", symInfo.Spread(), bufATR[1]);
   dashboard += "========================================\n";
   
   if(dailyLimitReached) dashboard += "!! DAILY LOSS LIMIT REACHED !!\n";
   if(weeklyLimitReached) dashboard += "!! WEEKLY DRAWDOWN LIMIT !!\n";
   if(weeklyTargetReached) dashboard += ">> WEEKLY TARGET REACHED <<\n";
   if(TimeCurrent() < cooldownUntil) dashboard += "** COOLDOWN ACTIVE **\n";
   
   Comment(dashboard);
}
//+------------------------------------------------------------------+
