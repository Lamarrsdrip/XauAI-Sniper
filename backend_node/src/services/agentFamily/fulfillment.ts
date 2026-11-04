import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { isMarketOpen } from "../marketCalendar.js";
import { XAUCLOUD_PIPS_PER_GOLD_MOVE } from "../marketOutlookCore.js";
import { classifyTrade, computePeriodStats, netResult } from "../performanceEngine.js";
import type { NativeSignalDecision } from "../agentFamilySource.js";
import { catalogById, type CatalogService } from "./catalog.js";

export const NOT_INVESTMENT_ADVICE = "Computational research only. Not investment advice, not a guarantee, and not an instruction to trade. No live order was placed.";

export interface QuotePoint { bid: number; ask: number; time: string }
export interface MarketContext {
  fresh: boolean;
  quote: QuotePoint | null;
  nativeSignal: NativeSignalDecision | null;
  spreadSamples: QuotePoint[];
  marketOpen: boolean;
  capturedAt: string;
}

export interface FulfillmentOk {
  ok: true;
  deliverable: Record<string, unknown>;
  report: string;
}
export interface FulfillmentNo {
  ok: false;
  code: "INSUFFICIENT_INFORMATION" | "INVALID_INPUT" | "EXPIRED_DATA" | "SOURCE_UNAVAILABLE" | "NOT_PUBLISHABLE";
  detail: string;
  missing?: string[];
}
export type FulfillmentResult = FulfillmentOk | FulfillmentNo;

const MAX_INPUT_CHARS = 1_500_000;

export function parseBuyerInput(raw: unknown): { value: unknown; error: string | null } {
  if (raw == null || raw === "") return { value: null, error: null };
  if (typeof raw === "object") return { value: raw, error: null };
  if (typeof raw !== "string") return { value: null, error: "Buyer input must be JSON text or an object." };
  if (raw.length > MAX_INPUT_CHARS) return { value: null, error: "Buyer input exceeds 1.5MB." };
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] ?? raw).trim();
  if (!text) return { value: null, error: null };
  if (text.startsWith("{") || text.startsWith("[")) {
    try { return { value: JSON.parse(text) as unknown, error: null }; }
    catch { return { value: null, error: "Buyer JSON could not be parsed." }; }
  }
  if (text.includes(",") && text.includes("\n")) return { value: { csv: text }, error: null };
  if (/<table/i.test(text) || /<html/i.test(text)) return { value: { html: text }, error: null };
  return { value: null, error: "Buyer input is not JSON, CSV or an HTML statement." };
}

function fail(code: FulfillmentNo["code"], detail: string, missing?: string[]): FulfillmentNo {
  return missing ? { ok: false, code, detail, missing } : { ok: false, code, detail };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function round(n: number, d = 2): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? Number.NaN;
  const b = sorted[hi] ?? a;
  if (lo === hi) return a;
  return a * (hi - pos) + b * (pos - lo);
}

function finish(service: CatalogService, body: Record<string, unknown>, report: string): FulfillmentOk {
  const markdown = `# ${service.title}\n\n${report}\n\n${NOT_INVESTMENT_ADVICE}\n`;
  const deliverable = {
    schemaVersion: 1,
    serviceId: service.id,
    title: service.title,
    liveTrading: false,
    notInvestmentAdvice: true,
    disclaimer: NOT_INVESTMENT_ADVICE,
    report: markdown,
    ...body,
  };
  return { ok: true, deliverable, report: markdown };
}

export function deliverableHash(deliverable: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(deliverable)).digest("hex");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

export function fulfillService(serviceId: string, input: unknown, market: MarketContext, now = new Date()): FulfillmentResult {
  const service = catalogById(serviceId);
  if (!service) return fail("INVALID_INPUT", "Unknown service.");
  if (!service.publishable) return fail("NOT_PUBLISHABLE", service.disabledReason ?? "Service is unpublished.");
  if (service.needsFreshBrokerSource && (!market.fresh || !market.quote)) {
    return fail("SOURCE_UNAVAILABLE", "No fresh owner-approved MT5 quote is available. Nothing was fabricated.");
  }
  switch (service.id) {
    case "xauusd-signal": return fulfillSignal(service, market);
    case "gold-technical-intelligence": return fulfillTechnical(service, market, now);
    case "signal-quality-review": return fulfillQuality(service, input, market, now);
    case "broker-spread-health": return fulfillSpread(service, input, market);
    case "position-sizing": return fulfillSizing(service, input);
    case "mt5-journal-audit": return fulfillJournal(service, input);
    case "trade-result-bootstrap": return fulfillBootstrap(service, input);
    case "broker-slippage-analysis": return fulfillSlippage(service, input);
    case "parameter-robustness-review": return fulfillRobustness(service, input);
    case "historical-gold-data-quality": return fulfillDataQuality(service, input);
    case "gold-volatility-research": return fulfillVolatility(service, input);
    case "multi-timeframe-gold-analysis": return fulfillMtf(service, input);
    case "open-position-exposure": return fulfillExposure(service, input);
    case "gold-regime-description": return fulfillRegime(service, input);
    default: return fail("NOT_PUBLISHABLE", "No fulfillment function is bound to this service.");
  }
}

function fulfillSignal(service: CatalogService, market: MarketContext): FulfillmentResult {
  const signal = market.nativeSignal;
  const quote = market.quote!;
  const decision = signal ?? {
    status: "NO_TRADE" as const, direction: "NO_TRADE" as const, engine: "XauCloud",
    signalId: "", entry: null, stop: null, takeProfit: null, rationale: "No fresh native actionable signal",
  };
  return finish(service, {
    symbol: "XAUUSD",
    quote: { bid: quote.bid, ask: quote.ask, time: quote.time },
    decision: decision.direction,
    status: decision.status,
    engine: decision.engine,
    signalId: decision.signalId,
    entry: decision.entry,
    stop: decision.stop,
    takeProfit: decision.takeProfit,
    rationale: decision.rationale,
    capturedAt: market.capturedAt,
  }, `Decision: ${decision.direction}. Quote ${quote.bid}/${quote.ask} at ${quote.time}. ${decision.rationale}`);
}

function fulfillTechnical(service: CatalogService, market: MarketContext, now: Date): FulfillmentResult {
  const quote = market.quote!;
  const spread = round(quote.ask - quote.bid, 4);
  const signal = fulfillSignal(service, market);
  if (!signal.ok) return signal;
  return finish(service, {
    symbol: "XAUUSD",
    marketOpen: isMarketOpen(now),
    spreadPrice: spread,
    spreadXauCloudPips: round(spread * XAUCLOUD_PIPS_PER_GOLD_MOVE, 2),
    pipDefinition: "1 XauCloud pip = 0.1 price",
    quote: signal.deliverable["quote"],
    nativeDecision: {
      decision: signal.deliverable["decision"],
      status: signal.deliverable["status"],
      engine: signal.deliverable["engine"],
      entry: signal.deliverable["entry"],
      stop: signal.deliverable["stop"],
      takeProfit: signal.deliverable["takeProfit"],
      rationale: signal.deliverable["rationale"],
    },
    limitations: [
      "Single approved-terminal quote, not a multi-broker consensus.",
      "Native levels are omitted whenever the signal is NO_TRADE.",
      "Market holidays are not modeled.",
    ],
  }, `Market ${isMarketOpen(now) ? "open" : "closed"}. Spread ${spread}. Native decision ${String(signal.deliverable["decision"])}.`);
}

function fulfillQuality(service: CatalogService, input: unknown, market: MarketContext, now: Date): FulfillmentResult {
  const row = asRecord(input);
  const direction = String(row?.["direction"] ?? "").toUpperCase();
  const entry = num(row?.["entry"]);
  const stop = num(row?.["stop"]);
  const takeProfit = num(row?.["takeProfit"]);
  if ((direction !== "BUY" && direction !== "SELL") || entry === null || stop === null || takeProfit === null) {
    return fail("INSUFFICIENT_INFORMATION", "Required fields: direction, entry, stop, takeProfit.", ["direction", "entry", "stop", "takeProfit"]);
  }
  const quote = market.quote!;
  const spread = quote.ask - quote.bid;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(takeProfit - entry);
  if (risk <= 0) return fail("INVALID_INPUT", "Stop distance is zero.");
  const stopOk = direction === "BUY" ? stop < entry : stop > entry;
  const tpOk = direction === "BUY" ? takeProfit > entry : takeProfit < entry;
  const rr = reward / risk;
  const spreadRatio = spread / risk;
  const reasons: string[] = [];
  if (!stopOk) reasons.push("Stop is on the wrong side of entry.");
  if (!tpOk) reasons.push("Take-profit is on the wrong side of entry.");
  if (rr < 1) reasons.push("Reward-to-risk is below 1.");
  if (spreadRatio > 0.35) reasons.push("Spread is more than 35% of stop distance.");
  if (!isMarketOpen(now)) reasons.push("Gold session is closed on the XauCloud weekday clock. Holidays are not modeled.");
  const verdict = reasons.length === 0 ? "PASS" : "FAIL";
  return finish(service, {
    verdict,
    reasons,
    rewardToRisk: round(rr, 3),
    spread: round(spread, 4),
    spreadToStop: round(spreadRatio, 3),
    quote: { bid: quote.bid, ask: quote.ask, time: quote.time },
    reviewed: { direction, entry, stop, takeProfit },
    replacesSignal: false,
  }, `Verdict ${verdict}. Reward-to-risk ${round(rr, 3)}. ${reasons.join(" ") || "Geometry passed the published checks."}`);
}

function quoteList(input: unknown, market: MarketContext): QuotePoint[] | FulfillmentNo {
  const row = asRecord(input);
  const supplied = Array.isArray(row?.["quotes"]) ? row!["quotes"] as unknown[] : [];
  const fromBuyer: QuotePoint[] = [];
  for (const item of supplied) {
    const q = asRecord(item);
    const bid = num(q?.["bid"]);
    const ask = num(q?.["ask"]);
    if (bid === null || ask === null) continue;
    fromBuyer.push({ bid, ask, time: String(q?.["time"] ?? "") });
  }
  const sample = fromBuyer.length >= 20 ? fromBuyer : market.spreadSamples;
  if (sample.length < 20) {
    return fail("SOURCE_UNAVAILABLE", "Fewer than 20 real quotes. A spread audit was not produced.");
  }
  return sample.slice(0, 2000);
}

function fulfillSpread(service: CatalogService, input: unknown, market: MarketContext): FulfillmentResult {
  const sample = quoteList(input, market);
  if (!Array.isArray(sample)) return sample;
  const spreads = sample.map((q) => q.ask - q.bid);
  const crossed = spreads.filter((s) => s < 0).length;
  const sorted = [...spreads].filter((s) => s >= 0).sort((a, b) => a - b);
  if (sorted.length < 20) return fail("INVALID_INPUT", "Too many crossed quotes to audit the rest.");
  const median = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  return finish(service, {
    samples: sorted.length,
    crossedQuotes: crossed,
    medianSpread: round(median, 4),
    p95Spread: round(p95, 4),
    maxSpread: round(sorted[sorted.length - 1] ?? 0, 4),
    shareAbove0_50: round(sorted.filter((s) => s > 0.5).length / sorted.length, 4),
    source: asRecord(input)?.["quotes"] ? "buyer-upload" : "owner-approved-terminal-cache",
  }, `Median spread ${round(median, 4)} across ${sorted.length} quotes. Crossed quotes: ${crossed}.`);
}

function fulfillSizing(service: CatalogService, input: unknown): FulfillmentResult {
  const row = asRecord(input);
  const equity = num(row?.["equity"]);
  const riskPercent = num(row?.["riskPercent"]);
  const entry = num(row?.["entry"]);
  const stop = num(row?.["stop"]);
  const value = num(row?.["valuePerLotPerPriceUnit"]);
  if (equity === null || riskPercent === null || entry === null || stop === null || value === null) {
    return fail("INSUFFICIENT_INFORMATION", "Required: equity, riskPercent, entry, stop, valuePerLotPerPriceUnit.", ["equity", "riskPercent", "entry", "stop", "valuePerLotPerPriceUnit"]);
  }
  if (equity <= 0 || entry <= 0 || stop <= 0 || value <= 0) return fail("INVALID_INPUT", "Equity, prices and contract value must be positive.");
  if (riskPercent <= 0 || riskPercent > 5) return fail("INVALID_INPUT", "riskPercent must be greater than 0 and at most 5.");
  const distance = Math.abs(entry - stop);
  if (distance <= 0) return fail("INVALID_INPUT", "Stop distance is zero.");
  const riskAmount = equity * (riskPercent / 100);
  const rawLots = riskAmount / (distance * value);
  const step = num(row?.["volumeStep"]) ?? 0.01;
  const minLot = num(row?.["minLot"]) ?? step;
  if (step <= 0 || minLot <= 0) return fail("INVALID_INPUT", "volumeStep and minLot must be positive.");
  const lots = Math.floor(rawLots / step) * step;
  const takeProfit = num(row?.["takeProfit"]);
  const rewardToRisk = takeProfit === null ? null : round(Math.abs(takeProfit - entry) / distance, 3);
  return finish(service, {
    lots: round(lots, 4),
    rawLots: round(rawLots, 6),
    riskAmount: round(riskAmount, 2),
    stopDistance: round(distance, 4),
    sized: lots >= minLot,
    belowMinLot: lots < minLot,
    rewardToRisk,
    assumptions: ["Fixed fractional risk.", "Lot size is floored to volumeStep.", "valuePerLotPerPriceUnit was supplied by the buyer and was not inferred."],
  }, `Risk ${round(riskAmount, 2)} over stop ${round(distance, 4)} sizes ${round(lots, 4)} lots${lots < minLot ? ", which is below minLot." : "."}`);
}

interface NormalizedTrade { ticket: string; opened_at: number; net_profit: number; commission: number; swap: number; balance: number }

function epoch(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v > 10_000_000_000 ? Math.floor(v / 1000) : Math.floor(v);
  if (typeof v !== "string" || !v.trim()) return null;
  const parsed = Date.parse(v);
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function tradeFromRow(row: Record<string, unknown>): NormalizedTrade | null {
  const ticket = String(row["ticket"] ?? row["Ticket"] ?? row["deal"] ?? "").trim();
  const opened = epoch(row["opened_at"] ?? row["open_time"] ?? row["Time"] ?? row["time"]);
  const net = num(row["net_profit"] ?? row["netProfit"] ?? row["profit"] ?? row["Profit"]);
  if (!ticket || opened === null || net === null) return null;
  return {
    ticket,
    opened_at: opened,
    net_profit: net,
    commission: num(row["commission"] ?? row["Commission"]) ?? 0,
    swap: num(row["swap"] ?? row["Swap"]) ?? 0,
    balance: num(row["balance"] ?? row["Balance"]) ?? 0,
  };
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const headerLine = lines[0];
  if (!headerLine || lines.length < 2) return [];
  const headers = splitCsvLine(headerLine).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === "," && !quoted) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function tradesFromHtml(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  let rows: Record<string, unknown>[] = [];
  $("table").each((_, table) => {
    const headers = $(table).find("tr").first().find("th,td").map((__, cell) => $(cell).text().trim()).get();
    const joined = headers.join(" ").toLowerCase();
    if (!joined.includes("profit") || !(joined.includes("time") || joined.includes("ticket") || joined.includes("deal"))) return;
    const parsed: Record<string, unknown>[] = [];
    $(table).find("tr").slice(1).each((__, tr) => {
      const cells = $(tr).find("td").map((___, td) => $(td).text().trim()).get();
      if (cells.length < headers.length) return;
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
      parsed.push(row);
    });
    if (parsed.length > rows.length) rows = parsed;
  });
  return rows;
}

function collectTrades(input: unknown): NormalizedTrade[] | FulfillmentNo {
  const row = asRecord(input);
  let raw: Record<string, unknown>[] = [];
  if (Array.isArray(input)) raw = input.map((x) => asRecord(x)).filter((x): x is Record<string, unknown> => !!x);
  else if (Array.isArray(row?.["trades"])) raw = (row!["trades"] as unknown[]).map((x) => asRecord(x)).filter((x): x is Record<string, unknown> => !!x);
  else if (typeof row?.["csv"] === "string") raw = parseCsv(row["csv"]);
  else if (typeof row?.["html"] === "string") raw = tradesFromHtml(row["html"]);
  else return fail("INSUFFICIENT_INFORMATION", "Upload trades as JSON, CSV or an MT5 HTML statement.", ["trades"]);
  const trades = raw.slice(0, 5000).map(tradeFromRow).filter((t): t is NormalizedTrade => !!t);
  if (!trades.length) return fail("INVALID_INPUT", "No trade row had ticket, time and profit.");
  return trades;
}

function fulfillJournal(service: CatalogService, input: unknown): FulfillmentResult {
  const trades = collectTrades(input);
  if (!Array.isArray(trades)) return trades;
  const engineRows = trades.map((t) => ({
    ticket: t.ticket,
    opened_at: t.opened_at,
    net_profit: t.net_profit,
    commission: t.commission,
    swap: t.swap,
    balance: t.balance,
    has_rich_ledger_data: true,
    account_login: "buyer-upload",
  }));
  const stats = computePeriodStats(engineRows, 1, 20);
  const check = engineRows.reduce((sum, t) => sum + netResult(t), 0);
  return finish(service, {
    stats,
    independentNetCheck: round(check, 2),
    classified: {
      wins: engineRows.filter((t) => classifyTrade(t) === "WIN").length,
      losses: engineRows.filter((t) => classifyTrade(t) === "LOSS").length,
    },
    rowsUsed: trades.length,
  }, `Trades ${stats.total_trades}. Net ${stats.net_profit}. Profit factor ${stats.profit_factor_value ?? stats.profit_factor_state}. Sufficient sample: ${stats.sufficient_data}.`);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fulfillBootstrap(service: CatalogService, input: unknown): FulfillmentResult {
  const row = asRecord(input);
  const pnls = Array.isArray(row?.["pnls"]) ? (row!["pnls"] as unknown[]).map(num).filter((n): n is number => n !== null) : [];
  if (pnls.length < 30) return fail("INSUFFICIENT_INFORMATION", "At least 30 finite closed-trade results are required.", ["pnls"]);
  if (pnls.length > 5000) return fail("INVALID_INPUT", "At most 5000 results.");
  const seed = 20261104;
  const rand = mulberry32(seed);
  const totals: number[] = [];
  const drawdowns: number[] = [];
  for (let i = 0; i < 1000; i += 1) {
    let equity = 0;
    let peak = 0;
    let maxDd = 0;
    for (let j = 0; j < pnls.length; j += 1) {
      const pick = pnls[Math.floor(rand() * pnls.length)] ?? 0;
      equity += pick;
      if (equity > peak) peak = equity;
      maxDd = Math.max(maxDd, peak - equity);
    }
    totals.push(equity);
    drawdowns.push(maxDd);
  }
  totals.sort((a, b) => a - b);
  drawdowns.sort((a, b) => a - b);
  return finish(service, {
    paths: 1000,
    seed,
    sampleSize: pnls.length,
    terminalPnl: { p05: round(quantile(totals, 0.05)), p50: round(quantile(totals, 0.5)), p95: round(quantile(totals, 0.95)) },
    maxDrawdown: { p50: round(quantile(drawdowns, 0.5)), p95: round(quantile(drawdowns, 0.95)) },
    method: "Resample of supplied closed-trade PnL with replacement. Not an MT5 Strategy Tester run.",
  }, `Bootstrap p50 ${round(quantile(totals, 0.5))} and p05 ${round(quantile(totals, 0.05))} on ${pnls.length} trades, seed ${seed}.`);
}

function fulfillSlippage(service: CatalogService, input: unknown): FulfillmentResult {
  const row = asRecord(input);
  const fills = Array.isArray(row?.["fills"]) ? row!["fills"] as unknown[] : [];
  const slips: number[] = [];
  for (const item of fills.slice(0, 5000)) {
    const f = asRecord(item);
    const side = String(f?.["side"] ?? "").toUpperCase();
    const requested = num(f?.["requestedPrice"]);
    const filled = num(f?.["fillPrice"]);
    if ((side !== "BUY" && side !== "SELL") || requested === null || filled === null) continue;
    slips.push(side === "BUY" ? filled - requested : requested - filled);
  }
  if (!slips.length) return fail("INSUFFICIENT_INFORMATION", "Required fills[].side, requestedPrice, fillPrice.", ["fills"]);
  const sorted = [...slips].sort((a, b) => a - b);
  const mean = slips.reduce((s, n) => s + n, 0) / slips.length;
  return finish(service, {
    fills: slips.length,
    meanAdverseSlippage: round(mean, 5),
    medianAdverseSlippage: round(quantile(sorted, 0.5), 5),
    p95AdverseSlippage: round(quantile(sorted, 0.95), 5),
    signConvention: "Positive means the fill was worse than the requested price.",
  }, `Mean adverse slippage ${round(mean, 5)} across ${slips.length} fills.`);
}

function fulfillRobustness(service: CatalogService, input: unknown): FulfillmentResult {
  const row = asRecord(input);
  const rows = Array.isArray(row?.["rows"]) ? row!["rows"] as unknown[] : [];
  const clean = rows.map((item) => {
    const r = asRecord(item);
    return { label: String(r?.["label"] ?? ""), netProfit: num(r?.["netProfit"]), trades: num(r?.["trades"]) };
  }).filter((r) => r.label && r.netProfit !== null && r.trades !== null && r.trades >= 5) as { label: string; netProfit: number; trades: number }[];
  if (clean.length < 8) return fail("INSUFFICIENT_INFORMATION", "At least 8 rows with label, netProfit and trades >= 5.", ["rows"]);
  const profits = clean.map((r) => r.netProfit).sort((a, b) => a - b);
  const median = quantile(profits, 0.5);
  const best = [...clean].sort((a, b) => b.netProfit - a.netProfit)[0]!;
  const second = [...clean].sort((a, b) => b.netProfit - a.netProfit)[1]!;
  const mean = profits.reduce((s, n) => s + n, 0) / profits.length;
  const variance = profits.reduce((s, n) => s + (n - mean) ** 2, 0) / profits.length;
  const cv = mean === 0 ? null : Math.sqrt(variance) / Math.abs(mean);
  const fragile = median > 0 && best.netProfit > median * 2 && second.netProfit < median * 1.25;
  return finish(service, {
    rows: clean.length,
    medianNetProfit: round(median, 2),
    best: { label: best.label, netProfit: round(best.netProfit, 2) },
    coefficientOfVariation: cv === null ? null : round(cv, 3),
    fragilePeak: fragile,
    rule: "fragilePeak when the best row exceeds twice the median and the second-best is below 1.25x the median, and the median is positive.",
    notAnOptimization: true,
  }, `Median net ${round(median, 2)}. Best ${best.label} at ${round(best.netProfit, 2)}. Fragile peak: ${fragile}.`);
}

interface Bar { time: number; open: number; high: number; low: number; close: number }

function barsFrom(input: unknown, min: number): Bar[] | FulfillmentNo {
  const row = asRecord(input);
  const raw = Array.isArray(row?.["bars"]) ? row!["bars"] as unknown[] : [];
  const bars: Bar[] = [];
  for (const item of raw.slice(0, 5000)) {
    const b = asRecord(item);
    const time = epoch(b?.["time"]);
    const open = num(b?.["open"]);
    const high = num(b?.["high"]);
    const low = num(b?.["low"]);
    const close = num(b?.["close"]);
    if (time === null || open === null || high === null || low === null || close === null) continue;
    bars.push({ time, open, high, low, close });
  }
  if (bars.length < min) return fail("INSUFFICIENT_INFORMATION", `At least ${min} OHLC bars are required.`, ["bars"]);
  return bars;
}

function fulfillDataQuality(service: CatalogService, input: unknown): FulfillmentResult {
  const bars = barsFrom(input, 20);
  if (!Array.isArray(bars)) return bars;
  let ohlcBroken = 0;
  let nonPositive = 0;
  let duplicates = 0;
  let unordered = 0;
  const seen = new Set<number>();
  const deltas: number[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i]!;
    if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) nonPositive += 1;
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) ohlcBroken += 1;
    if (seen.has(bar.time)) duplicates += 1;
    seen.add(bar.time);
    if (i > 0 && bar.time <= bars[i - 1]!.time) unordered += 1;
    if (i > 0) deltas.push(bar.time - bars[i - 1]!.time);
  }
  const positiveDeltas = deltas.filter((d) => d > 0).sort((a, b) => a - b);
  const medianDelta = positiveDeltas.length ? quantile(positiveDeltas, 0.5) : 0;
  const largeGaps = medianDelta > 0 ? deltas.filter((d) => d > medianDelta * 3).length : 0;
  const checks = [ohlcBroken === 0, nonPositive === 0, duplicates === 0, unordered === 0, largeGaps === 0];
  return finish(service, {
    bars: bars.length,
    ohlcBroken,
    nonPositive,
    duplicateTimestamps: duplicates,
    unorderedSteps: unordered,
    largeGaps,
    medianStepSeconds: round(medianDelta, 0),
    checksPassed: checks.filter(Boolean).length,
    checksTotal: checks.length,
  }, `${checks.filter(Boolean).length}/${checks.length} quality checks passed on ${bars.length} bars.`);
}

function fulfillVolatility(service: CatalogService, input: unknown): FulfillmentResult {
  const bars = barsFrom(input, 30);
  if (!Array.isArray(bars)) return bars;
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const prev = bars[i - 1]!.close;
    const close = bars[i]!.close;
    if (prev > 0 && close > 0) returns.push(Math.log(close / prev));
  }
  if (returns.length < 20) return fail("INVALID_INPUT", "Not enough positive closes for log returns.");
  const mean = returns.reduce((s, n) => s + n, 0) / returns.length;
  const variance = returns.reduce((s, n) => s + (n - mean) ** 2, 0) / returns.length;
  const realized = Math.sqrt(variance);
  let atr: number | null = null;
  if (bars.length >= 15) {
    const trs: number[] = [];
    for (let i = 1; i < bars.length; i += 1) {
      const bar = bars[i]!;
      const prev = bars[i - 1]!.close;
      trs.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prev), Math.abs(bar.low - prev)));
    }
    const last = trs.slice(-14);
    atr = last.reduce((s, n) => s + n, 0) / last.length;
  }
  const tf = num(asRecord(input)?.["timeframeMinutes"]);
  const annualized = tf && tf > 0 ? realized * Math.sqrt(525600 / tf) : null;
  return finish(service, {
    samples: returns.length,
    meanLogReturn: round(mean, 8),
    realizedVolatilityPerBar: round(realized, 8),
    annualizedVolatility: annualized === null ? null : round(annualized, 6),
    annualization: annualized === null ? "not applied; timeframeMinutes was absent" : "sqrt(525600 / timeframeMinutes), a 365-day clock",
    atr14: atr === null ? null : round(atr, 4),
    forecast: false,
  }, `Realized volatility per bar ${round(realized, 8)}. ATR14 ${atr === null ? "n/a" : round(atr, 4)}.`);
}

function fulfillMtf(service: CatalogService, input: unknown): FulfillmentResult {
  const row = asRecord(input);
  const closes = asRecord(row?.["closes"]);
  const frames = ["M15", "H1", "H4", "D1"] as const;
  const slopes: Record<string, number> = {};
  const signs: Record<string, string> = {};
  for (const frame of frames) {
    const series = Array.isArray(closes?.[frame]) ? (closes![frame] as unknown[]).map(num).filter((n): n is number => n !== null && n > 0) : [];
    if (series.length < 20) return fail("INSUFFICIENT_INFORMATION", `${frame} needs at least 20 positive closes.`, [`closes.${frame}`]);
    const first = series[0]!;
    const last = series[series.length - 1]!;
    const slope = (last - first) / first;
    slopes[frame] = round(slope, 6);
    signs[frame] = Math.abs(slope) < 0.001 ? "flat" : slope > 0 ? "up" : "down";
  }
  const directional = Object.values(signs).filter((s) => s !== "flat");
  const ups = directional.filter((s) => s === "up").length;
  const agreement = directional.length === 0 ? "flat" : ups === directional.length || ups === 0 ? "aligned" : "mixed";
  return finish(service, {
    slopes,
    signs,
    agreement,
    tradeDecision: "NONE",
    note: "Directional agreement of supplied closes only. This is not a BUY or SELL.",
  }, `Agreement ${agreement}. Signs ${JSON.stringify(signs)}. No trade was produced.`);
}

function fulfillExposure(service: CatalogService, input: unknown): FulfillmentResult {
  const row = asRecord(input);
  const positions = Array.isArray(row?.["positions"]) ? row!["positions"] as unknown[] : [];
  let net = 0;
  let gross = 0;
  let unprotected = 0;
  let weighted = 0;
  let goldLots = 0;
  let used = 0;
  for (const item of positions.slice(0, 2000)) {
    const p = asRecord(item);
    const symbol = String(p?.["symbol"] ?? "");
    const side = String(p?.["side"] ?? "").toUpperCase();
    const lots = num(p?.["lots"]);
    const price = num(p?.["price"]);
    if (!/xau|gold/i.test(symbol) || (side !== "BUY" && side !== "SELL") || lots === null || lots <= 0 || price === null || price <= 0) continue;
    const signed = side === "BUY" ? lots : -lots;
    net += signed;
    gross += lots;
    goldLots += lots;
    weighted += price * lots;
    if (num(p?.["stop"]) === null) unprotected += 1;
    used += 1;
  }
  if (!used) return fail("INSUFFICIENT_INFORMATION", "Upload at least one XAUUSD or GOLD position with side, lots and price.", ["positions"]);
  const leverage = num(row?.["leverage"]);
  const contractSize = num(row?.["contractSize"]);
  const margin = leverage && contractSize && leverage > 0 && contractSize > 0
    ? round((gross * contractSize * (weighted / goldLots)) / leverage, 2)
    : null;
  return finish(service, {
    positions: used,
    netLots: round(net, 4),
    grossLots: round(gross, 4),
    unprotectedStops: unprotected,
    averagePrice: round(weighted / goldLots, 4),
    marginEstimate: margin,
    marginNote: margin === null ? "Not computed. leverage and contractSize were not both supplied." : "Buyer-supplied leverage and contract size. Not a broker margin call.",
    customerTerminalsRead: false,
  }, `Net ${round(net, 4)} lots, gross ${round(gross, 4)}, unprotected ${unprotected}.`);
}

function fulfillRegime(service: CatalogService, input: unknown): FulfillmentResult {
  const row = asRecord(input);
  const closes = Array.isArray(row?.["closes"]) ? (row!["closes"] as unknown[]).map(num).filter((n): n is number => n !== null && n > 0) : [];
  if (closes.length < 50) return fail("INSUFFICIENT_INFORMATION", "At least 50 positive closes are required.", ["closes"]);
  let path = 0;
  for (let i = 1; i < closes.length; i += 1) path += Math.abs(closes[i]! - closes[i - 1]!);
  const first = closes[0]!;
  const efficiency = path === 0 ? 0 : Math.abs(closes[closes.length - 1]! - first) / path;
  const label = efficiency > 0.45 ? "TREND" : efficiency < 0.25 ? "RANGE" : "MIXED";
  return finish(service, {
    samples: closes.length,
    efficiencyRatio: round(efficiency, 4),
    label,
    thresholds: { TREND: "> 0.45", RANGE: "< 0.25", MIXED: "otherwise" },
    forecast: false,
  }, `Efficiency ${round(efficiency, 4)} labels this sample ${label}.`);
}
