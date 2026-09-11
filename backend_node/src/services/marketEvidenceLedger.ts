import { createHash, randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { getDb } from "../db.js";
import { normalizeGoldSymbol } from "./goldSymbol.js";
import { asUtc, extractEvidenceQuoteFromDetails } from "./marketOutlookEvidence.js";
import { MARKET_EVIDENCE_COLLECTION, MARKET_EVIDENCE_RETENTION_DAYS } from "./marketIntelligenceConfig.js";
import { recordPersistentDiagnostic } from "./persistentDiagnostics.js";
import { normalizeEnvironmentSource, normalizeRuntimeEnvironment } from "./accountProvenance.js";

export { MARKET_EVIDENCE_COLLECTION };

export interface MarketEvidenceInput {
  /** Operational activity row, if one exists. It is a link only, never the immutable identity. */
  source_activity_id: string;
  license_key: string;
  account: string;
  symbol: string;
  event_type: string;
  received_at: Date;
  details: Record<string, unknown>;
}

export interface MarketEvidenceReceipt {
  persisted: boolean;
  evidence_id: string | null;
  evidence_key: string | null;
  source_activity_id: string;
  observed_at: string | null;
  quote_valid: boolean;
}

function nonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length > 0);
}

export function hasMarketEvidence(details: Record<string, unknown> | null | undefined): boolean {
  const d = details ?? {};
  return nonEmptyRecord(d["market_thesis"]) || nonEmptyRecord(d["entry_readiness"]) || nonEmptyRecord(d["m10_signal"]);
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function evidenceKey(input: MarketEvidenceInput, observedAt: string, quote: ReturnType<typeof extractEvidenceQuoteFromDetails>): string {
  const d = input.details;
  const payload = {
    license_key: input.license_key,
    account: input.account,
    symbol: normalizeGoldSymbol(input.symbol),
    observed_at: observedAt,
    bid: quote.bid,
    ask: quote.ask,
    market_thesis: d["market_thesis"] ?? {},
    entry_readiness: d["entry_readiness"] ?? {},
    m10_signal: d["m10_signal"] ?? {},
    execution: {
      candidate_allowed: d["candidate_allowed"],
      final_execution_allowed: d["final_execution_allowed"],
      final_decision: d["final_decision"],
      final_blocker: d["final_blocker"] ?? d["blocked_by"],
      pipeline_stage: d["pipeline_stage"],
    },
  };
  return createHash("sha256").update(stableJson(payload), "utf8").digest("hex");
}

/** A payload clock this far ahead of our receive time is a skewed terminal clock, not a market observation time. */
const MAX_FUTURE_OBSERVATION_SKEW_MS = 2 * 60_000;

/**
 * Prefer the UTC timestamp carried by the broker/M10 payload.  `received_at`
 * is deliberately only the final fallback: retry delivery time is not the
 * time of the market observation and must not turn an exact retry into a new
 * historical event.
 *
 * M10 `bar_time`/`candle_time` are NOT observation times: the EA formats them
 * from the closed bar in BROKER-SERVER time at minute resolution
 * (TimeToString(g_m10Snapshot.closedBarTime)), whereas `evidence_time_utc` is
 * TimeGMT() at quote capture.  Using the bar time would stamp every quote in a
 * 10-minute bar with the bar open, shifted by the broker's UTC offset, and
 * break replay chronology.  The bar identity still participates in the
 * evidence key through the m10_signal content.
 */
function observationTime(input: MarketEvidenceInput, quote: ReturnType<typeof extractEvidenceQuoteFromDetails>): Date {
  const m10 = (input.details["m10_signal"] as Record<string, unknown> | undefined) ?? {};
  const thesis = (input.details["market_thesis"] as Record<string, unknown> | undefined) ?? {};
  const readiness = (input.details["entry_readiness"] as Record<string, unknown> | undefined) ?? {};
  // The selected quote bundle's own time first, so stored bid/ask and
  // observed_at always describe the same broker observation.
  const candidates = [
    quote.valid ? quote.quote_at : null,
    m10["quote_time"], m10["evidence_time_utc"], thesis["evidence_time_utc"], readiness["evidence_time_utc"],
  ];
  const latestAcceptable = input.received_at.getTime() + MAX_FUTURE_OBSERVATION_SKEW_MS;
  for (const candidate of candidates) {
    const parsed = asUtc(candidate);
    if (parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() <= latestAcceptable) return parsed;
  }
  return input.received_at;
}

export async function ensureMarketEvidenceIndexes(): Promise<void> {
  const db = getDb();
  const collection = db.collection(MARKET_EVIDENCE_COLLECTION);
  await collection.createIndex({ evidence_key: 1 }, { unique: true });
  await collection.createIndex({ source_activity_id: 1 });
  await collection.createIndex({ account: 1, observed_at: 1 });
  await collection.createIndex({ account: 1, received_at: -1 });
  await collection.createIndex({ license_key: 1, account: 1, received_at: -1 });
  await collection.createIndex({ normalized_symbol: 1, received_at: -1 });
  await collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
}

/**
 * Append-only market evidence. Operational activity is free to deduplicate or
 * prune for UI purposes; this record is separately identified and immutable.
 * An exact retry of the same broker/M10 snapshot is idempotent by evidence_key.
 */
export async function recordImmutableMarketEvidence(input: MarketEvidenceInput): Promise<MarketEvidenceReceipt> {
  if (!input.account || !hasMarketEvidence(input.details)) {
    return { persisted: false, evidence_id: null, evidence_key: null, source_activity_id: input.source_activity_id, observed_at: null, quote_valid: false };
  }

  const quote = extractEvidenceQuoteFromDetails(input.details, input.received_at.toISOString());
  const observed = observationTime(input, quote);
  const observedAt = observed.toISOString();
  const key = evidenceKey(input, observedAt, quote);
  const evidenceId = randomUUID();
  const now = input.received_at;
  const details = input.details;
  const doc = {
    id: evidenceId,
    evidence_key: key,
    source_activity_id: input.source_activity_id,
    license_key: input.license_key,
    account: input.account,
    symbol: input.symbol,
    normalized_symbol: normalizeGoldSymbol(input.symbol),
    event_type: input.event_type,
    received_at: now.toISOString(),
    observed_at: observedAt,
    expires_at: new Date(now.getTime() + MARKET_EVIDENCE_RETENTION_DAYS * 86_400_000),
    quote_valid: quote.valid,
    bid: quote.bid,
    ask: quote.ask,
    mid: quote.mid,
    spread: quote.spread,
    market_thesis: nonEmptyRecord(details["market_thesis"]) ? details["market_thesis"] : {},
    entry_readiness: nonEmptyRecord(details["entry_readiness"]) ? details["entry_readiness"] : {},
    m10_signal: nonEmptyRecord(details["m10_signal"]) ? details["m10_signal"] : {},
    post_trade_state: nonEmptyRecord(details["post_trade_state"]) ? details["post_trade_state"] : {},
    execution: {
      candidate_allowed: details["candidate_allowed"],
      final_execution_allowed: details["final_execution_allowed"],
      final_decision: details["final_decision"],
      final_blocker: details["final_blocker"] ?? details["blocked_by"],
      pipeline_stage: details["pipeline_stage"],
      open_trade_called: details["open_trade_called"],
      broker_retcode: details["broker_retcode"],
    },
    provenance: {
      // Stamped by the route from the server-side attestation resolver.
      runtime_environment: normalizeRuntimeEnvironment(details["runtime_environment"]),
      environment_source: normalizeEnvironmentSource(details["environment_source"]),
      environment_attestation_id: details["environment_attestation_id"] ? String(details["environment_attestation_id"]) : null,
      ea_version: String(details["ea_version"] ?? ""),
      broker_server: String(details["broker_server"] ?? ""),
      build_id: String(details["build_id"] ?? ""),
      source: String(details["source"] ?? input.event_type),
    },
  };

  try {
    await getDb().collection(MARKET_EVIDENCE_COLLECTION).insertOne(doc);
    return { persisted: true, evidence_id: evidenceId, evidence_key: key, source_activity_id: input.source_activity_id, observed_at: observedAt, quote_valid: quote.valid };
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      // Exact retry. The existing row is the immutable record; never let a
      // follow-up read failure surface into the EA acknowledgement path.
      const existing = await getDb().collection(MARKET_EVIDENCE_COLLECTION).findOne(
        { evidence_key: key },
        { projection: { _id: 0, id: 1, evidence_key: 1, source_activity_id: 1, observed_at: 1, quote_valid: 1 } },
      ).catch(() => null);
      return {
        persisted: Boolean(existing),
        evidence_id: existing ? String(existing["id"] ?? "") || null : null,
        evidence_key: existing ? String(existing["evidence_key"] ?? "") || key : key,
        source_activity_id: existing ? String(existing["source_activity_id"] ?? input.source_activity_id) : input.source_activity_id,
        observed_at: existing ? String(existing["observed_at"] ?? "") || null : observedAt,
        quote_valid: existing?.["quote_valid"] === true,
      };
    }
    await recordPersistentDiagnostic("error", "market-evidence-ledger", error, {
      code: "MARKET_EVIDENCE_PERSIST_FAILED",
      account: input.account,
      source_event_id: input.source_activity_id,
      details: { event_type: input.event_type, symbol: input.symbol, evidence_key: key },
    });
    return { persisted: false, evidence_id: null, evidence_key: key, source_activity_id: input.source_activity_id, observed_at: observedAt, quote_valid: quote.valid };
  }
}
