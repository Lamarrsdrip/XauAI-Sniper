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
import { computeForecast, type Direction, type FourHourForecast } from "../backend_node/src/services/fourHourOutlookEngine.js";
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
  const cutoff = Math.min(h1.at(-1)!.t, h4.at(-1)!.t);
  const start = cutoff - 30 * DAY;
  const records: Array<Record<string, unknown>> = [];
  let previous: Direction = "NEUTRAL";
  let flips = 0;

  for (const bar of h4) {
    const point = bar.t + H4;
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
    const result = outcome(direction, forecast, h1, point);
    records.push({ time_utc: new Date(point * 1000).toISOString(), direction, qualification: forecast.qualification, thesis_state: forecast.thesisStatus, regime: forecast.regimeLabel, confidence: forecast.confidence, net_score: forecast.netScore, runway_pips: forecast.directionalRunwayPips, outcome: result });
  }

  const active = records.filter((record) => record.direction !== "NEUTRAL");
  const count = (needle: Outcome) => active.filter((record) => record.outcome === needle).length;
  const fingerprint = createHash("sha256").update([h1Text, h4Text, d1Text, provenanceText].join("")).digest("hex");
  const report = {
    methodology: "No-lookahead D1/H4/H1 structural replay; closed bars only; M10/EA signals excluded from direction; outcome uses subsequent H1 bars only after the decision.",
    source: JSON.parse(provenanceText),
    input: { h1: basename(join(input, "XAUUSDm_H1.csv")), h4: basename(join(input, "XAUUSDm_H4.csv")), d1: basename(join(input, "XAUUSDm_D1.csv")), sha256: fingerprint },
    window: { from_utc: new Date(start * 1000).toISOString(), to_utc: new Date(cutoff * 1000).toISOString() },
    summary: { evaluations: records.length, qualifying_signals: active.length, direction_flips: flips, t1: count("T1"), invalidated: count("INVALIDATED"), expired: count("EXPIRED") },
    records,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report.summary));
}

void main();
