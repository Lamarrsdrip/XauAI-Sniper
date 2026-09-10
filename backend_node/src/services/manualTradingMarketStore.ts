/**
 * Durable, broker-originated candle store for Manual Trading Intelligence.
 *
 * `cloud_bot_activity` is intentionally short-lived operational telemetry.
 * It must never be the historical source of truth for a Daily/H4 thesis.
 * This collector writes only verified bid/ask observations from the connected
 * EA into account-scoped OHLC buckets, preserving the provenance and source
 * timestamp needed to audit every later thesis.
 */
import { getDb } from "../db.js";
import { isGoldSymbol, normalizeGoldSymbol } from "./goldSymbol.js";

import { createHash } from "node:crypto";
const GOLD_MIN = 1000;
const GOLD_MAX = 20_000;
const TIMEFRAMES = [
  { name: "H1", seconds: 60 * 60 },
  { name: "H4", seconds: 4 * 60 * 60 },
  { name: "D1", seconds: 24 * 60 * 60 },
] as const;

export interface VerifiedManualQuoteReceipt {
  persisted: boolean;
  normalizedSymbol: string;
  sourceAt: string | null;
  close: number | null;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoFromEvidence(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let normalized = raw;
  if (/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    normalized = `${raw.replace(/\./g, "-").replace(" ", "T")}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    normalized = `${raw.replace(" ", "T")}Z`;
  }
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
} // ASTRA_REPAIR_V2_6287 / 004


/**
 * Best-effort collection; it never affects the EA activity acknowledgement.
 * Invalid, missing, crossed, or out-of-range quotes are rejected rather than
 * being converted to a plausible-looking current price.
 */
export async function recordVerifiedManualTradingQuote(args: {
  account: string;
  symbol: string;
  receivedAt: Date;
  marketThesis: unknown;
}): Promise<VerifiedManualQuoteReceipt> {
  const thesis = (args.marketThesis && typeof args.marketThesis === "object" ? args.marketThesis : {}) as Record<string, unknown>;
  const bid = finite(thesis["live_bid"]);
  const ask = finite(thesis["live_ask"]);
  const normalizedSymbol = normalizeGoldSymbol(args.symbol);
  const rejected = { persisted: false, normalizedSymbol, sourceAt: null, close: null };
  if (!args.account || !isGoldSymbol(args.symbol) || bid == null || ask == null || ask < bid || bid < GOLD_MIN || ask > GOLD_MAX) return rejected;
  const sourceAt = isoFromEvidence(thesis["evidence_time_utc"]);
  if (!sourceAt) return rejected;
  const sourceMs = new Date(sourceAt).getTime();
  const receivedAt = args.receivedAt.toISOString();
  const mid = (bid + ask) / 2;
  const db = getDb();

  const sampleId = createHash("sha256").update([args.account, normalizedSymbol, sourceAt, String(bid), String(ask)].join("|")).digest("hex");
  const sourceOrderKey = `${sourceAt}|${sampleId}`;
  await db.collection<{ _id: string } & Record<string, unknown>>("manual_trading_broker_quote_samples").updateOne(
    { _id: sampleId },
    { $setOnInsert: { account: args.account, symbol: normalizedSymbol, brokerSymbol: String(args.symbol), sourceAt, receivedAt, bid, ask, mid } },
    { upsert: true },
  );

  await Promise.all(TIMEFRAMES.map(async ({ name, seconds }) => {
    const openTime = new Date(Math.floor(sourceMs / (seconds * 1000)) * seconds * 1000).toISOString();
    const key = { account: args.account, symbol: normalizedSymbol, timeframe: name, openTime };
    await db.collection("manual_trading_broker_candles").updateOne(
      key,
      [{ $set: {
        ...key,
        source: "ea-stream(spot)",
        // Legacy candles predate the order-key field. Their stored source
        // timestamp remains a safe migration baseline; treating it as
        // "missing" would let a late packet overwrite their open/close.
        o: { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$firstSourceAt", null] }, null] }, { $gt: [{ $ifNull: ["$firstOrderKey", { $concat: ["$firstSourceAt", "|"] }] }, sourceOrderKey] }] }, mid, { $ifNull: ["$o", mid] }] },
        h: { $max: [{ $ifNull: ["$h", mid] }, mid] },
        l: { $min: [{ $ifNull: ["$l", mid] }, mid] },
        c: { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$lastSourceAt", null] }, null] }, { $lt: [{ $ifNull: ["$lastOrderKey", { $concat: ["$lastSourceAt", "|"] }] }, sourceOrderKey] }] }, mid, { $ifNull: ["$c", mid] }] },
        bid: { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$lastSourceAt", null] }, null] }, { $lt: [{ $ifNull: ["$lastOrderKey", { $concat: ["$lastSourceAt", "|"] }] }, sourceOrderKey] }] }, bid, "$bid"] },
        ask: { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$lastSourceAt", null] }, null] }, { $lt: [{ $ifNull: ["$lastOrderKey", { $concat: ["$lastSourceAt", "|"] }] }, sourceOrderKey] }] }, ask, "$ask"] },
        brokerSymbol: { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$lastSourceAt", null] }, null] }, { $lt: [{ $ifNull: ["$lastOrderKey", { $concat: ["$lastSourceAt", "|"] }] }, sourceOrderKey] }] }, String(args.symbol), "$brokerSymbol"] },
        firstSourceAt: { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$firstSourceAt", null] }, null] }, { $gt: [{ $ifNull: ["$firstOrderKey", { $concat: ["$firstSourceAt", "|"] }] }, sourceOrderKey] }] }, sourceAt, "$firstSourceAt"] },
        lastSourceAt: { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$lastSourceAt", null] }, null] }, { $lt: [{ $ifNull: ["$lastOrderKey", { $concat: ["$lastSourceAt", "|"] }] }, sourceOrderKey] }] }, sourceAt, "$lastSourceAt"] },
        firstOrderKey: { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$firstSourceAt", null] }, null] }, { $gt: [{ $ifNull: ["$firstOrderKey", { $concat: ["$firstSourceAt", "|"] }] }, sourceOrderKey] }] }, sourceOrderKey, { $ifNull: ["$firstOrderKey", { $concat: ["$firstSourceAt", "|"] }] }] },
        lastOrderKey: { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$lastSourceAt", null] }, null] }, { $lt: [{ $ifNull: ["$lastOrderKey", { $concat: ["$lastSourceAt", "|"] }] }, sourceOrderKey] }] }, sourceOrderKey, { $ifNull: ["$lastOrderKey", { $concat: ["$lastSourceAt", "|"] }] }] },
        firstReceivedAt: { $min: [{ $ifNull: ["$firstReceivedAt", receivedAt] }, receivedAt] },
        lastReceivedAt: { $max: [{ $ifNull: ["$lastReceivedAt", receivedAt] }, receivedAt] },
        sampleKeys: { $setUnion: [{ $ifNull: ["$sampleKeys", []] }, [sampleId]] },
      }}, { $set: { samples: { $size: "$sampleKeys" } } }],
      { upsert: true },
    );
  }));
  return { persisted: true, normalizedSymbol, sourceAt, close: mid };
} // ASTRA_REPAIR_V2_6287 / 004


/** Persist entry/exit decision evidence beyond the short activity retention. */
export async function recordAuditableEaDecision(args: {
  at: Date;
  account: string;
  symbol: string;
  eventType: string;
  severity: string;
  category: string;
  message: string;
  details: Record<string, unknown>;
}): Promise<void> {
  if (!args.account || !isGoldSymbol(args.symbol) || !["entries", "exits"].includes(args.category)) return;
  const d = args.details;
  await getDb().collection("manual_trading_ea_decisions").insertOne({
    recordedAt: args.at.toISOString(), account: args.account, symbol: normalizeGoldSymbol(args.symbol), brokerSymbol: String(args.symbol),
    eventType: args.eventType, severity: args.severity, category: args.category,
    message: args.message.slice(0, 600), ticket: String(d["ticket"] ?? ""),
    module: String(d["module"] ?? ""), reason: String(d["reason"] ?? "").slice(0, 1200),
    market_thesis: d["market_thesis"] ?? {}, entry_readiness: d["entry_readiness"] ?? {},
    m10_signal: d["m10_signal"] ?? {}, ea_version: d["ea_version"] ?? "", build_hash: d["build_hash"] ?? "",
  });
}


export async function loadClosedBrokerHtfEvidence(account: string, symbol: string, at = new Date()): Promise<{
  complete: boolean; candles: Record<string, Record<string, unknown>>; missing: string[]; provenance: Record<string, unknown>;
}> {
  const normalizedSymbol = normalizeGoldSymbol(symbol);
  const db = getDb();
  const candles: Record<string, Record<string, unknown>> = {};
  const missing: string[] = [];
  for (const { name, seconds } of TIMEFRAMES) {
    const latestClosedOpen = new Date(Math.floor(at.getTime() / (seconds * 1000)) * seconds * 1000 - seconds * 1000).toISOString();
    const row = await db.collection("manual_trading_broker_candles").findOne(
      { account, symbol: normalizedSymbol, timeframe: name, openTime: { $lte: latestClosedOpen } },
      { projection: { _id: 0 }, sort: { openTime: -1 } },
    );
    if (!row) { missing.push(name); continue; }
    candles[name] = row as Record<string, unknown>;
  }
  return { complete: missing.length === 0, candles, missing, provenance: { account, symbol: normalizedSymbol, required: ["H1", "H4", "D1"], evaluated_at: at.toISOString() } };
} // ASTRA_REPAIR_V2_6287 / 005
