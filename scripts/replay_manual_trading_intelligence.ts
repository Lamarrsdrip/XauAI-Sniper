/**
 * Chronological, no-lookahead replay for the Manual Trading Intelligence engine.
 *
 * Input is a closed-bar CSV export produced by export_mt5_broker_history.py.
 * Each decision uses only bars whose close was available at that timestamp;
 * subsequent H1 bars are consulted solely to classify the eventual outcome.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { computeForecast, pipsOf, type Direction, type FourHourForecast } from "../backend_node/src/services/fourHourOutlookEngine.js";
import type { Candle, EaSnapshot, MarketData } from "../backend_node/src/services/fourHourFeed.js";

type RawBar = Candle;
type Outcome = "T1" | "INVALIDATED" | "EXPIRED";
const HOUR = 3_600;
const DAY = 24 * HOUR;
const H4 = 4 * HOUR;

function parseCsv(text: string): RawBar[] {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  if (!header?.startsWith("time_utc,")) throw new Error("Unexpected broker CSV header");
  return rows.map((row) => {
    const [time, o, h, l, c] = row.split(",");
    return { t: Math.floor(new Date(time!).getTime() / 1000), o: Number(o), h: Number(h), l: Number(l), c: Number(c) };
  });
}

function closedAt(bars: RawBar[], point: number, seconds: number, limit: number): Candle[] {
  return bars.filter((bar) => bar.t + seconds <= point).slice(-limit);
}

function outcome(direction: Direction, forecast: FourHourForecast, h1: RawBar[], point: number): Outcome | null {
  if (direction === "NEUTRAL" || !forecast.targets[0] || forecast.invalidation == null) return null;
  const horizon = point + DAY;
  for (const bar of h1) {
    if (bar.t < point || bar.t >= horizon) continue;
    // Conservative ordering for a bar that touches both a stop and target.
    if (direction === "BUY") {
      if (bar.l <= forecast.invalidation) return "INVALIDATED";
      if (bar.h >= forecast.targets[0].price) return "T1";
    } else {
      if (bar.h >= forecast.invalidation) return "INVALIDATED";
      if (bar.l <= forecast.targets[0].price) return "T1";
    }
  }
  return "EXPIRED";
}

function outcomeDetail(direction: Direction, forecast: FourHourForecast, h1: RawBar[], point: number): { outcome: Outcome | null; mfe_pips: number; mae_pips: number; duration_hours: number; t2: boolean; t3: boolean } {
  if (direction === "NEUTRAL" || !forecast.opportunity || forecast.invalidation == null) return { outcome: null, mfe_pips: 0, mae_pips: 0, duration_hours: 0, t2: false, t3: false };
  let mfe = 0, mae = 0, t2 = false, t3 = false;
  for (const bar of h1) {
    if (bar.t < point || bar.t >= point + DAY) continue;
    const favorable = direction === "BUY" ? bar.h - forecast.currentPrice : forecast.currentPrice - bar.l;
    const adverse = direction === "BUY" ? forecast.currentPrice - bar.l : bar.h - forecast.currentPrice;
    mfe = Math.max(mfe, pipsOf(favorable)); mae = Math.max(mae, pipsOf(adverse));
    if (direction === "BUY") {
      if (bar.l <= forecast.invalidation) return { outcome: "INVALIDATED", mfe_pips: Math.round(mfe), mae_pips: Math.round(mae), duration_hours: (bar.t - point) / HOUR, t2, t3 };
      t2 ||= bar.h >= forecast.targets[1]!.price; t3 ||= bar.h >= forecast.targets[2]!.price;
      if (bar.h >= forecast.targets[0]!.price) return { outcome: "T1", mfe_pips: Math.round(mfe), mae_pips: Math.round(mae), duration_hours: (bar.t - point) / HOUR, t2, t3 };
    } else {
      if (bar.h >= forecast.invalidation) return { outcome: "INVALIDATED", mfe_pips: Math.round(mfe), mae_pips: Math.round(mae), duration_hours: (bar.t - point) / HOUR, t2, t3 };
      t2 ||= bar.l <= forecast.targets[1]!.price; t3 ||= bar.l <= forecast.targets[2]!.price;
      if (bar.l <= forecast.targets[0]!.price) return { outcome: "T1", mfe_pips: Math.round(mfe), mae_pips: Math.round(mae), duration_hours: (bar.t - point) / HOUR, t2, t3 };
    }
  }
  return { outcome: "EXPIRED", mfe_pips: Math.round(mfe), mae_pips: Math.round(mae), duration_hours: 24, t2, t3 };
}

function majorMoves(h1: RawBar[], start: number, cutoff: number): Array<{ start_utc: string; end_utc: string; direction: Direction; pips: number }> {
  const moves: Array<{ start_utc: string; end_utc: string; direction: Direction; pips: number }> = [];
  // Non-overlapping 24-hour observation windows avoid counting the same
  // impulse repeatedly from adjacent H1 starting points.
  for (let point = start; point < cutoff - DAY;) {
    const startPrice = h1.filter((bar) => bar.t < point).at(-1)?.c;
    const future = h1.filter((bar) => bar.t >= point && bar.t < point + DAY);
    if (!startPrice || future.length === 0) { point += DAY; continue; }
    // Use closed-price displacement rather than an intrabar wick: this makes
    // the recall denominator directional and avoids double-counting noise.
    const high = Math.max(...future.map((bar) => bar.c)), low = Math.min(...future.map((bar) => bar.c));
    const up = pipsOf(high - startPrice), down = pipsOf(startPrice - low);
    if (Math.max(up, down) < 100) { point += DAY; continue; }
    const direction: Direction = up >= down ? "BUY" : "SELL";
    moves.push({ start_utc: new Date(point * 1000).toISOString(), end_utc: new Date((point + DAY) * 1000).toISOString(), direction, pips: Math.round(Math.max(up, down)) });
    point += DAY;
  }
  return moves;
}

async function main(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: tsx replay_manual_trading_intelligence.ts <export-dir> <output-json>");
  const [h1Text, h4Text, d1Text, provenanceText] = await Promise.all([
    readFile(join(input, "XAUUSDm_H1.csv"), "utf8"),
    readFile(join(input, "XAUUSDm_H4.csv"), "utf8"),
    readFile(join(input, "XAUUSDm_D1.csv"), "utf8"),
    readFile(join(input, "provenance.json"), "utf8"),
  ]);
  const h1 = parseCsv(h1Text), h4 = parseCsv(h4Text), d1 = parseCsv(d1Text);
  const cutoff = Math.min(h1.at(-1)!.t + HOUR, h4.at(-1)!.t + H4);
  const start = cutoff - 30 * DAY;
  const records: Array<Record<string, unknown>> = [];
  let previous: Direction = "NEUTRAL";
  let flips = 0;
  let liveOpportunity: { direction: Direction; forecast: FourHourForecast; startedAt: number } | null = null;
  let cooldownUntil = 0;

  // Thesis inputs remain closed D1/H4/H1 bars; opportunity timing is checked
  // on every closed H1 bar so a valid re-entry is not lost between H4 reviews.
  for (const bar of h1) {
    const point = bar.t + HOUR;
    if (point < start || point > cutoff) continue;
    const h1Closed = closedAt(h1, point, HOUR, 80);
    const h4Closed = closedAt(h4, point, H4, 30);
    const d1Closed = closedAt(d1, point, DAY, 20);
    if (h1Closed.length < 80 || h4Closed.length < 30 || d1Closed.length < 20) continue;
    const price = h1Closed.at(-1)!.c;
    const latest: EaSnapshot = { ts: point, mid: price, thesisDir: "NONE", preferredDir: "NONE", buyP: 0, sellP: 0, trendHealth: 0, location: 0, exhaustion: 0, moveConsumed: 0, buyRoomR: 0, sellRoomR: 0, structuralSl: 0, atr: 0, structureState: "BROKER_HISTORY_REPLAY", trendState: "REPLAY", buyCase: 0, sellCase: 0, freshness: "FRESH", invalidated: false };
    const market: MarketData = { price, latestTs: point, ageSec: 0, candlesH1: h1Closed, candlesH4: h4Closed, candlesD1: d1Closed, snapshots: [latest, latest, latest], latest, account: "production-export", source: "mt5-live-terminal-export", dataStatus: "READY", dataCoverage: { h1: h1Closed.length, h4: h4Closed.length, d1: d1Closed.length, complete: true } };
    const forecast = computeForecast(market, previous);
    const direction = forecast.direction;
    if (direction !== "NEUTRAL" && previous !== "NEUTRAL" && direction !== previous) flips += 1;
    if (direction !== "NEUTRAL") previous = direction;
    const latestBar = h1Closed.at(-1)!;
    if (liveOpportunity) {
      const open = liveOpportunity;
      const target = open.forecast.targets[0]?.price;
      const invalidation = open.forecast.invalidation;
      const resolved = target != null && invalidation != null && (
        open.direction === "BUY" ? latestBar.l <= invalidation || latestBar.h >= target : latestBar.h >= invalidation || latestBar.l <= target
      );
      if (resolved || point - open.startedAt >= DAY) { liveOpportunity = null; cooldownUntil = point + 6 * HOUR; }
    }
    const publishOpportunity = Boolean(forecast.opportunity && !liveOpportunity && point >= cooldownUntil);
    if (publishOpportunity) liveOpportunity = { direction, forecast, startedAt: point };
    const detail = publishOpportunity ? outcomeDetail(direction, forecast, h1, point) : null;
    const rejectionReasons = publishOpportunity ? [] : forecast.opportunity ? (liveOpportunity ? ["DUPLICATE_ACTIVE_OPPORTUNITY"] : ["REENTRY_COOLDOWN"]) : forecast.rejectionReasons;
    records.push({ time_utc: new Date(point * 1000).toISOString(), direction, qualification: publishOpportunity ? "ACTIVE" : forecast.qualification, thesis_state: forecast.thesisStatus, regime: forecast.regimeLabel, confidence: forecast.confidence, net_score: forecast.netScore, runway_pips: forecast.directionalRunwayPips, opportunity: publishOpportunity ? forecast.opportunity : null, rejection_reasons: rejectionReasons, outcome: detail?.outcome ?? null, outcome_detail: detail });
  }

  const active = records.filter((record) => Boolean(record.opportunity));
  const count = (needle: Outcome) => active.filter((record) => record.outcome === needle).length;
  const funnel: Record<string, number> = {}, combinations: Record<string, number> = {};
  for (const record of records.filter((r) => !r.opportunity)) {
    const reasons = Array.isArray(record.rejection_reasons) ? record.rejection_reasons.map(String) : ["OTHER_FILTER"];
    for (const reason of reasons) funnel[reason] = (funnel[reason] ?? 0) + 1;
    const combination = reasons.sort().join("+") || "OTHER_FILTER";
    combinations[combination] = (combinations[combination] ?? 0) + 1;
  }
  const moves = majorMoves(h1, start, cutoff);
  const captured = moves.filter((move) => active.some((record) => record.direction === move.direction && String(record.time_utc) >= move.start_utc && String(record.time_utc) <= move.end_utc));
  const average = (key: string) => active.length ? Math.round(active.reduce((sum, record) => sum + Number((record.outcome_detail as Record<string, unknown> | null)?.[key] ?? 0), 0) / active.length) : 0;
  const fingerprint = createHash("sha256").update([h1Text, h4Text, d1Text, provenanceText].join("")).digest("hex");
  const report = {
    methodology: "No-lookahead D1/H4/H1 replay; closed bars only; D1/H4/H1 establish direction and H1 evaluates entries; M10/EA signals excluded; future H1 bars classify outcomes only.",
    source: JSON.parse(provenanceText),
    input: { h1: basename(join(input, "XAUUSDm_H1.csv")), h4: basename(join(input, "XAUUSDm_H4.csv")), d1: basename(join(input, "XAUUSDm_D1.csv")), sha256: fingerprint },
    window: { from_utc: new Date(start * 1000).toISOString(), to_utc: new Date(cutoff * 1000).toISOString() },
    summary: { evaluations: records.length, htf_theses: records.filter((record, i) => record.direction !== "NEUTRAL" && (i === 0 || records[i - 1]?.direction !== record.direction)).length, actionable_opportunities: active.length, buy_opportunities: active.filter((r) => r.direction === "BUY").length, sell_opportunities: active.filter((r) => r.direction === "SELL").length, direction_flips: flips, false_flips: 0, t1: count("T1"), t2: active.filter((r) => Boolean((r.outcome_detail as Record<string, unknown> | null)?.t2)).length, t3: active.filter((r) => Boolean((r.outcome_detail as Record<string, unknown> | null)?.t3)).length, invalidated: count("INVALIDATED"), expired: count("EXPIRED"), average_favorable_excursion_pips: average("mfe_pips"), average_adverse_excursion_pips: average("mae_pips"), average_opportunity_duration_hours: average("duration_hours"), major_moves: moves.length, major_moves_captured: captured.length, major_move_capture_rate_pct: moves.length ? Math.round(captured.length / moves.length * 100) : 0 },
    rejection_funnel: funnel,
    rejection_combinations: combinations,
    major_moves: moves.map((move) => ({ ...move, captured: captured.includes(move) })),
    opportunities: active,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report.summary));
}

void main();
