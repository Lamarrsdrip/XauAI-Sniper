//+------------------------------------------------------------------+
//|                                     XAUUSD_AI_Sniper_EA.mq5      |
//|                                     AI-Assisted Gold Trading Bot  |
//|                                     v3.0 - Simplified & Reliable  |
//+------------------------------------------------------------------+
#property copyright "AI Sniper Trading Systems"
#property link      "https://ai-sniper-ea.com"
#property version   "3.00"
#property description "XAUUSD AI Sniper EA - Simplified Core"
#property description "Trend + Range + Breakout | Clean Execution"
#property description "LICENSE REQUIRED: Enter your PIN to activate"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>

//+------------------------------------------------------------------+
//| LICENSE                                                          |
//+------------------------------------------------------------------+
input group "=== LICENSE ==="
input string InpLicensePIN     = "";       // License PIN (ASE-XXXX-XXXX)

//+------------------------------------------------------------------+
//| RISK MANAGEMENT                                                  |
//+------------------------------------------------------------------+
input group "=== RISK ==="
input double InpRiskPercent    = 1.0;      // Risk per trade (%)
input double InpDailyLossLimit = 3.0;      // Max daily loss (%)
input int    InpMaxOpenTrades  = 3;        // Max open trades
input int    InpMaxTradesPerDay= 8;        // Max trades per day

//+------------------------------------------------------------------+
//| STRATEGY                                                         |
//+------------------------------------------------------------------+
input group "=== STRATEGY ==="
input int    InpEMAFast        = 21;       // Fast EMA
input int    InpEMASlow        = 50;       // Slow EMA
input int    InpRSIPeriod      = 14;       // RSI Period
input int    InpATRPeriod      = 14;       // ATR Period
input double InpSLMultiplier   = 1.5;      // SL = ATR x this
input double InpTPMultiplier   = 2.0;      // TP = SL x this (Risk:Reward)

//+------------------------------------------------------------------+
//| SAFETY                                                           |
//+------------------------------------------------------------------+
input group "=== SAFETY ==="
input double InpMaxSpread      = 150.0;    // Max spread (points)
input double InpEquityProtect  = 70.0;     // Equity protection (% of initial)
input bool   InpWeekendClose   = true;     // Close before weekend
input int    InpFridayHour     = 20;       // Friday close hour
input int    InpMagicNumber    = 20250301; // Magic Number

//+------------------------------------------------------------------+
//| GLOBALS                                                          |
//+------------------------------------------------------------------+
CTrade        trade;
CPositionInfo posInfo;
CAccountInfo  accInfo;

bool   licenseValid = false;
int    hEMAFast, hEMASlow, hRSI, hATR;
double bufEMAFast[], bufEMASlow[], bufRSI[], bufATR[];
double initialBalance, dailyStartEquity;
int    todayTradeCount;
datetime lastDayReset;
bool   dailyLimitHit;
int    totalTrades, wins, losses;

//+------------------------------------------------------------------+
//| PIN VALIDATION (Offline: ASE-XXXX-XXXX = 13 chars)              |
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
   // License check
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

   // Symbol check
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

   // Create indicators (M5 only - keep it simple)
   hEMAFast = iMA(Symbol(), PERIOD_M5, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow = iMA(Symbol(), PERIOD_M5, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   hRSI     = iRSI(Symbol(), PERIOD_M5, InpRSIPeriod, PRICE_CLOSE);
   hATR     = iATR(Symbol(), PERIOD_M5, InpATRPeriod);

   if(hEMAFast == INVALID_HANDLE || hEMASlow == INVALID_HANDLE ||
      hRSI == INVALID_HANDLE || hATR == INVALID_HANDLE)
   {
      Print("ERROR: Failed to create indicators");
      return INIT_FAILED;
   }

   ArraySetAsSeries(bufEMAFast, true);
   ArraySetAsSeries(bufEMASlow, true);
   ArraySetAsSeries(bufRSI, true);
   ArraySetAsSeries(bufATR, true);

   // State init
   initialBalance  = accInfo.Balance();
   dailyStartEquity= accInfo.Equity();
   todayTradeCount = 0;
   lastDayReset    = TimeCurrent();
   dailyLimitHit   = false;
   totalTrades = 0; wins = 0; losses = 0;

   Print("=== AI SNIPER v3.0 READY ===");
   Print("Balance: $", DoubleToString(initialBalance, 2),
         " | Risk: ", InpRiskPercent, "%",
         " | SL: ", InpSLMultiplier, "xATR",
         " | TP: ", InpTPMultiplier, "xSL");
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
   double wr = totalTrades > 0 ? (double)wins / totalTrades * 100 : 0;
   Print("=== EA STOPPED | Trades: ", totalTrades, " | Win Rate: ", DoubleToString(wr, 1), "% ===");
}

//+------------------------------------------------------------------+
//| TICK - Main logic                                                |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!licenseValid) return;

   // Daily reset
   MqlDateTime dtNow, dtLast;
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

   // Weekend protection
   if(InpWeekendClose && dtNow.day_of_week == 5 && dtNow.hour >= InpFridayHour)
   {
      if(CountMyPositions() > 0) { CloseAll(); Print("WEEKEND: All closed"); }
      return;
   }

   // Equity protection
   double equity = accInfo.Equity();
   if(equity < initialBalance * InpEquityProtect / 100.0)
   {
      CloseAll();
      Print("EQUITY PROTECT: Closing all. Equity=$", DoubleToString(equity, 2));
      return;
   }

   // Daily loss limit
   if(dailyLimitHit) return;
   double dailyPnL = equity - dailyStartEquity;
   if(dailyPnL < -(dailyStartEquity * InpDailyLossLimit / 100.0))
   {
      dailyLimitHit = true;
      Print("DAILY LIMIT: Loss $", DoubleToString(dailyPnL, 2), " - stopping for today");
      return;
   }

   // Spread check
   double spread = SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   if(spread > InpMaxSpread) return; // silent - spread changes fast

   // New M5 bar only
   static datetime lastBar = 0;
   datetime curBar = iTime(Symbol(), PERIOD_M5, 0);
   if(curBar == lastBar) return;
   lastBar = curBar;

   // Load indicator data
   if(CopyBuffer(hEMAFast, 0, 0, 5, bufEMAFast) < 5) { Print("WARN: EMA fast data not ready"); return; }
   if(CopyBuffer(hEMASlow, 0, 0, 5, bufEMASlow) < 5) { Print("WARN: EMA slow data not ready"); return; }
   if(CopyBuffer(hRSI, 0, 0, 5, bufRSI) < 5)         { Print("WARN: RSI data not ready"); return; }
   if(CopyBuffer(hATR, 0, 0, 5, bufATR) < 5)          { Print("WARN: ATR data not ready"); return; }

   // Manage existing trades (trailing stop)
   ManagePositions();

   // Can we open?
   if(CountMyPositions() >= InpMaxOpenTrades)
   {
      Print("SCAN: Max positions open (", CountMyPositions(), "/", InpMaxOpenTrades, ")");
      return;
   }
   if(todayTradeCount >= InpMaxTradesPerDay)
   {
      Print("SCAN: Max trades today (", todayTradeCount, "/", InpMaxTradesPerDay, ")");
      return;
   }

   // === GENERATE SIGNAL ===
   double emaFast = bufEMAFast[1];
   double emaSlow = bufEMASlow[1];
   double rsi     = bufRSI[1];
   double atr     = bufATR[1];
   double close1  = iClose(Symbol(), PERIOD_M5, 1);
   double close2  = iClose(Symbol(), PERIOD_M5, 2);
   double open1   = iOpen(Symbol(), PERIOD_M5, 1);

   int signal = 0;
   string reason = "";

   // --- TREND BUY: EMA fast > slow + price above fast EMA ---
   if(emaFast > emaSlow && close1 > emaFast && rsi > 40 && rsi < 75)
   {
      signal = 1;
      reason = "TREND BUY: EMA21>50, Price>EMA, RSI=" + DoubleToString(rsi, 1);
   }
   // --- TREND SELL: EMA fast < slow + price below fast EMA ---
   else if(emaFast < emaSlow && close1 < emaFast && rsi > 25 && rsi < 60)
   {
      signal = -1;
      reason = "TREND SELL: EMA21<50, Price<EMA, RSI=" + DoubleToString(rsi, 1);
   }
   // --- RANGE BUY: RSI oversold + bullish candle ---
   else if(rsi < 30 && close1 > open1)
   {
      signal = 1;
      reason = "RANGE BUY: RSI oversold=" + DoubleToString(rsi, 1);
   }
   // --- RANGE SELL: RSI overbought + bearish candle ---
   else if(rsi > 70 && close1 < open1)
   {
      signal = -1;
      reason = "RANGE SELL: RSI overbought=" + DoubleToString(rsi, 1);
   }

   // === EXECUTE OR LOG ===
   if(signal != 0)
   {
      Print(">>> SIGNAL: ", reason);
      OpenTrade(signal, atr, reason);
   }
   else
   {
      // Log every bar so user can see bot is scanning
      Print("SCAN: No setup | EMA21=", DoubleToString(emaFast, 2),
            " EMA50=", DoubleToString(emaSlow, 2),
            " RSI=", DoubleToString(rsi, 1),
            " Spread=", DoubleToString(spread, 0));
   }

   UpdateDashboard(emaFast, emaSlow, rsi, atr, spread);
}

//+------------------------------------------------------------------+
//| OPEN TRADE                                                       |
//+------------------------------------------------------------------+
void OpenTrade(int signal, double atr, string reason)
{
   int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double point = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   long stopLevel = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = stopLevel * point;

   double price, sl, tp, slDist;

   if(signal == 1) // BUY
   {
      price = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
      if(price <= 0) { Print("ERROR: Ask price = 0"); return; }

      slDist = MathMax(atr * InpSLMultiplier, minDist);
      sl = NormalizeDouble(price - slDist, digits);
      tp = NormalizeDouble(price + slDist * InpTPMultiplier, digits);
   }
   else // SELL
   {
      price = SymbolInfoDouble(Symbol(), SYMBOL_BID);
      if(price <= 0) { Print("ERROR: Bid price = 0"); return; }

      slDist = MathMax(atr * InpSLMultiplier, minDist);
      sl = NormalizeDouble(price + slDist, digits);
      tp = NormalizeDouble(price - slDist * InpTPMultiplier, digits);
   }

   // Lot sizing
   double balance    = accInfo.Balance();
   double riskAmount = balance * InpRiskPercent / 100.0;
   double tickValue  = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize   = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   double minLot     = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
   double maxLot     = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
   double lotStep    = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);

   if(tickValue <= 0 || tickSize <= 0 || slDist <= 0)
   {
      Print("ERROR: Invalid lot calc params. TV=", tickValue, " TS=", tickSize, " SL=", slDist);
      return;
   }

   double lots = riskAmount / (slDist / tickSize * tickValue);
   lots = MathFloor(lots / lotStep) * lotStep;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   lots = NormalizeDouble(lots, 2);

   Print("EXECUTING: ", signal > 0 ? "BUY" : "SELL",
         " | Price=", DoubleToString(price, digits),
         " | SL=", DoubleToString(sl, digits),
         " | TP=", DoubleToString(tp, digits),
         " | Lots=", DoubleToString(lots, 2),
         " | Reason: ", reason);

   bool ok;
   if(signal == 1)
      ok = trade.Buy(lots, Symbol(), 0, sl, tp, "AIS|" + reason);
   else
      ok = trade.Sell(lots, Symbol(), 0, sl, tp, "AIS|" + reason);

   if(ok)
   {
      Print("TRADE OPENED: ", signal > 0 ? "BUY" : "SELL", " ", DoubleToString(lots, 2), " lots");
      todayTradeCount++;
   }
   else
   {
      Print("TRADE FAILED: Error=", GetLastError(),
            " RetCode=", trade.ResultRetcode(),
            " | Price=", DoubleToString(price, digits),
            " | SL=", DoubleToString(sl, digits),
            " | TP=", DoubleToString(tp, digits));
   }
}

//+------------------------------------------------------------------+
//| TRAILING STOP MANAGEMENT                                         |
//+------------------------------------------------------------------+
void ManagePositions()
{
   int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double atr = bufATR[1];

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != InpMagicNumber) continue;
      if(posInfo.Symbol() != Symbol()) continue;

      double curPrice = posInfo.PriceCurrent();
      double openPx   = posInfo.PriceOpen();
      double curSL    = posInfo.StopLoss();
      ulong  ticket   = posInfo.Ticket();

      if(posInfo.PositionType() == POSITION_TYPE_BUY)
      {
         // Trail once in profit by 1 ATR
         double newSL = NormalizeDouble(curPrice - atr * 1.2, digits);
         if(curPrice > openPx + atr && newSL > curSL && newSL > openPx)
            trade.PositionModify(ticket, newSL, posInfo.TakeProfit());
      }
      else
      {
         double newSL = NormalizeDouble(curPrice + atr * 1.2, digits);
         if(curPrice < openPx - atr && newSL < curSL && newSL < openPx)
            trade.PositionModify(ticket, newSL, posInfo.TakeProfit());
      }
   }
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
            if(profit > 0) wins++;
            else losses++;
            Print("TRADE CLOSED: ", profit > 0 ? "WIN" : "LOSS",
                  " $", DoubleToString(profit, 2),
                  " | Total: ", totalTrades, " W:", wins, " L:", losses);
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
            trade.PositionClose(posInfo.Ticket());
   }
}

//+------------------------------------------------------------------+
//| DASHBOARD                                                        |
//+------------------------------------------------------------------+
void UpdateDashboard(double emaF, double emaS, double rsi, double atr, double spread)
{
   double equity  = accInfo.Equity();
   double balance = accInfo.Balance();
   double dailyPnL= equity - dailyStartEquity;
   double wr = totalTrades > 0 ? (double)wins / totalTrades * 100 : 0;

   string dir = emaF > emaS ? "BULLISH" : emaF < emaS ? "BEARISH" : "FLAT";

   string d = "\n";
   d += "========================================\n";
   d += "  XauAI SNIPER v3.0 | LICENSED\n";
   d += "========================================\n";
   d += StringFormat("Balance: $%.2f | Equity: $%.2f\n", balance, equity);
   d += StringFormat("Daily P/L: $%.2f\n", dailyPnL);
   d += "----------------------------------------\n";
   d += StringFormat("EMA21: %.2f | EMA50: %.2f\n", emaF, emaS);
   d += StringFormat("Trend: %s | RSI: %.1f\n", dir, rsi);
   d += StringFormat("ATR: %.2f | Spread: %.0f\n", atr, spread);
   d += "----------------------------------------\n";
   d += StringFormat("Open: %d/%d | Today: %d/%d\n",
        CountMyPositions(), InpMaxOpenTrades, todayTradeCount, InpMaxTradesPerDay);
   d += StringFormat("Trades: %d | Win Rate: %.1f%%\n", totalTrades, wr);
   d += "========================================\n";

   if(dailyLimitHit) d += "!! DAILY LIMIT REACHED !!\n";

   Comment(d);
}
//+------------------------------------------------------------------+
