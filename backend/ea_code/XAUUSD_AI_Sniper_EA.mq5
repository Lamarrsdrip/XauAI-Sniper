//+------------------------------------------------------------------+
//|                                     XAUUSD_AI_Sniper_EA.mq5      |
//|                                     AI-Assisted Gold Trading Bot  |
//|                                     v3.1 - Smart & Reliable       |
//+------------------------------------------------------------------+
#property copyright "AI Sniper Trading Systems"
#property link      "https://ai-sniper-ea.com"
#property version   "3.10"
#property description "XAUUSD AI Sniper EA - Smart Core with ML"
#property description "Trend + Range | H1 Filter | Pattern Learning"
#property description "LICENSE REQUIRED: Enter your PIN to activate"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>

//+------------------------------------------------------------------+
//| LICENSE                                                          |
//+------------------------------------------------------------------+
input group "=== LICENSE ==="
input string InpLicensePIN     = "";

//+------------------------------------------------------------------+
//| RISK MANAGEMENT                                                  |
//+------------------------------------------------------------------+
input group "=== RISK ==="
input double InpRiskPercent    = 1.0;      // Risk per trade (%)
input double InpMaxLots        = 10.0;     // HARD max lots per trade (safety cap)
input double InpDailyLossLimit = 3.0;      // Max daily loss (%) - CLOSES ALL TRADES
input int    InpMaxOpenTrades  = 3;        // Max open trades
input int    InpMaxTradesPerDay= 15;       // Max trades per day
input double InpWeeklyTarget   = 35.0;     // Weekly profit target (%) - stops when hit
input double InpWeeklyMaxLoss  = 10.0;     // Weekly max loss (%) - stops when hit
input bool   InpCarefulMode    = true;     // Careful mode: reduce risk as profit grows

//+------------------------------------------------------------------+
//| STRATEGY                                                         |
//+------------------------------------------------------------------+
input group "=== STRATEGY ==="
input int    InpEMAFast        = 50;       // Fast EMA (M5) - was 21, less whipsaw
input int    InpEMASlow        = 200;      // Slow EMA (M5) - was 50, stronger trend
input int    InpRSIPeriod      = 14;       // RSI Period
input int    InpATRPeriod      = 14;       // ATR Period
input double InpSLMultiplier   = 0.8;      // SL = ATR x this (tight stop)
input double InpTPMultiplier   = 1.3;      // TP = SL x this (TP bigger than SL)
input bool   InpUseH1Filter    = true;     // Use H1 trend filter
input int    InpCooldownMins   = 10;       // Minutes to wait after a loss before next trade
input double InpMinEMASep      = 0.05;     // Min EMA separation (%) - avoids choppy zones

//+------------------------------------------------------------------+
//| SMART FEATURES                                                   |
//+------------------------------------------------------------------+
input group "=== SMART ==="
input bool   InpBreakEven      = true;     // Move SL to break-even at +1 ATR
input bool   InpTrailingStop   = true;     // Trail stop in profit
input bool   InpLearnPatterns  = true;     // Learn from trade outcomes (local ML)
input int    InpMaxPatterns    = 500;      // Max patterns to remember
input bool   InpUseAI          = true;     // Use GPT-5.2 AI analysis before trades
input bool   InpUseNewsFilter  = true;     // Avoid trading during high-impact news
input string InpServerURL      = "https://xauaisniper.com";  // Server URL for AI & News

//+------------------------------------------------------------------+
//| SAFETY                                                           |
//+------------------------------------------------------------------+
input group "=== SAFETY ==="
input double InpMaxSpread      = 150.0;    // Max spread (points)
input double InpEquityProtect  = 70.0;     // Equity protection (%)
input bool   InpWeekendClose   = true;     // Close before weekend
input int    InpFridayHour     = 20;       // Friday close hour
input int    InpMagicNumber    = 20250301; // Magic Number

//+------------------------------------------------------------------+
//| ML PATTERN STRUCTURE                                             |
//+------------------------------------------------------------------+
struct TradePattern
{
   int    direction;       // 1=buy, -1=sell
   double emaDiff;         // ema fast - slow normalized
   double rsi;             // rsi at entry
   double atr;             // atr at entry
   int    hour;            // hour of day
   int    dayOfWeek;       // day of week
   bool   wasWinner;       // outcome
   double profit;          // profit in $
};

//+------------------------------------------------------------------+
//| GLOBALS                                                          |
//+------------------------------------------------------------------+
CTrade        trade;
CPositionInfo posInfo;
CAccountInfo  accInfo;

bool   licenseValid = false;
int    hEMAFast, hEMASlow, hRSI, hATR;
int    hEMAFast_H1, hEMASlow_H1;
double bufEMAFast[], bufEMASlow[], bufRSI[], bufATR[];
double bufEMAFast_H1[], bufEMASlow_H1[];
double initialBalance, dailyStartEquity, weeklyStartEquity;
int    todayTradeCount;
datetime lastDayReset, lastWeekReset;
bool   dailyLimitHit, weeklyTargetHit, weeklyLossHit;
int    totalTrades, wins, losses;
datetime lastTradeClose;
int    lastTradeDir;  // prevents immediate reversal

// ML
TradePattern patterns[];
int    patternCount;
int    lastSignalDir;
double lastSignalRSI, lastSignalEMADiff, lastSignalATR;

//+------------------------------------------------------------------+
//| PIN VALIDATION                                                   |
//+------------------------------------------------------------------+
bool ValidatePIN(string pin)
{
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

//+------------------------------------------------------------------+
//| INIT                                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpLicensePIN) == 0)
   {
      Alert("Enter your license PIN in Inputs tab.");
      return INIT_FAILED;
   }
   licenseValid = ValidatePIN(InpLicensePIN);
   if(!licenseValid)
   {
      Alert("Invalid PIN: " + InpLicensePIN + " | Format: ASE-XXXX-XXXX");
      return INIT_FAILED;
   }
   Print("LICENSE OK: ", InpLicensePIN);

   if(StringFind(Symbol(), "XAU") < 0 && StringFind(Symbol(), "GOLD") < 0)
      Print("WARNING: EA optimized for XAUUSD. Current: ", Symbol());

   // Trade setup
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(50);

   // Auto-detect fill mode
   long fm = SymbolInfoInteger(Symbol(), SYMBOL_FILLING_MODE);
   if((fm & SYMBOL_FILLING_FOK) != 0)      trade.SetTypeFilling(ORDER_FILLING_FOK);
   else if((fm & SYMBOL_FILLING_IOC) != 0)  trade.SetTypeFilling(ORDER_FILLING_IOC);
   else                                      trade.SetTypeFilling(ORDER_FILLING_RETURN);
   Print("FILL MODE: ", (fm & SYMBOL_FILLING_FOK) != 0 ? "FOK" : (fm & SYMBOL_FILLING_IOC) != 0 ? "IOC" : "RETURN");

   // M5 indicators
   hEMAFast = iMA(Symbol(), PERIOD_M5, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow = iMA(Symbol(), PERIOD_M5, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   hRSI     = iRSI(Symbol(), PERIOD_M5, InpRSIPeriod, PRICE_CLOSE);
   hATR     = iATR(Symbol(), PERIOD_M5, InpATRPeriod);

   // H1 indicators for smart filter
   hEMAFast_H1 = iMA(Symbol(), PERIOD_H1, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow_H1 = iMA(Symbol(), PERIOD_H1, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);

   if(hEMAFast == INVALID_HANDLE || hEMASlow == INVALID_HANDLE ||
      hRSI == INVALID_HANDLE || hATR == INVALID_HANDLE ||
      hEMAFast_H1 == INVALID_HANDLE || hEMASlow_H1 == INVALID_HANDLE)
   {
      Print("ERROR: Failed to create indicators");
      return INIT_FAILED;
   }

   ArraySetAsSeries(bufEMAFast, true);
   ArraySetAsSeries(bufEMASlow, true);
   ArraySetAsSeries(bufRSI, true);
   ArraySetAsSeries(bufATR, true);
   ArraySetAsSeries(bufEMAFast_H1, true);
   ArraySetAsSeries(bufEMASlow_H1, true);

   // State
   initialBalance   = accInfo.Balance();
   dailyStartEquity = accInfo.Equity();
   weeklyStartEquity= accInfo.Equity();
   todayTradeCount  = 0;
   lastDayReset     = TimeCurrent();
   lastWeekReset    = TimeCurrent();
   dailyLimitHit    = false;
   weeklyTargetHit  = false;
   weeklyLossHit    = false;
   totalTrades = 0; wins = 0; losses = 0;
   lastTradeClose = 0;
   lastTradeDir = 0;

   // ML
   ArrayResize(patterns, 0);
   patternCount = 0;
   lastSignalDir = 0;
   LoadPatterns();

   Print("=== AI SNIPER v3.1 READY ===");
   Print("Balance: $", DoubleToString(initialBalance, 2),
         " | Risk: ", InpRiskPercent, "%",
         " | SL: ", InpSLMultiplier, "xATR",
         " | TP: ", InpTPMultiplier, "xSL");
   Print("Weekly Target: +", InpWeeklyTarget, "% | Weekly Max Loss: -", InpWeeklyMaxLoss, "%",
         " | Careful: ", InpCarefulMode ? "ON" : "OFF",
         " | H1 Filter: ", InpUseH1Filter ? "ON" : "OFF",
         " | ML: ", InpLearnPatterns ? "ON" : "OFF");
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| DEINIT                                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   IndicatorRelease(hEMAFast);
   IndicatorRelease(hEMASlow);
   IndicatorRelease(hRSI);
   IndicatorRelease(hATR);
   IndicatorRelease(hEMAFast_H1);
   IndicatorRelease(hEMASlow_H1);
   SavePatterns();
   double wr = totalTrades > 0 ? (double)wins / totalTrades * 100 : 0;
   Print("=== EA STOPPED | Trades: ", totalTrades, " | Win Rate: ", DoubleToString(wr, 1), "% | Patterns: ", patternCount, " ===");
}

//+------------------------------------------------------------------+
//| TICK                                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!licenseValid) return;

   // Daily reset
   MqlDateTime dtNow, dtLast, dtWeek;
   TimeCurrent(dtNow);
   TimeToStruct(lastDayReset, dtLast);
   if(dtNow.day != dtLast.day)
   {
      dailyStartEquity = accInfo.Equity();
      todayTradeCount  = 0;
      dailyLimitHit    = false;
      lastDayReset     = TimeCurrent();
      Print("NEW DAY: Equity reset to $", DoubleToString(dailyStartEquity, 2));
   }

   // Weekly reset (Monday)
   TimeToStruct(lastWeekReset, dtWeek);
   if(dtNow.day_of_week == 1 && dtWeek.day_of_week != 1)
   {
      weeklyStartEquity = accInfo.Equity();
      weeklyTargetHit   = false;
      weeklyLossHit     = false;
      lastWeekReset     = TimeCurrent();
      Print("NEW WEEK: Equity reset to $", DoubleToString(weeklyStartEquity, 2), " | Target: +", InpWeeklyTarget, "%");
   }

   // Weekend protection
   if(InpWeekendClose && dtNow.day_of_week == 5 && dtNow.hour >= InpFridayHour)
   {
      if(CountMyPositions() > 0) { CloseAll(); Print("WEEKEND: All closed"); }
      return;
   }

   // === EQUITY PROTECTION: CLOSE EVERYTHING ===
   double equity = accInfo.Equity();
   if(equity < initialBalance * InpEquityProtect / 100.0)
   {
      CloseAll();
      Print("EQUITY PROTECT: CLOSED ALL. Equity=$", DoubleToString(equity, 2));
      return;
   }

   // === WEEKLY PROFIT TARGET: STOP TRADING FOR THE WEEK ===
   double weeklyPnL = equity - weeklyStartEquity;
   double weeklyTargetAmt = weeklyStartEquity * InpWeeklyTarget / 100.0;
   if(weeklyPnL >= weeklyTargetAmt)
   {
      if(!weeklyTargetHit)
      {
         Print("WEEKLY TARGET HIT! Profit=$", DoubleToString(weeklyPnL, 2),
               " (", DoubleToString(weeklyPnL / weeklyStartEquity * 100, 1), "%)",
               " — DONE FOR THE WEEK. Closing all trades.");
         if(CountMyPositions() > 0) CloseAll();
      }
      weeklyTargetHit = true;
      return;
   }

   // === WEEKLY MAX LOSS: STOP TRADING FOR THE WEEK ===
   double weeklyMaxLossAmt = weeklyStartEquity * InpWeeklyMaxLoss / 100.0;
   if(weeklyPnL < -weeklyMaxLossAmt)
   {
      if(!weeklyLossHit)
      {
         Print("WEEKLY LOSS LIMIT! Loss=$", DoubleToString(weeklyPnL, 2),
               " — STOPPING FOR THE WEEK. Closing all trades.");
         if(CountMyPositions() > 0) CloseAll();
      }
      weeklyLossHit = true;
      return;
   }

   // === DAILY LOSS LIMIT: CLOSE EVERYTHING AND STOP ===
   double dailyPnL = equity - dailyStartEquity;
   double dailyMax = dailyStartEquity * InpDailyLossLimit / 100.0;
   if(dailyPnL < -dailyMax)
   {
      if(!dailyLimitHit)
      {
         Print("DAILY LIMIT HIT: Loss=$", DoubleToString(dailyPnL, 2),
               " > Max=$", DoubleToString(dailyMax, 2), " — CLOSING ALL TRADES");
      }
      dailyLimitHit = true;
      if(CountMyPositions() > 0) CloseAll();  // CLOSE existing trades!
      return;
   }

   // Spread check
   double spread = SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   if(spread > InpMaxSpread) return;

   // New M5 bar only
   static datetime lastBar = 0;
   datetime curBar = iTime(Symbol(), PERIOD_M5, 0);
   if(curBar == lastBar) return;
   lastBar = curBar;

   // Load indicators
   if(CopyBuffer(hEMAFast, 0, 0, 5, bufEMAFast) < 5) { Print("WARN: EMA fast not ready"); return; }
   if(CopyBuffer(hEMASlow, 0, 0, 5, bufEMASlow) < 5) { Print("WARN: EMA slow not ready"); return; }
   if(CopyBuffer(hRSI, 0, 0, 5, bufRSI) < 5)         { Print("WARN: RSI not ready"); return; }
   if(CopyBuffer(hATR, 0, 0, 5, bufATR) < 5)          { Print("WARN: ATR not ready"); return; }
   if(CopyBuffer(hEMAFast_H1, 0, 0, 3, bufEMAFast_H1) < 3) { Print("WARN: H1 EMA fast not ready"); return; }
   if(CopyBuffer(hEMASlow_H1, 0, 0, 3, bufEMASlow_H1) < 3) { Print("WARN: H1 EMA slow not ready"); return; }

   // === MANAGE EXISTING TRADES FIRST (always runs) ===
   ManagePositions();

   // Can we open new trade?
   if(CountMyPositions() >= InpMaxOpenTrades || todayTradeCount >= InpMaxTradesPerDay)
   {
      UpdateDashboard(0);
      return;
   }

   // === COOLDOWN: Wait after last trade close ===
   if(lastTradeClose > 0 && TimeCurrent() - lastTradeClose < InpCooldownMins * 60)
   {
      int remaining = (int)(InpCooldownMins * 60 - (TimeCurrent() - lastTradeClose)) / 60;
      Print("COOLDOWN: Waiting ", remaining, " more minutes before next trade");
      UpdateDashboard(0);
      return;
   }

   // === READ MARKET ===
   double emaFast = bufEMAFast[1];
   double emaSlow = bufEMASlow[1];
   double rsi     = bufRSI[1];
   double atr     = bufATR[1];
   double close1  = iClose(Symbol(), PERIOD_M5, 1);
   double open1   = iOpen(Symbol(), PERIOD_M5, 1);
   double h1Fast  = bufEMAFast_H1[1];
   double h1Slow  = bufEMASlow_H1[1];
   bool   h1Bull  = h1Fast > h1Slow;
   bool   h1Bear  = h1Fast < h1Slow;

   // === ANTI-WHIPSAW: Require minimum EMA separation ===
   double emaSepPct = MathAbs(emaFast - emaSlow) / emaSlow * 100.0;
   if(emaSepPct < InpMinEMASep)
   {
      Print("SCAN: EMAs too close (", DoubleToString(emaSepPct, 3), "%) — choppy zone, skipping");
      UpdateDashboard(0);
      return;
   }

   int signal = 0;
   string reason = "";
   bool mlReduced = false;
   bool mlBoosted = false;
   double bodySize = MathAbs(close1 - open1);
   double candleRange = iHigh(Symbol(), PERIOD_M5, 1) - iLow(Symbol(), PERIOD_M5, 1);
   bool strongCandle = candleRange > 0 && (bodySize / candleRange) > 0.4; // body > 40% of range

   // --- TREND BUY ---
   if(emaFast > emaSlow && close1 > emaFast && rsi > 40 && rsi < 75 && strongCandle)
   {
      signal = 1;
      reason = "TREND BUY: EMA21>50, RSI=" + DoubleToString(rsi, 1);
   }
   // --- TREND SELL ---
   else if(emaFast < emaSlow && close1 < emaFast && rsi > 25 && rsi < 60 && strongCandle)
   {
      signal = -1;
      reason = "TREND SELL: EMA21<50, RSI=" + DoubleToString(rsi, 1);
   }
   // --- RANGE BUY (RSI oversold) ---
   else if(rsi < 30 && close1 > open1)
   {
      signal = 1;
      reason = "RSI OVERSOLD BUY: RSI=" + DoubleToString(rsi, 1);
   }
   // --- RANGE SELL (RSI overbought) ---
   else if(rsi > 70 && close1 < open1)
   {
      signal = -1;
      reason = "RSI OVERBOUGHT SELL: RSI=" + DoubleToString(rsi, 1);
   }

   // === SMART FILTER: H1 Trend (reduces bad trades, doesn't block good ones) ===
   if(signal != 0 && InpUseH1Filter)
   {
      if(rsi > 30 && rsi < 70)
      {
         if(signal == 1 && h1Bear)
         {
            Print("H1 FILTER: Skipping BUY — H1 is bearish");
            signal = 0;
         }
         else if(signal == -1 && h1Bull)
         {
            Print("H1 FILTER: Skipping SELL — H1 is bullish");
            signal = 0;
         }
      }
   }

   // === ANTI-REVERSAL: Don't flip direction right after last trade ===
   if(signal != 0 && lastTradeDir != 0 && signal != lastTradeDir)
   {
      if(lastTradeClose > 0 && TimeCurrent() - lastTradeClose < InpCooldownMins * 2 * 60)
      {
         Print("ANTI-REVERSAL: Blocked ", signal > 0 ? "BUY" : "SELL",
               " — last trade was ", lastTradeDir > 0 ? "BUY" : "SELL",
               ". Wait for confirmation.");
         signal = 0;
      }
   }

   // === ML PATTERN CHECK (adjusts lot size based on history) ===
   if(signal != 0 && InpLearnPatterns && patternCount >= 10)
   {
      double mlScore = GetMLScore(signal, rsi, (emaFast - emaSlow) / emaSlow * 10000, dtNow.hour, dtNow.day_of_week);
      if(mlScore < 0.3)
      {
         Print("ML: Low win rate (", DoubleToString(mlScore * 100, 0), "%) — MIN lot to learn");
         mlReduced = true;
      }
      else if(mlScore > 0.6)
      {
         Print("ML: High win rate (", DoubleToString(mlScore * 100, 0), "%) — full confidence");
         mlBoosted = true;
      }
   }

   // === CONSECUTIVE LOSS GUARD: reduce size after 3 losses in a row ===
   if(signal != 0 && losses >= 3 && (totalTrades - wins) >= 3)
   {
      // Check last 3 trades were all losses
      int recentLosses = 0;
      for(int p = patternCount - 1; p >= MathMax(0, patternCount - 3); p--)
      {
         if(!patterns[p].wasWinner) recentLosses++;
      }
      if(recentLosses >= 3)
      {
         Print("STREAK GUARD: 3+ consecutive losses — reducing lot size");
         mlReduced = true;
      }
   }

   // === VOLATILITY CHECK: skip during dead market (ATR too low) ===
   if(signal != 0 && atr < SymbolInfoDouble(Symbol(), SYMBOL_POINT) * 30)
   {
      Print("LOW VOLATILITY: ATR too low (", DoubleToString(atr, 2), ") — skipping");
      signal = 0;
   }

   // === NEWS CHECK: Skip during high-impact events ===
   if(signal != 0 && !IsNewsSafe())
   {
      signal = 0;
   }

   // === GPT-5.2 AI ANALYSIS: Get second opinion ===
   if(signal != 0 && InpUseAI && StringLen(InpServerURL) >= 10)
   {
      string h1DirStr = h1Bull ? "BULL" : h1Bear ? "BEAR" : "FLAT";
      int aiOpinion = GetAIAnalysis(emaFast, emaSlow, rsi, atr,
                                      iClose(Symbol(), PERIOD_M5, 0), h1DirStr, spread);

      if(aiOpinion == 0)
      {
         // AI says SKIP — still trade but at minimum lot (learning)
         Print("AI: SKIP recommendation — trading at minimum lot to learn");
         mlReduced = true;
      }
      else if(aiOpinion != signal)
      {
         // AI disagrees — trade at minimum lot
         Print("AI: Disagrees (AI=", aiOpinion > 0 ? "BUY" : "SELL",
               " vs Signal=", signal > 0 ? "BUY" : "SELL", ") — minimum lot");
         mlReduced = true;
      }
      else
      {
         // AI agrees — full confidence
         Print("AI: Confirms ", signal > 0 ? "BUY" : "SELL", " — full lot");
      }
   }

   // === EXECUTE OR LOG ===
   if(signal != 0)
   {
      Print(">>> SIGNAL: ", reason);
      // Store signal context for ML recording
      lastSignalDir = signal;
      lastSignalRSI = rsi;
      lastSignalEMADiff = (emaFast - emaSlow) / emaSlow * 10000;
      lastSignalATR = atr;
      OpenTrade(signal, atr, reason, mlReduced || false);
   }
   else
   {
      Print("SCAN: No setup | EMA21=", DoubleToString(emaFast, 2),
            " EMA50=", DoubleToString(emaSlow, 2),
            " RSI=", DoubleToString(rsi, 1),
            " H1=", h1Bull ? "BULL" : h1Bear ? "BEAR" : "FLAT",
            " Spread=", DoubleToString(spread, 0));
   }

   UpdateDashboard(signal);
}

//+------------------------------------------------------------------+
//| OPEN TRADE                                                       |
//+------------------------------------------------------------------+
void OpenTrade(int signal, double atr, string reason, bool reduceSize = false)
{
   int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double point = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   long stopLevel = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = stopLevel * point;

   double price, sl, tp, slDist;

   if(signal == 1)
   {
      price = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
      if(price <= 0) { Print("ERROR: Ask = 0"); return; }
      slDist = MathMax(atr * InpSLMultiplier, minDist);
      sl = NormalizeDouble(price - slDist, digits);
      tp = NormalizeDouble(price + slDist * InpTPMultiplier, digits);
   }
   else
   {
      price = SymbolInfoDouble(Symbol(), SYMBOL_BID);
      if(price <= 0) { Print("ERROR: Bid = 0"); return; }
      slDist = MathMax(atr * InpSLMultiplier, minDist);
      sl = NormalizeDouble(price + slDist, digits);
      tp = NormalizeDouble(price - slDist * InpTPMultiplier, digits);
   }

   // Lot sizing
   double balance    = accInfo.Balance();
   double riskPct    = InpRiskPercent;

   // === CAREFUL MODE: Scale down risk as weekly profit grows ===
   if(InpCarefulMode)
   {
      double weekPnL = accInfo.Equity() - weeklyStartEquity;
      double weekPct = weekPnL / weeklyStartEquity * 100.0;

      if(weekPct > InpWeeklyTarget * 0.75)
      {
         // Over 75% of target reached — trade at 25% size to protect gains
         riskPct = InpRiskPercent * 0.25;
         Print("CAREFUL: Near weekly target (", DoubleToString(weekPct, 1), "%) — risk reduced to ", DoubleToString(riskPct, 2), "%");
      }
      else if(weekPct > InpWeeklyTarget * 0.5)
      {
         // Over 50% of target — trade at 50% size
         riskPct = InpRiskPercent * 0.5;
         Print("CAREFUL: Good weekly progress (", DoubleToString(weekPct, 1), "%) — risk reduced to ", DoubleToString(riskPct, 2), "%");
      }

      // Also reduce after daily losses
      double dayPnL = accInfo.Equity() - dailyStartEquity;
      if(dayPnL < -(dailyStartEquity * InpDailyLossLimit / 100.0 * 0.5))
      {
         riskPct = riskPct * 0.5;
         Print("CAREFUL: Daily drawdown — risk further reduced to ", DoubleToString(riskPct, 2), "%");
      }
   }

   double riskAmount = balance * riskPct / 100.0;
   double tickValue  = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize   = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   double minLot     = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
   double maxLot     = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
   double lotStep    = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);

   if(tickValue <= 0 || tickSize <= 0 || slDist <= 0)
   {
      Print("ERROR: Lot calc invalid. TV=", tickValue, " TS=", tickSize, " SL=", slDist);
      return;
   }

   double lots = riskAmount / (slDist / tickSize * tickValue);
   lots = MathFloor(lots / lotStep) * lotStep;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   lots = NormalizeDouble(lots, 2);

   // ML/streak reduction or boost
   if(reduceSize)
   {
      lots = MathMax(minLot, NormalizeDouble(minLot, 2)); // minimum lot to learn
      Print("LOT MIN: Learning trade — using ", DoubleToString(lots, 2), " lots");
   }

   // === HARD LOT CAP — ABSOLUTE MAXIMUM regardless of any calculation ===
   if(lots > InpMaxLots)
   {
      Print("HARD CAP: ", DoubleToString(lots, 2), " -> ", DoubleToString(InpMaxLots, 2), " lots (max limit)");
      lots = InpMaxLots;
   }

   // Safety: verify dollar risk makes sense
   double estimatedRisk = lots * slDist / tickSize * tickValue;
   if(estimatedRisk > balance * 0.03) // never risk more than 3% of balance
   {
      lots = (balance * 0.02) / (slDist / tickSize * tickValue);
      lots = MathFloor(lots / lotStep) * lotStep;
      lots = MathMax(minLot, lots);
      lots = MathMin(lots, InpMaxLots);
      Print("RISK CAP: Adjusted to ", DoubleToString(lots, 2), " lots (3% max risk)");
   }

   // === MARGIN CHECK: Reduce lot if not enough free margin ===
   double freeMargin = accInfo.FreeMargin();
   double marginNeeded = 0;
   if(OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded))
   {
      while(lots > minLot && marginNeeded > freeMargin * 0.5)
      {
         lots -= lotStep;
         lots = MathMax(minLot, lots);
         OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded);
      }
      lots = NormalizeDouble(lots, 2);
      if(marginNeeded > freeMargin * 0.8)
      {
         Print("NO MARGIN: Free=$", DoubleToString(freeMargin, 2),
               " Need=$", DoubleToString(marginNeeded, 2), " — skipping trade");
         return;
      }
   }

   Print("EXECUTING: ", signal > 0 ? "BUY" : "SELL",
         " Price=", DoubleToString(price, digits),
         " SL=", DoubleToString(sl, digits),
         " TP=", DoubleToString(tp, digits),
         " Lots=", DoubleToString(lots, 2),
         " Risk=$", DoubleToString(riskAmount, 2));

   bool ok;
   if(signal == 1)
      ok = trade.Buy(lots, Symbol(), 0, sl, tp, "AIS|" + reason);
   else
      ok = trade.Sell(lots, Symbol(), 0, sl, tp, "AIS|" + reason);

   if(ok)
   {
      Print("TRADE OPENED: ", signal > 0 ? "BUY" : "SELL", " ", DoubleToString(lots, 2), " lots");
      todayTradeCount++;
      lastTradeDir = signal;
   }
   else
   {
      Print("TRADE FAILED: Error=", GetLastError(), " RetCode=", trade.ResultRetcode(),
            " Price=", DoubleToString(price, digits),
            " SL=", DoubleToString(sl, digits),
            " TP=", DoubleToString(tp, digits));
   }
}

//+------------------------------------------------------------------+
//| SMART POSITION MANAGEMENT — "Rethinking" active trades           |
//| Watches RSI, EMA, candle patterns to adapt in real-time          |
//+------------------------------------------------------------------+
void ManagePositions()
{
   int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double atr = bufATR[1];
   if(atr <= 0) return;
   double minVol = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
   double lotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
   double rsi = bufRSI[1];
   double emaFast = bufEMAFast[1];
   double emaSlow = bufEMASlow[1];
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   double close2 = iClose(Symbol(), PERIOD_M5, 2);
   double open1 = iOpen(Symbol(), PERIOD_M5, 1);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != InpMagicNumber) continue;
      if(posInfo.Symbol() != Symbol()) continue;

      double curPrice = posInfo.PriceCurrent();
      double openPx   = posInfo.PriceOpen();
      double curSL    = posInfo.StopLoss();
      double curTP    = posInfo.TakeProfit();
      double volume   = posInfo.Volume();
      ulong  ticket   = posInfo.Ticket();
      double profit   = posInfo.Profit();
      double slDist;

      if(posInfo.PositionType() == POSITION_TYPE_BUY)
      {
         slDist = openPx - curSL;
         if(slDist <= 0) slDist = atr * InpSLMultiplier;
         double tp1 = openPx + slDist * 1.0;

         // ============================================
         // SMART EXIT 1: In profit but market reversing
         // If in profit AND (RSI overbought OR price crossed below fast EMA OR bearish reversal candle)
         // → Take profit now, don't wait for TP
         // ============================================
         if(profit > 0 && curPrice > openPx + atr * 0.3)
         {
            bool rsiReversal = rsi > 72;                        // RSI getting overbought
            bool emaCross = close1 < emaFast && close2 > emaFast; // price just crossed below EMA
            bool bearishCandle = close1 < open1 && (open1 - close1) > atr * 0.4; // strong bearish candle

            if(rsiReversal || emaCross || bearishCandle)
            {
               string exitReason = rsiReversal ? "RSI overbought" : emaCross ? "Price crossed below EMA" : "Strong bearish reversal candle";
               Print("SMART EXIT: Closing BUY #", ticket, " in profit ($", DoubleToString(profit, 2),
                     ") — Market reversing: ", exitReason);
               trade.PositionClose(ticket);
               continue;
            }
         }

         // ============================================
         // SMART EXIT 2: Heading to SL but showing recovery
         // If losing AND price approaching SL AND (RSI oversold = bounce likely OR bullish reversal candle)
         // → Widen SL slightly to give room, or do nothing (let it play out)
         // If losing AND no recovery signs AND loss > 60% of SL distance
         // → Cut loss early instead of waiting for full SL hit
         // ============================================
         if(profit < 0)
         {
            double lossPercent = MathAbs(curPrice - openPx) / slDist * 100;

            // Loss > 60% of SL and market shows no recovery (bearish momentum)
            if(lossPercent > 60 && rsi < 35 && close1 < close2)
            {
               Print("SMART CUT: Closing BUY #", ticket, " early — loss at ", DoubleToString(lossPercent, 0),
                     "% of SL, no recovery signs (RSI=", DoubleToString(rsi, 1), ")");
               trade.PositionClose(ticket);
               continue;
            }

            // Near SL but RSI oversold = bounce likely → move SL a bit wider
            if(lossPercent > 70 && rsi < 28)
            {
               double newSL = NormalizeDouble(curSL - atr * 0.3, digits);
               Print("SMART ADJUST: BUY #", ticket, " — RSI oversold (", DoubleToString(rsi, 1),
                     "), widening SL to give room for bounce");
               trade.PositionModify(ticket, newSL, curTP);
               continue;
            }
         }

         // PARTIAL CLOSE at 1:1 target
         if(curPrice >= tp1 && volume > minVol)
         {
            double closeVol = MathFloor(volume * 0.5 / lotStep) * lotStep;
            closeVol = NormalizeDouble(closeVol, 2);
            if(closeVol >= minVol)
            {
               if(trade.PositionClosePartial(ticket, closeVol))
               {
                  Print("PARTIAL CLOSE: 50% of #", ticket, " at 1:1 target");
                  double beSL = NormalizeDouble(openPx + SymbolInfoDouble(Symbol(), SYMBOL_POINT) * 10, digits);
                  trade.PositionModify(ticket, beSL, curTP);
               }
            }
         }
         else if(InpBreakEven && curSL < openPx && curPrice > openPx + atr)
         {
            double beSL = NormalizeDouble(openPx + SymbolInfoDouble(Symbol(), SYMBOL_POINT) * 10, digits);
            trade.PositionModify(ticket, beSL, curTP);
            Print("BREAK-EVEN: #", ticket);
         }

         // Trailing
         if(InpTrailingStop && curPrice > tp1)
         {
            double newSL = NormalizeDouble(curPrice - atr * 1.0, digits);
            if(newSL > curSL && newSL > openPx)
               trade.PositionModify(ticket, newSL, curTP);
         }
      }
      else // === SELL POSITION ===
      {
         slDist = curSL - openPx;
         if(slDist <= 0) slDist = atr * InpSLMultiplier;
         double tp1 = openPx - slDist * 1.0;

         // SMART EXIT: In profit but market reversing UP
         if(profit > 0 && curPrice < openPx - atr * 0.3)
         {
            bool rsiReversal = rsi < 28;
            bool emaCross = close1 > emaFast && close2 < emaFast;
            bool bullishCandle = close1 > open1 && (close1 - open1) > atr * 0.4;

            if(rsiReversal || emaCross || bullishCandle)
            {
               string exitReason = rsiReversal ? "RSI oversold" : emaCross ? "Price crossed above EMA" : "Strong bullish reversal candle";
               Print("SMART EXIT: Closing SELL #", ticket, " in profit ($", DoubleToString(profit, 2),
                     ") — Market reversing: ", exitReason);
               trade.PositionClose(ticket);
               continue;
            }
         }

         // SMART CUT: Losing with no recovery
         if(profit < 0)
         {
            double lossPercent = MathAbs(curPrice - openPx) / slDist * 100;

            if(lossPercent > 60 && rsi > 65 && close1 > close2)
            {
               Print("SMART CUT: Closing SELL #", ticket, " early — loss at ", DoubleToString(lossPercent, 0),
                     "% of SL, no recovery (RSI=", DoubleToString(rsi, 1), ")");
               trade.PositionClose(ticket);
               continue;
            }

            if(lossPercent > 70 && rsi > 72)
            {
               double newSL = NormalizeDouble(curSL + atr * 0.3, digits);
               Print("SMART ADJUST: SELL #", ticket, " — RSI overbought (", DoubleToString(rsi, 1),
                     "), widening SL for pullback");
               trade.PositionModify(ticket, newSL, curTP);
               continue;
            }
         }

         // PARTIAL CLOSE
         if(curPrice <= tp1 && volume > minVol)
         {
            double closeVol = MathFloor(volume * 0.5 / lotStep) * lotStep;
            closeVol = NormalizeDouble(closeVol, 2);
            if(closeVol >= minVol)
            {
               if(trade.PositionClosePartial(ticket, closeVol))
               {
                  Print("PARTIAL CLOSE: 50% of #", ticket, " at 1:1 target");
                  double beSL = NormalizeDouble(openPx - SymbolInfoDouble(Symbol(), SYMBOL_POINT) * 10, digits);
                  trade.PositionModify(ticket, beSL, curTP);
               }
            }
         }
         else if(InpBreakEven && curSL > openPx && curPrice < openPx - atr)
         {
            double beSL = NormalizeDouble(openPx - SymbolInfoDouble(Symbol(), SYMBOL_POINT) * 10, digits);
            trade.PositionModify(ticket, beSL, curTP);
            Print("BREAK-EVEN: #", ticket);
         }

         if(InpTrailingStop && curPrice < tp1)
         {
            double newSL = NormalizeDouble(curPrice + atr * 1.0, digits);
            if(newSL < curSL && newSL < openPx)
               trade.PositionModify(ticket, newSL, curTP);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| ML: GET WIN RATE SCORE FOR SIMILAR SETUPS                        |
//+------------------------------------------------------------------+
double GetMLScore(int dir, double rsi, double emaDiff, int hour, int dow)
{
   if(patternCount < 10) return 0.5; // neutral if not enough data

   int matches = 0;
   int matchWins = 0;

   for(int i = 0; i < patternCount; i++)
   {
      if(patterns[i].direction != dir) continue;
      if(MathAbs(patterns[i].rsi - rsi) > 15) continue;
      if(MathAbs(patterns[i].hour - hour) > 2) continue;

      matches++;
      if(patterns[i].wasWinner) matchWins++;
   }

   if(matches < 5) return 0.5;
   return (double)matchWins / matches;
}

//+------------------------------------------------------------------+
//| ML: RECORD TRADE OUTCOME                                         |
//+------------------------------------------------------------------+
void RecordPattern(bool wasWin, double profit)
{
   if(!InpLearnPatterns) return;

   MqlDateTime dt;
   TimeCurrent(dt);

   TradePattern p;
   p.direction = lastSignalDir;
   p.emaDiff   = lastSignalEMADiff;
   p.rsi       = lastSignalRSI;
   p.atr       = lastSignalATR;
   p.hour      = dt.hour;
   p.dayOfWeek = dt.day_of_week;
   p.wasWinner = wasWin;
   p.profit    = profit;

   // FIFO if full
   if(patternCount >= InpMaxPatterns)
   {
      for(int i = 0; i < patternCount - 1; i++)
         patterns[i] = patterns[i + 1];
      patternCount--;
   }

   ArrayResize(patterns, patternCount + 1);
   patterns[patternCount] = p;
   patternCount++;

   Print("ML: Recorded #", patternCount, " | ", wasWin ? "WIN" : "LOSS", " $", DoubleToString(profit, 2));

   // Auto-save to cloud every 5 trades
   if(patternCount % 5 == 0) SavePatterns();
}

//+------------------------------------------------------------------+
//| ML: SAVE PATTERNS (Cloud + Local backup)                         |
//+------------------------------------------------------------------+
void SavePatterns()
{
   if(patternCount == 0) return;

   // Save locally as backup
   string fn = "AIS_Patterns_" + Symbol() + ".bin";
   int h = FileOpen(fn, FILE_WRITE | FILE_BIN);
   if(h != INVALID_HANDLE)
   {
      FileWriteInteger(h, patternCount);
      for(int i = 0; i < patternCount; i++)
      {
         FileWriteInteger(h, patterns[i].direction);
         FileWriteDouble(h, patterns[i].emaDiff);
         FileWriteDouble(h, patterns[i].rsi);
         FileWriteDouble(h, patterns[i].atr);
         FileWriteInteger(h, patterns[i].hour);
         FileWriteInteger(h, patterns[i].dayOfWeek);
         FileWriteInteger(h, patterns[i].wasWinner ? 1 : 0);
         FileWriteDouble(h, patterns[i].profit);
      }
      FileClose(h);
   }

   // Save to cloud server (survives account changes)
   if(StringLen(InpServerURL) >= 10)
   {
      string url = InpServerURL + "/api/ml/patterns/save";
      string headers = "Content-Type: application/json\r\n";

      // Build JSON array of patterns
      string jsonPatterns = "[";
      for(int i = 0; i < patternCount; i++)
      {
         if(i > 0) jsonPatterns += ",";
         jsonPatterns += StringFormat("{\"d\":%d,\"ed\":%.4f,\"r\":%.1f,\"a\":%.2f,\"h\":%d,\"dw\":%d,\"w\":%d,\"p\":%.2f}",
            patterns[i].direction, patterns[i].emaDiff, patterns[i].rsi,
            patterns[i].atr, patterns[i].hour, patterns[i].dayOfWeek,
            patterns[i].wasWinner ? 1 : 0, patterns[i].profit);
      }
      jsonPatterns += "]";

      string body = StringFormat("{\"pin\":\"%s\",\"symbol\":\"%s\",\"patterns\":%s}",
         InpLicensePIN, Symbol(), jsonPatterns);

      char postData[], result[];
      string resultHeaders;
      StringToCharArray(body, postData, 0, StringLen(body));
      int res = WebRequest("POST", url, headers, 10000, postData, result, resultHeaders);
      if(res == 200)
         Print("ML CLOUD: Saved ", patternCount, " patterns to server");
      else
         Print("ML CLOUD: Save failed (", res, ") — local backup saved");
   }
}

//+------------------------------------------------------------------+
//| ML: LOAD PATTERNS (Cloud first, then local backup)               |
//+------------------------------------------------------------------+
void LoadPatterns()
{
   // Try cloud first (has patterns from all accounts)
   if(StringLen(InpServerURL) >= 10)
   {
      string url = InpServerURL + "/api/ml/patterns/load";
      string headers = "Content-Type: application/json\r\n";
      string body = StringFormat("{\"pin\":\"%s\",\"symbol\":\"%s\"}", InpLicensePIN, Symbol());

      char postData[], result[];
      string resultHeaders;
      StringToCharArray(body, postData, 0, StringLen(body));
      int res = WebRequest("POST", url, headers, 10000, postData, result, resultHeaders);

      if(res == 200)
      {
         string response = CharArrayToString(result);

         // Parse count
         int countIdx = StringFind(response, "\"count\":");
         if(countIdx >= 0)
         {
            string countStr = StringSubstr(response, countIdx + 8, 10);
            int commaIdx = StringFind(countStr, ",");
            if(commaIdx < 0) commaIdx = StringFind(countStr, "}");
            if(commaIdx > 0) countStr = StringSubstr(countStr, 0, commaIdx);
            int cloudCount = (int)StringToInteger(countStr);

            if(cloudCount > 0)
            {
               // Parse patterns from JSON array
               int arrStart = StringFind(response, "[");
               int arrEnd = StringFind(response, "]");
               if(arrStart >= 0 && arrEnd > arrStart)
               {
                  string arrStr = StringSubstr(response, arrStart, arrEnd - arrStart + 1);
                  int parsed = ParseCloudPatterns(arrStr);
                  if(parsed > 0)
                  {
                     Print("ML CLOUD: Loaded ", patternCount, " patterns from server");
                     return;
                  }
               }
            }
         }
      }
      Print("ML CLOUD: No cloud patterns found, trying local...");
   }

   // Fallback to local file
   string fn = "AIS_Patterns_" + Symbol() + ".bin";
   if(!FileIsExist(fn)) { Print("ML: No patterns found (fresh start)"); return; }
   int h = FileOpen(fn, FILE_READ | FILE_BIN);
   if(h == INVALID_HANDLE) return;
   patternCount = FileReadInteger(h);
   ArrayResize(patterns, patternCount);
   for(int i = 0; i < patternCount; i++)
   {
      patterns[i].direction = FileReadInteger(h);
      patterns[i].emaDiff   = FileReadDouble(h);
      patterns[i].rsi       = FileReadDouble(h);
      patterns[i].atr       = FileReadDouble(h);
      patterns[i].hour      = FileReadInteger(h);
      patterns[i].dayOfWeek = FileReadInteger(h);
      patterns[i].wasWinner = FileReadInteger(h) == 1;
      patterns[i].profit    = FileReadDouble(h);
   }
   FileClose(h);
   Print("ML LOCAL: Loaded ", patternCount, " patterns from file");
}

//+------------------------------------------------------------------+
//| Parse cloud pattern JSON array                                    |
//+------------------------------------------------------------------+
int ParseCloudPatterns(string arrStr)
{
   patternCount = 0;
   ArrayResize(patterns, 0);

   int pos = 0;
   while(pos < StringLen(arrStr))
   {
      int objStart = StringFind(arrStr, "{", pos);
      if(objStart < 0) break;
      int objEnd = StringFind(arrStr, "}", objStart);
      if(objEnd < 0) break;

      string obj = StringSubstr(arrStr, objStart, objEnd - objStart + 1);

      TradePattern p;
      p.direction = (int)GetJsonInt(obj, "\"d\":");
      p.emaDiff   = GetJsonDouble(obj, "\"ed\":");
      p.rsi       = GetJsonDouble(obj, "\"r\":");
      p.atr       = GetJsonDouble(obj, "\"a\":");
      p.hour      = (int)GetJsonInt(obj, "\"h\":");
      p.dayOfWeek = (int)GetJsonInt(obj, "\"dw\":");
      p.wasWinner = GetJsonInt(obj, "\"w\":") == 1;
      p.profit    = GetJsonDouble(obj, "\"p\":");

      ArrayResize(patterns, patternCount + 1);
      patterns[patternCount] = p;
      patternCount++;

      pos = objEnd + 1;
   }
   return patternCount;
}

long GetJsonInt(string json, string key)
{
   int idx = StringFind(json, key);
   if(idx < 0) return 0;
   string val = StringSubstr(json, idx + StringLen(key), 20);
   int end = StringFind(val, ",");
   if(end < 0) end = StringFind(val, "}");
   if(end > 0) val = StringSubstr(val, 0, end);
   return StringToInteger(val);
}

double GetJsonDouble(string json, string key)
{
   int idx = StringFind(json, key);
   if(idx < 0) return 0;
   string val = StringSubstr(json, idx + StringLen(key), 20);
   int end = StringFind(val, ",");
   if(end < 0) end = StringFind(val, "}");
   if(end > 0) val = StringSubstr(val, 0, end);
   return StringToDouble(val);
}

//+------------------------------------------------------------------+
//| TRADE RESULT TRACKING                                            |
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
            bool isWin = profit > 0;
            if(isWin) wins++; else losses++;

            Print("TRADE CLOSED: ", isWin ? "WIN" : "LOSS",
                  " $", DoubleToString(profit, 2),
                  " | Total: ", totalTrades, " W:", wins, " L:", losses);

            // Set cooldown timer (longer after a loss)
            lastTradeClose = TimeCurrent();

            // ML: record pattern
            RecordPattern(isWin, profit);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| HELPERS                                                          |
//+------------------------------------------------------------------+
int CountMyPositions()
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

void CloseAll()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(posInfo.SelectByIndex(i))
         if(posInfo.Magic() == InpMagicNumber && posInfo.Symbol() == Symbol())
         {
            trade.PositionClose(posInfo.Ticket());
            Print("FORCE CLOSED: Ticket #", posInfo.Ticket());
         }
   }
}

//+------------------------------------------------------------------+
//| AI ANALYSIS: Call GPT-5.2 for trade decision                     |
//+------------------------------------------------------------------+
int GetAIAnalysis(double emaF, double emaS, double rsi, double atr, double price, string h1Dir, double spread)
{
   if(!InpUseAI || StringLen(InpServerURL) < 10) return 0; // 0 = no opinion

   string url = InpServerURL + "/api/ai/analyze";
   string headers = "Content-Type: application/json\r\n";
   string body = StringFormat(
      "{\"price\":%.2f,\"ema_fast\":%.2f,\"ema_slow\":%.2f,\"rsi\":%.1f,\"atr\":%.2f,\"h1_trend\":\"%s\",\"spread\":%.0f}",
      price, emaF, emaS, rsi, atr, h1Dir, spread);

   char postData[];
   char result[];
   string resultHeaders;
   StringToCharArray(body, postData, 0, StringLen(body));

   int timeout = 10000; // 10 seconds
   int res = WebRequest("POST", url, headers, timeout, postData, result, resultHeaders);

   if(res != 200)
   {
      Print("AI: Server returned ", res, " — proceeding without AI");
      return 0;
   }

   string response = CharArrayToString(result);

   // Parse action from JSON response
   int actionIdx = StringFind(response, "\"action\"");
   if(actionIdx < 0) return 0;

   if(StringFind(response, "\"BUY\"", actionIdx) >= 0 || StringFind(response, "\"buy\"", actionIdx) >= 0)
   {
      Print("AI SAYS: BUY — ", response);
      return 1;
   }
   else if(StringFind(response, "\"SELL\"", actionIdx) >= 0 || StringFind(response, "\"sell\"", actionIdx) >= 0)
   {
      Print("AI SAYS: SELL — ", response);
      return -1;
   }
   else
   {
      Print("AI SAYS: SKIP — ", response);
      return 0;
   }
}

//+------------------------------------------------------------------+
//| NEWS CHECK: Avoid high-impact events                             |
//+------------------------------------------------------------------+
bool IsNewsSafe()
{
   if(!InpUseNewsFilter || StringLen(InpServerURL) < 10) return true;

   string url = InpServerURL + "/api/news/check";
   char postData[];
   char result[];
   string resultHeaders;

   int res = WebRequest("GET", url, "", 5000, postData, result, resultHeaders);
   if(res != 200)
   {
      Print("NEWS: Check failed (", res, ") — proceeding");
      return true;
   }

   string response = CharArrayToString(result);

   if(StringFind(response, "\"safe_to_trade\":false") >= 0 || StringFind(response, "\"safe_to_trade\": false") >= 0)
   {
      // Extract reason
      int reasonIdx = StringFind(response, "\"reason\"");
      if(reasonIdx >= 0)
      {
         string reasonPart = StringSubstr(response, reasonIdx, 200);
         Print("NEWS ALERT: ", reasonPart, " — SKIPPING TRADE");
      }
      else
         Print("NEWS ALERT: High-impact event nearby — SKIPPING TRADE");
      return false;
   }

   return true;
}

//+------------------------------------------------------------------+
//| DASHBOARD                                                        |
//+------------------------------------------------------------------+
void UpdateDashboard(int signal)
{
   double equity  = accInfo.Equity();
   double balance = accInfo.Balance();
   double dailyPnL= equity - dailyStartEquity;
   double weeklyPnL = equity - weeklyStartEquity;
   double weeklyPct = weeklyStartEquity > 0 ? weeklyPnL / weeklyStartEquity * 100.0 : 0;
   double wr = totalTrades > 0 ? (double)wins / totalTrades * 100 : 0;

   string dir = bufEMAFast[1] > bufEMASlow[1] ? "BULLISH" : "BEARISH";
   string h1dir = bufEMAFast_H1[1] > bufEMASlow_H1[1] ? "BULL" : "BEAR";
   double mlWR = 0;
   int mlW = 0;
   for(int i = 0; i < patternCount; i++) if(patterns[i].wasWinner) mlW++;
   if(patternCount > 0) mlWR = (double)mlW / patternCount * 100;

   string d = "\n";
   d += "========================================\n";
   d += "  XauAI SNIPER v3.1 | SMART | LICENSED\n";
   d += "========================================\n";
   d += StringFormat("Balance: $%.2f | Equity: $%.2f\n", balance, equity);
   d += StringFormat("Daily P/L: $%.2f\n", dailyPnL);
   d += StringFormat("Weekly P/L: $%.2f (%.1f%% / %.0f%%)\n", weeklyPnL, weeklyPct, InpWeeklyTarget);
   d += "----------------------------------------\n";
   d += StringFormat("M5: %s | H1: %s | RSI: %.1f\n", dir, h1dir, bufRSI[1]);
   d += StringFormat("ATR: %.2f | Spread: %.0f\n", bufATR[1], (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD));
   d += "----------------------------------------\n";
   d += StringFormat("Open: %d/%d | Today: %d/%d\n",
        CountMyPositions(), InpMaxOpenTrades, todayTradeCount, InpMaxTradesPerDay);
   d += StringFormat("Trades: %d | Win: %.1f%%\n", totalTrades, wr);
   d += StringFormat("ML Patterns: %d | ML Win%%: %.1f%%\n", patternCount, mlWR);
   d += "----------------------------------------\n";
   d += StringFormat("Careful: %s | H1: %s | ML: %s\n",
        InpCarefulMode ? "ON" : "OFF", InpUseH1Filter ? "ON" : "OFF", InpLearnPatterns ? "ON" : "OFF");
   d += StringFormat("AI(GPT5.2): %s | News Filter: %s\n",
        InpUseAI ? "ON" : "OFF", InpUseNewsFilter ? "ON" : "OFF");
   d += "========================================\n";

   if(weeklyTargetHit) d += ">> WEEKLY TARGET HIT - RESTING <<\n";
   if(weeklyLossHit) d += "!! WEEKLY LOSS LIMIT - STOPPED !!\n";
   if(dailyLimitHit) d += "!! DAILY LIMIT - TRADES CLOSED !!\n";

   Comment(d);
}
//+------------------------------------------------------------------+
