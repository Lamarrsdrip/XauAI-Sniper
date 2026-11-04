/**
 * Commercial catalog. A service is publishable only when fulfillment is a
 * real computation over buyer-supplied files or an owner-approved fresh
 * MT5 quote. Unpublished entries stay in the owner dashboard and are never
 * sent to Agent.family.
 */
export interface CatalogService {
  id: string;
  title: string;
  priceUsd: number;
  skillTag: string;
  publishable: boolean;
  disabledReason: string | null;
  needsFreshBrokerSource: boolean;
  needsBuyerInput: boolean;
  deliveryDays: number;
  estimatedCostUsd: number;
  acceptedInputs: string;
  description: string;
}

const NOT_ADVICE = "This is a computational research artifact, not investment advice, a solicitation, or a guarantee of profit. XauCloud will not place, modify, or close a live trade for this order.";

export const AGENT_FAMILY_CATEGORY = "Market & Protocol Research";

export const CATALOG: readonly CatalogService[] = [
  {
    id: "gold-technical-intelligence",
    title: "Gold technical intelligence",
    priceUsd: 9,
    skillTag: "xaucloud-gold-technical-intelligence",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: true,
    needsBuyerInput: false,
    deliveryDays: 1,
    estimatedCostUsd: 0.02,
    acceptedInputs: "No file. Uses the owner-approved XauCloud MT5 quote and the native signal already bound to that terminal.",
    description: `Fresh XAUUSD bid/ask from an owner-approved connected MT5 terminal, session state, spread, and the native XauCloud decision (BUY, SELL, or NO_TRADE). NO_TRADE is a complete result when the native engine has no fresh actionable signal. Levels are never invented. ${NOT_ADVICE}`,
  },
  {
    id: "multi-timeframe-gold-analysis",
    title: "Multi-timeframe gold analysis",
    priceUsd: 19,
    skillTag: "xaucloud-mtf-gold-analysis",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.03,
    acceptedInputs: "JSON with closes.M15, closes.H1, closes.H4 and closes.D1; each is an array of at least 20 positive numbers, oldest first.",
    description: `Describes directional agreement across the four supplied XAUUSD close series. It does not emit a trade. Incomplete timeframes are rejected instead of filled in. ${NOT_ADVICE}`,
  },
  {
    id: "gold-volatility-research",
    title: "Gold volatility research",
    priceUsd: 12,
    skillTag: "xaucloud-gold-volatility",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.03,
    acceptedInputs: "JSON bars: [{time, open, high, low, close}] length >= 30. Optional timeframeMinutes for an explicitly labeled annualization.",
    description: `Close-to-close realized volatility and 14-period ATR on the supplied bars. No forecast and no trade. ${NOT_ADVICE}`,
  },
  {
    id: "position-sizing",
    title: "Position sizing and risk calculations",
    priceUsd: 6,
    skillTag: "xaucloud-position-sizing",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.01,
    acceptedInputs: "JSON: equity, riskPercent (0 < pct <= 5), entry, stop, valuePerLotPerPriceUnit. Optional takeProfit, volumeStep, minLot.",
    description: `Fixed-fractional lot size from the buyer's own equity, risk cap and stop distance. Risk above 5% is rejected. Contract value is never assumed. ${NOT_ADVICE}`,
  },
  {
    id: "mt5-journal-audit",
    title: "MT5 trading journal audit",
    priceUsd: 24,
    skillTag: "xaucloud-mt5-journal-audit",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.05,
    acceptedInputs: "CSV, JSON {trades:[]}, or an MT5 HTML statement. Columns: ticket, opened_at, net_profit (or profit), optional commission, swap, balance.",
    description: `Recomputes win rate, profit factor, streaks and balance drawdown with the same XauCloud performance engine used for owner periods. Sample size below 20 is reported, not hidden. ${NOT_ADVICE}`,
  },
  {
    id: "strategy-backtest-diagnostics",
    title: "Strategy backtest diagnostics",
    priceUsd: 39,
    skillTag: "xaucloud-backtest-diagnostics",
    publishable: false,
    disabledReason: "A connected MT5 heartbeat is not an isolated Strategy Tester job runner. This listing stays unpublished so a report cannot be sold in place of a real tester run.",
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0,
    acceptedInputs: "Not accepted. No fulfillment path.",
    description: "Unpublished. XauCloud does not execute marketplace backtests on customer or owner terminals.",
  },
  {
    id: "trade-result-bootstrap",
    title: "Closed-trade bootstrap stress test",
    priceUsd: 29,
    skillTag: "xaucloud-trade-bootstrap",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.04,
    acceptedInputs: "JSON {pnls: number[]} with at least 30 finite closed-trade results. This does not re-run an EA or Strategy Tester.",
    description: `Deterministic 1,000-path bootstrap of the supplied closed-trade PnL, with the seed included so the percentiles can be recomputed. It is not a new backtest of the XauCloud EA. ${NOT_ADVICE}`,
  },
  {
    id: "broker-slippage-analysis",
    title: "Broker execution and slippage analysis",
    priceUsd: 23,
    skillTag: "xaucloud-slippage-analysis",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.03,
    acceptedInputs: "JSON {fills:[{side:BUY|SELL, requestedPrice, fillPrice, volume?}]}. Positive slippage is adverse to the order.",
    description: `Side-aware slippage from the buyer's own requested-versus-filled prices. It cannot observe a broker XauCloud is not connected to, and it does not invent fills. ${NOT_ADVICE}`,
  },
  {
    id: "parameter-robustness-review",
    title: "Strategy parameter robustness review",
    priceUsd: 45,
    skillTag: "xaucloud-parameter-robustness",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.04,
    acceptedInputs: "JSON {rows:[{label, netProfit, trades}]} with at least 8 rows of at least 5 trades. An MT5 optimization export reduced to those columns is acceptable.",
    description: `Compares the supplied optimization rows for an isolated peak versus a stable cluster. It does not run a new optimization and does not declare a parameter set safe to trade. ${NOT_ADVICE}`,
  },
  {
    id: "historical-gold-data-quality",
    title: "Historical gold-data quality audit",
    priceUsd: 15,
    skillTag: "xaucloud-data-quality",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.03,
    acceptedInputs: "JSON {bars:[{time, open, high, low, close}]} length >= 20.",
    description: `Checks OHLC consistency, duplicate timestamps, ordering and unusually large gaps on the file the buyer uploaded. XauCloud's short-lived broker cache is not resold as a history product. ${NOT_ADVICE}`,
  },
  {
    id: "xauusd-signal",
    title: "On-demand XAUUSD trading signal",
    priceUsd: 8,
    skillTag: "xaucloud-xauusd-signal",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: true,
    needsBuyerInput: false,
    deliveryDays: 1,
    estimatedCostUsd: 0.02,
    acceptedInputs: "No file. Symbol is XAUUSD. A NO_TRADE decision is a valid paid result.",
    description: `Returns the current native XauCloud BUY, SELL or NO_TRADE bound to the owner-approved terminal that produced the fresh quote. Failover never reuses another terminal's signal. No live order is sent. ${NOT_ADVICE}`,
  },
  {
    id: "signal-quality-review",
    title: "Independent signal quality review",
    priceUsd: 11,
    skillTag: "xaucloud-signal-quality-review",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: true,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.02,
    acceptedInputs: "JSON {direction:BUY|SELL, entry, stop, takeProfit} plus a fresh owner-approved XAUUSD quote.",
    description: `Checks stop side, reward-to-risk and spread versus stop distance against a fresh approved quote. It does not replace the signal with a XauCloud trade. ${NOT_ADVICE}`,
  },
  {
    id: "broker-spread-health",
    title: "Broker spread health audit",
    priceUsd: 14,
    skillTag: "xaucloud-spread-health",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: false,
    deliveryDays: 1,
    estimatedCostUsd: 0.02,
    acceptedInputs: "Either 20+ buyer quotes {quotes:[{bid,ask,time}]} or 20+ recent quotes already retained for an owner-approved terminal. Fewer than 20 is not sold as an audit.",
    description: `Median, 95th percentile and crossed-quote count for a real quote sample. A single tick is refused. ${NOT_ADVICE}`,
  },
  {
    id: "open-position-exposure",
    title: "MT5 open-position exposure review",
    priceUsd: 16,
    skillTag: "xaucloud-exposure-review",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.02,
    acceptedInputs: "JSON {positions:[{symbol, side:BUY|SELL, lots, price, stop?}]}. Customer VPS positions are never read for this order.",
    description: `Net and gross XAUUSD lots, unprotected-stop count and average price from the uploaded book. Margin is computed only when the buyer also supplies leverage and contractSize. ${NOT_ADVICE}`,
  },
  {
    id: "gold-regime-description",
    title: "Gold-market regime description",
    priceUsd: 18,
    skillTag: "xaucloud-gold-regime",
    publishable: true,
    disabledReason: null,
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0.03,
    acceptedInputs: "JSON {closes:number[]} length >= 50, oldest first.",
    description: `Kaufman efficiency ratio on the supplied closes, labeled TREND, RANGE or MIXED by published thresholds. This is a description of that sample, not a forecast. ${NOT_ADVICE}`,
  },
  {
    id: "event-risk-research",
    title: "Event-risk research",
    priceUsd: 17,
    skillTag: "xaucloud-event-risk",
    publishable: false,
    disabledReason: "XauCloud marketCalendar.ts has session hours only and explicitly no economic or holiday calendar. An event-risk listing would be fabricated.",
    needsFreshBrokerSource: false,
    needsBuyerInput: true,
    deliveryDays: 1,
    estimatedCostUsd: 0,
    acceptedInputs: "Not accepted.",
    description: "Unpublished until a real event calendar is wired.",
  },
];

export function catalogById(id: string | null | undefined): CatalogService | null {
  return CATALOG.find((s) => s.id === id) ?? null;
}

export function catalogBySkillTag(tag: string | null | undefined): CatalogService | null {
  if (!tag) return null;
  return CATALOG.find((s) => s.skillTag === tag) ?? null;
}

export function publishableCatalog(): CatalogService[] {
  return CATALOG.filter((s) => s.publishable);
}
