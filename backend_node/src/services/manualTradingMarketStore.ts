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

const GOLD_MIN = 1000;
const GOLD_MAX = 20_000;
const TIMEFRAMES = [
  { name: "H1", seconds: 60 * 60 },
  { name: "H4", seconds: 4 * 60 * 60 },
  { name: "D1", seconds: 24 * 60 * 60 },
] as const;

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoFromEvidence(value: unknown, fallback: Date): string {
  // EA evidence uses `YYYY.MM.DD HH:MM:SS`; accept it only when it parses.
  const raw = String(value ?? "").trim();
  const parsed = raw ? new Date(`${raw.replace(/\./g, "-").replace(" ", "T")}Z`) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback.toISOString();
}

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
}): Promise<void> {
  const thesis = (args.marketThesis && typeof args.marketThesis === "object" ? args.marketThesis : {}) as Record<string, unknown>;
  const bid = finite(thesis["live_bid"]);
  const ask = finite(thesis["live_ask"]);
  if (!args.account || !isGoldSymbol(args.symbol) || bid == null || ask == null || ask < bid || bid < GOLD_MIN || ask > GOLD_MAX) return;

  const sourceAt = isoFromEvidence(thesis["evidence_time_utc"], args.receivedAt);
  const sourceMs = new Date(sourceAt).getTime();
  if (!Number.isFinite(sourceMs)) return;
  const mid = (bid + ask) / 2;
  const db = getDb();

  await Promise.all(TIMEFRAMES.map(async ({ name, seconds }) => {
    const startMs = Math.floor(sourceMs / (seconds * 1000)) * seconds * 1000;
    const openTime = new Date(startMs).toISOString();
    // XAUUSDm is the same Gold market as XAUUSD for intelligence identity.
    // Preserve the raw broker symbol for traceability, but key the candle by
    // the one existing XauCloud canonical Gold symbol.
    const key = { account: args.account, symbol: normalizeGoldSymbol(args.symbol), timeframe: name, openTime };
    await db.collection("manual_trading_broker_candles").updateOne(
      key,
      {
        $setOnInsert: {
          ...key,
          brokerSymbol: String(args.symbol),
          o: mid,
          h: mid,
          l: mid,
          c: mid,
          firstSourceAt: sourceAt,
          source: "ea-stream(spot)",
          bid,
          ask,
        },
        $min: { l: mid },
        $max: { h: mid },
        $set: { c: mid, bid, ask, lastSourceAt: sourceAt, source: "ea-stream(spot)", brokerSymbol: String(args.symbol) },
        $inc: { samples: 1 },
      },
      { upsert: true },
    );
  }));
}

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
