// Fallback broker→servers list. The dashboard tries /api/cloud/mt5/brokers
// first, then falls back to this list if the API is missing/empty/older.
// Sourced from each broker's published MT5 server list + the public TradeVPS
// broker directory (https://broker-servers.apis.tradevps.net/).
export const FALLBACK_BROKER_SERVERS = [
  // MetaQuotes
  { broker: "MetaQuotes",        server: "MetaQuotes-Demo",                type: "demo" },
  // Exness
  { broker: "Exness",            server: "Exness-MT5Real",                 type: "live" },
  { broker: "Exness",            server: "Exness-MT5Real2",                type: "live" },
  { broker: "Exness",            server: "Exness-MT5Real8",                type: "live" },
  { broker: "Exness",            server: "Exness-MT5Real16",               type: "live" },
  { broker: "Exness",            server: "Exness-MT5Real26",               type: "live" },
  { broker: "Exness",            server: "Exness-MT5Trial",                type: "demo" },
  { broker: "Exness",            server: "Exness-MT5Trial4",               type: "demo" },
  { broker: "Exness",            server: "Exness-MT5Trial14",              type: "demo" },
  // IC Markets
  { broker: "IC Markets",        server: "ICMarketsSC-MT5",                type: "live" },
  { broker: "IC Markets",        server: "ICMarketsSC-MT5-2",              type: "live" },
  { broker: "IC Markets",        server: "ICMarketsSC-MT5-4",              type: "live" },
  { broker: "IC Markets",        server: "ICMarketsSC-Demo",               type: "demo" },
  { broker: "IC Markets",        server: "ICMarketsSC-Demo03",             type: "demo" },
  { broker: "IC Markets EU",     server: "ICMarketsEU-MT5",                type: "live" },
  { broker: "IC Markets EU",     server: "ICMarketsEU-MT5-2",              type: "live" },
  { broker: "IC Markets EU",     server: "ICMarketsEU-Demo",               type: "demo" },
  // Pepperstone
  { broker: "Pepperstone",       server: "Pepperstone-MT5-Live",           type: "live" },
  { broker: "Pepperstone",       server: "Pepperstone-MT5-Live02",         type: "live" },
  { broker: "Pepperstone",       server: "Pepperstone-Demo",               type: "demo" },
  // FBS
  { broker: "FBS",               server: "FBS-Real",                       type: "live" },
  { broker: "FBS",               server: "FBS-Demo",                       type: "demo" },
  // XM
  { broker: "XM",                server: "XMGlobal-MT5",                   type: "live" },
  { broker: "XM",                server: "XMGlobal-MT5 2",                 type: "live" },
  { broker: "XM",                server: "XMGlobal-MT5 3",                 type: "live" },
  { broker: "XM",                server: "XMGlobal-Demo",                  type: "demo" },
  { broker: "XM",                server: "XMTrading-MT5",                  type: "live" },
  { broker: "XM",                server: "XMTrading-MT5 2",                type: "live" },
  { broker: "XM",                server: "XMTrading-Demo",                 type: "demo" },
  // OctaFX / Octa
  { broker: "OctaFX",            server: "OctaFX-Real",                    type: "live" },
  { broker: "OctaFX",            server: "OctaFX-Demo",                    type: "demo" },
  { broker: "Octa",              server: "Octa-Real",                      type: "live" },
  { broker: "Octa",              server: "Octa-Demo",                      type: "demo" },
  // FxPro
  { broker: "FxPro",             server: "FxPro-MT5",                      type: "live" },
  { broker: "FxPro",             server: "FxPro-MT5 Live02",               type: "live" },
  { broker: "FxPro",             server: "FxPro-MT5 Demo",                 type: "demo" },
  // FTMO
  { broker: "FTMO",              server: "FTMO-Server",                    type: "live" },
  { broker: "FTMO",              server: "FTMO-Server2",                   type: "live" },
  { broker: "FTMO",              server: "FTMO-Demo",                      type: "demo" },
  // FundedNext
  { broker: "FundedNext",        server: "FundedNext-Server",              type: "live" },
  { broker: "FundedNext",        server: "FundedNext-Server 2",            type: "live" },
  { broker: "FundedNext",        server: "FundedNext-Server 3",            type: "live" },
  { broker: "FundedNext",        server: "FundedNext-Server 4",            type: "live" },
  // FundingPips
  { broker: "FundingPips",       server: "FundingPips2-SIM",               type: "live" },
  // RoboForex
  { broker: "RoboForex",         server: "RoboForex-ECN",                  type: "live" },
  { broker: "RoboForex",         server: "RoboForex-Pro",                  type: "live" },
  { broker: "RoboForex",         server: "RoboForex-Demo",                 type: "demo" },
  // Tickmill
  { broker: "Tickmill",          server: "Tickmill-Demo",                  type: "demo" },
  { broker: "Tickmill UK",       server: "TickmillUK-Live",                type: "live" },
  { broker: "Tickmill UK",       server: "TickmillUK-Demo",                type: "demo" },
  { broker: "Tickmill EU",       server: "TickmillEU-Live",                type: "live" },
  { broker: "Tickmill EU",       server: "TickmillEU-Demo",                type: "demo" },
  // Admirals
  { broker: "Admirals",          server: "AdmiralsGroup-Live",             type: "live" },
  { broker: "Admirals",          server: "AdmiralsGroup-Demo",             type: "demo" },
  { broker: "Admiral Markets",   server: "AdmiralMarkets-Live",            type: "live" },
  { broker: "Admiral Markets",   server: "AdmiralMarkets-Demo",            type: "demo" },
  // HFM (HotForex)
  { broker: "HFM",               server: "HFMarketsGlobal-Live",           type: "live" },
  { broker: "HFM",               server: "HFMarketsGlobal-Demo",           type: "demo" },
  { broker: "HFM",               server: "HFMarketsSV-Live",               type: "live" },
  { broker: "HFM",               server: "HFMarketsSV-Demo",               type: "demo" },
  // ThinkMarkets
  { broker: "ThinkMarkets",      server: "ThinkMarkets-Live",              type: "live" },
  { broker: "ThinkMarkets",      server: "ThinkMarkets-Demo",              type: "demo" },
  // Vantage
  { broker: "Vantage",           server: "VantageInternational-Live",      type: "live" },
  { broker: "Vantage",           server: "VantageInternational-Demo",      type: "demo" },
  // Eightcap
  { broker: "Eightcap",          server: "Eightcap-Live",                  type: "live" },
  { broker: "Eightcap",          server: "Eightcap-Demo",                  type: "demo" },
  // Deriv
  { broker: "Deriv",             server: "Deriv-Server",                   type: "live" },
  { broker: "Deriv",             server: "Deriv-Demo",                     type: "demo" },
  // BlackBull
  { broker: "BlackBull",         server: "BlackBullMarkets-Live",          type: "live" },
  { broker: "BlackBull",         server: "BlackBullMarkets-Demo",          type: "demo" },
  // Trade.com / Leadcapital
  { broker: "Trade.com",         server: "Trade-Live",                     type: "live" },
  { broker: "Trade.com",         server: "Trade-Demo",                     type: "demo" },
  { broker: "Trade.com",         server: "LeadCapitalMarkets-Live",        type: "live" },
  { broker: "Trade.com",         server: "LeadCapitalMarkets-Demo",        type: "demo" },
  { broker: "Trade.com",         server: "TradeCapitalMarkets-Live",       type: "live" },
  // OneRoyal
  { broker: "OneRoyal",          server: "OneRoyal-Live",                  type: "live" },
  { broker: "OneRoyal",          server: "OneRoyal-Demo",                  type: "demo" },
  { broker: "OneRoyal",          server: "RoyalMtPro-Live",                type: "live" },
  { broker: "OneRoyal",          server: "RoyalMtPro-Live01",              type: "live" },
  { broker: "OneRoyal",          server: "RoyalMtPro-Demo",                type: "demo" },
  // AvaTrade / ActivTrades
  { broker: "AvaTrade",          server: "AvaTrade-Real",                  type: "live" },
  { broker: "AvaTrade",          server: "AvaTrade-Demo",                  type: "demo" },
  { broker: "ActivTrades",       server: "ActivTrades-Server",             type: "live" },
  { broker: "ActivTrades",       server: "ActivTrades-Demo",               type: "demo" },
  // Just2Trade
  { broker: "Just2Trade",        server: "Just2Trade-MT5",                 type: "live" },
  { broker: "Just2Trade",        server: "Just2Trade-Demo",                type: "demo" },
  // FXTM
  { broker: "FXTM",              server: "ForexTime-Live01",               type: "live" },
  { broker: "FXTM",              server: "ForexTime-Live02",               type: "live" },
  { broker: "FXTM",              server: "ForexTime-Demo01",               type: "demo" },
  { broker: "FXTM",              server: "ForexTime-Demo02",               type: "demo" },
  { broker: "FXTM",              server: "ForexTimeFXTM-Live01",           type: "live" },
  { broker: "FXTM",              server: "ForexTimeFXTM-Demo01",           type: "demo" },
  // Alpari / AMarkets
  { broker: "Alpari",            server: "Alpari-MT5",                     type: "live" },
  { broker: "Alpari",            server: "Alpari-MT5-Demo",                type: "demo" },
  { broker: "AMarkets",          server: "AMarkets-Real",                  type: "live" },
  { broker: "AMarkets",          server: "AMarkets-Demo",                  type: "demo" },
  // FusionMarkets / LiteFinance
  { broker: "FusionMarkets",     server: "FusionMarkets-Live",             type: "live" },
  { broker: "FusionMarkets",     server: "FusionMarkets-Demo",             type: "demo" },
  { broker: "LiteFinance",       server: "LiteFinance-MT5-Live",           type: "live" },
  { broker: "LiteFinance",       server: "LiteFinance-MT5-Demo",           type: "demo" },
  // Errante / AronMarkets
  { broker: "Errante",           server: "ErranteSC-Live",                 type: "live" },
  { broker: "Errante",           server: "ErranteSC-Demo",                 type: "demo" },
  { broker: "Errante",           server: "ErranteTrading-Live",            type: "live" },
  { broker: "Errante",           server: "ErranteTrading-Demo",            type: "demo" },
  { broker: "AronMarkets",       server: "AronMarkets-MT5",                type: "live" },
  { broker: "AronMarkets",       server: "AronMarkets-Demo",               type: "demo" },
  // Misc smaller brokers
  { broker: "FIBO Group",        server: "FIBOGroup-MT5 Server",           type: "live" },
  { broker: "Orbex",             server: "OrbexGlobal-Server",             type: "live" },
  { broker: "Combat Capital",    server: "CombatCapitalMarkets-Server",    type: "live" },
  { broker: "Investment Castle", server: "InvestmentCastle-Server",        type: "live" },
  { broker: "EpicPips",          server: "EpicPips-Trade",                 type: "live" },
  { broker: "ePlanet",           server: "ePlanet-MT5",                    type: "live" },
  { broker: "GTC Global",        server: "GTCGlobalTrade-Server",          type: "live" },
  { broker: "Omega Finex",       server: "OmegaFinex-Real",                type: "live" },
  { broker: "Pivot Broker",      server: "PivotBroker-Live",               type: "live" },
  { broker: "Propridge",         server: "PropridgeCapitalMarkets-Server", type: "live" },
  { broker: "RavexGlobal",       server: "RavexGlobal-Live",               type: "live" },
  { broker: "MondTrades",        server: "Mondtrades-Server",              type: "live" },
  { broker: "TspFxb",            server: "TspFxb-Server",                  type: "live" },
  { broker: "WM Markets",        server: "WMMarkets-Real1",                type: "live" },
  { broker: "WM Markets",        server: "WMMarkets-Demo",                 type: "demo" },
  { broker: "UNFXB",             server: "UNFXB-Real",                     type: "live" },
  { broker: "xChief",            server: "xChief-MT5",                     type: "live" },
  { broker: "ZoraCapital",       server: "ZoraCapital-Server",             type: "live" },
];
