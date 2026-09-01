import { createHash } from "node:crypto";

/** Port of backend/local_ai/schema.py -- schema for the private local-AI worker relay. */

export const SCHEMA_VERSION = "xaucloud-local-ai-v4";

const DIRECTIONS = new Set(["BUY", "SELL", "NONE"]);
const MARKET_STATES = new Set(["TREND", "PULLBACK", "BREAKOUT", "REVERSAL", "RANGE", "NO_EDGE"]);
const STRUCTURE_STATES = new Set(["CONFIRMED", "DEVELOPING", "BROKEN", "UNCLEAR"]);
const MOMENTUM_STATES = new Set(["IMPROVING", "STABLE", "WEAKENING", "CONTRADICTORY"]);
const LOCATION_QUALITIES = new Set(["GOOD", "EXCELLENT", "LATE", "RESET_PENDING", "OTHER"]);

export class SchemaError extends Error {}

function shortText(value: unknown, name: string, limit: number): string {
  if (typeof value !== "string") throw new SchemaError(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit || [...trimmed].some((c) => c.charCodeAt(0) < 32)) {
    throw new SchemaError(`${name} must contain 1..${limit} printable characters`);
  }
  return trimmed;
}

function shortCode(value: unknown): string {
  const v = shortText(value, "reason_code", 48).toUpperCase();
  if (![...v].every((c) => (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || c === "_")) {
    throw new SchemaError("reason codes may contain only A-Z, 0-9 and underscore");
  }
  return v;
}

function enumValue(value: unknown, name: string, allowed: Set<string>): string {
  const v = shortText(value, name, 96).toUpperCase();
  if (!allowed.has(v)) throw new SchemaError(`${name} must be one of ${[...allowed].sort()}`);
  return v;
}

function numberValue(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value === "boolean" || typeof value !== "number") throw new SchemaError(`${name} must be numeric`);
  if (Number.isNaN(value) || value < minimum || value > maximum) throw new SchemaError(`${name} is outside the allowed range`);
  return value;
}

export interface Snapshot {
  symbol: string;
  closed_m10_timestamp: number;
  recent_m10_ohlc: number[][];
  atr: number;
  volatility_state: string;
  ema_state: string;
  rsi: number;
  momentum_score: number;
  buy_score: number;
  sell_score: number;
  preferred_direction: string;
  setup: string;
  grade: string;
  session: string;
  regime: string;
  location: string;
  structure_state: string;
  breakout_state: string;
  pullback_state: string;
  reset_state: string;
  reward_room_r: number;
  higher_timeframe_context: string;
  open_position_state: string;
  allowed_candidate_setups: string[];
  model_name: string;
  prompt_schema_version: string;
}

const SNAPSHOT_FIELDS = [
  "symbol",
  "closed_m10_timestamp",
  "recent_m10_ohlc",
  "atr",
  "volatility_state",
  "ema_state",
  "rsi",
  "momentum_score",
  "buy_score",
  "sell_score",
  "preferred_direction",
  "setup",
  "grade",
  "session",
  "regime",
  "location",
  "structure_state",
  "breakout_state",
  "pullback_state",
  "reset_state",
  "reward_room_r",
  "higher_timeframe_context",
  "open_position_state",
  "allowed_candidate_setups",
  "model_name",
] as const;

/** Port of schema.py's `Snapshot.parse`. */
export function parseSnapshot(raw: unknown): Snapshot {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new SchemaError("snapshot must be an object");
  const rawObj = raw as Record<string, unknown>;
  const expected = new Set<string>([...SNAPSHOT_FIELDS, "prompt_schema_version"]);
  const extra = Object.keys(rawObj).filter((k) => !expected.has(k));
  if (extra.length > 0) throw new SchemaError(`unknown snapshot fields: ${extra.sort()}`);
  const missing = SNAPSHOT_FIELDS.filter((f) => !(f in rawObj));
  if (missing.length > 0) throw new SchemaError(`missing snapshot fields: ${missing.sort()}`);

  const promptSchemaVersion = rawObj["prompt_schema_version"] ?? SCHEMA_VERSION;
  if (promptSchemaVersion !== SCHEMA_VERSION) throw new SchemaError("unsupported prompt/schema version");

  const symbol = shortText(rawObj["symbol"], "symbol", 24);
  const modelName = shortText(rawObj["model_name"], "model_name", 96);
  const textFields: Record<string, string> = {};
  for (const name of [
    "volatility_state",
    "ema_state",
    "setup",
    "grade",
    "session",
    "regime",
    "location",
    "structure_state",
    "breakout_state",
    "pullback_state",
    "reset_state",
    "higher_timeframe_context",
    "open_position_state",
  ]) {
    textFields[name] = shortText(rawObj[name], name, 160);
  }
  const preferredDirection = enumValue(rawObj["preferred_direction"], "preferred_direction", DIRECTIONS);
  const closedM10Timestamp = rawObj["closed_m10_timestamp"];
  if (typeof closedM10Timestamp !== "number" || !Number.isInteger(closedM10Timestamp) || closedM10Timestamp <= 0) {
    throw new SchemaError("closed_m10_timestamp must be a positive integer");
  }
  const numberFields: Record<string, number> = {};
  for (const name of ["atr", "rsi", "momentum_score", "buy_score", "sell_score", "reward_room_r"]) {
    numberFields[name] = numberValue(rawObj[name], name, -1_000_000, 1_000_000);
  }
  const ohlc = rawObj["recent_m10_ohlc"];
  if (!Array.isArray(ohlc) || ohlc.length < 1 || ohlc.length > 6) {
    throw new SchemaError("recent_m10_ohlc must contain 1..6 closed candles");
  }
  const parsedOhlc: number[][] = ohlc.map((candle, index) => {
    if (!Array.isArray(candle) || candle.length !== 4) throw new SchemaError(`recent_m10_ohlc[${index}] must be [open,high,low,close]`);
    return candle.map((v) => numberValue(v, `ohlc[${index}]`, 0, 1_000_000));
  });
  const allowedSetupsRaw = rawObj["allowed_candidate_setups"];
  if (!Array.isArray(allowedSetupsRaw) || allowedSetupsRaw.length < 1 || allowedSetupsRaw.length > 12) {
    throw new SchemaError("allowed_candidate_setups must contain 1..12 existing setup names");
  }
  const allowedCandidateSetups = allowedSetupsRaw.map((v) => shortCode(v));

  return {
    symbol,
    closed_m10_timestamp: closedM10Timestamp,
    recent_m10_ohlc: parsedOhlc,
    atr: numberFields["atr"]!,
    volatility_state: textFields["volatility_state"]!,
    ema_state: textFields["ema_state"]!,
    rsi: numberFields["rsi"]!,
    momentum_score: numberFields["momentum_score"]!,
    buy_score: numberFields["buy_score"]!,
    sell_score: numberFields["sell_score"]!,
    preferred_direction: preferredDirection,
    setup: textFields["setup"]!,
    grade: textFields["grade"]!,
    session: textFields["session"]!,
    regime: textFields["regime"]!,
    location: textFields["location"]!,
    structure_state: textFields["structure_state"]!,
    breakout_state: textFields["breakout_state"]!,
    pullback_state: textFields["pullback_state"]!,
    reset_state: textFields["reset_state"]!,
    reward_room_r: numberFields["reward_room_r"]!,
    higher_timeframe_context: textFields["higher_timeframe_context"]!,
    open_position_state: textFields["open_position_state"]!,
    allowed_candidate_setups: allowedCandidateSetups,
    model_name: modelName,
    prompt_schema_version: SCHEMA_VERSION,
  };
}

export interface Decision {
  preferred_direction: string;
  candidate_allowed: boolean;
  candidate_setup: string;
  market_state: string;
  structure_state: string;
  momentum_state: string;
  location_quality: string;
  confidence: number;
  reason_codes: string[];
  short_reason: string;
}

const DECISION_FIELDS = new Set([
  "preferred_direction",
  "candidate_allowed",
  "candidate_setup",
  "market_state",
  "structure_state",
  "momentum_state",
  "location_quality",
  "confidence",
  "reason_codes",
  "short_reason",
]);

/** Port of schema.py's `Decision.parse`. */
export function parseDecision(raw: unknown): Decision {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new SchemaError("decision must be an object");
  const rawObj = raw as Record<string, unknown>;
  const keys = new Set(Object.keys(rawObj));
  if (keys.size !== DECISION_FIELDS.size || ![...DECISION_FIELDS].every((f) => keys.has(f))) {
    throw new SchemaError(`decision fields must be exactly ${[...DECISION_FIELDS].sort()}`);
  }
  if (typeof rawObj["candidate_allowed"] !== "boolean") throw new SchemaError("candidate_allowed must be boolean");
  const confidence = rawObj["confidence"];
  if (typeof confidence === "boolean" || typeof confidence !== "number" || !Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    throw new SchemaError("confidence must be an integer from 0 to 100");
  }
  const reasonCodesRaw = rawObj["reason_codes"];
  if (!Array.isArray(reasonCodesRaw) || reasonCodesRaw.length > 6) throw new SchemaError("reason_codes must be an array of at most 6 items");
  const reasonCodes = reasonCodesRaw.map((v) => shortCode(v));

  return {
    preferred_direction: enumValue(rawObj["preferred_direction"], "preferred_direction", DIRECTIONS),
    candidate_allowed: rawObj["candidate_allowed"] as boolean,
    candidate_setup: shortText(rawObj["candidate_setup"], "candidate_setup", 96),
    market_state: enumValue(rawObj["market_state"], "market_state", MARKET_STATES),
    structure_state: enumValue(rawObj["structure_state"], "structure_state", STRUCTURE_STATES),
    momentum_state: enumValue(rawObj["momentum_state"], "momentum_state", MOMENTUM_STATES),
    location_quality: enumValue(rawObj["location_quality"], "location_quality", LOCATION_QUALITIES),
    confidence,
    reason_codes: reasonCodes,
    short_reason: shortText(rawObj["short_reason"], "short_reason", 240),
  };
}

/** Port of schema.py's `snapshot_signature` -- canonical JSON (sorted keys, no whitespace) SHA-256. */
export function snapshotSignature(snapshot: Snapshot): string {
  const sortedKeys = Object.keys(snapshot).sort();
  const canonicalObj: Record<string, unknown> = {};
  for (const k of sortedKeys) canonicalObj[k] = (snapshot as unknown as Record<string, unknown>)[k];
  const canonical = JSON.stringify(canonicalObj);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
