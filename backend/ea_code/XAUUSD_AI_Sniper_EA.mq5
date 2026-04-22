//+------------------------------------------------------------------+
//|                                     XAUUSD_AI_Sniper_EA.mq5      |
//|                                     QuantPerp XAU Edition         |
//|                                     v4.0 — 5-Gate + Smart Exits  |
//+------------------------------------------------------------------+
#property copyright "AI Sniper × QuantPerp"
#property link      "https://xauaisniper.com"
#property version   "4.00"
#property description "XAUUSD AI Sniper v4.0 — QuantPerp Architecture"
#property description "5-Gate Entry | 3-Path Exit | Claude + GPT-5.2"
#property description "8 Market Regimes | 7 Setup Patterns | Learning Loop"
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
input double InpDailyLossLimit = 6.0;      // Daily loss cap (%) — QuantPerp uses 6%
input int    InpMaxOpenTrades  = 5;        // Max open positions
input int    InpMaxTradesPerDay= 30;       // No artificial limit until target
input double InpWeeklyTarget   = 50.0;     // Weekly profit target (%)
input double InpWeeklyMaxLoss  = 15.0;     // Weekly max loss (%)
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

input group "=== SAFETY ==="
input double InpMaxSpread      = 150.0;    // Max spread (points)
input double InpEquityProtect  = 70.0;     // Equity protection (%)
input bool   InpWeekendClose   = true;     // Close Friday 20:00
input int    InpMagicNumber    = 20250401;

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
   LoadPatterns();

   Print("=== XAUAI SNIPER v4.0 (QUANTPERP) READY ===");
   Print("Balance: $", DoubleToString(initialBalance, 2), " | Risk: ", InpRiskPercent,
         "% | AI: ", InpUseAI ? "ON" : "OFF", " | ML: ", InpLearnPatterns ? "ON" : "OFF");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hEMAFast); IndicatorRelease(hEMASlow);
   IndicatorRelease(hRSI); IndicatorRelease(hATR); IndicatorRelease(hBBUpper);
   IndicatorRelease(hEMAFast_H1); IndicatorRelease(hEMASlow_H1); IndicatorRelease(hRSI_M15);
   IndicatorRelease(hStoch);
   SavePatterns();
   Print("=== v4.0 STOPPED | Trades:", totalTrades, " W:", wins, " L:", losses, " ===");
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
   bool squeeze = bbWidth < prevBBWidth * 0.7;
   bool expanding = bbWidth > prevBBWidth * 1.3;

   double emaDiff = MathAbs(emaF - emaS) / emaS * 100;
   bool mtfAligned = (emaF > emaS && h1F > h1S) || (emaF < emaS && h1F < h1S);

   // DEAD: ATR < 0.04%
   if(atrPct < 0.04) { currentRegime = REGIME_DEAD; return 0.05; }

   // BREAKOUT: BB squeeze releasing + price outside bands
   if(expanding && close1 > bbU) { currentRegime = REGIME_BREAKOUT_UP; return 0.75; }
   if(expanding && close1 < bbL) { currentRegime = REGIME_BREAKOUT_DOWN; return 0.75; }

   // LOW VOL: ATR < 0.12%
   if(atrPct < 0.12) { currentRegime = REGIME_LOW_VOL; return 0.55; }

   // CHOPPY: EMAs close + no MTF alignment
   if(emaDiff < 0.03 && !mtfAligned) { currentRegime = REGIME_CHOPPY; return 0.30; }

   // TRENDING: Clear EMA separation + MTF aligned
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

   // RANGING: Everything else
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
int RsiBucket(double r)   { if(r<20) return 0; if(r<40) return 1; if(r<60) return 2; if(r<80) return 3; return 4; }
int StochBucket(double s) { if(s<20) return 0; if(s<40) return 1; if(s<60) return 2; if(s<80) return 3; return 4; }
// Momentum bucket: price change over 5 bars, normalised by ATR
int MomBucket(double mom, double atr)
{
   if(atr <= 0) return 2;
   double m = mom / atr;
   if(m < -0.8) return 0;
   if(m < -0.2) return 1;
   if(m <  0.2) return 2;
   if(m <  0.8) return 3;
   return 4;
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
//| GATE 2: SESSION FILTER (UTC)                                     |
//+------------------------------------------------------------------+
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
         if(lowerWick > body * 0.5) s += 1.5; // rejection wick
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
         if(upperWick > body * 0.5) s += 1.5;
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
      if(rsi < 25 && close1 > open1) { dir = 1; s = 2.0 + (close1 > emaF ? 1.0 : 0) + (m15RSI < 30 ? 1.0 : 0) + (lowerWick > body ? 1.0 : 0); }
      if(rsi > 75 && close1 < open1) { dir = -1; s = 2.0 + (close1 < emaF ? 1.0 : 0) + (m15RSI > 70 ? 1.0 : 0) + (upperWick > body ? 1.0 : 0); }
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
         dir = 1; s = 2.5 + (lowerWick > body * 0.5 ? 1.0 : 0) + (close1 > open1 ? 1.0 : 0);
      }
      if(rsi > 72 && close1 > bbU - (bbU - bbL) * 0.15 && m15RSI > 65)
      {
         dir = -1; s = 2.5 + (upperWick > body * 0.5 ? 1.0 : 0) + (close1 < open1 ? 1.0 : 0);
      }
      if(s > bestScore && dir != 0) { bestScore = s; bestDir = dir; bestName = "MULTI_EXTREME"; bestType = 7; }
   }

   score = bestScore;
   setupName = bestName;
   lastSetupType = bestType;
   lastRegime = (int)currentRegime;
   return bestDir;
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

   // Equity/daily/weekly limits
   double equity = accInfo.Equity();
   if(equity < initialBalance * InpEquityProtect / 100.0)
   { CloseAll(); Print("EQUITY PROTECT"); return; }

   double weeklyPnL = equity - weeklyStartEquity;
   if(weeklyPnL >= weeklyStartEquity * InpWeeklyTarget / 100.0)
   { if(!weeklyTargetHit) { CloseAll(); Print("WEEKLY TARGET HIT: +$", DoubleToString(weeklyPnL, 2)); } weeklyTargetHit = true; return; }
   if(weeklyPnL < -(weeklyStartEquity * InpWeeklyMaxLoss / 100.0))
   { if(!weeklyLossHit) { CloseAll(); Print("WEEKLY LOSS LIMIT"); } weeklyLossHit = true; return; }

   double dailyPnL = equity - dailyStartEquity;
   if(dailyPnL < -(dailyStartEquity * InpDailyLossLimit / 100.0))
   { if(!dailyLimitHit) Print("DAILY LIMIT: -$", DoubleToString(MathAbs(dailyPnL), 2));
     dailyLimitHit = true; if(CountMyPositions() > 0) CloseAll(); return; }

   // === ALWAYS MANAGE OPEN POSITIONS (every tick, even on wide spread) ===
   // We intentionally run this BEFORE the spread gate so that news-time
   // spread spikes cannot prevent us from closing losing positions.
   ManagePositions();

   // Spread check — blocks NEW ENTRIES only (silent)
   double spread = (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   if(spread > InpMaxSpread) return;

   // New M5 bar only for entries
   static datetime lastBar = 0;
   datetime curBar = iTime(Symbol(), PERIOD_M5, 0);
   if(curBar == lastBar) return;
   lastBar = curBar;

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
   { UpdateDashboard(0, 0, ""); return; }

   // Cooldown
   if(lastTradeClose > 0 && TimeCurrent() - lastTradeClose < 300) // 5min
   { UpdateDashboard(0, 0, ""); return; }

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
   string grade = combinedScore >= 5.5 ? "A+" : combinedScore >= 4.0 ? "A" : combinedScore >= 2.5 ? "B" : "PASS";

   if(signal == 0 || combinedScore < 2.5)
   {
      Print("SCAN: ", RegimeName(), " | Session:", DoubleToString(sessionQuality, 2),
            " | Setup:", setupName, " Score:", DoubleToString(setupScore, 1),
            " Combined:", DoubleToString(combinedScore, 1), " [", grade, "] — PASS");
      UpdateDashboard(0, combinedScore, grade);
      return;
   }

   Print("SIGNAL: ", setupName, " ", signal > 0 ? "BUY" : "SELL",
         " | Regime:", RegimeName(), "(", DoubleToString(regimeQuality, 2), ")",
         " | Session:", DoubleToString(sessionQuality, 2),
         " | Score:", DoubleToString(setupScore, 1),
         " | Combined:", DoubleToString(combinedScore, 1), " [", grade, "]");

   // News check
   if(InpUseNewsFilter && !IsNewsSafe()) { Print("NEWS BLOCK"); return; }

   // Anti-reversal (short cooldown for direction flip)
   if(lastTradeDir != 0 && signal != lastTradeDir && lastTradeClose > 0 &&
      TimeCurrent() - lastTradeClose < 600)
   { Print("ANTI-REVERSAL: Wait before flipping direction"); return; }

   // Build exact signature for ML lookup + hive + journal
   string signature = BuildSignature(signal, setupName);

   // ============ GATE 4: RISK SIZING ============
   double sizeMulti = grade == "A+" ? 1.0 : grade == "A" ? 0.85 : 0.55;
   int    confidenceBoostPP = 0;   // in percentage points, informational

   // ----- LOCAL ML (exact-signature match) -----
   if(InpLearnPatterns && patternCount >= 5)
   {
      double mlScore = GetMLScore(signal, bufRSI[1],
         (bufEMAFast[1] - bufEMASlow[1]) / bufEMASlow[1] * 10000,
         dtNow.hour, dtNow.day_of_week);
      if(mlScore <= 0.30 && patternCount >= 5)
      { Print("LOCAL ML VETO: WR=", DoubleToString(mlScore * 100, 0), "% — HARD BLOCK"); return; }
      if(mlScore >= 0.60) { sizeMulti += 0.15; confidenceBoostPP += 8; }
   }

   // ----- GLOBAL HIVE-MIND (7-day, all users, same signature) -----
   int hive = GetHiveVerdict(signature);
   if(hive == -1)
   { Print("HIVE VETO: signature ", signature, " has WR <= 30% globally — HARD BLOCK"); return; }
   if(hive == 1)
   { Print("HIVE BOOST: signature ", signature, " has WR >= 60% globally (+8pp)");
     sizeMulti += 0.15; confidenceBoostPP += 8; }

   // ============ GATE 5: DUAL-AI ENTRY (Claude 4.5 + GPT-5.2) ============
   if(grade == "A+" && InpUseAI && StringLen(InpServerURL) >= 10)
   {
      int aiResult = GetAIAnalysis(bufEMAFast[1], bufEMASlow[1], bufRSI[1], bufATR[1],
         iClose(Symbol(), PERIOD_M5, 0),
         bufEMAFast_H1[1] > bufEMASlow_H1[1] ? "BULL" : "BEAR", spread,
         setupName, RegimeName(), signature,
         ArraySize(bufStochK) >= 2 ? bufStochK[1] : 50.0,
         iClose(Symbol(), PERIOD_M5, 1) - iClose(Symbol(), PERIOD_M5, 5));
      if(aiResult == 0)
      { Print("DUAL-AI: SKIP — reducing to B size"); sizeMulti = MathMin(sizeMulti, 0.55); }
      else if(aiResult != signal)
      { Print("DUAL-AI: Disagrees — reducing to B size"); sizeMulti = MathMin(sizeMulti, 0.55); }
      else
      { Print("DUAL-AI: Confirms ", signal > 0 ? "BUY" : "SELL"); }
   }

   // Store signal context for ML + journal logging
   lastSignalDir = signal;
   lastSignalRSI = bufRSI[1];
   lastSignalEMADiff = (bufEMAFast[1] - bufEMASlow[1]) / bufEMASlow[1] * 10000;
   lastSignalATR = bufATR[1];
   lastSignalSetup = setupName;
   lastSignalSignature = signature;

   // Open trade with grade-scaled sizing
   OpenTrade(signal, bufATR[1], setupName + " [" + grade + "]", sizeMulti);
   UpdateDashboard(signal, combinedScore, grade);
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
   lots = NormalizeDouble(lots, 2);

   // Margin check
   double freeMargin = accInfo.FreeMargin();
   double marginNeeded = 0;
   if(OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded))
   {
      while(lots > minLot && marginNeeded > freeMargin * 0.5)
      {
         lots -= lotStep; lots = MathMax(minLot, lots);
         OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded);
      }
      if(marginNeeded > freeMargin * 0.8) { Print("NO MARGIN"); return; }
   }
   lots = NormalizeDouble(lots, 2);

   Print("EXECUTING: ", signal > 0 ? "BUY" : "SELL",
         " Price=", DoubleToString(price, digits),
         " SL=", DoubleToString(sl, digits),
         " TP=", DoubleToString(tp, digits),
         " Lots=", DoubleToString(lots, 2),
         " | ", reason);

   bool ok;
   if(signal == 1) ok = trade.Buy(lots, Symbol(), 0, sl, tp, "XAU-SNIPER|" + reason);
   else ok = trade.Sell(lots, Symbol(), 0, sl, tp, "XAU-SNIPER|" + reason);

   if(ok) { todayTradeCount++; lastTradeDir = signal; }
   else Print("TRADE FAILED: Err=", GetLastError(), " Ret=", trade.ResultRetcode());
}

//+------------------------------------------------------------------+
//| 3-PATH SMART EXIT SYSTEM                                         |
//| Path A: Deterministic | Path B: Smart | Path C: Claude           |
//+------------------------------------------------------------------+
void ManagePositions()
{
   int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   if(ArraySize(bufATR) < 2 || bufATR[1] <= 0) return;
   double atr = bufATR[1];
   double rsi = ArraySize(bufRSI) >= 2 ? bufRSI[1] : 50;
   double emaF = ArraySize(bufEMAFast) >= 2 ? bufEMAFast[1] : 0;
   double emaS = ArraySize(bufEMASlow) >= 2 ? bufEMASlow[1] : 0;
   double close1 = iClose(Symbol(), PERIOD_M5, 1);
   double open1 = iOpen(Symbol(), PERIOD_M5, 1);

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
      // 1R$ = lots * (slDist / tickSize) * tickValue
      double tickValue = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
      double tickSize  = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
      double lotsOpen  = posInfo.Volume();
      double rDollars  = (tickSize > 0 && tickValue > 0)
                         ? lotsOpen * (slDist / tickSize) * tickValue
                         : MathMax(30.0, MathAbs(profit));

      // ===== PATH A: DETERMINISTIC (SL/TP/Trail) =====
      // Trail at 1.2x ATR behind price (M5 gold — typical ATR $1-$3)
      double trailDist = MathMax(atr * 1.2, SymbolInfoDouble(Symbol(), SYMBOL_POINT) * 200);
      if(isBuy && profit > 0)
      {
         double newSL = NormalizeDouble(curPrice - trailDist, digits);
         if(newSL > curSL && newSL > openPx)
            trade.PositionModify(ticket, newSL, curTP);
      }
      if(!isBuy && profit > 0)
      {
         double newSL = NormalizeDouble(curPrice + trailDist, digits);
         if(newSL < curSL && newSL < openPx)
            trade.PositionModify(ticket, newSL, curTP);
      }

      // ===== PATH B: SMART MANAGEMENT =====

      // B1: Breakeven lock at +0.5R (in PRICE)
      double halfR = slDist * 0.5;
      if(isBuy && curPrice > openPx + halfR && curSL < openPx)
      {
         double beSL = NormalizeDouble(openPx + SymbolInfoDouble(Symbol(), SYMBOL_POINT) * 20, digits);
         trade.PositionModify(ticket, beSL, curTP);
         Print("BE LOCK: #", ticket, " at +0.5R — risk free");
      }
      if(!isBuy && curPrice < openPx - halfR && curSL > openPx)
      {
         double beSL = NormalizeDouble(openPx - SymbolInfoDouble(Symbol(), SYMBOL_POINT) * 20, digits);
         trade.PositionModify(ticket, beSL, curTP);
         Print("BE LOCK: #", ticket, " at +0.5R — risk free");
      }

      // B2: Quick profit take ($150-500, faster on M5 gold)
      if(profit >= 150)
      {
         bool momentumFading = false;
         if(isBuy && (rsi > 70 || close1 < open1 || close1 < emaF)) momentumFading = true;
         if(!isBuy && (rsi < 30 || close1 > open1 || close1 > emaF)) momentumFading = true;

         if(profit >= 500 || momentumFading || minsOpen > 18)
         {
            Print("QUICK PROFIT: #", ticket, " +$", DoubleToString(profit, 2), " (", minsOpen, "min)");
            trade.PositionClose(ticket); continue;
         }
      }

      // B3: Smart loss cut
      if(profit < -100)
      {
         bool noRecovery = false;
         if(isBuy && rsi < 35 && close1 < emaF) noRecovery = true;
         if(!isBuy && rsi > 65 && close1 > emaF) noRecovery = true;
         if(noRecovery || (profit < -200 && minsOpen > 15))
         {
            Print("SMART CUT: #", ticket, " $", DoubleToString(profit, 2), " — ", noRecovery ? "no recovery" : "time+loss");
            trade.PositionClose(ticket); continue;
         }
      }

      // B4: Stale exit — QuantPerp caps (compare DOLLARS to DOLLARS)
      int staleCap = (currentRegime == REGIME_LOW_VOL || currentRegime == REGIME_CHOPPY) ? 35 : 90;
      if(minsOpen > staleCap && profit <= -(rDollars * 0.6))
      {
         Print("STALE EXIT: #", ticket, " open ", minsOpen, "min > cap ", staleCap, " with -$", DoubleToString(MathAbs(profit), 2), " (0.6R=$", DoubleToString(rDollars*0.6, 2), ")");
         trade.PositionClose(ticket); continue;
      }
      if(minsOpen > 30 && MathAbs(profit) < 30)
      {
         Print("STALE DRIFT: #", ticket, " — ", minsOpen, "min, $", DoubleToString(profit, 2), " — going nowhere");
         trade.PositionClose(ticket); continue;
      }

      // ===== PATH C: CLAUDE SEMANTIC EXIT (A+ only, every 10 min) =====
      static datetime lastClaudeCheck = 0;
      if(InpUseAI && StringLen(InpServerURL) >= 10 && minsOpen >= 3 && // 3min grace period
         TimeCurrent() - lastClaudeCheck > 600)
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
               Print("CLAUDE EXIT BLOCKED: Losing -$", DoubleToString(MathAbs(profit), 2), " < 0.3R=$", DoubleToString(rDollars*0.3, 2), " — letting SL handle");
            }
            else
            {
               Print("CLAUDE EXIT: #", ticket, " $", DoubleToString(profit, 2));
               trade.PositionClose(ticket); continue;
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| AI FUNCTIONS                                                     |
//+------------------------------------------------------------------+
int GetAIAnalysis(double emaF, double emaS, double rsi, double atr, double price, string h1Dir, double spread,
                  string setup, string regime, string signature, double stoch, double mom)
{
   if(!InpUseAI || StringLen(InpServerURL) < 10) return 0;
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
   // Response shape: {"action":"BUY|SELL|SKIP",...,"claude":{...},"gpt":{...}}
   // Match only the top-level "action" field
   int actIdx = StringFind(response, "\"action\":");
   if(actIdx < 0) return 0;
   string tail = StringSubstr(response, actIdx, 40);
   if(StringFind(tail, "\"BUY\"")  >= 0) return 1;
   if(StringFind(tail, "\"SELL\"") >= 0) return -1;
   return 0;
}

int CheckPositionWithAI(string dir, double entry, double current, double profit, double lots,
                         double rsi, double emaF, double emaS, double atr, int minsOpen, double sl, double tp)
{
   if(StringLen(InpServerURL) < 10) return 0;
   string url = InpServerURL + "/api/ai/manage-position";
   string headers = "Content-Type: application/json\r\n";
   string body = StringFormat("{\"direction\":\"%s\",\"entry_price\":%.2f,\"current_price\":%.2f,\"profit\":%.2f,\"lots\":%.2f,\"rsi\":%.1f,\"ema_fast\":%.2f,\"ema_slow\":%.2f,\"atr\":%.2f,\"minutes_open\":%d,\"sl\":%.2f,\"tp\":%.2f}",
      dir, entry, current, profit, lots, rsi, emaF, emaS, atr, minsOpen, sl, tp);
   char postData[], result[]; string rh;
   StringToCharArray(body, postData, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 10000, postData, result, rh);
   if(res != 200) return 0;
   string response = CharArrayToString(result);
   if(StringFind(response, "\"CLOSE\"") >= 0) { Print("CLAUDE: ", response); return -1; }
   return 0;
}

bool IsNewsSafe()
{
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
double GetMLScore(int dir, double rsi, double emaDiff, int hour, int dow)
{
   if(patternCount < 10) return 0.5;
   int matches = 0, matchWins = 0;
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
   if(patternCount >= InpMaxPatterns)
   { for(int i = 0; i < patternCount - 1; i++) patterns[i] = patterns[i+1]; patternCount--; }
   ArrayResize(patterns, patternCount + 1);
   patterns[patternCount] = p; patternCount++;
   Print("ML: #", patternCount, " ", wasWin ? "WIN" : "LOSS", " $", DoubleToString(profit, 2));
   if(patternCount % 5 == 0) SavePatterns();
}

//+------------------------------------------------------------------+
//| SAVE/LOAD PATTERNS (Cloud + Local)                               |
//+------------------------------------------------------------------+
void SavePatterns()
{
   if(patternCount == 0) return;
   // Local backup
   string fn = "AIS_Patterns_" + Symbol() + ".bin";
   int h = FileOpen(fn, FILE_WRITE | FILE_BIN);
   if(h != INVALID_HANDLE)
   {
      FileWriteInteger(h, patternCount);
      for(int i = 0; i < patternCount; i++)
      {
         FileWriteInteger(h, patterns[i].direction); FileWriteDouble(h, patterns[i].emaDiff);
         FileWriteDouble(h, patterns[i].rsi); FileWriteDouble(h, patterns[i].atr);
         FileWriteInteger(h, patterns[i].hour); FileWriteInteger(h, patterns[i].dayOfWeek);
         FileWriteInteger(h, patterns[i].regime); FileWriteInteger(h, patterns[i].setupType);
         FileWriteInteger(h, patterns[i].wasWinner ? 1 : 0); FileWriteDouble(h, patterns[i].profit);
      }
      FileClose(h);
   }
   // Cloud save
   if(StringLen(InpServerURL) >= 10)
   {
      string url = InpServerURL + "/api/ml/patterns/save";
      string headers = "Content-Type: application/json\r\n";
      string jp = "[";
      for(int i = 0; i < patternCount; i++)
      {
         if(i > 0) jp += ",";
         jp += StringFormat("{\"d\":%d,\"ed\":%.4f,\"r\":%.1f,\"a\":%.2f,\"h\":%d,\"dw\":%d,\"rg\":%d,\"st\":%d,\"w\":%d,\"p\":%.2f}",
            patterns[i].direction, patterns[i].emaDiff, patterns[i].rsi, patterns[i].atr,
            patterns[i].hour, patterns[i].dayOfWeek, patterns[i].regime, patterns[i].setupType,
            patterns[i].wasWinner ? 1 : 0, patterns[i].profit);
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
   // Try cloud first
   if(StringLen(InpServerURL) >= 10)
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
   // Local fallback
   string fn = "AIS_Patterns_" + Symbol() + ".bin";
   if(!FileIsExist(fn)) { Print("ML: Fresh start"); return; }
   int h = FileOpen(fn, FILE_READ | FILE_BIN);
   if(h == INVALID_HANDLE) return;
   patternCount = FileReadInteger(h);
   ArrayResize(patterns, patternCount);
   for(int i = 0; i < patternCount; i++)
   {
      patterns[i].direction = FileReadInteger(h); patterns[i].emaDiff = FileReadDouble(h);
      patterns[i].rsi = FileReadDouble(h); patterns[i].atr = FileReadDouble(h);
      patterns[i].hour = FileReadInteger(h); patterns[i].dayOfWeek = FileReadInteger(h);
      patterns[i].regime = FileReadInteger(h); patterns[i].setupType = FileReadInteger(h);
      patterns[i].wasWinner = FileReadInteger(h) == 1; patterns[i].profit = FileReadDouble(h);
   }
   FileClose(h);
   Print("ML LOCAL: Loaded ", patternCount, " patterns");
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
   if(profit > 0) wins++; else losses++;
   lastTradeClose = TimeCurrent();
   Print("CLOSED: ", profit > 0 ? "WIN" : "LOSS", " $", DoubleToString(profit, 2),
         " | T:", totalTrades, " W:", wins, " L:", losses);
   RecordPattern(profit > 0, profit);
   LogTradeToServer(profit > 0 ? "WIN" : "LOSS", dPrice, profit, dVolume, dirStr);
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
   d += " XAUAI SNIPER v4.0 | QUANTPERP | LICENSED\n";
   d += "==========================================\n";
   d += StringFormat("Bal: $%.0f | Eq: $%.0f\n", bal, eq);
   d += StringFormat("Daily: $%.0f | Weekly: $%.0f (%.1f%%/%.0f%%)\n", dPnL, wPnL, weeklyStartEquity > 0 ? wPnL/weeklyStartEquity*100 : 0.0, InpWeeklyTarget);
   d += "------------------------------------------\n";
   d += StringFormat("Regime: %s | Session: %.2f\n", RegimeName(), GetSessionQuality());
   d += StringFormat("RSI: %.1f | ATR: %.2f | Spread: %.0f\n", bufRSI[1], bufATR[1], (double)SymbolInfoInteger(Symbol(), SYMBOL_SPREAD));
   d += StringFormat("Last Score: %.1f [%s]\n", score, grade);
   d += "------------------------------------------\n";
   d += StringFormat("Open: %d/%d | Today: %d/%d\n", CountMyPositions(), InpMaxOpenTrades, todayTradeCount, InpMaxTradesPerDay);
   d += StringFormat("Trades: %d | Win: %.0f%% | ML: %d\n", totalTrades, wr, patternCount);
   d += StringFormat("AI: %s | News: %s | Careful: %s\n", InpUseAI?"ON":"OFF", InpUseNewsFilter?"ON":"OFF", InpCarefulMode?"ON":"OFF");
   d += "==========================================\n";
   if(weeklyTargetHit) d += ">> WEEKLY TARGET HIT — RESTING <<\n";
   if(weeklyLossHit) d += "!! WEEKLY LOSS LIMIT — STOPPED !!\n";
   if(dailyLimitHit) d += "!! DAILY LIMIT — CLOSED ALL !!\n";
   Comment(d);
}
//+------------------------------------------------------------------+
